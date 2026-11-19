#!/usr/bin/env python3
"""Python 3.9-compatible extract for the vendored production frontend archive.

The Mini suite runs system Python 3.9.6. extractall(filter='data') is 3.12+.
These cases exercise the helper on whatever interpreter is running, including
the forced manual path, and pin the fixture's loopback / quiet-log policy.
"""
import io
import os
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import production_frontend_fixture  # noqa: E402

ARCHIVE = Path(__file__).resolve().parent / "fixtures/production-frontend.tar.gz"
UI_TEST = Path(__file__).resolve().parents[1] / "OmarchyDeckUITests/ProductionFrontendUITests.swift"


def _gzip_tar(add):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as archive:
        add(archive)
    return buf.getvalue()


def _add_file(archive, name, data=b"ok"):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))


def _add_link(archive, name, target, kind):
    info = tarfile.TarInfo(name)
    info.type = kind
    info.linkname = target
    archive.addfile(info)


class FrontendArchiveTests(unittest.TestCase):
    def _extract(self, payload, dest, force_manual=False):
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            if force_manual:
                with mock.patch.object(
                    production_frontend_fixture, "extractall_accepts_filter", return_value=False
                ):
                    production_frontend_fixture.extract_frontend_archive(archive, dest)
            else:
                production_frontend_fixture.extract_frontend_archive(archive, dest)

    def _manual_must_reject(self, payload):
        dest = tempfile.mkdtemp(prefix="deck-archive-bad-")
        self.addCleanup(shutil.rmtree, dest, True)
        with self.assertRaises(ValueError):
            self._extract(payload, dest, force_manual=True)
        self.assertEqual(os.listdir(dest), [])

    def test_committed_archive_extracts_layout_without_links(self):
        dest = tempfile.mkdtemp(prefix="deck-archive-")
        self.addCleanup(shutil.rmtree, dest, True)
        with tarfile.open(ARCHIVE) as archive:
            production_frontend_fixture.extract_frontend_archive(archive, dest)
        root = Path(dest)
        self.assertTrue((root / "qa" / "mock-deck.mjs").is_file())
        self.assertTrue((root / "qa" / "fixtures.mjs").is_file())
        self.assertTrue((root / "static").is_dir())
        for dirpath, dirnames, filenames in os.walk(dest):
            for name in dirnames + filenames:
                self.assertFalse(Path(dirpath, name).is_symlink(), name)

    def test_manual_extract_of_committed_archive_matches_layout(self):
        dest = tempfile.mkdtemp(prefix="deck-archive-manual-")
        self.addCleanup(shutil.rmtree, dest, True)
        with tarfile.open(ARCHIVE) as archive:
            with mock.patch.object(
                production_frontend_fixture, "extractall_accepts_filter", return_value=False
            ):
                production_frontend_fixture.extract_frontend_archive(archive, dest)
        self.assertTrue((Path(dest) / "qa" / "mock-deck.mjs").is_file())

    def test_uses_data_filter_when_extractall_accepts_it(self):
        if not production_frontend_fixture.extractall_accepts_filter():
            return
        dest = tempfile.mkdtemp(prefix="deck-archive-filter-")
        self.addCleanup(shutil.rmtree, dest, True)
        seen = {}
        real = tarfile.TarFile.extractall

        def wrapped(self_archive, *args, **kwargs):
            seen["filter"] = kwargs.get("filter")
            return real(self_archive, *args, **kwargs)

        with mock.patch.object(tarfile.TarFile, "extractall", wrapped):
            with tarfile.open(ARCHIVE) as archive:
                production_frontend_fixture.extract_frontend_archive(archive, dest)
        self.assertEqual(seen.get("filter"), "data")

    def test_manual_extract_rejects_absolute_path(self):
        self._manual_must_reject(_gzip_tar(lambda tar: _add_file(tar, "/tmp/evil.txt")))

    def test_manual_extract_rejects_parent_path(self):
        self._manual_must_reject(_gzip_tar(lambda tar: _add_file(tar, "ok/../../escape.txt")))

    def test_manual_extract_rejects_symlink(self):
        self._manual_must_reject(
            _gzip_tar(lambda tar: _add_link(tar, "link", "/etc/passwd", tarfile.SYMTYPE))
        )

    def test_manual_extract_rejects_hard_link(self):
        self._manual_must_reject(
            _gzip_tar(lambda tar: _add_link(tar, "link", "target", tarfile.LNKTYPE))
        )

    def test_manual_extract_keeps_a_safe_file(self):
        dest = tempfile.mkdtemp(prefix="deck-archive-safe-")
        self.addCleanup(shutil.rmtree, dest, True)
        payload = _gzip_tar(lambda tar: _add_file(tar, "qa/hello.txt", b"hi"))
        self._extract(payload, dest, force_manual=True)
        self.assertEqual((Path(dest) / "qa" / "hello.txt").read_bytes(), b"hi")


class FixturePolicyTests(unittest.TestCase):
    def test_listeners_are_loopback_and_logging_is_off(self):
        source = Path(production_frontend_fixture.__file__).read_text()
        self.assertIn('ThreadingHTTPServer(("127.0.0.1"', source)
        self.assertIn('HTTPConnection("127.0.0.1"', source)
        self.assertNotIn("0.0.0.0", source)
        self.assertRegex(source, r"def log_message\(self, \*_+\):\n        pass")
        self.assertIn("def extract_frontend_archive(", source)
        self.assertNotIn('extractall(source, filter="data")', source)

    def test_stdlib_only(self):
        source = Path(production_frontend_fixture.__file__).read_text()
        for package in ("requests", "httpx", "urllib3", "pip"):
            self.assertNotIn("import %s" % package, source)
            self.assertNotIn("from %s" % package, source)

    def test_issue_22_ui_test_still_runs(self):
        text = UI_TEST.read_text()
        self.assertIn("func testCommittedFrontendFleetLifeReserveAndRotation", text)
        self.assertNotIn("XCTSkip", text)


class RegenerateTests(unittest.TestCase):
    """I5: the vendored frontend is rebuilt from a pixel-deck commit by script, not by hand."""

    def _git(self, repo, *args):
        import subprocess
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)

    def test_regenerate_archives_the_page_and_qa_backend_and_records_the_commit(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            repo, scripts = Path(tmp) / "pixel-deck", Path(tmp) / "scripts"
            (scripts / "fixtures").mkdir(parents=True)
            for name, text in {"static/index.html": "<p>deck</p>", "static/ops.js": "1", "qa/fixtures.mjs": "",
                               "qa/mock-deck.mjs": "", "qa/theme.css": "", "qa/other.mjs": "", "keys.json": "{}",
                               "rust/src/main.rs": ""}.items():
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
            self._git(repo, "add", "-A")
            self._git(repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "x")
            commit = production_frontend_fixture.regenerate(repo, "main", scripts)
            archive = scripts / "fixtures/production-frontend.tar.gz"
            with tarfile.open(archive) as packed:
                names = sorted(m.name for m in packed.getmembers() if m.isfile())
            self.assertEqual(names, ["qa/fixtures.mjs", "qa/mock-deck.mjs", "qa/theme.css",
                                     "static/index.html", "static/ops.js"], "keys.json and the rest stay out")
            self.assertEqual((scripts / "fixtures/production-frontend.source").read_text(), "pixel-deck %s\n" % commit)
            first = archive.read_bytes()
            production_frontend_fixture.regenerate(repo, "main", scripts)
            self.assertEqual(archive.read_bytes(), first, "The same commit must give the same bytes")

    def test_missing_required_source_does_not_replace_existing_fixture(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            repo, scripts = Path(tmp) / "pixel-deck", Path(tmp) / "scripts"
            (repo / "static").mkdir(parents=True)
            for name in ("qa/fixtures.mjs",):
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("")
            (repo / "static/index.html").write_text("<p>deck</p>")
            (scripts / "fixtures").mkdir(parents=True)
            archive = scripts / "fixtures/production-frontend.tar.gz"
            source = scripts / "fixtures/production-frontend.source"
            archive.write_bytes(b"previous archive")
            source.write_text("previous source\n")
            subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)
            self._git(repo, "add", "-A")
            self._git(repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "x")

            with self.assertRaisesRegex(RuntimeError, "has no qa/mock-deck.mjs"):
                production_frontend_fixture.regenerate(repo, "main", scripts)

            self.assertEqual(archive.read_bytes(), b"previous archive")
            self.assertEqual(source.read_text(), "previous source\n")

    def test_committed_archive_matches_its_recorded_source(self):
        source = ARCHIVE.parent / "production-frontend.source"
        self.assertTrue(source.exists(), "Regenerate the archive with production_frontend_fixture.py regenerate")
        self.assertRegex(source.read_text(), r"^pixel-deck [0-9a-f]{40}\n$")


if __name__ == "__main__":
    unittest.main()
