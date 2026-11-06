# Servidor estatico de BackplateLab sin Node: PowerShell 5.1 + HttpListener (viene con Windows).
# Lo usa BackplateLab_web.bat. Uso:
#   serve.ps1 [-Port 8642] [-HostIp <ip> | -Tailscale] [-Open]
# Sin -HostIp sirve solo en esta compu (http://localhost:<port>/). Con -HostIp (o -Tailscale, que
# busca la IP 100.x de Tailscale) sirve ADEMAS en esa IP para abrirla desde el telefono; eso pide
# una sola vez, como administrador, el permiso de la URL y la regla del firewall (lo imprime si falta).
param([int]$Port = 8642, [string]$HostIp = '', [switch]$Tailscale, [switch]$Open)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.md' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'; '.glb' = 'model/gltf-binary'
  '.ttf' = 'font/ttf'; '.woff2' = 'font/woff2'; '.mp4' = 'video/mp4'; '.exr' = 'image/x-exr'; '.obj' = 'text/plain' }

if ($Tailscale -and -not $HostIp) {
    # Tailscale reparte direcciones del rango 100.64.0.0/10.
    $HostIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.' } | Select-Object -First 1).IPAddress
    if (-not $HostIp) { Write-Host 'No se encontro una IP de Tailscale (100.x). Tailscale esta conectado?'; exit 1 }
}

# Si ya hay un BackplateLab sirviendo en ese puerto, se abre ese y listo.
$local = "http://localhost:$Port/"
try {
    $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($local + 'js/version.js')
    if ($probe.Content -match 'APP_VERSION') {
        Write-Host "BackplateLab ya esta corriendo en $local"
        if ($Open) { Start-Process $local }
        exit 0
    }
} catch { }

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($local)
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
if ($HostIp) { $listener.Prefixes.Add("http://${HostIp}:$Port/") }
try { $listener.Start() } catch {
    Write-Host "No se pudo abrir el puerto ${Port}: $($_.Exception.Message)"
    if ($HostIp) {
        Write-Host 'Para servir en otra IP, Windows pide una vez (en una consola de ADMINISTRADOR):'
        Write-Host "  netsh http add urlacl url=http://${HostIp}:$Port/ user=$env:USERDOMAIN\$env:USERNAME"
        Write-Host "  netsh advfirewall firewall add rule name=`"BackplateLab $Port`" dir=in action=allow protocol=TCP localport=$Port remoteip=100.64.0.0/10"
    } else { Write-Host "Otro programa usa el puerto ${Port}: probar con --port <otro>." }
    exit 1
}
Write-Host "BackplateLab en $local  (carpeta $root)"
if ($HostIp) { Write-Host "Desde el telefono (Tailscale/LAN): http://${HostIp}:$Port/" }
Write-Host 'Cerrar esta ventana (o Ctrl+C) para apagarlo.'
if ($Open) { Start-Process $local }

try {
    while ($listener.IsListening) {
        # Espera por tramos para que Ctrl+C corte.
        $pending = $listener.BeginGetContext($null, $null)
        while (-not $pending.AsyncWaitHandle.WaitOne(500)) { }
        $ctx = $listener.EndGetContext($pending)
        $res = $ctx.Response
        try {
            $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
            if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
            $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
            if (-not $file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
                $res.StatusCode = 403
            } elseif (-not [IO.File]::Exists($file)) {
                $res.StatusCode = 404
            } else {
                $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
                $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
                $res.Headers['Cache-Control'] = 'no-store'
                $bytes = [IO.File]::ReadAllBytes($file)
                $res.ContentLength64 = $bytes.Length
                if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
            }
        } catch { $res.StatusCode = 500 }
        try { $res.Close() } catch { }
    }
} finally { $listener.Stop(); $listener.Close() }
