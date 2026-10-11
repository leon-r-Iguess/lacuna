import { beforeEach, describe, expect, it } from "vitest";
import * as ob from "./fake-obsidian";
import LacunaPlugin from "../src/main";
import { setLang } from "../src/i18n";
import { cleanMermaid, cleanTable, cleanVisual, isUntouchedTemplate, renderVisual } from "../src/core/visual";
import { evaluationItems, normalizeQuestions, schemaCreate } from "../src/core/prompts";
import { computeResult, isEmpty, maxPoints, questionsForAI } from "../src/core/scoring";
import { parseAnswers, renderEvaluated, renderQuiz } from "../src/core/quiz-markdown";
import { readDataBlock } from "../src/core/embed";
import { strictSchema } from "../src/core/json";
import { QuizData } from "../src/core/types";

beforeEach(() => setLang("en"));

const TABLE = "| A | B | Y |\n|---|---|---|\n| 0 | 0 | 0 |\n| 1 | 1 | 1 |";
const TEMPLATE = "| A | B | Y |\n|---|---|---|\n| 0 | 0 |  |\n| 0 | 1 |  |\n| 1 | 0 |  |\n| 1 | 1 |  |";
const FILLED = "| A | B | Y |\n|---|---|---|\n| 0 | 0 | 0 |\n| 0 | 1 | 1 |\n| 1 | 0 | 1 |\n| 1 | 1 | 0 |";
const MERMAID = "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: start";

describe("cleanTable", () => {
	it("accepts a Markdown table and trims blank lines and indentation", () => {
		expect(cleanTable(`\n\n  ${TABLE.split("\n").join("\n  ")}\n\n`)).toBe(TABLE);
	});
	it("accepts alignment colons in the separator row", () => {
		expect(cleanTable("| A | Y |\n|:---|---:|\n| 0 | 1 |")).toBe("| A | Y |\n|:---|---:|\n| 0 | 1 |");
	});
	it("rejects anything that is not a complete table", () => {
		expect(cleanTable("")).toBeNull();
		expect(cleanTable("| A | Y |\n| 0 | 1 |\n| 1 | 0 |")).toBeNull(); // no separator row
		expect(cleanTable("| A | Y |\n|---|---|")).toBeNull(); // no body row
		expect(cleanTable("| A | Y |\n|---|---|\n| 0 | 1 |\nfree text")).toBeNull();
	});
	it("rejects tables that could break the note", () => {
		expect(cleanTable("| A | Y |\n|---|---|\n| %% | 1 |")).toBeNull(); // Obsidian comment / data block marker
		expect(cleanTable("| A | Y |\n|---|---|\n| ``` | 1 |")).toBeNull();
		expect(cleanTable(["| A |", "|---|", ...Array(70).fill("| 1 |")].join("\n"))).toBeNull(); // too long
	});
});

describe("cleanMermaid", () => {
	it("keeps plain Mermaid code", () => {
		expect(cleanMermaid(MERMAID)).toBe(MERMAID);
	});
	it("removes a surrounding fence and comment lines", () => {
		expect(cleanMermaid("```mermaid\n%% a comment\n" + MERMAID + "\n```")).toBe(MERMAID);
		expect(cleanMermaid("%%{init: {'theme':'dark'}}%%\n" + MERMAID)).toBe(MERMAID);
		// parseLoose strips backticks from the whole AI reply, so only the word "mermaid" may be left
		expect(cleanMermaid("mermaid\n" + MERMAID + "\n")).toBe(MERMAID);
	});
	it("rejects unknown diagram types and plain text", () => {
		expect(cleanMermaid("This is not a diagram")).toBeNull();
		expect(cleanMermaid("")).toBeNull();
	});
	it("rejects code that could break the note", () => {
		expect(cleanMermaid("flowchart LR\n  A --> B\n```\n## Question 9")).toBeNull();
		expect(cleanMermaid("flowchart LR\n## Question 2\n  A --> B")).toBeNull();
		expect(cleanMermaid("flowchart LR\n  A[**Answer:**] --> B")).not.toBeNull(); // only a label at line start is dangerous
		expect(cleanMermaid("flowchart LR\n**Answer:** x")).toBeNull();
		expect(cleanMermaid("flowchart LR\n  A --> B %% inline")).toBeNull();
	});
});

describe("cleanVisual", () => {
	it("maps the AI fields to a figure or nothing", () => {
		expect(cleanVisual("table", TABLE)).toEqual({ kind: "table", content: TABLE });
		expect(cleanVisual("Mermaid", MERMAID)).toEqual({ kind: "mermaid", content: MERMAID });
		expect(cleanVisual("none", TABLE)).toBeUndefined();
		expect(cleanVisual(undefined, undefined)).toBeUndefined();
		expect(cleanVisual("table", "not a table")).toBeUndefined();
	});
	it("renders Mermaid in a fence and tables as they are", () => {
		expect(renderVisual({ kind: "mermaid", content: MERMAID })).toBe("```mermaid\n" + MERMAID + "\n```");
		expect(renderVisual({ kind: "table", content: TABLE })).toBe(TABLE);
	});
});

const RAW = {
	title: "Logic",
	questions: [
		{ type: "mc", difficulty: "easy", topic: "Gates", question: "Which gate has this truth table?", options: ["AND", "OR", "XOR", "NAND"], correct: 0, solution: "AND.", reference: "p. 2", visual_kind: "table", visual: TABLE, answer_template: TEMPLATE },
		{ type: "open", difficulty: "medium", topic: "Gates", question: "Complete the truth table of XOR.", options: [], correct: -1, solution: FILLED, reference: "p. 3", visual_kind: "none", visual: "", answer_template: TEMPLATE },
		{ type: "open", difficulty: "hard", topic: "FSM", question: "When does the machine leave Idle?", options: [], correct: -1, solution: "On start.", reference: "p. 5", visual_kind: "mermaid", visual: "```mermaid\n" + MERMAID + "\n```", answer_template: "" },
		{ type: "open", difficulty: "medium", topic: "FSM", question: "Broken figure", options: [], correct: -1, solution: "x", reference: "", visual_kind: "table", visual: "## Question 1\nnonsense", answer_template: "no table" },
	],
};

function quiz(): QuizData {
	const { title, questions } = normalizeQuestions(RAW);
	return { id: "v1", title, source: "Uni/Logic/Gates.md", pages: "", created: "2026-10-11T18:00", questions };
}

describe("questions with figures", () => {
	it("normalizeQuestions keeps checked figures and templates, drops broken ones", () => {
		const q = quiz().questions;
		expect(q[0].visual).toEqual({ kind: "table", content: TABLE });
		expect(q[0].answerTemplate).toBeUndefined(); // templates only for open questions
		expect(q[1].visual).toBeUndefined();
		expect(q[1].answerTemplate).toBe(TEMPLATE);
		expect(q[2].visual).toEqual({ kind: "mermaid", content: MERMAID });
		expect(q[3].visual).toBeUndefined(); // the question itself stays
		expect(q[3].answerTemplate).toBeUndefined();
		expect(q[3].question).toBe("Broken figure");
	});

	it("schema asks for the new fields; strict mode makes them required", () => {
		const props = (schemaCreate().input_schema as any).properties.questions.items.properties;
		expect(props.visual_kind.enum).toEqual(["none", "table", "mermaid"]);
		expect(props.visual.type).toBe("string");
		expect(props.answer_template.type).toBe("string");
		const strict = strictSchema(schemaCreate().input_schema);
		expect(strict.properties.questions.items.required).toEqual(expect.arrayContaining(["visual_kind", "visual", "answer_template"]));
	});

	it("renders figures below the question text and the template below the answer label", () => {
		const md = renderQuiz(quiz(), { confidence: true });
		expect(md).toContain("Which gate has this truth table?\n\n" + TABLE + "\n\n- [ ] A) AND");
		expect(md).toContain("When does the machine leave Idle?\n\n```mermaid\n" + MERMAID + "\n```\n\n");
		expect(md).toContain("*Fill in the empty cells of the table below.*");
		expect(md).toContain("**Answer:**\n\n" + TEMPLATE + "\n");
		expect(md.match(/```mermaid/g)).toHaveLength(1);
	});

	it("German quizzes explain the template in German", () => {
		setLang("de");
		expect(renderQuiz(quiz())).toContain("*Füll die leeren Zellen der Tabelle unten aus.*");
	});

	it("figures and templates do not disturb reading the answers back", () => {
		const q = quiz();
		let md = renderQuiz(q, { confidence: true });
		md = md.replace("- [ ] A) AND", "- [x] A) AND");
		md = md.replace("**Answer:**\n\n" + TEMPLATE, "**Answer:**\n\n" + FILLED);
		md = md.replace("leave Idle?\n\n```mermaid\n" + MERMAID + "\n```\n\n*How sure are you?*\n- [ ] guessed\n- [ ] unsure\n- [ ] sure", "leave Idle?\n\n```mermaid\n" + MERMAID + "\n```\n\n*How sure are you?*\n- [ ] guessed\n- [x] unsure\n- [ ] sure");
		md = md.replace(/(leave Idle\?[\s\S]*?\*\*Answer:\*\*\n)/, "$1When start arrives.\n");
		const a = parseAnswers(md, q.questions);
		expect(a[0].checked).toEqual([0]);
		expect(a[1].text).toBe(FILLED);
		expect(a[2].text).toBe("When start arrives.");
		expect(a[2].confidence).toBe("unsure");
		expect(a[3].text).toBe("");
	});

	it("an untouched template counts as no answer and is not sent to the AI", () => {
		const q = quiz();
		const md = renderQuiz(q);
		const a = parseAnswers(md, q.questions);
		expect(a[1].text).toBe(TEMPLATE);
		expect(isEmpty(q.questions[1], a[1])).toBe(true);
		expect(questionsForAI(q.questions, a).map((x) => x.nr)).not.toContain(2);
		const r = computeResult(q.questions, a, [], "");
		expect(r.evaluations[1]).toMatchObject({ points: 0, errorType: "knowledge_gap" });
	});

	it("whitespace changes alone do not count as an answer; a filled cell does", () => {
		const spaced = TEMPLATE.replace("| 0 | 0 |  |", "|  0 |   0 |     |");
		expect(isUntouchedTemplate(spaced, TEMPLATE)).toBe(true);
		expect(isUntouchedTemplate("\n" + TEMPLATE + "\n\n", TEMPLATE)).toBe(true);
		// Obsidian's table editor pads columns and rewrites the separator row
		const reformatted = "| A   | B   | Y   |\n| --- | --- | --- |\n| 0   | 0   |     |\n| 0   | 1   |     |\n| 1   | 0   |     |\n| 1   | 1   |     |";
		expect(isUntouchedTemplate(reformatted, TEMPLATE)).toBe(true);
		expect(isUntouchedTemplate(reformatted.replace("| 1   | 1   |     |", "| 1   | 1   | 0   |"), TEMPLATE)).toBe(false);
		const one = TEMPLATE.replace("| 0 | 0 |  |", "| 0 | 0 | 0 |");
		expect(isEmpty(quiz().questions[1], { nr: 2, checked: [], text: one })).toBe(false);
	});

	it("grading gets the figure and the template", () => {
		const q = quiz();
		const items = evaluationItems(q.questions, [{ nr: 2, checked: [], text: FILLED }], maxPoints);
		expect(items[0].visual).toBe("Table:\n" + TABLE);
		expect(items[1].answer_template).toBe(TEMPLATE);
		expect(items[1].visual).toBeUndefined();
		expect(items[2].visual).toBe("Mermaid diagram:\n" + MERMAID);
		expect(items[3]).not.toHaveProperty("visual");
		expect(items[3]).not.toHaveProperty("answer_template");
	});

	it("the evaluated note shows the figure again and keeps it in the data block", () => {
		const q = quiz();
		const answers = [
			{ nr: 1, checked: [0], text: "" },
			{ nr: 2, checked: [], text: FILLED },
			{ nr: 3, checked: [], text: "On start." },
			{ nr: 4, checked: [], text: "" },
		];
		const r = computeResult(q.questions, answers, [{ nr: 2, points: 2, error_type: "none" }, { nr: 3, points: 3, error_type: "none" }], "Fine.");
		const md = renderEvaluated(q, answers, r);
		expect(md).toContain("Which gate has this truth table?\n\n" + TABLE);
		expect(md).toContain("```mermaid\n" + MERMAID + "\n```");
		expect(md).toContain(FILLED); // the learner's completed table
		const back = readDataBlock(md)!;
		expect(back.questions[0].visual).toEqual({ kind: "table", content: TABLE });
		expect(back.questions[1].answerTemplate).toBe(TEMPLATE);
	});

	it("quizzes without figures render exactly as before", () => {
		const plain: QuizData = {
			...quiz(),
			questions: quiz().questions.map(({ visual, answerTemplate, ...rest }) => rest),
		};
		const md = renderQuiz(plain);
		expect(md).not.toContain("```mermaid");
		expect(md).not.toContain("Fill in the empty cells");
		expect(md).toContain("**Answer:**\n\n\n\n## Question 3");
	});
});

// ------------------------------------------------------------------ Plugin flow

const claudeReply = (input: any) => ({
	status: 200,
	json: { stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: "text", text: JSON.stringify(input) }] },
	text: "",
});

describe("plugin flow with figures", () => {
	let app: ob.App;
	let plugin: LacunaPlugin;

	beforeEach(async () => {
		ob.requestUrl.mockReset();
		ob.notices.length = 0;
		app = new ob.App();
		plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
		await plugin.onload();
		plugin.settings.claudeKey = "sk-ant-test";
		plugin.choose = async () => "later";
		await app.vault.create("Uni/Logic/Gates.md", "# Gates\n" + "An XOR gate outputs 1 if the inputs differ. ".repeat(10));
	});

	it("create → answer → evaluate → follow-up keeps the figure", async () => {
		ob.requestUrl.mockResolvedValueOnce(claudeReply(RAW));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Gates.md") as any, { count: 4 });
		const prompt = JSON.parse(ob.requestUrl.mock.calls[0][0].body).system as string;
		expect(prompt).toContain('visual_kind "table"');
		const path = [...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/Quizzes/"))!;
		let md = app.vault.files.get(path) as string;
		expect(md).toContain("```mermaid\n" + MERMAID + "\n```");

		md = md
			.replace("- [ ] B) OR", "- [x] B) OR")
			.replace("**Answer:**\n\n" + TEMPLATE, "**Answer:**\n\n" + FILLED)
			.replace(/(leave Idle\?[\s\S]*?\*\*Answer:\*\*\n)/, "$1No idea\n");
		app.vault.files.set(path, md);
		ob.requestUrl.mockResolvedValueOnce(
			claudeReply({
				evaluations: [
					{ nr: 1, points: 0, error_type: "confusion", what_was_wrong: "OR is 1 for 0/1.", correct: "AND.", reference: "p. 2", follow_up: "What does the table give for A=0, B=1?" },
					{ nr: 2, points: 2, error_type: "none", what_was_wrong: "", correct: "", reference: "", follow_up: "" },
					{ nr: 3, points: 0, error_type: "knowledge_gap", what_was_wrong: "No transition named.", correct: "On start.", reference: "p. 5", follow_up: "Which event leads from Idle to Busy?" },
				],
				summary: "Read the figures carefully.",
			}),
		);
		await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
		const sent = JSON.parse(JSON.parse(ob.requestUrl.mock.calls[1][0].body).messages[0].content[0].text.split("\n").slice(3).join("\n"));
		expect(sent.find((x: any) => x.nr === 1).visual).toBe("Table:\n" + TABLE);
		expect(sent.find((x: any) => x.nr === 2).answer_template).toBe(TEMPLATE);
		expect(sent.find((x: any) => x.nr === 2).student_answer).toBe(FILLED);
		expect(sent.find((x: any) => x.nr === 4)).toBeUndefined(); // empty answer, graded locally

		await plugin.followUp(app.vault.getAbstractFileByPath(path) as any);
		const fu = [...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/Quizzes/Follow-up"))!;
		const fumd = app.vault.files.get(fu) as string;
		expect(fumd).toContain("What does the table give for A=0, B=1?\n\n" + TABLE);
		expect(fumd).toContain("Which event leads from Idle to Busy?\n\n```mermaid\n" + MERMAID + "\n```");
	});
});
