import { beforeEach, describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import * as ob from "./fake-obsidian";
import LacunaPlugin from "../src/main";
import { setLang } from "../src/i18n";
import { computeReadiness, ratingFor, readinessLine, readinessText, timestamp } from "../src/core/readiness";
import { asReadinessInput, estimateTopicTokens, extendTopics, newSources, normalizeTopics, parseTopics, renderTopics } from "../src/core/topics";
import { parseAnswers, readConfidence, renderQuiz, setFrontmatterValue } from "../src/core/quiz-markdown";
import { schemaCreate, userPromptCreate } from "../src/core/prompts";
import { aggregate, reviewMaterial } from "../src/core/progress";
import { readDataBlock } from "../src/core/embed";
import type { Confidence, Question, QuizData } from "../src/core/types";

beforeEach(() => setLang("en"));

// ------------------------------------------------------------------ helpers

let counter = 0;
/** Build an evaluated quiz: per topic [points, max] */
function quiz(date: string, topics: Record<string, [number, number]>, extra: Partial<QuizData> = {}, confidence?: Record<string, Confidence>): QuizData {
	const questions: Question[] = [];
	const evaluations: any[] = [];
	for (const [topic, [p, m]] of Object.entries(topics)) {
		const nr = questions.length + 1;
		questions.push({ nr, type: "open", difficulty: "medium", topic, question: "?", options: [], correct: null, solution: "", reference: "" });
		evaluations.push({ nr, points: p, max: m, errorType: p < m ? "knowledge_gap" : null, whatWasWrong: "", correct: "", reference: "", followUp: "", ...(confidence?.[topic] ? { confidence: confidence[topic] } : {}) });
	}
	const points = evaluations.reduce((s, e) => s + e.points, 0);
	const max = evaluations.reduce((s, e) => s + e.max, 0);
	return {
		id: "q" + ++counter,
		title: "Q",
		source: "Subject/a.md",
		pages: "",
		created: date,
		questions,
		result: { evaluated: date, points, max, percent: Math.round((points / max) * 100), evaluations, topics: [], errorTypes: {}, summary: "" },
		...extra,
	};
}

const OPT = { target: 0.9, cap: 80 };

// ------------------------------------------------------------------ FSRS from results only

describe("review planning (FSRS) from quiz results", () => {
	it("score → rating, level shifts the thresholds", () => {
		expect(ratingFor(0.3)).toBe(Rating.Again);
		expect(ratingFor(0.5)).toBe(Rating.Hard);
		expect(ratingFor(0.8)).toBe(Rating.Good);
		expect(ratingFor(0.95)).toBe(Rating.Easy);
		expect(ratingFor(0.65, "exam")).toBe(Rating.Good); // 0.65·1.1 = 0.715
		expect(ratingFor(0.8, "intro")).toBe(Rating.Hard); // 0.8·0.85 = 0.68
	});

	it("recall decays over time, good repetitions make it more stable", () => {
		const once = [quiz("2026-10-01T10:00", { VLAN: [6, 6] })];
		const r1 = computeReadiness(once, { ...OPT, now: new Date("2026-10-01T10:00:00Z") });
		const r2 = computeReadiness(once, { ...OPT, now: new Date("2026-10-20T10:00:00Z") });
		expect(r1.topics[0].recall).toBe(1);
		expect(r2.topics[0].recall).toBeLessThan(0.9);
		expect(r2.topics[0].due).toBe(true);

		const thrice = [...once, quiz("2026-10-05T10:00", { VLAN: [6, 6] }), quiz("2026-10-12T10:00", { VLAN: [6, 6] })];
		const r3 = computeReadiness(thrice, { ...OPT, now: new Date("2026-10-20T10:00:00Z") });
		expect(r3.topics[0].recall).toBeGreaterThan(r2.topics[0].recall);
		expect(r3.topics[0].due).toBe(false);
		expect(r3.topics[0].dueOn!.getTime()).toBeGreaterThan(new Date("2026-10-20").getTime());
	});

	it("self-assessment does NOT change the plan", () => {
		const without = [quiz("2026-10-01T10:00", { VLAN: [2, 6] })];
		const withSure = [quiz("2026-10-01T10:00", { VLAN: [2, 6] }, {}, { VLAN: "sure" })];
		const now = new Date("2026-10-08T10:00:00Z");
		const a = computeReadiness(without, { ...OPT, now });
		const b = computeReadiness(withSure, { ...OPT, now });
		expect(b.topics[0].recall).toBe(a.topics[0].recall);
		expect(b.topics[0].dueOn).toEqual(a.topics[0].dueOn);
		expect(b.percent).toBe(a.percent);
		// …but it shows up as a confident error
		expect(b.topics[0].confidentErrors).toBe(1);
		expect(b.calibration.confidentErrorRate).toBe(1);
	});

	it("poor result → due again quickly", () => {
		const r = computeReadiness([quiz("2026-10-01T10:00", { VLAN: [1, 6] })], { ...OPT, now: new Date("2026-10-03T10:00:00Z") });
		expect(r.topics[0].due).toBe(true);
		expect(r.levers[0].topic).toBe("VLAN");
	});
});

// ------------------------------------------------------------------ exam readiness

describe("exam readiness", () => {
	const list = {
		subject: "Networks",
		topics: [
			{ name: "VLAN", weight: "high" as const, reference: "L2", also: ["VLAN basics"] },
			{ name: "Subnetting", weight: "high" as const, reference: "L3", also: [] },
			{ name: "History", weight: "low" as const, reference: "L1", also: [] },
		],
		sources: [],
		updated: "",
	};

	it("with topic list: untested topics count 0, weighted coverage, aliases are mapped", () => {
		const quizzes = [quiz("2026-10-05T10:00", { "VLAN basics": [6, 6] }, { level: "exam" })];
		const r = computeReadiness(quizzes, { ...OPT, now: new Date("2026-10-05T12:00:00Z"), ...asReadinessInput(list) });
		expect(r.mode).toBe("topics");
		expect(r.coverage).toBeCloseTo(3 / 7);
		expect(r.topics.find((x) => x.name === "VLAN")!.tested).toBe(true);
		expect(r.percent).toBe(43); // 3/7 · 1 · 1 · 1
		expect(r.capped).toBe(false);
		expect(r.levers[0]).toMatchObject({ topic: "Subnetting", reason: { kind: "untested" } });
	});

	it("capped without an exam-level quiz", () => {
		const quizzes = [quiz("2026-10-05T10:00", { VLAN: [6, 6], Subnetting: [6, 6], History: [6, 6] })];
		const r = computeReadiness(quizzes, { ...OPT, now: new Date("2026-10-05T12:00:00Z"), ...asReadinessInput(list) });
		expect(r.percent).toBe(80);
		expect(r.capped).toBe(true);
		const withPastExam = [{ ...quizzes[0], styleTemplate: "Past exam.pdf" }];
		expect(computeReadiness(withPastExam, { ...OPT, now: new Date("2026-10-05T12:00:00Z"), ...asReadinessInput(list) }).percent).toBe(100);
	});

	it("forecast on exam day is below today's value", () => {
		const quizzes = [quiz("2026-10-05T10:00", { VLAN: [6, 6], Subnetting: [6, 6], History: [6, 6] }, { level: "exam" })];
		const r = computeReadiness(quizzes, { ...OPT, now: new Date("2026-10-06T10:00:00Z"), exam: timestamp("2027-02-10"), ...asReadinessInput(list) });
		expect(r.daysToExam).toBe(128);
		expect(r.percentAtExam!).toBeLessThan(r.percent);
		expect(readinessText("Networks", r, 80).join("\n")).toContain("Exam in 128 days");
	});

	it("without topic list: rough coverage by files, folder quizzes cover their subfolders", () => {
		const quizzes = [quiz("2026-10-05T10:00", { A: [6, 6] }, { source: "Subject/L1.pdf", level: "exam" })];
		const files = ["Subject/L1.pdf", "Subject/L2.pdf", "Subject/Sub/L3.md", "Subject/Sub/L4.md"].map((path) => ({ path, weight: 1 }));
		const now = new Date("2026-10-05T12:00:00Z");
		const r = computeReadiness(quizzes, { ...OPT, now, files });
		expect(r.mode).toBe("files");
		expect(r.coverage).toBe(0.25);
		expect(r.percent).toBe(25);
		const folderQuiz = quiz("2026-10-05T11:00", { B: [6, 6] }, { source: "Subject/Sub", level: "exam" });
		expect(computeReadiness([...quizzes, folderQuiz], { ...OPT, now, files }).coverage).toBe(0.75);
	});

	it("line below the quiz with the change", () => {
		expect(readinessLine("Networks", 40, 47)).toBe("Exam readiness Networks: 47 % (+7 from this quiz)");
		expect(readinessLine("Networks", null, 20)).toBe("Exam readiness Networks: 20 %");
		expect(readinessLine("Networks", 50, 48)).toBe("Exam readiness Networks: 48 % (-2 from this quiz)");
		setLang("de");
		expect(readinessLine("Netze", 40, 47)).toBe("Klausurreife Netze: 47 % (+7 durch diesen Test)");
	});
});

// ------------------------------------------------------------------ topic list

describe("topic list", () => {
	const l = {
		subject: "Networks",
		topics: [
			{ name: "VLAN | Trunk", weight: "high" as const, reference: "L2.pdf p. 3", also: ["VLAN basics", "802.1Q"] },
			{ name: "Subnetting", weight: "medium" as const, reference: "", also: [] },
		],
		sources: ["Networks/L2.pdf", "Networks/L3.pdf"],
		updated: "2026-10-06",
	};

	it("round trip Markdown ↔ list, user edits are read", () => {
		const md = renderTopics(l);
		expect(md).toContain("lacuna: topics");
		const p = parseTopics(md)!;
		expect(p.topics.map((x) => x.name)).toEqual(["VLAN / Trunk", "Subnetting"]);
		expect(p.topics[0].also).toEqual(["VLAN basics", "802.1Q"]);
		expect(p.sources).toEqual(l.sources);
		const edited = md.replace("| Subnetting | medium |  |  |", "| Routing | High | L4 |  |");
		const q = parseTopics(edited)!;
		expect(q.topics.map((x) => [x.name, x.weight])).toEqual([
			["VLAN / Trunk", "high"],
			["Routing", "high"],
		]);
		expect(parseTopics("# not a topic list")).toBeNull();
	});

	it("extending only appends new topics and merges aliases", () => {
		const add = normalizeTopics({
			topics: [
				{ name: "Subnetting", weight: "high", reference: "L5", also: ["IP calculation"] },
				{ name: "OSPF", weight: "MEDIUM", reference: "L5", also: [] },
				{ name: "ospf", weight: "high", reference: "", also: ["Link state"] },
			],
		});
		expect(add).toHaveLength(2);
		expect(add[1]).toMatchObject({ name: "OSPF", weight: "high", also: ["Link state"] });
		const e = extendTopics(l, add, ["Networks/L5.pdf"], "2026-10-07");
		expect(e.topics.map((x) => x.name)).toEqual(["VLAN | Trunk", "Subnetting", "OSPF"]);
		expect(e.topics[1].weight).toBe("medium"); // the user's weight stays
		expect(e.topics[1].also).toEqual(["IP calculation"]);
		expect(e.sources).toContain("Networks/L5.pdf");
		expect(newSources(e, ["Networks/L2.pdf", "Networks/L5.pdf", "Networks/L6.pdf"])).toEqual(["Networks/L6.pdf"]);
	});

	it("cost estimate grows with volume and chunks", () => {
		expect(estimateTopicTokens({ chars: 35_000, images: 0, scanPages: 0, chunks: 1 }).input).toBe(10_900);
		const big = estimateTopicTokens({ chars: 600_000, images: 2, scanPages: 10, chunks: 3 });
		expect(big.input).toBeGreaterThan(190_000);
		expect(big.output).toBe(3 * 1800 + 2500);
	});

	it("quiz creation is bound to the topics of the list", () => {
		const s = schemaCreate(["VLAN", "Subnetting"]);
		expect(s.input_schema.properties.questions.items.properties.topic).toEqual({ type: "string", enum: ["VLAN", "Subnetting"] });
		expect((schemaCreate().input_schema.properties.questions.items.properties.topic as any).enum).toBeUndefined();
		expect(userPromptCreate({ count: 5, focus: "", topics: ["VLAN"] })).toContain('"VLAN"');
	});
});

// ------------------------------------------------------------------ confidence

describe("How sure are you?", () => {
	const questions: Question[] = [
		{ nr: 1, type: "mc", difficulty: "easy", topic: "A", question: "F1", options: ["a", "b"], correct: 1, solution: "", reference: "" },
		{ nr: 2, type: "open", difficulty: "medium", topic: "B", question: "F2", options: [], correct: null, solution: "", reference: "" },
	];
	const q = { id: "x", title: "T", source: "a.md", pages: "", created: "2026-10-06T10:00", questions } as QuizData;

	it("is only asked when enabled and read back cleanly", () => {
		expect(renderQuiz(q)).not.toContain("How sure");
		let md = renderQuiz(q, { confidence: true });
		const [a, b] = md.split("## Question 2");
		md = a.replace("- [ ] B)", "- [x] B)").replace("- [ ] unsure", "- [x] unsure") + "## Question 2" + b.replace("- [ ] sure", "- [x] sure").replace("**Answer:**\n", "**Answer:**\n- [x] guessed is just text here\nMy answer\n");
		const ans = parseAnswers(md, questions);
		expect(ans[0]).toMatchObject({ checked: [1], confidence: "unsure" });
		expect(ans[1].confidence).toBe("sure"); // text below "Answer:" does not count
		expect(ans[1].text).toContain("My answer");
	});

	it("several checks: the most cautious level counts; German words work too", () => {
		expect(readConfidence("- [x] sure\n- [X] guessed")).toBe("guessed");
		expect(readConfidence("- [x] sicher\n- [x] unsicher")).toBe("unsure");
		expect(readConfidence("- [ ] sure")).toBeNull();
	});

	it("confident errors come first in the review quiz", () => {
		const q1 = quiz("2026-10-01T10:00", { A: [0, 2], B: [0, 2] }, {}, { B: "sure" });
		const m = reviewMaterial(aggregate([q1], new Map()));
		expect(m.indexOf("· B ·")).toBeLessThan(m.indexOf("· A ·"));
		expect(m).toContain("student was SURE");
	});
});

describe("frontmatter", () => {
	it("set, change, remove a value", () => {
		const md = "---\nlacuna: progress\nscore: 50\n---\n# X";
		const a = setFrontmatterValue(md, "exam", "2027-02-10");
		expect(a).toBe("---\nlacuna: progress\nscore: 50\nexam: 2027-02-10\n---\n# X");
		expect(setFrontmatterValue(a, "exam", "2027-03-01")).toContain("exam: 2027-03-01");
		expect(setFrontmatterValue(a, "exam", null)).toBe(md);
	});
});

// ------------------------------------------------------------------ in the plugin

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

describe("exam readiness in the plugin", () => {
	let app: ob.App;
	let plugin: LacunaPlugin;
	let asked: { title: string; text: string[]; options: string[] }[];
	let answer: string | null;

	beforeEach(async () => {
		ob.requestUrl.mockReset();
		ob.notices.length = 0;
		app = new ob.App();
		plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
		await plugin.onload();
		plugin.settings.claudeKey = "sk-ant-test";
		asked = [];
		answer = "yes";
		plugin.choose = async (title, text, options) => {
			asked.push({ title, text, options: options.map((o) => o.id) });
			return answer;
		};
		await app.vault.create("Uni/Networks/L1.md", "# VLAN\n" + "VLANs separate broadcast domains. ".repeat(20));
		await app.vault.create("Uni/Networks/L2.md", "# Subnetting\n" + "Subnet mask and prefix. ".repeat(20));
	});

	const TOPICS = { topics: [{ name: "VLAN", weight: "high", reference: "L1", also: [] }, { name: "Subnetting", weight: "medium", reference: "L2", also: [] }] };
	const networks = () => app.vault.getAbstractFileByPath("Uni/Networks") as any;

	it("topic list only after confirmation with a cost estimate; 'later' and 'never' are respected", async () => {
		answer = "later";
		await plugin.topicList(networks(), false);
		expect(asked[0].title).toBe("Create topic list?");
		expect(asked[0].options).toEqual(["yes", "later", "never"]);
		expect(asked[0].text.join("\n")).toMatch(/Estimate: claude-sonnet-5-5 · [\d,]+ Tokens · approx\. \$0\.02/);
		expect(ob.requestUrl).not.toHaveBeenCalled();
		expect(app.vault.files.has("Uni/Networks/Topics.md")).toBe(false);

		answer = "never";
		await plugin.topicList(networks(), true);
		expect(plugin.settings.noTopicList).toEqual(["Uni/Networks"]);
		expect(ob.requestUrl).not.toHaveBeenCalled();

		// Progress no longer asks after "never"
		asked = [];
		await plugin.progress(networks());
		expect(asked).toHaveLength(0);
	});

	it("creates the list, quizzes use its topics, new files are added", async () => {
		ob.requestUrl.mockResolvedValueOnce(claudeReply(TOPICS));
		await plugin.topicList(networks(), true);
		expect(body(0).output_config.format.schema.properties.topics).toBeTruthy();
		expect(allTexts(0)).toContain("=== File: Uni/Networks/L1.md ===");
		const md = app.vault.files.get("Uni/Networks/Topics.md") as string;
		expect(md).toContain("| VLAN | high | L1 |  |");
		expect(md).toContain("Uni/Networks/L2.md");
		expect(app.opened).toContain("Uni/Networks/Topics.md");

		ob.requestUrl.mockResolvedValueOnce(
			claudeReply({ title: "VLAN", questions: [{ type: "open", difficulty: "medium", topic: "VLAN", question: "What is a VLAN?", options: [], correct: -1, solution: "x", reference: "L1" }] }),
		);
		await plugin.createQuiz(app.vault.getAbstractFileByPath("Uni/Networks/L1.md") as any, { count: 3, level: "exam" });
		expect(body(1).output_config.format.schema.properties.questions.items.properties.topic.enum).toEqual(["VLAN", "Subnetting"]);
		const quizPath = [...app.vault.files.keys()].find((p) => p.startsWith("Uni/Networks/Quizzes/"))!;
		expect(readDataBlock(app.vault.files.get(quizPath) as string)!.level).toBe("exam");

		await app.vault.create("Uni/Networks/L3.md", "# OSPF\n" + "Link-state routing with Dijkstra. ".repeat(20));
		asked = [];
		ob.requestUrl.mockResolvedValueOnce(claudeReply({ topics: [{ name: "OSPF", weight: "high", reference: "L3", also: [] }] }));
		await plugin.topicList(networks(), false);
		expect(asked[0].title).toBe("Extend topic list?");
		expect(asked[0].text[0]).toContain("L3.md");
		expect(allTexts(2)).toContain("L3.md");
		expect(allTexts(2)).not.toContain("=== File: Uni/Networks/L1.md");
		expect(allTexts(2)).toContain("A topic list already exists");
		expect(parseTopics(app.vault.files.get("Uni/Networks/Topics.md") as string)!.topics.map((x) => x.name)).toEqual(["VLAN", "Subnetting", "OSPF"]);
	});

	it("evaluation writes readiness with the change below the quiz; live view, exam date and status bar", async () => {
		await app.vault.create(
			"Uni/Networks/Topics.md",
			renderTopics({ subject: "Networks", topics: normalizeTopics(TOPICS), sources: ["Uni/Networks/L1.md", "Uni/Networks/L2.md"], updated: "2026-10-06" }),
		);
		const question = { type: "open", difficulty: "medium", question: "Explain.", options: [], correct: -1, solution: "x", reference: "L1" };
		const takeQuiz = async (topic: string, points: number) => {
			ob.requestUrl.mockResolvedValueOnce(claudeReply({ title: topic, questions: [{ ...question, topic }, { ...question, topic }] }));
			await plugin.createFolderQuiz(networks(), { count: 2, level: "exam" });
			const path = [...app.vault.files.keys()].filter((p) => p.startsWith("Uni/Networks/Quizzes/Folder quiz") && (app.vault.files.get(p) as string).includes("status: open"))[0];
			app.vault.files.set(path, (app.vault.files.get(path) as string).split("**Answer:**\n").join("**Answer:**\nSomething\n"));
			ob.requestUrl.mockResolvedValueOnce(
				claudeReply({ evaluations: [1, 2].map((nr) => ({ nr, points, error_type: points === 2 ? "none" : "knowledge_gap", what_was_wrong: "", correct: "", follow_up: "" })), summary: "" }),
			);
			await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
			return app.vault.files.get(path) as string;
		};

		const first = await takeQuiz("VLAN", 2);
		expect(first).toContain("**Exam readiness Networks: 40 %**"); // VLAN (weight 3) full, but only 4 of 6 points of evidence: 3·⅔ / 5
		const second = await takeQuiz("Subnetting", 1);
		expect(second).toContain("**Exam readiness Networks: 53 % (+13 from this quiz)**"); // + 2·½·⅔ of 5

		await new Promise((r) => setTimeout(r, 0));
		const el = new ob.FakeEl();
		plugin.codeBlocks.get("lacuna")("readiness\n", el, { sourcePath: "Uni/Networks/Progress.md" });
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		expect(el.text).toContain("Exam readiness Networks 53 %");
		expect(el.text).toContain("Coverage 100 %");
		expect(el.text).toContain("Subnetting – 50 % mastered");
		expect(el.text).toContain("No exam date set.");
		expect(el.all("button").map((b) => b.ownText)).toContain("Quiz on it");

		plugin.askDate = async () => "2027-02-10";
		await plugin.setExamDate(networks());
		const progress = app.vault.files.get("Uni/Networks/Progress.md") as string;
		expect(progress).toContain("exam: 2027-02-10");
		expect(progress).toContain('<div class="lacuna-static">');
		const k = await plugin.readinessData(networks());
		expect(k.exam).toBe("2027-02-10");
		expect(k.r.daysToExam).toBeGreaterThan(0);
		await plugin.progress(networks(), false);
		expect(app.vault.files.get("Uni/Networks/Progress.md")).toContain("exam: 2027-02-10");

		app.active = app.vault.getAbstractFileByPath("Uni/Networks/L1.md") as any;
		await plugin.updateStatus();
		expect(plugin.statusBar[0].ownText).toBe("🎓 Networks: 53 %");
	});
});
