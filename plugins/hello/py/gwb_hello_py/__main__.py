"""这个件的 python CLI。

跟 node 那半（`src/cli.ts`）做同一件事、各用各的语言，摆在一起就能看出这条链
两边是对称的：读参数、打一行 JSON、`--fail` 时退出码 1。

**stdout 只放 JSON**：那是数据面。要说的话往 stderr 写。

手上要单独跑一趟：`<包根>/py/.venv/Scripts/gwb-hello-py.exe --名 值`
"""

from __future__ import annotations

import json
import os
import sys


def main() -> int:
    argv = sys.argv[1:]
    flags = [a[2:] for a in argv if a.startswith("--")]
    rest = [a for a in argv if not a.startswith("--")]

    # 故意失败那一路：验的是回执里的 exitCode 真能带回界面
    if "fail" in flags:
        sys.stderr.write("[hello-py] 这是故意失败的那一路,stderr 与退出码都该原样回到界面\n")
        return 1

    payload = {
        "ok": True,
        "from": "gwb-hello",
        "lang": "python",
        "runtime": sys.version.split()[0],
        "args": rest,
        "flags": flags,
        "cwd": os.getcwd(),
        # 装在哪个 venv 里——实机一眼看出用的是不是件包根下那份
        "prefix": sys.prefix,
        "encoding": sys.stdout.encoding,
        "note": "中文没乱码就对了",
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
