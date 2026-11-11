using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace PetsIA;

public enum Edge { Left, Right }

/// What the user chose; kept in %LOCALAPPDATA%\PetsIA\overlay.json.
public sealed class OverlaySettings
{
    public string Edge { get; set; } = "right";
    public bool Hidden { get; set; }
    public bool Collapsed { get; set; }

    public static OverlaySettings Load()
    {
        try
        {
            return JsonSerializer.Deserialize<OverlaySettings>(File.ReadAllText(Paths.SettingsFile)) ?? new OverlaySettings();
        }
        catch (Exception)
        {
            return new OverlaySettings();
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Paths.DataDir);
            File.WriteAllText(Paths.SettingsFile, JsonSerializer.Serialize(this));
        }
        catch (Exception)
        {
        }
    }
}

static class Theme
{
    public static readonly Brush Backdrop = Draw.Solid(199, 13, 13, 13);
    public static readonly Brush Line = Draw.Solid(26, 255, 255, 255);
    public static readonly Brush Text = Draw.Solid(255, 245, 245, 245);
    public static readonly Brush Muted = Draw.Solid(255, 153, 153, 153);
    public static readonly Brush Accent = Paint.Accent.ToBrush();
    public static readonly Brush Danger = Paint.Danger.ToBrush();
}

/// The small label beside the strip: name and status of what the mouse is over. Never takes the mouse.
sealed class HoverWindow : Window
{
    readonly TextBlock name = new() { FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = Theme.Text, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 320 };
    readonly TextBlock status = new() { FontSize = 11, FontFamily = new FontFamily("Consolas"), TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 320 };
    readonly StackPanel lines = new();

    public HoverWindow()
    {
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        ResizeMode = ResizeMode.NoResize;
        SizeToContent = SizeToContent.WidthAndHeight;
        IsHitTestVisible = false;
        lines.Children.Add(name);
        lines.Children.Add(status);
        Content = new Border
        {
            Background = Theme.Backdrop,
            BorderBrush = Theme.Line,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 6, 10, 6),
            Child = lines,
        };
        SourceInitialized += (_, _) => Native.MakeOverlay(this, clickThrough: true);
    }

    /// `anchor` is the hovered cell in screen DIPs; the label goes on the strip's inner side.
    public void ShowFor(string title, string line, Brush color, Rect anchor, Rect strip, Edge edge, Rect work)
    {
        name.Text = title;
        status.Text = line;
        status.Foreground = color;
        var align = edge == Edge.Right ? TextAlignment.Right : TextAlignment.Left;
        name.TextAlignment = align;
        status.TextAlignment = align;
        if (!IsVisible) Show();
        UpdateLayout();
        var left = edge == Edge.Right ? strip.Left - ActualWidth - 6 : strip.Right + 6;
        var top = anchor.Top + anchor.Height / 2 - ActualHeight / 2;
        Left = left;
        Top = Math.Clamp(top, work.Top, Math.Max(work.Top, work.Bottom - ActualHeight));
    }
}

/// The strip itself, its label, the tray icon and the link to the agent.
public sealed class StripController
{
    const double Inset = 4;
    const int CellPaddingPixels = 2;
    static readonly double[] Scales = { 2, 1.5, 1 };
    const double FramesPerSecond = 4;

    readonly Window window = new();
    readonly HoverWindow hover = new();
    readonly StackPanel cells = new();
    readonly Border strip = new();
    readonly Border tab = new();
    readonly Image tabImage = new();
    readonly StackPanel root = new() { Orientation = Orientation.Horizontal };
    readonly SessionList list = new();
    readonly AgentLink link;
    readonly AgentSupervisor supervisor = new();
    readonly OverlaySettings settings = OverlaySettings.Load();
    readonly DispatcherTimer clock;
    readonly Tray tray;

    List<PanelSession> shown = new();
    double scale = 2;
    /// Session id, "+" or "tab".
    string? hovered;
    (string Cell, string Message, DateTime Until)? notice;
    bool libraryPending;

    Edge EdgeSide => settings.Edge == "left" ? Edge.Left : Edge.Right;

    public StripController()
    {
        link = new AgentLink(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
        link.Message += OnMessage;
        link.StatusChanged += status =>
        {
            if (status != LinkStatus.Online) list.Clear();
            Render();
        };

        window.WindowStyle = WindowStyle.None;
        window.AllowsTransparency = true;
        window.Background = Brushes.Transparent;
        window.Topmost = true;
        window.ShowInTaskbar = false;
        window.ShowActivated = false;
        window.ResizeMode = ResizeMode.NoResize;
        window.SizeToContent = SizeToContent.WidthAndHeight;
        window.Title = "Pets IA";
        window.SourceInitialized += (_, _) => Native.MakeOverlay(window, clickThrough: false);
        window.SizeChanged += (_, _) => Place();
        window.MouseLeave += (_, _) => SetHover(null);

        strip.Background = Theme.Backdrop;
        strip.BorderBrush = Theme.Line;
        strip.BorderThickness = new Thickness(1);
        strip.Padding = new Thickness(Inset - 1);
        strip.Child = cells;

        tab.Background = Theme.Backdrop;
        tab.BorderBrush = Theme.Line;
        tab.BorderThickness = new Thickness(1);
        tab.VerticalAlignment = VerticalAlignment.Center;
        tab.Child = tabImage;
        tab.Cursor = Cursors.Hand;
        RenderOptions.SetBitmapScalingMode(tabImage, BitmapScalingMode.NearestNeighbor);
        tab.MouseEnter += (_, _) => SetHover("tab");
        tab.MouseLeftButtonUp += (_, _) =>
        {
            settings.Collapsed = !settings.Collapsed;
            settings.Save();
            Rebuild();
        };

        window.Content = root;
        tray = new Tray(this);

        clock = new DispatcherTimer(DispatcherPriority.Render) { Interval = TimeSpan.FromSeconds(1 / FramesPerSecond) };
        clock.Tick += (_, _) => Render();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += (_, _) => window.Dispatcher.BeginInvoke(new Action(Rebuild));
    }

    public void Start()
    {
        Rebuild();
        if (!settings.Hidden) window.Show();
        clock.Start();
        link.Start();
    }

    // ── Tray actions ─────────────────────────────────────────────────────────

    public bool Hidden => settings.Hidden;
    public Edge Edge => EdgeSide;
    public LinkStatus LinkStatus => link.Status;
    public IReadOnlyList<PanelSession> Shown => shown;

    public void ToggleHidden()
    {
        settings.Hidden = !settings.Hidden;
        settings.Save();
        if (settings.Hidden)
        {
            window.Hide();
            hover.Hide();
        }
        else
        {
            window.Show();
            Rebuild();
        }
    }

    public void SetEdge(Edge edge)
    {
        settings.Edge = edge == Edge.Left ? "left" : "right";
        settings.Save();
        Rebuild();
    }

    public void Quit()
    {
        clock.Stop();
        link.Stop();
        tray.Dispose();
        supervisor.StopAgent();
        supervisor.Dispose();
        Application.Current.Shutdown();
    }

    // ── Agent messages ───────────────────────────────────────────────────────

    void OnMessage(ServerMessage message)
    {
        switch (message)
        {
            case ServerMessage.Library library when libraryPending:
                libraryPending = false;
                ShowLibrary(library.Sessions);
                return;
            case ServerMessage.Failure failure:
                notice = (hovered ?? "+", failure.Message, DateTime.UtcNow.AddSeconds(5));
                break;
        }
        list.Apply(message);
        Render();
    }

    // ── Layout ───────────────────────────────────────────────────────────────

    static double CellPixels => Sprite.Size + 2 * CellPaddingPixels;
    double CellSide => scale * CellPixels;

    /// Recreates the cells when their number, the scale or the edge changes.
    void Rebuild()
    {
        var work = SystemParameters.WorkArea;
        var count = shown.Count + 1;
        scale = Scales.FirstOrDefault(s => count * CellPixels * s + 2 * Inset <= work.Height, Scales[^1]);

        cells.Children.Clear();
        for (var i = 0; i < count; i++) cells.Children.Add(MakeCell(i));

        var right = EdgeSide == Edge.Right;
        strip.CornerRadius = right ? new CornerRadius(8, 0, 0, 8) : new CornerRadius(0, 8, 8, 0);
        strip.MaxHeight = work.Height;
        tab.CornerRadius = right ? new CornerRadius(6, 0, 0, 6) : new CornerRadius(0, 6, 6, 0);
        tab.Width = Appearance.TabWidth * scale;
        tab.Height = Appearance.TabHeight * scale;
        tabImage.Width = tab.Width;
        tabImage.Height = tab.Height;
        tab.BorderThickness = right ? new Thickness(1, 1, 0, 1) : new Thickness(0, 1, 1, 1);

        root.Children.Clear();
        if (right) root.Children.Add(tab);
        if (!settings.Collapsed) root.Children.Add(strip);
        if (!right) root.Children.Add(tab);

        Render();
        window.UpdateLayout();
        Place();
    }

    Border MakeCell(int index)
    {
        var image = new Image { Width = Sprite.Size * scale, Height = Sprite.Size * scale, Stretch = Stretch.Fill };
        RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.NearestNeighbor);
        var cell = new Border
        {
            Width = CellSide,
            Height = CellSide,
            CornerRadius = new CornerRadius(6 * scale / 2),
            Child = image,
            Cursor = Cursors.Hand,
            Background = Brushes.Transparent,
        };
        cell.MouseEnter += (_, _) => SetHover(KeyAt(index));
        cell.MouseLeftButtonUp += (_, _) => Click(KeyAt(index));
        cell.MouseRightButtonUp += (_, e) =>
        {
            e.Handled = true;
            if (KeyAt(index) is { } key && key != "+") ShowCreatureMenu(key, cell);
        };
        return cell;
    }

    string? KeyAt(int index) => index < shown.Count ? shown[index].Id : index == shown.Count ? "+" : null;

    void Place()
    {
        var work = SystemParameters.WorkArea;
        window.Left = EdgeSide == Edge.Right ? work.Right - window.ActualWidth : work.Left;
        window.Top = work.Top + Math.Max(0, (work.Height - window.ActualHeight) / 2);
    }

    // ── Drawing ──────────────────────────────────────────────────────────────

    void Render()
    {
        var now = DateTimeOffset.UtcNow;
        var next = list.Shown(now);
        if (next.Count != shown.Count)
        {
            shown = next;
            Rebuild();
            return;
        }
        shown = next;
        var frame = (int)(now.ToUnixTimeMilliseconds() * FramesPerSecond / 1000);

        for (var i = 0; i < cells.Children.Count && i <= shown.Count; i++)
        {
            var cell = (Border)cells.Children[i];
            var look = i < shown.Count
                ? Appearance.ForSession(shown[i], shown[i].Id == list.FocusedId, hovered == shown[i].Id, frame, now)
                : Appearance.AddButton(hovered == "+");
            PaintCell(cell, look);
        }
        var tabLook = Appearance.Tab(shown, settings.Collapsed, EdgeSide == Edge.Right, hovered == "tab", frame, now);
        tabImage.Source = tabLook.Pixels.ToBitmap();
        tab.Background = tabLook.Tile.Fill is { } fill ? new SolidColorBrush(fill.ToColor()) : Theme.Backdrop;
        tab.BorderBrush = tabLook.Tile.Border.ToBrush() ?? Theme.Line;

        UpdateHover(now);
        tray.Update(shown, link.Status);
    }

    static void PaintCell(Border cell, Appearance look)
    {
        var image = (Image)cell.Child;
        image.Source = look.Pixels.ToBitmap();
        image.Opacity = look.Opacity;
        cell.Background = look.Tile.Fill.ToBrush() ?? Brushes.Transparent;
        cell.BorderBrush = look.Tile.Border.ToBrush();
        cell.BorderThickness = new Thickness(look.Tile.Border is null ? 0 : look.Tile.BorderWidth);
    }

    // ── Hover ────────────────────────────────────────────────────────────────

    void SetHover(string? key)
    {
        if (key == hovered) return;
        hovered = key;
        Render();
    }

    void UpdateHover(DateTimeOffset now)
    {
        if (notice is { } n && n.Until < DateTime.UtcNow) notice = null;
        var key = notice?.Cell ?? hovered;
        if (key is null || settings.Hidden || !window.IsVisible)
        {
            hover.Hide();
            return;
        }
        var failure = notice is { } active && active.Cell == key ? active.Message : null;
        string title, line;
        Brush color;
        FrameworkElement anchor;

        if (key == "tab")
        {
            title = settings.Collapsed ? "Mostrar" : "Recoger";
            line = Status.Summary(shown);
            color = shown.Any(s => s.NeedsAttention) ? Theme.Accent : Theme.Muted;
            anchor = tab;
        }
        else if (key == "+")
        {
            if (settings.Collapsed) { hover.Hide(); return; }
            title = "Añadir sesión";
            line = failure ?? (link.Status == LinkStatus.Online ? "fija una sesión de Claude o Codex" : StatusText(link.Status));
            color = failure is not null ? Theme.Danger : Theme.Muted;
            anchor = (FrameworkElement)cells.Children[shown.Count];
        }
        else
        {
            var index = shown.FindIndex(s => s.Id == key);
            if (index < 0 || settings.Collapsed) { hover.Hide(); return; }
            var s = shown[index];
            title = $"{s.Name}  —  {s.WhereLabel}";
            line = failure ?? s.StatusLine(now);
            color = failure is not null ? Theme.Danger : s.NeedsAttention ? Theme.Accent : Theme.Muted;
            anchor = (FrameworkElement)cells.Children[index];
        }

        var topLeft = anchor.TransformToAncestor(window).Transform(new Point(0, 0));
        var rect = new Rect(window.Left + topLeft.X, window.Top + topLeft.Y, anchor.ActualWidth, anchor.ActualHeight);
        var stripRect = new Rect(window.Left, window.Top, window.ActualWidth, window.ActualHeight);
        hover.ShowFor(title, line, color, rect, stripRect, EdgeSide, SystemParameters.WorkArea);
    }

    public static string StatusText(LinkStatus status) => status switch
    {
        LinkStatus.Online => "Conectado",
        LinkStatus.Connecting => "Conectando con el agente…",
        LinkStatus.Offline => "El agente no está en marcha · reintentando",
        _ => "Agente sin configurar · ejecuta petsia setup",
    };

    // ── Clicks and menus ─────────────────────────────────────────────────────

    void Click(string? key)
    {
        if (key is null) return;
        if (key == "+")
        {
            libraryPending = true;
            link.Send(ClientMessage.Library());
            return;
        }
        link.Send(ClientMessage.Open(key));
    }

    void ShowCreatureMenu(string id, FrameworkElement target)
    {
        var session = shown.FirstOrDefault(s => s.Id == id);
        if (session is null) return;
        var menu = new ContextMenu { PlacementTarget = target, Placement = System.Windows.Controls.Primitives.PlacementMode.Left };
        if (EdgeSide == Edge.Left) menu.Placement = System.Windows.Controls.Primitives.PlacementMode.Right;
        menu.Items.Add(new MenuItem { Header = $"{session.Name}  ({session.WhereLabel})", IsEnabled = false });
        menu.Items.Add(Item("Abrir", () => link.Send(ClientMessage.Open(id))));
        menu.Items.Add(Item(session.Pinned ? "Quitar de la tira" : "Fijar en la tira", () => link.Send(ClientMessage.Pin(id, !session.Pinned))));
        menu.Items.Add(new Separator());

        var characters = new MenuItem { Header = "Personaje" };
        foreach (var c in CharacterTemplate.All)
        {
            var icon = session.Icon with { Character = c.Id };
            characters.Items.Add(Item(c.Label, () => link.Send(ClientMessage.Icon(id, icon)), CharacterTemplate.Named(session.Icon.Character).Id == c.Id));
        }
        menu.Items.Add(characters);

        var colors = new MenuItem { Header = "Color" };
        foreach (var (name, color) in SessionIcon.Palette)
        {
            var icon = session.Icon with { Color = color };
            var item = Item(name, () => link.Send(ClientMessage.Icon(id, icon)), string.Equals(session.Icon.Color, color, StringComparison.OrdinalIgnoreCase));
            var rgb = Rgb.Hex(color);
            item.Icon = new Border { Width = 12, Height = 12, CornerRadius = new CornerRadius(2), Background = new SolidColorBrush(Color.FromRgb(rgb.R, rgb.G, rgb.B)) };
            colors.Items.Add(item);
        }
        menu.Items.Add(colors);
        menu.IsOpen = true;
    }

    void ShowLibrary(List<LibraryEntry> entries)
    {
        if (cells.Children.Count <= shown.Count) return;
        var target = (FrameworkElement)cells.Children[shown.Count];
        var menu = new ContextMenu
        {
            PlacementTarget = target,
            Placement = EdgeSide == Edge.Right ? System.Windows.Controls.Primitives.PlacementMode.Left : System.Windows.Controls.Primitives.PlacementMode.Right,
            MaxHeight = SystemParameters.WorkArea.Height * 0.8,
        };
        menu.Items.Add(new MenuItem { Header = "Fijar una sesión", IsEnabled = false });
        if (entries.Count == 0) menu.Items.Add(new MenuItem { Header = "No hay sesiones de Claude ni de Codex", IsEnabled = false });
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in entries)
        {
            var tool = entry.Source == "codex" ? "Codex" : "Claude";
            var item = Item($"{tool} — {entry.Name}   {Status.Ago(entry.LastActivityAt, now)}", () => link.Send(ClientMessage.Pin(entry.Id, !entry.Pinned)), entry.Pinned);
            item.ToolTip = entry.Cwd;
            menu.Items.Add(item);
        }
        menu.IsOpen = true;
    }

    static MenuItem Item(string header, Action action, bool isChecked = false)
    {
        var item = new MenuItem { Header = header, IsCheckable = false, IsChecked = isChecked };
        item.Click += (_, _) => action();
        return item;
    }
}

/// The notification-area icon: what the strip shows, and the few settings there are.
sealed class Tray : IDisposable
{
    readonly System.Windows.Forms.NotifyIcon icon = new();
    readonly System.Drawing.Icon calm = Draw.TrayIcon(Rgb.Hex("#d97757"), alert: false);
    readonly System.Drawing.Icon alert = Draw.TrayIcon(Rgb.Hex("#d97757"), alert: true);
    readonly StripController strip;
    bool alerting;

    public Tray(StripController strip)
    {
        this.strip = strip;
        icon.Icon = calm;
        icon.Text = "Pets IA";
        icon.Visible = true;
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Opening += (_, _) => Fill(menu);
        icon.ContextMenuStrip = menu;
        icon.MouseClick += (_, e) =>
        {
            if (e.Button == System.Windows.Forms.MouseButtons.Left) strip.ToggleHidden();
        };
        Fill(menu);
    }

    void Fill(System.Windows.Forms.ContextMenuStrip menu)
    {
        menu.Items.Clear();
        var status = strip.LinkStatus == LinkStatus.Online
            ? $"{StripController.StatusText(LinkStatus.Online)} · {Status.Summary(strip.Shown.ToList())}"
            : StripController.StatusText(strip.LinkStatus);
        menu.Items.Add(new System.Windows.Forms.ToolStripMenuItem(status) { Enabled = false });
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add(strip.Hidden ? "Mostrar la tira" : "Ocultar la tira", null, (_, _) => strip.ToggleHidden());
        var edge = new System.Windows.Forms.ToolStripMenuItem("Borde");
        edge.DropDownItems.Add(new System.Windows.Forms.ToolStripMenuItem("Izquierda", null, (_, _) => strip.SetEdge(Edge.Left)) { Checked = strip.Edge == Edge.Left });
        edge.DropDownItems.Add(new System.Windows.Forms.ToolStripMenuItem("Derecha", null, (_, _) => strip.SetEdge(Edge.Right)) { Checked = strip.Edge == Edge.Right });
        menu.Items.Add(edge);
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("Salir de Pets IA", null, (_, _) => strip.Quit());
    }

    public void Update(IReadOnlyList<PanelSession> shown, LinkStatus status)
    {
        var waiting = shown.Count(s => s.NeedsAttention);
        var text = status != LinkStatus.Online ? "Pets IA · sin agente" : $"Pets IA · {Status.Summary(shown.ToList())}";
        if (icon.Text != text) icon.Text = text.Length > 63 ? text[..63] : text;
        if ((waiting > 0) != alerting)
        {
            alerting = waiting > 0;
            icon.Icon = alerting ? alert : calm;
        }
    }

    public void Dispose()
    {
        icon.Visible = false;
        icon.Dispose();
    }
}
