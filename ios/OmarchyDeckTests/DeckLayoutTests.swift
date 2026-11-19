import XCTest
@testable import OmarchyDeck

/// Every window the app can be given, by its size classes. Foundation only, so it also runs in the Linux harness.
final class DeckLayoutTests: XCTestCase {
    private struct Window {
        let name: String
        let regularWidth: Bool
        let compactHeight: Bool
    }

    private let iPadFullScreen = Window(name: "iPad full screen", regularWidth: true, compactHeight: false)
    private let iPadSplitViewHalf = Window(name: "iPad Split View, half", regularWidth: false, compactHeight: false)
    private let iPadSplitViewThird = Window(name: "iPad Split View, third", regularWidth: false, compactHeight: false)
    private let iPadSlideOver = Window(name: "iPad Slide Over", regularWidth: false, compactHeight: false)
    /// 12.9 and 13 inch iPads keep regular width at two thirds of the screen.
    private let iPadSplitViewTwoThirds = Window(name: "large iPad Split View, two thirds", regularWidth: true,
                                                compactHeight: false)
    private let iPhonePortrait = Window(name: "iPhone portrait", regularWidth: false, compactHeight: false)
    private let iPhoneLandscape = Window(name: "iPhone landscape", regularWidth: false, compactHeight: true)
    private let iPhoneMaxLandscape = Window(name: "iPhone Max landscape", regularWidth: true, compactHeight: true)

    private func sidebar(_ window: Window) -> Bool {
        DeckLayout.demoUsesSidebar(regularWidth: window.regularWidth, compactHeight: window.compactHeight)
    }

    private func twoColumns(_ window: Window, accessibilityText: Bool = false) -> Bool {
        DeckLayout.firstRunUsesTwoColumns(regularWidth: window.regularWidth, compactHeight: window.compactHeight,
                                          accessibilityText: accessibilityText)
    }

    func testDemoUsesTheSidebarOnlyWhereThereIsRoomForIt() {
        for window in [iPadFullScreen, iPadSplitViewTwoThirds] {
            XCTAssertTrue(sidebar(window), window.name)
        }
    }

    /// A portrait iPad detail column (about 820 pt) keeps one column; a landscape one (about 1166 pt) splits in two.
    func testDemoSplitsItsCardsInTwoColumnsOnlyWhereEachColumnStillReads() {
        XCTAssertFalse(DeckLayout.demoUsesTwoColumns(detailWidth: 822))
        XCTAssertFalse(DeckLayout.demoUsesTwoColumns(detailWidth: 899))
        XCTAssertTrue(DeckLayout.demoUsesTwoColumns(detailWidth: 900))
        XCTAssertTrue(DeckLayout.demoUsesTwoColumns(detailWidth: 1166))
        XCTAssertFalse(DeckLayout.demoUsesTwoColumns(detailWidth: 0), "unmeasured keeps one column")
    }

    func testDemoFallsBackToTheTabBarInCompactWidthIncludingSplitViewAndSlideOver() {
        for window in [iPadSplitViewHalf, iPadSplitViewThird, iPadSlideOver, iPhonePortrait, iPhoneLandscape] {
            XCTAssertFalse(sidebar(window), "\(window.name) is too narrow for a sidebar")
        }
    }

    func testDemoKeepsTheTabBarOnALandscapePhoneEvenAtRegularWidth() {
        XCTAssertFalse(sidebar(iPhoneMaxLandscape), "A sidebar would leave a short phone no room for the page")
    }

    func testFirstRunUsesTwoColumnsOnWideOrShortWindows() {
        for window in [iPadFullScreen, iPadSplitViewTwoThirds, iPhoneLandscape, iPhoneMaxLandscape] {
            XCTAssertTrue(twoColumns(window), window.name)
        }
    }

    func testFirstRunStacksOneColumnInNarrowSplitViewSlideOverAndPortraitPhones() {
        for window in [iPadSplitViewHalf, iPadSplitViewThird, iPadSlideOver, iPhonePortrait] {
            XCTAssertFalse(twoColumns(window), window.name)
        }
    }

    func testAccessibilityTextAlwaysStacksFirstRun() {
        for window in [iPadFullScreen, iPadSplitViewTwoThirds, iPhoneLandscape, iPhoneMaxLandscape,
                       iPadSplitViewHalf, iPhonePortrait] {
            XCTAssertFalse(twoColumns(window, accessibilityText: true), window.name)
        }
    }

    /// Tile grids on Decks, United States and Market keep their columns at ordinary sizes and stack at accessibility sizes.
    func testTileGridsStackInOneColumnOnlyAtAccessibilityTextSizes() {
        for wanted in [2, 3, 4] {
            XCTAssertEqual(DeckLayout.tileColumns(wanted: wanted, accessibilityText: false), wanted)
            XCTAssertEqual(DeckLayout.tileColumns(wanted: wanted, accessibilityText: true), 1)
        }
        XCTAssertEqual(DeckLayout.tileColumns(wanted: 0, accessibilityText: false), 1, "A grid never gets zero columns")
    }

    func testFeedsUsesSidebarOnlyForRegularWideWindows() {
        XCTAssertFalse(DeckLayout.feedsUsesSidebar(regularWidth: true, windowWidth: 759))
        XCTAssertTrue(DeckLayout.feedsUsesSidebar(regularWidth: true, windowWidth: 760))
        XCTAssertFalse(DeckLayout.feedsUsesSidebar(regularWidth: false, windowWidth: 1_024))
    }

    func testFeedsAddsASecondColumnAtTheReadableWidthBoundary() {
        XCTAssertEqual(DeckLayout.feedsColumns(contentWidth: 0), 1)
        XCTAssertEqual(DeckLayout.feedsColumns(contentWidth: 559), 1)
        XCTAssertEqual(DeckLayout.feedsColumns(contentWidth: 560), 2)
    }

    // MARK: Token form keyboard clearance

    private let tokenWindow = CGRect(x: 0, y: 0, width: 390, height: 844)

    func testDockedKeyboardReservesOnlyTheCoveredContentAboveTheSafeArea() {
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: tokenWindow, keyboard: CGRect(x: 0, y: 544, width: 390, height: 300),
            safeAreaBottom: 34), 266)
    }

    func testFullWidthKeyboardStoppingShortOfTheWindowBottomReservesTheActions() {
        let window = CGRect(x: 0, y: 0, width: 402, height: 874)
        let keyboard = CGRect(x: 0, y: 583, width: 402, height: 233)
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: window, keyboard: keyboard, safeAreaBottom: 34), 305)
    }

    func testFloatingKeyboardDoesNotPushTheWholeTokenFormAboveItsTopEdge() {
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: tokenWindow, keyboard: CGRect(x: 40, y: 300, width: 300, height: 200),
            safeAreaBottom: 34), 0)
    }

    func testKeyboardInAnotherMultitaskingWindowDoesNotReserveSpace() {
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: tokenWindow, keyboard: CGRect(x: 500, y: 544, width: 390, height: 300),
            safeAreaBottom: 34), 0)
    }

    func testHiddenKeyboardClearsTheInset() {
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: tokenWindow, keyboard: CGRect(x: 0, y: 844, width: 390, height: 300),
            safeAreaBottom: 34), 0)
    }

    func testKeyboardOverlapIsClippedToTheWindow() {
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: tokenWindow, keyboard: CGRect(x: 0, y: -200, width: 390, height: 1200),
            safeAreaBottom: 34), 810)
    }

    func testKeyboardCoveringOnlyTheBottomSafeAreaNeedsNoExtraInset() {
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: tokenWindow, keyboard: CGRect(x: 0, y: 824, width: 390, height: 300),
            safeAreaBottom: 34), 0)
    }

    func testKeyboardGeometryUsesTheWindowsCoordinateSpace() {
        XCTAssertEqual(DeckLayout.keyboardBottomClearance(
            window: CGRect(x: 10, y: 20, width: 390, height: 844),
            keyboard: CGRect(x: 10, y: 564, width: 390, height: 300),
            safeAreaBottom: 34), 266)
    }
}
