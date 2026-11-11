import Foundation

/// Read from Resources/characters.json, a format shared with claude-panel's Pi panel.
public struct CharacterTemplate: Decodable, Sendable {
    public let id: String
    public let label: String
    /// 16 rows of 16 cells: B body, D darker, L lighter, F face plate, P pink, "." empty.
    public let body: [String]
    /// Rows that replace the body from `row` down on alternate frames while working.
    public let walk: Walk?
    /// Top-left corners of the two 2×2 eyes.
    public let eyes: Eyes
    public let eyeColor: String?

    public struct Walk: Decodable, Sendable {
        public let row: Int
        public let rows: [String]
    }

    public struct Eyes: Decodable, Sendable {
        public let y: Int
        public let left: Int
        public let right: Int
    }

    /// The default comes first. The JSON ships inside the package, so failing to read it is a build bug.
    public static let all: [CharacterTemplate] = {
        guard let url = Bundle.module.url(forResource: "characters", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let characters = try? JSONDecoder().decode([CharacterTemplate].self, from: data),
              !characters.isEmpty
        else { fatalError("characters.json is missing or malformed in the PetsCore bundle") }
        return characters
    }()

    public static func named(_ id: String) -> CharacterTemplate {
        all.first { $0.id == id } ?? all[0]
    }
}
