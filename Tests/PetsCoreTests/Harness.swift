import Foundation

private var testCount = 0
private var failedChecks: [String] = []
private var currentTest = ""

func test(_ name: String, _ body: () throws -> Void) {
    currentTest = name
    testCount += 1
    do {
        try body()
    } catch {
        failedChecks.append("\(name): threw \(error)")
    }
}

func expect(_ condition: Bool, _ message: @autoclosure () -> String = "", file: StaticString = #fileID, line: UInt = #line) {
    if !condition { failedChecks.append("\(file):\(line) \(currentTest): \(message())") }
}

func expectEqual<T: Equatable>(_ actual: T, _ expected: T, file: StaticString = #fileID, line: UInt = #line) {
    expect(actual == expected, "expected \(expected), got \(actual)", file: file, line: line)
}

func finish() -> Never {
    for failure in failedChecks { print("FAIL \(failure)") }
    print("\(testCount) tests, \(failedChecks.count) failed checks")
    exit(failedChecks.isEmpty ? 0 : 1)
}
