# Changelog

## 0.5.1

- Fix: Lacuna failed to load while Skript-Check was still enabled (both registered the `skript-check` code block). Lacuna now leaves those blocks to Skript-Check until it is disabled.
- CI loads the built plugin once against a stubbed Obsidian API, so startup errors are caught before a release.

## 0.5.0 – Lacuna

First release under the name **Lacuna**.

- Interface and notes in English and German (follows Obsidian's language, can be set in the settings). Quizzes are written in the language of the material.
- Code base fully in English, AI instructions in English.
- Takes over settings and API keys from Skript-Check on first start and reads all notes it created (quizzes, progress notes, topic lists, exam date).
- New identifiers: notes are marked with `lacuna:` in the frontmatter, buttons use ```` ```lacuna ```` code blocks. Old `skript-check` blocks keep working.

## Skript-Check (German predecessor)

- **0.4** – Exam readiness with FSRS from quiz results only, topic list with confirmation and cost estimate, "How sure are you?", exam date, live readiness view, status bar.
- **0.3** – Gemini and ChatGPT besides Claude, retries and Gemini fallback model on overload, cost per quiz, folder quizzes, past exam as style template, levels, follow-up round, solutions stored inside the note.
- **0.2** – Question types (MC only / open only), progress note with error patterns, review quiz.
- **0.1** – Quizzes from notes, PDFs and images with score and error analysis (Claude).
