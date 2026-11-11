import Foundation

public struct Paint: Equatable, Sendable {
    public var rgb: RGB
    /// 0…1
    public var alpha: Double

    public init(rgb: RGB, alpha: Double = 1) {
        self.rgb = rgb
        self.alpha = alpha
    }

    public static let accent = Paint(rgb: RGB(hex: "#ff6b1a")!)
    public static let danger = Paint(rgb: RGB(hex: "#ff4d4d")!)
    /// A session that finished its turn and waits for the user's reply.
    public static let ready = Paint(rgb: RGB(hex: "#4cd964")!)

    public static func white(_ alpha: Double) -> Paint {
        Paint(rgb: RGB(r: 255, g: 255, b: 255), alpha: alpha)
    }

    func with(alpha: Double) -> Paint {
        Paint(rgb: rgb, alpha: alpha)
    }
}

public struct Tile: Equatable, Sendable {
    public var fill: Paint?
    public var border: Paint?
    /// Points.
    public var borderWidth: Double

    public init(fill: Paint? = nil, border: Paint? = nil, borderWidth: Double = 1.5) {
        self.fill = fill
        self.border = border
        self.borderWidth = borderWidth
    }
}

public struct CreatureAppearance: Equatable, Sendable {
    public let pixels: Pixels
    public let tile: Tile
    public let opacity: Double

    private init(pixels: Pixels, tile: Tile, opacity: Double) {
        self.pixels = pixels
        self.tile = tile
        self.opacity = opacity
    }

    /// The tile at the end of the strip that pins sessions: a plus in its middle.
    public static func addButton(hovered: Bool) -> CreatureAppearance {
        var pixels = Pixels(repeating: Array(repeating: nil, count: spriteSize), count: spriteSize)
        for x in 8...15 { for y in 11...12 { pixels[y][x] = controlColor } }
        for x in 11...12 { for y in 8...15 { pixels[y][x] = controlColor } }
        return CreatureAppearance(pixels: pixels, tile: hovered ? Tile(fill: .white(0.12)) : Tile(), opacity: 1)
    }

    /// The tab that collapses the strip: an arrow toward the edge while open, back out while collapsed.
    /// Collapsed, it carries the mark of its most urgent session.
    public static func tab(for sessions: [PanelSession], collapsed: Bool, edge: ScreenEdge, hovered: Bool, frame: Int, now: Date) -> CreatureAppearance {
        let chevron = ["...X", "..XX", ".XX.", "XX..", ".XX.", "..XX", "...X"]
        let (width, height) = StripLayout.tabPixels
        let left = (width - 4) / 2
        let top = (height - chevron.count) / 2
        let pointsRight = (edge == .right) != collapsed
        var pixels = Pixels(repeating: Array(repeating: nil, count: width), count: height)
        for (y, row) in chevron.enumerated() {
            for (x, cell) in row.enumerated() where cell == "X" {
                pixels[top + y][left + (pointsRight ? 3 - x : x)] = controlColor
            }
        }

        var tile = hovered ? Tile(fill: .white(0.12)) : Tile()
        let marks = sessions.compactMap { s in urgency(of: s, at: now).map { (session: s, rank: $0) } }
        if collapsed, let urgent = marks.min(by: { $0.rank < $1.rank })?.session {
            tile = marked(tile, by: urgent, frame: frame, now: now)
            if urgent.needsAttention { pixels = outlined(pixels) }
        }
        return CreatureAppearance(pixels: pixels, tile: tile, opacity: 1)
    }

    public init(session: PanelSession, focused: Bool, hovered: Bool, frame: Int, now: Date) {
        var tile = Tile()
        if hovered { tile.fill = .white(0.12) }
        if focused {
            tile.fill = .white(hovered ? 0.3 : 0.22)
            tile.border = .white(0.75)
        }
        tile = Self.marked(tile, by: session, frame: frame, now: now)

        var pixels = spriteFrame(character: session.icon.character, color: session.icon.tint, mood: session.mood(at: now), frame: frame)
        // An accent tile may share the sprite's color.
        if session.needsAttention { pixels = outlined(pixels) }
        if !session.live { pixels = grayscaled(pixels) }

        self.pixels = pixels
        self.tile = tile
        opacity = session.live ? 1 : 0.45
    }

    /// Attention outranks focus and hover.
    private static func marked(_ tile: Tile, by session: PanelSession, frame: Int, now: Date) -> Tile {
        var tile = tile
        switch session.state {
        case .needsPermission:
            tile = Tile(fill: frame % 4 < 2 ? .accent : Paint.accent.with(alpha: 0.25), border: .accent, borderWidth: 2)
        case .needsInput:
            tile = Tile(fill: Paint.accent.with(alpha: frame % 8 < 4 ? 0.35 : 0.2), border: .accent, borderWidth: 2)
        case .done where session.mood(at: now) == .finished:
            tile.border = .ready
        case .error:
            tile.border = .danger
        default:
            break
        }
        return tile
    }

    /// Lower is more urgent; nil carries no mark.
    private static func urgency(of session: PanelSession, at now: Date) -> Int? {
        switch session.state {
        case .needsPermission: return 0
        case .needsInput: return 1
        case .error: return 2
        case .done where session.mood(at: now) == .finished: return 3
        default: return nil
        }
    }
}

private let controlColor = RGB(hex: "#8b909a")!

private func outlined(_ pixels: Pixels) -> Pixels {
    let black = RGB(r: 0, g: 0, b: 0)
    func filled(_ x: Int, _ y: Int) -> Bool {
        pixels.indices.contains(y) && pixels[y].indices.contains(x) && pixels[y][x] != nil
    }
    var result = pixels
    for y in pixels.indices {
        for x in pixels[y].indices where pixels[y][x] == nil {
            let touchesSprite = filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)
            if touchesSprite { result[y][x] = black }
        }
    }
    return result
}

private func grayscaled(_ pixels: Pixels) -> Pixels {
    func gray(_ c: RGB) -> RGB {
        let r = 0.2126 * Double(c.r)
        let g = 0.7152 * Double(c.g)
        let b = 0.0722 * Double(c.b)
        let luma = UInt8((r + g + b).rounded())
        return RGB(r: luma, g: luma, b: luma)
    }
    return pixels.map { row in row.map { $0.map(gray) } }
}
