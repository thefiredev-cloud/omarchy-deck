import Foundation
#if canImport(SwiftUI)
import SwiftUI
#endif

/// Plain-language next steps for a deck token. Foundation only, so the Linux harness tests it.
/// Messages never echo the input, so a pasted token cannot reach the screen, VoiceOver or a log.
enum TokenEntryCopy {
    /// The next step for a token that `DeckConfig.extractToken` refuses. Nil when the token is acceptable or empty.
    static func problem(_ input: String) -> String? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, DeckConfig.extractToken(text) == nil else { return nil }
        if text.contains(where: \.isWhitespace) { return "A deck token has no spaces. Paste only the token." }
        if text.contains("?t=") { return "The ?t= value is not a complete deck token. Copy the whole link again." }
        if text.contains("://") || text.contains("?") { return "Paste the token itself, or a deck link that contains ?t=." }
        if text.count < 8 { return "A deck token is at least 8 characters. Check that the whole token was pasted." }
        if text.count > 256 { return "That is longer than a deck token. Check that only the token was pasted." }
        return "A deck token uses letters, numbers, - and _ only. Check for stray characters."
    }
}

#if canImport(SwiftUI)
struct TokenView: View {
    /// DeckModel's wording when a saved session stopped working. The screen then leads with "Sign in again".
    static let expiredNotice = "Sign in again to open the deck."

    @EnvironmentObject var deck: DeckModel
    let notice: String?
    @State private var token = ""
    @State private var feedbackTick = 0
    /// A format problem with what was typed. It clears as soon as the user edits the field.
    @State private var problem: String?
    /// Set once the user edits after DeckModel's notice appeared, so that stale notice stops showing.
    @State private var noticeCleared = false
    @FocusState private var focused: Bool
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.verticalSizeClass) private var verticalSize

    private var expired: Bool { notice == Self.expiredNotice }

    /// The message under the field: a local format problem first, then DeckModel's notice until the user edits.
    private var shownNotice: String? {
        if let problem { return problem }
        if expired || noticeCleared { return nil }
        return notice
    }

    var body: some View {
        DeckInsetReader { inset in
            ScrollView {
                VStack(spacing: DeckSpace.m) {
                    if verticalSize != .compact {
                        DeckIcon(name: "rectangle.grid.2x2", hero: true)
                            .foregroundStyle(DeckColors.signal)
                            .padding(.top, DeckSpace.l)
                    }
                    Text("Omarchy Deck")
                        .textCase(.uppercase)
                        .deckEyebrow()
                        .accessibilityIdentifier("token.eyebrow")
                    Text(expired ? "Sign in again" : "Enter your deck token")
                        .deckTitle()
                        .fixedSize(horizontal: false, vertical: true)
                        // Large Dynamic Type splits a Text into one AX node per line; combining keeps one `token.title`.
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("token.title")
                    Text(expired
                         ? "Your deck signed this device out. Enter your deck token to continue."
                         : "The token is your deck's access code. Ask whoever runs the deck for it. You enter it once, and the deck keeps this device signed in. The app never saves it.")
                        .deckBody()
                        .accessibilityIdentifier("token.body")

                    VStack(alignment: .leading, spacing: DeckSpace.s) {
                        SecureField("Deck token", text: $token)
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .focused($focused)
                            .onSubmit(go)
                            .font(DeckType.mono)
                            .padding(.horizontal, DeckSpace.m)
                            .frame(minHeight: DeckSpace.control)
                            .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.controlRadius))
                            .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius).strokeBorder(DeckColors.fieldEdge, lineWidth: 1))
                            .foregroundStyle(DeckColors.fg)
                            .accessibilityLabel("Deck token")
                            .accessibilityIdentifier("token.field")
                        Text("You can paste the whole deck link instead. It ends in ?t= and the token.")
                            .font(DeckType.caption)
                            .foregroundStyle(DeckColors.dim)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("token.help")
                    }

                    if let message = shownNotice {
                        Label {
                            Text(message)
                        } icon: {
                            DeckIcon(name: "exclamationmark.circle")
                        }
                        .font(DeckType.captionStrong)
                        .foregroundStyle(DeckColors.fg)
                        .padding(DeckSpace.s + DeckSpace.xs)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(DeckColors.panel, in: .rect(cornerRadius: DeckStyle.cardRadius))
                        .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius).strokeBorder(DeckColors.bad.opacity(0.7), lineWidth: 1))
                        .accessibilityIdentifier("token.notice")
                    }

                    // Side by side the two buttons each get half the width, which breaks "Open deck" mid-word at the
                    // accessibility sizes. Stacked, each button gets the full width. The default size keeps one row.
                    let stack = typeSize.isAccessibilitySize
                    let actions = stack
                        ? AnyLayout(VStackLayout(spacing: DeckSpace.s + DeckSpace.xs))
                        : AnyLayout(HStackLayout(spacing: DeckSpace.s + DeckSpace.xs))
                    actions {
                        pasteButton
                            .frame(maxWidth: stack ? CGFloat.infinity : nil)
                        openButton
                    }

                    Text("Connecting to \(deck.selectedOrigin?.absoluteString ?? "your server"). Only pages from this server open inside the app.")
                        .font(DeckType.caption)
                        .foregroundStyle(DeckColors.dim)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("token.server")
                }
                .padding(.top, inset.top)
                .padding(.bottom, inset.bottom)
                .padding(.leading, max(inset.leading, DeckSpace.l))
                .padding(.trailing, max(inset.trailing, DeckSpace.l))
                .frame(maxWidth: DeckSpace.column)
                .frame(maxWidth: .infinity)
                .dismissesKeyboardOnBackgroundTap { focused = false }
            }
            .scrollDismissesKeyboard(.interactively)
            .deckKeyboardClearance()
            .accessibilityIdentifier("screen.token")
        }
        .dismissesKeyboardOnBackgroundTap { focused = false }
        .deckKeyboardDoneButton { focused = false }
        .background(DeckColors.bg)
        .sensoryFeedback(trigger: feedbackTick) { _, _ in expired ? .warning : .error }
        .onChange(of: token) { _, _ in
            problem = nil
            if !token.isEmpty { noticeCleared = true }
        }
        .onChange(of: notice) { _, _ in
            problem = nil
            noticeCleared = false
        }
        .onAppear {
            // A landscape phone has no room for the keyboard and the actions together: the field takes focus on tap there.
            focused = verticalSize != .compact
            if notice != nil { feedbackTick += 1 }
        }
    }

    private var pasteButton: some View {
        PasteButton(payloadType: String.self) { strings in
            if let s = strings.first { token = s }
        }
        .buttonBorderShape(.roundedRectangle(radius: DeckStyle.controlRadius))
        // Panel is a surface color. As the Paste label it is about 1.1:1 on the page, so the label uses text-1.
        .tint(DeckColors.fg)
        .frame(minHeight: DeckSpace.control)
        // The identifier sits on PasteButton itself. VoiceOver's activate pastes the clipboard, same as a tap.
        .accessibilityIdentifier("token.paste")
    }

    private var openButton: some View {
        Button("Open deck", action: go)
            .buttonStyle(TokenOpenButtonStyle())
            .disabled(token.isEmpty)
            // Return on a hardware keyboard opens the deck from anywhere on the screen, not only from the field.
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("token.open")
    }

    private func go() {
        let t = token
        // An empty submit does nothing. Nothing is sent and no error is shown for it.
        guard !t.isEmpty else { return }
        if let message = TokenEntryCopy.problem(t) {
            // The typed text stays so the user can correct it. Only the fixed message above is shown or announced.
            problem = message
            focused = true
            feedbackTick += 1
            AccessibilityNotification.Announcement(message).post()
            return
        }
        token = ""          // never keep the secret in view state once it is handed off
        focused = false
        noticeCleared = false
        deck.submit(token: t)
    }
}

/// Same amber face as `DeckPrimaryButtonStyle` while the token is present.
/// Disabled, that style fades the face to 0.45 opacity, about 2.9:1. Text-1 on panel stays above 4.5:1.
private struct TokenOpenButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .multilineTextAlignment(.center)
            .foregroundStyle(isEnabled ? DeckColors.onSignal : DeckColors.fg)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(isEnabled ? DeckColors.signal : DeckColors.panel,
                        in: .rect(cornerRadius: DeckStyle.controlRadius))
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(.smooth(duration: 0.12), value: configuration.isPressed)
            .contentShape(.rect(cornerRadius: DeckStyle.controlRadius))
    }
}
#endif
