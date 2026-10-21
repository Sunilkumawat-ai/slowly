/* Slowly - app.js
   On-device chat summaries with an open-weight model (WebLLM + WebGPU). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ENGINE_URL = "https://esm.run/@mlc-ai/web-llm";
const KEY_SAVED = "slowly.saved";
const KEY_BENCH = "slowly.bench";
const KEY_MODEL = "slowly.model";

const S = {
  webllm: null, engine: null, modelId: null, modelLabel: "", loadSecs: null,
  busy: false, hasF16: false, stopped: false, lang: "English"
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
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}
function haptic(p = 10) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }
function showNotice(msg) { const n = $("#notice"); n.textContent = msg; n.classList.remove("hidden"); }
function hideNotice() { $("#notice").classList.add("hidden"); }
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
    if (S.hasF16 && f32) return false;
    if (!S.hasF16 && f16) return false;
    return true;
  }).sort((a, b) => (a.vram_required_MB || 0) - (b.vram_required_MB || 0));

  const rec = list.find((m) => /gemma/i.test(m.model_id)) || list.find((m) => /llama-3\.2-1b/i.test(m.model_id)) || list[0];
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
    ? "Gemma is Google's open-weight model family. The first load downloads it once, so use Wi-Fi."
    : "The first load downloads the model once, so use Wi-Fi. Smaller models are faster but less precise.";
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

function format(lang) {
  const L = lang === "Hinglish" ? "Hinglish (Hindi written in the Roman alphabet, mixed with simple English)"
    : lang === "Hindi" ? "Hindi (Devanagari script)" : "English";
  return `Write the answer in ${L}. Reply in exactly this format and nothing else:
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

async function summarizeLong(text, lang, hooks = {}) {
  const t0 = performance.now();
  let tokens = 0, source, multi = false;
  if (text.length <= 5000) {
    source = `Here is a group chat:\n\n${text}\n\n${format(lang)}`;
  } else {
    multi = true;
    const parts = splitChat(text), notes = [];
    for (let i = 0; i < parts.length; i++) {
      if (S.stopped) throw new Error("stopped");
      hooks.onStatus?.(`Reading part ${i + 1} of ${parts.length}…`);
      const r = await ask(`Here is part ${i + 1} of ${parts.length} of a group chat:\n\n${parts[i]}\n\nWrite 3 to 6 short bullet notes: key points, decisions, tasks (with who owns them) and any dates or times. Use only what is written.`, { max: 220 });
      notes.push(r.text.trim());
      tokens += r.usage?.completion_tokens || r.chunks;
    }
    source = `Here are notes taken from a long group chat:\n\n${notes.join("\n\n")}\n\n${format(lang)}`;
  }
  const r = await ask(source, { max: 360, onToken: hooks.onToken });
  tokens += r.usage?.completion_tokens || r.chunks;
  const secs = (performance.now() - t0) / 1000;
  const decode = r.usage?.extra?.decode_tokens_per_s;
  return { p: parse(r.text), tokens, secs, speed: !multi && decode ? decode : tokens / secs };
}

/* ---------- summarize:  model writes the gist and tasks, rules pull the dates, all checked against the chat ---------- */
async function summarize(text, lang, hooks = {}) {
  if (text.length > 3500) return summarizeLong(text, lang, hooks);
  const t0 = performance.now();
  const say = lang === "Hinglish" ? "Write in simple Hinglish (Hindi in English letters)."
    : lang === "Hindi" ? "Write in Hindi." : "Write in English.";
  const sys = "You read short chats and answer very briefly. Use only facts written in the chat. Never invent names, days or times. Never copy the chat. " + say;
  let tokens = 0;
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
    tokens += r.usage?.completion_tokens || 0;
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
  const stamp = /^\s*(?:\[[^\]]*\]|\(?\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},?\s*\d{1,2}:\d{2}(?:\s?[ap]m)?\)?\s*-)\s*/i;
  const msgs = [];
  for (const raw of text.split("\n")) {
    const m = raw.replace(stamp, "").match(/^([^:\n]{1,30}):\s*(.+)$/);
    if (m) msgs.push({ who: m[1].trim(), msg: m[2].trim() });
  }
  const speakers = new Set(msgs.map((m) => m.who.toLowerCase()));

  /* 2) model: gist and tasks */
  hooks.onStatus?.("Finding the gist…");
  const gistRaw = await q("In one short sentence, say what this chat is about. Reply with the sentence only.", 60);
  hooks.onStatus?.("Finding the tasks…");
  const todoRaw = await q("List what each person said they will do. One line per task, written as Name: task. Use only names from the chat. At most 6 lines. Reply with the list only.", 140);
  hooks.onStatus?.("Checking tasks and dates…");

  /* 3) tasks: rule-based first (I will ...), then model tasks that name a real speaker and are not repeats */
  const willRe = /\b(i will|i'll|i am going to|i'm going to)\b|\b\w+(unga|ungi)\b/i;
  const stop = new Set(["the", "and", "for", "you", "with", "from", "that", "this", "will", "are", "was", "has", "have"]);
  const words = (s) => new Set(s.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !stop.has(w)) || []);
  const similar = (a, b) => {
    const A = words(a), B = words(b);
    if (!A.size || !B.size) return false;
    let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
    return n / Math.min(A.size, B.size) >= 0.5;
  };
  const todo = [];
  for (const m of msgs) {
    if (!willRe.test(m.msg)) continue;
    let t = m.msg.replace(/^(ok(ay)?|sure|done|great|fine|haan|theek hai|pakka)[,.! ]+/i, "")
      .replace(/\b(i will|i'll|i am going to|i'm going to)\s+/i, "");
    todo.push(m.who + ": " + t);
  }
  for (const l of lines(todoRaw)) {
    const i = l.indexOf(":");
    if (i < 1) continue;
    if (speakers.size && !speakers.has(l.slice(0, i).trim().toLowerCase())) continue;
    if (todo.some((x) => similar(x.slice(x.indexOf(":") + 1), l.slice(i + 1)))) continue;
    todo.push(l);
  }

  /* 4) dates: pull the chat lines that name a day or a time (nothing is invented) */
  const dayRe = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|morning|evening|afternoon|night|noon|kal|parso|aaj|subah|shaam|raat|dopahar|baje|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar)\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}(st|nd|rd|th)\b|कल|परसों|आज|सुबह|शाम|रात|बजे|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार/i;
  const pool = msgs.length ? msgs.map((m) => m.who + ": " + m.msg) : text.split(/[\n.!?]+/).map((s) => s.trim());
  const dates = [], seenD = new Set();
  for (const l of pool) {
    if (!dayRe.test(l)) continue;
    const k = l.toLowerCase();
    if (seenD.has(k)) continue;
    seenD.add(k);
    dates.push(l.length > 110 ? l.slice(0, 107) + "…" : l);
  }

  const secs = (performance.now() - t0) / 1000;
  const gist = lines(gistRaw).slice(0, 2).join(" ") || "The model could not write a clear summary. Try a shorter chat or a bigger model.";
  return { p: { gist, todo: todo.slice(0, 7), dates: dates.slice(0, 6) }, tokens, secs, speed: tokens / secs };
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
function showResult(p, stats) {
  $("#result").classList.remove("hidden");
  $("#skel").classList.add("hidden"); $("#live").classList.add("hidden");
  $("#gist").textContent = p.gist;
  fill($("#todo"), p.todo, "Nothing you need to do.", true);
  fill($("#dates"), p.dates, "No dates or plans mentioned.", false);
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
  S.busy = true; S.stopped = false; hideNotice(); refresh(); haptic(12);
  const live = $("#live"), skel = $("#skel");
  $("#result").classList.remove("hidden");
  $("#out").classList.add("hidden"); $("#stats").classList.add("hidden");
  live.classList.add("hidden"); live.textContent = ""; skel.classList.remove("hidden");
  $("#go").classList.add("hidden"); $("#stop").classList.remove("hidden");
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
  const show = (m) => { skel.classList.add("hidden"); live.classList.remove("hidden"); live.textContent = m; };
  try {
    const r = await summarize(text, S.lang, { onStatus: show, onToken: show });
    if (S.stopped) { $("#result").classList.add("hidden"); }
    else { showResult(r.p, r); addSaved(r.p); haptic([10, 40, 10]); }
  } catch (e) {
    console.error(e);
    $("#result").classList.add("hidden");
    if (!S.stopped) showNotice("Something went wrong while reading the chat. Try a shorter chat, or reload the model in the Lab tab.");
  } finally {
    S.busy = false;
    $("#stop").classList.add("hidden"); $("#go").classList.remove("hidden");
    refresh();
  }
});
$("#stop").addEventListener("click", () => { S.stopped = true; try { S.engine.interruptGenerate(); } catch {} });

/* ---------- copy / share ---------- */
function asText() {
  const li = (id) => $$(id + " li span").map((s) => "- " + s.textContent).join("\n");
  return `${$("#gist").textContent}\n\nTo do\n${li("#todo") || "- None"}\n\nDates and plans\n${li("#dates") || "- None"}`;
}
$("#copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(asText()); toast("Copied"); haptic(8); } catch { toast("Copy failed"); }
});
if (navigator.share) {
  $("#share").classList.remove("hidden");
  $("#share").addEventListener("click", () => navigator.share({ title: "Chat summary", text: asText() }).catch(() => {}));
}

/* ---------- saved ---------- */
function titleOf(g) { return g.split(/\s+/).slice(0, 7).join(" ").replace(/[.,;:!?]+$/, ""); }
function addSaved(p) {
  const list = store.get(KEY_SAVED, []);
  list.unshift({ id: Date.now(), ts: Date.now(), title: titleOf(p.gist), gist: p.gist, todo: p.todo, dates: p.dates, model: S.modelLabel, lang: S.lang });
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
  showResult({ gist: x.gist, todo: x.todo, dates: x.dates }, null);
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
