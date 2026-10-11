# Improvement ideas: learning science and fun

Candidate features for Lacuna, each backed by research on learning or motivation. Collected 2026-10-11
from a review of the code base (0.5.3). Nothing here is implemented yet; this is a backlog, not a plan.

**What Lacuna already does well:** retrieval practice instead of rereading (Adesope et al. 2017,
meta-analysis, g = 0.61), elaborated feedback with error analysis, the "sure but wrong" hint
(hypercorrection, Butterfield & Metcalfe 2001) and FSRS (Free Spaced Repetition Scheduler) scheduling.
The biggest remaining levers are about **when and how often** the learner practises, less about what.

Effort: S = small (about a day, no new AI calls), M = medium, L = large.

## A. Learning effect (well supported)

### 1. Explanation for "correct but guessed" — S, quick win
Correct multiple-choice answers currently get no explanation (`src/core/scoring.ts`, branch
`mcCorrect`). The model answer is already stored in the note. Show it when the learner rated the answer
"guessed" or "unsure" (or always, as a folded callout).
- Butler, Karpicke & Roediger 2008: feedback doubled retention of low-confidence correct answers.
- Points stay unchanged, so rule 2 (confidence never affects scheduling or points) holds.

### 2. Hint before solution — S
Render the correct solution as a folded callout (`> [!failure]-`) and put the existing follow-up question
above it as a hint, so the learner tries again before opening it.
- Metcalfe 2017 (review): errors followed by corrective feedback improve learning.
- Generation effect: Bertsch et al. 2007 (meta-analysis, d ≈ 0.40).
- Finn & Metcalfe 2010: scaffolded feedback beat plain answer feedback in a lab study (single study).

### 3. "Close the gap": successive relearning of missed questions — M (planned for 0.6)
Missed questions come back in later sessions until they were answered correctly in three *different*
sessions. Status per question: open → 1/3 → 2/3 → closed. Multiple choice is graded locally, so this
costs nothing.
- Rawson et al. 2018: one-week retention 68 % with one correct recall in each of three spaced sessions vs.
  26 % with three correct recalls in a single session.
- Rawson & Dunlosky 2011; Higham et al. 2022 (successive relearning in a real course).
- Karpicke & Roediger 2008: repeated retrieval of the same items strongly improves retention.
- Needs stable question IDs across quizzes (shared groundwork with 4 and 11).

### 4. Daily mixed round from due topics — M (planned for 0.6)
FSRS already computes `dueOn` per topic (`src/core/readiness.ts`), but nothing uses it actively. Add a
command and a `lacuna today` code block that the learner puts into their own daily-note template (so
Lacuna never writes to their notes, rule 1). It creates 5–8 questions from due topics, mixed, and
including open items from 3.
- Spacing: Cepeda et al. 2006 (meta-analysis); Cepeda et al. 2008 (optimal gap grows with retention interval).
- Interleaving: Brunmair & Richter 2019 (meta-analysis, g = 0.42), **strongest for similar, confusable
  material**, so mix within a subject rather than across unrelated subjects.

### 5. Confusion duel — S
The evaluation already tags `confusion` errors and names both concepts. Add a review variant that asks
discrimination questions only solvable by telling A and B apart (e.g. access port vs. trunk port).
- Brunmair & Richter 2019 ("Similarity matters"); Kang & Pashler 2012 (discriminative contrast).

### 6. Pretest before the lecture — S/M
A quiz on material not studied yet, excluded from FSRS and readiness (new level `pretest`), errors
explicitly welcome. The reference links from 0.5.3 lead straight to the place in the material.
- Richland, Kornell & Kao 2009; Kornell, Hays & Bjork 2009; Pan & Carpenter 2023 (review): pretesting
  helps when the correct answers are studied afterwards.
- Curiosity improves memory: Gruber, Gelman & Ranganath 2014.

### 7. Brain dump: "write down everything you know about X" — M
Free recall from memory; the AI compares it with the topic list / material and lists the gaps. Fits the
name Lacuna.
- Karpicke & Blunt 2011 (Science): free retrieval beat concept mapping.

### 8. Self-grading with a checklist (free, offline, mobile) — M
At creation, split the model answer into 2–4 key points ("idea units"). For open questions the learner
ticks which points they covered. Saves API cost, so more practice.
- Dunlosky, Hartwig, Rawson & Lipko 2011: idea-unit standards make self-evaluation more accurate.
  Mixed evidence: a 2022 study found no benefit for self-generated examples.
- **Decision needed:** may self-graded results feed FSRS? Rule 2 does not cover this case yet.

### 9. Mock exam ("dress rehearsal") — S/M
A full exam-level quiz with a past exam as style template a few days before the exam date; working time
is recorded.
- Transfer-appropriate processing: Morris, Bransford & Franks 1977.
- Retrieval practice protected memory under acute stress: Smith, Floerke & Thomas 2016 (Science).

### 10. "Explain it to the AI" (learning by teaching) — L
The AI plays a fellow student who asks follow-up questions; the learner explains.
- Fiorella & Mayer 2013/2014; Kobayashi 2019 (meta-analysis). Effects moderate. High fun, needs a dialog UI.

## B. Motivation and fun (also supported)

Basis: Self-Determination Theory (Ryan & Deci 2000): autonomy, competence, relatedness. Gamification
helps on average (Sailer & Homner 2020: g = 0.49 cognitive, 0.36 motivational, 0.25 behavioural), but
badges and leaderboards in a course lowered intrinsic motivation **and** exam scores (Hanus & Fox 2015).

### 11. "Gap closed!" moments and a gap map — M
Say explicitly when an earlier mistake is now answered correctly ("3 old gaps closed"). Add a tile map of
topics: grey = untested, then red → yellow → green. CSS classes only.
- Informational feedback raises intrinsic motivation, expected rewards lower it: Deci, Koestner & Ryan 1999.
- Goal-gradient effect: Kivetz, Urminsky & Zheng 2006.
- Builds on 3.

### 12. Study-day streak with grace days — S
Computed from existing `evaluated` timestamps, no new storage. One or two free days per week do not break
it. No "streak lost!" message; after a break, frame it as a fresh start.
- Silverman & Barasch 2023: intact streaks increase engagement, visibly broken ones make people drop off,
  and prompts to rescue a streak often backfire.
- Lally et al. 2010: missing a single day did not hurt habit formation.
- Fresh-start effect: Dai, Milkman & Riis 2014.

### 13. "What do you expect?" before evaluating — S
The learner guesses their score; afterwards it is compared with the result, showing calibration over time.
Never feeds FSRS (in the spirit of rule 2).
- Hacker, Bol, Horgan & Rakow 2000: prediction accuracy improved with practice, mainly for stronger students.

### 14. Difficulty adapted to the current level — S
The "quiz on it" lever button picks the level from topic mastery (intro when low, exam when high),
aiming at roughly 70–85 % success.
- Mostly theory: Wilson et al. 2019 ("85 % rule", derived from learning models); desirable difficulties (Bjork & Bjork). Weaker empirical support.

### 15. Microcopy that explains effort — S
E.g. "If this feels hard, you are learning right now." Only `src/i18n.ts`.
- Kirk-Johnson, Galla & Fraundorf 2019: learners read effort as poor learning and drop effective
  strategies. Effect of such messages is small, but nearly free.

### 16. "When do you study next?" when setting the exam date — S
An if-then plan ("Monday after the lecture, in the library, I do the Lacuna round").
- Implementation intentions: Gollwitzer & Sheeran 2006 (meta-analysis, d = 0.65).

### 17. One question at a time — M/L
A card mode instead of the whole note, especially on mobile. No study behind it; usability and game feel only.

## C. Deliberately avoid

- **Leaderboards, badges for everything, XP for time in the app** — lowered motivation and grades (Hanus & Fox 2015).
- **"Summarize" or "reread" buttons** — low utility (Dunlosky et al. 2013); would dilute Lacuna's core strength.
- **Confetti on every answer** — keep celebrations rare and informative (see 11).
- **"Your streak is broken!" reminders** — backfire (Silverman & Barasch 2023).

## Suggested order

1. First open item 1 in `CLAUDE.md`: test in a real vault and fix what shows up there.
2. Quick wins (small, no extra AI cost): 1, 2, 12, 13, 15.
3. Core of 0.6: 3 + 4 + 11 together — all need stable question IDs across quizzes. 3 has the largest effect.
4. Then the cheap prompt variants 5 and 6, later 8, 7, 9, 10.

## Sources checked online

- [Butler, Karpicke & Roediger 2008](https://profiles.wustl.edu/en/publications/correcting-a-metacognitive-error-feedback-increases-retention-of-/)
- [Brunmair & Richter 2019](https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf)
- [Sailer & Homner 2020](https://link.springer.com/article/10.1007/s10648-019-09498-w)
- [Silverman & Barasch 2023](https://www.colorado.edu/business/faculty-research/2023/04/19/or-track-how-broken-streaks-affect-consumer-decisions)
- [Kirk-Johnson, Galla & Fraundorf 2019](https://www.msrlab.pitt.edu/wp-content/uploads/2021/08/Kirk-Johnson-et-al-2019_Perceiving-effort-as-poor-learning.pdf)
- [Hanus & Fox 2015](https://osu.academia.edu/MichaelHanus)
- [Successive relearning (Higham et al.)](https://eprints.soton.ac.uk/449677/1/Higham_et_al._in_press_JEdPsych.pdf)
- [Pretesting (Pan & Carpenter)](https://par.nsf.gov/servlets/purl/10511812)
- [Agarwal et al. 2014, test anxiety](https://profiles.wustl.edu/en/publications/classroom-based-programs-of-retrieval-practice-reduce-middle-scho/) (self-report survey, not causal)
- [Finn & Metcalfe 2010, cited in a reference list](https://eprints.soton.ac.uk/412186/1/Beyond_Hypercorrection_manuscipt_R2_Final.docx)
- [Idea-unit standards, 2022 follow-up](https://link.springer.com/10.1007/s11409-022-09293-z)

All other studies are standard literature cited from memory and not re-checked online.
