// Port of Sources/PetsCore/Status.swift and SessionList.swift.
using System;
using System.Collections.Generic;
using System.Linq;

namespace PetsIA;

public sealed partial class PanelSession
{
    static readonly TimeSpan DozeAfter = TimeSpan.FromMinutes(5);

    public bool NeedsAttention => State is SessionState.NeedsPermission or SessionState.NeedsInput;

    /// Doing something or waiting on the user, or finished recently: the strip shows these even unpinned.
    public bool IsActive(DateTimeOffset now)
    {
        if (!Live) return false;
        return State switch
        {
            SessionState.Working or SessionState.Compacting or SessionState.NeedsPermission or SessionState.NeedsInput => true,
            SessionState.Done or SessionState.Error => now - StateSince <= DozeAfter,
            _ => false,
        };
    }

    public Mood MoodAt(DateTimeOffset now) => State switch
    {
        SessionState.Working => PetsIA.Mood.Working,
        SessionState.NeedsPermission => PetsIA.Mood.Alert,
        SessionState.NeedsInput => PetsIA.Mood.Asking,
        SessionState.Compacting => PetsIA.Mood.Compacting,
        SessionState.Error => PetsIA.Mood.Error,
        SessionState.Ended => PetsIA.Mood.Sleeping,
        SessionState.Idle => now - StateSince > DozeAfter ? PetsIA.Mood.Sleeping : PetsIA.Mood.Idle,
        _ => now - StateSince > DozeAfter ? PetsIA.Mood.Sleeping : PetsIA.Mood.Finished,
    };

    public string StatusLine(DateTimeOffset now) => State switch
    {
        SessionState.Working => Activity ?? "trabajando",
        SessionState.NeedsPermission => Activity is { } a ? $"permiso · {a}" : "necesita permiso",
        SessionState.NeedsInput => Activity ?? "esperando tu respuesta",
        SessionState.Compacting => "compactando",
        SessionState.Error => Activity is { } e ? $"error · {e}" : "error",
        SessionState.Idle => $"en espera · {Status.Ago(StateSince, now)}",
        SessionState.Done => $"terminado · {Status.Ago(StateSince, now)}",
        _ => $"cerrada · {Status.Ago(StateSince, now)}",
    };
}

public static class Status
{
    public static string Summary(IReadOnlyCollection<PanelSession> sessions)
    {
        var needy = sessions.Count(s => s.NeedsAttention);
        if (needy > 0) return needy == 1 ? "1 te necesita" : $"{needy} te necesitan";
        return sessions.Count switch { 0 => "sin sesiones", 1 => "1 sesión", var n => $"{n} sesiones" };
    }

    public static string Ago(DateTimeOffset since, DateTimeOffset now)
    {
        var s = Math.Max(0, (int)(now - since).TotalSeconds);
        if (s < 5) return "ahora";
        if (s < 60) return $"{s}s";
        if (s < 3600) return $"{s / 60}m";
        if (s < 86400) return $"{s / 3600}h";
        return $"{s / 86400}d";
    }
}

public sealed class SessionList
{
    readonly Dictionary<string, PanelSession> sessions = new();
    public string? FocusedId { get; private set; }

    public void Apply(ServerMessage message)
    {
        switch (message)
        {
            case ServerMessage.Snapshot snap:
                sessions.Clear();
                foreach (var s in snap.Sessions) sessions[s.Id] = s;
                FocusedId = snap.FocusedId;
                break;
            case ServerMessage.Session one:
                sessions[one.Value.Id] = one.Value;
                break;
            case ServerMessage.Removed removed:
                sessions.Remove(removed.Id);
                break;
            case ServerMessage.Focus focus:
                FocusedId = focus.Id;
                break;
        }
    }

    public void Clear() => sessions.Clear();

    /// Pinned sessions, then the active unpinned ones by name, so creatures don't jump around as their states change.
    public List<PanelSession> Shown(DateTimeOffset now)
    {
        var pinned = sessions.Values.Where(s => s.Pinned).OrderBy(s => s.Position ?? 0).ThenBy(s => s.Id, StringComparer.Ordinal);
        var others = sessions.Values.Where(s => !s.Pinned && s.IsActive(now))
            .OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(s => s.Id, StringComparer.Ordinal);
        return pinned.Concat(others).ToList();
    }
}
