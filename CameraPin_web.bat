@echo off
setlocal
REM 3D Camera Pin en el navegador, sin Node ni instalar nada: sirve esta carpeta con PowerShell y
REM abre el navegador (tools\serve.ps1, el de BackplateLab).
REM Uso: CameraPin_web.bat [--tailscale ^| --host <ip>] [--port <n>] [--no-open]
REM   --tailscale  tambien sirve en la IP de Tailscale (100.x) para abrirla desde el telefono
REM La carpeta se guarda antes del bucle: shift tambien corre %0 y %~dp0 dejaria de ser esta.
set "HERE=%~dp0"
set "ARGS=-Open"
:loop
if "%~1"=="" goto run
if /I "%~1"=="--tailscale" set "ARGS=%ARGS% -Tailscale"
if /I "%~1"=="--host" (set "ARGS=%ARGS% -HostIp %~2" & shift)
if /I "%~1"=="--port" (set "ARGS=%ARGS% -Port %~2" & shift)
if /I "%~1"=="--no-open" set "ARGS=%ARGS:-Open=%"
shift
goto loop
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%tools\serve.ps1" %ARGS%
exit /b %ERRORLEVEL%
