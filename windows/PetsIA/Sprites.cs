// Port of Sources/PetsCore/Sprites/Sprite.swift and Appearance.swift: same characters, same poses, same marks.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;

namespace PetsIA;

public readonly record struct Rgb(byte R, byte G, byte B)
{
    public static Rgb? FromHex(string? hex)
    {
        if (hex is null || hex.Length != 7 || hex[0] != '#') return null;
        try
        {
            var v = Convert.ToUInt32(hex.Substring(1), 16);
            return new Rgb((byte)(v >> 16 & 0xff), (byte)(v >> 8 & 0xff), (byte)(v & 0xff));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public static Rgb Hex(string hex) => FromHex(hex) ?? new Rgb(255, 0, 255);

    /// Mixed toward black (amount below 0) or white (above 0).
    public Rgb Shaded(double amount)
    {
        var target = amount < 0 ? 0.0 : 255.0;
        var t = Math.Abs(amount);
        byte Mix(byte v) => (byte)Math.Round(v + (target - v) * t);
        return new Rgb(Mix(R), Mix(G), Mix(B));
    }
}

public enum Mood { Idle, Working, Alert, Asking, Compacting, Error, Sleeping, Finished }

public sealed class CharacterTemplate
{
    public string Id = "";
    public string Label = "";
    public string[] Body = Array.Empty<string>();
    public int? WalkRow;
    public string[] WalkRows = Array.Empty<string>();
    public int EyesY, EyesLeft, EyesRight;
    public string? EyeColor;

    static readonly Dictionary<string, string> Labels = new()
    {
        ["default"] = "Bichito", ["robot"] = "Robot", ["ghost"] = "Fantasma", ["cat"] = "Gato",
    };

    public static readonly List<CharacterTemplate> All = Load();

    public static CharacterTemplate Named(string id) => All.FirstOrDefault(c => c.Id == id) ?? All[0];

    static List<CharacterTemplate> Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("characters.json")
            ?? throw new InvalidOperationException("characters.json is not embedded");
        using var doc = JsonDocument.Parse(stream);
        var list = new List<CharacterTemplate>();
        foreach (var c in doc.RootElement.EnumerateArray())
        {
            var t = new CharacterTemplate
            {
                Id = c.GetProperty("id").GetString()!,
                Body = c.GetProperty("body").EnumerateArray().Select(r => r.GetString()!).ToArray(),
                EyesY = c.GetProperty("eyes").GetProperty("y").GetInt32(),
                EyesLeft = c.GetProperty("eyes").GetProperty("left").GetInt32(),
                EyesRight = c.GetProperty("eyes").GetProperty("right").GetInt32(),
                EyeColor = c.TryGetProperty("eyeColor", out var ec) ? ec.GetString() : null,
            };
            t.Label = Labels.TryGetValue(t.Id, out var label) ? label : c.GetProperty("label").GetString()!;
            if (c.TryGetProperty("walk", out var walk))
            {
                t.WalkRow = walk.GetProperty("row").GetInt32();
                t.WalkRows = walk.GetProperty("rows").EnumerateArray().Select(r => r.GetString()!).ToArray();
            }
            list.Add(t);
        }
        if (list.Count == 0) throw new InvalidOperationException("characters.json has no characters");
        return list;
    }
}

/// A square of optional colors, [y, x].
public sealed class Pixels
{
    public readonly Rgb?[,] Cells;
    public int Width => Cells.GetLength(1);
    public int Height => Cells.GetLength(0);

    public Pixels(int width, int height) => Cells = new Rgb?[height, width];

    public Rgb? this[int x, int y]
    {
        get => x >= 0 && y >= 0 && x < Width && y < Height ? Cells[y, x] : null;
        set { if (x >= 0 && y >= 0 && x < Width && y < Height) Cells[y, x] = value; }
    }

    public Pixels Copy()
    {
        var p = new Pixels(Width, Height);
        Array.Copy(Cells, p.Cells, Cells.Length);
        return p;
    }
}

public static class Sprite
{
    /// A 16×16 character plus room above and to the right for overlays.
    public const int Size = 24;
    const int BodyX = 4, BodyY = 6;

    static readonly Rgb Bang = Rgb.Hex("#ffd23f"), Question = Rgb.Hex("#ffffff"), Cross = Rgb.Hex("#ff4d4d"), Z = Rgb.Hex("#c8d0dc");
    static readonly Rgb DotOn = Rgb.Hex("#ffffff"), DotOff = Rgb.Hex("#4a4f5a"), Face = Rgb.Hex("#16171c"), Pink = Rgb.Hex("#ff8fb1");
    static readonly Rgb Check = Rgb.Hex("#4cd964"), Eye = Rgb.Hex("#111216");

    static readonly string[] GBang = { "X", "X", "X", ".", "X" };
    static readonly string[] GQuestion = { "XXX", "..X", ".XX", "...", ".X." };
    static readonly string[] GCross = { "X.X", ".X.", "X.X" };
    static readonly string[] GZ = { "XXXX", "..X.", ".X..", "XXXX" };
    static readonly string[] GDot = { "X" };
    static readonly string[] GCheck = { ".....X", "....XX", "X..XX.", "XXXX..", ".XX..." };
    static readonly (int X, int Y)[] ZSpots = { (15, 5), (18, 2), (20, 0) };

    enum Eyes { Open, Closed, Squint }

    record struct Overlay(string[] Glyph, int X, int Y, Rgb Color);

    static T Cycle<T>(int frame, params T[] values) => values[((frame % values.Length) + values.Length) % values.Length];

    public static Pixels Frame(string characterId, Rgb color, Mood mood, int frame)
    {
        var c = CharacterTemplate.Named(characterId);
        int dx = 0, dy = 0;
        var eyes = Eyes.Open;
        var walk = false;
        var overlays = new List<Overlay>();
        var blink = new Eyes[16];
        Array.Fill(blink, Eyes.Open);
        blink[0] = Eyes.Closed;

        switch (mood)
        {
            case Mood.Idle:
                eyes = Cycle(frame, blink);
                break;
            case Mood.Working:
                dy = Cycle(frame, 0, -1, -2, -1);
                walk = Cycle(frame, false, true);
                var raised = Cycle(frame, 0, 1, 2);
                for (var i = 0; i < 3; i++) overlays.Add(new Overlay(GDot, 17 + i * 2, i == raised ? 3 : 4, DotOn));
                break;
            case Mood.Alert:
                dy = Cycle(frame, 0, -2, -3, -2);
                if (frame % 2 == 0) overlays.Add(new Overlay(GBang, 21, 0, Bang));
                break;
            case Mood.Asking:
                dy = Cycle(frame, 0, 0, -1, -1);
                overlays.Add(new Overlay(GQuestion, 19, 0, Question));
                break;
            case Mood.Compacting:
                dy = Cycle(frame, 0, 1);
                eyes = Eyes.Squint;
                var lit = Cycle(frame, 0, 1, 2);
                for (var i = 0; i < 3; i++) overlays.Add(new Overlay(GDot, 17 + i * 2, 3, i == lit ? DotOn : DotOff));
                break;
            case Mood.Error:
                dx = Cycle(frame, -1, 1, -1, 0, 0, 0, 0, 0);
                eyes = Eyes.Squint;
                overlays.Add(new Overlay(GCross, 19, 1, Cross));
                break;
            case Mood.Finished:
                eyes = Cycle(frame, blink);
                overlays.Add(new Overlay(GCheck, 17, 0, Check));
                break;
            case Mood.Sleeping:
                var count = Cycle(frame, 1, 1, 2, 2, 3, 3, 0, 0);
                eyes = Eyes.Closed;
                foreach (var (x, y) in ZSpots.Take(count)) overlays.Add(new Overlay(GZ, x, y, Z));
                break;
        }

        var palette = new Dictionary<char, Rgb>
        {
            ['B'] = color, ['D'] = color.Shaded(-0.35), ['L'] = color.Shaded(0.35), ['F'] = Face, ['P'] = Pink,
        };
        var pixels = new Pixels(Size, Size);
        int ox = BodyX + dx, oy = BodyY + dy;
        for (var y = 0; y < c.Body.Length; y++)
        {
            var row = c.Body[y];
            if (walk && c.WalkRow is { } wr && y >= wr && y < wr + c.WalkRows.Length) row = c.WalkRows[y - wr];
            for (var x = 0; x < row.Length; x++)
                if (palette.TryGetValue(row[x], out var paint)) pixels[ox + x, oy + y] = paint;
        }

        var eyeColor = Rgb.FromHex(c.EyeColor) ?? Eye;
        foreach (var (ex, mirrored) in new[] { (c.EyesLeft, false), (c.EyesRight, true) })
            foreach (var (cx, cy) in EyeCells(eyes, mirrored))
                pixels[ox + ex + cx, oy + c.EyesY + cy] = eyeColor;

        foreach (var o in overlays)
            for (var y = 0; y < o.Glyph.Length; y++)
                for (var x = 0; x < o.Glyph[y].Length; x++)
                    if (o.Glyph[y][x] == 'X') pixels[o.X + x, o.Y + y] = o.Color;
        return pixels;
    }

    static (int, int)[] EyeCells(Eyes style, bool mirrored) => style switch
    {
        Eyes.Open => new[] { (0, 0), (1, 0), (0, 1), (1, 1) },
        Eyes.Closed => new[] { (0, 1), (1, 1) },
        _ => mirrored ? new[] { (1, 0), (0, 1) } : new[] { (0, 0), (1, 1) },
    };

    /// A black ring around the sprite, so it reads on an orange tile of its own color.
    public static Pixels Outlined(Pixels p)
    {
        var result = p.Copy();
        for (var y = 0; y < p.Height; y++)
            for (var x = 0; x < p.Width; x++)
                if (p[x, y] is null && (p[x - 1, y] is not null || p[x + 1, y] is not null || p[x, y - 1] is not null || p[x, y + 1] is not null))
                    result[x, y] = new Rgb(0, 0, 0);
        return result;
    }

    public static Pixels Grayscaled(Pixels p)
    {
        var result = p.Copy();
        for (var y = 0; y < p.Height; y++)
            for (var x = 0; x < p.Width; x++)
                if (p[x, y] is { } c)
                {
                    var l = (byte)Math.Round(0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B);
                    result[x, y] = new Rgb(l, l, l);
                }
        return result;
    }
}

public readonly record struct Paint(Rgb Rgb, double Alpha = 1)
{
    public static readonly Paint Accent = new(Rgb.Hex("#ff6b1a"));
    public static readonly Paint Danger = new(Rgb.Hex("#ff4d4d"));
    public static readonly Paint Ready = new(Rgb.Hex("#4cd964"));
    public static Paint White(double alpha) => new(new Rgb(255, 255, 255), alpha);
    public Paint WithAlpha(double alpha) => this with { Alpha = alpha };
}

public record struct Tile(Paint? Fill = null, Paint? Border = null, double BorderWidth = Tile.DefaultBorderWidth)
{
    public const double DefaultBorderWidth = 1.5;

    /// `new Tile()` on a record struct skips the defaults above and leaves 0.
    public double Width => BorderWidth > 0 ? BorderWidth : DefaultBorderWidth;
}

public sealed class Appearance
{
    public Pixels Pixels;
    public Tile Tile;
    public double Opacity;

    Appearance(Pixels pixels, Tile tile, double opacity)
    {
        Pixels = pixels;
        Tile = tile;
        Opacity = opacity;
    }

    static readonly Rgb Control = Rgb.Hex("#8b909a");
    public const int TabWidth = 8, TabHeight = 21;

    public static Appearance ForSession(PanelSession s, bool focused, bool hovered, int frame, DateTimeOffset now)
    {
        var tile = new Tile();
        if (hovered) tile.Fill = Paint.White(0.12);
        if (focused)
        {
            tile.Fill = Paint.White(hovered ? 0.3 : 0.22);
            tile.Border = Paint.White(0.75);
        }
        tile = Marked(tile, s, frame, now);
        var color = Rgb.FromHex(s.Icon.Color) ?? Rgb.Hex(SessionIcon.Default.Color);
        var pixels = Sprite.Frame(s.Icon.Character, color, s.MoodAt(now), frame);
        if (s.NeedsAttention) pixels = Sprite.Outlined(pixels);
        if (!s.Live) pixels = Sprite.Grayscaled(pixels);
        return new Appearance(pixels, tile, s.Live ? 1 : 0.45);
    }

    /// The tile at the end of the strip that pins sessions: a plus in its middle.
    public static Appearance AddButton(bool hovered)
    {
        var p = new Pixels(Sprite.Size, Sprite.Size);
        for (var x = 8; x <= 15; x++) for (var y = 11; y <= 12; y++) p[x, y] = Control;
        for (var x = 11; x <= 12; x++) for (var y = 8; y <= 15; y++) p[x, y] = Control;
        return new Appearance(p, hovered ? new Tile(Paint.White(0.12)) : new Tile(), 1);
    }

    /// The tab that collapses the strip; collapsed, it carries the mark of its most urgent session.
    public static Appearance Tab(IReadOnlyList<PanelSession> sessions, bool collapsed, bool rightEdge, bool hovered, int frame, DateTimeOffset now)
    {
        string[] chevron = { "...X", "..XX", ".XX.", "XX..", ".XX.", "..XX", "...X" };
        var p = new Pixels(TabWidth, TabHeight);
        int left = (TabWidth - 4) / 2, top = (TabHeight - chevron.Length) / 2;
        var pointsRight = rightEdge != collapsed;
        for (var y = 0; y < chevron.Length; y++)
            for (var x = 0; x < 4; x++)
                if (chevron[y][x] == 'X') p[left + (pointsRight ? 3 - x : x), top + y] = Control;

        var tile = hovered ? new Tile(Paint.White(0.12)) : new Tile();
        if (collapsed)
        {
            var urgent = sessions.Select(s => (s, rank: Urgency(s, now))).Where(t => t.rank is not null).OrderBy(t => t.rank).Select(t => t.s).FirstOrDefault();
            if (urgent is not null)
            {
                tile = Marked(tile, urgent, frame, now);
                if (urgent.NeedsAttention) p = Sprite.Outlined(p);
            }
        }
        return new Appearance(p, tile, 1);
    }

    /// Attention outranks focus and hover.
    static Tile Marked(Tile tile, PanelSession s, int frame, DateTimeOffset now)
    {
        switch (s.State)
        {
            case SessionState.NeedsPermission:
                return new Tile(frame % 4 < 2 ? Paint.Accent : Paint.Accent.WithAlpha(0.25), Paint.Accent, 2);
            case SessionState.NeedsInput:
                return new Tile(Paint.Accent.WithAlpha(frame % 8 < 4 ? 0.35 : 0.2), Paint.Accent, 2);
            case SessionState.Done when s.MoodAt(now) == Mood.Finished:
                tile.Border = Paint.Ready;
                return tile;
            case SessionState.Error:
                tile.Border = Paint.Danger;
                return tile;
            default:
                return tile;
        }
    }

    static int? Urgency(PanelSession s, DateTimeOffset now) => s.State switch
    {
        SessionState.NeedsPermission => 0,
        SessionState.NeedsInput => 1,
        SessionState.Error => 2,
        SessionState.Done when s.MoodAt(now) == Mood.Finished => 3,
        _ => null,
    };
}
