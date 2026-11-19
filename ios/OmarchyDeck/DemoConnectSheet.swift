import SwiftUI

/// The demo's way out. The address field is right here, so connecting is one step: saving the address leaves the
/// demo and opens the deck. Purchase, Restore, price loading and the legal links are the same components as first run.
struct DemoConnectSheet: View {
    let onConnect: () -> Void
    @EnvironmentObject var deck: DeckModel
    @EnvironmentObject var pro: ProEntitlement
    @Environment(\.dismiss) private var dismiss
    @FocusState private var addressFocused: Bool
    @State private var replacePrompt = ReplaceDeckPrompt.idle

    private var mode: AddDeckMode {
        AddDeckMode(connections: deck.connections, selected: deck.selectedOrigin, isPro: pro.isPro)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Connect your deck")
                            .font(DemoType.display)
                            .foregroundStyle(DemoPalette.text1)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text("You are looking at sample data. Enter your deck server's address to see your own day, cameras and links. The app asks for your deck token next.")
                            .font(DemoType.body)
                            .foregroundStyle(DemoPalette.text2)
                            .fixedSize(horizontal: false, vertical: true)
                        AddressEntry(focus: $addressFocused,
                                     save: { deck, input, replacing in
                                         deck.saveConnectionLeavingDemo(input, replacing: replacing)
                                     },
                                     onSaved: { dismiss() },
                                     replacePrompt: $replacePrompt)
                    }
                    .padding(.vertical, 6)
                    Button("Leave the demo", action: onConnect)
                        .buttonStyle(DeckQuietButtonStyle())
                        .accessibilityHint("Goes back to the first screen without saving an address.")
                        .accessibilityIdentifier("demo.connect")
                }
                .listRowBackground(DemoPalette.raised)

                Section {
                    ProCard()
                        .padding(.vertical, 6)
                }
                .listRowBackground(DemoPalette.raised)

                Section {
                    DeckLegalLinks()
                } header: {
                    DemoSectionHeader("About")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        DemoSectionFooter(AppVersion.current)
                        DemoSectionFooter(AppCopyright.notice)
                            .accessibilityIdentifier("deck.about.copyright")
                    }
                }
                .listRowBackground(DemoPalette.raised)
            }
            .demoList()
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Connect")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("demo.connect.close")
                }
            }
            .deckKeyboardDoneButton { addressFocused = false }
        }
        .replaceDeckAlert(prompt: $replacePrompt, message: mode.confirmationMessage)
        .tint(DemoPalette.tint)
        .presentationBackground(DemoPalette.bg)
        .preferredColorScheme(.dark)
    }
}
