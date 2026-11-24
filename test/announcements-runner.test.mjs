import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const content = new URL('../scripts/content/', import.meta.url);
const runnerPath = new URL('announcements-daily.ps1', content);
const registerPath = new URL('register-announcements-task.ps1', content);
const runner = readFileSync(runnerPath, 'utf8');
const prompt = readFileSync(new URL('announcements-translate-prompt.md', content), 'utf8');
const register = readFileSync(registerPath, 'utf8');

// Scenario: inspect the runner parameters and Codex invocation without executing the daily job.
// Purpose: protect the supported scheduling controls and the default translation configuration.
test('UnitT10_daily_runner_exposes_the_scheduling_batch_and_translation_options', () => {
  const parameters = runner.split(/\r?\n\)/, 1)[0];
  for (const name of [
    'RepoPath', 'WorktreeRoot', 'ModsRepoPath', 'LogDir', 'Model', 'Effort',
    'MaxFixRounds', 'CodexTimeoutMinutes', 'DryRun', 'Batch', 'Topics',
  ]) {
    assert.match(parameters, new RegExp(`\\$${name}\\b`, 'i'));
  }
  assert.match(parameters, /\$Model = 'gpt-5\.6-sol'/);
  assert.match(parameters, /\$Effort = 'medium'/);
  assert.match(runner, /Get-Content -LiteralPath \$PromptPath -Raw -Encoding utf8\s*\|\s*& codex exec\b[^\r\n]*\s-C \$Worktree - 2>&1/);
  assert.doesNotMatch(runner, /\b(?:npm|codex)\.cmd\b/i);
  assert.match(runner, /foreach \(\$requiredCommand in 'git', 'node', 'npm', 'gh', 'codex'\) \{[\s\S]*?Get-Command \$requiredCommand -CommandType Application -ErrorAction SilentlyContinue\s*\|\s*Select-Object -First 1[\s\S]*?Required command '\$requiredCommand' was not found on PATH\./);
  assert.match(runner, /WaitForExit\(\$CodexTimeoutMinutes \* 60000\)/);
  assert.match(runner, /\$process\.Kill\(\$true\)/);
  assert.match(parameters, /\[ValidatePattern\('\^\[0-9\]\+\(,\[0-9\]\+\)\*\$'\)\]\[string\]\$Topics/);
});

// Scenario: A manual backfill supplies explicit topic IDs to the daily runner.
// Purpose: ensure the runner bypasses scan selection while retaining branch and batch guards.
test('UnitT20_daily_runner_uses_explicit_topics_without_skipping_safety_checks', () => {
  assert.match(runner, /if \(\$Topics\) \{\s*\$topicIds = \$Topics\s*\} else \{[\s\S]*?'scan', '--json'/);
  assert.match(runner, /if \(\$Topics\)[\s\S]*?refs\/heads\/\$branch[\s\S]*?ls-tree[\s\S]*?\$batchDir/);
});

// Scenario: The runner successfully acquires the exclusive file handle despite stale PID text in the file.
// Purpose: make the FileShare.None handle the sole lock authority after a successful open.
test('UnitT30_daily_runner_does_not_consult_the_previous_lock_pid', () => {
  const lock = /function Enter-RunnerLock \{([\s\S]*?)\n\}/.exec(runner)?.[1] ?? '';
  assert.doesNotMatch(lock, /Get-Process|previousOwner|StreamReader/);
  assert.match(lock, /SetLength\(0\)[\s\S]*?GetBytes\(\[string\]\$PID\)/);
  assert.match(lock, /\$win32Code -in 32, 33\) \{ return \}/);
});

test('daily runner limits publication to the batch and enables auto-merge only on success', () => {
  assert.doesNotMatch(runner, /\bpush\b[^\r\n]*(?:--force(?:-with-lease)?\b|(?:\s|')-f(?:\s|'|$))/i);
  const addCalls = runner.match(/Invoke-Native git @\('add'[^\r\n]*/g);
  assert.deepEqual(addCalls, ["Invoke-Native git @('add', '--', $batchDir)"]);
  assert.match(runner, /Invoke-Native git @\('commit', '--only',[\s\S]*?'--', \$batchDir\)/);
  assert.match(runner, /\$passed = \$build\.Code -eq 0 -and \$check\.Code -eq 0 -and \$gateErrors\.Count -eq 0 -and \$tests\.Code -eq 0/);
  assert.match(runner, /if \(\$DryRun\) \{ return \$result \}[\s\S]*?'switch', '-c', \$branch/);
  assert.match(runner, /if \(\$passed\) \{\s*\$prArguments \+= @\('--label', 'auto-announcements'\)\s*\} else \{\s*\$prArguments \+= @\('--draft', '--label', 'announcements-needs-review'\)\s*\}\s*\$null = Invoke-Native gh \$prArguments/);
  assert.equal([...runner.matchAll(/'--label', 'auto-announcements'/g)].length, 1);
});

test('translation prompt retains the batch inputs, attribution and terminology', () => {
  for (const name of ['BATCH_DIR', 'OUTLINE_DIR', 'GLOSSARY_PATH', 'ARTICLES', 'GATE_ERRORS']) {
    assert.ok(prompt.includes(`{{${name}}}`), `missing ${name} placeholder`);
  }
  assert.ok(prompt.includes('**來源與授權：**原文作者 <author>，首帖發布於 <yyyy-MM-dd>。本文為繁體中文翻譯與改作，依 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 分享；授權範圍僅及該論壇文章貢獻，不延伸至遊戲或商標。'));
  for (const [source, translation] of [
    ['Sisters Novitiate', '戰鬥修女'], ['Adepta Sororitas', '修女會'],
    ['fully ordained Sisters', '正式修女'], ['Novitiate Blade', '見習修女劍'],
    ['Warband', '打擊小隊'], ['Mourningstar', '哀星號'],
    ['Ordo Dockets', '帝國幣（Ordo Dockets）'], ['Expeditions', '遠征'],
    ['Tech-Remnants', '科技殘骸'], ['Darktide', '《Darktide》'],
  ]) {
    assert.ok(prompt.includes(`| ${source} | ${translation}`), `missing mapping for ${source}`);
  }
  assert.match(prompt, /term-rules\.json/);
  assert.match(prompt, /node scripts\/content\/announcements-intake\.mjs check --batch <batch>/);
});

test('registration configures the daily interactive Windows task', () => {
  assert.match(register, /'DarkTide-Announcements-Daily'/);
  assert.match(register, /New-ScheduledTaskTrigger -Daily -At \$at/);
  assert.match(register, /'10:30'/);
  assert.match(register, /-StartWhenAvailable -ExecutionTimeLimit \(New-TimeSpan -Hours 3\) -MultipleInstances IgnoreNew/);
  assert.match(register, /-LogonType Interactive/);
  assert.match(register, /SupportsShouldProcess/);
  assert.match(register, /show 'origin\/main:scripts\/content\/announcements-daily\.ps1'/);
});

test('both scripts parse in PowerShell 7 when pwsh is available', (t) => {
  const parsed = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `
    $failed = $false
    foreach ($path in $env:ANNOUNCEMENTS_RUNNER_SCRIPT, $env:ANNOUNCEMENTS_REGISTER_SCRIPT) {
      $tokens = $null
      $errors = $null
      $null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
      foreach ($errorItem in $errors) {
        [Console]::Error.WriteLine("\${path}:$($errorItem.Extent.StartLineNumber): $($errorItem.Message)")
        $failed = $true
      }
    }
    if ($failed) { exit 1 }
  `], {
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      ANNOUNCEMENTS_RUNNER_SCRIPT: fileURLToPath(runnerPath),
      ANNOUNCEMENTS_REGISTER_SCRIPT: fileURLToPath(registerPath),
    },
  });
  if (parsed.error?.code === 'ENOENT') {
    t.skip('pwsh is unavailable on PATH');
    return;
  }
  assert.ifError(parsed.error);
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
});
