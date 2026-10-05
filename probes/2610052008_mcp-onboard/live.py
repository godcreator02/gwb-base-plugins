"""Disposable-home evidence; no real client configuration or credential output."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.error
import urllib.request

HOME = "mcp-onboard-2610052008"
directory = Path(os.environ["APPDATA"]) / "gwb-kernel/homes" / HOME
url = json.loads((directory / "runtime.json").read_text())["mcp"]["url"]
def secrets():
    return json.loads((directory / "credentials.json").read_text())["sections"]["mcp"]
main_token = secrets()["token"]["value"]
checks = []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)

def rpc(method, params, token=main_token):
    request = urllib.request.Request(url, json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(), headers={"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json, text/event-stream"})
    with urllib.request.urlopen(request, timeout=10) as response:
        text=response.read().decode()
    messages=[json.loads(line[5:].strip()) for line in text.splitlines() if line.startswith("data:")]
    return (messages[0] if messages else json.loads(text))["result"]

def tool(name,args,token=main_token):
    result=rpc("tools/call",{"name":name,"arguments":args},token)
    return json.loads(result["content"][0]["text"])

def command(name,args=None):
    return tool("run",{"command":name,"args":args or {}})

index=tool("index",{})
check("index target home",index["home"]==HOME)
commands=[name for row in index["commands"] for name in row["names"]]
check("issue listed", "mcp.client.issue" in commands)
check("configure removed", "mcp.client.configure" not in commands)
info=command("mcp.info")
check("info hides raw credential",main_token not in json.dumps(info))
issued=command("mcp.client.issue",{"expiresInSeconds":60})["data"]
token=next(row["token"] for row in json.loads(secrets()["client-tokens"]["value"]) if row["id"]==issued["id"])
check("issue only status",set(issued)=={"id","expiresAt"} and token not in json.dumps(issued))
check("temporary authenticates",tool("index",{},token)["home"]==HOME)
check("list contains id",any(row["id"]==issued["id"] for row in command("mcp.client.list")["data"]))
with tempfile.TemporaryDirectory(prefix="onboard-fixtures-") as temporary:
    root=Path(temporary)
    for name,keys in [("claude",["mcpServers"]),("zcode",["mcp","servers"]),("kimi",["mcpServers"])]:
        file=root/(name+".json")
        original={"preserved":{"unrelated":True}}
        document=json.loads(json.dumps(original))
        target=document
        for key in keys:
            target=target.setdefault(key,{})
        target["other"]={"url":"http://unrelated.example"}
        target["gwb"]={"url":url,"headers":{"Authorization":"Bearer "+token}}
        if name!="kimi": target["gwb"]["type"]="http"
        file.write_text(json.dumps(document))
        restored=json.loads(file.read_text())
        check(name+" unrelated settings preserved",restored["preserved"]==original["preserved"])
        for key in keys: restored=restored[key]
        check(name+" auth matches target home",tool("index",{},restored["gwb"]["headers"]["Authorization"][7:])["home"]==HOME)
    file=root/"codex.toml"
    original='model = "fixture"\n# preserved comment\n'
    file.write_text(original+'[mcp_servers.gwb]\nurl = '+json.dumps(url)+'\n[mcp_servers.gwb.http_headers]\nAuthorization = '+json.dumps("Bearer "+token)+'\n')
    document=tomllib.loads(file.read_text())
    check("codex parses and preserves",document["model"]=="fixture" and file.read_text().startswith(original))
    check("codex auth matches target home",tool("index",{},document["mcp_servers"]["gwb"]["http_headers"]["Authorization"][7:])["home"]==HOME)
revoked=command("mcp.client.revoke",{"id":issued["id"]})["data"]
check("revoke acknowledged",revoked["revoked"])
try:
    tool("index",{},token)
except urllib.error.HTTPError as error:
    check("revoked returns 401",error.code==401)
else:
    raise AssertionError("revoked still authorized")
short=command("mcp.client.issue",{"expiresInSeconds":1})["data"]
short_token=next(row["token"] for row in json.loads(secrets()["client-tokens"]["value"]) if row["id"]==short["id"])
time.sleep(1.1)
try:
    tool("index",{},short_token)
except urllib.error.HTTPError as error:
    check("expired returns 401",error.code==401)
else:
    raise AssertionError("expired still authorized")
check("expired flag",next(row["expired"] for row in command("mcp.client.list")["data"] if row["id"]==short["id"]))
command("mcp.client.revoke",{"id":short["id"]})
check("main remains valid",tool("index",{})["home"]==HOME)
onboard=command("skill.read",{"name":"onboard","file":"references/mcp-clients.md"})
check("skill attachment shipped",onboard["ok"] and "mcp.servers.gwb" in onboard["data"]["text"] and "mcp_servers.gwb" in onboard["data"]["text"])
hook=Path("D:/unitfolders/evew5-gwbapps/gwb-agent-hooks-skills/hooks/fetch-gwb-instructions.py")
process=subprocess.run([sys.executable,str(hook),"--home",HOME],capture_output=True,text=True,encoding="utf-8")
check("hook authenticated to selected home",process.returncode==0 and HOME in json.loads(process.stdout)["hookSpecificOutput"]["additionalContext"])
check("hook output contains no token",main_token not in process.stdout and token not in process.stdout and not process.stderr)
plugins=command("plugin-manager.list")["data"]
check("live credential store contains no temporary entries",json.loads(secrets()["client-tokens"]["value"])==[])
evidence={"home":HOME,"checks":checks,"count":len(checks),"defaultTouched":False,"realClientConfigurationsTouched":False}
destination=Path(__file__).parent/"runs/01-live.json"
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(evidence,ensure_ascii=False))
