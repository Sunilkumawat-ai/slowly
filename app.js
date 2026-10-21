/* Slowly - app.js
   On-device chat summaries with an open-weight model (WebLLM + WebGPU). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
/* pinned version: an update from the CDN can no longer break the app or change the code that reads your chat */
const ENGINE_URL = "https://esm.run/@mlc-ai/web-llm@0.2.79";
const KEY_SAVED = "slowly.saved";
const KEY_BENCH = "slowly.bench";
const KEY_MODEL = "slowly.model";

const S = {
  webllm: null, engine: null, modelId: null, modelLabel: "", loadSecs: null,
  busy: false, hasF16: false, stopped: false, lang: "English", shownLang: "English"
};

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

/* Fixed Hinglish chat used by the benchmark, so every model gets the same input. */
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
/* the red box #notice lives in the Lab tab, so Read-tab errors need their own box on the Read tab */
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

/* ---------- connectivity ---------- */
function paintNet() {
  const on = navigator.onLine;
  $("#net").classList.toggle("off", !on);
  $("#netText").textContent = on ? "Online" : "Offline";
}
addEventListener("online", paintNet); addEventListener("offline", paintNet); paintNet();

/* ---------- swipe pager + tabs ---------- */
const pager = $("#pager"), tabsEl = $("#tabs"), tabBtns = $$(".tab");
function goTab(i) { pager.scrollTo({ left: i * pager.clientWidth, behavior: "smooth" }); }
tabBtns.forEach((b) => b.addEventListener("click", () => { haptic(8); goTab(+b.dataset.tab); }));
let raf = 0;
pager.addEventListener("scroll", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const p = pager.scrollLeft / pager.clientWidth;
    tabsEl.style.setProperty("--p", p.toFixed(3));
    const i = Math.round(p);
    tabBtns.forEach((b, k) => b.setAttribute("aria-selected", String(k === i)));
  });
}, { passive: true });
$("#setupBtn").addEventListener("click", () => goTab(2));

/* ---------- state -> UI ---------- */
const chat = $("#chat");
function refresh() {
  const ready = !!S.engine && !S.busy;
  $("#go").disabled = !(ready && chat.value.trim().length > 20);
  $("#bench").disabled = !ready;
  $("#modelState").textContent = S.engine ? S.modelLabel : "Not loaded";
  $("#goHint").textContent = S.engine ? "" : "Load a model first. Tap Set up above.";
  $("#setupBtn").textContent = S.engine ? "Change" : "Set up";
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
  const all = S.webllm.prebuiltAppConfig.model_list;
  const list = all.filter((m) => {
    const id = m.model_id;
    if (!/gemma|qwen2\.5-(0\.5b|1\.5b|3b)-instruct|llama-3\.2-(1b|3b)|smollm2/i.test(id)) return false;
    if (/-1k$/i.test(id) || /coder|math/i.test(id)) return false;
    if (m.vram_required_MB && m.vram_required_MB > 3600) return false;
    const f16 = /q4f16|q0f16/i.test(id), f32 = /q4f32|q0f32/i.test(id);
    /* Gemma writes broken text in f16 on many phone GPUs, so Gemma uses f32 only */
    if (/gemma/i.test(id)) return f32;
    if (S.hasF16 && f32) return false;
    if (!S.hasF16 && f16) return false;
    return true;
  }).sort((a, b) => (a.vram_required_MB || 0) - (b.vram_required_MB || 0));

  const rec = list.find((m) => /llama-3\.2-1b/i.test(m.model_id)) || list.find((m) => /gemma/i.test(m.model_id)) || list[0];
  const saved = store.get(KEY_MODEL, null);
  const sel = $("#model");
  sel.textContent = "";
  list.forEach((m) => {
    const o = document.createElement("option");
    const gb = m.vram_required_MB ? ` · ${(m.vram_required_MB / 1024).toFixed(1)} GB` : "";
    o.value = m.model_id;
    o.textContent = prettyName(m.model_id) + gb + (m === rec ? " (recommended)" : "");
    sel.appendChild(o);
  });
  if (!list.length) { const o = document.createElement("option"); o.textContent = "No compatible model found"; sel.appendChild(o); return; }
  sel.value = list.some((m) => m.model_id === saved) ? saved : rec.model_id;
  sel.disabled = false;
  $("#load").disabled = false;
  paintHint();
}
function paintHint() {
  const id = $("#model").value || "";
  $("#modelHint").textContent = /gemma/i.test(id)
    ? "Gemma is Google's open-weight model family. On some phones it can write broken text. If that happens, use Llama 3.2 1B. The first load downloads it once, so use Wi-Fi."
    : "The first load downloads the model once, so use Wi-Fi. Smaller models are faster but less precise. For better Hindi, try Llama 3.2 3B.";
}
$("#model").addEventListener("change", paintHint);

/* ---------- load model ---------- */
$("#load").addEventListener("click", async () => {
  if (S.busy) return;
  const id = $("#model").value;
  S.busy = true; hideNotice(); refresh();
  $("#load").disabled = true; $("#model").disabled = true;
  setProgress(0); setStatus("Starting download…");
  const t0 = performance.now();
  try {
    if (S.engine) { try { await S.engine.unload(); } catch {} S.engine = null; }
    S.engine = await S.webllm.CreateMLCEngine(id, {
      initProgressCallback: (r) => { setProgress(r.progress || 0); setStatus(r.text || "Loading…"); }
    });
    S.modelId = id; S.modelLabel = prettyName(id);
    S.loadSecs = (performance.now() - t0) / 1000;
    store.set(KEY_MODEL, id);
    setProgress(1);
    setStatus(`${S.modelLabel} loaded in ${S.loadSecs.toFixed(1)}s. It now runs on this device.`, true);
    haptic([10, 40, 10]); toast("Model ready");
    setTimeout(() => goTab(0), 800);
  } catch (e) {
    console.error(e);
    S.engine = null;
    setProgress(0); setStatus("");
    showNotice(String(e && e.message || e).slice(0, 220) + " | The model didn't load. If it keeps failing, choose a smaller model such as Llama 3.2 1B or SmolLM2.");
  } finally {
    S.busy = false;
    $("#load").disabled = false; $("#model").disabled = false;
    $("#load").textContent = S.engine ? "Load a different model" : "Download and load model";
    refresh();
  }
});

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
});

/* ---------- inference ---------- */
async function ask(prompt, { max = 320, onToken } = {}) {
  const stream = await S.engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    stream: true, temperature: 0.2, top_p: 0.9, max_tokens: max,
    stream_options: { include_usage: true }
  });
  let out = "", usage = null, n = 0;
  for await (const ch of stream) {
    const d = ch.choices?.[0]?.delta?.content;
    if (d) { out += d; n++; onToken?.(out); }
    if (ch.usage) usage = ch.usage;
    if (S.stopped) { try { S.engine.interruptGenerate(); } catch {} }
  }
  return { text: out, usage, chunks: n };
}

function splitChat(text, size = 3200) {
  const parts = []; let cur = "";
  for (const l of text.split("\n")) {
    if ((cur + "\n" + l).length > size && cur) { parts.push(cur); cur = l; }
    else cur = cur ? cur + "\n" + l : l;
  }
  if (cur) parts.push(cur);
  return parts;
}

/* the model always writes English first. Hindi and Hinglish come from the translation step below. */
function format() {
  return `Write the answer in English. Reply in exactly this format and nothing else:
GIST: Two short sentences. What the chat is about and where things stand.
TO DO:
- One action per line. Say who owns it if the chat makes that clear.
DATES:
- Each plan, deadline or time that was mentioned. Write "None" if there are none.
Keep the labels GIST, TO DO and DATES exactly as written. Use only what is in the chat. Do not invent names, times or amounts.`;
}

function parse(t) {
  t = t.replace(/\*\*/g, "").replace(/^#+\s*/gm, "");
  const g = /GIST:\s*([\s\S]*?)(?=\n\s*TO ?DO:|$)/i.exec(t);
  const td = /TO ?DO:\s*([\s\S]*?)(?=\n\s*DATES?\b|$)/i.exec(t);
  const dt = /DATES?[^:\n]*:\s*([\s\S]*)$/i.exec(t);
  const bullets = (s) => (s || "").split("\n")
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter((l) => l && !/^none\.?$/i.test(l));
  return { gist: (g ? g[1] : t).trim().replace(/\s+/g, " "), todo: bullets(td && td[1]), dates: bullets(dt && dt[1]) };
}

/* ---------- checks for bad model output ---------- */
/* read the chat into who / message */
const STAMP = /^\s*(?:\[[^\]]*\]|\(?\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},?\s*\d{1,2}:\d{2}(?:\s?[ap]m)?\)?\s*-)\s*/i;
function readMsgs(text) {
  const msgs = [];
  for (const raw of text.split("\n")) {
    const m = raw.replace(STAMP, "").match(/^([^:\n]{1,30}):\s*(.+)$/);
    if (m) msgs.push({ who: m[1].trim(), msg: m[2].trim() });
  }
  return msgs;
}
/* random symbols or random scripts = the model is broken */
function gibberish(g) {
  if (/<unused|<\|/.test(g)) return true;
  const L = g.match(/\p{L}/gu) || [];
  if (L.length < 8) return false;
  const known = L.filter((c) => /[A-Za-z\u0900-\u097F]/.test(c)).length;
  return (L.length - known) / L.length > 0.05;
}
/* English gist must be clean and must not invent numbers */
function gistOk(g, text, lang) {
  if (!g || g.length < 12 || gibberish(g)) return false;
  const L = g.match(/\p{L}/gu) || [];
  const dev = L.filter((c) => /[\u0900-\u097F]/.test(c)).length / (L.length || 1);
  if (lang === "Hindi" && dev < 0.4) return false;
  if (lang !== "Hindi" && dev > 0.1) return false;
  if (lang === "Hinglish" && !/\b(hai|hain|ka|ki|ke|ko|se|mein|aur|kar|karna|raha|rahe|rahi|liye|tak|hoga|hogi|wala|wali)\b/i.test(g)) return false;
  const seen = new Set(text.match(/\d+/g) || []);
  if ((g.match(/\d+/g) || []).some((n) => !seen.has(n))) return false;
  return true;
}
function joinNames(a, lang) {
  const and = lang === "Hinglish" ? "aur" : lang === "Hindi" ? "और" : "and";
  if (a.length < 2) return a[0] || "";
  return a.slice(0, -1).join(", ") + " " + and + " " + a[a.length - 1];
}
/* safe gist built from the chat itself, in the chosen language */
function fallbackGist(msgs, nTodo, nDates, lang) {
  const who = joinNames([...new Set(msgs.map((m) => m.who))].slice(0, 4), lang);
  if (lang === "Hindi") return (who ? who + " की चैट। " : "चैट। ") + `${nTodo} काम और ${nDates} योजनाओं या समय का ज़िक्र हुआ।`;
  if (lang === "Hinglish") return (who ? who + " ki chat. " : "Chat. ") + `${nTodo} kaam aur ${nDates} plan ya time ka zikr hua.`;
  return (who ? "Chat between " + who + ". " : "Chat. ") + `${nTodo} tasks and ${nDates} plans or times were mentioned.`;
}
const BROKEN_MSG = "Model wrote broken text. Simple summary used. Try Llama 3.2 1B in Lab.";
const MISS_MSG = (n) => `${n} line${n > 1 ? "s" : ""} stayed in English. Try Llama 3.2 3B for better Hindi.`;

/* ---------- labels in each language ---------- */
const LBL = {
  English: { todo: "To do", dates: "Dates and plans", noTodo: "Nothing you need to do.", noDates: "No dates or plans mentioned.", copy: "Copy", share: "Share", none: "None", asks: "asks" },
  Hindi: { todo: "करने के काम", dates: "तारीख़ें और योजनाएँ", noTodo: "कोई काम नहीं।", noDates: "कोई तारीख़ या योजना नहीं।", copy: "कॉपी", share: "शेयर", none: "कोई नहीं", asks: "का अनुरोध" },
  Hinglish: { todo: "Karne wale kaam", dates: "Dates aur plans", noTodo: "Koi kaam nahi.", noDates: "Koi date ya plan nahi.", copy: "Copy", share: "Share", none: "Koi nahi", asks: "ka request" }
};

/* ---------- days and times: a word list, so they are always correct ---------- */
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

/* ---------- translation: the model translates short lines, every line is checked ---------- */
/* returns the clean line, or null if the line looks wrong (then the English line is kept) */
function trFix(src, out, lang) {
  out = (out || "").trim().replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d));
  if (!out || out.length > src.length * 4 + 30 || gibberish(out)) return null;
  const nums = (s) => [...new Set(s.match(/\d+/g) || [])].sort().join(",");
  if (nums(src) !== nums(out)) return null;
  const L = out.match(/\p{L}/gu) || [];
  const dev = L.filter((c) => /[\u0900-\u097F]/.test(c)).length / (L.length || 1);
  if (lang === "Hindi") return dev >= 0.4 ? out : null;
  const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return dev === 0 && flat(out) !== flat(src) ? out : null;
}
const TR = {
  Hindi: {
    intro: "Translate each numbered line from English to Hindi, written in Devanagari script.",
    ex: [
      ["pay the rent", "किराया देना"],
      ["call the doctor", "डॉक्टर को फ़ोन करना"],
      ["The chat is about a birthday party planned for Sunday.", "यह चैट रविवार को होने वाली बर्थडे पार्टी की योजना के बारे में है।"]
    ]
  },
  Hinglish: {
    intro: "Translate each numbered line from English to Hinglish: Hindi written in the Roman alphabet, the way people type on WhatsApp.",
    ex: [
      ["pay the rent", "Rent dena"],
      ["call the doctor", "Doctor ko call karna"],
      ["The chat is about a birthday party planned for Sunday.", "Yeh chat Sunday ko hone wali birthday party ki planning ke baare mein hai."]
    ]
  }
};
async function translateAll(srcs, lang, hooks, acc) {
  const cfg = TR[lang], res = [];
  for (let i = 0; i < srcs.length; i += 6) {
    if (S.stopped) throw new Error("stopped");
    const part = srcs.slice(i, i + 6);
    hooks.onStatus?.(`Translating to ${lang}… ${Math.min(i + 6, srcs.length)} of ${srcs.length}`);
    const exIn = cfg.ex.map((e, k) => `${k + 1}. ${e[0]}`).join("\n");
    const exOut = cfg.ex.map((e, k) => `${k + 1}. ${e[1]}`).join("\n");
    const inp = part.map((s, k) => `${k + 1}. ${s}`).join("\n");
    const r = await S.engine.chat.completions.create({
      messages: [
        { role: "system", content: "You are a careful translator. You translate short chat lines and never add or remove facts." },
        { role: "user", content: `${cfg.intro} Keep names, numbers and times exactly as written. Do not explain. Reply with the numbered lines only.\n\nExample input:\n${exIn}\nExample output:\n${exOut}\n\nInput:\n${inp}\nOutput:` }
      ],
      stream: false, temperature: 0, top_p: 0.9, max_tokens: Math.min(420, 45 * part.length + 40)
    });
    acc.tokens += r.usage?.completion_tokens || 0;
    const d = r.usage?.extra?.decode_tokens_per_s; if (d) acc.speeds.push(d);
    const map = {};
    for (const l of (r.choices?.[0]?.message?.content || "").split("\n")) {
      const m = /^\s*(\d+)[.)]\s*(.+)$/.exec(l);
      if (m) map[+m[1]] = m[2].trim();
    }
    part.forEach((s, k) => res.push(trFix(s, map[k + 1], lang)));
  }
  return res;
}
/* translate each different line once. The result is a Map: English line -> translated line (or null) */
async function trMap(srcs, lang, hooks, acc) {
  const uniq = [...new Set(srcs.filter(Boolean))];
  const out = uniq.length ? await translateAll(uniq, lang, hooks, acc) : [];
  const m = new Map();
  uniq.forEach((s, i) => m.set(s, out[i]));
  m.miss = out.filter((x) => !x).length;
  return m;
}

/* ---------- long chats (over 3,500 characters) ---------- */
async function summarizeLong(text, lang, hooks = {}) {
  const t0 = performance.now();
  const acc = { tokens: 0, speeds: [] };
  const note = (r) => {
    acc.tokens += r.usage?.completion_tokens || r.chunks;
    const d = r.usage?.extra?.decode_tokens_per_s; if (d) acc.speeds.push(d);
  };
  let source;
  if (text.length <= 5000) {
    source = `Here is a group chat:\n\n${text}\n\n${format()}`;
  } else {
    const parts = splitChat(text), notes = [];
    for (let i = 0; i < parts.length; i++) {
      if (S.stopped) throw new Error("stopped");
      hooks.onStatus?.(`Reading part ${i + 1} of ${parts.length}…`);
      const r = await ask(`Here is part ${i + 1} of ${parts.length} of a group chat:\n\n${parts[i]}\n\nWrite 3 to 6 short bullet notes: key points, decisions, tasks (with who owns them) and any dates or times. Use only what is written.`, { max: 220 });
      notes.push(r.text.trim());
      note(r);
    }
    source = `Here are notes taken from a long group chat:\n\n${notes.join("\n\n")}\n\n${format()}`;
  }
  const r = await ask(source, { max: 360, onToken: hooks.onToken });
  note(r);
  const msgs = readMsgs(text);
  const p = parse(r.text);
  p.todo = p.todo.slice(0, 7); p.dates = p.dates.slice(0, 6);
  let fb = false;
  if (!gistOk(p.gist, text, "English")) {
    if (gibberish(r.text)) hooks.onWarn?.(BROKEN_MSG);
    p.gist = fallbackGist(msgs, p.todo.length, p.dates.length, "English"); fb = true;
  }
  if (lang !== "English") {
    const m = await trMap([fb ? "" : p.gist, ...p.todo, ...p.dates], lang, hooks, acc);
    if (m.miss) hooks.onWarn?.(MISS_MSG(m.miss));
    const g = fb ? "" : m.get(p.gist);
    p.gist = g || fallbackGist(msgs, p.todo.length, p.dates.length, lang);
    p.todo = p.todo.map((s) => m.get(s) || s);
    p.dates = p.dates.map((s) => m.get(s) || s);
  }
  const secs = (performance.now() - t0) / 1000;
  const speed = acc.speeds.length ? acc.speeds.reduce((a, b) => a + b, 0) / acc.speeds.length : acc.tokens / secs;
  return { p, tokens: acc.tokens, secs, speed };
}

/* ---------- summarize: the model finds the gist and tasks in English, rules find the dates, then everything is put into the chosen language ---------- */
async function summarize(text, lang, hooks = {}) {
  if (text.length > 3500) return summarizeLong(text, lang, hooks);
  const t0 = performance.now();
  const sys = "You read short chats and answer very briefly. Use only facts written in the chat. Never invent names, days or times. Never copy the chat. Write in English.";
  const acc = { tokens: 0, speeds: [] };
  const q = async (instruction, max) => {
    if (S.stopped) throw new Error("stopped");
    const r = await S.engine.chat.completions.create({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: "Chat:\n" + text + "\n\n" + instruction }
      ],
      stream: false, temperature: 0.1, top_p: 0.9, max_tokens: max,
      frequency_penalty: 0.6, presence_penalty: 0.3
    });
    acc.tokens += r.usage?.completion_tokens || 0;
    const d = r.usage?.extra?.decode_tokens_per_s; if (d) acc.speeds.push(d);
    return r.choices?.[0]?.message?.content || "";
  };
  const lines = (s) => {
    const seen = new Set();
    return s.split("\n")
      .map((l) => l.trim())
      .filter((l) => !/^[\s\[\(]*\d{0,2}:\d{2}/.test(l))
      .map((l) => l.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter((l) => l.length > 3 && !/:\s*$/.test(l) && !/^none\b/i.test(l))
      .filter((l) => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  };

  /* 1) read the chat into who / message */
  const msgs = readMsgs(text);
  const speakers = new Set(msgs.map((m) => m.who.toLowerCase()));

  /* 2) model: gist and tasks, always in English */
  hooks.onStatus?.("Finding the gist…");
  const gistRaw = await q("Write one full sentence of 10 to 20 words saying what this chat is about and what is planned. Name the event and the day if the chat says them. Do not use vague words like details or arrangements. Reply with the sentence only.", 80);
  hooks.onStatus?.("Finding the tasks…");
  const todoRaw = await q("List what each person said they will do. One line per task, written as Name: task. Use only names from the chat. At most 6 lines. Reply with the list only.", 120);
  hooks.onStatus?.("Checking tasks and dates…");

  /* 3) rules: words that name a day or a time, and helpers that clean a message */
  const dayRe = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|noon|kal|parso|aaj|subah|shaam|raat|dopahar|baje|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar)\b|\b\d{1,2}(:\d{2})?\s?(am|pm|baje)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}(st|nd|rd|th)\b|कल|परसों|आज|सुबह|शाम|रात|बजे|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार/i;
  const whenRe = /(?:\b(?:on|at|by|before|till|until)\s+)?(?:\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\b(?:\s+(?:morning|afternoon|evening|night))?|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b)/gi;
  const clean = (s) => s.replace(/^(?:(?:yes|yeah|yep|yup|ok(?:ay)?|sure|done|great|fine|cool|alright|haan|ha|theek hai|pakka)\b[,.!\s]*)+/i, "").trim();
  /* the action part of a message: filler words, time words and a starting "I will" removed */
  const core = (msg) => clean(msg.replace(whenRe, ""))
    .replace(/\s+/g, " ").replace(/\s+([.,!?])/g, "$1")
    .replace(/^(i will|i'll|i am going to|i'm going to)\s+/i, "")
    .replace(/[,.! ]+$/, "").trim();
  const whenOf = (msg) => { const f = msg.match(whenRe); return f ? f.map((x) => x.trim()) : []; };

  /* 4) tasks: "I will ...", then requests ("please ..."), then model tasks that name a real speaker and are not repeats */
  const willRe = /\b(i will|i'll|i am going to|i'm going to)\b|\b\w+(unga|ungi)\b/i;
  const stop = new Set(["the", "and", "for", "you", "with", "from", "that", "this", "will", "are", "was", "has", "have", "sunday", "saturday", "morning", "evening", "please", "pick"]);
  const words = (s) => new Set(s.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !stop.has(w)) || []);
  const similar = (a, b) => {
    const A = words(a), B = words(b);
    if (!A.size || !B.size) return false;
    let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
    return n >= 1 && n / Math.min(A.size, B.size) >= 0.3;
  };
  const todo = []; /* { who, what, when[], ask } */
  const taken = (what) => todo.some((x) => similar(x.what, what));
  for (const m of msgs) {
    const c = clean(m.msg);
    if (!willRe.test(c)) continue;
    if (/\b(i will|i'll)\s+be\b/i.test(c)) continue; /* "I will be late" is not a task */
    const what = core(m.msg);
    if (what) todo.push({ who: m.who, what, when: whenOf(m.msg), ask: false });
  }
  for (const m of msgs) {
    const r = /^(?:([A-Za-z]+),\s*)?please\s+(.+)$/i.exec(core(m.msg));
    if (!r) continue;
    const what = r[2].split(/[.!?]/)[0].trim();
    if (!what || taken(what)) continue;
    const owner = r[1] && speakers.has(r[1].toLowerCase()) ? r[1] : null;
    todo.push({ who: owner || m.who, what, when: whenOf(m.msg), ask: !owner });
  }
  for (const l of lines(todoRaw)) {
    const i = l.indexOf(":");
    if (i < 1) continue;
    const who = l.slice(0, i).trim(), what = l.slice(i + 1).trim().replace(/[,.! ]+$/, "");
    if (speakers.size && !speakers.has(who.toLowerCase())) continue;
    if (!what || taken(what)) continue;
    todo.push({ who, what, when: [], ask: false });
  }

  /* 5) dates: pull the chat lines that name a day or a time (nothing is invented) */
  const pool = msgs.length ? msgs : text.split(/[\n.!?]+/).map((s) => ({ who: "", msg: s.replace(STAMP, "").trim() })).filter((m) => m.msg);
  const dates = [], seenD = new Set(); /* { who, what, when[] } */
  for (const m of pool) {
    if (!dayRe.test(m.msg)) continue;
    const when = whenOf(m.msg);
    let what = (when.length ? core(m.msg) : "") || clean(m.msg).replace(/[,.! ]+$/, "");
    if (what.length > 90) what = what.slice(0, 87) + "…";
    const key = (when.join() + what).toLowerCase();
    if (seenD.has(key)) continue;
    seenD.add(key);
    dates.push({ who: m.who, what, when });
  }

  const T = todo.slice(0, lang === "English" ? 7 : 6), D = dates.slice(0, lang === "English" ? 6 : 5);

  /* 6) English gist: check it. If it is broken or has invented numbers, use a safe gist */
  let gist = lines(gistRaw).slice(0, 2).join(" ");
  let fb = false;
  if (!gistOk(gist, text, "English")) {
    if (gibberish(gistRaw)) hooks.onWarn?.(BROKEN_MSG);
    gist = fallbackGist(msgs, T.length, D.length, "English"); fb = true;
  }

  /* 7) translate the gist and the action lines (each different line once) */
  let tr = (s) => s;
  if (lang !== "English") {
    const m = await trMap([fb ? "" : gist, ...T.map((x) => x.what), ...D.map((x) => x.what)], lang, hooks, acc);
    if (m.miss) hooks.onWarn?.(MISS_MSG(m.miss));
    tr = (s) => m.get(s) || s;
    const g = fb ? "" : m.get(gist);
    gist = g || fallbackGist(msgs, T.length, D.length, lang);
  }

  /* 8) build the final lines. Days and times come from the word list. */
  const LB = LBL[lang];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const whenStr = (arr) => arr.map((x) => whenLocal(x, lang)).join(", ");
  const todoOut = T.map((x) => {
    const w = whenStr(x.when);
    return `${x.who}${x.ask ? " " + LB.asks : ""}: ${tr(x.what)}${w ? " (" + w + ")" : ""}`;
  });
  const datesOut = D.map((x) => {
    const w = whenStr(x.when);
    const body = `${x.who ? x.who + ": " : ""}${tr(x.what)}`;
    return w ? `${cap(w)} — ${body}` : body;
  });

  const secs = (performance.now() - t0) / 1000;
  const speed = acc.speeds.length ? acc.speeds.reduce((a, b) => a + b, 0) / acc.speeds.length : acc.tokens / secs;
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
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
  const show = (m) => { skel.classList.add("hidden"); live.classList.remove("hidden"); live.textContent = m; };
  let warn = "";
  try {
    const r = await summarize(text, lang, { onStatus: show, onToken: show, onWarn: (m) => { warn = m; } });
    if (S.stopped) { $("#result").classList.add("hidden"); }
    else {
      showResult(r.p, r, lang); addSaved(r.p, lang); haptic([10, 40, 10]);
      if (warn) toast(warn, 4500);
    }
  } catch (e) {
    console.error(e);
    $("#result").classList.add("hidden");
    if (!S.stopped) readNotice("Something went wrong while reading the chat. Try a shorter chat, or reload the model in the Lab tab.");
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
  return `${$("#gist").textContent}\n\n${LB.todo}\n${li("#todo") || "- " + LB.none}\n\n${LB.dates}\n${li("#dates") || "- " + LB.none}`;
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
  const list = q ? all.filter((x) => (x.title + " " + x.gist + " " + x.todo.join(" ")).toLowerCase().includes(q)) : all;
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
  showResult({ gist: x.gist, todo: x.todo, dates: x.dates }, null, x.lang || "English");
  goTab(0);
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
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
    [r.model, r.load != null ? r.load.toFixed(1) + " s" : "-", r.tps.toFixed(1), r.secs.toFixed(1) + " s"].forEach((v) => {
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
    ...rows.map((r) => `| ${r.model} | ${r.load != null ? r.load.toFixed(1) : "-"} | ${r.tps.toFixed(1)} | ${r.secs.toFixed(1)} |`)
  ].join("\n");
  try { await navigator.clipboard.writeText(md); toast("Copied as Markdown"); } catch { toast("Copy failed"); }
});
$("#clearBench").addEventListener("click", () => { store.set(KEY_BENCH, []); renderBench(); });

/* ---------- install + service worker + share target ---------- */
let deferredInstall = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; $("#install").classList.remove("hidden"); });
$("#installBtn").addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch {}
  deferredInstall = null; $("#install").classList.add("hidden");
});
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
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
(async function boot() {
  paintCount(); renderSaved(); renderBench(); takeShared();
  setStatus("Checking your device…");
  const gpu = await detectGpu();
  if (!gpu) {
    setStatus("");
    showNotice("This browser does not support WebGPU, which the on-device model needs. Open this page in a recent Chrome on Android (version 121 or newer) and make sure Chrome is up to date.");
    $("#model").textContent = ""; const o = document.createElement("option"); o.textContent = "Not supported on this browser"; $("#model").appendChild(o);
    return;
  }
  try {
    S.webllm = await import(ENGINE_URL);
    buildModelList();
    setStatus("Pick a model and load it. You only do this once per device.");
  } catch (e) {
    console.error(e);
    setStatus("");
    showNotice("Couldn't load the model engine. Check your connection and reload the page.");
  }
})();
