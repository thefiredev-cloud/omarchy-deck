"""Helper outcome contracts. No real process, audio, media, lock, or desktop access."""
import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

_PATH = Path(__file__).resolve().parent.parent / "helper.py"
_spec = importlib.util.spec_from_file_location("deck_helper_actions", _PATH)
helper = importlib.util.module_from_spec(_spec)
with patch.dict(os.environ), patch("glob.glob", return_value=[]):
    _spec.loader.exec_module(helper)

BUS = "org.mpris.MediaPlayer2.fixture"
LIST = (0, BUS + " 1 fixture")
PLAYING = (0, '{"data":"Playing"}')
PAUSED = (0, '{"data":"Paused"}')
METADATA = (0, '{"data":{"xesam:title":{"data":"Song"},"xesam:artist":{"data":["Artist"]}}}')


class HelperActions(unittest.TestCase):
    def setUp(self):
        self.run_patch = patch.object(helper, "run", side_effect=AssertionError("Unmocked command"))
        self.run = self.run_patch.start()
        self.addCleanup(self.run_patch.stop)
        self.popen_patch = patch.object(helper.subprocess, "Popen", side_effect=AssertionError("Unmocked process"))
        self.popen = self.popen_patch.start()
        self.addCleanup(self.popen_patch.stop)

    def assert_failure(self, result):
        self.assertIs(result["ok"], False)
        self.assertIsInstance(result["error"], str)
        self.assertLessEqual(len(result["error"]), 80)

    def test_commerce_launches_open_fixed_read_only_pages_and_say_when_a_machine_lacks_one(self):
        self.run.side_effect = lambda argv, *a, **k: (0, "ok")
        with patch.object(helper.shutil, "which", return_value="/usr/bin/omarchy-launch-webapp"):
            r = helper.commerce("amazon-orders")
        self.assertIs(r["ok"], True)
        lua = self.run.call_args[0][0][2]
        self.assertEqual(lua, 'hl.dispatch(hl.dsp.exec_cmd("omarchy-launch-webapp https://www.amazon.com/your-orders/orders"))')
        for url in helper.WEBAPP.values():
            self.assertRegex(url, r"^https://www\.(amazon|commerceink)\.com/[A-Za-z0-9/._-]*$")
        with patch.object(helper.shutil, "which", return_value=None):
            self.assert_failure(helper.commerce("amazon-returns"))
        with patch.object(helper, "DASHBOARD", "/nonexistent/webapp-open"):
            r = helper.commerce("commerce-ink-dashboard")
        self.assert_failure(r)
        self.assertIn("pc-desktop", r["error"])

    def test_media_actions_keep_success_shape_and_command_semantics(self):
        for action in ("play-pause", "next", "prev"):
            with self.subTest(action=action):
                self.run.reset_mock()
                self.run.side_effect = [LIST, PLAYING, (0, ""), METADATA, PAUSED]
                self.assertEqual(helper.media(action), {
                    "player": "fixture", "status": "Paused", "title": "Song", "artist": "Artist", "art": ""})

    def test_missing_player_remains_null_without_executing_action(self):
        self.run.side_effect = [(0, "")]
        self.assertEqual(helper.media("play-pause"), {"player": None, "status": "none"})
        self.assertEqual(self.run.call_count, 1)

    def test_failed_player_list_is_not_mistaken_for_no_player(self):
        self.run.side_effect = [(1, "fixture private diagnostic")]
        result = helper.media("play-pause")
        self.assert_failure(result)
        self.assertNotIn("fixture private diagnostic", result["error"])
        self.assertNotIn("player", result)

    def test_invalid_initial_playback_state_never_executes_action(self):
        for state in ((1, "failure"), (0, "not json"), (0, '{"data":null}'), (0, '{"data":"unknown"}')):
            with self.subTest(state=state):
                self.run.reset_mock()
                self.run.side_effect = [LIST, state]
                self.assert_failure(helper.media("play-pause"))
                self.assertEqual(self.run.call_count, 2)

    def test_all_media_command_failures_are_reported_without_readback(self):
        for action in ("play-pause", "next", "prev"):
            with self.subTest(action=action):
                self.run.reset_mock()
                self.run.side_effect = [LIST, PLAYING, (1, "fixture private diagnostic")]
                result = helper.media(action)
                self.assert_failure(result)
                self.assertNotIn("fixture private diagnostic", result["error"])
                self.assertEqual(self.run.call_count, 3)

    def test_applied_media_command_with_failed_metadata_has_unknown_state(self):
        for metadata in ((1, "failure"), (0, "not json"), (0, '{"data":null}'), (0, '{"data":[]}')):
            with self.subTest(metadata=metadata):
                self.run.side_effect = [LIST, PLAYING, (0, ""), metadata]
                result = helper.media("next")
                self.assertIs(result["ok"], True)
                self.assertEqual(result["player"], "fixture")
                self.assertIsNone(result["status"])
                self.assertIsNone(result["title"])
                self.assertNotIn("error", result)

    def test_applied_media_command_with_failed_playback_read_has_unknown_state(self):
        self.run.side_effect = [LIST, PLAYING, (0, ""), METADATA, (1, "failure")]
        result = helper.media("prev")
        self.assertIs(result["ok"], True)
        self.assertIsNone(result["status"])
        self.assertNotIn("error", result)

    def test_read_only_media_failure_is_not_an_accepted_action(self):
        self.run.side_effect = [LIST, PLAYING, (1, "failure")]
        self.assert_failure(helper.media())

    def test_mute_preserves_success_shape_in_both_directions(self):
        for output, muted in (("Volume: 0.42 [MUTED]", True), ("Volume: 0.42", False)):
            with self.subTest(muted=muted):
                self.run.side_effect = [(0, ""), (0, output)]
                self.assertEqual(helper.mute(), {"volume": 42, "muted": muted, "ok": True})

    def test_failed_mute_does_not_hide_failure_with_successful_readback(self):
        self.run.side_effect = [(1, "fixture private diagnostic")]
        result = helper.mute()
        self.assert_failure(result)
        self.assertNotIn("fixture private diagnostic", result["error"])
        self.assertEqual(self.run.call_count, 1)

    def test_applied_mute_with_failed_read_remains_success_with_unknown_state(self):
        for read in ((1, "failure"), (0, "invalid 42"), (0, "Volume: invalid")):
            with self.subTest(read=read):
                self.run.side_effect = [(0, ""), read]
                self.assertEqual(helper.mute(), {"volume": None, "muted": None, "ok": True})

    def test_failed_volume_read_does_not_invent_unmuted_state(self):
        for read in ((1, "Volume: 0.42"), (0, "invalid 42")):
            with self.subTest(read=read):
                self.run.side_effect = [read]
                result = helper.vol()
                self.assert_failure(result)
                self.assertIsNone(result["muted"])
                self.assertIsNone(result["volume"])

    def test_volume_set_reports_command_failure_and_unknown_state(self):
        self.run.side_effect = [(1, "fixture private diagnostic")]
        result = helper.vol_set(42)
        self.assert_failure(result)
        self.assertNotIn("fixture private diagnostic", result["error"])
        self.assertEqual(self.run.call_count, 1)

    def test_applied_volume_set_without_readback_remains_success_with_unknown_state(self):
        self.run.side_effect = [(0, ""), (1, "failure")]
        self.assertEqual(helper.vol_set(42), {"volume": None, "muted": None, "ok": True})

    def child(self, result=None, poll=None):
        child = Mock()
        if isinstance(result, Exception):
            child.wait.side_effect = result
        else:
            child.wait.return_value = result
        child.poll.return_value = poll
        self.popen.side_effect = None
        self.popen.return_value = child
        return child

    def test_lock_clean_exit_reports_started(self):
        self.child(result=0)
        self.assertEqual(helper.lock(), {"ok": True})

    def test_lock_surviving_startup_window_reports_started(self):
        child = self.child(result=subprocess.TimeoutExpired("fixture", 1.5), poll=None)
        self.assertEqual(helper.lock(), {"ok": True})
        child.kill.assert_not_called()
        child.terminate.assert_not_called()

    def test_lock_immediate_failure_and_signal_exit_are_failures(self):
        for code in (1, -15):
            with self.subTest(code=code):
                self.child(result=code)
                self.assert_failure(helper.lock())

    def test_lock_exit_race_after_wait_timeout_is_checked(self):
        for code, success in ((1, False), (0, True)):
            with self.subTest(code=code):
                self.child(result=subprocess.TimeoutExpired("fixture", 1.5), poll=code)
                result = helper.lock()
                self.assertIs(result["ok"], success)
                if not success:
                    self.assert_failure(result)

    def test_lock_spawn_failure_is_structured_without_os_diagnostics(self):
        self.popen.side_effect = FileNotFoundError("fixture private path")
        result = helper.lock()
        self.assert_failure(result)
        self.assertNotIn("fixture private path", result["error"])

    # ---- workspaces with their apps, and the Apps and Spaces keys (2026-10-07 feedback) ----
    CLIENTS = (
        '[{"class":"chromium","title":"private page title","mapped":true,"hidden":false,"workspace":{"id":1}},'
        '{"class":"com.mitchellh.ghostty","title":"secret","mapped":true,"hidden":false,"workspace":{"id":1}},'
        '{"class":"chromium","title":"again","mapped":true,"hidden":false,"workspace":{"id":1}},'
        '{"class":"org.mozilla.firefox","title":"x","mapped":true,"hidden":false,"workspace":{"id":1}},'
        '{"class":"spotify","title":"x","mapped":true,"hidden":false,"workspace":{"id":1}},'
        '{"class":"obsidian","title":"x","mapped":true,"hidden":false,"workspace":{"id":3}},'
        '{"class":"steam_app_1234","title":"x","mapped":true,"hidden":false,"workspace":{"id":6}},'
        '{"class":"ghost","title":"x","mapped":false,"hidden":false,"workspace":{"id":2}},'
        '{"class":"","title":"no class","mapped":true,"hidden":false,"workspace":{"id":2}}]')

    def test_app_names_are_short_plain_words_from_the_class_only(self):
        for cls, want in (("chromium", "Chromium"), ("org.mozilla.firefox", "Firefox"), ("com.mitchellh.ghostty", "Ghostty"),
                          ("steam_app_1234", "Game"), ("gamescope", "Game"), ("fleet-mirror", "Mirror"),
                          ("my_app-name", "My app name"), ("a" * 50, "A" * 1 + "a" * 19), ("", None), (None, None), ("!!!", None)):
            with self.subTest(cls=cls):
                self.assertEqual(helper.app_name(cls), want)

    def test_ws_list_groups_apps_by_workspace_and_never_carries_a_title(self):
        self.run.side_effect = [(0, "[]"), (0, self.CLIENTS), (0, '{"id":3}')]
        r = helper.ws_list()
        self.assertIs(r["ok"], True)
        self.assertEqual(r["active"], 3)
        self.assertEqual([w["id"] for w in r["ws"]], [1, 2, 3, 4, 5])
        one = r["ws"][0]
        self.assertEqual((one["n"], one["apps"], one["more"]), (5, ["Chromium", "Ghostty", "Firefox"], 1))
        self.assertEqual(r["ws"][1], {"id": 2, "n": 0, "apps": [], "more": 0})
        self.assertEqual(r["ws"][2]["apps"], ["Obsidian"])
        self.assertEqual(r["other"], {"n": 1, "apps": ["Game"], "more": 0})
        self.assertNotIn("title", repr(r))
        self.assertNotIn("private page title", repr(r))

    def test_ws_list_active_outside_the_five_is_none(self):
        self.run.side_effect = [(0, "[]"), (0, "[]"), (0, '{"id":6}')]
        self.assertIsNone(helper.ws_list()["active"])

    def test_ws_list_failures_are_structured_without_diagnostics(self):
        for seq in ([(1, "fixture private diagnostic"), (1, "x"), (1, "x")], [(0, "[]"), (0, "not json"), (0, "{}")],
                    [(0, "[]"), (0, '{"a":1}'), (0, '{"id":1}')], [(1, "[]"), (0, "[]"), (0, '{"id":1}')]):
            with self.subTest(seq=seq):
                self.run.side_effect = seq
                r = helper.ws_list()
                self.assert_failure(r)
                self.assertNotIn("fixture private diagnostic", r["error"])

    def test_apps_uses_the_app_grid_when_installed_else_the_stock_apps_menu(self):
        self.run.side_effect = [(0, "matthewjaybarr.app-grid\nother"), (0, "")]
        self.assertIs(helper.apps()["ok"], True)
        grid = self.run.call_args_list[1].args[0]
        self.assertIn("omarchy-shell shell toggle matthewjaybarr.app-grid '{}'", grid[-1])
        self.run.reset_mock()
        self.run.side_effect = [(0, "other"), (0, "")]
        helper.apps()
        self.assertIn("omarchy-menu toggle apps", self.run.call_args_list[1].args[0][-1])

    def test_spaces_opens_the_overview_or_says_it_is_missing(self):
        self.run.side_effect = [(0, "ecylmz.spaceview"), (0, "")]
        self.assertIs(helper.spaces()["ok"], True)
        self.assertIn("omarchy-shell shell toggle ecylmz.spaceview", self.run.call_args_list[1].args[0][-1])
        self.run.reset_mock()
        self.run.side_effect = [(0, "other")]
        r = helper.spaces()
        self.assert_failure(r)
        self.assertEqual(self.run.call_count, 1)


    def dispatch(self, *argv):
        import contextlib
        import io
        import json as _json
        buf = io.StringIO()
        with patch.object(helper.sys, "argv", ["helper.py", *argv]), contextlib.redirect_stdout(buf):
            with self.assertRaises(SystemExit):
                helper.main()
        return _json.loads(buf.getvalue().strip().splitlines()[-1])

    def test_command_line_reaches_ws_list_apps_and_spaces_and_nothing_else_new(self):
        self.run.side_effect = [(0, "[]"), (0, "[]"), (0, '{"id":1}')]
        r = self.dispatch("ws-list")
        self.assertIs(r["ok"], True)
        self.assertEqual(r["active"], 1)
        self.run.reset_mock(); self.run.side_effect = [(0, "matthewjaybarr.app-grid"), (0, "")]
        self.assertIs(self.dispatch("launch", "apps")["ok"], True)
        self.run.reset_mock(); self.run.side_effect = [(0, "ecylmz.spaceview"), (0, "")]
        self.assertIs(self.dispatch("launch", "spaces")["ok"], True)
        self.assertNotIn("apps", helper.LAUNCH)  # reached through its own function, never through the plain command table
        self.assertNotIn("spaces", helper.LAUNCH)
        self.run.reset_mock()
        self.assertEqual(self.dispatch("launch", "rm -rf")["error"], "bad command")
        self.assertEqual(self.run.call_count, 0)

if __name__ == "__main__":
    unittest.main()
