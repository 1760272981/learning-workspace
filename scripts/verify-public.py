#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verify the published site renders for a logged-out (cookie-free) visitor.

Creates an isolated CDP browser context (no shared cookies/storage), navigates
to the public URL, checks the app mounted and the knowledge tree rendered,
captures a screenshot, then disposes the context. This is the real acceptance
action for "未登录访客能打开作品链接".
"""
import base64
import sys
import time
from pathlib import Path

SKILL_SCRIPTS = r"C:/Users/Admin/.qoder-cn/skills/browser-automation-cdp/scripts"
sys.path.insert(0, SKILL_SCRIPTS)
from cdp import CDPClient, CDPError  # noqa: E402

URL = "https://learning-workspace-v5d3qx7uw3a.qoder.zone"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("evidence/deploy-public-1440.png")
OUT.parent.mkdir(parents=True, exist_ok=True)

browser = CDPClient(timeout=20).connect_browser()
ctx = None
target = None
page = None
try:
    ctx = browser.send("Target.createBrowserContext")["browserContextId"]
    target = browser.send(
        "Target.createTarget", {"url": "about:blank", "browserContextId": ctx}
    )["targetId"]
    page = CDPClient(timeout=25).connect_page(target)
    page.send("Runtime.enable")
    page.send(
        "Emulation.setDeviceMetricsOverride",
        {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False},
    )
    loaded = page.navigate(URL, timeout=30)

    mounted = False
    deadline = time.time() + 20
    while time.time() < deadline:
        n = page.evaluate(
            "document.querySelector('#root') ? document.querySelector('#root').childElementCount : -1"
        ).get("value")
        if isinstance(n, (int, float)) and n > 0:
            mounted = True
            break
        time.sleep(0.5)
    time.sleep(2.0)

    info = page.evaluate(
        """(function(){
      var root=document.querySelector('#root');
      var svg=document.querySelector('svg');
      var nodes=document.querySelectorAll('.tree-node');
      var txt=document.body.innerText||'';
      return JSON.stringify({
        title:document.title,
        url:location.href,
        rootChildren:root?root.childElementCount:-1,
        hasSvg:!!svg,
        fruitNodes:nodes.length,
        hasDemoBadge:txt.indexOf('演示数据')>=0,
        hasRecordBtn:txt.indexOf('记录知识')>=0,
        bodyLen:txt.length,
        snippet:txt.slice(0,160)
      });
    })()"""
    ).get("value")

    print("LOADED:", loaded)
    print("MOUNTED:", mounted)
    print("INFO:", info)

    shot = page.send("Page.captureScreenshot", {"format": "png"})
    OUT.write_bytes(base64.b64decode(shot["data"]))
    print("SCREENSHOT:", str(OUT.resolve()))
finally:
    for fn in (
        lambda: page.close() if page else None,
        lambda: browser.send("Target.closeTarget", {"targetId": target}) if target else None,
        lambda: browser.send("Target.disposeBrowserContext", {"browserContextId": ctx}) if ctx else None,
        lambda: browser.close(),
    ):
        try:
            fn()
        except Exception:
            pass