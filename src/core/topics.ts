// Topic list of a subject: an editable Markdown table (Topics.md in the subject folder).
// It defines what "coverage" means for exam readiness. Reading accepts English and German
// (Themen.md from Skript-Check), so existing lists keep working.

import { t } from "../i18n";
import { LEGACY_KEY, PLUGIN_KEY, setFrontmatterValue } from "./quiz-markdown";
import { escapeLinkPipes } from "./reference";
import type { FileDef, TopicDef } from "./readiness";

export type Weight = "high" | "medium" | "low";
export const WEIGHTS: Weight[] = ["high", "medium", "low"];
export const WEIGHT_VALUE: Record<Weight, number> = { high: 3, medium: 2, low: 1 };

export interface Topic {
	name: string;
	weight: Weight;
	reference: string;
	/** Other names under which the topic appears in older quizzes */
	also: string[];
}

export interface TopicList {
	subject: string;
	topics: Topic[];
	/** Files the list was built from (to detect new files) */
	sources: string[];
	updated: string;
}

const SOURCES_START = "%%lacuna-sources";
const LEGACY_SOURCES_START = "%%skript-check-quellen";

function cell(s: string): string {
	// Wikilinks keep their alias pipe (escaped for the table), any other pipe would split the cell
	return String(s ?? "")
		.split(/(\[\[[^\]]*\]\])/)
		.map((part, i) => (i % 2 ? escapeLinkPipes(part) : part.replace(/\|/g, "/")))
		.join("")
		.replace(/\n/g, " ")
		.trim();
}

export function normName(s: string): string {
	return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normWeight(x: unknown): Weight {
	const v = String(x ?? "").toLowerCase().trim();
	if (/^(h|3)/.test(v)) return "high"; // high / hoch
	if (/^(lo|ni|ge|1)/.test(v)) return "low"; // low / niedrig / gering
	return "medium"; // medium / mittel / normal / anything else
}

/** Split a Markdown table row into cells. Pipes inside [[link|alias]] and escaped \\| stay in their cell. */
export function splitRow(line: string): string[] {
	const z = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	const cells: string[] = [];
	let cur = "";
	let depth = 0;
	for (let i = 0; i < z.length; i++) {
		const c = z[i];
		if (c === "\\" && z[i + 1] === "|") {
			cur += "\\|";
			i++;
		} else if (c === "[" && z[i + 1] === "[") {
			depth++;
			cur += "[[";
			i++;
		} else if (c === "]" && z[i + 1] === "]" && depth > 0) {
			depth--;
			cur += "]]";
			i++;
		} else if (c === "|" && depth === 0) {
			cells.push(cur.trim());
			cur = "";
		} else cur += c;
	}
	cells.push(cur.trim());
	return cells;
}

function isHeaderCell(c: string | undefined): boolean {
	return /^(topic|thema)$/i.test(c ?? "");
}

export function renderTopics(l: TopicList): string {
	const s = t().topics;
	const z = [
		"---",
		`${PLUGIN_KEY}: topics`,
		`updated: ${l.updated}`,
		`topics: ${l.topics.length}`,
		"---",
		"",
		`# ${s.title(l.subject)}`,
		"",
		`> [!info] ${s.infoTitle}`,
		...s.info.map((x) => `> ${x}`),
		"",
		`| ${s.headers.join(" | ")} |`,
		"|---|---|---|---|",
		...l.topics.map((x) => `| ${cell(x.name)} | ${t().weight[x.weight]} | ${cell(x.reference)} | ${cell(x.also.join(", "))} |`),
		"",
		`${SOURCES_START} ${s.sourcesNote}`,
		...l.sources,
		"%%",
		"",
	];
	return z.join("\n");
}

/** Read a topic list from Markdown. null if the note is not one. */
export function parseTopics(md: string, subject = ""): TopicList | null {
	const text = md.replace(/\r\n/g, "\n");
	const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
	if (!new RegExp(`^(?:${PLUGIN_KEY}:\\s*topics|${LEGACY_KEY}:\\s*themen)\\s*$`, "m").test(fm)) return null;
	const updated = fm.match(/^(?:updated|stand):\s*(.+)$/m)?.[1]?.trim() ?? "";
	const title = text.match(/^# (?:Topic list|Themenliste):\s*(.+)$/m)?.[1]?.trim() ?? subject;

	const topics: Topic[] = [];
	const seen = new Set<string>();
	let inTable = false;
	for (const line of text.split("\n")) {
		const z = line.trim();
		if (!z.startsWith("|")) {
			inTable = false;
			continue;
		}
		const cells = splitRow(z);
		if (isHeaderCell(cells[0])) {
			inTable = true;
			continue;
		}
		if (!inTable || /^:?-{2,}/.test(cells[0] ?? "")) continue;
		const name = cells[0];
		if (!name || seen.has(normName(name))) continue;
		seen.add(normName(name));
		topics.push({
			name,
			weight: normWeight(cells[1]),
			reference: cells[2] ?? "",
			also: (cells[3] ?? "")
				.split(/[,;]/)
				.map((x) => x.trim())
				.filter(Boolean),
		});
	}

	const sources: string[] = [];
	const a = text.indexOf(SOURCES_START);
	const i = a >= 0 ? a : text.indexOf(LEGACY_SOURCES_START);
	if (i >= 0) {
		for (const z of text.slice(i).split("\n").slice(1)) {
			if (z.trim() === "%%") break;
			if (z.trim()) sources.push(z.trim());
		}
	}
	return { subject: title, topics, sources, updated };
}

/**
 * Write an extended topic list back into the existing note without touching anything else:
 * existing rows stay as they are (extra columns, links, formatting), only their "Also" cell is
 * updated when new aliases were found, new topics are appended, and the sources block is replaced.
 */
export function updateTopicsMarkdown(oldMd: string, next: TopicList): string {
	const lines = oldMd.replace(/\r\n/g, "\n").split("\n");
	const header = lines.findIndex((l) => l.trim().startsWith("|") && isHeaderCell(splitRow(l)[0]));
	if (header < 0) return renderTopics(next);
	let end = header + 2;
	const seen = new Set<string>();
	for (; end < lines.length && lines[end].trim().startsWith("|"); end++) {
		const cells = splitRow(lines[end]);
		const topic = next.topics.find((x) => normName(x.name) === normName(cells[0] ?? ""));
		if (!topic) continue;
		seen.add(normName(topic.name));
		const also = topic.also.join(", ");
		if ((cells[3] ?? "") !== also && topic.also.length) {
			while (cells.length < 4) cells.push("");
			cells[3] = cell(also);
			lines[end] = `| ${cells.join(" | ")} |`;
		}
	}
	const added = next.topics.filter((x) => !seen.has(normName(x.name)));
	lines.splice(end, 0, ...added.map((x) => `| ${cell(x.name)} | ${t().weight[x.weight]} | ${cell(x.reference)} | ${cell(x.also.join(", "))} |`));

	let md = lines.join("\n");
	const start = Math.max(md.indexOf(SOURCES_START), md.indexOf(LEGACY_SOURCES_START));
	const block = `${SOURCES_START} ${t().topics.sourcesNote}\n${next.sources.join("\n")}${next.sources.length ? "\n" : ""}%%`;
	if (start >= 0) {
		const close = md.indexOf("\n%%", start);
		md = md.slice(0, start) + block + (close >= 0 ? md.slice(close + 3) : "");
	} else md = md.replace(/\s*$/, "") + "\n\n" + block + "\n";
	md = setFrontmatterValue(md, "updated", next.updated);
	return setFrontmatterValue(md, "topics", String(next.topics.length));
}

/** Raw AI output -> topics (duplicates merged). */
export function normalizeTopics(raw: any): Topic[] {
	const list = Array.isArray(raw?.topics) ? raw.topics : [];
	const out: Topic[] = [];
	for (const x of list) {
		const name = String(x?.name ?? "").replace(/\|/g, "/").trim().slice(0, 60);
		if (!name) continue;
		const next: Topic = {
			name,
			weight: normWeight(x?.weight),
			reference: String(x?.reference ?? "").trim().slice(0, 300),
			also: Array.isArray(x?.also) ? x.also.map((y: unknown) => String(y).trim()).filter(Boolean) : [],
		};
		const old = out.find((y) => normName(y.name) === normName(name));
		if (old) {
			old.also = [...new Set([...old.also, ...next.also])];
			if (WEIGHT_VALUE[next.weight] > WEIGHT_VALUE[old.weight]) old.weight = next.weight;
		} else out.push(next);
	}
	return out;
}

/** Append new topics without changing existing (possibly user-edited) ones. Aliases are merged in. */
export function extendTopics(l: TopicList, add: Topic[], newSources: string[], updated: string): TopicList {
	const topics = l.topics.map((x) => ({ ...x, also: [...x.also] }));
	for (const n of add) {
		const old = topics.find((x) => normName(x.name) === normName(n.name) || x.also.some((a) => normName(a) === normName(n.name)));
		if (old) {
			for (const a of n.also) if (!old.also.some((y) => normName(y) === normName(a)) && normName(a) !== normName(old.name)) old.also.push(a);
		} else topics.push(n);
	}
	return { ...l, topics, sources: [...new Set([...l.sources, ...newSources])].sort(), updated };
}

/** Files in the subject that have not been read into the topic list yet. */
export function newSources(l: TopicList, current: string[]): string[] {
	const known = new Set(l.sources);
	return current.filter((p) => !known.has(p));
}

/** Input for the readiness calculation: topics with weight and alias mapping. */
export function asReadinessInput(l: TopicList): { topics: TopicDef[]; aliases: Record<string, string> } {
	const aliases: Record<string, string> = {};
	for (const x of l.topics) for (const a of x.also) aliases[a] = x.name;
	return {
		topics: l.topics.map((x) => ({ name: x.name, weight: WEIGHT_VALUE[x.weight], reference: x.reference })),
		aliases,
	};
}

export function filesAsReadinessInput(paths: string[]): FileDef[] {
	return paths.map((path) => ({ path, weight: 1 }));
}

// ------------------------------------------------------------------ Cost estimate

export interface Volume {
	chars: number;
	images: number;
	/** Pages of scanned PDFs that are read as images */
	scanPages: number;
	chunks: number;
}

/** Rough token estimate for building a topic list. */
export function estimateTopicTokens(v: Volume): { input: number; output: number } {
	const perChunk = 900; // instructions
	let input = Math.ceil(v.chars / 3.5) + v.images * 1600 + v.scanPages * 1600 + v.chunks * perChunk;
	let output = v.chunks * 1800;
	if (v.chunks > 1) {
		// merging the partial lists
		input += v.chunks * 1800 + 1200;
		output += 2500;
	}
	return { input, output };
}
