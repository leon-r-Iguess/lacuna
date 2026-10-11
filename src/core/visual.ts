// Figures inside questions: Markdown tables and Mermaid diagrams written by the AI.
// Everything is checked before it goes into a note, so a broken figure can never break the quiz
// structure (question headings, answer label, code blocks, the hidden data block).

import { Visual } from "./types";

const MAX_LINES = 60;
const MAX_CHARS = 4000;

/** Diagram types Mermaid understands (first word of the code). */
const MERMAID_START =
	/^(?:graph|flowchart|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|timeline|gantt|pie|mindmap|journey|gitGraph|quadrantChart|xychart-beta|block-beta|sankey-beta)\b/;

const SEPARATOR_ROW = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;

function lines(text: string): string[] {
	return String(text ?? "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((z) => z.replace(/\s+$/, ""));
}

function withoutBlankEdges(z: string[]): string[] {
	let a = 0;
	let b = z.length;
	while (a < b && !z[a].trim()) a++;
	while (b > a && !z[b - 1].trim()) b--;
	return z.slice(a, b);
}

/** Lines that would break the note: code fences, headings (question sections), Obsidian comments (data block). */
function breaksNote(z: string): boolean {
	const s = z.trim();
	return s.includes("```") || s.startsWith("~~~") || /^#{1,6}\s/.test(s) || s.includes("%%") || /^\*\*(?:Answer|Antwort):\*\*/.test(s);
}

/** A Markdown table: header row, separator row, at least one body row; every line starts with "|". Returns null if not usable. */
export function cleanTable(text: string): string | null {
	const z = withoutBlankEdges(lines(text)).map((x) => x.trim());
	if (z.length < 3 || z.length > MAX_LINES) return null;
	if (!z.every((x) => x.startsWith("|") && !breaksNote(x))) return null;
	if (!SEPARATOR_ROW.test(z[1])) return null;
	const out = z.join("\n");
	return out.length > MAX_CHARS ? null : out;
}

/** Mermaid code without the surrounding fence; comment lines (%%) are dropped. Returns null if not usable. */
export function cleanMermaid(text: string): string | null {
	let z = withoutBlankEdges(lines(text));
	// Fence around the code; parseLoose may already have removed the backticks and left "mermaid"
	if (z.length && /^\s*(?:```\s*)?mermaid\s*$/i.test(z[0])) z = z.slice(1);
	if (z.length && /^\s*```\s*$/.test(z[z.length - 1])) z = z.slice(0, -1);
	z = withoutBlankEdges(z.filter((x) => !x.trim().startsWith("%%")));
	if (!z.length || z.length > MAX_LINES) return null;
	if (!MERMAID_START.test(z[0].trim())) return null;
	if (z.some(breaksNote)) return null;
	const out = z.join("\n");
	return out.length > MAX_CHARS ? null : out;
}

/** Turn the AI's visual fields into a checked figure, or undefined (no figure, or an unusable one). */
export function cleanVisual(kind: unknown, content: unknown): Visual | undefined {
	const k = String(kind ?? "").toLowerCase().trim();
	if (k === "table") {
		const c = cleanTable(String(content ?? ""));
		return c ? { kind: "table", content: c } : undefined;
	}
	if (k === "mermaid") {
		const c = cleanMermaid(String(content ?? ""));
		return c ? { kind: "mermaid", content: c } : undefined;
	}
	return undefined;
}

/** Markdown for a figure. */
export function renderVisual(v: Visual): string {
	return v.kind === "mermaid" ? "```mermaid\n" + v.content + "\n```" : v.content;
}

/** Text form for the AI (grading needs to know what the question showed). */
export function visualForAI(v: Visual): string {
	return v.kind === "mermaid" ? `Mermaid diagram:\n${v.content}` : `Table:\n${v.content}`;
}

/** Cell contents per row; ignores padding and separator styles, which Obsidian's table editor rewrites. */
function normalizeTable(text: string): string {
	return withoutBlankEdges(lines(text))
		.map((z) =>
			z
				.trim()
				.replace(/^\|/, "")
				.replace(/\|$/, "")
				.split("|")
				.map((c) => c.trim().replace(/\s+/g, " "))
				.map((c) => (/^:?-+:?$/.test(c) ? "-" : c))
				.join("|"),
		)
		.join("\n");
}

/** True if the learner left the answer template exactly as it was (counts as no answer). */
export function isUntouchedTemplate(answer: string, template: string): boolean {
	return normalizeTable(answer) === normalizeTable(template);
}
