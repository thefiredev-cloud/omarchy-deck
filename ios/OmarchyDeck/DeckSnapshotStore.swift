import CryptoKit
import UIKit

/// The last picture of each deck, shown dimmed while the next launch loads so the app never opens on a spinner.
/// One file per origin and shape under Caches. The file name is a hash of the origin, so one deck's picture is
/// never found by another deck, and removing a deck (or signing out of it) deletes only its own pictures.
struct DeckSnapshotStore {
    enum Shape: String, CaseIterable {
        case portrait, landscape
    }

    /// A cached picture and when it was saved. The date is the file's modification date; nil when it cannot be read,
    /// in which case the loading screen shows the picture without an age rather than guess one.
    struct Snapshot {
        let image: UIImage
        let savedAt: Date?
    }

    let directory: URL

    init(directory: URL = DeckSnapshotStore.defaultDirectory) {
        self.directory = directory
    }

    static var defaultDirectory: URL {
        (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
            .appendingPathComponent("DeckSnapshots", isDirectory: true)
    }

    static func shape(of size: CGSize) -> Shape {
        size.width > size.height ? .landscape : .portrait
    }

    func url(for origin: URL, shape: Shape) -> URL {
        let digest = SHA256.hash(data: Data(origin.absoluteString.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("\(name)-\(shape.rawValue).jpg", isDirectory: false)
    }

    func image(for origin: URL, shape: Shape) -> UIImage? {
        let file = url(for: origin, shape: shape)
        // Check the size before reading, so an oversized entry costs no memory.
        guard let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize,
              size <= W3SnapshotPolicy.maxByteCount,
              let data = try? Data(contentsOf: file),
              W3SnapshotPolicy.isAcceptable(data) else { return nil }
        return UIImage(data: data)
    }

    func snapshot(for origin: URL, shape: Shape) -> Snapshot? {
        guard let image = image(for: origin, shape: shape) else { return nil }
        let saved = (try? url(for: origin, shape: shape).resourceValues(forKeys: [.contentModificationDateKey]))?
            .contentModificationDate
        return Snapshot(image: image, savedAt: saved)
    }

    func snapshots(for origin: URL) -> [Shape: Snapshot] {
        var found: [Shape: Snapshot] = [:]
        for shape in Shape.allCases {
            if let snapshot = snapshot(for: origin, shape: shape) { found[shape] = snapshot }
        }
        return found
    }

    /// The deck is private, so the picture is unreadable while the device is locked.
    func save(jpeg data: Data, for origin: URL, shape: Shape) {
        // Refuse what image(for:) would reject, so a stored picture is always readable.
        guard W3SnapshotPolicy.isAcceptable(data) else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: url(for: origin, shape: shape), options: [.atomic, .completeFileProtection])
        } catch {
            // A missing picture only costs the dimmed placeholder on the next launch.
        }
    }

    func remove(origin: URL) {
        for shape in Shape.allCases {
            try? FileManager.default.removeItem(at: url(for: origin, shape: shape))
        }
    }
}
