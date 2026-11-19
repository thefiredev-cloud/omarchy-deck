"""Scores v2 (DataArch section 6, `metrics.json.scores` and `rental_grade`).

h_score (v2, name kept), retail_score, office_score, industrial_score and multifamily_score: inputs become percentile
ranks (mid-rank ties) within the score's universe, lower-is-better inputs invert, the score is the weighted mean of the
present inputs re-weighted over those present; a missing input is skipped, never zero. Confidence is input coverage
(Main 2026-11-14): coverage_conf(share of the score's input weight present) = (share - 0.5) / 0.5 clamped to 0..1, so
87.5% present reads high and 75% medium; the inputs' own freshness and grain stay in the metric parts.
c_score keeps the v1 formula and comes from the legacy builder unchanged.

Rental grade v2 keeps the v1 rules and field names (area_score, area_grade, area_conf, grade_parts, grade_flags) with
the v2 factors; area_conf = coverage_conf(coverage), the same rule.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, "legacy")):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import blend  # noqa: E402
import national_area as A  # noqa: E402

SCORES = {k: v for k, v in blend.SPEC["scores"].items() if k != "c_score"}
CONF_FIELD = {k: v.get("conf_field") for k, v in SCORES.items()}
GRADE = blend.SPEC["rental_grade"]
GRADE_METHOD = {"factors": [dict(f) for f in GRADE["factors"]], "grades": [list(g) for g in GRADE["grades"]],
                "min_pop": GRADE["min_pop"], "required": list(GRADE["required"]), "caps": [dict(c) for c in GRADE["caps"]],
                "min_coverage": GRADE["min_coverage"], "a_min_coverage": GRADE["a_min_coverage"],
                "low_conf_below": GRADE["low_conf_below"]}
GRADE_NOTE = ("Each factor scores 0 to 100 on a straight line between its zero and full values (clamped). Area score is "
              "the weighted mean of the factors present. Coverage is the share of total weight present; area_conf is "
              "(coverage - 0.5) / 0.5, clamped to 0 to 1. Grade A >= 70, B >= 55, C >= 40, else D; a "
              "gross yield under 5.5% holds the grade at C and under 4% at D. No grade below population 1,000, without "
              "a gross yield or under coverage 0.6; an A needs coverage 0.8.")


def universe_rule(text):
    """'ZIPs with population >= 1000' or 'ZIPs with biz_estabs >= 20 or lodes_jobs_total >= 200' -> [(field, min)]."""
    out = []
    for name, num in re.findall(r"([a-z_]+) >= (\d+)", text or ""):
        out.append(("pop" if name == "population" else name, float(num)))
    return out


def min_rule(text):
    """-> (min present weight, min inputs, any-of required keys)."""
    w = re.search(r"present weight >= ([\d.]+)", text or "")
    n = re.search(r"at least (\d+) inputs", text or "")
    req = re.search(r"and ([a-z_]+(?: or [a-z_]+)*) present", text or "")
    return (float(w.group(1)) if w else 0.0, int(n.group(1)) if n else 3,
            req.group(1).split(" or ") if req else [])


def coverage_conf(share):
    """Score confidence from the share of input weight present: (share - 0.5) / 0.5, clamped to 0..1."""
    if share is None:
        return None
    return round(max(0.0, min(1.0, (share - 0.5) / 0.5)), 2)


class Scorer:
    def __init__(self, blender):
        self.b = blender
        self.s = blender.s
        self._pct = {}

    def universe(self, sid):
        rule = universe_rule(SCORES[sid].get("universe"))
        return [i for i in range(self.s.n) if any((self.s.get(f, i) or 0) >= m for f, m in rule)]

    @staticmethod
    def keys(inp):
        """An input's field and its alternates (`or`), first present at a ZIP wins."""
        return [inp["key"]] + list(inp.get("or") or [])

    def _ranks(self, sid):
        """(universe, {input key: {i: percentile}}, {input key: {i: field used}}). An input with alternates ranks the
        first of its fields present at each ZIP (HVS metro rental vacancy, else ACS 1-year metro). A value a thin ZIP
        took from its county or metro (blend.area_fallback, meta `fallback`) is not the ZIP's own: it is skipped, so
        it neither scores that ZIP nor moves the other ZIPs' percentiles."""
        if sid not in self._pct:
            uni = self.universe(sid)
            ranks, used = {}, {}
            for inp in SCORES[sid]["inputs"]:
                keys = [k for k in self.keys(inp) if self.s.has(k)]
                fell = {k: (self.s.meta.get(k) or {}).get("fallback") or {} for k in keys}
                vals, src = [], {}
                for i in uni:
                    for k in keys:
                        v = self.s.get(k, i)
                        if isinstance(v, (int, float)) and not isinstance(v, bool) and i not in fell[k]:
                            vals.append((i, v))
                            src[i] = k
                            break
                p = blend.percentiles(vals) if vals else {}
                ranks[inp["key"]] = {i: (x if inp["direction"] == "higher" else 100 - x) for i, x in p.items()}
                used[inp["key"]] = src
            self._pct[sid] = (set(uni), ranks, used)
        return self._pct[sid]

    def total_weight(self, sid):
        """The score's input weight: every input, less `optional` inputs no field of which this build produced (new
        sources not landed yet), so their weight is spread over the rest instead of lowering every ZIP's coverage."""
        return sum(x["weight"] for x in SCORES[sid]["inputs"]
                   if not x.get("optional") or any(self.s.has(k) for k in self.keys(x)))

    def one(self, sid, i):
        """-> (score, conf, parts {field: percentile}) or (None, None, parts)."""
        uni, ranks, used = self._ranks(sid)
        parts = {}
        if i not in uni:
            return None, None, parts
        spec = SCORES[sid]
        total = self.total_weight(sid)
        wsum = acc = 0.0
        for inp in spec["inputs"]:
            p = ranks[inp["key"]].get(i)
            if p is None:
                continue
            parts[used[inp["key"]][i]] = round(p, 1)
            wsum += inp["weight"]
            acc += inp["weight"] * p
        min_w, min_n, need = min_rule(spec.get("min_inputs"))
        if not wsum or wsum / total < min_w or len(parts) < min_n or (need and not any(k in parts for k in need)):
            return None, None, parts
        return round(acc / wsum, 1), coverage_conf(wsum / total), parts

    def score_all(self):
        """Fill every v2 score and its conf column. Returns {score: {universe, scored}}."""
        out = {}
        for sid in SCORES:
            uni = self._ranks(sid)[0]
            n = 0
            for i in uni:
                v, c, _ = self.one(sid, i)
                if v is None:
                    continue
                self.s.put(sid, i, v)
                self.s.put(CONF_FIELD[sid], i, c)
                n += 1
            self.s.meta[sid] = {"source": "score", "level": "zip", "unit": "score", "agg": "pop_weighted_median"}
            self.s.meta[CONF_FIELD[sid]] = {"source": "score", "level": "zip", "unit": "ratio", "agg": "none"}
            out[sid] = {"universe": len(uni), "scored": n}
        return out

    # ---------------------------------------------------------------- rental grade v2
    def grade_one(self, i):
        """-> (area_score, area_grade, area_conf, grade_parts, grade_flags). A factor the validity table nulled carries
        its reason in grade_parts[key]["reason"] (the grade table says why the row is empty)."""
        rec = {f["key"]: self.s.get(f["key"], i) for f in GRADE_METHOD["factors"]}
        rec["pop"] = self.s.get("pop", i)
        for k in GRADE_METHOD["required"]:
            rec.setdefault(k, self.s.get(k, i))
        score, g, cover, parts, flags = A.grade_one(rec, GRADE_METHOD)
        for key, part in parts.items():
            why = self.b.nulled_at(key, i) if isinstance(part, dict) and part.get("value") is None else None
            if why:
                part["reason"] = why["reason"]
        return score, g, coverage_conf(cover), parts, flags

    def grade_all(self):
        counts = {"A": 0, "B": 0, "C": 0, "D": 0, "ungraded": 0}
        for i in range(self.s.n):
            score, g, conf, _, _ = self.grade_one(i)
            self.s.put("area_score", i, score)
            self.s.put("area_grade", i, g)
            self.s.put("area_conf", i, conf)
            counts[g or "ungraded"] += 1
        for f, unit in (("area_score", "score"), ("area_grade", "text"), ("area_conf", "ratio")):
            self.s.meta[f] = {"source": "score", "level": "zip", "unit": unit, "agg": "none"}
        return counts
