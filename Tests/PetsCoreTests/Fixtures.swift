import Foundation
import PetsCore

let now = Date(timeIntervalSince1970: 10_000)
private var sequence = 0

func session(
    name: String? = nil,
    state: SessionState = .done,
    activity: String? = nil,
    live: Bool = true,
    stateSince: Date = now,
    pinned: Bool = false,
    position: Int? = nil
) -> PanelSession {
    sequence += 1
    return PanelSession(
        id: String(format: "00000000-0000-0000-0000-%012d", sequence),
        name: name ?? "session \(sequence)",
        cwd: "/tmp",
        state: state,
        activity: activity,
        live: live,
        stateSince: stateSince,
        pinned: pinned,
        position: position,
        icon: .default
    )
}
