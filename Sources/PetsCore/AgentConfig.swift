import Foundation

public enum AgentConfig {
    /// Written by the agent; the path mirrors agent/src/config.ts.
    public static let configFile = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/pets-ia/config.json")

    public static func token() -> String? {
        (try? Data(contentsOf: configFile)).flatMap(token(fromJSON:))
    }

    public static func token(fromJSON data: Data) -> String? {
        struct Saved: Decodable { let token: String? }
        guard let token = (try? JSONDecoder().decode(Saved.self, from: data))?.token, !token.isEmpty else { return nil }
        return token
    }

    public static func webSocketURL(token: String) -> URL {
        var components = URLComponents()
        components.scheme = "ws"
        components.host = "127.0.0.1"
        components.port = panelPort
        components.path = "/ws"
        // URLComponents leaves "+" and "=" alone in queries; the agent would read "+" as a space.
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+=&")
        components.percentEncodedQuery = "token=" + (token.addingPercentEncoding(withAllowedCharacters: allowed) ?? token)
        return components.url!
    }
}
