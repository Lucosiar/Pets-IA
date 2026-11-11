using System;
using System.Threading;
using System.Windows;

namespace PetsIA;

static class Program
{
    [STAThread]
    static int Main()
    {
        using var single = new Mutex(true, @"Local\PetsIA.Overlay", out var first);
        if (!first) return 0; // already running

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
