import AppKit
import Observation
import PetsCore

@MainActor
final class StripController {
    /// What the pointer can be over: a session's creature, the add button after the last one, or the tab.
    private enum Cell: Equatable {
        case session(String)
        case add
        case tab
    }

    private let link: AgentLink
    private let panel = OverlayPanel()
    private let view = StripView()
    private let label = HoverLabel()
    private var layout = StripLayout.fitting(count: 0, height: 0)
    /// The sessions the current layout has room for.
    private var shown: [PanelSession] = []
    private var hovered: Cell?
    private var clock: Timer?
    private static let framesPerSecond = 4.0
    private static let edgeKey = "edge"
    private static let collapsedKey = "collapsed"
    private var collapsed: Bool

    var hidden = false {
        didSet { relayout() }
    }

    var edge: ScreenEdge {
        didSet {
            Preferences.store.set(edge.rawValue, forKey: Self.edgeKey)
            relayout()
        }
    }

    init(link: AgentLink) {
        self.link = link
        edge = Preferences.store.string(forKey: Self.edgeKey).flatMap(ScreenEdge.init(rawValue:)) ?? .right
        collapsed = Preferences.store.bool(forKey: Self.collapsedKey)
        view.onHover = { [weak self] hit in self?.hover(hit) }
        view.onClick = { [weak self] hit in self?.click(hit) }
        view.menuFor = { [weak self] index in self?.menu(for: index) }
        panel.contentView = view

        track { [weak self] in self?.relayout() }
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.relayout() }
        }
    }

    private func relayout() {
        shown = link.list.shown(at: Date())
        // The screen with the menu bar.
        guard !hidden, let screen = NSScreen.screens.first else {
            panel.orderOut(nil)
            label.hide()
            stopClock()
            hovered = nil // no mouseExited arrives for a window taken off screen
            return
        }
        layout = StripLayout.fitting(count: shown.count + 1, height: screen.visibleFrame.height)
        let frame = layout.frame(in: screen.visibleFrame, edge: edge)
        if panel.frame != frame { panel.setFrame(frame, display: false) }
        view.arrange(layout, edge: edge, collapsed: collapsed)
        panel.orderFrontRegardless()
        startClock()
        render()
    }

    private func render() {
        let now = Date()
        let current = link.list.shown(at: now)
        // A finished session that dozes off leaves the strip, which then needs a new layout.
        guard current.map(\.id) == shown.map(\.id) else { return relayout() }
        shown = current

        let frame = Int(now.timeIntervalSinceReferenceDate * Self.framesPerSecond)
        if !collapsed {
            let focusedId = link.list.focusedId
            view.show(shown.map {
                CreatureAppearance(session: $0, focused: $0.id == focusedId, hovered: hovered == .session($0.id), frame: frame, now: now)
            } + [CreatureAppearance.addButton(hovered: hovered == .add)])
        }
        view.showTab(CreatureAppearance.tab(for: shown, collapsed: collapsed, edge: edge, hovered: hovered == .tab, frame: frame, now: now))

        let notice = link.notice
        let noticeCell = notice.map { $0.sessionId.map(Cell.session) ?? .add }
        guard let labelled = hovered ?? noticeCell, !collapsed || labelled == .tab,
              let content = labelContent(for: labelled, failure: noticeCell == labelled ? notice?.message : nil, now: now)
        else { return label.hide() }
        label.show(content)
    }

    private func labelContent(for cell: Cell, failure: String?, now: Date) -> HoverLabel.Content? {
        let failed = NSColor(paint: .danger)
        let strip = layout.stripRect(in: panel.frame, edge: edge)
        func content(_ name: String, _ status: String, _ color: NSColor, beside: CGRect, outside: CGRect? = nil) -> HoverLabel.Content {
            HoverLabel.Content(name: name, status: status, statusColor: color, frameBeside: beside, outside: outside ?? panel.frame, edge: edge)
        }
        switch cell {
        case .session(let id):
            guard let index = shown.firstIndex(where: { $0.id == id }) else { return nil }
            let session = shown[index]
            let color = failure != nil ? failed : session.needsAttention ? NSColor(paint: .accent) : Style.muted
            return content("\(session.name)  —  \(session.whereLabel)", failure ?? session.statusLine(at: now), color, beside: layout.cellFrame(index, in: strip))
        case .add:
            let status = failure ?? "fija una sesión de Claude o Codex"
            return content("Añadir sesión", status, failure != nil ? failed : Style.muted, beside: layout.cellFrame(shown.count, in: strip))
        case .tab:
            let tab = layout.tabRect(in: panel.frame, edge: edge, collapsed: collapsed)
            let color = shown.contains(where: \.needsAttention) ? NSColor(paint: .accent) : Style.muted
            return content(collapsed ? "Expand" : "Collapse", summary(of: shown), color, beside: tab, outside: collapsed ? tab : nil)
        }
    }

    private func cell(at index: Int) -> Cell? {
        if shown.indices.contains(index) { return .session(shown[index].id) }
        return index == shown.count ? .add : nil
    }

    private func startClock() {
        guard clock == nil else { return }
        let period = 1 / Self.framesPerSecond
        // Ticks land just after each frame boundary, so no frame is skipped or drawn twice.
        let firstTick = ((Date().timeIntervalSinceReferenceDate / period).rounded(.down) + 1) * period + 0.005
        let timer = Timer(fire: Date(timeIntervalSinceReferenceDate: firstTick), interval: period, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.render() }
        }
        timer.tolerance = 0.02
        RunLoop.main.add(timer, forMode: .common)
        clock = timer
    }

    private func stopClock() {
        clock?.invalidate()
        clock = nil
    }

    private func hover(_ hit: StripHit?) {
        let cell: Cell?
        switch hit {
        case .cell(let index)?: cell = self.cell(at: index)
        case .tab?: cell = .tab
        case nil: cell = nil
        }
        guard cell != hovered else { return }
        hovered = cell
        render()
    }

    private func menu(for index: Int) -> NSMenu? {
        guard case .session(let id)? = cell(at: index), let session = shown.first(where: { $0.id == id }) else { return nil }
        hover(nil) // the label would sit under the menu
        return CreatureMenu.make(for: session) { [link] message in link.send(message) }
    }

    private func click(_ hit: StripHit) {
        guard case .cell(let index) = hit else { return toggleCollapsed() }
        switch cell(at: index) {
        case .session(let id)?:
            link.send(.open(id: id))
        case .add?:
            hover(nil)
            link.requestLibrary { [weak self] entries in
                // Not from inside the agent's receive loop: the menu runs its own event loop until it closes.
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { self?.showLibrary(entries) }
                }
            }
        case .tab?, nil:
            break
        }
    }

    private func toggleCollapsed() {
        collapsed.toggle()
        Preferences.store.set(collapsed, forKey: Self.collapsedKey)
        hovered = nil // the tab slides out from under the pointer
        render()
        view.slide(collapsed: collapsed)
    }

    private func showLibrary(_ entries: [LibraryEntry]) {
        let menu = LibraryMenu.make(entries, now: Date()) { [link] message in link.send(message) }
        view.popUp(menu, atCell: shown.count)
    }
}

final class OverlayPanel: NSPanel {
    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isFloatingPanel = true
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isMovable = false
        animationBehavior = .none
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Calls `apply` now, then again after each change to the observable state it read.
@MainActor
func track(_ apply: @escaping @MainActor () -> Void) {
    withObservationTracking(apply) {
        Task { @MainActor in track(apply) }
    }
}

enum Preferences {
    static let store = UserDefaults(suiteName: "com.lucosiar.petsia") ?? .standard
}
