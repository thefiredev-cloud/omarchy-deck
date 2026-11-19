import SwiftUI

/// Sample camera scenes, drawn on this device with vector shapes. No image file, URL or network is involved.
enum DemoScene: String, CaseIterable, Identifiable, Hashable {
    case frontDoor, garden, garage

    var id: String { rawValue }
    var title: String {
        switch self {
        case .frontDoor: "Front door"
        case .garden: "Back garden"
        case .garage: "Garage"
        }
    }
}

enum DemoLight: CaseIterable, Hashable {
    case day, dusk
}

/// A calm illustrated still. Its palette is fixed (it stands for a photograph, not for UI).
struct DemoStill: View {
    let scene: DemoScene
    let light: DemoLight

    var body: some View {
        Canvas { context, size in
            DemoStillPainter(light: light, size: size).paint(scene, in: &context)
        }
        .aspectRatio(16.0 / 10.0, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Example camera view: \(scene.title)")
        .accessibilityAddTraits(.isImage)
    }
}

private struct DemoStillPainter {
    let light: DemoLight
    let size: CGSize

    private var dusk: Bool { light == .dusk }
    private var w: CGFloat { size.width }
    private var h: CGFloat { size.height }

    private func rgb(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> Color {
        Color(red: r, green: g, blue: b, opacity: a)
    }

    private var skyTop: Color { dusk ? rgb(0.13, 0.15, 0.30) : rgb(0.42, 0.60, 0.78) }
    private var skyBottom: Color { dusk ? rgb(0.82, 0.48, 0.38) : rgb(0.88, 0.84, 0.74) }
    private var wall: Color { dusk ? rgb(0.30, 0.31, 0.40) : rgb(0.80, 0.76, 0.69) }
    private var ground: Color { dusk ? rgb(0.12, 0.13, 0.17) : rgb(0.46, 0.44, 0.40) }
    private var shade: Color { dusk ? rgb(0.05, 0.06, 0.10, 0.55) : rgb(0.10, 0.10, 0.14, 0.14) }
    private var lamp: Color { rgb(1.0, 0.82, 0.50) }

    func paint(_ scene: DemoScene, in context: inout GraphicsContext) {
        switch scene {
        case .frontDoor: frontDoor(&context)
        case .garden: garden(&context)
        case .garage: garage(&context)
        }
        vignette(&context)
    }

    private func rect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, radius: CGFloat = 0) -> Path {
        Path(roundedRect: CGRect(x: x * w, y: y * h, width: width * w, height: height * h), cornerRadius: radius * w)
    }

    private func glow(_ context: inout GraphicsContext, at point: CGPoint, radius: CGFloat) {
        guard dusk else { return }
        let circle = Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
        context.fill(circle, with: .radialGradient(
            Gradient(colors: [lamp.opacity(0.75), lamp.opacity(0)]),
            center: point, startRadius: 0, endRadius: radius))
    }

    private func vignette(_ context: inout GraphicsContext) {
        let full = Path(CGRect(origin: .zero, size: size))
        context.fill(full, with: .radialGradient(
            Gradient(colors: [.clear, .black.opacity(dusk ? 0.40 : 0.24)]),
            center: CGPoint(x: w / 2, y: h / 2), startRadius: min(w, h) * 0.45, endRadius: max(w, h) * 0.75))
    }

    private func frontDoor(_ context: inout GraphicsContext) {
        let full = Path(CGRect(origin: .zero, size: size))
        context.fill(full, with: .color(wall))
        for index in 1..<13 {
            let y = CGFloat(index) * h / 13
            context.stroke(Path { $0.move(to: CGPoint(x: 0, y: y)); $0.addLine(to: CGPoint(x: w, y: y)) },
                           with: .color(shade), lineWidth: max(1, h * 0.004))
        }
        context.fill(rect(0, 0.82, 1, 0.18), with: .color(ground))
        context.fill(rect(0.30, 0.76, 0.40, 0.07), with: .color(ground.opacity(0.9)))
        let frame = dusk ? rgb(0.20, 0.21, 0.27) : rgb(0.93, 0.91, 0.86)
        context.fill(rect(0.36, 0.14, 0.28, 0.64, radius: 0.01), with: .color(frame))
        let door = dusk ? rgb(0.10, 0.20, 0.24) : rgb(0.17, 0.33, 0.37)
        context.fill(rect(0.385, 0.17, 0.23, 0.61), with: .color(door))
        context.fill(rect(0.415, 0.22, 0.17, 0.16, radius: 0.006), with: .color(dusk ? lamp.opacity(0.55) : rgb(0.70, 0.84, 0.90)))
        context.fill(rect(0.415, 0.44, 0.17, 0.28, radius: 0.006), with: .color(.black.opacity(0.10)))
        context.fill(Path(ellipseIn: CGRect(x: 0.57 * w, y: 0.50 * h, width: 0.014 * w, height: 0.014 * w)),
                     with: .color(rgb(0.86, 0.72, 0.45)))
        let lampPoint = CGPoint(x: 0.72 * w, y: 0.30 * h)
        glow(&context, at: lampPoint, radius: w * 0.22)
        context.fill(rect(0.705, 0.25, 0.03, 0.10, radius: 0.004), with: .color(dusk ? lamp : rgb(0.30, 0.30, 0.34)))
        context.fill(rect(0.12, 0.66, 0.08, 0.12, radius: 0.006), with: .color(rgb(0.52, 0.30, 0.22)))
        for (dx, dy) in [(0.0, -0.10), (0.025, -0.07), (-0.025, -0.07)] {
            context.fill(Path(ellipseIn: CGRect(x: (0.14 + dx) * w, y: (0.62 + dy) * h, width: 0.05 * w, height: 0.09 * h)),
                         with: .color(dusk ? rgb(0.15, 0.30, 0.22) : rgb(0.28, 0.50, 0.32)))
        }
    }

    private func garden(_ context: inout GraphicsContext) {
        context.fill(rect(0, 0, 1, 0.70), with: .linearGradient(
            Gradient(colors: [skyTop, skyBottom]), startPoint: .zero, endPoint: CGPoint(x: 0, y: h * 0.7)))
        let orb = dusk ? rgb(0.95, 0.90, 0.80) : rgb(1.0, 0.92, 0.66)
        context.fill(Path(ellipseIn: CGRect(x: 0.66 * w, y: 0.14 * h, width: 0.10 * w, height: 0.10 * w)), with: .color(orb))
        let far = Path { path in
            path.move(to: CGPoint(x: 0, y: 0.60 * h))
            path.addQuadCurve(to: CGPoint(x: 0.45 * w, y: 0.52 * h), control: CGPoint(x: 0.2 * w, y: 0.40 * h))
            path.addQuadCurve(to: CGPoint(x: w, y: 0.58 * h), control: CGPoint(x: 0.75 * w, y: 0.42 * h))
            path.addLine(to: CGPoint(x: w, y: 0.75 * h))
            path.addLine(to: CGPoint(x: 0, y: 0.75 * h))
        }
        context.fill(far, with: .color(dusk ? rgb(0.12, 0.17, 0.22) : rgb(0.45, 0.58, 0.50)))
        context.fill(rect(0, 0.66, 1, 0.34), with: .linearGradient(
            Gradient(colors: [dusk ? rgb(0.10, 0.19, 0.17) : rgb(0.36, 0.55, 0.34), dusk ? rgb(0.06, 0.11, 0.11) : rgb(0.24, 0.40, 0.26)]),
            startPoint: CGPoint(x: 0, y: 0.66 * h), endPoint: CGPoint(x: 0, y: h)))
        let hedge = dusk ? rgb(0.08, 0.20, 0.15) : rgb(0.19, 0.38, 0.24)
        for index in 0..<7 {
            let x = 0.02 + CGFloat(index) * 0.14
            context.fill(rect(x, 0.54, 0.15, 0.17, radius: 0.045), with: .color(hedge))
        }
        let path = Path { path in
            path.move(to: CGPoint(x: 0.44 * w, y: 0.72 * h))
            path.addLine(to: CGPoint(x: 0.56 * w, y: 0.72 * h))
            path.addLine(to: CGPoint(x: 0.80 * w, y: h))
            path.addLine(to: CGPoint(x: 0.20 * w, y: h))
        }
        context.fill(path, with: .color(dusk ? rgb(0.30, 0.28, 0.28) : rgb(0.82, 0.75, 0.62)))
        let petals: [(CGFloat, CGFloat)] = [(0.10, 0.84), (0.16, 0.90), (0.84, 0.82), (0.90, 0.90), (0.08, 0.93), (0.78, 0.92)]
        for (x, y) in petals {
            context.fill(Path(ellipseIn: CGRect(x: x * w, y: y * h, width: 0.018 * w, height: 0.018 * w)),
                         with: .color(dusk ? rgb(0.74, 0.46, 0.50) : rgb(0.90, 0.46, 0.50)))
        }
        glow(&context, at: CGPoint(x: 0.88 * w, y: 0.66 * h), radius: w * 0.18)
        if dusk {
            context.fill(Path(ellipseIn: CGRect(x: 0.865 * w, y: 0.64 * h, width: 0.03 * w, height: 0.03 * w)), with: .color(lamp))
        }
    }

    private func garage(_ context: inout GraphicsContext) {
        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(wall))
        context.fill(rect(0, 0, 1, 0.07), with: .color(dusk ? rgb(0.18, 0.19, 0.25) : rgb(0.92, 0.90, 0.85)))
        let panel = dusk ? rgb(0.22, 0.24, 0.30) : rgb(0.90, 0.89, 0.86)
        context.fill(rect(0.16, 0.14, 0.68, 0.58, radius: 0.006), with: .color(panel))
        for index in 1..<5 {
            let y = (0.14 + 0.58 * CGFloat(index) / 5) * h
            context.stroke(Path { $0.move(to: CGPoint(x: 0.16 * w, y: y)); $0.addLine(to: CGPoint(x: 0.84 * w, y: y)) },
                           with: .color(shade.opacity(1.4)), lineWidth: max(1, h * 0.008))
        }
        for index in 0..<4 {
            let x = (0.20 + 0.16 * CGFloat(index)) * w
            context.fill(Path(CGRect(x: x, y: 0.19 * h, width: 0.09 * w, height: 0.03 * h)), with: .color(.white.opacity(dusk ? 0.05 : 0.30)))
        }
        let drive = Path { path in
            path.move(to: CGPoint(x: 0.16 * w, y: 0.72 * h))
            path.addLine(to: CGPoint(x: 0.84 * w, y: 0.72 * h))
            path.addLine(to: CGPoint(x: w, y: h))
            path.addLine(to: CGPoint(x: 0, y: h))
        }
        context.fill(drive, with: .color(ground))
        context.fill(rect(0, 0.72, 0.16, 0.28), with: .color(dusk ? rgb(0.08, 0.14, 0.12) : rgb(0.30, 0.45, 0.30)))
        context.fill(rect(0.84, 0.72, 0.16, 0.28), with: .color(dusk ? rgb(0.08, 0.14, 0.12) : rgb(0.30, 0.45, 0.30)))
        let body = dusk ? rgb(0.30, 0.36, 0.52) : rgb(0.42, 0.55, 0.72)
        context.fill(rect(0.30, 0.78, 0.40, 0.11, radius: 0.02), with: .color(body))
        context.fill(rect(0.38, 0.72, 0.24, 0.09, radius: 0.02), with: .color(body.opacity(0.95)))
        context.fill(rect(0.40, 0.735, 0.20, 0.05, radius: 0.01), with: .color(dusk ? lamp.opacity(0.25) : rgb(0.78, 0.88, 0.94)))
        for x in [0.35, 0.60] {
            context.fill(Path(ellipseIn: CGRect(x: x * w, y: 0.855 * h, width: 0.05 * w, height: 0.05 * w)),
                         with: .color(rgb(0.08, 0.08, 0.10)))
        }
        glow(&context, at: CGPoint(x: 0.5 * w, y: 0.10 * h), radius: w * 0.30)
        if dusk {
            context.fill(rect(0.47, 0.08, 0.06, 0.025, radius: 0.006), with: .color(lamp))
        }
    }
}

/// The illustrated desktop shown by the pad and the home tab. The pointer and the typed line follow the pad.
struct DemoDesktopFrame: View {
    var pointer = CGPoint(x: 0.5, y: 0.5)
    var typedText: String?

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            ZStack(alignment: .topLeading) {
                LinearGradient(colors: [Color(red: 0.16, green: 0.17, blue: 0.30), Color(red: 0.48, green: 0.32, blue: 0.30)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                Rectangle().fill(.black.opacity(0.30)).frame(height: height * 0.07)
                notes(width: width, height: height)
                    .position(x: width * 0.36, y: height * 0.44)
                calendar(width: width, height: height)
                    .position(x: width * 0.77, y: height * 0.50)
                dock(width: width, height: height)
                    .position(x: width / 2, y: height * 0.90)
                Image(systemName: "cursorarrow")
                    .font(.system(size: max(12, width * 0.05)))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.5), radius: 2, y: 1)
                    .position(x: pointer.x * width, y: pointer.y * height)
            }
            .frame(width: width, height: height)
            .clipped()
        }
        .aspectRatio(16.0 / 10.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: DeckStyle.cardRadius, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Example desktop view\(typedText.map { ", showing \"\($0)\"" } ?? ""). Not a live connection.")
    }

    private func windowDots() -> some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { _ in Circle().fill(DemoPalette.text3).frame(width: 6, height: 6) }
            Spacer()
        }
    }

    private func notes(width: CGFloat, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: height * 0.03) {
            windowDots()
            if let typedText {
                Text(typedText)
                    .font(.caption2)
                    .foregroundStyle(DemoPalette.text1)
                    .lineLimit(3)
                    .minimumScaleFactor(0.6)
            } else {
                ForEach([0.90, 0.72, 0.84, 0.50], id: \.self) { fraction in
                    Capsule().fill(DemoPalette.line).frame(width: width * 0.40 * fraction, height: height * 0.022)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(width * 0.025)
        .frame(width: width * 0.46, height: height * 0.52, alignment: .topLeading)
        .background(DemoPalette.raised, in: RoundedRectangle(cornerRadius: width * 0.02, style: .continuous))
    }

    private func calendar(width: CGFloat, height: CGFloat) -> some View {
        VStack(spacing: height * 0.02) {
            windowDots()
            ForEach(0..<3, id: \.self) { row in
                HStack(spacing: width * 0.012) {
                    ForEach(0..<4, id: \.self) { column in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(row == 1 && column == 2 ? DemoPalette.tint : DemoPalette.line)
                            .frame(height: height * 0.08)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(width * 0.025)
        .frame(width: width * 0.32, height: height * 0.40, alignment: .topLeading)
        .background(DemoPalette.raised, in: RoundedRectangle(cornerRadius: width * 0.02, style: .continuous))
    }

    private func dock(width: CGFloat, height: CGFloat) -> some View {
        HStack(spacing: width * 0.02) {
            ForEach(0..<5, id: \.self) { index in
                RoundedRectangle(cornerRadius: width * 0.012, style: .continuous)
                    .fill(index == 2 ? DemoPalette.tint : .white.opacity(0.22))
                    .frame(width: width * 0.05, height: width * 0.05)
            }
        }
        .padding(width * 0.015)
        .background(.black.opacity(0.32), in: RoundedRectangle(cornerRadius: width * 0.026, style: .continuous))
    }
}
