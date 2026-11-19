import Charts
import SwiftUI

/// Shared pieces of the Housing and Commercial screens, on the token ramp and the Geist scale. They draw only what the
/// feed carried: an unknown value reads the missing mark (spoken "No data"), never zero. No source text: provenance
/// lives in the Data sheet.

/// A titled panel. The title is a heading for VoiceOver's rotor.
struct RealEstateBlock<Content: View>: View {
    let title: String
    var trailing: String?
    let identifier: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.s + 4) {
            HStack(alignment: .firstTextBaseline, spacing: DeckSpace.s) {
                Text(title)
                    .deckFont(.heading)
                    .foregroundStyle(FeedPalette.text1)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if let trailing {
                    Text(trailing)
                        .deckFont(.data)
                        .foregroundStyle(FeedPalette.text2)
                        .multilineTextAlignment(.trailing)
                }
            }
            content
        }
        .feedPanel()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

/// One line of data: a name and facts on the left, one figure on the right. At accessibility text sizes the figure
/// drops under the name so neither is cut off.
struct RealEstateRow: View {
    let title: String
    var subtitle: String?
    var detail: String?
    var value: String?
    var valueCaption: String?
    /// The caption is words ("median price", "Open"), set in the text face: only figures are mono and tabular.
    var captionIsWords = false
    var link: URL?
    var identifier: String
    var open: ((URL) -> Void)?
    var select: (() -> Void)?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if let select {
                Button(action: select) { tappableFace }
                    .buttonStyle(FeedCardPressStyle())
            } else if let link, let open {
                Button { open(link) } label: { tappableFace }
                    .buttonStyle(FeedCardPressStyle())
                    .accessibilityHint("Opens the listing in Safari")
            } else {
                face
            }
        }
        .accessibilityIdentifier(identifier)
    }

    /// A one-line title with no subtitle is about 32 pt tall; the frame and hit shape sit inside the label so the
    /// whole 44 pt row takes the tap (a frame outside a plain Button adds no hit area).
    private var tappableFace: some View {
        face
            .frame(minHeight: DeckSpace.minTap, alignment: .topLeading)
            .contentShape(Rectangle())
    }

    private var face: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: DeckSpace.xs))
                                                  : AnyLayout(HStackLayout(alignment: .top, spacing: DeckSpace.s + 4))
        return layout {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .deckFont(.body, weight: 500)
                    .foregroundStyle(FeedPalette.text1)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle {
                    Text(subtitle)
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let detail {
                    Text(detail)
                        .deckFont(.meta)
                        .foregroundStyle(FeedPalette.text3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
            if value != nil || valueCaption != nil {
                VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 3) {
                    if let value {
                        Text(value)
                            .deckFont(.figureRow)
                            .foregroundStyle(value == DeckMissing.cell ? FeedPalette.text3 : FeedPalette.text1)
                            .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                            .minimumScaleFactor(typeSize.isAccessibilitySize ? 1 : 0.7)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel(value == DeckMissing.cell ? DeckMissing.sheet : value)
                    }
                    if let valueCaption {
                        Text(valueCaption)
                            .deckFont(captionIsWords ? .meta : .data)
                            .foregroundStyle(FeedPalette.text2)
                            .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .trailing)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, DeckSpace.xs + 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Lays children left to right and wraps to the next line, so chips never scroll sideways out of reach.
struct RealEstateFlow: Layout {
    var spacing: CGFloat = DeckSpace.s

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (CGSize(width: widest, height: y + rowHeight), points)
    }
}

/// A horizontal bar chart with one spoken sentence, so the picture has a text twin. Estimates draw hollow.
struct RealEstateBarChart: View {
    let title: String
    let bars: [CommercialBar]
    let format: (Double) -> String
    var identifier: String
    /// One bar and its axis label. Fixed 34 pt crowded the labels once Dynamic Type grew the axis text.
    @ScaledMetric(relativeTo: .caption) private var barPitch: CGFloat = 34

    var body: some View {
        VStack(alignment: .leading, spacing: DeckSpace.xs) {
            Text(title)
                .deckFont(.body, weight: 600)
                .foregroundStyle(FeedPalette.text1)
                .accessibilityAddTraits(.isHeader)
            if bars.isEmpty {
                Text("Not enough listings to draw this.")
                    .deckFont(.meta)
                    .foregroundStyle(FeedPalette.text3)
            } else {
                Chart(bars) { bar in
                    BarMark(x: .value("Value", bar.value), y: .value("Group", bar.label))
                        .foregroundStyle(bar.isEstimate ? FeedPalette.text3 : FeedPalette.text1.opacity(0.85))
                        .cornerRadius(2)
                        .annotation(position: .trailing, alignment: .leading, spacing: 4) {
                            Text(format(bar.value))
                                .deckFont(.data)
                                .foregroundStyle(FeedPalette.text2)
                        }
                }
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks { value in
                        AxisValueLabel {
                            if let label = value.as(String.self) {
                                Text(label)
                                    .deckFont(.micro, weight: 400)
                                    .foregroundStyle(FeedPalette.text2)
                            }
                        }
                    }
                }
                .chartXScale(range: .plotDimension(padding: 56))
                .frame(height: CGFloat(bars.count) * barPitch + 8)
                .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title + ": " + (bars.isEmpty ? "not enough listings"
                                            : bars.map { "\($0.label) \(format($0.value))" }.joined(separator: ", ")))
        .accessibilityIdentifier(identifier)
    }
}
