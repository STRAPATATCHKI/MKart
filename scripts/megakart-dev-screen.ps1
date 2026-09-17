$ProjectPath = "C:\Users\youss\MegakartDash"

$Host.UI.RawUI.WindowTitle = "MEGAKART - APEX DEVELOPMENT COMMAND CENTER"

$StartTime = Get-Date

$Spinner = @("|", "/", "-", "\")
$SpinIndex = 0
$ScannerPosition = 0
$Frame = 0
$VisualPackets = Get-Random -Minimum 12000 -Maximum 50000
$VisualEvents = Get-Random -Minimum 400 -Maximum 2500
$Progress = 7
$ProgressDirection = 1

$PreviousStatus = @{
    GoKarts  = ""
    GoServer = ""
    Live     = ""
    Sessions = ""
    Members  = ""
}

$Phases = @(
    "ANALYSING APEX DATA STREAM",
    "SEARCHING SESSION CHANNELS",
    "INDEXING LIVE TIMING EVENTS",
    "WATCHING SOURCE CODE",
    "NORMALIZING RACE STATE",
    "CHECKING KART TELEMETRY",
    "VERIFYING SESSION PIPELINE",
    "PROCESSING TIMING RECORDS",
    "SCANNING LOCAL SERVICES",
    "BUILDING LIVE DASHBOARD",
    "WAITING FOR NEW PASSING",
    "SYNCING MEGAKART STATE",
    "DETECTING SESSION ACTIVITY",
    "VALIDATING DRIVER RECORDS",
    "MONITORING GOKARTS ENGINE"
)

$SubMessages = @(
    "Race engine stable",
    "Timing channel ready",
    "Local connector available",
    "Watching for new sessions",
    "No destructive commands enabled",
    "Read channel monitoring active",
    "MegaKart pipeline standing by",
    "Live activity detector armed",
    "Session parser waiting",
    "Development watcher online"
)

function Get-PortStatus {
    param([int]$Port)

    try {
        $Connection = Get-NetTCPConnection `
            -LocalPort $Port `
            -State Listen `
            -ErrorAction SilentlyContinue

        if ($Connection) {
            return "ONLINE"
        }

        return "OFFLINE"
    }
    catch {
        return "UNKNOWN"
    }
}

function Get-ProcStatus {
    param([string]$Name)

    if (Get-Process -Name $Name -ErrorAction SilentlyContinue) {
        return "RUNNING"
    }

    return "STOPPED"
}

function Write-FixedHeader {

    Clear-Host

    Write-Host ""
    Write-Host " __  __ _____ ____    _    _  __    _    ____ _____ " -ForegroundColor Green
    Write-Host "|  \/  | ____/ ___|  / \  | |/ /   / \  |  _ \_   _|" -ForegroundColor Green
    Write-Host "| |\/| |  _|| |  _  / _ \ | ' /   / _ \ | |_) || |  " -ForegroundColor Green
    Write-Host "| |  | | |__| |_| |/ ___ \| . \  / ___ \|  _ < | |  " -ForegroundColor Green
    Write-Host "|_|  |_|_____\____/_/   \_\_|\_\/_/   \_\_| \_\|_|  " -ForegroundColor Green

    Write-Host ""
    Write-Host "              APEX INTEGRATION LAB" -ForegroundColor Cyan
    Write-Host "           DEVELOPMENT COMMAND CENTER" -ForegroundColor Cyan
    Write-Host "             MEGAKART // SYSTEM 01" -ForegroundColor DarkGray
    Write-Host ""

    Write-Host "======================================================================" -ForegroundColor DarkGray
    Write-Host "             LIVE DEVELOPMENT ENVIRONMENT ACTIVE" -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor DarkGray
    Write-Host ""

    return $Host.UI.RawUI.CursorPosition.Y
}

function Clear-DynamicArea {
    param([int]$StartRow)

    try {
        $Width = $Host.UI.RawUI.BufferSize.Width
        $Height = $Host.UI.RawUI.WindowSize.Height

        for ($Row = $StartRow; $Row -lt ($Height - 1); $Row++) {
            $Host.UI.RawUI.CursorPosition =
                New-Object System.Management.Automation.Host.Coordinates 0,$Row

            Write-Host (" " * ($Width - 1)) -NoNewline
        }

        $Host.UI.RawUI.CursorPosition =
            New-Object System.Management.Automation.Host.Coordinates 0,$StartRow
    }
    catch {}
}

function Show-Status {
    param(
        [string]$Label,
        [string]$Status
    )

    Write-Host (" {0,-28}" -f $Label) -NoNewline

    if ($Status -eq "ONLINE" -or $Status -eq "RUNNING") {
        Write-Host "[ $Status ]" -ForegroundColor Green
    }
    elseif ($Status -eq "OFFLINE" -or $Status -eq "STOPPED") {
        Write-Host "[ $Status ]" -ForegroundColor Red
    }
    else {
        Write-Host "[ $Status ]" -ForegroundColor Yellow
    }
}

function Make-ProgressBar {
    param(
        [int]$Value,
        [int]$Width = 50
    )

    $Value = [Math]::Max(0,[Math]::Min(100,$Value))
    $Filled = [Math]::Floor(($Value / 100.0) * $Width)
    $Empty = $Width - $Filled

    return "[" + ("#" * $Filled) + ("." * $Empty) + "]"
}

function Show-Scanner {

    param([int]$Position)

    $Width = 62
    $Pos = $Position % $Width
    $Line = ""

    for ($i = 0; $i -lt $Width; $i++) {

        $Distance = [Math]::Abs($i - $Pos)

        if ($Distance -eq 0) {
            $Line += "#"
        }
        elseif ($Distance -eq 1) {
            $Line += "+"
        }
        elseif ($Distance -eq 2) {
            $Line += ":"
        }
        elseif ($Distance -eq 3) {
            $Line += "."
        }
        else {
            $Line += " "
        }
    }

    Write-Host " [$Line]" -ForegroundColor Green
}

function Get-RecentFiles {

    $WatchPaths = @(
        "$ProjectPath\app",
        "$ProjectPath\db",
        "$ProjectPath\lib",
        "$ProjectPath\worker",
        "$ProjectPath\scripts",
        "$ProjectPath\hooks",
        "$ProjectPath\components"
    )

    $Existing = $WatchPaths | Where-Object { Test-Path $_ }

    if (-not $Existing) {
        return @()
    }

    return Get-ChildItem $Existing `
        -Recurse `
        -File `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 6
}

function Show-MiniGraph {

    $Values = @()

    for ($i = 0; $i -lt 34; $i++) {
        $Values += Get-Random -Minimum 1 -Maximum 9
    }

    $Graph = ""

    foreach ($Value in $Values) {

        if ($Value -ge 8) {
            $Graph += "#"
        }
        elseif ($Value -ge 6) {
            $Graph += "O"
        }
        elseif ($Value -ge 4) {
            $Graph += "o"
        }
        elseif ($Value -ge 2) {
            $Graph += "."
        }
        else {
            $Graph += "_"
        }
    }

    Write-Host " SIGNAL  $Graph" -ForegroundColor Cyan
}

function Show-Spark {

    $Patterns = @(
        @(
            "                 .",
            "              .  |  .",
            "            --   *   --",
            "              .  |  .",
            "                 ."
        ),
        @(
            "             \   |   /",
            "              \  |  /",
            "           ----  *  ----",
            "              /  |  \",
            "             /   |   \"
        ),
        @(
            "          *       .       *",
            "             \    |    /",
            "        . -----   *   ----- .",
            "             /    |    \",
            "          *       .       *"
        )
    )

    $Pattern = $Patterns | Get-Random

    Write-Host ""
    Write-Host " EVENT DETECTED" -ForegroundColor Yellow

    foreach ($Line in $Pattern) {
        Write-Host $Line -ForegroundColor Green
    }
}

function Show-Firework {

    $Frames = @(
        @(
            "                  .",
            "                  *",
            "                  |"
        ),
        @(
            "              .   |   .",
            "                \ | /",
            "             ---- * ----",
            "                / | \",
            "              .   |   ."
        ),
        @(
            "          *       .|.       *",
            "             \     |     /",
            "       . ------   ***   ------ .",
            "             /     |     \",
            "          *       .|.       *"
        )
    )

    foreach ($FireFrame in $Frames) {

        Write-Host ""

        foreach ($Line in $FireFrame) {
            Write-Host $Line -ForegroundColor Green
        }

        Start-Sleep -Milliseconds 180
    }
}

function Has-StatusChangedToGood {

    param(
        [string]$Key,
        [string]$Current
    )

    $Old = $PreviousStatus[$Key]
    $PreviousStatus[$Key] = $Current

    if (
        $Old -ne "" -and
        $Old -ne $Current -and
        ($Current -eq "ONLINE" -or $Current -eq "RUNNING")
    ) {
        return $true
    }

    return $false
}

$DynamicStart = Write-FixedHeader

while ($true) {

    Clear-DynamicArea $DynamicStart

    $Frame++
    $Elapsed = (Get-Date) - $StartTime

    $SpinnerChar = $Spinner[$SpinIndex]
    $SpinIndex = ($SpinIndex + 1) % $Spinner.Count

    $GoKartsStatus = Get-ProcStatus "GoKarts"
    $GoServerStatus = Get-ProcStatus "GoServer"

    $LiveStatus = Get-PortStatus 30001
    $SessionsStatus = Get-PortStatus 9122
    $MembersStatus = Get-PortStatus 9120

    $MajorRecovery = $false

    if (Has-StatusChangedToGood "GoKarts" $GoKartsStatus) {
        $MajorRecovery = $true
    }

    if (Has-StatusChangedToGood "GoServer" $GoServerStatus) {
        $MajorRecovery = $true
    }

    if (Has-StatusChangedToGood "Live" $LiveStatus) {
        $MajorRecovery = $true
    }

    if (Has-StatusChangedToGood "Sessions" $SessionsStatus) {
        $MajorRecovery = $true
    }

    if (Has-StatusChangedToGood "Members" $MembersStatus) {
        $MajorRecovery = $true
    }

    Write-Host " $SpinnerChar  CLAUDE / ANTIGRAVITY DEVELOPMENT ACTIVE" -ForegroundColor Cyan
    Write-Host ""

    Write-Host (
        " SESSION TIME     {0:00}:{1:00}:{2:00}" -f `
        [Math]::Floor($Elapsed.TotalHours),
        $Elapsed.Minutes,
        $Elapsed.Seconds
    ) -ForegroundColor White

    Write-Host (" FRAME            {0:D6}" -f $Frame) -ForegroundColor DarkGray

    Write-Host ""
    Write-Host " APEX ENGINE" -ForegroundColor Cyan
    Write-Host " --------------------------------------------------------------------"

    Show-Status "GoKarts.exe" $GoKartsStatus
    Show-Status "GoServer.exe" $GoServerStatus
    Show-Status "Live Feed :30001" $LiveStatus
    Show-Status "Sessions API :9122" $SessionsStatus
    Show-Status "Members API :9120" $MembersStatus

    Write-Host ""
    Write-Host " ACTIVE SCANNER" -ForegroundColor Cyan
    Write-Host " --------------------------------------------------------------------"

    Show-Scanner $ScannerPosition

    $ScannerPosition++

    Write-Host ""
    Write-Host " CURRENT OPERATION" -ForegroundColor Cyan
    Write-Host " --------------------------------------------------------------------"

    $CurrentPhase = $Phases | Get-Random
    $Message = $SubMessages | Get-Random

    Write-Host ""
    Write-Host " $SpinnerChar $CurrentPhase..." -ForegroundColor White
    Write-Host "   $Message" -ForegroundColor DarkGray

    $Progress += (Get-Random -Minimum 1 -Maximum 7) * $ProgressDirection

    if ($Progress -ge 96) {
        $Progress = 96
        $ProgressDirection = -1
    }

    if ($Progress -le 8) {
        $Progress = 8
        $ProgressDirection = 1
    }

    $Bar = Make-ProgressBar $Progress 48

    Write-Host ""
    Write-Host " $Bar $Progress%" -ForegroundColor Green

    $VisualPackets += Get-Random -Minimum 8 -Maximum 145
    $VisualEvents += Get-Random -Minimum 1 -Maximum 15

    $VisualLatency = Get-Random -Minimum 2 -Maximum 28
    $VisualNode = Get-Random -Minimum 1000 -Maximum 9999
    $VisualSession = Get-Random -Minimum 10000 -Maximum 99999
    $VisualEntropy = Get-Random -Minimum 100000 -Maximum 999999

    Write-Host ""
    Write-Host " VISUAL TELEMETRY" -ForegroundColor Cyan
    Write-Host " --------------------------------------------------------------------"
    Write-Host (" PACKETS       {0,12:N0}" -f $VisualPackets) -ForegroundColor White
    Write-Host (" EVENTS        {0,12:N0}" -f $VisualEvents) -ForegroundColor White
    Write-Host (" LATENCY       {0,12} ms" -f $VisualLatency) -ForegroundColor White
    Write-Host (" NODE          MK-{0}" -f $VisualNode) -ForegroundColor White
    Write-Host (" TRACE         {0}" -f $VisualSession) -ForegroundColor White
    Write-Host (" ENTROPY       {0}" -f $VisualEntropy) -ForegroundColor DarkGray

    Write-Host ""
    Show-MiniGraph

    Write-Host ""
    Write-Host " RECENT CODE ACTIVITY" -ForegroundColor Cyan
    Write-Host " --------------------------------------------------------------------"

    $RecentFiles = Get-RecentFiles

    if ($RecentFiles.Count -eq 0) {

        Write-Host " Waiting for source changes..." -ForegroundColor DarkGray

    }
    else {

        foreach ($File in $RecentFiles) {

            $Age = [int]((Get-Date) - $File.LastWriteTime).TotalSeconds
            $Name = $File.Name

            if ($Name.Length -gt 34) {
                $Name = $Name.Substring(0,31) + "..."
            }

            if ($Age -lt 5) {
                Write-Host (
                    " > {0,-35} {1,5}s ago   MODIFIED" -f $Name,$Age
                ) -ForegroundColor Green
            }
            else {
                Write-Host (
                    "   {0,-35} {1,5}s ago" -f $Name,$Age
                ) -ForegroundColor White
            }
        }
    }

    $NewCodeDetected = $false

    if ($RecentFiles.Count -gt 0) {

        $NewestAge = ((Get-Date) - $RecentFiles[0].LastWriteTime).TotalSeconds

        if ($NewestAge -lt 3) {
            $NewCodeDetected = $true
        }
    }

    Write-Host ""
    Write-Host " MEGAKART DATA FLOW" -ForegroundColor Cyan
    Write-Host " --------------------------------------------------------------------"

    Write-Host ""
    Write-Host "      DETECTOR / TRANSPONDER" -ForegroundColor White
    Write-Host "                |"
    Write-Host "                v"
    Write-Host "           APEX GOKARTS" -ForegroundColor Green
    Write-Host "                |"
    Write-Host "                v"
    Write-Host "          TCP LIVE :30001" -ForegroundColor Green
    Write-Host "                |"
    Write-Host "                v"
    Write-Host "        MEGAKART CONNECTOR" -ForegroundColor Cyan
    Write-Host "                |"
    Write-Host "                v"
    Write-Host "        LIVE RACE DASHBOARD" -ForegroundColor Green

    if ($MajorRecovery) {

        Write-Host ""
        Write-Host " >>> APEX LINK ESTABLISHED <<<" -ForegroundColor Green
        Show-Firework

    }
    elseif ($NewCodeDetected) {

        Write-Host ""
        Write-Host " >>> NEW DEVELOPMENT ACTIVITY DETECTED <<<" -ForegroundColor Green
        Show-Spark

    }
    elseif ((Get-Random -Minimum 1 -Maximum 18) -eq 7) {

        Write-Host ""
        Write-Host " >>> SYSTEM EVENT <<<" -ForegroundColor Yellow
        Show-Spark
    }

    Write-Host ""
    Write-Host " SYSTEM STATE: MONITORING / BUILDING / WAITING" -ForegroundColor Yellow
    Write-Host " CTRL+C TO TERMINATE COMMAND CENTER" -ForegroundColor DarkGray

    Start-Sleep -Milliseconds 1800
}