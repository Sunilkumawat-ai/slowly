<div align="center">

# Slowly

**Catch up on the group chat without reading it.**

A small open-weight language model runs inside your phone's browser, so your messages never leave your device.

[Open the app](https://sunilkumawat-ai.github.io/slowly/) · Chrome on Android · No account · No API key · MIT licensed

</div>

---

## The problem

Group chats pile up. Fifty messages about a trip, a deadline or a family function arrive while you are busy, and the useful part is three lines buried in the middle.

The usual fix is to paste the chat into a cloud AI. That means sending private conversations to someone else's server, paying per use, and needing a good connection. I live in a village where the connection is slow, so I wanted something that does the work on the phone itself.

## What Slowly does

Paste a chat, or share a WhatsApp export into the app. About half a minute later you get:

- **The gist** in one or two sentences
- **To-dos**, with the owner named, as a checklist you can tick off
- **Dates and plans** that were mentioned

You choose the summary language: **English, Hinglish or Hindi**. Every summary is saved on your phone. You can search it later or delete it.

## See it work

Input:

```
[18:02] Riya: Movie night on Friday at 8 pm?
[18:03] Sunil: Yes. I will book the tickets tonight,
[18:05] Dev: I can come, but I will be late. Will reach by 8:30,
[18:06] Riya: Okay. I will bring snacks
[18:06] Sunil: Please send me 300 each by Thursday
```

Output (English, Llama 3.2 1B, on my phone):

> Movie night event on Friday. Movie tickets will be booked by Sunil tonight.
>
> **To do**
> - Sunil: book the tickets (tonight)
> - Riya: bring snacks
> - Sunil asks: send me 300 each (by Thursday)
>
> **Dates and plans**
> - Friday, 8 pm: Riya: Movie night
> - Dev: will be late
> - By 8:30: Dev: will reach

The same chat in Hinglish:

> **Karne wale kaam**
> - Sunil: Tickets book karna hai (aaj raat)
> - Riya: Snacks lana hai
> - Sunil ka request: Mujhe 300 har ek bhejna hai (Thursday tak)

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

## Slow and steady

This project was built for the Hacktoberfest 2026 Open-Source AI Challenge, Week 3, "Slow and Steady". The theme fits in two ways.

**Slow network.** The first model download took me about 20 minutes on village internet. Slowly downloads it once. After that the model lives on the phone and you do not wait for anyone's server.

**Steady results.** Small models are unreliable, so Slowly does not trust them with everything. See the next section.

## How it works

1. **Load once.** Chrome downloads a compressed open-weight model and caches it on the phone.
2. **Run locally.** [WebLLM](https://github.com/mlc-ai/web-llm) runs the model through WebGPU on the phone's GPU.
3. **Rules find the facts.** Plain code reads the chat into who said what, then finds the to-dos ("I will...", "please send...") and the lines that name a day or a time.
4. **The model writes the gist.** It writes one short sentence about the chat. A second pass lists tasks, and any task is only kept if it names a real person from the chat.
5. **Every model line is checked.** If the gist repeats itself, invents a name or number, contains broken characters, or is too short, Slowly throws it away and shows a plain summary built from the chat instead.
6. **Long chats are split.** Longer chats are read in parts, turned into notes, and the notes are summarized again. Only the latest 12 parts are read.
7. **Store locally.** Summaries and benchmark runs live in the browser's `localStorage`. There is no server and no database.

There is no backend at all. The whole app is static files.

### Hinglish and Hindi

Small models are weak at Hindi. So Slowly translates the short, common lines (like "book the tickets" or "bring snacks") with a built-in dictionary, which is exact. Lines the dictionary does not know go to the model, and its answer is kept only if it passes the checks. If it fails, the line stays in English, and the app tells you how many lines stayed in English.

## Models

Slowly lists the open-weight models that your phone's browser can run, and **auto-picks the best one your phone can handle**. If that model does not fit in memory, it tries a smaller one, and it remembers which models failed so it does not download them again.

| Model | Maker | Role in Slowly |
|---|---|---|
| Qwen3 4B | Alibaba | Best quality, slow. Needs a strong phone |
| Llama 3.2 3B | Meta | Better Hindi |
| Qwen3 1.7B | Alibaba | Balanced |
| Llama 3.2 1B | Meta | Fast, works on most phones |
| Qwen2.5 1.5B / 3B | Alibaba | Good English |
| Phi-3.5 mini | Microsoft | Strong English, heavy |
| Gemma 2 2B | Google | Alternative |
| SmolLM2 1.7B | Hugging Face | Light |

The exact list depends on what WebLLM ships and what your GPU supports. Models that need too much memory are hidden.

## Measured on a real phone

Realme X7 Max, Chrome on Android, the 5-line chat from above. These are single runs, not a rigorous benchmark.

| Model | Language | Speed | Output | Total time |
|---|---|---|---|---|
| Llama 3.2 1B | English | 6.0 tok/s | 73 tokens | 21 s |
| Llama 3.2 1B | Hinglish | 6.3 tok/s | 99 tokens | 33 s |
| Llama 3.2 1B | Hindi | 5.9 tok/s | 132 tokens | 43 s |
| Qwen3 1.7B | Hinglish | 6.2 tok/s | 190 tokens | 45 s |
| Qwen3 1.7B | Hindi | 6.3 tok/s | 190 tokens | 45 s |

Hinglish and Hindi take longer because the app also translates lines. The Lab tab runs the same fixed chat on any model so you can compare on your own phone.

What I saw while testing:

- **Llama 3.2 1B** gave the most reliable gist on my phone.
- **Qwen3 1.7B** sometimes wrote a gist that failed the checks. Slowly then showed the plain summary instead of broken text.
- **Gemma 3 1B** loaded on my phone but wrote broken text, so it is not in the list.

## Features

- **On-device inference.** No server, no API key, no account.
- **Auto model choice.** Picks the best model that fits, falls back to a smaller one, and remembers what failed.
- **Swipe between screens.** Read, Saved and Lab are full-screen pages with a tab bar that follows your thumb.
- **English, Hinglish and Hindi summaries.**
- **Share to Slowly.** Once installed as an app, it can appear in the Android share sheet, so you can send a WhatsApp export straight in.
- **Offline after first load.** A service worker caches the app and the model engine, and the browser keeps the model.
- **Saved library.** Search, reopen and delete past summaries.
- **Lab.** Load different open models and run the same fixed Hinglish test chat on each. It records load time and tokens per second, and can export the results as a Markdown table.
- **Respects your settings.** Automatic dark mode, reduced-motion support, and large touch targets.

## Privacy

- Your chat is processed in the browser tab. It is never sent anywhere.
- Saved summaries, benchmark rows and your model choice are kept in your browser's `localStorage`. "Delete all" in the Saved tab clears the summaries.
- The only network requests are for the code and files the app needs: the WebLLM engine (from the esm.run CDN, with a jsDelivr fallback) and the model files (from Hugging Face, through WebLLM). None of them contains your chat.

## Run it yourself

It is plain HTML, CSS and JavaScript. There is no build step.

1. Fork or download this repo.
2. Serve the folder over HTTPS. GitHub Pages works: **Settings → Pages → Deploy from a branch → main / root**.
3. Open the page in Chrome on Android (version 121 or newer).

WebGPU needs a secure origin, so opening `index.html` straight from storage will not work. Use Pages or a local HTTPS server.

## Project layout

```
index.html            page structure
style.css             design system and layout
app.js                chat parsing, rules, model calls, saved list, lab, install
sw.js                 offline cache and share target
manifest.webmanifest  installable app and share target
icon.svg              app icon
```

## Limitations

Honest notes, because small on-device models have real limits.

- **Small models make mistakes.** They can miss a detail, merge two people or misread sarcasm. Treat the summary as a quick catch-up and check the original chat before acting on anything important.
- **The gist can be plain.** When the model's sentence fails the checks, Slowly shows a simple summary ("Chat between ... 3 tasks and 3 plans mentioned") instead.
- **Hinglish and Hindi are not perfect.** Common lines are exact. Unusual lines may stay in English. A bigger model (Llama 3.2 3B) translates better.
- **Names must match.** If a speaker's name is spelled two ways in the chat, they are treated as two people.
- **Needs WebGPU.** That means a recent Chrome on Android. Many older phones and other browsers are not supported yet.
- **First load is large.** The download is hundreds of MB to about a gigabyte, so use Wi-Fi. It happens once.
- **Memory.** If a model fails to load, the phone probably ran out of RAM. Close other apps or pick a smaller model.

## Roadmap

- [ ] Parse WhatsApp export formats directly, so names and timestamps are cleaner
- [ ] Per-person view: "what do I owe, and to whom"
- [ ] Export a to-do or date to the phone's calendar
- [ ] Fine-tune a small model on Hinglish chats and compare it with the baseline
- [ ] Voice-note transcription with an open speech model, fully offline

## Built with

- [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU for in-browser inference
- Open-weight models from Meta, Alibaba, Google, Microsoft and Hugging Face
- Plain HTML, CSS and JavaScript

Built for the **Hacktoberfest 2026 Open-Source AI Challenge, Week 3: Slow and Steady**.

## Author

Made by [Sunil Kumawat](https://github.com/Sunilkumawat-ai).

## License

MIT. See [LICENSE](LICENSE).
