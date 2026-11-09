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
// Ontario universities (Queen's first since that's where 1Yard is based). "Other" lets people type their own.
const UNIS = ["Queen's University", "Royal Military College of Canada", "Algoma University", "Brock University", "Carleton University",
  "Lakehead University", "Laurentian University", "McMaster University", "Nipissing University", "OCAD University", "Ontario Tech University",
  "Toronto Metropolitan University", "Trent University", "Université de Hearst", "Université de l'Ontario français", "University of Guelph",
  "University of Ottawa", "University of Toronto", "University of Waterloo", "University of Windsor", "Western University",
  "Wilfrid Laurier University", "York University"];
const YEARS = ["1st year", "2nd year", "3rd year", "4th year", "5th year or more", "Grad student"];
const TRAINING = CFG.training || [];
const SHADOW_SHIFTS_NEEDED = 2;
const OFFICE_PHONE = CFG.officePhone || "";
const CONCERNS = { safety: "Safety or injury", not_home: "Client wasn't home", bigger: "Job was bigger than described", other: "Other" };
const TOKENS_KEY = "1yard-my-requests";

/* ============ STATE ============ */
let S = {
  view: "loading", me: null, volunteers: [], clients: [], jobs: [], signups: [], myShadow: 0,
  adminTab: "calls", adminPage: "dash", volPage: "vhome", history: [], jobFilter: "upcoming", boardFilter: "all",
  bannerHidden: (() => { try { return localStorage.getItem("1yard-banner") === SEASON.label; } catch { return false; } })(),
  wiz: null, confirm: null, editing: null, resched: null, picking: null,
  token: null, request: null, justSent: false, notice: "", busy: false,
  notifs: [], bellOpen: false, thanks: [], directory: null, dirFilter: "all", stats: null, levelHistory: [], levelRules: null, reports: [], adminNotes: [], emails: [], go: null, flash: null,
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
// Each job needs j.spots volunteers (2-6). At most half the crew can be trainees, so every
// trainee has a supervisor (a Community Volunteer or above). Mirrors join_job() on the server.
const spotsOf = (j) => j.spots || 2;
const traineesOn = (j) => crew(j.id).filter((s) => s.asTrainee).length;
const isFull = (j) => crew(j.id).length >= spotsOf(j);
const needsExperienced = (j) => !isFull(j) && traineesOn(j) >= Math.floor(spotsOf(j) / 2);
const joinNames = (n) => n.length < 2 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
const canSeeBoard = (v) => v && (v.status === "trainee" || v.status === "experienced");
const liveWindows = (j) => (j.windows || []).filter((x) => x.date > today()).sort((a, b) => a.date.localeCompare(b.date));
const windowText = (x) => `${fmtDate(x.date)} · ${PARTS[x.part].name.toLowerCase()} (${PARTS[x.part].range})`;
// The time is fixed once someone picked it, and stays fixed after a confirmed crew loses a volunteer.
const isLocked = (j) => !!j.date && !!j.start && (crew(j.id).length > 0 || !!j.crewedAt);
const whenText = (j, long) => `${fmtDate(j.date, long)} at ${fmtTime(j.start)}`;
const needsNewDates = (j) => j.status === "scheduled" && !isFull(j) && (isLocked(j) ? j.date <= today() : liveWindows(j).length === 0);
const sortKey = (j) => (isLocked(j) || j.status === "done" ? (j.date || "") + (j.start || "").padStart(5, "0") : liveWindows(j)[0]?.date || j.windows?.[0]?.date || "");
function startTimes(part, hours) {
  const p = PARTS[part], out = [], last = Math.max(p.from * 60, p.to * 60 - hours * 60);
  for (let t = p.from * 60; t <= last; t += 30) out.push(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`);
  return out;
}
const timeChoices = (j, cur) => liveWindows(j).map((x) => `<optgroup label="${windowText(x)}">${startTimes(x.part, j.hours).map((t) => `<option value="${x.date}|${t}" ${cur === x.date + "|" + t ? "selected" : ""}>${fmtDate(x.date)} · ${fmtTime(t)}</option>`).join("")}</optgroup>`).join("");
const droppedSinceCall = (j) => j.dropoutAt && !isFull(j) && (!j.toldAt || j.toldAt < j.dropoutAt);
const callItems = () => S.jobs.filter((j) => j.status === "scheduled").flatMap((j) => isFull(j) && !j.toldAt ? [{ j, kind: "tell" }] : needsNewDates(j) ? [{ j, kind: "dates" }] : droppedSinceCall(j) ? [{ j, kind: "drop" }] : []);
function windowRows(prefix, wins) {
  return `<div class="winrows">${[0, 1, 2, 3].map((i) => { const x = wins[i] || {}; return `<div class="row"><input type="date" id="${prefix}-date-${i}" value="${x.date || ""}" aria-label="Date option ${i + 1}"><select id="${prefix}-part-${i}" aria-label="Time of day ${i + 1}">${Object.entries(PARTS).map(([k, p]) => `<option value="${k}" ${k === (x.part || "any") ? "selected" : ""}>${p.name} (${p.range})</option>`).join("")}</select></div>`; }).join("")}</div>`;
}
function readWindows(prefix) {
  const out = [];
  for (let i = 0; i < 4; i++) { const date = $(`#${prefix}-date-${i}`)?.value; if (date && !out.some((x) => x.date === date)) out.push({ date, part: $(`#${prefix}-part-${i}`).value }); }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
// Admin-side counts (the server has the same logic in shadow_count / jobs_done). Supervised shifts = shadow_count.
function shadowCount(vid) {
  return S.signups.filter((s) => s.vid === vid && s.asTrainee && job(s.jobId)?.status === "done" &&
    S.signups.some((p) => p.jobId === s.jobId && p.vid !== vid && !p.asTrainee)).length;
}
const jobsDone = (vid) => S.signups.filter((s) => s.vid === vid && job(s.jobId)?.status === "done").length;
// Already on another upcoming job whose time overlaps this one (same check as busy_then() on the server).
function busyThen(v, j) {
  const s0 = to_min(j.start), e0 = s0 + j.hours * 60;
  return S.jobs.some((o) => o.id !== j.id && o.status === "scheduled" && o.date === j.date && o.start
    && crew(o.id).some((c) => c.vid === v.id) && to_min(o.start) < e0 && s0 < to_min(o.start) + o.hours * 60);
}
// Mirrors join_job() on the server, so buttons show the right state. The server has the final say.
function canJoin(v, j) {
  const c = crew(j.id);
  if (!canSeeBoard(v)) return { ok: false, why: "Finish training first" };
  if (j.status !== "scheduled") return { ok: false, why: "Not open" };
  if (c.some((s) => s.vid === v.id)) return { ok: false, why: "You're on this job" };
  if (c.length >= spotsOf(j)) return { ok: false, why: "Full" };
  if (needsNewDates(j)) return { ok: false, why: "Waiting on new dates" };
  if (isLocked(j) && busyThen(v, j)) return { ok: false, why: "You're on another job then" };
  if (v.status === "trainee" && needsExperienced(j)) return { ok: false, why: "Supervisor spots only" };
  return { ok: true };
}
const V_STATUS = { pending: ["Waiting for review", "c-amber"], approved: ["Approved · doing training", "c-sky"], trainee: ["Trainee", "c-sky"], experienced: ["Community Volunteer", "c-green"], declined: ["Declined", "c-rose"] };
const vChip = (s) => `<span class="chip ${V_STATUS[s][1]}">${V_STATUS[s][0]}</span>`;
// Volunteer levels. Trainee → Community Volunteer come from training; Senior and Team Lead
// unlock from hours + trainee shifts supervised (numbers in level_rules() in schema.sql);
// Yard Captain is given by an admin.
const LEVELS = { trainee: { name: "Trainee", em: "🌱", cls: "c-sky" }, community: { name: "Community Volunteer", em: "🌿", cls: "c-green" },
  senior: { name: "Senior Volunteer", em: "🌳", cls: "c-green" }, team_lead: { name: "Volunteer Team Lead", em: "🍁", cls: "c-amber" }, captain: { name: "Yard Captain", em: "⭐", cls: "c-amber" } };
const LEVEL_ORDER = ["trainee", "community", "senior", "team_lead", "captain"];
const levelOf = (v) => v?.level || (v?.status === "trainee" ? "trainee" : v?.status === "experienced" ? "community" : null);
const levelChip = (v) => { const l = LEVELS[levelOf(v)]; return l ? `<span class="chip ${l.cls}">${l.em} ${l.name}</span>` : vChip(v.status); };
const carTag = (v) => v?.hasCar ? `<span class="cartag" title="Has a car they're willing to use">🚗 Has a car</span>` : "";
function jobState(j) {
  if (j.status === "review") return ["New request", "c-amber"];
  if (j.status === "declined") return ["Declined", "c-rose"];
  if (j.status === "cancelled") return ["Cancelled", "c-grey"];
  if (j.status === "done") return ["Done", "c-green"];
  const n = crew(j.id).length;
  if (needsNewDates(j)) return ["Needs new dates", "c-rose"];
  if (n >= spotsOf(j)) return j.toldAt ? ["Crew confirmed · client told", "c-green"] : ["Crew confirmed · call client", "c-amber"];
  if (needsExperienced(j)) return ["Needs a supervisor", "c-amber"];
  const left = spotsOf(j) - n;
  return [`Needs ${left} volunteer${left === 1 ? "" : "s"}`, "c-sky"];
}
const jChip = (j) => { const [t, c] = jobState(j); return `<span class="chip ${c}">${t}</span>`; };
function slots(j) {
  const c = crew(j.id);
  return `<div class="slots">${[...Array(spotsOf(j)).keys()].map((i) => {
    const s = c[i];
    if (s) { const v = vol(s.vid); return `<div class="slot ${s.asTrainee ? "trainee" : "exp"}"><b>${esc(v?.name || "Former volunteer")}</b>${s.asTrainee ? "Trainee" : LEVELS[levelOf(v)]?.name || "Experienced"}${carTag(v)}</div>`; }
    if (needsExperienced(j)) return `<div class="slot empty exp-only"><span class="plus">+</span><b>Open spot</b>Supervisor: Community Volunteer or above</div>`;
    return `<div class="slot empty"><span class="plus">+</span><b>Open spot</b>Anyone trained</div>`;
  }).join("")}</div>`;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3500); }
const myTokens = () => { try { return JSON.parse(localStorage.getItem(TOKENS_KEY)) || []; } catch { return []; } };
const rememberToken = (t) => { try { localStorage.setItem(TOKENS_KEY, JSON.stringify([t, ...myTokens().filter((x) => x !== t)].slice(0, 5))); } catch {} };

/* ============ DATA (Supabase) ============ */
const mapProfile = (p) => ({ id: p.id, role: p.role, name: p.name, email: p.email, phone: p.phone, uni: p.university, year: p.year, skills: p.skills || [], avail: p.availability || [], why: p.why, status: p.status, appliedAt: p.applied_at, reviewedAt: p.reviewed_at, trainedAt: p.trained_at, promotedAt: p.promoted_at, waiverPath: p.waiver_path, tempPassword: !!p.temp_password,
  level: p.level, hasCar: !!p.has_car, sharePhone: !!p.share_phone, shareEmail: !!p.share_email, prefsSetAt: p.prefs_set_at });
const mapClient = (c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, contact: c.contact, address: c.address, postal: c.postal, area: c.area });
const mapJob = (j) => ({ id: j.id, clientId: j.client_id, services: j.services, tools: j.tools || {}, flags: j.flags || [], notes: j.notes || "", windows: j.windows || [], status: j.status, date: j.date, start: j.start_time, hours: j.hours, createdAt: j.created_at, toldAt: j.told_at, attempts: j.attempts, lastAttemptAt: j.last_attempt_at, timeChangedAt: j.time_changed_at, publishedAt: j.published_at, doneAt: j.done_at, editedAt: j.edited_at, actualHours: j.actual_hours, crewedAt: j.crewed_at, dropoutAt: j.dropout_at, spots: j.spots || 2 });
const mapSignup = (s) => ({ id: s.id, jobId: s.job_id, vid: s.volunteer_id, asTrainee: s.as_trainee, at: s.created_at });
const must = ({ data, error }) => { if (error) throw error; return data; };

async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { S.me = null; return; }
  const p = must(await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle());
  S.me = p ? mapProfile(p) : null;
}
async function loadAdmin() {
  const [p, c, j, s, rep, an, em] = await Promise.all([sb.from("profiles").select("*"), sb.from("clients").select("*"), sb.from("jobs").select("*"), sb.from("job_signups").select("*"),
    sb.from("job_reports").select("*"), sb.from("admin_notes").select("*"), sb.from("email_outbox").select("*").order("created_at", { ascending: false }).limit(40)]);
  S.volunteers = must(p).map(mapProfile); S.clients = must(c).map(mapClient); S.jobs = must(j).map(mapJob); S.signups = must(s).map(mapSignup);
  // Tables added with notifications; tolerate them missing until the database is updated.
  const th = await sb.from("thanks").select("*"); S.thanks = th.error ? [] : th.data.sort((a, b) => b.created_at.localeCompare(a.created_at));
  S.reports = rep.error ? [] : rep.data; S.adminNotes = an.error ? [] : an.data.sort((a, b) => a.created_at.localeCompare(b.created_at)); S.emails = em.error ? [] : em.data;
}
async function loadDirectory() {
  const { data, error } = await sb.rpc("volunteer_directory");
  S.directory = error ? { people: [], thanks: [] } : data;
}
async function loadNotifs() {
  const { data, error } = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(40);
  S.notifs = error ? [] : data;
}
// The volunteer board comes from one server function that only returns what this volunteer may see.
async function loadBoard() {
  S.jobs = []; S.clients = []; S.signups = []; S.volunteers = [S.me];
  if (!canSeeBoard(S.me)) return;
  const data = must(await sb.rpc("volunteer_board"));
  S.myShadow = data.shadow_count; S.history = data.history || [];
  S.stats = data.stats || null; S.levelHistory = data.levels || []; S.levelRules = data.level_rules || null; S.myThanks = data.my_thanks || [];
  for (const b of data.jobs) {
    const cid = "c-" + b.id;
    S.clients.push({ id: cid, name: b.client_name || "", phone: b.client_phone || "", address: b.address || "", postal: b.postal || "", area: b.area });
    S.jobs.push({ id: b.id, clientId: cid, services: b.services, tools: b.tools || {}, flags: b.flags || [], notes: b.notes || "", windows: b.windows || [], status: b.status, date: b.date, start: b.start_time, hours: b.hours, timeChangedAt: b.time_changed_at, createdAt: b.created_at, crewedAt: b.crewed_at, spots: b.spots || 2 });
    for (const m of b.crew) {
      S.signups.push({ id: b.id + m.id, jobId: b.id, vid: m.id, asTrainee: m.as_trainee, at: m.at });
      const known = vol(m.id);
      if (!known) S.volunteers.push({ id: m.id, name: m.name, phone: m.phone || "", email: m.email || "", hasCar: !!m.has_car, level: m.level });
      else if (m.phone && known !== S.me) Object.assign(known, { phone: m.phone, email: m.email });
    }
  }
}
async function loadRequest() { S.request = /^[0-9a-f-]{36}$/i.test(S.token || "") ? must(await sb.rpc("get_request", { tok: S.token })) : null; }
async function refresh() {
  if (S.view === "admin") await Promise.all([loadAdmin(), loadNotifs()]);
  else if (S.view === "volunteer") { await loadMe(); await Promise.all([loadBoard(), loadNotifs(), S.volPage === "vcommunity" && canSeeBoard(S.me) ? loadDirectory() : null]); }
  else if (S.view === "request") await loadRequest();
}
async function goHome() {
  S.wiz = null; S.confirm = null; S.editing = null; S.resched = null; S.picking = null;
  if (S.me) { S.view = S.me.role === "admin" ? "admin" : "volunteer"; await refresh(); }
  else S.view = "home";
}

/* ============ ICONS & ART ============ */
const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const LOGO = `<svg viewBox="0 0 46 36" aria-hidden="true"><rect x="8" y="17" width="2.4" height="18" rx="1" fill="#3A4E10"/><circle cx="9.2" cy="14" r="7.5" fill="#749C20"/><rect x="22" y="14" width="2.4" height="21" rx="1" fill="#3A4E10"/><ellipse cx="23.2" cy="11" rx="7.5" ry="11" fill="#4F7A2C"/><rect x="36" y="19" width="2.4" height="16" rx="1" fill="#3A4E10"/><circle cx="37.2" cy="16.5" r="6.8" fill="#8DB83A"/></svg>`;
// Sidebar scene: hills, a house, trees and a fence.
const ART = `<svg viewBox="0 0 260 300" aria-hidden="true">
  <path d="M0 150 C60 120 120 140 170 118 C210 100 240 112 260 104 V300 H0Z" fill="#E4EDD6"/>
  <g transform="translate(70 120)"><path d="M0 40 L38 8 L76 40 Z" fill="#B9C9A2"/><rect x="6" y="38" width="64" height="48" fill="#F3EFE4"/><rect x="16" y="50" width="12" height="12" fill="#C9D9B3"/><rect x="48" y="50" width="12" height="12" fill="#C9D9B3"/><rect x="31" y="60" width="13" height="26" fill="#A88F6A"/></g>
  <g fill="#6B5B45"><rect x="27" y="150" width="5" height="60"/><rect x="200" y="140" width="5" height="70"/><rect x="232" y="168" width="4" height="40"/></g>
  <circle cx="30" cy="140" r="30" fill="#7FA35A"/><circle cx="14" cy="158" r="18" fill="#9DBE7A"/><circle cx="46" cy="160" r="16" fill="#8DB06A"/>
  <circle cx="203" cy="128" r="28" fill="#8DB06A"/><circle cx="222" cy="146" r="18" fill="#A9C784"/><circle cx="234" cy="160" r="14" fill="#7FA35A"/>
  <path d="M0 200 C70 172 150 196 260 170 V300 H0Z" fill="#A9C784"/>
  <g fill="#F4F1E6">${[...Array(13)].map((_, i) => `<rect x="${8 + i * 12}" y="${196 - i * 0.8}" width="5" height="22" rx="1.5"/>`).join("")}<rect x="6" y="203" width="156" height="3" transform="rotate(-4 6 203)"/></g>
  <path d="M0 224 C80 206 170 222 260 204 V300 H0Z" fill="#F7F9F1"/>
</svg>`;

/* ============ RENDER ============ */
function render() {
  if (S.view === "home" || (!S.view && !S.me)) { $("#root").innerHTML = homeView(); return; }
  const views = { loading: () => `<div class="loading">Loading…</div>`, setup: setupView, home: homeView, wizard: wizardView, request: requestView, login: loginView, signup: signupView, volunteer: volunteerView, admin: adminView };
  const tempPw = S.me?.tempPassword && (S.view === "admin" || S.view === "volunteer") && S.volPage !== "vaccount" && S.adminPage !== "settings"
    ? `<div class="note">You're using a temporary password from an admin. <button class="linkbtn" data-act="${S.view === "admin" ? "adminNav" : "volNav"}" data-id="${S.view === "admin" ? "settings" : "vaccount"}">Choose your own password</button></div>` : "";
  const body = (S.notice ? `<div class="note">${S.notice}</div>` : "") + tempPw + (views[S.view] || homeView)();
  const banner = S.bannerHidden ? "" : `<div class="seasonbar">${ic("leaf")}<span>${SEASON.label} · <b>Kingston · Outdoor work only</b></span><button class="x" data-act="hideBanner" aria-label="Hide this message">${ic("x")}</button></div>`;
  const foot = `<p class="foot-note">1Yard · volunteer yard help in Kingston, ON${OFFICE_PHONE ? ` · ${esc(OFFICE_PHONE)}` : ""}</p>`;
  const logo = `<button class="logo" data-act="go" data-id="home" aria-label="1Yard home">${LOGO}1Yard</button>`;
  if (S.me && (S.view === "admin" || S.view === "volunteer")) {
    $("#root").innerHTML = `<div class="shell">
      <aside class="side">${logo}<nav class="side-nav" aria-label="Main">${sideNav()}</nav>
        ${S.view === "admin" ? `<hr><nav class="side-nav">${navItem("settings", "Settings", "gear", S.adminPage === "settings")}</nav>` : ""}
        <div class="side-art">${ART}<div class="tag-line"><b>1Yard</b><span>Neighbour to neighbour.</span></div></div>
      </aside>
      <div class="main">
        <div class="mtop"><div class="bell-wrap" id="bell">${bellHtml()}</div><span class="who">${esc(first(S.me.name))} · ${S.me.role === "admin" ? "admin" : "volunteer"}</span><span class="avatar">${esc((S.me.name || "?").trim().charAt(0).toUpperCase())}</span><button class="btn ghost" data-act="logout">Log out</button></div>
        <div class="content">${banner}${body}${foot}</div>
      </div></div>`;
  } else {
    const clientish = ["home", "wizard", "request"].includes(S.view);
    const nav = S.view !== "login" && S.view !== "signup" ? `<button class="btn ghost" data-act="go" data-id="login">Volunteer log in</button>` : "";
    $("#root").innerHTML = `<header class="ptop">${logo}<div class="row">${nav}</div></header>
      <div class="pwrap"><div class="content ${clientish ? "client" : ""}">${banner}${body}${foot}</div></div>`;
  }
}
/* ---------------- BELL ---------------- */
const whenShort = (iso) => new Date(iso).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function bellHtml() {
  const unread = S.notifs.filter((n) => !n.read_at).length;
  const btn = `<button class="bellbtn" data-act="bell" aria-label="Notifications${unread ? `, ${unread} unread` : ""}" aria-expanded="${S.bellOpen}">${ic("bell")}${unread ? `<span class="dot">${unread > 9 ? "9+" : unread}</span>` : ""}</button>`;
  if (!S.bellOpen) return btn;
  return btn + `<div class="bellpanel" role="dialog" aria-label="Notifications">
    <div class="bellhead"><b>Notifications</b>${unread ? `<button class="linkbtn" data-act="notifAllRead">Mark all read</button>` : ""}</div>
    ${S.notifs.length ? S.notifs.map((n) => `<button class="notif ${n.read_at ? "" : "unread"} ${n.urgent ? "urgent" : ""}" data-act="notifOpen" data-id="${n.id}">
      ${n.urgent ? `<span class="urg">Urgent</span>` : ""}<span class="msg">${esc(n.message)}</span><span class="when">${ago(n.created_at)}</span></button>`).join("")
      : `<p class="muted small" style="padding:16px">Nothing yet. Updates about your jobs will show up here.</p>`}
  </div>`;
}
const drawBell = () => { const el = $("#bell"); if (el) el.innerHTML = bellHtml(); };
// Where a notification (or an email link like ?go=job:123) takes you.
function goTo(link) {
  if (!link || !S.me) return;
  const [kind, id] = link.split(":");
  if (S.view === "volunteer") {
    if (kind === "job") S.volPage = crew(id).some((s) => s.vid === S.me.id) ? "vhome" : "vboard";
    else if (["vhome", "vboard", "vrecord", "vcommunity", "vaccount"].includes(kind)) S.volPage = kind;
    else if (kind === "vhours") S.volPage = "vrecord";
    if (S.volPage === "vcommunity") loadDirectory().then(render);
    S.flash = kind === "job" && job(id) ? "job-" + id : null;
  } else if (S.view === "admin") {
    S.adminPage = "dash"; S.editing = null; S.resched = null;
    if (kind === "vaccount") S.adminPage = "settings";
    else if (kind === "thanks") { S.adminTab = "thanks"; S.flash = "admin-tabs"; }
    else if (["calls", "reqs", "apps"].includes(kind)) { S.adminTab = kind; S.flash = "admin-tabs"; }
    else if (kind === "jobs") {
      const j = job(id); S.adminTab = "jobs";
      if (j) S.jobFilter = j.status === "scheduled" ? "upcoming" : "past";
      S.flash = j ? "row-" + id : "admin-tabs";
    }
  }
  S.bellOpen = false;
  setTimeout(() => { const el = S.flash && document.getElementById(S.flash); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash"); } S.flash = null; }, 30);
}
// New notifications arrive by checking every minute while the page is open.
setInterval(async () => {
  if (!sb || !S.me || S.busy || document.visibilityState !== "visible" || !["admin", "volunteer"].includes(S.view)) return;
  try { await loadNotifs(); drawBell(); } catch {}
}, 60000);

const navItem = (id, label, icon, on, count) => `<button class="nav-item ${on ? "on" : ""}" data-act="${S.view === "admin" ? "adminNav" : "volNav"}" data-id="${id}">${ic(icon)}<span>${label}</span>${count ? `<span class="count">${count}</span>` : ""}</button>`;
function sideNav() {
  if (S.view === "admin") {
    const dash = S.adminPage === "dash";
    const n = { calls: callItems().length, reqs: S.jobs.filter((j) => j.status === "review").length, apps: S.volunteers.filter((v) => v.role !== "admin" && v.status === "pending").length };
    return navItem("dash", "Dashboard", "home", dash) + navItem("calls", "Calls to make", "phone", false, n.calls) + navItem("reqs", "New requests", "file", false, n.reqs) +
      navItem("apps", "Volunteer applications", "userplus", false, n.apps) + navItem("jobs", "Jobs", "cal") + navItem("vols", "Volunteers", "users");
  }
  const trained = canSeeBoard(S.me);
  return navItem("vhome", trained ? "My jobs" : "My application", "home", S.volPage === "vhome" || (!trained && S.volPage !== "vaccount")) +
    (trained ? navItem("vboard", "Open jobs", "search", S.volPage === "vboard") + navItem("vcommunity", "Volunteers", "users", S.volPage === "vcommunity") +
      navItem("vrecord", "My record", "clock", S.volPage === "vrecord") : "") +
    navItem("vaccount", "Account", "gear", S.volPage === "vaccount");
}
const endTime = (start, hours) => { const m = to_min(start) + Math.round(hours * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const to_min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
// How long a client has been waiting since they asked for help.
const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso)) / 864e5));
const waitText = (j) => { const d = daysSince(j.createdAt); return d === 0 ? "Asked today" : `Waiting ${d} day${d === 1 ? "" : "s"}`; };
const waitChip = (j) => j.createdAt && (j.status === "review" || j.status === "scheduled") ? `<span class="chip ${daysSince(j.createdAt) >= 7 ? "c-amber" : "c-grey"}" title="Asked for help on ${fmtDate(j.createdAt.slice(0, 10))}">${waitText(j)}</span>` : "";
// The client's most recent finished job before this one (admin only; volunteers don't load other jobs).
function lastHelped(j) {
  const prev = S.jobs.filter((x) => x.clientId === j.clientId && x.id !== j.id && x.status === "done" && x.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  return prev ? `Last helped ${fmtDate(prev.date)} (${daysSince(prev.date + "T12:00")} days ago)` : "First time asking for help";
}
// Volunteers can mark a job done once its start time has passed (admins any time).
const startsAt = (j) => new Date(`${j.date}T${j.start.padStart(5, "0")}`);
const hasStarted = (j) => j.date && j.start && startsAt(j) <= new Date();
const jobHours = (j) => +(j.actualHours ?? j.hours);
const hoursFor = (vid) => S.signups.filter((s) => s.vid === vid && job(s.jobId)?.status === "done").reduce((t, s) => t + jobHours(job(s.jobId)), 0);
const fmtHours = (h) => (Math.round(h * 10) / 10).toString().replace(/\.0$/, "");
const hourOptions = (cur) => [...Array(24)].map((_, i) => (i + 1) / 2).map((h) => `<option value="${h}" ${+cur === h ? "selected" : ""}>${fmtHours(h)} hour${h === 1 ? "" : "s"}</option>`).join("");
const doneForm = (j, label) => `<div class="confirm ok"><b>How many hours did the job take?</b><span class="small">Counts toward both volunteers' hours.</span>
  <select id="dh-${j.id}" aria-label="Hours worked" style="justify-self:start">${hourOptions(j.hours)}</select>
  <label class="small" for="dn-${j.id}"><b>Anything the team should know?</b> <span class="muted">(optional · only admins see this)</span></label>
  <textarea id="dn-${j.id}" rows="2" placeholder="e.g. Client asked about raking again in November"></textarea>
  <label class="check"><input type="checkbox" id="dc-${j.id}" data-concern="${j.id}"> Report a concern</label>
  <div id="dcw-${j.id}" class="stack" style="gap:6px" hidden>
    <select id="dct-${j.id}" aria-label="Type of concern" style="justify-self:start">${Object.entries(CONCERNS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>
    <textarea id="dcd-${j.id}" rows="2" placeholder="What happened? An admin will follow up."></textarea>
  </div>
  <div class="row"><button class="btn" data-act="doneYes" data-id="${j.id}">${label}</button><button class="btn ghost" data-act="confirmNo">Cancel</button></div></div>`;
// "Add to calendar" for the crew: a Google Calendar link and a downloadable .ics file.
const calStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function calInfo(j) {
  const c = client(j.clientId), s = startsAt(j), e = new Date(s.getTime() + j.hours * 36e5);
  return { s, e, title: "1Yard: " + jobTitle(j), where: [c.address, c.postal].filter(Boolean).join(", "),
    details: `1Yard volunteer job. The client provides the tools; bring your own gloves. ${location.origin}${location.pathname}?go=job:${j.id}` };
}
function gcalUrl(j) {
  const x = calInfo(j), u = encodeURIComponent;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${u(x.title)}&dates=${calStamp(x.s)}/${calStamp(x.e)}&location=${u(x.where)}&details=${u(x.details)}`;
}
function icsText(j) {
  const x = calInfo(j), e = (t) => t.replace(/[\\;,]/g, (m) => "\\" + m);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//1Yard//Volunteer jobs//EN", "BEGIN:VEVENT", `UID:${j.id}@1yard.ca`, `DTSTAMP:${calStamp(new Date())}`,
    `DTSTART:${calStamp(x.s)}`, `DTEND:${calStamp(x.e)}`, `SUMMARY:${e(x.title)}`, `LOCATION:${e(x.where)}`, `DESCRIPTION:${e(x.details)}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}
const setupView = () => `<div class="card stack"><h2>Almost there</h2><p>Add your Supabase URL and key to <code>docs/config.js</code> to turn the site on. See README.md.</p></div>`;

/* ---------------- PUBLIC HOME ---------------- */
// The public homepage has its own look (docs/landing.css, everything scoped to .lp).
function homeView() {
  const saved = myTokens();
  return `<div class="lp" id="top">
  <a class="skip" href="#main">Skip to content</a>
  <header>
    <div class="nav">
      <a class="logo" href="#top" aria-label="1Yard home">
        <svg width="42" height="34" viewBox="0 0 44 34" aria-hidden="true"><g fill="#4F7A2C"><circle cx="9" cy="11" r="7"/><circle cx="22" cy="8" r="8" fill="#1F4D2B"/><circle cx="35" cy="12" r="6.5"/></g><g stroke="#1F4D2B" stroke-width="2.4" stroke-linecap="round"><path d="M9 17v14M22 15v16M35 18v13"/></g></svg>
        1Yard
      </a>
      <nav class="pills" aria-label="On this page">
        <a href="#why"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L19 6 V11 C19 16 16 19 12 21 C8 19 5 16 5 11 V6 Z"/><path d="M9 12 L11 14 L15 10"/></svg>Why trust 1Yard</a>
        <a href="#how"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18 C14 18 10 6 16 6"/></svg>How 1Yard works</a>
        <a href="#impact"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 C5 15 3 11 3 8 A4.5 4.5 0 0 1 12 6 A4.5 4.5 0 0 1 21 8 C21 11 19 15 12 20 Z"/></svg>Community impact</a>
      </nav>
      <div class="vlinks"><a href="#volunteer" data-act="go" data-id="signup">Apply to volunteer</a><a href="#volunteer" data-act="go" data-id="login">Volunteer log in</a></div>
      <a class="btn primary" href="?start=request" data-act="wizStart">Request help <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12 H19 M13 6 L19 12 L13 18"/></svg></a>
    </div>
  </header>

  <main id="main">
    <!-- HERO · cream -->
    <section class="hero bg-cream has-wave">
      <svg class="corner-branch" viewBox="-6 -14 268 104" fill="none" stroke="#4F7A2C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M-4 52 C60 38 130 22 250 6" stroke="#8A6A45" stroke-width="3"/>
        <path d="M40 44 C34 24 44 12 56 8 C62 26 54 38 40 44 Z" fill="#DCE8CC"/>
        <path d="M66 39 C78 56 74 74 62 80 C54 64 56 50 66 39 Z" fill="#C9DCB0"/>
        <path d="M108 30 C102 12 112 0 124 -4 C130 12 122 26 108 30 Z" fill="#DCE8CC"/>
        <path d="M138 26 C150 42 146 60 134 66 C126 50 128 36 138 26 Z" fill="#DCE8CC"/>
        <path d="M190 16 C186 2 194 -8 204 -10 C208 4 202 14 190 16 Z" fill="#C9DCB0"/>
        <path d="M16 48 C24 66 18 82 6 86 C0 70 4 58 16 48 Z" fill="#DCE8CC"/>
      </svg>
      <div class="wrap hero-grid">
        <div>
          <p class="bubble">Fall 2026 services are now open in Kingston!</p>
          <h1>Student volunteers helping with outdoor home work, with dignity and <span class="swash">care<svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 10 C30 4 70 4 98 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span></h1>
          <p class="lead">1Yard is a student-led volunteer organization. We help seniors and people with physical limitations with demanding outdoor tasks. All services are free, with the option to make a voluntary donation to the Princess Margaret Cancer Centre.</p>
          <div class="ctas">
            <svg class="sparks" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M20 4 L24 14 M6 14 L16 19 M4 30 L14 29"/></svg>
            <a class="btn primary big" href="?start=request" data-act="wizStart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 C4 10 10 4 20 4 C20 14 14 20 4 20 Z"/><path d="M4 20 L14 10"/></svg>Request help <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12 H19 M13 6 L19 12 L13 18"/></svg></a>
            <a class="btn soft big" href="#thank"><svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 C5 15 3 11 3 8 A4.5 4.5 0 0 1 12 6 A4.5 4.5 0 0 1 21 8 C21 11 19 15 12 20 Z"/></svg>Thank a volunteer</a>
          </div>
          <p class="call"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4 H9 L11 9 L8.5 10.5 A11 11 0 0 0 13.5 15.5 L15 13 L20 15 V19 A2 2 0 0 1 18 21 A16 16 0 0 1 3 6 A2 2 0 0 1 5 4 Z"/></svg>Prefer to talk? Call <a href="tel:4164310010">416-431-0010</a> or email <a href="mailto:1yardqueens@gmail.com">1yardqueens@gmail.com</a></p>
          ${saved.length ? `<p class="mine"><button class="linkbtn" data-act="openRequest" data-id="${esc(saved[0])}">See my request</button></p>` : ""}
        </div>
        <!-- Hand-drawn garden scene: shrub, wheelbarrow of leaves, rake -->
        <svg class="scene" viewBox="0 0 520 440" aria-hidden="true">
          <path d="M40 372 C110 314 270 296 380 306 C470 314 516 344 516 374 C516 410 420 428 280 428 C140 428 40 410 40 372 Z" fill="#DCE8CC"/>
          <path d="M70 398 C150 376 330 370 480 390 C500 394 500 414 470 420 C360 434 180 434 96 422 C64 418 58 404 70 398 Z" fill="#C9DCB0"/>
          <g fill="#A9C784"><circle cx="400" cy="250" r="62"/><circle cx="460" cy="282" r="54"/><circle cx="350" cy="300" r="46"/></g>
          <g fill="#8DB06A"><circle cx="430" cy="214" r="34"/><circle cx="486" cy="250" r="30"/></g>
          <g fill="#FFFFFF" stroke="#E6DCC4" stroke-width="2"><circle cx="372" cy="262" r="9"/><circle cx="420" cy="290" r="10"/><circle cx="462" cy="244" r="8"/><circle cx="398" cy="226" r="7"/><circle cx="480" cy="300" r="9"/></g>
          <path d="M268 120 L330 368" stroke="#8A6A45" stroke-width="5" stroke-linecap="round"/>
          <g stroke="#536253" stroke-width="3" stroke-linecap="round"><path d="M306 352 L354 364 M310 356 L306 384 M318 358 L318 388 M326 360 L330 390 M334 362 L342 390 M342 364 L354 386"/></g>
          <path d="M130 300 H270 L250 350 H150 Z" fill="#4F7A2C"/>
          <path d="M130 300 H270" stroke="#2F5A17" stroke-width="5" stroke-linecap="round"/>
          <path d="M150 350 L120 380 M250 350 L264 380" stroke="#536253" stroke-width="5" stroke-linecap="round"/>
          <circle cx="200" cy="372" r="16" fill="#3A3A32"/><circle cx="200" cy="372" r="6" fill="#C9DCB0"/>
          <path d="M270 300 L310 292" stroke="#8A6A45" stroke-width="5" stroke-linecap="round"/>
          <path d="M150 300 C150 280 170 270 186 276 C182 292 168 300 150 300 Z" fill="#D9822B"/>
          <path d="M190 298 C186 276 206 264 222 268 C222 286 208 298 190 298 Z" fill="#C2412D"/>
          <path d="M226 300 C228 282 246 274 260 282 C254 296 240 302 226 300 Z" fill="#E3A72F"/>
          <path d="M90 400 C84 386 94 376 106 378 C108 392 100 400 90 400 Z" fill="#D9822B"/>
          <path d="M290 412 C292 398 306 392 316 398 C312 410 302 414 290 412 Z" fill="#C2412D"/>
          <path d="M60 418 C58 406 70 400 80 404 C78 416 70 420 60 418 Z" fill="#E3A72F"/>
        </svg>
      </div>
      <svg class="wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C240 0 480 70 760 36 C1020 6 1240 52 1440 24 V70 H0 Z" fill="#EEF3E6"/></svg>
    </section>

    <!-- SERVICES · sage -->
    <section class="svc-band has-wave" aria-labelledby="svc-title">
      <div class="wrap">
        <div class="svc-row">
          <h2 class="svc-title" id="svc-title">This fall, we can help with</h2>
          <ul class="svc">
            <li><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 38 C10 20 22 10 38 10 C38 26 28 38 10 38 Z"/><path d="M10 38 L30 18"/></svg>Raking leaves</li>
            <li><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 44 V22"/><path d="M24 30 C24 22 30 16 38 16 C38 24 32 30 24 30 Z"/><path d="M24 26 C24 18 18 12 10 12 C10 20 16 26 24 26 Z"/></svg>Garden bed clean-up</li>
            <li><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 40 H42"/><path d="M12 40 C12 30 10 24 8 20 M18 40 C18 28 20 22 24 16 M26 40 C26 30 28 26 32 22 M34 40 C34 32 36 28 40 26"/></svg>The last lawn mow</li>
            <li><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 34 L42 18"/><path d="M20 28 L16 16 M30 24 L34 12 M26 26 L30 36"/></svg>Branches and yard debris</li>
          </ul>
        </div>
        <p class="svc-note">Two volunteers come together. They bring gloves and use your tools. We only work outside.</p>
      </div>
      <svg class="wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 C300 64 560 4 860 28 C1120 48 1300 14 1440 34 V70 H0 Z" fill="#FFFFFF"/></svg>
    </section>

    <!-- WHY TRUST · white -->
    <section class="bg-white has-wave" id="why">
      <div class="wrap split">
        <div>
          <h2>We exist to extend <span class="swash">care<svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 10 C30 4 70 4 98 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span>, not just complete tasks.</h2>
          <p class="pull">Our volunteers step in as an extension of our clients' capacity when aging, illness, or mobility makes everyday tasks difficult.</p>
          <svg class="sprig" viewBox="0 0 120 60" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 52 C40 46 76 30 112 8"/>
            <path d="M40 44 C36 30 44 22 54 20 C56 32 50 40 40 44 Z" fill="#DCE8CC"/>
            <path d="M66 34 C74 46 70 56 60 58 C56 48 58 40 66 34 Z" fill="#DCE8CC"/>
            <path d="M88 22 C86 10 94 2 104 2 C104 12 98 20 88 22 Z" fill="#C9DCB0"/>
          </svg>
        </div>
        <div class="trust">
          <article><h3>Always free</h3><p>We never charge for our help. If you'd like to give back, you can donate to the Princess Margaret Cancer Centre. No money goes through 1Yard.</p></article>
          <article><h3>Local</h3><p>Students from Kingston's high schools and universities, helping their neighbours.</p></article>
          <article><h3>Safety first</h3><p>Volunteers always work in pairs and are trained in task safety before their first job.</p></article>
        </div>
      </div>
      <svg class="wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 26 C220 56 520 50 780 22 C1040 -2 1260 30 1440 46 V70 H0 Z" fill="#EEF3E6"/></svg>
    </section>

    <!-- HOW 1YARD WORKS · sage -->
    <section class="bg-sage has-wave" id="how">
      <div class="wrap">
        <div class="steps-head"><div>
          <h2>Getting help is <span class="swash orange">simple<svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 10 C30 4 70 4 98 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span></h2>
        </div></div>
        <div class="steps-wrap" style="position:relative;margin-top:48px">
          <svg class="path" viewBox="0 0 900 48" preserveAspectRatio="none" aria-hidden="true"><path d="M0 25 C120 4 220 46 300 25 C380 4 480 46 600 25 C700 8 800 42 900 25" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="7 9" stroke-linecap="round"/></svg>
          <ol class="steps">
            <li><h3>Reach out</h3><p>Request help on our website, or give us a call.</p></li>
            <li><h3>Tell us what you need</h3><p>We'll ask about your address, the work, and a few days that suit you.</p></li>
            <li><h3>We find two volunteers</h3><p>They pick a time on one of your days, and we let you know.</p></li>
            <li><h3>We show up and do the work</h3><span class="hand">That's it!</span></li>
          </ol>
        </div>
        <p class="cost"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 C4 10 10 4 20 4 C20 14 14 20 4 20 Z"/><path d="M4 20 L14 10"/></svg><span>All services are <b>free</b>, with the option to make a voluntary donation to the Princess Margaret Cancer Centre. No money goes through 1Yard.</span></p>
      </div>
      <svg class="wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 36 C260 8 520 60 800 34 C1060 10 1280 50 1440 28 V70 H0 Z" fill="#FAF6EC"/></svg>
    </section>

    <!-- IMPACT · cream -->
    <section class="bg-cream has-wave" id="impact">
      <div class="wrap impact-grid">
        <div>
          <div><p class="bignum">$17,000+<svg class="sparks" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M20 4 L16 14 M34 14 L24 19 M36 30 L26 29"/></svg></p></div>
          <p class="big-sub">raised for the Princess Margaret Cancer Foundation since 2021, thanks to community generosity.</p>
          <a class="btn soft donate" href="https://supportthepmcf.ca/ui/PDPCelebrate/p/231bd88823ca45efa285b5439d21e30d" target="_blank" rel="noopener"><svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 C5 15 3 11 3 8 A4.5 4.5 0 0 1 12 6 A4.5 4.5 0 0 1 21 8 C21 11 19 15 12 20 Z"/></svg>See our donation page <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 L17 7 M9 7 H17 V15"/></svg></a>
          <ul class="facts">
            <li>Donations go straight to Princess Margaret. No money goes through 1Yard.</li>
            <li>No money goes to volunteers or organizers.</li>
            <li>Volunteers will never ask for or accept payment directly.</li>
          </ul>
        </div>
        <div class="featured">
          <p class="hand">Featured by</p>
          <p><a href="https://globalnews.ca/video/10064957/young-man-honours-late-mother-by-starting-student-led-volunteer-organization" target="_blank" rel="noopener">Global News</a> and the <a href="https://torontoguardian.com/2023/08/toronto-charity-1yard/" target="_blank" rel="noopener">Toronto Guardian</a></p>
        </div>
      </div>
      <svg class="wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22 C280 52 540 6 820 30 C1080 52 1280 12 1440 30 V70 H0 Z" fill="#EEF3E6"/></svg>
    </section>

    <!-- THANK A VOLUNTEER · sage -->
    <section class="bg-sage has-wave" id="thank">
      <div class="wrap thank-grid">
        <div>
          <h2>Did our volunteers help <span class="swash red">you?<svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 10 C30 4 70 4 98 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span></h2>
          <p style="margin-top:18px">Leave a short note and we'll pass it on. It means a lot to the students who came by.</p>
          ${saved.length ? `<p style="margin-top:14px" class="opt">Already asked for help on this device? You can also say thanks from <button class="linkbtn" data-act="openRequest" data-id="${esc(saved[0])}">your request page</button>.</p>` : ""}
        </div>
        <div class="thank-card">
          <svg class="sparks" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M20 4 L16 14 M34 14 L24 19 M36 30 L26 29"/></svg>
          ${S.thanksSent ? `<h3>Thank you! ❤️</h3><p>We'll pass your note on to the volunteers. It will mean a lot to them.</p>
          <div><button class="btn soft" data-act="thanksAgain">Send another</button></div>` : `
          <div><label for="t-name">Your name</label><input id="t-name" autocomplete="name"></div>
          <div><label for="t-where">Your street or phone number <span class="opt">(so we know which visit)</span></label><input id="t-where" autocomplete="street-address"></div>
          <div><label for="t-vols">Volunteers' names <span class="opt">(if you remember them)</span></label><input id="t-vols"></div>
          <div><label for="t-msg">Your message</label><textarea id="t-msg" placeholder="e.g. Thank you, the yard looks wonderful!"></textarea></div>
          <p class="err" id="t-err" hidden></p>
          <div><button class="btn primary big" data-act="sendThanks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 C5 15 3 11 3 8 A4.5 4.5 0 0 1 12 6 A4.5 4.5 0 0 1 21 8 C21 11 19 15 12 20 Z"/></svg>Send thanks</button></div>`}
        </div>
      </div>
      <svg class="wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C300 10 600 58 900 30 C1140 8 1300 40 1440 26 V70 H0 Z" fill="#FFFFFF"/></svg>
    </section>

    <!-- VOLUNTEER · white -->
    <section class="bg-white has-wave" id="volunteer">
      <div class="wrap vol">
        <svg class="vol-art" viewBox="0 0 300 240" aria-hidden="true">
          <path d="M20 210 C70 180 230 176 286 206 C290 222 250 232 150 232 C60 232 16 226 20 210 Z" fill="#DCE8CC"/>
          <path d="M92 214 L196 44" stroke="#8A6A45" stroke-width="5" stroke-linecap="round"/>
          <g stroke="#536253" stroke-width="3" stroke-linecap="round" fill="none"><path d="M172 30 L222 60 M176 34 L168 52 M188 40 L180 60 M200 48 L192 68 M212 54 L204 74"/></g>
          <path d="M120 212 C106 200 106 184 118 176 C128 188 130 202 120 212 Z" fill="#D9822B"/>
          <path d="M152 218 C162 202 180 198 190 206 C182 218 166 222 152 218 Z" fill="#C2412D"/>
          <path d="M210 206 C206 190 216 178 230 178 C232 194 222 204 210 206 Z" fill="#E3A72F"/>
          <path d="M54 206 C50 190 60 178 74 178 C76 194 66 204 54 206 Z" fill="#A9C784"/>
          <path d="M244 214 C250 200 266 196 276 202 C270 214 256 218 244 214 Z" fill="#D9822B"/>
          <g fill="none" stroke="#E3A72F" stroke-width="3" stroke-linecap="round"><path d="M236 24 L240 36 M256 32 L246 40 M260 52 L248 52"/></g>
        </svg>
        <div>
          <h2>High school or university student? Volunteer with <span class="swash">1Yard.<svg viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 10 C30 4 70 4 98 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span></h2>
          <p style="margin-top:18px">Help neighbours with yard work around your classes. You pick the jobs and times, always with a partner. Your first two jobs are supervised shifts, with a Community Volunteer or above on the crew.</p>
          <div class="ctas"><a class="btn primary big" href="#volunteer" data-act="go" data-id="signup">Apply to volunteer <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12 H19 M13 6 L19 12 L13 18"/></svg></a><a class="btn soft" href="#volunteer" data-act="go" data-id="login">Volunteer log in</a></div>
        </div>
      </div>
      <svg class="wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 C240 60 520 10 800 32 C1060 52 1260 16 1440 36 V70 H0 Z" fill="#1F4D2B"/></svg>
    </section>
  </main>

  <footer>
    <svg class="foot-leaves" viewBox="0 0 220 200" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M30 190 C70 150 120 120 210 104"/>
      <path d="M80 152 C70 120 84 98 104 92 C110 120 100 142 80 152 Z"/>
      <path d="M128 126 C124 96 140 76 162 74 C164 102 150 120 128 126 Z"/>
      <path d="M110 140 C138 140 156 154 160 172 C134 176 116 162 110 140 Z"/>
    </svg>
    <div class="wrap foot">
      <div>
        <p class="logo" style="color:#fff">1Yard</p>
        <p style="margin-top:8px">Student volunteers providing essential outdoor home services in Kingston, with dignity and care.</p>
      </div>
      <div>
        <h3>Contact us</h3>
        <ul><li>Phone: <a href="tel:4164310010">416-431-0010</a></li><li>Email: <a href="mailto:1yardqueens@gmail.com">1yardqueens@gmail.com</a></li><li>Instagram: @1yard.ca</li><li>Nextdoor: search @1Yard</li></ul>
      </div>
      <div>
        <h3>On this page</h3>
        <ul><li><a href="?start=request" data-act="wizStart">Request help</a></li><li><a href="#why">Why trust 1Yard</a></li><li><a href="#how">How 1Yard works</a></li><li><a href="#impact">Community impact</a></li><li><a href="#thank">Thank a volunteer</a></li><li><a href="#volunteer">Volunteer</a></li><li><a href="#volunteer" data-act="go" data-id="login">Volunteer log in</a></li></ul>
      </div>
    </div>
    <p class="wrap fine">We are not a business and we are not paid contractors. All services are free, with the option to make a voluntary donation to the Princess Margaret Cancer Centre. No money goes through 1Yard.</p>
  </footer>
</div>`;
}

/* ---------------- CLIENT: status page (private link) ---------------- */
function requestView() {
  const r = S.request;
  if (!r) return `<div class="stack"><h1>We couldn't find that request</h1><p>The link may be wrong.${OFFICE_PHONE ? ` Please call us at <b>${esc(OFFICE_PHONE)}</b>.` : ""}</p><button class="bigbtn" data-act="go" data-id="home">Go to the home page</button></div>`;
  const crewNames = r.crew || [], full = crewNames.length >= (r.spots || 2), active = r.status === "review" || r.status === "scheduled";
  const wins = (r.windows || []).filter((x) => x.date > today()).sort((a, b) => a.date.localeCompare(b.date));
  let step = 1, msg = "";
  if (r.status === "review") msg = "We got your request. We'll call you soon to check the details.";
  else if (r.status === "scheduled" && r.needs_new_dates) { step = 2; msg = "We couldn't find volunteers for your days. We'll call you to pick new ones."; }
  else if (r.status === "scheduled" && !full && r.crewed && r.date) { step = 2; msg = `Your visit is set for <b>${fmtDate(r.date, true)} at ${fmtTime(r.start_time)}</b>. One volunteer can't come anymore, so we're finding someone else for that time. We'll call you if anything changes.`; }
  else if (r.status === "scheduled" && !full) { step = 2; msg = `We're finding ${r.spots || 2} volunteers for one of your days:<ul class="wins" style="margin-top:6px;font-size:1rem">${wins.map((x) => `<li>${fmtDate(x.date, true)}, ${PARTS[x.part].name.toLowerCase()}</li>`).join("")}</ul>`; }
  else if (r.status === "scheduled") { step = 3; msg = `<b>${joinNames(crewNames.map(esc))}</b> will come on <b>${fmtDate(r.date, true)} at ${fmtTime(r.start_time)}</b>.`; }
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
    ${r.status === "done" ? (r.thanked ? `<p class="thanks-done">❤️ You thanked ${joinNames(crewNames.map(esc)) || "the volunteers"}. Thank you!</p>`
      : `<article class="card stack"><h2 style="font-size:1.35rem">Want to thank ${joinNames(crewNames.map(esc)) || "your volunteers"}?</h2>
        <label class="lbl" for="ty-msg">A short message <span class="muted">(optional)</span></label>
        <textarea id="ty-msg" placeholder="e.g. Thank you, the yard looks wonderful!"></textarea>
        <button class="bigbtn" data-act="thankCrew">❤️ Send thanks</button></article>`) : ""}
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
    <p>Tap <b>${MIN_DAYS} to ${MAX_DAYS} days</b>, with <b>at least one from each week</b>. Then tap morning, afternoon, or either.</p>
    <p class="lbl">${picked.length} of ${MAX_DAYS} days picked${picked.length >= MIN_DAYS ? " ✓" : ""}</p>
    <h2>In the next 7 days</h2><div class="days">${[1, 2, 3, 4, 5, 6, 7].map(dayCard).join("")}</div>
    <h2>The week after</h2><div class="days">${[8, 9, 10, 11, 12, 13, 14].map(dayCard).join("")}</div>
    ${picked.length && !(wk1 && wk2) ? `<p class="note">Please also pick a day from ${wk1 ? "the week after" : "the next 7 days"}. Spreading your days out gives more volunteers a chance to help.</p>` : ""}
    ${picked.length && !picked.some((p) => [0, 6].includes(new Date(p.date + "T12:00").getDay())) ? `<p class="note">Tip: picking a Saturday or Sunday helps. That's when most of our student volunteers are free.</p>` : ""}
    ${picked.some((p) => p.part !== "any") ? `<p class="note">Tip: <b>Either</b> (9am–6pm) gives more volunteers a chance than morning or afternoon only.</p>` : ""}
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
  if (step === "when" && !(d.windows.some((p) => p.date <= day(7)) && d.windows.some((p) => p.date > day(7)))) return "Please pick at least one day from each week.";
  if (step === "tools" && neededTools(d.services).some((t) => d.tools[t] === undefined)) return "Please tap Yes or No for each tool.";
  if (step === "you" && !d.name.trim()) return "Please type your name.";
  if (step === "you" && d.phone.replace(/\D/g, "").length < 10 && !d.email.trim()) return "Please give us a phone number (with area code) or an email.";
  if (step === "review" && !d.agree) return "Please tick the box to say you understand.";
  return "";
}

/* ---------------- LOGIN / VOLUNTEER SIGN-UP ---------------- */
// Password box with a Show/Hide button so people can check what they typed.
const pwField = (id, label, auto, extra = "") => `<div class="field"><label class="lbl" for="${id}">${label}</label>
  <div class="row" style="flex-wrap:nowrap"><input type="password" id="${id}" required autocomplete="${auto}" ${extra}>
  <button type="button" class="btn ghost" data-act="togglePw" data-id="${id}" aria-controls="${id}" aria-pressed="false" style="min-width:76px">Show</button></div></div>`;
const loginView = () => `<form class="card stack authcard" id="login-form">
    <h1>Volunteer log in</h1>
    <div class="field"><label class="lbl" for="l-email">Email</label><input type="email" id="l-email" required autocomplete="email"></div>
    ${pwField("l-pass", "Password", "current-password")}
    <button class="btn" type="submit">Log in</button>
    <p class="small muted">Forgot your password? Contact the 1Yard team.</p>
    <p class="small">New volunteer? <button type="button" class="linkbtn" data-act="go" data-id="signup">Apply here</button></p>
  </form>`;
function signupView() {
  const other = (id, ph) => `<input type="text" id="${id}" placeholder="${ph}" hidden style="margin-top:8px">`;
  return `<div class="head"><div><h1>Volunteer with 1Yard</h1><p>Open to university students. Help seniors and people with physical limitations in Kingston with outdoor yard work. Apply below and an admin will review it.</p></div></div>
  <form class="card stack" id="signup">
    <div class="grid2">
      <div class="field"><label class="lbl" for="f-first">First name</label><input type="text" id="f-first" required autocomplete="given-name"></div>
      <div class="field"><label class="lbl" for="f-last">Last name</label><input type="text" id="f-last" required autocomplete="family-name"></div>
      <div class="field"><label class="lbl" for="f-email">Email</label><input type="email" id="f-email" required autocomplete="email" placeholder="you@example.com"></div>
      <div class="field"><label class="lbl" for="f-phone">Phone</label><input type="tel" id="f-phone" required autocomplete="tel"></div>
      ${pwField("f-pass", "Create a password", "new-password", 'minlength="8" placeholder="At least 8 characters"')}
      <div class="field"><label class="lbl" for="f-uni">University</label>
        <select class="in" id="f-uni" required><option value="" disabled selected>Choose your university</option>${UNIS.map((u) => `<option>${esc(u)}</option>`).join("")}<option value="__other">Other</option></select>
        ${other("f-uni-other", "Type your university")}</div>
    </div>
    <div class="field"><span class="lbl">Year of study</span>
      <div class="checks">${YEARS.map((a, i) => `<label class="check"><input type="radio" name="year" id="yr-${i}" value="${a}" required>${a}</label>`).join("")}<label class="check"><input type="radio" name="year" id="yr-other" value="__other">Other</label></div>
      ${other("f-year-other", "Type your year or program")}</div>
    <div class="field"><span class="lbl">What can you do?</span>
      <div class="checks">${Object.entries(SKILLS).map(([k, n]) => `<label class="check"><input type="checkbox" id="sk-${k}" name="skill" value="${k}">${n}</label>`).join("")}<label class="check"><input type="checkbox" id="sk-other" name="skill" value="__other">Other</label></div>
      ${other("f-skill-other", "What else can you do?")}</div>
    <div class="field"><label class="lbl" for="f-why">Why do you want to volunteer?</label><textarea id="f-why" required></textarea></div>
    <div class="field"><span class="lbl">Car</span>
      <label class="check"><input type="checkbox" id="f-car"> I have a car I'm willing to use for 1Yard jobs</label>
      <span class="small muted">Helps partners plan how to get there. You can change this later.</span></div>
    <div class="field"><span class="lbl">Volunteer directory</span>
      <span class="small muted">Trained volunteers can see each other's name, school, level and hours. Choose whether to also show:</span>
      <label class="check"><input type="checkbox" id="f-share-phone"> My phone number</label>
      <label class="check"><input type="checkbox" id="f-share-email"> My email</label>
      <span class="small muted">Your partner on a job always sees your phone and email. You can change this later under Account.</span></div>
    <label class="check" style="max-width:560px"><input type="checkbox" id="f-verify" required> I confirm the information above is correct.</label>
    <div class="row"><button class="btn" type="submit">Submit application</button><span class="small muted">Already applied? <button type="button" class="linkbtn" data-act="go" data-id="login">Log in</button></span></div>
  </form>`;
}

/* ---------------- VOLUNTEER ---------------- */
// Change your own password (everyone who logs in).
const passwordCard = () => `<section class="card stack" style="max-width:560px">
  <h2>Change your password</h2>
  ${S.me.tempPassword ? `<p class="small">You're using a temporary password an admin gave you. Pick one only you know.</p>` : `<p class="small muted">Forgot it? An admin can set a temporary one for you.</p>`}
  <form id="pw-form" class="stack">
    ${pwField("pw-new", "New password", "new-password", 'minlength="8" placeholder="At least 8 characters"')}
    ${pwField("pw-new2", "Type it again", "new-password", 'minlength="8"')}
    <div><button class="btn" type="submit">Save new password</button></div>
  </form></section>`;
// Car + what to share in the volunteer directory. Changeable any time.
const prefsCard = () => `<section class="card stack" style="max-width:560px">
  <h2>Car and volunteer directory</h2>
  <label class="check"><input type="checkbox" id="pf-car" ${S.me.hasCar ? "checked" : ""}> I have a car I'm willing to use for 1Yard jobs</label>
  <p class="small muted">Trained volunteers can see each other in the volunteer directory: name, school, level, hours and car. Choose what contact details to show there. Your partner on a job always sees your phone and email.</p>
  <label class="check"><input type="checkbox" id="pf-phone" ${S.me.sharePhone ? "checked" : ""}> Show my phone number in the directory</label>
  <label class="check"><input type="checkbox" id="pf-email" ${S.me.shareEmail ? "checked" : ""}> Show my email in the directory</label>
  <div><button class="btn" data-act="savePrefs">Save</button></div></section>`;
const accountView = () => `<div class="head"><div><h1>Account</h1><p>${esc(S.me.name)} · ${esc(S.me.email)}</p></div></div>` + prefsCard() + passwordCard();
// Volunteer directory + thank-you wall (trained volunteers only).
function communityView() {
  const d = S.directory || { people: [], thanks: [] };
  const people = d.people.filter((p) => S.dirFilter !== "car" || p.has_car);
  const stat = (n, label) => `<span><b>${n}</b> ${label}</span>`;
  return `<div class="head"><div><h1>Volunteers</h1><p>Everyone helping out with 1Yard. Contact details show only if the volunteer chose to share them.</p></div></div>
  <section class="stack">
    <h2>❤️ Thank-yous from clients</h2>
    ${d.thanks.length ? `<div class="thanks-wall">${d.thanks.map((t) => `<article class="card thank">
      ${t.message ? `<p class="tmsg">“${esc(t.message)}”</p>` : `<p class="tmsg">A client said thank you ❤️</p>`}
      <p class="small muted">${t.job ? `${esc((t.crew || []).map(first).join(" and "))} · ${esc(t.job)}${t.area ? ` · ${esc(t.area)}` : ""}${t.date ? ` · ${fmtDate(t.date)}` : ""}` : "To all our volunteers"}</p></article>`).join("")}</div>`
      : `<div class="empty">No thank-yous yet. When clients say thanks, they'll show up here.</div>`}
  </section>
  <section class="stack">
    <div class="filters">${[["all", "Everyone"], ["car", "🚗 Has a car"]].map(([k, n]) => `<button data-act="dirFilter" data-id="${k}" aria-pressed="${S.dirFilter === k}">${n}</button>`).join("")}</div>
    <div class="dir">${people.map((p) => `<article class="card person">
      <div class="row" style="justify-content:space-between"><b>${esc(p.name)}</b>${levelChip({ level: p.level })}</div>
      <span class="small muted">${esc(p.university)}${p.year ? ` · ${esc(p.year)}` : ""}</span>
      <div class="pstats">${stat(fmtHours(+p.stats.hours), +p.stats.hours === 1 ? "hour" : "hours")}${stat(p.stats.jobs, p.stats.jobs === 1 ? "job" : "jobs")}${stat(p.stats.supervised, p.stats.supervised === 1 ? "trainee shift supervised" : "trainee shifts supervised")}${stat(p.stats.thanks, "❤️")}</div>
      ${p.has_car ? `<span class="small">🚗 Has a car</span>` : ""}
      ${p.phone || p.email ? `<span class="small">${p.phone ? `📞 ${esc(p.phone)}` : ""}${p.phone && p.email ? " · " : ""}${p.email ? `✉️ ${esc(p.email)}` : ""}</span>` : `<span class="small muted">Contact details not shared</span>`}
    </article>`).join("") || `<div class="empty">Nobody here yet.</div>`}</div>
  </section>`;
}
// My record: level, progress, milestones and hours. Printable for applications.
function recordView(v) {
  const st = S.stats || { hours: 0, jobs: 0, supervised: 0, thanks: 0 }, lv = levelOf(v), rules = S.levelRules || {};
  const reached = Object.fromEntries(S.levelHistory.map((e) => [e.level, e.at]));
  const cur = LEVEL_ORDER.indexOf(lv), bar = (have, goal, label) => `<div class="prog"><div class="row" style="justify-content:space-between"><span>${label}</span><b>${fmtHours(Math.min(have, goal))} of ${goal}</b></div><div class="bar"><i style="width:${Math.min(100, (have / goal) * 100)}%"></i></div></div>`;
  // Every level you can reach by volunteering, with what it takes and how far along you are.
  const path = [
    ["trainee", "Finish online training and upload your signed waiver.", ""],
    ["community", `Finish ${SHADOW_SHIFTS_NEEDED} supervised shifts: jobs with a Community Volunteer or above on the crew.`, bar(lv === "trainee" ? S.myShadow : SHADOW_SHIFTS_NEEDED, SHADOW_SHIFTS_NEEDED, "Supervised shifts done")],
    ...["senior", "team_lead"].filter((k) => rules[k]).map((k) => [k, `Volunteer ${rules[k].hours} hours and supervise ${rules[k].supervised} trainee shifts.`,
      bar(+st.hours, rules[k].hours, "Hours volunteered") + bar(st.supervised, rules[k].supervised, "Trainee shifts supervised")]),
  ];
  const ladder = `<ol class="ladder">${path.map(([k, need, bars], i) => {
    const done = i <= cur, here = i === cur;
    return `<li class="${done ? "done" : ""} ${here ? "here" : ""}"><span class="dot">${done ? "✓" : LEVELS[k].em}</span><div class="stack" style="gap:6px">
      <div class="row"><b>${LEVELS[k].em} ${LEVELS[k].name}</b>${here ? `<span class="chip c-green">You're here</span>` : done && reached[k] ? `<span class="small muted">Reached ${fmtDate(reached[k].slice(0, 10))}</span>` : ""}</div>
      <span class="small">${need}</span>${!done ? bars : ""}</div></li>`;
  }).join("")}</ol>`;
  const tip = cur >= 1 && cur < 3 ? `<p class="small muted">Tip: every job you work that has a trainee on the crew counts as one trainee shift supervised. On <b>Open jobs</b>, pick <b>Trainee needs a supervisor</b> to find them.</p>` : "";
  const how = `<div class="howlevels"><b>How it works</b>
    <p><b>Trainees</b> have finished online training. Their first ${SHADOW_SHIFTS_NEEDED} jobs are <b>supervised shifts</b>: there's always a Community Volunteer or above on the crew.</p>
    <p><b>Community Volunteers and above</b> can take any spot and supervise trainees. Every job you work that has a trainee on it counts as one <b>trainee shift supervised</b>.</p>
    <p>At most half of any crew can be trainees, so every trainee has a supervisor.</p></div>`;
  const progress = `<h2 style="font-size:1.3rem">Your path</h2>${how}${ladder}${tip}`;
  const stat = (cls, icon, n, label) => `<div class="stat ${cls}"><span class="sico">${icon}</span><div><b>${n}</b><span>${label}</span></div></div>`;
  return `<div class="head"><div><h1>My record</h1><p>${esc(v.name)} · ${esc(v.uni)}. Handy for school service hours and applications.</p></div><button class="btn ghost noprint" data-act="print">Print or save as PDF</button></div>
  <section class="card stack levelcard"><div class="row">${levelChip(v)}${v.trainedAt ? `<span class="small muted">Volunteer since ${fmtDate(v.trainedAt.slice(0, 10))}</span>` : ""}</div>${progress}</section>
  <div class="stats">
    ${stat("s-sky", ic("clock"), fmtHours(+st.hours), "Hours volunteered")}${stat("s-green", ic("leaf"), st.jobs, "Jobs completed")}
    ${stat("s-lilac", ic("users"), st.supervised, "Trainee shifts supervised")}${stat("s-peach", "❤️", st.thanks, "Thank-yous from clients")}
  </div>
  ${(S.myThanks || []).length ? `<section class="card stack"><h2>❤️ Thank-yous for you</h2><div class="list">${S.myThanks.map((t) => `<div class="quote">${t.message ? `“${esc(t.message)}”` : "A client said thank you."}<div class="small muted" style="margin-top:4px">${esc(t.job)}${t.date ? ` · ${fmtDate(t.date)}` : ""}</div></div>`).join("")}</div></section>` : ""}
  ${S.levelHistory.length ? `<section class="card stack"><h2>Milestones</h2><ul class="wins">${S.levelHistory.map((e) => `<li>${LEVELS[e.level]?.em || ""} <b>${LEVELS[e.level]?.name || esc(e.level)}</b> · ${fmtDate(e.at.slice(0, 10))}</li>`).join("")}</ul></section>` : ""}
  ${S.history.length ? `<div class="card table-wrap"><table>
    <thead><tr><th>Date</th><th>Work</th><th>Neighbourhood</th><th>Hours</th></tr></thead>
    <tbody>${S.history.map((h) => `<tr><td><b>${fmtDate(h.date)}</b></td><td>${esc(h.services.map((x) => svc(x).name).join(" + "))}</td><td>${esc(h.area)}</td><td class="num"><b>${fmtHours(+h.hours)}</b></td></tr>`).join("")}</tbody>
  </table></div>` : `<div class="empty">No finished jobs yet. When you and your partner mark a job done, the hours show up here.</div>`}
  <p class="small muted">Need an official letter? Ask a 1Yard admin; they can confirm every number on this page.</p>`;
}
function volunteerView() {
  if (S.volPage === "vaccount") return accountView();
  const v = S.me, sc = S.myShadow;
  const [doneCount, nowStep] = { pending: [1, 1], declined: [1, -1], approved: [2, 2], trainee: [3, 3], experienced: [5, -1] }[v.status];
  const steps = [["Apply", "Send your application"], ["Approval", "An admin reviews it"], ["Online training", "Modules and waiver"],
    ["Supervised shifts", v.status === "trainee" ? `${sc} of ${SHADOW_SHIFTS_NEEDED} done` : `${SHADOW_SHIFTS_NEEDED} jobs with a supervisor on the crew`], ["Community Volunteer", "Can supervise trainees"]];
  const stepper = `<ol class="steps">${steps.map(([b, s], i) => `<li class="${i < doneCount ? "done" : ""} ${i === nowStep ? "now" : ""}"><b>${b}</b>${s}</li>`).join("")}</ol>`;
  let body = "";
  if (v.status === "pending") body = `<div class="card stack"><h2>Thanks, ${esc(first(v.name))}. Your application is in.</h2>
    <p class="muted">An admin will review it soon. Once you're approved, your training and waiver will show up here. Check back in a day or two.</p></div>` + lockedBoard();
  else if (v.status === "declined") body = `<div class="card stack"><h2>Application not approved</h2>
    <p class="muted">Thanks for your interest in 1Yard. Your application wasn't approved this season. Contact the team if you have questions.</p></div>`;
  else if (v.status === "approved") body = trainingView() + lockedBoard();
  else if (S.volPage === "vboard") return `<div class="head"><div><h1>Open jobs</h1><p>Each job shows how many volunteers it needs (usually 2). If a job has no one yet, you pick the exact time from the days the client is free. Bring your own gloves; the client provides the tools.</p></div><button class="btn" data-act="reload">${ic("refresh")} Refresh</button></div>` + openBoard(v);
  else if (S.volPage === "vrecord" || S.volPage === "vhours") return recordView(v);
  else if (S.volPage === "vcommunity") return communityView();
  else body = myJobsView(v, sc);
  return `<div class="head"><div><h1>Hi, ${esc(first(v.name))}</h1><p>${esc(v.uni)} · ${esc(v.skills.map((s) => SKILLS[s] || s).join(", "))}</p></div>${canSeeBoard(v) ? levelChip(v) : vChip(v.status)}</div>` + stepper + body;
}
function trainingView() {
  return `<section class="card stack">
    <div><h2>You're approved. Finish online training to start.</h2>
    <p class="muted">Read the training guides, sign the waiver, then upload it here.</p></div>
    <div class="label">Training guides</div>
    <div class="list">${TRAINING.map((m, i) => `<div class="module"><div class="ico">${i + 1}</div>
      <div><b>${esc(m.title)}</b><div class="muted small">${esc(m.detail)}</div></div>
      <a class="btn ghost" href="${esc(m.url)}" target="_blank" rel="noopener">Open</a></div>`).join("")}</div>
    <div class="label">Volunteer waiver</div>
    <div class="module"><div class="ico">PDF</div><div><b>1Yard Volunteer Waiver</b><div class="muted small">Download, sign, and upload the signed copy.</div></div>
      <a class="btn ghost" href="${esc(CFG.waiverUrl || "#")}" target="_blank" rel="noopener">Download PDF</a></div>
    <div class="drop">
      <label class="lbl" for="waiver-file">Upload your signed waiver <span class="muted small">(PDF, up to 5 MB)</span></label>
      <input type="file" id="waiver-file" accept="application/pdf,.pdf">
      <span class="small muted" id="file-note">No file chosen yet.</span>
    </div>
    <label class="check" style="max-width:480px"><input type="checkbox" id="done-training"> I have read and understood the 1Yard Volunteer Training Guide</label>
    <div class="row"><button class="btn" data-act="finish" id="finish" disabled>Finish training</button><span class="small muted" id="finish-hint">Upload your waiver and tick the box to continue.</span></div>
    <div class="note small">Next: you'll be a <b>trainee</b>. Your first ${SHADOW_SHIFTS_NEEDED} jobs are supervised shifts, with a Community Volunteer or above on the crew. After that you're a Community Volunteer.</div>
  </section>`;
}
const lockedBoard = () => `<div class="lock"><div style="font-size:1.8rem">🔒</div><h3>The job board is locked</h3><p class="muted small">Only volunteers who've finished training can see and sign up for jobs.</p></div>`;
function myJobsView(v, sc) {
  const mine = S.jobs.filter((j) => crew(j.id).some((s) => s.vid === v.id)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const total = S.history.reduce((t, h) => t + +h.hours, 0);
  const intro = v.status === "trainee"
    ? `<div class="note"><b>You're a trainee: ${sc} of ${SHADOW_SHIFTS_NEEDED} supervised shifts done.</b> A supervised shift is a job with a Community Volunteer or above on the crew. At most half of any crew can be trainees, so you're never without a supervisor. Once a job's trainee spots are taken, the rest are for supervisors.</div>`
    : `<div class="note"><b>You're a ${LEVELS[levelOf(v)].name}.</b> You can supervise trainees. Jobs where a trainee is waiting for a supervisor are shown first on Open jobs. Trainees can't go without you.</div>`;
  const prefsNote = !v.prefsSetAt ? `<div class="note"><b>New:</b> tell us if you have a car, and whether to show your phone or email in the volunteer directory. <button class="linkbtn" data-act="volNav" data-id="vaccount">Update in Account</button></div>` : "";
  return `${prefsNote}${intro}
  <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="stat s-green"><span class="sico">${ic("cal")}</span><div><b>${mine.length}</b><span>Upcoming jobs</span></div></div>
    <div class="stat s-sky"><span class="sico">${ic("clock")}</span><div><b>${fmtHours(total)}</b><span>Hours volunteered</span></div></div>
    <div class="stat s-peach"><span class="sico">${ic("leaf")}</span><div><b>${S.history.length}</b><span>Jobs completed</span></div></div>
  </div>
  <section class="stack">
    <div class="head"><div><h2>My upcoming jobs</h2><p>Client name, phone and notes appear on jobs you've signed up for.</p></div><button class="btn ghost" data-act="volNav" data-id="vboard">${ic("search")} Find a job</button></div>
    ${mine.length ? `<div class="jobs">${mine.map((j) => myJobCard(j, v)).join("")}</div>` : `<div class="empty">You haven't signed up for anything yet. <button class="linkbtn" data-act="volNav" data-id="vboard">See open jobs</button></div>`}
  </section>`;
}
function openBoard(v) {
  let open = S.jobs.filter((j) => !isFull(j) && !needsNewDates(j) && !crew(j.id).some((s) => s.vid === v.id));
  if (S.boardFilter === "skills") open = open.filter((j) => neededSkills(j.services).every((k) => v.skills.includes(k)));
  if (S.boardFilter === "exp") open = open.filter(needsExperienced);
  const rank = (j) => v.status === "experienced" ? (needsExperienced(j) ? 0 : 1) : (canJoin(v, j).ok ? 0 : 1);
  open.sort((a, b) => rank(a) - rank(b) || sortKey(a).localeCompare(sortKey(b)));
  const filters = [["all", "All open jobs"], ["skills", "Fits my skills"], ...(v.status === "experienced" ? [["exp", "Trainee needs a supervisor"]] : [])];
  return `<div class="filters">${filters.map(([k, n]) => `<button data-act="boardFilter" data-id="${k}" aria-pressed="${S.boardFilter === k}">${n}</button>`).join("")}</div>
    ${open.length ? `<div class="jobs">${open.map((j) => openJobCard(j, v)).join("")}</div>` : `<div class="empty">No open jobs right now. Check back soon.</div>`}`;
}
// Same layout for every job card: title, then When / Where / Skills / Tools / Heads up.
function jobFacts(j, v, full) {
  const c = client(j.clientId), skills = neededSkills(j.services), have = neededTools(j.services).filter((t) => j.tools[t]), miss = missingTools(j);
  const when = isLocked(j)
    ? `<div><b>${fmtDate(j.date)} · ${fmtTime(j.start)}–${fmtTime(endTime(j.start, j.hours))}</b> <span class="muted">(about ${j.hours}h)</span></div>`
    : `<div><b>You pick the start time</b> <span class="muted">(about ${j.hours}h)</span>, on one of the client's free days:<ul class="wins" style="margin-top:4px">${liveWindows(j).map((x) => `<li>${windowText(x)}</li>`).join("")}</ul></div>`;
  return `<dl>
    <dt>When</dt><dd>${when}</dd>
    <dt>Where</dt><dd><div><b>${esc(c.address)}${c.postal ? `, ${esc(c.postal)}` : ""}</b> <span class="muted">${esc(c.area)}</span></div></dd>
    ${full ? `<dt>Client</dt><dd>${esc(c.name)} · ${esc(c.phone)}</dd>` : ""}
    <dt>Skills</dt><dd>${skills.length ? skills.map((k) => `<span class="tag ${v.skills.includes(k) ? "have" : ""}">${v.skills.includes(k) ? "✓ " : ""}${SKILLS[k]}</span>`).join("") : `<span class="muted">No special skills</span>`}</dd>
    <dt>Tools</dt><dd>${have.map((t) => `<span class="tag">${TOOLS[t].name}</span>`).join("")}${miss.map((t) => `<span class="tag warn">No ${TOOLS[t].name.toLowerCase()}</span>`).join("")}<span class="tag">Bring: gloves</span></dd>
    ${j.flags.length ? `<dt>Heads up</dt><dd>${j.flags.map((f) => `<span class="tag">${FLAGS[f].em} ${FLAGS[f].name}</span>`).join("")}</dd>` : ""}
    ${j.notes && full ? `<dt>Note</dt><dd>${esc(j.notes)}</dd>` : ""}
  </dl>`;
}
const jobTop = (j) => `<div class="stack" style="gap:6px;justify-items:start"><h3>${esc(jobTitle(j))}</h3>${waitChip(j)}</div>`;
function picker(j, cur, verb) {
  return `<div class="picker">
    <label class="lbl" for="pk-${j.id}">Pick a start time (job takes about ${j.hours}h)</label>
    <select id="pk-${j.id}">${timeChoices(j, cur)}</select>
    <p class="small muted">Everyone else on the crew signs up for the time you choose.</p>
    <div class="row"><button class="btn" data-act="choose" data-id="${j.id}">${verb}</button><button class="btn ghost" data-act="pickCancel">Cancel</button></div>
  </div>`;
}
function openJobCard(j, v) {
  const r = canJoin(v, j), pri = v.status === "experienced" && needsExperienced(j), locked = isLocked(j);
  const action = !r.ok ? `<button class="btn locked" disabled title="${esc(r.why)}">🔒 ${esc(r.why)}</button>`
    : locked ? `<button class="btn" data-act="join" data-id="${j.id}">Sign up for ${fmtTime(j.start)}</button>`
    : `<button class="btn" data-act="pickOpen" data-id="${j.id}">Sign up and pick a time</button>`;
  return `<article class="card job ${pri ? "priority" : ""}" id="job-${j.id}">
    ${jobTop(j)}
    ${jobFacts(j, v, false)}
    ${slots(j)}
    ${S.picking === j.id ? picker(j, "", "Confirm sign-up") : `<div class="foot">${jChip(j)}${action}</div>`}
  </article>`;
}
function myJobCard(j, v) {
  const c = crew(j.id), me = c.find((s) => s.vid === v.id), others = c.filter((s) => s.vid !== v.id), full = isFull(j), partner = others[0];
  const mates = others.map((s) => vol(s.vid)).filter(Boolean), traineesLeft = !me.asTrainee && others.some((s) => s.asTrainee) && others.filter((s) => !s.asTrainee).length === 0;
  const started = hasStarted(j), soon = isLocked(j) && startsAt(j) - Date.now() < 864e5;
  const cant = started ? "" : `<button class="btn danger" data-act="leave" data-id="${j.id}">I can't make it</button>`;
  let foot;
  if (S.confirm === "leave:" + j.id) foot = `<div class="confirm"><b>Can't make it?</b>
    <span class="small">${j.crewedAt ? "The time stays the same and your spot goes back on the job board. The rest of your crew and the 1Yard admins will be told." : partner ? "Your spot goes back on the job board and the rest of your crew will be told." : "The client's days open up again for other volunteers."}${traineesLeft ? " The trainee on this job will need a new supervisor." : ""}</span>
    ${soon && j.crewedAt ? `<span class="small"><b>This is short notice. Please also text your crew${mates.length ? ` (${mates.map((m) => esc(m.phone)).filter(Boolean).join(", ")})` : ""}.</b></span>` : ""}
    <label class="small" for="lr-${j.id}">Reason <span class="muted">(optional · only admins see it)</span></label>
    <textarea id="lr-${j.id}" rows="2" placeholder="e.g. My exam was moved"></textarea>
    <div class="row"><button class="btn danger" data-act="leaveYes" data-id="${j.id}">Yes, take me off this job</button><button class="btn ghost" data-act="confirmNo">Keep it</button></div></div>`;
  else if (S.picking === j.id) foot = picker(j, j.date + "|" + j.start, "Save new time");
  else if (S.confirm === "done:" + j.id) foot = doneForm(j, "Mark as done");
  else if (full && started) foot = `<div class="foot"><button class="btn" data-act="done" data-id="${j.id}">We finished this job</button><span class="small muted">Something wrong? Call the 1Yard admin.</span></div>`;
  else if (full) foot = `<div class="foot"><span class="stack" style="gap:2px"><button class="btn" disabled>We finished this job</button><span class="small muted">You can mark this job complete after ${fmtDate(j.date)}, ${fmtTime(j.start)}.</span></span>${cant}</div>`;
  else foot = `<div class="foot">${j.crewedAt ? `<span class="small muted">This time was confirmed with the client. Only an admin can change it.</span>` : `<button class="btn ghost" data-act="pickOpen" data-id="${j.id}">Change time</button>`}${cant}</div>`;
  const cal = isLocked(j) && (full || j.crewedAt) && !started ? `<div class="row calrow"><span class="label">Add to calendar</span>
    <a class="btn ghost" href="${esc(gcalUrl(j))}" target="_blank" rel="noopener">${ic("cal")} Google Calendar</a>
    <button class="btn ghost" data-act="ics" data-id="${j.id}">Download .ics file</button></div>` : "";
  return `<article class="card job" id="job-${j.id}">
    ${jobTop(j)}
    ${j.timeChangedAt ? `<div class="alertline">⚠ An admin changed the time ${ago(j.timeChangedAt)}. It's now ${whenText(j)}.</div>` : ""}
    ${jobFacts(j, v, true)}
    ${slots(j)}
    ${full ? `<div class="picker" style="gap:8px"><span class="label">Your crew</span>${mates.map((m) => `<div style="display:grid;gap:2px"><b>${esc(m.name)}</b>${m.hasCar ? `<span class="small">🚗 Has a car they're willing to use</span>` : ""}<span class="small">📞 ${esc(m.phone)} · ✉️ ${esc(m.email)}</span></div>`).join("")}<span class="small muted">Running late? Text your crew and let the 1Yard admin know.</span></div>`
      : `<p class="small">${j.crewedAt ? "Someone on your crew can't make it anymore. We're finding a new volunteer for the same time. Please don't go short-handed without checking with an admin." : `Waiting for ${spotsOf(j) - c.length} more volunteer${spotsOf(j) - c.length === 1 ? "" : "s"}${needsExperienced(j) ? " (a supervisor: Community Volunteer or above)" : ""}.${others.length ? "" : " You can change the time until someone joins."}`}</p>`}
    ${cal}
    ${foot}
  </article>`;
}

/* ---------------- ADMIN ---------------- */
function adminView() {
  if (S.adminPage === "settings") return settingsView();
  const people = S.volunteers.filter((v) => v.role !== "admin");
  const apps = people.filter((v) => v.status === "pending");
  const reqs = S.jobs.filter((j) => j.status === "review");
  const live = S.jobs.filter((j) => j.status === "scheduled");
  const needVol = live.filter((j) => !isFull(j));
  const needExp = live.filter(needsExperienced);
  const calls = callItems();
  const tab = S.adminTab;
  const pendingThanks = S.thanks.filter((t) => t.status === "pending");
  const tabs = [["calls", "To call", calls.length], ["reqs", "New requests", reqs.length], ["apps", "Volunteer applications", apps.length], ["jobs", "Jobs", needExp.length], ["vols", "Volunteers", 0], ["thanks", "Thank-yous", pendingThanks.length]];
  let body = "";
  if (tab === "calls") body = callsView(calls);
  else if (tab === "apps") body = apps.length ? `<div class="list">${apps.map(appCard).join("")}</div>` : `<div class="empty">No applications waiting.</div>`;
  else if (tab === "reqs") body = reqs.length ? `<div class="list">${reqs.map(reviewCard).join("")}</div>` : `<div class="empty">No new client requests.</div>`;
  else if (tab === "jobs") body = (S.resched ? reschedPanel(job(S.resched)) : "") + (S.editing && job(S.editing)?.status === "scheduled" ? editForm(job(S.editing)) : "") + jobsTable();
  else if (tab === "thanks") body = thanksView();
  else body = volsTable(people);
  const stat = (cls, icon, n, label, sub) => `<div class="stat ${cls}"><span class="sico">${ic(icon)}</span><div><b>${n}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
  return `
  <div class="head"><div><h1>Admin dashboard</h1><p>Review new requests and volunteers, and make sure every job gets a full crew.</p></div><button class="btn" data-act="reload">${ic("refresh")} Refresh</button></div>
  <div class="stats">
    ${stat("s-green", "phone", calls.length, "Clients to call")}
    ${stat("s-sky", "file", reqs.length, "Client requests to review")}
    ${stat("s-lilac", "users", apps.length, "Volunteer applications")}
    ${stat("s-peach", "cal", needVol.length, "Jobs still needing volunteers", needExp.length ? `(${needExp.length} trainee waiting)` : "")}
  </div>
  <div class="stack" id="admin-tabs">
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
      <div class="row"><h3>${esc(jobTitle(j))}</h3>${jChip(j)}${waitChip(j)}<span class="muted small">sent ${ago(j.createdAt)}${j.editedAt ? ` · edited by admin ${ago(j.editedAt)}` : ""}</span><button class="btn ghost" style="margin-left:auto" data-act="edit" data-id="${j.id}">Edit details</button></div>
      <div class="kv">
        <div><span>Client</span>${esc(c.name)}</div>
        <div><span>Contact</span>${esc(c.phone)}${c.email ? `<br>${esc(c.email)}` : ""}<br><span style="display:inline">Prefers: ${CONTACT[c.contact]}</span></div>
        <div><span>Address</span>${esc(c.address)}, ${esc(c.postal)}<br>${esc(c.area)}</div>
        <div><span>History</span>${lastHelped(j)}</div>
      </div>
      <div><div class="label">Client is free</div><ul class="wins">${j.windows.map((x) => `<li>${windowText(x)}${x.date <= today() ? ` <span class="tag warn">already passed</span>` : ""}</li>`).join("")}</ul></div>
      <div class="row"><span class="label">Tools on site</span>${have.map((t) => `<span class="tag have">✓ ${TOOLS[t].name}</span>`).join("")}${miss.map((t) => `<span class="tag warn">Missing: ${TOOLS[t].name}</span>`).join("")}</div>
      ${j.flags.length ? `<div class="row"><span class="label">Heads up</span>${j.flags.map((f) => `<span class="tag">${FLAGS[f].em} ${FLAGS[f].name}</span>`).join("")}</div>` : ""}
      ${j.notes ? `<div class="quote"><div class="label">Client's note</div>${esc(j.notes)}</div>` : ""}
      ${miss.length ? `<p class="small" style="color:var(--amber-fg)">Volunteers only bring gloves. Call the client to sort out the missing tools before publishing.</p>` : ""}
      ${notesBlock(j)}
    </div>
    <div class="side-panel">
      <span class="label">Publish to volunteers</span>
      <p class="small muted">Volunteers will see the client's days and pick an exact start time. Fix the days with Edit details if they're wrong.</p>
      <label>Volunteers needed<select id="sp-${j.id}">${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === spotsOf(j) ? "selected" : ""}>${n} volunteers</option>`).join("")}</select></label>
      <span class="small muted">At most half can be trainees.</span>
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
    <div class="field"><label class="lbl" for="e-spots">Volunteers needed</label><select class="in" id="e-spots" style="max-width:220px">${[2, 3, 4, 5, 6].filter((n) => n >= crew(j.id).length).map((n) => `<option value="${n}" ${n === spotsOf(j) ? "selected" : ""}>${n} volunteers</option>`).join("")}</select><span class="small muted">At most half can be trainees. Can't go below the volunteers already signed up.</span></div>
    ${crew(j.id).length ? `<p class="small muted">Days are locked because a volunteer has signed up. Use <b>Change time</b> on the Jobs tab instead.</p>`
      : `<div class="field"><span class="lbl">Days the client is free (up to 4)</span>${windowRows("ew", j.windows)}</div>`}
    <div class="field"><span class="lbl">Work needed</span><div class="checks">${SERVICES.map((x) => box("e-svc", x.id, x.name, j.services.includes(x.id))).join("")}</div></div>
    <div class="field"><span class="lbl">Tools the client has</span><div class="checks">${Object.entries(TOOLS).map(([k, x]) => box("e-tool", k, x.name, j.tools[k])).join("")}</div></div>
    <div class="field"><span class="lbl">Heads up</span><div class="checks">${Object.entries(FLAGS).map(([k, x]) => box("e-flag", k, x.name, j.flags.includes(k))).join("")}</div></div>
    <div class="field"><label class="lbl" for="e-notes">Notes for volunteers</label><textarea id="e-notes">${esc(j.notes)}</textarea></div>
    <div class="row"><button class="btn" data-act="editSave" data-id="${j.id}">Save changes</button><button class="btn ghost" data-act="editCancel">Cancel</button></div>
  </article>`;
}
// Admin-only call notes on a request/job, and notes/concerns from the crew's hours log.
function notesBlock(j) {
  const list = S.adminNotes.filter((n) => n.job_id === j.id);
  return `<div class="anotes"><span class="label">Call notes</span>
    ${list.map((n) => `<div class="anote"><span class="small muted">${whenShort(n.created_at)} · ${esc(first(n.author_name) || "Admin")}</span> ${esc(n.body)}</div>`).join("")}
    <div class="row" style="flex-wrap:nowrap"><input type="text" class="in" id="an-${j.id}" placeholder="e.g. Called Tues, prefers mornings" aria-label="Add a call note"><button class="btn ghost" data-act="addNote" data-id="${j.id}">Add note</button></div></div>`;
}
const reportsBlock = (j) => S.reports.filter((r) => r.job_id === j.id).map((r) => `<div class="report ${r.concern ? "warn" : ""}">
  <b>${r.concern ? "⚠ Concern: " + esc(CONCERNS[r.concern]) : "Crew note"}</b> <span class="small muted">from ${esc(r.reporter_name || "a volunteer")} · ${whenShort(r.created_at)}</span>
  ${r.concern_detail ? `<div>${esc(r.concern_detail)}</div>` : ""}${r.note ? `<div>${r.concern ? `<b>Note:</b> ` : ""}${esc(r.note)}</div>` : ""}</div>`).join("");
function callsView(items) {
  if (!items.length) return `<div class="empty">Nobody to call right now. Clients show up here when their crew is set, or when none of their days worked out.</div>`;
  return `<div class="list">${items.map(({ j, kind }) => {
    const c = client(j.clientId), names = crew(j.id).map((s) => vol(s.vid)?.name || "A volunteer");
    if (S.resched === j.id) return reschedPanel(j);
    return `<article class="card call">
      <div class="stack" style="gap:8px">
        <div class="row">${kind === "tell" ? `<span class="chip c-green">Crew confirmed</span>` : kind === "drop" ? `<span class="chip c-amber">Volunteer dropped out</span>` : `<span class="chip c-rose">Needs new dates</span>`}<span class="small muted">${esc(jobTitle(j))} · ${esc(c.area)}</span>${waitChip(j)}</div>
        <h3>${kind === "tell" ? `Tell ${esc(c.name)} when volunteers are coming` : kind === "drop" ? `Let ${esc(c.name)} know a volunteer can't come` : `Ask ${esc(c.name)} for new days`}</h3>
        <div class="phone">📞 ${esc(c.phone || c.email)}</div>
        ${kind === "tell" ? `<p><b>${joinNames(names.map(esc))}</b> will come <b>${whenText(j, true)}</b> (about ${j.hours}h).</p>`
          : kind === "drop" ? `<p>The visit is still set for <b>${whenText(j, true)}</b>. ${names.length ? `<b>${esc(names[0])}</b> is still coming; we're finding a second volunteer.` : "Both spots are open again on the job board."} If the time no longer works, use <b>Change time</b>.</p>`
          : `<p>None of their days got a full crew: ${j.windows.map((x) => fmtDate(x.date)).join(", ")}.${crew(j.id).length ? ` ${esc(names[0])} signed up alone and will be released.` : ""}</p>`}
        ${j.attempts ? `<p class="small muted">No answer ${j.attempts}× · last tried ${ago(j.lastAttemptAt)}</p>` : ""}
        ${notesBlock(j)}
      </div>
      <div class="stack" style="gap:8px">
        ${kind === "dates" ? `<button class="btn" data-act="resched" data-id="${j.id}">Enter new days</button>` : `<button class="btn" data-act="called" data-id="${j.id}">Called ✓</button>`}
        ${kind === "drop" ? `<button class="btn ghost" data-act="resched" data-id="${j.id}">Change time</button>` : ""}
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
    ${(full || j.crewedAt) && isLocked(j) ? `<div class="stack" style="gap:8px">
      <span class="label">Option 1 · Move the time and keep the crew</span>
      <p class="small muted">Use this only after the volunteers on the job have agreed to the new time. They get a notification and an email; so does the client if they gave an email.</p>
      <div class="row"><input type="date" id="mv-date" value="${j.date}" aria-label="New date" ${inp}>
        <select id="mv-start" aria-label="New start time" ${inp}>${allTimes.map((t) => `<option value="${t}" ${t === j.start ? "selected" : ""}>${fmtTime(t)}</option>`).join("")}</select>
        <button class="btn" data-act="moveTime" data-id="${j.id}">Save new time</button></div>
    </div>` : ""}
    <div class="stack" style="gap:8px">
      <span class="label">${(full || j.crewedAt) && isLocked(j) ? "Option 2 · " : ""}Release ${crew(j.id).length ? "the crew" : "it"} and repost with new days</span>
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
    <tbody>${rows.map((j) => { const c = client(j.clientId); const lw = liveWindows(j); return `<tr id="row-${j.id}">
      <td style="white-space:nowrap">${j.status === "done" && j.date ? `<b>${fmtDate(j.date)}</b><div class="muted">${fmtTime(j.start)}</div>`
        : isLocked(j) ? `<b>${fmtDate(j.date)}</b><div class="muted">${fmtTime(j.start)} – ${fmtTime(endTime(j.start, j.hours))}</div><div class="muted">(~${j.hours}h)</div>`
        : lw.length ? `<b>${fmtDate(lw[0].date)}${lw.length > 1 ? ` –<br>${fmtDate(lw[lw.length - 1].date)}` : ""}</b><div class="muted">${lw.length} day option${lw.length === 1 ? "" : "s"}</div>` : `<b>No days left</b><div class="muted">Needs new dates</div>`}</td>
      <td style="min-width:260px"><b>${esc(jobTitle(j))}</b><div class="muted">${esc(c.name)} · ${esc(c.address)}, ${esc(c.area)}</div><div class="small muted">${lastHelped(j)}</div>${reportsBlock(j)}${notesBlock(j)}</td>
      <td style="min-width:250px">${slots(j)}</td>
      <td><div class="stack" style="gap:6px;justify-items:start">${jChip(j)}${waitChip(j)}</div>${j.status === "done" ? `<div style="margin-top:10px"><select class="in" data-hours="${j.id}" aria-label="Hours worked" style="width:auto">${hourOptions(jobHours(j))}</select><div class="small muted">logged per volunteer</div></div>` : ""}</td>
      <td>${S.confirm === "done:" + j.id ? doneForm(j, "Save as done") : j.status === "scheduled" ? `<div class="acts">${isFull(j) ? `<button class="btn" data-act="done" data-id="${j.id}">Mark done</button>` : ""}<button class="btn ghost" data-act="resched" data-id="${j.id}">Change time</button><button class="btn ghost" data-act="edit" data-id="${j.id}">Edit</button><button class="btn danger" data-act="acancel" data-id="${j.id}">Cancel</button></div>` : ""}</td>
    </tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">No jobs here.</div>`}`;
}
// One dropdown for the whole journey: application status, then levels.
const LEVEL_PICK = [["pending", "Waiting for review"], ["approved", "Approved · doing training"], ...LEVEL_ORDER.map((k) => [k, `${LEVELS[k].em} ${LEVELS[k].name}`]), ["declined", "Declined"]];
const levelOptions = (v) => { const cur = canSeeBoard(v) ? levelOf(v) : v.status; return LEVEL_PICK.map(([k, n]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${n}</option>`).join(""); };
const supervisedCount = (vid) => S.signups.filter((s) => s.vid === vid && !s.asTrainee && job(s.jobId)?.status === "done" && S.signups.some((p) => p.jobId === s.jobId && p.vid !== vid && p.asTrainee)).length;
const thanksFor = (vid) => S.thanks.filter((t) => t.status !== "hidden" && S.signups.some((s) => s.jobId === t.job_id && s.vid === vid)).length;
// Where a thank-you goes: credited to the volunteers on a job (counts for them), and/or
// shared as a shout-out on every volunteer's thank-you wall.
function thanksView() {
  const done = S.jobs.filter((j) => j.status === "done").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const jobLabel = (j) => `${j.date ? fmtDate(j.date) + " · " : ""}${client(j.clientId)?.name || ""} · ${jobTitle(j)} · ${crew(j.id).map((s) => first(vol(s.vid)?.name || "")).filter(Boolean).join(" & ")}`;
  const jobPick = (id, cur) => `<select class="in" id="${id}" style="min-width:260px;max-width:100%"><option value="">No specific job (shout-out only)</option>${done.map((j) => `<option value="${j.id}" ${j.id === cur ? "selected" : ""}>${esc(jobLabel(j))}</option>`).join("")}</select>`;
  const where = (t) => { const j = job(t.job_id), names = j ? crew(j.id).map((s) => first(vol(s.vid)?.name || "a volunteer")) : [];
    return [j ? `Credited to ${esc(names.join(" and "))} (${esc(jobTitle(j))}, ${j.date ? fmtDate(j.date) : ""})` : "", t.shoutout ? "Shared with all volunteers" : ""].filter(Boolean).join(" · "); };
  const src = { public: "From the website", request: "From the client's request page", admin: "Logged by an admin" };
  const card = (t) => `<article class="card stack" style="gap:10px">
    <div class="row">${t.status === "pending" ? `<span class="chip c-amber">Needs a decision</span>` : t.status === "approved" ? `<span class="chip c-green">Approved</span>` : `<span class="chip c-grey">Hidden</span>`}
      <span class="small muted">${src[t.source] || ""} · ${whenShort(t.created_at)}</span></div>
    <p>${t.message ? `“${esc(t.message)}”` : `<span class="muted">No message, just a thank-you</span>`}</p>
    ${t.from_name || t.contact || t.volunteer_names ? `<p class="small">${t.from_name ? `<b>${esc(t.from_name)}</b>` : ""}${t.contact ? ` · ${esc(t.contact)}` : ""}${t.volunteer_names ? ` · volunteers: ${esc(t.volunteer_names)}` : ""}</p>` : ""}
    ${t.status === "approved" ? `<p class="small muted">${where(t)}</p>` : ""}
    ${t.status !== "approved" ? `<div class="picker" style="gap:10px">
      <label class="lbl" for="tj-${t.id}">Which visit was it?${t.suggested_job && !t.job_id ? ` <span class="small muted">(we guessed from the phone or street)</span>` : ""}</label>
      ${jobPick("tj-" + t.id, t.job_id || t.suggested_job)}
      <label class="check"><input type="checkbox" id="ts-${t.id}" ${t.job_id ? "" : "checked"}> Also share it as a shout-out to all volunteers</label>
      <div class="row"><button class="btn" data-act="thanksOk" data-id="${t.id}">Approve</button>${t.status !== "hidden" ? `<button class="btn ghost" data-act="thanksHide" data-id="${t.id}">Hide</button>` : ""}</div>
    </div>` : `<div class="row"><button class="btn ghost" data-act="thanksHide" data-id="${t.id}">Hide</button></div>`}
  </article>`;
  const pending = S.thanks.filter((t) => t.status === "pending"), rest = S.thanks.filter((t) => t.status !== "pending");
  return `<p class="small muted">Pick the visit to credit the volunteers on it: it counts toward their thank-yous and they're told. Tick <b>shout-out</b> to also put it on every volunteer's thank-you wall. Hide anything inappropriate.</p>
    <section class="card stack"><h3>Log a thank-you from a call or email</h3>
      ${jobPick("ty-job", "")}
      <input type="text" class="in" id="ty-note" placeholder="What they said (optional)">
      <label class="check"><input type="checkbox" id="ty-shout"> Share it as a shout-out to all volunteers</label>
      <div><button class="btn" data-act="thanksLog">Add thank-you</button></div></section>
    ${pending.length ? `<h3>Waiting for you (${pending.length})</h3><div class="list">${pending.map(card).join("")}</div>` : ""}
    ${rest.length ? `<h3>Earlier</h3><div class="list">${rest.map(card).join("")}</div>` : ""}
    ${S.thanks.length ? "" : `<div class="empty">No thank-yous yet.</div>`}`;
}
function volsTable(people) {
  const order = { pending: 0, approved: 1, trainee: 2, experienced: 3, declined: 4 };
  const list = [...people].sort((a, b) => order[a.status] - order[b.status]);
  if (!list.length) return `<div class="empty">No volunteers yet.</div>`;
  return `<div class="card table-wrap"><table>
    <thead><tr><th>Volunteer</th><th>Level</th><th>Supervised shifts</th><th>Jobs done</th><th>Hours</th><th>Trainee shifts supervised</th><th>❤️</th><th>Car</th><th>Waiver</th><th></th></tr></thead>
    <tbody>${list.map((v) => `<tr>
      <td><b>${esc(v.name)}</b><div class="muted small">${esc(v.uni)} · ${esc(v.year)}<br>${esc(v.email)} · ${esc(v.phone)}</div></td>
      <td><select class="in" data-level="${v.id}" aria-label="Level for ${esc(v.name)}" style="min-width:200px">${levelOptions(v)}</select></td>
      <td class="num">${v.status === "trainee" ? `<b>${shadowCount(v.id)} of ${SHADOW_SHIFTS_NEEDED}</b>` : v.status === "experienced" ? "Complete" : "—"}</td>
      <td class="num">${jobsDone(v.id)}</td>
      <td class="num"><b>${fmtHours(hoursFor(v.id))}</b></td>
      <td class="num">${supervisedCount(v.id)}</td>
      <td class="num">${thanksFor(v.id)}</td>
      <td><label class="check" style="white-space:nowrap"><input type="checkbox" data-car="${v.id}" ${v.hasCar ? "checked" : ""}> 🚗</label></td>
      <td class="small">${v.waiverPath ? `<button class="btn ghost" data-act="waiver" data-id="${v.id}">📄 Open waiver</button>` : `<span class="muted">—</span>`}</td>
      <td>${S.confirm === "pw:" + v.id ? `<div class="confirm ok" style="min-width:240px"><b>New password for ${esc(first(v.name))}</b>
          <span class="small">Use this one or type your own (8+ characters). Their old password stops working.</span>
          <input type="text" class="in" id="np-${v.id}" value="${esc(S.tempPw)}" aria-label="New password" autocomplete="off">
          <div class="row"><button class="btn" data-act="pwSet" data-id="${v.id}">Set password</button><button class="btn ghost" data-act="confirmNo">Cancel</button></div></div>`
        : S.pwDone?.id === v.id ? `<div class="confirm ok" style="min-width:240px"><b>Done. Text this to ${esc(first(v.name))}:</b>${v.phone ? `<span class="small">📞 ${esc(v.phone)}</span>` : ""}
          <code class="pwshow">${esc(S.pwDone.pw)}</code><span class="small">They'll be asked to pick their own after logging in.</span>
          <div class="row"><button class="btn ghost" data-act="pwCopy">Copy</button><button class="btn ghost" data-act="pwClose">Close</button></div></div>`
        : S.confirm === "rmvol:" + v.id
        ? `<div class="confirm" style="min-width:220px"><b>Remove ${esc(first(v.name))}?</b><span class="small">Deletes their account and frees any upcoming jobs. They can apply again later.</span><div class="row"><button class="btn danger" data-act="rmVolYes" data-id="${v.id}">Yes, remove</button><button class="btn ghost" data-act="confirmNo">Cancel</button></div></div>`
        : `<div class="acts"><button class="btn ghost" data-act="pwOpen" data-id="${v.id}">Reset password</button><button class="btn danger" data-act="rmVol" data-id="${v.id}">Remove</button></div>`}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function settingsView() {
  const admins = S.volunteers.filter((v) => v.role === "admin"), others = S.volunteers.filter((v) => v.role !== "admin").sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="head"><div><h1>Settings</h1><p>Who can run the dashboard, and the details clients see.</p></div></div>
  <section class="card stack">
    <h2>Admins</h2>
    <div class="list">${admins.map((a) => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:12px">
      <div class="row"><span class="avatar" style="width:38px;height:38px;font-size:.95rem">${esc(a.name.charAt(0).toUpperCase())}</span><div><b>${esc(a.name)}</b>${a.id === S.me.id ? ` <span class="tag">You</span>` : ""}<div class="small muted">${esc(a.email)}</div></div></div>
      ${a.id === S.me.id ? "" : `<button class="btn ghost" data-act="unadmin" data-id="${a.id}">Remove admin rights</button>`}</div>`).join("")}</div>
    <div class="field"><label class="lbl" for="new-admin">Add an admin</label>
      ${others.length ? `<div class="row" style="flex-wrap:nowrap"><select class="in" id="new-admin">${others.map((v) => `<option value="${v.id}">${esc(v.name)} · ${esc(v.email)}</option>`).join("")}</select><button class="btn" data-act="makeAdmin">Make admin</button></div>` : ""}
      <p class="small muted">The person signs up first through <b>Volunteer log in → Apply here</b>. Then pick them here. They'll see the admin dashboard next time they log in.</p></div>
  </section>
  ${passwordCard()}
  <section class="card stack">
    <h2>Email log</h2>
    <p class="small muted">The last 40 emails the site sent (or tried to). Failed ones are retried automatically for 2 days.</p>
    ${S.emails.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>${S.emails.map((m) => `<tr>
      <td class="small" style="white-space:nowrap">${whenShort(m.created_at)}</td><td class="small">${esc(m.to_email)}</td><td class="small">${esc(m.subject)}</td>
      <td>${m.status === "sent" ? `<span class="chip c-green">Sent</span>` : m.status === "failed" ? `<span class="chip c-rose" title="${esc(m.last_error || "")}">Failed</span><div class="small muted">${esc(m.last_error || "")}</div>` : `<span class="chip c-grey">Waiting</span>`}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">No emails yet.</div>`}
  </section>
  <section class="card stack">
    <h2>Site details</h2>
    <div class="kv"><div><span>Phone shown to clients</span>${esc(OFFICE_PHONE || "—")}</div><div><span>Season</span>${esc(SEASON.label)}</div><div><span>Training modules</span>${TRAINING.length}</div></div>
    <p class="small muted">These live in <code>docs/config.js</code> and <code>docs/app.js</code> in the website's code.</p>
  </section>`;
}

/* ============ ACTIONS ============ */
const SKIP = Symbol();
// Turn database errors into something a person can act on.
function friendly(err, fallback) {
  const m = err?.message || "";
  if (/permission denied|JWT|not authenticated/i.test(m)) { setTimeout(checkLogin); return "You're no longer logged in here. Please log in again."; }
  // The site was updated but the database setup (supabase/schema.sql) wasn't re-run yet.
  if (/PGRST202|Could not find the function/i.test(m + (err?.code || ""))) return "The website was just updated and the database needs a quick update too. Please tell a 1Yard admin.";
  return m || fallback;
}
const upd = async (table, id, patch) => must(await sb.from(table).update(patch).eq("id", id));
const rpc = async (fn, args) => must(await sb.rpc(fn, args));
function showWizErr(e) { const el = $("#wiz-err"); el.textContent = e; el.hidden = false; el.scrollIntoView({ block: "nearest" }); return SKIP; }

const A = {
  go: async (id) => { S.notice = ""; if (id === "home") { await goHome(); history.replaceState(null, "", location.pathname); } else S.view = id; scrollTo(0, 0); },
  reload: async () => { await refresh(); return "Up to date."; },
  logout: async () => { S.selfAuth = true; await sb.auth.signOut(); S.selfAuth = false; S.me = null; S.view = "home"; S.notice = ""; S.adminPage = "dash"; S.volPage = "vhome"; },
  tab: (id) => { S.adminTab = id; S.editing = null; S.resched = null; S.confirm = null; },
  adminNav: (id) => {
    S.editing = null; S.resched = null; S.confirm = null;
    if (id === "settings") { S.adminPage = "settings"; scrollTo(0, 0); return; }
    S.adminPage = "dash";
    if (id !== "dash") { S.adminTab = id; setTimeout(() => $("#admin-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" })); } else scrollTo(0, 0);
  },
  volNav: async (id) => { S.volPage = id === "vhours" ? "vrecord" : id; S.picking = null; S.confirm = null; if (S.volPage === "vcommunity") await loadDirectory(); scrollTo(0, 0); },
  togglePw: (id, b) => {
    const el = $("#" + id), show = el.type === "password";
    el.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", show);
    return SKIP; // don't redraw: it would clear the form
  },
  hideBanner: () => { S.bannerHidden = true; try { localStorage.setItem("1yard-banner", SEASON.label); } catch {} },
  makeAdmin: async () => { const id = $("#new-admin").value; await upd("profiles", id, { role: "admin", status: "experienced" }); await loadAdmin(); return `${vol(id).name} is now an admin.`; },
  unadmin: async (id) => { await upd("profiles", id, { role: "volunteer" }); await loadAdmin(); return `${vol(id).name} is no longer an admin.`; },
  jobFilter: (id) => { S.jobFilter = id; },
  boardFilter: (id) => { S.boardFilter = id; },
  confirmNo: () => { S.confirm = null; },

  // --- admin
  approve: async (id) => { await upd("profiles", id, { status: "approved", reviewed_at: now() }); await loadAdmin(); return `${vol(id).name} approved. They can now do training.`; },
  decline: async (id) => { await upd("profiles", id, { status: "declined", reviewed_at: now() }); await loadAdmin(); return `${vol(id).name}'s application declined.`; },
  publish: async (id) => {
    const j = job(id);
    if (!liveWindows(j).length) return "All of this client's days have passed. Use Edit details to add new ones.";
    await upd("jobs", id, { status: "scheduled", hours: +$("#h-" + id).value, spots: +$("#sp-" + id).value, published_at: now() }); await loadAdmin();
    return `Published with ${liveWindows(job(id)).length} day options. Volunteers can now sign up.`;
  },
  reject: async (id) => { await upd("jobs", id, { status: "declined" }); await loadAdmin(); return "Request declined. Remember to call the client."; },
  // Cancel first, then free the spots, so the crew gets a "cancelled" message rather than "taken off".
  acancel: async (id) => { await upd("jobs", id, { status: "cancelled" }); must(await sb.from("job_signups").delete().eq("job_id", id)); await loadAdmin(); return "Job cancelled. The crew and client (if they gave an email) are told."; },
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
    await upd("jobs", id, { windows: wins, date: null, start_time: null, told_at: null, time_changed_at: null, attempts: 0, crewed_at: null, dropout_at: null });
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
    const patch = { spots: +$("#e-spots").value, services, tools: Object.fromEntries(checked("e-tool").map((t) => [t, true])), flags: checked("e-flag"), notes: val("notes"), edited_at: now() };
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
  rmVol: (id) => { S.confirm = "rmvol:" + id; },
  savePrefs: async () => {
    await rpc("update_my_prefs", { p_has_car: $("#pf-car").checked, p_share_phone: $("#pf-phone").checked, p_share_email: $("#pf-email").checked });
    await loadMe(); return "Saved.";
  },
  dirFilter: (id) => { S.dirFilter = id; },
  print: () => { window.print(); return SKIP; },
  thanksOk: async (id) => {
    const jobId = $("#tj-" + id).value || null, shout = $("#ts-" + id).checked;
    if (!jobId && !shout) return toast("Pick the visit, or tick shout-out."), SKIP;
    await rpc("admin_publish_thanks", { p_id: id, p_job: jobId, p_shoutout: shout }); await loadAdmin();
    return jobId && shout ? "Credited to the crew and shared with all volunteers." : jobId ? "Credited to the volunteers on that job." : "Shared with all volunteers.";
  },
  thanksHide: async (id) => { await rpc("admin_review_thanks", { p_id: id, p_status: "hidden" }); await loadAdmin(); return "Hidden."; },
  thanksLog: async () => {
    const jobId = $("#ty-job").value || null, shout = $("#ty-shout").checked;
    if (!jobId && !shout) return toast("Pick the visit, or tick shout-out."), SKIP;
    await rpc("admin_add_thanks", { p_job: jobId, p_message: $("#ty-note").value.trim(), p_shoutout: shout }); await loadAdmin();
    return "Thank-you added.";
  },
  sendThanks: async () => {
    const v = (id) => $("#" + id).value.trim(), err = $("#t-err");
    const problem = !v("t-name") ? "Please type your name." : !v("t-where") ? "Please type your street or phone number, so we know which visit it was." : !v("t-msg") && !v("t-vols") ? "Please write a few words for the volunteers." : "";
    if (problem) { err.textContent = problem; err.hidden = false; return SKIP; }
    const { error } = await sb.rpc("submit_thanks", { p: { name: v("t-name"), contact: v("t-where"), volunteers: v("t-vols"), message: v("t-msg") } });
    if (error) { err.textContent = friendly(error, "Something went wrong. Please try again, or call us."); err.hidden = false; return SKIP; }
    S.thanksSent = true;
    setTimeout(() => document.getElementById("thank")?.scrollIntoView({ block: "start" }));
  },
  thanksAgain: () => { S.thanksSent = false; setTimeout(() => document.getElementById("thank")?.scrollIntoView({ block: "start" })); },
  thankCrew: async () => { await rpc("thank_crew", { tok: S.token, p_message: $("#ty-msg").value.trim() || null }); await loadRequest(); return "Thank you! We'll pass it on."; },
  pwOpen: (id) => {
    // Easy to read out or text: e.g. "maple-rake-4827".
    const w = ["maple", "acorn", "cedar", "birch", "rake", "leaf", "garden", "pine", "willow", "clover"], n = crypto.getRandomValues(new Uint32Array(3));
    S.tempPw = `${w[n[0] % w.length]}-${w[n[1] % w.length]}-${1000 + (n[2] % 9000)}`; S.pwDone = null; S.confirm = "pw:" + id;
  },
  pwSet: async (id) => {
    const pw = $("#np-" + id).value.trim();
    if (pw.length < 8) return toast("The password needs at least 8 characters."), SKIP;
    await rpc("admin_set_password", { vid: id, pw });
    S.confirm = null; S.pwDone = { id, pw };
    return "Password set.";
  },
  pwCopy: () => { navigator.clipboard?.writeText(S.pwDone.pw).then(() => toast("Copied."), () => toast("Select the password and copy it.")); return SKIP; },
  pwClose: () => { S.pwDone = null; },
  rmVolYes: async (id) => {
    const v = vol(id);
    if (v.waiverPath) await sb.storage.from("waivers").remove([v.waiverPath]); // best effort; account removal is what matters
    await rpc("admin_remove_volunteer", { vid: id });
    S.confirm = null; await loadAdmin();
    return `${v.name} was removed.`;
  },
  done: (id) => { S.confirm = "done:" + id; },
  doneYes: async (id) => {
    const concern = $("#dc-" + id).checked ? $("#dct-" + id).value : null, detail = $("#dcd-" + id).value.trim();
    if (concern && !detail) return toast("Please describe the concern in a few words."), SKIP;
    const promoted = await rpc("finish_job", { p_job: id, p_hours: +$("#dh-" + id).value, p_note: $("#dn-" + id).value.trim() || null, p_concern: concern, p_concern_detail: concern ? detail : null });
    S.confirm = null;
    await refresh();
    return promoted.length ? `Job done. ${promoted.join(" and ")} ${promoted.length > 1 ? "are now Community Volunteers" : "is now a Community Volunteer"}!` : "Job marked as done.";
  },

  // --- volunteer
  finish: async () => {
    const f = $("#waiver-file").files[0];
    if (f.size > 5 * 1024 * 1024) return "That file is over 5 MB. Try a smaller scan.";
    const path = `${S.me.id}/${Date.now()}-waiver.pdf`;
    must(await sb.storage.from("waivers").upload(path, f, { contentType: "application/pdf" }));
    await rpc("complete_training", { p_path: path, p_read_guide: $("#done-training").checked });
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
    return mine ? `Time changed to ${whenText(job(id))}.` : `You're signed up for ${whenText(job(id))}. ${S.me.status === "trainee" ? "A supervisor (Community Volunteer or above) will join you." : isFull(job(id)) ? "The crew is complete." : "Waiting for the rest of the crew."}`;
  },
  join: async (id) => { await rpc("join_job", { p_job: id }); await refresh(); return isFull(job(id)) ? "You're signed up. The crew is complete." : "You're signed up."; },
  leave: (id) => { S.confirm = "leave:" + id; },
  leaveYes: async (id) => {
    await rpc("leave_job", { p_job: id, p_reason: $("#lr-" + id).value.trim() || null });
    S.confirm = null; await refresh();
    return "You're off this job. Thanks for letting us know.";
  },
  ics: (id) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([icsText(job(id))], { type: "text/calendar" }));
    a.download = "1yard-job.ics"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return SKIP;
  },
  bell: async () => {
    S.bellOpen = !S.bellOpen; drawBell();
    if (S.bellOpen) { await loadNotifs(); drawBell(); }
    return SKIP;
  },
  notifOpen: async (id) => {
    const n = S.notifs.find((x) => x.id === id);
    if (n && !n.read_at) { await rpc("mark_notifications_read", { p_ids: [id] }); n.read_at = now(); }
    goTo(n?.link);
  },
  notifAllRead: async () => { await rpc("mark_notifications_read", { p_ids: null }); S.notifs.forEach((n) => (n.read_at = n.read_at || now())); drawBell(); return SKIP; },
  addNote: async (id) => {
    const body = $("#an-" + id).value.trim();
    if (!body) return toast("Type a note first."), SKIP;
    await rpc("add_admin_note", { p_job: id, p_body: body }); await loadAdmin();
    return "Note added.";
  },

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
  if (S.bellOpen && !e.target.closest("#bell")) { S.bellOpen = false; drawBell(); }
  // Links to a section on the same page glide there instead of jumping.
  const jump = e.target.closest('a[href^="#"]:not([data-act])');
  const spot = jump && jump.getAttribute("href").length > 1 && document.getElementById(jump.getAttribute("href").slice(1));
  if (spot) {
    e.preventDefault();
    spot.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (spot.id === "main") spot.focus?.();
    return;
  }
  const b = e.target.closest("[data-act]");
  if (b?.tagName === "A") e.preventDefault();
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
    toast(friendly(err, "Something went wrong. Please try again."));
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
  // Volunteer form: show a text box when "Other" is picked.
  if (id === "f-uni") { $("#f-uni-other").hidden = e.target.value !== "__other"; if (!$("#f-uni-other").hidden) $("#f-uni-other").focus(); return; }
  if (e.target.name === "year") { $("#f-year-other").hidden = !$("#yr-other").checked; return; }
  if (id === "sk-other") { $("#f-skill-other").hidden = !e.target.checked; return; }
  if (e.target.dataset.concern) { $("#dcw-" + e.target.dataset.concern).hidden = !e.target.checked; if (e.target.checked) $("#dcd-" + e.target.dataset.concern).focus(); return; }
  if (e.target.dataset.hours) {
    const sel = e.target; sel.disabled = true;
    try { await upd("jobs", sel.dataset.hours, { actual_hours: +sel.value }); await loadAdmin(); render(); toast("Hours updated."); }
    catch (err) { toast(friendly(err, "Couldn't save the hours.")); render(); }
    return;
  }
  if (e.target.dataset.car) {
    const sel = e.target; sel.disabled = true;
    try { await upd("profiles", sel.dataset.car, { has_car: sel.checked }); await loadAdmin(); render(); toast("Car updated."); }
    catch (err) { toast(friendly(err, "Couldn't save that.")); render(); }
    return;
  }
  // Admin override of a volunteer's level (e.g. skip supervised shifts for someone with experience).
  if (e.target.dataset.level) {
    const v = vol(e.target.dataset.level), pick = e.target.value, sel = e.target;
    const status = ["pending", "approved", "declined", "trainee"].includes(pick) ? pick : "experienced";
    sel.disabled = true;
    try {
      const patch = { status };
      if (status === "experienced") patch.level = pick;
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
      toast(`${v.name} is now: ${LEVELS[pick]?.name || V_STATUS[pick][0]}.`);
    } catch (err) { toast(friendly(err, "Couldn't change the level.")); render(); }
    return;
  }
  if (id === "waiver-file" || id === "done-training") {
    const f = $("#waiver-file").files[0], isPdf = f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    $("#file-note").textContent = !f ? "No file chosen yet." : isPdf ? `📄 ${f.name}` : "That file isn't a PDF. Upload the signed waiver as a PDF.";
    const ok = isPdf && $("#done-training").checked;
    $("#finish").disabled = !ok;
    $("#finish-hint").textContent = ok ? "Ready to go." : "Upload your waiver and tick the box to continue.";
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, btn = form.querySelector('button[type="submit"]');
  if (S.busy) return;
  S.busy = true; btn.classList.add("busy"); S.selfAuth = true;
  try {
    if (form.id === "pw-form") {
      const pw = $("#pw-new").value;
      if (pw.length < 8) throw new Error("The password needs at least 8 characters.");
      if (pw !== $("#pw-new2").value) throw new Error("The two passwords don't match.");
      must(await sb.auth.updateUser({ password: pw }));
      await rpc("password_changed"); S.me.tempPassword = false;
      toast("Password changed. Use it next time you log in.");
    } else if (form.id === "login-form") {
      must(await sb.auth.signInWithPassword({ email: $("#l-email").value.trim(), password: $("#l-pass").value }));
      await loadMe();
      if (!S.me) throw new Error("This account has no volunteer profile. Contact the 1Yard team.");
      await goHome();
      if (S.go) { goTo(S.go); S.go = null; }
    } else if (form.id === "signup") {
      const typed = (id, what) => { const t = $("#" + id).value.trim(); if (!t) throw new Error(`Please type your ${what}.`); return t; };
      const uni = $("#f-uni").value === "__other" ? typed("f-uni-other", "university") : $("#f-uni").value;
      const yearPick = $('input[name="year"]:checked')?.value;
      const year = yearPick === "__other" ? typed("f-year-other", "year of study") : yearPick;
      let skills = [...document.querySelectorAll('input[name="skill"]:checked')].map((i) => i.value);
      if (skills.includes("__other")) skills = [...skills.filter((x) => x !== "__other"), "Other: " + typed("f-skill-other", "other skills")];
      if (!skills.length) throw new Error("Pick at least one thing you can do.");
      const res = must(await sb.auth.signUp({ email: $("#f-email").value.trim(), password: $("#f-pass").value, options: { data: {
        name: `${$("#f-first").value.trim()} ${$("#f-last").value.trim()}`, phone: $("#f-phone").value.trim(), university: uni,
        year, skills, why: $("#f-why").value.trim(),
        has_car: $("#f-car").checked, share_phone: $("#f-share-phone").checked, share_email: $("#f-share-email").checked } } }));
      if (!res.session) { S.view = "login"; S.notice = "Application sent. Check your email to confirm your address, then log in."; }
      else { await loadMe(); await goHome(); toast("Application sent. An admin will review it soon."); }
    }
    render(); scrollTo(0, 0);
  } catch (err) {
    toast(friendly(err, "Something went wrong. Please try again."));
  } finally { S.busy = false; btn.classList.remove("busy"); S.selfAuth = false; }
});

/* ============ START ============ */
(async function boot() {
  if (!sb) { S.view = "setup"; return render(); }
  render();
  try {
    const params = new URLSearchParams(location.search), tok = params.get("request");
    if (params.get("start") === "request") { history.replaceState(null, "", location.pathname); A.wizStart(); return render(); }
    if (tok) { S.token = tok; S.view = "request"; rememberToken(tok); await loadRequest(); }
    else {
      // Links in emails look like ?go=job:<id>. Log in first if needed, then jump there.
      S.go = params.get("go"); if (S.go) history.replaceState(null, "", location.pathname);
      await loadMe(); await goHome();
      if (S.go && S.me) { render(); goTo(S.go); S.go = null; }
      else if (S.go) { S.view = "login"; S.notice = "Log in to see that job."; }
    }
  } catch (err) {
    console.error(err);
    S.view = "home"; toast(err?.message || "Couldn't reach the server. Please try again.");
  }
  render();
})();

// Every tab in a browser shares one login. If it changes in another tab (someone logs in
// as a different person, or logs out), catch up here instead of acting as the wrong user.
async function checkLogin() {
  const before = S.me?.id || null;
  await loadMe();
  const after = S.me?.id || null;
  if (before === after) return false;
  if (after) { await goHome(); S.notice = `You're now logged in as <b>${esc(S.me.name)}</b>. The login changed in another tab of this browser.`; }
  else if (before) { S.view = "login"; S.notice = "You were logged out, probably from another tab in this browser. Log in again to continue. Tip: to use two accounts at once, use a private window for the second one."; }
  render();
  return true;
}
if (sb) {
  sb.auth.onAuthStateChange((event) => {
    if (S.selfAuth || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
    setTimeout(() => checkLogin().catch(() => {}));
  });
  // Coming back to the tab: make sure we're still the same person and show fresh data.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || S.busy || S.selfAuth || !S.me) return;
    try {
      if (await checkLogin()) return;
      const editing = S.editing || S.resched || S.picking || S.confirm || document.activeElement?.matches?.("input, textarea, select");
      if (!editing && (S.view === "admin" || S.view === "volunteer")) { await refresh(); render(); }
    } catch {}
  });
}
