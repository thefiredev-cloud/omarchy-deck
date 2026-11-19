import SwiftUI
import UIKit

/// Shared native metrics. Colors live in `DeckColors` (neutral ramp plus one tint, from `wave2/tokens.json`). Radii are
/// the web deck's (`tokens.css` `--r-panel`, `--r-ctl`; DESIGN section 4): square controls, round only for status.
enum DeckStyle {
    /// Panels and cards.
    static let cardRadius: CGFloat = 6
    /// Buttons, fields, chips and filter menus.
    static let controlRadius: CGFloat = 4
}

/// Where the deck's privacy and support pages live (shell/web contract item 5).
enum DeckLinks {
    // Optional parsing prevents malformed hard-coded legal URLs from trapping app startup.
    static let privacy = URL(string: "https://kodros.ai/privacy/deck")
    static let support = URL(string: "https://kodros.ai/deck/support")
}

/// 44 pt-or-taller filled action in the one tint. Pressed state scales slightly unless Reduce Motion is on.
struct DeckPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .multilineTextAlignment(.center)
            .foregroundStyle(DeckColors.onSignal)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(DeckColors.signal, in: .rect(cornerRadius: DeckStyle.controlRadius))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(.smooth(duration: 0.12), value: configuration.isPressed)
            .contentShape(.rect(cornerRadius: DeckStyle.controlRadius))
    }
}

/// Outlined action for the second choice on a screen.
struct DeckSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .multilineTextAlignment(.center)
            .foregroundStyle(DeckColors.fg)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius).strokeBorder(DeckColors.line, lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(.smooth(duration: 0.12), value: configuration.isPressed)
            .contentShape(.rect(cornerRadius: DeckStyle.controlRadius))
    }
}

/// Text-only action, still a 44 pt target.
struct DeckQuietButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(configuration.isPressed ? DeckColors.fg : DeckColors.dim)
            .frame(minHeight: 44)
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(.rect)
    }
}

/// Privacy and Support, one row. `Link` opens the page in the system browser. Each link is a 44 pt target: the frame and
/// hit shape sit inside the label, because a frame outside a `Link` adds layout space, not hit area.
struct DeckLegalLinks: View {
    var body: some View {
        HStack(spacing: 20) {
            if let privacy = DeckLinks.privacy {
                Link(destination: privacy) { legalLabel("Privacy") }
                    .accessibilityIdentifier("link.privacy")
            }
            if let support = DeckLinks.support {
                Link(destination: support) { legalLabel("Support") }
                    .accessibilityIdentifier("link.support")
            }
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(DeckColors.dim)
        .tint(DeckColors.dim)
    }

    private func legalLabel(_ title: String) -> some View {
        Text(title)
            .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap, alignment: .leading)
            .contentShape(.rect)
    }
}

/// The deck screens sit inside ContentView, which lets the web view run edge to edge. Native screens keep
/// `max(safe area, 16)` on every side: they read the window's real insets and subtract whatever safe area the
/// parent already propagated, so the result is right whether or not an ancestor ignores the safe area.
struct DeckInsetReader<Content: View>: View {
    @State private var window = UIEdgeInsets.zero
    @ViewBuilder let content: (EdgeInsets) -> Content

    var body: some View {
        GeometryReader { proxy in
            let propagated = proxy.safeAreaInsets
            content(EdgeInsets(
                top: Self.extra(window.top, propagated.top),
                leading: Self.extra(window.left, propagated.leading),
                bottom: Self.extra(window.bottom, propagated.bottom),
                trailing: Self.extra(window.right, propagated.trailing)))
        }
        .background(WindowInsetProbe(insets: $window).allowsHitTesting(false))
    }

    private static func extra(_ windowInset: CGFloat, _ propagated: CGFloat) -> CGFloat {
        max(max(windowInset, 16) - propagated, 0)
    }
}

private struct WindowInsetProbe: UIViewRepresentable {
    @Binding var insets: UIEdgeInsets

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.onChange = { value in
            if insets != value { insets = value }
        }
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        view.onChange = { value in
            if insets != value { insets = value }
        }
    }

    final class ProbeView: UIView {
        var onChange: ((UIEdgeInsets) -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            report()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            report()
        }

        private func report() {
            guard let value = window?.safeAreaInsets else { return }
            DispatchQueue.main.async { [weak self] in self?.onChange?(value) }
        }
    }
}
