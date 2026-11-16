# One-line install of foxleague-agent on Windows 10 and 11 (the agent runs inside WSL2, in Ubuntu):
#
#   irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 | iex
#
# Paste it into a normal PowerShell window (Windows PowerShell 5.1 or PowerShell 7), not one opened as
# administrator. What it does, in this order, saying each step in one line:
#   1. checks this PC: 64-bit Windows 10 version 2004 (build 19041) or later, virtualization where that can be told;
#   2. WSL: when it is missing, runs Microsoft's own "wsl --install --no-distribution" as administrator (Windows
#      asks for that with its own prompt) and, when Windows needs a restart, says so: restart, paste the line again;
#   3. Ubuntu: when it is missing, runs "wsl --install -d Ubuntu". Ubuntu asks for a Linux username and password
#      in the terminal. They are typed into Ubuntu, never into this script;
#   4. inside Ubuntu, as root: systemd turned on in /etc/wsl.conf (one [boot] section, never a second one), curl
#      and ca-certificates installed when they are missing;
#   5. inside Ubuntu, as your own Linux user: the normal installer (get.sh), in this same window;
#   6. a scheduled task of your Windows user, "FoxLeague Agent (WSL)", that keeps Ubuntu running while you are
#      logged in to Windows;
#   7. the dashboard address.
# It is safe to paste any number of times: every run looks at what is already there and goes on from it.
#
# To remove what it added on the Windows side (the scheduled task, nothing else) and, after one question, the agent's
# background service inside Ubuntu (./install.sh --uninstall, run for you; your folder and wallet words stay):
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1))) -Uninstall
#
# Switches, set in the PowerShell window before the line ($env:NAME = 'value'). The first four are get.sh's own
# and are handed to it:
#   FOXAGENT_VERSION=vX.Y.Z      a given release instead of the newest
#   FOXAGENT_DIR                 another folder inside Ubuntu (never a Windows folder)
#   FOXAGENT_RELEASES            another place that publishes the releases (a mirror, a test)
#   FOXAGENT_ALLOW_DOWNGRADE=1   put an older version over a newer install
#   FOXAGENT_GET_URL             another address for get.sh itself (a test before a release is public)
#
# FOR THE NEXT PERSON WHO CHANGES THIS FILE. You will probably not have a Windows PC at hand either, so:
# - Plain ASCII only. Windows PowerShell 5.1 reads a file without a byte order mark as the PC's own code page.
# - The whole script is ONE function, called on the last line. A download that was cut short does not parse, or
#   never reaches the call: nothing of it runs. Everything else is a function nested in it, so pasting the line
#   leaves no functions behind in the user's window, and the strict mode set below ends with the function.
# - Never "exit": under "| iex" that would close the user's window. Stop with Stop-Fox, which the last lines of
#   the main function turn into one red line.
# - Windows PowerShell 5.1 rules: no ternary, no ??, no &&. Under strict mode a single value has no .Count there:
#   wrap what may be one item in @( ) before counting. Read a hashtable with ['key'].
# - Every decision is a small function that takes text or plain values and returns what to do (Get-FoxWslState,
#   Get-FoxWslConfPlan, Get-FoxPassedEnv ...). Everything that touches Windows or starts a program is a thin
#   function of its own (Get-FoxWindowsFacts, Invoke-FoxProcess, Register-FoxKeepAlive ...). test/windows/ loads
#   this file with -DefineOnly in PowerShell 7 on Linux, replaces the thin ones with stand-ins and checks the rest.
# - wsl.exe is started through System.Diagnostics.Process with the argument text written here, not through
#   PowerShell's own argument passing, which differs between 5.1 and 7 when an argument holds a quote. What goes
#   to Linux is always "--exec <program> <arguments>": wsl.exe then splits the text by the usual Windows rules
#   (CommandLineToArgvW) and no Linux shell of the user reads it. ConvertTo-FoxArgument quotes by those rules.
# - wsl.exe prints its own messages in UTF-16 unless WSL_UTF8=1 is set (old versions ignore that). The bytes are
#   read as they are and decoded by ConvertFrom-FoxBytes. Its messages are translated by Windows, so nothing here
#   decides on their words: decisions use exit codes, version numbers and the table of "wsl -l -v", which is not
#   translated.
# - Nothing is downloaded and run on the Windows side except Microsoft's own wsl.exe. No password, key or
#   recovery word passes through this script: the one line it reads of the agent's .env is the dashboard port,
#   cut down to its digits inside Ubuntu.

function Install-FoxLeagueAgent {
    [CmdletBinding()]
    param(
        # Removes the scheduled task this script made and, after one question, the agent's service inside Ubuntu.
        [switch]$Uninstall,
        # Only defines the functions (for the checks in test/windows/): nothing is looked at and nothing runs.
        [switch]$DefineOnly
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    # ---- the names this script uses ----
    $FoxDistro = 'Ubuntu'
    $FoxTaskName = 'FoxLeague Agent (WSL)'
    $FoxGetUrl = 'https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh'
    $FoxLine = 'irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 | iex'
    $FoxWslDocs = 'https://learn.microsoft.com/windows/wsl/troubleshooting'
    # systemd in WSL needs WSL 0.67.6 or later (Microsoft's page "Use systemd to manage Linux services with WSL").
    $FoxMinWsl = '0.67.6'
    # What the installer inside Ubuntu names its service and its folder (install.sh, get.sh).
    $FoxUnit = 'foxleague-agent.service'
    $FoxFolder = 'foxleague-agent'
    # What the scheduled task gives wsl.exe to run: it keeps Ubuntu up (Get-FoxKeepAliveAction).
    $FoxKeepAliveArgs = '-d ' + $FoxDistro + ' --cd ~ --exec /bin/sleep infinity'

    # ================================================================================================
    # Words on the screen
    # ================================================================================================
    function Write-FoxStep([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Yellow }
    function Write-FoxLine([string]$Text) { Write-Host ('  ' + $Text) }
    # One line that must not be missed, in the colour of the step titles (W-14).
    function Write-FoxNote([string]$Text) { Write-Host ('  ' + $Text) -ForegroundColor Yellow }
    # Ends the run with one sentence. The main function catches it; nothing after it runs.
    function Stop-Fox([string]$Text) {
        $e = New-Object System.InvalidOperationException($Text)
        $e.Data['FoxStop'] = $true
        throw $e
    }
    function Read-FoxLine([string]$Prompt) { return [string](Read-Host ('  ' + $Prompt)) }
    # A yes or no question. Enter takes the default.
    function Confirm-Fox([string]$Question, [bool]$DefaultYes) {
        $hint = '(Enter means yes, n means no)'
        if (-not $DefaultYes) { $hint = '(Enter means no, y means yes)' }
        $answer = (Read-FoxLine ($Question + ' ' + $hint)).Trim()
        return (Get-FoxYes $answer $DefaultYes)
    }
    function Get-FoxYes([string]$Answer, [bool]$DefaultYes) {
        if ($Answer -eq '') { return $DefaultYes }
        return ($Answer -match '^[Yy]')
    }

    # ================================================================================================
    # Decisions: plain values in, what to do out. No Windows and no program is touched in this part.
    # ================================================================================================

    # The bytes a program printed, as text. wsl.exe prints UTF-16 (little endian) unless WSL_UTF8=1 is set and
    # understood, in which case it prints UTF-8. UTF-16 text of Latin letters has a zero byte in every pair, UTF-8
    # text has none, so one zero byte among the first bytes settles it. Byte order marks, zero characters and
    # carriage returns are taken out: what is left is lines that end in a line feed.
    function ConvertFrom-FoxBytes([byte[]]$Bytes) {
        if ($null -eq $Bytes -or $Bytes.Length -eq 0) { return '' }
        $utf16 = $false
        if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) { $utf16 = $true }
        else {
            $look = [Math]::Min($Bytes.Length, 512)
            for ($i = 0; $i -lt $look; $i++) { if ($Bytes[$i] -eq 0) { $utf16 = $true; break } }
        }
        if ($utf16) { $text = [System.Text.Encoding]::Unicode.GetString($Bytes) }
        else { $text = [System.Text.Encoding]::UTF8.GetString($Bytes) }
        return $text.Replace([string][char]0xFEFF, '').Replace([string][char]0, '').Replace("`r", '')
    }

    # The bytes of a Linux text file, as text, or $null when they are not UTF-8 text (a zero byte, a broken
    # sequence). A file that cannot be read exactly is never written back.
    function ConvertFrom-FoxLinuxBytes([byte[]]$Bytes) {
        if ($null -eq $Bytes -or $Bytes.Length -eq 0) { return '' }
        foreach ($b in $Bytes) { if ($b -eq 0) { return $null } }
        $strict = New-Object System.Text.UTF8Encoding($false, $true)
        try { return $strict.GetString($Bytes) } catch { return $null }
    }

    # One argument, quoted the way a Windows program splits its command line (CommandLineToArgvW): in double
    # quotes when it holds a space or a quote, a quote inside written as \" and the backslashes in front of a
    # quote doubled.
    function ConvertTo-FoxArgument([string]$Value) {
        if ($Value -ne '' -and $Value -notmatch '[\s"]') { return $Value }
        $sb = New-Object System.Text.StringBuilder
        [void]$sb.Append('"')
        $slashes = 0
        foreach ($ch in $Value.ToCharArray()) {
            if ($ch -eq [char]'\') { $slashes++; continue }
            if ($ch -eq [char]'"') {
                [void]$sb.Append('\' * ($slashes * 2 + 1))
                [void]$sb.Append('"')
            } else {
                if ($slashes -gt 0) { [void]$sb.Append('\' * $slashes) }
                [void]$sb.Append($ch)
            }
            $slashes = 0
        }
        if ($slashes -gt 0) { [void]$sb.Append('\' * ($slashes * 2)) }
        [void]$sb.Append('"')
        return $sb.ToString()
    }

    # The argument text for wsl.exe that runs one Linux program in Ubuntu, in the user's Linux home folder.
    # -User root for the steps that change the system; without it the distribution's own default user.
    # Ubuntu is always named: the user's default distribution may be another one, and it is never changed.
    function Get-FoxWslArguments {
        param([string]$User = '', [string[]]$Command)
        $parts = @('-d', $FoxDistro)
        if ($User -ne '') { $parts += @('-u', $User) }
        $parts += @('--cd', '~', '--exec')
        foreach ($c in $Command) { $parts += (ConvertTo-FoxArgument $c) }
        return ($parts -join ' ')
    }

    # True when version $A (1.2.3 or 1.2.3.4) is older than $B. Parts that are missing count as 0.
    function Test-FoxVersionOlder([string]$A, [string]$B) {
        $x = @($A.Split('.')); $y = @($B.Split('.'))
        for ($i = 0; $i -lt 4; $i++) {
            $p = 0; $q = 0
            if ($i -lt $x.Count) { [void][int]::TryParse($x[$i], [ref]$p) }
            if ($i -lt $y.Count) { [void][int]::TryParse($y[$i], [ref]$q) }
            if ($p -lt $q) { return $true }
            if ($p -gt $q) { return $false }
        }
        return $false
    }

    # The WSL version out of "wsl --version". Its first line is "WSL version: 2.6.1.0" with the label translated
    # by Windows, so the first number with dots is taken. '' when there is none.
    function Get-FoxWslVersion([string]$VersionText) {
        if ($VersionText -match '(\d+\.\d+\.\d+(\.\d+)?)') { return $Matches[1] }
        return ''
    }

    # The WSL version new distributions are made for, out of "wsl --status" ("Default Version: 2", the label
    # translated): the first line that ends in a colon and 1 or 2. 0 when it cannot be told.
    function Get-FoxDefaultWslVersion([string]$StatusText) {
        foreach ($line in @($StatusText -split "`n")) {
            if ($line -match ':\s*([12])\s*$') { return [int]$Matches[1] }
        }
        return 0
    }

    # Is WSL 2 there and new enough for systemd?  Returns 'ready', 'install' or 'update'.
    #   $VmCompute    whether Windows has the service "vmcompute" (the Virtual Machine Platform feature, which
    #                 WSL 2 runs on; wsl.exe itself looks for the same service): $true, $false or $null (not told)
    #   --version     only the WSL of the Microsoft Store or of the MSI package answers it with status 0
    #   --status      the WSL that came inside Windows answers it too, the bare wsl.exe of a PC without WSL does not
    #                 (only its status counts: its words are translated by Windows)
    # 'install': run "wsl --install --no-distribution" as administrator. 'update': WSL is there but older than
    # 0.67.6 (no systemd): run "wsl --update".
    function Get-FoxWslState {
        param($VmCompute, [int]$VersionExit, [string]$VersionText, [int]$StatusExit)
        if ($VmCompute -eq $false) { return 'install' }
        if ($VersionExit -eq 0) {
            $v = Get-FoxWslVersion $VersionText
            if ($v -ne '' -and (Test-FoxVersionOlder $v $FoxMinWsl)) { return 'update' }
            return 'ready'
        }
        if ($StatusExit -eq 0) { return 'update' }
        return 'install'
    }

    # After "wsl --install --no-distribution" ran as administrator: 'go-on' (WSL answers now), 'restart'
    # (Windows has to restart first), 'refused' (the administrator prompt was answered with No, or there was
    # none to answer) or 'failed'. 3010 is Windows' own "done, restart needed".
    function Get-FoxAfterWslInstall {
        param([string]$Outcome, $ExitCode, [bool]$ReadyNow)
        if ($Outcome -eq 'refused') { return 'refused' }
        if ($ReadyNow) { return 'go-on' }
        if ($null -eq $ExitCode -or $ExitCode -eq 0 -or $ExitCode -eq 3010) { return 'restart' }
        return 'failed'
    }

    # The table of "wsl -l -v" as a list of @{ Name; Default; State; Version }. Its header and its states are
    # not translated. A line counts when it ends in a number: the header and any sentence do not.
    function Get-FoxDistros([string]$ListText) {
        $found = @()
        foreach ($line in @($ListText -split "`n")) {
            if ($line -match '^\s*(\*?)\s*([A-Za-z0-9._-]+)\s+([A-Za-z]+)\s+(\d+)\s*$') {
                $found += @{ Name = $Matches[2]; Default = ($Matches[1] -eq '*'); State = $Matches[3]; Version = [int]$Matches[4] }
            }
        }
        return , $found
    }

    # The distribution called exactly Ubuntu (WSL compares names without regard to case), or $null.
    function Select-FoxUbuntu($Distros) {
        foreach ($d in @($Distros)) { if ($d['Name'] -ieq $FoxDistro) { return $d } }
        return $null
    }

    # Other distributions whose name starts with Ubuntu (Ubuntu-22.04, Ubuntu-24.04): named to the user, not used.
    function Get-FoxOtherUbuntus($Distros) {
        $names = @()
        foreach ($d in @($Distros)) {
            if ($d['Name'] -ine $FoxDistro -and $d['Name'] -like 'Ubuntu*') { $names += $d['Name'] }
        }
        return , $names
    }

    # Can the installer run in Ubuntu now?
    #   $Entry    Ubuntu's line of Get-FoxDistros, or $null
    #   $IdExit   the status of "id -u" run in Ubuntu as its default user, $IdText what it printed
    # 'not-registered'  Ubuntu is not there (yet)
    # 'busy'            Windows is still installing or converting it
    # 'wsl1'            it runs under WSL 1, which has no systemd
    # 'no-start'        it is there and could not be started
    # 'no-user'         its default user is root: the first start, where Ubuntu asks for a username, is not done
    # 'ready'
    function Get-FoxUbuntuReadiness {
        param($Entry, [int]$IdExit, [string]$IdText)
        if ($null -eq $Entry) { return 'not-registered' }
        if ($Entry['State'] -ne 'Running' -and $Entry['State'] -ne 'Stopped') { return 'busy' }
        if ($Entry['Version'] -ne 2) { return 'wsl1' }
        $id = $IdText.Trim()
        if ($IdExit -ne 0 -or $id -notmatch '^\d+$') { return 'no-start' }
        if ($id -eq '0') { return 'no-user' }
        return 'ready'
    }

    # The Linux users a person logs in as, out of Ubuntu's passwd ("getent passwd"): uid 1000 to 59999, a login shell
    # (not nologin or false) and a name as Ubuntu makes them. Ubuntu's own first start makes such a user.
    function Get-FoxLinuxUsers([string]$Passwd) {
        $names = @()
        foreach ($line in @($Passwd -split "`n")) {
            $f = @($line.TrimEnd("`r").Split(':'))
            if ($f.Count -lt 7) { continue }
            $uid = 0
            if (-not [int]::TryParse($f[2], [ref]$uid)) { continue }
            if ($uid -lt 1000 -or $uid -gt 59999) { continue }
            if ($f[6] -match '(nologin|false)$') { continue }
            if ($f[0] -cnotmatch '^[a-z_][a-z0-9_-]{0,31}$') { continue }
            $names += $f[0]
        }
        return , $names
    }

    # What to do when Ubuntu starts as root and asks nothing, also after it was started here once (INS-U2): its first
    # start was done earlier with root as its user, or root was made its default since. The installer runs as Ubuntu's
    # default user, which has to be one of its own: a user that is there is named, else how to make one is said.
    # [user] default= in /etc/wsl.conf is what every WSL reads; it counts once Ubuntu has restarted.
    #   $Users  Get-FoxLinuxUsers of that Ubuntu (none when it could not be asked)
    # Returns the lines to show, in order.
    function Get-FoxRootUbuntuHelp($Users) {
        $list = @($Users)
        $name = 'NAME'
        $lines = @()
        if ($list.Count -gt 0) {
            $name = [string]$list[0]
            $lines += ('Ubuntu starts as root and asks nothing. It has a user of your own: ' + ($list -join ' and ') + '.')
            $lines += ('The agent is installed as the user Ubuntu starts as, so make ' + $name + ' that user. In PowerShell type')
            $lines += ('  wsl -d ' + $FoxDistro + ' -u root --cd ~')
            $lines += 'then inside Ubuntu'
        } else {
            $lines += 'Ubuntu started as root and asked for no username.'
            $lines += 'If Ubuntu from the Start menu asks for one, choose the username and password there and paste the line again.'
            $lines += 'If it asks nothing, root is its user and the agent needs one of its own. In PowerShell type'
            $lines += ('  wsl -d ' + $FoxDistro + ' -u root --cd ~')
            $lines += 'then inside Ubuntu, one line at a time (NAME is a username of your choice; adduser asks for a password):'
            $lines += '  adduser NAME'
            $lines += '  usermod -aG sudo NAME'
        }
        $lines += '  nano /etc/wsl.conf'
        $lines += ('and add the two lines [user] and default=' + $name + ' (if the file has [user] already: set its default= line).')
        $lines += ('Leave nano with Ctrl-X, then Y and Enter. Type  exit . In PowerShell type  wsl --terminate ' + $FoxDistro)
        $lines += 'and paste the line again.'
        return , $lines
    }

    # What to do with /etc/wsl.conf so that systemd starts with Ubuntu. Returns
    #   @{ Changed = $false; Text = <the same text>; What = 'already' }                    or
    #   @{ Changed = $true;  Text = <the new text>;  What = 'added-section' | 'added-line' | 'set-true' }
    # It follows the rules of WSL's own reader (src/shared/configfile/configfile.cpp in microsoft/WSL):
    #   - a section is "[name]" with no space inside the brackets, alone on its line (a # comment may follow);
    #   - a key is "name = value", the value ends at a # or at the line's end, quotes around it are dropped;
    #   - names are compared without regard to case; true is "true" or "1";
    #   - when a key is there twice, WSL takes the FIRST one and warns about the others. So a second "[boot]"
    #     with "systemd=true" appended to a file that already says "systemd=false" changes nothing, and it is
    #     never done here: the line that is there is corrected, a missing line is put under the [boot] that is
    #     there, and a [boot] section is added only when the file has none.
    # Lines that are not touched stay byte for byte as they were, also their line ends (a file saved on Windows
    # may end its lines with CR LF; a new line then ends the same way).
    function Get-FoxWslConfPlan([string]$Text) {
        $cr = ''
        if ($Text -match "`r`n") { $cr = "`r" }
        $lines = @()
        if ($Text -ne '') { $lines = @($Text -split "`n") }
        $section = ''
        $firstBoot = -1
        $keys = @()   # indexes of the systemd lines inside [boot] sections
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i].TrimEnd("`r")
            if ($line -match '^[ \t]*\[([A-Za-z][A-Za-z0-9]*)\][ \t]*(#.*)?$') {
                $section = $Matches[1].ToLowerInvariant()
                if ($section -eq 'boot' -and $firstBoot -lt 0) { $firstBoot = $i }
                continue
            }
            if ($section -eq 'boot' -and $line -match '^[ \t]*systemd[ \t]*=') { $keys += $i }
        }

        if ($keys.Count -gt 0) {
            $changed = $false
            foreach ($i in $keys) {
                $line = $lines[$i].TrimEnd("`r")
                $ending = $lines[$i].Substring($line.Length)
                [void]($line -match '^([ \t]*)systemd[ \t]*=[ \t]*([^#]*?)[ \t]*(#.*)?$')
                $indent = $Matches[1]
                $value = $Matches[2].Trim().Trim('"')
                $comment = ''
                if ($Matches.ContainsKey(3)) { $comment = ' ' + $Matches[3] }
                if ($value -ieq 'true' -or $value -eq '1') { continue }
                $lines[$i] = $indent + 'systemd=true' + $comment + $ending
                $changed = $true
            }
            if (-not $changed) { return @{ Changed = $false; Text = $Text; What = 'already' } }
            return @{ Changed = $true; Text = ($lines -join "`n"); What = 'set-true' }
        }

        if ($firstBoot -ge 0) {
            # Right under the first [boot]. When that line is the file's last and has no line end, it gets one.
            $out = @()
            for ($i = 0; $i -lt $lines.Count; $i++) {
                if ($i -ne $firstBoot) { $out += $lines[$i]; continue }
                $isLast = ($i -eq $lines.Count - 1)
                if ($isLast) { $out += ($lines[$i].TrimEnd("`r") + $cr); $out += ('systemd=true' + $cr); $out += '' }
                else { $out += $lines[$i]; $out += ('systemd=true' + $cr) }
            }
            return @{ Changed = $true; Text = ($out -join "`n"); What = 'added-line' }
        }

        $new = $Text
        if ($new -ne '' -and -not $new.EndsWith("`n")) { $new += ($cr + "`n") }
        if ($new -ne '') { $new += ($cr + "`n") }
        $new += ('[boot]' + $cr + "`n" + 'systemd=true' + $cr + "`n")
        return @{ Changed = $true; Text = $new; What = 'added-section' }
    }

    # What "systemctl is-system-running" printed: 'ok' (running, or degraded: some unit failed, which is usual
    # in WSL and does not matter here), 'wait' (still starting) or 'no' (systemd does not run: offline, unknown,
    # no systemctl, nothing printed).
    function Get-FoxSystemdState([string]$Text) {
        $word = ''
        foreach ($line in @($Text -split "`n")) { if ($line.Trim() -ne '') { $word = $line.Trim().ToLowerInvariant(); break } }
        if ($word -eq 'running' -or $word -eq 'degraded') { return 'ok' }
        if ($word -eq 'starting' -or $word -eq 'initializing') { return 'wait' }
        return 'no'
    }

    # The switches of get.sh that are set in this PowerShell window, as NAME=value pairs for "env" inside
    # Ubuntu, and the address of get.sh. They are handed over on the command line, not through WSLENV, which the
    # user may not have set. Every value is held to a short list of characters first: it becomes part of a
    # command, and a value that could end one argument and start another is refused, not repaired.
    #   $Values  @{ NAME = value } as read from the environment; a missing or empty one is left out.
    # Returns @{ Pairs = @('NAME=value', ...); GetUrl = <address of get.sh>; Error = '' or why not }.
    function Get-FoxPassedEnv([hashtable]$Values) {
        $pairs = @()
        $url = $FoxGetUrl
        $webSafe = '^https?://[A-Za-z0-9._~:/%+=@,-]+$'
        foreach ($name in @('FOXAGENT_VERSION', 'FOXAGENT_RELEASES', 'FOXAGENT_DIR', 'FOXAGENT_ALLOW_DOWNGRADE', 'FOXAGENT_GET_URL')) {
            $v = ''
            if ($Values.ContainsKey($name) -and $null -ne $Values[$name]) { $v = ([string]$Values[$name]).Trim() }
            if ($v -eq '') { continue }
            $bad = ''
            if ($name -eq 'FOXAGENT_VERSION') {
                if ($v -cnotmatch '^(latest|main|v[0-9]+\.[0-9]+\.[0-9]+)$') { $bad = 'FOXAGENT_VERSION must look like v1.2.3' }
            } elseif ($name -eq 'FOXAGENT_ALLOW_DOWNGRADE') {
                if ($v -notmatch '^[01]$') { $bad = 'FOXAGENT_ALLOW_DOWNGRADE must be 1 or 0' }
            } elseif ($name -eq 'FOXAGENT_RELEASES' -or $name -eq 'FOXAGENT_GET_URL') {
                if ($v -notmatch $webSafe) { $bad = $name + ' must be a web address that starts with https:// or http:// and holds no spaces or quotes' }
            } else {
                # A folder inside Ubuntu. A Windows folder would put the file with the recovery words where
                # every program of the Windows user reads it and where Linux file permissions do not hold.
                if ($v -match '\\' -or $v -match '^[A-Za-z]:' -or $v -match '^/mnt/' -or $v -notmatch '^[A-Za-z0-9._/+-]+$' -or $v.StartsWith('-')) {
                    $bad = 'FOXAGENT_DIR must name a folder inside Ubuntu, written with letters, digits and . _ - / only (for example /home/you/fox2). A Windows folder (C:\... or /mnt/c/...) is refused: the file with your recovery words has to stay on Ubuntu''s own disk'
                }
            }
            if ($bad -ne '') { return @{ Pairs = @(); GetUrl = $url; Error = $bad } }
            if ($name -eq 'FOXAGENT_GET_URL') { $url = $v } else { $pairs += ($name + '=' + $v) }
        }
        return @{ Pairs = $pairs; GetUrl = $url; Error = '' }
    }

    # The Linux command that runs the normal installer: env NAME=value ... bash -lc "curl ... | bash".
    # pipefail: without it a download that fails hands bash nothing, bash ends with 0 and the failure is lost.
    function Get-FoxInstallerCommand($Passed) {
        $command = @('/usr/bin/env')
        foreach ($p in @($Passed['Pairs'])) { $command += $p }
        $command += @('/bin/bash', '-lc', ('set -o pipefail; curl -fsSL ''' + $Passed['GetUrl'] + ''' | bash'))
        return , $command
    }

    # "key=value" lines (what Get-FoxInstallFacts asks Ubuntu) as a hashtable. Lines of another shape are dropped.
    function ConvertFrom-FoxFacts([string]$Text) {
        $facts = @{}
        foreach ($line in @($Text -split "`n")) {
            if ($line -cmatch '^([a-z]+)=(.*)$') { $facts[$Matches[1]] = $Matches[2].Trim() }
        }
        return $facts
    }

    # The dashboard port the install says (WEB_UI_PORT of its .env), or 0 when it is not a port number.
    function Get-FoxDashboardPort($Facts) {
        $p = 0
        $text = [string]$Facts['port']
        if ($text -match '^\d{4,5}$' -and [int]::TryParse($text, [ref]$p) -and $p -ge 1024 -and $p -le 65535) { return $p }
        return 0
    }

    # The agent's folder as Windows Explorer opens it: \\wsl$\Ubuntu\home\you\foxleague-agent.
    function Get-FoxExplorerPath([string]$LinuxFolder) {
        return ('\\wsl$\' + $FoxDistro + ($LinuxFolder -replace '/', '\'))
    }

    # A Linux user name as Ubuntu makes them (it becomes an argument of loginctl). '' when it does not look like one.
    function Get-FoxLinuxUser($Facts) {
        $u = [string]$Facts['user']
        if ($u -cmatch '^[a-z_][a-z0-9_-]{0,31}$' -and $u -ne 'root') { return $u }
        return ''
    }

    # Does this script still have to ask about the browser? The installer inside Ubuntu asks the same question
    # on its last screen when it finds explorer.exe (which opens the Windows default browser from inside WSL),
    # and nobody should be asked twice. So: ask here only when the dashboard answers from Windows and the
    # installer inside had no explorer.exe to offer it with.
    function Test-FoxAskBrowser([bool]$ExplorerInside, [bool]$DashboardAnswers) {
        return ($DashboardAnswers -and -not $ExplorerInside)
    }

    # The scheduled task that keeps Ubuntu running: what it starts.
    # WSL stops a distribution about 15 seconds after the last program started through wsl.exe has ended, also
    # when a systemd service is running in it (Microsoft: "systemd services will NOT keep your WSL instance
    # alive"), and it does not start one with Windows. One wsl.exe that stays attached keeps it up: here it
    # runs "sleep infinity" as the user's Linux user. wsl.exe is a console program, so started alone it would
    # show a black window for ever: "conhost.exe --headless" gives it a console that has no window.
    function Get-FoxKeepAliveAction([string]$SystemRoot) {
        $sys = $SystemRoot.TrimEnd('\') + '\System32'
        $wsl = $sys + '\wsl.exe'
        if ($wsl -match '\s') { $wsl = '"' + $wsl + '"' }
        return @{ Execute = ($sys + '\conhost.exe'); Arguments = ('--headless ' + $wsl + ' ' + $FoxKeepAliveArgs) }
    }

    # Is this the command line of the wsl.exe that the task keeps attached? Its program is a wsl.exe (in quotes or
    # not, in any folder: the one in System32 starts the one of the Store package with the same arguments) and its
    # arguments are exactly the task's, letter for letter. Nothing else is ever taken for it.
    function Test-FoxKeepAliveCommand([string]$CommandLine) {
        $program = '(?i:"[^"]*\\wsl\.exe"|[^\s"]*\\wsl\.exe|wsl\.exe)'
        return ($CommandLine -cmatch ('^\s*' + $program + '\s+' + [regex]::Escape($FoxKeepAliveArgs) + '\s*$'))
    }

    # Is a task with our name the one this script makes? -Uninstall removes nothing else.
    function Test-FoxOwnTask([string]$Execute, [string]$Arguments) {
        if ($Execute -notmatch '(?i)\\conhost\.exe$') { return $false }
        return ($Arguments -match ('(?i)wsl\.exe"? -d ' + [regex]::Escape($FoxDistro) + ' .*--exec /bin/sleep infinity$'))
    }

    # What -Uninstall does inside Ubuntu once the task is gone (W-17):
    #   $Yes        the answer to its one question
    #   $Readiness  Get-FoxUbuntuReadiness of Ubuntu now ('' when it was not asked)
    #   $Facts      what the install inside says of itself (Get-FoxInstallFacts), @{} when it could not be asked
    # 'by-hand' (the answer was no), 'no-ubuntu' (WSL lists no distribution called Ubuntu), 'unreachable' (Ubuntu is
    # there and could not be started as its user, or did not say where the agent is), 'no-folder' (no install.sh in
    # the agent's folder), 'no-service' (the folder has no background service: nothing to stop) or 'run'. A folder
    # that is not a plain absolute path is never run.
    function Get-FoxInnerUninstallPlan {
        param([bool]$Yes, [string]$Readiness, $Facts)
        if (-not $Yes) { return 'by-hand' }
        if ($Readiness -eq 'not-registered') { return 'no-ubuntu' }
        if ($Readiness -ne 'ready') { return 'unreachable' }
        if ([string]$Facts['dir'] -notmatch '^/[A-Za-z0-9._/+-]+$') { return 'unreachable' }
        if ($Facts['script'] -ne '1') { return 'no-folder' }
        if ($Facts['service'] -ne '1') { return 'no-service' }
        return 'run'
    }

    # Why this PC cannot run the installer, in one sentence, or '' when it can.
    function Get-FoxWindowsProblem($Facts) {
        if ($Facts['InsideLinux']) {
            return 'this is a Linux or macOS terminal. Paste the other line here: curl -fsSL ' + $FoxGetUrl + ' | bash'
        }
        if (-not $Facts['Is64']) { return 'the agent needs 64-bit Windows. This Windows is a 32-bit one' }
        # The 32-bit PowerShell on 64-bit Windows is shown another System32, one without wsl.exe.
        if (-not $Facts['Is64Process']) {
            return 'this is the 32-bit PowerShell, "Windows PowerShell (x86)". Open the normal one (Start, type PowerShell, choose Windows PowerShell) and paste the line there'
        }
        if ($Facts['Build'] -lt 19041) {
            return 'WSL 2 needs Windows 11 or Windows 10 version 2004 (build 19041) or later. This PC runs build ' + $Facts['Build'] + '. Install the Windows updates (Settings, Windows Update), then paste the line again'
        }
        if (-not $Facts['WslExe']) {
            return 'wsl.exe was not found in the Windows folder. Install the Windows updates (Settings, Windows Update), then paste the line again'
        }
        if ($Facts['HostName'] -like '*ISE*') {
            return 'the PowerShell ISE has no real terminal for Ubuntu to ask its questions in. Open Windows PowerShell (Start, type PowerShell) and paste the line there'
        }
        return ''
    }

    # Is virtualization on? 'ok', 'off' or 'unknown'. A hypervisor that already runs proves it (and makes the
    # processor report "off", which is why it is asked first).
    function Get-FoxVirtualization($Facts) {
        if ($Facts['HypervisorPresent'] -eq $true) { return 'ok' }
        if ($Facts['VirtFirmware'] -eq $true) { return 'ok' }
        if ($Facts['HypervisorPresent'] -eq $false -and $Facts['VirtFirmware'] -eq $false) { return 'off' }
        return 'unknown'
    }

    # Is there room on the disk? '' or one sentence. Measured on the PC of 13 Nov 2026 (W-1, where C: had 0.2 GB):
    # Ubuntu's download was 0.42 GB (in %TEMP%) and its disk 1.39 GB right after its first start; the agent takes
    # about 0.24 GB, 0.28 GB once an update has kept the release before it. About 2.1 GB at the peak, so 4 GB before
    # Ubuntu is downloaded leaves room for Windows itself and for Ubuntu's disk, which grows and never shrinks by
    # itself. With Ubuntu there: 1 GB for the agent. An amount that cannot be read is not refused (said where asked).
    function Get-FoxDiskProblem {
        param($FreeBytes, [bool]$NeedsUbuntu, [string]$Drive)
        if ($null -eq $FreeBytes) { return '' }
        $gb = [double]$FreeBytes / 1GB
        $has = $gb.ToString('0.0', [System.Globalization.CultureInfo]::InvariantCulture)
        if ($NeedsUbuntu) {
            if ($gb -ge 4) { return '' }
            return ('Ubuntu and the agent need about 4 GB free on ' + $Drive + ' and it has ' + $has + ' GB. Ubuntu''s download and its disk take about 2 GB and the agent about 0.3 GB; Windows needs room besides. Free some space (Settings, System, Storage), then paste the line again')
        }
        if ($gb -ge 1) { return '' }
        return ('The agent needs about 1 GB free on ' + $Drive + ' and it has ' + $has + ' GB.')
    }

    # ================================================================================================
    # The thin part: everything that asks Windows something or starts a program.
    # ================================================================================================

    # What is asked of Windows, once. A fact that cannot be read is $null: unknown, not false.
    function Get-FoxWindowsFacts {
        $f = @{ InsideLinux = $false; Is64 = $false; Is64Process = $true; Build = 0; WslExe = ''; HostName = [string]$Host.Name; Elevated = $false
                User = ''; HypervisorPresent = $null; VirtFirmware = $null; VmCompute = $null; SystemRoot = '' }
        # PowerShell 7 on Linux or macOS has $IsWindows = $false; Windows PowerShell 5.1 has no such variable.
        $isWin = Get-Variable -Name IsWindows -ErrorAction SilentlyContinue
        if ($null -ne $isWin -and -not $isWin.Value) { $f['InsideLinux'] = $true; return $f }
        $f['Is64'] = [Environment]::Is64BitOperatingSystem
        $f['Is64Process'] = [Environment]::Is64BitProcess
        $f['Build'] = [Environment]::OSVersion.Version.Build
        $f['SystemRoot'] = [string]$env:SystemRoot
        # wsl.exe by its full path in the Windows folder: never whatever "wsl" the PATH finds first.
        $exe = Join-Path (Join-Path $f['SystemRoot'] 'System32') 'wsl.exe'
        if ($f['Is64Process'] -and (Test-Path -LiteralPath $exe)) { $f['WslExe'] = $exe }
        try {
            $me = [System.Security.Principal.WindowsIdentity]::GetCurrent()
            $f['User'] = $me.Name
            $f['Elevated'] = (New-Object System.Security.Principal.WindowsPrincipal($me)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
        } catch { }
        # Only a real yes or no is kept: an answer Windows leaves empty stays unknown.
        try { $v = @(Get-CimInstance -ClassName Win32_ComputerSystem)[0].HypervisorPresent; if ($v -is [bool]) { $f['HypervisorPresent'] = $v } } catch { }
        try { $v = @(Get-CimInstance -ClassName Win32_Processor)[0].VirtualizationFirmwareEnabled; if ($v -is [bool]) { $f['VirtFirmware'] = $v } } catch { }
        try { $f['VmCompute'] = ($null -ne (Get-Service -Name vmcompute -ErrorAction SilentlyContinue)) } catch { }
        return $f
    }

    function Get-FoxEnvValues {
        return @{ FOXAGENT_VERSION = $env:FOXAGENT_VERSION; FOXAGENT_RELEASES = $env:FOXAGENT_RELEASES; FOXAGENT_DIR = $env:FOXAGENT_DIR
                  FOXAGENT_ALLOW_DOWNGRADE = $env:FOXAGENT_ALLOW_DOWNGRADE; FOXAGENT_GET_URL = $env:FOXAGENT_GET_URL }
    }

    # Starts a program and waits for it. Returns @{ ExitCode; Bytes; ErrBytes; TimedOut }.
    #   -Capture       what it prints is collected as bytes (not shown); without it the program uses this window,
    #                  keyboard included, which is what Ubuntu's questions and the installer need
    #   -StdinText     written to the program's input as UTF-8 without a byte order mark, then the input is closed
    #   -TimeoutSeconds  0 waits for ever; otherwise the program is ended after that time and TimedOut is $true
    # The argument text goes to the program as it is written (ProcessStartInfo.Arguments): PowerShell 5.1 and 7
    # pass arguments with quotes in them differently when a program is called by name, and this way they cannot.
    function Invoke-FoxProcess {
        param([string]$File, [string]$Arguments, [switch]$Capture, [string]$StdinText, [int]$TimeoutSeconds = 0)
        $hasInput = $PSBoundParameters.ContainsKey('StdinText')
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $File
        $psi.Arguments = $Arguments
        $psi.UseShellExecute = $false
        $psi.EnvironmentVariables['WSL_UTF8'] = '1'
        # A captured program never gets the keyboard: its input is the text given, or nothing. A wsl.exe that
        # would wait for a key (the bare one of a PC without WSL offers to install it) reads the end of input.
        if ($Capture) { $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true }
        elseif ($hasInput) { $psi.RedirectStandardInput = $true }
        $p = New-Object System.Diagnostics.Process
        $p.StartInfo = $psi
        $out = New-Object System.IO.MemoryStream
        $err = New-Object System.IO.MemoryStream
        $timedOut = $false
        try {
            [void]$p.Start()
            $outTask = $null; $errTask = $null
            if ($Capture) {
                # Both are read while the program runs: a program that fills one pipe while the other is being
                # waited for would stand still for ever.
                $outTask = $p.StandardOutput.BaseStream.CopyToAsync($out)
                $errTask = $p.StandardError.BaseStream.CopyToAsync($err)
            }
            if ($psi.RedirectStandardInput) {
                # Written to the stream underneath and that stream closed: the text writer on top of it adds a
                # byte order mark of its own on some systems. A program that ended already has closed its end.
                try {
                    if ($hasInput) {
                        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($StdinText)
                        $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
                        $p.StandardInput.BaseStream.Flush()
                    }
                    $p.StandardInput.BaseStream.Close()
                } catch { }
            }
            if ($TimeoutSeconds -gt 0) {
                if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
                    $timedOut = $true
                    try { $p.Kill() } catch { }
                    [void]$p.WaitForExit(5000)
                }
            } else { $p.WaitForExit() }
            if ($Capture) {
                try { [void]$outTask.Wait(5000) } catch { }
                try { [void]$errTask.Wait(5000) } catch { }
            }
            $code = -1
            if (-not $timedOut) { $code = $p.ExitCode }
            return @{ ExitCode = $code; Bytes = $out.ToArray(); ErrBytes = $err.ToArray(); TimedOut = $timedOut }
        } finally {
            $p.Dispose()
        }
    }

    # The wsl.exe of this Windows. Step 1 writes it into this table (a table, so that a nested function can).
    $FoxRun = @{ WslExe = '' }
    function Get-FoxWslPath { return [string]$FoxRun['WslExe'] }

    # wsl.exe with the argument text given. Returns @{ ExitCode; Text; ErrText; Bytes; TimedOut }: Text is what
    # it printed, decoded; with -Capture only.
    function Invoke-FoxWsl {
        param([string]$Arguments, [switch]$Capture, [string]$StdinText, [int]$TimeoutSeconds = 0)
        $call = @{ File = (Get-FoxWslPath); Arguments = $Arguments; TimeoutSeconds = $TimeoutSeconds }
        if ($Capture) { $call['Capture'] = $true }
        if ($PSBoundParameters.ContainsKey('StdinText')) { $call['StdinText'] = $StdinText }
        $r = Invoke-FoxProcess @call
        $r['Text'] = ConvertFrom-FoxBytes $r['Bytes']
        $r['ErrText'] = ConvertFrom-FoxBytes $r['ErrBytes']
        return $r
    }

    # One Linux program in Ubuntu (see Get-FoxWslArguments). Captured calls end after two minutes: the first
    # start of a distribution is slow, and a WSL that hangs must not hang this script for ever.
    function Invoke-FoxLinux {
        param([string]$User = '', [string[]]$Command, [switch]$Capture, [string]$StdinText)
        $call = @{ Arguments = (Get-FoxWslArguments -User $User -Command $Command) }
        if ($Capture) { $call['Capture'] = $true; $call['TimeoutSeconds'] = 120 }
        if ($PSBoundParameters.ContainsKey('StdinText')) { $call['StdinText'] = $StdinText }
        return (Invoke-FoxWsl @call)
    }

    # Starts a program as administrator: Windows shows its own prompt (UAC). Returns @{ Outcome; ExitCode }:
    # Outcome 'done', or 'refused' when the prompt was answered with No or could not be shown at all (an account
    # that is no administrator and knows no administrator's password, a session without a desktop).
    function Start-FoxElevated([string]$File, [string]$Arguments) {
        try {
            $p = Start-Process -FilePath $File -ArgumentList $Arguments -Verb RunAs -Wait -PassThru
            $code = $null
            try { $code = $p.ExitCode } catch { }
            return @{ Outcome = 'done'; ExitCode = $code }
        } catch {
            return @{ Outcome = 'refused'; ExitCode = $null }
        }
    }

    # Asks WSL how it is (see Get-FoxWslState). When Windows has no vmcompute service, wsl.exe is not started at
    # all: on a PC without WSL the bare wsl.exe may wait a minute for a key before it answers.
    function Get-FoxWslReadiness($VmCompute) {
        if ($VmCompute -eq $false) { return @{ State = 'install'; DefaultVersion = 0 } }
        $version = Invoke-FoxWsl -Arguments '--version' -Capture -TimeoutSeconds 90
        $status = Invoke-FoxWsl -Arguments '--status' -Capture -TimeoutSeconds 90
        $state = Get-FoxWslState -VmCompute $VmCompute -VersionExit $version['ExitCode'] -VersionText $version['Text'] -StatusExit $status['ExitCode']
        return @{ State = $state; DefaultVersion = (Get-FoxDefaultWslVersion $status['Text']) }
    }

    function Get-FoxVmCompute {
        try { return ($null -ne (Get-Service -Name vmcompute -ErrorAction SilentlyContinue)) } catch { return $null }
    }

    # Ubuntu as it is now: its line of "wsl -l -v" and, when it can be started, its default user's number.
    function Get-FoxUbuntuNow {
        $list = Invoke-FoxWsl -Arguments '-l -v' -Capture -TimeoutSeconds 90
        $distros = Get-FoxDistros $list['Text']
        $entry = Select-FoxUbuntu $distros
        $idExit = -1; $idText = ''; $said = ''
        if ($null -ne $entry -and $entry['Version'] -eq 2 -and ($entry['State'] -eq 'Running' -or $entry['State'] -eq 'Stopped')) {
            $id = Invoke-FoxLinux -Command @('/usr/bin/id', '-u') -Capture
            $idExit = $id['ExitCode']; $idText = $id['Text']
            $said = ($id['Text'] + ' ' + $id['ErrText']).Trim()
        }
        return @{ Readiness = (Get-FoxUbuntuReadiness -Entry $entry -IdExit $idExit -IdText $idText); Distros = $distros; Said = $said }
    }

    # The users of Ubuntu (Get-FoxLinuxUsers), asked as root. None when it cannot be asked.
    function Get-FoxUbuntuUsers {
        $r = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'getent passwd') -Capture
        $names = @()
        if ($r['ExitCode'] -eq 0) { $names = Get-FoxLinuxUsers $r['Text'] }
        return , $names
    }

    # The scheduled task with our name, as @{ Execute; Arguments; State }, or $null when there is none.
    function Get-FoxTask {
        $t = Get-ScheduledTask -TaskName $FoxTaskName -ErrorAction SilentlyContinue
        if ($null -eq $t) { return $null }
        $t = @($t)[0]
        $a = @($t.Actions)[0]
        return @{ Execute = [string]$a.Execute; Arguments = [string]$a.Arguments; State = [string]$t.State }
    }

    # Makes (or replaces) the scheduled task of this Windows user and returns how it is started:
    # 'logon and every 5 minutes', 'every 5 minutes' or 'logon'.
    #   - It runs as the user, only while the user is logged in, with the user's ordinary rights: registering it
    #     needs no administrator.
    #   - "At log on" starts it with the session. The second trigger repeats every 5 minutes for ever, and the
    #     setting IgnoreNew means a start is dropped while the task still runs: so it only ever comes back after
    #     it ended (after "wsl --shutdown", after Windows updated WSL), within 5 minutes.
    #   - Windows' defaults would not start it on battery, would stop it when the PC goes on battery and would
    #     end it after 3 days: all three are turned off.
    # A trigger set that Windows refuses is tried without the part it may refuse (an account that may not make
    # a log on trigger; a Windows whose repetition needs an end).
    function Register-FoxKeepAlive([string]$User, $Action) {
        $act = New-ScheduledTaskAction -Execute $Action['Execute'] -Argument $Action['Arguments']
        $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
        $about = 'Keeps Ubuntu (WSL) running while you are logged in, so that foxleague-agent inside it keeps playing. Made by the foxleague-agent installer (get.ps1). Removing it does not remove the agent.'
        $last = $null
        foreach ($how in @('logon and every 5 minutes', 'every 5 minutes', 'logon')) {
            try {
                $triggers = @()
                if ($how -like '*logon*') { $triggers += (New-ScheduledTaskTrigger -AtLogOn -User $User) }
                if ($how -like '*every*') { $triggers += (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)) }
                [void](Register-ScheduledTask -TaskName $FoxTaskName -Action $act -Trigger $triggers -Principal $principal -Settings $settings -Description $about -Force)
                return $how
            } catch { $last = $_ }
        }
        throw $last
    }
    function Start-FoxKeepAlive { Start-ScheduledTask -TaskName $FoxTaskName }
    function Remove-FoxKeepAlive {
        try { Stop-ScheduledTask -TaskName $FoxTaskName -ErrorAction SilentlyContinue } catch { }
        Unregister-ScheduledTask -TaskName $FoxTaskName -Confirm:$false
    }
    # The wsl.exe programs that run now, as @{ Id; CommandLine }. Throws when Windows does not say.
    function Get-FoxWslProcesses {
        return , @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'wsl.exe'" | ForEach-Object { @{ Id = [int]$_.ProcessId; CommandLine = [string]$_.CommandLine } })
    }
    function Stop-FoxProcess([int]$Id) { Stop-Process -Id $Id -Force -ErrorAction SilentlyContinue }

    # True when the address answers "ok" (the agent's /healthz) within a few seconds.
    function Test-FoxUrl([string]$Url) {
        try {
            $request = [System.Net.WebRequest]::Create($Url)
            $request.Timeout = 4000
            $request.Proxy = $null
            $response = $request.GetResponse()
            try { return ([int]$response.StatusCode -eq 200) } finally { $response.Close() }
        } catch { return $false }
    }
    function Open-FoxBrowser([string]$Url) { Start-Process $Url }
    # The window's title, or $null where there is no window to ask.
    function Get-FoxTitle { try { return [string]$Host.UI.RawUI.WindowTitle } catch { return $null } }
    function Set-FoxTitle([string]$Title) { try { $Host.UI.RawUI.WindowTitle = $Title } catch { } }
    # The free space of the drive that holds %LOCALAPPDATA%, where wsl --install puts a new distribution (its download
    # goes to %TEMP% on the same drive): @{ Drive = 'C:'; Bytes } or $null when Windows does not say. An Ubuntu that
    # was moved to another drive is not looked for.
    function Get-FoxFreeSpace {
        try {
            $root = [System.IO.Path]::GetPathRoot([string]$env:LOCALAPPDATA)
            if ([string]::IsNullOrEmpty($root)) { return $null }
            $d = New-Object System.IO.DriveInfo($root)
            return @{ Drive = $root.TrimEnd('\'); Bytes = [long]$d.AvailableFreeSpace }
        } catch { return $null }
    }
    function Wait-Fox([int]$Seconds) { Start-Sleep -Seconds $Seconds }

    # ================================================================================================
    # The steps
    # ================================================================================================

    function Write-FoxWslHints {
        Write-FoxLine 'What usually helps:'
        Write-FoxLine '- "WSL 2 requires an update to its kernel component": type  wsl --update  then paste the line again.'
        Write-FoxLine '- An error that names virtualization or 0x80370102: turn virtualization on in the PC''s BIOS or UEFI'
        Write-FoxLine '  setup (Intel VT-x, AMD-V or SVM), then paste the line again.'
        Write-FoxLine '- Windows was not restarted since WSL was installed: restart it, then paste the line again.'
        Write-FoxLine ('- Microsoft''s own list: ' + $FoxWslDocs)
    }

    # Step 1. Returns the facts.
    function Step-FoxCheckPc {
        Write-FoxStep 'Windows 1/6: checking this PC'
        $facts = Get-FoxWindowsFacts
        $problem = Get-FoxWindowsProblem $facts
        if ($problem -ne '') { Stop-Fox $problem }
        Write-FoxLine ('64-bit Windows, build ' + $facts['Build'] + ': new enough for WSL 2.')
        if ($facts['Elevated']) {
            Write-FoxLine ('This window runs as administrator. Ubuntu and the agent are set up for the Windows user ' + $facts['User'] + '.')
            Write-FoxLine 'If that is not your everyday user, close this window and paste the line into a normal PowerShell window.'
        }
        return $facts
    }

    # Step 2. Ends the run when Windows has to restart first.
    function Step-FoxWsl($Facts) {
        Write-FoxStep 'Windows 2/6: WSL, the part of Windows that runs Linux'
        if ($Facts['VmCompute'] -ne $false) { Write-FoxLine 'Asking Windows about WSL (this can take a minute).' }
        $wsl = Get-FoxWslReadiness $Facts['VmCompute']
        if ($wsl['State'] -eq 'ready') { Write-FoxLine 'WSL 2 is installed.'; return $wsl }

        if ($wsl['State'] -eq 'update') {
            Write-FoxLine 'WSL is installed, in a version that is too old to run systemd, which keeps the agent running.'
            Write-FoxLine 'Updating it with Microsoft''s own command: wsl --update'
            $r = Invoke-FoxWsl -Arguments '--update'
            $wsl = Get-FoxWslReadiness (Get-FoxVmCompute)
            if ($wsl['State'] -ne 'ready') {
                Stop-Fox ('WSL could not be updated from this window (wsl --update ended with ' + $r['ExitCode'] + '). Open PowerShell as administrator (right-click the Start button, then Terminal (Admin) or Windows PowerShell (Admin)), type  wsl --update  and, when it is done, paste the line again in a normal window')
            }
            Write-FoxLine 'WSL is up to date.'
            return $wsl
        }

        # Not installed. Virtualization is looked at first: without it the restart below would be for nothing.
        $virt = Get-FoxVirtualization $Facts
        if ($virt -eq 'off') {
            Write-FoxLine 'Windows says that virtualization is turned off in this PC''s BIOS or UEFI setup. WSL 2 needs it.'
            Write-FoxLine 'Turn it on there first (Intel VT-x, AMD-V or SVM; the PC maker''s guide tells where), then paste the line again.'
            if (-not (Confirm-Fox 'Go on anyway, because you know it is on?' $false)) {
                Stop-Fox 'nothing was changed. Turn virtualization on in the BIOS or UEFI setup, then paste the line again'
            }
        }
        Write-FoxLine 'WSL 2 is not installed on this PC yet. It is the part of Windows, made by Microsoft, that runs Linux programs:'
        Write-FoxLine 'the agent lives in it. It is installed with Microsoft''s own command: wsl --install --no-distribution'
        $done = @{ Outcome = 'done'; ExitCode = 0 }
        if ($Facts['Elevated']) {
            $r = Invoke-FoxWsl -Arguments '--install --no-distribution'
            $done['ExitCode'] = $r['ExitCode']
        } else {
            Write-FoxLine 'That needs an administrator. Windows now shows its own prompt, which asks whether this app may make changes'
            Write-FoxLine 'to your device and names Windows Subsystem for Linux (wsl.exe): answer Yes. A window may open while it works.'
            Write-FoxLine 'It closes by itself.'
            if (-not (Confirm-Fox 'Ready?' $true)) { Stop-Fox 'nothing was changed. Paste the line again when you are ready' }
            $done = Start-FoxElevated (Get-FoxWslPath) '--install --no-distribution'
        }
        $wsl = Get-FoxWslReadiness (Get-FoxVmCompute)
        $next = Get-FoxAfterWslInstall -Outcome $done['Outcome'] -ExitCode $done['ExitCode'] -ReadyNow ($wsl['State'] -eq 'ready')
        if ($next -eq 'go-on') { Write-FoxLine 'WSL 2 is installed.'; return $wsl }
        if ($next -eq 'restart') {
            Write-FoxStep 'Restart Windows now, then paste the same line again'
            Write-FoxLine 'Windows finishes installing WSL while it restarts. Use Start, Power, Restart (not Shut down).'
            Write-FoxLine 'After the restart open PowerShell again and paste:'
            Write-FoxLine $FoxLine
            Write-FoxLine 'The installer then goes on from here. Nothing has to be done twice.'
            Stop-Fox ''
        }
        if ($next -eq 'refused') {
            Stop-Fox 'WSL was not installed: the administrator prompt was answered with No or could not be answered from this account. Open PowerShell as administrator (right-click the Start button, then Terminal (Admin) or Windows PowerShell (Admin)), type  wsl --install --no-distribution  and restart Windows when it says so. Then paste the line again in a normal PowerShell window'
        }
        Write-FoxWslHints
        Stop-Fox ('Windows could not install WSL (wsl --install --no-distribution ended with ' + $done['ExitCode'] + '). To see what it says, open PowerShell as administrator and type  wsl --install --no-distribution  yourself. Then paste the line again')
    }

    # Step 3. Returns $true when Ubuntu was installed by this run.
    function Step-FoxUbuntu($Wsl) {
        Write-FoxStep 'Windows 3/6: Ubuntu, the Linux the agent runs in'
        $now = Get-FoxUbuntuNow
        $fresh = $false
        if ($now['Readiness'] -eq 'ready') { Write-FoxLine 'Ubuntu is installed and has a user of its own.'; return $false }

        if ($now['Readiness'] -eq 'not-registered') {
            $fresh = $true
            $disk = Get-FoxFreeSpace
            if ($null -eq $disk) { Write-FoxLine 'How much space is free on the disk could not be read. Ubuntu and the agent need about 4 GB.' }
            else {
                $full = Get-FoxDiskProblem -FreeBytes $disk['Bytes'] -NeedsUbuntu $true -Drive $disk['Drive']
                if ($full -ne '') { Stop-Fox $full }
            }
            # Not wrapped in @( ): the function returns its list as one value (return , $names), and @( ) around
            # that made a list of one list, which was counted as one name and printed as System.Object[] (W-2).
            $others = Get-FoxOtherUbuntus $now['Distros']
            if (@($others).Count -gt 0) {
                Write-FoxLine ('You have ' + ($others -join ' and ') + '. The agent gets a distribution of its own, called Ubuntu: yours is not touched.')
            }
            Write-FoxLine 'Ubuntu is not installed yet. It is downloaded now with Microsoft''s own command: wsl --install -d Ubuntu'
            # Seen on a real PC (W-3): the bar stood at 0% because a click into the console window starts Windows'
            # text selection, which pauses the program until Enter; and WSL opened its own welcome window.
            Write-FoxLine '- The download can look stuck at 0%. A click into this window pauses it (Windows then selects text):'
            Write-FoxLine '  press Enter once and it goes on.'
            Write-FoxLine '- A window "Welcome to WSL" may open by itself: close it, the agent does not need it.'
            Write-FoxLine 'Then Ubuntu itself asks you to choose a Linux username and a password (here or in a window of its own).'
            Write-FoxLine '- They are new and yours to choose: they are not your Windows login.'
            Write-FoxLine '- Nothing shows while you type the password. That is normal. Type it, press Enter, type it again.'
            Write-FoxLine '- Remember it: Ubuntu asks for it when a command starts with sudo. This installer never sees it.'
            Write-FoxLine '- Ubuntu may also ask "Help improve Ubuntu!" (Y/n/e): either answer is fine for the agent.'
            Write-FoxLine '- When Ubuntu then shows its own prompt (a line that ends with $), type  exit  and press Enter'
            Write-FoxLine '  to come back to this installer.'
            if ($Wsl['DefaultVersion'] -eq 1) {
                Write-FoxLine 'This PC makes new distributions for WSL 1 (your own setting, which is left as it is): Ubuntu is moved to WSL 2 after it.'
            }
            if (-not (Confirm-Fox 'Ready?' $true)) { Stop-Fox 'Ubuntu was not installed. Paste the line again when you are ready' }
            # Said again as the last line before Ubuntu's own output, the nearest one to its prompt: among the notes
            # above it was 15 lines away, and on the PC of 14 Nov nothing on the screen said it at the prompt (W-14).
            Write-FoxNote 'When Ubuntu shows a line that ends with $, type  exit  and press Enter to come back here.'
            $r = Invoke-FoxWsl -Arguments ('--install -d ' + $FoxDistro)
            $now = Get-FoxUbuntuNow
            if ($now['Readiness'] -eq 'not-registered' -and $r['ExitCode'] -ne 0) {
                Write-FoxWslHints
                Stop-Fox ('Ubuntu could not be installed (wsl --install -d Ubuntu ended with ' + $r['ExitCode'] + '; what Windows said is above). Paste the line again after the fix')
            }
        }

        # Until Ubuntu is ready: every round names what is missing and what to do. Never more than a few rounds.
        $startedForUser = $false
        for ($round = 0; $round -lt 8; $round++) {
            $state = $now['Readiness']
            if ($state -eq 'ready') { Write-FoxLine 'Ubuntu is installed and has a user of its own.'; return $fresh }
            if ($state -eq 'wsl1') {
                Write-FoxLine 'Ubuntu runs under WSL 1, which cannot run systemd. The agent needs it under WSL 2.'
                Write-FoxLine 'Microsoft''s command for that is: wsl --set-version Ubuntu 2   (your files in Ubuntu are kept; it takes a few minutes)'
                if (-not (Confirm-Fox 'Move Ubuntu to WSL 2 now?' $true)) { Stop-Fox 'Ubuntu was left under WSL 1. Type  wsl --set-version Ubuntu 2  yourself, then paste the line again' }
                $r = Invoke-FoxWsl -Arguments ('--set-version ' + $FoxDistro + ' 2')
                if ($r['ExitCode'] -ne 0) {
                    Write-FoxWslHints
                    Stop-Fox ('Ubuntu could not be moved to WSL 2 (wsl --set-version ended with ' + $r['ExitCode'] + '; what Windows said is above)')
                }
            } elseif ($state -eq 'no-user') {
                if ($startedForUser) {
                    # Started here once and still root: this Ubuntu asks nothing, and starting it again would not
                    # either (INS-U2). What helps is said instead.
                    $users = Get-FoxUbuntuUsers
                    $help = Get-FoxRootUbuntuHelp $users
                    foreach ($l in $help) { Write-FoxLine $l }
                    Stop-Fox 'Ubuntu starts as root. Make a user of your own the one it starts as (see above), then paste the line again'
                }
                Write-FoxLine 'Ubuntu has no user of your own yet: its first start, where it asks for a username and password, is not done.'
                Write-FoxLine 'Ubuntu is started here now. Choose the username and password. Then, at its prompt (a line that ends with $ or #),'
                Write-FoxLine 'type  exit  and press Enter. If it asks nothing and shows a prompt at once, type  exit  and open Ubuntu'
                Write-FoxLine 'from the Start menu instead: that is where an older Ubuntu asks.'
                $answer = (Read-FoxLine 'Press Enter to start Ubuntu here (q stops)').Trim()
                if ($answer -match '^[Qq]') { Stop-Fox 'Ubuntu has no user yet. Open Ubuntu from the Start menu, choose a username and password, then paste the line again' }
                [void](Invoke-FoxWsl -Arguments ('-d ' + $FoxDistro + ' --cd ~'))
                $startedForUser = $true
            } elseif ($state -eq 'not-registered' -or $state -eq 'busy') {
                Write-FoxLine 'Ubuntu is not ready yet. If it opened in a window of its own, finish there: wait for the download, choose the'
                Write-FoxLine 'username and password. When its prompt (a line that ends with $) shows, come back to this window.'
                $answer = (Read-FoxLine 'Press Enter to look again (q stops)').Trim()
                if ($answer -match '^[Qq]') { Stop-Fox 'Ubuntu is not installed yet. Paste the line again to go on' }
            } else {
                if ($now['Said'] -ne '') { Write-FoxLine ('Windows said: ' + $now['Said']) }
                Write-FoxWslHints
                Stop-Fox 'Ubuntu is installed and could not be started. If nothing above fits, type  wsl --shutdown  and paste the line again'
            }
            $now = Get-FoxUbuntuNow
        }
        Stop-Fox 'Ubuntu is still not ready. Open Ubuntu from the Start menu, choose a username and password there, then paste the line again'
    }

    function Get-FoxSystemdNow {
        $r = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'systemctl is-system-running 2>/dev/null || true') -Capture
        return (Get-FoxSystemdState $r['Text'])
    }

    # Step 4.
    function Step-FoxUbuntuSettings([bool]$FreshUbuntu) {
        Write-FoxStep 'Windows 4/6: Ubuntu''s settings (systemd, curl)'
        $read = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'if [ -e /etc/wsl.conf ]; then cat /etc/wsl.conf; fi') -Capture
        if ($read['ExitCode'] -ne 0) {
            Stop-Fox ('Ubuntu''s settings file /etc/wsl.conf could not be read (status ' + $read['ExitCode'] + '). ' + $read['ErrText'].Trim())
        }
        $text = ConvertFrom-FoxLinuxBytes $read['Bytes']
        if ($null -eq $text) {
            Stop-Fox 'the file /etc/wsl.conf in Ubuntu holds bytes that are not text, so it was left as it is. Open Ubuntu, type  sudo nano /etc/wsl.conf  and put the line systemd=true under the line [boot] (add both lines when [boot] is missing). Then paste the line again'
        }
        $plan = Get-FoxWslConfPlan $text
        if (-not $plan['Changed']) {
            Write-FoxLine 'systemd is already turned on in /etc/wsl.conf.'
        } else {
            # The file as it was is kept once, next to it; the new text goes to a file beside it that then takes
            # its place; and what is there afterwards is read back and compared.
            $keep = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'if [ -e /etc/wsl.conf ] && [ ! -e /etc/wsl.conf.before-foxleague ]; then cp -p /etc/wsl.conf /etc/wsl.conf.before-foxleague; fi') -Capture
            if ($keep['ExitCode'] -ne 0) { Stop-Fox 'the file /etc/wsl.conf could not be copied before the change, so it was left as it is' }
            $write = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'cat > /etc/wsl.conf.foxleague-new && chmod 644 /etc/wsl.conf.foxleague-new && mv -f /etc/wsl.conf.foxleague-new /etc/wsl.conf') -Capture -StdinText $plan['Text']
            $back = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'cat /etc/wsl.conf') -Capture
            $now = ConvertFrom-FoxLinuxBytes $back['Bytes']
            if ($write['ExitCode'] -ne 0 -or $back['ExitCode'] -ne 0 -or $now -cne $plan['Text']) {
                Stop-Fox 'the file /etc/wsl.conf in Ubuntu could not be written as planned. Open Ubuntu, type  sudo nano /etc/wsl.conf  and make sure the line systemd=true stands under the line [boot] (the file as it was is in /etc/wsl.conf.before-foxleague). Then paste the line again'
            }
            if ($plan['What'] -eq 'added-section') { Write-FoxLine 'Added the two lines [boot] and systemd=true to /etc/wsl.conf.' }
            elseif ($plan['What'] -eq 'added-line') { Write-FoxLine 'Added the line systemd=true under the [boot] that /etc/wsl.conf already had.' }
            else { Write-FoxLine 'Changed the systemd line of /etc/wsl.conf to systemd=true.' }
        }

        $systemd = Get-FoxSystemdNow
        if ($plan['Changed'] -or $systemd -eq 'no') {
            # Only Ubuntu is restarted (wsl --terminate Ubuntu), never all of WSL: other distributions and
            # Docker Desktop keep running.
            if (-not $FreshUbuntu) {
                Write-FoxLine 'Ubuntu has to restart once so that systemd starts with it. Programs that run in Ubuntu now are stopped and its'
                Write-FoxLine 'open windows close. Other Linux distributions are not touched.'
                if (-not (Confirm-Fox 'Restart Ubuntu now?' $true)) { Stop-Fox 'Ubuntu was not restarted. Close what runs in it, then paste the line again' }
            } else { Write-FoxLine 'Restarting Ubuntu once so that systemd starts with it.' }
            $t = Invoke-FoxWsl -Arguments ('--terminate ' + $FoxDistro) -Capture -TimeoutSeconds 90
            if ($t['ExitCode'] -ne 0) { Stop-Fox ('Ubuntu could not be restarted (wsl --terminate Ubuntu ended with ' + $t['ExitCode'] + '). Type  wsl --shutdown  and paste the line again') }
            Wait-Fox 2
            $systemd = Get-FoxSystemdNow
        }
        # systemd needs a moment after Ubuntu starts.
        for ($i = 0; $i -lt 30 -and $systemd -eq 'wait'; $i++) { Wait-Fox 3; $systemd = Get-FoxSystemdNow }
        if ($systemd -eq 'no') {
            Stop-Fox 'systemd did not start in Ubuntu, although /etc/wsl.conf asks for it. It needs WSL 0.67.6 or later: type  wsl --update  then  wsl --shutdown  and paste the line again'
        }
        if ($systemd -eq 'wait') { Write-FoxLine 'systemd is still starting. The installer inside Ubuntu checks it again.' }
        else { Write-FoxLine 'systemd runs in Ubuntu.' }

        $has = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 && [ -s /etc/ssl/certs/ca-certificates.crt ]') -Capture
        if ($has['ExitCode'] -eq 0) { Write-FoxLine 'curl, tar and the certificates for https are there.'; return }
        Write-FoxLine 'Installing curl, tar and the certificates for https with Ubuntu''s own installer (apt):'
        $apt = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y curl tar ca-certificates')
        if ($apt['ExitCode'] -ne 0) {
            Stop-Fox ('curl could not be installed in Ubuntu (apt ended with ' + $apt['ExitCode'] + '; what it said is above). Check that Ubuntu reaches the internet, then paste the line again')
        }
    }

    # Step 5.
    function Step-FoxInstaller($Passed) {
        Write-FoxStep 'Windows 5/6: the agent''s installer, inside Ubuntu'
        $disk = Get-FoxFreeSpace
        if ($null -eq $disk) { Write-FoxLine 'How much space is free on the disk could not be read. The agent needs about 1 GB.' }
        else {
            $low = Get-FoxDiskProblem -FreeBytes $disk['Bytes'] -NeedsUbuntu $false -Drive $disk['Drive']
            if ($low -ne '') { Write-FoxLine $low; Write-FoxLine 'If the installer stops for lack of space, free some (Settings, System, Storage).' }
        }
        Write-FoxLine 'From here on it is the same installer as on Linux, with its own seven steps. Its questions are answered here.'
        $r = Invoke-FoxLinux -Command (Get-FoxInstallerCommand $Passed)
        if ($r['ExitCode'] -eq 130) { Stop-Fox 'the installer was stopped with Ctrl-C. Paste the line again to go on: your wallet and your answers are kept' }
        if ($r['ExitCode'] -ne 0) {
            Stop-Fox ('the installer inside Ubuntu did not finish (status ' + $r['ExitCode'] + '; what it said is above). Paste the line again after the fix: what is already set up is kept')
        }
    }

    # What the install inside Ubuntu is like, as "key=value" lines (ConvertFrom-FoxFacts). Run as the user's
    # Linux user, with FOXAGENT_DIR when it was set. Of the agent's .env only the port's digits come back.
    function Get-FoxInstallFacts($Passed) {
        $script = 'd=${FOXAGENT_DIR:-$HOME/' + $FoxFolder + '}; case $d in /*) ;; *) d=$PWD/$d ;; esac; ' +
            'echo "user=$(id -un)"; echo "dir=$d"; ' +
            'if [ -f "$d/versions/active" ]; then echo installed=1; else echo installed=0; fi; ' +
            'if [ -f "$d/install.sh" ]; then echo script=1; else echo script=0; fi; ' +
            'if [ -f "$HOME/.config/systemd/user/' + $FoxUnit + '" ]; then echo service=1; else echo service=0; fi; ' +
            'if command -v explorer.exe >/dev/null 2>&1; then echo explorer=1; else echo explorer=0; fi; ' +
            'echo "port=$(grep -a -m 1 ''^WEB_UI_PORT='' "$d/.env" 2>/dev/null | tr -cd 0-9)"'
        $command = @('/usr/bin/env')
        foreach ($p in @($Passed['Pairs'])) { if ($p -like 'FOXAGENT_DIR=*') { $command += $p } }
        $command += @('/bin/sh', '-c', $script)
        $r = Invoke-FoxLinux -Command $command -Capture
        return (ConvertFrom-FoxFacts $r['Text'])
    }

    # Step 6. Returns $true when the task is there and running.
    function Step-FoxKeepAlive($Facts, $Install) {
        Write-FoxStep 'Windows 6/6: keeping the agent running'
        if ($Install['service'] -ne '1') {
            Write-FoxLine 'The agent has no background service inside Ubuntu, so there is nothing to keep running. Paste the line again to finish the install.'
            return $false
        }
        # Background services of the Linux user start with Ubuntu, with nobody logged in to it (linger). The
        # installer inside asks for the same and may not be allowed to; root is.
        $user = Get-FoxLinuxUser $Install
        if ($user -ne '') { [void](Invoke-FoxLinux -User 'root' -Command @('/usr/bin/loginctl', 'enable-linger', $user) -Capture) }

        Write-FoxLine 'WSL stops Ubuntu a short while after its last window closes and does not start it with Windows.'
        $action = Get-FoxKeepAliveAction $Facts['SystemRoot']
        $how = ''
        try { $how = Register-FoxKeepAlive $Facts['User'] $action } catch {
            Write-FoxLine ('The scheduled task could not be made: ' + $_.Exception.Message)
            Write-FoxLine 'Until it is there, the agent plays while an Ubuntu window is open: leave one open (minimised is fine).'
            return $false
        }
        Write-FoxLine ('So a scheduled task of your Windows user is now there to keep it running: "' + $FoxTaskName + '" (started at ' + $how + ').')
        Write-FoxLine 'It keeps Ubuntu up while you are logged in to Windows. The agent does not play while the PC is off or asleep.'
        Write-FoxLine 'To see the task: Start, Task Scheduler, Task Scheduler Library. To remove it, type:'
        Write-FoxLine ('  Unregister-ScheduledTask -TaskName ''' + $FoxTaskName + ''' -Confirm:$false')
        $running = $false
        try {
            Start-FoxKeepAlive
            for ($i = 0; $i -lt 5 -and -not $running; $i++) {
                Wait-Fox 1
                $task = Get-FoxTask
                $running = ($null -ne $task -and $task['State'] -eq 'Running')
            }
        } catch { }
        if ($running) { Write-FoxLine 'The task is running.' }
        else {
            Write-FoxLine 'The task was made and is not running yet. It is started again within 5 minutes and at your next log on.'
            Write-FoxLine 'If the agent stops when you close this window, leave an Ubuntu window open and tell the maintainers.'
        }
        return $running
    }

    # The last screen.
    function Step-FoxDone($Install) {
        $port = Get-FoxDashboardPort $Install
        Write-FoxStep 'Done'
        $address = ''
        if ($port -gt 0) { $address = 'http://localhost:' + $port }
        if ($address -ne '') { Write-FoxLine ('Dashboard   ' + $address) }
        else { Write-FoxLine 'Dashboard   the address the installer showed above (http://localhost:8870 unless you chose another port)' }
        Write-FoxLine 'The agent runs inside Ubuntu, not in Windows itself.'
        if ([string]$Install['dir'] -ne '') { Write-FoxLine ('Its folder, from Windows Explorer: ' + (Get-FoxExplorerPath ([string]$Install['dir']))) }
        Write-FoxLine 'Updates are one click in the dashboard (Update now).'
        Write-FoxLine ('The commands the installer listed above are typed inside Ubuntu. To open it: wsl -d ' + $FoxDistro + ' --cd ~')
        if ($address -eq '') { return }

        # From Windows, as the browser will ask. The service may need a moment after the install.
        $answers = $false
        for ($i = 0; $i -lt 10 -and -not $answers; $i++) {
            $answers = (Test-FoxUrl ($address + '/healthz')) -or (Test-FoxUrl ('http://127.0.0.1:' + $port + '/healthz'))
            if (-not $answers) { Wait-Fox 2 }
        }
        if (-not $answers) {
            Write-FoxLine 'The dashboard does not answer from Windows yet. Give it a minute and open the address in your browser.'
            Write-FoxLine 'If it stays closed: type  wsl --shutdown  wait ten seconds, then paste the line again.'
            return
        }
        if (Test-FoxAskBrowser ($Install['explorer'] -eq '1') $true) {
            if (Confirm-Fox 'Open the dashboard in your browser now?' $true) { Open-FoxBrowser $address }
        }
    }

    # Stopping the task ends its conhost.exe, not the wsl.exe that conhost started: that one goes on alone and keeps
    # Ubuntu running until Windows restarts (W-13, seen on a real PC). Stops the wsl.exe programs whose whole command
    # line is the task's and returns how many, or -1 when Windows did not say which programs run.
    function Stop-FoxKeepAliveProcesses {
        $list = $null
        try { $list = Get-FoxWslProcesses } catch { return -1 }
        $n = 0
        foreach ($p in @($list)) {
            if ($null -ne $p -and (Test-FoxKeepAliveCommand ([string]$p['CommandLine']))) { Stop-FoxProcess ([int]$p['Id']); $n++ }
        }
        return $n
    }

    # The uninstall inside Ubuntu by hand: the first line in PowerShell, the others inside Ubuntu, one at a time
    # (W-17: pasted together, bash got the wsl line and Windows PowerShell 5.1 got the && of the next one).
    function Write-FoxInnerUninstallByHand([string]$Folder) {
        Write-FoxLine 'To do it by hand: in PowerShell, open Ubuntu with'
        Write-FoxLine ('  wsl -d ' + $FoxDistro + ' --cd ~')
        Write-FoxLine 'then type inside Ubuntu, one line at a time:'
        if ($Folder -eq '') { Write-FoxLine ('  cd ~/' + $FoxFolder + ' && ./install.sh --uninstall') }
        else { Write-FoxLine ('  cd ' + $Folder + ' && ./install.sh --uninstall') }
        Write-FoxLine '  exit'
    }

    function Invoke-FoxUninstall {
        Write-FoxStep 'Removing what the Windows installer added'
        $windows = Get-FoxWindowsFacts
        if ($windows['InsideLinux']) { Stop-Fox 'this removes a scheduled task of Windows: run it in PowerShell on Windows' }
        $task = Get-FoxTask
        $ours = $true
        if ($null -eq $task) {
            Write-FoxLine ('There is no scheduled task "' + $FoxTaskName + '": nothing to remove on the Windows side.')
        } elseif (-not (Test-FoxOwnTask $task['Execute'] $task['Arguments'])) {
            $ours = $false
            Write-FoxLine ('A scheduled task "' + $FoxTaskName + '" exists, but it is not the one')
            Write-FoxLine 'this installer makes, so it was left alone.'
            Write-FoxLine ('It starts: ' + $task['Execute'] + ' ' + $task['Arguments'])
        } else {
            Remove-FoxKeepAlive
            Write-FoxLine ('Removed the scheduled task "' + $FoxTaskName + '". That is all this installer added to Windows.')
        }
        if ($ours) {
            $stopped = Stop-FoxKeepAliveProcesses
            if ($stopped -gt 0) { Write-FoxLine 'Stopped the hidden wsl.exe that the task had started: it kept Ubuntu running.' }
            elseif ($stopped -lt 0) {
                Write-FoxLine 'Windows did not say which programs run: the hidden wsl.exe of the task may still keep'
                Write-FoxLine ('Ubuntu running. To stop Ubuntu now, type:  wsl --terminate ' + $FoxDistro)
            }
        }
        # The agent inside Ubuntu (W-17): one question, then this script does it, so that no line has to be typed into
        # a second shell. It comes after the task and its hidden wsl.exe (W-13). Every wsl.exe it starts is waited for
        # and nothing stays behind, so Ubuntu still stops by itself. The installer runs as the Linux user, from the
        # agent's folder, with --exec: no shell of the user reads the line. Its systemd is reached as in the install,
        # which runs the same way (install.sh falls back to /run/user/<uid> when the session names none).
        Write-FoxLine 'The agent itself runs inside Ubuntu. Your folder and wallet words stay there either way.'
        $yes = Confirm-Fox 'Also stop the agent and remove its background service in Ubuntu?' $true
        $readiness = ''; $facts = @{}; $refused = ''
        if ($yes) {
            $passed = Get-FoxPassedEnv (Get-FoxEnvValues)
            if ($passed['Error'] -ne '') { $refused = $passed['Error'] }
            else {
                $FoxRun['WslExe'] = $windows['WslExe']
                if ((Get-FoxWslPath) -eq '') { $readiness = 'no-start' }
                else {
                    $readiness = (Get-FoxUbuntuNow)['Readiness']
                    if ($readiness -eq 'ready') { $facts = Get-FoxInstallFacts $passed }
                }
            }
        }
        $plan = 'by-hand'
        if ($yes -and $refused -eq '') { $plan = Get-FoxInnerUninstallPlan -Yes $true -Readiness $readiness -Facts $facts }
        $folder = ''
        $innerDone = $false
        if ($plan -eq 'run' -or $plan -eq 'no-folder' -or $plan -eq 'no-service') { $folder = [string]$facts['dir'] }
        if ($plan -eq 'run') {
            Write-FoxLine ('Running ./install.sh --uninstall in ' + $folder + ' inside Ubuntu:')
            $r = Invoke-FoxLinux -Command @('/bin/bash', ($folder + '/install.sh'), '--uninstall')
            if ($r['ExitCode'] -eq 0) {
                Write-FoxLine 'Done: the agent is stopped and its background service in Ubuntu is removed.'
                $innerDone = $true
            }
            else {
                Write-FoxLine ('The uninstall inside Ubuntu did not finish (status ' + $r['ExitCode'] + '; what it said is above).')
                Write-FoxInnerUninstallByHand $folder
            }
        } elseif ($plan -eq 'no-ubuntu') {
            # What WSL lists, not a claim: a WSL that cannot list looks the same. Without the task Ubuntu stops by
            # itself anyway once its last window closes, and an agent inside it with it.
            Write-FoxLine 'WSL lists no distribution called Ubuntu, so no agent inside it was looked for.'
        } elseif ($plan -eq 'no-service') {
            Write-FoxLine ('The agent in ' + $folder + ' has no background service in Ubuntu: nothing to stop there.')
        } elseif ($plan -eq 'no-folder') {
            Write-FoxLine ('There is no install.sh in ' + $folder + ' inside Ubuntu, so nothing was run there.')
            Write-FoxLine 'If the agent is in another folder, use that one in the cd line.'
            Write-FoxInnerUninstallByHand ''
        } elseif ($plan -eq 'unreachable') {
            Write-FoxLine 'Ubuntu could not be reached as your Linux user, so the agent inside it was not touched.'
            Write-FoxInnerUninstallByHand ''
        } else {
            if ($refused -ne '') { Write-FoxLine ($refused + '.') }
            Write-FoxLine 'The agent inside Ubuntu was not touched.'
            Write-FoxInnerUninstallByHand ''
        }
        if ($plan -eq 'no-ubuntu') { return }
        # An uninstall inside Ubuntu that ended with 0 has just said, right above, that the folder, the wallet words,
        # the data and the PEM files stay and that the wallets may still hold funds: not twice (W-18). It cannot know
        # what stays on the Windows side, which follows in every case.
        if (-not $innerDone) {
            Write-FoxLine 'Your folder, your wallet words (.env), your data and your PEM files stay in Ubuntu.'
            Write-FoxLine 'The agent wallets may still hold funds.'
        }
        Write-FoxLine 'WSL, Ubuntu and the line systemd=true in Ubuntu''s /etc/wsl.conf are left as they are:'
        Write-FoxLine 'other programs may use them.'
        Write-FoxLine 'Ubuntu stops a short while after its last window closes.'
    }

    function Invoke-FoxInstall {
        Write-FoxStep 'foxleague-agent installer for Windows'
        Write-FoxLine 'The agent runs in Ubuntu, a Linux inside Windows (WSL 2). This installer sets that up and then starts the'
        Write-FoxLine 'same guided installer as on Linux. It is safe to paste the line again at any time: it goes on where it stopped.'

        $passed = Get-FoxPassedEnv (Get-FoxEnvValues)
        if ($passed['Error'] -ne '') { Stop-Fox ($passed['Error'] + '. Nothing was changed') }

        # Ubuntu's shell and the installer inside set a title of their own on this window: it gets its own back
        # when the run ends, also when it stops (W-7).
        $title = Get-FoxTitle
        try {
            $facts = Step-FoxCheckPc
            $FoxRun['WslExe'] = $facts['WslExe']
            $wsl = Step-FoxWsl $facts
            $fresh = Step-FoxUbuntu $wsl
            Step-FoxUbuntuSettings ([bool]$fresh)
            Step-FoxInstaller $passed
            $install = Get-FoxInstallFacts $passed
            [void](Step-FoxKeepAlive $facts $install)
            Step-FoxDone $install
        } finally {
            if ($null -ne $title -and $title -ne '') { Set-FoxTitle $title }
        }
    }

    if ($DefineOnly) { return }

    try {
        if ($Uninstall) { Invoke-FoxUninstall } else { Invoke-FoxInstall }
    } catch {
        $e = $_.Exception
        Write-Host ''
        if ($e.Data.Contains('FoxStop')) {
            # Stop-Fox: one sentence, already in plain words. An empty one means everything was said above.
            if ($e.Message -ne '') { Write-Host ('Stopped: ' + $e.Message + '.') -ForegroundColor Red }
        } else {
            Write-Host ('Stopped by something this installer did not expect: ' + $e.Message) -ForegroundColor Red
            Write-Host ('  (' + $_.InvocationInfo.PositionMessage.Trim() + ')')
            Write-Host '  Nothing is left half done on purpose: paste the line again. If it stops here again, tell the maintainers what this says.'
        }
    }
}

Install-FoxLeagueAgent @args
