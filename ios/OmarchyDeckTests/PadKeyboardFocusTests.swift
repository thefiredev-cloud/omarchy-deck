import WebKit
import XCTest
@testable import OmarchyDeck

@MainActor
final class PadKeyboardFocusTests: XCTestCase {
    func testModifierPressCancelsFocusTransferWithoutSwallowingTheLatch() async throws {
        let view = try await page()
        for container in ["kpages", "kbmods"] {
            for modifier in ["cmd", "super", "ctrl", "alt", "shift"] {
                for event in ["pointerdown", "mousedown"] {
                    let result = try await view.evaluateJavaScript("""
                    (() => {
                      const input = document.getElementById('kin');
                      input.focus();
                      const button = document.querySelector('#\(container) [data-m="\(modifier)"]');
                      let presses = 0;
                      const latch = () => { presses++; };
                      button.addEventListener('\(event)', latch);
                      const press = new MouseEvent('\(event)', {bubbles: true, cancelable: true});
                      button.firstElementChild.dispatchEvent(press);
                      button.removeEventListener('\(event)', latch);
                      return {cancelled: press.defaultPrevented, presses,
                              focused: document.activeElement === input};
                    })()
                    """)
                    let state = try XCTUnwrap(result as? [String: Any])
                    XCTAssertEqual(state["cancelled"] as? Bool, true, "\(container)/\(modifier)/\(event)")
                    XCTAssertEqual(state["presses"] as? Int, 1, "The page must still receive its modifier press")
                    XCTAssertEqual(state["focused"] as? Bool, true)
                }
            }
        }
    }

    func testOtherControlsAndUnfocusedTypingKeepTheirDefaultBehavior() async throws {
        let view = try await page()
        let result = try await view.evaluateJavaScript("""
        (() => {
          const input = document.getElementById('kin');
          const other = document.getElementById('other');
          const modifier = document.querySelector('#kpages [data-m]');
          function cancelled(target, type) {
            const event = new MouseEvent(type, {bubbles: true, cancelable: true});
            target.dispatchEvent(event);
            return event.defaultPrevented;
          }
          input.focus();
          const otherCancelled = cancelled(other, 'mousedown');
          const clickCancelled = cancelled(modifier, 'click');
          input.blur();
          return {otherCancelled, clickCancelled,
                  unfocusedCancelled: cancelled(modifier, 'pointerdown')};
        })()
        """)
        let state = try XCTUnwrap(result as? [String: Any])
        for key in ["otherCancelled", "clickCancelled", "unfocusedCancelled"] {
            XCTAssertEqual(state[key] as? Bool, false, key)
        }
    }

    func testNavKeysAndBindButtonsKeepTheTypingFieldFocused() async throws {
        let view = try await page()
        for selector in ["#kbnav [data-k='esc']", "#kbnav [data-k='enter']", "#kbfav button", "#kblist .go"] {
            for event in ["pointerdown", "mousedown"] {
                let result = try await view.evaluateJavaScript("""
                (() => {
                  const input = document.getElementById('kin');
                  input.focus();
                  const button = document.querySelector("\(selector)");
                  let presses = 0;
                  const count = () => { presses++; };
                  button.addEventListener('\(event)', count);
                  const press = new MouseEvent('\(event)', {bubbles: true, cancelable: true});
                  button.firstElementChild.dispatchEvent(press);
                  button.removeEventListener('\(event)', count);
                  return {cancelled: press.defaultPrevented, presses};
                })()
                """)
                let state = try XCTUnwrap(result as? [String: Any])
                XCTAssertEqual(state["cancelled"] as? Bool, true, "\(selector)/\(event)")
                XCTAssertEqual(state["presses"] as? Int, 1, "The page must still receive the press")
            }
        }
    }

    func testCurrentPadKeyCapsMouseButtonsAndPageTabsKeepTheTypingFieldFocused() async throws {
        let view = try await page()
        let selectors = ["#kpages [data-id='enter']", "#kpages [data-id='paste']", "#kpages [data-id='ralt']",
                         "#mrow [data-ck='l']", "#kbmouse [data-ck='r']", "#ppg [data-pg='fn']"]
        for selector in selectors {
            for event in ["pointerdown", "mousedown"] {
                let result = try await view.evaluateJavaScript("""
                (() => {
                  document.getElementById('kin').focus();
                  const button = document.querySelector("\(selector)");
                  let presses = 0;
                  const count = () => { presses++; };
                  button.addEventListener('\(event)', count);
                  const press = new MouseEvent('\(event)', {bubbles: true, cancelable: true});
                  button.firstElementChild.dispatchEvent(press);
                  button.removeEventListener('\(event)', count);
                  return {cancelled: press.defaultPrevented, presses};
                })()
                """)
                let state = try XCTUnwrap(result as? [String: Any])
                XCTAssertEqual(state["cancelled"] as? Bool, true, "\(selector)/\(event)")
                XCTAssertEqual(state["presses"] as? Int, 1, "The page must still receive the press")
            }
        }
    }

    func testPinStarAndUnfocusedNavPressKeepTheirDefaultBehavior() async throws {
        let view = try await page()
        let result = try await view.evaluateJavaScript("""
        (() => {
          const input = document.getElementById('kin');
          function cancelled(selector) {
            const event = new MouseEvent('mousedown', {bubbles: true, cancelable: true});
            document.querySelector(selector).firstElementChild.dispatchEvent(event);
            return event.defaultPrevented;
          }
          input.focus();
          const star = cancelled('#kblist .star');
          input.blur();
          return {star, unfocused: cancelled('#kbnav [data-k="esc"]')};
        })()
        """)
        let state = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(state["star"] as? Bool, false)
        XCTAssertEqual(state["unfocused"] as? Bool, false)
    }

    private func page() async throws -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(
            source: PadKeyboardFocus.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        let buttons = ["cmd", "super", "ctrl", "alt", "shift"].map {
            "<button data-m='\($0)'><span>\($0)</span></button>"
        }.joined()
        let nav = ["esc", "tab", "enter"].map { "<button data-k='\($0)'><span>\($0)</span></button>" }.joined()
        await WebLoadWaiter().load(html: """
        <!doctype html><input id=kin><button id=other>Done</button>
        <div id=kpages>\(buttons)<div class=kp><button class=kc data-id=enter data-k=enter><span>Enter</span></button>
        <button class=kc data-id=paste><span>Paste</span></button>
        <button class='kc holdkey' data-id=ralt><span>Right Alt</span></button></div></div>
        <div id=ppg><button data-pg=keys><span>Keys</span></button><button data-pg=fn><span>Function</span></button></div>
        <div id=mrow><button class='kc mk' data-ck=l><span>Left</span></button></div>
        <div id=kbmouse><button class='b ck' data-ck=r><span>RIGHT</span></button></div>
        <div id=kbmods>\(buttons)</div><div id=kbnav>\(nav)</div>
        <div id=kbfav><button><span>Pinned</span></button></div>
        <div id=kblist><div class=kbr><button class=star><span>*</span></button>
        <button class=go><span>Bind</span></button></div></div>
        """, in: view)
        return view
    }
}
