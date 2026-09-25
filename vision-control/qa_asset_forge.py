#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "vision-control"))
from vision_agent import VisionAgent


def make_fixture(path: Path):
    img = Image.new("RGBA", (192, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((24, 26, 168, 102), radius=14, fill=(52, 126, 231, 255))
    d.ellipse((72, 42, 120, 90), fill=(245, 199, 66, 255))
    img.save(path)


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/"
    out = ROOT / "tests" / "vision-verified"
    out.mkdir(parents=True, exist_ok=True)
    fixture = out / "vision-fixture.png"
    make_fixture(fixture)

    agent = VisionAgent(out_dir=str(out), viewport=(390, 844), headless=True).start()
    try:
        agent.goto(url)
        agent.wait(1200)

        first = agent.inspect("asset-forge-mobile")
        assert not first["analysis"]["signals"]["possible_blank_or_black_screen"], "Visual agent detected a black/blank screen"
        assert not first["analysis"]["page_errors"], "Page error detected: " + repr(first["analysis"]["page_errors"][:3])

        agent.click_selector("#fitBtn")
        agent.click_selector("#mobileExportBtn")
        agent.wait(250)

        agent.click_selector('button[data-sheet="toolPanel"]')
        agent.wait(200)
        second = agent.inspect("asset-forge-mobile-tools")

        interactive_ids = {x.get("id") for x in second["interactive"]}
        required = {"uploadBtn", "cropBtn", "trimBtn", "framesBtn", "sheetBtn"}
        missing = sorted(required - interactive_ids)
        assert not missing, f"Required editor controls missing: {missing}"

        if first["analysis"]["signals"]["console_errors"]:\n        raise AssertionError("Console errors detected: " + repr(first["analysis"]["console_errors"][:3]))\n\n    report = {
            "ok": True,
            "url": agent.page.url,
            "mobile_initial": first,
            "mobile_tools": second,
            "fixture": str(fixture)
        }
        (out / "vision-qa-report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps({"ok": True, "report": str(out / "vision-qa-report.json")}, ensure_ascii=False))
    finally:
        agent.close()


if __name__ == "__main__":
    main()
