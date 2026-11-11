using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace PetsIA;

static class Native
{
    const int GWL_EXSTYLE = -20;
    const long WS_EX_TRANSPARENT = 0x20;
    const long WS_EX_TOOLWINDOW = 0x80;
    const long WS_EX_NOACTIVATE = 0x08000000;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    /// Never takes focus from the app in front, stays out of Alt+Tab and the taskbar;
    /// click-through windows let the mouse pass to whatever is below.
    public static void MakeOverlay(Window window, bool clickThrough)
    {
        var handle = new WindowInteropHelper(window).Handle;
        var style = GetWindowLongPtr(handle, GWL_EXSTYLE).ToInt64() | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
        if (clickThrough) style |= WS_EX_TRANSPARENT;
        SetWindowLongPtr(handle, GWL_EXSTYLE, new IntPtr(style));
    }
}

static class Draw
{
    public static Color ToColor(this Paint paint) =>
        Color.FromArgb((byte)Math.Round(Math.Clamp(paint.Alpha, 0, 1) * 255), paint.Rgb.R, paint.Rgb.G, paint.Rgb.B);

    public static Brush ToBrush(this Paint paint) => ((Paint?)paint).ToBrush()!;

    public static Brush? ToBrush(this Paint? paint)
    {
        if (paint is not { } p) return null;
        var brush = new SolidColorBrush(p.ToColor());
        brush.Freeze();
        return brush;
    }

    public static Brush Solid(byte a, byte r, byte g, byte b)
    {
        var brush = new SolidColorBrush(Color.FromArgb(a, r, g, b));
        brush.Freeze();
        return brush;
    }

    public static BitmapSource ToBitmap(this Pixels pixels)
    {
        var data = new int[pixels.Width * pixels.Height];
        for (var y = 0; y < pixels.Height; y++)
            for (var x = 0; x < pixels.Width; x++)
                if (pixels[x, y] is { } c)
                    data[y * pixels.Width + x] = unchecked((int)(0xff000000u | (uint)c.R << 16 | (uint)c.G << 8 | c.B));
        var bitmap = BitmapSource.Create(pixels.Width, pixels.Height, 96, 96, PixelFormats.Bgra32, null, data, pixels.Width * 4);
        bitmap.Freeze();
        return bitmap;
    }

    /// The tray icon: the default critter, 2× on 32×32.
    public static System.Drawing.Icon TrayIcon(Rgb color, bool alert)
    {
        var frame = Sprite.Frame("default", alert ? Paint.Accent.Rgb : color, Mood.Idle, 1);
        using var bitmap = new System.Drawing.Bitmap(32, 32);
        for (var y = 0; y < 16; y++)
            for (var x = 0; x < 16; x++)
                if (frame[x + 4, y + 6] is { } c)
                    for (var dy = 0; dy < 2; dy++)
                        for (var dx = 0; dx < 2; dx++)
                            bitmap.SetPixel(x * 2 + dx, y * 2 + dy, System.Drawing.Color.FromArgb(255, c.R, c.G, c.B));
        return System.Drawing.Icon.FromHandle(bitmap.GetHicon());
    }
}
