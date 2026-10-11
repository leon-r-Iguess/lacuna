import { beforeEach, describe, expect, it } from "vitest";
import * as ob from "./fake-obsidian";
import LacunaPlugin from "../src/main";
import { setLang } from "../src/i18n";
import { FigureList, figureEmbed } from "../src/core/figures";
import { evaluationItems, normalizeQuestions, schemaCreate, userPromptCreate } from "../src/core/prompts";
import { maxPoints, computeResult } from "../src/core/scoring";
import { renderEvaluated, renderQuiz } from "../src/core/quiz-markdown";
import { readDataBlock } from "../src/core/embed";
import { strictSchema } from "../src/core/json";

beforeEach(() => setLang("en"));

function list(): FigureList {
	const f = new FigureList();
	f.add("Uni/Logic/img/circuit.png", "image");
	f.add("Uni/Logic/Slides.pdf", "pdf", [3, 4, 5, 9]);
	f.add("Uni/Logic/Scan.pdf", "pdf", [7]);
	return f;
}

describe("FigureList", () => {
	it("numbers figures and labels them for the AI", () => {
		const f = list();
		expect(f.ids).toEqual(["F1", "F2", "F3"]);
		expect(f.label(f.items[0])).toBe('[Figure F1: the image above, file "Uni/Logic/img/circuit.png"]');
		expect(f.label(f.items[1])).toContain('[Figure F2: pages 3-5, 9 of "Uni/Logic/Slides.pdf"');
		expect(f.label(f.items[1])).toContain("figure_page");
		expect(f.label(f.items[2])).toBe('[Figure F3: page 7 of "Uni/Logic/Scan.pdf"]');
		expect(f.needsPage).toBe(true);
	});

	it("never registers paths that cannot be embedded, or PDFs without pages", () => {
		const f = new FigureList();
		expect(f.add("Uni/a|b.png", "image")).toBeNull();
		expect(f.add("Uni/C#.png", "image")).toBeNull();
		expect(f.add("Uni/[draft].png", "image")).toBeNull();
		expect(f.add("Uni/x.pdf", "pdf", [])).toBeNull();
		expect(f.items).toHaveLength(0);
		expect(f.needsPage).toBe(false);
	});

	it("resolves only known IDs and pages", () => {
		const f = list();
		expect(f.resolve("F1", 0)).toEqual({ path: "Uni/Logic/img/circuit.png" });
		expect(f.resolve(" f1 ", undefined)).toEqual({ path: "Uni/Logic/img/circuit.png" });
		expect(f.resolve("F2", 4)).toEqual({ path: "Uni/Logic/Slides.pdf", page: 4 });
		expect(f.resolve("F2", 6)).toBeUndefined(); // page the AI did not see
		expect(f.resolve("F2", 0)).toBeUndefined(); // multi-page PDF needs a page
		expect(f.resolve("F3", 0)).toEqual({ path: "Uni/Logic/Scan.pdf", page: 7 }); // single page: implicit
		expect(f.resolve("F9", 0)).toBeUndefined();
		expect(f.resolve("", 0)).toBeUndefined();
		expect(f.resolve(undefined, undefined)).toBeUndefined();
		expect(f.resolve("Uni/Logic/img/circuit.png", 0)).toBeUndefined(); // only IDs, never paths
	});

	it("embeds images and PDF pages", () => {
		expect(figureEmbed({ path: "Uni/Logic/img/circuit.png" })).toBe("![[Uni/Logic/img/circuit.png]]");
		expect(figureEmbed({ path: "Uni/Logic/Slides.pdf", page: 4 })).toBe("![[Uni/Logic/Slides.pdf#page=4]]");
	});
});

describe("prompt and schema with figures", () => {
	it("restricts figure to the known IDs; figure_page only when needed", () => {
		const props = (schemaCreate(undefined, list()).input_schema as any).properties.questions.items.properties;
		expect(props.figure.enum).toEqual(["", "F1", "F2", "F3"]);
		expect(props.figure_page.type).toBe("integer");
		const images = new FigureList();
		images.add("a.png", "image");
		const p2 = (schemaCreate(["Gates"], images).input_schema as any).properties.questions.items.properties;
		expect(p2.figure.enum).toEqual(["", "F1"]);
		expect(p2.figure_page).toBeUndefined();
		expect(p2.topic.enum).toEqual(["Gates"]);
		const strict = strictSchema(schemaCreate(undefined, list()).input_schema);
		expect(strict.properties.questions.items.required).toEqual(expect.arrayContaining(["figure", "figure_page"]));
	});

	it("without figures the schema and prompt stay as before", () => {
		const props = (schemaCreate(undefined, new FigureList()).input_schema as any).properties.questions.items.properties;
		expect(props.figure).toBeUndefined();
		expect(userPromptCreate({ count: 3, focus: "", figures: new FigureList() })).not.toContain("figure");
		expect(userPromptCreate({ count: 3, focus: "" })).not.toContain("figure");
	});

	it("the prompt explains how to use figures", () => {
		const p = userPromptCreate({ count: 3, focus: "", figures: list() });
		expect(p).toContain('set "figure" to its ID (F1, F2, F3)');
		expect(p).toContain("figure_page");
	});
});

const RAW = {
	title: "Logic",
	questions: [
		{ type: "mc", difficulty: "easy", topic: "Gates", question: "Which gate is shown?", options: ["AND", "OR", "XOR", "NAND"], correct: 2, solution: "XOR.", reference: "p. 4", figure: "F2", figure_page: 4 },
		{ type: "open", difficulty: "medium", topic: "Gates", question: "What does this circuit output for A = 1, B = 0?", solution: "1.", reference: "", figure: "F1", figure_page: 0 },
		{ type: "open", difficulty: "medium", topic: "Gates", question: "Invented figure", solution: "x", reference: "", figure: "F7", figure_page: 0 },
		{ type: "open", difficulty: "medium", topic: "Gates", question: "Wrong page", solution: "x", reference: "", figure: "F2", figure_page: 6 },
		{ type: "open", difficulty: "medium", topic: "Gates", question: "No figure", solution: "x", reference: "", figure: "", figure_page: 0, visual_kind: "table", visual: "| A | Y |\n|---|---|\n| 0 | 1 |" },
	],
};

describe("questions with figures", () => {
	it("normalizeQuestions keeps only figures the AI was shown", () => {
		const { questions } = normalizeQuestions(RAW, "mixed", "General", list());
		expect(questions[0].figure).toEqual({ path: "Uni/Logic/Slides.pdf", page: 4 });
		expect(questions[1].figure).toEqual({ path: "Uni/Logic/img/circuit.png" });
		expect(questions[2].figure).toBeUndefined();
		expect(questions[3].figure).toBeUndefined();
		expect(questions[4].figure).toBeUndefined();
		// Without a figure list (e.g. review quiz) nothing is resolved
		expect(normalizeQuestions(RAW).questions[1].figure).toBeUndefined();
	});

	it("renders the figure below the question text, before a table figure, and keeps it in the data block", () => {
		const { questions } = normalizeQuestions(RAW, "mixed", "General", list());
		questions[1].visual = { kind: "table", content: "| A | B |\n|---|---|\n| 1 | 0 |" };
		const q = { id: "f1", title: "Logic", source: "Uni/Logic", pages: "", created: "2026-10-11T18:00", questions };
		const md = renderQuiz(q);
		expect(md).toContain("Which gate is shown?\n\n![[Uni/Logic/Slides.pdf#page=4]]\n\n- [ ] A) AND");
		expect(md).toContain("What does this circuit output for A = 1, B = 0?\n\n![[Uni/Logic/img/circuit.png]]\n\n| A | B |");
		expect(readDataBlock(md)!.questions[1].figure).toEqual({ path: "Uni/Logic/img/circuit.png" });

		const answers = questions.map((x) => ({ nr: x.nr, checked: x.nr === 1 ? [2] : [], text: x.nr === 2 ? "1" : "" }));
		const r = computeResult(questions, answers, [{ nr: 2, points: 2, error_type: "none" }], "");
		const ev = renderEvaluated(q, answers, r);
		expect(ev).toContain("Which gate is shown?\n\n![[Uni/Logic/Slides.pdf#page=4]]");
		expect(ev).toContain("![[Uni/Logic/img/circuit.png]]");
	});

	it("grading is told whether the figure is attached", () => {
		const { questions } = normalizeQuestions(RAW, "mixed", "General", list());
		const items = evaluationItems(questions, [], maxPoints, new Set([2]));
		expect(items[0].figure).toContain("not attached");
		expect(items[1].figure).toBe('see the image labeled "Figure of question 2"');
		expect(items[4]).not.toHaveProperty("figure");
	});
});

// ------------------------------------------------------------------ Plugin flow

const claudeReply = (input: any) => ({
	status: 200,
	json: { stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: "text", text: JSON.stringify(input) }] },
	text: "",
});
const body = (i: number) => JSON.parse(ob.requestUrl.mock.calls[i][0].body);

describe("plugin flow with figures", () => {
	let app: ob.App;
	let plugin: LacunaPlugin;
	const quizPath = () => [...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/Quizzes/") && !p.includes("Follow-up"))!;

	beforeEach(async () => {
		ob.requestUrl.mockReset();
		ob.loadPdfJs.mockReset();
		ob.notices.length = 0;
		app = new ob.App();
		plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
		await plugin.onload();
		plugin.settings.claudeKey = "sk-ant-test";
		plugin.choose = async () => "later";
		await app.vault.create("Uni/Logic/Gates.md", "# Gates\n" + "An XOR gate outputs 1 if the inputs differ. ".repeat(10) + "\n![[circuit.png]]\n![[table.png]]");
		await app.vault.create("Uni/Logic/img/circuit.png", new Uint8Array([1, 2, 3]).buffer as any);
		await app.vault.create("Uni/Logic/img/table.png", new Uint8Array([4, 5, 6]).buffer as any);
	});

	const QUIZ = {
		title: "Gates",
		questions: [
			{ type: "open", difficulty: "medium", topic: "Gates", question: "What does this circuit output for A = 1, B = 0?", options: [], correct: -1, solution: "1, it is an XOR.", reference: "", figure: "F1" },
			{ type: "open", difficulty: "easy", topic: "Gates", question: "Name the gate.", options: [], correct: -1, solution: "XOR.", reference: "", figure: "F2" },
			{ type: "open", difficulty: "easy", topic: "Gates", question: "Invented figure.", options: [], correct: -1, solution: "x", reference: "", figure: "F5" },
		],
	};

	it("note with embedded images: labels, figure in the quiz, image attached when grading, kept in the follow-up", async () => {
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUIZ));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Gates.md") as any, { count: 3 });
		const req = body(0);
		const texts = req.messages[0].content.filter((c: any) => c.type === "text").map((c: any) => c.text);
		expect(texts).toContain('[Figure F1: the image above, file "Uni/Logic/img/circuit.png"]');
		expect(texts).toContain('[Figure F2: the image above, file "Uni/Logic/img/table.png"]');
		expect(req.output_config.format.schema.properties.questions.items.properties.figure.enum).toEqual(["", "F1", "F2"]);
		expect(texts.join("\n")).toContain('set "figure" to its ID (F1, F2)');

		let md = app.vault.files.get(quizPath()) as string;
		expect(md).toContain("What does this circuit output for A = 1, B = 0?\n\n![[Uni/Logic/img/circuit.png]]");
		expect(md).toContain("Name the gate.\n\n![[Uni/Logic/img/table.png]]");
		expect(md).not.toContain("Invented figure.\n\n![[");

		// The table image is deleted before grading: graded without it
		app.vault.files.delete("Uni/Logic/img/table.png");
		md = md
			.replace(/(output for A = 1, B = 0\?[\s\S]*?\*\*Answer:\*\*\n)/, "$10\n")
			.replace(/(Name the gate\.[\s\S]*?\*\*Answer:\*\*\n)/, "$1AND\n");
		app.vault.files.set(quizPath(), md);
		ob.requestUrl.mockResolvedValueOnce(
			claudeReply({
				evaluations: [
					{ nr: 1, points: 0, error_type: "application", what_was_wrong: "Inputs differ, so 1.", correct: "1.", reference: "", follow_up: "What does it output for A = 1, B = 1?" },
					{ nr: 2, points: 0, error_type: "confusion", what_was_wrong: "AND vs XOR.", correct: "XOR.", reference: "", follow_up: "How do AND and XOR differ for 1/1?" },
				],
				summary: "Look at the circuit again.",
			}),
		);
		await plugin.evaluate(app.vault.getAbstractFileByPath(quizPath()) as any);
		const content = body(1).messages[0].content;
		expect(content[0].type).toBe("image");
		expect(content[1].text).toBe("Figure of question 1");
		expect(content.filter((c: any) => c.type === "image")).toHaveLength(1); // deleted figure is not attached
		const items = JSON.parse(content[2].text.split("\n").slice(3).join("\n"));
		expect(items.find((x: any) => x.nr === 1).figure).toBe('see the image labeled "Figure of question 1"');
		expect(items.find((x: any) => x.nr === 2).figure).toContain("not attached");

		md = app.vault.files.get(quizPath()) as string;
		expect(md).toContain("status: evaluated");
		expect(md).toContain("![[Uni/Logic/img/circuit.png]]");

		await plugin.followUp(app.vault.getAbstractFileByPath(quizPath()) as any);
		const fu = [...app.vault.files.keys()].find((p) => p.includes("Follow-up"))!;
		expect(app.vault.files.get(fu)).toContain("What does it output for A = 1, B = 1?\n\n![[Uni/Logic/img/circuit.png]]");
		expect(ob.requestUrl).toHaveBeenCalledTimes(2);
	});

	it("image file as source: the image itself is the figure", async () => {
		ob.requestUrl.mockResolvedValueOnce(claudeReply({ title: "Board", questions: [QUIZ.questions[0]] }));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/img/circuit.png") as any, { count: 1 });
		const c = body(0).messages[0].content;
		expect(c[0].type).toBe("image");
		expect(c[1].text).toContain('[Figure F1: the image above, file "Uni/Logic/img/circuit.png"]');
		const md = app.vault.files.get([...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/img/Quizzes/"))!) as string;
		expect(md).toContain("![[Uni/Logic/img/circuit.png]]");
	});

	it("scanned PDF: a question names the page it is about", async () => {
		ob.loadPdfJs.mockResolvedValue({
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: 12,
					getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
					destroy: async () => {},
				}),
			}),
		});
		await app.vault.create("Uni/Logic/Scan.pdf", new Uint8Array([37, 80, 68, 70]).buffer as any);
		ob.requestUrl.mockResolvedValueOnce(
			claudeReply({ title: "Scan", questions: [{ ...QUIZ.questions[0], figure: "F1", figure_page: 11 }, { ...QUIZ.questions[1], figure: "F1", figure_page: 3 }] }),
		);
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Scan.pdf") as any, { count: 2, pages: "10-12" });
		const c = body(0).messages[0].content;
		expect(c[0].type).toBe("document");
		expect(c[1].text).toContain('[Figure F1: pages 10-12 of "Uni/Logic/Scan.pdf"');
		expect(body(0).output_config.format.schema.properties.questions.items.properties.figure_page.type).toBe("integer");
		const md = app.vault.files.get([...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/Quizzes/"))!) as string;
		expect(md).toContain("![[Uni/Logic/Scan.pdf#page=11]]");
		expect(md).not.toContain("#page=3"); // outside the page range the AI saw
	});

	it("folder quiz: images from notes and image files are figures", async () => {
		ob.requestUrl.mockResolvedValueOnce(claudeReply({ title: "Logic", questions: [{ ...QUIZ.questions[1], figure: "F2" }] }));
		await plugin.createFolderQuiz(app.vault.getAbstractFileByPath("Uni/Logic") as any, { count: 1 });
		const texts = body(0).messages[0].content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
		expect(texts).toContain("[Figure F1:");
		expect(texts).toContain("[Figure F2:");
		const md = app.vault.files.get([...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/Quizzes/"))!) as string;
		expect(md).toMatch(/Name the gate\.\n\n!\[\[Uni\/Logic\/img\/(?:circuit|table)\.png\]\]/);
	});
});
