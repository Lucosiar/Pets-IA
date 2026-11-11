using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PetsIA;

/// Where things live; mirrors agent/src/config.ts.
public static class Paths
{
    public const int PanelPort = 7788;
    public const int HookPort = 7787;
    public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PetsIA");
    public static readonly string ConfigFile = Path.Combine(DataDir, "config.json");
    public static readonly string LogDir = Path.Combine(DataDir, "logs");
    public static readonly string SettingsFile = Path.Combine(DataDir, "overlay.json");
    public static readonly string AgentExe = Path.Combine(AppContext.BaseDirectory, "petsia.exe");

    public static string? Token()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(ConfigFile));
            return doc.RootElement.TryGetProperty("token", out var t) && t.GetString() is { Length: > 0 } token ? token : null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}

public enum LinkStatus { Connecting, Online, Offline, NotPaired }

/// The WebSocket to the agent: reconnects forever, and hands every message to the UI thread.
public sealed class AgentLink
{
    public event Action<ServerMessage>? Message;
    public event Action<LinkStatus>? StatusChanged;
    public LinkStatus Status { get; private set; } = LinkStatus.Connecting;

    readonly SynchronizationContext ui;
    readonly SemaphoreSlim sendLock = new(1, 1);
    ClientWebSocket? socket;
    readonly CancellationTokenSource stop = new();

    public AgentLink(SynchronizationContext ui) => this.ui = ui;

    public void Start() => _ = Task.Run(RunAsync);

    public void Stop() => stop.Cancel();

    void SetStatus(LinkStatus status)
    {
        if (status == Status) return;
        Status = status;
        ui.Post(_ => StatusChanged?.Invoke(status), null);
    }

    async Task RunAsync()
    {
        while (!stop.IsCancellationRequested)
        {
            var token = Paths.Token();
            if (token is null)
            {
                SetStatus(LinkStatus.NotPaired);
                await Delay(2000);
                continue;
            }
            using var ws = new ClientWebSocket();
            try
            {
                var uri = new Uri($"ws://127.0.0.1:{Paths.PanelPort}/ws?token={Uri.EscapeDataString(token)}");
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
                timeout.CancelAfter(3000);
                await ws.ConnectAsync(uri, timeout.Token);
                socket = ws;
                SetStatus(LinkStatus.Online);
                await ReceiveAsync(ws);
            }
            catch (Exception) when (!stop.IsCancellationRequested)
            {
                // Agent not up yet, restarted, or the token changed: try again.
            }
            catch (Exception)
            {
                return;
            }
            finally
            {
                socket = null;
            }
            SetStatus(LinkStatus.Offline);
            await Delay(2000);
        }
    }

    async Task ReceiveAsync(ClientWebSocket ws)
    {
        var buffer = new byte[64 * 1024];
        var text = new StringBuilder();
        while (ws.State == WebSocketState.Open && !stop.IsCancellationRequested)
        {
            var result = await ws.ReceiveAsync(buffer, stop.Token);
            if (result.MessageType == WebSocketMessageType.Close) return;
            text.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            if (!result.EndOfMessage) continue;
            var message = ServerMessage.Parse(text.ToString());
            text.Clear();
            if (message is not null) ui.Post(_ => Message?.Invoke(message), null);
        }
    }

    public async void Send(string json)
    {
        var ws = socket;
        if (ws is null || ws.State != WebSocketState.Open) return;
        await sendLock.WaitAsync();
        try
        {
            await ws.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, stop.Token);
        }
        catch (Exception)
        {
            // The receive loop notices and reconnects.
        }
        finally
        {
            sendLock.Release();
        }
    }

    async Task Delay(int ms)
    {
        try { await Task.Delay(ms, stop.Token); } catch (TaskCanceledException) { }
    }
}

/// Keeps `petsia.exe agent` running next to the overlay, without a console window, and stops it on quit.
public sealed class AgentSupervisor : IDisposable
{
    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(1.5) };
    readonly Timer timer;
    Process? process;
    StreamWriter? log;
    DateTime lastStart = DateTime.MinValue;
    int quickExits;
    int checking;

    public AgentSupervisor()
    {
        timer = new Timer(_ => _ = CheckAsync(), null, TimeSpan.Zero, TimeSpan.FromSeconds(5));
    }

    static async Task<bool> HealthyAsync()
    {
        try
        {
            using var response = await http.GetAsync($"http://127.0.0.1:{Paths.PanelPort}/health");
            return response.IsSuccessStatusCode;
        }
        catch (Exception)
        {
            return false;
        }
    }

    async Task CheckAsync()
    {
        if (Interlocked.Exchange(ref checking, 1) == 1) return;
        try
        {
            if (process is { HasExited: false }) return;
            if (await HealthyAsync()) return; // one started by setup, or by an earlier overlay
            if (!File.Exists(Paths.AgentExe)) return; // a development build without the agent beside it
            // Back off when it keeps dying at start, e.g. a port taken by something else.
            if (DateTime.UtcNow - lastStart < TimeSpan.FromSeconds(quickExits > 3 ? 60 : 5)) return;
            quickExits = DateTime.UtcNow - lastStart < TimeSpan.FromSeconds(30) ? quickExits + 1 : 0;
            Start();
        }
        finally
        {
            Volatile.Write(ref checking, 0);
        }
    }

    void Start()
    {
        lastStart = DateTime.UtcNow;
        try
        {
            Directory.CreateDirectory(Paths.LogDir);
            log ??= new StreamWriter(new FileStream(Path.Combine(Paths.LogDir, "agent.log"), FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
            var info = new ProcessStartInfo(Paths.AgentExe, "agent")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = AppContext.BaseDirectory,
            };
            var p = new Process { StartInfo = info, EnableRaisingEvents = true };
            p.OutputDataReceived += (_, e) => Write(e.Data);
            p.ErrorDataReceived += (_, e) => Write(e.Data);
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            process = p;
        }
        catch (Exception error)
        {
            Write($"no se pudo arrancar el agente: {error.Message}");
        }
    }

    void Write(string? line)
    {
        if (line is null) return;
        lock (timer) log?.WriteLine(line);
    }

    /// Asks the agent to stop (it may not be ours), then makes sure ours is gone.
    public void StopAgent()
    {
        timer.Change(Timeout.Infinite, Timeout.Infinite);
        try
        {
            if (Paths.Token() is { } token)
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{Paths.HookPort}/shutdown");
                request.Headers.Add("x-petsia-token", token);
                http.Send(request);
            }
        }
        catch (Exception)
        {
            // Not running.
        }
        try
        {
            if (process is { HasExited: false } p && !p.WaitForExit(1500)) p.Kill();
        }
        catch (Exception)
        {
        }
    }

    public void Dispose()
    {
        timer.Dispose();
        log?.Dispose();
    }
}
