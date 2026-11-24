#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$RepoPath = 'F:\GitFile\Persion - Games\DarkTide-Web',
    [string]$WorktreeRoot = 'F:\GitFile\Persion - Games\DarkTide-Web-worktrees',
    [string]$ModsRepoPath = 'F:\GitFile\Persion - Games\Warhammer-40-000-DARKTIDE-Mods-main',
    [string]$LogDir = "$env:LOCALAPPDATA\DarkTide-Announcements\logs",
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$Model = 'gpt-5.6-sol',
    [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Effort = 'medium',
    [ValidateRange(0, 100)][int]$MaxFixRounds = 2,
    [ValidateRange(1, 35791)][int]$CodexTimeoutMinutes = 60,
    [switch]$DryRun,
    [ValidatePattern('^[0-9]{8}$')][string]$Batch,
    [ValidatePattern('^[0-9]+(,[0-9]+)*$')][string]$Topics
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$OutputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$invariant = [Globalization.CultureInfo]::InvariantCulture
# Windows time-zone identifier for Asia/Taipei.
$taipei = [TimeZoneInfo]::FindSystemTimeZoneById('Taipei Standard Time')
$now = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $taipei)
if (-not $Batch) { $Batch = $now.ToString('yyyyMMdd', $invariant) }
$batchDate = [datetime]::ParseExact($Batch, 'yyyyMMdd', $invariant).ToString('yyyy-MM-dd', $invariant)
$stamp = $now.ToString('yyyyMMdd-HHmmss', $invariant)
$RepoPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($RepoPath)
$ModsRepoPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ModsRepoPath)
$WorktreeRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($WorktreeRoot)
$LogDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($LogDir)
$repository = 'SyuanTsai/DarkTide-Web'
$intake = 'scripts/content/announcements-intake.mjs'
$batchDir = "content/authoring/v2/official-announcements/$Batch"
$branch = "auto/announcements-$Batch"
$worktree = Join-Path $WorktreeRoot "auto-announcements-$stamp"

function Invoke-Native {
    param(
        [string]$Command,
        [string[]]$Arguments,
        [switch]$Quiet,
        [switch]$ReportExit
    )

    $lines = @(& $Command @Arguments 2>&1 | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE
    if (-not $Quiet -or $code -ne 0) { $lines | ForEach-Object { Write-Host $_ } }
    if ($ReportExit) { return @{ Code = $code; Lines = $lines } }
    if ($code -ne 0) { throw "$Command $($Arguments -join ' ') exited with code $code." }
    return $lines
}

function Read-Json {
    param([string]$Json)

    # Preserve the original timestamp string when PowerShell exposes this option.
    $options = @{}
    if ($PSVersionTable.PSVersion -ge [version]'7.5') { $options.DateKind = 'String' }
    return ConvertFrom-Json -InputObject $Json @options
}

function Enter-RunnerLock {
    param([string]$Path)

    try {
        $stream = [IO.File]::Open($Path, 'OpenOrCreate', 'ReadWrite', 'None')
    } catch [IO.IOException] {
        $win32Code = $_.Exception.HResult -band 0xffff
        if ($win32Code -in 32, 33) { return }
        throw
    }
    try {
        $stream.SetLength(0)
        $stream.Position = 0
        $bytes = [Text.Encoding]::UTF8.GetBytes([string]$PID)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        return $stream
    } catch {
        $stream.Dispose()
        throw
    }
}

function Invoke-Translation {
    param([string]$PromptPath, [int]$Round)

    $codexLog = Join-Path $LogDir "codex-$Model-announcements-$Batch-r$Round.log"
    $childScript = @'
param($PromptPath, $Model, $Effort, $Worktree)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
$configuration = "model_reasoning_effort='$Effort'"
Get-Content -LiteralPath $PromptPath -Raw -Encoding utf8 |
    & codex exec -m $Model -c $configuration -s workspace-write --skip-git-repo-check -C $Worktree - 2>&1 |
    ForEach-Object { [Console]::WriteLine([string]$_) }
exit $LASTEXITCODE
'@
    # Quote the child PowerShell arguments as literals. The prompt travels through stdin.
    $literals = @($PromptPath, $Model, $Effort, $worktree) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }
    $command = "& {`n$childScript`n} " + ($literals -join ' ')
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Write-Host "Codex round $Round. Log: $codexLog"
    $process = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -WorkingDirectory $worktree `
        -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) `
        -RedirectStandardOutput $codexLog -NoNewWindow -PassThru
    try {
        if (-not $process.WaitForExit($CodexTimeoutMinutes * 60000)) {
            try { $process.Kill($true) } catch [InvalidOperationException] {
                if (-not $process.HasExited) { throw }
            }
            $process.WaitForExit()
            throw "Codex timed out after $CodexTimeoutMinutes minutes. See $codexLog."
        }
        if ($process.ExitCode -ne 0) { throw "Codex exited with code $($process.ExitCode). See $codexLog." }
    } finally {
        $process.Dispose()
    }
}

function Format-MarkdownTitle {
    param([string]$Title)

    return [regex]::Replace($Title, '[\\`*_{\[\]<>|]', '\$0') -replace '[\r\n]+', ' '
}

function Invoke-Daily {
    $worktreeAdded = $false
    $locationPushed = $false
    $tempDir = $null
    try {
        foreach ($requiredCommand in 'git', 'node', 'npm', 'gh', 'codex') {
            $commandInfo = Get-Command $requiredCommand -CommandType Application -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if (-not $commandInfo) { throw "Required command '$requiredCommand' was not found on PATH." }
        }

        $null = Invoke-Native git @('-C', $RepoPath, 'fetch', 'origin')
        $null = Invoke-Native git @('-C', $RepoPath, 'worktree', 'add', '--detach', $worktree, 'origin/main')
        $worktreeAdded = $true
        Push-Location -LiteralPath $worktree
        $locationPushed = $true

        if ($Topics) {
            $topicIds = $Topics
        } else {
            $scan = Read-Json ((Invoke-Native node @($intake, 'scan', '--json') -Quiet) -join "`n")
            if ($scan.newCount -eq 0) {
                Write-Host 'No new announcements.'
                return 0
            }
            $topicIds = $scan.topics.id -join ','
        }

        $openPrs = Read-Json ((Invoke-Native gh @('pr', 'list', '--repo', $repository, '--state', 'open', '--limit', '1000', '--json', 'headRefName') -Quiet) -join "`n")
        if ($openPrs -and ($openPrs | Where-Object { $_.headRefName -clike 'auto/announcements-*' } | Select-Object -First 1)) {
            Write-Host 'An automatic announcement PR is already open. The next run will retry.'
            return 0
        }
        $remoteBranch = Invoke-Native git @('ls-remote', '--exit-code', '--heads', 'origin', "refs/heads/$branch") -ReportExit
        if ($remoteBranch.Code -eq 0) {
            Write-Host "Remote branch $branch already exists."
            return 0
        }
        if ($remoteBranch.Code -ne 2) { throw "Remote branch lookup failed with code $($remoteBranch.Code)." }
        if (Invoke-Native git @('ls-tree', '-d', 'HEAD', '--', $batchDir) -Quiet) {
            Write-Host "Batch $Batch already exists on origin/main."
            return 0
        }

        $null = Invoke-Native npm @('ci')
        $tempRoot = [IO.DirectoryInfo]::new([IO.Path]::GetTempPath()).FullName.TrimEnd('\', '/')
        $tempPath = Join-Path $tempRoot "darktide-announcements-$([guid]::NewGuid())"
        $tempDir = (New-Item -ItemType Directory -Path $tempPath).FullName
        $outlineDir = Join-Path $tempDir 'outlines'
        $null = Invoke-Native node @($intake, 'capture', '--batch', $Batch, '--topics', $topicIds, '--outline-dir', $outlineDir)

        $null = Invoke-Native git @('-C', $ModsRepoPath, 'fetch', 'origin')
        $glossary = @(Invoke-Native git @('-C', $ModsRepoPath, 'show', 'origin/main:Referneces/Translation.md') -Quiet)
        if (-not ($glossary -join '').Trim()) { throw 'The Mods repository glossary is empty.' }
        $glossaryPath = Join-Path $tempDir 'Translation.md'
        Set-Content -LiteralPath $glossaryPath -Value $glossary -Encoding utf8

        $plan = Read-Json (Get-Content -LiteralPath "$batchDir/batch-plan.json" -Encoding utf8 -Raw)
        $manifest = Read-Json (Get-Content -LiteralPath "$batchDir/source-snapshots/source-manifest.json" -Encoding utf8 -Raw)
        $articleRows = foreach ($article in $plan.articles) {
            $post = $manifest.posts | Where-Object topicId -EQ $article.topicId | Select-Object -First 1
            if (-not $post) { throw "Topic $($article.topicId) is missing from the source manifest." }
            $createdAt = if ($post.createdAt -is [datetime]) { $post.createdAt.ToUniversalTime().ToString('o') } else { $post.createdAt }
            [pscustomobject]@{ Post = $post; Article = $article; CreatedAt = $createdAt }
        }
        $articleList = foreach ($row in $articleRows) {
            $title = $row.Post.title -replace '[\r\n]+', ' '
            "- $($row.Post.topicId) | $title | $($row.CreatedAt) | $batchDir/$($row.Article.translation)"
        }

        $template = Get-Content -LiteralPath 'scripts/content/announcements-translate-prompt.md' -Encoding utf8 -Raw
        $promptPath = Join-Path $tempDir 'prompt.md'
        $promptValues = @{
            BATCH_DIR = $batchDir
            OUTLINE_DIR = $outlineDir
            GLOSSARY_PATH = $glossaryPath
            ARTICLES = $articleList -join "`n"
            GATE_ERRORS = ''
        }
        for ($round = 0; $round -le $MaxFixRounds; $round++) {
            $prompt = [regex]::Replace($template, '\{\{([A-Z_]+)\}\}', { param($match) $promptValues[$match.Groups[1].Value] })
            Set-Content -LiteralPath $promptPath -Value $prompt -Encoding utf8
            Invoke-Translation -PromptPath $promptPath -Round $round
            if (Invoke-Native git @('status', '--porcelain', '--untracked-files=all', '--', '.', ":(exclude)$batchDir") -Quiet) {
                throw 'Files outside the announcement batch changed during translation.'
            }

            foreach ($artifact in 'announcements.json', 'source-intake.json') {
                $artifactPath = "$batchDir/$artifact"
                if (Test-Path -LiteralPath $artifactPath) { Remove-Item -LiteralPath $artifactPath }
            }
            $build = Invoke-Native node @($intake, 'build', '--batch', $Batch) -ReportExit
            $check = Invoke-Native node @($intake, 'check', '--batch', $Batch) -ReportExit
            $gateErrors = @($check.Lines -cmatch '^ERROR\s')
            $gateWarnings = @($check.Lines -cmatch '^WARN\s')
            if ($gateErrors.Count -eq 0) { break }
            $promptValues.GATE_ERRORS = $gateErrors -join "`n"
        }

        $batchNotes = @(
            '# ' + $batchDate + ' official announcement batch (auto)'
            ''
            'This batch captures official Fatshark forum first posts and their generated Traditional Chinese translations.'
            ''
            '| Date | Topic | Record |'
            '|---|---|---|'
            foreach ($row in $articleRows) {
                $title = Format-MarkdownTitle $row.Post.title
                '| {0} | {1} ({2}) | `{3}` |' -f $row.CreatedAt.Substring(0, 10), $title, $row.Post.topicId, $row.Article.slug
            }
            ''
            '- `source-snapshots/` holds the first-post HTML (`cooked`) and `source-manifest.json` with its SHA-256 hashes. Replies are excluded.'
            '- `translations/*.md` holds the generated Traditional Chinese texts. The build writes `announcements.json` with typed blocks and `source-intake.json` with snapshot, translation hash and image provenance.'
            '- The build pins external image URLs by HTTPS GET, SHA-256 and size. YouTube embeds and Steam store cards are plain links.'
            '- Terminology follows `term-rules.json` and the Mods repository glossary at `origin/main:Referneces/Translation.md`, using unmodded in-game wording and official weapon names.'
            '- Each article credits its forum author and carries a translation notice. CC BY-NC-SA 3.0 applies to the forum contribution text only.'
            ''
            'Produced by `scripts/content/announcements-daily.ps1`.'
        )
        Set-Content -LiteralPath "$batchDir/README.md" -Value $batchNotes -Encoding utf8

        $tests = Invoke-Native node @('--test', 'test/announcements-intake.test.mjs', 'test/wp5-announcements.test.mjs') -ReportExit
        $testResult = if ($tests.Code -eq 0) { '通過' } else { "失敗（exit $($tests.Code)）" }
        Write-Host "Announcement tests: $testResult"
        if ($check.Code -ne 0 -and $gateErrors.Count -eq 0) {
            $gateErrors += "ERROR check exited with code $($check.Code)."
        }
        if ($build.Code -ne 0) { $gateErrors += "ERROR build exited with code $($build.Code)." }
        if ($tests.Code -ne 0) { $gateErrors += "ERROR announcement tests exited with code $($tests.Code)." }
        $passed = $build.Code -eq 0 -and $check.Code -eq 0 -and $gateErrors.Count -eq 0 -and $tests.Code -eq 0
        $result = if ($passed) { 0 } else { 2 }
        if ($DryRun) { return $result }

        $count = $plan.articles.Count
        $null = Invoke-Native git @('switch', '-c', $branch)
        $null = Invoke-Native git @('add', '--', $batchDir)
        $null = Invoke-Native git @('commit', '--only', '-m', "announcements: add $count Traditional Chinese official announcements ($Batch)",
            '-m', "Generated-by: announcements-daily.ps1 (codex $Model)", '--', $batchDir)
        $null = Invoke-Native git @('push', '--set-upstream', 'origin', $branch)
        $null = Invoke-Native gh @('label', 'create', 'auto-announcements', '--repo', $repository, '--force')
        $null = Invoke-Native gh @('label', 'create', 'announcements-needs-review', '--repo', $repository, '--force')

        $body = @(
            '| 日期 | 官方論壇公告 |'
            '|---|---|'
            foreach ($row in $articleRows) {
                '| {0} | [{1}]({2}) |' -f $row.CreatedAt.Substring(0, 10), (Format-MarkdownTitle $row.Post.title), $row.Post.url
            }
            ''
            "測試結果：$testResult"
            ''
            '### 品質檢查警告'
            ''
            if ($gateWarnings.Count) { $gateWarnings | ForEach-Object { "    $_" } } else { '無。' }
            ''
            if ($passed) {
                '沒有人工審查；CI 通過後由 announcements-auto-merge 自動合併並部署'
            } else {
                '### 待修正錯誤'
                ''
                $gateErrors | ForEach-Object { "    $_" }
            }
        )
        $bodyPath = Join-Path $tempDir 'pr-body.md'
        Set-Content -LiteralPath $bodyPath -Value $body -Encoding utf8
        $prArguments = @('pr', 'create', '--repo', $repository, '--base', 'main', '--head', $branch,
            '--title', "公告：新增 $count 篇官方公告繁中翻譯（$Batch）", '--body-file', $bodyPath)
        if ($passed) {
            $prArguments += @('--label', 'auto-announcements')
        } else {
            $prArguments += @('--draft', '--label', 'announcements-needs-review')
        }
        $null = Invoke-Native gh $prArguments
        return $result
    } finally {
        if ($locationPushed) { Pop-Location }
        try {
            if ($worktreeAdded) {
                if ($DryRun) { Write-Host "Dry run worktree retained: $worktree" }
                else { $null = Invoke-Native git @('-C', $RepoPath, 'worktree', 'remove', '--force', $worktree) }
            }
        } finally {
            if ($tempDir) {
                $tempItem = Get-Item -LiteralPath $tempDir
                if ($tempItem.Parent.FullName.TrimEnd('\', '/') -ne $tempRoot -or
                    ($tempItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                    throw "Cannot safely clean up temporary directory '$tempDir'."
                }
                Remove-Item -LiteralPath $tempItem.FullName -Recurse -Force
            }
        }
    }
}

$null = New-Item -ItemType Directory -Path $LogDir -Force
$lock = Enter-RunnerLock (Join-Path $LogDir 'announcements.lock')
if ($null -eq $lock) {
    Write-Host 'Another announcement runner is active.'
    exit 0
}
try {
    $null = Start-Transcript -LiteralPath (Join-Path $LogDir "announcements-$stamp.log") -NoClobber
    try {
        $exitCode = Invoke-Daily
    } catch {
        Write-Host "ERROR $($_.Exception.Message)"
        throw
    } finally {
        $null = Stop-Transcript
        foreach ($pattern in 'announcements-*.log', 'codex-*-announcements-*-r*.log') {
            Get-ChildItem -LiteralPath $LogDir -File -Filter $pattern |
                Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip 60 | Remove-Item
        }
    }
} finally {
    try { $lock.SetLength(0) } finally { $lock.Dispose() }
}
exit $exitCode
