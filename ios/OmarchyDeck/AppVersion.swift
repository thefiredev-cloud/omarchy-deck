import Foundation

/// In-app and Info.plist copyright. Keep this exact; do not add a legal entity name.
enum AppCopyright {
    static let notice = "© 2026 thefiredev-cloud"
}

enum AppVersion {
    static var current: String {
        display(
            short: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown",
            build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"
        )
    }

    /// Short marketing version only, e.g. "1.1". Unknown when the bundle lacks it.
    static var marketingVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
    }

    /// Tests pass a dictionary. `current` is the Bundle.main default.
    static func display(from info: [String: Any]) -> String {
        display(
            short: info["CFBundleShortVersionString"] as? String ?? "Unknown",
            build: info["CFBundleVersion"] as? String ?? "Unknown"
        )
    }

    static func display(short: String, build: String) -> String {
        "Version \(short) (\(build))"
    }
}
