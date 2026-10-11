import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ob from "./fake-obsidian";
import LacunaPlugin, { DEFAULTS } from "../src/main";
import { setLang } from "../src/i18n";
import { PageStats, pageStats, pickFigurePages } from "../src/core/figure-pages";
import { MAX_FIGURE_PAGES, pageRenderer } from "../src/sources";

// Operator codes as pdf.js numbers them (only the ones Lacuna looks at)
const OPS = { paintImageXObject: 85, paintInlineImageXObject: 86, constructPath: 91, stroke: 20, fill: 22, showText: 44 };

beforeEach(() => setLang("en"));

const st = (page: number, images: [number, number][], paths: number): PageStats => ({ page, images: images.map(([w, h]) => ({ w, h })), paths });

describe("pageStats", () => {
	it("counts images (both argument shapes) and drawing operations, ignores text", () => {
		const s = pageStats(
			4,
			[OPS.showText, OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.constructPath, OPS.stroke, OPS.fill, OPS.showText],
			[[], ["img_p4_1", 800, 600], [{ width: 300, height: 200, data: [] }], [[1, 2]], [], [], []],
			OPS,
		);
		expect(s).toEqual({ page: 4, images: [{ w: 800, h: 600 }, { w: 300, h: 200 }], paths: 3 });
	});
	it("copes with unknown argument shapes and missing operator codes", () => {
		expect(pageStats(1, [OPS.paintImageXObject], [["img"]], OPS).images).toEqual([]);
		expect(pageStats(1, [1, 2, 3], [], {})).toEqual({ page: 1, images: [], paths: 0 });
	});
});

describe("pickFigurePages", () => {
	it("picks pages with large images or many drawn paths", () => {
		const stats = [st(1, [], 4), st(2, [[900, 700]], 4), st(3, [], 120), st(4, [], 6), st(5, [[64, 64]], 5)];
		expect(pickFigurePages(stats, 10)).toEqual([2, 3]); // page 5: only an icon
	});
	it("ignores the slide template's logo that repeats on most pages", () => {
		const logo: [number, number] = [400, 160];
		const stats = [st(1, [logo], 4), st(2, [logo], 4), st(3, [logo, [1200, 800]], 4), st(4, [logo], 4), st(5, [logo], 4)];
		expect(pickFigurePages(stats, 10)).toEqual([3]);
	});
	it("needs clearly more paths than the template draws on every page", () => {
		const stats = [st(1, [], 30), st(2, [], 30), st(3, [], 45), st(4, [], 95), st(5, [], 30)];
		expect(pickFigurePages(stats, 10)).toEqual([4]); // threshold 2 × leanest page 30 + 10 = 70
	});
	it("still finds the figures when almost every page has one", () => {
		const stats = [st(1, [], 2), ...[2, 3, 4, 5, 6, 7, 8].map((p) => st(p, [], 150))];
		expect(pickFigurePages(stats, 10)).toEqual([2, 3, 4, 5, 6, 7, 8]);
	});
	it("keeps the strongest pages up to the limit, in page order", () => {
		const stats = [st(1, [], 50), st(2, [[800, 600]], 0), st(3, [], 300), st(4, [], 60), st(5, [[800, 600], [500, 500]], 0)];
		expect(pickFigurePages(stats, 2)).toEqual([3, 5]);
		expect(pickFigurePages(stats, 0)).toEqual([]);
		expect(pickFigurePages([], 5)).toEqual([]);
	});
	it("with fewer than four pages nothing counts as decoration", () => {
		expect(pickFigurePages([st(1, [[800, 600]], 0), st(2, [[800, 600]], 0)], 5)).toEqual([1, 2]);
	});
});

// ------------------------------------------------------------------ Plugin flow

const claudeReply = (input: any) => ({
	status: 200,
	json: { stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: "text", text: JSON.stringify(input) }] },
	text: "",
});
const body = (i: number) => JSON.parse(ob.requestUrl.mock.calls[i][0].body);

/** A fake PDF: text on every page, a circuit (many paths) on the pages in `circuits`. */
function fakePdf(numPages: number, circuits: number[]) {
	const getOperatorList = vi.fn(async (n: number) =>
		circuits.includes(n)
			? { fnArray: Array(150).fill(OPS.stroke), argsArray: Array(150).fill([]) }
			: { fnArray: [OPS.showText, OPS.constructPath], argsArray: [[], []] },
	);
	return {
		getOperatorList,
		pdfjs: {
			OPS,
			getDocument: () => ({
				promise: Promise.resolve({
					numPages,
					getPage: async (n: number) => ({
						n,
						getTextContent: async () => ({ items: [{ str: `Page ${n}: logic gates and truth tables. `.repeat(5), hasEOL: true }] }),
						getOperatorList: () => getOperatorList(n),
					}),
					destroy: async () => {},
				}),
			}),
		},
	};
}

describe("include figures from PDFs", () => {
	let app: ob.App;
	let plugin: LacunaPlugin;
	const original = pageRenderer.render;
	let rendered: number[];
	const quizMd = () => app.vault.files.get([...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/Quizzes/") && !p.includes("Follow-up"))!) as string;

	beforeEach(async () => {
		ob.requestUrl.mockReset();
		ob.loadPdfJs.mockReset();
		ob.notices.length = 0;
		rendered = [];
		pageRenderer.render = async (page: any) => {
			rendered.push(page.n);
			return `JPEG${page.n}`;
		};
		app = new ob.App();
		plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
		await plugin.onload();
		plugin.settings.claudeKey = "sk-ant-test";
		plugin.choose = async () => "later";
		await app.vault.create("Uni/Logic/Slides.pdf", new Uint8Array([37, 80, 68, 70]).buffer as any);
	});
	afterEach(() => {
		pageRenderer.render = original;
	});

	const QUIZ = {
		title: "Gates",
		questions: [
			{ type: "open", difficulty: "medium", topic: "Gates", question: "What does this circuit output for A = 1, B = 0?", options: [], correct: -1, solution: "1.", reference: "p. 3", figure: "F1" },
			{ type: "open", difficulty: "easy", topic: "Gates", question: "Explain XOR.", options: [], correct: -1, solution: "Inputs differ.", reference: "p. 1", figure: "" },
		],
	};

	it("is off by default: only text, no figure detection", async () => {
		expect(DEFAULTS.includeFigures).toBe(false);
		const pdf = fakePdf(4, [3]);
		ob.loadPdfJs.mockResolvedValue(pdf.pdfjs);
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUIZ));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Slides.pdf") as any, { count: 2 });
		expect(pdf.getOperatorList).not.toHaveBeenCalled();
		expect(rendered).toEqual([]);
		const c = body(0).messages[0].content;
		expect(c.filter((x: any) => x.type === "image")).toHaveLength(0);
		expect(body(0).output_config.format.schema.properties.questions.items.properties.figure).toBeUndefined();
		expect(quizMd()).not.toContain("![[");
		expect(ob.notices.join("\n")).not.toContain("Figures:");
	});

	it("when switched on: pages with figures go along as labeled images and appear in the question", async () => {
		const pdf = fakePdf(5, [3, 5]);
		ob.loadPdfJs.mockResolvedValue(pdf.pdfjs);
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUIZ));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Slides.pdf") as any, { count: 2, figures: true });
		expect(rendered).toEqual([3, 5]);
		const c = body(0).messages[0].content;
		expect(c[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "JPEG3" } });
		expect(c[1].text).toBe('[Figure F1: page 3 of "Uni/Logic/Slides.pdf"]');
		expect(c[2].source.data).toBe("JPEG5");
		expect(c[3].text).toBe('[Figure F2: page 5 of "Uni/Logic/Slides.pdf"]');
		expect(c[4].text).toContain("[Page 1]"); // the text is still sent
		const props = body(0).output_config.format.schema.properties.questions.items.properties;
		expect(props.figure.enum).toEqual(["", "F1", "F2"]);
		expect(props.figure_page).toBeUndefined(); // single pages need no page number
		expect(quizMd()).toContain("What does this circuit output for A = 1, B = 0?\n\n![[Uni/Logic/Slides.pdf#page=3]]");
		expect(ob.notices.join("\n")).toContain("Figures: 2 PDF pages sent as images.");
	});

	it("says so when no page has a figure", async () => {
		ob.loadPdfJs.mockResolvedValue(fakePdf(3, []).pdfjs);
		ob.requestUrl.mockResolvedValueOnce(claudeReply({ ...QUIZ, questions: [QUIZ.questions[1]] }));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Slides.pdf") as any, { count: 1, figures: true });
		expect(rendered).toEqual([]);
		expect(ob.notices.join("\n")).toContain("no pages with figures found");
	});

	it("a page that cannot be rendered is left out", async () => {
		ob.loadPdfJs.mockResolvedValue(fakePdf(5, [2, 4]).pdfjs);
		pageRenderer.render = async (page: any) => (page.n === 2 ? null : `JPEG${page.n}`);
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUIZ));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Slides.pdf") as any, { count: 2, figures: true });
		const c = body(0).messages[0].content;
		expect(c.filter((x: any) => x.type === "image").map((x: any) => x.source.data)).toEqual(["JPEG4"]);
		expect(c[1].text).toBe('[Figure F1: page 4 of "Uni/Logic/Slides.pdf"]');
	});

	it("grading renders the page again and attaches it", async () => {
		ob.loadPdfJs.mockResolvedValue(fakePdf(4, [3]).pdfjs);
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUIZ));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Slides.pdf") as any, { count: 2, figures: true });
		const path = [...app.vault.files.keys()].find((p) => p.startsWith("Uni/Logic/Quizzes/"))!;
		app.vault.files.set(path, quizMd().replace(/(output for A = 1, B = 0\?[\s\S]*?\*\*Answer:\*\*\n)/, "$10\n"));
		rendered = [];
		ob.requestUrl.mockResolvedValueOnce(
			claudeReply({ evaluations: [{ nr: 1, points: 0, error_type: "application", what_was_wrong: "x", correct: "1", reference: "", follow_up: "" }], summary: "" }),
		);
		await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
		expect(rendered).toEqual([3]);
		const c = body(1).messages[0].content;
		expect(c[0].source.data).toBe("JPEG3");
		expect(c[1].text).toBe("Figure of question 1");
	});

	it("folder quiz: one budget for all PDFs", async () => {
		await app.vault.create("Uni/Logic/More.pdf", new Uint8Array([37, 80, 68, 70]).buffer as any);
		ob.loadPdfJs.mockResolvedValue(fakePdf(12, [1, 2, 3, 4, 5, 6, 7, 8]).pdfjs);
		ob.requestUrl.mockResolvedValueOnce(claudeReply({ ...QUIZ, questions: [QUIZ.questions[1]] }));
		await plugin.createFolderQuiz(app.vault.getAbstractFileByPath("Uni/Logic") as any, { count: 1, figures: true });
		const images = body(0).messages[0].content.filter((x: any) => x.type === "image");
		expect(images).toHaveLength(MAX_FIGURE_PAGES);
		expect(ob.notices.join("\n")).toContain(`Figures: ${MAX_FIGURE_PAGES} PDF pages sent as images.`);
	});

	it("the setting sets the default of the create dialog", () => {
		plugin.settings.includeFigures = true;
		expect((plugin as any).defaultChoice().figures).toBe(true);
		plugin.settings.includeFigures = false;
		expect((plugin as any).defaultChoice().figures).toBe(false);
	});

	it("German notices", async () => {
		setLang("de");
		ob.loadPdfJs.mockResolvedValue(fakePdf(4, [2]).pdfjs);
		ob.requestUrl.mockResolvedValueOnce(claudeReply({ ...QUIZ, questions: [QUIZ.questions[1]] }));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Logic/Slides.pdf") as any, { count: 1, figures: true });
		expect(ob.notices.join("\n")).toContain("Abbildungen: 1 PDF-Seite als Bild mitgeschickt.");
	});
});
