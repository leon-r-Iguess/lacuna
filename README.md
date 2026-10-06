# Lacuna

**Find the gaps in your knowledge before the exam does.**

Lacuna is an [Obsidian](https://obsidian.md) plugin that turns your lecture notes, PDFs and images into comprehension quizzes, grades your answers with a score and an error analysis, and tells you how ready you are for the exam – based on your actual results, not on how confident you feel.

*Lacuna* is Latin for "gap".

🇩🇪 [Deutsche Anleitung](README.de.md)

---

## Features

- **Quizzes from anything in your vault** – a note, a PDF (with page range), an image of a blackboard, or a whole folder. Multiple choice and open questions, three difficulty levels.
- **Real grading, not just right/wrong** – open answers get partial points, every mistake gets an error type (knowledge gap, confusion, incomplete, application error, calculation error, imprecise), what was wrong, the correct reasoning, a reference to the source and a follow-up question.
- **Follow-up round** – one click turns the follow-up questions into a new quiz, without another AI call.
- **Past exams as style template** – questions in the style and at the level of an old exam, with content from your material.
- **Exam readiness** – a live bar in the progress note:
  - **Coverage**: which topics of the course you have tested (with an editable topic list, created only after you confirm).
  - **Mastery**: your scores in the latest quizzes per topic.
  - **Recall**: how much you probably still know today, computed with [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) (Free Spaced Repetition Scheduler, the algorithm behind modern Anki) – **from your quiz results only**.
  - **Exam date**: countdown and a forecast of what is left on exam day if you stop reviewing now.
  - **Biggest levers**: the three topics where studying pays off most right now, each with a "quiz on it" button.
- **"How sure are you?"** – optional confidence rating per question. It never changes points or the review plan, but shows where you overestimate yourself and puts "sure but wrong" answers first in the next review.
- **Everything is Markdown** – quizzes, results, progress and topic lists are normal notes in your vault. Solutions are stored hidden inside the quiz note, so it syncs with the rest of your vault.
- **Your AI, your key** – Claude (Anthropic), Gemini (Google) or ChatGPT (OpenAI). Shows token usage and the approximate cost below every quiz.
- **English and German** – the interface follows Obsidian's language; quizzes are always written in the language of your material.

## How it works

1. Right-click a note, PDF, image or folder → **Lacuna: Create quiz**.
2. Answer in the note: check boxes for multiple choice, write below **Answer:** for open questions.
3. Click **Evaluate**. The quiz note turns into the result with score, error analysis and follow-up questions.
4. Right-click the subject folder → **Lacuna: Update progress** to see patterns across quizzes, the exam readiness and what to do next.

```text
Exam readiness Networks   █████░░░░░  53 %
Coverage 100 % · Mastery 80 % · Freshness good
Exam in 128 days · on exam day without further review: 33 %

Biggest levers:
1. Subnetting – 50 % mastered (medium)
2. VLAN – little evidence yet (high)
```

## Installation

Lacuna is not in the community plugin directory yet.

**With BRAT (recommended for beta testing)**
1. Install the community plugin **BRAT** (Beta Reviewers Auto-update Tester).
2. BRAT → *Add beta plugin* → enter this repository's URL.
3. Enable **Lacuna** under *Settings → Community plugins*.

**Manually**
1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. Put them into `<your vault>/.obsidian/plugins/lacuna/`.
3. Reload Obsidian and enable **Lacuna** under *Settings → Community plugins*.

Then open *Settings → Lacuna*, pick a provider and enter your API key:

| Provider | Get a key | Default model |
|---|---|---|
| Claude (Anthropic) | platform.claude.com → API Keys | `claude-sonnet-5-5` |
| Gemini (Google) | aistudio.google.com → Get API key (free tier available) | `gemini-3.8-flash` |
| ChatGPT (OpenAI) | platform.openai.com → API keys | `gpt-6.1-sol` |

A typical quiz (create + evaluate) costs a few cents with the default models; Gemini's free tier costs nothing.

## How exam readiness is computed

Each topic counts as one card in FSRS. Every evaluated quiz is one review of each topic it contains, rated by the score for that topic:

| Score on the topic | FSRS rating |
|---|---|
| below 40 % | Again |
| 40–69 % | Hard |
| 70–89 % | Good |
| 90 % and above | Easy |

Exam-level quizzes are rated slightly more leniently, intro quizzes slightly more strictly.

Per topic: **readiness = mastery × recall × evidence**. Evidence reaches 100 % once at least 6 points have been asked about a topic, so a single lucky answer does not count as "done". The subject value is the weighted mean over all topics of the topic list (untested topics count as 0). Without any quiz at exam level or with a past exam, readiness is capped at 80 % (configurable).

The self-rated confidence is deliberately **not** part of this: it is shown as calibration only.

## Privacy

- Your material is sent to the AI provider you choose, only when you create or evaluate a quiz or build a topic list. Nothing is sent anywhere else, and there is no telemetry.
- API keys are stored locally in `.obsidian/plugins/lacuna/data.json`. Never share that folder – share the release files instead.
- Before a topic list is built, Lacuna shows a cost estimate and asks for confirmation.

## Coming from Skript-Check

Lacuna is the successor of *Skript-Check*, a German-only version of this plugin. On first start Lacuna takes over its settings and API keys, and it reads everything Skript-Check created: quizzes (also unevaluated ones), progress notes, topic lists and the exam date. Disable Skript-Check afterwards.

## Development

```bash
npm install
npm test           # Vitest, runs against a small stand-in for the Obsidian API
npm run build      # type check + bundle to dist/main.js
```

- `src/core/` – pure logic without Obsidian (scoring, Markdown, readiness, topic list), fully unit-tested
- `src/ai.ts` – the three providers, structured JSON output, retries and fallback model
- `src/sources.ts` – reading notes, PDFs (via Obsidian's pdf.js), images and folders
- `src/ui/` – dialogs, settings tab and the live readiness view
- `src/i18n.ts` – all English and German strings

To try a build in a vault, copy `dist/main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/lacuna/`.

Releases: `npm version <x.y.z> --no-git-tag-version`, commit and push to `main`. The release workflow sees the new version in `manifest.json` and publishes the GitHub release with `main.js`, `manifest.json` and `styles.css`.

## License

[MIT](LICENSE)
