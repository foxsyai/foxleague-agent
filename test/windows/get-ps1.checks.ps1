# Checks of get.ps1 (the Windows one-line installer) that need no Windows: PowerShell 7 on Linux, in a container.
#
#   docker run --rm --name fox-ps-checks -e FOX_PS_SANDBOX=1 -v "$PWD:/work:ro" \
#     mcr.microsoft.com/powershell:latest pwsh -NoProfile -File /work/test/windows/get-ps1.checks.ps1
#
# (test/audit-1111/windows-1.test.ts runs exactly that when Docker and the image are there, and skips otherwise.)
#
# What is checked here:
#   1. the PowerShell parser reads get.ps1 with zero errors, and the file uses no syntax that Windows PowerShell
#      5.1 does not have (the parser here is PowerShell 7's: it would accept a ternary, 5.1 would not);
#   2. the decisions of get.ps1, which are small functions that take text and return what to do;
#   3. with FOX_PS_SANDBOX=1 (a throwaway container, never a real machine: these checks write /etc/wsl.conf and
#      make a user): the steps of get.ps1 from start to end against a stand-in wsl.exe. The stand-in is a shell
#      script that answers --version, --status and -l -v from files and runs "-d Ubuntu --exec ..." as a real
#      Linux command in this container, so the argument quoting, the bytes read back, the edit of /etc/wsl.conf
#      and the command line of the installer are real. Windows itself (the facts about the PC, the
#      administrator prompt, the scheduled task, the browser) is replaced by stand-in functions.
# What this cannot check is listed in docs/WINDOWS-TEST.md: everything a real wsl.exe, a real Windows and
# Windows PowerShell 5.1 do.
#
# No Pester: every check is a name and a block that throws when it fails. The last line counts them; the exit
# status is 1 when one failed.
param([string]$Script = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Script -eq '') { $Script = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'get.ps1' }

$Passed = 0
$Failed = @()
function Check([string]$Name, [scriptblock]$Body) {
    try { & $Body; $script:Passed++; Write-Host ('ok      ' + $Name) }
    catch {
        $script:Failed += $Name
        Write-Host ('FAILED  ' + $Name)
        Write-Host ('        ' + $_.Exception.Message + ' (line ' + $_.InvocationInfo.ScriptLineNumber + ')')
    }
}
function Equal($Actual, $Expected, [string]$What = '') {
    if ([string]$Actual -cne [string]$Expected) { throw ($What + ' expected <' + $Expected + '> got <' + $Actual + '>') }
}
function True($Condition, [string]$What) { if (-not $Condition) { throw $What } }
function Bytes16([string]$Text) { return , [System.Text.Encoding]::Unicode.GetBytes($Text) }
function Bytes8([string]$Text) { return , [System.Text.Encoding]::UTF8.GetBytes($Text) }

# ====================================================================================================
Write-Host '== 1. The parser, and Windows PowerShell 5.1'
# ====================================================================================================
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tokens, [ref]$errors)

Check 'the PowerShell parser reads get.ps1 with zero errors' {
    Equal @($errors).Count 0 (@($errors | ForEach-Object { $_.Message + ' at line ' + $_.Extent.StartLineNumber }) -join '; ')
}
Check 'the file is one function and, as its last statement, the single call of it' {
    $top = @($ast.EndBlock.Statements)
    Equal $top.Count 2 'top-level statements'
    Equal $top[0].GetType().Name 'FunctionDefinitionAst'
    Equal $top[0].Name 'Install-FoxLeagueAgent'
    Equal $top[1].Extent.Text 'Install-FoxLeagueAgent @args'
    True ($null -eq $ast.ParamBlock -and $null -eq $ast.BeginBlock -and $null -eq $ast.ProcessBlock) 'nothing else at the top'
}
Check 'no syntax newer than Windows PowerShell 5.1 (ternary, ??, ?., && and ||, clean block)' {
    $newer = @($ast.FindAll({ param($n) $n.GetType().Name -in @('TernaryExpressionAst', 'PipelineChainAst') }, $true))
    Equal $newer.Count 0 ('found at line ' + (@($newer | ForEach-Object { $_.Extent.StartLineNumber }) -join ', '))
    $kinds = @($tokens | Where-Object { $_.Kind.ToString() -in @('QuestionQuestion', 'QuestionQuestionEquals', 'QuestionDot', 'QuestionLBracket', 'AndAnd', 'OrOr', 'Clean') })
    Equal $kinds.Count 0 ('found at line ' + (@($kinds | ForEach-Object { $_.Extent.StartLineNumber }) -join ', '))
}
Check 'no "exit" (under "| iex" it would close the user''s window) and no code is built and run' {
    $exits = @($ast.FindAll({ param($n) $n.GetType().Name -eq 'ExitStatementAst' }, $true))
    Equal $exits.Count 0 'exit statements'
    $commands = @($ast.FindAll({ param($n) $n.GetType().Name -eq 'CommandAst' }, $true) | ForEach-Object { [string]$_.GetCommandName() })
    foreach ($bad in @('iex', 'Invoke-Expression', 'Invoke-Command', 'icm', 'Add-Type', 'irm', 'Invoke-RestMethod', 'iwr', 'Invoke-WebRequest', 'curl', 'wget', 'Start-BitsTransfer', 'Import-Module', 'Set-ExecutionPolicy')) {
        True ($commands -notcontains $bad) ('the script calls ' + $bad)
    }
    $members = @($ast.FindAll({ param($n) $n.GetType().Name -eq 'InvokeMemberExpressionAst' }, $true) | ForEach-Object { [string]$_.Member.Extent.Text })
    foreach ($bad in @('Create', 'DownloadString', 'DownloadFile', 'InvokeScript', 'Invoke')) {
        if ($bad -eq 'Create') { continue } # [System.Net.WebRequest]::Create is the one Create, checked below
        True ($members -notcontains $bad) ('the script calls .' + $bad + '()')
    }
    $creates = @($ast.FindAll({ param($n) $n.GetType().Name -eq 'InvokeMemberExpressionAst' -and [string]$n.Member.Extent.Text -eq 'Create' }, $true))
    foreach ($c in $creates) { Equal $c.Expression.Extent.Text '[System.Net.WebRequest]' 'a Create that is not the web request of the health check' }
}
Check 'every native program is started by Invoke-FoxProcess or Start-FoxElevated: no call operator on a path' {
    $calls = @($ast.FindAll({ param($n) $n.GetType().Name -eq 'CommandAst' -and $n.InvocationOperator.ToString() -eq 'Ampersand' }, $true))
    Equal $calls.Count 0 ('& at line ' + (@($calls | ForEach-Object { $_.Extent.StartLineNumber }) -join ', '))
    $starts = @($ast.FindAll({ param($n) $n.GetType().Name -eq 'CommandAst' -and [string]$n.GetCommandName() -eq 'Start-Process' }, $true))
    Equal $starts.Count 2 'Start-Process is used twice: the administrator prompt and the browser'
}

# ====================================================================================================
Write-Host '== 2. Loading the functions (-DefineOnly), and what pasting the line leaves behind'
# ====================================================================================================
. $Script -DefineOnly
. Install-FoxLeagueAgent -DefineOnly

Check '-DefineOnly defines the functions and runs nothing' {
    True ($null -ne (Get-Command Get-FoxWslConfPlan -ErrorAction SilentlyContinue)) 'Get-FoxWslConfPlan is not defined'
    Equal $FoxDistro 'Ubuntu'
    Equal $FoxTaskName 'FoxLeague Agent (WSL)'
}
Check 'pasted (text | iex): on Linux it stops in one sentence, leaves no function but the main one and no strict mode' {
    $out = & pwsh -NoProfile -Command ('$text = Get-Content -Raw ''' + $Script + '''; $text | Invoke-Expression; ''after: '' + $ErrorActionPreference; ''functions: '' + (@(Get-Command -CommandType Function | Where-Object { $_.Name -like ''*Fox*'' } | ForEach-Object Name) -join '',''); $nothing = $null; ''strict: '' + ($nothing.missing -eq $null)') 2>&1 | Out-String
    True ($out -match 'Stopped: this is a Linux or macOS terminal\. Paste the other line here: curl -fsSL https://raw\.githubusercontent\.com/foxsyai/foxleague-agent/main/get\.sh \| bash\.') $out
    True ($out -match 'after: Continue') 'the error preference of the window was changed'
    True ($out -match 'functions: Install-FoxLeagueAgent\s') ('functions left behind: ' + $out)
    True ($out -match 'strict: True') 'strict mode was left on in the window'
}
Check 'the uninstall line ( & ([scriptblock]::Create(text)) -Uninstall ) reaches the uninstall' {
    $out = & pwsh -NoProfile -Command ('& ([scriptblock]::Create((Get-Content -Raw ''' + $Script + '''))) -Uninstall') 2>&1 | Out-String
    True ($out -match 'Removing what the Windows installer added') $out
    True ($out -match 'Stopped: this removes a scheduled task of Windows') $out
    True ($out -notmatch 'foxleague-agent installer for Windows') 'the install ran'
}
Check 'a download cut short runs nothing, wherever it is cut' {
    $text = Get-Content -Raw $Script
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('fox-cut-' + [Guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $work)
    $cuts = @(200, 5000, 20000, [int]($text.Length / 2), ($text.Length - 400), ($text.Length - 30), ($text.Length - 12), ($text.Length - 2))
    foreach ($cut in $cuts) {
        $part = Join-Path $work ('cut-' + $cut + '.txt')
        [System.IO.File]::WriteAllText($part, $text.Substring(0, $cut))
        $out = & pwsh -NoProfile -Command ('try { Get-Content -Raw ''' + $part + ''' | Invoke-Expression } catch { ''PARSE-ERROR'' }; ''end''') 2>&1 | Out-String
        True ($out -notmatch 'installer|Stopped|Windows 1/6') ('cut at ' + $cut + ' ran something: ' + $out)
        True ($out -match 'end') ('cut at ' + $cut + ' ended the session')
    }
    Remove-Item -Recurse -Force $work
}

# ====================================================================================================
Write-Host '== 3. Decisions: what wsl.exe prints'
# ====================================================================================================
Check 'UTF-16 output of wsl.exe is read: no byte order mark, no zero characters, no carriage returns' {
    Equal (ConvertFrom-FoxBytes (Bytes16 "WSL version: 2.6.1.0`r`nKernel version: 6.6.87.2-1`r`n")) "WSL version: 2.6.1.0`nKernel version: 6.6.87.2-1`n"
    $withMark = [byte[]](0xFF, 0xFE) + (Bytes16 "  NAME      STATE           VERSION`r`n* Ubuntu    Running         2`r`n")
    Equal (ConvertFrom-FoxBytes $withMark) "  NAME      STATE           VERSION`n* Ubuntu    Running         2`n"
}
Check 'UTF-8 output (WSL_UTF8=1) is read the same way, with letters of other languages' {
    $umlaut = 'Standardversion: 2 f' + [char]0xFC + 'r'
    Equal (ConvertFrom-FoxBytes (Bytes8 ($umlaut + "`r`n"))) ($umlaut + "`n")
    Equal (ConvertFrom-FoxBytes (Bytes16 ($umlaut + "`r`n"))) ($umlaut + "`n")
    Equal (ConvertFrom-FoxBytes ([byte[]]@())) ''
    Equal (ConvertFrom-FoxBytes $null) ''
}
Check 'the table of "wsl -l -v" in UTF-16 gives the same distributions as in UTF-8' {
    $table = "  NAME              STATE           VERSION`r`n* docker-desktop    Running         2`r`n  Ubuntu            Stopped         2`r`n"
    foreach ($bytes in @((Bytes16 $table), (Bytes8 $table))) {
        $d = Get-FoxDistros (ConvertFrom-FoxBytes $bytes)
        Equal @($d).Count 2
        Equal $d[0]['Name'] 'docker-desktop'; True $d[0]['Default'] 'the default is starred'
        Equal $d[1]['Name'] 'Ubuntu'; Equal $d[1]['State'] 'Stopped'; Equal $d[1]['Version'] 2; True (-not $d[1]['Default']) 'Ubuntu is not the default'
    }
}

Check 'WSL missing: no vmcompute service means install, and wsl.exe is not even asked' {
    Equal (Get-FoxWslState -VmCompute $false -VersionExit 0 -VersionText 'WSL version: 2.6.1.0' -StatusExit 0) 'install'
}
Check 'WSL missing: the bare wsl.exe answers neither --version nor --status' {
    $said = 'The Windows Subsystem for Linux is not installed. You can install by running ''wsl.exe --install''.'
    Equal (Get-FoxWslState -VmCompute $true -VersionExit 1 -VersionText $said -StatusExit 1) 'install'
    Equal (Get-FoxWslState -VmCompute $null -VersionExit -1 -VersionText '' -StatusExit -1) 'install'
}
Check 'an old WSL that came inside Windows (no --version, --status answers) means update' {
    Equal (Get-FoxWslState -VmCompute $true -VersionExit -1 -VersionText 'Invalid command line option: --version' -StatusExit 0) 'update'
}
Check 'a WSL older than 0.67.6 (no systemd) means update; 0.67.6 and later are ready' {
    Equal (Get-FoxWslState -VmCompute $true -VersionExit 0 -VersionText 'WSL version: 0.66.2.0' -StatusExit 0) 'update'
    Equal (Get-FoxWslState -VmCompute $true -VersionExit 0 -VersionText 'WSL version: 0.67.6.0' -StatusExit 0) 'ready'
    Equal (Get-FoxWslState -VmCompute $true -VersionExit 0 -VersionText "WSL-Version: 2.6.1.0`nKernelversion: 6.6.87.2-1" -StatusExit 0) 'ready'
    Equal (Get-FoxWslState -VmCompute $null -VersionExit 0 -VersionText 'WSL version: 2.4.13.0' -StatusExit 0) 'ready'
}
Check 'version numbers are compared part by part, as numbers' {
    True (Test-FoxVersionOlder '0.9.0' '0.67.6') '0.9.0 is older than 0.67.6'
    True (-not (Test-FoxVersionOlder '0.100.0' '0.67.6')) '0.100.0 is not older'
    True (-not (Test-FoxVersionOlder '0.67.6' '0.67.6')) 'equal is not older'
    True (Test-FoxVersionOlder '0.67.5.9' '0.67.6') '0.67.5.9 is older'
    Equal (Get-FoxWslVersion 'nothing here') ''
}
Check 'WSL 1 only: the default version of "wsl --status" is read in any language' {
    Equal (Get-FoxDefaultWslVersion "Default Distribution: Ubuntu`nDefault Version: 1`n") 1
    Equal (Get-FoxDefaultWslVersion "Standarddistribution: Ubuntu`nStandardversion: 2`n") 2
    Equal (Get-FoxDefaultWslVersion (ConvertFrom-FoxBytes (Bytes16 "Default Version: 1`r`n"))) 1
    Equal (Get-FoxDefaultWslVersion 'WSL2 is not supported with your current machine configuration.') 0
}
Check 'after the administrator ran wsl --install: go on, restart, refused or failed' {
    Equal (Get-FoxAfterWslInstall -Outcome 'done' -ExitCode 0 -ReadyNow $true) 'go-on'
    Equal (Get-FoxAfterWslInstall -Outcome 'done' -ExitCode 0 -ReadyNow $false) 'restart'
    Equal (Get-FoxAfterWslInstall -Outcome 'done' -ExitCode 3010 -ReadyNow $false) 'restart'
    Equal (Get-FoxAfterWslInstall -Outcome 'done' -ExitCode $null -ReadyNow $false) 'restart'
    Equal (Get-FoxAfterWslInstall -Outcome 'done' -ExitCode 1 -ReadyNow $false) 'failed'
    Equal (Get-FoxAfterWslInstall -Outcome 'refused' -ExitCode $null -ReadyNow $false) 'refused'
}

Check 'no Ubuntu: no distribution at all (wsl -l -v prints a sentence), or only others' {
    $none = Get-FoxDistros "Windows Subsystem for Linux has no installed distributions.`nYou can resolve this by installing a distribution with the instructions below:`n"
    Equal @($none).Count 0
    Equal (Get-FoxUbuntuReadiness -Entry (Select-FoxUbuntu $none) -IdExit -1 -IdText '') 'not-registered'
    $others = Get-FoxDistros "  NAME              STATE           VERSION`n* Debian            Stopped         2`n  Ubuntu-24.04      Running         2`n  Ubuntu-22.04      Stopped         1`n"
    Equal @($others).Count 3
    True ($null -eq (Select-FoxUbuntu $others)) 'Ubuntu-24.04 is not the distribution named Ubuntu'
    Equal ((Get-FoxOtherUbuntus $others) -join ',') 'Ubuntu-24.04,Ubuntu-22.04'
}
Check 'Ubuntu present: ready with a user of its own, also when another distribution is the default' {
    $d = Get-FoxDistros "  NAME      STATE           VERSION`n* Debian    Running         2`n  Ubuntu    Stopped         2`n"
    $u = Select-FoxUbuntu $d
    Equal $u['Name'] 'Ubuntu'
    Equal (Get-FoxUbuntuReadiness -Entry $u -IdExit 0 -IdText "1000`n") 'ready'
    Equal (Get-FoxUbuntuReadiness -Entry (Select-FoxUbuntu (Get-FoxDistros "* ubuntu  Running  2")) -IdExit 0 -IdText '1001') 'ready'
}
Check 'Ubuntu present under WSL 1, still installing, without a user, or not starting' {
    $v1 = Select-FoxUbuntu (Get-FoxDistros "  NAME      STATE           VERSION`n* Ubuntu    Stopped         1`n")
    Equal (Get-FoxUbuntuReadiness -Entry $v1 -IdExit 0 -IdText '1000') 'wsl1'
    $busy = Select-FoxUbuntu (Get-FoxDistros "* Ubuntu    Installing      2")
    Equal (Get-FoxUbuntuReadiness -Entry $busy -IdExit -1 -IdText '') 'busy'
    $ok = Select-FoxUbuntu (Get-FoxDistros "* Ubuntu    Running         2")
    Equal (Get-FoxUbuntuReadiness -Entry $ok -IdExit 0 -IdText "0`n") 'no-user'
    Equal (Get-FoxUbuntuReadiness -Entry $ok -IdExit -1 -IdText '') 'no-start'
    Equal (Get-FoxUbuntuReadiness -Entry $ok -IdExit 0 -IdText 'Error: 0x80370102') 'no-start'
}

# ====================================================================================================
Write-Host '== 4. Decisions: /etc/wsl.conf'
# ====================================================================================================
function BootHeaders([string]$Text) { return @([regex]::Matches($Text, '(?im)^[ \t]*\[boot\]')).Count }
function Plan([string]$Text) {
    $p = Get-FoxWslConfPlan $Text
    # Whatever the start, a second run finds nothing to do, and there is never a second [boot].
    $again = Get-FoxWslConfPlan $p['Text']
    if ($again['Changed']) { throw ('a second run changes the file again: ' + $again['What']) }
    if ($again['What'] -ne 'already') { throw 'a second run does not say already' }
    $before = BootHeaders $Text
    $after = BootHeaders $p['Text']
    if ($before -eq 0 -and $after -ne 1) { throw ('no [boot] before, ' + $after + ' after') }
    if ($before -gt 0 -and $after -ne $before) { throw ($before + ' [boot] before, ' + $after + ' after') }
    return $p
}
Check 'wsl.conf missing or empty: the two lines are the file' {
    $p = Plan ''
    True $p['Changed'] 'changed'; Equal $p['What'] 'added-section'; Equal $p['Text'] "[boot]`nsystemd=true`n"
}
Check 'wsl.conf with no [boot]: the section is added at the end, the rest is kept byte for byte' {
    $old = "[automount]`nenabled = true`noptions = `"metadata`"`n`n[network]`nhostname=box`n"
    $p = Plan $old
    Equal $p['What'] 'added-section'
    Equal $p['Text'] ($old + "`n[boot]`nsystemd=true`n")
    $noEnd = Plan "[user]`ndefault=ana"
    Equal $noEnd['Text'] "[user]`ndefault=ana`n`n[boot]`nsystemd=true`n"
}
Check 'wsl.conf with [boot] and no systemd line: the line goes under that [boot], no second section' {
    $p = Plan "[boot]`ncommand = service cron start`n`n[user]`ndefault=ana`n"
    Equal $p['What'] 'added-line'
    Equal $p['Text'] "[boot]`nsystemd=true`ncommand = service cron start`n`n[user]`ndefault=ana`n"
    $last = Plan "[user]`ndefault=ana`n[boot]"
    Equal $last['Text'] "[user]`ndefault=ana`n[boot]`nsystemd=true`n"
    $comment = Plan "  [Boot]   # mine`n"
    Equal $comment['Text'] "  [Boot]   # mine`nsystemd=true`n"
}
Check 'wsl.conf with systemd=false: that line is corrected in place' {
    $p = Plan "[boot]`nsystemd=false`n"
    Equal $p['What'] 'set-true'; Equal $p['Text'] "[boot]`nsystemd=true`n"
    $spaced = Plan "[network]`nhostname=box`n[boot]`n  Systemd = False   # off for now`ncommand=true`n"
    Equal $spaced['Text'] "[network]`nhostname=box`n[boot]`n  systemd=true # off for now`ncommand=true`n"
    Equal (Plan "[boot]`nsystemd=0`n")['Text'] "[boot]`nsystemd=true`n"
    Equal (Plan "[boot]`nsystemd=`n")['Text'] "[boot]`nsystemd=true`n"
    Equal (Plan "[boot]`nsystemd=`"false`"")['Text'] "[boot]`nsystemd=true"
}
Check 'wsl.conf with systemd=true already: nothing is changed' {
    foreach ($text in @("[boot]`nsystemd=true`n", "[boot]`nsystemd = true`n", "[BOOT]`nSYSTEMD=True # yes`n", "[boot]`nsystemd=1`n", "[boot]`nsystemd=`"true`"`n", "[boot]`r`nsystemd=true`r`n", "# mine`n[user]`ndefault=ana`n`n[boot]`ncommand=x`nsystemd=true")) {
        $p = Get-FoxWslConfPlan $text
        True (-not $p['Changed']) ('changed: ' + $text)
        Equal $p['What'] 'already'; Equal $p['Text'] $text
    }
}
Check 'two [boot] sections (WSL reads the FIRST systemd line): the lines that are there are corrected, none is added' {
    $p = Plan "[boot]`nsystemd=false`n`n[user]`ndefault=ana`n`n[boot]`nsystemd=true`n"
    Equal $p['Text'] "[boot]`nsystemd=true`n`n[user]`ndefault=ana`n`n[boot]`nsystemd=true`n"
    $second = Plan "[boot]`ncommand=x`n[user]`ndefault=ana`n[boot]`nsystemd=false`n"
    Equal $second['Text'] "[boot]`ncommand=x`n[user]`ndefault=ana`n[boot]`nsystemd=true`n"
}
Check 'a systemd line outside [boot], a commented one and a broken section header do not count' {
    Equal (Plan "[user]`nsystemd=true`n")['What'] 'added-section'
    Equal (Plan "systemd=true`n")['What'] 'added-section'
    $commented = Plan "[boot]`n# systemd=true`n"
    Equal $commented['Text'] "[boot]`nsystemd=true`n# systemd=true`n"
    # "[ boot ]" is no section for WSL's reader, so the section before it goes on.
    Equal (Plan "[ boot ]`nsystemd=true`n")['What'] 'added-section'
    Equal (Plan "[boot]`n[ other ]`nsystemd=false`n")['Text'] "[boot]`n[ other ]`nsystemd=true`n"
}
Check 'a file saved on Windows (CR LF) keeps its line ends, and the new lines end the same way' {
    Equal (Plan "[user]`r`ndefault=ana`r`n")['Text'] "[user]`r`ndefault=ana`r`n`r`n[boot]`r`nsystemd=true`r`n"
    Equal (Plan "[boot]`r`ncommand=x`r`n")['Text'] "[boot]`r`nsystemd=true`r`ncommand=x`r`n"
    Equal (Plan "[boot]`r`nsystemd=false`r`n")['Text'] "[boot]`r`nsystemd=true`r`n"
}
Check 'a wsl.conf that is not text is not read as text' {
    True ($null -eq (ConvertFrom-FoxLinuxBytes ([byte[]](0x5B, 0x00, 0x62)))) 'a zero byte'
    True ($null -eq (ConvertFrom-FoxLinuxBytes ([byte[]](0x5B, 0xFF, 0xFE, 0x62)))) 'bytes that are not UTF-8'
    Equal (ConvertFrom-FoxLinuxBytes (Bytes8 "[boot]`r`n# caf$([char]0xE9)`n")) "[boot]`r`n# caf$([char]0xE9)`n"
    Equal (ConvertFrom-FoxLinuxBytes ([byte[]]@())) ''
}
Check 'systemctl is-system-running: running and degraded are fine, starting waits, anything else is no' {
    Equal (Get-FoxSystemdState "running`n") 'ok'
    Equal (Get-FoxSystemdState "degraded`n") 'ok'
    Equal (Get-FoxSystemdState "starting`n") 'wait'
    Equal (Get-FoxSystemdState "initializing") 'wait'
    Equal (Get-FoxSystemdState "offline`n") 'no'
    Equal (Get-FoxSystemdState '') 'no'
    Equal (Get-FoxSystemdState 'System has not been booted with systemd as init system (PID 1). Can''t operate.') 'no'
}

# ====================================================================================================
Write-Host '== 5. Decisions: the command lines, the switches, the last screen'
# ====================================================================================================
Check 'an argument is quoted by the rules a Windows program splits its command line with' {
    Equal (ConvertTo-FoxArgument 'plain') 'plain'
    Equal (ConvertTo-FoxArgument 'two words') '"two words"'
    Equal (ConvertTo-FoxArgument 'say "hi"') '"say \"hi\""'
    Equal (ConvertTo-FoxArgument 'a\b') 'a\b'
    Equal (ConvertTo-FoxArgument 'ends in \ ') '"ends in \ "'
    Equal (ConvertTo-FoxArgument 'slash before quote \" x') '"slash before quote \\\" x"'
    Equal (ConvertTo-FoxArgument 'tail slash \') '"tail slash \\"'
    Equal (ConvertTo-FoxArgument '') '""'
}
Check 'Ubuntu is always named, root only where asked, the home folder, --exec: the default distribution is never used' {
    Equal (Get-FoxWslArguments -Command @('/usr/bin/id', '-u')) '-d Ubuntu --cd ~ --exec /usr/bin/id -u'
    Equal (Get-FoxWslArguments -User 'root' -Command @('/bin/sh', '-c', 'cat /etc/wsl.conf')) '-d Ubuntu -u root --cd ~ --exec /bin/sh -c "cat /etc/wsl.conf"'
}
Check 'the switches of get.sh set in the window are handed over, each held to its own shape' {
    $p = Get-FoxPassedEnv @{ FOXAGENT_VERSION = 'v1.2.3'; FOXAGENT_RELEASES = 'https://example.org/fox/releases'; FOXAGENT_DIR = '/home/ana/fox2'; FOXAGENT_ALLOW_DOWNGRADE = '1' }
    Equal $p['Error'] ''
    Equal ($p['Pairs'] -join ' ') 'FOXAGENT_VERSION=v1.2.3 FOXAGENT_RELEASES=https://example.org/fox/releases FOXAGENT_DIR=/home/ana/fox2 FOXAGENT_ALLOW_DOWNGRADE=1'
    Equal $p['GetUrl'] 'https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh'
    Equal (Get-FoxPassedEnv @{ FOXAGENT_VERSION = 'main' })['Pairs'] 'FOXAGENT_VERSION=main'
    $none = Get-FoxPassedEnv @{ FOXAGENT_VERSION = $null; FOXAGENT_DIR = ''; FOXAGENT_RELEASES = '  ' }
    Equal @($none['Pairs']).Count 0; Equal $none['Error'] ''
    $test = Get-FoxPassedEnv @{ FOXAGENT_GET_URL = 'http://127.0.0.1:8765/get.sh'; FOXAGENT_RELEASES = 'http://127.0.0.1:8765' }
    Equal $test['GetUrl'] 'http://127.0.0.1:8765/get.sh'; Equal ($test['Pairs'] -join ' ') 'FOXAGENT_RELEASES=http://127.0.0.1:8765'
}
Check 'a switch that could end its argument and start another is refused, not repaired' {
    foreach ($bad in @(
        @{ FOXAGENT_VERSION = 'v1.2.3; rm -rf ~' }, @{ FOXAGENT_VERSION = '1.2.3' }, @{ FOXAGENT_VERSION = 'v1.2.3 x' }, @{ FOXAGENT_VERSION = 'V1.2.3' },
        @{ FOXAGENT_ALLOW_DOWNGRADE = 'yes' },
        @{ FOXAGENT_RELEASES = 'https://example.org/a b' }, @{ FOXAGENT_RELEASES = 'https://example.org/$(id)' }, @{ FOXAGENT_RELEASES = 'ftp://example.org/x' },
        @{ FOXAGENT_RELEASES = 'https://example.org/"x' }, @{ FOXAGENT_RELEASES = "https://example.org/'x" }, @{ FOXAGENT_RELEASES = 'https://example.org/x;y' },
        @{ FOXAGENT_GET_URL = "https://example.org/get.sh' ; id ; '" }, @{ FOXAGENT_GET_URL = 'https://example.org/get.sh|sh' }, @{ FOXAGENT_GET_URL = '/tmp/get.sh' },
        @{ FOXAGENT_DIR = 'C:\Users\ana\fox' }, @{ FOXAGENT_DIR = '/mnt/c/Users/ana/fox' }, @{ FOXAGENT_DIR = 'c:/fox' }, @{ FOXAGENT_DIR = '/home/ana/my fox' },
        @{ FOXAGENT_DIR = '~/fox' }, @{ FOXAGENT_DIR = '/home/ana/$HOME' }, @{ FOXAGENT_DIR = '-rf' }, @{ FOXAGENT_DIR = '/home/ana/a;b' }, @{ FOXAGENT_DIR = "/home/ana/a`nb" }
    )) {
        $p = Get-FoxPassedEnv $bad
        True ($p['Error'] -ne '') ('accepted: ' + (@($bad.Values) -join ''))
        Equal @($p['Pairs']).Count 0 'pairs of a refused switch'
    }
    True ((Get-FoxPassedEnv @{ FOXAGENT_DIR = '/mnt/c/fox' })['Error'] -match 'recovery words') 'the Windows folder is refused with its reason'
}
Check 'the installer command: env, the switches, bash -lc with pipefail, the address of get.sh in single quotes' {
    $passed = Get-FoxPassedEnv @{ FOXAGENT_VERSION = 'v1.2.3' }
    $c = Get-FoxInstallerCommand $passed
    Equal ($c -join '|') "/usr/bin/env|FOXAGENT_VERSION=v1.2.3|/bin/bash|-lc|set -o pipefail; curl -fsSL 'https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh' | bash"
    Equal (Get-FoxWslArguments -Command $c) "-d Ubuntu --cd ~ --exec /usr/bin/env FOXAGENT_VERSION=v1.2.3 /bin/bash -lc `"set -o pipefail; curl -fsSL 'https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh' | bash`""
    $plain = Get-FoxInstallerCommand (Get-FoxPassedEnv @{})
    Equal ($plain -join '|') "/usr/bin/env|/bin/bash|-lc|set -o pipefail; curl -fsSL 'https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.sh' | bash"
}
Check 'what the install says of itself: the port only when it is a port, the folder for Explorer, the Linux user' {
    $f = ConvertFrom-FoxFacts "user=ana`ndir=/home/ana/foxleague-agent`ninstalled=1`nservice=1`nexplorer=1`nport=8871`nAGENT_MNEMONIC=never`n"
    Equal $f['user'] 'ana'; Equal $f['service'] '1'
    True (-not $f.ContainsKey('AGENT_MNEMONIC')) 'a line of another shape is dropped'
    Equal (Get-FoxDashboardPort $f) 8871
    Equal (Get-FoxExplorerPath $f['dir']) '\\wsl$\Ubuntu\home\ana\foxleague-agent'
    Equal (Get-FoxLinuxUser $f) 'ana'
    foreach ($bad in @('', '80', '99999', '88x70', '88 70', '123456', '-8870')) { Equal (Get-FoxDashboardPort (ConvertFrom-FoxFacts ("port=" + $bad))) 0 ('port ' + $bad) }
    Equal (Get-FoxDashboardPort @{}) 0
    foreach ($bad in @('root', 'Ana', 'a b', '-x', 'a;b', '')) { Equal (Get-FoxLinuxUser @{ user = $bad }) '' ('user ' + $bad) }
}
Check 'the browser is offered once: here only when the installer inside had no explorer.exe to offer it with' {
    True (Test-FoxAskBrowser $false $true) 'no explorer.exe inside, dashboard answers: ask here'
    True (-not (Test-FoxAskBrowser $true $true)) 'explorer.exe inside: the installer asked'
    True (-not (Test-FoxAskBrowser $false $false)) 'a dashboard that does not answer is not offered'
    True (Get-FoxYes '' $true) 'Enter means yes'; True (-not (Get-FoxYes '' $false)) 'Enter means no where no is the default'
    True (Get-FoxYes 'Y' $false) 'Y'; True (-not (Get-FoxYes 'n' $true)) 'n'; True (-not (Get-FoxYes 'no' $true)) 'no'
}
Check 'the scheduled task: one wsl.exe kept attached, without a window, named so that only it is removed' {
    $a = Get-FoxKeepAliveAction 'C:\WINDOWS'
    Equal $a['Execute'] 'C:\WINDOWS\System32\conhost.exe'
    Equal $a['Arguments'] '--headless C:\WINDOWS\System32\wsl.exe -d Ubuntu --cd ~ --exec /bin/sleep infinity'
    True (Test-FoxOwnTask $a['Execute'] $a['Arguments']) 'its own task'
    $spaced = Get-FoxKeepAliveAction 'D:\My Windows\'
    Equal $spaced['Arguments'] '--headless "D:\My Windows\System32\wsl.exe" -d Ubuntu --cd ~ --exec /bin/sleep infinity'
    True (Test-FoxOwnTask $spaced['Execute'] $spaced['Arguments']) 'its own task, with a space in the path'
    True (-not (Test-FoxOwnTask 'C:\WINDOWS\System32\cmd.exe' $a['Arguments'])) 'another program'
    True (-not (Test-FoxOwnTask $a['Execute'] '--headless C:\WINDOWS\System32\wsl.exe -d Debian --cd ~ --exec /bin/sleep infinity')) 'another distribution'
    True (-not (Test-FoxOwnTask $a['Execute'] '--headless powershell.exe -File C:\x.ps1')) 'another command'
}
Check 'the PC: 32-bit, the 32-bit PowerShell, an old build, no wsl.exe, the ISE, a Linux terminal are each said in a sentence' {
    $ok = @{ InsideLinux = $false; Is64 = $true; Is64Process = $true; Build = 19045; WslExe = 'C:\WINDOWS\System32\wsl.exe'; HostName = 'ConsoleHost' }
    Equal (Get-FoxWindowsProblem $ok) ''
    $x = $ok.Clone(); $x['Build'] = 19041; Equal (Get-FoxWindowsProblem $x) ''
    $x = $ok.Clone(); $x['Build'] = 26100; Equal (Get-FoxWindowsProblem $x) ''
    $x = $ok.Clone(); $x['Build'] = 19040; True ((Get-FoxWindowsProblem $x) -match 'Windows 11 or Windows 10 version 2004 \(build 19041\) or later\. This PC runs build 19040') 'old build'
    $x = $ok.Clone(); $x['Is64'] = $false; True ((Get-FoxWindowsProblem $x) -match '64-bit') '32-bit'
    $x = $ok.Clone(); $x['Is64Process'] = $false; True ((Get-FoxWindowsProblem $x) -match 'Windows PowerShell \(x86\)') 'the 32-bit PowerShell'
    $x = $ok.Clone(); $x['WslExe'] = ''; True ((Get-FoxWindowsProblem $x) -match 'wsl\.exe was not found') 'no wsl.exe'
    $x = $ok.Clone(); $x['HostName'] = 'Windows PowerShell ISE Host'; True ((Get-FoxWindowsProblem $x) -match 'ISE') 'ISE'
    $x = $ok.Clone(); $x['InsideLinux'] = $true; True ((Get-FoxWindowsProblem $x) -match 'curl -fsSL https://raw') 'Linux'
}
Check 'virtualization: a running hypervisor or the firmware says yes; two clear noes say off; else unknown' {
    Equal (Get-FoxVirtualization @{ HypervisorPresent = $true; VirtFirmware = $false }) 'ok'
    Equal (Get-FoxVirtualization @{ HypervisorPresent = $false; VirtFirmware = $true }) 'ok'
    Equal (Get-FoxVirtualization @{ HypervisorPresent = $false; VirtFirmware = $false }) 'off'
    Equal (Get-FoxVirtualization @{ HypervisorPresent = $null; VirtFirmware = $false }) 'unknown'
    Equal (Get-FoxVirtualization @{ HypervisorPresent = $false; VirtFirmware = $null }) 'unknown'
    Equal (Get-FoxVirtualization @{ HypervisorPresent = $null; VirtFirmware = $null }) 'unknown'
}

# ====================================================================================================
if ($env:FOX_PS_SANDBOX -ne '1') {
    Write-Host '== 6. skipped: the steps against a stand-in wsl.exe write /etc/wsl.conf and make a user, so they run only'
    Write-Host '      in a throwaway container (FOX_PS_SANDBOX=1).'
} else {
Write-Host '== 6. The steps, against a stand-in wsl.exe that runs the Linux commands for real (this container)'
# ====================================================================================================
$W = '/tmp/fox-world'
$Fake = '/opt/foxfake/wsl.exe'
[void](New-Item -ItemType Directory -Force -Path '/opt/foxfake', "$W/www")
$env:FOX_WORLD = $W
if (-not (Test-Path '/home/fox')) { & useradd -m -s /bin/bash fox }

# The stand-in wsl.exe. Its arguments arrive split by .NET, which follows the Windows rules on Linux too.
[System.IO.File]::WriteAllText($Fake, @'
#!/bin/bash
W=$FOX_WORLD
{ printf '%s' "$1"; shift_args=("${@:2}"); for a in "${shift_args[@]}"; do printf '\t%s' "$a"; done; printf '\n'; } >> "$W/calls.log"
say() { if [ -e "$W/utf16" ]; then iconv -f utf-8 -t utf-16le; else cat; fi; }
code() { cat "$W/$1.exit" 2>/dev/null || echo "${2:-0}"; }
case "$1" in
  --version) cat "$W/version.out" 2>/dev/null | say; exit "$(code version)" ;;
  --status) cat "$W/status.out" 2>/dev/null | say; exit "$(code status)" ;;
  -l)
    if [ -s "$W/distros" ]; then { printf '  NAME      STATE           VERSION\r\n'; sed 's/$/\r/' "$W/distros"; } | say; exit 0; fi
    printf 'Windows Subsystem for Linux has no installed distributions.\r\n' | say; exit 255 ;;
  --update) rm -f "$W/version.exit"; printf 'WSL version: 2.6.1.0\n' > "$W/version.out"; exit 0 ;;
  --install)
    if [ "$2" = -d ] && [ "$3" = Ubuntu ]; then
      if [ -e "$W/install-fails" ]; then echo 'Error: 0x80370102'; exit 1; fi
      printf '* Ubuntu    Stopped         %s\n' "$(cat "$W/default-version" 2>/dev/null || echo 2)" > "$W/distros"
      [ -e "$W/no-first-user" ] || touch "$W/user"
      exit 0
    fi
    exit 0 ;;
  --set-version) sed -i 's/1$/2/' "$W/distros"; exit 0 ;;
  --terminate)
    if grep -Eqi '^[[:space:]]*systemd[[:space:]]*=[[:space:]]*(true|1)' /etc/wsl.conf 2>/dev/null; then touch "$W/systemd-runs"; fi
    exit 0 ;;
  -d)
    [ "$2" = Ubuntu ] || { echo "there is no distribution $2"; exit 255; }
    shift 2
    user=fox
    [ -e "$W/user" ] || user=root
    exec_mode=0
    while [ $# -gt 0 ]; do
      case "$1" in
        -u) user=$2; shift 2 ;;
        --cd) shift 2 ;;
        --exec) exec_mode=1; shift; break ;;
        *) echo "stand-in wsl.exe: unexpected $1"; exit 250 ;;
      esac
    done
    if [ "$exec_mode" = 0 ]; then touch "$W/user"; exit 0; fi   # the first start: Ubuntu makes its user
    if [ "$user" = root ]; then cd /root && exec env HOME=/root USER=root "$@"; fi
    cd "/home/$user" && exec runuser -u "$user" -- env HOME="/home/$user" USER="$user" LOGNAME="$user" "$@" ;;
  *) echo "stand-in wsl.exe: unexpected $1"; exit 250 ;;
esac
'@)
& chmod 755 $Fake

# systemd, curl, apt and loginctl of the stand-in Ubuntu.
function Put-Tool([string]$Path, [string]$Body) { [System.IO.File]::WriteAllText($Path, "#!/bin/bash`n" + $Body + "`n"); & chmod 755 $Path }
Put-Tool '/usr/local/bin/systemctl' 'if [ "$1" = is-system-running ]; then if [ -e "$FOX_WORLD/systemd-runs" ]; then echo "${FOX_SYSTEMD_SAYS:-running}"; exit 0; fi; echo offline; exit 1; fi; exit 1'
Put-Tool '/usr/bin/loginctl' 'echo "loginctl $* as $(id -un)" >> "$FOX_WORLD/linux.log"'
Put-Tool '/usr/local/bin/apt-get' 'echo "apt-get $* as $(id -un)" >> "$FOX_WORLD/linux.log"; if [ "$1" = install ]; then cp /opt/foxfake/curl /usr/local/bin/curl; fi'
Put-Tool '/opt/foxfake/curl' 'url="${@: -1}"; f="$FOX_WORLD/www/${url##*/}"; echo "curl $*" >> "$FOX_WORLD/linux.log"; [ -f "$f" ] || exit 22; cat "$f"'
# What stands in for get.sh: it leaves what an install leaves, and notes the switches it was started with.
[System.IO.File]::WriteAllText("$W/www/get.sh", @'
d=${FOXAGENT_DIR:-$HOME/foxleague-agent}
case $d in /*) ;; *) d=$PWD/$d ;; esac
mkdir -p "$d/versions" "$HOME/.config/systemd/user"
echo v1.0.0 > "$d/versions/active"
printf 'AGENT_MNEMONIC="made up words of a stand in install never shown on the screen"\nWEB_UI_PORT="8899"\nANTHROPIC_API_KEY="stand-in-key-never-shown"\n' > "$d/.env"
chmod 600 "$d/.env"
echo '[Unit]' > "$HOME/.config/systemd/user/foxleague-agent.service"
echo "get.sh ran as $(id -un) in $PWD version=${FOXAGENT_VERSION:-} releases=${FOXAGENT_RELEASES:-} dir=${FOXAGENT_DIR:-} downgrade=${FOXAGENT_ALLOW_DOWNGRADE:-} tty=$([ -t 0 ] && echo yes || echo no)" >> "$FOX_WORLD/linux.log"
echo "  the stand-in installer ran"
exit "${FOX_INSTALLER_EXIT:-0}"
'@)

# Windows, as stand-in functions. $World is one PC; New-World makes a fresh one.
$World = @{}
function New-World {
    param([bool]$VmCompute = $true, [string]$Distros = '', [bool]$HasUser = $false, [string]$Conf = $null, [bool]$SystemdRuns = $false, [bool]$Curl = $true)
    & bash -c "rm -rf $W/calls.log $W/distros $W/user $W/systemd-runs $W/utf16 $W/*.exit $W/*.out $W/install-fails $W/no-first-user $W/default-version /etc/wsl.conf /etc/wsl.conf.before-foxleague /home/fox/foxleague-agent /home/fox/fox2 /home/fox/.config /usr/local/bin/curl"
    [System.IO.File]::WriteAllText("$W/version.out", "WSL version: 2.6.1.0`nKernel version: 6.6.87.2-1`n")
    # The Linux user of the stand-in Ubuntu writes its notes here too.
    [System.IO.File]::WriteAllText("$W/linux.log", ''); & chmod 777 $W; & chmod 666 "$W/linux.log"
    [System.IO.File]::WriteAllText("$W/status.out", "Default Version: 2`n")
    if ($Distros -ne '') { [System.IO.File]::WriteAllText("$W/distros", $Distros) }
    if ($HasUser) { [System.IO.File]::WriteAllText("$W/user", '') }
    if ($PSBoundParameters.ContainsKey('Conf')) { [System.IO.File]::WriteAllText('/etc/wsl.conf', $Conf) }
    if ($SystemdRuns) { [System.IO.File]::WriteAllText("$W/systemd-runs", '') }
    if ($Curl) { & cp /opt/foxfake/curl /usr/local/bin/curl }
    $script:World = @{
        Facts = @{ InsideLinux = $false; Is64 = $true; Is64Process = $true; Build = 26100; WslExe = $Fake; HostName = 'ConsoleHost'; Elevated = $false; User = 'PC\ana'
                   HypervisorPresent = $VmCompute; VirtFirmware = $true; VmCompute = $VmCompute; SystemRoot = 'C:\WINDOWS' }
        VmCompute = $VmCompute; VmComputeAfterInstall = $VmCompute; Elevated = @(); ElevatedOutcome = @{ Outcome = 'done'; ExitCode = 0 }
        Task = $null; TaskRegistered = 0; Answers = @(); Asked = @(); Lines = @(); Urls = @(); Opened = @(); DashboardAnswers = $true
        Env = @{ FOXAGENT_GET_URL = 'http://127.0.0.1:1/get.sh' }
    }
}
function Get-FoxWslPath { return $Fake }
function Get-FoxWindowsFacts { return $World['Facts'].Clone() }
function Get-FoxVmCompute { return $World['VmCompute'] }
function Start-FoxElevated([string]$File, [string]$Arguments) { $World['Elevated'] += $Arguments; $World['VmCompute'] = $World['VmComputeAfterInstall']; return $World['ElevatedOutcome'] }
function Register-FoxKeepAlive([string]$User, $Action) { $World['Task'] = @{ Execute = $Action['Execute']; Arguments = $Action['Arguments']; State = 'Ready'; User = $User }; $World['TaskRegistered']++; return 'logon and every 5 minutes' }
function Start-FoxKeepAlive { $World['Task']['State'] = 'Running' }
function Get-FoxTask { return $World['Task'] }
function Remove-FoxKeepAlive { $World['Task'] = $null }
function Test-FoxUrl([string]$Url) { $World['Urls'] += $Url; return $World['DashboardAnswers'] }
function Open-FoxBrowser([string]$Url) { $World['Opened'] += $Url }
function Wait-Fox([int]$Seconds) { }
function Read-FoxLine([string]$Prompt) {
    $World['Asked'] += $Prompt
    if (@($World['Answers']).Count -eq 0) { return '' }
    $first = @($World['Answers'])[0]
    $World['Answers'] = @(@($World['Answers']) | Select-Object -Skip 1)
    return $first
}
function Write-FoxStep([string]$Text) { $World['Lines'] += ('== ' + $Text) }
function Write-FoxLine([string]$Text) { $World['Lines'] += $Text }
function Get-FoxEnvValues { return $World['Env'] }
# The whole install as the main function runs it. Returns 'done' or 'stop: <the sentence>'.
function Run-Install {
    try { Invoke-FoxInstall; return 'done' }
    catch { if ($_.Exception.Data.Contains('FoxStop')) { return 'stop: ' + $_.Exception.Message }; throw }
}
function Screen { return ($World['Lines'] -join "`n") }
# (ReadAllText, not Get-Content: an empty file must read as '', which -match can be asked about.)
function Calls { if (Test-Path "$W/calls.log") { return [System.IO.File]::ReadAllText("$W/calls.log") }; return '' }
function LinuxLog { if (Test-Path "$W/linux.log") { return [System.IO.File]::ReadAllText("$W/linux.log") }; return '' }
function Conf { if (Test-Path '/etc/wsl.conf') { return [System.IO.File]::ReadAllText('/etc/wsl.conf') }; return $null }
$UbuntuThere = "* Ubuntu    Running         2`n"

Check 'a real process: arguments with spaces, quotes, $ and backslashes reach Linux as they were written' {
    New-World -Distros $UbuntuThere -HasUser $true
    $hard = @('two words', 'say "hi" to $HOME', 'back\slash', 'tail\', 'single ''quote''', 'a\"b', '')
    $r = Invoke-FoxLinux -Command (@('/usr/bin/printf', '%s\n') + $hard) -Capture
    Equal $r['ExitCode'] 0
    Equal $r['Text'] (($hard -join "`n") + "`n")
}
Check 'a real process: the exit status, the text of both outputs, the input without a byte order mark, a timeout' {
    New-World -Distros $UbuntuThere -HasUser $true
    $r = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'echo out; echo err >&2; exit 7') -Capture
    Equal $r['ExitCode'] 7; Equal $r['Text'] "out`n"; Equal $r['ErrText'] "err`n"
    $in = Invoke-FoxLinux -User 'root' -Command @('/usr/bin/od', '-An', '-c') -Capture -StdinText "a`n"
    Equal ($in['Text'] -replace '\s+', ' ').Trim() 'a \n'
    $empty = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'cat | wc -c') -Capture
    Equal $empty['Text'].Trim() '0' 'a captured program reads the end of input, not the keyboard'
    $slow = Invoke-FoxProcess -File '/bin/sleep' -Arguments '30' -Capture -TimeoutSeconds 1
    True $slow['TimedOut'] 'the program was not ended'
    $who = Invoke-FoxLinux -Command @('/usr/bin/id', '-un') -Capture
    Equal $who['Text'].Trim() 'fox' 'the default user'
    $root = Invoke-FoxLinux -User 'root' -Command @('/bin/sh', '-c', 'id -un; pwd') -Capture
    Equal $root['Text'] "root`n/root`n"
}
Check 'a real process: wsl.exe that prints UTF-16 is read (an old WSL that ignores WSL_UTF8)' {
    New-World -Distros "* Debian    Running         2`n  Ubuntu    Stopped         2`n" -HasUser $true
    [System.IO.File]::WriteAllText("$W/utf16", '')
    $list = Invoke-FoxWsl -Arguments '-l -v' -Capture
    True (@($list['Bytes'] | Where-Object { $_ -eq 0 }).Count -gt 10) 'the stand-in did not print UTF-16'
    $now = Get-FoxUbuntuNow
    Equal $now['Readiness'] 'ready'
    Equal (Get-FoxWslReadiness $true)['State'] 'ready'
}

Check 'a PC without WSL: the administrator runs wsl --install --no-distribution, then: restart and paste again' {
    New-World -VmCompute $false
    $World['VmComputeAfterInstall'] = $false
    $end = Run-Install
    Equal $end 'stop: '
    Equal ($World['Elevated'] -join '|') '--install --no-distribution'
    Equal (Calls) '' 'wsl.exe was started on a PC without WSL'
    True ((Screen) -match 'answer Yes') 'the administrator prompt is announced'
    True ((Screen) -match '== Restart Windows now, then paste the same line again') (Screen)
    True ((Screen) -match [regex]::Escape('irm https://raw.githubusercontent.com/foxsyai/foxleague-agent/main/get.ps1 | iex')) 'the line to paste again'
    True ($null -eq $World['Task']) 'no task before the agent is there'
}
Check 'a PC without WSL where the prompt is answered with No: nothing is changed, and what to do is said' {
    New-World -VmCompute $false
    $World['VmComputeAfterInstall'] = $false
    $World['ElevatedOutcome'] = @{ Outcome = 'refused'; ExitCode = $null }
    $end = Run-Install
    True ($end -match '^stop: WSL was not installed: the administrator prompt was answered with No') $end
    True ($end -match 'wsl --install --no-distribution') $end
}
Check 'a PC without WSL and virtualization off in the BIOS: Enter stops before anything is installed' {
    New-World -VmCompute $false
    $World['Facts']['HypervisorPresent'] = $false; $World['Facts']['VirtFirmware'] = $false
    $end = Run-Install
    True ($end -match '^stop: nothing was changed\. Turn virtualization on') $end
    Equal @($World['Elevated']).Count 0
}
Check 'an old WSL is updated with wsl --update and the install goes on' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`nsystemd=true`n" -SystemdRuns $true
    [System.IO.File]::WriteAllText("$W/version.out", "WSL version: 0.60.0.0`n")
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    Equal (Run-Install) 'done'
    True ((Calls) -match '(?m)^--update$') (Calls)
    Equal @($World['Elevated']).Count 0
}

Check 'after the restart: Ubuntu is installed, systemd turned on, Ubuntu restarted, the installer run, the task made' {
    New-World -Curl $false
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/fox/get.sh'; FOXAGENT_VERSION = 'v1.2.3'; FOXAGENT_RELEASES = 'https://example.org/fox'; FOXAGENT_ALLOW_DOWNGRADE = '1' }
    $end = Run-Install
    Equal $end 'done' (Screen)
    Equal @($World['Elevated']).Count 0 'no administrator when WSL is there'
    $calls = Calls
    True ($calls -match "(?m)^--install`t-d`tUbuntu$") $calls
    True ($calls -match "(?m)^--terminate`tUbuntu$") $calls
    True ($calls -notmatch '--shutdown') 'never all of WSL'
    True ($calls -notmatch '--set-default') 'the default distribution and version are not changed'
    Equal (Conf) "[boot]`nsystemd=true`n"
    True (-not (Test-Path '/etc/wsl.conf.before-foxleague')) 'no copy of a file that was not there'
    $log = LinuxLog
    True ($log -match 'apt-get update as root') $log
    True ($log -match 'apt-get install -y curl tar ca-certificates as root') $log
    True ($log -match 'curl -fsSL https://example\.org/fox/get\.sh') $log
    True ($log -match 'get\.sh ran as fox in /home/fox version=v1\.2\.3 releases=https://example\.org/fox dir= downgrade=1') $log
    True ($log -match 'loginctl enable-linger fox as root') $log
    $screen = Screen
    True ($screen -match 'They are new and yours to choose') 'the username and password are announced before Ubuntu asks'
    True ($screen -match 'This installer never sees it') 'the password stays with Ubuntu'
    True ($screen -match 'type  exit  and press Enter') 'how to come back'
    True ($screen -match 'Added the two lines \[boot\] and systemd=true') $screen
    True ($screen -match 'Dashboard   http://localhost:8899') 'the port the install has, not 8870'
    True ($screen -match [regex]::Escape('\\wsl$\Ubuntu\home\fox\foxleague-agent')) 'the folder for Explorer'
    True ($screen -match 'Updates are one click in the dashboard') $screen
    True ($screen -notmatch 'made up words|stand-in-key|never.shown') 'a secret of the .env reached the screen'
    Equal $World['Task']['Execute'] 'C:\WINDOWS\System32\conhost.exe'
    Equal $World['Task']['User'] 'PC\ana'
    Equal $World['Task']['State'] 'Running'
    Equal ($World['Urls'] | Select-Object -First 1) 'http://localhost:8899/healthz'
    Equal ($World['Opened'] -join '|') 'http://localhost:8899' 'Enter opens the dashboard (no explorer.exe inside this stand-in Ubuntu)'
    True (($World['Asked'] -join '|') -match 'Open the dashboard in your browser now\? \(Enter means yes, n means no\)') 'the browser question'
}
Check 'pasted again on a finished install: nothing is installed, changed or restarted; the installer and the task run again' {
    # (the state the check above left: Ubuntu with its user, systemd on and running, curl there, the agent installed)
    $confBefore = Conf
    [System.IO.File]::WriteAllText("$W/calls.log", ''); & bash -c ": > $W/linux.log"
    $task = $World['Task']
    $World['Lines'] = @(); $World['Asked'] = @(); $World['Opened'] = @(); $World['Answers'] = @('n'); $World['Task'] = $task
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/fox/get.sh' }
    Equal (Run-Install) 'done' (Screen)
    $calls = Calls
    True ($calls -notmatch '--install') $calls
    True ($calls -notmatch '--terminate') 'Ubuntu was restarted although nothing changed'
    Equal (Conf) $confBefore
    True ((LinuxLog) -notmatch 'apt-get') 'apt ran although curl is there'
    True ((Screen) -match 'systemd is already turned on') (Screen)
    True ((Screen) -match 'Ubuntu is installed and has a user of its own') (Screen)
    Equal @($World['Opened']).Count 0 'n keeps the browser closed'
    Equal $World['TaskRegistered'] 2 'the task is made again (replaced), not doubled'
}
Check 'Ubuntu that was there, with systemd=false and things running: asked before it is restarted; no means stop' {
    New-World -Distros "* Debian    Running         2`n  Ubuntu    Running         2`n" -HasUser $true -Conf "[automount]`nenabled=true`n`n[boot]`nsystemd=false`n"
    $World['Answers'] = @('n')
    $end = Run-Install
    True ($end -match '^stop: Ubuntu was not restarted') $end
    Equal (Conf) "[automount]`nenabled=true`n`n[boot]`nsystemd=true`n"
    Equal ([System.IO.File]::ReadAllText('/etc/wsl.conf.before-foxleague')) "[automount]`nenabled=true`n`n[boot]`nsystemd=false`n" 'the file as it was is kept'
    True ((Calls) -notmatch '--terminate') 'restarted without the yes'
    True ((LinuxLog) -notmatch 'get\.sh ran') 'the installer ran without systemd'
    # Pasted again, with Enter: now it restarts and goes on. The copy of the first file is not overwritten.
    $World['Answers'] = @(); $World['Lines'] = @()
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    Equal (Run-Install) 'done' (Screen)
    True ((Calls) -match "(?m)^--terminate`tUbuntu$") (Calls)
    Equal ([System.IO.File]::ReadAllText('/etc/wsl.conf.before-foxleague')) "[automount]`nenabled=true`n`n[boot]`nsystemd=false`n"
    Equal (@(BootHeaders (Conf))) 1 'one [boot]'
}
Check 'a wsl.conf that already says systemd=true while systemd does not run yet: Ubuntu is restarted, the file is not touched' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`r`nsystemd=true`r`n"
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    Equal (Run-Install) 'done' (Screen)
    Equal (Conf) "[boot]`r`nsystemd=true`r`n"
    True ((Calls) -match "(?m)^--terminate`tUbuntu$") (Calls)
}
Check 'systemd that never starts (a WSL too old for it): the installer inside is not started' {
    New-World -Distros $UbuntuThere -HasUser $true
    Put-Tool '/usr/local/bin/systemctl' 'echo offline; exit 1'
    try { $end = Run-Install } finally {
        Put-Tool '/usr/local/bin/systemctl' 'if [ "$1" = is-system-running ]; then if [ -e "$FOX_WORLD/systemd-runs" ]; then echo "${FOX_SYSTEMD_SAYS:-running}"; exit 0; fi; echo offline; exit 1; fi; exit 1'
    }
    True ($end -match '^stop: systemd did not start in Ubuntu') $end
    True ($end -match 'wsl --update') $end
    True ((LinuxLog) -notmatch 'get\.sh ran') 'the installer ran'
}
Check 'a wsl.conf that is not text is left as it is' {
    New-World -Distros $UbuntuThere -HasUser $true
    [System.IO.File]::WriteAllBytes('/etc/wsl.conf', [byte[]](0x5B, 0x62, 0x6F, 0x6F, 0x74, 0x5D, 0x0A, 0xFF, 0xFE, 0x0A))
    $end = Run-Install
    True ($end -match '^stop: the file /etc/wsl\.conf in Ubuntu holds bytes that are not text') $end
    Equal ([System.IO.File]::ReadAllBytes('/etc/wsl.conf').Length) 10
}
Check 'Ubuntu under WSL 1 (the PC makes new distributions for WSL 1): moved to WSL 2 with a yes, the setting is left' {
    New-World
    [System.IO.File]::WriteAllText("$W/status.out", "Default Version: 1`n")
    [System.IO.File]::WriteAllText("$W/default-version", '1')
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    Equal (Run-Install) 'done' (Screen)
    True ((Calls) -match "(?m)^--set-version`tUbuntu`t2$") (Calls)
    True ((Calls) -notmatch 'set-default-version') 'the setting of the PC was changed'
    True ((Screen) -match 'your own setting, which is left as it is') (Screen)
}
Check 'Ubuntu whose first start was never done (its user is root): started here once, then the install goes on' {
    New-World
    [System.IO.File]::WriteAllText("$W/no-first-user", '')
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    Equal (Run-Install) 'done' (Screen)
    True ((Screen) -match 'Ubuntu has no user of your own yet') (Screen)
    True ((Calls) -match "(?m)^-d`tUbuntu`t--cd`t~$") (Calls)
    True ((LinuxLog) -match 'get\.sh ran as fox') 'the installer ran as the new user, not as root'
}
Check 'Ubuntu that cannot be installed: what to try is said, and nothing else runs' {
    New-World
    [System.IO.File]::WriteAllText("$W/install-fails", '')
    $end = Run-Install
    True ($end -match '^stop: Ubuntu could not be installed \(wsl --install -d Ubuntu ended with 1') $end
    True ((Screen) -match 'virtualization') (Screen)
    True ((Screen) -match 'https://learn\.microsoft\.com/windows/wsl/troubleshooting') (Screen)
    True ($null -eq $World['Task']) 'a task without an agent'
}
Check 'a switch that is refused stops before the PC is even looked at' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`nsystemd=true`n" -SystemdRuns $true
    $World['Env'] = @{ FOXAGENT_DIR = 'C:\fox' }
    $end = Run-Install
    True ($end -match '^stop: FOXAGENT_DIR must name a folder inside Ubuntu') $end
    Equal (Calls) ''
}
Check 'FOXAGENT_DIR reaches the installer and the last screen names that folder' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`nsystemd=true`n" -SystemdRuns $true
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh'; FOXAGENT_DIR = 'fox2' }
    Equal (Run-Install) 'done' (Screen)
    True ((LinuxLog) -match 'get\.sh ran as fox in /home/fox version= releases= dir=fox2 ') (LinuxLog)
    True ((Screen) -match [regex]::Escape('\\wsl$\Ubuntu\home\fox\fox2')) (Screen)
}
Check 'the installer inside fails (a download that does not come, or its own error): said, and no task is made' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`nsystemd=true`n" -SystemdRuns $true
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/missing.sh' }
    $end = Run-Install
    True ($end -match '^stop: the installer inside Ubuntu did not finish \(status 22') ('a failed download must not count as a finished install: ' + $end)
    True ($null -eq $World['Task']) 'a task without an agent'
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    $env:FOX_INSTALLER_EXIT = '130'
    try { $end = Run-Install } finally { Remove-Item Env:FOX_INSTALLER_EXIT }
    True ($end -match '^stop: the installer was stopped with Ctrl-C') $end
}
Check 'a dashboard that does not answer from Windows is not opened; the user is told what to do' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`nsystemd=true`n" -SystemdRuns $true
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    $World['DashboardAnswers'] = $false
    Equal (Run-Install) 'done' (Screen)
    Equal @($World['Opened']).Count 0
    True ((Screen) -match 'wsl --shutdown') (Screen)
    True (($World['Urls'] -join ' ') -match 'http://127\.0\.0\.1:8899/healthz') 'both addresses are tried'
}
Check 'the task cannot be made: said, with what keeps the agent playing until then' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`nsystemd=true`n" -SystemdRuns $true
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    function Register-FoxKeepAlive([string]$User, $Action) { throw 'Access is denied.' }
    try { Equal (Run-Install) 'done' (Screen) } finally {
        function Register-FoxKeepAlive([string]$User, $Action) { $World['Task'] = @{ Execute = $Action['Execute']; Arguments = $Action['Arguments']; State = 'Ready'; User = $User }; $World['TaskRegistered']++; return 'logon and every 5 minutes' }
    }
    True ((Screen) -match 'The scheduled task could not be made: Access is denied\.') (Screen)
    True ((Screen) -match 'leave one open') (Screen)
}

Check '-Uninstall removes the task this script made, says how to remove the agent, and touches nothing in Ubuntu' {
    New-World -Distros $UbuntuThere -HasUser $true -Conf "[boot]`nsystemd=true`n" -SystemdRuns $true
    $a = Get-FoxKeepAliveAction 'C:\WINDOWS'
    $World['Task'] = @{ Execute = $a['Execute']; Arguments = $a['Arguments']; State = 'Running' }
    Invoke-FoxUninstall
    True ($null -eq $World['Task']) 'the task is still there'
    True ((Screen) -match 'Removed the scheduled task "FoxLeague Agent \(WSL\)"') (Screen)
    True ((Screen) -match [regex]::Escape('cd ~/foxleague-agent && ./install.sh --uninstall')) (Screen)
    True ((Screen) -match 'WSL, Ubuntu and the line systemd=true .* are left as they are') (Screen)
    Equal (Calls) '' 'wsl.exe was started by the uninstall'
    Equal (Conf) "[boot]`nsystemd=true`n"
}
Check '-Uninstall leaves a task of the same name that is not ours, and says so when there is none' {
    New-World
    $World['Task'] = @{ Execute = 'C:\Tools\other.exe'; Arguments = '--mine'; State = 'Ready' }
    Invoke-FoxUninstall
    True ($null -ne $World['Task']) 'a task that is not ours was removed'
    True ((Screen) -match 'it is not the one this installer makes, so it was left alone') (Screen)
    New-World
    Invoke-FoxUninstall
    True ((Screen) -match 'nothing to remove on the Windows side') (Screen)
}
Check 'every sentence on the screen: plain ASCII, no long dash, no comma before the last "and" or "or", never the word bot' {
    # (all the screens of the runs above are gone with their worlds; this one run prints every step once more)
    New-World
    $World['Env'] = @{ FOXAGENT_GET_URL = 'https://example.org/get.sh' }
    [void](Run-Install); Invoke-FoxUninstall
    foreach ($line in $World['Lines']) {
        True ($line -cmatch '^[\x20-\x7E]*$') ('not plain ASCII: ' + $line)
        True ($line -notmatch ', (and|or) ') ('a comma before and/or: ' + $line)
        True ($line -notmatch '(?i)\bbots?\b') ('the word bot: ' + $line)
    }
}
}

# ====================================================================================================
Write-Host ''
Write-Host ('get.ps1 checks: ' + $Passed + ' passed, ' + @($Failed).Count + ' failed')
if (@($Failed).Count -gt 0) { exit 1 }
exit 0
