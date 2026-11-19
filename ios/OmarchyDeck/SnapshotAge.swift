import Foundation

/// How old the cached picture of a deck is, in words. The loading screen shows the last saved picture of the deck,
/// never the deck as it is now, so it always says when that picture was taken. Foundation only, so the Linux
/// harness checks it.
enum SnapshotAge {
    /// The chip on the picture: `Picture from 2 h ago`.
    static func label(savedAt: Date, now: Date) -> String {
        "Picture from \(short(savedAt: savedAt, now: now))"
    }

    /// What VoiceOver says for the same picture. No abbreviations: `h` read aloud is a letter.
    static func spoken(savedAt: Date, now: Date) -> String {
        "Last saved picture, from \(long(savedAt: savedAt, now: now)), not live"
    }

    /// Whole minutes since the save. A picture dated in the future (the clock moved back) counts as just taken.
    private static func minutes(savedAt: Date, now: Date) -> Int {
        let seconds = now.timeIntervalSince(savedAt)
        guard seconds.isFinite, seconds > 0 else { return 0 }
        let minutes = seconds / 60
        // Corrupt or extreme file dates can exceed Int's range; keep the later day rounding safe too.
        guard minutes < Double(Int.max / 2) else { return Int.max / 2 }
        return Int(minutes)
    }

    private static func short(savedAt: Date, now: Date) -> String {
        let m = minutes(savedAt: savedAt, now: now)
        switch m {
        case ..<1: return "just now"
        case ..<60: return "\(m) min ago"
        case ..<(24 * 60): return "\(m / 60) h ago"
        default:
            let d = days(m)
            return "\(d) \(d == 1 ? "day" : "days") ago"
        }
    }

    private static func long(savedAt: Date, now: Date) -> String {
        let m = minutes(savedAt: savedAt, now: now)
        switch m {
        case ..<1: return "just now"
        case ..<60: return m == 1 ? "1 minute ago" : "\(m) minutes ago"
        case ..<(24 * 60):
            let h = m / 60
            return h == 1 ? "1 hour ago" : "\(h) hours ago"
        default:
            let d = days(m)
            return d == 1 ? "1 day ago" : "\(d) days ago"
        }
    }

    /// Whole days, rounded to the nearest: a picture 46 hours old is closer to 2 days than to "yesterday".
    private static func days(_ minutes: Int) -> Int {
        max((minutes + 12 * 60) / (24 * 60), 1)
    }
}
