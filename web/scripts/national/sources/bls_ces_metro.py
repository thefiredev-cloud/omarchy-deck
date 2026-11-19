"""BLS monthly CES employment by metro, from SM flat files.

Jobs are persons, not thousands. Component groups require all members, and
annual changes compare the same component series and seasonal adjustment.
"""
import _bls_ces

SOURCE = {
    "id": "bls_ces_metro",
    "name": "BLS current employment statistics by metro",
    "publisher": "US Bureau of Labor Statistics",
    "homepage": "https://www.bls.gov/sae/",
    "level": "cbsa",
    "group": "commercial",
    "cadence": "monthly",
    "license": "Public domain (US government work)",
    "key_env": None,
    "fields": _bls_ces.fields("cesm_"),
}
MIN_AREAS = 350


def parse(paths):
    """Read local sm.series, sm.area and data file paths without networking."""
    return _bls_ces.parse(paths, "cbsa", "cesm_", MIN_AREAS)


def load(ctx):
    return _bls_ces.load(ctx, "cbsa", "cesm_", MIN_AREAS)
