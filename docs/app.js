/* 1Yard portal — live site. Data lives in Supabase (see supabase/schema.sql). */
const CFG = window.ONEYARD_CONFIG || {};
const sb = CFG.supabaseUrl ? supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

/* ============ CONFIG ============ */
const SEASON = { label: "Fall 2026 services are open" };
// Swap this list (and SEASON) for winter: snow shovelling, salting walkways, etc.
const SERVICES = [
  { id: "leaves",  name: "Raking leaves",              em: "🍂", hint: "Rake and bag fallen leaves",       skills: ["raking"],  tools: ["rake", "bags"] },
  { id: "mow",     name: "Last lawn mow",              em: "🌱", hint: "One final cut before winter",      skills: ["mower"],   tools: ["mower"] },
  { id: "garden",  name: "Garden bed clean-up",        em: "🌼", hint: "Cut back plants, pull dead ones",  skills: ["garden"],  tools: ["shears", "bags"] },
  { id: "debris",  name: "Branches and yard debris",   em: "🪵", hint: "Pick up and bag sticks, branches", skills: ["lifting"], tools: ["bags", "wheelbarrow"] },
  { id: "general", name: "Other yard help / not sure", em: "🧤", hint: "Tell us more on a later step",     skills: [],          tools: ["rake", "bags"] },
];
const SKILLS = { raking: "Raking and bagging", mower: "Using a lawn mower", garden: "Garden care (knows weeds from plants)", lifting: "Lifting and carrying heavy loads" };
const TOOLS = { rake: { name: "Rake", em: "🧹" }, bags: { name: "Yard waste bags", em: "🛍️" }, mower: { name: "Lawn mower", em: "🚜" }, shears: { name: "Garden clippers", em: "✂️" }, wheelbarrow: { name: "Wheelbarrow", em: "🛒" } };
const FLAGS = { pet: { name: "A pet may be in the yard", em: "🐕" }, gate: { name: "The gate is locked", em: "🔒" }, slope: { name: "The ground is steep or bumpy", em: "⛰️" } };
const PARTS = { am: { name: "Morning", range: "9am–12pm", from: 9, to: 12 }, pm: { name: "Afternoon", range: "1pm–6pm", from: 13, to: 18 }, any: { name: "Either", range: "9am–6pm", from: 9, to: 18 } };
const MIN_DAYS = 2, MAX_DAYS = 4;
const CONTACT = { phone: "Phone call", email: "Email", either: "Either is fine" };
const UNIS = ["Queen's University", "Royal Military College", "Other university"];
const YEARS = ["1st year", "2nd year", "3rd year", "4th year+", "Grad student"];
const AVAIL = ["Weekday afternoons", "Weekday evenings", "Weekends"];
const TRAINING = CFG.training || [];
const SHADOW_SHIFTS_NEEDED = 2;
const OFFICE_PHONE = CFG.officePhone || "";
const TOKENS_KEY = "1yard-my-requests";

/* ============ STATE ============ */
let S = {
  view: "loading", me: null, volunteers: [], clients: [], jobs: [], signups: [], myShadow: 0,
  adminTab: "calls", jobFilter: "upcoming", boardFilter: "all",
  wiz: null, confirm: null, editing: null, resched: null, picking: null,
  token: null, request: null, justSent: false, notice: "", busy: false,
};

/* ============ HELPERS ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => new Date().toISOString();
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 6e4); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + "h ago"; const d = Math.round(h / 24); return d + (d === 1 ? " day ago" : " days ago"); };
const day = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const today = () => day(0);
const fmtDate = (iso, long) => new Date(iso + "T12:00").toLocaleDateString("en-CA", long ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" });
const fmtTime = (t) => { const [h, m] = t.split(":").map(Number); return ((h + 11) % 12 + 1) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? "am" : "pm"); };
const first = (name) => String(name || "").split(" ")[0];
const vol = (id) => S.volunteers.find((v) => v.id === id);
const client = (id) => S.clients.find((c) => c.id === id);
const job = (id) => S.jobs.find((j) => j.id === id);
const crew = (jobId) => S.signups.filter((s) => s.jobId === jobId).sort((a, b) => a.at.localeCompare(b.at));
const svc = (id) => SERVICES.find((s) => s.id === id) || { name: id, em: "", skills: [], tools: [] };
const jobTitle = (j) => j.services.map((s) => svc(s).name).join(" + ");
const neededTools = (services) => [...new Set(services.flatMap((s) => svc(s).tools))];
const neededSkills = (services) => [...new Set(services.flatMap((s) => svc(s).skills))];
const missingTools = (j) => neededTools(j.services).filter((t) => !j.tools[t]);
const needsExperienced = (j) => { const c = crew(j.id); return c.length === 1 && c[0].asTrainee; };
const isFull = (j) => crew(j.id).length >= 2;
const canSeeBoard = (v) => v && (v.status === "trainee" || v.status === "experienced");
const liveWindows = (j) => (j.windows || []).filter((x) => x.date > today()).sort((a, b) => a.date.localeCompare(b.date));
const windowText = (x) => `${fmtDate(x.date)} · ${PARTS[x.part].name.toLowerCase()} (${PARTS[x.part].range})`;
const isLocked = (j) => !!j.date && !!j.start && crew(j.id).length > 0;
const whenText = (j, long) => `${fmtDate(j.date, long)} at ${fmtTime(j.start)}`;
const needsNewDates = (j) => j.status === "scheduled" && !isFull(j) && (isLocked(j) ? j.date <= today() : liveWindows(j).length === 0);
const sortKey = (j) => (isLocked(j) || j.status === "done" ? (j.date || "") + (j.start || "").padStart(5, "0") : liveWindows(j)[0]?.date || j.windows?.[0]?.date || "");
function startTimes(part, hours) {
  const p = PARTS[part], out = [], last = Math.max(p.from * 60, p.to * 60 - hours * 60);
  for (let t = p.from * 60; t <= last; t += 30) out.push(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`);
  return out;
}
const timeChoices = (j, cur) => liveWindows(j).map((x) => `<optgroup label="${windowText(x)}">${startTimes(x.part, j.hours).map((t) => `<option value="${x.date}|${t}" ${cur === x.date + "|" + t ? "selected" : ""}>${fmtDate(x.date)} · ${fmtTime(t)}</option>`).join("")}</optgroup>`).join("");
const callItems = () => S.jobs.filter((j) => j.status === "scheduled").flatMap((j) => isFull(j) && !j.toldAt ? [{ j, kind: "tell" }] : needsNewDates(j) ? [{ j, kind: "dates" }] : []);
function windowRows(prefix, wins) {
  return `<div class="winrows">${[0, 1, 2, 3].map((i) => { const x = wins[i] || {}; return `<div class="row"><input type="date" id="${prefix}-date-${i}" value="${x.date || ""}" aria-label="Date option ${i + 1}"><select id="${prefix}-part-${i}" aria-label="Time of day ${i + 1}">${Object.entries(PARTS).map(([k, p]) => `<option value="${k}" ${k === (x.part || "any") ? "selected" : ""}>${p.name} (${p.range})</option>`).join("")}</select></div>`; }).join("")}</div>`;
}
function readWindows(prefix) {
  const out = [];
  for (let i = 0; i < 4; i++) { const date = $(`#${prefix}-date-${i}`)?.value; if (date && !out.some((x) => x.date === date)) out.push({ date, part: $(`#${prefix}-part-${i}`).value }); }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
// Admin-side counts (the server has the same logic in shadow_count / jobs_done).
function shadowCount(vid) {
  return S.signups.filter((s) => s.vid === vid && s.asTrainee && job(s.jobId)?.status === "done" &&
    S.signups.some((p) => p.jobId === s.jobId && p.vid !== vid && !p.asTrainee)).length;
}
const jobsDone = (vid) => S.signups.filter((s) => s.vid === vid && job(s.jobId)?.status === "done").length;
// Mirrors join_job() on the server, so buttons show the right state. The server has the final say.
function canJoin(v, j) {
  const c = crew(j.id);
  if (!canSeeBoard(v)) return { ok: false, why: "Finish training first" };
  if (j.status !== "scheduled") return { ok: false, why: "Not open" };
  if (c.some((s) => s.vid === v.id)) return { ok: false, why: "You're on this job" };
  if (c.length >= 2) return { ok: false, why: "Full" };
  if (needsNewDates(j)) return { ok: false, why: "Waiting on new dates" };
  if (v.status === "trainee" && c.some((s) => s.asTrainee)) return { ok: false, why: "Experienced volunteers only" };
  return { ok: true };
}
const V_STATUS = { pending: ["Waiting for review", "c-amber"], approved: ["Approved · doing training", "c-sky"], trainee: ["Trainee", "c-sky"], experienced: ["Experienced", "c-green"], declined: ["Declined", "c-rose"] };
const vChip = (s) => `<span class="chip ${V_STATUS[s][1]}">${V_STATUS[s][0]}</span>`;
function jobState(j) {
  if (j.status === "review") return ["New request", "c-amber"];
  if (j.status === "declined") return ["Declined", "c-rose"];
  if (j.status === "cancelled") return ["Cancelled", "c-grey"];
  if (j.status === "done") return ["Done", "c-green"];
  const n = crew(j.id).length;
  if (needsNewDates(j)) return ["Needs new dates", "c-rose"];
  if (n >= 2) return j.toldAt ? ["Crew confirmed · client told", "c-green"] : ["Crew confirmed · call client", "c-amber"];
  if (needsExperienced(j)) return ["Needs experienced volunteer", "c-amber"];
  return [n === 0 ? "Needs 2 volunteers" : "Needs 1 volunteer", "c-sky"];
}
const jChip = (j) => { const [t, c] = jobState(j); return `<span class="chip ${c}">${t}</span>`; };
function slots(j) {
  const c = crew(j.id);
  return `<div class="slots">${[0, 1].map((i) => {
    const s = c[i];
    if (s) return `<div class="slot ${s.asTrainee ? "trainee" : "exp"}"><b>${esc(vol(s.vid)?.name)}</b>${s.asTrainee ? "Trainee" : "Experienced"}</div>`;
    if (needsExperienced(j)) return `<div class="slot empty exp-only"><b>Open spot</b>Experienced only</div>`;
    return `<div class="slot empty"><b>Open spot</b>Anyone trained</div>`;
  }).join("")}</div>`;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3500); }
const myTokens = () => { try { return JSON.parse(localStorage.getItem(TOKENS_KEY)) || []; } catch { return []; } };
const rememberToken = (t) => { try { localStorage.setItem(TOKENS_KEY, JSON.stringify([t, ...myTokens().filter((x) => x !== t)].slice(0, 5))); } catch {} };

/* ============ DATA (Supabase) ============ */
const mapProfile = (p) => ({ id: p.id, role: p.role, name: p.name, email: p.email, phone: p.phone, uni: p.university, year: p.year, skills: p.skills || [], avail: p.availability || [], why: p.why, status: p.status, appliedAt: p.applied_at, reviewedAt: p.reviewed_at, trainedAt: p.trained_at, promotedAt: p.promoted_at, waiverPath: p.waiver_path });
const mapClient = (c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, contact: c.contact, address: c.address, postal: c.postal, area: c.area });
const mapJob = (j) => ({ id: j.id, clientId: j.client_id, services: j.services, tools: j.tools || {}, flags: j.flags || [], notes: j.notes || "", windows: j.windows || [], status: j.status, date: j.date, start: j.start_time, hours: j.hours, createdAt: j.created_at, toldAt: j.told_at, attempts: j.attempts, lastAttemptAt: j.last_attempt_at, timeChangedAt: j.time_changed_at, publishedAt: j.published_at, doneAt: j.done_at, editedAt: j.edited_at });
const mapSignup = (s) => ({ id: s.id, jobId: s.job_id, vid: s.volunteer_id, asTrainee: s.as_trainee, at: s.created_at });
const must = ({ data, error }) => { if (error) throw error; return data; };

async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { S.me = null; return; }
  const p = must(await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle());
  S.me = p ? mapProfile(p) : null;
}
async function loadAdmin() {
  const [p, c, j, s] = await Promise.all([sb.from("profiles").select("*"), sb.from("clients").select("*"), sb.from("jobs").select("*"), sb.from("job_signups").select("*")]);
  S.volunteers = must(p).map(mapProfile); S.clients = must(c).map(mapClient); S.jobs = must(j).map(mapJob); S.signups = must(s).map(mapSignup);
}
// The volunteer board comes from one server function that only returns what this volunteer may see.
async function loadBoard() {
  S.jobs = []; S.clients = []; S.signups = []; S.volunteers = [S.me];
  if (!canSeeBoard(S.me)) return;
  const data = must(await sb.rpc("volunteer_board"));
  S.myShadow = data.shadow_count;
  for (const b of data.jobs) {
    const cid = "c-" + b.id;
    S.clients.push({ id: cid, name: b.client_name || "", phone: b.client_phone || "", address: b.address || "", postal: b.postal || "", area: b.area });
    S.jobs.push({ id: b.id, clientId: cid, services: b.services, tools: b.tools || {}, flags: b.flags || [], notes: b.notes || "", windows: b.windows || [], status: b.status, date: b.date, start: b.start_time, hours: b.hours, timeChangedAt: b.time_changed_at, createdAt: b.created_at });
    for (const m of b.crew) {
      S.signups.push({ id: b.id + m.id, jobId: b.id, vid: m.id, asTrainee: m.as_trainee, at: m.at });
      const known = vol(m.id);
      if (!known) S.volunteers.push({ id: m.id, name: m.name, phone: m.phone || "", email: m.email || "" });
      else if (m.phone && known !== S.me) Object.assign(known, { phone: m.phone, email: m.email });
    }
  }
}
async function loadRequest() { S.request = /^[0-9a-f-]{36}$/i.test(S.token || "") ? must(await sb.rpc("get_request", { tok: S.token })) : null; }
async function refresh() {
  if (S.view === "admin") await loadAdmin();
  else if (S.view === "volunteer") { await loadMe(); await loadBoard(); }
  else if (S.view === "request") await loadRequest();
}
async function goHome() {
  S.wiz = null; S.confirm = null; S.editing = null; S.resched = null; S.picking = null;
  if (S.me) { S.view = S.me.role === "admin" ? "admin" : "volunteer"; await refresh(); }
  else S.view = "home";
}

/* ============ RENDER ============ */
function render() {
  $("#season").textContent = `🍂 ${SEASON.label} · Kingston · Outdoor work only`;
  $("#nav").innerHTML = S.me
    ? `<span class="small muted">${esc(first(S.me.name))}${S.me.role === "admin" ? " · admin" : ""}</span><button class="btn ghost" data-act="logout">Log out</button>`
    : S.view !== "login" && S.view !== "signup" ? `<button class="btn ghost" data-act="go" data-id="login">Volunteer log in</button>` : "";
  const app = $("#app");
  const clientish = ["home", "wizard", "request"].includes(S.view);
  app.className = "wrap" + (clientish ? " narrow client" : S.view === "login" || S.view === "signup" ? " narrow" : "");
  const views = { loading: () => `<div class="loading">Loading…</div>`, setup: setupView, home: homeView, wizard: wizardView, request: requestView, login: loginView, signup: signupView, volunteer: volunteerView, admin: adminView };
  app.innerHTML = (S.notice ? `<div class="note">${S.notice}</div>` : "") + (views[S.view] || homeView)() +
    `<footer><p class="small muted">1Yard · volunteer yard help in Kingston, ON${OFFICE_PHONE ? ` · ${esc(OFFICE_PHONE)}` : ""}</p></footer>`;
}
const setupView = () => `<div class="card stack"><h2>Almost there</h2><p>Add your Supabase URL and key to <code>docs/config.js</code> to turn the site on. See README.md.</p></div>`;

/* ---------------- PUBLIC HOME ---------------- */
function homeView() {
  const saved = myTokens();
  return `<div class="stack" style="gap:18px">
    <h1>Need help with your yard?</h1>
    <p>1Yard's university student volunteers help seniors and people with physical limitations in Kingston with outdoor yard work. It's free.</p>
    <div class="card stack">
      <p>🍂 Raking leaves, garden clean-up, last lawn mow, and picking up branches.</p>
      <p>🧤 Two volunteers come together. They bring gloves and use your tools.</p>
      <p>🏡 We only work outside. We never need to come into your home.</p>
    </div>
    <button class="bigbtn" data-act="wizStart">Ask for help</button>
    ${saved.length ? `<button class="bigbtn ghost" data-act="openRequest" data-id="${esc(saved[0])}">See my request</button>` : ""}
    ${OFFICE_PHONE ? `<p class="muted" style="text-align:center">Prefer to talk? Call us at <b>${esc(OFFICE_PHONE)}</b></p>` : ""}
    <div class="card home-vol" style="margin-top:20px">
      <div><h3>University student? Volunteer with 1Yard.</h3><p class="small muted">Help neighbours with yard work around your classes. You pick the jobs and times.</p></div>
      <div class="row"><button class="btn" data-act="go" data-id="signup">Apply</button><button class="btn ghost" data-act="go" data-id="login">Log in</button></div>
    </div>
  </div>`;
}

/* ---------------- CLIENT: status page (private link) ---------------- */
function requestView() {
  const r = S.request;
  if (!r) return `<div class="stack"><h1>We couldn't find that request</h1><p>The link may be wrong.${OFFICE_PHONE ? ` Please call us at <b>${esc(OFFICE_PHONE)}</b>.` : ""}</p><button class="bigbtn" data-act="go" data-id="home">Go to the home page</button></div>`;
  const crewNames = r.crew || [], full = crewNames.length >= 2, active = r.status === "review" || r.status === "scheduled";
  const wins = (r.windows || []).filter((x) => x.date > today()).sort((a, b) => a.date.localeCompare(b.date));
  let step = 1, msg = "";
  if (r.status === "review") msg = "We got your request. We'll call you soon to check the details.";
  else if (r.status === "scheduled" && r.needs_new_dates) { step = 2; msg = "We couldn't find volunteers for your days. We'll call you to pick new ones."; }
  else if (r.status === "scheduled" && !full) { step = 2; msg = `We're finding 2 volunteers for one of your days:<ul class="wins" style="margin-top:6px;font-size:1rem">${wins.map((x) => `<li>${fmtDate(x.date, true)}, ${PARTS[x.part].name.toLowerCase()}</li>`).join("")}</ul>`; }
  else if (r.status === "scheduled") { step = 3; msg = `<b>${crewNames.map(esc).join(" and ")}</b> will come on <b>${fmtDate(r.date, true)} at ${fmtTime(r.start_time)}</b>.`; }
  else if (r.status === "done") { step = 4; msg = `All done on ${fmtDate(r.date, true)}. Thank you for letting us help!`; }
  else if (r.status === "declined") { step = 0; msg = "We can't help with this request right now. We'll call you to explain."; }
  else { step = 0; msg = "This request was cancelled."; }
  const tools = neededTools(r.services).filter((t) => r.tools?.[t]);
  return `<div class="stack" style="gap:18px">
    ${S.justSent ? `<div class="thanks"><h2>Thank you, ${esc(r.client_name)}!</h2><p>We got your request. Someone from 1Yard will ${r.contact === "email" ? "email" : "call"} you soon to check the details.</p></div>
      <div class="linkbox"><b>Keep this page to check on your request</b><span class="small">Bookmark it, or copy the link below. We'll also ${r.contact === "email" ? "email" : "call"} you, so don't worry if you lose it.</span>
        <input type="text" id="mylink" readonly value="${esc(location.href)}" aria-label="Your request link"><button class="btn" data-act="copyLink">Copy link</button></div>`
      : `<h1>Hello, ${esc(r.client_name)}</h1>`}
    <article class="card stack">
      <h2 style="font-size:1.35rem">${r.services.map((s) => svc(s).em + " " + svc(s).name).join("<br>")}</h2>
      ${step ? `<div class="timeline">${["Request sent", "Finding volunteers", "Volunteers coming", "Done"].map((t, i) => `<div class="${i < step ? "on" : ""}"><i></i>${t}</div>`).join("")}</div>` : ""}
      <div>${msg}</div>
      ${step === 3 && tools.length ? `<p class="muted">Please leave these out for the volunteers: <b>${tools.map((t) => TOOLS[t].name.toLowerCase()).join(", ")}</b>.</p>` : ""}
      ${active ? (S.confirm === "ccancel"
        ? `<div class="confirm"><b>Cancel this request?</b><div class="wiz-nav"><button class="bigbtn ghost" data-act="confirmNo">No, keep it</button><button class="bigbtn" style="background:var(--rose-fg);color:var(--surface)" data-act="ccancelYes">Yes, cancel</button></div></div>`
        : `<button class="bigbtn ghost" data-act="ccancel">Cancel this request</button>`) : ""}
    </article>
    ${active ? `<p class="muted">You can have one request at a time. When this one is done, you can ask for more help.</p>` : `<button class="bigbtn" data-act="wizStart">Ask for help again</button>`}
    ${OFFICE_PHONE ? `<p class="muted" style="text-align:center">Questions? Call us at <b>${esc(OFFICE_PHONE)}</b></p>` : ""}
  </div>`;
}

/* ---------------- CLIENT: request form, one question per screen ---------------- */
const W_STEPS = ["services", "where", "when", "tools", "extra", "you", "review"];
function wizardView() {
  const w = S.wiz, d = w.d, step = W_STEPS[w.step], n = W_STEPS.length;
  const tile = (field, val, em, name, hint, multi) => {
    const on = multi ? d[field].includes(val) : d[field] === val;
    return `<button type="button" class="tile" data-act="pick" data-field="${field}" data-val="${val}" ${multi ? 'data-multi="1"' : ""} aria-pressed="${on}"><span class="em">${em}</span><span>${name}${hint ? `<small>${hint}</small>` : ""}</span></button>`;
  };
  let q = "";
  if (step === "services") q = `<h1>What do you need help with?</h1><p class="muted">Tap all that apply.</p>
    <div class="tiles">${SERVICES.map((s) => tile("services", s.id, s.em, s.name, s.hint, true)).join("")}</div>
    <p class="muted">We only do outdoor work. Volunteers won't come inside your home.</p>`;
  else if (step === "where") q = `<h1>Where is your yard?</h1>
    <div class="field"><label class="lbl" for="w-address">Street address</label><input type="text" id="w-address" data-w="address" value="${esc(d.address)}" placeholder="e.g. 12 Maple St" autocomplete="street-address"></div>
    <div class="field"><label class="lbl" for="w-postal">Postal code</label><input type="text" id="w-postal" data-w="postal" value="${esc(d.postal)}" placeholder="e.g. K7L 1A1" autocomplete="postal-code"></div>
    <div class="field"><label class="lbl" for="w-area">Neighbourhood <span class="muted">(if you know it)</span></label><input type="text" id="w-area" data-w="area" value="${esc(d.area)}" placeholder="e.g. Sydenham"></div>`;
  else if (step === "when") {
    const picked = d.windows, full = picked.length >= MAX_DAYS;
    const dayCard = (k) => { const date = day(k), x = picked.find((p) => p.date === date);
      return `<div class="dayc ${x ? "on" : ""}"><button type="button" class="dbtn" data-act="winDay" data-id="${date}" ${!x && full ? "disabled" : ""} aria-pressed="${!!x}">${fmtDate(date, true)}</button>
        ${x ? `<div class="parts">${Object.entries(PARTS).map(([k2, p]) => `<button type="button" data-act="winPart" data-id="${date}|${k2}" aria-pressed="${x.part === k2}">${p.name}<small>${p.range}</small></button>`).join("")}</div>` : ""}</div>`; };
    const wk1 = picked.some((p) => p.date <= day(7)), wk2 = picked.some((p) => p.date > day(7));
    q = `<h1>Which days are good for you?</h1>
    <p>Tap <b>${MIN_DAYS} to ${MAX_DAYS} days</b>. Try to pick one from each week. Then tap morning, afternoon, or either.</p>
    <p class="lbl">${picked.length} of ${MAX_DAYS} days picked${picked.length >= MIN_DAYS ? " ✓" : ""}</p>
    <h2>In the next 7 days</h2><div class="days">${[1, 2, 3, 4, 5, 6, 7].map(dayCard).join("")}</div>
    <h2>The week after</h2><div class="days">${[8, 9, 10, 11, 12, 13, 14].map(dayCard).join("")}</div>
    ${picked.length && !(wk1 && wk2) ? `<p class="note">Tip: picking a day from each week helps us find volunteers faster.</p>` : ""}
    <p class="muted">Two volunteers will pick a start time on one of these days. We'll tell you the exact time.</p>`;
  }
  else if (step === "tools") { const tl = neededTools(d.services); q = `<h1>Do you have these tools?</h1>
    <p class="muted">Our volunteers bring gloves, but they use your tools. If you don't have something, that's okay. Just tell us.</p>
    <div class="list">${tl.map((t) => `<div class="toolrow"><span><span style="font-size:1.5rem">${TOOLS[t].em}</span> <b>${TOOLS[t].name}</b></span>
      <div class="yn"><button type="button" data-act="pick" data-field="tools.${t}" data-val="1" aria-pressed="${d.tools[t] === true}">Yes</button><button type="button" data-act="pick" data-field="tools.${t}" data-val="0" aria-pressed="${d.tools[t] === false}">No</button></div></div>`).join("")}</div>`; }
  else if (step === "extra") q = `<h1>Anything we should know?</h1><p class="muted">Tap any that are true. You can skip this.</p>
    <div class="tiles">${Object.entries(FLAGS).map(([k, x]) => tile("flags", k, x.em, x.name, "", true)).join("")}</div>
    <div class="field"><label class="lbl" for="w-notes">Anything else? <span class="muted">(optional)</span></label><textarea id="w-notes" data-w="notes" placeholder="e.g. Please leave the roses alone">${esc(d.notes)}</textarea></div>`;
  else if (step === "you") q = `<h1>How can we reach you?</h1>
    <div class="field"><label class="lbl" for="w-name">Your name</label><input type="text" id="w-name" data-w="name" value="${esc(d.name)}" autocomplete="name"></div>
    <div class="field"><label class="lbl" for="w-phone">Phone number</label><input type="tel" id="w-phone" data-w="phone" value="${esc(d.phone)}" autocomplete="tel"></div>
    <div class="field"><label class="lbl" for="w-email">Email <span class="muted">(optional)</span></label><input type="email" id="w-email" data-w="email" value="${esc(d.email)}" autocomplete="email"></div>
    <p class="lbl">How should we contact you?</p><div class="tiles">${Object.entries(CONTACT).map(([k, x]) => tile("contact", k, k === "phone" ? "📞" : k === "email" ? "✉️" : "👍", x, "")).join("")}</div>`;
  else {
    const rows = [
      ["What", esc(d.services.map((s) => svc(s).name).join(", ")), 0],
      ["Where", esc([d.address, d.postal].filter(Boolean).join(", ")), 1],
      ["Days you're free", [...d.windows].sort((a, b) => a.date.localeCompare(b.date)).map((x) => `${fmtDate(x.date, true)}, ${PARTS[x.part].name.toLowerCase()}`).join("<br>"), 2],
      ["Your tools", neededTools(d.services).map((t) => `${TOOLS[t].name}: ${d.tools[t] ? "yes" : "no"}`).join("<br>") || "None needed", 3],
      ["Good to know", [...d.flags.map((f) => FLAGS[f].name), d.notes].filter(Boolean).map(esc).join("<br>") || "Nothing", 4],
      ["You", `${esc(d.name)}<br>${esc(d.phone)}${d.email ? "<br>" + esc(d.email) : ""}`, 5],
    ];
    q = `<h1>Is this right?</h1>
    <div class="card summary">${rows.map(([k, v, i]) => `<div><div><span>${k}</span>${v}</div><button class="linkbtn" data-act="wizGoto" data-id="${i}">Change</button></div>`).join("")}</div>
    <label class="agree"><input type="checkbox" id="w-agree" data-w="agree" ${d.agree ? "checked" : ""}><span>I understand 1Yard is run by volunteers, and help depends on who is available.</span></label>`;
  }
  return `<div class="stack" style="gap:20px">
    <div class="wiz-top"><span class="muted">Step ${w.step + 1} of ${n}</span><button class="linkbtn" data-act="wizQuit">Stop and go back</button></div>
    <div class="bar"><i style="width:${((w.step + 1) / n) * 100}%"></i></div>
    ${q}
    <div id="wiz-err" class="err" hidden></div>
    <div class="wiz-nav">
      <button class="bigbtn ghost" data-act="wizBack" ${w.step === 0 ? "disabled" : ""}>Back</button>
      ${step === "review" ? `<button class="bigbtn" data-act="wizSend">Send my request</button>` : `<button class="bigbtn" data-act="wizNext">Next</button>`}
    </div>
  </div>`;
}
function wizError() {
  const d = S.wiz.d, step = W_STEPS[S.wiz.step];
  if (step === "services" && !d.services.length) return "Please tap at least one thing you need help with.";
  if (step === "where" && !d.address.trim()) return "Please type your street address.";
  if (step === "when" && d.windows.length < MIN_DAYS) return `Please tap at least ${MIN_DAYS} days.`;
  if (step === "tools" && neededTools(d.services).some((t) => d.tools[t] === undefined)) return "Please tap Yes or No for each tool.";
  if (step === "you" && !d.name.trim()) return "Please type your name.";
  if (step === "you" && d.phone.replace(/\D/g, "").length < 10 && !d.email.trim()) return "Please give us a phone number (with area code) or an email.";
  if (step === "review" && !d.agree) return "Please tick the box to say you understand.";
  return "";
}

/* ---------------- LOGIN / VOLUNTEER SIGN-UP ---------------- */
const loginView = () => `<form class="card stack authcard" id="login-form">
    <h1>Volunteer log in</h1>
    <div class="field"><label class="lbl" for="l-email">Email</label><input type="email" id="l-email" required autocomplete="email"></div>
    <div class="field"><label class="lbl" for="l-pass">Password</label><input type="password" id="l-pass" required autocomplete="current-password" style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface)"></div>
    <button class="btn" type="submit">Log in</button>
    <p class="small muted">Forgot your password? Contact the 1Yard team.</p>
    <p class="small">New volunteer? <button type="button" class="linkbtn" data-act="go" data-id="signup">Apply here</button></p>
  </form>`;
function signupView() {
  const pw = `style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface)"`;
  return `<div class="head"><div><h1>Volunteer with 1Yard</h1><p>Open to university students in Kingston. Help seniors and people with physical limitations with outdoor yard work. Apply below and an admin will review it.</p></div></div>
  <form class="card stack" id="signup">
    <div class="grid2">
      <div class="field"><label class="lbl" for="f-name">Full name</label><input type="text" id="f-name" required autocomplete="name"></div>
      <div class="field"><label class="lbl" for="f-phone">Phone</label><input type="tel" id="f-phone" required autocomplete="tel"></div>
      <div class="field"><label class="lbl" for="f-email">School email</label><input type="email" id="f-email" required autocomplete="email" placeholder="you@queensu.ca"></div>
      <div class="field"><label class="lbl" for="f-pass">Create a password</label><input type="password" id="f-pass" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters" ${pw}></div>
      <div class="field"><label class="lbl" for="f-uni">University</label><select class="in" id="f-uni" required>${UNIS.map((u) => `<option>${u}</option>`).join("")}</select></div>
    </div>
    <div class="field"><span class="lbl">Year of study</span>
      <div class="checks">${YEARS.map((a, i) => `<label class="check"><input type="radio" name="year" id="yr-${i}" value="${a}" ${i === 0 ? "checked" : ""}>${a}</label>`).join("")}</div></div>
    <label class="check" style="max-width:520px"><input type="checkbox" id="f-student" required> I'm currently enrolled as a university student</label>
    <div class="field"><span class="lbl">What can you do?</span>
      <div class="checks">${Object.entries(SKILLS).map(([k, n]) => `<label class="check"><input type="checkbox" id="sk-${k}" name="skill" value="${k}">${n}</label>`).join("")}</div></div>
    <div class="field"><span class="lbl">When are you usually free?</span>
      <div class="checks">${AVAIL.map((s, i) => `<label class="check"><input type="checkbox" id="av-${i}" name="avail" value="${s}">${s}</label>`).join("")}</div></div>
    <div class="field"><label class="lbl" for="f-why">Why do you want to volunteer?</label><textarea id="f-why" required></textarea></div>
    <div class="row"><button class="btn" type="submit">Submit application</button><span class="small muted">Already applied? <button type="button" class="linkbtn" data-act="go" data-id="login">Log in</button></span></div>
  </form>`;
}

/* ---------------- VOLUNTEER ---------------- */
function volunteerView() {
  const v = S.me, sc = S.myShadow;
  const [doneCount, nowStep] = { pending: [1, 1], declined: [1, -1], approved: [2, 2], trainee: [3, 3], experienced: [5, -1] }[v.status];
  const steps = [["Apply", "Send your application"], ["Approval", "An admin reviews it"], ["Online training", "Modules and waiver"],
    ["Shadow shifts", v.status === "trainee" ? `${sc} of ${SHADOW_SHIFTS_NEEDED} done` : `${SHADOW_SHIFTS_NEEDED} jobs with an experienced volunteer`], ["Experienced", "Can lead new volunteers"]];
  const stepper = `<ol class="steps">${steps.map(([b, s], i) => `<li class="${i < doneCount ? "done" : ""} ${i === nowStep ? "now" : ""}"><b>${b}</b>${s}</li>`).join("")}</ol>`;
  let body = "";
  if (v.status === "pending") body = `<div class="card stack"><h2>Thanks, ${esc(first(v.name))}. Your application is in.</h2>
    <p class="muted">An admin will review it soon. Once you're approved, your training and waiver will show up here. Check back in a day or two.</p></div>` + lockedBoard();
  else if (v.status === "declined") body = `<div class="card stack"><h2>Application not approved</h2>
    <p class="muted">Thanks for your interest in 1Yard. Your application wasn't approved this season. Contact the team if you have questions.</p></div>`;
  else if (v.status === "approved") body = trainingView() + lockedBoard();
  else body = boardView(v, sc);
  return `<div class="head"><div><h1>Hi, ${esc(first(v.name))}</h1><p>${esc(v.uni)} · ${v.skills.map((s) => SKILLS[s]).join(", ")}</p></div>${vChip(v.status)}</div>` + stepper + body;
}
function trainingView() {
  return `<section class="card stack">
    <div><h2>You're approved. Finish online training to start.</h2>
    <p class="muted">Go through the modules, sign the waiver, then upload it here.</p></div>
    <div class="label">Training modules</div>
    <div class="list">${TRAINING.map((m, i) => `<div class="module"><div class="ico">${i + 1}</div>
      <div><b>${esc(m.title)}</b><div class="muted small">${esc(m.detail)}</div></div>
      <a class="btn ghost" href="${esc(m.url)}" target="_blank" rel="noopener">Open</a></div>`).join("")}</div>
    <div class="label">Volunteer waiver</div>
    <div class="module"><div class="ico">PDF</div><div><b>1Yard Volunteer Waiver</b><div class="muted small">Download, sign, and upload the signed copy.</div></div>
      <a class="btn ghost" href="${esc(CFG.waiverUrl || "#")}" target="_blank" rel="noopener">Open PDF</a></div>
    <div class="drop">
      <label class="lbl" for="waiver-file">Upload your signed waiver <span class="muted small">(PDF, up to 5 MB)</span></label>
      <input type="file" id="waiver-file" accept="application/pdf,.pdf">
      <span class="small muted" id="file-note">No file chosen yet.</span>
    </div>
    <label class="check" style="max-width:420px"><input type="checkbox" id="done-training"> I have done the training</label>
    <div class="row"><button class="btn" data-act="finish" id="finish" disabled>Finish training</button><span class="small muted" id="finish-hint">Tick the box and upload your waiver to continue.</span></div>
    <div class="note small">Next: you'll be a <b>trainee</b>. You need ${SHADOW_SHIFTS_NEEDED} jobs alongside an experienced volunteer before you're fully trained.</div>
  </section>`;
}
const lockedBoard = () => `<div class="lock"><div style="font-size:1.8rem">🔒</div><h3>The job board is locked</h3><p class="muted small">Only volunteers who've finished training can see and sign up for jobs.</p></div>`;
function boardView(v, sc) {
  const mine = S.jobs.filter((j) => crew(j.id).some((s) => s.vid === v.id)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  let open = S.jobs.filter((j) => !isFull(j) && !needsNewDates(j) && !crew(j.id).some((s) => s.vid === v.id));
  if (S.boardFilter === "skills") open = open.filter((j) => neededSkills(j.services).every((k) => v.skills.includes(k)));
  if (S.boardFilter === "exp") open = open.filter(needsExperienced);
  const rank = (j) => v.status === "experienced" ? (needsExperienced(j) ? 0 : 1) : (canJoin(v, j).ok ? 0 : 1);
  open.sort((a, b) => rank(a) - rank(b) || sortKey(a).localeCompare(sortKey(b)));
  const filters = [["all", "All open jobs"], ["skills", "Fits my skills"], ...(v.status === "experienced" ? [["exp", "Trainee needs a partner"]] : [])];
  const intro = v.status === "trainee"
    ? `<div class="note"><b>You're a trainee: ${sc} of ${SHADOW_SHIFTS_NEEDED} shadow shifts done.</b> You can take a job that's empty or that already has an experienced volunteer. Once you sign up for an empty job, only an experienced volunteer can take the second spot.</div>`
    : `<div class="note"><b>You're an experienced volunteer.</b> Jobs where a trainee is waiting for a partner are shown first. Trainees can't go without you.</div>`;
  return `${intro}
  <section class="stack">
    <div class="head"><div><h2>My upcoming jobs</h2><p>Full address and client contact show here once you've signed up.</p></div><button class="btn ghost" data-act="reload">Refresh</button></div>
    ${mine.length ? `<div class="jobs">${mine.map((j) => myJobCard(j, v)).join("")}</div>` : `<div class="empty">You haven't signed up for anything yet. Pick a job below.</div>`}
  </section>
  <section class="stack">
    <div class="head"><div><h2>Open jobs</h2><p>Every job needs 2 volunteers. If a job has no one yet, you pick the exact time from the days the client is free. Bring your own gloves; the client provides the tools.</p></div></div>
    <div class="filters">${filters.map(([k, n]) => `<button data-act="boardFilter" data-id="${k}" aria-pressed="${S.boardFilter === k}">${n}</button>`).join("")}</div>
    ${open.length ? `<div class="jobs">${open.map((j) => openJobCard(j, v)).join("")}</div>` : `<div class="empty">No open jobs right now. Check back soon.</div>`}
  </section>`;
}
function jobFacts(j, v, full) {
  const c = client(j.clientId), skills = neededSkills(j.services), have = neededTools(j.services).filter((t) => j.tools[t]), miss = missingTools(j);
  return `<dl>
    <dt>Where</dt><dd>${full ? `<b>${esc(c.address)}, ${esc(c.postal)}</b>` : `${esc(c.area)} <span class="muted">(full address after you sign up)</span>`}</dd>
    ${full ? `<dt>Client</dt><dd>${esc(c.name)} · ${esc(c.phone)}</dd>` : ""}
    <dt>Skills</dt><dd>${skills.length ? skills.map((k) => `<span class="tag ${v.skills.includes(k) ? "have" : ""}">${v.skills.includes(k) ? "✓ " : ""}${SKILLS[k]}</span>`).join("") : `<span class="muted">No special skills</span>`}</dd>
    <dt>Tools</dt><dd>${have.map((t) => `<span class="tag">${TOOLS[t].name}</span>`).join("")}${miss.map((t) => `<span class="tag warn">No ${TOOLS[t].name.toLowerCase()}</span>`).join("")}<span class="tag">Bring: gloves</span></dd>
    ${j.flags.length ? `<dt>Heads up</dt><dd>${j.flags.map((f) => `<span class="tag">${FLAGS[f].em} ${FLAGS[f].name}</span>`).join("")}</dd>` : ""}
    ${j.notes && full ? `<dt>Note</dt><dd>${esc(j.notes)}</dd>` : ""}
  </dl>`;
}
function picker(j, cur, verb) {
  return `<div class="picker">
    <label class="lbl" for="pk-${j.id}">Pick a start time (job takes about ${j.hours}h)</label>
    <select id="pk-${j.id}">${timeChoices(j, cur)}</select>
    <p class="small muted">Your partner will sign up for the time you choose.</p>
    <div class="row"><button class="btn" data-act="choose" data-id="${j.id}">${verb}</button><button class="btn ghost" data-act="pickCancel">Cancel</button></div>
  </div>`;
}
function openJobCard(j, v) {
  const r = canJoin(v, j), pri = v.status === "experienced" && needsExperienced(j), locked = isLocked(j);
  const action = !r.ok ? `<button class="btn locked" disabled title="${esc(r.why)}">🔒 ${esc(r.why)}</button>`
    : locked ? `<button class="btn" data-act="join" data-id="${j.id}">Sign up for ${fmtTime(j.start)}</button>`
    : `<button class="btn" data-act="pickOpen" data-id="${j.id}">Sign up and pick a time</button>`;
  return `<article class="card job ${pri ? "priority" : ""}">
    <div class="row" style="justify-content:space-between"><span class="when">${locked ? whenText(j) : "You pick the time"}</span><span class="small muted">~${j.hours}h</span></div>
    <h3>${esc(jobTitle(j))}</h3>
    ${locked ? "" : `<div><div class="label">Client is free</div><ul class="wins">${liveWindows(j).map((x) => `<li>${windowText(x)}</li>`).join("")}</ul></div>`}
    ${jobFacts(j, v, false)}
    ${slots(j)}
    ${S.picking === j.id ? picker(j, "", "Confirm sign-up") : `<div class="foot">${jChip(j)}${action}</div>`}
  </article>`;
}
function myJobCard(j, v) {
  const c = crew(j.id), partner = c.find((s) => s.vid !== v.id), full = c.length >= 2, pv = partner && vol(partner.vid);
  const confirming = S.confirm === "leave:" + j.id;
  let foot;
  if (confirming) foot = `<div class="confirm"><b>Leave this job?</b>${partner && !c.find((s) => s.vid === v.id).asTrainee && partner.asTrainee ? " Your trainee partner will need a new experienced volunteer." : ""}${!partner ? " The client's days will open up again for others." : ""}<div class="row"><button class="btn danger" data-act="leaveYes" data-id="${j.id}">Yes, leave</button><button class="btn ghost" data-act="confirmNo">Keep it</button></div></div>`;
  else if (S.picking === j.id) foot = picker(j, j.date + "|" + j.start, "Save new time");
  else foot = `<div class="foot">${full ? `<button class="btn" data-act="done" data-id="${j.id}">We finished this job</button>` : `<button class="btn ghost" data-act="pickOpen" data-id="${j.id}">Change time</button>`}<button class="btn danger" data-act="leave" data-id="${j.id}">Leave job</button></div>`;
  return `<article class="card job">
    <div class="row" style="justify-content:space-between"><span class="when">${whenText(j)}</span><span class="small muted">~${j.hours}h</span></div>
    ${j.timeChangedAt ? `<div class="alertline">⚠ An admin changed the time ${ago(j.timeChangedAt)}. It's now ${whenText(j)}.</div>` : ""}
    <h3>${esc(jobTitle(j))}</h3>
    ${jobFacts(j, v, true)}
    ${slots(j)}
    ${pv ? `<div class="picker" style="gap:2px"><span class="label">Your partner</span><b>${esc(pv.name)}</b><span class="small">📞 ${esc(pv.phone)} · ✉️ ${esc(pv.email)}</span><span class="small muted">Running late or can't make it? Text your partner and let the 1Yard admin know.</span></div>`
      : `<p class="small">${needsExperienced(j) ? "Waiting for an experienced volunteer to join you." : "Waiting for a second volunteer."} You can change the time until someone joins.</p>`}
    ${foot}
  </article>`;
}

/* ---------------- ADMIN ---------------- */
function adminView() {
  const people = S.volunteers.filter((v) => v.role !== "admin");
  const apps = people.filter((v) => v.status === "pending");
  const reqs = S.jobs.filter((j) => j.status === "review");
  const live = S.jobs.filter((j) => j.status === "scheduled");
  const needVol = live.filter((j) => !isFull(j));
  const needExp = live.filter(needsExperienced);
  const calls = callItems();
  const tab = S.adminTab;
  const tabs = [["calls", "To call", calls.length], ["reqs", "New requests", reqs.length], ["apps", "Volunteer applications", apps.length], ["jobs", "Jobs", needExp.length], ["vols", "Volunteers", 0]];
  let body = "";
  if (tab === "calls") body = callsView(calls);
  else if (tab === "apps") body = apps.length ? `<div class="list">${apps.map(appCard).join("")}</div>` : `<div class="empty">No applications waiting.</div>`;
  else if (tab === "reqs") body = reqs.length ? `<div class="list">${reqs.map(reviewCard).join("")}</div>` : `<div class="empty">No new client requests.</div>`;
  else if (tab === "jobs") body = (S.resched ? reschedPanel(job(S.resched)) : "") + (S.editing && job(S.editing)?.status === "scheduled" ? editForm(job(S.editing)) : "") + jobsTable();
  else body = volsTable(people);
  return `
  <div class="head"><div><h1>Admin dashboard</h1><p>Review new requests and volunteers, and make sure every job gets a full crew.</p></div><button class="btn ghost" data-act="reload">Refresh</button></div>
  <div class="stats">
    <div class="stat ${calls.length ? "alert" : ""}"><b>${calls.length}</b><span>Clients to call</span></div>
    <div class="stat ${reqs.length ? "alert" : ""}"><b>${reqs.length}</b><span>Client requests to review</span></div>
    <div class="stat ${apps.length ? "alert" : ""}"><b>${apps.length}</b><span>Volunteer applications</span></div>
    <div class="stat"><b>${needVol.length}</b><span>Jobs still needing volunteers${needExp.length ? ` (${needExp.length} trainee waiting)` : ""}</span></div>
  </div>
  <div class="stack">
    <div class="tabs" role="tablist">${tabs.map(([id, name, n]) => `<button role="tab" data-act="tab" data-id="${id}" aria-selected="${tab === id}">${name}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("")}</div>
    ${body}
  </div>`;
}
function appCard(v) {
  return `<article class="card split">
    <div class="stack">
      <div class="row"><h3>${esc(v.name)}</h3>${vChip(v.status)}<span class="muted small">applied ${ago(v.appliedAt)}</span></div>
      <div class="kv">
        <div><span>Email</span>${esc(v.email)}</div><div><span>Phone</span>${esc(v.phone)}</div>
        <div><span>School</span>${esc(v.uni)}</div><div><span>Year</span>${esc(v.year)}</div>
        <div><span>Availability</span>${esc(v.avail.join(", ") || "—")}</div>
      </div>
      <div class="row">${v.skills.map((s) => `<span class="tag">${esc(SKILLS[s] || s)}</span>`).join("")}</div>
      <div class="quote"><div class="label">Why they want to volunteer</div>${esc(v.why)}</div>
    </div>
    <div class="stack">
      <button class="btn" data-act="approve" data-id="${v.id}">Approve</button>
      <button class="btn danger" data-act="decline" data-id="${v.id}">Decline</button>
      <p class="small muted">Approving unlocks online training and the waiver.</p>
    </div>
  </article>`;
}
function reviewCard(j) {
  if (S.editing === j.id) return editForm(j);
  const c = client(j.clientId), miss = missingTools(j), have = neededTools(j.services).filter((t) => j.tools[t]);
  return `<article class="card split">
    <div class="stack">
      <div class="row"><h3>${esc(jobTitle(j))}</h3>${jChip(j)}<span class="muted small">sent ${ago(j.createdAt)}${j.editedAt ? ` · edited by admin ${ago(j.editedAt)}` : ""}</span><button class="btn ghost" style="margin-left:auto" data-act="edit" data-id="${j.id}">Edit details</button></div>
      <div class="kv">
        <div><span>Client</span>${esc(c.name)}</div>
        <div><span>Contact</span>${esc(c.phone)}${c.email ? `<br>${esc(c.email)}` : ""}<br><span style="display:inline">Prefers: ${CONTACT[c.contact]}</span></div>
        <div><span>Address</span>${esc(c.address)}, ${esc(c.postal)}<br>${esc(c.area)}</div>
      </div>
      <div><div class="label">Client is free</div><ul class="wins">${j.windows.map((x) => `<li>${windowText(x)}${x.date <= today() ? ` <span class="tag warn">already passed</span>` : ""}</li>`).join("")}</ul></div>
      <div class="row"><span class="label">Tools on site</span>${have.map((t) => `<span class="tag have">✓ ${TOOLS[t].name}</span>`).join("")}${miss.map((t) => `<span class="tag warn">Missing: ${TOOLS[t].name}</span>`).join("")}</div>
      ${j.flags.length ? `<div class="row"><span class="label">Heads up</span>${j.flags.map((f) => `<span class="tag">${FLAGS[f].em} ${FLAGS[f].name}</span>`).join("")}</div>` : ""}
      ${j.notes ? `<div class="quote"><div class="label">Client's note</div>${esc(j.notes)}</div>` : ""}
      ${miss.length ? `<p class="small" style="color:var(--amber-fg)">Volunteers only bring gloves. Call the client to sort out the missing tools before publishing.</p>` : ""}
    </div>
    <div class="side">
      <span class="label">Publish to volunteers</span>
      <p class="small muted">Volunteers will see the client's days and pick an exact start time. Fix the days with Edit details if they're wrong.</p>
      <label>Estimated time<select id="h-${j.id}">${[1, 2, 3, 4].map((h) => `<option value="${h}" ${h === 2 ? "selected" : ""}>${h} hour${h > 1 ? "s" : ""}</option>`).join("")}</select></label>
      <button class="btn" data-act="publish" data-id="${j.id}">Publish to volunteers</button>
      <button class="btn danger" data-act="reject" data-id="${j.id}">Decline request</button>
    </div>
  </article>`;
}
function editForm(j) {
  const c = client(j.clientId);
  const opt = (obj, cur) => Object.entries(obj).map(([k, x]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${typeof x === "string" ? x : x.name}</option>`).join("");
  const box = (name, k, label, on) => `<label class="check"><input type="checkbox" name="${name}" value="${k}" ${on ? "checked" : ""}>${label}</label>`;
  return `<article class="card stack" id="edit-card" style="border-color:var(--accent)">
    <div class="row"><h3>Edit request: ${esc(c.name)}</h3>${jChip(j)}</div>
    <p class="small muted">Use this after calling the client to fix or fill in details. Contact and address changes apply to the client's profile.</p>
    <div class="grid2">
      <div class="field"><label class="lbl" for="e-name">Client name</label><input type="text" id="e-name" value="${esc(c.name)}"></div>
      <div class="field"><label class="lbl" for="e-phone">Phone</label><input type="tel" id="e-phone" value="${esc(c.phone)}"></div>
      <div class="field"><label class="lbl" for="e-email">Email</label><input type="email" id="e-email" value="${esc(c.email)}"></div>
      <div class="field"><label class="lbl" for="e-contact">Prefers</label><select class="in" id="e-contact">${opt(CONTACT, c.contact)}</select></div>
      <div class="field"><label class="lbl" for="e-address">Street address</label><input type="text" id="e-address" value="${esc(c.address)}"></div>
      <div class="field"><label class="lbl" for="e-postal">Postal code</label><input type="text" id="e-postal" value="${esc(c.postal)}"></div>
      <div class="field"><label class="lbl" for="e-area">Neighbourhood</label><input type="text" id="e-area" value="${esc(c.area)}"></div>
    </div>
    ${crew(j.id).length ? `<p class="small muted">Days are locked because a volunteer has signed up. Use <b>Change time</b> on the Jobs tab instead.</p>`
      : `<div class="field"><span class="lbl">Days the client is free (up to 4)</span>${windowRows("ew", j.windows)}</div>`}
    <div class="field"><span class="lbl">Work needed</span><div class="checks">${SERVICES.map((x) => box("e-svc", x.id, x.name, j.services.includes(x.id))).join("")}</div></div>
    <div class="field"><span class="lbl">Tools the client has</span><div class="checks">${Object.entries(TOOLS).map(([k, x]) => box("e-tool", k, x.name, j.tools[k])).join("")}</div></div>
    <div class="field"><span class="lbl">Heads up</span><div class="checks">${Object.entries(FLAGS).map(([k, x]) => box("e-flag", k, x.name, j.flags.includes(k))).join("")}</div></div>
    <div class="field"><label class="lbl" for="e-notes">Notes for volunteers</label><textarea id="e-notes">${esc(j.notes)}</textarea></div>
    <div class="row"><button class="btn" data-act="editSave" data-id="${j.id}">Save changes</button><button class="btn ghost" data-act="editCancel">Cancel</button></div>
  </article>`;
}
function callsView(items) {
  if (!items.length) return `<div class="empty">Nobody to call right now. Clients show up here when their crew is set, or when none of their days worked out.</div>`;
  return `<div class="list">${items.map(({ j, kind }) => {
    const c = client(j.clientId), names = crew(j.id).map((s) => vol(s.vid)?.name || "A volunteer");
    if (S.resched === j.id) return reschedPanel(j);
    return `<article class="card call">
      <div class="stack" style="gap:8px">
        <div class="row">${kind === "tell" ? `<span class="chip c-green">Crew confirmed</span>` : `<span class="chip c-rose">Needs new dates</span>`}<span class="small muted">${esc(jobTitle(j))} · ${esc(c.area)}</span></div>
        <h3>${kind === "tell" ? `Tell ${esc(c.name)} when volunteers are coming` : `Ask ${esc(c.name)} for new days`}</h3>
        <div class="phone">📞 ${esc(c.phone || c.email)}</div>
        ${kind === "tell" ? `<p><b>${names.map(esc).join(" and ")}</b> will come <b>${whenText(j, true)}</b> (about ${j.hours}h).</p>`
          : `<p>None of their days got a full crew: ${j.windows.map((x) => fmtDate(x.date)).join(", ")}.${crew(j.id).length ? ` ${esc(names[0])} signed up alone and will be released.` : ""}</p>`}
        ${j.attempts ? `<p class="small muted">No answer ${j.attempts}× · last tried ${ago(j.lastAttemptAt)}</p>` : ""}
      </div>
      <div class="stack" style="gap:8px">
        ${kind === "tell" ? `<button class="btn" data-act="called" data-id="${j.id}">Called ✓</button>` : `<button class="btn" data-act="resched" data-id="${j.id}">Enter new days</button>`}
        <button class="btn ghost" data-act="noAnswer" data-id="${j.id}">No answer</button>
      </div>
    </article>`; }).join("")}</div>`;
}
function reschedPanel(j) {
  if (!j) return "";
  const c = client(j.clientId), full = isFull(j), allTimes = startTimes("any", 0.5);
  const inp = `style="padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--surface)"`;
  return `<article class="card stack" id="resched-card" style="border-color:var(--accent)">
    <div class="row"><h3>Change time: ${esc(c.name)}</h3>${jChip(j)}</div>
    ${full && isLocked(j) ? `<div class="stack" style="gap:8px">
      <span class="label">Option 1 · Move the time and keep the crew</span>
      <p class="small muted">Use this only after both volunteers have agreed to the new time.</p>
      <div class="row"><input type="date" id="mv-date" value="${j.date}" aria-label="New date" ${inp}>
        <select id="mv-start" aria-label="New start time" ${inp}>${allTimes.map((t) => `<option value="${t}" ${t === j.start ? "selected" : ""}>${fmtTime(t)}</option>`).join("")}</select>
        <button class="btn" data-act="moveTime" data-id="${j.id}">Save new time</button></div>
    </div>` : ""}
    <div class="stack" style="gap:8px">
      <span class="label">${full && isLocked(j) ? "Option 2 · " : ""}Release ${crew(j.id).length ? "the crew" : "it"} and repost with new days</span>
      <p class="small muted">Enter the days the client is free now. ${crew(j.id).length ? "Signed-up volunteers will be removed from the job." : ""}</p>
      ${windowRows("rw", liveWindows(j))}
      <div class="row"><button class="btn" data-act="repost" data-id="${j.id}">Repost to volunteers</button><button class="btn ghost" data-act="reschedCancel">Cancel</button></div>
    </div>
  </article>`;
}
function jobsTable() {
  const f = S.jobFilter;
  const rows = S.jobs.filter((j) => j.status !== "review").filter((j) => f === "upcoming" ? j.status === "scheduled" : f === "attention" ? j.status === "scheduled" && !isFull(j) : j.status !== "scheduled")
    .sort((a, b) => f === "past" ? sortKey(b).localeCompare(sortKey(a)) : sortKey(a).localeCompare(sortKey(b)));
  return `<div class="filters">${[["upcoming", "Upcoming"], ["attention", "Needs volunteers"], ["past", "Done & cancelled"]].map(([k, n]) => `<button data-act="jobFilter" data-id="${k}" aria-pressed="${f === k}">${n}</button>`).join("")}</div>
  ${rows.length ? `<div class="card table-wrap"><table>
    <thead><tr><th>When</th><th>Job</th><th>Crew</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map((j) => { const c = client(j.clientId); const lw = liveWindows(j); return `<tr>
      <td>${(isLocked(j) || j.status === "done") && j.date ? `<b>${fmtDate(j.date)}</b><div class="muted small">${fmtTime(j.start)} · ~${j.hours}h</div>` : `<b>${lw.length} day option${lw.length === 1 ? "" : "s"}</b><div class="muted small">${lw.map((x) => fmtDate(x.date)).join(", ") || "all passed"}</div>`}</td>
      <td><b>${esc(jobTitle(j))}</b><div class="muted small">${esc(c.name)} · ${esc(c.address)}, ${esc(c.area)}</div></td>
      <td style="min-width:240px">${slots(j)}</td>
      <td>${jChip(j)}</td>
      <td><div class="row" style="justify-content:flex-end">${j.status === "scheduled" ? `${isFull(j) ? `<button class="btn" data-act="done" data-id="${j.id}">Mark done</button>` : ""}<button class="btn ghost" data-act="resched" data-id="${j.id}">Change time</button><button class="btn ghost" data-act="edit" data-id="${j.id}">Edit</button><button class="btn danger" data-act="acancel" data-id="${j.id}">Cancel</button>` : ""}</div></td>
    </tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">No jobs here.</div>`}`;
}
function volsTable(people) {
  const order = { pending: 0, approved: 1, trainee: 2, experienced: 3, declined: 4 };
  const list = [...people].sort((a, b) => order[a.status] - order[b.status]);
  if (!list.length) return `<div class="empty">No volunteers yet.</div>`;
  return `<div class="card table-wrap"><table>
    <thead><tr><th>Volunteer</th><th>Level</th><th>Shadow shifts</th><th>Jobs done</th><th>Waiver</th></tr></thead>
    <tbody>${list.map((v) => `<tr>
      <td><b>${esc(v.name)}</b><div class="muted small">${esc(v.uni)} · ${esc(v.year)}<br>${esc(v.email)} · ${esc(v.phone)}</div></td>
      <td><select class="in" data-level="${v.id}" aria-label="Level for ${esc(v.name)}" style="min-width:190px">${Object.entries(V_STATUS).map(([k, [label]]) => `<option value="${k}" ${k === v.status ? "selected" : ""}>${label}</option>`).join("")}</select></td>
      <td class="num">${v.status === "trainee" ? `<b>${shadowCount(v.id)} of ${SHADOW_SHIFTS_NEEDED}</b>` : v.status === "experienced" ? "Complete" : "—"}</td>
      <td class="num">${jobsDone(v.id)}</td>
      <td class="small">${v.waiverPath ? `<button class="btn ghost" data-act="waiver" data-id="${v.id}">📄 Open waiver</button>` : `<span class="muted">—</span>`}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

/* ============ ACTIONS ============ */
const SKIP = Symbol();
const upd = async (table, id, patch) => must(await sb.from(table).update(patch).eq("id", id));
const rpc = async (fn, args) => must(await sb.rpc(fn, args));
function showWizErr(e) { const el = $("#wiz-err"); el.textContent = e; el.hidden = false; el.scrollIntoView({ block: "nearest" }); return SKIP; }

const A = {
  go: async (id) => { S.notice = ""; if (id === "home") { await goHome(); history.replaceState(null, "", location.pathname); } else S.view = id; scrollTo(0, 0); },
  reload: async () => { await refresh(); return "Up to date."; },
  logout: async () => { await sb.auth.signOut(); S.me = null; S.view = "home"; S.notice = ""; },
  tab: (id) => { S.adminTab = id; S.editing = null; S.resched = null; },
  jobFilter: (id) => { S.jobFilter = id; },
  boardFilter: (id) => { S.boardFilter = id; },
  confirmNo: () => { S.confirm = null; },

  // --- admin
  approve: async (id) => { await upd("profiles", id, { status: "approved", reviewed_at: now() }); await loadAdmin(); return `${vol(id).name} approved. They can now do training.`; },
  decline: async (id) => { await upd("profiles", id, { status: "declined", reviewed_at: now() }); await loadAdmin(); return `${vol(id).name}'s application declined.`; },
  publish: async (id) => {
    const j = job(id);
    if (!liveWindows(j).length) return "All of this client's days have passed. Use Edit details to add new ones.";
    await upd("jobs", id, { status: "scheduled", hours: +$("#h-" + id).value, published_at: now() }); await loadAdmin();
    return `Published with ${liveWindows(job(id)).length} day options. Volunteers can now sign up.`;
  },
  reject: async (id) => { await upd("jobs", id, { status: "declined" }); await loadAdmin(); return "Request declined. Remember to call the client."; },
  acancel: async (id) => { must(await sb.from("job_signups").delete().eq("job_id", id)); await upd("jobs", id, { status: "cancelled" }); await loadAdmin(); return "Job cancelled."; },
  called: async (id) => { await upd("jobs", id, { told_at: now() }); await loadAdmin(); return "Marked as called."; },
  noAnswer: async (id) => { await upd("jobs", id, { attempts: (job(id).attempts || 0) + 1, last_attempt_at: now() }); await loadAdmin(); return "Logged. It stays on the list so you can try again."; },
  resched: (id) => { S.resched = id; S.editing = null; setTimeout(() => $("#resched-card")?.scrollIntoView({ block: "start", behavior: "smooth" })); },
  reschedCancel: () => { S.resched = null; },
  moveTime: async (id) => {
    const date = $("#mv-date").value;
    if (!date) return toast("Pick a date."), SKIP;
    await upd("jobs", id, { date, start_time: $("#mv-start").value, time_changed_at: now(), told_at: now() });
    S.resched = null; await loadAdmin();
    return `Moved to ${whenText(job(id))}. Both volunteers will see the change.`;
  },
  repost: async (id) => {
    const wins = readWindows("rw").filter((x) => x.date > today());
    if (!wins.length) return toast("Add at least one future day."), SKIP;
    must(await sb.from("job_signups").delete().eq("job_id", id));
    await upd("jobs", id, { windows: wins, date: null, start_time: null, told_at: null, time_changed_at: null, attempts: 0 });
    S.resched = null; await loadAdmin();
    return "Reposted with new days. Volunteers can sign up again.";
  },
  edit: (id) => { S.editing = id; S.resched = null; setTimeout(() => $("#edit-card")?.scrollIntoView({ block: "start", behavior: "smooth" })); },
  editCancel: () => { S.editing = null; },
  editSave: async (id) => {
    const j = job(id), val = (k) => $("#e-" + k).value.trim();
    const checked = (n) => [...document.querySelectorAll(`input[name="${n}"]:checked`)].map((i) => i.value);
    const services = checked("e-svc");
    if (!services.length) return toast("Pick at least one type of work."), SKIP;
    if (!val("address")) return toast("The address can't be empty."), SKIP;
    const patch = { services, tools: Object.fromEntries(checked("e-tool").map((t) => [t, true])), flags: checked("e-flag"), notes: val("notes"), edited_at: now() };
    if ($("#ew-date-0")) { const wins = readWindows("ew"); if (!wins.length) return toast("Add at least one day the client is free."), SKIP; patch.windows = wins; }
    await upd("clients", j.clientId, { name: val("name"), phone: val("phone"), phone_key: val("phone").replace(/\D/g, ""), email: val("email").toLowerCase(), contact: $("#e-contact").value, address: val("address"), postal: val("postal").toUpperCase(), area: val("area") || "Kingston" });
    await upd("jobs", id, patch);
    S.editing = null; await loadAdmin();
    return "Request updated.";
  },
  waiver: async (id) => {
    const win = window.open("", "_blank"); // open now so pop-up blockers allow it
    const { data, error } = await sb.storage.from("waivers").createSignedUrl(vol(id).waiverPath, 300);
    if (error) { win?.close(); throw error; }
    if (win) win.location = data.signedUrl; else location.href = data.signedUrl;
  },
  done: async (id) => {
    const promoted = await rpc("finish_job", { p_job: id });
    await refresh();
    return promoted.length ? `Job done. ${promoted.join(" and ")} ${promoted.length > 1 ? "are" : "is"} now experienced!` : "Job marked as done.";
  },

  // --- volunteer
  finish: async () => {
    const f = $("#waiver-file").files[0];
    if (f.size > 5 * 1024 * 1024) return "That file is over 5 MB. Try a smaller scan.";
    const path = `${S.me.id}/${Date.now()}-waiver.pdf`;
    must(await sb.storage.from("waivers").upload(path, f, { contentType: "application/pdf" }));
    await rpc("complete_training", { p_path: path });
    S.boardFilter = "all"; await refresh(); scrollTo(0, 0);
    return "Training complete. You can now sign up for jobs as a trainee.";
  },
  pickOpen: (id) => { S.picking = id; },
  pickCancel: () => { S.picking = null; },
  choose: async (id) => {
    const [date, start] = $("#pk-" + id).value.split("|");
    const mine = crew(id).some((s) => s.vid === S.me.id);
    await rpc(mine ? "change_my_time" : "join_job", { p_job: id, p_date: date, p_start: start });
    S.picking = null; await refresh();
    return mine ? `Time changed to ${whenText(job(id))}.` : `You're signed up for ${whenText(job(id))}. ${S.me.status === "trainee" ? "Now waiting for an experienced volunteer." : "Waiting for a second volunteer."}`;
  },
  join: async (id) => { await rpc("join_job", { p_job: id }); await refresh(); return isFull(job(id)) ? "You're signed up. The crew is complete." : "You're signed up."; },
  leave: (id) => { S.confirm = "leave:" + id; },
  leaveYes: async (id) => { await rpc("leave_job", { p_job: id }); S.confirm = null; await refresh(); return "You left the job. The spot is open again."; },

  // --- client
  openRequest: async (tok) => { S.token = tok; S.justSent = false; history.replaceState(null, "", "?request=" + tok); S.view = "request"; await loadRequest(); },
  ccancel: () => { S.confirm = "ccancel"; },
  ccancelYes: async () => { await rpc("cancel_request", { tok: S.token }); S.confirm = null; S.justSent = false; await loadRequest(); return "Your request is cancelled."; },
  copyLink: () => {
    const el = $("#mylink");
    navigator.clipboard?.writeText(el.value).then(() => toast("Link copied."), () => { el.select(); toast("Press Ctrl+C (or ⌘C) to copy."); });
    return SKIP;
  },
  wizStart: () => {
    S.justSent = false; S.confirm = null; S.view = "wizard";
    S.wiz = { step: 0, d: { services: [], address: "", postal: "", area: "", windows: [], tools: {}, flags: [], notes: "", name: "", phone: "", email: "", contact: "phone", agree: false } };
    scrollTo(0, 0);
  },
  winDay: (date) => {
    const d = S.wiz.d, i = d.windows.findIndex((x) => x.date === date);
    if (i >= 0) d.windows.splice(i, 1);
    else if (d.windows.length >= MAX_DAYS) return `You can pick up to ${MAX_DAYS} days.`;
    else d.windows.push({ date, part: "any" });
  },
  winPart: (id) => { const [date, part] = id.split("|"); S.wiz.d.windows.find((x) => x.date === date).part = part; },
  pick: (_, b) => {
    const d = S.wiz.d, f = b.dataset.field, val = b.dataset.val;
    if (f.startsWith("tools.")) d.tools[f.slice(6)] = val === "1";
    else if (b.dataset.multi) d[f] = d[f].includes(val) ? d[f].filter((x) => x !== val) : [...d[f], val];
    else d[f] = val;
  },
  wizNext: () => { const e = wizError(); if (e) return showWizErr(e); S.wiz.step++; if (W_STEPS[S.wiz.step] === "tools" && !neededTools(S.wiz.d.services).length) S.wiz.step++; scrollTo(0, 0); },
  wizBack: () => { S.wiz.step--; if (W_STEPS[S.wiz.step] === "tools" && !neededTools(S.wiz.d.services).length) S.wiz.step--; scrollTo(0, 0); },
  wizGoto: (id) => { S.wiz.step = +id; scrollTo(0, 0); },
  wizQuit: () => { S.wiz = null; S.view = "home"; },
  wizSend: async () => {
    const e = wizError(); if (e) return showWizErr(e);
    const d = S.wiz.d, tools = {};
    neededTools(d.services).forEach((t) => (tools[t] = !!d.tools[t]));
    const { data, error } = await sb.rpc("submit_request", { p: {
      name: d.name.trim(), phone: d.phone.trim(), email: d.email.trim(), contact: d.contact,
      address: d.address.trim(), postal: d.postal.trim(), area: d.area.trim(),
      services: d.services, tools, flags: d.flags, notes: d.notes.trim(), windows: d.windows } });
    if (error) return showWizErr(error.message.includes("ACTIVE_REQUEST")
      ? `You already have a request with us. You can have one at a time.${OFFICE_PHONE ? ` Call us at ${OFFICE_PHONE} if you need to change it.` : ""}` : error.message);
    rememberToken(data);
    S.wiz = null; S.token = data; S.justSent = true; S.view = "request";
    history.replaceState(null, "", "?request=" + data);
    await loadRequest(); scrollTo(0, 0);
  },
};

/* ============ EVENTS ============ */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled || S.busy) return;
  const fn = A[b.dataset.act]; if (!fn) return;
  S.busy = true; b.classList.add("busy");
  try {
    const msg = await fn(b.dataset.id, b);
    if (msg === SKIP) return;
    render();
    if (msg) toast(msg);
  } catch (err) {
    console.error(err);
    toast(err?.message || "Something went wrong. Please try again.");
    try { await refresh(); } catch {}
    render();
  } finally { S.busy = false; b.classList.remove("busy"); }
});
document.addEventListener("input", (e) => {
  const k = e.target.dataset.w;
  if (k && S.wiz) S.wiz.d[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
});
document.addEventListener("change", async (e) => {
  const id = e.target.id;
  // Admin override of a volunteer's level (e.g. skip shadow shifts for someone experienced).
  if (e.target.dataset.level) {
    const v = vol(e.target.dataset.level), status = e.target.value, sel = e.target;
    sel.disabled = true;
    try {
      const patch = { status };
      if (status === "experienced") patch.promoted_at = now();
      if ((status === "trainee" || status === "experienced") && !v.trainedAt) patch.trained_at = now();
      if (v.status === "pending") patch.reviewed_at = now();
      await upd("profiles", v.id, patch);
      // A promoted volunteer no longer counts as a trainee on jobs they're already signed up for.
      if (status === "experienced") {
        const open = S.signups.filter((s) => s.vid === v.id && s.asTrainee && job(s.jobId)?.status === "scheduled");
        for (const s of open) must(await sb.from("job_signups").update({ as_trainee: false }).eq("id", s.id));
      }
      await loadAdmin(); render();
      toast(`${v.name} is now: ${V_STATUS[status][0]}.`);
    } catch (err) { toast(err?.message || "Couldn't change the level."); render(); }
    return;
  }
  if (id === "waiver-file" || id === "done-training") {
    const f = $("#waiver-file").files[0], isPdf = f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    $("#file-note").textContent = !f ? "No file chosen yet." : isPdf ? `📄 ${f.name}` : "That file isn't a PDF. Upload the signed waiver as a PDF.";
    const ok = isPdf && $("#done-training").checked;
    $("#finish").disabled = !ok;
    $("#finish-hint").textContent = ok ? "Ready to go." : "Tick the box and upload your waiver to continue.";
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, btn = form.querySelector('button[type="submit"]');
  if (S.busy) return;
  S.busy = true; btn.classList.add("busy");
  try {
    if (form.id === "login-form") {
      must(await sb.auth.signInWithPassword({ email: $("#l-email").value.trim(), password: $("#l-pass").value }));
      await loadMe();
      if (!S.me) throw new Error("This account has no volunteer profile. Contact the 1Yard team.");
      await goHome();
    } else if (form.id === "signup") {
      const skills = [...document.querySelectorAll('input[name="skill"]:checked')].map((i) => i.value);
      if (!skills.length) throw new Error("Pick at least one thing you can do.");
      const res = must(await sb.auth.signUp({ email: $("#f-email").value.trim(), password: $("#f-pass").value, options: { data: {
        name: $("#f-name").value.trim(), phone: $("#f-phone").value.trim(), university: $("#f-uni").value,
        year: $('input[name="year"]:checked')?.value || "", skills,
        availability: [...document.querySelectorAll('input[name="avail"]:checked')].map((i) => i.value), why: $("#f-why").value.trim() } } }));
      if (!res.session) { S.view = "login"; S.notice = "Application sent. Check your email to confirm your address, then log in."; }
      else { await loadMe(); await goHome(); toast("Application sent. An admin will review it soon."); }
    }
    render(); scrollTo(0, 0);
  } catch (err) {
    toast(err?.message || "Something went wrong. Please try again.");
  } finally { S.busy = false; btn.classList.remove("busy"); }
});

/* ============ START ============ */
(async function boot() {
  if (!sb) { S.view = "setup"; return render(); }
  render();
  try {
    const tok = new URLSearchParams(location.search).get("request");
    if (tok) { S.token = tok; S.view = "request"; rememberToken(tok); await loadRequest(); }
    else { await loadMe(); await goHome(); }
  } catch (err) {
    console.error(err);
    S.view = "home"; toast(err?.message || "Couldn't reach the server. Please try again.");
  }
  render();
})();
