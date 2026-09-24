@echo off
REM ---------------------------------------------------------------------------
REM  MEGAKART - redemarrer le serveur d'accueil (desk.mjs, port 5190)
REM
REM  C'est lui qui sert le dashboard ET l'API de la file d'attente. Le fermer
REM  coupe les deux pendant une seconde ou deux ; aucune donnee n'est perdue,
REM  les reservations sont sur le disque (%LOCALAPPDATA%\MegaKart).
REM
REM  Double-cliquez ce fichier. Laissez la fenetre ouverte : c'est le serveur.
REM ---------------------------------------------------------------------------

set "NODE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
if not exist "%NODE%" (
  echo [ERREUR] node.exe introuvable :
  echo          %NODE%
  pause
  exit /b 1
)

cd /d "%~dp0"
if not exist "desk.mjs" (
  echo [ERREUR] desk.mjs introuvable dans %CD%
  pause
  exit /b 1
)

echo.
echo  Arret de l'ancien serveur d'accueil...
REM  On ne tue que node.exe dont la ligne de commande contient desk.mjs : le pont
REM  d'inscription (bridge.mjs) et le reste tournent aussi sous node.exe.
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*desk.mjs*' } | ForEach-Object { Write-Host ('   arret PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"

timeout /t 1 /nobreak >nul

echo  Demarrage...
echo.
"%NODE%" desk.mjs

REM  Si on arrive ici, le serveur s'est arrete. Deux cas :
REM   - une nouvelle copie l'a remplace (bouton Synchroniser du dashboard, ou ce fichier
REM     relance) : elle ecoute deja sur le port, cette fenetre se ferme toute seule ;
REM   - il s'est vraiment arrete : on garde la fenetre pour lire l'erreur.
timeout /t 5 /nobreak >nul
netstat -ano | findstr /r /c:":5190 .*LISTENING" >nul && exit
echo.
echo  Le serveur d'accueil s'est arrete.
pause
