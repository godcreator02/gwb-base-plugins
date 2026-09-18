param(
  [Parameter(Mandatory)] [string] $Pnpm,
  [Parameter(Mandatory)] [string] $Work,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null

function HashText([string] $s) {
  [BitConverter]::ToString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).Replace('-', '').Substring(0, 12)
}
function HashFile([string] $f) { if (Test-Path $f) { (Get-FileHash $f -Algorithm SHA256).Hash.Substring(0, 12) } else { '-' } }

# 顶层 node_modules（含 @scope 下一层、junction 指向）与 .pnpm 目录名单各取一个指纹
function Snap([string] $dir) {
  $nm = "$dir/node_modules"
  $top = if (Test-Path $nm) {
    (Get-ChildItem $nm -Recurse -Depth 1 -Force | Where-Object { $_.FullName -notmatch '\\\.pnpm' } |
      ForEach-Object { "$($_.FullName.Substring($nm.Length))=>$($_.Target)" } | Sort-Object) -join ','
  } else { '' }
  $store = if (Test-Path "$nm/.pnpm") { (Get-ChildItem "$nm/.pnpm" -Directory -Name | Sort-Object) -join ',' } else { '' }
  [pscustomobject]@{
    pkg   = HashFile "$dir/package.json"
    lock  = HashFile "$dir/pnpm-lock.yaml"
    top   = HashText $top
    pnpmd = HashText $store
    deps  = (Get-Content "$dir/package.json" -Raw | ConvertFrom-Json).dependencies | ConvertTo-Json -Compress
  }
}

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
  $before = Snap $dir
  Push-Location $dir
  $stdout = "$Out/$label.stdout.txt"; $stderr = "$Out/$label.stderr.txt"
  $p = Start-Process -FilePath $Pnpm -ArgumentList $pnpmArgs -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Pop-Location
  $after = Snap $dir
  $line = [ordered]@{
    label = $label; args = ($pnpmArgs -join ' '); exit = $p.ExitCode
    pkgChanged = $before.pkg -ne $after.pkg; lockChanged = $before.lock -ne $after.lock
    topChanged = $before.top -ne $after.top; pnpmDirChanged = $before.pnpmd -ne $after.pnpmd
    depsAfter = $after.deps
  }
  ($line | ConvertTo-Json -Compress) | Add-Content "$Out/summary.jsonl"
  $line
}

Remove-Item "$Out/summary.jsonl" -ErrorAction SilentlyContinue

# 冲突路：外壳钉 0.7.2，再装要 shell >=0.8.0 的件
$old = @{ '@godcreator/gwb-shell' = '0.7.2' }
$d = Fresh 'a-flag' $old;        Step $d 'a-flag' @('add', '@godcreator/gwb-glm-quota', '--strict-peer-dependencies')
$d = Fresh 'b-config-true' $old; Step $d 'b-config-true' @('add', '@godcreator/gwb-glm-quota', '--config.strict-peer-dependencies=true')
$d = Fresh 'c-config-false' $old; Step $d 'c-config-false' @('add', '@godcreator/gwb-glm-quota', '--config.strict-peer-dependencies=false')
$d = Fresh 'd-noflag' $old;      Step $d 'd-noflag' @('add', '@godcreator/gwb-glm-quota')
$d = Fresh 'e-no-strict' $old;   Step $d 'e-no-strict' @('add', '@godcreator/gwb-glm-quota', '--no-strict-peer-dependencies')
# 已带冲突的 home（d-noflag 的终态）里严格装一个与冲突无关的包
Step (Join-Path $Work 'd-noflag') 'f-unrelated-strict' @('add', '@godcreator/gwb-data', '--config.strict-peer-dependencies=true')
# 只解析不落 node_modules：严格失败时锁文件写没写
$d = Fresh 'i-lockonly-strict' $old; Step $d 'i-lockonly-strict' @('add', '@godcreator/gwb-glm-quota', '--lockfile-only', '--config.strict-peer-dependencies=true')
# 严格失败后的 home 再跑一趟普通 install，半截能不能自己收回去
Step (Join-Path $Work 'a-flag') 'j-install-after-fail' @('install')
# 开发版路：外壳 0.9.0 + 下游，把外壳换成它的 dev 号
$new = @{ '@godcreator/gwb-shell' = '0.9.0'; '@godcreator/gwb-glm-quota' = 'latest' }
$d = Fresh 'g-dev-strict' $new;  Step $d 'g-dev-strict' @('add', '@godcreator/gwb-shell@0.9.1-dev.202609181108', '--config.strict-peer-dependencies=true')
$d = Fresh 'h-dev-loose' $new;   Step $d 'h-dev-loose' @('add', '@godcreator/gwb-shell@0.9.1-dev.202609181108', '--config.strict-peer-dependencies=false')

# 迁成 ^ 之后：本地造两个下游，peer 分别写 ^0.9.0 与 ^0.8.0
function Downstream([string] $name, [string] $range) {
  $dir = Join-Path $Work "_$name"
  New-Item -ItemType Directory -Force $dir | Out-Null
  @{ name = $name; version = '1.0.0'; peerDependencies = @{ '@godcreator/gwb-shell' = $range } } | ConvertTo-Json | Set-Content "$dir/package.json"
  "file:$($dir -replace '\\', '/')"
}
$ds09 = Downstream 'probe-ds-caret09' '^0.9.0'
$ds08 = Downstream 'probe-ds-caret08' '^0.8.0'
$caret = @{ '@godcreator/gwb-shell' = '0.9.0'; 'probe-ds-caret09' = $ds09 }
$d = Fresh 'k-caret-dev-strict' $caret; Step $d 'k-caret-dev-strict' @('add', '@godcreator/gwb-shell@0.9.1-dev.202609181108', '--config.strict-peer-dependencies=true')
$d = Fresh 'l-caret-dev-loose' $caret;  Step $d 'l-caret-dev-loose' @('add', '@godcreator/gwb-shell@0.9.1-dev.202609181108', '--config.strict-peer-dependencies=false')
# 上游出了新线、下游还钉在旧线：一键更新那一趟
$behind = @{ '@godcreator/gwb-shell' = '0.8.0'; 'probe-ds-caret08' = $ds08 }
$d = Fresh 'm-caret-breaking-strict' $behind; Step $d 'm-caret-breaking-strict' @('add', '@godcreator/gwb-shell@0.9.0', '--config.strict-peer-dependencies=true')

# 破坏线的开发版（上游仓里已抬到 0.10，dev 号 0.10.0-dev.x）对 ^0.9.0 的下游：全用本地包造
function LocalPkg([string] $name, [string] $version, [hashtable] $peers) {
  $dir = Join-Path $Work "_$name@$version"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $manifest = @{ name = $name; version = $version }
  if ($peers) { $manifest.peerDependencies = $peers }
  $manifest | ConvertTo-Json | Set-Content "$dir/package.json"
  "file:$($dir -replace '\\', '/')"
}
$up09 = LocalPkg 'probe-up' '0.9.0' $null
$up10dev = LocalPkg 'probe-up' '0.10.0-dev.1' $null
$dsUp = LocalPkg 'probe-ds-up' '1.0.0' @{ 'probe-up' = '^0.9.0' }
$line = @{ 'probe-up' = $up09; 'probe-ds-up' = $dsUp }
$d = Fresh 'n-breaking-dev-strict' $line; Step $d 'n-breaking-dev-strict' @('add', $up10dev, '--config.strict-peer-dependencies=true')
$d = Fresh 'o-breaking-dev-loose' $line;  Step $d 'o-breaking-dev-loose' @('add', $up10dev, '--config.strict-peer-dependencies=false')

# 预检：把 home 的 package.json 与 pnpm-lock.yaml 抄进一个空目录，在那儿只解析、严格
function Preflight([string] $target, [string] $label, [string[]] $specs) {
  $pre = Join-Path $Work "_pre-$label"
  if (Test-Path $pre) { Remove-Item -Recurse -Force $pre }
  New-Item -ItemType Directory $pre | Out-Null
  Copy-Item "$target/package.json", "$target/pnpm-lock.yaml" $pre
  $before = Snap $target
  $r = Step $pre "$label-pre" (@('add') + $specs + @('--lockfile-only', '--config.strict-peer-dependencies=true'))
  $after = Snap $target
  ([ordered]@{ label = "$label-home"; homeUntouched = ($before | ConvertTo-Json) -eq ($after | ConvertTo-Json) } | ConvertTo-Json -Compress) | Add-Content "$Out/summary.jsonl"
  $r
}
$d = Fresh 'p-preflight-conflict' $old; Preflight $d 'p-preflight-conflict' @('@godcreator/gwb-glm-quota')
$d = Fresh 'q-preflight-ok' @{ '@godcreator/gwb-shell' = '0.9.0' }; Preflight $d 'q-preflight-ok' @('@godcreator/gwb-glm-quota')

# 命令行压得过项目级配置吗：目录里放一份 strictPeerDependencies: true，再显式给 =false
$d = Fresh 'r-override-true' $old; 'strictPeerDependencies: true' | Set-Content "$d/pnpm-workspace.yaml"
Step $d 'r-override-noflag' @('add', '@godcreator/gwb-glm-quota', '--lockfile-only')
$d = Fresh 'r-override-false' $old; 'strictPeerDependencies: true' | Set-Content "$d/pnpm-workspace.yaml"
Step $d 'r-override-config-false' @('add', '@godcreator/gwb-glm-quota', '--lockfile-only', '--config.strict-peer-dependencies=false')

# 目录里只写 strictPeerDependencies: true 的 pnpm-workspace.yaml 是逐项覆盖，用户级配置照读
Push-Location (Join-Path $Work 'r-override-true')
"strictPeerDependencies=$(& $Pnpm config get strictPeerDependencies)`nminimumReleaseAgeExclude=$(& $Pnpm config get minimumReleaseAgeExclude)" | Set-Content "$Out/s-config-merge.txt"
Pop-Location
