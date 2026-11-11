import CoreGraphics
import PetsCore

private let screen = CGRect(x: 0, y: 0, width: 1440, height: 900)

func stripLayoutTests() {
    test("creatures are as big as the screen allows, in steps that land on whole Retina pixels") {
        expectEqual(StripLayout.fitting(count: 3, height: 900).scale, 2)
        expectEqual(StripLayout.fitting(count: 20, height: 900).scale, 1.5)
        expectEqual(StripLayout.fitting(count: 40, height: 900).scale, 1)
    }

    test("the strip is one cell wide and one cell tall per creature, plus its inset; the tab sits beside it") {
        let layout = StripLayout.fitting(count: 3, height: 900)
        expectEqual(layout.cellSide, 56)
        expectEqual(layout.stripSize, CGSize(width: 56 + 2 * StripLayout.inset, height: 3 * 56 + 2 * StripLayout.inset))
        expectEqual(layout.tabSize, CGSize(width: 16, height: 42))
        expectEqual(layout.size, CGSize(width: layout.stripSize.width + layout.tabSize.width, height: layout.stripSize.height))
    }

    test("inside its frame, the strip sits against the edge and the tab at mid-height on its inner side") {
        let layout = StripLayout.fitting(count: 3, height: 900)
        let bounds = CGRect(origin: .zero, size: layout.size)
        expectEqual(layout.stripRect(in: bounds, edge: .right), CGRect(x: 16, y: 0, width: 64, height: 176))
        expectEqual(layout.tabRect(in: bounds, edge: .right, collapsed: false), CGRect(x: 0, y: 67, width: 16, height: 42))
        expectEqual(layout.stripRect(in: bounds, edge: .left), CGRect(x: 0, y: 0, width: 64, height: 176))
        expectEqual(layout.tabRect(in: bounds, edge: .left, collapsed: false), CGRect(x: 64, y: 67, width: 16, height: 42))
    }

    test("collapsing slides the strip past the edge, leaving only the tab against it") {
        let layout = StripLayout.fitting(count: 3, height: 900)
        let bounds = CGRect(origin: .zero, size: layout.size)
        expectEqual(layout.collapseOffset(edge: .right), 64)
        expectEqual(layout.collapseOffset(edge: .left), -64)
        expectEqual(layout.tabRect(in: bounds, edge: .right, collapsed: true), CGRect(x: 64, y: 67, width: 16, height: 42))
        expectEqual(layout.tabRect(in: bounds, edge: .left, collapsed: true), CGRect(x: 0, y: 67, width: 16, height: 42))
    }

    test("docks to the middle of the chosen edge") {
        let layout = StripLayout.fitting(count: 3, height: screen.height)
        let right = layout.frame(in: screen, edge: .right)
        expectEqual(right.maxX, screen.maxX)
        expectEqual(right.midY, screen.midY)
        expectEqual(right.size, layout.size)
        let left = layout.frame(in: screen.offsetBy(dx: 100, dy: 40), edge: .left)
        expectEqual(left.minX, 100)
        expectEqual(left.midY, screen.midY + 40)
    }

    test("a strip taller than the screen is cut to the screen") {
        let frame = StripLayout.fitting(count: 40, height: 900).frame(in: screen, edge: .right)
        expectEqual(frame.minY, screen.minY)
        expectEqual(frame.height, screen.height)
    }

    test("finds the creature or the tab under a point") {
        let layout = StripLayout.fitting(count: 3, height: 900)
        let bounds = CGRect(origin: .zero, size: layout.size)
        let inset = StripLayout.inset
        func hit(_ x: CGFloat, fromTop y: CGFloat, edge: ScreenEdge = .right, collapsed: Bool = false) -> StripHit? {
            layout.hit(CGPoint(x: x, y: bounds.maxY - y), in: bounds, edge: edge, collapsed: collapsed)
        }
        expectEqual(hit(40, fromTop: inset), .cell(0))
        expectEqual(hit(40, fromTop: inset + 55.9), .cell(0))
        expectEqual(hit(40, fromTop: inset + 56), .cell(1))
        expectEqual(hit(40, fromTop: inset + 3 * 56 - 1), .cell(2))
        expectEqual(hit(40, fromTop: inset - 1), nil)
        expectEqual(hit(40, fromTop: inset + 3 * 56), nil)
        expectEqual(hit(8, fromTop: 88), .tab)
        expectEqual(hit(8, fromTop: 20), nil)
        expectEqual(hit(72, fromTop: 88, edge: .left), .tab)
        expectEqual(hit(30, fromTop: inset, edge: .left), .cell(0))

        expectEqual(hit(72, fromTop: 88, collapsed: true), .tab)
        expectEqual(hit(40, fromTop: inset, collapsed: true), nil)
        expectEqual(hit(8, fromTop: 88, collapsed: true), nil)
        expectEqual(hit(8, fromTop: 88, edge: .left, collapsed: true), .tab)
    }

    test("places a cell, and its label facing into the screen, clear of the tab") {
        let layout = StripLayout.fitting(count: 3, height: 900)
        let frame = layout.frame(in: screen, edge: .right)
        let strip = layout.stripRect(in: frame, edge: .right)
        let cell = layout.cellFrame(1, in: strip)
        expectEqual(cell, CGRect(x: strip.minX + StripLayout.inset, y: strip.maxY - StripLayout.inset - 2 * 56, width: 56, height: 56))

        let label = CGSize(width: 200, height: 40)
        let onRight = StripLayout.labelFrame(size: label, beside: cell, outside: frame, edge: .right)
        expectEqual(onRight.maxX, frame.minX - StripLayout.labelGap)
        expectEqual(onRight.midY, cell.midY)
        let leftFrame = layout.frame(in: screen, edge: .left)
        let leftCell = layout.cellFrame(1, in: layout.stripRect(in: leftFrame, edge: .left))
        let onLeft = StripLayout.labelFrame(size: label, beside: leftCell, outside: leftFrame, edge: .left)
        expectEqual(onLeft.minX, leftFrame.maxX + StripLayout.labelGap)
    }

    test("inside a cell, the tile leaves one sprite pixel of margin and the sprite sits centred") {
        let layout = StripLayout.fitting(count: 3, height: 900)
        let cell = CGRect(x: 10, y: 20, width: 56, height: 56)
        expectEqual(layout.tileRect(in: cell), CGRect(x: 12, y: 22, width: 52, height: 52))
        expectEqual(layout.spriteRect(in: cell), CGRect(x: 14, y: 24, width: 48, height: 48))
    }
}
