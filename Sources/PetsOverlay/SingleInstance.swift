import Foundation

enum SingleInstance {
    private static let lockFile = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/pets-ia/overlay.lock")

    /// The lock lasts as long as the process: the kernel drops it on exit, even after a crash.
    /// When the lock file can't be opened, running twice beats not running at all.
    static func claim() -> Bool {
        try? FileManager.default.createDirectory(at: lockFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        let descriptor = open(lockFile.path, O_RDWR | O_CREAT, 0o600)
        guard descriptor >= 0 else { return true }
        return flock(descriptor, LOCK_EX | LOCK_NB) == 0
    }
}
