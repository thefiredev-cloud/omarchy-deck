"""L3 2026-10-29: house keys contract (C4) and the helper's Hyprland discovery. No HA call, no process, no desktop."""
import importlib.util
import json
import os
from pathlib import Path
import re
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
KEYS = json.loads((ROOT / "keys.json").read_text())
HA_RS = (ROOT / "rust/src/ha.rs").read_text()
OTHER_TENANT = re.compile(r"morgan|quill|loto", re.I)
# The 26 keys that shipped before house keys. Their indexes are what `POST /api/key?v=` sends, so they never move.
OLD = [("launch", a) for a in ("terminal", "browser", "files", "hermes", "spotify", "obsidian", "apps", "spaces")] + [
    ("media-act", "prev"), ("media-act", "play-pause"), ("media-act", "next"), ("mute", "")] + [
    ("ws", str(i)) for i in range(1, 6)] + [("mvws", str(i)) for i in range(1, 6)] + [
    ("launch", "menu"), ("launch", "nightlight"), ("screenshot", ""), ("lock", "")]
RISKY = {"living_tv_power", "stop_all_watering", "rain_delay_2_days", "clear_rain_delay"}


def ha_scripts():
    """(id, vars, confirm) rows of ha.rs HA_SCRIPTS."""
    block = HA_RS.split("pub const HA_SCRIPTS", 1)[1].split("];", 1)[0]
    return [(m[0], m[1], m[2] == "true")
            for m in re.findall(r'\("([a-z0-9_]+)",\s*(?:r#)?"(.*?)"#?,\s*(true|false)\)', block)]


class HouseKeys(unittest.TestCase):
    def test_40_keys_in_nine_groups_and_the_old_26_keep_their_index(self):
        keys = KEYS["keys"]
        self.assertEqual(len(keys), 40)
        self.assertEqual([(k["action"], k.get("arg", "")) for k in keys[:26]], OLD)
        groups = [g["id"] for g in KEYS["groups"]]
        self.assertEqual(groups, ["apps", "media", "workspaces", "window", "system", "tv", "music", "sprinklers", "house"])
        for k in keys:
            self.assertIn(k["group"], groups, k)
            self.assertTrue(1 <= len(k["label"]) <= 14, k)
            self.assertTrue(1 <= len(k["icon"]) <= 6, k)

    def test_every_house_key_is_one_allowlisted_script_and_risky_ones_ask_twice(self):
        table = ha_scripts()
        self.assertEqual(len(table), 13)
        house = [k for k in KEYS["keys"] if k["action"] == "ha-script"]
        self.assertEqual(sorted(k["arg"] for k in house), sorted(t[0] for t in table))
        for k in house:
            self.assertEqual(bool(k.get("confirm")), k["arg"] in RISKY, k)
        self.assertEqual({t[0] for t in table if t[2]}, RISKY)
        media = [k for k in KEYS["keys"] if k["action"] == "ha-media"]
        self.assertEqual([(k["arg"], k["group"]) for k in media], [("play-pause", "music")])

    def test_allowlists_are_tanner_and_house_only(self):
        self.assertIsNone(OTHER_TENANT.search(json.dumps(KEYS)))
        sensors = re.findall(r'"([a-z_]+\.[a-z0-9_]+)"', HA_RS.split("pub const HA_SENSORS", 1)[1].split("];", 1)[0])
        self.assertEqual(len(sensors), 20)
        for e in sensors + [t[0] for t in ha_scripts()]:
            self.assertIsNone(OTHER_TENANT.search(e), e)
            self.assertFalse(e.startswith("device_tracker."), e)
            self.assertTrue(not e.startswith("person.") or e == "person.mesh", e)
        for sid, variables, _ in ha_scripts():
            self.assertNotIn(sid, ("water_zone", "tv_app_launch"))
            self.assertNotIn("pyleusa", variables, "the house speaker is off (D12)")
            if variables:
                self.assertEqual(json.loads(variables), {"target": "media_player.main_bedroom_2"})


class HelperDiscovery(unittest.TestCase):
    """helper.py picks the Hyprland instance the same way keybinds.rs BINDS_SCRIPT does."""

    def load(self, env_sig, dirs):
        """Import helper.py with `dirs` = {name: (mtime, live socket)} under /run/user/<uid>/hypr."""
        uid = os.getuid()
        base = f"/run/user/{uid}/hypr/"
        paths = {base + n + "/": v for n, v in dirs.items()}
        real_exists = os.path.exists

        def exists(p):
            p = str(p)
            if p.startswith(base) and p.endswith("/.socket.sock"):
                return paths.get(p[: -len(".socket.sock")], (0, False))[1]
            return real_exists(p)

        env = {k: v for k, v in os.environ.items() if k != "HYPRLAND_INSTANCE_SIGNATURE"}
        if env_sig:
            env["HYPRLAND_INSTANCE_SIGNATURE"] = env_sig
        spec = importlib.util.spec_from_file_location("deck_helper_discovery", ROOT / "helper.py")
        mod = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, env, clear=True), \
                patch("glob.glob", return_value=list(paths)), \
                patch("os.path.getmtime", side_effect=lambda p: paths[p][0]), \
                patch("os.path.exists", side_effect=exists):
            spec.loader.exec_module(mod)
            return os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")

    def test_newest_live_instance_wins_and_dead_ones_are_skipped(self):
        dirs = {"old_live": (100, True), "new_live": (200, True), "newest_dead": (300, False)}
        self.assertEqual(self.load(None, dirs), "new_live")
        self.assertEqual(self.load("old_live", dirs), "old_live")
        self.assertEqual(self.load("gone", dirs), "new_live")
        self.assertEqual(self.load("newest_dead", dirs), "new_live")

    def test_no_live_instance_sets_nothing(self):
        self.assertIsNone(self.load(None, {"dead": (1, False)}))


if __name__ == "__main__":
    unittest.main()
