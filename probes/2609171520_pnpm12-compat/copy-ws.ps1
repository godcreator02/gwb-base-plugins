param([string]$Repo, [string]$Dest)
# 把一个仓 HEAD 上的 workspace 清单（全部 package.json、pnpm-workspace.yaml、pnpm-lock.yaml）原样导到 $Dest，不碰工作区
Push-Location $Repo
try {
  $files = git ls-files -- 'package.json' '**/package.json' 'pnpm-workspace.yaml' 'pnpm-lock.yaml' '**/pnpm-lock.yaml' '.npmrc' '**/.npmrc' '.pnpmfile.cjs' '.pnpmfile.mjs'
  foreach ($f in $files) {
    $target = Join-Path $Dest $f
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    $bytes = git show "HEAD:$f"
    [System.IO.File]::WriteAllText($target, (($bytes -join "`n") + "`n"))
    $f
  }
} finally { Pop-Location }
