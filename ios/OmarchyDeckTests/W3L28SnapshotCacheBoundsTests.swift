#if canImport(UIKit)
import UIKit
#endif
import Foundation
import XCTest
@testable import OmarchyDeck

/// Cached launch pictures are bounded before they are decoded. Policy tests use synthetic bytes only.
final class W3L28SnapshotCacheBoundsTests: XCTestCase {
    private let origin = URL(string: "https://a.example.com/")!
    private let other = URL(string: "https://b.example.com/")!

    /// A JPEG with a start-of-frame header of the given size. COM filler pads the byte count.
    private func syntheticJPEG(width: Int, height: Int, paddingBytes: Int = 0) -> Data {
        var bytes: [UInt8] = [0xFF, 0xD8]
        bytes += [0xFF, 0xC0, 0x00, 0x11, 0x08,
                  UInt8(height >> 8), UInt8(height & 0xFF),
                  UInt8(width >> 8), UInt8(width & 0xFF), 0x03]
        bytes += [UInt8](repeating: 0x01, count: 9)
        var remaining = paddingBytes
        while remaining > 0 {
            let payload = min(remaining, 65_533)
            let length = payload + 2
            bytes += [0xFF, 0xFE, UInt8(length >> 8), UInt8(length & 0xFF)]
            bytes += [UInt8](repeating: 0x00, count: payload)
            remaining -= payload
        }
        bytes += [0xFF, 0xD9]
        return Data(bytes)
    }

    // MARK: Policy (Foundation only, runs on Linux)

    func testPortraitAndLandscapePicturesWithinLimitsAreAccepted() {
        let portrait = syntheticJPEG(width: 960, height: 2085)
        let landscape = syntheticJPEG(width: 2085, height: 960)
        XCTAssertTrue(W3SnapshotPolicy.isAcceptable(portrait))
        XCTAssertTrue(W3SnapshotPolicy.isAcceptable(landscape))
        XCTAssertEqual(W3SnapshotPolicy.dimensions(of: portrait), W3SnapshotPolicy.PictureSize(width: 960, height: 2085))
    }

    func testHugeDeclaredDimensionsAreRejectedBeforeDecoding() {
        // A few hundred bytes can declare a picture far larger than any capture.
        let bomb = syntheticJPEG(width: 20_000, height: 20_000)
        XCTAssertLessThan(bomb.count, 1_000)
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(bomb))
    }

    func testSideLimitIsEnforcedAtTheBoundary() {
        XCTAssertTrue(W3SnapshotPolicy.isAcceptable(syntheticJPEG(width: 1, height: W3SnapshotPolicy.maxSide)))
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(syntheticJPEG(width: 1, height: W3SnapshotPolicy.maxSide + 1)))
    }

    func testOversizedByteCountIsRejected() {
        let oversized = syntheticJPEG(width: 960, height: 2085, paddingBytes: W3SnapshotPolicy.maxByteCount)
        XCTAssertGreaterThan(oversized.count, W3SnapshotPolicy.maxByteCount)
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(oversized))
    }

    func testCorruptOrTruncatedBytesAreRejected() {
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(Data()))
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(Data("not a picture".utf8)))
        let valid = syntheticJPEG(width: 960, height: 2085)
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(Data(valid.dropLast(2))), "A missing end-of-image marker means truncated")
        XCTAssertNil(W3SnapshotPolicy.dimensions(of: Data([0xFF, 0xD8, 0xFF, 0xD9])), "No frame header means no size")
    }

    func testZeroSizedFrameIsRejected() {
        XCTAssertNil(W3SnapshotPolicy.dimensions(of: syntheticJPEG(width: 0, height: 100)))
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(syntheticJPEG(width: 0, height: 100)))
    }

#if canImport(UIKit)
    // MARK: Store (UIKit, Xcode only)

    private var directory: URL!

    override func setUp() {
        super.setUp()
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("W3L28-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    private func realJPEG(width: CGFloat, height: CGFloat) throws -> Data {
        let size = CGSize(width: width, height: height)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
        return try XCTUnwrap(image.jpegData(compressionQuality: 0.7))
    }

    func testValidPicturesInBothShapesLoad() throws {
        let store = DeckSnapshotStore(directory: directory)
        store.save(jpeg: try realJPEG(width: 96, height: 200), for: origin, shape: .portrait)
        store.save(jpeg: try realJPEG(width: 200, height: 96), for: origin, shape: .landscape)
        XCTAssertEqual(store.snapshots(for: origin).count, 2)
    }

    func testOversizedEntryYieldsNilAndKeepsOtherOriginsAndShapes() throws {
        let store = DeckSnapshotStore(directory: directory)
        store.save(jpeg: try realJPEG(width: 96, height: 200), for: origin, shape: .portrait)
        store.save(jpeg: try realJPEG(width: 96, height: 200), for: other, shape: .portrait)
        store.save(jpeg: try realJPEG(width: 200, height: 96), for: origin, shape: .landscape)
        // Written straight to disk, because save(jpeg:) refuses oversized data.
        let bad = store.url(for: origin, shape: .portrait)
        try syntheticJPEG(width: 960, height: 2085, paddingBytes: W3SnapshotPolicy.maxByteCount).write(to: bad)

        XCTAssertNil(store.image(for: origin, shape: .portrait))
        XCTAssertNotNil(store.image(for: other, shape: .portrait), "Another origin's picture is untouched")
        XCTAssertNotNil(store.image(for: origin, shape: .landscape), "The same origin's other shape is untouched")
        XCTAssertTrue(FileManager.default.fileExists(atPath: bad.path), "Only the bad read is refused; nothing is wiped")
    }

    func testCorruptEntryYieldsNil() throws {
        let store = DeckSnapshotStore(directory: directory)
        store.save(jpeg: try realJPEG(width: 200, height: 96), for: origin, shape: .landscape)
        try Data("garbage".utf8).write(to: store.url(for: origin, shape: .portrait))

        XCTAssertNil(store.image(for: origin, shape: .portrait))
        XCTAssertNotNil(store.image(for: origin, shape: .landscape))
    }

    func testSaveRefusesToWriteAnUnreadablePicture() {
        let store = DeckSnapshotStore(directory: directory)
        store.save(jpeg: syntheticJPEG(width: 960, height: 2085, paddingBytes: W3SnapshotPolicy.maxByteCount), for: origin, shape: .portrait)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.url(for: origin, shape: .portrait).path))
    }
#endif
}
