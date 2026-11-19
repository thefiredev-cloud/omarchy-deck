import SwiftUI
import UIKit
import WebKit

/// Pad key caps must not take focus from the remote typing field: every cap on the Keys, Function and Media pages
/// (`#kpages .kc`), the mouse buttons (`#mrow`, `#kbmouse`), the page tabs (`#ppg`), and on older servers the modifier
/// caps, Esc/Tab/arrows/Backspace/Enter row and bind buttons. Cancel focus transfer before the page handles the press;
/// its latch and click handlers still run.
enum PadKeyboardFocus {
    static let script = """
    (() => {
      const KEYS = '#kpages .kc, #mrow .kc, #kbmouse button, #ppg button, #kpages button[data-m], #kbmods button[data-m], '
        + '#kbnav button[data-k], #kbfav button, #kblist button.go';
      function keepTyping(event) {
        const input = document.activeElement;
        if (!input || input.id !== 'kin') return;
        const button = event.target.closest?.(KEYS);
        if (button) event.preventDefault();
      }
      document.addEventListener('pointerdown', keepTyping, {capture: true, passive: false});
      document.addEventListener('mousedown', keepTyping, {capture: true, passive: false});
    })();
    """
}

/// Pull to refresh on the real deck page (I2, I15). The page locks its root (`html,body{overflow:hidden}`) and every
/// inner scroller sets `overscroll-behavior:contain`, so the web view's scroll view never overscrolls and a
/// UIRefreshControl never fires. This script watches the page instead: one finger that starts where the scroller
/// under it (the active `.page` in portrait, its column in landscape, or the document) is at its top, then pulls down
/// more than 70 px without the page claiming the touch, posts `deckRefresh` once. Touches the page handles itself
/// (preventDefault, or `touch-action` none or pan-x: the Pad, sliders, the page strip), form fields and sideways or
/// upward moves never count.
enum DeckPullRefresh {
    static let handlerName = "deckRefresh"
    static let thresholdPixels = 70
    static let script = """
    (() => {
      if (window.__deckPullRefresh) return;
      window.__deckPullRefresh = true;
      const LIMIT = \(thresholdPixels);
      const SKIP = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],canvas,video,#kin,[data-no-pull]';
      let pull = null;
      function scroller(node) {
        for (let el = node; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
          const overflow = getComputedStyle(el).overflowY;
          if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
        }
        return document.scrollingElement || document.documentElement;
      }
      function claimed(node) {
        // The nearest declared touch-action decides: `.page` (pan-x pan-y) inside `#pager` (pan-x) may pull,
        // the Pad surface (none) and the horizontal strips (pan-x) may not.
        for (let el = node; el && el !== document.documentElement; el = el.parentElement) {
          const action = getComputedStyle(el).touchAction || 'auto';
          if (action === 'auto' || action === 'manipulation') continue;
          return action.includes('none') || !(action.includes('pan-y') || action.includes('pan-down'));
        }
        return false;
      }
      function atTop(el) { return el.scrollTop <= 0 && window.scrollY <= 0; }
      addEventListener('touchstart', (event) => {
        pull = null;
        if (event.touches.length !== 1) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target.closest(SKIP) || claimed(target)) return;
        const el = scroller(target);
        if (!atTop(el)) return;
        const touch = event.touches[0];
        pull = { x: touch.screenX, y: touch.screenY, el: el, sent: false };
      }, { passive: true });
      addEventListener('touchmove', (event) => {
        if (!pull || pull.sent) return;
        if (event.defaultPrevented || event.touches.length !== 1 || !atTop(pull.el)) { pull = null; return; }
        const touch = event.touches[0];
        const down = touch.screenY - pull.y;
        const across = Math.abs(touch.screenX - pull.x);
        if (down < -6 || (across > 24 && across > down)) { pull = null; return; }
        if (down > LIMIT && across < down / 2) {
          pull.sent = true;
          try { window.webkit.messageHandlers.\(handlerName).postMessage({ pull: down }); } catch (error) {}
        }
      }, { passive: true });
      addEventListener('touchend', () => { pull = null; }, { passive: true });
      addEventListener('touchcancel', () => { pull = null; }, { passive: true });
    })();
    """
}

/// Receives `deckRefresh` from the main frame only and hands it to the model. Registered through
/// `WeakScriptMessageHandler`, so WebKit never keeps the model alive.
@MainActor
final class DeckPullRefreshBridge: NSObject, WKScriptMessageHandler {
    private let onPull: () -> Void

    init(onPull: @escaping () -> Void) {
        self.onPull = onPull
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.name == DeckPullRefresh.handlerName else { return }
        onPull()
    }
}

/// The corner of the page the shell keeps for its Decks control (shell and web contract 2).
/// The page reads `--shell-reserve-top-right`: 56px while the control is visible, 0px while it is hidden.
enum ShellReserve {
    static let variable = "--shell-reserve-top-right"

    /// Sets the property once `<html>` exists (it does not at document start), and again on DOMContentLoaded.
    static func script(points: Int) -> String {
        "(function(){var v='\(points)px';function a(){var e=document.documentElement;" +
        "if(e){e.style.setProperty('\(variable)',v);return true}return false}" +
        "if(!a()){new MutationObserver(function(_,o){if(a())o.disconnect()}).observe(document,{childList:true})}" +
        "document.addEventListener('DOMContentLoaded',a)})();"
    }

    /// Future documents get the value at document start; the current document is updated in place.
    /// Only the previous reserve script is replaced. Other user scripts, such as the token scrub, stay installed.
    @MainActor
    static func install(points: Int, in webView: WKWebView) {
        let source = script(points: points)
        let controller = webView.configuration.userContentController
        // Materialize retained script references before mutating WebKit's bridged userScripts collection.
        let others = controller.userScripts.filter { !$0.source.contains(variable) }
        controller.removeAllUserScripts()
        others.forEach { controller.addUserScript($0) }
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(source, completionHandler: nil)
    }
}

/// Visibility of the Decks control. It dims 3 s after the last interaction while the deck is on screen,
/// and returns to full strength on a tap in the top band. The control never disappears and never stops
/// taking taps: a reviewer must always be able to reach Decks, Pro, About and Remove deck
/// (App Review Guideline 5.6, build 21). The corner stays reserved while it is dimmed.
@MainActor
final class DeckChrome: ObservableObject {
    nonisolated static let controlPoints: CGFloat = 44
    /// Control plus its 8 pt inset on the safe-area corner, rounded up to leave air.
    nonisolated static let reservedPoints = 56
    nonisolated static let idleSeconds = 3.0
    /// Height of the band, below the top safe-area edge, where a tap brings the control back.
    nonisolated static let revealBandPoints: CGFloat = 44

    @Published private(set) var isPresent = false
    /// True while the control is on screen. It is always tappable while present; `isDimmed` only changes how it looks.
    @Published private(set) var isVisible = false
    /// True after the idle wait. The glyph draws at a low but visible opacity; taps still open Decks.
    @Published private(set) var isDimmed = false

    /// 56 while the control is present, else 0. The page reads this as `--shell-reserve-top-right`.
    /// The corner stays reserved while the control is dimmed, because the control still takes taps there.
    var reservedPoints: Int { isVisible ? Self.reservedPoints : 0 }
    var onReserveChange: ((Int) -> Void)?

    private var present = false
    private var contentReady = false
    private var sheetOpen = false
    private var dimmed = false
    private var dimTask: Task<Void, Never>?
    private var announced: Int?
    private let sleep: @MainActor (UInt64) async throws -> Void
    private let assistiveRunning: @MainActor () -> Bool
    private var observers: [NSObjectProtocol] = []

    init(sleep: @escaping @MainActor (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) },
         assistiveRunning: @escaping @MainActor () -> Bool = {
             DeckChrome.suppressesDim(
                 voiceOver: UIAccessibility.isVoiceOverRunning,
                 switchControl: UIAccessibility.isSwitchControlRunning,
                 reduceTransparency: UIAccessibility.isReduceTransparencyEnabled,
                 accessibilityTextSize: UIApplication.shared.preferredContentSizeCategory.isAccessibilityCategory)
         }) {
        self.sleep = sleep
        self.assistiveRunning = assistiveRunning
        for name in [UIAccessibility.voiceOverStatusDidChangeNotification,
                     UIAccessibility.switchControlStatusDidChangeNotification,
                     UIAccessibility.reduceTransparencyStatusDidChangeNotification,
                     UIContentSizeCategory.didChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            })
        }
    }

    /// The dim is decoration only; anyone who needs stronger contrast or bigger text keeps the full-strength glyph.
    nonisolated static func suppressesDim(voiceOver: Bool, switchControl: Bool,
                                          reduceTransparency: Bool, accessibilityTextSize: Bool) -> Bool {
        voiceOver || switchControl || reduceTransparency || accessibilityTextSize
    }

    deinit {
        dimTask?.cancel()
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    /// Present while a deck is selected and it is not the demo. `contentReady` is true once the page is showing.
    func update(present: Bool, contentReady: Bool) {
        self.present = present
        self.contentReady = contentReady
        refresh()
    }

    func setSheetPresented(_ open: Bool) {
        sheetOpen = open
        refresh()
    }

    /// A tap in the top band brings the control back to full strength and restarts the idle wait.
    /// The control is tappable either way, so this is a visual restore only.
    func reveal() {
        dimmed = false
        dimTask?.cancel()
        dimTask = nil
        refresh()
    }

    nonisolated static func isRevealTouch(y: CGFloat, safeAreaTop: CGFloat) -> Bool {
        y >= 0 && y < safeAreaTop + revealBandPoints
    }

    private func refresh() {
        let pinned = !contentReady || sheetOpen || assistiveRunning()
        if !present || pinned {
            dimTask?.cancel()
            dimTask = nil
            dimmed = false
        } else if dimTask == nil && !dimmed {
            dimTask = Task { [weak self] in
                guard let self else { return }
                try? await self.sleep(UInt64(Self.idleSeconds * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self.dimTask = nil
                self.dimmed = true
                self.publish()
            }
        }
        publish()
    }

    private func publish() {
        // Present means on screen and tappable. The idle wait only dims the glyph, so the control
        // can never become invisible or untappable (Guideline 5.6).
        let visible = present
        let dimmedNow = present && dimmed
        if isPresent != present { isPresent = present }
        if isVisible != visible { isVisible = visible }
        if isDimmed != dimmedNow { isDimmed = dimmedNow }
        let reserve = reservedPoints
        if announced != reserve {
            announced = reserve
            onReserveChange?(reserve)
        }
    }
}
