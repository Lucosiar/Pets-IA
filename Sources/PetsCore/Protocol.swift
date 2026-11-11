import Foundation

// Mirrors shared/protocol.ts; keep the two in step, and compatible with claude-panel's Pi panel.

public let panelPort = 7788

public enum SessionState: String, CaseIterable, Sendable, Decodable {
    case idle // started, no prompt yet
    case working
    case needsPermission = "needs_permission"
    case needsInput = "needs_input"
    case compacting
    case done
    case error
    case ended // process gone; the session itself can be reopened

    /// Unknown states from a newer agent read as idle instead of failing the whole message.
    public init(from decoder: Decoder) throws {
        self = SessionState(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .idle
    }
}

public struct SessionIcon: Equatable, Sendable, Decodable {
    public var character: String
    public var color: String

    public init(character: String, color: String) {
        self.character = character
        self.color = color
    }

    public static let `default` = SessionIcon(character: "default", color: "#d97757")

    /// The colors the Pi panel offers, so a choice made on either face exists on the other.
    public static let palette: [(name: String, color: String)] = [
        ("Orange", "#ff6b1a"), ("Clay", "#d97757"), ("Yellow", "#ffd23f"), ("Green", "#4cd964"), ("Cyan", "#3ccfe6"),
        ("Blue", "#4f7cff"), ("Purple", "#a66cff"), ("Pink", "#ff5fa2"), ("White", "#e8e8e8"),
    ]
}

public struct PanelSession: Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var cwd: String
    public var state: SessionState
    public var activity: String?
    /// The Claude process is running.
    public var live: Bool
    public var stateSince: Date
    public var pinned: Bool
    public var position: Int?
    public var icon: SessionIcon
    /// "claude" or "codex".
    public var source: String = "claude"
    /// Where it runs: "desktop", "vscode", "app" or "terminal".
    public var origin: String = "terminal"

    public init(
        id: String, name: String, cwd: String, state: SessionState, activity: String?, live: Bool,
        stateSince: Date, pinned: Bool, position: Int?, icon: SessionIcon
    ) {
        self.id = id
        self.name = name
        self.cwd = cwd
        self.state = state
        self.activity = activity
        self.live = live
        self.stateSince = stateSince
        self.pinned = pinned
        self.position = position
        self.icon = icon
    }
}

extension PanelSession: Decodable {
    private enum Keys: String, CodingKey {
        case id, name, cwd, state, activity, live, stateSince, pinned, position, icon, source, origin
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let stateSinceEpochMs = try c.decode(Double.self, forKey: .stateSince)
        self.init(
            id: try c.decode(String.self, forKey: .id),
            name: try c.decode(String.self, forKey: .name),
            cwd: try c.decode(String.self, forKey: .cwd),
            state: try c.decode(SessionState.self, forKey: .state),
            activity: try c.decodeIfPresent(String.self, forKey: .activity),
            live: try c.decode(Bool.self, forKey: .live),
            stateSince: Date(timeIntervalSince1970: stateSinceEpochMs / 1000),
            pinned: try c.decode(Bool.self, forKey: .pinned),
            position: try c.decodeIfPresent(Int.self, forKey: .position),
            icon: try c.decode(SessionIcon.self, forKey: .icon)
        )
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "claude"
        origin = try c.decodeIfPresent(String.self, forKey: .origin) ?? "terminal"
    }

    /// "Codex · VS Code", "Claude · Desktop"...
    public var whereLabel: String {
        let tool = source == "codex" ? "Codex" : "Claude"
        let place: String
        switch origin {
        case "desktop": place = "Desktop"
        case "vscode": place = "VS Code"
        case "app": place = "App"
        default: place = "Terminal"
        }
        return "\(tool) · \(place)"
    }
}

/// A desktop-app session that can be pinned, running or not.
public struct LibraryEntry: Equatable, Sendable, Decodable {
    public var id: String
    public var name: String
    public var cwd: String
    public var lastActivityAt: Date
    public var pinned: Bool
    /// "claude" or "codex".
    public var source: String = "claude"

    public init(id: String, name: String, cwd: String, lastActivityAt: Date, pinned: Bool) {
        self.id = id
        self.name = name
        self.cwd = cwd
        self.lastActivityAt = lastActivityAt
        self.pinned = pinned
    }

    private enum Keys: String, CodingKey { case id, name, cwd, lastActivityAt, pinned, source }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let lastActivityEpochMs = try c.decode(Double.self, forKey: .lastActivityAt)
        self.init(
            id: try c.decode(String.self, forKey: .id),
            name: try c.decode(String.self, forKey: .name),
            cwd: try c.decode(String.self, forKey: .cwd),
            lastActivityAt: Date(timeIntervalSince1970: lastActivityEpochMs / 1000),
            pinned: try c.decode(Bool.self, forKey: .pinned)
        )
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "claude"
    }
}

public enum ServerMessage: Equatable, Sendable {
    case snapshot(sessions: [PanelSession], focusedId: String?)
    case session(PanelSession)
    case removed(id: String)
    /// The session in front in the desktop app.
    case focus(id: String?)
    case error(message: String)
    /// Reply to a library request, most recent first.
    case library([LibraryEntry])

    /// Nil for malformed or unknown messages.
    public static func parse(_ text: String) -> ServerMessage? {
        let data = Data(text.utf8)
        let decoder = JSONDecoder()
        guard let type = try? decoder.decode(Envelope.self, from: data).type else { return nil }
        switch type {
        case "snapshot":
            guard let m = try? decoder.decode(Snapshot.self, from: data) else { return nil }
            return .snapshot(sessions: m.sessions.compactMap(\.value), focusedId: m.focusedId)
        case "session":
            return (try? decoder.decode(SessionChange.self, from: data)).map { .session($0.session) }
        case "removed":
            return (try? decoder.decode(Removed.self, from: data)).map { .removed(id: $0.id) }
        case "focus":
            return (try? decoder.decode(Focus.self, from: data)).map { .focus(id: $0.id) }
        case "error":
            return (try? decoder.decode(Failure.self, from: data)).map { .error(message: $0.message) }
        case "library":
            return (try? decoder.decode(Library.self, from: data)).map { .library($0.sessions.compactMap(\.value)) }
        default:
            return nil
        }
    }

    private struct Envelope: Decodable { let type: String }
    private struct Snapshot: Decodable { let sessions: [Lenient<PanelSession>]; let focusedId: String? }
    private struct SessionChange: Decodable { let session: PanelSession }
    private struct Removed: Decodable { let id: String }
    private struct Focus: Decodable { let id: String? }
    private struct Failure: Decodable { let message: String }
    private struct Library: Decodable { let sessions: [Lenient<LibraryEntry>] }
}

/// Lets one unreadable session be skipped instead of failing the whole snapshot.
private struct Lenient<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}

public enum ClientMessage: Equatable, Sendable {
    case open(id: String)
    case pin(id: String, pinned: Bool)
    /// The agent stores icons with pins, so this also pins the session, and unpinning resets its icon.
    case icon(id: String, icon: SessionIcon)
    /// Asks for the desktop sessions that can be pinned; answered with `ServerMessage.library`.
    case library

    public var sessionId: String? {
        switch self {
        case .open(let id), .pin(let id, _), .icon(let id, _): return id
        case .library: return nil
        }
    }

    public var json: String {
        let object: [String: Any]
        switch self {
        case .open(let id):
            object = ["type": "open", "id": id]
        case .pin(let id, let pinned):
            object = ["type": "pin", "id": id, "pinned": pinned]
        case .icon(let id, let icon):
            object = ["type": "icon", "id": id, "icon": ["character": icon.character, "color": icon.color]]
        case .library:
            object = ["type": "library"]
        }
        let body = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return String(decoding: body, as: UTF8.self)
    }
}
