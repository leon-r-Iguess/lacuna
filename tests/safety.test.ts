// Lacuna must never destroy something the learner wrote.
import { beforeEach, describe, expect, it } from "vitest";
import * as ob from "./fake-obsidian";
import LacunaPlugin from "../src/main";
import { lang, setLang } from "../src/i18n";
import { keepUserFrontmatter, frontmatterValue, isEvaluatedNote, setFrontmatterValue } from "../src/core/quiz-markdown";
import { lenientMatch } from "../src/core/readiness";
import { normWeight, parseTopics, renderTopics, splitRow, updateTopicsMarkdown } from "../src/core/topics";
import { normalizeQuestions } from "../src/core/prompts";
import { imageEmbeds } from "../src/core/util";

const reply = (input: any) => ({ status: 200, json: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(input) }] }, text: "" });
const QUESTIONS = {
	title: "VLANs",
	questions: [{ type: "open", difficulty: "medium", topic: "VLAN", question: "What is a VLAN?", options: [], correct: -1, solution: "x", reference: "p. 1" }],
};

let app: ob.App;
let plugin: LacunaPlugin;

beforeEach(async () => {
	setLang("en");
	ob.requestUrl.mockReset();
	ob.notices.length = 0;
	app = new ob.App();
	plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
	await plugin.onload();
	plugin.settings.claudeKey = "sk-ant-test";
	plugin.choose = async () => "yes";
	await app.vault.create("Uni/Networks/L1.md", "# VLAN\n" + "VLANs separate broadcast domains. ".repeat(20));
});

const networks = () => app.vault.getAbstractFileByPath("Uni/Networks") as any;

async function createAndAnswer(): Promise<string> {
	ob.requestUrl.mockResolvedValueOnce(reply(QUESTIONS));
	await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/L1.md") as any, { count: 1 });
	const path = [...app.vault.files.keys()].find((p) => p.startsWith("Uni/Networks/Quizzes/"))!;
	app.vault.files.set(path, (app.vault.files.get(path) as string).replace("**Answer:**\n", "**Answer:**\nA virtual LAN.\n"));
	return path;
}

describe("own notes with the same name are never overwritten", () => {
	it("progress note", async () => {
		await app.vault.create("Uni/Networks/Progress.md", "# My own progress diary\nDo not lose me.");
		await plugin.progress(networks(), true, true);
		expect(app.vault.files.get("Uni/Networks/Progress.md")).toBe("# My own progress diary\nDo not lose me.");
		expect(ob.notices.join("\n")).toContain("is not a Lacuna note");

		// also not by the exam date or in the background after an evaluation
		plugin.askDate = async () => "2027-02-10";
		await plugin.setExamDate(networks());
		const path = await createAndAnswer();
		ob.requestUrl.mockResolvedValueOnce(reply({ evaluations: [{ nr: 1, points: 2, error_type: "none", what_was_wrong: "", correct: "", follow_up: "" }], summary: "" }));
		await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
		await new Promise((r) => setTimeout(r, 0));
		expect(app.vault.files.get("Uni/Networks/Progress.md")).toBe("# My own progress diary\nDo not lose me.");
	});

	it("topic list", async () => {
		await app.vault.create("Uni/Networks/Topics.md", "# Topics I still have to ask the professor about");
		await plugin.topicList(networks(), true);
		expect(app.vault.files.get("Uni/Networks/Topics.md")).toBe("# Topics I still have to ask the professor about");
		expect(ob.requestUrl).not.toHaveBeenCalled();
		expect(ob.notices.join("\n")).toContain("is not a Lacuna note");
	});
});

describe("evaluation", () => {
	it("does not overwrite answers changed while the AI was grading", async () => {
		const path = await createAndAnswer();
		ob.requestUrl.mockImplementationOnce(async () => {
			// the learner keeps typing while the request runs
			app.vault.files.set(path, (app.vault.files.get(path) as string).replace("A virtual LAN.", "A virtual LAN that separates broadcast domains."));
			return reply({ evaluations: [{ nr: 1, points: 1, error_type: "incomplete", what_was_wrong: "x", correct: "y", follow_up: "z" }], summary: "" });
		});
		await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
		const md = app.vault.files.get(path) as string;
		expect(md).toContain("A virtual LAN that separates broadcast domains.");
		expect(md).toContain("status: open");
		expect(ob.notices.join("\n")).toContain("changed your answers while the quiz was being evaluated");
	});

	it("keeps the learner's own frontmatter (tags, aliases)", async () => {
		const path = await createAndAnswer();
		app.vault.files.set(path, setFrontmatterValue(app.vault.files.get(path) as string, "tags", "[networks, exam]"));
		ob.requestUrl.mockResolvedValueOnce(reply({ evaluations: [{ nr: 1, points: 2, error_type: "none", what_was_wrong: "", correct: "", follow_up: "" }], summary: "" }));
		await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
		const md = app.vault.files.get(path) as string;
		expect(frontmatterValue(md, "status")).toBe("evaluated");
		expect(frontmatterValue(md, "tags")).toBe("[networks, exam]");
	});
});

describe("topic list updates keep the learner's edits", () => {
	it("extending changes only the table and the sources", () => {
		const base = renderTopics({ subject: "Networks", topics: [{ name: "VLAN", weight: "high", reference: "L1", also: [] }], sources: ["a.md"], updated: "2026-10-01" });
		const edited = base
			.replace("| Topic | Weight | Reference | Also |", "| Topic | Weight | Reference | Also | My notes |")
			.replace("|---|---|---|---|", "|---|---|---|---|---|")
			.replace("| VLAN | high | L1 |  |", "| VLAN | high | [[L1.pdf|Lecture 1]] |  | ask about QinQ |")
			.replace("# Topic list: Networks", "# Topic list: Networks\n\nMy own intro text.");
		const list = parseTopics(edited)!;
		expect(list.topics[0].reference).toBe("[[L1.pdf|Lecture 1]]");
		const next = { ...list, topics: [{ ...list.topics[0], also: ["VLAN basics"] }, { name: "OSPF", weight: "medium" as const, reference: "L3", also: [] }], sources: ["a.md", "b.md"], updated: "2026-10-07" };
		const md = updateTopicsMarkdown(edited, next);
		expect(md).toContain("My own intro text.");
		expect(md).toContain("| VLAN | high | [[L1.pdf|Lecture 1]] | VLAN basics | ask about QinQ |");
		expect(md).toContain("| OSPF | medium | L3 |  |");
		expect(md).toContain("a.md\nb.md\n%%");
		expect(frontmatterValue(md, "updated")).toBe("2026-10-07");
		expect(parseTopics(md)!.topics.map((x) => x.name)).toEqual(["VLAN", "OSPF"]);
	});

	it("table cells with links and escaped pipes", () => {
		expect(splitRow("| [[a|b]] | x \\| y | z |")).toEqual(["[[a|b]]", "x \\| y", "z"]);
		expect(normWeight("normal")).toBe("medium");
		expect(normWeight("niedrig")).toBe("low");
		expect(normWeight("Hoch")).toBe("high");
	});
});

describe("smaller fixes", () => {
	it("topic matching uses whole words and refuses ambiguous matches", () => {
		const list = new Map([
			["ip", "IP"],
			["compression", "Compression"],
			["static routing", "Static routing"],
			["dynamic routing", "Dynamic routing"],
			["vlan", "VLAN"],
		]);
		expect(lenientMatch("zip compression", list)).toBe("Compression");
		expect(lenientMatch("routing", list)).toBeNull();
		expect(lenientMatch("vlan tagging", list)).toBe("VLAN");
	});

	it("unknown language values fall back instead of breaking startup", () => {
		setLang("fr");
		expect(["en", "de"]).toContain(lang());
	});

	it("frontmatter with Windows line endings and empty frontmatter", () => {
		expect(isEvaluatedNote("---\r\nstatus: evaluated\r\n---\r\n# X")).toBe(true);
		expect(setFrontmatterValue("---\n---\n# X", "exam", "2027-01-01")).toBe("---\nexam: 2027-01-01\n---\n# X");
		expect(setFrontmatterValue("---\r\na: 1\r\n---\r\n# X", "b", "2")).toBe("---\na: 1\nb: 2\n---\n# X");
		expect(keepUserFrontmatter("---\ntags:\n  - a\n  - b\nstatus: open\n---\nx", "---\nstatus: evaluated\n---\ny", ["status"])).toBe(
			"---\nstatus: evaluated\ntags:\n  - a\n  - b\n---\ny",
		);
	});

	it("MC with more than six options keeps a valid correct answer; % in image names", () => {
		const { questions } = normalizeQuestions({ questions: [{ type: "mc", question: "?", options: ["a", "b", "c", "d", "e", "f", "g", "h"], correct: 7, solution: "" }] });
		expect(questions[0].type).toBe("open"); // correct option would be cut off -> asked open instead
		expect(imageEmbeds("![x](result_100%.png)")).toEqual(["result_100%.png"]);
	});

	it("saves settings on first start so folder names do not change with the language later", () => {
		expect(plugin.data).toMatchObject({ quizFolder: "Quizzes", progressName: "Progress" });
	});
});
