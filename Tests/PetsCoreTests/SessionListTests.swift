import Foundation
import PetsCore

func sessionListTests() {
    test("a snapshot replaces everything") {
        var list = SessionList()
        list.apply(.session(session(name: "stale")))
        let fresh = session(name: "fresh")
        list.apply(.snapshot(sessions: [fresh], focusedId: fresh.id))
        expectEqual(list.shown(at: now).map(\.name), ["fresh"])
        expectEqual(list.focusedId, fresh.id)
    }

    test("session upserts, removed deletes, focus moves") {
        var list = SessionList()
        var a = session(name: "a")
        list.apply(.session(a))
        a.state = .working
        list.apply(.session(a))
        expectEqual(list.shown(at: now).map(\.state), [.working])

        list.apply(.focus(id: a.id))
        expectEqual(list.focusedId, a.id)
        list.apply(.removed(id: a.id))
        expectEqual(list.shown(at: now).count, 0)
        list.apply(.focus(id: nil))
        expectEqual(list.focusedId, nil)
    }

    test("errors leave the list alone") {
        var list = SessionList()
        list.apply(.session(session()))
        let before = list
        list.apply(.error(message: "boom"))
        expectEqual(list, before)
    }

    test("shows pinned sessions by position, then the active unpinned ones by name") {
        var list = SessionList()
        list.apply(.snapshot(sessions: [
            session(name: "zeta", state: .working),
            session(name: "pinned second", state: .idle, pinned: true, position: 1),
            session(name: "alpha", state: .needsInput),
            session(name: "open but resting", state: .idle),
            session(name: "finished long ago", state: .done, stateSince: now - 3600),
            session(name: "gone", state: .ended, live: false),
            session(name: "pinned first", state: .ended, live: false, pinned: true, position: 0),
        ], focusedId: nil))
        expectEqual(list.shown(at: now).map(\.name), ["pinned first", "pinned second", "alpha", "zeta"])
    }

    test("sessions with the same name keep a stable order") {
        var list = SessionList()
        let twins = [session(name: "twin"), session(name: "twin")]
        list.apply(.snapshot(sessions: twins.reversed(), focusedId: nil))
        expectEqual(list.shown(at: now).map(\.id), twins.map(\.id))
    }
}
