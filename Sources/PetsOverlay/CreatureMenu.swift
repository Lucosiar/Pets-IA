import AppKit
import PetsCore

enum CreatureMenu {
    static func make(for session: PanelSession, send: @escaping (ClientMessage) -> Void) -> NSMenu {
        let id = session.id
        let icon = session.icon
        let menu = NSMenu()
        menu.addItem(.sectionHeader(title: session.name))
        menu.addItem(ActionItem("Abrir") { send(.open(id: id)) })
        menu.addItem(ActionItem(session.pinned ? "Quitar de la tira" : "Fijar en la tira") { send(.pin(id: id, pinned: !session.pinned)) })
        menu.addItem(.separator())

        let characters = NSMenu()
        for character in CharacterTemplate.all {
            characters.addItem(ActionItem(
                character.label,
                image: preview(of: character.id, in: icon.tint),
                checked: character.id == CharacterTemplate.named(icon.character).id
            ) {
                send(.icon(id: id, icon: SessionIcon(character: character.id, color: icon.color)))
            })
        }
        menu.addItem(submenu("Personaje", characters, image: preview(of: icon.character, in: icon.tint)))

        let colors = NSMenu()
        for (name, color) in SessionIcon.palette {
            colors.addItem(ActionItem(name, image: swatch(color), checked: color == icon.color.lowercased()) {
                send(.icon(id: id, icon: SessionIcon(character: icon.character, color: color)))
            })
        }
        menu.addItem(submenu("Color", colors, image: swatch(icon.color)))
        return menu
    }

    private static func submenu(_ title: String, _ menu: NSMenu, image: NSImage) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.image = image
        item.submenu = menu
        return item
    }

    private static let previewPointsPerPixel: CGFloat = 2

    private static func preview(of character: String, in color: RGB) -> NSImage {
        let pixels = trimmed(spriteFrame(character: character, color: color, mood: .idle, frame: 1))
        let image = CGImage.sprite(pixels)
        let side = CGFloat(CharacterTemplate.named(character).body.count) * previewPointsPerPixel
        let size = CGSize(width: CGFloat(pixels.first?.count ?? 0), height: CGFloat(pixels.count))
        return NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
            guard let image, let context = NSGraphicsContext.current else { return false }
            context.imageInterpolation = .none
            let drawn = CGSize(width: size.width * previewPointsPerPixel, height: size.height * previewPointsPerPixel)
            context.cgContext.draw(image, in: CGRect(x: rect.midX - drawn.width / 2, y: rect.midY - drawn.height / 2, width: drawn.width, height: drawn.height))
            return true
        }
    }

    private static func swatch(_ color: String) -> NSImage {
        let paint = Paint(rgb: RGB(hex: color) ?? SessionIcon.default.tint)
        return NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
            let circle = NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1))
            NSColor(paint: paint).setFill()
            circle.fill()
            NSColor(white: 0, alpha: 0.25).setStroke()
            circle.stroke()
            return true
        }
    }
}

enum LibraryMenu {
    /// The Claude app's sessions, most recent first; choosing one pins it, or unpins it when it already is.
    static func make(_ entries: [LibraryEntry], now: Date, send: @escaping (ClientMessage) -> Void) -> NSMenu {
        let menu = NSMenu()
        menu.addItem(.sectionHeader(title: "Fijar una sesión"))
        if entries.isEmpty {
            menu.addItem(withTitle: "No hay sesiones de Claude ni de Codex", action: nil, keyEquivalent: "")
        }
        for entry in entries {
            let item = ActionItem(entry.name, checked: entry.pinned) { send(.pin(id: entry.id, pinned: !entry.pinned)) }
            let title = NSMutableAttributedString(string: "\(entry.source == "codex" ? "Codex" : "Claude") — \(entry.name)")
            title.append(NSAttributedString(
                string: "  \(ago(since: entry.lastActivityAt, now: now))",
                attributes: [.foregroundColor: NSColor.secondaryLabelColor]
            ))
            item.attributedTitle = title
            item.toolTip = entry.cwd
            menu.addItem(item)
        }
        return menu
    }
}

private final class ActionItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, image: NSImage? = nil, checked: Bool = false, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: "")
        target = self
        self.image = image
        state = checked ? .on : .off
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("not used") }

    @objc private func run() {
        handler()
    }
}
