/* HR Hiring - the pages for the HR officer and the Interviewer.
   Plain JavaScript, no framework. Every value from the server is escaped before it is shown. */
"use strict";

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AI_ACTORS = new Set(["Recruiter", "Coordinator", "Onboarding", "Chief of staff"]);
const APP_NAME = "HR Hiring";

let ROLE = store.get("hr-hiring-role", "hr");
if (!["hr", "interviewer"].includes(ROLE)) ROLE = "hr";
let STATE = null;
let lastHTML = "";
let current = { page: "", arg: "" };
const UI = { showCv: false, showRuns: false, editDraft: null, editEmail: false, candFilter: "selected", candQuery: "",
             repliesTab: "waiting", showAll: "", files: [], uploadResults: null, areas: null };

async function api(path, { method = "GET", body, form } = {}) {
  const opt = { method, headers: { "X-Role": ROLE } };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  let data = null;
  try { data = await r.json(); } catch { /* no body */ }
  if (!r.ok) throw new Error((data && data.detail) || `The server answered with error ${r.status}.`);
  return data;
}

function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  while ($("#toasts").children.length > 3) $("#toasts").firstChild.remove();
  setTimeout(() => t.remove(), bad ? 7000 : 4500);
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Colour is used only for Pass, Fail and "Needs you".
const HR_NEEDS = new Set(["needs_person", "needs_area", "borderline", "not_shortlisted_check", "invite_ready", "hold_note_ready", "reply_ready", "offer_ready"]);
const INT_NEEDS = new Set(["awaiting_result", "on_hold"]);
const needsMe = (status) => (ROLE === "hr" ? HR_NEEDS : INT_NEEDS).has(status);
function statusTag(c) {
  const cls = c.status === "passed" ? "pass" : c.status === "failed" ? "fail" : needsMe(c.status) ? "need" : "";
  return `<span class="tag ${cls}">${esc(c.status_label)}</span>`;
}
const resultTag = (r) => (r ? `<span class="tag ${r === "Pass" ? "pass" : r === "Fail" ? "fail" : ""}">${esc(r)}</span>` : "");
const tag = (text, cls = "") => `<span class="tag ${cls}">${esc(text)}</span>`;
const byText = (text) => (text ? `<span class="by">(${esc(text)})</span>` : "");
const actorText = (actor) => esc(AI_ACTORS.has(actor) ? `AI ${actor}` : actor);
const empty = (text) => `<div class="empty">${esc(text)}</div>`;
const candLink = (appNo, text) => `<a href="#/candidate/${encodeURIComponent(appNo)}">${esc(text || appNo)}</a>`;

function title(t) { $("#page-title").textContent = t; document.title = `${t} - ${APP_NAME}`; }
function setView(html) {
  if (html === lastHTML) return;
  const y = window.scrollY;
  lastHTML = html;
  view.innerHTML = html;
  window.scrollTo(0, y);
}
function busy() {
  const a = document.activeElement;
  return $("#dialog").open || document.hidden ||
    (a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName)) || UI.editDraft !== null || UI.editEmail;
}

// ---------------------------------------------------------------- dialogs
function openDialog(html) {
  $("#dialog-body").innerHTML = html;
  const d = $("#dialog");
  if (!d.open) d.showModal();
  const f = d.querySelector("input, textarea, select");
  if (f) f.focus();
}
function closeDialog() { $("#dialog").close(); }
function confirmBox({ heading, text, ok = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    openDialog(`<h3>${esc(heading)}</h3><p class="muted">${esc(text)}</p>
      <div class="actions"><button class="btn" data-dlg="no">Cancel</button>
      <button class="btn ${danger ? "danger" : "primary"}" data-dlg="yes">${esc(ok)}</button></div>`);
    const d = $("#dialog");
    const done = (v) => { d.removeEventListener("close", onClose); closeDialog(); resolve(v); };
    const onClose = () => resolve(false);
    d.addEventListener("close", onClose, { once: true });
    d.querySelector('[data-dlg="yes"]').onclick = () => done(true);
    d.querySelector('[data-dlg="no"]').onclick = () => done(false);
  });
}

// ---------------------------------------------------------------- frame: top menu, model, role
const NAV = {
  hr: [["dashboard", "Dashboard"], ["add", "Add CV"], ["candidates", "Candidates"], ["review", "Review queue", "review"],
       ["replies", "Replies", "release"], ["areas", "Areas"], ["team", "AI team"]],
  interviewer: [["interviews", "Interviews", "interview"], ["team", "AI team"]],
};
const HOME = { hr: "#/dashboard", interviewer: "#/interviews" };

function renderFrame() {
  const t = STATE ? STATE.tiles : {};
  $("#nav").innerHTML = NAV[ROLE].map(([key, label, countKey]) => {
    const count = countKey && t[countKey] ? `<span class="count">${esc(t[countKey])}</span>` : "";
    const on = current.page === key || (key === "candidates" && current.page === "candidate") || (key === "interviews" && current.page === "interview");
    return `<a class="${on ? "on" : ""}" href="#/${key}">${esc(label)}${count}</a>`;
  }).join("");
  $("#brand").href = HOME[ROLE];
  $("#role-select").value = ROLE;
  if (!STATE) return;
  const m = STATE.model;
  const down = !m.ok || (STATE.notice && STATE.notice.text);
  const el = $("#model");
  el.textContent = down ? "Model: not running" : "Model: running";
  el.className = "model" + (down ? " down" : "");
  el.title = down ? ((STATE.notice && STATE.notice.text) || m.detail || "") : m.model;
  const working = Object.values(STATE.team).find((x) => x.state === "working");
  $("#foot").textContent = `${APP_NAME} - prototype. Emails are drafted only, never sent. AI team: ${STATE.paused ? "paused" : working ? working.name + " is working" : "waiting for work"}.`;
}
async function refreshState() {
  try { STATE = await api("/api/state"); } catch { return; }
  renderFrame();
}

$("#role-select").onchange = (e) => {
  ROLE = e.target.value;
  store.set("hr-hiring-role", ROLE);
  e.target.blur();
  toast(`You are now using the system as ${ROLE === "hr" ? "the HR Officer" : "the Interviewer"}.`);
  lastHTML = "";
  location.hash = HOME[ROLE];
  renderFrame();
};

// ---------------------------------------------------------------- shared pieces
function notice(kind, head, text = "", action = "") {
  return `<div class="notice ${kind}"><div class="grow"><b>${esc(head)}</b>${text ? ` <span class="muted">${esc(text)}</span>` : ""}</div>${action}</div>`;
}
function boxHead(text, extra = "") {
  return `<div class="box-head"><h2>${esc(text)}</h2><div class="spacer"></div>${extra}</div>`;
}
function modelNotice() {
  if (!STATE) return "";
  const n = STATE.notice && STATE.notice.text;
  if (STATE.model.ok && !n) return "";
  return notice("error", "The AI employees cannot work: the model server is not running.",
    "Open a second terminal in the project folder and run ./start_model.sh, then wait until it says the server is listening. " + (n || STATE.model.detail || ""));
}
function mailBlock(d, { showCandidate = false } = {}) {
  const editing = UI.editDraft === d.id;
  const state = d.status === "waiting" ? tag("Waiting for release", ROLE === "hr" ? "need" : "") : d.status === "released" ? tag("Released") : tag(d.status);
  const notes = (d.check_notes || []).map((n) => `<div class="warn">Warning: ${esc(n)}</div>`).join("");
  let foot = "";
  if (d.status === "waiting" && ROLE === "hr") {
    foot = editing
      ? `<div class="actions"><button class="btn primary" data-act="save-draft" data-id="${d.id}">Save changes</button><button class="btn" data-act="cancel-edit">Cancel</button></div>`
      : `<div class="actions"><button class="btn primary" data-act="release" data-id="${d.id}" data-name="${esc(d.name)}" data-kind="${esc(d.kind_label)}" ${d.can_release ? "" : "disabled"}>Release</button>
         <button class="btn" data-act="edit-draft" data-id="${d.id}">Edit</button>
         ${d.can_release ? "" : `<span class="small muted">${esc(d.release_blocker || "The candidate is not at this step now.")}</span>`}</div>`;
  } else if (d.status === "released") {
    foot = `<span class="small muted">Released ${esc(fmtTime(d.released_at))}. Saved to data/outbox/${esc(d.file)} (not sent).</span>`;
  }
  const body = editing
    ? `<div class="mail-body editing"><div class="form-row"><label for="ed-subject">Subject</label><input type="text" id="ed-subject" value="${esc(d.subject)}"></div>
       <div class="form-row"><label for="ed-body">Email</label><textarea id="ed-body" rows="12">${esc(d.body)}</textarea></div></div>`
    : `<div class="mail-body"><b>${esc(d.subject)}</b>\n\n${esc(d.body)}</div>`;
  return `<div class="mail" id="mail-${d.id}">
    <div class="mail-head"><b>${esc(d.kind_label)}</b>${state}${byText(d.written_by)}<span class="grow"></span>
      ${showCandidate ? candLink(d.app_no) : ""}<span class="small muted">To: ${esc(d.name || "")} ${d.email ? "&lt;" + esc(d.email) + "&gt;" : "(no email yet)"}</span></div>
    ${notes}${body}${foot ? `<div class="mail-foot">${foot}</div>` : ""}</div>`;
}

// ================================================================ HR officer pages
async function pDashboard() {
  title("Dashboard");
  const [s, all] = await Promise.all([api("/api/state"), api("/api/candidates")]);
  STATE = s;
  renderFrame();
  const t = s.tiles;
  let next;
  if (t.review) next = notice("need", `${t.review} item(s) need your decision or a quick check.`, "", `<a class="btn" href="#/review">Open Review queue</a>`);
  else if (t.release) next = notice("need", `${t.release} email(s) are waiting for your release.`, "Nothing reaches a candidate until you release it.", `<a class="btn" href="#/replies">Open Replies</a>`);
  else if (!s.total) next = notice("ok", "No CVs yet.", "Add a CV to start, or load the sample CVs.", `<a class="btn primary" href="#/add">Add CV</a>`);
  else next = notice("ok", "Nothing needs you right now.", "The AI team is handling the rest.");
  const nums = [
    ["New CVs", t.new, "#/candidates/new", false],
    ["Needs your review", t.review, "#/review", t.review > 0],
    ["Emails to release", t.release, "#/replies", t.release > 0],
    ["In interview", t.interview, "#/candidates/interview", false],
    ["Selected", t.selected, "#/candidates/selected", false],
  ].map(([label, n, href, need]) => `<a class="num ${need ? "need" : ""}" href="${href}"><b>${esc(n)}</b><span>${esc(label)}</span></a>`).join("");

  // Selected = passed the interview, counted per area
  const passed = {};
  all.filter((c) => c.result === "Pass").forEach((c) => { passed[c.area] = (passed[c.area] || 0) + 1; });
  const areaNames = s.areas_chart.map((a) => a.area);
  Object.keys(passed).forEach((a) => { if (!areaNames.includes(a)) areaNames.push(a); });
  const totalPassed = Object.values(passed).reduce((x, y) => x + y, 0);
  const areaTable = areaNames.length ? `<table class="t"><thead><tr><th>Area</th><th class="num-col">Selected</th></tr></thead><tbody>
      ${areaNames.map((a) => `<tr><td>${esc(a)}</td><td class="num-col">${esc(passed[a] || 0)}</td></tr>`).join("")}
      <tr class="total"><td>All areas</td><td class="num-col">${esc(totalPassed)}</td></tr></tbody></table>` : empty("No areas yet.");

  const recent = s.recent.length ? `<table class="t"><thead><tr><th style="width:110px">Time</th><th>Activity</th></tr></thead><tbody>
      ${s.recent.slice(0, 6).map((r) => `<tr ${r.app_no ? `class="click" data-href="#/candidate/${encodeURIComponent(r.app_no)}"` : ""}><td class="small muted">${esc(fmtTime(r.at))}</td>
        <td>${esc(r.text)}<div class="small muted">${actorText(r.actor)}${r.app_no ? " - " + esc(r.app_no) + " " + esc(r.name || "") : ""}</div></td></tr>`).join("")}</tbody></table>`
    : empty("Nothing has happened yet.");
  const team = `<table class="t"><thead><tr><th>Employee</th><th>Status</th><th>Last run</th></tr></thead><tbody>
      ${Object.values(s.team).map((e) => `<tr><td>${esc(e.name)}</td>
        <td>${s.paused ? "Paused" : e.state === "working" ? "Working: " + esc(e.doing) : "Ready"}</td>
        <td class="small muted">${e.last_run ? esc(fmtTime(e.last_run)) + "<br>" + esc(e.last_note) : "Not yet"}</td></tr>`).join("")}</tbody></table>`;
  const brief = s.brief ? `<p style="margin:0 0 6px">${esc(s.brief.text)}</p><div class="small muted">Chief of staff (${esc(s.brief.written_by)}) - ${esc(fmtTime(s.brief.created_at))}</div>`
    : `<p class="muted" style="margin:0">The Chief of staff writes a brief every morning at 08:00.</p>`;

  setView(`${modelNotice()}
    ${next}
    <div class="nums">${nums}</div>
    <div class="box">${boxHead("Morning brief", `<button class="btn small" data-act="brief">Write brief now</button>`)}${brief}</div>
    <div class="box">${boxHead("Selected candidates by area", `<span class="small muted">Passed the interview</span> <a class="small" href="#/candidates/selected">View list</a>`)}${areaTable}</div>
    <div class="grid two even">
      <div class="box">${boxHead("Recent activity")}${recent}</div>
      <div class="box">${boxHead("AI team", `<a class="small" href="#/team">Open AI team</a>`)}${team}</div>
    </div>`);
}

async function pAdd() {
  title("Add CV");
  const files = UI.files;
  const results = UI.uploadResults;
  const resultTable = results ? `<table class="t"><thead><tr><th>File</th><th>Result</th><th>Application</th></tr></thead><tbody>
      ${results.map((r) => r.ok
        ? `<tr class="click" data-href="#/candidate/${encodeURIComponent(r.app_no)}"><td>${esc(r.file)}</td><td>Added</td><td>${candLink(r.app_no)}</td></tr>`
        : `<tr><td>${esc(r.file)}</td><td>${tag("Not added", "fail")} <span class="small muted">${esc(r.reason)}</span></td><td>-</td></tr>`).join("")}</tbody></table>` : "";
  const fileTable = files.length ? `<table class="t" style="margin-top:10px"><thead><tr><th>Chosen file</th><th>Size</th><th></th></tr></thead><tbody>
      ${files.map((f, i) => `<tr><td>${esc(f.name)}</td><td class="small muted">${Math.ceil(f.size / 1024)} KB</td>
        <td style="text-align:right"><button class="btn small" data-act="remove-file" data-i="${i}">Remove</button></td></tr>`).join("")}</tbody></table>` : "";
  setView(`<div class="box">${boxHead("Add CVs")}
      <div class="add-grid">
        <div>
          <label class="drop" id="drop" for="file-input"><span class="btn">Choose files</span><div style="margin-top:8px">or drop CV files here</div>
            <div class="small muted">PDF, Word (.docx) or text files, up to 5 MB each. You can add several at once.</div></label>
          <input type="file" id="file-input" accept=".pdf,.docx,.txt" multiple hidden>
          ${fileTable}
        </div>
        <div>
          <div class="form-row"><label for="cv-email">Candidate's email (optional)</label>
            <input type="email" id="cv-email" placeholder="${files.length > 1 ? "Only for a single CV" : "name@example.com"}" ${files.length > 1 ? "disabled" : ""}>
            <div class="help">If you type it, replies use this address. If you leave it empty, the Recruiter reads it from the CV and you confirm it.</div></div>
          <p class="small muted">${files.length ? `${files.length} file(s) chosen.` : "No files chosen yet."}</p>
          <div class="actions"><button class="btn primary" data-act="upload" ${files.length ? "" : "disabled"}>Add ${files.length > 1 ? files.length + " CVs" : "CV"}</button>
            ${files.length ? `<button class="btn" data-act="clear-files">Clear</button>` : ""}</div>
        </div>
      </div></div>
    ${results ? `<div class="box">${boxHead("Result")}${resultTable}</div>` : ""}
    <div class="box">${boxHead("What happens next")}<ol class="clean">
      <li><b>Recruiter</b> reads the CV, chooses the area and scores the match. Every fact is checked against the CV.</li>
      <li><b>You</b> decide borderline and low scores, and choose areas the AI is unsure about.</li>
      <li><b>Coordinator</b> books an interview slot, prepares questions and drafts the invitation for you to release.</li>
      <li><b>Interviewer</b> does the interview and enters Pass, Fail or Hold.</li>
      <li><b>Onboarding</b> issues the 4-digit work ID and drafts the acceptance email for you to release.</li></ol></div>
    <div class="box">${boxHead("Try it with sample CVs")}<p class="small muted" style="margin-top:0">17 made-up candidates in PDF, Word and text files, for demos and testing. Three of them fit none of the areas.</p>
      <button class="btn" data-act="samples">Load the sample CVs</button></div>`);
  const input = $("#file-input");
  input.onchange = () => { addFiles(input.files); input.value = ""; };
  const drop = $("#drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); };
}
function addFiles(list) {
  for (const f of list) if (!UI.files.some((x) => x.name === f.name && x.size === f.size)) UI.files.push(f);
  UI.uploadResults = null;
  lastHTML = "";
  pAdd();
}

const FILTERS = [["selected", "Selected candidates"], ["", "All"], ["new", "New"], ["interview", "In interview"], ["closed", "Closed"], ["review", "Needs you"], ["release", "Emails to release"]];
async function pCandidates(arg) {
  title("Candidates");
  if (arg !== undefined && arg !== "" && FILTERS.some((f) => f[0] === arg)) UI.candFilter = arg;
  const selected = UI.candFilter === "selected";
  let rows = await api(`/api/candidates?status=${selected ? "" : encodeURIComponent(UI.candFilter)}`);
  if (selected) rows = rows.filter((c) => c.result === "Pass");   // passed the interview
  const q = UI.candQuery.toLowerCase();
  const shown = q ? rows.filter((c) => [c.name, c.app_no, c.area, c.email].join(" ").toLowerCase().includes(q)) : rows;
  const body = shown.length ? `<table class="t list"><thead><tr><th>Application</th><th>Candidate</th><th>Area</th><th class="num-col">Score</th><th>Status</th><th>Next</th></tr></thead><tbody>
    ${shown.map((c) => `<tr class="click" data-href="#/candidate/${encodeURIComponent(c.app_no)}">
      <td><b>${esc(c.app_no)}</b><div class="small muted">${esc(fmtTime(c.created_at))}</div></td>
      <td>${esc(c.name)}<div class="small muted">${esc(c.email || "no email yet")}</div></td>
      <td>${c.area ? esc(c.area) : c.suggested_new_area ? `<span class="small muted">Suggested: ${esc(c.suggested_new_area)}</span>` : `<span class="muted">-</span>`}</td>
      <td class="num-col">${c.score == null ? "-" : esc(c.score)}</td>
      <td>${statusTag(c)} ${c.open_flags ? tag(`${c.open_flags} note(s)`, ROLE === "hr" ? "need" : "") : ""}</td>
      <td class="small muted">${esc(c.next_actor || (c.outcome || "Done"))}</td></tr>`).join("")}</tbody></table>`
    : empty(rows.length ? "No candidate matches your search." : selected ? "No one has passed an interview yet." : "No candidates here.");
  setView(`<div class="box">${boxHead("Candidates", `<a class="btn primary" href="#/add">Add CV</a>`)}
    <div class="filters"><div class="tabs">${FILTERS.map(([k, l]) => `<button class="${UI.candFilter === k ? "on" : ""}" data-act="filter" data-f="${k}">${esc(l)}</button>`).join("")}</div>
    <input type="search" class="search" id="cand-q" placeholder="Search name, number, area" value="${esc(UI.candQuery)}"></div>${body}</div>`);
  const qi = $("#cand-q");
  qi.oninput = () => { UI.candQuery = qi.value; const pos = qi.selectionStart; lastHTML = ""; pCandidates().then(() => { const n = $("#cand-q"); n.focus(); n.setSelectionRange(pos, pos); }); };
}

function nextStep(c, areas) {
  const areaSelect = (label) => `<select id="area-pick" style="width:auto;max-width:220px">${areas.filter((a) => a.active).map((a) => `<option ${a.name === c.area ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
      <button class="btn ${label ? "primary" : "small"}" data-act="set-area">${esc(label || "Use this area")}</button>`;
  switch (c.status) {
    case "new": return notice("ok", "The Recruiter will read this CV in a moment.", "The page updates by itself.");
    case "needs_person": return notice("need", "This CV could not be read.", "It may be a scanned PDF. Upload it again as Word or text, or try again.",
      `<div class="actions"><button class="btn primary" data-act="retry">Try again</button><button class="btn danger" data-act="close">Close</button></div>`);
    case "needs_area": return notice("need", "Choose the area for this candidate.",
      c.suggested_new_area ? `The AI suggested a new area: "${c.suggested_new_area}". Add it on the Areas page first if you agree.` : "The Recruiter could not choose one with confidence.",
      `<div class="actions">${areaSelect("Save area")}${c.suggested_new_area ? `<a class="btn" href="#/areas/new:${encodeURIComponent(c.suggested_new_area)}">Add "${esc(c.suggested_new_area)}"</a>` : ""}<button class="btn danger" data-act="close">Close</button></div>`);
    case "borderline": return notice("need", `Score ${c.score}/100 is borderline (50 to 59). Please decide.`, "",
      `<div class="actions"><button class="btn primary" data-act="decide" data-d="shortlist">Shortlist</button><button class="btn" data-act="decide" data-d="not_shortlist">Not shortlisted</button></div>`)
      + `<div class="actions small muted" style="margin-top:8px">Wrong area? ${areaSelect("")}</div>`;
    case "not_shortlisted_check": return notice("need", `Score ${c.score}/100 is below 50. Confirm Not shortlisted?`, "A polite reply is drafted only after you confirm.",
      `<div class="actions"><button class="btn primary" data-act="decide" data-d="confirm">Confirm Not shortlisted</button><button class="btn" data-act="decide" data-d="shortlist">Shortlist instead</button></div>`)
      + `<div class="actions small muted" style="margin-top:8px">Wrong area? ${areaSelect("")}</div>`;
    case "invite_ready": case "reply_ready": case "hold_note_ready": case "offer_ready":
      return notice("need", "An email is waiting for your release.", "Read it below, edit it if needed, then release it.", `<a class="btn" href="#emails" data-act="jump">Go to the email</a>`);
    case "awaiting_result": return notice("ok", "Waiting for the interviewer's result.", `Interview: ${c.interview_label}.`);
    case "on_hold": return notice("ok", "The result is on hold.", "The interviewer will enter Pass or Fail later.");
    case "closed": return notice("ok", `Closed: ${c.outcome || "done"}.`);
    default: return notice("ok", `The ${c.next_actor} is working on this.`, "The page updates by itself.");
  }
}

async function pCandidate(appNo) {
  title("Candidate");
  const [c, areas] = await Promise.all([api(`/api/candidates/${encodeURIComponent(appNo)}`), UI.areas ? Promise.resolve(UI.areas) : api("/api/areas")]);
  UI.areas = areas;
  const p = c.profile || {};
  const list = (items, none) => (items && items.length ? `<ul class="clean">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="muted">${esc(none)}</span>`);
  const flags = c.flags.filter((f) => f.open);
  const parts = Object.entries(c.score_parts || {});
  const scoreTable = parts.length ? `<table class="t score-table"><thead><tr><th>Part</th><th>Why</th><th class="num-col">Points</th></tr></thead><tbody>
      ${parts.map(([k, v]) => `<tr><td>${esc(k[0].toUpperCase() + k.slice(1))}</td><td class="small muted">${esc(v.why)}</td><td class="num-col">${esc(v.points)} / ${esc(v.max)}</td></tr>`).join("")}
      <tr class="total"><td>Total</td><td></td><td class="num-col">${esc(c.score)} / 100</td></tr></tbody></table>
      <div class="small muted" style="margin-top:6px">60 or more: shortlisted. 50 to 59: you decide. Below 50: not shortlisted.</div>` : "";
  const emailField = UI.editEmail
    ? `<div class="actions"><input type="email" id="email-input" value="${esc(c.email)}" style="max-width:280px"><button class="btn primary small" data-act="save-email">Save</button><button class="btn small" data-act="cancel-email">Cancel</button></div>`
    : `<div>${c.email ? esc(c.email) : `<span class="muted">No email yet</span>`} ${ROLE === "hr" ? `<button class="btn link small" data-act="edit-email">${c.email ? "Change" : "Add email"}</button>` : ""}</div>
       ${c.email_source ? `<div class="small muted">${esc(c.email_source)}</div>` : ""}`;
  const hasInterview = c.interview_label || (c.questions && c.questions.length) || c.result;
  setView(`<a class="back" href="#/candidates">&larr; All candidates</a>
    <div class="box"><div class="box-head"><h2 style="font-size:18px">${esc(c.name)}</h2><div class="spacer"></div>
      <a class="btn" href="/api/candidates/${encodeURIComponent(c.app_no)}/cv">Download CV</a></div>
      <div class="actions">${esc(c.app_no)} ${statusTag(c)}${c.area ? ` <span>Area: ${esc(c.area)}</span>` : ""}${c.score != null ? ` <span>Score: ${esc(c.score)}/100</span>` : ""}${c.work_id ? ` <b>Work ID ${esc(c.work_id)}</b>` : ""}</div></div>
    ${ROLE === "hr" ? nextStep(c, areas.areas) : notice("ok", "You are viewing this as the Interviewer.", "Open it from the Interviews page to enter a result.")}
    ${flags.length ? `<div class="box">${boxHead("Notes to check", `<span class="small muted">From the AI team</span>`)}<table class="t"><tbody>
      ${flags.map((f) => `<tr><td>${esc(f.text)}<div class="small muted">${esc(f.by)} - ${esc(fmtTime(f.at))}</div></td>
        <td style="text-align:right">${ROLE === "hr" ? `<button class="btn small" data-act="resolve" data-i="${f.index}">Mark as checked</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="grid two">
      <div class="box">${boxHead("Profile", c.profile_source ? byText(c.profile_source === "AI" ? "read by AI, checked against the CV" : "made by rules") : "")}
        <div class="field"><div class="label">Email</div>${emailField}</div>
        <div class="field"><div class="label">Phone</div><div>${esc(p.phone || "-")}</div></div>
        <div class="field"><div class="label">Education</div>${list(p.education, "Not found")}</div>
        <div class="field"><div class="label">Skills</div>${p.skills && p.skills.length ? esc(p.skills.join(", ")) : `<span class="muted">Not found</span>`}</div>
        <div class="field"><div class="label">Projects</div>${list(p.projects, "Not found")}</div>
        <div class="field"><div class="label">Experience</div>${list(p.experience, "No experience listed")}</div>
        <div class="actions" style="margin-top:12px"><button class="btn small" data-act="toggle-cv">${UI.showCv ? "Hide" : "Show"} the CV text</button><span class="small muted">${esc(c.cv_filename)}</span></div>
        ${UI.showCv ? `<div class="cvtext">${esc(c.cv_text)}</div>` : ""}</div>
      <div class="box">${boxHead("Area and score", c.area_source ? byText(c.area_source) : "")}
        <div class="field"><div class="label">Area</div>${c.area ? `<div class="big">${esc(c.area)}</div>` : `<div class="muted">${c.suggested_new_area ? "AI suggested a new area: " + esc(c.suggested_new_area) : "Not chosen yet"}</div>`}</div>
        ${c.area_reasons.length ? `<div class="field"><div class="label">Why</div>${list(c.area_reasons, "")}</div>` : ""}
        ${c.area_evidence.length ? `<div class="field"><div class="label">Evidence from the CV</div>${c.area_evidence.map((e) => `<div class="quote">"${esc(e)}"</div>`).join("")}</div>` : ""}
        ${c.score != null ? `<div class="field"><div class="label">Score (calculated by code)</div>${scoreTable}</div>` : ""}
        ${c.gaps.length ? `<div class="field"><div class="label">Skill gaps</div>${esc(c.gaps.join(", "))}</div>` : ""}</div>
    </div>
    ${hasInterview ? `<div class="box">${boxHead("Interview", c.questions_source ? byText(c.questions_source === "AI" ? "questions by AI" : c.questions_source) : "")}
      <div class="grid two"><div><div class="field"><div class="label">Date and time</div><div>${esc(c.interview_label || "-")}</div></div>
        <div class="field"><div class="label">Result</div><div>${c.result ? `${resultTag(c.result)} <span class="small muted">${esc(fmtTime(c.result_at))} - decided by the interviewer</span>` : `<span class="muted">Not entered yet</span>`}</div></div>
        ${c.result_comment ? `<div class="field"><div class="label">Interviewer's comment</div><div>${esc(c.result_comment)}</div></div>` : ""}</div>
        <div><div class="label">Questions for the interviewer</div>${c.questions.length ? `<ol class="clean">${c.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : `<span class="muted">-</span>`}</div></div></div>` : ""}
    ${c.drafts.length ? `<div class="box" id="emails">${boxHead("Emails", `<span class="small muted">Nothing is sent without your release</span>`)}${c.drafts.slice().reverse().map((d) => mailBlock(d)).join("")}</div>` : ""}
    ${c.work_id ? `<div class="box">${boxHead("Onboarding")}
      <div class="grid two"><div><div class="label">Work ID</div><div class="big">${esc(c.work_id)}</div><div class="small muted">Issued by plain code after the Pass. Never reused.</div></div>
      <div><div class="label">Onboarding checklist</div>${c.checklist.length ? `<ul class="clean">${c.checklist.map((i) => `<li>${esc(i.item)}</li>`).join("")}</ul>` : `<span class="muted">Being prepared</span>`}</div></div></div>` : ""}
    <div class="box">${boxHead("Timeline", `<button class="btn small" data-act="toggle-runs">${UI.showRuns ? "Hide" : "Show"} AI steps</button>`)}
      <table class="t"><thead><tr><th style="width:120px">Time</th><th style="width:170px">Who</th><th>What</th></tr></thead><tbody>
      ${c.events.slice().reverse().map((e) => `<tr><td class="small muted">${esc(fmtTime(e.at))}</td><td>${actorText(e.actor)}</td><td>${esc(e.text)}</td></tr>`).join("")}</tbody></table>
      ${UI.showRuns ? `<table class="t" style="margin-top:12px"><thead><tr><th>Time</th><th>Employee</th><th>Routine</th><th>Outcome</th><th class="num-col">Model calls</th><th class="num-col">Seconds</th></tr></thead><tbody>
        ${c.runs.map((r) => `<tr><td class="small muted">${esc(fmtTime(r.at))}</td><td>${esc(r.employee)}</td><td>${esc(r.routine)}</td><td>${outcomeText(r.outcome)}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ""}</td><td class="num-col">${esc(r.model_calls)}</td><td class="num-col">${esc(r.seconds)}</td></tr>`).join("")}</tbody></table>` : ""}</div>`);
  view.dataset.app = c.app_no;
}
function outcomeText(o) {
  const m = { ok: ["", "Passed checks"], fixed: ["", "Fixed after a check"], fallback: ["", "Fell back to rules"], stopped: ["fail", "Stopped: model not running"], error: ["fail", "Error"] }[o] || ["", o];
  return m[0] ? tag(m[1], m[0]) : esc(m[1]);
}

async function pReview() {
  title("Review queue");
  const r = await api("/api/review");
  const total = r.decisions.length + r.notes.length;
  setView(`${total ? notice("need", `${total} item(s) need you.`, "Decisions first, then quick checks.") : notice("ok", "The review queue is empty.", "Nothing needs a decision right now.")}
    <div class="box">${boxHead("Emails waiting for release")}
      <div class="notice ${r.replies_waiting ? "need" : ""}"><div class="grow"><b>${esc(r.replies_waiting)} email(s) waiting for your release.</b>
        <span class="muted">Invitations, replies and acceptance emails drafted by the AI team. Nothing reaches a candidate until you release it.</span></div><a class="btn" href="#/replies">Open Replies</a></div></div>
    <div class="grid two">
      <div class="box">${boxHead("Decisions for you", `<span class="small muted">${r.decisions.length}</span>`)}
        ${r.decisions.length ? `<table class="t"><thead><tr><th>Candidate</th><th>What to decide</th><th>Status</th></tr></thead><tbody>
          ${r.decisions.map((c) => `<tr class="click" data-href="#/candidate/${encodeURIComponent(c.app_no)}"><td>${esc(c.name)}<div class="small muted">${esc(c.app_no)}</div></td>
            <td>${esc(c.reason)}</td><td>${statusTag(c)}</td></tr>`).join("")}</tbody></table>` : empty("No decisions waiting.")}</div>
      <div class="box">${boxHead("Notes to check", `<span class="small muted">${r.notes.length}</span>`)}
        ${r.notes.length ? `<table class="t"><thead><tr><th>Candidate</th><th>Note</th><th></th></tr></thead><tbody>
          ${r.notes.map((n) => `<tr><td>${esc(n.name)}<div class="small">${candLink(n.app_no)}</div></td><td>${esc(n.text)}<div class="small muted">${esc(n.by)} - ${esc(fmtTime(n.at))}</div></td>
            <td style="text-align:right"><button class="btn small" data-act="resolve" data-app="${esc(n.app_no)}" data-i="${n.index}">Checked</button></td></tr>`).join("")}</tbody></table>` : empty("No notes to check.")}</div>
    </div>
    ${r.suggested_areas.length ? `<div class="box">${boxHead("New areas suggested by the AI")}<table class="t"><thead><tr><th>Area</th><th>Suggested for</th><th></th></tr></thead><tbody>
      ${r.suggested_areas.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.app_nos.join(", "))}</td><td style="text-align:right"><a class="btn small" href="#/areas/new:${encodeURIComponent(s.name)}">Add this area</a></td></tr>`).join("")}</tbody></table></div>` : ""}`);
}

async function pReplies(arg) {
  title("Replies");
  if (arg === "released" || arg === "waiting") UI.repliesTab = arg;
  const drafts = await api(`/api/drafts?state=${UI.repliesTab}`);
  setView(`<div class="box">${boxHead("Emails drafted by the AI team")}
    <div class="filters"><div class="tabs"><button class="${UI.repliesTab === "waiting" ? "on" : ""}" data-act="tab" data-t="waiting">Waiting for release</button><button class="${UI.repliesTab === "released" ? "on" : ""}" data-act="tab" data-t="released">Released</button></div></div>
    <p class="small muted" style="margin-top:0">Read each email, edit it if needed, then release it. In this prototype a released email is saved in the data/outbox folder. Nothing is sent.</p>
    ${drafts.length ? drafts.map((d) => mailBlock(d, { showCandidate: true })).join("") : empty(UI.repliesTab === "waiting" ? "No emails are waiting for release." : "No emails released yet.")}</div>`);
}

async function pAreas(arg) {
  title("Areas");
  const a = UI.areas = await api("/api/areas");
  setView(`${a.suggested.length ? notice("need", "The AI suggested new areas.", "Add one only if your organisation really offers it. " + a.suggested.map((s) => `${s.name} (${s.count})`).join(", ") + ".",
      `<div class="actions">${a.suggested.map((s) => `<button class="btn small" data-act="area-new" data-name="${esc(s.name)}">Add ${esc(s.name)}</button>`).join("")}</div>`) : ""}
    <div class="box">${boxHead("Areas", `<button class="btn primary" data-act="area-new">Add area</button>`)}
      <p class="small muted" style="margin-top:0">The Recruiter chooses from these areas. CVs are scored against the required skills (skills 40, projects 30, education 20, experience 10).</p>
      <table class="t"><thead><tr><th>Area</th><th>Required skills</th><th>Preferred skills</th><th class="num-col">Candidates</th><th>Status</th><th></th></tr></thead><tbody>
      ${a.areas.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="small muted">${esc(x.description || "No description.")}</div><div class="small muted">Added by ${esc(x.added_by)}</div></td>
        <td>${esc(x.required_skills.join(", ") || "-")}</td><td>${esc(x.preferred_skills.join(", ") || "-")}</td>
        <td class="num-col">${esc(x.candidates)}</td><td>${x.active ? "Active" : "Turned off"}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn small" data-act="area-edit" data-id="${x.id}">Edit</button>
          <button class="btn small" data-act="area-toggle" data-id="${x.id}">${x.active ? "Turn off" : "Turn on"}</button></td></tr>`).join("")}</tbody></table></div>`);
  if (arg && arg.startsWith("new:")) { history.replaceState(null, "", "#/areas"); areaForm(null, arg.slice(4)); }
}
function areaForm(area, name = "") {
  const v = area || { name, description: "", required_skills: [], preferred_skills: [], keywords: [], checklist: [] };
  openDialog(`<h3>${area ? "Edit area" : "Add area"}</h3><p class="small muted">Separate skills with commas. Only add an area that your organisation really offers.</p>
    <div class="form-row"><label for="af-name">Name</label><input type="text" id="af-name" value="${esc(v.name)}" maxlength="40"></div>
    <div class="form-row"><label for="af-desc">Description</label><textarea id="af-desc" rows="2" style="min-height:50px">${esc(v.description)}</textarea></div>
    <div class="form-row"><label for="af-req">Required skills</label><input type="text" id="af-req" value="${esc(v.required_skills.join(", "))}" placeholder="For example: Recruitment, Interviewing, Excel"><div class="help">Used for the score. At least one.</div></div>
    <div class="form-row"><label for="af-pref">Preferred skills</label><input type="text" id="af-pref" value="${esc(v.preferred_skills.join(", "))}"></div>
    <div class="form-row"><label for="af-kw">Keywords for related projects</label><input type="text" id="af-kw" value="${esc(v.keywords.join(", "))}"></div>
    <div class="form-row"><label for="af-check">Extra onboarding checklist items (one per line)</label><textarea id="af-check" rows="3" style="min-height:60px">${esc(v.checklist.join("\n"))}</textarea></div>
    <div class="actions"><button class="btn" data-dlg="cancel">Cancel</button><button class="btn primary" data-dlg="save">Save area</button></div>`);
  const d = $("#dialog");
  d.querySelector('[data-dlg="cancel"]').onclick = closeDialog;
  d.querySelector('[data-dlg="save"]').onclick = async () => {
    const body = { name: $("#af-name").value, description: $("#af-desc").value, required_skills: $("#af-req").value,
      preferred_skills: $("#af-pref").value, keywords: $("#af-kw").value, checklist: $("#af-check").value, active: area ? area.active : true };
    try {
      if (area) await api(`/api/areas/${area.id}`, { method: "PUT", body });
      else await api("/api/areas", { method: "POST", body });
      closeDialog(); toast(`Saved the area ${body.name}.`); UI.areas = null; lastHTML = ""; render();
    } catch (e) { toast(e.message, true); }
  };
}

async function pTeam() {
  title("AI team");
  const t = await api("/api/team");
  const down = !t.model.ok || (t.notice && t.notice.text);
  setView(`${notice(down ? "error" : "ok", down ? "The model server is not running, so the AI team is waiting." : t.paused ? "The AI team is paused." : "Four AI employees work on their own schedule.",
      "Each one is a folder of Markdown files (ROLE, SCHEDULE, RELEASES and one SKILL file per routine). The status of a candidate hands the work from one to the next.",
      ROLE === "hr" ? `<div class="actions"><button class="btn primary" data-act="run" data-who="all">Run all now</button><button class="btn" data-act="pause" data-p="${t.paused ? "0" : "1"}">${t.paused ? "Resume" : "Pause"}</button></div>` : "")}
    <div class="grid two">${t.employees.map((e) => `<div class="box emp">
      ${boxHead(e.name, `<span>${t.paused ? "Paused" : e.state === "working" ? "Working: " + esc(e.doing) : "Ready"}</span>`)}
      <div class="small muted">${esc((e.schedule.text || "").split("\n")[0])}${e.next_run ? " - next run " + esc(fmtTime(e.next_run)) : ""}</div>
      <p>${esc(e.summary)}</p>
      <p class="small">Last 24 hours: ${esc(e.day.ok)} passed checks, ${esc(e.day.fixed)} fixed, ${esc(e.day.fallback)} fell back to rules${e.day.error || e.day.stopped ? `, ${tag((e.day.error + e.day.stopped) + " stopped", "fail")}` : ""}.</p>
      <div class="label">Routines</div>
      <table class="t"><thead><tr><th>Routine</th><th>Done by</th><th>Starts when</th></tr></thead><tbody>
        ${e.routines.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.uses_model ? "Model + checks" : "Plain code"}</td><td class="small muted">${esc(r.starts_when || "-")}</td></tr>`).join("")}</tbody></table>
      ${e.lessons.length ? `<div class="label" style="margin-top:12px">What it has learned</div><ul class="clean small">${e.lessons.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      <div class="label" style="margin-top:12px">Recent steps</div>
      ${e.runs.length ? `<table class="t"><thead><tr><th>Time</th><th>Routine</th><th>Outcome</th><th class="num-col">Seconds</th></tr></thead><tbody>
        ${e.runs.slice(0, 5).map((r) => `<tr><td class="small muted">${esc(fmtTime(r.at))}</td><td>${esc(r.routine)}</td><td>${outcomeText(r.outcome)}</td><td class="num-col">${esc(r.seconds)}</td></tr>`).join("")}</tbody></table>` : `<span class="muted small">No runs yet.</span>`}
      ${ROLE === "hr" ? `<div class="actions" style="margin-top:12px"><button class="btn small" data-act="run" data-who="${esc(e.key)}">Run ${esc(e.name)} now</button></div>` : ""}
    </div>`).join("")}</div>`);
}

// ================================================================ Interviewer pages
async function pInterviews() {
  title("Interviews");
  const r = await api("/api/interviews");
  const LIMIT = 5;
  const table = (items, key, click, none, last) => {
    if (!items.length) return empty(none);
    const all = UI.showAll === key;
    const rows = (all ? items : items.slice(0, LIMIT)).map((c) => `<tr ${click ? `class="click" data-href="#/interview/${encodeURIComponent(c.app_no)}"` : ""}>
      <td>${esc(c.name)}<div class="small muted">${esc(c.app_no)}</div></td><td class="small">${esc(c.interview_label || "-")}</td><td>${esc(c.area)}</td>
      <td style="white-space:nowrap">${last === "result" ? resultTag(c.result) : last === "released" ? `<span class="small muted">Not released</span>` : esc(c.score ?? "-")}</td></tr>`).join("");
    const head = `<thead><tr><th>Candidate</th><th>Interview</th><th>Area</th><th>${last === "result" ? "Result" : last === "released" ? "Invitation" : "Score"}</th></tr></thead>`;
    const btn = items.length > LIMIT ? `<button class="btn link small" data-act="show-all" data-k="${all ? "" : key}" style="margin-top:8px">${all ? "Show fewer" : "Show all " + items.length}</button>` : "";
    return `<table class="t">${head}<tbody>${rows}</tbody></table>${btn}`;
  };
  setView(`${r.waiting.length ? notice("need", `${r.waiting.length} interview(s) are waiting for your result.`, "Open one, do the interview and enter Pass, Fail or Hold.")
      : notice("ok", "No results are waiting for you.", `${r.on_hold.length} on hold. Your result is final; the AI cannot change it.`)}
    <div class="grid two even">
      <div class="box">${boxHead("Waiting for your result", `<span class="small muted">${r.waiting.length}</span>`)}${table(r.waiting, "waiting", true, "Nothing waiting.", "score")}</div>
      <div class="box">${boxHead("Coming up", `<span class="small muted">${r.invitation_not_released.length}, invitation not released yet</span>`)}${table(r.invitation_not_released, "coming", false, "None.", "released")}</div>
      <div class="box">${boxHead("On hold", `<span class="small muted">${r.on_hold.length}</span>`)}${table(r.on_hold, "hold", true, "No one is on hold.", "result")}</div>
      <div class="box">${boxHead("Your recent results")}${table(r.done, "done", false, "No results yet.", "result")}</div>
    </div>`);
}

async function pInterview(appNo) {
  title("Interview");
  const c = await api(`/api/candidates/${encodeURIComponent(appNo)}`);
  const p = c.profile || {};
  const open = c.status === "awaiting_result" || c.status === "on_hold";
  const form = open ? `<div class="result-pick">
      <label class="pass"><input type="radio" name="result" value="Pass"><b>Pass</b> <span class="small muted">Make an offer</span></label>
      <label class="fail"><input type="radio" name="result" value="Fail"><b>Fail</b> <span class="small muted">No offer</span></label>
      ${c.status === "awaiting_result" ? `<label class="hold"><input type="radio" name="result" value="Hold"><b>Hold</b> <span class="small muted">Decide later</span></label>` : ""}</div>
    <div class="form-row" style="margin-top:12px"><label for="result-comment">Comment (optional)</label><textarea id="result-comment" rows="4" placeholder="Short notes for the HR officer. Not sent to the candidate."></textarea></div>
    <div class="actions" style="margin-top:12px"><button class="btn primary" data-act="save-result">Save result</button><span class="small muted">The AI team takes over after you save.</span></div>`
    : c.result ? `<p>${resultTag(c.result)}</p><p class="muted">Saved ${esc(fmtTime(c.result_at))}. ${c.result_comment ? "Comment: " + esc(c.result_comment) : ""}</p><p class="small muted">Now: ${esc(c.status_label)}.</p>`
    : `<p class="muted">The result can be entered after the HR officer releases the invitation.</p>`;
  setView(`<a class="back" href="#/interviews">&larr; All interviews</a>
    <div class="box"><div class="box-head"><h2 style="font-size:18px">${esc(c.name)}</h2><div class="spacer"></div><span class="small muted">${esc(c.interview_label || "")}</span></div>
      <div class="actions">${esc(c.app_no)} ${statusTag(c)} <span>Area: ${esc(c.area)}</span>${c.score != null ? ` <span>Score: ${esc(c.score)}/100</span>` : ""}</div></div>
    <div class="grid two">
      <div class="stack">
        <div class="box">${boxHead("Questions to ask", c.questions_source ? byText(c.questions_source === "AI" ? "prepared by AI" : c.questions_source) : "")}
          ${c.questions.length ? `<ol class="clean">${c.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>` : `<span class="muted">No questions prepared.</span>`}</div>
        <div class="box">${boxHead("About the candidate", `<a class="btn small" href="/api/candidates/${encodeURIComponent(c.app_no)}/cv">Download CV</a>`)}
          <div class="field"><div class="label">Education</div>${(p.education || []).map((x) => `<div>${esc(x)}</div>`).join("") || "-"}</div>
          <div class="field"><div class="label">Skills</div>${esc((p.skills || []).join(", ") || "-")}</div>
          <div class="field"><div class="label">Projects</div><ul class="clean">${(p.projects || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>-</li>"}</ul></div>
          ${c.gaps.length ? `<div class="field"><div class="label">Skill gaps for ${esc(c.area)}</div>${esc(c.gaps.join(", "))}</div>` : ""}</div>
      </div>
      <div class="box">${boxHead("Your result")}${form}</div>
    </div>`);
}

// ================================================================ actions (one click handler for every button)
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg); lastHTML = ""; await refreshState(); await render(); }
  catch (e) { toast(e.message, true); }
}
const ACTS = {
  "brief": () => act(() => api("/api/brief", { method: "POST" }), "The Chief of staff is writing the brief. It appears here in a moment."),
  "remove-file": (b) => { UI.files.splice(+b.dataset.i, 1); lastHTML = ""; pAdd(); },
  "clear-files": () => { UI.files = []; UI.uploadResults = null; lastHTML = ""; pAdd(); },
  "upload": async (b) => {
    const form = new FormData();
    UI.files.forEach((f) => form.append("files", f, f.name));
    const email = $("#cv-email");
    if (email && !email.disabled && email.value.trim()) form.append("email", email.value.trim());
    b.disabled = true;
    try {
      const r = await api("/api/cvs", { method: "POST", form });
      UI.uploadResults = r.results; UI.files = [];
      const ok = r.results.filter((x) => x.ok).length;
      toast(ok ? `${ok} CV(s) added. The Recruiter will read them now.` : "No CV was added.", !ok);
    } catch (e) { toast(e.message, true); }
    lastHTML = ""; refreshState(); pAdd();
  },
  "samples": () => act(async () => { const r = await api("/api/samples", { method: "POST" }); UI.uploadResults = r.results; return r; },
    (r) => `${r.results.filter((x) => x.ok).length} sample CV(s) added.`),
  "filter": (b) => { UI.candFilter = b.dataset.f; history.replaceState(null, "", "#/candidates"); lastHTML = ""; pCandidates(); },
  "show-all": (b) => { UI.showAll = b.dataset.k; lastHTML = ""; render(); },
  "tab": (b) => { UI.repliesTab = b.dataset.t; lastHTML = ""; pReplies(); },
  "toggle-cv": () => { UI.showCv = !UI.showCv; lastHTML = ""; render(); },
  "toggle-runs": () => { UI.showRuns = !UI.showRuns; lastHTML = ""; render(); },
  "edit-email": () => { UI.editEmail = true; lastHTML = ""; render().then(() => $("#email-input")?.focus()); },
  "cancel-email": () => { UI.editEmail = false; lastHTML = ""; render(); },
  "save-email": () => act(async () => { await api(`/api/candidates/${encodeURIComponent(current.arg)}/email`, { method: "POST", body: { email: $("#email-input").value } }); UI.editEmail = false; }, "Email saved."),
  "set-area": () => act(() => api(`/api/candidates/${encodeURIComponent(current.arg)}/area`, { method: "POST", body: { area: $("#area-pick").value } }),
    (r) => `Area saved. Score ${r.score}/100.`),
  "decide": async (b) => {
    const d = b.dataset.d;
    const text = { shortlist: ["Shortlist this candidate?", "The Coordinator will book an interview and draft the invitation for you to release.", "Shortlist"],
      not_shortlist: ["Mark as Not shortlisted?", "The Coordinator will draft a polite reply for you to release.", "Not shortlisted"],
      confirm: ["Confirm Not shortlisted?", "The Coordinator will draft a polite reply for you to release.", "Confirm"] }[d];
    if (!(await confirmBox({ heading: text[0], text: text[1], ok: text[2] }))) return;
    act(() => api(`/api/candidates/${encodeURIComponent(current.arg)}/decision`, { method: "POST", body: { decision: d } }), "Saved. The AI team takes it from here.");
  },
  "retry": () => act(() => api(`/api/candidates/${encodeURIComponent(current.arg)}/retry`, { method: "POST" }), "Sent back to the Recruiter."),
  "close": async () => {
    if (!(await confirmBox({ heading: "Close this application?", text: "No reply will be drafted. You can still see it under Closed.", ok: "Close application", danger: true }))) return;
    act(() => api(`/api/candidates/${encodeURIComponent(current.arg)}/close`, { method: "POST" }), "Application closed.");
  },
  "resolve": (b) => act(() => api(`/api/candidates/${encodeURIComponent(b.dataset.app || current.arg)}/flags/${b.dataset.i}/resolve`, { method: "POST" }), "Marked as checked."),
  "edit-draft": (b) => { UI.editDraft = +b.dataset.id; lastHTML = ""; render(); },
  "cancel-edit": () => { UI.editDraft = null; lastHTML = ""; render(); },
  "save-draft": async (b) => {
    try {
      const r = await api(`/api/drafts/${b.dataset.id}`, { method: "POST", body: { subject: $("#ed-subject").value, body: $("#ed-body").value } });
      UI.editDraft = null;
      toast(r.check_notes.length ? "Saved, but please read the warnings above the email." : "Saved.", r.check_notes.length > 0);
    } catch (e) { toast(e.message, true); }
    lastHTML = ""; render();
  },
  "release": async (b) => {
    if (!(await confirmBox({ heading: `Release the ${b.dataset.kind}?`, text: `To ${b.dataset.name}. In this prototype the email is saved to the outbox folder, not sent.`, ok: "Release" }))) return;
    act(() => api(`/api/drafts/${b.dataset.id}/release`, { method: "POST" }), "Released.");
  },
  "jump": (b, e) => { e.preventDefault(); $("#emails")?.scrollIntoView({ behavior: "smooth" }); },
  "area-new": (b) => areaForm(null, b.dataset.name || ""),
  "area-edit": (b) => areaForm(UI.areas.areas.find((x) => x.id === +b.dataset.id)),
  "area-toggle": async (b) => {
    const a = UI.areas.areas.find((x) => x.id === +b.dataset.id);
    act(() => api(`/api/areas/${a.id}`, { method: "PUT", body: { ...a, required_skills: a.required_skills, active: !a.active } }), a.active ? `${a.name} turned off.` : `${a.name} turned on.`);
  },
  "run": (b) => act(() => api("/api/run", { method: "POST", body: { employee: b.dataset.who } }), "Started. Watch the status update."),
  "pause": (b) => act(() => api("/api/pause", { method: "POST", body: { paused: b.dataset.p === "1" } }), b.dataset.p === "1" ? "The AI team is paused." : "The AI team is working again."),
  "save-result": async () => {
    const picked = document.querySelector('input[name="result"]:checked');
    if (!picked) { toast("Choose Pass, Fail or Hold first.", true); return; }
    const comment = $("#result-comment").value;
    const words = { Pass: "The Onboarding employee will issue a work ID and draft the acceptance email.", Fail: "The Coordinator will draft a polite reply.", Hold: "The Coordinator will draft a short hold note." }[picked.value];
    if (!(await confirmBox({ heading: `Save the result: ${picked.value}?`, text: `${words} The AI team cannot change your result.`, ok: `Save ${picked.value}` }))) return;
    act(() => api(`/api/candidates/${encodeURIComponent(current.arg)}/result`, { method: "POST", body: { result: picked.value, comment } }), "Result saved.");
  },
};
view.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b && !b.disabled) { ACTS[b.dataset.act]?.(b, e); return; }
  if (e.target.closest("a, button, input, select, textarea, label")) return;
  const row = e.target.closest("[data-href]");
  if (row) location.hash = row.dataset.href;
});

// ================================================================ router
const ROUTES = {
  hr: { dashboard: pDashboard, add: pAdd, candidates: pCandidates, candidate: pCandidate, review: pReview, replies: pReplies, areas: pAreas, team: pTeam },
  interviewer: { interviews: pInterviews, interview: pInterview, team: pTeam, candidate: pCandidate },
};
const AUTO = new Set(["dashboard", "candidates", "candidate", "review", "replies", "team", "interviews", "interview"]);
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const i = h.indexOf("/");
  return i < 0 ? { page: h, arg: "" } : { page: h.slice(0, i), arg: decodeURIComponent(h.slice(i + 1)) };
}
let rendering = false;
async function render() {
  const { page, arg } = parseHash();
  const fn = ROUTES[ROLE][page];
  if (!fn) { location.replace(HOME[ROLE]); return; }
  if (page !== current.page || arg !== current.arg) { UI.showCv = false; UI.showRuns = false; UI.editDraft = null; UI.editEmail = false; lastHTML = ""; window.scrollTo(0, 0); }
  current = { page, arg };
  renderFrame();
  rendering = true;
  try { await fn(arg); }
  catch (e) { setView(`<div class="box">${empty(e.message)}<a class="btn" href="${HOME[ROLE]}">Back to start</a></div>`); }
  finally { rendering = false; }
}
window.addEventListener("hashchange", render);

async function tick() {
  await refreshState();
  if (!rendering && AUTO.has(current.page) && !busy()) {
    try { await ROUTES[ROLE][current.page]?.(current.arg); } catch { /* keep the page as it is */ }
  }
}
(async function start() {
  await refreshState();
  await render();
  setInterval(tick, 5000);
})();
