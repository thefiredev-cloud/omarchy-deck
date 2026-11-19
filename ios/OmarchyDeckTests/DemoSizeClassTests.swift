import SwiftUI
import UIKit
import XCTest
@testable import OmarchyDeck

/// The demo rendered in the windows iPad multitasking produces. SwiftUI backs `NavigationSplitView` with a
/// `UISplitViewController` and `TabView` with a `UITabBarController`, so the container under the hosting controller
/// shows which layout the size classes picked. Needs UIKit, so it runs on the Mini, not in the Linux harness.
final class DemoSizeClassTests: XCTestCase {
    private enum Container: Equatable { case sidebar, tabBar, neither }

    @MainActor
    private func container(width: UIUserInterfaceSizeClass, height: UIUserInterfaceSizeClass,
                           size: CGSize) throws -> Container {
        let suite = "DemoSizeClassTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = DeckModel(defaults: defaults, startsAutomatically: false,
                              pro: ProEntitlement(startsAutomatically: false))
        model.beginDemo()

        let host = UIHostingController(rootView: DemoDeckView().environmentObject(model))
        host.traitOverrides.horizontalSizeClass = width
        host.traitOverrides.verticalSizeClass = height
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }

        let found = settledContainer(under: host, width: width, timeout: 5)
        XCTAssertEqual(host.traitCollection.horizontalSizeClass, width)
        return found
    }

    /// SwiftUI can attach its container controller a run loop turn after the first layout pass. Lays out and checks
    /// on every turn, returning as soon as the overridden size class has landed and a container exists. The timeout
    /// only bounds a broken layout, so a busy machine costs time instead of a false failure.
    @MainActor
    private func settledContainer(under host: UIViewController, width: UIUserInterfaceSizeClass,
                                  timeout: TimeInterval) -> Container {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            let found = currentContainer(under: host)
            if host.traitCollection.horizontalSizeClass == width, found != .neither { return found }
            if Date() >= deadline {
                XCTFail("no split view or tab bar controller within \(timeout) s")
                return found
            }
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
    }

    @MainActor
    private func currentContainer(under host: UIViewController) -> Container {
        if contains(UISplitViewController.self, under: host) { return .sidebar }
        if contains(UITabBarController.self, under: host) { return .tabBar }
        return .neither
    }

    @MainActor
    private func contains<T: UIViewController>(_ type: T.Type, under controller: UIViewController) -> Bool {
        if controller is T { return true }
        return controller.children.contains { contains(type, under: $0) }
    }

    @MainActor
    func testFullScreenIPadShowsTheSidebar() throws {
        let found = try container(width: .regular, height: .regular, size: CGSize(width: 1032, height: 1376))
        XCTAssertEqual(found, .sidebar)
    }

    /// Split View at one half or one third, and Slide Over, are compact width on every iPad.
    @MainActor
    func testSplitViewAndSlideOverWidthsShowTheTabBar() throws {
        for size in [CGSize(width: 504, height: 1376), CGSize(width: 375, height: 1376), CGSize(width: 320, height: 1100)] {
            let found = try container(width: .compact, height: .regular, size: size)
            XCTAssertEqual(found, .tabBar, "compact width \(size.width) pt")
        }
    }

    @MainActor
    func testLandscapePhoneKeepsTheTabBar() throws {
        let found = try container(width: .regular, height: .compact, size: CGSize(width: 956, height: 440))
        XCTAssertEqual(found, .tabBar)
    }
}
