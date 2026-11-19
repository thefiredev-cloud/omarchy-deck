import Foundation
#if canImport(SwiftUI)
import SwiftUI
#endif

/// Row wording for one saved deck. Foundation only, so the Linux harness can test it without SwiftUI.
enum SavedDeckRowText {
    static let lockedHint = "Restore Pro to switch decks."

    /// The host, with the port when one is set, so two decks on one host stay apart on screen.
    static func title(for origin: URL) -> String {
        guard let host = origin.host else { return origin.absoluteString }
        let displayHost = host.contains(":") ? "[\(host)]" : host
        guard let port = origin.port else { return displayHost }
        return "\(displayHost):\(port)"
    }

    /// VoiceOver hears the full address, port included, then the state. Selected wins over locked.
    static func spokenLabel(for origin: URL, isSelected: Bool, isLocked: Bool) -> String {
        let address = origin.absoluteString
        if isSelected { return "\(address), current deck" }
        if isLocked { return "\(address), locked" }
        return address
    }

    /// The reason a locked row cannot switch, read as the row's hint.
    static func hint(isLocked: Bool) -> String {
        isLocked ? lockedHint : ""
    }
}

#if canImport(SwiftUI)

/// Screens pushed inside the Decks sheet.
enum DecksRoute: Hashable {
    case addDeck
}

/// First run shows the branded `FirstRunView`. Later, the same type is the Decks sheet: saved decks, a row that opens
/// the add screen, Pro, and About with Privacy and Support.
struct ConnectionsView: View {
    @EnvironmentObject var deck: DeckModel
    @EnvironmentObject var pro: ProEntitlement
    @Environment(\.dismiss) private var dismiss
    @State private var lockedOrigin: URL?
    @State private var pendingRemoval: URL?
    @State private var inspectedOrigin: URL?
    @State private var path: [DecksRoute]
    @State private var query = ""
    @State private var searching = false
    @State private var confirmingSignOut = false
    let firstRun: Bool
    /// Opens one of the native Feeds sections (`DeckFeedSection`). Nil on first run.
    let onOpenFeeds: ((DeckFeedSection) -> Void)?

    /// `startsAdding` opens the sheet straight on the add screen, for Command N on the deck screen.
    init(firstRun: Bool, startsAdding: Bool = false, onOpenFeeds: ((DeckFeedSection) -> Void)? = nil) {
        self.firstRun = firstRun
        self.onOpenFeeds = onOpenFeeds
        _path = State(initialValue: startsAdding ? [.addDeck] : [])
    }

    var body: some View {
        Group {
            if firstRun {
                FirstRunView()
            } else {
                sheet
            }
        }
        .tint(DeckColors.signal)
        .preferredColorScheme(.dark)
        // `.contain` keeps every child's own identifier. A bare identifier on the container overwrites them
        // (the two-column first run lost `demo.try` to it).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.connections")
    }

    private var mode: AddDeckMode {
        AddDeckMode(connections: deck.connections, selected: deck.selectedOrigin, isPro: pro.isPro)
    }

    private var offersSearch: Bool { DeckListSearch.isOffered(deckCount: deck.connections.count) }

    private var shownDecks: [URL] {
        offersSearch ? DeckListSearch.filter(deck.connections, query: query) : deck.connections
    }

    private var sheet: some View {
        NavigationStack(path: $path) {
            List {
                // The four native sections first: one tap on Decks, one on a tile. They read the selected deck only.
                if deck.selectedOrigin != nil, let onOpenFeeds {
                    Section {
                        FeedTiles(open: onOpenFeeds)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    } header: { Text("Your feeds") } footer: {
                        Text("Lists your deck gathers for you. Each shows when it was updated, and cards name their source when the deck provides one.")
                    }
                }
                // An empty section would still draw its header over a blank box.
                if !deck.connections.isEmpty {
                    Section {
                        ForEach(shownDecks, id: \.absoluteString) { origin in
                            row(origin)
                            if DeckModel.showsLockNotice(tapped: lockedOrigin, row: origin,
                                                         selected: deck.selectedOrigin, isPro: pro.isPro) {
                                Text(SavedDeckRowText.lockedHint)
                                    .font(DeckType.caption)
                                    .foregroundStyle(DeckColors.bad)
                                    .listRowBackground(DeckColors.panel)
                                    .accessibilityIdentifier("connection.lock")
                            }
                        }
                    } header: { Text("Saved decks") }
                }

                Section {
                    NavigationLink(value: DecksRoute.addDeck) {
                        Label(mode.actionTitle, systemImage: "plus.circle")
                            .foregroundStyle(DeckColors.fg)
                    }
                    .listRowBackground(DeckColors.panel)
                    .accessibilityIdentifier("connection.add")
                }

                // The two-finger double tap still reloads, but no screen ever named it (Guideline 5.6).
                // A visible row makes the same action reachable and discoverable.
                if deck.selectedOrigin != nil {
                    Section {
                        Button {
                            deck.reload()
                            dismiss()
                        } label: {
                            Label("Reload deck", systemImage: "arrow.clockwise")
                                .foregroundStyle(DeckColors.fg)
                        }
                        .listRowBackground(DeckColors.panel)
                        .accessibilityIdentifier("connection.reload")
                        .accessibilityHint("Reloads the deck on screen. Double tap with two fingers does the same.")
                        // Owner or guest, from the deck's own answer (I10). Unknown until the deck has shown once.
                        if let role = deck.role {
                            Label(role.signedInLabel, systemImage: role == .owner ? "person.crop.circle.badge.checkmark"
                                                                                  : "person.crop.circle")
                                .foregroundStyle(DeckColors.dim)
                                .listRowBackground(DeckColors.panel)
                                .accessibilityIdentifier("connection.role")
                        }
                        // Signing out keeps the address, so a guest device can paste the owner's token next.
                        Button(role: .destructive) {
                            confirmingSignOut = true
                        } label: {
                            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                        .listRowBackground(DeckColors.panel)
                        .accessibilityIdentifier("connection.signout")
                        .accessibilityHint("Signs this device out of the deck on screen and keeps its address.")
                    } header: {
                        Text("This deck")
                    }
                }

                Section {
                    ProCard()
                        .listRowBackground(DeckColors.panel)
                } header: { Text("Pro") }

                Section {
                    if let privacy = DeckLinks.privacy {
                        Link(destination: privacy) {
                            Label("Privacy", systemImage: "hand.raised")
                        }
                        .listRowBackground(DeckColors.panel)
                        .accessibilityIdentifier("link.privacy")
                    }
                    if let support = DeckLinks.support {
                        Link(destination: support) {
                            Label("Support", systemImage: "lifepreserver")
                        }
                        .listRowBackground(DeckColors.panel)
                        .accessibilityIdentifier("link.support")
                    }
                } header: {
                    Text("About")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(AppVersion.current)
                            .accessibilityIdentifier("deck.about.version")
                        Text(AppCopyright.notice)
                            .accessibilityIdentifier("deck.about.copyright")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(DeckColors.bg)
            .deckSearch(offered: offersSearch, text: $query, isPresented: $searching)
            .navigationTitle("Decks")
            .navigationDestination(for: DecksRoute.self) { route in
                switch route {
                case .addDeck: AddDeckScreen { dismiss() }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                        .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap)
                        .contentShape(Rectangle())
                }
            }
            .background {
                KeyboardShortcutButton(title: "Add Deck", key: "n") { path = [.addDeck] }
                if offersSearch {
                    KeyboardShortcutButton(title: "Search Decks", key: "f") { searching = true }
                }
            }
            // An alert, not a confirmation dialog: inside a sheet the dialog opens as a popover with no visible Cancel.
            .alert("Remove this deck?", isPresented: removalBinding, presenting: pendingRemoval) { origin in
                Button("Remove deck", role: .destructive) { deck.removeConnection(origin) }
                    .accessibilityIdentifier("connection.remove.confirm")
                Button("Keep deck", role: .cancel) {}
            } message: { origin in
                Text("This signs this device out of \(origin.host ?? origin.absoluteString) and forgets its address. Your other decks stay as they are.")
            }
            .alert("Sign out of this deck?", isPresented: $confirmingSignOut) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await deck.signOut() }
                }
                .accessibilityIdentifier("connection.signout.confirm")
                Button("Stay signed in", role: .cancel) {}
            } message: {
                Text("The deck's address stays saved. Sign in again with a deck token or a deck link.")
            }
            .alert("Server address", isPresented: inspectionBinding, presenting: inspectedOrigin) { _ in
                Button("Done", role: .cancel) {}
            } message: { origin in
                Text(origin.absoluteString)
            }
        }
    }

    private var removalBinding: Binding<Bool> {
        Binding(get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } })
    }

    private var inspectionBinding: Binding<Bool> {
        Binding(get: { inspectedOrigin != nil }, set: { if !$0 { inspectedOrigin = nil } })
    }

    /// Tap and Haptic Touch share the same guarded action, with exactly one feedback dispatch.
    private func activate(_ origin: URL) {
        if DeckModel.mayActivate(origin, selected: deck.selectedOrigin, isPro: pro.isPro) {
            deck.haptics.handle(body: ["style": "selection"])
            deck.select(origin)
            dismiss()
        } else {
            deck.haptics.handle(body: ["style": "warning"])
            lockedOrigin = origin
        }
    }

    /// Shows the full address in an alert, with the same selection haptic as the other row taps.
    private func inspect(_ origin: URL) {
        deck.haptics.handle(body: ["style": "selection"])
        inspectedOrigin = origin
    }

    /// The row names the deck by host and port. The full address is one Haptic Touch away and is what VoiceOver reads.
    private func row(_ origin: URL) -> some View {
        let isSelected = origin == deck.selectedOrigin
        let isLocked = !DeckModel.mayActivate(origin, selected: deck.selectedOrigin, isPro: pro.isPro)
        return Button { activate(origin) } label: {
            HStack(spacing: DeckSpace.m) {
                Text(SavedDeckRowText.title(for: origin))
                    .foregroundStyle(DeckColors.fg)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isSelected {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(DeckColors.signal).accessibilityHidden(true)
                } else if !pro.isPro {
                    Image(systemName: "lock.fill").foregroundStyle(DeckColors.faint).accessibilityHidden(true)
                }
            }
            .frame(minHeight: DeckSpace.minTap)
            .contentShape(.rect)
        }
        .listRowBackground(DeckColors.panel)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // Removing a deck also signs this device out of it, so it asks first.
            Button("Delete", role: .destructive) { pendingRemoval = origin }
        }
        .contextMenu {
            Button("Open deck", systemImage: "rectangle.stack") { activate(origin) }
                .disabled(isLocked)
            Button("Show server address", systemImage: "network") { inspect(origin) }
            Divider()
            Button("Remove deck", systemImage: "trash", role: .destructive) { pendingRemoval = origin }
        }
        // The same actions reach VoiceOver without a swipe or long press. Removal still asks first.
        .accessibilityActions {
            // A locked row cannot open, so the rotor offers only what the row can do. Activating it still shows the lock reason.
            if !isLocked {
                Button("Open deck") { activate(origin) }
            }
            Button("Show server address") { inspect(origin) }
            Button("Remove deck") { pendingRemoval = origin }
        }
        .accessibilityIdentifier("connection.\(origin.absoluteString)")
        .accessibilityLabel(SavedDeckRowText.spokenLabel(for: origin, isSelected: isSelected, isLocked: isLocked))
        .accessibilityHint(SavedDeckRowText.hint(isLocked: isLocked))
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

/// The nine feed sections as tiles: two across on a phone, four across on a wide sheet.
private struct FeedTiles: View {
    let open: (DeckFeedSection) -> Void
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let wanted = width == .regular ? 4 : 2
        let columns = Array(repeating: GridItem(.flexible(), spacing: DeckSpace.s + 4),
                            count: DeckLayout.tileColumns(wanted: wanted, accessibilityText: typeSize.isAccessibilitySize))
        LazyVGrid(columns: columns, spacing: DeckSpace.s + 4) {
            ForEach(DeckFeedSection.allCases) { section in
                Button { open(section) } label: {
                    VStack(alignment: .leading, spacing: DeckSpace.s) {
                        Image(systemName: section.symbol)
                            .font(.system(.title3, weight: .regular))
                            .foregroundStyle(DeckColors.signal)
                            .accessibilityHidden(true)
                        Text(section.title)
                            .deckFont(.body, weight: 600)
                            .foregroundStyle(DeckColors.fg)
                    }
                    .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
                    .padding(DeckSpace.m - 2)
                    .background(DeckColors.panel, in: RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous)
                        .strokeBorder(DeckColors.line, lineWidth: 1))
                    .contentShape(RoundedRectangle(cornerRadius: DeckStyle.cardRadius))
                }
                .buttonStyle(FeedTilePressStyle())
                .accessibilityLabel(section.title)
                .accessibilityHint(section.tagline)
                .accessibilityIdentifier("feeds.open.\(section.rawValue)")
            }
        }
    }
}

private struct FeedTilePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// The one place a deck is added from the Decks sheet. It opens with the cursor in the address field, and the
/// button, the note under it and Pro all follow `AddDeckMode`, so a Free customer sees "Replace deck" before typing
/// instead of an error after.
private struct AddDeckScreen: View {
    @EnvironmentObject var deck: DeckModel
    @EnvironmentObject var pro: ProEntitlement
    @FocusState private var focused: Bool
    /// Owned here, on the pushed screen. The Decks stack, first run, and AddressEntry must not
    /// present this alert: a second `.alert` plus this one produced two `connection.replace.confirm` buttons.
    @State private var replacePrompt = ReplaceDeckPrompt.idle
    let close: () -> Void

    private var mode: AddDeckMode {
        AddDeckMode(connections: deck.connections, selected: deck.selectedOrigin, isPro: pro.isPro)
    }

    var body: some View {
        // Topmost Add deck screen only, on a ZStack, never on this List or the Decks stack.
        // A List-owned or stack-owned `.alert` is presented twice once this destination is showing.
        ZStack {
            form
        }
        .replaceDeckAlert(prompt: $replacePrompt, message: mode.confirmationMessage)
    }

    private var form: some View {
        List {
            // Own row so VoiceOver and XCTest see `connection.note` before anything is typed. Inside AddressEntry
            // a List row swallows that static text, so Free would only learn it replaces after an error.
            if let note = mode.note {
                Section {
                    Text(note)
                        .font(mode.acceptsAddress ? DeckType.caption : DeckType.body)
                        .foregroundStyle(DeckColors.dim)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("connection.note")
                }
                .listRowBackground(DeckColors.panel)
            }
            if mode.acceptsAddress {
                Section {
                    AddressEntry(focus: $focused, onSaved: close, replacePrompt: $replacePrompt, showsNote: false)
                }
                .listRowBackground(DeckColors.panel)
            }

            if mode.offersPro {
                Section {
                    ProCard()
                        .listRowBackground(DeckColors.panel)
                } header: { Text("Pro") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(DeckColors.bg)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(mode.screenTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done", action: close)
                    .keyboardShortcut(.cancelAction)
                    .frame(minWidth: DeckSpace.minTap, minHeight: DeckSpace.minTap)
                    .contentShape(Rectangle())
            }
        }
        .deckKeyboardDoneButton { focused = false }
        .task {
            // Focus set while the push is still animating is dropped, so wait for it to settle.
            try? await Task.sleep(for: .milliseconds(400))
            if mode.acceptsAddress { focused = true }
        }
    }
}

private extension View {
    /// The search field only appears once the list is long enough to need one. Command F opens it.
    @ViewBuilder
    func deckSearch(offered: Bool, text: Binding<String>, isPresented: Binding<Bool>) -> some View {
        if offered {
            searchable(text: text, isPresented: isPresented, prompt: "Search decks")
        } else {
            self
        }
    }
}
#endif
