import Foundation
import XCTest
@testable import OmarchyDeck

final class W3SnapshotPolicyTests: XCTestCase {
    private func segment(_ marker: UInt8, payload: [UInt8]) -> [UInt8] {
        let length = payload.count + 2
        return [0xFF, marker, UInt8(length >> 8), UInt8(length & 0xFF)] + payload
    }

    private func frame(_ marker: UInt8 = 0xC0, width: Int = 320, height: Int = 240) -> [UInt8] {
        segment(marker, payload: [
            8, UInt8(height >> 8), UInt8(height & 0xFF),
            UInt8(width >> 8), UInt8(width & 0xFF), 3,
            1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0
        ])
    }

    private func jpeg(_ segments: [UInt8]) -> Data {
        Data([0xFF, 0xD8] + segments + [0xFF, 0xD9])
    }

    func testMetadataPayloadCannotMasqueradeAsTheFrameSize() {
        let misleadingFrame = frame(width: 9000, height: 9000)
        let data = jpeg(segment(0xE1, payload: misleadingFrame) + frame())

        XCTAssertEqual(W3SnapshotPolicy.dimensions(of: data), .init(width: 320, height: 240))
        XCTAssertTrue(W3SnapshotPolicy.isAcceptable(data))
    }

    func testTableMarkersInTheFrameRangeAreSkipped() {
        for marker: UInt8 in [0xC4, 0xC8, 0xCC] {
            let data = jpeg(frame(marker, width: 9000, height: 9000) + frame())
            XCTAssertEqual(W3SnapshotPolicy.dimensions(of: data), .init(width: 320, height: 240), "marker \(marker)")
            XCTAssertTrue(W3SnapshotPolicy.isAcceptable(data), "marker \(marker)")
        }
    }

    func testAllSupportedFrameMarkersSupplyDimensions() {
        for marker: UInt8 in [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF] {
            let data = jpeg(frame(marker, width: 513, height: 257))
            XCTAssertEqual(W3SnapshotPolicy.dimensions(of: data), .init(width: 513, height: 257), "marker \(marker)")
        }
    }

    func testFillBytesAndStandaloneMarkersDoNotHideTheFrame() {
        let standalone: [UInt8] = [0x01] + Array(0xD0...0xD7)
        for marker in standalone {
            let data = jpeg([0xFF, 0xFF, marker, 0xFF] + frame())
            XCTAssertEqual(W3SnapshotPolicy.dimensions(of: data), .init(width: 320, height: 240), "marker \(marker)")
        }
    }

    func testScanOrEndBeforeAFrameCannotReadLaterBytesAsDimensions() {
        for marker: UInt8 in [0xDA, 0xD9] {
            let data = jpeg([0xFF, marker] + frame())
            XCTAssertNil(W3SnapshotPolicy.dimensions(of: data), "marker \(marker)")
            XCTAssertFalse(W3SnapshotPolicy.isAcceptable(data), "marker \(marker)")
        }
    }

    func testMalformedSegmentsAreRejectedWithoutReadingPastTheirBounds() {
        let malformed: [[UInt8]] = [
            [0xFF],                                  // Incomplete marker.
            [0xFF, 0xFF],                            // Fill bytes without a marker.
            [0xFF, 0xE1, 0x00],                      // Incomplete segment length.
            [0xFF, 0xE1, 0x00, 0x01],                // Length cannot include its own bytes.
            [0xFF, 0xE1, 0x00, 0x20, 0x00],          // Segment extends beyond the data.
            segment(0xC0, payload: [8, 0, 240, 1]),    // Frame omits the low width byte.
            [0x00] + frame()                          // Not a marker boundary.
        ]
        for bytes in malformed {
            let data = Data([0xFF, 0xD8] + bytes)
            XCTAssertNil(W3SnapshotPolicy.dimensions(of: data), "bytes \(bytes)")
            XCTAssertFalse(W3SnapshotPolicy.isAcceptable(data), "bytes \(bytes)")
        }
    }

    func testPixelBudgetRejectsWideAndTallPicturesWithIndividuallyAllowedSides() {
        for (width, height) in [(4096, 2048), (2048, 4096)] {
            XCTAssertTrue(W3SnapshotPolicy.isAcceptable(jpeg(frame(width: width, height: height))))
        }
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(jpeg(frame(width: 4096, height: 2049))))
        XCTAssertFalse(W3SnapshotPolicy.isAcceptable(jpeg(frame(width: 2049, height: 4096))))
    }

    /// I16: the launch picture is the view's full width at the screen scale, so an iPad's is not a stretched blur.
    func testCaptureUsesTheFullViewWidthWithinThePixelLimits() {
        // iPhone portrait at 3x and iPad Air landscape at 2x fit the limits unchanged.
        XCTAssertEqual(W3SnapshotPolicy.captureWidthPoints(viewWidth: 402, viewHeight: 874, scale: 3), 402)
        XCTAssertEqual(W3SnapshotPolicy.captureWidthPoints(viewWidth: 1180, viewHeight: 820, scale: 2), 1180)
        XCTAssertEqual(W3SnapshotPolicy.captureWidthPoints(viewWidth: 1376, viewHeight: 1032, scale: 2), 1376)
        // A 13-inch iPad Pro at 2x in portrait: 2064 x 2752 px is 5.7 M pixels, inside the 8 M budget.
        XCTAssertEqual(W3SnapshotPolicy.captureWidthPoints(viewWidth: 1032, viewHeight: 1376, scale: 2), 1032)
        // Larger views shrink until both sides and the pixel count fit, keeping the shape.
        for (width, height, scale) in [(2000.0, 3000.0, 3.0), (3000.0, 1000.0, 3.0), (1500.0, 1500.0, 3.0)] {
            let points = W3SnapshotPolicy.captureWidthPoints(viewWidth: width, viewHeight: height, scale: scale)
            let pixelWidth = points * scale
            let pixelHeight = points * height / width * scale
            XCTAssertLessThan(points, width)
            XCTAssertLessThanOrEqual(pixelWidth, Double(W3SnapshotPolicy.maxSide))
            XCTAssertLessThanOrEqual(pixelHeight, Double(W3SnapshotPolicy.maxSide) + scale)
            XCTAssertLessThanOrEqual(pixelWidth * pixelHeight, Double(W3SnapshotPolicy.maxPixels) * 1.01)
        }
        XCTAssertEqual(W3SnapshotPolicy.captureWidthPoints(viewWidth: 0, viewHeight: 800, scale: 3), 1)
    }

    /// The byte cap tries lower JPEG qualities in order, never a higher one after a lower one.
    func testJPEGQualitiesStepDown() {
        let qualities = W3SnapshotPolicy.jpegQualities
        XCTAssertEqual(qualities.first, 0.7)
        XCTAssertEqual(qualities, qualities.sorted(by: >))
        XCTAssertTrue(qualities.allSatisfy { $0 > 0 && $0 <= 1 })
    }
}
