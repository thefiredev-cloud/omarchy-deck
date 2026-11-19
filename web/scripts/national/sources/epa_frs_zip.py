"""EPA Facility Registry Service: regulated facilities, brownfield sites and toxic release reporters per ZIP. Source tag: epa.
The national zip is 1.37 GB, but only NATIONAL_FACILITY_FILE.CSV is needed: its PGM_SYS_ACRNMS column lists every program a
facility is registered in (ACRES is the brownfields program, TRIS the Toxics Release Inventory). The plugin reads the zip's
central directory with a range request, downloads only that one member (about 350 MB) and inflates it as a stream."""
import csv
import io
import os
import re
import struct
import zlib

from ctx import SourceUnavailable

SOURCE = {
    "id": "epa_frs_zip",
    "name": "EPA Facility Registry Service, facilities and brownfields by ZIP",
    "publisher": "US Environmental Protection Agency",
    "homepage": "https://www.epa.gov/frs",
    "level": "zip",
    "native": "zip",
    "group": "risk",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": {
        "epa_facilities": {"label": "EPA-regulated facilities", "unit": "count", "agg": "sum"},
        "epa_brownfields": {"label": "Brownfield sites", "unit": "count", "agg": "sum", "metric": "commercial_risk",
                            "better": "lower"},
        "epa_tri_sites": {"label": "Toxic release reporting sites", "unit": "count", "agg": "sum", "better": "lower"},
    },
}
URL = "https://ordsext.epa.gov/FLA/www3/state_files/national_combined.zip"
MEMBER = "NATIONAL_FACILITY_FILE.CSV"
TAIL = 300000
_ACRES = re.compile(r"(?:^|,\s*)ACRES:")
_TRIS = re.compile(r"(?:^|,\s*)TRIS:")


class _Inflater(io.RawIOBase):
    """Raw deflate stream (a zip member's bytes) as a readable file."""

    def __init__(self, path):
        self.fh = open(path, "rb")
        self.dec = zlib.decompressobj(-15)
        self.buf = b""
        self.done = False

    def readable(self):
        return True

    def readinto(self, out):
        while not self.buf and not self.done:
            chunk = self.fh.read(1 << 20)
            if not chunk:
                self.buf, self.done = self.dec.flush(), True
            else:
                self.buf = self.dec.decompress(chunk)
        n = min(len(out), len(self.buf))
        out[:n] = self.buf[:n]
        self.buf = self.buf[n:]
        return n

    def close(self):
        self.fh.close()
        super().close()


def member_entry(tail, name=MEMBER):
    """The last bytes of a zip -> (local header offset, compressed size, uncompressed size) of member `name`.
    The central directory sits right before the end-of-directory record, so its position inside the tail is known."""
    i = tail.rfind(b"PK\x05\x06")
    if i < 0:
        raise SourceUnavailable("zip central directory not found")
    _, _, _, _, entries, size, offset, _ = struct.unpack("<IHHHHIIH", tail[i:i + 22])
    start = i - size
    if start < 0:
        raise SourceUnavailable("zip central directory is larger than the range read")
    directory, p = tail[start:start + size], 0
    while directory[p:p + 4] == b"PK\x01\x02":
        _, _, _, _, method, _, _, _, csize, usize, nlen, elen, clen, _, _, _, lho = struct.unpack("<IHHHHHHIIIHHHHHII", directory[p:p + 46])
        if directory[p + 46:p + 46 + nlen].decode("latin-1") == name:
            if method != 8:
                raise SourceUnavailable("zip member is not deflated")
            return lho, csize, usize
        p += 46 + nlen + elen + clen
    raise SourceUnavailable("%s is not in the zip" % name)


def parse(path):
    """Raw deflate member file (or a plain facility CSV) -> (data, rows, as_of)."""
    with open(path, "rb") as probe:
        plain = probe.read(1) == b'"'
    raw = open(path, "rb") if plain else _Inflater(path)
    data, rows, newest = {}, 0, ""
    with io.TextIOWrapper(io.BufferedReader(raw, 1 << 20), encoding="latin-1", newline="") as text:
        reader = csv.reader(text)
        head = next(reader, None)
        if not head or "POSTAL_CODE" not in head or "PGM_SYS_ACRNMS" not in head:
            raise SourceUnavailable("FRS facility file header changed")
        zi, pi = head.index("POSTAL_CODE"), head.index("PGM_SYS_ACRNMS")
        ui = head.index("UPDATE_DATE") if "UPDATE_DATE" in head else None
        for row in reader:
            rows += 1
            if len(row) <= max(zi, pi):
                continue
            z = _zip5(row[zi])
            if not z:
                continue
            rec = data.setdefault(z, {"epa_facilities": 0, "epa_brownfields": 0, "epa_tri_sites": 0})
            rec["epa_facilities"] += 1
            if _ACRES.search(row[pi]):
                rec["epa_brownfields"] += 1
            if _TRIS.search(row[pi]):
                rec["epa_tri_sites"] += 1
            if ui is not None and len(row) > ui and len(row[ui]) == 9:
                newest = max(newest, _sortable(row[ui]))
    if not data:
        raise SourceUnavailable("FRS facility file had no ZIPs")
    return data, rows, _iso(newest)


def _zip5(text):
    """5-digit ZIP from a facility ZIP field: 12345, 12345-6789 or 123456789. Anything else is a typo, not a ZIP."""
    match = re.fullmatch(r"(\d{5})(?:-?\d{4})?", (text or "").strip())
    return match.group(1) if match and match.group(1) >= "00501" else None


def _sortable(text):
    """'11-SEP-25' -> '20250911' (the FRS date style), or ''."""
    months = {m: i for i, m in enumerate(("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)}
    match = re.fullmatch(r"(\d\d)-([A-Z]{3})-(\d\d)", text.upper())
    if not match or match.group(2) not in months:
        return ""
    return "20%s%02d%s" % (match.group(3), months[match.group(2)], match.group(1))


def _iso(compact):
    return "%s-%s-%s" % (compact[:4], compact[4:6], compact[6:8]) if len(compact) == 8 else None


def load(ctx):
    tail_path, _ = ctx.fetch(URL, "frs_zip_tail.bin", timeout=120, headers={"Range": "bytes=-%d" % TAIL}, min_bytes=1000)
    with open(tail_path, "rb") as fh:
        tail = fh.read()
    lho, csize, _ = member_entry(tail)
    ctx.log("facility member: %.0f MB compressed" % (csize / 1e6))
    name = "frs_facility_%d_%d.deflate" % (lho, csize)
    # the local header is 30 bytes plus a name and extra field, read with the member in one request
    head_path, _ = ctx.fetch(URL, "frs_facility_head_%d.bin" % lho, timeout=120, headers={"Range": "bytes=%d-%d" % (lho, lho + 1023)},
                             min_bytes=30, min_age=10 ** 10)
    with open(head_path, "rb") as fh:
        head = fh.read(1024)
    nlen, elen = struct.unpack("<HH", head[26:30])
    start = lho + 30 + nlen + elen
    path, _ = ctx.fetch(URL, name, timeout=3000, headers={"Range": "bytes=%d-%d" % (start, start + csize - 1)},
                        min_bytes=1000, min_age=10 ** 10)
    if os.path.getsize(path) != csize:
        os.unlink(path)
        raise SourceUnavailable("facility member download is %d bytes, expected %d" % (os.path.getsize(path), csize))
    for old in os.listdir(ctx.cache_dir):  # a newer zip leaves the previous member behind
        if old.startswith("frs_facility_") and old.endswith(".deflate") and old != name:
            os.unlink(os.path.join(ctx.cache_dir, old))
    data, rows, as_of = parse(path)
    if len(data) < 25000 or rows < 2000000:
        raise SourceUnavailable("FRS facility file gave %d rows and %d ZIPs" % (rows, len(data)))
    return {"as_of": as_of or "unknown", "rows": rows, "data": data,
            "note": "Facilities registered with EPA programs; brownfields are the ACRES program, toxic release reporters the TRI program."}

