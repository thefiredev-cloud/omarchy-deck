#!/usr/bin/env python3
"""Behavior tests for scripts/ci/check_repo.py, the Linux repo gate.

Each test copies the tracked tree into a scratch git repo, breaks one rule there,
and checks that the gate exits 1 and names the file and the rule. The owner's
checkout is never edited. The gate needs PyYAML, so the tests skip without it.
"""
import importlib.util
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
GATE = Path("scripts", "ci", "check_repo.py")
HAS_YAML = importlib.util.find_spec("yaml") is not None
# Built at runtime so this file does not contain the strings the gate scans for.
PRIVATE_KEY_HEADER = "-----BEGIN " "PRIVATE KEY-----"
BANNED_WORDING = "Acme In" "c."
ENCRYPTION_FALSE = "        ITSAppUsesNonExemptEncryption: false\n        UILaunchScreen:\n"


def tracked_files():
    listing = subprocess.run(["git", "ls-files", "-z"], cwd=REPO_ROOT, capture_output=True, check=True).stdout
    return [rel for rel in listing.decode("utf-8").split("\0") if rel]


@unittest.skipUnless(HAS_YAML, "PyYAML is not installed; check_repo.py cannot run")
class CheckRepoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._scratch = tempfile.TemporaryDirectory()
        cls.base = Path(cls._scratch.name) / "base"
        for rel in tracked_files():
            source = REPO_ROOT / rel
            target = cls.base / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if os.path.islink(source):
                os.symlink(os.readlink(source), target)
            elif source.is_file():
                shutil.copy2(source, target)
        subprocess.run(["git", "init", "-q"], cwd=cls.base, check=True)
        subprocess.run(["git", "add", "-A"], cwd=cls.base, check=True)

    @classmethod
    def tearDownClass(cls):
        cls._scratch.cleanup()

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.tree = Path(scratch.name) / "tree"
        shutil.copytree(self.base, self.tree, symlinks=True)

    def gate(self):
        return subprocess.run(
            [sys.executable, str(self.tree / GATE)],
            cwd=self.tree,
            capture_output=True,
            encoding="utf-8",
            check=False,
        )

    def write(self, rel, text, *, track=True):
        path = self.tree / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        if track:
            subprocess.run(["git", "add", "-f", rel], cwd=self.tree, check=True)

    def append(self, rel, text):
        path = self.tree / rel
        path.write_text(path.read_text(encoding="utf-8") + text, encoding="utf-8")

    def replace_once(self, rel, old, new):
        path = self.tree / rel
        text = path.read_text(encoding="utf-8")
        self.assertEqual(text.count(old), 1, f"{rel} must contain {old!r} exactly once")
        path.write_text(text.replace(old, new), encoding="utf-8")

    def edit_plist(self, rel, change):
        path = self.tree / rel
        data = plistlib.loads(path.read_bytes())
        change(data)
        path.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML))

    def assert_rejected(self, result, message):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(message, result.stdout)

    def test_clean_copy_passes(self):
        result = self.gate()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"^ok: \d+ tracked files checked\n$")

    def test_tracked_private_key_header_is_rejected(self):
        self.write("docs/deploy-notes.md", f"key pasted here\n{PRIVATE_KEY_HEADER}\n")

        self.assert_rejected(self.gate(), "ERROR docs/deploy-notes.md: private key material")

    def test_tracked_key_file_by_suffix_is_rejected(self):
        self.write("secrets/deploy.p8", "not a real key\n")

        self.assert_rejected(self.gate(), "ERROR secrets/deploy.p8: key or secret file is tracked")

    def test_untracked_key_file_is_not_checked(self):
        self.write("secrets/local.p8", "not a real key\n", track=False)

        result = self.gate()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_banned_legal_entity_wording_is_rejected(self):
        self.write("docs/notes.md", f"Billed by {BANNED_WORDING}\n")

        self.assert_rejected(self.gate(), "ERROR docs/notes.md: banned legal-entity wording")

    def test_arbitrary_ats_loads_in_project_spec_are_rejected(self):
        self.replace_once(
            "project.yml",
            ENCRYPTION_FALSE,
            "        NSAppTransportSecurity:\n"
            "          NSAllowsArbitraryLoads: true\n" + ENCRYPTION_FALSE,
        )

        self.assert_rejected(self.gate(), "ERROR project.yml: no ATS exceptions are allowed")

    def test_export_encryption_declaration_must_stay_false(self):
        self.replace_once(
            "project.yml",
            ENCRYPTION_FALSE,
            ENCRYPTION_FALSE.replace("false", "true"),
        )

        self.assert_rejected(self.gate(), "ERROR project.yml: ITSAppUsesNonExemptEncryption must stay false")

    def test_ipad_orientation_dropped_from_generated_plist_is_rejected(self):
        self.edit_plist(
            "OmarchyDeck/Info.plist",
            lambda data: data["UISupportedInterfaceOrientations~ipad"].remove("UIInterfaceOrientationLandscapeLeft"),
        )

        self.assert_rejected(
            self.gate(),
            "ERROR OmarchyDeck/Info.plist: UISupportedInterfaceOrientations~ipad must list all four orientations",
        )

    def test_watch_copyright_drift_is_rejected(self):
        self.edit_plist(
            "OmarchyDeckWatch/Info.plist",
            lambda data: data.__setitem__("NSHumanReadableCopyright", "© 2025 thefiredev-cloud"),
        )

        self.assert_rejected(self.gate(), "ERROR OmarchyDeckWatch/Info.plist: NSHumanReadableCopyright must be exactly")

    def test_decks_control_without_hit_testing_is_rejected(self):
        self.replace_once(
            "OmarchyDeck/ContentView.swift",
            ".allowsHitTesting(chrome.isVisible)",
            ".allowsHitTesting(true)",
        )

        self.assert_rejected(
            self.gate(),
            "ERROR OmarchyDeck/ContentView.swift: the Decks control must be tappable whenever it is present",
        )

    def test_decks_glyph_faded_to_zero_is_rejected(self):
        self.replace_once(
            "OmarchyDeck/ContentView.swift",
            ".allowsHitTesting(chrome.isVisible)",
            ".allowsHitTesting(chrome.isVisible)\n            .opacity(visible ? 1 : 0)",
        )

        self.assert_rejected(
            self.gate(),
            "ERROR OmarchyDeck/ContentView.swift: the Decks glyph must never reach zero opacity",
        )

    def test_missing_reload_row_is_rejected(self):
        self.replace_once(
            "OmarchyDeck/ConnectionsView.swift",
            'accessibilityIdentifier("connection.reload")',
            'accessibilityIdentifier("connection.refresh")',
        )

        self.assert_rejected(
            self.gate(),
            "ERROR OmarchyDeck/ConnectionsView.swift: Decks must offer a visible Reload deck row",
        )

    def test_fixture_binding_all_interfaces_is_rejected(self):
        self.append("scripts/production_frontend_fixture.py", '\nBIND_ALL = "0.0.0.0"\n')

        self.assert_rejected(
            self.gate(),
            "ERROR scripts/production_frontend_fixture.py: must not bind 0.0.0.0",
        )

    def test_unparseable_plist_is_rejected(self):
        self.write("OmarchyDeckWatch/Broken.plist", "<plist>not closed")

        self.assert_rejected(self.gate(), "ERROR OmarchyDeckWatch/Broken.plist: not a valid plist")

    def test_unparseable_contents_json_is_rejected(self):
        self.write("OmarchyDeck/Assets.xcassets/Broken.colorset/Contents.json", "{")

        self.assert_rejected(
            self.gate(),
            "ERROR OmarchyDeck/Assets.xcassets/Broken.colorset/Contents.json: invalid JSON",
        )

    def test_required_reason_api_without_manifest_category_is_rejected(self):
        self.edit_plist(
            "OmarchyDeck/PrivacyInfo.xcprivacy",
            lambda data: data.__setitem__("NSPrivacyAccessedAPITypes", [
                entry for entry in data["NSPrivacyAccessedAPITypes"]
                if entry["NSPrivacyAccessedAPIType"] != "NSPrivacyAccessedAPICategorySystemBootTime"
            ]),
        )

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/HapticBridge.swift: calls 'systemUptime', so OmarchyDeck/PrivacyInfo.xcprivacy must declare "
            "NSPrivacyAccessedAPICategorySystemBootTime",
        )

    def test_new_required_reason_api_call_is_rejected_until_declared(self):
        self.write("OmarchyDeck/FreeSpace.swift", "import Foundation\nlet free = URLResourceKey.volumeAvailableCapacityKey\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/FreeSpace.swift: calls 'volumeAvailableCapacity', so OmarchyDeck/PrivacyInfo.xcprivacy must "
            "declare NSPrivacyAccessedAPICategoryDiskSpace",
        )

    def test_ns_style_file_timestamp_key_is_rejected_until_declared(self):
        self.edit_plist(
            "OmarchyDeck/PrivacyInfo.xcprivacy",
            lambda data: data.__setitem__("NSPrivacyAccessedAPITypes", [
                entry for entry in data["NSPrivacyAccessedAPITypes"]
                if entry["NSPrivacyAccessedAPIType"] != "NSPrivacyAccessedAPICategoryFileTimestamp"
            ]),
        )
        self.write("OmarchyDeck/Stamp.swift", "import Foundation\nlet key = NSURLCreationDateKey\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Stamp.swift: calls 'CreationDate', so OmarchyDeck/PrivacyInfo.xcprivacy must "
            "declare NSPrivacyAccessedAPICategoryFileTimestamp",
        )

    def test_manifest_reason_from_another_category_is_rejected(self):
        def swap(data):
            for entry in data["NSPrivacyAccessedAPITypes"]:
                if entry["NSPrivacyAccessedAPIType"] == "NSPrivacyAccessedAPICategoryUserDefaults":
                    entry["NSPrivacyAccessedAPITypeReasons"] = ["35F9.1"]

        self.edit_plist("OmarchyDeck/PrivacyInfo.xcprivacy", swap)

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/PrivacyInfo.xcprivacy: reason '35F9.1' is not an allowed code for "
            "NSPrivacyAccessedAPICategoryUserDefaults",
        )

    def test_manifest_unknown_category_is_rejected(self):
        self.edit_plist(
            "OmarchyDeckWatch/PrivacyInfo.xcprivacy",
            lambda data: data["NSPrivacyAccessedAPITypes"].append({
                "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryBatteryLevel",
                "NSPrivacyAccessedAPITypeReasons": ["CA92.1"],
            }),
        )

        self.assert_rejected(
            self.gate(),
            "OmarchyDeckWatch/PrivacyInfo.xcprivacy: unknown required-reason category "
            "'NSPrivacyAccessedAPICategoryBatteryLevel'",
        )

    def test_stat_call_is_a_file_timestamp_api(self):
        self.edit_plist(
            "OmarchyDeck/PrivacyInfo.xcprivacy",
            lambda data: data.__setitem__("NSPrivacyAccessedAPITypes", [
                entry for entry in data["NSPrivacyAccessedAPITypes"]
                if entry["NSPrivacyAccessedAPIType"] != "NSPrivacyAccessedAPICategoryFileTimestamp"
            ]),
        )
        self.write("OmarchyDeck/Stat.swift", "import Darwin\nvar info = stat()\nlet rc = lstat(path, &info)\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Stat.swift: calls 'stat(', so OmarchyDeck/PrivacyInfo.xcprivacy must "
            "declare NSPrivacyAccessedAPICategoryFileTimestamp",
        )

    def test_total_disk_size_is_a_disk_space_api(self):
        self.write("OmarchyDeck/Disk.swift", "import Foundation\nlet total = attributes[.systemSize]\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Disk.swift: calls 'systemSize', so OmarchyDeck/PrivacyInfo.xcprivacy must "
            "declare NSPrivacyAccessedAPICategoryDiskSpace",
        )

    def test_tracking_declaration_must_stay_false(self):
        self.edit_plist("OmarchyDeck/PrivacyInfo.xcprivacy", lambda data: data.__setitem__("NSPrivacyTracking", True))

        self.assert_rejected(self.gate(), "ERROR OmarchyDeck/PrivacyInfo.xcprivacy: NSPrivacyTracking must stay false")

    def test_empty_local_network_purpose_string_is_rejected(self):
        self.edit_plist("OmarchyDeck/Info.plist", lambda data: data.__setitem__("NSLocalNetworkUsageDescription", ""))

        self.assert_rejected(
            self.gate(),
            "ERROR OmarchyDeck/Info.plist: NSLocalNetworkUsageDescription must give a real purpose",
        )

    def test_xtool_plist_local_network_string_must_match_the_app(self):
        self.edit_plist("omarchy-xtool/Info.plist",
                        lambda data: data.__setitem__("NSLocalNetworkUsageDescription", "Talks to a host."))

        self.assert_rejected(
            self.gate(),
            "ERROR omarchy-xtool/Info.plist: NSLocalNetworkUsageDescription must match OmarchyDeck/Info.plist",
        )

    def test_manifest_dropped_from_app_resources_is_rejected(self):
        self.replace_once("project.yml", "      - path: OmarchyDeck/PrivacyInfo.xcprivacy\n        buildPhase: resources\n", "")

        self.assert_rejected(
            self.gate(),
            "ERROR project.yml: OmarchyDeck/PrivacyInfo.xcprivacy must be a resource of the OmarchyDeck target",
        )

    def test_watch_required_reason_api_without_watch_manifest_category_is_rejected(self):
        self.write("OmarchyDeckWatch/Prefs.swift", "import Foundation\nlet prefs = UserDefaults.standard\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeckWatch/Prefs.swift: calls 'UserDefaults', so OmarchyDeckWatch/PrivacyInfo.xcprivacy must "
            "declare NSPrivacyAccessedAPICategoryUserDefaults",
        )

    def test_watch_tracking_declaration_must_stay_false(self):
        self.edit_plist("OmarchyDeckWatch/PrivacyInfo.xcprivacy", lambda data: data.__setitem__("NSPrivacyTracking", True))

        self.assert_rejected(self.gate(), "ERROR OmarchyDeckWatch/PrivacyInfo.xcprivacy: NSPrivacyTracking must stay false")

    def test_watch_manifest_dropped_from_watch_resources_is_rejected(self):
        self.replace_once(
            "project.yml",
            "      - path: OmarchyDeckWatch/PrivacyInfo.xcprivacy\n        buildPhase: resources\n",
            "",
        )

        self.assert_rejected(
            self.gate(),
            "ERROR project.yml: OmarchyDeckWatch/PrivacyInfo.xcprivacy must be a resource of the OmarchyDeckWatch target",
        )

    def test_camera_api_without_purpose_string_is_rejected(self):
        self.write("OmarchyDeck/Scan.swift", "import AVFoundation\nlet camera = AVCaptureDevice.default(for: .video)\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Scan.swift: calls 'AVCaptureDevice', so OmarchyDeck/Info.plist must give a real "
            "NSCameraUsageDescription",
        )

    def test_camera_api_with_purpose_string_is_accepted(self):
        self.write("OmarchyDeck/Scan.swift", "import AVFoundation\nlet camera = AVCaptureDevice.default(for: .video)\n")
        self.edit_plist(
            "OmarchyDeck/Info.plist",
            lambda data: data.__setitem__("NSCameraUsageDescription", "Scan a deck QR code to connect to your server."),
        )

        result = self.gate()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_watch_location_api_needs_the_watch_plist_string(self):
        self.write("OmarchyDeckWatch/Where.swift", "import CoreLocation\nlet manager = CLLocationManager()\n")
        self.edit_plist(
            "OmarchyDeck/Info.plist",
            lambda data: data.__setitem__("NSLocationWhenInUseUsageDescription", "Shows surf spots near your location."),
        )

        self.assert_rejected(
            self.gate(),
            "OmarchyDeckWatch/Where.swift: calls 'CLLocationManager', so OmarchyDeckWatch/Info.plist must give a "
            "real NSLocationWhenInUseUsageDescription",
        )

    def test_speech_recognition_needs_its_own_purpose_string(self):
        self.write("OmarchyDeck/Dictate.swift", "import Speech\nlet recognizer = SFSpeechRecognizer()\n")
        self.edit_plist(
            "OmarchyDeck/Info.plist",
            lambda data: data.__setitem__("NSMicrophoneUsageDescription", "Dictate a deck address by voice."),
        )

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Dictate.swift: calls 'SFSpeechRecognizer', so OmarchyDeck/Info.plist must give a real "
            "NSSpeechRecognitionUsageDescription",
        )

    def test_photo_save_without_add_purpose_string_is_rejected(self):
        self.write("OmarchyDeck/Save.swift", "import UIKit\nfunc save(_ image: UIImage) { UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil) }\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Save.swift: calls 'UIImageWriteToSavedPhotosAlbum', so OmarchyDeck/Info.plist must give a "
            "real NSPhotoLibraryAddUsageDescription",
        )

    def test_health_store_needs_its_own_purpose_string(self):
        self.write("OmarchyDeck/Health.swift", "import HealthKit\nlet store = HKHealthStore()\n")

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Health.swift: calls 'HKHealthStore', so OmarchyDeck/Info.plist must give a real "
            "NSHealthShareUsageDescription",
        )

    def test_always_location_request_needs_always_purpose_string(self):
        self.write("OmarchyDeck/Roam.swift", "import CoreLocation\nlet manager = CLLocationManager()\nmanager.requestAlwaysAuthorization()\n")
        self.edit_plist(
            "OmarchyDeck/Info.plist",
            lambda data: data.__setitem__("NSLocationWhenInUseUsageDescription", "Shows surf spots near your location."),
        )

        self.assert_rejected(
            self.gate(),
            "OmarchyDeck/Roam.swift: calls 'requestAlwaysAuthorization', so OmarchyDeck/Info.plist must give a real "
            "NSLocationAlwaysAndWhenInUseUsageDescription",
        )


if __name__ == "__main__":
    unittest.main()
