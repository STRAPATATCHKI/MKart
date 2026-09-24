@echo off
REM ---------------------------------------------------------------------------
REM  MEGAKART - redemarrer le pont d'inscription (bridge.mjs, port 8787)
REM
REM  Il sert le formulaire d'inscription du Wi-Fi de la piste et transmet chaque
REM  inscription au serveur d'accueil (dashboard). Sans lui, le QR du Wi-Fi ne
REM  repond plus ; le chrono et le dashboard continuent normalement.
REM
REM  Normalement vous n'avez PAS besoin de ce fichier : MegaKart Timing Control
REM  demarre ce pont tout seul. Il est la comme secours.
REM
REM  Double-cliquez. Laissez la fenetre ouverte : c'est le serveur.
REM ---------------------------------------------------------------------------

set "NODE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
if not exist "%NODE%" (
  echo [ERREUR] node.exe introuvable :
  echo          %NODE%
  pause
  exit /b 1
)

cd /d "%~dp0"
if not exist "bridge.mjs" (
  echo [ERREUR] bridge.mjs introuvable dans %CD%
  pause
  exit /b 1
)

echo.
echo  Arret de l'ancien pont d'inscription...
REM  Seulement node.exe dont la ligne de commande contient bridge.mjs : le serveur
REM  d'accueil (desk.mjs) tourne aussi sous node.exe et doit rester en vie.
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*bridge.mjs*' } | ForEach-Object { Write-Host ('   arret PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"

timeout /t 1 /nobreak >nul

echo  Demarrage...
echo.
"%NODE%" bridge.mjs

REM  Si on arrive ici, le serveur s'est arrete. Deux cas :
REM   - une nouvelle copie l'a remplace (bouton Synchroniser du dashboard, ou ce fichier
REM     relance) : elle ecoute deja sur le port, cette fenetre se ferme toute seule ;
REM   - il s'est vraiment arrete : on garde la fenetre pour lire l'erreur.
timeout /t 5 /nobreak >nul
netstat -ano | findstr /r /c:":8787 .*LISTENING" >nul && exit
echo.
echo  Le pont d'inscription s'est arrete.
pause
