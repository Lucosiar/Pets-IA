import Foundation
import PetsCore

private let orange = RGB(hex: "#ff6b1a")!
private let blue = RGB(hex: "#4f7cff")!

func spriteTests() {
    test("parses and shades colors") {
        expectEqual(RGB(hex: "#d97757"), RGB(r: 0xd9, g: 0x77, b: 0x57))
        expectEqual(RGB(hex: "#D97757"), RGB(r: 0xd9, g: 0x77, b: 0x57))
        expectEqual(RGB(hex: "d97757"), nil)
        expectEqual(RGB(hex: "#d9775"), nil)
        expectEqual(RGB(hex: "#zz7757"), nil)
        expectEqual(RGB(hex: "#d97757")!.shaded(-0.35), RGB(hex: "#8d4d39"))
        expectEqual(RGB(hex: "#d97757")!.shaded(0.35), RGB(hex: "#e6a792"))
    }

    test("loads the shared character templates, default first") {
        expectEqual(CharacterTemplate.all.map(\.id), ["default", "robot", "ghost", "cat"])
    }

    for c in CharacterTemplate.all {
        test("\(c.id) is a well-formed 16×16 template") {
            expectEqual(c.body.count, 16)
            for row in c.body + (c.walk?.rows ?? []) {
                expect(row.count == 16 && row.allSatisfy { "BDLFP.".contains($0) }, "bad row \(row)")
            }
            if let walk = c.walk { expect(walk.row + walk.rows.count <= 16, "walk runs past the body") }
        }

        test("\(c.id) has both eyes on its body") {
            let rows = c.body.map(Array.init)
            for x in [c.eyes.left, c.eyes.right] {
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    expect(rows[c.eyes.y + dy][x + dx] != ".", "eye cell off the body at \(x + dx),\(c.eyes.y + dy)")
                }
            }
        }
    }

    test("every character and mood fits the sprite") {
        for c in CharacterTemplate.all {
            for mood in Mood.allCases {
                for frame in 0..<16 {
                    let pixels = spriteFrame(character: c.id, color: orange, mood: mood, frame: frame)
                    expect(pixels.count == spriteSize && pixels.allSatisfy { $0.count == spriteSize }, "\(c.id) \(mood) \(frame)")
                }
            }
        }
    }

    test("the body is tinted with the icon color") {
        expect(spriteFrame(character: "default", color: orange, mood: .idle, frame: 1).joined().contains(orange))
        expect(!spriteFrame(character: "default", color: blue, mood: .idle, frame: 1).joined().contains(orange))
    }

    test("unknown characters fall back to the default one") {
        expectEqual(
            spriteFrame(character: "nope", color: orange, mood: .idle, frame: 1),
            spriteFrame(character: "default", color: orange, mood: .idle, frame: 1)
        )
    }

    test("working moves between frames; idle stands still between blinks") {
        expect(spriteFrame(character: "default", color: orange, mood: .working, frame: 0)
            != spriteFrame(character: "default", color: orange, mood: .working, frame: 1))
        expectEqual(
            spriteFrame(character: "default", color: orange, mood: .idle, frame: 1),
            spriteFrame(character: "default", color: orange, mood: .idle, frame: 2)
        )
        expect(spriteFrame(character: "default", color: orange, mood: .idle, frame: 0)
            != spriteFrame(character: "default", color: orange, mood: .idle, frame: 1), "frame 0 blinks")
    }

    test("alert, asking, error and sleeping carry their overlay") {
        func has(_ mood: Mood, _ frame: Int, _ hex: String) -> Bool {
            spriteFrame(character: "default", color: orange, mood: mood, frame: frame).joined().contains(RGB(hex: hex)!)
        }
        expect(has(.alert, 0, "#ffd23f"))
        expect(has(.asking, 0, "#ffffff"))
        expect(has(.error, 0, "#ff4d4d"))
        expect(has(.sleeping, 0, "#c8d0dc"))
    }

    test("trimming drops the transparent margins around a sprite") {
        let red = RGB(hex: "#ff0000")!
        let pixels: Pixels = [
            [nil, nil, nil, nil],
            [nil, red, nil, nil],
            [nil, nil, red, nil],
            [nil, nil, nil, nil],
        ]
        expectEqual(trimmed(pixels), [[red, nil], [nil, red]])
        expectEqual(trimmed([[nil, nil], [nil, nil]]), [])
    }

    test("working hops two pixels and shows typing dots, so every character looks busy") {
        func top(_ pixels: Pixels) -> Int { pixels.firstIndex { $0.contains(orange) }! }
        for character in CharacterTemplate.all {
            let frames = (0..<4).map { spriteFrame(character: character.id, color: orange, mood: .working, frame: $0) }
            let tops = frames.map(top)
            expectEqual(tops.max()! - tops.min()!, 2)
            for frame in frames {
                expect(frame[0...5].contains { $0[17...].contains(RGB(hex: "#ffffff")!) }, "\(character.id) has dots")
            }
        }
    }

    test("a finished creature holds up a green check") {
        for frame in 0..<8 {
            expect(spriteFrame(character: "cat", color: orange, mood: .finished, frame: frame).joined().contains(RGB(hex: "#4cd964")!))
        }
        expect(!spriteFrame(character: "cat", color: orange, mood: .idle, frame: 1).joined().contains(RGB(hex: "#4cd964")!))
    }
}

