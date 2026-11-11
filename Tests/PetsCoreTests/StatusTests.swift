import Foundation
import PetsCore

func statusTests() {
    test("maps states to moods") {
        expectEqual(session(state: .working).mood(at: now), .working)
        expectEqual(session(state: .needsPermission).mood(at: now), .alert)
        expectEqual(session(state: .needsInput).mood(at: now), .asking)
        expectEqual(session(state: .compacting).mood(at: now), .compacting)
        expectEqual(session(state: .error).mood(at: now), .error)
        expectEqual(session(state: .ended).mood(at: now), .sleeping)
    }

    test("a finished session waits for you, then dozes off after five minutes") {
        expectEqual(session(state: .done, stateSince: now - 60).mood(at: now), .finished)
        expectEqual(session(state: .idle, stateSince: now - 60).mood(at: now), .idle)
        expectEqual(session(state: .done, stateSince: now - 6 * 60).mood(at: now), .sleeping)
    }

    test("active: working or waiting on the user, or finished less than five minutes ago") {
        for state in [SessionState.working, .compacting, .needsPermission, .needsInput] {
            expect(session(state: state).isActive(at: now), "\(state)")
        }
        expect(session(state: .done, stateSince: now - 60).isActive(at: now))
        expect(session(state: .error, stateSince: now - 60).isActive(at: now))
        expect(!session(state: .done, stateSince: now - 6 * 60).isActive(at: now))
        expect(!session(state: .error, stateSince: now - 6 * 60).isActive(at: now))
        expect(!session(state: .idle).isActive(at: now))
        expect(!session(state: .ended, live: false).isActive(at: now))
        expect(!session(state: .working, live: false).isActive(at: now), "its process is gone")
    }

    test("only permission and input requests need the user") {
        let needy = SessionState.allCases.filter { session(state: $0).needsAttention }
        expectEqual(needy, [.needsPermission, .needsInput])
    }

    test("summarises the strip for its tab") {
        expectEqual(summary(of: []), "sin sesiones")
        expectEqual(summary(of: [session(state: .working)]), "1 sesión")
        expectEqual(summary(of: [session(state: .working), session(state: .done)]), "2 sesiones")
        expectEqual(summary(of: [session(state: .needsInput), session(state: .working)]), "1 te necesita")
        expectEqual(summary(of: [session(state: .needsInput), session(state: .needsPermission)]), "2 te necesitan")
    }

    test("ago") {
        expectEqual(ago(since: now, now: now), "ahora")
        expectEqual(ago(since: now + 30, now: now), "ahora")
        expectEqual(ago(since: now - 42, now: now), "42s")
        expectEqual(ago(since: now - 5 * 60, now: now), "5m")
        expectEqual(ago(since: now - 3 * 3600, now: now), "3h")
        expectEqual(ago(since: now - 2 * 86400, now: now), "2d")
    }

    test("statusLine") {
        expectEqual(session(state: .working, activity: "Bash: npm test").statusLine(at: now), "Bash: npm test")
        expectEqual(session(state: .working).statusLine(at: now), "trabajando")
        expectEqual(session(state: .done, stateSince: now - 5 * 60).statusLine(at: now), "terminado · 5m")
        expectEqual(session(state: .idle, stateSince: now - 42).statusLine(at: now), "en espera · 42s")
        expectEqual(session(state: .ended, live: false, stateSince: now - 2 * 3600).statusLine(at: now), "cerrada · 2h")
        expectEqual(
            session(state: .needsPermission, activity: "Claude needs your permission to use Bash").statusLine(at: now),
            "permiso · Claude needs your permission to use Bash"
        )
        expectEqual(session(state: .needsInput).statusLine(at: now), "esperando tu respuesta")
        expectEqual(session(state: .needsInput, activity: "Plan ready").statusLine(at: now), "Plan ready")
        expectEqual(session(state: .compacting).statusLine(at: now), "compactando")
        expectEqual(session(state: .error).statusLine(at: now), "error")
        expectEqual(session(state: .error, activity: "rate limited").statusLine(at: now), "error · rate limited")
    }
}
