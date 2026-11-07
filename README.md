# HR Hiring

A local, AI-assisted hiring workflow. Four AI agents handle the routine work of screening CVs, scheduling interviews and drafting emails. Two people make every decision that matters.

| Role | Type | Responsibility |
|---|---|---|
| **Recruiter** | AI agent | Reads each CV, builds a profile checked against the CV, picks the role area and scores the match. |
| **Coordinator** | AI agent | Books interview slots, prepares interview questions and drafts emails to candidates. |
| **Onboarding** | AI agent | After a Pass, issues a 4-digit employee ID, drafts the offer email and prepares an onboarding checklist. |
| **Chief of staff** | AI agent | Reviews the day's activity each morning, flags stalled work and writes a short summary. |
| **HR officer** | Person | Adds CVs, decides borderline and low scores, confirms uncertain areas, manages areas and releases every email. |
| **Interviewer** | Person | Runs the interview and records Pass, Fail or Hold. The AI cannot change this result. |

## Features

- Runs fully on your own machine. CVs never leave the computer.
- Local LLM (Gemma 3 4B by default) served by llama.cpp. No cloud API keys needed.
- Scores are calculated by code, not by the model.
- Every model answer is checked against the CV before it is saved.
- Emails are drafted only. Nothing is sent. Released emails are saved to `data/outbox/`.
- Plain web UI with two roles: HR officer and interviewer.

## Tech stack

Python, FastAPI, LangGraph, SQLAlchemy (SQLite), APScheduler, llama.cpp, and plain HTML, CSS and JavaScript.

## Requirements

- macOS (also works on Linux)
- Python 3.10 or newer
- [llama.cpp](https://github.com/ggml-org/llama.cpp) (`brew install llama.cpp`)
- About 3 GB of free memory for the model

## Installation

```bash
git clone https://github.com/sgautham651-dev/hr-hiring.git
cd hr-hiring
bash setup.sh
```

`setup.sh` creates a `.venv` folder and installs the Python packages.

## Running

Open two terminals in the project folder.

**Terminal 1: start the model server**

```bash
./start_model.sh
```

On the first run this downloads Gemma 3 4B (about 2.5 GB). Wait until the server is listening.

**Terminal 2: start the app**

```bash
./start_app.sh
```

Open **http://localhost:8000** in your browser. Press Control+C in each terminal to stop.

To check that the model returns valid JSON:

```bash
.venv/bin/python run.py check
```

If you see "permission denied", run `bash start_model.sh` and `bash start_app.sh` instead.

## Quick demo

1. Use the **Role** dropdown (top right) to choose **HR Officer**. Go to **Add CV** and click **Load the sample CVs**.
2. Watch the **Dashboard** while the Recruiter screens the CVs and the Coordinator drafts invitations. With a local 4B model this can take a minute or more per CV.
3. Open the **Review queue** to handle borderline scores and CVs whose area is uncertain. If the AI suggests a new area, add it on the **Areas** page with its required skills, then choose it on the candidate's page.
4. Open **Replies** and release an interview invitation.
5. Switch the role to **Interviewer**, open **Interviews**, pick a candidate and record **Pass**.
6. Switch back to **HR Officer**. Onboarding issues employee ID **1001** and drafts the offer email. Release it to close the application.
7. Click **Write brief now** on the Dashboard to see the daily summary. The **AI team** page shows each agent, its routines and every step it took.

## How it works

```
HR officer adds a CV
  -> Recruiter:    read CV -> duplicate check -> choose area -> score -> skill gaps -> shortlist rule
       60+ shortlisted | 50-59 HR officer decides | below 50 HR officer confirms | unsure area -> HR officer
  -> Coordinator:  interview slot -> questions -> invitation draft    -> HR officer releases
  -> Interviewer:  Pass / Fail / Hold
  -> Pass: Onboarding: employee ID -> offer draft -> checklist        -> HR officer releases -> Closed
     Fail: Coordinator: rejection draft                               -> HR officer releases -> Closed
     Hold: Coordinator: hold note -> HR officer releases -> On hold   -> Interviewer decides later
```

- **The candidate's status is the hand-off.** Each agent runs on its own schedule and picks up candidates in its trigger status.
- **Agents are defined in Markdown** in `employees/`: `ROLE.md` (who it is), `SCHEDULE.md` (when it runs), `RELEASES.md` (what needs a person) and `routines/<name>/SKILL.md` (one task each). The **Instructions for the model** and **Output** sections are the prompt, so you can change behaviour without touching code.
- **Workflows are LangGraph graphs** (`hiring/flows.py`), scheduled with APScheduler (`hiring/scheduler.py`).
- **The model proposes, code decides** (`hiring/checks.py`):
  - profile items, names, emails and evidence must appear in the CV;
  - emails must contain the correct name, area, date and ID, with no invented numbers or placeholders;
  - a failed check is sent back to the model (up to 2 retries), then the agent falls back to rules or a template and flags the candidate;
  - the score is calculated by code: skills 40, projects 30, education 20, experience 10;
  - employee IDs are issued by code only after a Pass, starting at 1001, never reused.
- **Lessons:** when a check fails, the agent saves a short lesson (no personal data) in `data/notes/` and uses it next time.
- **No forced areas:** the model may suggest a new area, but only a person can add one.

## Configuration

| What | Where |
|---|---|
| Areas and required skills | **Areas** page |
| Score weights and thresholds | `hiring/config.py` |
| Agent instructions | `employees/<agent>/ROLE.md` and `routines/<routine>/SKILL.md` |
| Agent schedule | `employees/<agent>/SCHEDULE.md` |
| Model | The model name in `start_model.sh` (any GGUF model on Hugging Face, for example a Qwen3 4B Instruct build) |
| App port | `APP_PORT` in `hiring/config.py` |

To reset all data, stop the app and delete the `data` folder.

## Project structure

```
setup.sh, start_model.sh, start_app.sh   setup and start scripts
app.py                                   web app entry point
run.py                                   CLI helpers: check, samples, once, brief, status
employees/                               the 4 AI agents (Markdown)
shared/areas.json                        starter areas
hiring/
  config.py     settings               db.py         database (SQLite)
  llm.py        llama-server client    checks.py     checks on model answers
  tools.py      CV reading, scoring, scheduling, templates
  employees.py  loads agent folders, checked model calls
  flows.py      LangGraph workflows    scheduler.py  APScheduler jobs
  actions.py    user actions           server.py     FastAPI routes
web/                                     front end (HTML, CSS, JavaScript)
samples/                                 sample CVs (fictional people)
tests/                                   tests and a fake model server
data/                                    created at runtime: database, inbox, outbox, logs, notes
```

## Testing

```bash
.venv/bin/python -m pytest tests -q
```

The tests use a scripted fake model (`tests/fake_model.py`), so no real model is needed. To try the UI without a real model, run the fake model in terminal 1 instead of `./start_model.sh`:

```bash
.venv/bin/python tests/fake_model.py --port 8080 --delay 1
```

## Limitations

- Quality and speed depend on the model. The **AI team** page shows how many steps passed, needed a fix or fell back to rules, which helps compare models.
- The checks confirm facts appear in the CV, not that a decision is correct. Borderline and low scores always go to a person.
- Evidence matching is word-based, not semantic.
- Scanned PDFs are not supported (no OCR). They are flagged for a person.
- No authentication. The role switch is for demo use only.
- One model call at a time.

## Troubleshooting

| Problem | Fix |
|---|---|
| Top bar shows "Model: not running" | Run `./start_model.sh` in another terminal and wait until it is listening. |
| `llama-server: command not found` | `brew install llama.cpp` |
| Port 8000 or 8080 already in use | Close the other running copy, or change the port. |
| Very slow | Close other apps. The model needs about 3 GB of memory. |
| Many "fell back to rules" steps | Try another model or adjust the SKILL instructions. |

## Acknowledgements

The Markdown agent structure (ROLE, SCHEDULE, RELEASES and SKILL files) follows the idea from [markfulton/ai-employees](https://github.com/markfulton/ai-employees). All people in `samples/` are fictional.
