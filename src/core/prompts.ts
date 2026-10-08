// Prompts and JSON schemas. Instructions are in English (models follow them best);
// the generated content is always in the language of the source material.

import { t } from "../i18n";
import { legacyDifficulty } from "./legacy";
import { Answer, DIFFICULTIES, Difficulty, ERROR_TYPES, Level, Question, QuestionTypes } from "./types";

export interface CreateOptions {
	count: number;
	focus: string;
	/** Review quiz built from earlier mistakes */
	review?: boolean;
	questionTypes?: QuestionTypes;
	level?: Level;
	/** A past exam is attached as style template */
	withStyleTemplate?: boolean;
	/** Source consists of several files of a folder */
	fromFolder?: boolean;
	/** Topic list of the subject: every question must use one of these names */
	topics?: string[];
}

const LANGUAGE_RULE =
	"Language: write the title, questions, options, solutions and topics in the SAME language as the source material (e.g. German source → German quiz). Never translate the subject matter.";

export const SYSTEM_CREATE = `You are a strict but fair university tutor (computer science / engineering). You write quizzes that check whether material is UNDERSTOOD – not whether it was memorized.

Rules for good questions:
- About half multiple choice (exactly 4 options, exactly one correct). Wrong options must reflect typical misconceptions, not obviously absurd answers.
- The rest open questions: explain, justify, compare, apply to a new example, small calculation or configuration tasks (if the material allows). Answerable in 1–4 sentences.
- Mix difficulty: about 30 % easy (core term), 45 % medium (relationships), 25 % hard (transfer/application).
- Cover the central topics. No questions about organization, slide titles, literature, authors or page numbers.
- Only content that appears in the source or follows directly from it.
- "topic" is a short, reusable subtopic (2–4 words), e.g. "802.1Q tagging", not the whole question. Use the same topic for related questions.
- "reference": where in the source this is covered. The source contains markers like [Page 12]; then name the page ("p. 12–14"), otherwise the section. With several files (=== File: path ===), start with the full file path, e.g. "Folder/Script.pdf, p. 12–14". Do not copy the === or [Page] markers themselves.
- ${LANGUAGE_RULE}`;

export function userPromptCreate(o: CreateOptions): string {
	const parts = [
		o.review
			? `Create a review quiz with exactly ${o.count} NEW questions. It is based on questions the student previously got wrong or incomplete (below, with the error analysis). Write new questions that test exactly these gaps and confusions – no verbatim repeats.`
			: `Create a quiz with exactly ${o.count} questions from the source.`,
	];
	if (o.questionTypes === "mc")
		parts.push(
			'Deviating from the default rule: ALL questions as multiple choice (type "mc", exactly 4 options, exactly one correct). Ask comprehension, transfer and calculation questions as MC too; the wrong options should reflect typical reasoning errors.',
		);
	if (o.questionTypes === "open")
		parts.push(
			'Deviating from the default rule: NO multiple-choice questions. ALL questions open (type "open", empty options, correct -1): explain, justify, compare, apply, calculate. No questions that only ask for a single word.',
		);
	if (o.level === "intro") parts.push("Level intro: about 60 % easy, 30 % medium, 10 % hard. Secure core terms and key relationships, no special cases.");
	if (o.level === "exam")
		parts.push(
			"Level exam: about 10 % easy, 40 % medium, 50 % hard. Transfer, application to new examples, calculation and reasoning tasks as they appear in a university exam.",
		);
	if (o.withStyleTemplate)
		parts.push(
			"A PAST EXAM is attached as STYLE TEMPLATE (marked). Adopt its task types, wording style, level and depth. The CONTENT of the questions comes exclusively from the source. Do not copy tasks from the past exam and never cite it as reference.",
		);
	if (o.fromFolder)
		parts.push(
			"The source consists of several files (marked with === File: … ===). Spread the questions sensibly over the most important topics of all files. Name the full file path and, if available, the page in reference.",
		);
	if (o.topics && o.topics.length)
		parts.push(`The subject has a topic list. Set "topic" of every question to EXACTLY one of these names (verbatim, the best fit): ${o.topics.map((x) => `"${x}"`).join(", ")}.`);
	if (o.focus.trim()) parts.push(`Focus: ${o.focus.trim()}`);
	parts.push("Answer in the given JSON format.");
	return parts.join("\n");
}

export const SCHEMA_CREATE = {
	name: "create_quiz",
	description: "Returns the finished quiz.",
	input_schema: {
		type: "object",
		properties: {
			title: { type: "string", description: "Short title of the material, e.g. 'VLANs and trunking'" },
			questions: {
				type: "array",
				items: {
					type: "object",
					properties: {
						type: { type: "string", enum: ["mc", "open"] },
						difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
						topic: { type: "string" },
						question: { type: "string" },
						options: { type: "array", items: { type: "string" }, description: "mc: exactly 4 options without A)/B) prefix. open: empty list." },
						correct: { type: "integer", description: "mc: index 0-3 of the correct option. open: -1." },
						solution: { type: "string", description: "Model answer or explanation of the correct option" },
						reference: { type: "string" },
					},
					required: ["type", "difficulty", "topic", "question", "solution", "reference"],
				},
			},
		},
		required: ["title", "questions"],
	},
};

/** Schema for creating; with a topic list "topic" is restricted to its names. */
export function schemaCreate(topics?: string[]): typeof SCHEMA_CREATE {
	if (!topics || !topics.length) return SCHEMA_CREATE;
	const s = JSON.parse(JSON.stringify(SCHEMA_CREATE));
	s.input_schema.properties.questions.items.properties.topic = { type: "string", enum: [...new Set(topics)] };
	return s;
}

/** Turn raw AI output into clean questions. Throws on unusable output. */
export function normalizeQuestions(raw: any, questionTypes: QuestionTypes = "mixed", fallbackTopic = "General"): { title: string; questions: Question[] } {
	const list = raw?.questions ?? raw?.fragen;
	if (!raw || !Array.isArray(list)) throw new Error(t().errors.noQuestions);
	const questions: Question[] = [];
	for (const f of list) {
		const text = f?.question ?? f?.frage;
		if (!f || typeof text !== "string" || !text.trim()) continue;
		const rawOptions = f.options ?? f.optionen;
		let options: string[] = Array.isArray(rawOptions)
			? rawOptions.map((o: unknown) => String(o).replace(/^\s*[A-Fa-f][).:]\s+/, "").trim()).filter(Boolean)
			: [];
		let type: "mc" | "open" = String(f.type ?? f.typ).toLowerCase() === "mc" ? "mc" : "open";
		let correct: number | null = null;
		if (type === "mc") {
			const r = Number(f.correct ?? f.richtig);
			options = options.slice(0, 6); // A–F; cut first so the correct index is checked against what is shown
			if (options.length >= 2 && Number.isInteger(r) && r >= 0 && r < options.length) {
				correct = r;
			} else {
				type = "open"; // unusable MC: ask it as an open question instead
				options = [];
			}
		} else {
			options = [];
		}
		let solution = String(f.solution ?? f.loesung ?? "").trim();
		if (type === "mc" && questionTypes === "open") {
			// AI returned MC despite the instruction: ask it open, correct option goes into the model answer
			solution = `${options[correct as number]}${solution ? ". " + solution : ""}`;
			type = "open";
			options = [];
			correct = null;
		}
		const d = String(f.difficulty ?? f.schwierigkeit ?? "").toLowerCase();
		const difficulty: Difficulty = (DIFFICULTIES as string[]).includes(d) ? (d as Difficulty) : (legacyDifficulty(d) ?? "medium");
		questions.push({
			nr: questions.length + 1,
			type,
			difficulty,
			topic: String(f.topic ?? f.thema ?? "").trim().slice(0, 60) || fallbackTopic,
			question: text.trim(),
			options,
			correct,
			solution,
			reference: String(f.reference ?? f.fundstelle ?? "").trim(),
		});
	}
	if (questions.length === 0) throw new Error(t().errors.noUsableQuestions);
	return { title: String(raw.title ?? raw.titel ?? "Quiz").trim().slice(0, 80) || "Quiz", questions };
}

// ---------------------------------------------------------------- Evaluation

export const SYSTEM_EVALUATE = `You grade a student's answers in a comprehension quiz and write a precise error analysis. Be strict but fair: understanding counts, not exact wording. In "what_was_wrong", refer concretely to what the student wrote or checked – not in general terms.

Error types (exactly one per flawed answer):
- knowledge_gap: content not known.
- confusion: two concepts swapped or mixed up (name both).
- incomplete: core correct, important parts missing.
- application: concept known but applied wrongly to the situation.
- calculation: approach correct, calculation wrong.
- imprecise: correct in principle but vague or technically sloppy.

For every question:
- points: 0 to max in steps of 0.5 (ignored for multiple choice, only the analysis counts there).
- error_type: "none" for full marks, otherwise one of the types.
- what_was_wrong: 1–2 sentences, concrete.
- correct: the correct reasoning in 1–3 sentences.
- reference: copy from the question.
- follow_up: a short follow-up question that lets the student close the gap right away (without the answer).

Finally "summary": 2–3 sentences about the pattern behind the mistakes (do not repeat the score) and what to do next, concretely.
Language: write all feedback in the SAME language as the questions. Answer in the given JSON format.`;

export interface AIEvaluationItem {
	nr: number;
	type: string;
	difficulty: string;
	max: number;
	topic: string;
	question: string;
	options?: string[];
	correct_option?: string;
	model_answer: string;
	reference: string;
	student_answer: string;
}

export function evaluationItems(questions: Question[], answers: Answer[], maxOf: (q: Question) => number): AIEvaluationItem[] {
	const a = new Map(answers.map((x) => [x.nr, x]));
	const L = "ABCDEF";
	return questions.map((q) => {
		const an = a.get(q.nr);
		const item: AIEvaluationItem = {
			nr: q.nr,
			type: q.type,
			difficulty: q.difficulty,
			max: maxOf(q),
			topic: q.topic,
			question: q.question,
			model_answer: q.solution,
			reference: q.reference,
			student_answer: "",
		};
		if (q.type === "mc") {
			item.options = q.options.map((o, i) => `${L[i]}) ${o}`);
			item.correct_option = q.correct !== null ? `${L[q.correct]}) ${q.options[q.correct]}` : "";
			item.student_answer = (an?.checked ?? []).map((i) => `${L[i]}) ${q.options[i] ?? "?"}`).join(" + ");
		} else {
			item.student_answer = an?.text ?? "";
		}
		return item;
	});
}

export function userPromptEvaluate(title: string, items: AIEvaluationItem[]): string {
	return `Quiz: "${title}"\n\nQuestions to grade with the student's answers:\n${JSON.stringify(items, null, 1)}`;
}

export const SCHEMA_EVALUATE = {
	name: "evaluate_quiz",
	description: "Returns the grading.",
	input_schema: {
		type: "object",
		properties: {
			evaluations: {
				type: "array",
				items: {
					type: "object",
					properties: {
						nr: { type: "integer" },
						points: { type: "number" },
						error_type: { type: "string", enum: [...ERROR_TYPES, "none"], description: "'none' for full marks" },
						what_was_wrong: { type: "string" },
						correct: { type: "string" },
						reference: { type: "string" },
						follow_up: { type: "string" },
					},
					required: ["nr", "points", "error_type", "what_was_wrong", "correct", "follow_up"],
				},
			},
			summary: { type: "string" },
		},
		required: ["evaluations", "summary"],
	},
};

// ---------------------------------------------------------------- Error patterns

export const SYSTEM_PATTERNS = `You analyze a student's mistakes across several quizzes in one subject. Find recurring patterns: which concepts they regularly confuse, which error types dominate, which topics stay weak despite repetition. Be concrete and cite examples from the data. No motivational filler. Write in the same language as the quiz data. Answer in the given JSON format.`;

export const SCHEMA_PATTERNS = {
	name: "patterns",
	description: "Returns the error patterns.",
	input_schema: {
		type: "object",
		properties: {
			patterns: {
				type: "array",
				items: {
					type: "object",
					properties: {
						title: { type: "string", description: "e.g. 'Access vs. trunk port confused'" },
						description: { type: "string", description: "1–2 sentences with evidence from the data" },
					},
					required: ["title", "description"],
				},
			},
			recommendation: { type: "string", description: "2–3 concrete next steps" },
		},
		required: ["patterns", "recommendation"],
	},
};

// ---------------------------------------------------------------- Topic list

export const SYSTEM_TOPICS = `You build a topic list for exam preparation from university course material.

Rules:
- A topic is a testable block of content that could be asked in an exam task (e.g. "Subnetting", "Spanning Tree Protocol", "TCP handshake"). Not too fine (no single term), not too coarse (no whole chapter "Networks").
- Depending on the scope, 6–25 topics. No organization, literature, introduction or recap slides.
- "name": 1–5 words, technical terms as in the source.
- "weight": "high" = central, lots of space in the material or explicitly marked as important/exam-relevant; "medium" = regular material; "low" = side topic, excursion, example.
- "reference": full file path (from === File: path ===) and page or section, e.g. "Folder/Script.pdf, p. 12–14" or "Folder/Note.md (section Interfaces)". Several places separated by "; ", each with its full path. Do not copy the === or [Page] markers themselves.
- "also": names from PREVIOUS QUIZ TOPICS (if given) that belong to this topic in content – copy them verbatim. Otherwise an empty list.
- Language: topic names in the SAME language as the source material. Answer in the given JSON format.`;

export function userPromptTopics(o: { subject: string; oldTopics: string[]; existing?: string[]; part?: { nr: number; of: number } }): string {
	const z: string[] = [`Subject: ${o.subject}`];
	if (o.part && o.part.of > 1) z.push(`This is part ${o.part.nr} of ${o.part.of} of the material. Only list topics from this part.`);
	if (o.existing && o.existing.length)
		z.push(
			`A topic list already exists: ${o.existing.map((x) => `"${x}"`).join(", ")}.\nThe material above is NEW. Only return topics that are still missing from the existing list. If content belongs to an existing topic, return that topic with exactly its name (then only the entries in "also" count).`,
		);
	z.push(o.oldTopics.length ? `PREVIOUS QUIZ TOPICS: ${o.oldTopics.map((x) => `"${x}"`).join(", ")}` : "PREVIOUS QUIZ TOPICS: (none)");
	z.push("Create the topic list.");
	return z.join("\n\n");
}

export const SYSTEM_TOPICS_MERGE = `You receive several partial topic lists from different sections of the same course. Merge them into ONE topic list:
- Combine duplicate or nearly identical topics (combine references, unite "also" entries).
- Result 8–30 topics, same rules for size and weight as the partial lists. On conflicts take the higher weight if the topic appears in several parts.
- Keep the language of the partial lists. Answer in the given JSON format.`;

export const SCHEMA_TOPICS = {
	name: "topic_list",
	description: "Returns the topic list.",
	input_schema: {
		type: "object",
		properties: {
			topics: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						weight: { type: "string", enum: ["high", "medium", "low"] },
						reference: { type: "string" },
						also: { type: "array", items: { type: "string" } },
					},
					required: ["name", "weight", "reference", "also"],
				},
			},
		},
		required: ["topics"],
	},
};
