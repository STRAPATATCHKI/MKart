@echo off
REM ---------------------------------------------------------------------------
REM  MEGAKART - donner a un compte de l'application l'acces aux rapports
REM  (revenus et courses dans Firebase).
REM
REM  1. Firebase console > Authentication > Users : creez le compte (email +
REM     mot de passe) et copiez son "User UID".
REM  2. Double-cliquez ce fichier et collez l'UID.
REM ---------------------------------------------------------------------------

set "NODE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
cd /d "%~dp0"

echo.
echo  Comptes qui ont deja acces :
"%NODE%" grant-app-access.mjs --list
echo.
set /p UID=" UID du compte a autoriser (Entree pour quitter) : "
if "%UID%"=="" exit /b 0
"%NODE%" grant-app-access.mjs %UID%
echo.
pause
