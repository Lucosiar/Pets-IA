import AppKit
import PetsCore

@MainActor
final class MenuBar: NSObject, NSMenuDelegate {
    private let link: AgentLink
    private let strip: StripController
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    init(link: AgentLink, strip: StripController) {
        self.link = link
        self.strip = strip
        super.init()
        item.button?.image = Self.icon()
        item.button?.imagePosition = .imageLeading
        item.button?.toolTip = "Pets IA"
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu

        track { [weak self] in
            guard let self else { return }
            let waiting = link.list.shown(at: Date()).filter(\.needsAttention).count
            item.button?.title = waiting > 0 ? " \(waiting)" : ""
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        menu.addItem(withTitle: statusText, action: nil, keyEquivalent: "")
        menu.addItem(.separator())

        menu.addItem(entry(strip.hidden ? "Mostrar la tira" : "Ocultar la tira", #selector(toggleStrip)))
        let edges = NSMenu()
        for edge in ScreenEdge.allCases {
            let choice = entry(edge == .left ? "Izquierda" : "Derecha", #selector(chooseEdge(_:)))
            choice.representedObject = edge.rawValue
            choice.state = strip.edge == edge ? .on : .off
            edges.addItem(choice)
        }
        let edgeItem = NSMenuItem(title: "Borde", action: nil, keyEquivalent: "")
        edgeItem.submenu = edges
        menu.addItem(edgeItem)

        menu.addItem(.separator())
        menu.addItem(withTitle: "Salir de Pets IA", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }

    private var statusText: String {
        switch link.status {
        case .online:
            let count = link.list.shown(at: Date()).count
            return "Conectado · \(count) \(count == 1 ? "sesión" : "sesiones")"
        case .connecting: return "Conectando con el agente…"
        case .offline: return "El agente no está en marcha · reintentando"
        case .notPaired: return "Agente sin configurar · reintentando"
        }
    }

    private func entry(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func toggleStrip() {
        strip.hidden.toggle()
    }

    @objc private func chooseEdge(_ sender: NSMenuItem) {
        if let edge = (sender.representedObject as? String).flatMap(ScreenEdge.init(rawValue:)) { strip.edge = edge }
    }

    private static func icon() -> NSImage {
        let character = CharacterTemplate.named("default")
        let eyes = character.eyes
        func isEye(_ x: Int, _ y: Int) -> Bool {
            let row = y == eyes.y || y == eyes.y + 1
            let column = x == eyes.left || x == eyes.left + 1 || x == eyes.right || x == eyes.right + 1
            return row && column
        }
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: true) { _ in
            NSColor.black.setFill()
            for (y, row) in character.body.enumerated() {
                for (x, cell) in row.enumerated() where cell != "." && !isEye(x, y) {
                    NSRect(x: x, y: y, width: 1, height: 1).fill()
                }
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}
