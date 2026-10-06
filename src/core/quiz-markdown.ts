// Markdown form of a quiz: render it, read the learner's answers back, render the evaluated version.
// Pure functions without Obsidian. Rendering uses the UI language; reading accepts English and German,
// so notes created by Skript-Check (the German predecessor) keep working.

import { t } from "../i18n";
import { dataBlock } from "./embed";
import { costText } from "./cost";
import { Answer, CONFIDENCE_LEVELS, Confidence, ErrorType, Evaluation, Question, QuizData, Result } from "./types";

export const PLUGIN_KEY = "lacuna";
export const LEGACY_KEY = "skript-check";

const button = (action: string) => "```" + PLUGIN_KEY + "\n" + action + "\n```";
export const BUTTON_EVALUATE = button("evaluate");
export const BUTTON_REVIEW = button("review");
export const BUTTON_FOLLOW_UP = button("follow-up");
export const BLOCK_READINESS = button("readiness");

/** Code block actions, including the German ones from Skript-Check notes. */
export function normalizeAction(a: string): string {
	const m: Record<string, string> = { auswerten: "evaluate", wiederholen: "review", nachfragen: "follow-up", reife: "readiness" };
	return m[a] ?? a;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Confidence words in both languages. */
const CONFIDENCE_WORDS: Record<string, Confidence> = {
	guessed: "guessed",
	unsure: "unsure",
	sure: "sure",
	geraten: "guessed",
	unsicher: "unsure",
	sicher: "sure",
};

/** Put text safely into a YAML double-quoted string. */
export function yamlString(s: string): string {
	return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ") + '"';
}

/** Prefix every line with "> " so the text sits inside a callout. */
export function asCallout(text: string): string {
	return String(text)
		.split("\n")
		.map((z) => "> " + z)
		.join("\n");
}

function wikiLink(path: string): string {
	const name = path.split("/").pop() || path;
	if (!name.includes(".")) return t().md.folder(path); // folder quiz: no link possible
	return `[[${path}|${name}]]`;
}

function footer(q: QuizData): string {
	const s = t().md;
	const parts: string[] = [];
	if (q.styleTemplate) parts.push(`${s.styleTemplate}: ${wikiLink(q.styleTemplate)}`);
	if (q.cost) parts.push(`${s.aiUsage}: ${costText(q.cost)}`);
	return parts.length ? parts.map((z) => `<small>${z}</small>`).join("<br>\n") : "";
}

function questionHeading(q: Question): string {
	return `## ${t().md.question} ${q.nr} · ${t().difficulty[q.difficulty]} · ${q.topic}`;
}

function confidenceLines(): string[] {
	return [`*${t().md.howSure}*`, ...CONFIDENCE_LEVELS.map((c) => `- [ ] ${t().confidence[c]}`)];
}

export interface RenderOptions {
	/** Ask "How sure are you?" per question (calibration only, never affects scheduling) */
	confidence?: boolean;
}

/** Render the empty quiz. */
export function renderQuiz(q: QuizData, opt: RenderOptions = {}): string {
	const s = t().md;
	const fm = [
		"---",
		`${PLUGIN_KEY}: quiz`,
		`id: ${q.id}`,
		`source: ${yamlString(wikiLink(q.source))}`,
		...(q.pages ? [`pages: ${yamlString(q.pages)}`] : []),
		`created: ${q.created}`,
		"status: open",
		`questions: ${q.questions.length}`,
		"---",
	].join("\n");

	const intro = [`# ${s.quizTitle(q.title)}`, "", `> [!info] ${s.howToTitle}`, `> ${s.howTo}`, ...(opt.confidence ? [`> ${s.confidenceHint}`] : [])].join("\n");

	const questions = q.questions
		.map((f) => {
			const parts = [questionHeading(f), "", f.question.trim(), ""];
			if (f.type === "mc") {
				f.options.forEach((o, i) => parts.push(`- [ ] ${LETTERS[i]}) ${o.replace(/\n/g, " ")}`));
				if (opt.confidence) parts.push("", ...confidenceLines());
			} else {
				if (opt.confidence) parts.push(...confidenceLines(), "");
				parts.push(`**${s.answer}:**`, "", "");
			}
			return parts.join("\n");
		})
		.join("\n\n");

	const foot = [`## ${s.evaluate}`, "", BUTTON_EVALUATE].join("\n");
	const info = footer(q);
	return [fm, intro, questions, foot, ...(info ? [info] : []), dataBlock(q)].join("\n\n") + "\n";
}

/** Body without frontmatter. */
export function withoutFrontmatter(md: string): string {
	const m = md.match(/^---\n[\s\S]*?\n---\n?/);
	return m ? md.slice(m[0].length) : md;
}

const ANSWER_LABEL = /^\*\*(?:Answer|Antwort):\*\*/m;

/** Read the learner's answers from the note. */
export function parseAnswers(md: string, questions: Question[]): Answer[] {
	const body = withoutFrontmatter(md).replace(/\r\n/g, "\n");
	const sections = body.split(/^(?=## )/m);
	const byNr = new Map<number, string>();
	for (const s of sections) {
		const m = s.match(/^## (?:Question|Frage) (\d+)\b/);
		if (m) byNr.set(parseInt(m[1], 10), s);
	}

	return questions.map((q) => {
		const section = byNr.get(q.nr) ?? "";
		const checked: number[] = [];
		let text = "";
		const answerStart = q.type === "open" ? section.search(ANSWER_LABEL) : -1;
		const confidence = readConfidence(answerStart >= 0 ? section.slice(0, answerStart) : section);
		if (q.type === "mc") {
			for (const line of section.split("\n")) {
				const m = line.match(/^\s*[-*+]\s*\[([xX])\]\s*([A-F])\)/);
				if (m) checked.push(LETTERS.indexOf(m[2].toUpperCase()));
			}
		} else if (answerStart >= 0) {
			text = section.slice(answerStart).replace(ANSWER_LABEL, "").trim();
		}
		return { nr: q.nr, checked, text, confidence };
	});
}

/** Read the checked confidence. Several checks: the most cautious one counts. */
export function readConfidence(section: string): Confidence | null {
	let best: Confidence | null = null;
	for (const line of section.split("\n")) {
		const m = line.match(/^\s*[-*+]\s*\[[xX]\]\s*(\p{L}+)\s*$/u);
		const c = m ? CONFIDENCE_WORDS[m[1].toLowerCase()] : undefined;
		if (!c) continue;
		if (best === null || CONFIDENCE_LEVELS.indexOf(c) < CONFIDENCE_LEVELS.indexOf(best)) best = c;
	}
	return best;
}

export function isConfidentError(e: Evaluation): boolean {
	return e.confidence === "sure" && e.points < e.max;
}

/** Short calibration summary, e.g. "sure 4/5 correct · unsure 1/3 correct". */
export function calibrationText(evaluations: Evaluation[]): string {
	const parts: string[] = [];
	for (const c of [...CONFIDENCE_LEVELS].reverse()) {
		const l = evaluations.filter((e) => e.confidence === c);
		if (!l.length) continue;
		parts.push(t().md.calibration(t().confidence[c], l.filter((e) => e.points >= e.max).length, l.length));
	}
	return parts.join(" · ");
}

function calloutType(points: number, max: number): string {
	if (points >= max) return "success";
	if (points > 0) return "warning";
	return "failure";
}

export function fmtPoints(x: number): string {
	return Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", t().cost.decimal);
}

/** Render the evaluated quiz (answers are kept). */
export function renderEvaluated(q: QuizData, answers: Answer[], r: Result, readinessLine = ""): string {
	const s = t().md;
	const topicsFm = r.topics.map((x) => `  - ${yamlString(`${x.topic}: ${x.percent} %`)}`);
	const errorsFm = Object.entries(r.errorTypes).map(([k, v]) => `  ${k}: ${v}`);
	const fm = [
		"---",
		`${PLUGIN_KEY}: quiz`,
		`id: ${q.id}`,
		`source: ${yamlString(wikiLink(q.source))}`,
		...(q.pages ? [`pages: ${yamlString(q.pages)}`] : []),
		`created: ${q.created}`,
		"status: evaluated",
		`evaluated: ${r.evaluated}`,
		`questions: ${q.questions.length}`,
		`score: ${r.percent}`,
		`points: ${yamlString(`${fmtPoints(r.points)} / ${r.max}`)}`,
		...(topicsFm.length ? ["topics:", ...topicsFm] : []),
		...(errorsFm.length ? ["error_types:", ...errorsFm] : []),
		"---",
	].join("\n");

	const errorList = Object.entries(r.errorTypes)
		.sort((a, b) => (b[1] as number) - (a[1] as number))
		.map(([k, v]) => `${t().errorType[k as ErrorType]} (${v})`)
		.join(", ");
	const topicList = [...r.topics]
		.sort((a, b) => a.percent - b.percent)
		.map((x) => `${x.topic} ${x.percent} %`)
		.join(" · ");

	const calib = calibrationText(r.evaluations);
	const confidentErrors = r.evaluations.filter(isConfidentError).length;
	const head = [
		`# ${s.quizTitle(q.title)}`,
		"",
		`> [!abstract] ${s.result(fmtPoints(r.points), r.max, r.percent)}`,
		`> **${s.topicsWeakest}:** ${topicList || "-"}`,
		`> **${s.errorTypes}:** ${errorList || s.none}`,
		...(calib ? [`> **${s.selfAssessment}:** ${calib}${confidentErrors ? ` · ${s.confidentWrongCount(confidentErrors)}` : ""}`] : []),
		...(readinessLine ? [`> **${readinessLine}**`] : []),
		...(r.summary ? [asCallout(`**${s.summary}:** ${r.summary}`)] : []),
	].join("\n");

	const byNr = new Map(r.evaluations.map((e) => [e.nr, e]));
	const answerByNr = new Map(answers.map((a) => [a.nr, a]));

	const questions = q.questions
		.map((f) => {
			const e = byNr.get(f.nr);
			const a = answerByNr.get(f.nr);
			const points = e ? e.points : 0;
			const max = e ? e.max : 0;
			const parts = [`${questionHeading(f)} — ${fmtPoints(points)}/${max}`, "", f.question.trim(), ""];
			if (f.type === "mc") {
				f.options.forEach((o, i) => {
					const x = a?.checked.includes(i) ? "x" : " ";
					const mark = i === f.correct ? " ✅" : a?.checked.includes(i) ? " ❌" : "";
					parts.push(`- [${x}] ${LETTERS[i]}) ${o.replace(/\n/g, " ")}${mark}`);
				});
			} else {
				parts.push(`**${s.yourAnswer}:**`, "", a?.text ? a.text : s.noAnswer);
			}
			if (e) {
				parts.push("");
				const errorName = e.errorType ? t().errorType[e.errorType] : "";
				const youWere = e.confidence ? ` · ${s.youWere(t().confidence[e.confidence])}` : "";
				const title =
					e.errorType === null
						? `[!${calloutType(points, max)}] ${s.correctTitle}${youWere}`
						: isConfidentError(e)
							? `[!${calloutType(points, max)}] ${fmtPoints(points)}/${max} · ${errorName} · ${s.sureButWrong}`
							: `[!${calloutType(points, max)}] ${fmtPoints(points)}/${max} · ${errorName}${youWere}`;
				const body: string[] = [];
				if (e.whatWasWrong) body.push(`**${s.whatWasWrong}:** ${e.whatWasWrong}`);
				if (e.correct) body.push(`**${s.correct}:** ${e.correct}`);
				if (e.reference) body.push(`**${s.reference}:** ${e.reference}`);
				if (e.followUp) body.push(`**${s.followUp}:** ${e.followUp}`);
				if (isConfidentError(e)) body.push(`*${s.hypercorrection}*`);
				parts.push(`> ${title}`);
				if (body.length) parts.push(asCallout(body.join("\n")));
			}
			return parts.join("\n");
		})
		.join("\n\n");

	const hasFollowUps = r.evaluations.some((e) => e.errorType && e.followUp);
	const followUps = hasFollowUps ? [`## ${s.followUpRound}`, "", s.followUpRoundText, "", BUTTON_FOLLOW_UP].join("\n") : "";
	const info = footer(q);
	return [fm, head, questions, ...(followUps ? [followUps] : []), ...(info ? [info] : []), dataBlock({ ...q, result: r, answers })].join("\n\n") + "\n";
}

/** Read a scalar frontmatter value (simple, scalar values only). */
export function frontmatterValue(md: string, key: string): string | null {
	const m = md.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return null;
	const line = m[1].split("\n").find((l) => l.startsWith(key + ":"));
	if (!line) return null;
	return line
		.slice(key.length + 1)
		.trim()
		.replace(/^"(.*)"$/, "$1");
}

/** True if the quiz note has already been evaluated (current or Skript-Check status). */
export function isEvaluatedNote(md: string): boolean {
	const s = frontmatterValue(md, "status");
	return s === "evaluated" || s === "ausgewertet";
}

/** Set a scalar frontmatter value (or remove it with null). Creates frontmatter if needed. */
export function setFrontmatterValue(md: string, key: string, value: string | null): string {
	const m = md.match(/^---\n([\s\S]*?)\n---/);
	const line = value === null ? null : `${key}: ${value}`;
	if (!m) return line ? `---\n${line}\n---\n${md}` : md;
	const lines = m[1].split("\n");
	const i = lines.findIndex((l) => l.startsWith(key + ":"));
	if (i >= 0) {
		if (line) lines[i] = line;
		else lines.splice(i, 1);
	} else if (line) lines.push(line);
	return `---\n${lines.join("\n")}\n---` + md.slice(m[0].length);
}
