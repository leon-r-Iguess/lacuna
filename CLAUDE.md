# Lacuna – notes for Claude Code

Obsidian plugin: AI quizzes from notes/PDFs/images, grading with error analysis, and exam readiness
(FSRS, Free Spaced Repetition Scheduler) computed from quiz results. Successor of the German-only
plugin "Skript-Check". Owner: Leon (student, writes tests for everything because details slip otherwise).

## Working with Leon

- Talk to him in **German**. Code, comments, commit messages and docs stay **English**.
- Spell out abbreviations once in parentheses the first time they come up (e.g. "CI (Continuous Integration)").
- He wants a plan before big changes, honest assessments, and tests for every fix.

## Commands

```bash
npm ci
npm test          # Vitest, ~92 tests, against tests/fake-obsidian.ts
npm run build     # tsc --noEmit + esbuild -> dist/main.js
npm run smoke     # loads dist/main.js against a stubbed Obsidian API and runs onload()
```

Always run all three before committing. `npm run smoke` exists because unit tests import the
TypeScript sources and cannot see bundle/startup errors (see 0.5.1 in CHANGELOG.md).

Try it in a vault: copy `dist/main.js`, `manifest.json`, `styles.css` to `<vault>/.obsidian/plugins/lacuna/`.

## Architecture

- `src/core/` – pure logic, no Obsidian imports, fully unit-tested
  - `types.ts` data model (QuizData, Question, Answer, Evaluation, Result)
  - `quiz-markdown.ts` render quiz/evaluated notes, parse answers back, frontmatter helpers
    (`noteKind`, `keepUserFrontmatter`, CRLF-safe)
  - `scoring.ts` MC graded locally, open answers via AI points
  - `readiness.ts` FSRS (ts-fsrs) per topic; readiness = mastery × recall × evidence; levers; calibration
  - `topics.ts` editable topic list (Topics.md / Themen.md), in-place updates, link-aware table parsing
  - `progress.ts` progress note (Progress.md / Lernstand.md), error patterns, review material
  - `prompts.ts` system prompts (English) + JSON schemas; output language = language of the material
  - `embed.ts` hidden `%%lacuna-data … %%` block (Base64 JSON) inside each quiz note
  - `legacy.ts` read Skript-Check data (German field names) and import its settings
  - `cost.ts` token usage and price table (USD per 1M tokens, Oct 2026)
- `src/ai.ts` Claude / Gemini / OpenAI via `requestUrl`, structured JSON output, retries, Gemini fallback model
- `src/sources.ts` notes, PDFs (Obsidian's pdf.js), images, folders, chunked folder loading
- `src/main.ts` plugin class: commands, menus, code blocks, flows (create, evaluate, follow-up, progress, review, topic list, exam date, status bar)
- `src/ui/` dialogs, settings tab, live readiness view
- `src/i18n.ts` all UI strings, `EN` and `DE` objects of the same type (TypeScript enforces completeness)

## Rules that must not break

1. **Never destroy the learner's text.** Only write to notes whose frontmatter says they are Lacuna
   notes (`noteKind`). Use `vault.process` for read-modify-write. Keep the learner's own frontmatter.
   Evaluate aborts if answers changed while the AI was grading. Topic list updates touch only the table and sources block.
2. **FSRS uses quiz results only.** The "How sure are you?" confidence is for calibration and for
   ordering review material – never for scheduling or points.
3. **Backward compatibility with Skript-Check**: frontmatter `skript-check: test|lernstand|themen`,
   German headings (`## Frage`, `**Antwort:**`), German confidence words, `%%skript-check-daten`,
   `skript-check` code blocks, `klausur:` exam date. Fixtures in `tests/fixtures/` were generated with
   the original Skript-Check code – keep `tests/legacy.test.ts` green.
4. **Obsidian community review rules**: no `innerHTML`, no `element.style` (use CSS classes or
   `setCssProps`), no default hotkeys, no plugin name in command names, network only via `requestUrl`,
   no Node/Electron APIs (`isDesktopOnly: false`), only `console.warn/error`.
5. **No secrets in the repo.** API keys live only in `.obsidian/plugins/lacuna/data.json` (gitignored).
   Tests use obvious fakes (`sk-ant-test`, `FAKE-…`). Scan before every push.
6. Every user-visible string goes through `t()` in both languages. Frontmatter keys stay English.
7. A code block language can be registered only once across all plugins – the legacy `skript-check`
   registration is wrapped in try/catch on purpose.

## Releases

Bump with `npm version <x.y.z> --no-git-tag-version` (updates manifest.json and versions.json), add a
CHANGELOG entry, commit, push to `main`. `.github/workflows/release.yml` sees the new manifest version and
creates the GitHub release with `main.js`, `manifest.json`, `styles.css`. No manual tags.
Commits use the GitHub noreply address `222822457+leon-r-Iguess@users.noreply.github.com`.

## State (2026-10-06)

- Version **0.5.2** released. Repo `leon-r-Iguess/lacuna`, currently **private**.
- Not yet tested in a real Obsidian vault after 0.5.1/0.5.2 (only via tests and the smoke test).
  Skript-Check must be disabled in the vault; Obsidian reload once afterwards.

## Open items

1. **Test in the real vault** (Leon's Linux laptop): install via BRAT or release files, check settings
   import from Skript-Check, old notes, topic list dialog, readiness bar, evaluate with confidence.
   Fix whatever shows up there first.
2. **Decision pending:** commit messages contain `Claude-Session: https://claude.ai/code/session_…` lines.
   Leon made the repo private because of them. Option: rewrite history to drop those lines (same approach
   as the e-mail rewrite: filter-branch, force push, then delete releases whose tags are no longer on
   `main` and rebuild the current release), then make the repo public again. Do not add such lines to new commits unless Leon wants them.
3. GitHub settings for Leon: repo description + topics, private vulnerability reporting (SECURITY.md links to it),
   e-mail privacy settings.
4. Before publishing more widely: README GIF (create → answer → evaluate → readiness), 2–3 beta testers via
   BRAT, then submit to `obsidianmd/obsidian-releases`.
5. Known, not yet fixed (low priority, from the code review):
   - Building a topic list reads/parses every source file before the confirmation dialog (slow at vault root, on mobile).
   - Skript-Check fails to load if it is enabled *after* Lacuna (code block conflict) – acceptable, README says disable it.
   - A source inside the user's own folder named like the quiz folder creates quizzes in `Tests/Tests`.
6. Planned for 0.6 (learning science): interleaved mixed quizzes across topics; successive relearning
   (repeat a topic until it is answered correctly several times in a row).
