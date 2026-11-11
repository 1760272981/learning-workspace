import json, urllib.request, sys
from websocket import create_connection

tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5).read().decode())
page = next(t for t in tabs if t.get("type") == "page")
ws = create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
mid = 0
def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid:
            return m

if len(sys.argv) >= 3 and sys.argv[1] != "clear":
    send("Emulation.setDeviceMetricsOverride", {
        "width": int(sys.argv[1]), "height": int(sys.argv[2]),
        "deviceScaleFactor": 2, "mobile": True,
    })
    send("Emulation.setTouchEmulationEnabled", {"enabled": True})
    send("Emulation.setFocusEmulationEnabled", {"enabled": True})
    print("DEVICE", sys.argv[1], sys.argv[2], flush=True)
    if len(sys.argv) >= 4 and sys.argv[3] == "hold":
        import time
        while True:
            time.sleep(5)
else:
    send("Emulation.clearDeviceMetricsOverride")
    send("Emulation.setTouchEmulationEnabled", {"enabled": False})
    print("DEVICE_CLEARED")
ws.close()