"""Shared stdlib xlsx reader (zipfile + ElementTree) for sources that publish a workbook. Not a source (SPEC rule 12)."""
import re
import xml.etree.ElementTree as ET
import zipfile

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def sheet_names(path):
    """Worksheet names in workbook order."""
    with zipfile.ZipFile(path) as zf:
        with zf.open("xl/workbook.xml") as fh:
            return [el.get("name") for _, el in ET.iterparse(fh) if el.tag == NS + "sheet"]


def read_xlsx_rows(path, sheet=1):
    """Yield each row of worksheet number `sheet` (1 based, workbook order) as a list of cell strings, None for blanks."""
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        strings = []
        if "xl/sharedStrings.xml" in names:
            with zf.open("xl/sharedStrings.xml") as fh:
                for _, el in ET.iterparse(fh):
                    if el.tag == NS + "si":
                        strings.append("".join(t.text or "" for t in el.iter(NS + "t")))
                        el.clear()
        sheets = sorted((n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
                        key=lambda n: int(re.search(r"(\d+)\.xml", n).group(1)))
        with zf.open(sheets[sheet - 1]) as fh:
            for _, el in ET.iterparse(fh):
                if el.tag != NS + "row":
                    continue
                cells = {}
                for c in el.findall(NS + "c"):
                    kind = c.get("t")
                    if kind == "inlineStr":
                        text = "".join(t.text or "" for t in c.iter(NS + "t"))
                        if text:
                            cells[_col(c.get("r"))] = text
                        continue
                    v = c.find(NS + "v")
                    if v is None or v.text is None:
                        continue
                    cells[_col(c.get("r"))] = strings[int(v.text)] if kind == "s" else v.text
                el.clear()
                yield [cells.get(i) for i in range(max(cells) + 1)] if cells else []
