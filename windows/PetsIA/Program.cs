using System;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace PetsIA;

static class Program
{
    [STAThread]
    static int Main()
    {
        using var single = new Mutex(true, @"Local\PetsIA.Overlay", out var first);
        if (!first) return 0; // already running

        // The strip is a tiny, per-pixel-transparent, always-on-top window. On some machines the GPU
        // compositor drops its content after a driver reset, a sleep/wake, or a remote session change,
        // and it then renders fully blank until something forces a repaint — invisible, though the
        // process and the agent underneath are perfectly healthy. Software rendering sidesteps that
        // whole class of compositor glitches; the window is small enough that the CPU cost is trivial.
        RenderOptions.ProcessRenderMode = RenderMode.SoftwareOnly;

        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.DispatcherUnhandledException += (_, e) =>
        {
            // A broken frame must not take the strip down; the next tick draws again.
            Log(e.Exception);
            e.Handled = true;
        };
        app.Startup += (_, _) => new StripController().Start();
        return app.Run();
    }

    static void Log(Exception error)
    {
        try
        {
            System.IO.Directory.CreateDirectory(Paths.LogDir);
            System.IO.File.AppendAllText(System.IO.Path.Combine(Paths.LogDir, "overlay.log"), $"{DateTime.Now:s} {error}\n");
        }
        catch (Exception)
        {
        }
    }
}
