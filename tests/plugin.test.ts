import { beforeEach, describe, expect, it } from "vitest";
import * as ob from "./fake-obsidian";
import LacunaPlugin from "../src/main";

function aiReply(input: any) {
	return { status: 200, json: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(input) }] }, text: "" };
}

const QUESTIONS = {
	title: "VLANs and trunking",
	questions: [
		{ type: "mc", difficulty: "easy", topic: "VLAN basics", question: "What does a VLAN do?", options: ["Routing", "Separates broadcast domains", "Encrypts", "DHCP"], correct: 1, solution: "Separates broadcast domains.", reference: "Section 1" },
		{ type: "open", difficulty: "hard", topic: "Inter-VLAN routing", question: "Explain router-on-a-stick.", solution: "Subinterfaces with encapsulation dot1q.", reference: "Section 3" },
		{ type: "mc", difficulty: "medium", topic: "802.1Q tagging", question: "How long is the VLAN ID?", options: ["8 bit", "12 bit", "16 bit", "32 bit"], correct: 1, solution: "12 bit.", reference: "Section 2" },
	],
};

let app: ob.App;
let plugin: LacunaPlugin;
const paths = () => [...app.vault.files.keys()];
const quizPaths = () => paths().filter((p) => p.startsWith("Uni/Networks/Quizzes/"));

beforeEach(async () => {
	ob.requestUrl.mockReset();
	ob.notices.length = 0;
	app = new ob.App();
	plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
	await plugin.onload();
	plugin.settings.claudeKey = "sk-ant-test";
	plugin.choose = async () => "later";
	await app.vault.create("Uni/Networks/Chapter 4.md", "# VLANs\n" + "A VLAN separates broadcast domains. ".repeat(10) + "\n![[board.png]]");
	await app.vault.create("Uni/Networks/images/board.png", new Uint8Array([1, 2, 3]).buffer as any);
});

describe("full flow", () => {
	it("creates, evaluates, builds progress and review", async () => {
		// 1) Create
		ob.requestUrl.mockResolvedValueOnce(aiReply(QUESTIONS));
		const source = app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any;
		await plugin.createQuiz(source, { count: 3 });

		const req = JSON.parse(ob.requestUrl.mock.calls[0][0].body);
		expect(ob.requestUrl.mock.calls[0][0].headers["x-api-key"]).toBe("sk-ant-test");
		expect(req.model).toBe("claude-sonnet-5-5");
		expect(req.tool_choice).toBeUndefined();
		const schema = req.output_config.format.schema;
		expect(req.output_config.format.type).toBe("json_schema");
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties.questions.items.required).toContain("correct");
		expect(req.system).toContain("SAME language as the source material");
		expect(req.messages[0].content[0].type).toBe("image"); // embedded image is sent
		expect(req.messages[0].content[1].text).toContain("A VLAN separates");

		const quizPath = quizPaths()[0];
		expect(quizPath).toMatch(/VLANs and trunking – Quiz /);
		expect(app.opened).toContain(quizPath);
		expect(paths().filter((p) => p.startsWith(".obsidian/"))).toHaveLength(0); // nothing in the plugin folder
		let md = app.vault.files.get(quizPath) as string;
		expect(md).toContain("%%lacuna-data");
		expect(md).not.toContain("Subinterfaces with encapsulation"); // solution not visible

		// 2) Answer (MC1 correct + "guessed", open question, MC3 wrong but "sure")
		expect(md).toContain("*How sure are you?*\n- [ ] guessed\n- [ ] unsure\n- [ ] sure");
		const [before3, from3] = md.split("## Question 3");
		md =
			before3
				.replace("- [ ] B) Separates broadcast domains", "- [x] B) Separates broadcast domains")
				.replace("- [ ] guessed", "- [x] guessed")
				.replace("**Answer:**\n", "**Answer:**\nA router with several subinterfaces.\n") +
			"## Question 3" +
			from3.replace("- [ ] A) 8 bit", "- [x] A) 8 bit").replace("- [ ] sure", "- [x] sure");
		app.vault.files.set(quizPath, md);

		// 3) Evaluate
		ob.requestUrl.mockResolvedValueOnce(
			aiReply({
				evaluations: [
					{ nr: 2, points: 2, error_type: "incomplete", what_was_wrong: "dot1q encapsulation missing.", correct: "One subinterface per VLAN with encapsulation dot1q <ID>.", reference: "Section 3", follow_up: "Which command assigns a subinterface to a VLAN?" },
					{ nr: 3, points: 2, error_type: "confusion", what_was_wrong: "8 bit confused with …", correct: "12 bit.", reference: "Section 2", follow_up: "How many VLAN IDs does that give?" },
				],
				summary: "Configuration details are missing.",
			}),
		);
		const quizFile = app.vault.getAbstractFileByPath(quizPath) as any;
		await plugin.evaluate(quizFile);

		const evalReq = JSON.parse(ob.requestUrl.mock.calls[1][0].body);
		const items = JSON.parse(evalReq.messages[0].content[0].text.split("with the student's answers:\n")[1]);
		expect(items.map((i: any) => i.nr)).toEqual([2, 3]); // correct MC is not sent

		md = app.vault.files.get(quizPath) as string;
		expect(md).toContain("status: evaluated");
		expect(md).toContain("Result: 3 / 6 points (50 %)"); // 1 + 2 + 0
		expect(md).toContain("> [!warning] 2/3 · Incomplete");
		expect(md).toContain("**Follow-up:** Which command");
		expect(md).toContain("A router with several subinterfaces.");
		expect(md).toContain("> [!success] Correct · you were: guessed");
		expect(md).toContain("0/2 · Confusion · ⚠️ sure but wrong");
		expect(md).toContain("**Self-assessment:** sure 0/1 correct · guessed 1/1 correct · ⚠️ 1× sure but wrong");
		expect(md).toMatch(/\*\*Exam readiness Networks: \d+ %\*\*/); // first quiz: no "before" value yet
		expect(md).not.toContain("How sure are you?");

		// Evaluating twice is prevented
		await plugin.evaluate(quizFile);
		expect(ob.requestUrl).toHaveBeenCalledTimes(2);

		// 4) Progress (already created in the background without AI)
		await new Promise((r) => setTimeout(r, 0));
		expect(app.vault.files.get("Uni/Networks/Progress.md")).toContain("# Progress: Networks");

		ob.requestUrl.mockResolvedValueOnce(aiReply({ patterns: [{ title: "Configuration details missing", description: "dot1q missing for router-on-a-stick." }], recommendation: "Practice the commands." }));
		await plugin.progress(plugin.subjectFolder(quizFile));
		const progress = app.vault.files.get("Uni/Networks/Progress.md") as string;
		expect(progress).toContain("**Configuration details missing:**");
		expect(progress).toContain("| Inter-VLAN routing | 67 %");
		expect(progress).toContain("| 802.1Q tagging ⚠️ | 0 %"); // sure but wrong
		expect(progress).toContain("## Exam readiness");
		expect(progress).toContain("```lacuna\nreadiness\n```");
		expect(progress).toContain("| sure | 1 | 0 % |");

		// Progress without AI keeps the patterns
		await plugin.progress(plugin.subjectFolder(quizFile), false);
		expect(app.vault.files.get("Uni/Networks/Progress.md")).toContain("**Configuration details missing:**");
		expect(app.vault.files.get("Uni/Networks/Progress.md")).toContain("Practice the commands.");

		// 5) Review: confident errors first
		ob.requestUrl.mockResolvedValueOnce(aiReply({ title: "802.1Q and subinterfaces", questions: QUESTIONS.questions.slice(1) }));
		await plugin.review(plugin.subjectFolder(quizFile));
		const reviewReq = JSON.parse(ob.requestUrl.mock.calls[3][0].body);
		const material = reviewReq.messages[0].content[0].text;
		expect(material).toContain("dot1q encapsulation missing.");
		expect(material.indexOf("student was SURE")).toBeLessThan(material.indexOf("dot1q encapsulation missing."));
		const reviewPath = paths().find((p) => p.includes("Quizzes/Review Networks"));
		expect(reviewPath).toBeTruthy();
		expect(app.vault.files.get(reviewPath!)).toContain("# Quiz: Review: 802.1Q and subinterfaces");
	});

	it("reports missing credit clearly", async () => {
		ob.requestUrl.mockResolvedValueOnce({ status: 400, json: { error: { message: "Your credit balance is too low" } }, text: "" });
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any, { count: 3 });
		expect(ob.notices.join("\n")).toContain("No credit");
		expect(quizPaths()).toHaveLength(0);
	});

	it("workspace header and a clear workspace error", async () => {
		ob.requestUrl.mockResolvedValueOnce({ status: 400, json: { error: { message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header" } }, text: "" });
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any, { count: 3 });
		expect(ob.requestUrl.mock.calls[0][0].headers["anthropic-workspace-id"]).toBeUndefined();
		expect(ob.notices.join("\n")).toContain("not assigned to a workspace");

		plugin.settings.workspaceId = " wrkspc_01ABC ";
		ob.requestUrl.mockResolvedValueOnce(aiReply(QUESTIONS));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any, { count: 3 });
		expect(ob.requestUrl.mock.calls[1][0].headers["anthropic-workspace-id"]).toBe("wrkspc_01ABC");
	});

	it("falls back to no output_config if the model does not support it", async () => {
		ob.requestUrl.mockResolvedValueOnce({ status: 400, json: { error: { message: "output_config.format is not supported for this model" } }, text: "" });
		ob.requestUrl.mockResolvedValueOnce({ status: 200, json: { stop_reason: "end_turn", content: [{ type: "text", text: "```json\n" + JSON.stringify(QUESTIONS) + "\n```" }] }, text: "" });
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any, { count: 3 });
		const second = JSON.parse(ob.requestUrl.mock.calls[1][0].body);
		expect(second.output_config).toBeUndefined();
		expect(second.messages[0].content.at(-1).text).toContain("JSON object");
		expect(quizPaths()).toHaveLength(1);
	});

	it("question types: MC only, open only, mixed", async () => {
		const src = () => app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any;
		ob.requestUrl.mockResolvedValue(aiReply(QUESTIONS));
		await plugin.createQuiz(src(), { count: 5, questionTypes: "mc" });
		await plugin.createQuiz(src(), { count: 5, questionTypes: "open" });
		await plugin.createQuiz(src(), { count: 5 });
		const prompt = (i: number) => JSON.parse(ob.requestUrl.mock.calls[i][0].body).messages[0].content.at(-1).text;
		expect(prompt(0)).toContain("ALL questions as multiple choice");
		expect(prompt(1)).toContain("NO multiple-choice questions");
		expect(prompt(2)).not.toMatch(/ALL questions as multiple choice|NO multiple-choice/);

		// With "open only" no checkbox may end up in the quiz even if the AI returns MC
		const notes = quizPaths().map((p) => app.vault.files.get(p) as string);
		expect(notes.filter((x) => !x.includes("- [ ] A)"))).toHaveLength(1);
	});

	it("with Gemini: right endpoint, key and status notice", async () => {
		plugin.settings.provider = "gemini";
		plugin.settings.geminiKey = "gemini-test-key";
		ob.requestUrl.mockResolvedValueOnce({ status: 200, json: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(QUESTIONS) }] } }] }, text: "" });
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any, { count: 3 });
		const call = ob.requestUrl.mock.calls[0][0];
		expect(call.url).toContain("generativelanguage.googleapis.com");
		expect(call.url).toContain("gemini-3.8-flash");
		expect(call.headers["x-goog-api-key"]).toBe("gemini-test-key");
		expect(ob.notices.join("\n")).toContain("Gemini is writing 3 questions");
		expect(quizPaths()).toHaveLength(1);
	});

	it("ChatGPT without key: notice instead of a request", async () => {
		plugin.settings.provider = "openai";
		await plugin.openCreateDialog(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any);
		expect(ob.requestUrl).not.toHaveBeenCalled();
		expect(ob.notices.join("\n")).toContain("ChatGPT (OpenAI)");
	});

	it("an empty quiz is not evaluated", async () => {
		ob.requestUrl.mockResolvedValueOnce(aiReply(QUESTIONS));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/Chapter 4.md") as any, { count: 3 });
		await plugin.evaluate(app.vault.getAbstractFileByPath(quizPaths()[0]) as any);
		expect(ob.requestUrl).toHaveBeenCalledTimes(1);
		expect(ob.notices.join("\n")).toContain("not answered anything");
	});

	it("PDF: page range with page markers, scanned fallback as document", async () => {
		const pageText: Record<number, string> = { 1: "Title slide", 2: "VLAN basics ".repeat(20), 3: "Trunking 802.1Q ".repeat(20) };
		ob.loadPdfJs.mockResolvedValue({
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: 3,
					getPage: async (n: number) => ({ getTextContent: async () => ({ items: [{ str: pageText[n], hasEOL: true }] }) }),
					destroy: async () => {},
				}),
			}),
		});
		await app.vault.create("Uni/Networks/script.pdf", new Uint8Array([37, 80, 68, 70]).buffer as any);
		ob.requestUrl.mockResolvedValueOnce(aiReply(QUESTIONS));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/script.pdf") as any, { count: 3, pages: "2-3" });
		const text = JSON.parse(ob.requestUrl.mock.calls[0][0].body).messages[0].content[0].text;
		expect(text).toContain("[Page 2]");
		expect(text).toContain("[Page 3]");
		expect(text).not.toContain("Title slide");
		expect(app.vault.files.get(quizPaths()[0])).toContain('pages: "2-3"');

		// Scanned: hardly any text -> whole PDF as document
		pageText[2] = "";
		pageText[3] = "";
		ob.requestUrl.mockResolvedValueOnce(aiReply(QUESTIONS));
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/script.pdf") as any, { count: 3, pages: "2-3" });
		const c = JSON.parse(ob.requestUrl.mock.calls[1][0].body).messages[0].content;
		expect(c[0].type).toBe("document");
		expect(c[1].text).toContain("only use pages 2-3");
	});
});
