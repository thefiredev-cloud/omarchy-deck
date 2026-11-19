import SwiftUI

@main
struct OmarchyDeckWatchApp: App {
    @StateObject private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            WatchActionsView(model: model)
                .preferredColorScheme(.dark)
        }
    }
}

/// The deck's tokens v3 (`DeckTokens` on the phone): the signal accent #FF6B1A, carbon #0A0B0D for text on it.
/// The watch keeps the system font: Geist ships in the phone app only.
enum WatchTheme {
    static let tint = Color(red: 0xff / 255, green: 0x6b / 255, blue: 0x1a / 255)
    static let onTint = Color(red: 0x0a / 255, green: 0x0b / 255, blue: 0x0d / 255)
}

struct WatchActionsView: View {
    @ObservedObject var model: WatchModel
    @State private var confirming: WatchAction?
    /// Grows with the glyph (default body size), so it does not crowd the label at larger watch text sizes.
    @ScaledMetric(relativeTo: .body) private var glyphColumn: CGFloat = 24

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    // The result of the last tap sits above the list, where the eye already is.
                    Text(model.status.line)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(statusColor)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("action.feedback")
                        .accessibilityAddTraits(.updatesFrequently)
                    ForEach(model.actions) { action in
                        Button {
                            confirming = action
                        } label: {
                            HStack {
                                Image(systemName: symbol(for: action.id))
                                    .frame(width: glyphColumn)
                                    .accessibilityHidden(true)
                                Text(action.label)
                                    .font(.subheadline.weight(.semibold))
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 44)
                            .foregroundStyle(WatchTheme.onTint)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(WatchTheme.tint)
                        .disabled(model.status.isSending)
                        .accessibilityIdentifier("action.\(action.id)")
                        .accessibilityHint("Confirms before running.")
                    }
                    if model.actions.isEmpty {
                        Text("Open Omarchy Deck on your iPhone to load these actions.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)
            }
            .navigationTitle("Deck")
        }
        .onAppear { model.refresh() }
        .confirmationDialog("\(confirming?.label ?? "This action")?", isPresented: Binding(
            get: { confirming != nil },
            set: { if !$0 { confirming = nil } }
        )) {
            if let action = confirming {
                Button(action.label) {
                    confirming = nil
                    model.run(action.id)
                }
            }
            Button("Cancel", role: .cancel) { confirming = nil }
        } message: {
            Text("This changes your desktop through your iPhone.")
        }
    }

    /// Idle guidance stays quiet; a result or a problem reads in full contrast.
    private var statusColor: Color {
        switch model.status {
        case .idle, .sending: .secondary
        case .done: WatchTheme.tint
        case .phoneUnreachable, .deckOffline, .failed: .primary
        }
    }

    private func symbol(for id: String) -> String {
        switch id {
        case "play-pause": "playpause.fill"
        case "mute": "speaker.slash.fill"
        case "lock": "lock.fill"
        default: "rectangle.on.rectangle"
        }
    }
}
