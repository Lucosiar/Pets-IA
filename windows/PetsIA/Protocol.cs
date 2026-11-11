// Mirrors shared/protocol.ts; keep the two in step.
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace PetsIA;

public enum SessionState { Idle, Working, NeedsPermission, NeedsInput, Compacting, Done, Error, Ended }

public sealed record SessionIcon(string Character, string Color)
{
    public static readonly SessionIcon Default = new("default", "#d97757");

    /// The colors the Mac strip offers too.
    public static readonly (string Name, string Color)[] Palette =
    {
        ("Naranja", "#ff6b1a"), ("Arcilla", "#d97757"), ("Amarillo", "#ffd23f"), ("Verde", "#4cd964"), ("Cian", "#3ccfe6"),
        ("Azul", "#4f7cff"), ("Morado", "#a66cff"), ("Rosa", "#ff5fa2"), ("Blanco", "#e8e8e8"),
    };
}

public sealed partial class PanelSession
{
    public string Id = "";
    public string Name = "";
    public string Cwd = "";
    public SessionState State;
    public string? Activity;
    /// The tool's process is running.
    public bool Live;
    public DateTimeOffset StateSince;
    public bool Pinned;
    public int? Position;
    public SessionIcon Icon = SessionIcon.Default;
    /// "claude" or "codex".
    public string Source = "claude";
    /// "desktop", "vscode", "app" or "terminal".
    public string Origin = "terminal";

    public string WhereLabel
    {
        get
        {
            var tool = Source == "codex" ? "Codex" : "Claude";
            var place = Origin switch { "desktop" => "Desktop", "vscode" => "VS Code", "app" => "App", _ => "Terminal" };
            return $"{tool} · {place}";
        }
    }
}

public sealed class LibraryEntry
{
    public string Id = "";
    public string Name = "";
    public string Cwd = "";
    public DateTimeOffset LastActivityAt;
    public bool Pinned;
    public string Source = "claude";
    public string Origin = "terminal";
}

public abstract record ServerMessage
{
    public sealed record Snapshot(List<PanelSession> Sessions, string? FocusedId) : ServerMessage;
    public sealed record Session(PanelSession Value) : ServerMessage;
    public sealed record Removed(string Id) : ServerMessage;
    public sealed record Focus(string? Id) : ServerMessage;
    public sealed record Library(List<LibraryEntry> Sessions) : ServerMessage;
    public sealed record Failure(string Message) : ServerMessage;

    /// Null for malformed or unknown messages; one unreadable session is skipped, not the whole snapshot.
    public static ServerMessage? Parse(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            switch (Str(root, "type"))
            {
                case "snapshot":
                    var sessions = new List<PanelSession>();
                    if (root.TryGetProperty("sessions", out var list) && list.ValueKind == JsonValueKind.Array)
                        foreach (var item in list.EnumerateArray())
                            if (ReadSession(item) is { } s) sessions.Add(s);
                    return new Snapshot(sessions, Str(root, "focusedId"));
                case "session":
                    return root.TryGetProperty("session", out var one) && ReadSession(one) is { } session ? new Session(session) : null;
                case "removed":
                    return Str(root, "id") is { } id ? new Removed(id) : null;
                case "focus":
                    return new Focus(Str(root, "id"));
                case "library":
                    var entries = new List<LibraryEntry>();
                    if (root.TryGetProperty("sessions", out var lib) && lib.ValueKind == JsonValueKind.Array)
                        foreach (var item in lib.EnumerateArray())
                            if (ReadEntry(item) is { } e) entries.Add(e);
                    return new Library(entries);
                case "error":
                    return new Failure(Str(root, "message") ?? "error");
                default:
                    return null;
            }
        }
        catch (JsonException)
        {
            return null;
        }
    }

    static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    static bool Bool(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    static DateTimeOffset Epoch(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? DateTimeOffset.FromUnixTimeMilliseconds((long)v.GetDouble())
            : DateTimeOffset.UnixEpoch;

    static SessionState ParseState(string? s) => s switch
    {
        "working" => SessionState.Working,
        "needs_permission" => SessionState.NeedsPermission,
        "needs_input" => SessionState.NeedsInput,
        "compacting" => SessionState.Compacting,
        "done" => SessionState.Done,
        "error" => SessionState.Error,
        "ended" => SessionState.Ended,
        _ => SessionState.Idle, // unknown states from a newer agent read as idle
    };

    static PanelSession? ReadSession(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object || Str(e, "id") is not { } id) return null;
        var icon = SessionIcon.Default;
        if (e.TryGetProperty("icon", out var i) && Str(i, "character") is { } ch && Str(i, "color") is { } color) icon = new SessionIcon(ch, color);
        int? position = e.TryGetProperty("position", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : null;
        return new PanelSession
        {
            Id = id,
            Name = Str(e, "name") ?? "",
            Cwd = Str(e, "cwd") ?? "",
            State = ParseState(Str(e, "state")),
            Activity = Str(e, "activity"),
            Live = Bool(e, "live"),
            StateSince = Epoch(e, "stateSince"),
            Pinned = Bool(e, "pinned"),
            Position = position,
            Icon = icon,
            Source = Str(e, "source") ?? "claude",
            Origin = Str(e, "origin") ?? "terminal",
        };
    }

    static LibraryEntry? ReadEntry(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object || Str(e, "id") is not { } id) return null;
        return new LibraryEntry
        {
            Id = id,
            Name = Str(e, "name") ?? "",
            Cwd = Str(e, "cwd") ?? "",
            LastActivityAt = Epoch(e, "lastActivityAt"),
            Pinned = Bool(e, "pinned"),
            Source = Str(e, "source") ?? "claude",
            Origin = Str(e, "origin") ?? "terminal",
        };
    }
}

public static class ClientMessage
{
    public static string Open(string id) => JsonSerializer.Serialize(new { type = "open", id });
    public static string Pin(string id, bool pinned) => JsonSerializer.Serialize(new { type = "pin", id, pinned });
    public static string Icon(string id, SessionIcon icon) =>
        JsonSerializer.Serialize(new { type = "icon", id, icon = new { character = icon.Character, color = icon.Color } });
    public static string Library() => JsonSerializer.Serialize(new { type = "library" });
}
