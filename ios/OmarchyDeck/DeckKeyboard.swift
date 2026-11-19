import SwiftUI

extension DeckShortcut {
    var keyEquivalent: KeyEquivalent { KeyEquivalent(key) }
    var modifiers: EventModifiers { usesShift ? [.command, .shift] : .command }
}

/// A keyboard shortcut with no visible control. iPadOS still lists it under its title while Command is held,
/// and a hardware keyboard on iPhone fires it the same way.
struct KeyboardShortcutButton: View {
    let title: String
    let key: KeyEquivalent
    var modifiers: EventModifiers = .command
    let action: () -> Void

    var body: some View {
        Button(title, action: action)
            .keyboardShortcut(key, modifiers: modifiers)
            .frame(width: 0, height: 0)
            .opacity(0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// The deck screen's shortcuts, drawn from `DeckShortcutState.offered` so a key only exists while it does something.
struct DeckShortcutLayer: View {
    let state: DeckShortcutState
    let connections: [URL]
    let perform: (DeckShortcut) -> Void

    var body: some View {
        ZStack {
            ForEach(state.offered) { shortcut in
                KeyboardShortcutButton(title: shortcut.overlayTitle(in: connections),
                                       key: shortcut.keyEquivalent,
                                       modifiers: shortcut.modifiers) { perform(shortcut) }
            }
        }
        .accessibilityHidden(true)
    }
}

extension View {
    /// A Done button above the software keyboard. Apply it once per screen: each copy adds another button.
    func deckKeyboardDoneButton(action: @escaping () -> Void) -> some View {
        toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done", action: action)
                    .fontWeight(.semibold)
                    .accessibilityIdentifier("keyboard.done")
            }
        }
    }

    /// A tap on empty background puts the keyboard away. The catcher sits behind the content, so taps on fields
    /// and buttons still reach them.
    func dismissesKeyboardOnBackgroundTap(action: @escaping () -> Void) -> some View {
        background {
            Color.clear
                .contentShape(.rect)
                .onTapGesture(perform: action)
                .accessibilityHidden(true)
        }
    }
}

/// Keeps the last control of a scrolling screen reachable above the software keyboard.
///
/// The token form sits in a scroll view the system did not inset for the keyboard: at accessibility text sizes the
/// keyboard covered Paste and Open deck and no swipe could bring them above it. The screen therefore owns the inset.
/// It ignores the system's keyboard inset and pads its content by the keyboard's overlap with the window, so exactly
/// one inset applies whether or not the system would have added one.
private struct DeckKeyboardClearance: ViewModifier {
    @State private var overlap: CGFloat = 0
    @State private var window: UIWindow?

    func body(content: Content) -> some View {
        content
            .ignoresSafeArea(.keyboard, edges: .bottom)
            .safeAreaPadding(.bottom, overlap)
            .background(KeyboardWindowProbe(window: $window))
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
                guard let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
                let seconds = (note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
                let next = Self.overlap(of: end, in: window)
                withAnimation(.easeOut(duration: seconds)) { overlap = next }
            }
    }

    /// Bottom-edge overlap in the owning window's coordinates. A keyboard raised in another scene's window
    /// never intersects this one, so a second iPad window no longer zeroes or inflates this scene's clearance.
    private static func overlap(of keyboard: CGRect, in window: UIWindow?) -> CGFloat {
        guard let window else { return 0 }
        let local = window.convert(keyboard, from: window.screen.coordinateSpace)
        return DeckLayout.keyboardBottomClearance(window: window.bounds, keyboard: local,
                                                   safeAreaBottom: window.safeAreaInsets.bottom)
    }
}

/// Reports the window that owns the view; `isKeyWindow` across all scenes can belong to the other iPad window.
private struct KeyboardWindowProbe: UIViewRepresentable {
    @Binding var window: UIWindow?

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.onChange = { value in
            if window !== value { window = value }
        }
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        view.onChange = { value in
            if window !== value { window = value }
        }
    }

    final class ProbeView: UIView {
        var onChange: ((UIWindow?) -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            onChange?(window)
        }
    }
}

extension View {
    func deckKeyboardClearance() -> some View { modifier(DeckKeyboardClearance()) }
}
