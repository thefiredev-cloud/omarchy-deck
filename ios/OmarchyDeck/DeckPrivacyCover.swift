import SwiftUI
import UIKit

/// A synchronous window cover supplements SwiftUI scene state for switcher snapshots.
struct DeckPrivacyCover: UIViewRepresentable {
    func makeUIView(context: Context) -> CoverAnchor { CoverAnchor(frame: .zero) }
    func updateUIView(_ uiView: CoverAnchor, context: Context) {}

    final class CoverAnchor: UIView {
        private let cover = UIView()
        private weak var coveredRoot: UIView?
        private var accessibilityState = PrivacyCoverAccessibilityState()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            cover.backgroundColor = .black
            cover.isAccessibilityElement = true
            cover.accessibilityLabel = "Omarchy Deck privacy cover"
            cover.accessibilityViewIsModal = true
            NotificationCenter.default.addObserver(self, selector: #selector(hideDeck),
                name: UIApplication.willResignActiveNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(hideDeck),
                name: UIApplication.didEnterBackgroundNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(showDeck),
                name: UIApplication.didBecomeActiveNotification, object: nil)
        }

        // Built in code only. A storyboard or nib decode returns nil instead of trapping the app.
        required init?(coder: NSCoder) { return nil }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil {
                showDeck()
            } else if UIApplication.shared.applicationState != .active {
                hideDeck()
            }
        }

        @objc private func hideDeck() {
            guard let window else { return }
            if cover.superview == nil {
                coveredRoot = window.rootViewController?.view
                if let coveredRoot {
                    accessibilityState.hide(currentAccessibilityHidden: coveredRoot.accessibilityElementsHidden)
                    coveredRoot.accessibilityElementsHidden = true
                }
                cover.frame = window.bounds
                cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                window.addSubview(cover)
            }
            window.bringSubviewToFront(cover)
        }

        @objc private func showDeck() {
            cover.removeFromSuperview()
            if let previous = accessibilityState.show() {
                coveredRoot?.accessibilityElementsHidden = previous
            }
            coveredRoot = nil
        }

        deinit { NotificationCenter.default.removeObserver(self) }
    }
}
