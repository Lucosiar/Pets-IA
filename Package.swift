// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PetsIA",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "petsia-overlay", targets: ["PetsOverlay"]),
        .library(name: "PetsCore", targets: ["PetsCore"]),
    ],
    targets: [
        .target(name: "PetsCore", resources: [.copy("Resources/characters.json")]),
        .executableTarget(name: "PetsOverlay", dependencies: ["PetsCore"]),
        // Command Line Tools 15 ship no XCTest, so the tests are an executable: `swift run PetsCoreTests`.
        .executableTarget(name: "PetsCoreTests", dependencies: ["PetsCore"], path: "Tests/PetsCoreTests"),
    ]
)
