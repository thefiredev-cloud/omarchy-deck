import Foundation

/// Size and shape limits for cached launch pictures. Reads only bytes, so the Linux harness can run it.
enum W3SnapshotPolicy {
    struct PictureSize: Equatable {
        let width: Int
        let height: Int
    }

    /// Largest cached picture read or written. Captures are a few hundred kilobytes.
    static let maxByteCount = 2 * 1024 * 1024
    /// Largest accepted side in pixels. A full-height portrait capture at 3x fits well inside it.
    static let maxSide = 4096
    /// Largest accepted pixel count, which keeps one decoded picture near 32 MB.
    static let maxPixels = 8 * 1024 * 1024

    /// JPEG qualities tried in order until one encode fits `maxByteCount` (I16 byte cap).
    static let jpegQualities: [Double] = [0.7, 0.55, 0.4, 0.25]

    /// The snapshot width in points for a view of this size. WebKit draws at the screen scale, so the picture is the
    /// view's full width in pixels (I16: a fixed 320 pt picture was a blur on an iPad). Shrinks only when the pixel
    /// width or the pixel count would pass the limits above. Always at least 1 point.
    static func captureWidthPoints(viewWidth: Double, viewHeight: Double, scale: Double) -> Double {
        guard viewWidth > 0, viewHeight > 0 else { return 1 }
        let pixelScale = max(scale, 1)
        var width = viewWidth
        width = min(width, Double(maxSide) / pixelScale)
        width = min(width, Double(maxSide) / pixelScale * viewWidth / viewHeight)
        let pixels = viewWidth * viewHeight * pixelScale * pixelScale
        if pixels > Double(maxPixels) {
            width = min(width, viewWidth * (Double(maxPixels) / pixels).squareRoot())
        }
        return max(1, width.rounded(.down))
    }

    /// True only for a complete JPEG within the byte limit and the pixel bounds.
    static func isAcceptable(_ data: Data) -> Bool {
        guard data.count <= maxByteCount,
              data.starts(with: [0xFF, 0xD8, 0xFF]),
              data.suffix(2).elementsEqual([0xFF, 0xD9]),
              let size = dimensions(of: data) else { return false }
        return size.width <= maxSide && size.height <= maxSide && size.width * size.height <= maxPixels
    }

    /// Reads the frame size from the first start-of-frame header without decoding pixels.
    /// Returns nil when the bytes are not a JPEG header or the frame has a zero side.
    static func dimensions(of data: Data) -> PictureSize? {
        // No copy: a validation runs on every accept check, and a full byte copy costs up to the byte limit.
        data.withUnsafeBytes { raw -> PictureSize? in
            let count = raw.count
            guard count >= 4, let bytes = raw.bindMemory(to: UInt8.self).baseAddress else { return nil }
            guard bytes[0] == 0xFF, bytes[1] == 0xD8 else { return nil }
            var index = 2
            while index + 1 < count {
                guard bytes[index] == 0xFF else { return nil }
                var markerIndex = index + 1
                var marker = bytes[markerIndex]
                while marker == 0xFF {  // fill bytes may precede a marker
                    markerIndex += 1
                    guard markerIndex < count else { return nil }
                    marker = bytes[markerIndex]
                }
                if marker == 0xD9 || marker == 0xDA { return nil }  // end of image or scan before any frame header
                if marker == 0x01 || (0xD0...0xD7).contains(marker) {  // standalone markers carry no length
                    index = markerIndex + 1
                    continue
                }
                guard markerIndex + 2 < count else { return nil }
                let length = Int(bytes[markerIndex + 1]) << 8 | Int(bytes[markerIndex + 2])
                let segmentEnd = markerIndex + 1 + length
                guard length >= 2, segmentEnd <= count else { return nil }
                if isStartOfFrame(marker) {
                    let payload = markerIndex + 3  // precision, height, width, component count
                    guard payload + 4 < segmentEnd else { return nil }
                    let height = Int(bytes[payload + 1]) << 8 | Int(bytes[payload + 2])
                    let width = Int(bytes[payload + 3]) << 8 | Int(bytes[payload + 4])
                    guard width > 0, height > 0 else { return nil }
                    return PictureSize(width: width, height: height)
                }
                index = segmentEnd
            }
            return nil
        }
    }

    private static func isStartOfFrame(_ marker: UInt8) -> Bool {
        // C4 (DHT), C8 (JPG) and CC (DAC) share the C0...CF range but are not frame headers.
        (0xC0...0xCF).contains(marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC
    }
}
