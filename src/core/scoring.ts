// Points, topic scores and error types.
// Multiple choice is graded locally; open answers get their points from the AI.

import { t } from "../i18n";
import { legacyErrorType } from "./legacy";
import { Answer, ERROR_TYPES, ErrorType, Evaluation, POINTS_PER_DIFFICULTY, Question, Result, TopicScore } from "./types";

export function maxPoints(q: Question): number {
	return POINTS_PER_DIFFICULTY[q.difficulty] ?? 2;
}

export function mcCorrect(q: Question, a: Answer | undefined): boolean {
	return !!a && a.checked.length === 1 && a.checked[0] === q.correct;
}

export function isEmpty(q: Question, a: Answer | undefined): boolean {
	if (!a) return true;
	return q.type === "mc" ? a.checked.length === 0 : a.text.trim() === "";
}

/** Round to half points and clamp to [0, max]. */
export function clampPoints(p: unknown, max: number): number {
	const n = typeof p === "number" ? p : parseFloat(String(p));
	if (!isFinite(n)) return 0;
	return Math.min(max, Math.max(0, Math.round(n * 2) / 2));
}

/** Normalize whatever the AI returned to one of the error types. */
export function normalizeErrorType(x: unknown): ErrorType {
	const s = String(x ?? "").toLowerCase().trim();
	const exact = ERROR_TYPES.find((e) => e === s.replace(/[\s-]+/g, "_"));
	if (exact) return exact;
	const legacy = legacyErrorType(x);
	if (legacy) return legacy;
	if (s.includes("confus") || s.includes("verwechs") || s.includes("mix")) return "confusion";
	if (s.includes("calc") || s.includes("rechen") || s.includes("arithm")) return "calculation";
	if (s.includes("appl") || s.includes("anwend") || s.includes("transfer")) return "application";
	if (s.includes("incomplete") || s.includes("unvollst")) return "incomplete";
	if (s.includes("impreci") || s.includes("ungenau") || s === "none" || s === "keiner") return "imprecise";
	return "knowledge_gap";
}

/** Which questions the AI has to grade or analyze. */
export function questionsForAI(questions: Question[], answers: Answer[]): Question[] {
	const a = new Map(answers.map((x) => [x.nr, x]));
	return questions.filter((q) => {
		const an = a.get(q.nr);
		if (isEmpty(q, an)) return false; // empty: graded locally as a gap
		if (q.type === "mc") return !mcCorrect(q, an); // wrong MC: analyze the mistake
		return true; // open answers are always graded
	});
}

/** Raw grading from the AI for one question. */
export interface AIEvaluation {
	nr: number;
	points?: number;
	error_type?: string | null;
	what_was_wrong?: string;
	correct?: string;
	reference?: string;
	follow_up?: string;
}

export function computeResult(questions: Question[], answers: Answer[], ai: AIEvaluation[], summary: string, now: Date = new Date()): Result {
	const a = new Map(answers.map((x) => [x.nr, x]));
	const k = new Map(ai.map((x) => [Number(x.nr), x]));

	const raw: Evaluation[] = questions.map((q) => {
		const max = maxPoints(q);
		const an = a.get(q.nr);
		const kb = k.get(q.nr);
		const mcText = (i: number | null) => (i !== null && q.options[i] ? `${"ABCDEF"[i]}) ${q.options[i]}` : "");

		if (isEmpty(q, an)) {
			return {
				nr: q.nr,
				points: 0,
				max,
				errorType: "knowledge_gap",
				whatWasWrong: t().scoring.noAnswer,
				correct: q.type === "mc" ? `${mcText(q.correct)}. ${q.solution}` : q.solution,
				reference: q.reference,
				followUp: kb?.follow_up ?? "",
			};
		}

		if (q.type === "mc") {
			if (mcCorrect(q, an)) {
				return { nr: q.nr, points: max, max, errorType: null, whatWasWrong: "", correct: "", reference: "", followUp: "" };
			}
			const multiple = (an?.checked.length ?? 0) > 1;
			return {
				nr: q.nr,
				points: 0,
				max,
				errorType: multiple ? "imprecise" : normalizeErrorType(kb?.error_type),
				whatWasWrong: multiple ? t().scoring.multipleChecked : kb?.what_was_wrong || t().scoring.wrongOption,
				correct: kb?.correct || `${mcText(q.correct)}. ${q.solution}`,
				reference: kb?.reference || q.reference,
				followUp: kb?.follow_up ?? "",
			};
		}

		// open question
		const points = clampPoints(kb?.points ?? 0, max);
		const full = points >= max;
		return {
			nr: q.nr,
			points,
			max,
			errorType: full ? null : normalizeErrorType(kb?.error_type),
			whatWasWrong: full ? "" : (kb?.what_was_wrong ?? ""),
			correct: full ? "" : kb?.correct || q.solution,
			reference: full ? "" : kb?.reference || q.reference,
			followUp: full ? "" : (kb?.follow_up ?? ""),
		};
	});

	// Attach the self-rated confidence (never changes the points)
	const evaluations: Evaluation[] = raw.map((e) => {
		const c = a.get(e.nr)?.confidence;
		return c ? { ...e, confidence: c } : e;
	});

	const points = evaluations.reduce((s, e) => s + e.points, 0);
	const max = evaluations.reduce((s, e) => s + e.max, 0);

	const topicMap = new Map<string, { points: number; max: number }>();
	questions.forEach((q, i) => {
		const e = evaluations[i];
		const x = topicMap.get(q.topic) ?? { points: 0, max: 0 };
		x.points += e.points;
		x.max += e.max;
		topicMap.set(q.topic, x);
	});
	const topics: TopicScore[] = [...topicMap.entries()].map(([topic, v]) => ({
		topic,
		points: v.points,
		max: v.max,
		percent: v.max ? Math.round((v.points / v.max) * 100) : 0,
	}));

	const errorTypes: Partial<Record<ErrorType, number>> = {};
	for (const e of evaluations) if (e.errorType) errorTypes[e.errorType] = (errorTypes[e.errorType] ?? 0) + 1;

	return {
		evaluated: now.toISOString().slice(0, 16),
		points,
		max,
		percent: max ? Math.round((points / max) * 100) : 0,
		evaluations,
		topics,
		errorTypes,
		summary: summary || "",
	};
}
