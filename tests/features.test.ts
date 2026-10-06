import { beforeEach, describe, expect, it } from "vitest";
import * as ob from "./fake-obsidian";
import LacunaPlugin from "../src/main";
import { setLang } from "../src/i18n";
import { dataBlock, readDataBlock, withDataBlock, withoutDataBlock } from "../src/core/embed";
import { findPastExams } from "../src/sources";
import { renderQuiz } from "../src/core/quiz-markdown";

const QUESTIONS = {
	title: "VLANs",
	questions: [
		{ type: "mc", difficulty: "easy", topic: "Basics", question: "What does a VLAN do?", options: ["Routing", "Separates broadcast domains", "Encrypts", "DHCP"], correct: 1, solution: "Separates broadcast domains.", reference: "p. 1" },
		{ type: "open", difficulty: "hard", topic: "Routing", question: "Explain router-on-a-stick.", options: [], correct: -1, solution: "Subinterfaces with dot1q.", reference: "p. 3" },
	],
};
const claudeReply = (input: any, usage = { input_tokens: 1000, output_tokens: 500 }) => ({
	status: 200,
	json: { stop_reason: "end_turn", usage, content: [{ type: "text", text: JSON.stringify(input) }] },
	text: "",
});
const body = (i: number) => JSON.parse(ob.requestUrl.mock.calls[i][0].body);
const allTexts = (i: number) =>
	body(i)
		.messages[0].content.filter((c: any) => c.type === "text")
		.map((c: any) => c.text)
		.join("\n");
const filesUnder = (app: ob.App, p: string) => [...app.vault.files.keys()].filter((x) => x.startsWith(p));

let app: ob.App;
let plugin: LacunaPlugin;

beforeEach(async () => {
	setLang("en");
	ob.requestUrl.mockReset();
	ob.loadPdfJs.mockReset();
	ob.notices.length = 0;
	app = new ob.App();
	plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
	await plugin.onload();
	plugin.settings.claudeKey = "sk-ant-test";
	plugin.choose = async () => "later";
	await app.vault.create("Uni/Networks/Chapter 1.md", "# VLANs\n" + "A VLAN separates broadcast domains. ".repeat(10));
	await app.vault.create("Uni/Networks/Chapter 2.md", "# Trunking\n" + "802.1Q tag with a 12-bit VLAN ID. ".repeat(10));
	await app.vault.create("Uni/Networks/Past exam WS24.md", "Task 1 (8 points): Explain … ".repeat(5));
	await app.vault.create("Uni/Networks/Quizzes/old quiz.md", "---\nlacuna: quiz\nid: x\n---\n# old");
	await app.vault.create("Uni/Networks/Progress.md", "---\nlacuna: progress\n---\n# Progress");
	await app.vault.create("Uni/Math/Exam SS25.md", "Math exam ".repeat(20));
});

describe("1. solutions inside the quiz note", () => {
	it("data block: round trip with umlauts, remove, replace", () => {
		const q = { id: "a", title: "Übung ÄÖÜß ✓", source: "x.md", pages: "", created: "2026", questions: [] } as any;
		const md = "# Quiz\n\nText\n\n" + dataBlock(q) + "\n";
		expect(readDataBlock(md)?.title).toBe("Übung ÄÖÜß ✓");
		expect(md).not.toContain("Übung ÄÖÜß"); // not in plain text
		expect(withoutDataBlock(md).trim()).toBe("# Quiz\n\nText");
		const next = withDataBlock(md, { ...q, title: "new" });
		expect(readDataBlock(next)?.title).toBe("new");
		expect(next.match(/%%lacuna-data/g)).toHaveLength(1);
		expect(readDataBlock("%%lacuna-data\nbroken!!\n%%")).toBeNull();
		expect(readDataBlock("no block")).toBeNull();
	});

	it("very old Skript-Check quizzes (solutions in the plugin folder) can still be evaluated", async () => {
		const old = { id: "old1", titel: "Alt", quelle: "Uni/Networks/Chapter 1.md", seiten: "", erstellt: "2026-10-01T10:00", fragen: [{ nr: 1, typ: "mc", schwierigkeit: "leicht", thema: "G", frage: "F?", optionen: ["a", "b"], richtig: 0, loesung: "a", fundstelle: "" }] };
		await app.vault.adapter.write(".obsidian/plugins/skript-check/tests/old1.json", JSON.stringify(old));
		const md = "---\nskript-check: test\nid: old1\nstatus: offen\n---\n\n## Frage 1 · leicht · G\n\nF?\n\n- [x] A) a\n- [ ] B) b\n";
		const f = await app.vault.create("Uni/Networks/Tests/Alt.md", md);
		await plugin.evaluate(f);
		const next = app.vault.files.get("Uni/Networks/Tests/Alt.md") as string;
		expect(next).toContain("status: evaluated");
		expect(readDataBlock(next)?.result?.percent).toBe(100);
		expect(ob.requestUrl).not.toHaveBeenCalled(); // MC correct: no AI needed
	});
});

describe("2. quiz from a folder", () => {
	it("uses all sources except quizzes, progress and plugin notes", async () => {
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUESTIONS));
		await plugin.createFolderQuiz(app.vault.getAbstractFileByPath("Uni/Networks") as any, { count: 12 });
		const text = allTexts(0);
		expect(text).toContain("=== File: Uni/Networks/Chapter 1.md ===");
		expect(text).toContain("=== File: Uni/Networks/Chapter 2.md ===");
		expect(text).not.toContain("Quizzes/old quiz.md");
		expect(text).not.toContain("Progress.md");
		expect(text).toContain("several files");
		const created = filesUnder(app, "Uni/Networks/Quizzes/Folder quiz Networks");
		expect(created).toHaveLength(1);
		expect(app.vault.files.get(created[0])).toContain('source: "Folder Uni/Networks"');
	});

	it("empty folder: notice instead of a request", async () => {
		await app.vault.createFolder("Uni/Empty");
		await plugin.openFolderDialog(app.vault.getAbstractFileByPath("Uni/Empty") as any);
		expect(ob.requestUrl).not.toHaveBeenCalled();
		expect(ob.notices.join("\n")).toContain("contains no notes");
	});
});

describe("3./4. past exam and level", () => {
	it("finds past exams, subject folder first", () => {
		const k = findPastExams(app as any, app.vault.getAbstractFileByPath("Uni/Networks") as any).map((f) => f.path);
		expect(k).toEqual(["Uni/Networks/Past exam WS24.md", "Uni/Math/Exam SS25.md"]);
	});

	it("style template and level go into the prompt, the template is remembered and not used as source", async () => {
		ob.requestUrl.mockResolvedValue(claudeReply(QUESTIONS));
		await plugin.createFolderQuiz(app.vault.getAbstractFileByPath("Uni/Networks") as any, { count: 6, level: "exam", styleTemplate: "Uni/Networks/Past exam WS24.md" });
		const c = body(0).messages[0].content;
		expect(c[0].text).toContain('STYLE TEMPLATE (past exam "Past exam WS24.md")');
		const text = allTexts(0);
		expect(text).toContain("A PAST EXAM is attached as STYLE TEMPLATE");
		expect(text).toContain("Level exam");
		expect(text).not.toContain("=== File: Uni/Networks/Past exam WS24.md");
		expect(plugin.settings.styleTemplates["Uni/Networks"]).toBe("Uni/Networks/Past exam WS24.md");
		const created = filesUnder(app, "Uni/Networks/Quizzes/Folder quiz");
		expect(app.vault.files.get(created[0])).toContain("Style template: [[Uni/Networks/Past exam WS24.md|Past exam WS24.md]]");

		// Level intro, no template
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 1.md") as any, { count: 4, level: "intro", styleTemplate: "" });
		expect(allTexts(1)).toContain("Level intro");
		expect(allTexts(1)).not.toContain("STYLE TEMPLATE");
		expect(plugin.settings.styleTemplates["Uni/Networks"]).toBeUndefined();
	});
});

describe("5./6. follow-up round and cost", () => {
	it("cost is shown and summed up; follow-up round without an AI call", async () => {
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUESTIONS, { input_tokens: 20000, output_tokens: 3000 }));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 1.md") as any, { count: 2 });
		const path = filesUnder(app, "Uni/Networks/Quizzes/VLANs – Quiz")[0];
		let md = app.vault.files.get(path) as string;
		// 20000*2 + 3000*10 = 70000 / 1e6 = $0.07
		expect(md).toContain("AI usage: claude-sonnet-5-5 · 23,000 Tokens · approx. $0.07");

		md = md.replace("- [ ] A) Routing", "- [x] A) Routing").replace("**Answer:**\n", "**Answer:**\nno idea, something with a router\n");
		app.vault.files.set(path, md);
		ob.requestUrl.mockResolvedValueOnce(
			claudeReply(
				{
					evaluations: [
						{ nr: 1, points: 0, error_type: "confusion", what_was_wrong: "Routing is layer 3.", correct: "A VLAN separates broadcast domains.", reference: "p. 1", follow_up: "On which layer does a VLAN work?" },
						{ nr: 2, points: 0.5, error_type: "knowledge_gap", what_was_wrong: "No mechanism named.", correct: "Subinterfaces with encapsulation dot1q.", reference: "p. 3", follow_up: "Which command assigns a subinterface to a VLAN?" },
					],
					summary: "Basics are missing.",
				},
				{ input_tokens: 5000, output_tokens: 1000 },
			),
		);
		await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
		md = app.vault.files.get(path) as string;
		// 0.07 + (5000*2 + 1000*10)/1e6 = 0.07 + 0.02 = 0.09
		expect(md).toContain("29,000 Tokens · approx. $0.09");
		expect(md).toContain("## Follow-up round");
		expect(md).toContain("```lacuna\nfollow-up\n```");

		await plugin.followUp(app.vault.getAbstractFileByPath(path) as any);
		expect(ob.requestUrl).toHaveBeenCalledTimes(2); // no further AI call
		const fu = filesUnder(app, "Uni/Networks/Quizzes/Follow-up – VLANs");
		expect(fu).toHaveLength(1);
		const fumd = app.vault.files.get(fu[0]) as string;
		expect(fumd).toContain("On which layer does a VLAN work?");
		expect(fumd).toContain("Which command assigns a subinterface");
		expect(fumd).not.toMatch(/- \[ \] [A-F]\)/); // open questions only
		expect(readDataBlock(fumd)!.questions[1].solution).toContain("encapsulation dot1q");
	});
});

describe("7. language", () => {
	it("German UI: German notes, buttons and file names", async () => {
		setLang("de");
		ob.requestUrl.mockResolvedValueOnce(claudeReply(QUESTIONS));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 1.md") as any, { count: 2 });
		const path = filesUnder(app, "Uni/Networks/Quizzes/VLANs – Test")[0];
		const md = app.vault.files.get(path) as string;
		expect(md).toContain("# Test: VLANs");
		expect(md).toContain("*Wie sicher bist du?*");
		expect(md).toContain("## Auswerten");
		expect(ob.notices.join("\n")).toContain("Test mit 2 Fragen erstellt");

		const el = new ob.FakeEl();
		plugin.codeBlocks.get("lacuna")("evaluate\n", el, { sourcePath: path });
		expect(el.all("button")[0].ownText).toBe("Auswerten");
	});

	it("the empty quiz renders without the confidence block when disabled", () => {
		plugin.settings.askConfidence = false;
		const md = renderQuiz({ id: "x", title: "T", source: "a.md", pages: "", created: "", questions: [] });
		expect(md).not.toContain("How sure");
	});
});
