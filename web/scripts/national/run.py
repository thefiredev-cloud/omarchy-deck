#!/usr/bin/env python3
"""Source plugin runner for the national dataset v2 (program 2026-11-14).

Discovers `sources/*.py`, checks each SOURCE with `ctx.check_source`, and runs every `load()` in its own child process
with a timeout and a memory cap, so one slow, broken or greedy source never stops the others. Each run ends as one
status for the manifest: ok, unavailable (with the plain reason), needs_key (with the env name) or invalid (the SPEC
problems).

The parsed result of each source is kept on disk (`<state>/results/<id>.json.gz`) with the list of downloads the run
made. A later run first replays those downloads through `ctx.fetch` (cached copies or conditional requests, and the
URLs that failed last time); when the source file, ctx.py and every download are unchanged, the stored result is used
and nothing is parsed again. `--force` reruns every source and refetches.

Usage: run.py [--force] [--only id,id] [--jobs N] [--timeout S] [SOURCES_DIR]   (prints one line per source)
       run.py --child SOURCE_PATH OUT_PATH PREV_PATH FORCE   (internal)
"""
import base64
import gzip
import hashlib
import json
import os
import resource
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import ctx  # noqa: E402

SOURCES_DIR = os.path.join(HERE, "sources")
STATE_DIR = os.path.join(ctx.CACHE_ROOT, "_runner")
DEFAULT_TIMEOUT = 20 * 60          # SPEC: a cold run stays under 15 minutes; 5 more before the runner gives up
REUSE_MAX_AGE = 7 * 86400          # a stored result older than this reruns even when every download is unchanged
MEM_CAP = 6 * 1024 ** 3            # address-space cap per source process (machine rule: one process under 6 GB)
LIMITS = {"cold_s": 15 * 60, "warm_s": 3 * 60, "peak_mb": 2048}
# sources.json `mem: heavy`: at most one of these runs at a time (DataArch section 3)
HEAVY = {"redfin_zip_market", "redfin_zip_supply_signals", "zillow_zhvi_variants", "realtor_hotness_zip",
         "fhfa_uad_tract", "acs5_housing_people", "lehd_lodes_wac", "hud_chas_tract", "hud_picture_zip",
         "ejscreen_mirror", "ookla_fixed_tiles", "epa_frs_zip", "realtor_zip_history", "nces_edge_schools",
         "realtor_metro"}  # L03 2026-11-17: 34 MB metro history plus 9 MB hotness download
SOURCE_KEYS = ("name", "publisher", "homepage", "level", "group", "cadence", "license", "key_env", "fields", "native",
               "tract_vintage", "legacy")


def discover(src_dir=SOURCES_DIR):
    """Every sources/<id>.py, sorted; files starting with '_' are helpers, not sources."""
    try:
        names = sorted(os.listdir(src_dir))
    except OSError:
        return []
    return [os.path.join(src_dir, n) for n in names if n.endswith(".py") and not n.startswith("_")]


def code_sha(path):
    """Fingerprint of a source file plus ctx.py (a ctx change can change any parse)."""
    h = hashlib.sha256()
    for p in (path, os.path.join(HERE, "ctx.py")):
        with open(p, "rb") as fh:
            h.update(fh.read())
    return h.hexdigest()[:16]


def _atomic_gz(path, obj):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = "%s.%d.tmp" % (path, os.getpid())
    with gzip.open(tmp, "wt", encoding="utf8", compresslevel=5) as fh:
        json.dump(obj, fh, separators=(",", ":"), allow_nan=False)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def read_result(path):
    """A stored run: {sha, saved_at, report, result, fetches}, or None."""
    try:
        with gzip.open(path, "rt", encoding="utf8") as fh:
            return json.load(fh)
    except (OSError, ValueError, EOFError):
        return None


# ---------------------------------------------------------------- child side

class RecordingCtx(ctx.Ctx):
    """A Ctx that remembers every download attempt, so the next run can tell whether anything changed."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.fetches = []

    def fetch(self, url, name=None, min_age=ctx.DEFAULT_MIN_AGE, timeout=300, min_bytes=64, headers=None, data=None):
        rec = {"url": url, "name": name, "min_bytes": min_bytes, "headers": headers or None,
               "data": base64.b64encode(data).decode() if data else None}
        try:
            path, meta = super().fetch(url, name, min_age=min_age, timeout=timeout, min_bytes=min_bytes,
                                       headers=headers, data=data)
        except ctx.SourceUnavailable:
            rec["ok"] = False
            self.fetches.append(rec)
            raise
        rec.update(ok=True, changed_at=meta.get("changed_at"), bytes=meta.get("bytes"))
        self.fetches.append(rec)
        return path, meta


def unchanged(source_id, fetches):
    """Replay a stored run's downloads. True when every file is the same copy and every failed URL still fails."""
    if not fetches:
        return False  # a source that downloads nothing (or recorded nothing) is cheap to run again
    c = ctx.Ctx(source_id, quiet=True)
    seen = set()
    for f in fetches:
        key = (f["url"], f.get("name"), f.get("data"))
        if key in seen:
            continue
        seen.add(key)
        data = base64.b64decode(f["data"]) if f.get("data") else None
        try:
            _, meta = c.fetch(f["url"], f.get("name"), min_bytes=f.get("min_bytes") or 64, headers=f.get("headers"),
                              data=data)
        except ctx.SourceUnavailable:
            if f.get("ok"):
                return False  # the copy is gone
            continue
        if not f.get("ok"):
            return False  # a URL that failed last time answers now (a newer vintage)
        if meta.get("changed_at") != f.get("changed_at") or meta.get("bytes") != f.get("bytes"):
            return False
    return True


def child(path, out_path, prev_path, force):
    """Run one source and write {sha, report, result, fetches} (or {"reuse": true}) to out_path."""
    sha = code_sha(path)
    prev = None if force or not prev_path else read_result(prev_path)
    if (prev and prev.get("sha") == sha and prev.get("report", {}).get("status") == "ok"
            and time.time() - prev.get("saved_at", 0) < REUSE_MAX_AGE):
        sid = prev["report"]["id"]
        if unchanged(sid, prev.get("fetches")):
            _write_report(out_path, dict(prev["report"], peak_mb=_hwm_mb()), reused=True)
            return 0
    t0 = time.time()
    stem = os.path.basename(path)[:-3]
    report = {"id": stem, "status": "ok", "reason": None, "problems": []}
    result, fetches = None, []
    try:
        mod = ctx.load_module(path)
    except Exception as exc:  # noqa: BLE001 - an import error is this source's status
        mod = None
        report.update(status="invalid", reason="import failed: %s: %s" % (exc.__class__.__name__, ctx.short(exc, 200)))
    source = (getattr(mod, "SOURCE", None) or {}) if mod else {}
    if mod:
        report["problems"] = ctx.check_source(source)
        if source.get("id") and source["id"] != stem:
            report["problems"].append("SOURCE.id %s does not match the file name %s.py" % (source["id"], stem))
        report["source"] = {k: source.get(k) for k in SOURCE_KEYS}
    if mod is None:
        pass  # the import error is the status
    elif report["problems"]:
        report.update(status="invalid", reason="; ".join(report["problems"])[:300])
    elif not callable(getattr(mod, "load", None)):
        report.update(status="invalid", reason="load(ctx) is missing")
    else:
        c = RecordingCtx(stem, force=force)
        try:
            result = mod.load(c)
            report["problems"] = ctx.check_result(source, result)
            if report["problems"]:
                report.update(status="invalid", reason="; ".join(report["problems"])[:300])
                result = None
        except ctx.NeedsKey as exc:
            report.update(status="needs_key", reason=str(exc), key_env=exc.env)
        except ctx.SourceUnavailable as exc:
            report.update(status="unavailable", reason=ctx.short(exc, 300))
        except Exception as exc:  # noqa: BLE001 - a crash in one source is that source's status, never the build's
            report.update(status="invalid", reason="load() raised %s: %s" % (exc.__class__.__name__, ctx.short(exc, 200)))
        fetches = c.fetches
        report["requests"] = c.requests
    if result is not None:
        data = result.get("data") or {}
        report.update(as_of=result.get("as_of"), rows=result.get("rows"), geos=len(data), note=result.get("note"))
    report["load_s"] = round(time.time() - t0, 1)
    report["peak_mb"] = _hwm_mb()
    doc = {"sha": sha, "saved_at": int(time.time()), "report": report, "result": result, "fetches": fetches}
    try:
        _atomic_gz(out_path, doc)
    except ValueError:  # NaN or infinity in the data: refuse the result rather than publish junk
        report.update(status="invalid", reason="load() returned NaN or infinite numbers (missing must be None)")
        _atomic_gz(out_path, dict(doc, result=None))
    _write_report(out_path, report, reused=False)
    return 0


def _write_report(out_path, report, reused):
    """The report beside the result, so the parent never loads a whole parsed result just to read it."""
    side = out_path + ".report.json"
    with open(side + ".part", "w", encoding="utf8") as fh:
        json.dump({"report": report, "reused": reused}, fh)
    os.replace(side + ".part", side)


def _hwm_mb():
    """Peak resident memory of this process since exec, in MB (VmHWM). getrusage would also count the memory of the
    parent the child was forked from, which holds the whole ZIP table during a build."""
    try:
        with open("/proc/self/status", encoding="ascii") as fh:
            for ln in fh:
                if ln.startswith("VmHWM:"):
                    return round(int(ln.split()[1]) / 1024)
    except (OSError, ValueError):
        pass
    return None


# ---------------------------------------------------------------- parent side

def _limit():
    resource.setrlimit(resource.RLIMIT_AS, (MEM_CAP, MEM_CAP))
    os.nice(5)


def cadence_days(cadence):
    """Two cadences, the age up to which a last good result stands in for a failed run (DataArch section 3)."""
    c = (cadence or "").lower()
    for word, days in (("hour", 2), ("dai", 2), ("week", 14), ("month", 62), ("quarter", 190)):
        if word in c:
            return days
    return 400  # annual and slower


def _side(store):
    return store[:-len(".json.gz")] + ".meta.json"


def _stale(job, rep):
    """A failed run falls back to the last good stored result when it is young enough; status `stale`."""
    try:
        with open(_side(job["store"]), encoding="utf8") as fh:
            last = json.load(fh)
    except (OSError, ValueError):
        return rep, None
    age = time.time() - last.get("saved_at", 0)
    src = (last.get("report") or {}).get("source") or {}
    if not os.path.exists(job["store"]) or age > cadence_days(src.get("cadence")) * 86400:
        return rep, None
    when = time.strftime("%Y-%m-%d", time.localtime(last["saved_at"]))
    out = dict(last["report"], id=rep["id"], file=rep.get("file"), seconds=rep.get("seconds"), reused=True,
               status="stale", reason=("this run failed (%s); using the result of %s" % (rep.get("reason"), when))[:300])
    return out, job["store"]


def _finish(job, word):
    """Turn a finished child into the manifest report; keep the stored (last good) result current."""
    out_tmp, store = job["tmp"], job["store"]
    side = out_tmp + ".report.json"
    base = {"id": job["id"], "file": os.path.basename(job["path"]), "seconds": round(time.time() - job["t0"], 1)}
    got = None
    if word == "exit0":
        try:
            with open(side, encoding="utf8") as fh:
                got = json.load(fh)
        except (OSError, ValueError):
            word = "no report written"
    if got is None:
        for p in (side, out_tmp):
            if os.path.exists(p):
                os.unlink(p)
        tail = ""
        try:
            with open(job["log"], encoding="utf8", errors="replace") as fh:
                lines = [ln.strip() for ln in fh.read()[-4000:].splitlines() if ln.strip()]
            tail = ctx.short(lines[-1], 200) if lines else ""
        except OSError:
            pass
        if word == "timeout":
            reason = "timed out after %d s" % job["timeout"]
        elif "MemoryError" in tail or word == "signal 9":
            reason = "stopped at the %d GB memory cap (%s)" % (MEM_CAP >> 30, word)
        else:
            reason = "source process failed (%s)%s" % (word, (": " + tail) if tail else "")
        return _stale(job, dict(base, status="unavailable" if word == "timeout" else "invalid", reason=reason[:300]))
    os.unlink(side)
    rep = dict(got["report"], **base, reused=got["reused"])
    if got["reused"]:
        return rep, store
    if rep.get("status") != "ok":
        if os.path.exists(out_tmp):
            os.unlink(out_tmp)
        return _stale(job, rep) if rep.get("status") in ("unavailable", "invalid") else (rep, None)
    os.replace(out_tmp, store)
    with open(_side(store) + ".part", "w", encoding="utf8") as fh:
        json.dump({"saved_at": int(time.time()), "report": rep}, fh)
    os.replace(_side(store) + ".part", _side(store))
    return rep, store


def run_all(src_dir=SOURCES_DIR, force=False, only=None, skip=None, jobs=3, timeout=DEFAULT_TIMEOUT,
            state_dir=STATE_DIR, log=None):
    """Run every source. Returns [(report, result_path or None)] in file order. Never raises for a source.
    At most one HEAVY source runs at a time, beside light ones, up to `jobs`. A child writes its stderr to
    <state>/logs/<id>.log (kept for the last run)."""
    log = log or (lambda msg: print(msg, file=sys.stderr, flush=True))
    res_dir, log_dir = os.path.join(state_dir, "results"), os.path.join(state_dir, "logs")
    for d in (res_dir, log_dir):
        os.makedirs(d, mode=0o700, exist_ok=True)
    queue = []
    for path in discover(src_dir):
        sid = os.path.basename(path)[:-3]
        if (only and sid not in only) or (skip and sid in skip):
            continue
        store = os.path.join(res_dir, sid + ".json.gz")
        queue.append({"id": sid, "path": path, "store": store, "tmp": store + ".new", "timeout": timeout,
                      "log": os.path.join(log_dir, sid + ".log")})
    out, running = {}, {}
    while queue or running:
        heavy_running = any(j["id"] in HEAVY for j in running.values())
        while queue and len(running) < max(1, jobs):
            pick = next((j for j in queue if not (heavy_running and j["id"] in HEAVY)), None)
            if pick is None:
                break
            queue.remove(pick)
            job = pick
            heavy_running = heavy_running or job["id"] in HEAVY
            job["t0"] = time.time()
            prev = job["store"] if os.path.exists(job["store"]) else ""
            with open(job["log"], "w", encoding="utf8") as errfh:
                os.chmod(job["log"], 0o600)
                proc = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--child", job["path"], job["tmp"],
                                         prev, "1" if force else "0"], stdin=subprocess.DEVNULL,
                                        stdout=errfh, stderr=errfh, preexec_fn=_limit, start_new_session=True)
            job["proc"] = proc
            running[proc.pid] = job
        time.sleep(0.2)
        for pid, job in list(running.items()):
            wpid, st = os.waitpid(pid, os.WNOHANG)
            if wpid == 0:
                if time.time() - job["t0"] <= job["timeout"]:
                    continue
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                _, st = os.waitpid(pid, 0)
                word = "timeout"
            else:
                code = os.waitstatus_to_exitcode(st)
                word = "exit0" if code == 0 else ("signal %d" % -code if code < 0 else "exit %d" % code)
            job["proc"].returncode = os.waitstatus_to_exitcode(st)  # reaped here; keeps Popen from waiting again
            rep, res = _finish(job, word)
            rep["limits"] = limit_breaches(rep)
            del running[pid]
            out[job["path"]] = (rep, res)
            log(line(rep))
    return [out[p] for p in sorted(out)]


def limit_breaches(rep):
    """SPEC size and manners limits a run broke (plain words for the lane that owns the source)."""
    out = []
    secs = rep.get("load_s") or rep.get("seconds") or 0
    if not rep.get("reused") and secs > LIMITS["cold_s"]:
        out.append("load took %d s (15 minutes at most cold)" % secs)
    if (rep.get("peak_mb") or 0) > LIMITS["peak_mb"]:
        out.append("peak memory %d MB (2 GB at most)" % rep["peak_mb"])
    return out


def line(rep):
    return "%-32s %-11s as_of=%-10s rows=%-8s geos=%-6s %5ss %5sMB%s %s" % (
        rep.get("id"), rep.get("status"), rep.get("as_of"), rep.get("rows"), rep.get("geos"), rep.get("seconds"),
        rep.get("peak_mb"), " reused" if rep.get("reused") else "", rep.get("reason") or "")


def load_result(path):
    """The source's load() result ({as_of, rows, data, hist, note}) from a stored run."""
    got = read_result(path) if path else None
    return (got or {}).get("result")


def _clean(v):
    """A value safe for the shards: finite numbers, text and booleans; anything else is dropped."""
    if isinstance(v, bool) or isinstance(v, str):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if v == v and v not in (float("inf"), float("-inf")) else None
    return None


MERGED = ("ok", "stale")


def pack_hist(series, periods_seen):
    """[[period, value], ...] -> (periods tuple shared across geos, array('d') of values); compact in memory."""
    import array  # noqa: PLC0415
    pts = [(str(p), v) for p, v in series if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v]
    key = tuple(p for p, _ in pts)
    key = periods_seen.setdefault(key, key)
    return key, array.array("d", (v for _, v in pts))


def merge(store, runs, reserved, county_of, xwalk_get=None, hist=None):
    """Put every ok (or stale) plugin source's fields into the columnar store (xwalk.Store).

    zip-level data goes in as is; tract and county data go through the crosswalk; cbsa, state and us data are
    returned as `context` for the rollups and the blend. Wrapped legacy sources (SOURCE.legacy) are skipped: their
    fields come from the legacy builder. A field whose name is reserved (legacy field, metric, score) or already taken
    by an earlier source is dropped and named in the report (`dropped_fields`). Each report gains zips, coverage
    {field: ZIPs}, zips_outside and xwalk stats. `hist`, when given, collects every source's history as
    {field: {"level", "source", "geo": {geo: (periods, values)}}}. Returns (owner {field: source}, context).

    County sources merge after every other level, so a county source of `group: commercial` can apportion its counts
    by the ZIP job share of the LODES workplace table merged before it: it asks xwalk_get for "county_jobs" instead
    of "county" (DataArch section 4).

    Crosswalked fields record their mode in meta (`xwalk`: sum, mean or assign). The published values of every
    numeric county field, and of tract fields with agg sum that were not apportioned (mean or assign), are kept in
    `store.areas` {field: {"level", "values": {geo: value}}} so the rollups count each county or tract once
    (writer.v2_rollups) instead of summing a county value copied to each of its ZIPs."""
    import xwalk  # noqa: PLC0415
    if xwalk_get is None:
        xwalk_get = xwalk.get
    if not hasattr(store, "areas"):
        store.areas = {}
    owner, context, periods_seen = {}, {"cbsa": {}, "state": {}, "us": {}}, {}
    for rep, path in sorted(runs, key=lambda rp: (rp[0].get("source") or {}).get("level") == "county"):
        src = rep.get("source") or {}
        if rep.get("status") not in MERGED or not path or src.get("legacy"):
            continue
        sid = rep["id"]
        fields, dropped = {}, []
        for f, spec in (src.get("fields") or {}).items():
            if f in reserved:
                dropped.append("%s (reserved name)" % f)
            elif f in owner:
                dropped.append("%s (already from %s)" % (f, owner[f]))
            else:
                fields[f] = spec
        rep["dropped_fields"] = dropped
        result = load_result(path) or {}
        data, level = result.get("data") or {}, src.get("level")
        for f, spec in fields.items():
            store.meta[f] = {"source": sid, "level": level, "native": src.get("native") or level,
                             "unit": spec.get("unit"), "agg": spec.get("agg", "none"), "as_of": rep.get("as_of"),
                             "context": level in context}
            if level in ("county", "tract"):
                store.meta[f]["xwalk"] = xwalk.default_mode(spec)
        if hist is not None:
            for geo, series in (result.get("hist") or {}).items():
                for f, pts in series.items():
                    if f in fields and pts:
                        h = hist.setdefault(f, {"level": level, "source": sid, "geo": {}})
                        h["geo"][geo] = pack_hist(pts, periods_seen)
        if level in context:
            cover = dict.fromkeys(fields, 0)
            for geo, row in data.items():
                vals = {f: _clean(row.get(f)) for f in fields}
                vals = {f: v for f, v in vals.items() if v is not None}
                for f in vals:
                    cover[f] += 1
                if vals:
                    context[level].setdefault(geo, {}).update(vals)
            owner.update(dict.fromkeys(fields, sid))
            rep.update(zips=0, coverage=cover, geo_coverage=True)
            continue
        if level == "zip":
            zipdata, stats = data, None
        else:
            try:
                if level == "tract" and str(src.get("tract_vintage") or "2020") == "2010":
                    data, rep["xwalk_2010"] = xwalk_get("tract10").to_zip(data, fields)
                key = "county_jobs" if level == "county" and src.get("group") == "commercial" else level
                zipdata, stats = xwalk_get(key).to_zip(data, fields, county_of if level == "county" else None)
            except (OSError, ValueError, ctx.SourceUnavailable) as exc:
                rep.update(status="unavailable", reason="the %s to ZIP crosswalk is unavailable (%s)"
                           % (level, ctx.short(exc, 120)))
                for f in fields:
                    store.meta.pop(f, None)
                continue
        owner.update(dict.fromkeys(fields, sid))
        for f, spec in fields.items() if level != "zip" else ():
            mode, agg = store.meta[f]["xwalk"], spec.get("agg", "none")
            if agg not in ("sum", "pop_weighted_mean", "pop_weighted_median") or (
                    level == "tract" and (agg != "sum" or mode == "sum")):
                continue
            vals = {}
            for geo, row in data.items():
                v = _clean(row.get(f))
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    vals[geo] = v
            if vals:
                store.areas[f] = {"level": level, "values": vals}
        cover, outside, zips, bad = dict.fromkeys(fields, 0), 0, 0, 0
        for z, row in zipdata.items():
            i = store.ix.get(z)
            if i is None:
                outside += 1
                continue
            got = False
            for f in fields:
                v = row.get(f)
                if v is None:
                    continue
                cv = _clean(v)
                if cv is None:
                    bad += 1
                    continue
                store.put(f, i, cv)
                cover[f] += 1
                got = True
            zips += got
        rep.update(zips=zips, coverage=cover, zips_outside=outside, xwalk=stats)
        if bad:
            rep.setdefault("problems", []).append("%d values were not finite numbers, text or flags" % bad)
        del data, zipdata, result
    return owner, context


def parse_args(argv):
    """--force, --only a,b, --skip a,b, --jobs N, --timeout S, --out DIR, plus positional words."""
    opts = {"force": "--force" in argv, "only": None, "skip": None, "jobs": 3, "timeout": DEFAULT_TIMEOUT,
            "out": None, "rest": []}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--only", "--skip", "--jobs", "--timeout", "--out"):
            if i + 1 >= len(argv):
                raise SystemExit("%s needs a value" % a)
            val = argv[i + 1]
            if a in ("--only", "--skip"):
                opts[a[2:]] = set(val.split(","))
            elif a == "--out":
                opts["out"] = os.path.abspath(os.path.expanduser(val))
            else:
                opts[a[2:]] = int(val)
            i += 2
            continue
        if not a.startswith("--"):
            opts["rest"].append(a)
        i += 1
    return opts


def main(argv):
    if argv and argv[0] == "--child":
        return child(argv[1], argv[2], argv[3] or None, argv[4] == "1")
    o = parse_args(argv)
    reports = run_all(o["rest"][0] if o["rest"] else SOURCES_DIR, force=o["force"], only=o["only"], skip=o["skip"],
                      jobs=o["jobs"], timeout=o["timeout"], log=lambda m: None)
    for rep, _ in reports:
        print(line(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
