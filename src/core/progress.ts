// Progress note per subject folder: summary of all evaluated quizzes plus exam readiness.

import { t } from "../i18n";
import { BLOCK_READINESS, BUTTON_REVIEW, PLUGIN_KEY } from "./quiz-markdown";
import { SubjectReadiness, bar, readinessStatic, topicTable } from "./readiness";
import { ErrorType, QuizData } from "./types";

export interface ProgressData {
	quizzes: { title: string; file: string; date: string; percent: number; points: number; max: number }[];
	topics: { topic: string; points: number; max: number; percent: number; quizzes: number }[];
	errorTypes: [ErrorType, number][];
	overallPercent: number;
	mistakes: Mistake[];
}

export interface Mistake {
	quizId: string;
	date: string;
	topic: string;
	question: string;
	errorType: ErrorType;
	whatWasWrong: string;
	correct: string;
	points: number;
	max: number;
	/** Was rated "sure" */
	sure?: boolean;
}

export interface Pattern {
	title: string;
	description: string;
}

/** `files` maps quiz id -> note path (for links). */
export function aggregate(quizzes: QuizData[], files: Map<string, string>): ProgressData {
	const evaluated = quizzes.filter((q) => q.result).sort((a, b) => a.created.localeCompare(b.created));

	const topics = new Map<string, { points: number; max: number; quizzes: Set<string> }>();
	const errorTypes = new Map<ErrorType, number>();
	const mistakes: Mistake[] = [];
	let sumP = 0;
	let sumM = 0;

	for (const q of evaluated) {
		const r = q.result!;
		sumP += r.points;
		sumM += r.max;
		for (const e of r.evaluations) {
			const question = q.questions.find((x) => x.nr === e.nr);
			if (!question) continue;
			const x = topics.get(question.topic) ?? { points: 0, max: 0, quizzes: new Set<string>() };
			x.points += e.points;
			x.max += e.max;
			x.quizzes.add(q.id);
			topics.set(question.topic, x);
			if (e.errorType) {
				errorTypes.set(e.errorType, (errorTypes.get(e.errorType) ?? 0) + 1);
				mistakes.push({
					quizId: q.id,
					date: r.evaluated.slice(0, 10),
					topic: question.topic,
					question: question.question,
					errorType: e.errorType,
					whatWasWrong: e.whatWasWrong,
					correct: e.correct || question.solution,
					points: e.points,
					max: e.max,
					...(e.confidence === "sure" ? { sure: true } : {}),
				});
			}
		}
	}

	return {
		quizzes: evaluated.map((q) => ({
			title: q.title,
			file: files.get(q.id) ?? "",
			date: q.result!.evaluated.slice(0, 10),
			percent: q.result!.percent,
			points: q.result!.points,
			max: q.result!.max,
		})),
		topics: [...topics.entries()]
			.map(([topic, v]) => ({
				topic,
				points: v.points,
				max: v.max,
				percent: v.max ? Math.round((v.points / v.max) * 100) : 0,
				quizzes: v.quizzes.size,
			}))
			.sort((a, b) => a.percent - b.percent || b.max - a.max),
		errorTypes: [...errorTypes.entries()].sort((a, b) => b[1] - a[1]),
		overallPercent: sumM ? Math.round((sumP / sumM) * 100) : 0,
		mistakes,
	};
}

function cell(s: string): string {
	return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export interface ProgressExtras {
	readiness?: SubjectReadiness | null;
	/** Exam date YYYY-MM-DD, kept across re-renders */
	exam?: string | null;
	/** Readiness cap in % (for the text) */
	cap?: number;
}

export function renderProgress(
	subject: string,
	d: ProgressData,
	patterns: Pattern[] | null,
	recommendation: string,
	now: Date = new Date(),
	extra: ProgressExtras = {},
): string {
	const s = t().progress;
	const r = extra.readiness ?? null;
	const date = now.toISOString().slice(0, 10);
	const z: string[] = [
		"---",
		`${PLUGIN_KEY}: progress`,
		`updated: ${now.toISOString().slice(0, 16)}`,
		...(extra.exam ? [`exam: ${extra.exam}`] : []),
		...(r ? [`readiness: ${r.percent}`] : []),
		`score: ${d.overallPercent}`,
		`quizzes: ${d.quizzes.length}`,
		"---",
		"",
		`# ${s.title(subject)}`,
		"",
	];

	if (r) z.push(`## ${s.readinessHeading}`, "", BLOCK_READINESS, "", readinessStatic(subject, r, date, extra.cap ?? 80), "");
	z.push(`> [!abstract] ${s.overall(d.overallPercent, d.quizzes.length)}`, "");

	if (patterns && patterns.length) {
		z.push(`## ${s.patterns}`, "");
		for (const m of patterns) z.push(`- **${m.title}:** ${m.description}`);
		z.push("");
		if (recommendation) z.push(`> [!tip] ${s.nextSteps}`, ...recommendation.split("\n").map((x) => "> " + x), "");
	}

	if (r && r.topics.length) {
		z.push(`## ${s.topicsAsOf(date)}`, "", s.topicsExplainer, "", ...topicTable(r, now), "");
	} else {
		const h = s.topicHeaders;
		z.push(`## ${s.topicsWeakest}`, "", `| ${h.join(" | ")} |`, "|---|---|---|---|---|");
		for (const x of d.topics) z.push(`| ${cell(x.topic)} | ${x.percent} % | \`${bar(x.percent)}\` | ${x.points}/${x.max} | ${x.quizzes} |`);
		z.push("");
	}

	if (r && r.calibration.levels.length) {
		const h = s.calibrationHeaders;
		z.push(`## ${s.selfAssessment}`, "", `| ${h.join(" | ")} |`, "|---|---|---|");
		for (const k of r.calibration.levels) z.push(`| ${t().confidence[k.level]} | ${k.count} | ${Math.round((k.correct / k.count) * 100)} % |`);
		z.push("", s.calibrationExplainer, "");
	}

	if (d.errorTypes.length) {
		z.push(`## ${s.errorTypes}`, "", `| ${s.errorTypeHeaders.join(" | ")} |`, "|---|---|");
		for (const [type, n] of d.errorTypes) z.push(`| ${t().errorType[type]} | ${n} |`);
		z.push("");
	}

	z.push(`## ${s.history}`, "", `| ${s.historyHeaders.join(" | ")} |`, "|---|---|---|");
	for (const x of [...d.quizzes].reverse()) {
		const link = x.file ? `[[${x.file}\\|${cell(x.title)}]]` : cell(x.title);
		z.push(`| ${x.date} | ${link} | ${x.percent} % |`);
	}
	z.push("", `## ${s.reviewHeading}`, "", s.reviewText, "", BUTTON_REVIEW, "");
	return z.join("\n");
}

/** Read the error patterns of an existing progress note (English or German headings). */
export function readPatterns(md: string): { patterns: Pattern[]; recommendation: string } | null {
	const m = md.match(/## (?:Error patterns|Fehlermuster)\n\n([\s\S]*?)\n\n(?:> \[!tip\][^\n]*\n((?:> [^\n]*\n?)*))?/);
	if (!m) return null;
	const patterns = m[1]
		.split("\n")
		.map((z) => z.match(/^- \*\*(.+?):\*\* (.*)$/))
		.filter((x): x is RegExpMatchArray => !!x)
		.map((x) => ({ title: x[1], description: x[2] }));
	const recommendation = (m[2] ?? "")
		.split("\n")
		.map((z) => z.replace(/^> ?/, ""))
		.join("\n")
		.trim();
	return { patterns, recommendation };
}

/** Material for the review quiz: recent mistakes, confident errors first, then weakest topics. Sent to the AI in English. */
export function reviewMaterial(d: ProgressData, maxEntries = 25): string {
	const rank = new Map(d.topics.map((x, i) => [x.topic, i]));
	const picked = [...d.mistakes]
		.sort((a, b) => Number(!!b.sure) - Number(!!a.sure) || (rank.get(a.topic) ?? 99) - (rank.get(b.topic) ?? 99) || b.date.localeCompare(a.date))
		.slice(0, maxEntries);
	return picked
		.map(
			(f, i) =>
				`### Mistake ${i + 1} · ${f.topic} · ${f.errorType}${f.sure ? " · student was SURE (misconception, test again)" : ""}\nQuestion: ${f.question}\nWhat was wrong: ${f.whatWasWrong}\nCorrect: ${f.correct}`,
		)
		.join("\n\n");
}
