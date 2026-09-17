# MEGAKART — SAISIE ASSISTÉE DES PILOTES DANS GOKARTS
#
# Types a list of pilot names into a window that ALREADY has focus on the right cell.
# It does not search for controls, does not click anything, and does not press any button:
# it only sends characters and a navigation key between names. The operator stays in charge
# of where the cursor is and of starting the session.
#
# WHY TYPING AND NOT PASTING: pasting a multi-line block into the GoKarts grid mangles it
# (observed: 4 rows, one full name, then "H", then "-"). Sending one character at a time with
# an explicit navigation key between rows is predictable.
#
# SAFETY RAILS, all deliberate:
#   - WAITS for the operator to click into the target window; it never seizes the foreground
#   - re-checks the foreground window before every name; aborts instantly if it changed
#   - only ever sends printable characters plus TAB / ENTER / DOWN
#   - never sends ALT, CTRL, F-keys, or mouse events, so it cannot reach a menu or a button
#   - -DryRun targets Notepad instead, so the sequence can be rehearsed safely
#
# It has NOTHING to do with kart power, speed, DeHaardt or the start lights, and never will.
#
#   .\typist.ps1 -Names "MEHDI RAHALI","YOUSSEF AMRANI" -DryRun
#   .\typist.ps1 -Names "MEHDI RAHALI","YOUSSEF AMRANI" -Nav Enter
#   .\typist.ps1 -NamesJson 'C:\path\names.json'

[CmdletBinding()]
param(
  [string[]] $Names,
  [string]   $NamesJson,
  # How the grid moves to the next row. Verify with -DryRun before trusting it.
  [ValidateSet("Enter", "Tab", "Down")] [string] $Nav = "Enter",
  [int] $CharDelayMs = 18,
  [int] $RowDelayMs = 140,
  [int] $Countdown = 2,
  # How long to wait for the operator to click into the target window. Waiting beats
  # seizing the foreground: no focus is ever stolen from whatever they are doing.
  [int] $WaitSeconds = 45,
  [switch] $DryRun,
  [string] $WindowClass = "TDialogMain",
  [string] $WindowTitleLike = "GoKarts"
)

$ErrorActionPreference = "Stop"

# When stdout is piped (the dashboard reads it back), PowerShell uses the OEM codepage and
# accented French output arrives as mojibake. Force UTF-8 so the log stays readable.
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }

if ($NamesJson) {
  if (-not (Test-Path $NamesJson)) { throw "Fichier introuvable : $NamesJson" }
  # Read as UTF-8 explicitly: names carry accents and Get-Content would use the ANSI codepage.
  $Names = [IO.File]::ReadAllText($NamesJson, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
}

# `powershell -File script.ps1 -Names "a","b","c"` hands the whole lot over as ONE string
# rather than an array, so "a,b,c" would be typed as a single pilot. Normalise here instead of
# making the caller remember which invocation form preserves arrays.
$Names = @($Names) |
  ForEach-Object { $_ -split "`r?`n" } |
  ForEach-Object { $_ -split "," } |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ }

if (-not $Names -or $Names.Count -eq 0) { throw "Aucun nom fourni." }

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Typist {
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  // The union must be declared at its FULL size. Windows sizes INPUT by its largest member,
  // MOUSEINPUT (32 bytes on x64), giving sizeof(INPUT) == 40. Declaring only KEYBDINPUT gives
  // 32, and SendInput then rejects every call with ERROR_INVALID_PARAMETER (87) while
  // returning 0 -- silently typing nothing. This member exists purely to size the union; it
  // is never populated, and no mouse event is ever sent.
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT {
    [FieldOffset(0)] public uint type;
    [FieldOffset(8)] public MOUSEINPUT mi;
    [FieldOffset(8)] public KEYBDINPUT ki;
  }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] p, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);

  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;

  // Unicode injection: French names carry é, è, ï. Sending scan codes would depend on the
  // keyboard layout; KEYEVENTF_UNICODE does not.
  public static int StructSize() { return Marshal.SizeOf(typeof(INPUT)); }

  // Both return the number of events Windows ACCEPTED. The caller must check it: a silent 0
  // means nothing was typed, and reporting success in that case is the worst possible outcome.
  public static uint SendChar(char c) {
    INPUT[] inp = new INPUT[2];
    inp[0].type = INPUT_KEYBOARD; inp[0].ki.wScan = c; inp[0].ki.dwFlags = KEYEVENTF_UNICODE;
    inp[1].type = INPUT_KEYBOARD; inp[1].ki.wScan = c; inp[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    return SendInput(2, inp, Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint SendVk(ushort vk) {
    INPUT[] inp = new INPUT[2];
    inp[0].type = INPUT_KEYBOARD; inp[0].ki.wVk = vk;
    inp[1].type = INPUT_KEYBOARD; inp[1].ki.wVk = vk; inp[1].ki.dwFlags = KEYEVENTF_KEYUP;
    return SendInput(2, inp, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string ForegroundClass() {
    StringBuilder sb = new StringBuilder(256);
    GetClassName(GetForegroundWindow(), sb, 256);
    return sb.ToString();
  }
  public static string ForegroundTitle() {
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(GetForegroundWindow(), sb, 512);
    return sb.ToString();
  }
}
"@

$VK = @{ Enter = 0x0D; Tab = 0x09; Down = 0x28 }

# sizeof(INPUT) is 40 on x64 and 28 on x86. Anything else means the struct does not match the
# architecture and SendInput will reject every call -- better to say so than to type nothing.
$expected = if ([IntPtr]::Size -eq 8) { 40 } else { 28 }
$actual = [Typist]::StructSize()
if ($actual -ne $expected) {
  Write-Host "  ECHEC : structure INPUT de $actual octets, attendu $expected." -ForegroundColor Red
  exit 3
}

if ($DryRun) {
  $WindowClass = "Notepad"
  $WindowTitleLike = ""
  Write-Host ""
  Write-Host "  MODE ESSAI — la saisie ira dans le Bloc-notes, jamais dans GoKarts." -ForegroundColor Yellow
  Write-Host "  Ouvrez le Bloc-notes, cliquez dans la zone de texte, puis revenez ici." -ForegroundColor Yellow
}

$targetDesc = "classe '$WindowClass'"
if ($WindowTitleLike) { $targetDesc = $targetDesc + " + titre contenant '" + $WindowTitleLike + "'" }

Write-Host ""
Write-Host "  MEGAKART - saisie assistee" -ForegroundColor Cyan
Write-Host ("  " + ("-" * 58))
Write-Host "  pilotes       : $($Names.Count)"
Write-Host "  navigation    : $Nav entre chaque nom"
Write-Host "  fenetre visee : $targetDesc"
Write-Host ""
foreach ($n in $Names) { Write-Host "     - $n" }
Write-Host ""
Write-Host "  MARCHE A SUIVRE :" -ForegroundColor Yellow
Write-Host "    1. Laissez cette fenetre ouverte."
Write-Host "    2. Cliquez dans la PREMIERE cellule Pilote de GoKarts."
Write-Host "       (ce seul clic met GoKarts devant ET place le curseur)"
Write-Host "    3. Ne touchez plus a rien : la saisie demarre toute seule."
Write-Host ""

function Get-TargetMismatch {
  $cls = [Typist]::ForegroundClass()
  $ttl = [Typist]::ForegroundTitle()
  if ($cls -ne $WindowClass) { return "classe '$cls' au lieu de '$WindowClass'" }
  if ($WindowTitleLike -and $ttl -notlike "*$WindowTitleLike*") { return "titre '$ttl'" }
  return $null
}

# WAIT FOR THE OPERATOR, rather than seizing the foreground.
#
# The button lives in a browser, so the browser is in front the instant it is clicked. The
# first design gave the operator a 5-second countdown to switch windows without touching the
# keyboard, which is a bad thing to ask of someone and failed every time in practice.
#
# We could force the window forward with AttachThreadInput + SetForegroundWindow, but stealing
# focus from whatever the user is doing is exactly the behaviour that makes automation tools
# dangerous. Waiting is safer and needs no such privilege: the operator clicks into the Pilote
# cell whenever they are ready, which focuses GoKarts AND positions the cursor in one action.
Write-Host "  En attente de la fenêtre cible…" -ForegroundColor Yellow
Write-Host "  Cliquez maintenant dans la cellule Pilote de GoKarts." -ForegroundColor Yellow
Write-Host "  (Ctrl+C pour annuler — abandon automatique après $WaitSeconds s)"
Write-Host ""

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if (-not (Get-TargetMismatch)) { $ready = $true; break }
  $left = [int]($deadline - (Get-Date)).TotalSeconds
  Write-Host "`r  en attente… ${left}s   " -NoNewline
  Start-Sleep -Milliseconds 250
}
Write-Host "`r                                                     "

if (-not $ready) {
  Write-Host "  ABANDON : la fenêtre cible n'a jamais été au premier plan ($(Get-TargetMismatch))." -ForegroundColor Red
  Write-Host "  Rien n'a été saisi." -ForegroundColor Red
  exit 1
}

# Let the click settle so the grid has really put the caret in the cell before we type.
Write-Host "  Fenêtre détectée. Saisie dans $Countdown s…" -ForegroundColor Green
for ($i = $Countdown; $i -gt 0; $i--) {
  if (Get-TargetMismatch) {
    Write-Host ""
    Write-Host "  ABANDON : la fenêtre a changé avant le début de la saisie." -ForegroundColor Red
    exit 1
  }
  Write-Host "`r  saisie dans $i s…   " -NoNewline
  Start-Sleep -Seconds 1
}
Write-Host "`r                                                     "



$typed = 0
foreach ($name in $Names) {
  # Re-check before EVERY name: if the operator alt-tabs mid-run, the remaining names must
  # not land in whatever window happens to be in front.
  $why = Get-TargetMismatch
  if ($why) {
    Write-Host ""
    Write-Host "  INTERROMPU après $typed nom(s) : la fenêtre a changé ($why)." -ForegroundColor Red
    exit 2
  }

  foreach ($ch in $name.ToCharArray()) {
    $sent = [Typist]::SendChar($ch)
    if ($sent -eq 0) {
      Write-Host ""
      Write-Host "  ECHEC : Windows a refuse l'injection clavier (SendInput a renvoye 0)." -ForegroundColor Red
      Write-Host "  Rien de fiable n'a ete saisi. Saisissez les noms a la main." -ForegroundColor Red
      exit 3
    }
    Start-Sleep -Milliseconds $CharDelayMs
  }
  $sent = [Typist]::SendVk([uint16]$VK[$Nav])
  if ($sent -eq 0) {
    Write-Host ""
    Write-Host "  ECHEC : la touche de navigation n'a pas ete acceptee." -ForegroundColor Red
    exit 3
  }
  Start-Sleep -Milliseconds $RowDelayMs
  $typed++
  Write-Host "  saisi : $name"
}

Write-Host ""
Write-Host "  $typed nom(s) saisi(s)." -ForegroundColor Green
Write-Host "  Vérifiez la grille, puis armez la session vous-même dans GoKarts." -ForegroundColor Green
Write-Host ""
