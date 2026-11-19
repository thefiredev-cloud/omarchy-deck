import Foundation
#if canImport(SwiftUI)
import SwiftUI
#endif

/// Plain-language next steps for a server address. Foundation only, so the Linux harness tests it.
/// Messages never echo the input, so a pasted token cannot reach the screen, VoiceOver or a log.
enum AddressEntryCopy {
    static let example = "Enter only the server address, like https://deck.example.com:10443/."

    /// The next step for an address that `DeckConfig.splitDeckLink` refuses. Nil when the address (or a full deck
    /// link with its `?t=` token) is acceptable, or empty.
    static func problem(_ input: String) -> String? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, DeckConfig.splitDeckLink(text) == nil else { return nil }
        if text.contains(where: \.isWhitespace) { return "A server address has no spaces. \(example)" }
        if let range = text.range(of: "://"), text[..<range.lowerBound].lowercased() != "https" {
            return "Start the address with https://. This app connects only over HTTPS."
        }
        if text.contains("@") { return "Remove the username, password, or token before the @. \(example)" }
        if text.contains("?") || text.contains("#") {
            return "Paste the whole deck link with its ?t= token, or remove everything after the address. \(example)"
        }
        let full = text.contains("://") ? text : "https://" + text
        if let parts = URLComponents(string: full) {
            if let port = parts.port, !(1...65535).contains(port) {
                return "The port must be a number from 1 to 65535. \(example)"
            }
            if !(parts.path.isEmpty || parts.path == "/") {
                return "Remove the path after the address. \(example)"
            }
        }
        return "Enter the server's address, like https://deck.example.com:10443/."
    }
}

/// What saving an address does, decided once from the saved decks and Pro, so the button, the note under it and
/// the confirmation all say the same thing. Mirrors the rules in `DeckModel.saveConnection`.
enum AddDeckMode: Equatable {
    /// No deck yet.
    case connect
    /// Pro: the address joins the list.
    case add
    /// Free with one deck: the address takes its place.
    case replace(URL)
    /// Free with several saved decks, after Pro lapsed: nothing can be added until Pro is back.
    case locked

    static let helper = "Your deck server's web address, which starts with https://, or the whole deck link with its token. The app saves the address, never the token."

    init(connections: [URL], selected: URL?, isPro: Bool) {
        if connections.isEmpty {
            self = .connect
        } else if isPro {
            self = .add
        } else if connections.count == 1, let current = selected ?? connections.first {
            self = .replace(current)
        } else {
            self = .locked
        }
    }

    var screenTitle: String {
        switch self {
        case .connect: "Connect"
        case .add, .locked: "Add Deck"
        case .replace: "Replace Deck"
        }
    }

    var actionTitle: String {
        switch self {
        case .connect: "Connect"
        case .add, .locked: "Add deck"
        case .replace: "Replace deck"
        }
    }

    var acceptsAddress: Bool { self != .locked }

    var replaces: Bool {
        if case .replace = self { return true }
        return false
    }

    /// Pro is the way past both limits, so the add screen offers it right there.
    var offersPro: Bool {
        switch self {
        case .replace, .locked: true
        case .connect, .add: false
        }
    }

    /// One sentence under the address field when saving does more than add.
    var note: String? {
        switch self {
        case .connect, .add:
            nil
        case .replace(let current):
            "Free includes one deck, so this replaces \(SavedDeckRowText.title(for: current)). Pro keeps both."
        case .locked:
            "Your other decks are locked. Restore Pro to add or switch decks."
        }
    }

    /// Replacing signs this device out of the current deck, so it asks first. An address that is already saved
    /// only reopens that deck and replaces nothing.
    func confirmsReplacement(of input: String, saved: [URL]) -> Bool {
        guard replaces, let origin = DeckConfig.splitDeckLink(input)?.origin else { return false }
        return !saved.contains(origin)
    }

    var confirmationMessage: String {
        guard case .replace(let current) = self else { return "" }
        return "This signs this device out of \(SavedDeckRowText.title(for: current)) and forgets its address."
    }
}

/// One replace confirmation. A List row that owns its own `.alert` presents that alert twice.
enum ReplaceDeckPrompt: Equatable {
    case idle
    case asking
    case confirmed
}

#if canImport(SwiftUI)
/// The server address field and its save action. First run, the Decks sheet's add screen and the demo's Connect
/// sheet share it, so the accessibility identifiers (`connection.origin`, `.clear`, `.save`, `.error`) have one home.
/// The parent owns the focus so it can put the cursor here from Command N or move it away from a keyboard Done.
struct AddressEntry: View {
    @EnvironmentObject var deck: DeckModel
    @EnvironmentObject var pro: ProEntitlement
    var focus: FocusState<Bool>.Binding
    /// Saves the typed address. Nil uses `DeckModel.saveConnection`; the demo leaves itself first.
    var save: ((DeckModel, String, Bool) -> String?)? = nil
    /// Called after the address was saved, so a sheet can close itself.
    var onSaved: () -> Void = {}
    /// Parents that present the replace alert pass a binding. This view never presents the alert itself:
    /// a second `.alert` here plus Add deck produced two `connection.replace.confirm` buttons.
    var replacePrompt: Binding<ReplaceDeckPrompt>? = nil
    /// List parents that already publish `mode.note` as their own row pass false so `connection.note` stays unique.
    var showsNote: Bool = true
    @State private var address = ""
    @State private var error: String?
    @State private var localReplacePrompt = ReplaceDeckPrompt.idle
    @State private var savedTick = 0
    @State private var errorTick = 0

    private var prompt: Binding<ReplaceDeckPrompt> { replacePrompt ?? $localReplacePrompt }

    private var mode: AddDeckMode {
        AddDeckMode(connections: deck.connections, selected: deck.selectedOrigin, isPro: pro.isPro)
    }

    private var isBlank: Bool { address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + DeckSpace.xs) {
            Text("Server address")
                .font(DeckType.captionStrong)
                .foregroundStyle(DeckColors.dim)
                .accessibilityHidden(true)
            HStack {
                TextField("Example: https://deck.example.com:10443/", text: $address)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                    .textContentType(.URL)
                    .submitLabel(.go)
                    .focused(focus)
                    .onSubmit(submit)
                    .foregroundStyle(DeckColors.fg)
                    .accessibilityLabel("Server address")
                    .accessibilityHint("Enter the HTTPS address of your deck server.")
                    .accessibilityIdentifier("connection.origin")
                if !address.isEmpty {
                    Button {
                        address = ""
                        error = nil
                        focus.wrappedValue = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(DeckColors.faint)
                            .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap)
                            .contentShape(.rect)
                    }
                    // Inside a List row an automatic-style Button fires when any part of the row is tapped.
                    // Borderless keeps the tap on the 44 pt glyph.
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear address")
                    .accessibilityIdentifier("connection.clear")
                }
            }
            .padding(.leading, DeckSpace.m)
            .frame(minHeight: DeckSpace.control)
            .background(DeckColors.bg, in: .rect(cornerRadius: DeckStyle.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius)
                .strokeBorder(focus.wrappedValue ? DeckColors.signal : DeckColors.fieldEdge, lineWidth: 1))

            Text(AddDeckMode.helper)
                .font(DeckType.caption)
                .foregroundStyle(DeckColors.faint)
                .fixedSize(horizontal: false, vertical: true)


            if let error {
                HStack(alignment: .firstTextBaseline, spacing: DeckSpace.s) {
                    Image(systemName: "exclamationmark.circle").accessibilityHidden(true)
                    Text(error)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("connection.error")
                }
                .font(DeckType.caption)
                .foregroundStyle(DeckColors.bad)
            }
            if showsNote, let note = mode.note {
                Text(note)
                    .font(DeckType.caption)
                    .foregroundStyle(DeckColors.dim)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("connection.note")
            }

            Button(mode.actionTitle, action: submit)
                .buttonStyle(DeckSecondaryButtonStyle())
                .disabled(isBlank)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("connection.save")
        }
        // List rows flatten static children into the row. `.contain` keeps `connection.note` its own element.
        .accessibilityElement(children: .contain)
        // Typing a correction removes the error it was fixing.
        .onChange(of: address) { _, _ in error = nil }
        .onChange(of: prompt.wrappedValue, handleReplacePrompt)
        .sensoryFeedback(.success, trigger: savedTick)
        .sensoryFeedback(.error, trigger: errorTick)
    }

    private func submit() {
        guard !isBlank else { return }
        // Format problems are checked first so a malformed address saves nothing and gets a specific next step.
        if let problem = AddressEntryCopy.problem(address) {
            fail(problem)
            return
        }
        if mode.confirmsReplacement(of: address, saved: deck.connections) {
            focus.wrappedValue = false
            prompt.wrappedValue = .asking
            return
        }
        commit()
    }

    private func handleReplacePrompt(_ old: ReplaceDeckPrompt, _ new: ReplaceDeckPrompt) {
        switch (old, new) {
        case (_, .confirmed):
            prompt.wrappedValue = .idle
            commit()
        case (.asking, .idle):
            focus.wrappedValue = true
        case (.idle, .asking), (.idle, .idle), (.asking, .asking), (.confirmed, .idle), (.confirmed, .asking):
            break
        }
    }

    private func commit() {
        let notice: String?
        if let save {
            notice = save(deck, address, mode.replaces)
        } else {
            notice = deck.saveConnection(address, replacing: mode.replaces)
        }
        if let notice {
            fail(notice)
        } else {
            savedTick += 1
            address = ""
            error = nil
            focus.wrappedValue = false
            AccessibilityNotification.Announcement("Address saved. Connecting.").post()
            onSaved()
        }
    }

    /// The cursor stays in the field, so the correction can be typed straight away.
    private func fail(_ message: String) {
        error = message
        errorTick += 1
        focus.wrappedValue = true
        AccessibilityNotification.Announcement(message).post()
    }
}

extension View {
    /// Present the replace confirmation once, on a NavigationStack or non-List screen. A List-owned or
    /// row-owned `.alert` is presented twice, so Free sees two `connection.replace.confirm` buttons.
    @ViewBuilder
    func replaceDeckAlert(prompt: Binding<ReplaceDeckPrompt>, message: String, enabled: Bool = true) -> some View {
        if enabled {
            alert("Replace deck?", isPresented: Binding(
                get: { prompt.wrappedValue == .asking },
                set: { if !$0, prompt.wrappedValue == .asking { prompt.wrappedValue = .idle } }
            )) {
                Button("Replace deck", role: .destructive) { prompt.wrappedValue = .confirmed }
                    .accessibilityIdentifier("connection.replace.confirm")
                Button("Keep current deck", role: .cancel) {}
                    .accessibilityIdentifier("connection.replace.keep")
            } message: {
                Text(message)
            }
        } else {
            self
        }
    }
}
#endif
