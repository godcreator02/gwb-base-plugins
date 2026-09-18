param(
  [Parameter(Mandatory)] [string] $Pnpm,
  [Parameter(Mandatory)] [string] $Work,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
Remove-Item "$Out/summary.jsonl" -ErrorAction SilentlyContinue

function Fresh([string] $name, [hashtable] $deps) {
  $dir = Join-Path $Work $name
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory $dir | Out-Null
  @{ name = "probe-$name"; private = $true; dependencies = $deps } | ConvertTo-Json | Set-Content "$dir/package.json"
  Push-Location $dir
  & $Pnpm install *> "$Out/$name.00-install.txt"
  Pop-Location
  $dir
}

function Step([string] $dir, [string] $label, [string[]] $pnpmArgs) {
  Push-Location $dir
  $stdout = "$Out/$label.stdout.txt"; $stderr = "$Out/$label.stderr.txt"
  $p = Start-Process -FilePath $Pnpm -ArgumentList $pnpmArgs -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Pop-Location
  $line = [ordered]@{ label = $label; args = ($pnpmArgs -join ' '); exit = $p.ExitCode; warnLine = [bool](Select-String -Path $stdout -Pattern 'Issues with peer dependencies' -Quiet) }
  ($line | ConvertTo-Json -Compress) | Add-Content "$Out/summary.jsonl"
  $line
}

# 一趟不带任何 strict 参数的 add，随后 peers check 文字版与 --json 版各一趟
function Scenario([string] $name, [hashtable] $deps, [string[]] $specs) {
  $d = Fresh $name $deps
  Step $d "$name.1-add" (@('add') + $specs)
  Step $d "$name.2-peers" @('peers', 'check')
  Step $d "$name.3-peers-json" @('peers', 'check', '--json')
}

# 冲突：外壳钉 0.7.2，再装要 shell >=0.8.0 的件（install 那条路）
Scenario 'a-conflict' @{ '@godcreator/gwb-shell' = '0.7.2' } @('@godcreator/gwb-glm-quota')
# 不冲突：外壳在 0.9.0
Scenario 'b-clean' @{ '@godcreator/gwb-shell' = '0.9.0' } @('@godcreator/gwb-glm-quota')
# 已带冲突的 home 里装一个不相干的包：WARN 与 peers check 说的是 home 整体
$d = Join-Path $Work 'a-conflict'
Step $d 'c-unrelated.1-add' @('add', '@godcreator/gwb-data')
Step $d 'c-unrelated.2-peers-json' @('peers', 'check', '--json')

# update-all 那条路：一趟多个精确版本；上游出了新线、下游还钉旧线
function LocalPkg([string] $name, [string] $version, [hashtable] $peers) {
  $dir = Join-Path $Work "_$name@$version"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $manifest = @{ name = $name; version = $version }
  if ($peers) { $manifest.peerDependencies = $peers }
  $manifest | ConvertTo-Json | Set-Content "$dir/package.json"
  "file:$($dir -replace '\\', '/')"
}
$up09 = LocalPkg 'probe-up' '0.9.0' $null
$up10 = LocalPkg 'probe-up' '0.10.0' $null
$other = LocalPkg 'probe-other' '1.1.0' $null
$other0 = LocalPkg 'probe-other' '1.0.0' $null
$ds = LocalPkg 'probe-ds' '1.0.0' @{ 'probe-up' = '^0.9.0' }
Scenario 'd-update-all' @{ 'probe-up' = $up09; 'probe-ds' = $ds; 'probe-other' = $other0 } @($up10, $other)

# missing 那一格长什么样：peer 没装、也不让 pnpm 自动补
$d = Fresh 'e-missing' @{}
Step $d 'e-missing.1-add' @('add', '@godcreator/gwb-glm-quota', '--config.auto-install-peers=false')
Step $d 'e-missing.3-peers-json' @('peers', 'check', '--json')
