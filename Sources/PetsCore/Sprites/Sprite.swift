// Grown from claude-panel's ui/src/lib/sprites/render.ts. Working and finished look livelier here; the Pi panel can port them back.

public enum Mood: CaseIterable, Sendable {
    case idle, working, alert, asking, compacting, error, sleeping
    /// Done with its turn and waiting for the user's reply.
    case finished
}

/// A 16×16 character plus room above and to the right for overlays.
public let spriteSize = 24

public typealias Pixels = [[RGB?]]

public struct RGB: Hashable, Sendable {
    public var r, g, b: UInt8

    public init(r: UInt8, g: UInt8, b: UInt8) {
        self.r = r
        self.g = g
        self.b = b
    }

    public init?(hex: String) {
        guard hex.count == 7, hex.first == "#", let v = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(r: UInt8(v >> 16 & 0xff), g: UInt8(v >> 8 & 0xff), b: UInt8(v & 0xff))
    }

    /// Mixed toward black (amount < 0) or white (amount > 0); |amount| is 0…1.
    public func shaded(_ amount: Double) -> RGB {
        let target = amount < 0 ? 0.0 : 255.0
        let t = abs(amount)
        func mix(_ v: UInt8) -> UInt8 { UInt8((Double(v) + (target - Double(v)) * t).rounded()) }
        return RGB(r: mix(r), g: mix(g), b: mix(b))
    }
}

extension SessionIcon {
    public var tint: RGB {
        RGB(hex: color) ?? RGB(hex: SessionIcon.default.color)!
    }
}

public func spriteFrame(character characterId: String, color: RGB, mood: Mood, frame: Int) -> Pixels {
    let character = CharacterTemplate.named(characterId)
    let pose = Pose(mood: mood, frame: frame)
    let palette: [Swift.Character: RGB] = [
        "B": color,
        "D": color.shaded(-0.35),
        "L": color.shaded(0.35),
        "F": Palette.face,
        "P": Palette.pink,
    ]

    var pixels = Pixels(repeating: Array(repeating: nil, count: spriteSize), count: spriteSize)
    func set(_ x: Int, _ y: Int, _ c: RGB) {
        if (0..<spriteSize).contains(x), (0..<spriteSize).contains(y) { pixels[y][x] = c }
    }

    let ox = bodyX + pose.dx
    let oy = bodyY + pose.dy
    for (y, row) in bodyRows(character, walking: pose.walk).enumerated() {
        for (x, cell) in row.enumerated() {
            if let c = palette[cell] { set(ox + x, oy + y, c) }
        }
    }

    let eyeColor = character.eyeColor.flatMap(RGB.init(hex:)) ?? Palette.eye
    for (ex, mirrored) in [(character.eyes.left, false), (character.eyes.right, true)] {
        for (dx, dy) in eyeCells(pose.eyes, mirrored: mirrored) {
            set(ox + ex + dx, oy + character.eyes.y + dy, eyeColor)
        }
    }

    for overlay in pose.overlays {
        for (y, row) in overlay.glyph.rows.enumerated() {
            for (x, cell) in row.enumerated() where cell == "X" { set(overlay.x + x, overlay.y + y, overlay.color) }
        }
    }
    return pixels
}

private let bodyX = 4
private let bodyY = 6

private enum Palette {
    static let bang = RGB(hex: "#ffd23f")!
    static let question = RGB(hex: "#ffffff")!
    static let cross = RGB(hex: "#ff4d4d")!
    static let z = RGB(hex: "#c8d0dc")!
    static let dotOn = RGB(hex: "#ffffff")!
    static let dotOff = RGB(hex: "#4a4f5a")!
    static let face = RGB(hex: "#16171c")!
    static let pink = RGB(hex: "#ff8fb1")!
    static let check = RGB(hex: "#4cd964")!
    static let eye = RGB(hex: "#111216")!
}

private enum Glyph {
    case bang, question, cross, z, dot, check

    var rows: [String] {
        switch self {
        case .bang: return ["X", "X", "X", ".", "X"]
        case .question: return ["XXX", "..X", ".XX", "...", ".X."]
        case .cross: return ["X.X", ".X.", "X.X"]
        case .z: return ["XXXX", "..X.", ".X..", "XXXX"]
        case .dot: return ["X"]
        case .check: return [".....X", "....XX", "X..XX.", "XXXX..", ".XX..."]
        }
    }
}

private let zSpots = [(15, 5), (18, 2), (20, 0)]

private enum EyeStyle { case open, closed, squint }

private struct Overlay {
    let glyph: Glyph
    let x: Int
    let y: Int
    let color: RGB
}

private struct Pose {
    var dx = 0
    var dy = 0
    var eyes = EyeStyle.open
    var walk = false
    var overlays: [Overlay] = []

    init(mood: Mood, frame: Int) {
        func cycle<T>(_ values: [T]) -> T { values[(frame % values.count + values.count) % values.count] }
        switch mood {
        case .idle:
            eyes = cycle([EyeStyle.closed] + Array(repeating: .open, count: 15))
        case .working:
            dy = cycle([0, -1, -2, -1])
            walk = cycle([false, true])
            let raised = cycle([0, 1, 2])
            overlays = (0..<3).map { Overlay(glyph: .dot, x: 17 + $0 * 2, y: $0 == raised ? 3 : 4, color: Palette.dotOn) }
        case .alert:
            dy = cycle([0, -2, -3, -2])
            overlays = cycle([[Overlay(glyph: .bang, x: 21, y: 0, color: Palette.bang)], []])
        case .asking:
            dy = cycle([0, 0, -1, -1])
            overlays = [Overlay(glyph: .question, x: 19, y: 0, color: Palette.question)]
        case .compacting:
            dy = cycle([0, 1])
            eyes = .squint
            let lit = cycle([0, 1, 2])
            overlays = (0..<3).map { Overlay(glyph: .dot, x: 17 + $0 * 2, y: 3, color: $0 == lit ? Palette.dotOn : Palette.dotOff) }
        case .error:
            dx = cycle([-1, 1, -1, 0, 0, 0, 0, 0])
            eyes = .squint
            overlays = [Overlay(glyph: .cross, x: 19, y: 1, color: Palette.cross)]
        case .finished:
            eyes = cycle([EyeStyle.closed] + Array(repeating: .open, count: 15))
            overlays = [Overlay(glyph: .check, x: 17, y: 0, color: Palette.check)]
        case .sleeping:
            let count = cycle([1, 1, 2, 2, 3, 3, 0, 0])
            eyes = .closed
            overlays = zSpots.prefix(count).map { Overlay(glyph: .z, x: $0.0, y: $0.1, color: Palette.z) }
        }
    }
}

private func bodyRows(_ character: CharacterTemplate, walking: Bool) -> [[Swift.Character]] {
    let body = character.body.map(Array.init)
    guard walking, let walk = character.walk else { return body }
    return body.enumerated().map { y, line in
        (walk.row..<walk.row + walk.rows.count).contains(y) ? Array(walk.rows[y - walk.row]) : line
    }
}

private func eyeCells(_ style: EyeStyle, mirrored: Bool) -> [(Int, Int)] {
    switch style {
    case .open: return [(0, 0), (1, 0), (0, 1), (1, 1)]
    case .closed: return [(0, 1), (1, 1)]
    case .squint: return mirrored ? [(1, 0), (0, 1)] : [(0, 0), (1, 1)]
    }
}

public func trimmed(_ pixels: Pixels) -> Pixels {
    let rows = pixels.indices.filter { pixels[$0].contains { $0 != nil } }
    let columns = (pixels.first?.indices ?? 0..<0).filter { x in pixels.contains { $0[x] != nil } }
    guard let top = rows.first, let bottom = rows.last, let left = columns.first, let right = columns.last else { return [] }
    return pixels[top...bottom].map { Array($0[left...right]) }
}
