// Lacuna must keep working with everything Skript-Check (its German predecessor) left in a vault.
// The fixtures were generated with the original Skript-Check 0.4 code.
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as ob from "./fake-obsidian";
import LacunaPlugin from "../src/main";
import { setLang } from "../src/i18n";
import { readDataBlock } from "../src/core/embed";
import { fromLegacy, settingsFromLegacy } from "../src/core/legacy";
import { parseAnswers } from "../src/core/quiz-markdown";
import { parseTopics } from "../src/core/topics";
import { readPatterns } from "../src/core/progress";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

beforeEach(() => setLang("en"));

describe("old data", () => {
	it("reads the German data block and converts every field", () => {
		const q = readDataBlock(fixture("skript-check-ausgewertet.md"))!;
		expect(q.title).toBe("VLANs");
		expect(q.source).toBe("Uni/Netze/Kapitel 4.md");
		expect(q.level).toBe("exam");
		expect(q.cost).toMatchObject({ model: "claude-sonnet-5-5", provider: "claude", usd: 0.07 });
		expect(q.questions[0]).toMatchObject({ type: "mc", difficulty: "easy", topic: "VLAN-Grundlagen", correct: 1, reference: "Seite 3" });
		expect(q.questions[1]).toMatchObject({ type: "open", difficulty: "hard", correct: null });
		expect(q.answers![0]).toMatchObject({ checked: [1], confidence: "sure" });
		expect(q.result!.percent).toBe(50);
		expect(q.result!.evaluations[1]).toMatchObject({ points: 1, errorType: "incomplete", whatWasWrong: "dot1q fehlt", followUp: "Welcher Befehl?", confidence: "unsure" });
		expect(q.result!.errorTypes).toEqual({ incomplete: 1 });
		expect(q.result!.topics[0]).toMatchObject({ topic: "VLAN-Grundlagen", percent: 100 });
	});

	it("reads answers and German confidence words from an unevaluated German quiz", () => {
		const md = fixture("skript-check-offen.md");
		const q = readDataBlock(md)!;
		const a = parseAnswers(md, q.questions);
		expect(a[0]).toMatchObject({ checked: [1], confidence: "sure" });
		expect(a[1]).toMatchObject({ text: "Ein Router mit Subinterfaces.", confidence: "unsure" });
	});

	it("reads the German topic list including weights and aliases", () => {
		const l = parseTopics(fixture("skript-check-themen.md"))!;
		expect(l.subject).toBe("Netze");
		expect(l.topics).toEqual([
			{ name: "VLAN", weight: "high", reference: "Kapitel 4", also: ["VLAN-Grundlagen", "Inter-VLAN-Routing"] },
			{ name: "Subnetting", weight: "low", reference: "Kapitel 5", also: [] },
		]);
		expect(l.sources).toEqual(["Uni/Netze/Kapitel 4.md"]);
		expect(l.updated).toBe("2026-10-05");
	});

	it("reads the error patterns of a German progress note", () => {
		expect(readPatterns(fixture("skript-check-lernstand.md"))).toEqual({
			patterns: [{ title: "Konfiguration vergessen", description: "dot1q fehlt öfter." }],
			recommendation: "Befehle üben.",
		});
	});

	it("maps the old settings", () => {
		const s = settingsFromLegacy(JSON.parse(fixture("skript-check-data.json")));
		expect(s).toMatchObject({
			provider: "gemini",
			claudeKey: "sk-ant-FAKE-for-tests",
			geminiKey: "FAKE-gemini-for-tests",
			defaultCount: 10,
			questionTypes: "open",
			level: "exam",
			quizFolder: "Tests",
			progressName: "Lernstand",
			topicsName: "Themen",
			targetRetention: 0.85,
			readinessCap: 90,
			statusBar: false,
			noTopicList: ["Uni/Mathe"],
		});
		expect(settingsFromLegacy({ nurMC: true }).questionTypes).toBe("mc");
		expect(fromLegacy({ id: "x", title: "already new", questions: [] }).title).toBe("already new");
	});
});

describe("old vault in the plugin", () => {
	let app: ob.App;
	let plugin: LacunaPlugin;

	beforeEach(async () => {
		ob.requestUrl.mockReset();
		ob.notices.length = 0;
		app = new ob.App();
		await app.vault.adapter.write(".obsidian/plugins/skript-check/data.json", fixture("skript-check-data.json"));
		plugin = new LacunaPlugin(app as any, { dir: ".obsidian/plugins/lacuna" } as any);
		await plugin.onload();
		plugin.choose = async () => "later";
		await app.vault.create("Uni/Netze/Kapitel 4.md", "# VLANs\n" + "Ein VLAN trennt Broadcast-Domänen. ".repeat(10));
		await app.vault.create("Uni/Netze/Tests/VLANs – Test 2026-10-04.md", fixture("skript-check-ausgewertet.md"));
		await app.vault.create("Uni/Netze/Tests/VLANs – Test 2026-10-05.md", fixture("skript-check-offen.md"));
		await app.vault.create("Uni/Netze/Themen.md", fixture("skript-check-themen.md"));
		await app.vault.create("Uni/Netze/Lernstand.md", fixture("skript-check-lernstand.md"));
	});

	it("takes over the settings on first start, including keys and the German folder names", () => {
		expect(plugin.settings.provider).toBe("gemini");
		expect(plugin.settings.geminiKey).toBe("FAKE-gemini-for-tests");
		expect(plugin.settings.quizFolder).toBe("Tests");
		expect(plugin.settings.progressName).toBe("Lernstand");
		expect(plugin.settings.topicsName).toBe("Themen");
		expect(plugin.data.geminiKey).toBe("FAKE-gemini-for-tests"); // saved as Lacuna settings
		expect(ob.notices.join("\n")).toContain("taken over from Skript-Check");
	});

	it("recognizes old quizzes, topic list, exam date and code blocks", async () => {
		const k = await plugin.readinessData(app.vault.getAbstractFileByPath("Uni/Netze") as any);
		expect(k.list!.topics.map((x) => x.name)).toEqual(["VLAN", "Subnetting"]);
		expect(k.r.evaluatedQuizzes).toBe(1);
		expect(k.r.topics.find((x) => x.name === "VLAN")!.tested).toBe(true); // via the "also" aliases
		expect(k.exam).toBe("2027-02-10"); // "klausur:" in the old progress note

		// Old ```skript-check auswerten``` button still works
		const el = new ob.FakeEl();
		plugin.codeBlocks.get("skript-check")("auswerten\n", el, { sourcePath: "Uni/Netze/Tests/VLANs – Test 2026-10-05.md" });
		expect(el.all("button")[0].ownText).toBe("Evaluate");
	});

	it("evaluates an answered German quiz and keeps the evaluated one untouched", async () => {
		ob.requestUrl.mockResolvedValueOnce({
			status: 200,
			json: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ evaluations: [{ nr: 2, points: 3, error_type: "none", what_was_wrong: "", correct: "", follow_up: "" }], summary: "Gut." }) }] } }] },
			text: "",
		});
		const path = "Uni/Netze/Tests/VLANs – Test 2026-10-05.md";
		await plugin.evaluate(app.vault.getAbstractFileByPath(path) as any);
		const md = app.vault.files.get(path) as string;
		expect(md).toContain("status: evaluated");
		expect(md).toContain("Result: 4 / 4 points (100 %)");
		expect(readDataBlock(md)!.answers![0].confidence).toBe("sure");

		// The already evaluated quiz is not evaluated again
		await plugin.evaluate(app.vault.getAbstractFileByPath("Uni/Netze/Tests/VLANs – Test 2026-10-04.md") as any);
		expect(ob.notices.join("\n")).toContain("already been evaluated");
		expect(ob.requestUrl).toHaveBeenCalledTimes(1);

		// The progress note is updated in place, exam date and patterns survive
		await new Promise((r) => setTimeout(r, 0));
		const progress = app.vault.files.get("Uni/Netze/Lernstand.md") as string;
		expect(progress).toContain("lacuna: progress");
		expect(progress).toContain("exam: 2027-02-10");
		expect(progress).toContain("**Konfiguration vergessen:**");
		expect(progress).toContain("quizzes: 2");
	});

	it("a vault without Skript-Check gets the default settings for its language", async () => {
		setLang("en");
		const app2 = new ob.App();
		const p = new LacunaPlugin(app2 as any, { dir: ".obsidian/plugins/lacuna" } as any);
		await p.onload();
		expect(p.settings.quizFolder).toBe("Quizzes");
		expect(p.settings.claudeKey).toBe("");
	});
});
