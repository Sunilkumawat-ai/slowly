<h1 align="center">Slowly</h1>

<p align="center">
  <strong>Catch up on the group chat without reading it.</strong><br>
  An open-weight language model runs inside your phone's browser, so your messages never leave your device.
</p>

<p align="center">
  <a href="https://sunilkumawat-ai.github.io/slowly/"><strong>Open the app</strong></a>
  &nbsp;·&nbsp; Chrome on Android &nbsp;·&nbsp; No account &nbsp;·&nbsp; No API key &nbsp;·&nbsp; MIT licensed
</p>

---

## The problem

Group chats pile up. Fifty messages about a trip, a deadline or a family function arrive while you are busy, and the useful part is three lines buried in the middle.

The usual fix is to paste the chat into a cloud AI. That means sending private conversations to someone else's server, paying per use, and needing a connection.

## What Slowly does

Paste a chat, or share a WhatsApp export into the app. A few seconds later you get:

- **The gist** in two sentences
- **To-dos**, with the owner named when the chat makes it clear, as a checklist you can tick off
- **Dates and plans** that were mentioned

You choose the summary language: **English, Hinglish or Hindi**.

Every summary is saved on your phone. You can search it later or delete it. Nothing is uploaded.

## Why open weights

Slowly only works because the model is open.

| | Closed cloud API | Slowly (open weights, on device) |
|---|---|---|
| Where your chat goes | Sent to a server you don't control | Stays on your phone |
| Cost per summary | Pay per token | Free |
| Account or API key | Required | None |
| Works offline | No | Yes, after the first download |
| Swap the model | Whatever the vendor offers | Pick any compatible open model in the Lab tab |
| Inspect what runs | No | Yes, the weights and the code are public |

For a personal chat, the privacy row alone is the reason to build it this way.

## How it works

```
 Chat text ──► Chunker ──► Open-weight model ──► Parser ──► Gist / To-do / Dates
 (pasted or      (long        (WebLLM + WebGPU,      (turns      (saved in your
  shared)         chats        runs on your GPU)      text into   browser only)
                  split)                              a layout)
```

1. **Load once.** Chrome downloads a compressed open-weight model and caches it on the phone.
2. **Run locally.** [WebLLM](https://github.com/mlc-ai/web-llm) runs the model through WebGPU on the phone's GPU.
3. **Handle long chats.** Chats over about 5,000 characters are split into parts, summarized into notes, and the notes are summarized again. This keeps a small model within its memory limit.
4. **Structure the answer.** The model is asked for a fixed format. A small parser turns it into the gist, a checklist and a date list.
5. **Store locally.** Summaries and benchmark runs live in the browser's `localStorage`. There is no server and no database.

There is no backend at all. The whole app is static files.
## Features

- **On-device inference.** No server, no API key, no account.
- **Swipe between screens.** Read, Saved and Lab are full-screen pages with a tab bar that follows your thumb.
- **Hinglish, Hindi and English summaries.**
- **Share to Slowly.** Once installed as an app, it can appear in the Android share sheet, so you can send a WhatsApp export straight in.
- **Offline after first load.** A service worker caches the app and the model engine.
- **Saved library.** Search, reopen and delete past summaries.
- **Lab.** Load different open models and run the same fixed Hinglish test chat on each. It records load time and tokens per second, and can export the results as a Markdown table.
- **Accessible and respectful of settings.** Automatic dark mode, reduced-motion support, and large touch targets.

## Models

Slowly lists the open-weight models that your phone's browser can run, and recommends one for you. It looks for these families:

- **Gemma** (Google), recommended when available
- **Llama 3.2 1B / 3B** (Meta)
- **Qwen 2.5 0.5B / 1.5B / 3B** (Alibaba)
- **SmolLM2** (Hugging Face)

The exact list depends on what WebLLM ships and what your GPU supports. Models that need too much memory are hidden.

## Run it yourself

It is plain HTML, CSS and JavaScript. There is no build step.

1. Fork or download this repo.
2. Serve the folder over HTTPS. GitHub Pages works: **Settings → Pages → Deploy from a branch → main / root**.
3. Open the page in Chrome on Android (version 121 or newer).

WebGPU needs a secure origin, so opening `index.html` straight from storage will not work. Use Pages or a local HTTPS server.

## Project layout

```
index.html             page structure
style.css              design system and layout
app.js                 inference, parsing, saved list, lab, install
sw.js                  offline cache and share target
manifest.webmanifest   installable app + share target
icon.svg               app icon
```

## Limitations

Honest notes, because small on-device models have real limits.

- **Small models make mistakes.** They can miss a detail, merge two people or misread sarcasm. Treat the summary as a quick catch-up and check the original chat before acting on anything important.
- **Hinglish and Hindi quality varies** by model. Compare them in the Lab tab.
- **Needs WebGPU.** That means a recent Chrome on Android. Many older phones and other browsers are not supported yet.
- **First load is large.** The download is hundreds of MB, so use Wi-Fi. It happens once.
- **Memory.** If a model fails to load, the phone probably ran out of RAM. Close other apps or pick a smaller model.

## Roadmap

- [ ] Parse WhatsApp export formats directly, so names and timestamps are cleaner
- [ ] Per-person view: "what do I owe, and to whom"
- [ ] Export a to-do or date to the phone's calendar
- [ ] Fine-tune a small model on Hinglish chats and compare it with the baseline
- [ ] Voice-note transcription with an open speech model, fully offline

## Built with

- [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU for in-browser inference
- Open-weight models from Google, Meta, Alibaba and Hugging Face
- Plain HTML, CSS and JavaScript

Built for the **Hacktoberfest 2026 Open-Source AI Challenge, Week 3: Slow and Steady**.

## Author

Made by [Sunil Kumawat](https://github.com/Sunilkumawat-ai).

## License

MIT. See [LICENSE](LICENSE).
