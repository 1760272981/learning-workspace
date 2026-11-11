import json, urllib.request, sys
from websocket import create_connection

def http(path):
    with urllib.request.urlopen("http://127.0.0.1:9222" + path, timeout=5) as r:
        return json.loads(r.read().decode())

ver = http("/json/version")
tabs = http("/json/list")
page = next((t for t in tabs if t.get("type") == "page"), None)
if not page:
    print("NO_PAGE"); sys.exit(1)
tid = page["id"]

# Browser-level: bring window to normal (not minimized) so rAF runs at full rate
bws = create_connection(ver["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
mid = 0
def bsend(method, params=None):
    global mid
    mid += 1
    bws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        m = json.loads(bws.recv())
        if m.get("id") == mid:
            return m

w = bsend("Browser.getWindowForTarget", {"targetId": tid})
wid = w.get("result", {}).get("windowId")
if wid:
    bounds = {"windowState": "normal"}
    if len(sys.argv) >= 3:
        bounds = {"left": 0, "top": 0, "width": int(sys.argv[1]), "height": int(sys.argv[2]), "windowState": "normal"}
    bsend("Browser.setWindowBounds", {"windowId": wid, "bounds": bounds})
bws.close()

# Page-level: emulate focus + active lifecycle so animations are not throttled
pws = create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
pid = 0
def psend(method, params=None):
    global pid
    pid += 1
    pws.send(json.dumps({"id": pid, "method": method, "params": params or {}}))
    while True:
        m = json.loads(pws.recv())
        if m.get("id") == pid:
            return m

psend("Page.enable")
psend("Emulation.setFocusEmulationEnabled", {"enabled": True})
psend("Page.setWebLifecycleState", {"state": "active"})
pws.close()
print("ACTIVATED", tid)