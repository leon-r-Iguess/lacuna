import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../src/i18n";
import { evaluationItems, normalizeQuestions } from "../src/core/prompts";
import { clampPoints, computeResult, maxPoints, normalizeErrorType, questionsForAI } from "../src/core/scoring";
import { frontmatterValue, parseAnswers, renderEvaluated, renderQuiz } from "../src/core/quiz-markdown";
import { aggregate, renderProgress, reviewMaterial } from "../src/core/progress";
import { imageEmbeds, pageRangeText, parsePageRange, safeFileName } from "../src/core/util";
import { QuizData } from "../src/core/types";
import { parseLoose, strictSchema } from "../src/core/json";

beforeEach(() => setLang("en"));

describe("json", () => {
	it("parseLoose repairs missing commas and fences", () => {
		expect(parseLoose('```json\n{"a":[{"x":1}\n {"x":2},]}\n```')).toEqual({ a: [{ x: 1 }, { x: 2 }] });
	});
	it("strictSchema sets additionalProperties and required recursively, leaves enum alone", () => {
		const s = strictSchema({ type: "object", properties: { a: { type: "string", enum: ["x"] }, b: { type: "array", items: { type: "object", properties: { c: { type: "integer" } } } } } });
		expect(s.required).toEqual(["a", "b"]);
		expect(s.additionalProperties).toBe(false);
		expect(s.properties.b.items.required).toEqual(["c"]);
		expect(s.properties.a.enum).toEqual(["x"]);
		expect(s.properties.additionalProperties).toBeUndefined();
	});
});

const raw = {
	title: "VLANs and trunking",
	questions: [
		{
			type: "mc",
			difficulty: "easy",
			topic: "VLAN basics",
			question: "What does a VLAN do?",
			options: ["A) Routing", "B) Separates broadcast domains", "C) Encrypts", "D) Assigns IPs"],
			correct: 1,
			solution: "A VLAN separates broadcast domains.",
			reference: "Page 3",
		},
		{ type: "open", difficulty: "hard", topic: "Inter-VLAN routing", question: "Explain router-on-a-stick.", solution: "Subinterfaces with dot1q.", reference: "Page 5" },
		{
			type: "mc",
			difficulty: "medium",
			topic: "802.1Q tagging",
			question: "How long is the VLAN ID?",
			options: ["8 bit", "12 bit", "16 bit", "32 bit"],
			correct: 1,
			solution: "12 bit.",
			reference: "Page 4",
		},
		{ type: "open", difficulty: "medium", topic: "Native VLAN", question: "What is the native VLAN?", solution: "Untagged.", reference: "Page 4" },
		{ type: "MC", difficulty: "nonsense", topic: "", question: "Broken MC", options: ["x"], correct: 7, solution: "", reference: "" },
		{ type: "open", question: "   " },
	],
};

function quiz(): QuizData {
	const { title, questions } = normalizeQuestions(raw);
	return { id: "q1", title, source: "Uni/Networks/Chapter 4.pdf", pages: "1-6", created: "2026-10-05T18:00", questions };
}

describe("normalizeQuestions", () => {
	it("strips prefixes, renumbers, repairs broken questions", () => {
		const { title, questions } = normalizeQuestions(raw);
		expect(title).toBe("VLANs and trunking");
		expect(questions).toHaveLength(5); // empty question is dropped
		expect(questions.map((q) => q.nr)).toEqual([1, 2, 3, 4, 5]);
		expect(questions[0].options[0]).toBe("Routing"); // "A) " removed
		expect(questions[4].type).toBe("open"); // broken MC -> open
		expect(questions[4].difficulty).toBe("medium");
		expect(questions[4].topic).toBe("General");
	});
	it("open only: MC becomes an open question with the correct option in the solution", () => {
		const { questions } = normalizeQuestions(raw, "open");
		expect(questions.every((q) => q.type === "open" && q.options.length === 0 && q.correct === null)).toBe(true);
		expect(questions[0].solution).toBe("Separates broadcast domains. A VLAN separates broadcast domains.");
	});
	it("also accepts the German field names of older prompts", () => {
		const { questions } = normalizeQuestions({ titel: "T", fragen: [{ typ: "offen", schwierigkeit: "schwer", thema: "X", frage: "Warum?", loesung: "Darum", fundstelle: "S. 1" }] });
		expect(questions[0]).toMatchObject({ type: "open", difficulty: "hard", topic: "X", question: "Warum?", solution: "Darum", reference: "S. 1" });
	});
	it("throws without questions", () => {
		expect(() => normalizeQuestions({ questions: [] })).toThrow();
		expect(() => normalizeQuestions(null)).toThrow();
	});
});

describe("quiz Markdown", () => {
	it("renders and reads answers back", () => {
		const q = quiz();
		let md = renderQuiz(q);
		expect(frontmatterValue(md, "id")).toBe("q1");
		expect(frontmatterValue(md, "status")).toBe("open");
		expect(md).toContain("lacuna: quiz");
		expect(md).toContain("```lacuna\nevaluate\n```");

		md = md.replace("- [ ] B) Separates broadcast domains", "- [x] B) Separates broadcast domains");
		md = md.replace("- [ ] A) 8 bit", "- [X] A) 8 bit");
		md = md.replace(
			"## Question 2 · hard · Inter-VLAN routing\n\nExplain router-on-a-stick.\n\n**Answer:**\n",
			"## Question 2 · hard · Inter-VLAN routing\n\nExplain router-on-a-stick.\n\n**Answer:**\nA router with subinterfaces.\nSecond line.\n",
		);
		const a = parseAnswers(md, q.questions);
		expect(a[0].checked).toEqual([1]);
		expect(a[1].text).toBe("A router with subinterfaces.\nSecond line.");
		expect(a[2].checked).toEqual([0]);
		expect(a[3].text).toBe(""); // left empty, the footer must not leak in
		expect(a[4].text).toBe("");
	});

	it("reads an answer on the same line as the label", () => {
		const q = quiz();
		const md = renderQuiz(q).replace("**Answer:**\n\n\n\n## Question 3", "**Answer:** short and sweet\n\n## Question 3");
		expect(parseAnswers(md, q.questions)[1].text).toBe("short and sweet");
	});

	it("renders in German when the UI language is German", () => {
		setLang("de");
		const md = renderQuiz(quiz());
		expect(md).toContain("# Test: VLANs and trunking");
		expect(md).toContain("## Frage 2 · schwer · Inter-VLAN routing");
		expect(md).toContain("**Antwort:**");
		expect(md).toContain("status: open"); // frontmatter stays language-neutral
	});
});

describe("scoring", () => {
	it("weights by difficulty and clamps AI points", () => {
		expect(maxPoints({ difficulty: "hard" } as any)).toBe(3);
		expect(clampPoints(2.74, 3)).toBe(2.5);
		expect(clampPoints(9, 3)).toBe(3);
		expect(clampPoints(-1, 3)).toBe(0);
		expect(clampPoints("x", 3)).toBe(0);
		expect(normalizeErrorType("confusion of concepts")).toBe("confusion");
		expect(normalizeErrorType("Verwechslung")).toBe("confusion");
		expect(normalizeErrorType("knowledge gap")).toBe("knowledge_gap");
		expect(normalizeErrorType("??")).toBe("knowledge_gap");
	});

	it("grades MC locally, open via AI, empty as gap", () => {
		const q = quiz();
		const answers = [
			{ nr: 1, checked: [1], text: "" }, // correct, 1 point
			{ nr: 2, checked: [], text: "Router with subinterfaces" }, // AI: 2/3
			{ nr: 3, checked: [0], text: "" }, // wrong, 0/2
			{ nr: 4, checked: [], text: "" }, // empty, 0/2
			{ nr: 5, checked: [], text: "something" }, // AI: 2/2
		];
		expect(questionsForAI(q.questions, answers).map((x) => x.nr)).toEqual([2, 3, 5]);

		const items = evaluationItems(q.questions, answers, maxPoints);
		expect(items[2].student_answer).toBe("A) 8 bit");
		expect(items[2].correct_option).toBe("B) 12 bit");

		const r = computeResult(
			q.questions,
			answers,
			[
				{ nr: 2, points: 2, error_type: "incomplete", what_was_wrong: "dot1q missing", correct: "…", follow_up: "Which command?" },
				{ nr: 3, points: 2, error_type: "confusion", what_was_wrong: "8 bit is CoS", correct: "12 bit" }, // points ignored for MC
				{ nr: 5, points: 5, error_type: null },
			],
			"Summary",
			new Date("2026-10-05T19:00:00Z"),
		);
		expect(r.max).toBe(1 + 3 + 2 + 2 + 2);
		expect(r.points).toBe(1 + 2 + 0 + 0 + 2);
		expect(r.percent).toBe(50);
		expect(r.evaluations[0].errorType).toBeNull();
		expect(r.evaluations[2].errorType).toBe("confusion");
		expect(r.evaluations[2].points).toBe(0);
		expect(r.evaluations[3].errorType).toBe("knowledge_gap");
		expect(r.evaluations[4].errorType).toBeNull();
		expect(r.errorTypes).toEqual({ incomplete: 1, confusion: 1, knowledge_gap: 1 });
		expect(r.topics.find((x) => x.topic === "Inter-VLAN routing")!.percent).toBe(67);

		const md = renderEvaluated(q, answers, r);
		expect(frontmatterValue(md, "status")).toBe("evaluated");
		expect(frontmatterValue(md, "score")).toBe("50");
		expect(md).toContain("Result: 5 / 10 points (50 %)");
		expect(md).toContain("- [x] A) 8 bit ❌");
		expect(md).toContain("- [ ] B) 12 bit ✅");
		expect(md).toContain("> [!warning] 2/3 · Incomplete");
		expect(md).toContain("> [!failure] 0/2 · Confusion");
		expect(md).not.toContain("```lacuna\nevaluate");
	});

	it("several checks on MC = wrong", () => {
		const q = quiz();
		const r = computeResult(q.questions, [{ nr: 1, checked: [0, 1], text: "" }], [], "");
		expect(r.evaluations[0].points).toBe(0);
		expect(r.evaluations[0].errorType).toBe("imprecise");
	});
});

describe("progress", () => {
	it("aggregates topics and mistakes across quizzes", () => {
		const q1 = quiz();
		const a = [
			{ nr: 1, checked: [0], text: "" },
			{ nr: 3, checked: [1], text: "" },
		];
		q1.result = computeResult(q1.questions, a, [{ nr: 1, error_type: "confusion", what_was_wrong: "x" }], "", new Date("2026-10-05T10:00:00Z"));
		const q2 = { ...quiz(), id: "q2", created: "2026-10-06T10:00" };
		q2.result = computeResult(q2.questions, [{ nr: 1, checked: [1], text: "" }], [], "", new Date("2026-10-06T10:00:00Z"));
		const d = aggregate([q2, q1, { ...quiz(), id: "q3" }], new Map([["q1", "Quizzes/a.md"]]));
		expect(d.quizzes.map((x) => x.file)).toEqual(["Quizzes/a.md", ""]);
		expect(d.topics[0].percent).toBeLessThanOrEqual(d.topics[d.topics.length - 1].percent);
		expect(d.errorTypes[0][0]).toBe("knowledge_gap");
		const md = renderProgress("Networks", d, [{ title: "Pattern", description: "Evidence" }], "Do X");
		expect(md).toContain("# Progress: Networks");
		expect(md).toContain("lacuna: progress");
		expect(md).toContain("```lacuna\nreview\n```");
		expect(md).toContain("[[Quizzes/a.md\\|VLANs and trunking]]");
		expect(reviewMaterial(d)).toContain("What was wrong");
	});
});

describe("util", () => {
	it("page ranges", () => {
		expect(parsePageRange("", 3)).toEqual([1, 2, 3]);
		expect(parsePageRange("2-4, 7, 9-8", 10)).toEqual([2, 3, 4, 7, 8, 9]);
		expect(parsePageRange("5–6", 10)).toEqual([5, 6]);
		expect(parsePageRange("8-20", 10)).toEqual([8, 9, 10]);
		expect(() => parsePageRange("abc", 10)).toThrow(/page range/);
		expect(() => parsePageRange("50", 10)).toThrow();
		expect(pageRangeText([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
	});
	it("file names and images", () => {
		expect(safeFileName('a/b:c?"d" [x]')).toBe("a b c d x");
		expect(imageEmbeds("![[Image 1.png|300]] text ![alt](assets/x%20y.jpg) ![](https://a/b.png) ![[n.md]]")).toEqual(["Image 1.png", "assets/x y.jpg"]);
	});
});
