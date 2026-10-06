// Exam readiness per subject: coverage × mastery × recall (FSRS).
// FSRS only ever sees quiz results (score per topic) – never the self-rated confidence.
// Pure computation without Obsidian or AI, fully unit-testable.

import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";
import { t } from "../i18n";
import { CONFIDENCE_LEVELS, Confidence, Level, QuizData } from "./types";

export interface TopicDef {
	name: string;
	/** high = 3, medium = 2, low = 1 */
	weight: number;
	reference?: string;
}

export interface FileDef {
	path: string;
	weight: number;
}

export interface ReadinessOptions {
	now: Date;
	/** Target retention (FSRS request_retention), e.g. 0.9 */
	target: number;
	/** Cap in %, as long as no exam-level quiz exists */
	cap: number;
	exam?: Date | null;
	/** Topic list of the subject; without it coverage is counted by files */
	topics?: TopicDef[] | null;
	/** Map of old topic names -> topic list name */
	aliases?: Record<string, string>;
	/** Source files of the subject (for coverage without a topic list) */
	files?: FileDef[];
}

export interface TopicReadiness {
	name: string;
	weight: number;
	tested: boolean;
	/** Recency-weighted score of the last sessions, 0..1 */
	mastery: number;
	/** FSRS retrievability today, 0..1 */
	recall: number;
	/** FSRS retrievability on exam day (without further review) */
	recallAtExam: number | null;
	/** Strength of evidence 0..1 (how many points back it up) */
	evidence: number;
	readiness: number;
	readinessAtExam: number | null;
	due: boolean;
	/** When recall drops below the target according to FSRS */
	dueOn: Date | null;
	last: Date | null;
	confidentErrors: number;
	sessions: number;
}

export type LeverReason =
	| { kind: "untested" }
	| { kind: "confident"; n: number }
	| { kind: "weak"; percent: number }
	| { kind: "due"; days: number }
	| { kind: "evidence" };

export interface Lever {
	topic: string;
	weight: number;
	reason: LeverReason;
	/** Contribution to the points gap, for sorting */
	potential: number;
}

export interface Calibration {
	levels: { level: Confidence; count: number; correct: number }[];
	/** Share of answers rated "sure" that were wrong or incomplete */
	confidentErrorRate: number | null;
}

export interface SubjectReadiness {
	mode: "topics" | "files";
	percent: number;
	percentAtExam: number | null;
	coverage: number;
	mastery: number;
	freshness: "good" | "medium" | "stale" | "none";
	capped: boolean;
	daysToExam: number | null;
	topics: TopicReadiness[];
	levers: Lever[];
	calibration: Calibration;
	evaluatedQuizzes: number;
}

const LEVEL_FACTOR: Record<Level, number> = { intro: 0.85, normal: 1, exam: 1.1 };
const FULL_EVIDENCE = 6; // from this many points of evidence a topic counts as reliably assessed
const DAY_MS = 86_400_000;

/** Parse plugin timestamps ("2026-10-05T18:30" in UTC, or a plain date) robustly. */
export function timestamp(s: string): Date {
	if (/Z$|[+-]\d\d:\d\d$/.test(s)) return new Date(s);
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00Z");
	return new Date(s + (s.length === 16 ? ":00Z" : "Z"));
}

/** Session score -> FSRS rating. The quiz level shifts the thresholds slightly. */
export function ratingFor(share: number, level: Level = "normal"): Grade {
	const x = Math.min(1, share * LEVEL_FACTOR[level]);
	if (x < 0.4) return Rating.Again;
	if (x < 0.7) return Rating.Hard;
	if (x < 0.9) return Rating.Good;
	return Rating.Easy;
}

function normName(s: string): string {
	return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function levelOf(q: QuizData): Level {
	return q.styleTemplate ? "exam" : (q.level ?? "normal");
}

interface Session {
	date: Date;
	points: number;
	max: number;
	level: Level;
	confidentErrors: number;
}

/** Group the question results of all quizzes per topic into sessions (one per quiz). */
function collectSessions(quizzes: QuizData[], topicOf: (raw: string) => string | null): Map<string, Session[]> {
	const byTopic = new Map<string, Session[]>();
	for (const q of quizzes) {
		const r = q.result;
		if (!r) continue;
		const date = timestamp(r.evaluated);
		const level = levelOf(q);
		const local = new Map<string, Session>();
		for (const e of r.evaluations) {
			const question = q.questions.find((x) => x.nr === e.nr);
			if (!question) continue;
			const topic = topicOf(question.topic);
			if (!topic) continue;
			const s = local.get(topic) ?? { date, points: 0, max: 0, level, confidentErrors: 0 };
			s.points += e.points;
			s.max += e.max;
			if (e.confidence === "sure" && e.points < e.max) s.confidentErrors++;
			local.set(topic, s);
		}
		for (const [topic, s] of local) {
			const list = byTopic.get(topic) ?? [];
			list.push(s);
			byTopic.set(topic, list);
		}
	}
	for (const l of byTopic.values()) l.sort((a, b) => a.date.getTime() - b.date.getTime());
	return byTopic;
}

function evaluateTopic(name: string, weight: number, sessions: Session[], o: ReadinessOptions): TopicReadiness {
	if (!sessions.length) {
		return {
			name,
			weight,
			tested: false,
			mastery: 0,
			recall: 0,
			recallAtExam: null,
			evidence: 0,
			readiness: 0,
			readinessAtExam: o.exam ? 0 : null,
			due: false,
			dueOn: null,
			last: null,
			confidentErrors: 0,
			sessions: 0,
		};
	}
	const f = fsrs(generatorParameters({ request_retention: o.target, enable_fuzz: false, enable_short_term: false }));
	let card: Card = createEmptyCard(sessions[0].date);
	for (const s of sessions) card = f.next(card, s.date, ratingFor(s.max ? s.points / s.max : 0, s.level)).card;
	const last = sessions[sessions.length - 1].date;
	const recallAt = (d: Date) => (d.getTime() <= last.getTime() ? 1 : f.get_retrievability(card, d, false));
	const recall = recallAt(o.now);
	const recallAtExam = o.exam ? recallAt(o.exam > o.now ? o.exam : o.now) : null;

	// Mastery: last three sessions, newest counts most (3/2/1), weighted by points
	const lastThree = sessions.slice(-3).reverse();
	let num = 0;
	let den = 0;
	lastThree.forEach((s, i) => {
		const g = (3 - i) * s.max;
		num += g * (s.max ? s.points / s.max : 0);
		den += g;
	});
	const mastery = den ? num / den : 0;
	const evidence = Math.min(1, sessions.reduce((a, s) => a + s.max, 0) / FULL_EVIDENCE);
	const confidentErrors = sessions.slice(-3).reduce((a, s) => a + s.confidentErrors, 0);

	return {
		name,
		weight,
		tested: true,
		mastery,
		recall,
		recallAtExam,
		evidence,
		readiness: mastery * recall * evidence,
		readinessAtExam: recallAtExam === null ? null : mastery * recallAtExam * evidence,
		due: recall < o.target,
		dueOn: card.due,
		last,
		confidentErrors,
		sessions: sessions.length,
	};
}

function calibration(quizzes: QuizData[]): Calibration {
	const z = new Map<Confidence, { count: number; correct: number }>();
	for (const q of quizzes)
		for (const e of q.result?.evaluations ?? []) {
			if (!e.confidence) continue;
			const s = z.get(e.confidence) ?? { count: 0, correct: 0 };
			s.count++;
			if (e.points >= e.max) s.correct++;
			z.set(e.confidence, s);
		}
	const levels = [...CONFIDENCE_LEVELS]
		.reverse()
		.filter((c) => z.has(c))
		.map((c) => ({ level: c, ...z.get(c)! }));
	const sure = z.get("sure");
	return { levels, confidentErrorRate: sure && sure.count ? (sure.count - sure.correct) / sure.count : null };
}

export function computeReadiness(quizzes: QuizData[], o: ReadinessOptions): SubjectReadiness {
	const evaluated = quizzes.filter((q) => q.result);
	const withList = !!(o.topics && o.topics.length);

	let topicOf: (raw: string) => string | null;
	let defs: TopicDef[];
	if (withList) {
		defs = o.topics!;
		const byNorm = new Map(defs.map((d) => [normName(d.name), d.name]));
		const aliases = new Map(Object.entries(o.aliases ?? {}).map(([k, v]) => [normName(k), v]));
		topicOf = (raw) => {
			const n = normName(raw);
			const direct = byNorm.get(n) ?? aliases.get(n);
			if (direct) return byNorm.get(normName(direct)) ?? null;
			// lenient: does one name contain the other?
			for (const [k, v] of byNorm) if (k && n && (k.includes(n) || n.includes(k))) return v;
			return null;
		};
	} else {
		topicOf = (raw) => raw.trim() || t().defaultTopic;
		const names = new Set<string>();
		for (const q of evaluated) for (const x of q.questions) names.add(topicOf(x.topic)!);
		defs = [...names].map((n) => ({ name: n, weight: 2 }));
	}

	const sessions = collectSessions(evaluated, topicOf);
	const topics = defs.map((d) => evaluateTopic(d.name, d.weight, sessions.get(d.name) ?? [], o));

	const sumW = topics.reduce((a, x) => a + x.weight, 0);
	const tested = topics.filter((x) => x.tested);
	const sumWT = tested.reduce((a, x) => a + x.weight, 0);
	const mean = (f: (x: TopicReadiness) => number, list: TopicReadiness[], den: number) => (den ? list.reduce((a, x) => a + x.weight * f(x), 0) / den : 0);

	let coverage: number;
	let readiness: number;
	let atExam: number | null = null;
	if (withList) {
		coverage = sumW ? sumWT / sumW : 0;
		readiness = mean((x) => x.readiness, topics, sumW);
		if (o.exam) atExam = mean((x) => x.readinessAtExam ?? 0, topics, sumW);
	} else {
		// Coverage by source files: a file counts once it was the source of an evaluated quiz
		const files = o.files ?? [];
		const sources = new Set(evaluated.map((q) => q.source));
		const total = files.reduce((a, d) => a + d.weight, 0);
		const covered = files.filter((d) => sources.has(d.path) || [...sources].some((s) => s && d.path.startsWith(s + "/"))).reduce((a, d) => a + d.weight, 0);
		coverage = total ? covered / total : tested.length ? 1 : 0;
		readiness = mean((x) => x.readiness, tested, sumWT) * coverage;
		if (o.exam) atExam = mean((x) => x.readinessAtExam ?? 0, tested, sumWT) * coverage;
	}

	const hasExamLevel = evaluated.some((q) => levelOf(q) === "exam");
	const cap = hasExamLevel ? 1 : o.cap / 100;
	const capped = !hasExamLevel && readiness > cap;
	const percent = Math.round(Math.min(readiness, cap) * 100);
	const percentAtExam = atExam === null ? null : Math.round(Math.min(atExam, cap) * 100);

	const recallMean = tested.length ? tested.reduce((a, x) => a + x.recall, 0) / tested.length : null;
	const freshness = recallMean === null ? "none" : recallMean >= 0.85 ? "good" : recallMean >= 0.7 ? "medium" : "stale";

	const levers: Lever[] = topics
		.map((x) => {
			let reason: LeverReason | null;
			if (!x.tested) reason = { kind: "untested" };
			else if (x.confidentErrors > 0) reason = { kind: "confident", n: x.confidentErrors };
			else if (x.mastery < 0.6) reason = { kind: "weak", percent: Math.round(x.mastery * 100) };
			else if (x.due) reason = { kind: "due", days: Math.round((o.now.getTime() - (x.last?.getTime() ?? 0)) / DAY_MS) };
			else if (x.evidence < 1) reason = { kind: "evidence" };
			else reason = null;
			return { topic: x.name, weight: x.weight, reason, potential: x.weight * (1 - x.readiness) + (x.confidentErrors ? 0.5 : 0) };
		})
		.filter((h): h is Lever => !!h.reason && h.potential > 0.05)
		.sort((a, b) => b.potential - a.potential)
		.slice(0, 3);

	return {
		mode: withList ? "topics" : "files",
		percent,
		percentAtExam,
		coverage,
		mastery: mean((x) => x.mastery, tested, sumWT),
		freshness,
		capped,
		daysToExam: o.exam ? Math.ceil((o.exam.getTime() - o.now.getTime()) / DAY_MS) : null,
		topics,
		levers,
		calibration: calibration(evaluated),
		evaluatedQuizzes: evaluated.length,
	};
}

// ------------------------------------------------------------------ Text output

export function bar(percent: number, width = 10): string {
	const full = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
	return "█".repeat(full) + "░".repeat(width - full);
}

export function weightName(w: number): string {
	return w >= 3 ? t().weight.high : w <= 1 ? t().weight.low : t().weight.medium;
}

export function leverReasonText(r: LeverReason): string {
	const s = t().readiness.reasons;
	switch (r.kind) {
		case "untested":
			return s.untested;
		case "confident":
			return s.confident(r.n);
		case "weak":
			return s.weak(r.percent);
		case "due":
			return s.due(r.days);
		case "evidence":
			return s.evidence;
	}
}

/** Text version (works without the plugin, e.g. on a phone). */
export function readinessText(subject: string, r: SubjectReadiness, cap: number): string[] {
	const s = t().readiness;
	const z: string[] = [];
	z.push(`${s.title(subject)}   ${bar(r.percent)}  ${r.percent} %`);
	z.push(s.breakdown(Math.round(r.coverage * 100), r.mode === "files", Math.round(r.mastery * 100), s.freshness[r.freshness]));
	if (r.daysToExam !== null) {
		if (r.daysToExam < 0) z.push(s.examPast);
		else z.push(r.percentAtExam !== null && r.daysToExam > 0 ? `${s.examIn(r.daysToExam)} · ${s.forecast(r.percentAtExam)}` : s.examIn(r.daysToExam));
	}
	if (r.capped) z.push(s.capped(cap));
	const q = r.calibration.confidentErrorRate;
	if (q !== null && q > 0.25) z.push(s.overconfidence(Math.round(q * 100)));
	if (r.levers.length) {
		z.push("", `${s.levers}:`);
		r.levers.forEach((h, i) => z.push(`${i + 1}. ${h.topic} – ${leverReasonText(h.reason)}${r.mode === "topics" ? ` (${weightName(h.weight)})` : ""}`));
	}
	return z;
}

function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Static version for the note. The plugin hides it and shows the live view instead. */
export function readinessStatic(subject: string, r: SubjectReadiness, asOf: string, cap: number): string {
	const lines = readinessText(subject, r, cap).filter((z) => z !== "");
	return `<div class="lacuna-static">${lines.map(esc).join("<br>")}<br><small>${esc(t().readiness.staticNote(asOf))}</small></div>`;
}

/** Table per topic for the progress note. */
export function topicTable(r: SubjectReadiness, now: Date): string[] {
	const s = t().readiness.table;
	const withWeight = r.mode === "topics";
	const head = withWeight ? [s.topic, s.weight, s.mastery, s.recall, s.next] : [s.topic, s.mastery, s.recall, s.next];
	const sorted = [...r.topics].sort((a, b) => Number(a.tested) - Number(b.tested) || a.readiness - b.readiness || b.weight - a.weight);
	const rows = sorted.map((x) => {
		const name = x.name.replace(/\|/g, "/") + (x.confidentErrors ? " ⚠️" : "");
		const w = weightName(x.weight);
		if (!x.tested) return withWeight ? `| ${name} | ${w} | – | – | ${s.notTested} |` : `| ${name} | – | – | – |`;
		const when = !x.dueOn ? "–" : x.due || x.dueOn.getTime() <= now.getTime() ? `**${s.dueNow}**` : x.dueOn.toISOString().slice(0, 10);
		const cells = [name, ...(withWeight ? [w] : []), `${Math.round(x.mastery * 100)} %`, `${Math.round(x.recall * 100)} %`, when];
		return `| ${cells.join(" | ")} |`;
	});
	return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows];
}

/** Short line below an evaluated quiz. */
export function readinessLine(subject: string, before: number | null, after: number): string {
	return t().readiness.line(subject, after, before === null ? null : after - before);
}
