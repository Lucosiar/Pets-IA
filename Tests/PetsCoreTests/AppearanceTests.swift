import Foundation
import PetsCore

private let black = RGB(r: 0, g: 0, b: 0)

private func look(_ s: PanelSession, focused: Bool = false, hovered: Bool = false, frame: Int = 1) -> CreatureAppearance {
    CreatureAppearance(session: s, focused: focused, hovered: hovered, frame: frame, now: now)
}

func appearanceTests() {
    test("a plain session is its sprite on a bare tile") {
        let s = session(state: .idle)
        let a = look(s)
        expectEqual(a.tile, Tile())
        expectEqual(a.opacity, 1)
        expectEqual(a.pixels, spriteFrame(character: s.icon.character, color: s.icon.tint, mood: .idle, frame: 1))
    }

    test("hover tints the tile; focus tints it more and rings it") {
        expectEqual(look(session(state: .idle), hovered: true).tile, Tile(fill: .white(0.12)))
        expectEqual(look(session(state: .idle), focused: true).tile, Tile(fill: .white(0.22), border: .white(0.75)))
        expectEqual(look(session(state: .idle), focused: true, hovered: true).tile.fill, .white(0.3))
    }

    test("a permission request blinks the tile in accent once a second, even when focused") {
        for focused in [false, true] {
            let lit = look(session(state: .needsPermission), focused: focused, frame: 0).tile
            let dim = look(session(state: .needsPermission), focused: focused, frame: 2).tile
            expectEqual(lit, Tile(fill: .accent, border: .accent, borderWidth: 2))
            expectEqual(dim, Tile(fill: Paint(rgb: Paint.accent.rgb, alpha: 0.25), border: .accent, borderWidth: 2))
            expectEqual(look(session(state: .needsPermission), focused: focused, frame: 4).tile, lit)
        }
    }

    test("waiting for input rings the tile in accent and pulses its fill") {
        let pulse = (0..<8).map { look(session(state: .needsInput), frame: $0).tile }
        expect(pulse.allSatisfy { $0.border == .accent && $0.borderWidth == 2 })
        expectEqual(pulse[0].fill, Paint(rgb: Paint.accent.rgb, alpha: 0.35))
        expectEqual(pulse[4].fill, Paint(rgb: Paint.accent.rgb, alpha: 0.2))
    }

    test("a finished session is ringed in green until it dozes off, even when it's in front") {
        expectEqual(look(session(state: .done, stateSince: now - 60)).tile, Tile(border: .ready))
        expectEqual(look(session(state: .done, stateSince: now - 60), focused: true).tile, Tile(fill: .white(0.22), border: .ready))
        expectEqual(look(session(state: .done, stateSince: now - 6 * 60)).tile, Tile())
    }

    test("errors ring the tile in the danger color") {
        expectEqual(look(session(state: .error)).tile.border, .danger)
    }

    test("a creature on an accent tile gets a black outline around its sprite") {
        let s = session(state: .needsPermission)
        let plain = spriteFrame(character: s.icon.character, color: s.icon.tint, mood: .alert, frame: 1)
        let outlined = look(s).pixels
        for y in 0..<spriteSize {
            for x in 0..<spriteSize {
                if let c = plain[y][x] { expectEqual(outlined[y][x], c); continue }
                let touches = [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)].contains { nx, ny in
                    (0..<spriteSize).contains(nx) && (0..<spriteSize).contains(ny) && plain[ny][nx] != nil
                }
                expectEqual(outlined[y][x], touches ? black : nil)
            }
        }
        expect(!look(session(state: .done)).pixels.joined().contains(black), "no outline on a bare tile")
    }

    test("a closed session's creature is grey and faded") {
        let a = look(session(state: .ended, live: false))
        expectEqual(a.opacity, 0.45)
        expect(a.pixels.joined().compactMap { $0 }.allSatisfy { $0.r == $0.g && $0.g == $0.b })
        expect(a.pixels.joined().contains { $0 != nil })
    }

    test("the add button is a plus in the middle of its tile, which hover lights") {
        let plain = CreatureAppearance.addButton(hovered: false)
        expectEqual(plain.tile, Tile())
        expectEqual(plain.opacity, 1)
        expectEqual(CreatureAppearance.addButton(hovered: true).tile, Tile(fill: .white(0.12)))

        var lit = Set<[Int]>()
        for (y, row) in plain.pixels.enumerated() {
            for (x, color) in row.enumerated() where color != nil { lit.insert([x, y]) }
        }
        expect(lit.contains([11, 11]) && lit.contains([12, 12]), "the centre is lit")
        expect(lit.allSatisfy { lit.contains([23 - $0[0], $0[1]]) && lit.contains([$0[0], 23 - $0[1]]) }, "centred both ways")
        expect(lit.allSatisfy { $0[0] == 11 || $0[0] == 12 || $0[1] == 11 || $0[1] == 12 }, "only the two arms")
    }

    test("the tab's arrow points toward the edge while open, and back into the screen while collapsed") {
        func arrow(_ edge: ScreenEdge, collapsed: Bool) -> Pixels {
            CreatureAppearance.tab(for: [], collapsed: collapsed, edge: edge, hovered: false, frame: 1, now: now).pixels
        }
        func pointing(_ pixels: Pixels) -> ScreenEdge? {
            let lit = pixels.enumerated().flatMap { y, row in row.indices.filter { row[$0] != nil }.map { (x: $0, y: y) } }
            let tip = lit.filter { $0.y == pixels.count / 2 }.map(\.x)
            if tip.max() == lit.map(\.x).max() && tip.min()! > lit.map(\.x).min()! { return .right }
            if tip.min() == lit.map(\.x).min() && tip.max()! < lit.map(\.x).max()! { return .left }
            return nil
        }
        let open = arrow(.right, collapsed: false)
        expectEqual(open.count, 21)
        expect(open.allSatisfy { $0.count == 8 }, "fills the 8×21 tab")
        expectEqual(open, Array(open.reversed()))
        expectEqual(pointing(open), .right)
        expectEqual(pointing(arrow(.right, collapsed: true)), .left)
        expectEqual(pointing(arrow(.left, collapsed: false)), .left)
        expectEqual(pointing(arrow(.left, collapsed: true)), .right)
    }

    test("a collapsed tab carries the mark of its most urgent session") {
        func tab(_ sessions: [PanelSession], collapsed: Bool = true, hovered: Bool = false) -> CreatureAppearance {
            CreatureAppearance.tab(for: sessions, collapsed: collapsed, edge: .right, hovered: hovered, frame: 0, now: now)
        }
        let finished = session(state: .done, stateSince: now - 60)
        let failed = session(state: .error)
        let asking = session(state: .needsInput)
        let blocked = session(state: .needsPermission)
        expectEqual(tab([]).tile, Tile())
        expectEqual(tab([session(state: .working), session(state: .done, stateSince: now - 6 * 60)]).tile, Tile())
        expectEqual(tab([finished]).tile, Tile(border: .ready))
        expectEqual(tab([finished, failed]).tile, Tile(border: .danger))
        expectEqual(tab([finished, asking, failed]).tile, look(asking, frame: 0).tile)
        expectEqual(tab([asking, finished, blocked]).tile, look(blocked, frame: 0).tile)
        expect(tab([blocked]).pixels.joined().contains(black), "outlined on an accent tile")
        expect(!tab([finished]).pixels.joined().contains(black), "no outline on a bare tile")
        expect(tab([blocked], collapsed: false).tile == Tile(), "while open, the creatures show it")
    }

    test("hovering the tab tints it, under any mark") {
        func tab(_ sessions: [PanelSession], collapsed: Bool) -> Tile {
            CreatureAppearance.tab(for: sessions, collapsed: collapsed, edge: .right, hovered: true, frame: 0, now: now).tile
        }
        expectEqual(tab([], collapsed: false), Tile(fill: .white(0.12)))
        expectEqual(tab([], collapsed: true), Tile(fill: .white(0.12)))
        expectEqual(tab([session(state: .done, stateSince: now - 60)], collapsed: true), Tile(fill: .white(0.12), border: .ready))
    }
}
