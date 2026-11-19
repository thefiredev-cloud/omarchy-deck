import SwiftUI

// MARK: - Today

struct DemoTodayPage: View {
    @Bindable var sample: DemoDeck
    let onConnect: () -> Void
    @Environment(\.demoDetailWidth) private var detailWidth
    @Environment(\.dynamicTypeSize) private var typeSize
    /// The glyph column grows with the glyph, so a large text size does not push it over the row's text.
    @ScaledMetric(relativeTo: .title2) private var glyphColumn: CGFloat = 36

    var body: some View {
        Group {
            if DeckLayout.demoUsesTwoColumns(detailWidth: detailWidth) {
                HStack(alignment: .top, spacing: 0) {
                    List { DemoPurposeSection(DemoWords.todayPurpose); weather; schedule; timer }.demoList()
                    List { desktop; cameras }.demoList()
                }
            } else {
                List { DemoPurposeSection(DemoWords.todayPurpose); weather; schedule; timer; desktop; cameras }.demoList()
            }
        }
        .demoChrome(title: "Today", onConnect: onConnect)
    }

    private static func temperature(_ celsius: Double) -> String {
        Measurement(value: celsius, unit: UnitTemperature.celsius)
            .formatted(.measurement(width: .narrow, usage: .weather, numberFormatStyle: .number.precision(.fractionLength(0))))
    }

    private var weather: some View {
        Section {
            HStack(spacing: 14) {
                Image(systemName: "sun.max.fill")
                    .font(.title2)
                    .foregroundStyle(DemoPalette.tint)
                    .frame(width: glyphColumn)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Clear skies, \(Self.temperature(18))")
                        .font(DemoType.title)
                        .foregroundStyle(DemoPalette.text1)
                    Text("High \(Self.temperature(21)) · Low \(Self.temperature(11)) · Light wind")
                        .font(DemoType.meta)
                        .foregroundStyle(DemoPalette.text2)
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Example weather. Clear skies, \(Self.temperature(18)). High \(Self.temperature(21)). Low \(Self.temperature(11)). Light wind.")
            .accessibilityIdentifier("demo.today.weather")
        } header: {
            DemoSectionHeader("Weather")
        } footer: {
            DemoSectionFooter("Sample data. Connect your deck to see your own day.")
        }
        .listRowBackground(DemoPalette.raised)
    }

    private var schedule: some View {
        Section {
            ForEach(sample.events) { event in
                let reminded = sample.remindedEventIDs.contains(event.id)
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.title)
                            .font(DemoType.bodyStrong)
                            .foregroundStyle(DemoPalette.text1)
                        Text("\(event.start.formatted(date: .omitted, time: .shortened)) · \(event.start.formatted(.relative(presentation: .named)))")
                            .font(DemoType.meta)
                            .foregroundStyle(DemoPalette.text2)
                        Text(event.detail)
                            .font(DemoType.meta)
                            .foregroundStyle(DemoPalette.text3)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Example event: \(event.title), \(event.start.formatted(date: .omitted, time: .shortened)). \(event.detail)")
                    Spacer(minLength: 8)
                    Button { sample.toggleReminder(event) } label: {
                        Image(systemName: reminded ? "bell.fill" : "bell")
                            .foregroundStyle(reminded ? DemoPalette.tint : DemoPalette.text2)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remind me about \(event.title)")
                    .accessibilityValue(reminded ? "On" : "Off")
                    .accessibilityIdentifier("demo.event.\(event.id).remind")
                    .accessibilityHint(DemoWords.reminderHint)
                }
            }
        } header: {
            DemoSectionHeader("Next up")
        } footer: {
            DemoSectionFooter(DemoWords.scheduleFooter)
        }
        .listRowBackground(DemoPalette.raised)
    }

    private var timer: some View {
        Section {
            // The clock only ticks while the countdown runs, so an idle timer keeps the screen still.
            if sample.timerRunning {
                TimelineView(.periodic(from: .now, by: 0.5)) { context in
                    timerRow(now: context.date)
                }
            } else {
                timerRow(now: .now)
            }
        } header: {
            DemoSectionHeader("Timer")
        } footer: {
            DemoSectionFooter(DemoWords.timerFooter)
        }
        .listRowBackground(DemoPalette.raised)
    }

    private func timerRow(now: Date) -> some View {
        let remaining = sample.timerRemaining(at: now)
        let finished = sample.timerFinished(at: now)
        let done = finished || sample.timerDone
        let phase: DemoWords.TimerPhase = done ? .done : sample.timerRunning ? .running : .ready
        let titleRow = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
        let buttonRow = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(spacing: 12))
        return VStack(alignment: .leading, spacing: 12) {
            titleRow {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tea")
                        .font(DemoType.bodyStrong)
                        .foregroundStyle(DemoPalette.text1)
                    Text(DemoWords.timerStatus(phase))
                        .font(DemoType.meta)
                        .foregroundStyle(done ? DemoPalette.ok : DemoPalette.text2)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(DemoWords.timerSpoken(name: "Tea", phase: phase))
                if !typeSize.isAccessibilitySize { Spacer() }
                Text(DemoWords.clock(remaining))
                    .font(DemoType.display)
                    .monospacedDigit()
                    .foregroundStyle(DemoPalette.text1)
                    .accessibilityLabel(DemoWords.timerClockSpoken(remaining))
                    .accessibilityAddTraits(.updatesFrequently)
                    .accessibilityIdentifier("demo.timer.remaining")
            }
            buttonRow {
                Button {
                    sample.toggleTimer(now: now)
                    announce(sample.timerRunning ? .started : .paused, now: now)
                } label: {
                    Text(done ? "Restart" : sample.timerRunning ? "Pause" : "Start")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .foregroundStyle(DemoPalette.bg)
                .accessibilityHint(DemoWords.timerToggleHint(phase: phase, duration: sample.timerDuration))
                .accessibilityIdentifier("demo.timer.toggle")
                Button {
                    sample.resetTimer()
                    announce(.reset, now: now)
                } label: {
                    Text("Reset").frame(minWidth: 64, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityHint(DemoWords.timerResetHint(duration: sample.timerDuration))
                .accessibilityIdentifier("demo.timer.reset")
            }
        }
        .padding(.vertical, 4)
        .onChange(of: finished) { _, isFinished in
            guard isFinished else { return }
            sample.settleFinishedTimer(now: now)
            AccessibilityNotification.Announcement(DemoWords.timerAnnouncement(.finished, remaining: 0)).post()
        }
    }

    /// Says the new timer state aloud once, so a VoiceOver user hears Start, Pause and Reset take effect.
    private func announce(_ event: DemoWords.TimerEvent, now: Date) {
        AccessibilityNotification.Announcement(
            DemoWords.timerAnnouncement(event, remaining: sample.timerRemaining(at: now))
        ).post()
    }

    private var desktop: some View {
        Section {
            Button { sample.activeTab = .home } label: {
                VStack(alignment: .leading, spacing: 12) {
                    if DeckLayout.demoUsesTwoColumns(detailWidth: detailWidth) {
                        DemoDesktopFrame(pointer: sample.pointer, typedText: sample.sentMessages.last)
                            .demoExampleTag()
                    }
                    HStack(spacing: 14) {
                        Image(systemName: "desktopcomputer")
                            .font(.title2)
                            .foregroundStyle(DemoPalette.tint)
                            .frame(width: glyphColumn)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sample.desktopName)
                                .font(DemoType.bodyStrong)
                                .foregroundStyle(DemoPalette.text1)
                            HStack(spacing: 6) {
                                Circle().fill(DemoPalette.ok).frame(width: 8, height: 8).accessibilityHidden(true)
                                Text(DemoWords.desktopStatus(windows: 3))
                                    .font(DemoType.meta)
                                    .foregroundStyle(DemoPalette.text2)
                            }
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(DemoPalette.text3)
                            .accessibilityHidden(true)
                    }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DemoWords.desktopSpoken(name: sample.desktopName, windows: 3))
            .accessibilityHint(DemoWords.desktopHint)
            .accessibilityIdentifier("demo.desktop.open")
        } header: {
            DemoSectionHeader("Desktop")
        } footer: {
            DemoSectionFooter(DemoWords.desktopFooter)
        }
        .listRowBackground(DemoPalette.raised)
    }

    private var cameras: some View {
        Section {
            if let camera = sample.cameras.first {
                Button {
                    sample.activeTab = .home
                    sample.open(camera)
                } label: {
                    let wide = DeckLayout.demoUsesTwoColumns(detailWidth: detailWidth)
                    let layout = wide
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                        : AnyLayout(HStackLayout(spacing: 14))
                    layout {
                        DemoStill(scene: camera.scene, light: sample.light(for: camera))
                            .frame(maxWidth: wide ? .infinity : 96)
                            .demoExampleTag()
                            .clipShape(RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(camera.name)
                                .font(DemoType.bodyStrong)
                                .foregroundStyle(DemoPalette.text1)
                            Text(DemoWords.cameraCaption(updated: sample.updatedLabel(for: camera)))
                                .font(DemoType.meta)
                                .foregroundStyle(DemoPalette.text2)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(DemoPalette.text3)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(DemoWords.cameraSpoken(name: camera.name, updated: sample.updatedLabel(for: camera)))
                .accessibilityIdentifier("demo.today.camera")
            }
        } header: {
            DemoSectionHeader("Camera")
        } footer: {
            DemoSectionFooter(DemoWords.cameraFooter)
        }
        .listRowBackground(DemoPalette.raised)
    }
}

// MARK: - Home

struct DemoHomePage: View {
    @Bindable var sample: DemoDeck
    let onConnect: () -> Void
    @Environment(\.demoDetailWidth) private var detailWidth
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if DeckLayout.demoUsesTwoColumns(detailWidth: detailWidth) {
                HStack(alignment: .top, spacing: 0) {
                    List { DemoPurposeSection(DemoWords.homePurpose); camerasSection }.demoList()
                    List { desktopSection; roomsSection }.demoList()
                }
            } else {
                List { DemoPurposeSection(DemoWords.homePurpose); camerasSection; desktopSection; roomsSection }.demoList()
            }
        }
        .demoChrome(title: "Home", onConnect: onConnect)
        .sheet(item: $sample.selectedCamera) { camera in
            DemoCameraSheet(sample: sample, camera: camera)
        }
    }

    private var camerasSection: some View {
        Section {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16, alignment: .top), count: typeSize.isAccessibilitySize ? 1 : 2),
                      spacing: 16) {
                ForEach(sample.cameras) { camera in tile(camera) }
            }
            .padding(.vertical, 4)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } header: {
            DemoSectionHeader("Cameras")
        } footer: {
            DemoSectionFooter("Sample stills drawn on this device. Your deck shows snapshots from your own cameras.")
        }
    }

    private var desktopSection: some View {
        Section {
            DemoDesktopFrame(pointer: sample.pointer, typedText: sample.sentMessages.last)
                .demoExampleTag()
                .padding(.vertical, 4)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                .accessibilityIdentifier("demo.desktop.frame")
        } header: {
            DemoSectionHeader(sample.desktopName)
        } footer: {
            DemoSectionFooter("An illustrated desktop, not a connection to a computer. It follows the Pad tab.")
        }
    }

    private var roomsSection: some View {
        Section {
            ForEach(sample.switches) { item in
                let on = sample.isOn(item.id)
                Toggle(isOn: Binding(get: { sample.isOn(item.id) },
                                     set: { sample.setSwitch(item.id, on: $0) })) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(DemoType.body)
                                .foregroundStyle(DemoPalette.text1)
                            Text(on ? item.onDetail : item.offDetail)
                                .font(DemoType.meta)
                                .foregroundStyle(DemoPalette.text2)
                        }
                    } icon: {
                        Image(systemName: on ? item.onSymbol : item.offSymbol)
                            .foregroundStyle(on ? DemoPalette.tint : DemoPalette.text3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    // Tapping the label area must flip the switch. Setting the captured
                    // target (not a toggle of current value) keeps this idempotent when the
                    // Toggle itself also handles the same tap.
                    .onTapGesture { sample.setSwitch(item.id, on: !on) }
                }
                .frame(minHeight: 44)
                .accessibilityLabel("Example: \(item.title), \(on ? item.onDetail : item.offDetail)")
                .accessibilityHint(DemoWords.switchHint)
                .accessibilityIdentifier("demo.switch.\(item.id)")
            }
        } header: {
            DemoSectionHeader("Rooms")
        } footer: {
            DemoSectionFooter(DemoWords.roomsFooter)
        }
        .listRowBackground(DemoPalette.raised)
    }

    private func tile(_ camera: DemoDeck.Camera) -> some View {
        Button { sample.open(camera) } label: {
            VStack(alignment: .leading, spacing: 8) {
                DemoStill(scene: camera.scene, light: sample.light(for: camera))
                    .demoExampleTag()
                    .clipShape(RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous)
                        .strokeBorder(DemoPalette.line, lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    Text(camera.name)
                        .font(DemoType.bodyStrong)
                        .foregroundStyle(DemoPalette.text1)
                    Text(DemoWords.cameraCaption(updated: sample.updatedLabel(for: camera)))
                        .font(DemoType.meta)
                        .foregroundStyle(DemoPalette.text2)
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .contextMenu {
            Button("View sample still", systemImage: "camera") { sample.open(camera) }
            Button("Refresh sample still", systemImage: "arrow.clockwise") { sample.refreshSnapshot(camera) }
        }
        .buttonStyle(DemoPressStyle())
        .accessibilityLabel(DemoWords.cameraSpoken(name: camera.name, updated: sample.updatedLabel(for: camera)))
        .accessibilityIdentifier("demo.camera.\(camera.id)")
    }
}

struct DemoCameraSheet: View {
    @Bindable var sample: DemoDeck
    let camera: DemoDeck.Camera
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ZStack {
                        DemoStill(scene: camera.scene, light: sample.light(for: camera))
                            .id(sample.light(for: camera))
                            .transition(.opacity)
                    }
                    .animation(DemoMotion.animation(reduceMotion: reduceMotion), value: sample.light(for: camera))
                    .demoExampleTag()
                    .clipShape(RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Example camera view: \(camera.name), drawn on this device")
                    VStack(alignment: .leading, spacing: 4) {
                        Text(camera.name)
                            .font(DemoType.display)
                            .foregroundStyle(DemoPalette.text1)
                            .accessibilityIdentifier("demo.camera.title")
                            .accessibilityAddTraits(.isHeader)
                        Text(DemoWords.cameraCaption(place: camera.place, updated: sample.updatedLabel(for: camera)))
                            .font(DemoType.meta)
                            .foregroundStyle(DemoPalette.text2)
                    }
                    Button { sample.refreshSnapshot(camera) } label: {
                        Label(DemoWords.cameraRefreshTitle, systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .foregroundStyle(DemoPalette.bg)
                    .accessibilityIdentifier("demo.camera.refresh")
                    .accessibilityHint(DemoWords.cameraRefreshHint)
                    Text("A sample still drawn on this device. No camera or network is connected.")
                        .font(DemoType.meta)
                        .foregroundStyle(DemoPalette.text3)
                }
                .padding(16)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .background(DemoPalette.bg)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { DemoBadge() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("demo.camera.close")
                }
            }
        }
        .tint(DemoPalette.tint)
        .presentationBackground(DemoPalette.bg)
        .preferredColorScheme(.dark)
    }
}

// MARK: - Shop

/// The deck's Shop tab in miniature: a watchlist with best prices and a calm Coverage list. A store that blocks
/// automated search, or one still waiting for keys, reads as skipped in muted text, never as a red failure.
struct DemoShopPage: View {
    @Bindable var sample: DemoDeck
    let onConnect: () -> Void
    @Environment(\.demoDetailWidth) private var detailWidth
    @ScaledMetric(relativeTo: .title3) private var glyphColumn: CGFloat = 32

    var body: some View {
        Group {
            if DeckLayout.demoUsesTwoColumns(detailWidth: detailWidth) {
                HStack(alignment: .top, spacing: 0) {
                    List { DemoPurposeSection(DemoWords.shopPurpose); watchlistSection }.demoList()
                    List { coverageSection }.demoList()
                }
            } else {
                List { DemoPurposeSection(DemoWords.shopPurpose); watchlistSection; coverageSection }.demoList()
            }
        }
        .demoChrome(title: "Shop", onConnect: onConnect)
    }

    private var watchlistSection: some View {
        Section {
            ForEach(sample.watchlist) { item in itemRow(item) }
        } header: {
            DemoSectionHeader("Watchlist")
        } footer: {
            DemoSectionFooter(DemoWords.watchlistFooter)
        }
        .listRowBackground(DemoPalette.raised)
    }

    private func itemRow(_ item: DemoDeck.WatchItem) -> some View {
        let alert = sample.hasAlert(item)
        return HStack(alignment: .center, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Image(systemName: item.symbol)
                    .font(.title3)
                    .foregroundStyle(DemoPalette.tint)
                    .frame(width: glyphColumn)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(DemoType.bodyStrong)
                        .foregroundStyle(DemoPalette.text1)
                    Text("\(DemoWords.price(item.price)) · \(item.store)")
                        .font(DemoType.body.monospacedDigit())
                        .foregroundStyle(DemoPalette.text1)
                    Text(DemoWords.lowLine(price: item.price, low30: item.low30, weekChange: item.weekChange))
                        .font(DemoType.meta.monospacedDigit())
                        .foregroundStyle(item.weekChange < 0 ? DemoPalette.ok : DemoPalette.text2)
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(DemoWords.itemSpoken(title: item.title, price: item.price, store: item.store,
                                                     low30: item.low30, weekChange: item.weekChange))
            .accessibilityIdentifier("demo.shop.item.\(item.id)")
            Button { sample.toggleAlert(item) } label: {
                Image(systemName: alert ? "bell.fill" : "bell")
                    .font(.body)
                    .foregroundStyle(alert ? DemoPalette.tint : DemoPalette.text3)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DemoPressStyle())
            .accessibilityLabel("Example price drop alert, \(item.title)")
            .accessibilityValue(alert ? "On" : "Off")
            .accessibilityHint(DemoWords.alertHint(on: alert))
            .accessibilityIdentifier("demo.shop.\(item.id).alert")
        }
        .frame(minHeight: 44)
    }

    private var coverageSection: some View {
        let coverage = sample.coverage
        return Section {
            VStack(alignment: .leading, spacing: 2) {
                Text(coverage.title)
                    .font(DemoType.bodyStrong)
                    .foregroundStyle(DemoPalette.text1)
                Text(coverage.detail)
                    .font(DemoType.meta)
                    .foregroundStyle(DemoPalette.text2)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("demo.shop.coverage")
            ForEach(sample.stores) { store in storeRow(store) }
        } header: {
            DemoSectionHeader("Stores checked")
        } footer: {
            DemoSectionFooter(DemoWords.coverageFooter)
        }
        .listRowBackground(DemoPalette.raised)
    }

    private func storeRow(_ store: DemoDeck.SampleStore) -> some View {
        let answering = store.state == .answering
        return HStack(alignment: .firstTextBaseline, spacing: 14) {
            Image(systemName: Self.symbol(store.state))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(answering ? DemoPalette.ok : DemoPalette.text3)
                .frame(width: glyphColumn)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.name)
                    .font(DemoType.body)
                    .foregroundStyle(answering ? DemoPalette.text1 : DemoPalette.text2)
                Text(DemoWords.storeStatus(store.state))
                    .font(DemoType.meta)
                    .foregroundStyle(DemoPalette.text3)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Example store: \(store.name). \(DemoWords.storeStatus(store.state))")
        .accessibilityIdentifier("demo.shop.store.\(store.id)")
    }

    private static func symbol(_ state: DemoWords.StoreState) -> String {
        switch state {
        case .answering: "checkmark.circle.fill"
        case .skipped: "minus.circle"
        case .needsSetup: "key"
        }
    }
}

// MARK: - Links

struct DemoLinksPage: View {
    @Bindable var sample: DemoDeck
    let onConnect: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    @ScaledMetric(relativeTo: .title3) private var glyphColumn: CGFloat = 32
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var previewed: DemoDeck.SampleLink? {
        sample.links.first { $0.id == sample.openedLinkID } ?? sample.links.first
    }

    var body: some View {
        Group {
            if sizeClass == .regular, let previewed {
                HStack(alignment: .top, spacing: 0) {
                    list
                        .frame(maxWidth: 420)
                    Divider().overlay(DemoPalette.line)
                    GeometryReader { proxy in
                        ScrollView {
                            DemoLinkContent(sample: sample, link: previewed)
                                .padding(24)
                                .frame(maxWidth: 680, minHeight: max(proxy.size.height - 48, 0), alignment: .topLeading)
                                .background(DemoPalette.raised, in: .rect(cornerRadius: DeckStyle.cardRadius))
                                .padding(24)
                                .frame(maxWidth: .infinity, alignment: .center)
                        }
                        .id(previewed.id)
                    }
                }
            } else {
                list
            }
        }
        .demoChrome(title: "Links", onConnect: onConnect)
        .navigationDestination(for: DemoDeck.SampleLink.self) { link in
            DemoLinkPage(sample: sample, link: link, onConnect: onConnect)
        }
    }

    private func pin(_ link: DemoDeck.SampleLink) {
        withAnimation(DemoMotion.animation(reduceMotion: reduceMotion)) { sample.togglePin(link) }
    }

    private var list: some View {
        List {
            DemoPurposeSection(DemoWords.linksPurpose)
            Section {
                ForEach(sample.orderedLinks) { link in
                    row(link)
                        .swipeActions(edge: .leading) {
                            Button { pin(link) } label: {
                                Label(sample.isPinned(link) ? "Unpin" : "Pin",
                                      systemImage: sample.isPinned(link) ? "pin.slash" : "pin")
                            }
                            .tint(DemoPalette.tint)
                        }
                        .contextMenu {
                            Button { pin(link) } label: {
                                Label(sample.isPinned(link) ? "Unpin" : "Pin",
                                      systemImage: sample.isPinned(link) ? "pin.slash" : "pin")
                            }
                        }
                }
            } footer: {
                DemoSectionFooter("Sample pages. A tap opens a local preview, never a website.")
            }
            .listRowBackground(DemoPalette.raised)
        }
        .demoList()
    }

    @ViewBuilder
    private func row(_ link: DemoDeck.SampleLink) -> some View {
        if sizeClass == .regular {
            let selected = link.id == previewed?.id
            Button { sample.openLink(link) } label: { rowLabel(link, selected: selected) }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isSelected] : [])
                .accessibilityIdentifier("demo.link.\(link.id)")
        } else {
            NavigationLink(value: link) { rowLabel(link, selected: false) }
                .accessibilityIdentifier("demo.link.\(link.id)")
        }
    }

    private func rowLabel(_ link: DemoDeck.SampleLink, selected: Bool) -> some View {
        HStack(spacing: 14) {
            Image(systemName: link.symbol)
                .font(.title3)
                .foregroundStyle(DemoPalette.tint)
                .frame(width: glyphColumn)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(link.title)
                    .font(DemoType.bodyStrong)
                    .foregroundStyle(DemoPalette.text1)
                Text(link.detail)
                    .font(DemoType.meta)
                    .foregroundStyle(DemoPalette.text2)
            }
            Spacer(minLength: 8)
            if sample.isPinned(link) {
                Image(systemName: "pin.fill")
                    .font(.footnote)
                    .foregroundStyle(DemoPalette.text3)
                    .accessibilityLabel("Pinned")
            }
            if selected {
                Image(systemName: "checkmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(DemoPalette.tint)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityLabel("Example page: \(link.title), \(link.detail)\(sample.isPinned(link) ? ", pinned" : "")\(selected ? ", selected" : "")")
    }
}

private struct DemoLinkPage: View {
    @Bindable var sample: DemoDeck
    let link: DemoDeck.SampleLink
    let onConnect: () -> Void

    var body: some View {
        ScrollView {
            DemoLinkContent(sample: sample, link: link)
                .padding(20)
                .frame(maxWidth: 680, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .background(DemoPalette.bg)
        .navigationBarTitleDisplayMode(.inline)
        // The way out stays one tap away on a pushed page too, not only on the list behind it.
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Connect", action: onConnect)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Connect your deck")
                    .accessibilityHint(DemoWords.connectHint)
                    .accessibilityIdentifier("demo.connect.open")
            }
        }
        .onAppear { sample.openLink(link) }
    }
}

private struct DemoLinkContent: View {
    @Bindable var sample: DemoDeck
    let link: DemoDeck.SampleLink

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(link.title)
                    .font(DemoType.display)
                    .foregroundStyle(DemoPalette.text1)
                    .accessibilityIdentifier("demo.link.detail.title")
                    .accessibilityAddTraits(.isHeader)
                Label("Sample page", systemImage: "doc.text")
                    .font(DemoType.micro)
                    .foregroundStyle(DemoPalette.text2)
            }
            ForEach(link.paragraphs, id: \.self) { paragraph in
                Text(paragraph)
                    .font(DemoType.body)
                    .foregroundStyle(DemoPalette.text1)
                    .lineSpacing(3)
            }
            Button { sample.togglePin(link) } label: {
                Label(sample.isPinned(link) ? "Pinned" : "Pin to top",
                      systemImage: sample.isPinned(link) ? "pin.fill" : "pin")
                    .frame(minHeight: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityHint(DemoWords.pinHint(pinned: sample.isPinned(link)))
            .accessibilityIdentifier("demo.link.pin")
            Text("Links in your own deck open the pages you saved on your server.")
                .font(DemoType.meta)
                .foregroundStyle(DemoPalette.text3)
        }
    }
}

// MARK: - Pad

/// The trackpad is a plain stack, not a scroll view, so a drag never competes with scrolling.
/// The page scrolls only at accessibility text sizes or in a short window (landscape phone, short Split View),
/// and scrolling is off while a finger is on the pad.
struct DemoPadPage: View {
    @Bindable var sample: DemoDeck
    let onConnect: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var message = ""
    @State private var dragging = false
    @State private var lastTranslation = CGSize.zero
    @FocusState private var typing: Bool

    /// Side by side at normal text sizes, stacked at accessibility sizes so no label is cut off.
    private var sideBySide: AnyLayout {
        typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
    }

    /// Below this height the fixed layout can push the Send button off screen, so the page scrolls instead.
    private static let scrollsBelowHeight: CGFloat = 480

    private func scrollable(wide: Bool) -> some View {
        ScrollView {
            layout(wide: wide)
                .padding(16)
        }
        .scrollDisabled(dragging)
        // The typing field keeps the keyboard while the page scrolls. Done and a background tap still dismiss it.
        .scrollDismissesKeyboard(.never)
    }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                scrollable(wide: false)
            } else {
                GeometryReader { proxy in
                    // A short landscape window scrolls and takes the two-column layout, so the typing row sits at the
                    // top of the left column instead of below a full-height desktop on a page the pad's drag eats.
                    let wide = proxy.size.width > proxy.size.height * 1.2
                    if proxy.size.height < Self.scrollsBelowHeight {
                        scrollable(wide: wide)
                    } else {
                        layout(wide: wide)
                            .padding(16)
                    }
                }
            }
        }
        .dismissesKeyboardOnBackgroundTap { typing = false }
        .background(DemoPalette.bg)
        .demoChrome(title: "Pad", inline: true, onConnect: onConnect)
        .deckKeyboardDoneButton { typing = false }
    }

    /// A click on the sample desktop. It is spoken as an Example, because the desktop reacts only on screen.
    private func click(_ kind: DemoDeck.Click) {
        sample.click(kind)
        announce(kind == .left ? .leftClick : .rightClick)
    }

    /// A drag stays silent: it would repeat for every frame.
    private func announce(_ event: DemoWords.PadEvent) {
        guard let text = DemoWords.padAnnouncement(event) else { return }
        AccessibilityNotification.Announcement(text).post()
    }

    /// VoiceOver rotor move: the drag gesture is touch-only, so the pad nudges the pointer and says where it landed.
    private func nudge(dx: CGFloat, dy: CGFloat) {
        sample.movePointer(dx: dx, dy: dy)
        AccessibilityNotification.Announcement(DemoWords.padPosition(sample.pointer)).post()
    }

    @ViewBuilder
    private func layout(wide: Bool) -> some View {
        if wide {
            HStack(alignment: .top, spacing: 16) {
                VStack(spacing: 12) {
                    desktop
                    typeRow
                }
                .frame(maxHeight: .infinity)
                VStack(spacing: 12) {
                    surface
                        .frame(maxHeight: .infinity)
                    clicks
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 12) {
                desktop
                surface
                clicks
                typeRow
            }
        }
    }

    private var desktop: some View {
        VStack(spacing: 8) {
            DemoDesktopFrame(pointer: sample.pointer, typedText: sample.sentMessages.last)
                .demoExampleTag()
                .overlay(RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous)
                    .strokeBorder(DemoPalette.line, lineWidth: 1))
            Text(sample.padStatus.map { DemoWords.padResult($0.demoEvent) } ?? DemoWords.padIdle)
                .font(DemoType.meta)
                .foregroundStyle(DemoPalette.text2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("demo.pad.status")
        }
    }

    private var surface: some View {
        GeometryReader { proxy in
            ZStack {
                RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous)
                    .fill(DemoPalette.raised)
                RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous)
                    .strokeBorder(dragging ? DemoPalette.tint.opacity(0.6) : DemoPalette.line, lineWidth: 1)
                Text("Trackpad")
                    .font(DemoType.meta)
                    .foregroundStyle(DemoPalette.text3)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        dragging = true
                        let step = CGSize(width: value.translation.width - lastTranslation.width,
                                          height: value.translation.height - lastTranslation.height)
                        lastTranslation = value.translation
                        guard abs(step.width) + abs(step.height) > 0.5 else { return }
                        sample.movePointer(dx: step.width / max(proxy.size.width, 1) * 1.5,
                                           dy: step.height / max(proxy.size.height, 1) * 1.5)
                    }
                    .onEnded { value in
                        dragging = false
                        lastTranslation = .zero
                        if hypot(value.translation.width, value.translation.height) < 8 { click(.left) }
                    }
            )
        }
        .frame(minHeight: 140)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DemoWords.padSurfaceLabel)
        .accessibilityHint(DemoWords.padSurfaceHint)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { click(.left) }
        .accessibilityAction(named: Text(DemoWords.padNudgeLeft)) { nudge(dx: -0.08, dy: 0) }
        .accessibilityAction(named: Text(DemoWords.padNudgeRight)) { nudge(dx: 0.08, dy: 0) }
        .accessibilityAction(named: Text(DemoWords.padNudgeUp)) { nudge(dx: 0, dy: -0.08) }
        .accessibilityAction(named: Text(DemoWords.padNudgeDown)) { nudge(dx: 0, dy: 0.08) }
        .accessibilityIdentifier("demo.pad.surface")
    }

    private var clicks: some View {
        sideBySide {
            Button { click(.left) } label: {
                Text("Left click").frame(maxWidth: .infinity, minHeight: 44)
            }
            .accessibilityHint(DemoWords.padClickHint)
            .accessibilityIdentifier("demo.pad.left")
            Button { click(.right) } label: {
                Text("Right click").frame(maxWidth: .infinity, minHeight: 44)
            }
            .accessibilityHint(DemoWords.padClickHint)
            .accessibilityIdentifier("demo.pad.right")
        }
        .buttonStyle(.bordered)
    }

    private var canSend: Bool { !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var typeRow: some View {
        sideBySide {
            TextField("Type to the sample desktop", text: $message,
                      prompt: Text("Type to the sample desktop").foregroundStyle(DemoPalette.text3))
                .font(DemoType.body)
                .foregroundStyle(DemoPalette.text1)
                .submitLabel(.send)
                .focused($typing)
                .onSubmit(send)
                .accessibilityLabel("Message to the sample desktop")
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(DemoPalette.raised, in: RoundedRectangle(cornerRadius: DeckStyle.controlRadius, style: .continuous))
                .accessibilityIdentifier("demo.text.input")
            Button("Send", action: send)
                .buttonStyle(.borderedProminent)
                .foregroundStyle(DemoPalette.bg)
                .frame(minHeight: 44)
                .disabled(!canSend)
                .accessibilityHint(DemoWords.padSendHint)
                .accessibilityIdentifier("demo.text.send")
        }
    }

    /// The keyboard stays up after a send, so the next line can be typed straight away.
    private func send() {
        guard sample.sendText(message) else { return }
        message = ""
        typing = true
        announce(.sent)
    }
}

private extension DemoDeck.PadStatus {
    var demoEvent: DemoWords.PadEvent {
        switch self {
        case .moved: .moved
        case .leftClick: .leftClick
        case .rightClick: .rightClick
        case .sent: .sent
        }
    }
}
