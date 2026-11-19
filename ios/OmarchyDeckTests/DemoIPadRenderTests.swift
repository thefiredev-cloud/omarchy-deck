import SwiftUI
import UIKit
import XCTest
@testable import OmarchyDeck

/// Renders the sample deck at full-screen iPad size (13 inch, portrait and landscape) and keeps each page as an
/// attachment, so spacing and the sidebar header can be reviewed without an iPad simulator.
/// Set SNAPSHOT_DIR to also write the PNGs to a folder.
final class DemoIPadRenderTests: XCTestCase {
    private static let portrait = CGSize(width: 1032, height: 1376)
    private static let landscape = CGSize(width: 1376, height: 1032)

    @MainActor
    private func render<V: View>(_ view: V, size: CGSize, name: String) throws {
        let host = UIHostingController(rootView: view)
        host.traitOverrides.horizontalSizeClass = .regular
        host.traitOverrides.verticalSizeClass = .regular
        host.overrideUserInterfaceStyle = .dark
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        let deadline = Date().addingTimeInterval(1.5)
        while Date() < deadline {
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let data = try XCTUnwrap(image.pngData())
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] {
            try data.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    @MainActor
    func testFullScreenIPadDemoRenders() throws {
        let suite = "DemoIPadRenderTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false))
        model.beginDemo()
        for (label, size) in [("portrait", Self.portrait), ("landscape", Self.landscape)] {
            try render(DemoDeckView().environmentObject(model), size: size, name: "ipad-\(label)-today")
        }
        // The other pages, as the split view's detail column shows them, in both widths.
        let sample = DemoDeck()
        let sidebar: CGFloat = 210
        for (label, screen) in [("portrait", Self.portrait), ("landscape", Self.landscape)] {
            let detail = CGSize(width: screen.width - sidebar, height: screen.height)
            try render(NavigationStack { DemoHomePage(sample: sample, onConnect: {}) }
                .environment(\.demoDetailWidth, detail.width), size: detail, name: "ipad-\(label)-home")
            try render(NavigationStack { DemoShopPage(sample: sample, onConnect: {}) }
                .environment(\.demoDetailWidth, detail.width), size: detail, name: "ipad-\(label)-shop")
        }
        let pad = CGSize(width: Self.portrait.width - sidebar, height: Self.portrait.height)
        try render(NavigationStack { DemoPadPage(sample: sample, onConnect: {}) }, size: pad, name: "ipad-portrait-pad")
    }
}
