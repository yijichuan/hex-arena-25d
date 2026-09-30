param(
    [ValidateRange(0, 65535)][int]$Port = 8002,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$gameServer = $null
try {
    if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'index.html')) -or
        !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'models/Ashe.glb')) -or
        !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'assets/champion/Ashe.png'))) {
        throw 'Game files are missing. Extract the entire ZIP before starting.'
    }

    # Windows ships PowerShell and .NET; the release does not require Node or Python.
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public sealed class HexArenaLocalServer : IDisposable {
    private readonly string root;
    private readonly TcpListener listener;
    private volatile bool running = true;
    public int Port { get { return ((IPEndPoint)listener.LocalEndpoint).Port; } }

    public HexArenaLocalServer(string directory, int port) {
        root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.ExclusiveAddressUse = true;
        try { listener.Start(); }
        catch (SocketException) {
            listener.Stop();
            if (port == 0) throw;
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.ExclusiveAddressUse = true;
            listener.Start();
        }
        Thread thread = new Thread(AcceptClients);
        thread.IsBackground = true;
        thread.Start();
    }

    private void AcceptClients() {
        while (running) {
            try {
                TcpClient client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate { Serve(client); });
            } catch (SocketException) { if (!running) break; }
              catch (ObjectDisposedException) { break; }
        }
    }

    private static void Headers(Stream stream, string status, string type, long length) {
        byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nContent-Type: " + type +
            "\r\nContent-Length: " + length + "\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n\r\n");
        stream.Write(header, 0, header.Length);
    }

    private static string Mime(string file) {
        switch (Path.GetExtension(file).ToLowerInvariant()) {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".glb": return "model/gltf-binary";
            case ".png": return "image/png";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".ico": return "image/x-icon";
            case ".md": case ".txt": return "text/plain; charset=utf-8";
            default: return null;
        }
    }

    private void Serve(TcpClient client) {
        using (client) {
            client.ReceiveTimeout = 5000;
            client.SendTimeout = 30000;
            try {
                using (NetworkStream stream = client.GetStream()) {
                    StringBuilder request = new StringBuilder();
                    while (request.Length < 8192) {
                        int value = stream.ReadByte();
                        if (value < 0) return;
                        request.Append((char)value);
                        int n = request.Length;
                        if (n >= 4 && request[n-4] == '\r' && request[n-3] == '\n' && request[n-2] == '\r' && request[n-1] == '\n') break;
                    }
                    string[] line = request.ToString().Split('\n')[0].Trim().Split(' ');
                    if (line.Length != 3 || request.Length >= 8192) { Headers(stream, "400 Bad Request", "text/plain", 0); return; }
                    bool head = line[0] == "HEAD";
                    if (line[0] != "GET" && !head) { Headers(stream, "405 Method Not Allowed", "text/plain", 0); return; }
                    if (!line[1].StartsWith("/")) { Headers(stream, "400 Bad Request", "text/plain", 0); return; }
                    string relative = Uri.UnescapeDataString(line[1].Split('?')[0]).Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
                    if (relative.Length == 0) relative = "index.html";
                    string file = Path.GetFullPath(Path.Combine(root, relative));
                    if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase) || relative.Contains(":")) { Headers(stream, "403 Forbidden", "text/plain", 0); return; }
                    string mime = Mime(file);
                    if (mime == null || !File.Exists(file)) { Headers(stream, "404 Not Found", "text/plain", 0); return; }
                    using (FileStream input = File.OpenRead(file)) {
                        Headers(stream, "200 OK", mime, input.Length);
                        if (!head) input.CopyTo(stream);
                    }
                }
            } catch (IOException) { }
              catch (SocketException) { }
              catch (ArgumentException) { }
              catch (NotSupportedException) { }
              catch (UnauthorizedAccessException) { }
        }
    }

    public void Dispose() { running = false; listener.Stop(); }
}
'@

    $gameServer = New-Object HexArenaLocalServer($PSScriptRoot, $Port)
    $gameUrl = 'http://127.0.0.1:' + $gameServer.Port + '/'
    Write-Host ''
    Write-Host 'HEX ARENA - ready / 游戏已启动' -ForegroundColor Cyan
    Write-Host "GAME_URL=$gameUrl"
    Write-Host '游玩期间请保持此窗口开启；退出游戏后可关闭此窗口。'
    Write-Host '若浏览器没有自动打开，请把上方网址复制到 Edge 或 Chrome。'
    Write-Host '关闭窗口或按 Ctrl+C 将停止本地服务。'
    if (!$NoBrowser) {
        try { Start-Process $gameUrl }
        catch { Write-Host "请手动在浏览器打开：$gameUrl" -ForegroundColor Yellow }
    }
    while ($true) { Start-Sleep -Seconds 1 }
} catch {
    Write-Host ('启动失败 / Startup failed: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($gameServer) { $gameServer.Dispose() }
}
