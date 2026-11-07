"""Clicks through every page in a real browser and saves screenshots (optional check).

Needs Playwright (pip install playwright, then python -m playwright install chromium),
the fake model (python tests/fake_model.py --port 8080) and the app (python app.py)
running with an empty data folder.

    python tests/ui_check.py [--out screenshots]
"""
import argparse
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"
errors: list[str] = []
checks: list[tuple[str, bool]] = []


def ok(name: str, cond: bool) -> None:
    checks.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def wait_for(page, fn, timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="screenshots")
    out = Path(ap.parse_args().out)
    out.mkdir(exist_ok=True)
    with sync_playwright() as p:
        exe = os.environ.get("CHROMIUM_PATH")
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        shot = lambda name, full=True: page.screenshot(path=str(out / f"{name}.png"), full_page=full)

        page.goto(BASE + "/#/dashboard")
        page.wait_for_selector(".nums")
        ok("dashboard loads", page.locator(".num").count() == 5)
        ok("name in the top bar is HR Hiring", page.inner_text("#brand") == "HR Hiring")
        shot("01_dashboard_empty")

        page.click("#nav a[href='#/add']")
        page.wait_for_selector("#drop")
        shot("02_add_cv")
        page.click("[data-act=samples]")
        ok("samples added", wait_for(page, lambda: page.locator("tr.click", has_text="Added").count() >= 6))
        shot("03_add_cv_result")

        ok("employees processed the CVs", wait_for(page, lambda: page.evaluate(
            "fetch('/api/state').then(r=>r.json()).then(s=>s.tiles.new)") == 0 and page.evaluate(
            "fetch('/api/state').then(r=>r.json()).then(s=>s.tiles.release)") >= 4, 240))
        page.goto(BASE + "/#/dashboard")
        page.wait_for_selector(".nums")
        time.sleep(1)
        shot("04_dashboard")

        page.goto(BASE + "/#/candidates")
        page.wait_for_selector(".tabs")
        ok("Selected candidates is the default filter", "Selected candidates" in page.inner_text(".tabs button.on"))
        page.click("[data-act=filter][data-f='']")
        page.wait_for_selector("table.list")
        ok("candidate list shows 17", page.locator("table.list tbody tr").count() == 17)
        shot("05_candidates")

        page.click("text=Arjun Mehta")
        page.wait_for_selector("text=Area and score")
        ok("candidate page shows the score table", page.locator(".score-table tbody tr").count() == 5)
        ok("candidate page shows invitation", page.locator(".mail").count() >= 1)
        shot("06_candidate")

        page.click("[data-act=release]")
        page.click("#dialog [data-dlg=yes]")
        ok("invitation released", wait_for(page, lambda: "Waiting for the interviewer" in page.inner_text("#view")))
        shot("07_candidate_released")

        page.goto(BASE + "/#/review")
        page.wait_for_selector("text=Decisions for you")
        ok("review shows the borderline decision", "Daniel" in page.inner_text("#view"))
        shot("08_review")

        page.goto(BASE + "/#/areas")
        page.wait_for_selector("#view table.t")
        page.click(".box-head [data-act=area-new]")
        page.fill("#af-name", "Legal")
        page.fill("#af-req", "Contract Law, Legal Research, Drafting")
        page.click("#dialog [data-dlg=save]")
        ok("new area added", wait_for(page, lambda: "Added by HR officer" in page.inner_text("#view")))
        shot("09_areas")

        page.goto(BASE + "/#/candidates")
        page.click("[data-act=filter][data-f='']")
        page.wait_for_selector("table.list")
        page.click("text=Laura Bennett")
        ok("HR CV matched to Human Resources", wait_for(page, lambda: "Area: Human Resources" in page.inner_text("#view")))
        shot("10_candidate_area_chosen")

        page.goto(BASE + "/#/replies")
        page.wait_for_selector("text=Emails drafted by the AI team")
        shot("11_replies")

        page.goto(BASE + "/#/team")
        page.wait_for_selector("text=Routines")
        ok("team page shows 4 employees", page.locator(".box.emp").count() == 4)
        shot("12_team")

        # Interviewer
        page.select_option("#role-select", "interviewer")
        page.wait_for_selector("text=Waiting for your result")
        shot("13_interviews")
        page.click("tr.click >> text=Arjun Mehta")
        page.wait_for_selector("text=Your result")
        shot("14_interview")
        page.click("label.pass")
        page.fill("#result-comment", "Strong project work and clear answers.")
        page.click("[data-act=save-result]")
        page.click("#dialog [data-dlg=yes]")
        ok("result saved", wait_for(page, lambda: "Saved" in page.inner_text("#view")))
        shot("15_interview_saved")

        # Back to HR: onboarding should have drafted the acceptance with a work ID
        page.select_option("#role-select", "hr")
        page.goto(BASE + "/#/candidates/selected")
        page.wait_for_selector("table.list")
        page.click("text=Arjun Mehta")
        ok("work ID issued", wait_for(page, lambda: "Work ID 1001" in page.inner_text("#view"), 40))
        shot("16_candidate_work_id")

        page.goto(BASE + "/#/dashboard")
        ok("selected count on dashboard", wait_for(page, lambda: "Selected candidates by area" in page.inner_text("#view")))
        shot("17_dashboard_after")
        page.select_option("#role-select", "interviewer")
        page.wait_for_selector("text=Your recent results")
        shot("18_interviews_after")
        page.select_option("#role-select", "hr")
        page.goto(BASE + "/#/review")
        page.wait_for_selector("text=Decisions for you")
        shot("19_review_after")
        page.goto(BASE + "/#/add")
        page.wait_for_selector("#drop")
        shot("20_add_after")
        page.set_viewport_size({"width": 820, "height": 1000})
        page.goto(BASE + "/#/dashboard")
        page.wait_for_selector(".nums")
        shot("21_dashboard_narrow")
        browser.close()

    ok("no browser errors", not errors)
    for e in errors[:10]:
        print("  browser error:", e)
    failed = [n for n, c in checks if not c]
    print(f"\n{len(checks) - len(failed)} of {len(checks)} checks passed. Screenshots in {out}/")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
