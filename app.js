/* Slowly - app.js (v2)
   On-device chat summaries with an open-weight model (WebLLM + WebGPU).
   Rules find the facts, the model writes the gist and translates short lines,
   and every model line is checked before it is shown. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ENGINE_URLS = [
  "https://esm.run/@mlc-ai/web-llm@0.2.79",
  "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm"
];
const KEY_SAVED = "slowly.saved";
const KEY_BENCH = "slowly.bench";
const KEY_MODEL = "slowly.model";
const MAX_VRAM = 3800;

const S = {
  webllm: null, engine: null, modelId: null, modelLabel: "", loadSecs: null,
  busy: false, loading: false, unsupported: false, hasF16: false,
  stopped: false, lang: "English", shownLang: "English"
};

const TIERS = [
  { re: /llama-3\.2-1b/i, tag: "Fast", rank: 0 },
  { re: /qwen3-1\.7b/i, tag: "Balanced", rank: 1 },
  { re: /llama-3\.2-3b/i, tag: "Better Hindi", rank: 2 },
  { re: /qwen3-4b/i, tag: "Best quality, slow", rank: 3 },
  { re: /qwen2\.5-1\.5b/i, tag: "Good English", rank: 4 },
  { re: /qwen2\.5-3b/i, tag: "Accurate English", rank: 5 },
  { re: /phi-3\.5-mini/i, tag: "Strong English, heavy", rank: 6 },
  { re: /gemma-2-2b/i, tag: "Alternative", rank: 7 },
  { re: /smollm2-1\.7b/i, tag: "Light", rank: 8 }
];
const tierOf = (id) => TIERS.find((t) => t.re.test(id || ""));

const SAMPLE = `[09:12] Aarav: Guys, are we still doing the Lonavala trip this Saturday?
[09:14] Meera: Yes! But we need to decide cars. I can drive mine, fits 4.
[09:15] Kabir: I'm in. Can someone book the villa? The one near the lake is 9,000 a night.
[09:18] Aarav: I'll book the villa tonight. Everyone please send me 2,250 each by Thursday.
[09:21] Isha: Sorry, can't leave before 2 pm Saturday, I have a client call.
[09:22] Meera: Fine, then we leave at 2:30 sharp. Kabir, you're in my car.
[09:25] Kabir: Cool. Who's bringing the speaker? And someone has to confirm the veg/non-veg split for dinner.
[09:27] Isha: I'll bring the speaker. Dinner split, I'll ask the caterer and tell you by Friday.
[09:30] Dev: I might not make it, my cousin's engagement is the same weekend. Will confirm on Wednesday.
[09:31] Aarav: Ok Dev, please confirm by Wednesday night, villa has a 24-hour cancellation window.
[09:40] Meera: Also, rain is forecast Sunday. Let's plan to head back by 11 am.
[09:41] Kabir: Agreed. Someone should also print the villa booking in case there's no signal.
[09:44] Aarav: I'll forward the confirmation once it's done. Kabir, can you handle the printout?
[09:45] Kabir: Sure, will do.`;

const BENCH_CHAT = `[09:12] Aarav: Bhai Saturday ko Lonavala ka plan pakka hai na?
[09:14] Meera: Haan, meri car me 4 log aa sakte hain. Cars ka kaun dekhega?
[09:15] Kabir: Main aa raha hu. Villa koi book kar do, lake ke paas wala 9000 per night hai.
[09:18] Aarav: Villa main aaj raat book karta hu. Sab log Thursday tak 2250 rupaye bhej do.
[09:21] Isha: Mujhe Saturday 2 baje se pehle nikalna mushkil hai, client call hai.
[09:22] Meera: Theek hai, phir 2:30 baje nikalte hain. Kabir tu meri car me aayega.
[09:25] Kabir: Done. Speaker kaun la raha hai? Aur dinner ka veg/non-veg kaun confirm karega?
[09:27] Isha: Speaker main laungi. Caterer se puch ke Friday tak bata dungi.
[09:30] Dev: Shayad main nahi aa paunga, cousin ki engagement hai. Wednesday ko confirm karunga.
[09:31] Aarav: Dev, Wednesday raat tak pakka bata dena, villa ka cancellation 24 ghante pehle tak hai.
[09:40] Meera: Sunday ko barish ka forecast hai, 11 baje tak wapas nikal jaayenge.
[09:41] Kabir: Sahi hai. Villa booking ka printout bhi le lena, signal nahi mila toh.
[09:44] Aarav: Confirmation main forward kar dunga. Kabir, printout tu dekh lena.
[09:45] Kabir: Pakka.`;

/* ---------- small helpers ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let toastTimer;
function toast(msg, ms = 1800) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
function haptic(p = 10) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }
function showNotice(msg) { const n = $("#notice"); n.textContent = msg; n.classList.remove("hidden"); }
function hideNotice() { $("#notice").classList.add("hidden"); }
function readNotice(msg) {
  let n = $("#readNotice");
  if (!n) {
    n = document.createElement("div");
    n.id = "readNotice"; n.className = "notice"; n.setAttribute("role", "alert");
    $("#goHint").after(n);
  }
  n.textContent = msg; n.classList.remove("hidden");
}
function hideReadNotice() { const n = $("#readNotice"); if (n) n.classList.add("hidden"); }
function setStatus(text, ready) {
  const el = $("#status"); el.textContent = "";
  if (ready) { const s = document.createElement("span"); s.className = "ready"; s.textContent = "Ready. "; el.appendChild(s); }
  el.appendChild(document.createTextNode(text));
}
function setProgress(p) {
  $("#progWrap").classList.remove("hidden");
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  $("#prog").style.width = pct + "%";
  $("#progWrap").setAttribute("aria-valuenow", pct);
}
function prettyName(id) {
  return id.replace(/-MLC.*$/i, "").replace(/-q\d+f\d+(_\d+)?/i, "")
    .replace(/-Instruct|-it\b/gi, "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function sizeB(id) { const m = /(\d+(?:\.\d+)?)b\b/i.exec(id || ""); return m ? parseFloat(m[1]) : 4; }

/* ---------- connectivity ---------- */
function paintNet() {
  const on = navigator.onLine;
  $("#net").classList.toggle("off", !on);
  $("#netText").textContent = on ? "Online" : "Offline";
}
addEventListener("online", paintNet); addEventListener("offline", paintNet); paintNet();

/* ---------- swipe pager + tabs ---------- */
const pager = $("#pager"), tabsEl = $("#tabs"), tabBtns = $$(".tab");
let curTab = 0;
function goTab(i) { curTab = i; pager.scrollTo({ left: i * pager.clientWidth, behavior: "smooth" }); }
tabBtns.forEach((b) => b.addEventListener("click", () => { haptic(8); goTab(+b.dataset.tab); }));
let raf = 0;
pager.addEventListener("scroll", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const p = pager.scrollLeft / (pager.clientWidth || 1);
    tabsEl.style.setProperty("--p", p.toFixed(3));
    const i = Math.round(p);
    curTab = i;
    tabBtns.forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
  });
}, { passive: true });
addEventListener("resize", () => { pager.scrollTo({ left: curTab * pager.clientWidth, behavior: "auto" }); });
$("#setupBtn").addEventListener("click", () => goTab(2));

function scrollToResult() {
  const panel = $("#p-read"), r = $("#result");
  const top = r.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 8;
  panel.scrollTo({ top, behavior: "smooth" });
}

/* ---------- state -> UI ---------- */
const chat = $("#chat");
function refresh() {
  const ready = !!S.engine && !S.busy;
  const enough = chat.value.trim().length > 20;
  $("#go").disabled = !(ready && enough);
  $("#bench").disabled = !ready;
  $("#modelState").textContent = S.engine ? S.modelLabel : S.loading ? "Loading…" : "Not loaded";
  $("#goHint").textContent = S.unsupported ? "This browser can't run the on-device model."
    : S.loading ? "Loading the model. Please wait."
    : !S.engine ? "Load a model first. Tap Set up above."
    : !enough ? "Paste a chat first." : "";
  $("#setupBtn").textContent = S.engine ? "Change" : "Set up";
  const h = $("#langHint");
  if (h) {
    const weak = S.engine && S.lang !== "English" && sizeB(S.modelId) < 3;
    h.textContent = weak ? `${S.lang} is more accurate with a bigger model. In the Lab tab, try Llama 3.2 3B or Qwen3 4B. Small models may leave some lines in English.` : "";
    h.classList.toggle("hidden", !weak);
  }
}
function paintCount() {
  $("#count").textContent = chat.value.length.toLocaleString() + " characters";
  refresh();
}

/* ---------- model list ---------- */
async function detectGpu() {
  if (!("gpu" in navigator)) return null;
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return null;
    S.hasF16 = a.features.has("shader-f16");
    return a;
  } catch { return null; }
}
function buildModelList() {
  const all = (S.webllm.prebuiltAppConfig && S.webllm.prebuiltAppConfig.model_list) || [];
  const seen = new Set(), list = [];
  for (const m of all) {
    const id = m.model_id, tier = tierOf(id);
    if (!tier) continue;
    if (/vision|jpn|coder|math|embed|-1k$|q0f/i.test(id)) continue;
    if (m.vram_required_MB && m.vram_required_MB > MAX_VRAM) continue;
    if ((m.required_features || []).includes("shader-f16") && !S.hasF16) continue;
    const f16 = /q4f16/i.test(id), f32 = /q4f32/i.test(id);
    if (/gemma/i.test(id)) { if (!f32) continue; }
    else if (S.hasF16 ? f32 : f16) continue;
    const key = prettyName(id);
    if (seen.has(key)) continue;
    seen.add(key); list.push({ m, tier });
  }
  list.sort((a, b) => a.tier.rank - b.tier.rank || (a.m.vram_required_MB || 0) - (b.m.vram_required_MB || 0));

  const sel = $("#model");
  sel.textContent = "";
  if (!list.length) {
    const o = document.createElement("option"); o.textContent = "No compatible model found"; sel.appendChild(o); return [];
  }
  const big = (navigator.deviceMemory || 4) >= 8 ? list.find((x) => /llama-3\.2-3b/i.test(x.m.model_id)) : null;
  const rec = big || list.find((x) => /llama-3\.2-1b/i.test(x.m.model_id)) || list[0];
  const saved = store.get(KEY_MODEL, null);
  list.forEach((x) => {
    const o = document.createElement("option");
    const gb = x.m.vram_required_MB ? ` · ${(x.m.vram_required_MB / 1024).toFixed(1)} GB` : "";
    o.value = x.m.model_id;
    o.dataset.base = prettyName(x.m.model_id) + gb + " · " + x.tier.tag + (x === rec ? " · Recommended" : "");
    o.textContent = o.dataset.base;
    sel.appendChild(o);
  });
  sel.value = list.some((x) => x.m.model_id === saved) ? saved : rec.m.model_id;
  sel.disabled = false;
  $("#load").disabled = false;
  paintHint();
  return list;
}
async function markCached() {
  if (!S.webllm || !S.webllm.hasModelInCache) return;
  for (const o of $$("#model option")) {
    if (!o.value) continue;
    try { if (await S.webllm.hasModelInCache(o.value)) o.textContent = o.dataset.base + " · downloaded"; } catch {}
  }
}
function paintHint() {
  const id = $("#model").value || "";
  const sz = sizeB(id);
  let t = /gemma/i.test(id)
    ? "Gemma is Google's open-weight model family. On some phones it can write broken text. If that happens, use Llama 3.2 1B."
    : sz < 3
      ? "Small and fast. Good for English. Hindi and Hinglish can need small corrections."
      : "Bigger and slower, but much more accurate, especially for Hindi and Hinglish. Needs a phone with 6 GB RAM or more.";
  t += " The first load downloads the model once, so use Wi-Fi. After that it works offline.";
  $("#modelHint").textContent = t;
}
$("#model").addEventListener("change", paintHint);

/* ---------- load model ---------- */
async function loadModel(id, { auto = false } = {}) {
  if (S.busy || !id || !S.webllm) return false;
  S.busy = true; S.loading = true; hideNotice(); refresh();
  $("#load").disabled = true; $("#model").disabled = true;
  setProgress(0); setStatus(auto ? "Opening your saved model…" : "Starting download…");
  const t0 = performance.now();
  let ok = false;
  try {
    if (S.engine) { try { await S.engine.unload(); } catch {} S.engine = null; }
    S.engine = await S.webllm.CreateMLCEngine(id, {
      initProgressCallback: (r) => { setProgress(r.progress || 0); setStatus(r.text || "Loading…"); }
    });
    S.modelId = id; S.modelLabel = prettyName(id);
    S.loadSecs = (performance.now() - t0) / 1000;
    store.set(KEY_MODEL, id);
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    setProgress(1);
    setStatus(`${S.modelLabel} loaded in ${S.loadSecs.toFixed(1)}s. It now runs on this device.`, true);
    haptic([10, 40, 10]); toast("Model ready");
    if (!auto) setTimeout(() => goTab(0), 800);
    ok = true;
  } catch (e) {
    console.error(e);
    S.engine = null; S.modelId = null;
    setProgress(0); setStatus("");
    const msg = String((e && e.message) || e).slice(0, 200);
    showNotice(msg + " | The model didn't load. Try a smaller model such as Llama 3.2 1B, close other apps and tabs, then try again.");
  } finally {
    S.busy = false; S.loading = false;
    $("#load").disabled = false; $("#model").disabled = false;
    $("#load").textContent = S.engine ? "Load a different model" : "Download and load model";
    refresh(); markCached();
  }
  return ok;
}
$("#load").addEventListener("click", () => loadModel($("#model").value));

/* ---------- input controls ---------- */
chat.addEventListener("input", paintCount);
$("#sample").addEventListener("click", () => { chat.value = SAMPLE; paintCount(); haptic(8); });
$("#clear").addEventListener("click", () => { chat.value = ""; paintCount(); $("#result").classList.add("hidden"); chat.focus(); });
$("#paste").addEventListener("click", async () => {
  try { chat.value = await navigator.clipboard.readText(); paintCount(); }
  catch { chat.focus(); toast("Press and hold in the box, then Paste"); }
});
$("#lang").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lang]"); if (!b) return;
  S.lang = b.dataset.lang; haptic(8);
  $$("#lang button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  refresh();
});

/* ======================================================================
   TEXT LOGIC (no model needed)
   ====================================================================== */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function splitChat(text, size = 2800) {
  const parts = []; let cur = "";
  const lines = [];
  for (const l of text.split("\n")) {
    if (l.length <= size) lines.push(l);
    else for (let i = 0; i < l.length; i += size) lines.push(l.slice(i, i + size));
  }
  for (const l of lines) {
    if ((cur + "\n" + l).length > size && cur) { parts.push(cur); cur = l; }
    else cur = cur ? cur + "\n" + l : l;
  }
  if (cur) parts.push(cur);
  return parts;
}

function normalize(t) {
  return t.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u200e\u200f\u202a-\u202e\u00a0\u202f]/g, " ").replace(/\r/g, "");
}

const STAMP = /^\s*(?:\[[^\]]*\]|\(?\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?\)?\s*-)\s*/i;
const SKIP_MSG = /^<?(?:media|image|video|audio|sticker|gif|document) omitted>?$|^this message was deleted$|^you deleted this message$|^<attached:/i;
function readMsgs(text) {
  const msgs = [];
  const lines = text.split("\n");
  const stamped = lines.some((l) => STAMP.test(l));
  for (const raw of lines) {
    if (stamped && !STAMP.test(raw)) {
      if (msgs.length && raw.trim()) msgs[msgs.length - 1].msg += " " + raw.trim();
      continue;
    }
    const m = raw.replace(STAMP, "").match(/^([^:\n]{1,30}):\s*(.+)$/);
    if (m && !SKIP_MSG.test(m[2].trim())) msgs.push({ who: m[1].trim(), msg: m[2].trim() });
  }
  return msgs;
}

function gibberish(g) {
  if (/<unused|<\||<think>/.test(g)) return true;
  if (/(\b[\w\u0900-\u097F]{2,}\b)(?:\s+\1){3,}/u.test(g)) return true;
  const L = g.match(/\p{L}/gu) || [];
  if (L.length < 8) return false;
  const known = L.filter((c) => /[A-Za-z\u0900-\u097F]/.test(c)).length;
  return (L.length - known) / L.length > 0.05;
}
function devRatio(s) {
  const L = s.match(/\p{L}/gu) || [];
  return L.filter((c) => /[\u0900-\u097F]/.test(c)).length / (L.length || 1);
}
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function inventedNames(g, text) {
  const low = text.toLowerCase();
  for (const sent of g.split(/(?<=[.!?])\s+/)) {
    const ws = sent.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    for (let i = 1; i < ws.length; i++) {
      const w = ws[i];
      if (!/^[A-Z][a-z]{2,}$/.test(w)) continue;
      const k = w.toLowerCase();
      if (DAYS.includes(k) || MONTHS.includes(k)) continue;
      if (!low.includes(k)) return true;
    }
  }
  return false;
}
function gistOk(g, text) {
  if (!g || g.length < 12 || gibberish(g)) return false;
  if (devRatio(g) > 0.1) return false;
  const words = g.trim().split(/\s+/).length;
  if (words < 4 || words > 50) return false;
  if (/\[\d{1,2}:\d{2}\]|^\w+:\s/.test(g)) return false;
  const seen = new Set(text.match(/\d+/g) || []);
  if ((g.match(/\d+/g) || []).some((n) => !seen.has(n))) return false;
  if (inventedNames(g, text)) return false;
  return true;
}
function firstSentences(s, n) {
  return s.replace(/^\s*(?:here(?:'s| is)[^:\n]*:|sure[,!.:]?|gist:|summary:)\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "").trim().split(/(?<=[.!?])\s+/).slice(0, n).join(" ").trim();
}
function joinNames(a, lang) {
  const and = lang === "Hinglish" ? "aur" : lang === "Hindi" ? "और" : "and";
  if (a.length < 2) return a[0] || "";
  return a.slice(0, -1).join(", ") + " " + and + " " + a[a.length - 1];
}
function fallbackGist(msgs, nTodo, nDates, lang) {
  const who = joinNames([...new Set(msgs.map((m) => m.who))].slice(0, 4), lang);
  if (lang === "Hindi") return (who ? who + " की चैट। " : "चैट। ") + `${nTodo} काम और ${nDates} योजनाओं या समय का ज़िक्र हुआ।`;
  if (lang === "Hinglish") return (who ? who + " ki chat. " : "Chat. ") + `${nTodo} kaam aur ${nDates} plan ya time ka zikr hua.`;
  return (who ? "Chat between " + who + ". " : "Chat. ") + `${nTodo} tasks and ${nDates} plans or times were mentioned.`;
}
const BROKEN_MSG = "Model wrote broken text, so a simple summary was used. Try Llama 3.2 1B in Lab.";
const MISS_MSG = (n) => `${n} line${n > 1 ? "s" : ""} stayed in English. A bigger model (Llama 3.2 3B) translates better.`;

const LBL = {
  English: { todo: "To do", dates: "Dates and plans", noTodo: "Nothing you need to do.", noDates: "No other dates or plans.", copy: "Copy", share: "Share", none: "None", asks: "asks" },
  Hindi: { todo: "करने के काम", dates: "तारीख़ें और योजनाएँ", noTodo: "कोई काम नहीं।", noDates: "कोई अन्य तारीख़ या योजना नहीं।", copy: "कॉपी", share: "शेयर", none: "कोई नहीं", asks: "का अनुरोध" },
  Hinglish: { todo: "Karne wale kaam", dates: "Dates aur plans", noTodo: "Koi kaam nahi.", noDates: "Koi aur date ya plan nahi.", copy: "Copy", share: "Share", none: "Koi nahi", asks: "ka request" }
};

const L10N = {
  Hindi: {
    days: { monday: "सोमवार", tuesday: "मंगलवार", wednesday: "बुधवार", thursday: "गुरुवार", friday: "शुक्रवार", saturday: "शनिवार", sunday: "रविवार" },
    today: "आज", tomorrow: "कल", tonight: "आज रात", morning: "सुबह", afternoon: "दोपहर", evening: "शाम", night: "रात", baje: "बजे", tak: "तक"
  },
  Hinglish: {
    days: { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" },
    today: "aaj", tomorrow: "kal", tonight: "aaj raat", morning: "subah", afternoon: "dopahar", evening: "shaam", night: "raat", baje: "baje", tak: "tak"
  }
};
function partOfDay(h, ap) {
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 16) return "afternoon";
  if (h >= 16 && h < 19) return "evening";
  return "night";
}
const WHEN_TOK = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(today|tomorrow|tonight)\b|\b(morning|afternoon|evening|night)\b|\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\b/gi;
function whenLocal(piece, lang) {
  if (lang === "English") return piece;
  const T = L10N[lang];
  let tak = false;
  const p = piece.trim().replace(/^(?:(by|before|till|until)|on|at)\s+/i, (m, g) => { if (g) tak = true; return ""; });
  const out = p.replace(WHEN_TOK, (m, day, rel, part, h, mi, ap) => {
    if (day) return T.days[day.toLowerCase()];
    if (rel) return T[rel.toLowerCase()];
    if (part) return T[part.toLowerCase()];
    const time = mi ? h + ":" + mi : h;
    const pd = ap ? T[partOfDay(+h, ap.toLowerCase())] + " " : "";
    return pd + time + " " + T.baje;
  });
  return tak ? out + " " + T.tak : out;
}

/* ---------- exact translation of common short lines ---------- */
const LEX = {
  ticket: ["ticket", "टिकट"], tickets: ["tickets", "टिकट"], snack: ["snack", "स्नैक्स"], snacks: ["snacks", "स्नैक्स"],
  money: ["paise", "पैसे"], cash: ["cash", "कैश"], rent: ["rent", "किराया"], villa: ["villa", "विला"],
  car: ["car", "कार"], cars: ["cars", "कारें"], cab: ["cab", "कैब"], cabs: ["cabs", "कैब"],
  speaker: ["speaker", "स्पीकर"], dinner: ["dinner", "डिनर"], lunch: ["lunch", "लंच"], breakfast: ["nashta", "नाश्ता"],
  food: ["khana", "खाना"], booking: ["booking", "बुकिंग"], confirmation: ["confirmation", "कन्फ़र्मेशन"],
  printout: ["printout", "प्रिंटआउट"], payment: ["payment", "पेमेंट"], bill: ["bill", "बिल"], doctor: ["doctor", "डॉक्टर"],
  cake: ["cake", "केक"], gift: ["gift", "गिफ्ट"], gifts: ["gifts", "गिफ्ट"], drinks: ["drinks", "ड्रिंक्स"], water: ["paani", "पानी"],
  movie: ["movie", "फ़िल्म"], night: ["night", "नाइट"], party: ["party", "पार्टी"], trip: ["trip", "ट्रिप"], meeting: ["meeting", "मीटिंग"],
  plan: ["plan", "प्लान"], plans: ["plans", "प्लान"], document: ["document", "दस्तावेज़"], documents: ["documents", "दस्तावेज़"],
  form: ["form", "फ़ॉर्म"], report: ["report", "रिपोर्ट"], photo: ["photo", "फ़ोटो"], photos: ["photos", "फ़ोटो"],
  list: ["list", "लिस्ट"], location: ["location", "लोकेशन"], address: ["address", "पता"], keys: ["keys", "चाबियाँ"],
  bag: ["bag", "बैग"], charger: ["charger", "चार्जर"], medicines: ["medicines", "दवाइयाँ"], groceries: ["groceries", "किराने का सामान"],
  details: ["details", "जानकारी"], message: ["message", "मैसेज"], email: ["email", "ईमेल"],
  decorations: ["decorations", "सजावट"], balloons: ["balloons", "गुब्बारे"], games: ["games", "गेम्स"],
  rupees: ["rupaye", "रुपये"], rupee: ["rupaye", "रुपये"], rs: ["rupaye", "रुपये"],
  and: ["aur", "और"], all: ["sab", "सब"], everyone: ["sab log", "सब लोग"], each: ["har ek", "हर एक"]
};
const VERBS = {
  "book": ["book karna", "बुक करना"], "reserve": ["reserve karna", "रिज़र्व करना"],
  "bring": ["lana", "लाना"], "get": ["lana", "लाना"], "buy": ["kharidna", "खरीदना"],
  "send": ["bhejna", "भेजना"], "pay": ["dena", "देना"], "forward": ["forward karna", "फ़ॉरवर्ड करना"],
  "call": ["call karna", "फ़ोन करना", ["ko", "को"]], "ask": ["puchna", "पूछना", ["se", "से"]],
  "tell": ["batana", "बताना", ["ko", "को"]], "remind": ["yaad dilana", "याद दिलाना", ["ko", "को"]],
  "confirm": ["confirm karna", "पुष्टि करना"], "print": ["print karna", "प्रिंट करना"], "share": ["share karna", "साझा करना"],
  "check": ["check karna", "जाँच करना"], "handle": ["sambhalna", "संभालना"], "arrange": ["arrange karna", "इंतज़ाम करना"],
  "organize": ["organize karna", "आयोजित करना"], "collect": ["collect karna", "इकट्ठा करना"],
  "carry": ["le jaana", "ले जाना"], "pick up": ["lena", "लेना"], "take": ["lena", "लेना"], "pack": ["pack karna", "पैक करना"],
  "cook": ["pakana", "पकाना"], "order": ["order karna", "ऑर्डर करना"], "prepare": ["taiyaar karna", "तैयार करना"],
  "plan": ["plan karna", "योजना बनाना"], "cancel": ["cancel karna", "रद्द करना"], "reply": ["reply karna", "जवाब देना"],
  "update": ["update karna", "अपडेट करना"], "submit": ["submit karna", "जमा करना"], "finish": ["khatam karna", "खत्म करना"],
  "clean": ["saaf karna", "साफ़ करना"], "reach": ["pahunchna", "पहुँचना"], "arrive": ["pahunchna", "पहुँचना"],
  "come": ["aana", "आना"], "leave": ["nikalna", "निकलना"]
};
const DET = new Set(["the", "a", "an", "my", "our", "your", "their", "some"]);
const FUNC = new Set(["to", "for", "from", "with", "at", "in", "on", "it", "them", "him", "her", "us", "up", "out", "near", "by", "before", "after",
  "about", "if", "when", "that", "which", "because", "so", "but", "or", "not", "also", "only", "just", "every", "than", "then", "there", "here",
  "this", "these", "those", "be", "is", "are", "was", "were", "been", "can", "could", "should", "would", "might", "may", "do", "does", "did",
  "have", "has", "had", "of", "as", "into", "over", "under", "like", "who", "what", "where", "how", "why", "we", "you", "they", "he", "she", "i"]);
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function trObj(tokens, lang, names) {
  const hi = lang === "Hindi", out = [];
  for (const raw of tokens) {
    const w = raw.replace(/^[,;:()]+|[,;:()]+$/g, "");
    if (!w) continue;
    const k = w.toLowerCase();
    if (DET.has(k)) continue;
    if (/^\d[\d,.:]*$/.test(w)) { out.push(w); continue; }
    if (names.has(k)) { out.push(w); continue; }
    if (LEX[k]) { out.push(LEX[k][hi ? 1 : 0]); continue; }
    if (FUNC.has(k) || hi) return null;
    out.push(w);
  }
  return out;
}
function ruleTr(src, lang, names) {
  if (lang === "English") return null;
  const s = src.trim().replace(/[.!?।]+$/, "").replace(/^(?:i will|i'll|will|to|please)\s+/i, "");
  if (!s || /[\u0900-\u097F]/.test(s)) return null;
  const hi = lang === "Hindi", w = s.split(/\s+/);
  const two = w.slice(0, 2).join(" ").toLowerCase();
  const key = VERBS[two] ? two : VERBS[w[0].toLowerCase()] ? w[0].toLowerCase() : null;
  if (key) {
    const v = VERBS[key];
    let rest = w.slice(key.split(" ").length), me = false;
    if (rest[0] && rest[0].toLowerCase() === "me") { me = true; rest = rest.slice(1); }
    const obj = trObj(rest, lang, names);
    if (!obj) return null;
    const post = v[2] && obj.length ? v[2][hi ? 1 : 0] : "";
    const parts = [me ? (hi ? "मुझे" : "mujhe") : "", ...obj, post, v[hi ? 1 : 0], hi ? "है" : "hai"].filter(Boolean);
    return capFirst(parts.join(" "));
  }
  if (w.length > 4) return null;
  const parts = [];
  for (const raw of w) {
    const k = raw.toLowerCase();
    if (DET.has(k)) continue;
    if (/^\d[\d,.:]*$/.test(raw)) parts.push(raw);
    else if (names.has(k)) parts.push(raw);
    else if (LEX[k]) parts.push(LEX[k][hi ? 1 : 0]);
    else return null;
  }
  return parts.length ? capFirst(parts.join(" ")) : null;
}

/* ---------- facts from the chat (rules only) ---------- */
function extractRules(text, msgs, modelLines = []) {
  const speakers = new Set(msgs.map((m) => m.who.toLowerCase()));
  const dayRe = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|noon|kal|parso|aaj|subah|shaam|raat|dopahar|baje|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar)\b|\b\d{1,2}(:\d{2})?\s?(am|pm|baje)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}(st|nd|rd|th)\b|कल|परसों|आज|सुबह|शाम|रात|बजे|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार/i;
  const whenRe = /(?:\b(?:on|at|by|before|till|until)\s+)?(?:\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b(?:\s+(?:morning|afternoon|evening|night))?|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b)/gi;
  const clean = (s) => s.replace(/^(?:(?:yes|yeah|yep|yup|ok(?:ay)?|sure|done|great|fine|cool|alright|agreed|haan|ha|theek hai|pakka)\b[,.!\s]*)+/i, "").trim();
  const core = (msg) => clean(msg.replace(whenRe, ""))
    .replace(/\s+/g, " ").replace(/\s+([.,!?])/g, "$1")
    .replace(/^(i will|i'll|i am going to|i'm going to)\s+/i, "")
    .replace(/[,.!? ]+$/, "").trim();
  const whenOf = (msg) => (msg.match(whenRe) || []).map((x) => x.trim().replace(/^(?:on|at)\s+/i, ""));

  const items = [];
  for (const m of msgs) for (const t of m.msg.split(/(?<=[.!?])\s+/)) if (t.trim()) items.push({ who: m.who, msg: t.trim() });

  const stop = new Set(["the", "and", "for", "you", "with", "from", "that", "this", "will", "are", "was", "has", "have", "sunday", "saturday", "morning", "evening", "please", "pick"]);
  const words = (s) => new Set(s.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !stop.has(w)) || []);
  const similar = (a, b) => {
    const A = words(a), B = words(b);
    if (!A.size || !B.size) return false;
    let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
    return n >= 1 && n / Math.min(A.size, B.size) >= 0.3;
  };
  const todo = [];
  const taken = (what) => todo.some((x) => similar(x.what, what));
  const willRe = /\b(i will|i'll|i am going to|i'm going to)\b|\b\w+(unga|ungi)\b/i;
  const WILL = /\b(?:i will|i'll|i am going to|i'm going to)\s+/i;

  for (const m of items) {
    const c = clean(m.msg);
    if (!willRe.test(c)) continue;
    if (/\b(i will|i'll)\s+be\b/i.test(c)) continue;
    const wm = WILL.exec(m.msg);
    const what = core(wm ? m.msg.slice(wm.index + wm[0].length) : m.msg);
    if (what) todo.push({ who: m.who, what, when: whenOf(m.msg), ask: false });
  }
  for (const m of items) {
    const r = /^(?:([A-Za-z]+),?\s+)?please\s+(.+)$/i.exec(core(m.msg));
    if (!r) continue;
    const what = r[2].split(/[.!?]/)[0].trim();
    if (!what || taken(what)) continue;
    const owner = r[1] && speakers.has(r[1].toLowerCase()) ? r[1] : null;
    todo.push({ who: owner || m.who, what, when: whenOf(m.msg), ask: !owner });
  }
  for (const l of modelLines) {
    const i = l.indexOf(":");
    if (i < 1) continue;
    const who = l.slice(0, i).trim(), what = l.slice(i + 1).trim().replace(/[,.! ]+$/, "");
    if (speakers.size && !speakers.has(who.toLowerCase())) continue;
    if (!what || what.length > 90 || gibberish(what) || taken(what)) continue;
    todo.push({ who, what, when: [], ask: false });
  }

  const pool = msgs.length ? items : text.split(/[\n.!?]+/).map((s) => ({ who: "", msg: s.replace(STAMP, "").trim() })).filter((m) => m.msg);
  const dates = [], seenD = new Set();
  for (const m of pool) {
    if (!dayRe.test(m.msg)) continue;
    const when = whenOf(m.msg);
    let what = (when.length ? core(m.msg) : "") || clean(m.msg).replace(/[,.!? ]+$/, "");
    if (taken(what)) continue;
    if (what.length > 90) what = what.slice(0, 87) + "…";
    const key = (when.join() + what).toLowerCase();
    if (seenD.has(key)) continue;
    seenD.add(key);
    dates.push({ who: m.who, what, when });
  }
  return { todo, dates };
}

/* ======================================================================
   MODEL CALLS
   ====================================================================== */

const stripThink = (s) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();
async function gen(messages, max, acc, { temp = 0.1, penalty = false } = {}) {
  if (S.stopped) throw new Error("stopped");
  const id = S.modelId || "";
  const q3 = /qwen3/i.test(id);
  let ms = messages.map((m) => ({ ...m }));
  if (/gemma/i.test(id) && ms[0] && ms[0].role === "system") {
    const sys = ms.shift(); if (ms[0]) ms[0].content = sys.content + "\n\n" + ms[0].content;
  }
  if (q3) { const last = ms[ms.length - 1]; last.content += " /no_think"; }
  const req = { messages: ms, stream: false, temperature: temp, top_p: 0.9, max_tokens: max };
  if (penalty) { req.frequency_penalty = 0.6; req.presence_penalty = 0.3; }
  if (q3) req.extra_body = { enable_thinking: false };
  const r = await S.engine.chat.completions.create(req);
  acc.tokens += r.usage?.completion_tokens || 0;
  const d = r.usage?.extra?.decode_tokens_per_s; if (d) acc.speeds.push(d);
  return stripThink(r.choices?.[0]?.message?.content || "");
}

/* ---------- translation ---------- */
const TR = {
  Hindi: {
    sys: "Translate the message from English to Hindi, written in Devanagari script. Keep people's names, numbers and times exactly as written, with names in English letters. Do not add or remove information. Reply with the translation only.",
    ex: [
      ["Aman will pay the rent on Monday.", "Aman सोमवार को किराया देगा।"],
      ["Call the doctor.", "डॉक्टर को फ़ोन करना।"],
      ["The chat is about a birthday party planned for Sunday.", "यह चैट रविवार को होने वाली बर्थडे पार्टी की योजना के बारे में है।"]
    ]
  },
  Hinglish: {
    sys: "Translate the message from English to Hinglish: Hindi written in the Roman alphabet, the way people type on WhatsApp. Keep people's names, numbers and times exactly as written. Do not add or remove information. Reply with the translation only.",
    ex: [
      ["Aman will pay the rent on Monday.", "Aman Monday ko rent dega."],
      ["Call the doctor.", "Doctor ko call karna."],
      ["The chat is about a birthday party planned for Sunday.", "Yeh chat Sunday ko hone wali birthday party ki planning ke baare mein hai."]
    ]
  }
};
const HINGLISH_WORDS = /\b(hai|hain|ka|ki|ke|ko|se|mein|me|aur|karna|kar|yeh|ye|woh|ne|par|pe|tak|liye|wala|wali|hoga|hogi|raha|rahe|rahi|nahi|bhi|ho|hua|hone|\w+(?:ega|egi|enge|unga|ungi))\b/i;
function keeps(src, out, lang, names) {
  const lo = out.toLowerCase();
  const ws = src.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  const okWords = ws.every((w, i) => {
    const k = w.toLowerCase();
    if (DAYS.includes(k)) return lang === "Hindi" ? lo.includes(k) || lo.includes(L10N.Hindi.days[k]) : lo.includes(k);
    if (names.has(k) || (i > 0 && /^[A-Z][a-z]/.test(w))) return lo.includes(k);
    return true;
  });
  if (!okWords) return false;
  if (lang === "Hindi") {
    const srcLow = src.toLowerCase();
    if ((out.match(/[A-Za-z]{3,}/g) || []).some((w) => !srcLow.includes(w.toLowerCase()))) return false;
  }
  return true;
}
function trFix(src, out, lang, names) {
  out = (out || "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^(?:output|translation|hindi|hinglish)\s*:\s*/i, "")
    .replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d));
  if (!out || out.length > src.length * 4 + 30 || gibberish(out)) return null;
  const lo = src.toLowerCase();
  if (TR[lang].ex.some((e) => !lo.includes(e[0].toLowerCase().replace(/[.!?]$/, "")) && out.toLowerCase().includes(e[1].toLowerCase().replace(/[।.]$/, "")))) return null;
  const nums = (s) => [...new Set(s.match(/\d+/g) || [])].sort().join(",");
  if (nums(src) !== nums(out)) return null;
  if (!keeps(src, out, lang, names)) return null;
  const dev = devRatio(out);
  if (lang === "Hindi") return dev >= 0.4 ? out : null;
  if (dev !== 0) return null;
  const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (flat(out) === flat(src)) return null;
  if (out.split(/\s+/).length >= 4 && !HINGLISH_WORDS.test(out)) return null;
  return out;
}
async function translateAll(srcs, lang, hooks, acc, names) {
  const cfg = TR[lang], res = [];
  for (let i = 0; i < srcs.length; i++) {
    if (S.stopped) throw new Error("stopped");
    const s = srcs[i];
    hooks.onStatus?.(`Translating to ${lang}… ${i + 1} of ${srcs.length}`);
    const messages = [];
    cfg.ex.forEach((e, k) => {
      messages.push({ role: "user", content: (k === 0 ? cfg.sys + "\n\n" : "") + e[0] });
      messages.push({ role: "assistant", content: e[1] });
    });
    messages.push({ role: "user", content: s });
    const out = await gen(messages, Math.min(240, (lang === "Hindi" ? 4 : 2) * s.length + 40), acc, { temp: 0 });
    res.push(trFix(s, out.split("\n")[0], lang, names));
  }
  return res;
}
async function trMap(srcs, lang, hooks, acc, names) {
  const uniq = [...new Set(srcs.filter(Boolean))];
  const m = new Map(), need = [];
  for (const s of uniq) { const r = ruleTr(s, lang, names); if (r) m.set(s, r); else need.push(s); }
  if (need.length) {
    const out = await translateAll(need, lang, hooks, acc, names);
    need.forEach((s, i) => m.set(s, out[i]));
  }
  m.miss = need.filter((s) => !m.get(s)).length;
  return m;
}

/* ---------- summarize ---------- */
async function summarize(text, lang, hooks = {}) {
  text = normalize(text);
  const t0 = performance.now();
  const acc = { tokens: 0, speeds: [] };
  const sys = "You read chats and answer very briefly. Use only facts written in the chat. Never invent names, days or times. Never copy the chat. Write in English.";
  const lines = (s) => {
    const seen = new Set();
    return s.split("\n")
      .map((l) => l.trim())
      .filter((l) => !/^[\s\[\(]*\d{0,2}:\d{2}/.test(l))
      .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim())
      .filter((l) => l.length > 3 && !/:\s*$/.test(l) && !/^none\b/i.test(l))
      .filter((l) => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  };

  const msgs = readMsgs(text);
  const names = new Set(msgs.map((m) => m.who.toLowerCase()));

  const dev = devRatio(text);
  const direct = dev > 0.15 ? 1400 : 3500, chunk = dev > 0.15 ? 900 : 2800;
  let ctx = text, label = "Chat:";
  if (text.length > direct) {
    let parts = splitChat(text, chunk);
    if (parts.length > 12) { parts = parts.slice(-12); hooks.onWarn?.("Very long chat. Only the latest part was read."); }
    const notes = [];
    for (let i = 0; i < parts.length; i++) {
      hooks.onStatus?.(`Reading part ${i + 1} of ${parts.length}…`);
      const n = await gen([
        { role: "system", content: sys },
        { role: "user", content: `Part ${i + 1} of ${parts.length} of a group chat:\n\n${parts[i]}\n\nWrite 3 to 6 short bullet notes: key points, decisions, tasks (Name: task) and any days or times. Use only what is written.` }
      ], 220, acc, { penalty: true });
      notes.push(n);
    }
    ctx = notes.join("\n"); label = "Notes from a long chat:";
  }
  const q = (instruction, max) => gen([
    { role: "system", content: sys },
    { role: "user", content: `${label}\n${ctx}\n\n${instruction}` }
  ], max, acc, { penalty: true });

  hooks.onStatus?.("Finding the gist…");
  const gistRaw = await q("Write one full sentence of 10 to 20 words saying what this chat is about and what is planned. Name the event and the day if the chat says them. Do not use vague words like details or arrangements. Reply with the sentence only.", 80);
  hooks.onStatus?.("Finding the tasks…");
  const todoRaw = await q("List what each person said they will do. One line per task, written as Name: task. Use only names from the chat. At most 6 lines. Reply with the list only.", 120);
  hooks.onStatus?.("Checking tasks and dates…");

  const rules = extractRules(text, msgs, lines(todoRaw));
  const N = lang === "English" ? [7, 6] : [6, 5];
  const T = rules.todo.slice(-N[0]), D = rules.dates.slice(-N[1]);

  let gist = firstSentences(lines(gistRaw).join(" "), 2);
  let fb = false;
  if (!gistOk(gist, text)) {
    if (gibberish(gistRaw)) hooks.onWarn?.(BROKEN_MSG);
    gist = fallbackGist(msgs, T.length, D.length, "English"); fb = true;
  }

  let tr = (s) => s;
  if (lang !== "English") {
    const m = await trMap([...T.map((x) => x.what), ...D.map((x) => x.what)], lang, hooks, acc, names);
    let miss = m.miss;
    tr = (s) => m.get(s) || s;
    let g = null;
    if (!fb) { g = (await translateAll([gist], lang, hooks, acc, names))[0]; if (!g) miss++; }
    gist = g || fallbackGist(msgs, T.length, D.length, lang);
    if (miss) hooks.onWarn?.(MISS_MSG(miss));
  }

  const LB = LBL[lang];
  const whenStr = (arr) => arr.map((x) => whenLocal(x, lang)).join(", ");
  const todoOut = T.map((x) => {
    const w = whenStr(x.when);
    return `${x.who}${x.ask ? " " + LB.asks : ""}: ${tr(x.what)}${w ? " (" + w + ")" : ""}`;
  });
  const datesOut = D.map((x) => {
    const w = whenStr(x.when);
    const body = `${x.who ? x.who + ": " : ""}${tr(x.what)}`;
    return w ? `${capFirst(w)} — ${body}` : body;
  });

  const secs = (performance.now() - t0) / 1000;
  const speed = acc.speeds.length ? acc.speeds.reduce((a, b) => a + b, 0) / acc.speeds.length : acc.tokens / Math.max(secs, 0.1);
  return { p: { gist, todo: todoOut, dates: datesOut }, tokens: acc.tokens, secs, speed };
}

/* ---------- render result ---------- */
function fill(ul, items, emptyText, checks) {
  ul.textContent = "";
  if (!items.length) {
    const li = document.createElement("li"), p = document.createElement("p");
    p.className = "empty"; p.textContent = emptyText; li.appendChild(p); ul.appendChild(li); return;
  }
  items.forEach((txt) => {
    const li = document.createElement("li");
    if (checks) {
      const c = document.createElement("input");
      c.type = "checkbox"; c.className = "check"; c.setAttribute("aria-label", "Mark done");
      c.addEventListener("change", () => { li.classList.toggle("done", c.checked); haptic(8); });
      li.appendChild(c);
    }
    const s = document.createElement("span"); s.textContent = txt; li.appendChild(s);
    ul.appendChild(li);
  });
}
function showResult(p, stats, lang = "English") {
  const LB = LBL[lang] || LBL.English;
  S.shownLang = LBL[lang] ? lang : "English";
  $("#result").classList.remove("hidden");
  $("#skel").classList.add("hidden"); $("#live").classList.add("hidden");
  $("#gist").textContent = p.gist;
  const heads = $$("#out .block-t");
  if (heads[0]) heads[0].textContent = LB.todo;
  if (heads[1]) heads[1].textContent = LB.dates;
  fill($("#todo"), p.todo, LB.noTodo, true);
  fill($("#dates"), p.dates, LB.noDates, false);
  $("#copy").textContent = LB.copy;
  $("#share").textContent = LB.share;
  $("#out").classList.remove("hidden");
  if (stats) {
    $("#sModel").textContent = S.modelLabel;
    $("#sSpeed").textContent = stats.speed.toFixed(1) + " tok/s";
    $("#sTokens").textContent = stats.tokens + " tokens";
    $("#sTime").textContent = stats.secs.toFixed(1) + " s";
    $("#stats").classList.remove("hidden");
  } else { $("#stats").classList.add("hidden"); }
}

$("#go").addEventListener("click", async () => {
  const text = chat.value.trim();
  if (!S.engine || S.busy || text.length < 20) return;
  const lang = S.lang;
  S.busy = true; S.stopped = false; hideNotice(); hideReadNotice(); refresh(); haptic(12);
  const live = $("#live"), skel = $("#skel");
  $("#result").classList.remove("hidden");
  $("#out").classList.add("hidden"); $("#stats").classList.add("hidden");
  live.classList.add("hidden"); live.textContent = ""; skel.classList.remove("hidden");
  $("#go").classList.add("hidden"); $("#stop").classList.remove("hidden");
  scrollToResult();
  const show = (m) => { skel.classList.add("hidden"); live.classList.remove("hidden"); live.textContent = m; };
  const warns = [];
  try {
    const r = await summarize(text, lang, { onStatus: show, onWarn: (m) => { if (!warns.includes(m)) warns.push(m); } });
    if (S.stopped) { $("#result").classList.add("hidden"); }
    else {
      showResult(r.p, r, lang); addSaved(r.p, lang); haptic([10, 40, 10]);
      if (warns.length) toast(warns.join(" "), 5000);
    }
  } catch (e) {
    console.error(e);
    $("#result").classList.add("hidden");
    if (!S.stopped) {
      const m = String((e && e.message) || e);
      readNotice(/memory|device lost|out of|allocation/i.test(m)
        ? "The phone ran out of memory. Close other apps and tabs, or load a smaller model in the Lab tab."
        : "Something went wrong while reading the chat. Try a shorter chat, or reload the model in the Lab tab.");
    }
  } finally {
    S.busy = false;
    $("#stop").classList.add("hidden"); $("#go").classList.remove("hidden");
    refresh();
  }
});
$("#stop").addEventListener("click", () => { S.stopped = true; try { S.engine.interruptGenerate(); } catch {} });

/* ---------- copy / share ---------- */
function asText() {
  const LB = LBL[S.shownLang] || LBL.English;
  const li = (id) => $$(id + " li span").map((s) => "- " + s.textContent).join("\n");
  const clean = (id) => $(id + " li p.empty") ? "" : li(id);
  return `${$("#gist").textContent}\n\n${LB.todo}\n${clean("#todo") || "- " + LB.none}\n\n${LB.dates}\n${clean("#dates") || "- " + LB.none}`;
}
$("#copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(asText()); toast("Copied"); haptic(8); } catch { toast("Copy failed"); }
});
if (navigator.share) {
  $("#share").classList.remove("hidden");
  $("#share").addEventListener("click", () => navigator.share({ title: "Chat summary", text: asText() }).catch(() => {}));
}

/* ---------- saved ---------- */
function titleOf(g) { return g.split(/\s+/).slice(0, 7).join(" ").replace(/[.,;:!?।]+$/, ""); }
function addSaved(p, lang = S.lang) {
  const list = store.get(KEY_SAVED, []);
  list.unshift({ id: Date.now(), ts: Date.now(), title: titleOf(p.gist), gist: p.gist, todo: p.todo, dates: p.dates, model: S.modelLabel, lang });
  store.set(KEY_SAVED, list.slice(0, 100));
  renderSaved();
}
function renderSaved() {
  const q = $("#q").value.trim().toLowerCase();
  const all = store.get(KEY_SAVED, []);
  const list = q ? all.filter((x) => ((x.title || "") + " " + (x.gist || "") + " " + (x.todo || []).join(" ")).toLowerCase().includes(q)) : all;
  const box = $("#saved"); box.textContent = "";
  $("#wipe").classList.toggle("hidden", !all.length);
  if (!list.length) {
    const d = document.createElement("div"); d.className = "empty-state";
    d.textContent = all.length ? "No matches." : "Nothing saved yet. Summaries you make appear here.";
    box.appendChild(d); return;
  }
  list.forEach((x) => {
    const el = document.createElement("div");
    el.className = "item"; el.tabIndex = 0; el.setAttribute("role", "button"); el.dataset.id = x.id;
    const h = document.createElement("h3"); h.textContent = x.title;
    const p = document.createElement("p"); p.textContent = x.gist;
    const s = document.createElement("small"); s.textContent = fmtDate(x.ts) + " · " + x.model;
    const del = document.createElement("button");
    del.type = "button"; del.className = "btn quiet"; del.dataset.del = x.id; del.textContent = "Delete";
    del.style.marginTop = "8px"; del.style.paddingLeft = "0";
    el.append(h, p, s, del); box.appendChild(el);
  });
}
function openSaved(el) {
  const x = store.get(KEY_SAVED, []).find((v) => v.id === +el.dataset.id);
  if (!x) return;
  showResult({ gist: x.gist, todo: x.todo || [], dates: x.dates || [] }, null, x.lang || "English");
  goTab(0);
  setTimeout(scrollToResult, 350);
}
$("#saved").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    store.set(KEY_SAVED, store.get(KEY_SAVED, []).filter((x) => x.id !== +del.dataset.del));
    renderSaved(); haptic(8); return;
  }
  const it = e.target.closest(".item"); if (it) openSaved(it);
});
$("#saved").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const it = e.target.closest(".item"); if (it && e.target === it) openSaved(it);
});
$("#q").addEventListener("input", renderSaved);
$("#wipe").addEventListener("click", () => {
  if (confirm("Delete all saved summaries from this phone?")) { store.set(KEY_SAVED, []); renderSaved(); }
});

/* ---------- lab: benchmark ---------- */
function renderBench() {
  const rows = store.get(KEY_BENCH, []);
  const tb = $("#rows"); tb.textContent = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    [r.model, r.load != null ? r.load.toFixed(1) + " s" : "-", (r.tps || 0).toFixed(1), (r.secs || 0).toFixed(1) + " s"].forEach((v) => {
      const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  const has = rows.length > 0;
  $("#tblWrap").classList.toggle("hidden", !has);
  $("#exportMd").classList.toggle("hidden", !has);
  $("#clearBench").classList.toggle("hidden", !has);
}
$("#bench").addEventListener("click", async () => {
  if (!S.engine || S.busy) return;
  S.busy = true; S.stopped = false; hideNotice(); refresh();
  const btn = $("#bench"); btn.textContent = "Running…";
  try {
    const r = await summarize(BENCH_CHAT, "English");
    const rows = store.get(KEY_BENCH, []);
    rows.push({ model: S.modelLabel, load: S.loadSecs, tps: r.speed, secs: r.secs, tokens: r.tokens });
    store.set(KEY_BENCH, rows);
    renderBench(); toast("Benchmark saved"); haptic([10, 40, 10]);
  } catch (e) {
    console.error(e); showNotice("The benchmark failed. Try again, or reload the model.");
  } finally {
    S.busy = false; btn.textContent = "Run benchmark"; refresh();
  }
});
$("#exportMd").addEventListener("click", async () => {
  const rows = store.get(KEY_BENCH, []);
  const md = [
    "| Model | Load (s) | Tokens/s | Total (s) |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.model} | ${r.load != null ? r.load.toFixed(1) : "-"} | ${(r.tps || 0).toFixed(1)} | ${(r.secs || 0).toFixed(1)} |`)
  ].join("\n");
  try { await navigator.clipboard.writeText(md); toast("Copied as Markdown"); } catch { toast("Copy failed"); }
});
$("#clearBench").addEventListener("click", () => { store.set(KEY_BENCH, []); renderBench(); });

/* ---------- install + service worker + share target ---------- */
let deferredInstall = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; $("#install").classList.remove("hidden"); });
addEventListener("appinstalled", () => { deferredInstall = null; $("#install").classList.add("hidden"); });
$("#installBtn").addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch {}
  deferredInstall = null; $("#install").classList.add("hidden");
});
if ("serviceWorker" in navigator) {
  const reg = () => navigator.serviceWorker.register("sw.js").catch(() => {});
  if (document.readyState === "complete") reg(); else addEventListener("load", reg);
}
async function takeShared() {
  const q = new URLSearchParams(location.search);
  let text = q.get("text") || "";
  if (q.get("shared") === "file") {
    try {
      const c = await caches.open("slowly-share");
      const r = await c.match("shared-text");
      if (r) { text = await r.text(); await c.delete("shared-text"); }
    } catch {}
  }
  if (text) {
    chat.value = text; paintCount();
    history.replaceState(null, "", location.pathname);
    toast("Chat received");
  }
}

/* ---------- boot ---------- */
async function importEngine() {
  let last;
  for (const u of ENGINE_URLS) {
    try { return await import(u); } catch (e) { last = e; console.warn("engine import failed", u, e); }
  }
  throw last;
}
(async function boot() {
  paintCount(); renderSaved(); renderBench(); takeShared();
  setStatus("Checking your device…");
  const gpu = await detectGpu();
  if (!gpu) {
    S.unsupported = true; setStatus(""); refresh();
    const msg = "This browser does not support WebGPU, which the on-device model needs. Open this page in a recent Chrome on Android (version 121 or newer) and update Chrome.";
    showNotice(msg); readNotice(msg);
    const sel = $("#model"); sel.textContent = "";
    const o = document.createElement("option"); o.textContent = "Not supported on this browser"; sel.appendChild(o);
    return;
  }
  try {
    S.webllm = await importEngine();
  } catch (e) {
    console.error(e); setStatus("");
    const msg = "Couldn't load the model engine. Check your connection and reload the page.";
    showNotice(msg); readNotice(msg);
    return;
  }
  const list = buildModelList();
  setStatus("Pick a model and load it. You only do this once per device.");
  await markCached();
  const saved = store.get(KEY_MODEL, null);
  if (saved && list.some((x) => x.m.model_id === saved)) {
    try {
      if (S.webllm.hasModelInCache && await S.webllm.hasModelInCache(saved)) { $("#model").value = saved; paintHint(); loadModel(saved, { auto: true }); }
    } catch {}
  }
})();
