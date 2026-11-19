import Foundation

/// Stepping through the pages a live deck shows (Today, Home, Keys and so on) from a hardware keyboard.
///
/// The page builds its own strip of tabs from the pages in its DOM, so the shell keeps no second copy of the
/// page list: it presses the next tab, exactly as a finger would. Foundation only, so the Linux harness checks
/// the script without WebKit.
enum DeckPageNav {
    /// The deck's page strip: one button per page, `data-p` holding that page's place. `app.js` builds it.
    static let tabSelector = "#pgs button[data-p]"

    /// A script that moves `step` pages from the one showing, wrapping at both ends, and answers the new place
    /// as a string. A page with no strip answers "none"; a step that lands where it started answers "same".
    /// Nothing is reported to the shell: the deck already moves its own tab, dots and content.
    static func stepScript(_ step: Int) -> String {
        """
        (function () {
          var tabs = Array.prototype.slice.call(document.querySelectorAll('\(tabSelector)'));
          if (tabs.length < 2) { return 'none'; }
          var now = 0;
          for (var i = 0; i < tabs.length; i++) { if (tabs[i].classList.contains('on')) { now = i; break; } }
          var next = ((now + (\(step) % tabs.length)) % tabs.length + tabs.length) % tabs.length;
          if (next === now) { return 'same'; }
          tabs[next].click();
          return String(next);
        })();
        """
    }
}
