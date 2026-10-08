import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../src/i18n";
import { escapeLinkPipes, linkReference } from "../src/core/reference";
import { parseTopics, renderTopics, updateTopicsMarkdown } from "../src/core/topics";
import { renderEvaluated } from "../src/core/quiz-markdown";
import { computeResult } from "../src/core/scoring";
import { QuizData } from "../src/core/types";

beforeEach(() => setLang("en"));

const PDF = "Semester 3/Knetze/Chapter 1 - Introduction v13.0.pdf";
const INFO = [
	"Semester 2/Informatik 2/Info 2 Greedy.md",
	"Semester 2/Informatik 2/Info 2.md",
	"Semester 2/Informatik 2/Info2_Casting.md",
	"Semester 2/Informatik 2/exceptions.md",
	"Semester 2/Informatik 2/exceptionsbs.md",
	"Semester 2/Informatik 2/probeklausur2/A1.md",
	"Semester 2/Informatik 2/probeklausur2/A3.md",
];

describe("linkReference", () => {
	// Real output from the first vault test (0.5.2), where references were plain text
	it("turns source and page markers into a PDF page link", () => {
		expect(linkReference(`=== File: ${PDF} === [Page 4]-[Page 7]`, [PDF], "p.")).toBe(
			`[[${PDF}#page=4|Chapter 1 - Introduction v13.0 – p. 4–7]]`,
		);
		expect(linkReference(`=== File: ${PDF} === [Page 14]-[Page 18], [Page 26]`, [PDF], "S.")).toBe(
			`[[${PDF}#page=14|Chapter 1 - Introduction v13.0 – S. 14–18, 26]]`,
		);
	});

	it("links several notes, resolving bare and relative names against the sources", () => {
		expect(linkReference("Semester 2/Informatik 2/exceptions.md; exceptionsbs.md", INFO, "p.")).toBe(
			"[[Semester 2/Informatik 2/exceptions.md|exceptions]]; [[Semester 2/Informatik 2/exceptionsbs.md|exceptionsbs]]",
		);
		expect(linkReference("Semester 2/Informatik 2/Info2_Casting.md (section errors); probeklausur2/A3.md", INFO, "p.")).toBe(
			"[[Semester 2/Informatik 2/Info2_Casting.md|Info2_Casting]] (section errors); [[Semester 2/Informatik 2/probeklausur2/A3.md|A3]]",
		);
	});

	it("does not confuse similar names", () => {
		expect(linkReference("Semester 2/Informatik 2/Info 2 Greedy.md; Info 2.md", INFO, "p.")).toBe(
			"[[Semester 2/Informatik 2/Info 2 Greedy.md|Info 2 Greedy]]; [[Semester 2/Informatik 2/Info 2.md|Info 2]]",
		);
		expect(linkReference("XA1.md", INFO, "p.")).toBe("XA1.md");
	});

	it("handles the new prompt format", () => {
		expect(linkReference(`${PDF}, p. 12 - 14`, [PDF, "Semester 3/Knetze/x.md"], "p.")).toBe(
			`[[${PDF}#page=12|Chapter 1 - Introduction v13.0 – p. 12–14]]`,
		);
	});

	it("links bare pages only when the single source is a PDF and it says page", () => {
		expect(linkReference("page 17", [PDF], "p.")).toBe(`[[${PDF}#page=17|Chapter 1 - Introduction v13.0 – p. 17]]`);
		expect(linkReference("[Page 3] (figure)", [PDF], "p.")).toBe(`[[${PDF}#page=3|Chapter 1 - Introduction v13.0 – p. 3]] (figure)`);
		expect(linkReference("802.1Q tagging", [PDF], "p.")).toBe("802.1Q tagging");
		expect(linkReference("page 17", ["a.md"], "p.")).toBe("page 17");
		expect(linkReference("page 17", [PDF, "b.pdf"], "p.")).toBe("page 17");
	});

	it("never links unknown, ambiguous or unlinkable files", () => {
		expect(linkReference("Other/missing.md", INFO, "p.")).toBe("Other/missing.md");
		expect(linkReference("A.md", ["x/A.md", "y/A.md"], "p.")).toBe("A.md");
		expect(linkReference("C# notes.md", ["C# notes.md"], "p.")).toBe("C# notes.md");
		expect(linkReference("", INFO, "p.")).toBe("");
	});

	it("leaves existing links alone", () => {
		const done = `[[${PDF}#page=4|x]]`;
		expect(linkReference(done, [PDF], "p.")).toBe(done);
	});
});

describe("references in the topic table", () => {
	const ref = linkReference(`=== File: ${PDF} === [Page 4]-[Page 7]`, [PDF], "p.");
	const list = { subject: "Knetze", topics: [{ name: "Internet Overview", weight: "low" as const, reference: ref, also: [] }], sources: [PDF], updated: "2026-10-08" };

	it("escapes the alias pipe so the table keeps its columns, and reads it back", () => {
		const md = renderTopics(list);
		expect(md).toContain(`| Internet Overview | low | [[${PDF}#page=4\\|Chapter 1 - Introduction v13.0 – p. 4–7]] |  |`);
		const back = parseTopics(md)!;
		expect(back.topics).toHaveLength(1);
		expect(back.topics[0].weight).toBe("low");
		expect(back.topics[0].reference).toBe(escapeLinkPipes(ref));
		// Re-rendering does not double-escape
		expect(renderTopics(back)).toBe(md);
	});

	it("still turns plain pipes into slashes", () => {
		const md = renderTopics({ ...list, topics: [{ ...list.topics[0], reference: "a | b" }] });
		expect(md).toContain("| a / b |");
	});

	it("keeps existing rows when new topics are appended", () => {
		const md = renderTopics(list);
		const next = { ...list, topics: [...parseTopics(md)!.topics, { name: "New", weight: "high" as const, reference: ref, also: [] }] };
		const out = updateTopicsMarkdown(md, next);
		expect(parseTopics(out)!.topics.map((x) => x.name)).toEqual(["Internet Overview", "New"]);
		expect(out.match(/\\\|/g)).toHaveLength(2);
	});
});

describe("references in evaluated quizzes", () => {
	it("shows the question's linked reference, not the AI's plain copy", () => {
		const link = `[[${PDF}#page=9|Chapter 1 – p. 9]]`;
		const q: QuizData = {
			id: "x",
			title: "T",
			source: PDF,
			pages: "",
			created: "2026-10-08T10:00",
			questions: [{ nr: 1, type: "open", difficulty: "easy", topic: "A", question: "Q?", options: [], correct: null, solution: "S", reference: link }],
		};
		const answers = [{ nr: 1, checked: [], text: "x" }];
		const r = computeResult(q.questions, answers, [{ nr: 1, points: 0, error_type: "gap", what_was_wrong: "w", reference: "[Page 9]" }], "", new Date("2026-10-08T10:05:00Z"));
		const md = renderEvaluated(q, answers, r);
		expect(md).toContain(`**Reference:** ${link}`);
		expect(md).not.toContain("[Page 9]");
	});
});
