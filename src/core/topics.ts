// Topic list of a subject: an editable Markdown table (Topics.md in the subject folder).
// It defines what "coverage" means for exam readiness. Reading accepts English and German
// (Themen.md from Skript-Check), so existing lists keep working.

import { t } from "../i18n";
import { LEGACY_KEY, PLUGIN_KEY } from "./quiz-markdown";
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
	return String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ").trim();
}

export function normName(s: string): string {
	return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normWeight(x: unknown): Weight {
	const s = String(x ?? "").toLowerCase().trim();
	if (s.startsWith("h") || s === "3") return "high"; // high / hoch
	if (s.startsWith("l") || s.startsWith("n") || s === "1") return "low"; // low / niedrig
	return "medium";
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
		const cells = z.replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());
		if (/^(topic|thema)$/i.test(cells[0] ?? "")) {
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
			reference: String(x?.reference ?? "").trim().slice(0, 120),
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
