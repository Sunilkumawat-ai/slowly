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
