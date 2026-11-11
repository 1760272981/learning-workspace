import json, urllib.request, time, sys
from websocket import create_connection

tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5).read().decode())
page = next(t for t in tabs if t.get("type") == "page")
ws = create_connection(page["webSocketDebuggerUrl"], timeout=15, suppress_origin=True)
mid = 0
def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    return mid

def pump(seconds):
    end = time.time() + seconds
    events = []
    ws.settimeout(0.5)
    while time.time() < end:
        try:
            m = json.loads(ws.recv())
        except Exception:
            continue
        if m.get("method") == "Runtime.consoleAPICalled":
            t = m["params"].get("type")
            if t in ("error", "warning"):
                txt = " ".join(a.get("value", a.get("description", "")) for a in m["params"].get("args", []))
                events.append((t, txt[:300]))
        elif m.get("method") == "Runtime.exceptionThrown":
            d = m["params"].get("exceptionDetails", {})
            events.append(("exception", json.dumps(d.get("exception", {}).get("description", d.get("text", "")))[:300]))
    return events

send("Runtime.enable")
send("Page.enable")
send("Page.reload", {"ignoreCache": True})
errs = pump(4.0)
# interact: click first node to surface any runtime error in detail path
send("Runtime.evaluate", {"expression": "document.querySelectorAll('.tree-node')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))"})
errs += pump(1.5)
print("CONSOLE_ISSUES:", len(errs))
for t, txt in errs:
    print(" -", t, txt)
ws.close()