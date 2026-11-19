"""Shared helper for the HUD workbook sources (fair market rents, income limits, picture of subsidized households).
Not a source: the runner skips files starting with _."""
import zipfile

import _xlsx
from ctx import SourceUnavailable


def rows(path, sheet=1):
    """Rows of one worksheet as lists of strings ('' for blanks). A file that is not a workbook (an HTML error page)
    raises SourceUnavailable."""
    try:
        for row in _xlsx.read_xlsx_rows(path, sheet):
            yield [c or "" for c in row]
    except zipfile.BadZipFile:
        raise SourceUnavailable("the download is not an Excel workbook")
