import datetime
import importlib.util
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIXTURE = os.path.join(HERE, "fixtures", "hypr_binds.sample.json")

spec = importlib.util.spec_from_file_location("keys_from_hypr", os.path.join(ROOT, "scripts", "keys_from_hypr.py"))
kfh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kfh)

NOW = datetime.datetime(2026, 10, 21, 12, 0, 0, tzinfo=datetime.timezone.utc)


def bind(modmask=0, key="A", description="x", **kw):
    b = {"locked": False, "mouse": False, "release": False, "submap": "", "modmask": modmask, "key": key,
         "keycode": 0, "catch_all": False, "description": description, "dispatcher": "__lua", "arg": "1"}
    b.update(kw)
    return b


def load_fixture():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def find(doc, label, combo=None):
    hits = [k for p in doc["pages"] for k in p["keys"] if k["label"] == label and (combo is None or k["combo"] == combo)]
    assert len(hits) == 1, (label, combo, hits)
    return hits[0]


def page_of(doc, label, combo=None):
    k = find(doc, label, combo)
    return next(p["id"] for p in doc["pages"] if k in p["keys"])


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.binds = load_fixture()
        self.doc = kfh.build(self.binds, "fixture", NOW)

    def test_every_bind_placed_once(self):
        idx = [k["index"] for p in self.doc["pages"] for k in p["keys"]]
        self.assertEqual(sorted(idx), list(range(len(self.binds))))
        self.assertEqual(self.doc["total_binds"], len(self.binds))
        self.assertEqual(sum(p["count"] for p in self.doc["pages"]), len(self.binds))

    def test_page_order_and_names(self):
        self.assertEqual([p["id"] for p in self.doc["pages"]],
                         ["workspaces", "windows", "apps", "media", "screenshots", "dictation", "other"])

    def test_grouping(self):
        expect = {
            "Switch to workspace 1": "workspaces",
            "Move window to workspace 1": "workspaces",
            "Toggle scratchpad": "workspaces",
            "Close window": "windows",
            "Expand window left": "windows",
            "Switch to group window 3": "windows",
            "Terminal": "apps",
            "Spotify": "apps",
            "Calendar": "apps",
            "Volume up": "media",
            "Next track": "media",
            "Switch audio output": "media",
            "Screenshot": "screenshots",
            "Color picker": "screenshots",
            "Fullscreen screenshot and paste": "screenshots",
            "Make webcam overlay smaller": "screenshots",
            "Toggle dictation": "dictation",
            "VoxType engine picker": "dictation",
            "Omarchy menu": "other",
            "Bar panel 4": "other",
            "Middle click: paste clipboard": "other",
            "Toggle touchpad": "other",
        }
        for label, page in expect.items():
            with self.subTest(label=label):
                hits = [k for p in self.doc["pages"] if p["id"] == page for k in p["keys"] if k["label"] == label]
                self.assertTrue(hits, "%s not on page %s" % (label, page))

    def test_plain_combos(self):
        self.assertEqual(find(self.doc, "Close window")["combo"], "Super + W")
        self.assertEqual(find(self.doc, "Terminal")["combo"], "Super + Enter")
        self.assertEqual(find(self.doc, "Screenshot")["combo"], "Print Screen")
        self.assertEqual(find(self.doc, "Volume up")["combo"], "Volume up key")
        self.assertEqual(find(self.doc, "Focus on left window")["combo"], "Super + Left arrow")
        self.assertEqual(find(self.doc, "Scroll active workspace forward")["combo"], "Super + Scroll down")
        self.assertEqual(find(self.doc, "Move window")["combo"], "Super + Left mouse button")

    def test_keycode_binds_recovered(self):
        cases = {
            ("Switch to workspace 1", "Super + 1"): True,
            ("Move window to workspace 1", "Super + Shift + 1"): True,
            ("Switch to workspace 10", "Super + 0"): True,
            ("Switch to group window 3", "Super + Alt + 3"): True,
            ("Expand window left", "Super + -"): True,
            ("Shrink window left", "Super + ="): True,
            ("Expand window down a lot", "Super + Ctrl + Shift + ="): True,
            ("Make webcam overlay smaller", "Super + Alt + ["): True,
            ("Make webcam overlay larger", "Super + Alt + ]"): True,
            ("Bar panel 4", "Super + Ctrl + 4"): True,
        }
        for (label, combo), _ in cases.items():
            with self.subTest(label=label):
                k = find(self.doc, label, combo)
                self.assertTrue(k["key_known"])
                self.assertTrue(k["key_inferred"])

    def test_copilot_key_menu_is_recovered(self):
        k = find(self.doc, "Omarchy menu", "Super + Shift + F23 (Copilot key)")
        self.assertTrue(k["key_known"])
        self.assertTrue(k["key_inferred"])

    def test_lid_switches_get_plain_labels(self):
        for label, combo in (("Closed: Lid Switch", "Lid closes"), ("Opened: Lid Switch", "Lid opens")):
            k = find(self.doc, label)
            self.assertEqual(k["locked"], True)
            self.assertEqual(k["combo"], combo)
            self.assertIn("not a key", k["note"])

    def test_fixture_has_no_unresolved_binds(self):
        self.assertEqual(self.doc["unresolved_count"], 0)
        self.assertEqual(self.doc["unresolved"], [])

    def test_json_roundtrip_and_stamp(self):
        again = json.loads(json.dumps(self.doc))
        self.assertEqual(again, self.doc)
        self.assertEqual(self.doc["generated_at"], "2026-10-21T12:00:00Z")
        self.assertEqual(self.doc["source"], "fixture")


class UnitTests(unittest.TestCase):
    def test_mod_words(self):
        self.assertEqual(kfh.mod_words(64 | 4 | 8 | 1), ["Super", "Ctrl", "Alt", "Shift"])
        self.assertEqual(kfh.mod_words(0), [])

    def test_duplicate_combos_both_kept(self):
        binds = [bind(8, "TAB", "Fathom: dive one window deeper"), bind(8, "TAB", "Fathom: dive one window deeper")]
        doc = kfh.build(binds, "t", NOW)
        self.assertEqual(sum(p["count"] for p in doc["pages"]), 2)
        self.assertEqual([k["index"] for k in doc["pages"][1]["keys"]], [0, 1])

    def test_submap_carried(self):
        doc = kfh.build([bind(0, "ESCAPE", "Fathom: rise one window", submap="fathom")], "t", NOW)
        self.assertEqual(doc["pages"][1]["keys"][0]["submap"], "fathom")

    def test_unnamed_unknown_bind_lands_on_other(self):
        doc = kfh.build([bind(0, "F11", "")], "t", NOW)
        self.assertEqual(doc["pages"][-1]["keys"][0]["label"], "F11")
        self.assertEqual(doc["pages"][-1]["id"], "other")

    def test_dictation_beats_media_and_apps(self):
        doc = kfh.build([bind(64, "H", "Voxtype Dictation Toggle"), bind(64, "M", "VoxType meeting controls")], "t", NOW)
        self.assertEqual(doc["pages"][5]["count"], 2)

    def test_empty_list(self):
        doc = kfh.build([], "t", NOW)
        self.assertEqual(doc["total_binds"], 0)
        self.assertTrue(all(p["count"] == 0 for p in doc["pages"]))

    def test_unknown_key_is_not_invented(self):
        # same description as the Copilot bind, other modifiers: no source says which key, so none is guessed
        doc = kfh.build([bind(64, "", "Omarchy menu"), bind(64, "", "Something by keycode")], "t", NOW)
        self.assertEqual(doc["unresolved_count"], 2)
        self.assertEqual([u["combo"] for u in doc["unresolved"]], ["Super + (key not reported)"] * 2)
        k = doc["pages"][-1]["keys"][0]
        self.assertFalse(k["key_known"])
        self.assertEqual(k["key"], "")
        self.assertIn("keycode", k["note"])


class CliTests(unittest.TestCase):
    def test_writes_valid_json_from_file(self):
        with tempfile.TemporaryDirectory() as td:
            out = os.path.join(td, "keys.generated.json")
            self.assertEqual(kfh.main([FIXTURE, "-o", out]), 0)
            with open(out, encoding="utf-8") as f:
                doc = json.load(f)
            self.assertEqual(doc["total_binds"], len(load_fixture()))
            self.assertFalse(os.path.exists(out + ".tmp"))

    def test_refuses_to_overwrite_keys_json(self):
        with self.assertRaises(SystemExit) as cm:
            kfh.write_json_atomic(kfh.PROTECTED, {})
        self.assertIn("keys.json", str(cm.exception))

    def test_rejects_non_list(self):
        with tempfile.TemporaryDirectory() as td:
            bad = os.path.join(td, "bad.json")
            with open(bad, "w") as f:
                f.write("{}")
            with self.assertRaises(SystemExit):
                kfh.main([bad, "-o", os.path.join(td, "o.json")])


if __name__ == "__main__":
    unittest.main()
