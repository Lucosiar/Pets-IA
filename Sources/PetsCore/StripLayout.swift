import CoreGraphics

public enum ScreenEdge: String, CaseIterable, Sendable {
    case left, right
}

public enum StripHit: Equatable, Sendable {
    case cell(Int)
    case tab
}

/// Points, with AppKit's bottom-left origin unless noted.
///
/// The frame holds the strip against the screen edge and the tab beside it, on the strip's inner side.
/// Collapsing slides both toward the edge by `collapseOffset(edge:)`, which leaves only the tab on screen.
public struct StripLayout: Equatable, Sendable {
    public static let inset: CGFloat = 4
    public static let labelGap: CGFloat = 6
    /// Sprite pixels.
    public static let tabPixels = (width: 8, height: 21)
    private static let cellPaddingPixels = 2
    private static let cellPixels = CGFloat(spriteSize + 2 * cellPaddingPixels)
    /// Halves keep every sprite pixel on whole Retina pixels.
    private static let scales: [CGFloat] = [2, 1.5, 1]

    public let count: Int
    /// Points per sprite pixel.
    public let scale: CGFloat

    public var cellSide: CGFloat { scale * Self.cellPixels }

    public var stripSize: CGSize {
        CGSize(width: cellSide + 2 * Self.inset, height: CGFloat(count) * cellSide + 2 * Self.inset)
    }

    public var tabSize: CGSize {
        CGSize(width: CGFloat(Self.tabPixels.width) * scale, height: CGFloat(Self.tabPixels.height) * scale)
    }

    public var size: CGSize {
        CGSize(width: stripSize.width + tabSize.width, height: stripSize.height)
    }

    /// Past the smallest scale the strip overflows, and `frame(in:edge:)` cuts it to the screen.
    public static func fitting(count: Int, height: CGFloat) -> StripLayout {
        let pixels = CGFloat(count) * cellPixels
        let fits = { (scale: CGFloat) -> Bool in pixels * scale + 2 * inset <= height }
        return StripLayout(count: count, scale: scales.first(where: fits) ?? scales[scales.count - 1])
    }

    public func frame(in visible: CGRect, edge: ScreenEdge) -> CGRect {
        let height = min(size.height, visible.height)
        let x = edge == .right ? visible.maxX - size.width : visible.minX
        return CGRect(x: x, y: visible.midY - height / 2, width: size.width, height: height)
    }

    public func stripRect(in frame: CGRect, edge: ScreenEdge) -> CGRect {
        let x = edge == .right ? frame.maxX - stripSize.width : frame.minX
        return CGRect(x: x, y: frame.minY, width: stripSize.width, height: frame.height)
    }

    public func tabRect(in frame: CGRect, edge: ScreenEdge, collapsed: Bool) -> CGRect {
        let x = edge == .right ? frame.minX : frame.maxX - tabSize.width
        let open = CGRect(x: x, y: (frame.midY - tabSize.height / 2).rounded(.down), width: tabSize.width, height: tabSize.height)
        return collapsed ? open.offsetBy(dx: collapseOffset(edge: edge), dy: 0) : open
    }

    public func collapseOffset(edge: ScreenEdge) -> CGFloat {
        edge == .right ? stripSize.width : -stripSize.width
    }

    public func hit(_ point: CGPoint, in frame: CGRect, edge: ScreenEdge, collapsed: Bool) -> StripHit? {
        if tabRect(in: frame, edge: edge, collapsed: collapsed).contains(point) { return .tab }
        guard !collapsed, stripRect(in: frame, edge: edge).contains(point) else { return nil }
        return index(atY: frame.maxY - point.y).map(StripHit.cell)
    }

    /// `y` is measured down from the strip's top edge.
    private func index(atY y: CGFloat) -> Int? {
        guard y >= Self.inset else { return nil }
        let index = Int((y - Self.inset) / cellSide)
        return index < count ? index : nil
    }

    public func tileRect(in cell: CGRect) -> CGRect {
        cell.insetBy(dx: scale, dy: scale)
    }

    public func spriteRect(in cell: CGRect) -> CGRect {
        let inset = CGFloat(Self.cellPaddingPixels) * scale
        return cell.insetBy(dx: inset, dy: inset)
    }

    public func cellFrame(_ index: Int, in strip: CGRect) -> CGRect {
        CGRect(
            x: strip.minX + Self.inset,
            y: strip.maxY - Self.inset - CGFloat(index + 1) * cellSide,
            width: cellSide,
            height: cellSide
        )
    }

    /// Beside `item`'s middle, facing into the screen and clear of `outside`.
    public static func labelFrame(size: CGSize, beside item: CGRect, outside: CGRect, edge: ScreenEdge) -> CGRect {
        let x = edge == .right ? outside.minX - labelGap - size.width : outside.maxX + labelGap
        return CGRect(x: x, y: item.midY - size.height / 2, width: size.width, height: size.height)
    }
}
