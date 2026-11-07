"""Downloads IT/CS resumes from Hugging Face (InferencePrince555/Resume-Dataset),
formats them into clean .txt CV files compatible with the HR Hiring system, and
optionally imports and screens them into the local register database.

Usage:
    # Export 100 IT resumes from Hugging Face into data/hf_it_cvs/:
    .venv/bin/python scripts/import_hf_it_dataset.py --count 100 --out data/hf_it_cvs

    # Export and also add + screen them into data/register.db using rule-based screening:
    .venv/bin/python scripts/import_hf_it_dataset.py --count 50 --out data/hf_it_cvs --load-db
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DATASET = "InferencePrince555/Resume-Dataset"

# Offsets in InferencePrince555/Resume-Dataset where IT / Software / Data / Network roles are located
IT_OFFSETS = list(range(1000, 32000, 1000))

IT_KEYWORDS = (
    "software", "developer", "data", "database", "python", "java", "web",
    "network", "security", "devops", "cloud", "testing", "qa", "information technology",
    "machine learning", "engineer", "system administrator",
)

DEGREE_RE = re.compile(
    r"\b(B\.?Tech|B\.?E\.?|B\.?Sc|B\.?S\.?|M\.?Tech|M\.?Sc|M\.?S\.?|BCA|MCA|Bachelor|Master)[^.\n]{0,80}"
    r"(Computer Science|Information Technology|Software Engineering|Data Science|Computer Engineering|Computing|Engineering|ICT)",
    re.IGNORECASE,
)


def fetch_hf_rows(offset: int, length: int = 50) -> list[dict]:
    url = (
        f"https://datasets-server.huggingface.co/rows?"
        f"dataset={DATASET}&config=default&split=train&offset={offset}&length={length}"
    )
    resp = httpx.get(url, headers={"User-Agent": "hr-hiring-dataset-importer/1.0"}, timeout=30.0)
    resp.raise_for_status()
    data = resp.json()
    return [r["row"] for r in data.get("rows", [])]


def stream_with_datasets_lib(count: int) -> list[dict]:
    from datasets import load_dataset  # type: ignore
    ds = load_dataset(DATASET, split="train", streaming=True)
    matched = []
    for row in ds:
        inst = (row.get("instruction") or "").lower()
        text = row.get("Resume_test") or ""
        if any(k in inst for k in IT_KEYWORDS) and DEGREE_RE.search(text):
            matched.append(row)
            if len(matched) >= count:
                break
    return matched


def format_for_hr_hiring(raw_text: str, role_hint: str, idx: int) -> str:
    """Formats a single-line Hugging Face resume string into structured sections
    so `hiring/tools.py` and `hiring/checks.py` can parse Education, Skills, Projects, and Experience."""
    clean = re.sub(r"\s+", " ", raw_text).strip()
    deg_match = DEGREE_RE.search(clean)
    degree_line = deg_match.group(0).strip() if deg_match else "B.Sc. in Information Technology"

    # Extract sentence chunks from the raw resume text so every line is verbatim in the CV
    chunks = [c.strip() for c in re.split(r"(?<=[a-z0-9])\s+(?=[A-Z][a-z])", clean) if len(c.strip()) > 25]
    proj_lines = chunks[:3] if len(chunks) >= 3 else [clean[:200]]
    exp_lines = chunks[3:6] if len(chunks) >= 6 else chunks[:2]

    candidate_id = f"Candidate IT {idx:03d}"
    email = f"candidate.it{idx:03d}@example.com"

    sections = [
        candidate_id,
        f"{email} | +1 555 019 {idx:04d}",
        "",
        "Profile",
        f"{role_hint.replace('Generate a Resume for a ', '').strip()}",
        "",
        "Education",
        f"- {degree_line}",
        "",
        "Technical Skills",
        clean[:600],
        "",
        "Projects",
        *[f"- {p[:220]}" for p in proj_lines],
        "",
        "Experience",
        *[f"- {e[:220]}" for e in exp_lines],
        "",
        "Additional Resume Text",
        clean[:3500],
    ]
    return "\n".join(sections)


def load_and_screen_into_db(files: list[Path]) -> int:
    """Adds the exported CV files into the HR Hiring SQLite database and runs
    deterministic profile extraction, area matching, and scoring."""
    from hiring import actions, config, db, tools
    db.setup()
    areas = db.active_areas()
    vocab = tools.skill_vocabulary(areas)
    added = 0
    for f in files:
        res = actions.add_cv(f.name, f.read_bytes())
        if not res.get("ok"):
            continue
        c = db.get_candidate(res["app_no"])
        if c is None:
            continue
        prof = tools.rule_profile(c.cv_text, vocab)
        best_name, _, best_share = tools.best_area_by_rules(prof, c.cv_text, areas)
        if best_name and best_share > 0:
            area_obj = db.area_by_name(best_name)
            score, parts, gaps = tools.score_cv(prof, c.cv_text, area_obj)
            status = tools.shortlist_status(score) if score is not None else "needs_area"
            if status == "shortlisted":
                with db.Session() as ses:
                    from sqlalchemy import select
                    taken = {x for x in ses.scalars(select(db.Candidate.interview_at).where(db.Candidate.interview_at != ""))}
                try:
                    slot_iso, slot_label = tools.pick_interview_slot(taken)
                except RuntimeError:
                    slot_iso, slot_label = "", ""
                qs = tools.template_questions(best_name, gaps, prof)
                facts = {"name": prof.get("name") or c.app_no, "area": best_name, "app_no": c.app_no, "interview": slot_label}
                draft = tools.template_draft("invitation", facts)
                db.update_candidate(
                    c.id, status="invite_ready", name=prof.get("name") or c.app_no,
                    email=prof.get("email") or "", email_source="Read from CV",
                    profile=prof, profile_source="Rules", area=best_name, area_source="Chosen by rules",
                    area_reasons=[f"Matched {best_name} skills in the CV."], score=score,
                    score_parts=parts, gaps=gaps, interview_at=slot_iso, interview_label=slot_label,
                    questions=qs, questions_source="Standard questions",
                )
                with db.Session() as ses:
                    ses.add(db.Draft(
                        candidate_id=c.id, kind="invitation", subject=draft["subject"], body=draft["body"],
                        status="waiting", written_by="Template", check_notes=[], created_at=db.now(),
                    ))
                    ses.commit()
            else:
                db.update_candidate(
                    c.id, status=status, name=prof.get("name") or c.app_no,
                    email=prof.get("email") or "", email_source="Read from CV",
                    profile=prof, profile_source="Rules", area=best_name, area_source="Chosen by rules",
                    area_reasons=[f"Matched {best_name} skills in the CV."], score=score,
                    score_parts=parts, gaps=gaps,
                )
        else:
            db.update_candidate(
                c.id, status="needs_area", name=prof.get("name") or c.app_no,
                email=prof.get("email") or "", email_source="Read from CV",
                profile=prof, profile_source="Rules",
            )
        added += 1
    return added


def main() -> None:
    ap = argparse.ArgumentParser(description="Import IT resumes from InferencePrince555/Resume-Dataset")
    ap.add_argument("--count", type=int, default=50, help="Number of IT resumes to export")
    ap.add_argument("--out", type=str, default="data/hf_it_cvs", help="Output folder for .txt CV files")
    ap.add_argument("--use-datasets-lib", action="store_true", help="Use `from datasets import load_dataset`")
    ap.add_argument("--load-db", action="store_true", help="Also import and screen the CVs into data/register.db")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    if args.use_datasets_lib:
        rows = stream_with_datasets_lib(args.count)
    else:
        for offset in IT_OFFSETS:
            if len(rows) >= args.count:
                break
            try:
                batch = fetch_hf_rows(offset, length=100)
            except Exception as e:
                print(f"Warning: could not fetch offset {offset}: {e}")
                continue
            for r in batch:
                inst = (r.get("instruction") or "").lower()
                text = r.get("Resume_test") or ""
                if any(k in inst for k in IT_KEYWORDS) or DEGREE_RE.search(text):
                    rows.append(r)
                    if len(rows) >= args.count:
                        break

    written: list[Path] = []
    for i, r in enumerate(rows[: args.count], start=1):
        role = r.get("instruction") or "IT Role"
        text = r.get("Resume_test") or ""
        formatted = format_for_hr_hiring(text, role, i)
        fname = out_dir / f"hf_it_resume_{i:03d}.txt"
        fname.write_text(formatted, encoding="utf-8")
        written.append(fname)

    print(f"Saved {len(written)} IT resume(s) from {DATASET} to {out_dir}/")
    if args.load_db and written:
        added = load_and_screen_into_db(written)
        print(f"Loaded and screened {added} new CV(s) into data/register.db")


if __name__ == "__main__":
    main()
