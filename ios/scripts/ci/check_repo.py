#!/usr/bin/env python3
"""Static repo checks for Omarchy Deck, run by CI on Linux (no Xcode needed).

- project.yml parses, targets the bundle id net.meshchat.deck and allows no arbitrary ATS loads
- the iPad build lists all four orientations, has a launch screen and does not require full screen (Split View),
  in both project.yml and the generated OmarchyDeck/Info.plist
- every .plist / .xcprivacy / asset-catalog Contents.json parses
- the iPhone app and the Watch app each ship a privacy manifest that declares every required-reason API their sources call
- no key material or secret files are tracked
"""
import json
import pathlib
import plistlib
import re
import subprocess
import sys

import yaml  # PyYAML ships on GitHub's ubuntu runners

ROOT = pathlib.Path(__file__).resolve().parents[2]
errors = []


def fail(msg):
    errors.append(msg)


tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
tracked = [p for p in tracked if p]

spec = yaml.safe_load((ROOT / "project.yml").read_text())
app = spec.get("targets", {}).get("OmarchyDeck", {})
if app.get("settings", {}).get("base", {}).get("PRODUCT_BUNDLE_IDENTIFIER") != "net.meshchat.deck":
    fail("project.yml: OmarchyDeck bundle id is not net.meshchat.deck")
info = app.get("info", {}).get("properties", {})
if "NSAppTransportSecurity" in info:
    fail("project.yml: no ATS exceptions are allowed (the deck is https only)")
if info.get("ITSAppUsesNonExemptEncryption") is not False:
    fail("project.yml: ITSAppUsesNonExemptEncryption must stay false")

IPAD_ORIENTATIONS = {
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationPortraitUpsideDown",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight",
}
launch_color = ROOT / "OmarchyDeck/Assets.xcassets/LaunchBackground.colorset/Contents.json"
# XcodeGen rewrites Info.plist from project.yml, so the two must agree or a regenerate silently changes the build.
for source, properties in [("project.yml", info),
                           ("OmarchyDeck/Info.plist", plistlib.loads((ROOT / "OmarchyDeck/Info.plist").read_bytes()))]:
    ipad = set(properties.get("UISupportedInterfaceOrientations~ipad") or [])
    if ipad != IPAD_ORIENTATIONS:
        fail(f"{source}: UISupportedInterfaceOrientations~ipad must list all four orientations, has {sorted(ipad)}")
    if properties.get("UIRequiresFullScreen"):
        fail(f"{source}: UIRequiresFullScreen turns off iPad Split View and Slide Over")
    launch = properties.get("UILaunchScreen")
    if not isinstance(launch, dict) and not properties.get("UILaunchStoryboardName"):
        fail(f"{source}: needs a UILaunchScreen dict or a UILaunchStoryboardName")
    elif isinstance(launch, dict) and launch.get("UIColorName") and not launch_color.is_file():
        fail(f"{source}: UILaunchScreen names a color with no {launch_color.relative_to(ROOT)}")

for rel in tracked:
    path = ROOT / rel
    if rel.endswith((".plist", ".xcprivacy")):
        try:
            plistlib.loads(path.read_bytes())
        except Exception as exc:  # noqa: BLE001 - report any parse failure
            fail(f"{rel}: not a valid plist ({exc})")
    elif rel.endswith("Contents.json"):
        try:
            json.loads(path.read_text())
        except ValueError as exc:
            fail(f"{rel}: invalid JSON ({exc})")
    if re.search(r"\.(p8|p12|pem|key|mobileprovision|keychain-db)$", rel) or rel.endswith(".env"):
        fail(f"{rel}: key or secret file is tracked")
    if path.suffix in {".swift", ".py", ".sh", ".md", ".yml", ".yaml", ".plist", ".json"} and path.is_file():
        text = path.read_text(errors="replace")
        if re.search(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", text):
            fail(f"{rel}: private key material")

COPYRIGHT = "© 2026 thefiredev-cloud"
# Split so this file does not contain the banned tokens as whole words.
BANNED_ENTITY = [
    re.compile("TheFire" r"Dev\s+LL" "C", re.I),
    re.compile(r"\bd" r"ba\b", re.I),
    re.compile(r"\bL\.L\." r"C\.?\b"),
    re.compile(r"\bInc" r"\."),
    re.compile(r"\bLtd" r"\."),
    re.compile(r"\bGmb" r"H\b"),
    re.compile(r"\bCorp" r"\."),
]
SCAN_SUFFIXES = {".swift", ".py", ".sh", ".md", ".yml", ".yaml", ".plist", ".json", ".txt", ".rb"}

for source, properties in [("project.yml", info),
                           ("OmarchyDeck/Info.plist", plistlib.loads((ROOT / "OmarchyDeck/Info.plist").read_bytes())),
                           ("OmarchyDeckWatch/Info.plist",
                            plistlib.loads((ROOT / "OmarchyDeckWatch/Info.plist").read_bytes()))]:
    if properties.get("NSHumanReadableCopyright") != COPYRIGHT:
        fail(f"{source}: NSHumanReadableCopyright must be exactly {COPYRIGHT!r}")

watch = spec.get("targets", {}).get("OmarchyDeckWatch", {})
watch_info = watch.get("info", {}).get("properties", {})
if watch_info.get("NSHumanReadableCopyright") != COPYRIGHT:
    fail("project.yml: OmarchyDeckWatch NSHumanReadableCopyright must be exactly "
         f"{COPYRIGHT!r}")

for rel in (
    "OmarchyDeck/ConnectionsView.swift",
    "OmarchyDeck/FirstRunView.swift",
    "OmarchyDeck/DemoConnectSheet.swift",
):
    text = (ROOT / rel).read_text()
    if "AppCopyright.notice" not in text or "deck.about.copyright" not in text:
        fail(f"{rel}: About must show AppCopyright.notice as deck.about.copyright")

content = (ROOT / "OmarchyDeck/ContentView.swift").read_text()
if ".allowsHitTesting(chrome.isVisible)" not in content:
    fail("OmarchyDeck/ContentView.swift: the Decks control must be tappable whenever it is present")
control_start = content.find("private struct DecksControl")
style_start = content.find("private struct DeckPressStyle")
if control_start < 0 or style_start < 0 or style_start <= control_start:
    fail("OmarchyDeck/ContentView.swift: DecksControl block is missing")
else:
    control = content[control_start:style_start]
    if ".animation(" in control:
        fail("OmarchyDeck/ContentView.swift: do not animate DecksControl hit testing")
    if ".opacity(chrome.isVisible" in control:
        fail("OmarchyDeck/ContentView.swift: fading the button itself keeps it non-hittable")
# Guideline 5.6: a Decks control that hides itself reads as a hidden feature.
if ".opacity(visible ? 1 : 0)" in content:
    fail("OmarchyDeck/ContentView.swift: the Decks glyph must never reach zero opacity")
if "dimmedOpacity: Double = 0.55" not in content:
    fail("OmarchyDeck/ContentView.swift: the idle state must dim the glyph, not hide it")
if ".allowsHitTesting(tokenFieldIsReachable)" not in content:
    fail("OmarchyDeck/ContentView.swift: token field must not stay tappable after the deck is showing")
if 'accessibilityIdentifier("connection.reload")' not in (ROOT / "OmarchyDeck/ConnectionsView.swift").read_text():
    fail("OmarchyDeck/ConnectionsView.swift: Decks must offer a visible Reload deck row")

fixture = (ROOT / "scripts/production_frontend_fixture.py").read_text()
if "def extract_frontend_archive(" not in fixture:
    fail("scripts/production_frontend_fixture.py: extract must work on Python 3.9+")
if 'extractall(source, filter="data")' in fixture:
    fail("scripts/production_frontend_fixture.py: call extract_frontend_archive, not extractall(filter=) directly")
if 'ThreadingHTTPServer(("127.0.0.1"' not in fixture:
    fail("scripts/production_frontend_fixture.py: TLS listener must bind 127.0.0.1 only")
if "0.0.0.0" in fixture:
    fail("scripts/production_frontend_fixture.py: must not bind 0.0.0.0")
frontend_ui = (ROOT / "OmarchyDeckUITests/ProductionFrontendUITests.swift").read_text()
if "func testCommittedFrontendFleetLifeReserveAndRotation" not in frontend_ui:
    fail("OmarchyDeckUITests/ProductionFrontendUITests.swift: #22 test is missing")
if "XCTSkip" in frontend_ui:
    fail("OmarchyDeckUITests/ProductionFrontendUITests.swift: #22 must run, not skip")

if COPYRIGHT not in (ROOT / "OmarchyDeck/AppVersion.swift").read_text():
    fail("OmarchyDeck/AppVersion.swift: AppCopyright.notice must be exactly "
         f"{COPYRIGHT!r}")

for rel in tracked:
    path = ROOT / rel
    if path.suffix not in SCAN_SUFFIXES or not path.is_file():
        continue
    text = path.read_text(errors="replace")
    for pattern in BANNED_ENTITY:
        if pattern.search(text):
            fail(f"{rel}: banned legal-entity wording {pattern.pattern!r}")

# App Review 5.1.1 and ITMS-91053: every required-reason API the shipped source calls needs its category and a
# reason in PrivacyInfo.xcprivacy, the manifest must reach the app bundle, and a Local Network prompt needs a purpose.
# Symbols are Apple's "Describing use of required reason API" lists. The *Date and *Capacity names also arrive as
# NSFile*/NSURL*Key constants with a capital first letter, so those two match without regard to case.
REQUIRED_REASON_APIS = {
    "NSPrivacyAccessedAPICategoryFileTimestamp": re.compile(
        r"(?i:modificationDate|creationDate)|attributesOfItem|getattrlist|\b[fl]?stat(?:at)?\(|\.st_[mac]time"),
    "NSPrivacyAccessedAPICategorySystemBootTime": re.compile(r"systemUptime|mach_absolute_time"),
    "NSPrivacyAccessedAPICategoryUserDefaults": re.compile(r"UserDefaults|@AppStorage"),
    "NSPrivacyAccessedAPICategoryDiskSpace": re.compile(
        r"(?i:volumeAvailableCapacity|volumeTotalCapacity|systemFreeSize|systemSize)|statfs|statvfs"),
    "NSPrivacyAccessedAPICategoryActiveKeyboards": re.compile(r"activeInputModes"),
}
# Reason codes Apple accepts per category ("Describing use of required reason API"). A code outside its category
# uploads fine but App Store Connect mails ITMS-91053 afterwards, so the gate rejects it before the build.
ALLOWED_REASONS = {
    "NSPrivacyAccessedAPICategoryFileTimestamp": {"DDA9.1", "C617.1", "3B52.1", "0A2A.1"},
    "NSPrivacyAccessedAPICategorySystemBootTime": {"35F9.1", "8FFB.1", "3D61.1"},
    "NSPrivacyAccessedAPICategoryUserDefaults": {"CA92.1", "1C8F.1", "C56D.1", "AC6B.1"},
    "NSPrivacyAccessedAPICategoryDiskSpace": {"E174.1", "85F4.1", "7D9E.1", "B728.1"},
    "NSPrivacyAccessedAPICategoryActiveKeyboards": {"3EC4.1", "54BD.1"},
}
watch = spec.get("targets", {}).get("OmarchyDeckWatch", {})
# Each bundle ships its own manifest and answers for the sources compiled into it; Shared/ is compiled into both.
BUNDLES = [
    ("OmarchyDeck/PrivacyInfo.xcprivacy", app, ("OmarchyDeck/", "Shared/"), "OmarchyDeck"),
    ("OmarchyDeckWatch/PrivacyInfo.xcprivacy", watch, ("OmarchyDeckWatch/", "Shared/"), "OmarchyDeckWatch"),
]
for manifest_rel, target, source_prefixes, target_name in BUNDLES:
    manifest = plistlib.loads((ROOT / manifest_rel).read_bytes())
    if manifest.get("NSPrivacyTracking") is not False:
        fail(f"{manifest_rel}: NSPrivacyTracking must stay false")
    if "NSPrivacyCollectedDataTypes" not in manifest:
        fail(f"{manifest_rel}: NSPrivacyCollectedDataTypes must be declared, even when empty")
    declared = {}
    for entry in manifest.get("NSPrivacyAccessedAPITypes", []):
        declared[entry.get("NSPrivacyAccessedAPIType")] = entry.get("NSPrivacyAccessedAPITypeReasons") or []
        category = entry.get("NSPrivacyAccessedAPIType")
        if category not in ALLOWED_REASONS:
            fail(f"{manifest_rel}: unknown required-reason category {category!r}")
        for reason in entry.get("NSPrivacyAccessedAPITypeReasons") or []:
            if reason not in ALLOWED_REASONS.get(category, set()):
                fail(f"{manifest_rel}: reason {reason!r} is not an allowed code for {category}")
    for rel in tracked:
        if not rel.endswith(".swift") or not rel.startswith(source_prefixes):
            continue
        code = "\n".join(line for line in (ROOT / rel).read_text(errors="replace").splitlines()
                         if not line.lstrip().startswith("//"))
        for category, pattern in REQUIRED_REASON_APIS.items():
            hit = pattern.search(code)
            if hit and not declared.get(category):
                fail(f"{rel}: calls {hit.group(0)!r}, so {manifest_rel} must declare {category} with a reason")
    if not any(isinstance(src, dict) and src.get("path") == manifest_rel and src.get("buildPhase") == "resources"
               for src in target.get("sources", [])):
        fail(f"project.yml: {manifest_rel} must be a resource of the {target_name} target")
for source, properties in [("project.yml", info),
                           ("OmarchyDeck/Info.plist", plistlib.loads((ROOT / "OmarchyDeck/Info.plist").read_bytes()))]:
    if len(str(properties.get("NSLocalNetworkUsageDescription") or "").strip()) < 20:
        fail(f"{source}: NSLocalNetworkUsageDescription must give a real purpose (the deck may sit on a private network)")

# The xtool sideload plist is a second Info.plist for the same app, so it must carry the same copyright and a purpose
# string that matches the real HTTPS-only behaviour (App Review 5.1.1; it once named a personal host and a tailnet).
xtool_plist = plistlib.loads((ROOT / "omarchy-xtool/Info.plist").read_bytes())
main_plist = plistlib.loads((ROOT / "OmarchyDeck/Info.plist").read_bytes())
if xtool_plist.get("NSHumanReadableCopyright") != COPYRIGHT:
    fail(f"omarchy-xtool/Info.plist: NSHumanReadableCopyright must be exactly {COPYRIGHT!r}")
if xtool_plist.get("NSLocalNetworkUsageDescription") != main_plist.get("NSLocalNetworkUsageDescription"):
    fail("omarchy-xtool/Info.plist: NSLocalNetworkUsageDescription must match OmarchyDeck/Info.plist")

# App Review 5.1.1: an API that opens a privacy prompt needs its NS*UsageDescription in the bundle that compiles
# the call, and the string must say why. The deck declares none of these today, so any new call fails until the
# purpose string and its Review Notes line are added. Web pages cannot raise capture prompts: DeckModel denies them.
PURPOSE_STRING_APIS = {
    "NSCameraUsageDescription": re.compile(r"\bAVCaptureDevice\b|\bAVCaptureSession\b|\bUIImagePickerController\b"),
    "NSMicrophoneUsageDescription": re.compile(r"\bAVAudioRecorder\b|\bAVAudioApplication\b|requestRecordPermission|\bSFSpeechRecognizer\b"),
    "NSLocationWhenInUseUsageDescription": re.compile(r"\bCLLocationManager\b"),
    "NSPhotoLibraryUsageDescription": re.compile(r"\bPHPhotoLibrary\b"),
    "NSContactsUsageDescription": re.compile(r"\bCNContactStore\b"),
    "NSFaceIDUsageDescription": re.compile(r"\bLAContext\b"),
    "NSCalendarsFullAccessUsageDescription": re.compile(r"\bEKEventStore\b"),
    "NSBluetoothAlwaysUsageDescription": re.compile(r"\bCBCentralManager\b|\bCBPeripheralManager\b"),
    "NSSpeechRecognitionUsageDescription": re.compile(r"\bSFSpeechRecognizer\b"),
    "NSPhotoLibraryAddUsageDescription": re.compile(
        r"UIImageWriteToSavedPhotosAlbum|\bPHAssetChangeRequest\b|\bPHAssetCreationRequest\b"),
    "NSUserTrackingUsageDescription": re.compile(r"\bATTrackingManager\b"),
    "NSMotionUsageDescription": re.compile(r"\bCMMotionActivityManager\b|\bCMPedometer\b"),
    "NSAppleMusicUsageDescription": re.compile(r"\bMPMediaLibrary\b"),
    "NFCReaderUsageDescription": re.compile(r"\bNFCNDEFReaderSession\b|\bNFCTagReaderSession\b"),
    "NSLocationAlwaysAndWhenInUseUsageDescription": re.compile(r"requestAlwaysAuthorization"),
    "NSHealthShareUsageDescription": re.compile(r"\bHKHealthStore\b"),
    "NSHealthUpdateUsageDescription": re.compile(r"\btoShare\s*:"),
    "NSHomeKitUsageDescription": re.compile(r"\bHMHomeManager\b"),
    "NSFocusStatusUsageDescription": re.compile(r"\bINFocusStatusCenter\b"),
}
PLIST_BY_BUNDLE = {"OmarchyDeck": "OmarchyDeck/Info.plist", "OmarchyDeckWatch": "OmarchyDeckWatch/Info.plist"}
for manifest_rel, target, source_prefixes, target_name in BUNDLES:
    bundle_plist = plistlib.loads((ROOT / PLIST_BY_BUNDLE[target_name]).read_bytes())
    for rel in tracked:
        if not rel.endswith(".swift") or not rel.startswith(source_prefixes):
            continue
        code = "\n".join(line for line in (ROOT / rel).read_text(errors="replace").splitlines()
                         if not line.lstrip().startswith("//"))
        for key, pattern in PURPOSE_STRING_APIS.items():
            hit = pattern.search(code)
            if hit and len(str(bundle_plist.get(key) or "").strip()) < 20:
                fail(f"{rel}: calls {hit.group(0)!r}, so {PLIST_BY_BUNDLE[target_name]} must give a real {key}")

# App Review 5.1.1: the Review Notes say Local Network is the only system prompt, so a deck page must not be able to
# raise WebKit's camera, microphone or motion prompts. DeckModel answers both with an explicit deny.
deck_model = (ROOT / "OmarchyDeck/DeckModel.swift").read_text()
for handler in ("requestMediaCapturePermissionFor", "requestDeviceOrientationAndMotionPermissionFor"):
    start = deck_model.find(handler)
    if start < 0 or ".deny" not in deck_model[start:start + 400] or ".grant" in deck_model[start:start + 400]:
        fail(f"OmarchyDeck/DeckModel.swift: {handler} must deny, never grant or prompt")

if errors:
    print("\n".join(f"ERROR {e}" for e in errors))
    sys.exit(1)
print(f"ok: {len(tracked)} tracked files checked")
