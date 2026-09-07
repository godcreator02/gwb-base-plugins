"""自检的靶子：起得来就打一行 JSON 走人。

它替这条路上的每一环签字——venv 建出来了、入口点垫片生成了、参数原样到达、
stdout 收得回来、中文不乱码。

**stdout 只放 JSON**：那是数据面。要说的话往 stderr 写。
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    payload = {
        "ok": True,
        "from": "gwb-py-cli",
        "argv": sys.argv[1:],
        "python": sys.version.split()[0],
        # 装在哪个 venv 里——实机验收时一眼看出用的是不是那份 venv
        "prefix": sys.prefix,
        # 编码这条专门留着：Windows 上没配 PYTHONUTF8 的话这儿会露馅
        "encoding": sys.stdout.encoding,
        "中文": "没乱码就对了",
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
