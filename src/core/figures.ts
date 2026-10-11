// Real figures from the learner's material inside questions: images embedded in notes, image files and PDF pages.
// Every figure the AI is shown gets an ID ("F1", "F2", …). A question may point to one of these IDs, so a figure
// in a quiz can only ever be a file Lacuna actually read – never a guessed path that would create an empty note.

import { Figure } from "./types";
import { pageRangeText } from "./util";

export interface FigureSource {
	id: string;
	path: string;
	kind: "image" | "pdf";
	/** PDF only: the pages the AI saw; a question has to name one of them */
	pages?: number[];
}

// Characters that cannot appear inside a wikilink target
const UNLINKABLE = /[|#^[\]]/;

export class FigureList {
	readonly items: FigureSource[] = [];

	/** Register a figure the AI is about to see. Returns null for paths that cannot be embedded. */
	add(path: string, kind: "image" | "pdf", pages?: number[]): FigureSource | null {
		if (UNLINKABLE.test(path)) return null;
		if (kind === "pdf" && (!pages || !pages.length)) return null;
		const f: FigureSource = { id: `F${this.items.length + 1}`, path, kind, ...(kind === "pdf" ? { pages: [...pages!] } : {}) };
		this.items.push(f);
		return f;
	}

	get ids(): string[] {
		return this.items.map((f) => f.id);
	}

	/** True if a question has to name a page (some figure is a multi-page PDF). */
	get needsPage(): boolean {
		return this.items.some((f) => f.kind === "pdf" && (f.pages?.length ?? 0) > 1);
	}

	/** Text the AI reads next to the figure. */
	label(f: FigureSource): string {
		if (f.kind === "image") return `[Figure ${f.id}: the image above, file "${f.path}"]`;
		const p = f.pages!;
		return p.length === 1
			? `[Figure ${f.id}: page ${p[0]} of "${f.path}"]`
			: `[Figure ${f.id}: pages ${pageRangeText(p)} of "${f.path}" – a question about one of these pages names it in figure_page]`;
	}

	/** Turn the AI's figure fields into a figure, or undefined if they do not name a known figure (and page). */
	resolve(id: unknown, page: unknown): Figure | undefined {
		const key = String(id ?? "").trim().toUpperCase();
		if (!key) return undefined;
		const f = this.items.find((x) => x.id === key);
		if (!f) return undefined;
		if (f.kind === "image") return { path: f.path };
		const pages = f.pages!;
		if (pages.length === 1) return { path: f.path, page: pages[0] };
		const n = Number(page);
		return Number.isInteger(n) && pages.includes(n) ? { path: f.path, page: n } : undefined;
	}
}

/** Markdown embed of a figure. */
export function figureEmbed(f: Figure): string {
	return f.page ? `![[${f.path}#page=${f.page}]]` : `![[${f.path}]]`;
}

/** Text for the AI when grading: which attached image belongs to the question. */
export function figureForAI(nr: number, attached: boolean): string {
	return attached ? `see the image labeled "Figure of question ${nr}"` : "a figure from the material (not attached; rely on the model answer)";
}
