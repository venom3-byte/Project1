#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

try:
    import pytesseract
    from pytesseract import Output
except Exception:
    pytesseract = None
    Output = None

INTERACTIVE = "button,a,input,textarea,select,[role=button],[role=link],[contenteditable=true]"


class VisionAgent:
    def __init__(self, out_dir="tests/vision-verified", viewport=(1280, 900), headless=True, cdp=None):
        self.out = Path(out_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self.viewport = {"width": int(viewport[0]), "height": int(viewport[1])}
        self.headless = headless
        self.cdp = cdp
        self.pw = self.browser = self.context = self.page = None
        self.console_errors = []
        self.page_errors = []

    def start(self):
        self.pw = sync_playwright().start()
        if self.cdp:
            self.browser = self.pw.chromium.connect_over_cdp(self.cdp)
            if not self.browser.contexts:
                raise RuntimeError("CDP connection has no browser context")
            self.context = self.browser.contexts[0]
            self.page = self.context.pages[-1] if self.context.pages else self.context.new_page()
            self.page.set_viewport_size(self.viewport)
        else:
            self.browser = self.pw.chromium.launch(headless=self.headless)
            self.context = self.browser.new_context(viewport=self.viewport, device_scale_factor=1)
            self.page = self.context.new_page()
        self.page.on("console", self._console)
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        return self

    def _console(self, message):
        if message.type != "error":
            return
        text = message.text
        lowered = text.lower()
        if not any(k in lowered for k in ("token", "authorization", "bearer", "password")):
            self.console_errors.append(text[:1000])

    def goto(self, url):
        self.page.goto(url, wait_until="domcontentloaded", timeout=60000)
        self.page.wait_for_timeout(800)
        return self.page.url

    def set_viewport(self, width, height):
        self.viewport = {"width": int(width), "height": int(height)}
        self.page.set_viewport_size(self.viewport)
        return self.viewport

    def screenshot(self, name="screen.png", full_page=False):
        path = self.out / name
        self.page.screenshot(path=str(path), full_page=full_page)
        return str(path)

    def dom_inventory(self):
        items = self.page.locator(INTERACTIVE).evaluate_all(
            """els => els.map((el, i) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                const visible = !!(r.width && r.height) &&
                  s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
                let text = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
                if (text.length > 120) text = text.slice(0,117) + '...';
                return {
                  index:i, tag:el.tagName.toLowerCase(),
                  id:el.id || '', role:el.getAttribute('role') || '',
                  text, type:el.getAttribute('type') || '',
                  disabled:!!el.disabled, visible,
                  bbox:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}
                };
            })"""
        )
        return [x for x in items if x.get("visible")]

    def ocr(self, image_path):
        if pytesseract is None:
            return []
        try:
            img = cv2.imread(image_path)
            data = pytesseract.image_to_data(img, output_type=Output.DICT, config="--psm 6")
            result = []
            for i, raw in enumerate(data["text"]):
                text = (raw or "").strip()
                conf = float(data["conf"][i]) if data["conf"][i] not in ("", None) else -1
                if text and conf >= 35:
                    result.append({
                        "text": text[:160],
                        "confidence": round(conf, 1),
                        "bbox": {
                            "x": int(data["left"][i]), "y": int(data["top"][i]),
                            "w": int(data["width"][i]), "h": int(data["height"][i])
                        }
                    })
            return result
        except Exception:
            return []

    def analyze(self, image_path, use_ocr=True):
        img = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError(f"Cannot read screenshot: {image_path}")
        h, w = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        black_ratio = float((np.max(img, axis=2) < 18).mean())
        edge_density = float((cv2.Canny(gray, 60, 160) > 0).mean())

        _, threshold = cv2.threshold(gray, 22, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        regions = []
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            area = cw * ch
            if area >= max(200, int(w * h * 0.002)):
                regions.append({"x": x, "y": y, "w": cw, "h": ch, "area": area})
        regions.sort(key=lambda r: r["area"], reverse=True)

        result = {
            "width": w,
            "height": h,
            "black_ratio": round(black_ratio, 4),
            "edge_density": round(edge_density, 4),
            "visual_regions": regions[:60],
            "signals": {
                "possible_blank_or_black_screen": (black_ratio >= 0.965 and edge_density < 0.002),
                "very_low_visual_structure": edge_density <= 0.005,
                "console_errors": len(self.console_errors),
                "page_errors": len(self.page_errors)
            },
            "console_errors": self.console_errors[:20],
            "page_errors": self.page_errors[:20]
        }
        if use_ocr:
            result["ocr"] = self.ocr(image_path)
        return result

    def annotate(self, image_path, inventory, ocr_items=None, name="annotated.png"):
        img = Image.open(image_path).convert("RGB")
        draw = ImageDraw.Draw(img)
        for item in inventory:
            b = item["bbox"]
            if b["w"] < 3 or b["h"] < 3:
                continue
            xy = [b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]]
            draw.rectangle(xy, outline=(60,150,255), width=2)
            label = (item.get("text") or f'#{item["index"]} {item["tag"]}')[:40]
            draw.rectangle([b["x"], max(0,b["y"]-15), b["x"]+max(40,len(label)*6), b["y"]], fill=(20,55,95))
            draw.text((b["x"]+2, max(0,b["y"]-14)), label, fill=(235,245,255))
        for item in ocr_items or []:
            b = item["bbox"]
            draw.rectangle([b["x"],b["y"],b["x"]+b["w"],b["y"]+b["h"]], outline=(255,90,100), width=1)
        out = self.out / name
        img.save(out)
        return str(out)

    def inspect(self, name="vision"):
        shot = self.screenshot(f"{name}.png")
        analysis = self.analyze(shot, use_ocr=True)
        inventory = self.dom_inventory()
        annotated = self.annotate(shot, inventory, analysis.get("ocr", []), f"{name}-annotated.png")
        report = {
            "url": self.page.url,
            "viewport": self.viewport,
            "screenshot": shot,
            "annotated": annotated,
            "interactive": inventory,
            "analysis": analysis
        }
        (self.out / f"{name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return report

    def click_selector(self, selector):
        self.page.locator(selector).first.click(timeout=15000)
        return True

    def click_text(self, text):
        self.page.get_by_text(text, exact=False).first.click(timeout=15000)
        return True

    def click_point(self, x, y):
        self.page.mouse.click(float(x), float(y))
        return True

    def type_text(self, selector, text):
        self.page.locator(selector).fill(text, timeout=15000)
        return True

    def scroll(self, dx=0, dy=700):
        self.page.mouse.wheel(float(dx), float(dy))
        self.page.wait_for_timeout(200)
        return True

    def wait(self, ms=500):
        self.page.wait_for_timeout(int(ms))
        return True

    def close(self):
        try:
            if self.browser and not self.cdp:
                self.browser.close()
        finally:
            if self.pw:
                self.pw.stop()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url")
    ap.add_argument("--cdp")
    ap.add_argument("--out", default="tests/vision-verified")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--name", default="vision")
    ap.add_argument("--action", choices=["inspect","screenshot","click","type","scroll"], default="inspect")
    ap.add_argument("--selector")
    ap.add_argument("--text")
    ap.add_argument("--x", type=float)
    ap.add_argument("--y", type=float)
    ap.add_argument("--input-text")
    args = ap.parse_args()

    agent = VisionAgent(
        out_dir=args.out,
        viewport=(args.width,args.height),
        headless=not args.headed,
        cdp=args.cdp
    ).start()
    try:
        if args.url:
            agent.goto(args.url)
        if args.action == "inspect":
            result = agent.inspect(args.name)
        elif args.action == "screenshot":
            result = agent.screenshot(args.name + ".png")
        elif args.action == "click":
            if args.selector:
                result = agent.click_selector(args.selector)
            elif args.text:
                result = agent.click_text(args.text)
            else:
                result = agent.click_point(args.x, args.y)
        elif args.action == "type":
            result = agent.type_text(args.selector, args.input_text or "")
        else:
            result = agent.scroll(dy=args.y or 700)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        agent.close()


if __name__ == "__main__":
    main()
