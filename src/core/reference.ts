// Turn the AI's free-text "reference" into clickable wikilinks.
// Only files from the known source list are linked, so a link never points to a missing file
// (clicking an unresolved wikilink would create an empty note). Anything not recognized stays text.

const SOURCE_MARKER = /===\s*File:\s*(.+?)\s*(?:\(scanned\)\s*)?===/g;
const PAGE_MARKER = /\[(?:Page|Seite)\s+(\d+)\]/gi;
// Optional page word, then "4", "4-7", "4–7, 26" ...
const PAGES = /^[\s,:;]*(?:(?:pages?|pp?\.|seiten?|s\.)\s*)?(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)/i;
// Characters that cannot appear inside a wikilink target
const UNLINKABLE = /[|#^[\]]/;

interface Match {
	start: number;
	end: number;
	path: string;
}

function extension(path: string): string {
	return path.slice(path.lastIndexOf(".") + 1).toLowerCase();
}

function stem(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/** Every path suffix ("a/b/c.md", "b/c.md", "c.md") -> source path; suffixes shared by several sources are dropped. */
function suffixIndex(sources: string[]): Map<string, string> {
	const index = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const p of sources) {
		const parts = p.split("/");
		for (let i = 0; i < parts.length; i++) {
			const key = parts.slice(i).join("/").toLowerCase();
			if (index.has(key) && index.get(key) !== p) ambiguous.add(key);
			else index.set(key, p);
		}
	}
	for (const k of ambiguous) index.delete(k);
	return index;
}

function findFiles(text: string, sources: string[]): Match[] {
	const lower = text.toLowerCase();
	const keys = [...suffixIndex(sources).entries()].sort((a, b) => b[0].length - a[0].length);
	const found: Match[] = [];
	for (const [key, path] of keys) {
		let from = 0;
		for (;;) {
			const i = lower.indexOf(key, from);
			if (i < 0) break;
			from = i + 1;
			const end = i + key.length;
			// Whole names only: "A1.md" must not match inside "XA1.md" or "dir/A1.md"
			if (i > 0 && /[\p{L}\p{N}_/.-]/u.test(text[i - 1])) continue;
			if (found.some((m) => i < m.end && end > m.start)) continue;
			found.push({ start: i, end, path });
		}
	}
	return found.sort((a, b) => a.start - b.start);
}

/** "4 - 7,26" -> "4–7, 26" */
function pageText(s: string): string {
	return s.replace(/\s*[-–]\s*/g, "–").replace(/\s*,\s*/g, ", ");
}

function link(path: string, pages: string, pageLabel: string): string {
	const label = pages ? `${stem(path)} – ${pageLabel} ${pages}` : stem(path);
	const first = pages.match(/\d+/)?.[0];
	return `[[${path}${first ? `#page=${first}` : ""}|${label}]]`;
}

/**
 * "=== File: a/Script.pdf === [Page 4]-[Page 7]" -> "[[a/Script.pdf#page=4|Script – p. 4–7]]".
 * With a single PDF as source, a bare "page 12" links into that PDF.
 */
export function linkReference(ref: string, sources: string[], pageLabel: string): string {
	if (!ref || ref.includes("[[")) return ref;
	const usable = sources.filter((p) => !UNLINKABLE.test(p));
	const text = ref
		.replace(SOURCE_MARKER, "$1")
		.replace(PAGE_MARKER, "$1")
		.trim();
	const files = findFiles(text, usable);

	if (!files.length) {
		const pdfs = usable.filter((p) => extension(p) === "pdf");
		if (usable.length !== 1 || pdfs.length !== 1) return text;
		// Without a file name, a leading number is only a page if it was called one ("802.1Q" is not)
		if (!/^\s*(?:\[(?:page|seite)|(?:pages?|pp?\.|seiten?|s\.)\s*\d)/i.test(ref)) return text;
		const m = text.match(PAGES);
		if (!m) return text;
		return (link(pdfs[0], pageText(m[1]), pageLabel) + text.slice(m[0].length)).trim();
	}

	let out = text.slice(0, files[0].start);
	files.forEach((f, i) => {
		let rest = text.slice(f.end, i + 1 < files.length ? files[i + 1].start : text.length);
		let pages = "";
		if (extension(f.path) === "pdf") {
			const m = rest.match(PAGES);
			if (m) {
				pages = pageText(m[1]);
				rest = rest.slice(m[0].length);
			}
		}
		out += link(f.path, pages, pageLabel) + rest;
	});
	return out.trim();
}

/** Pipes inside [[target|alias]] must be written as \| in a Markdown table cell. */
export function escapeLinkPipes(s: string): string {
	return s.replace(/\[\[[^\]]*\]\]/g, (l) => l.replace(/\\?\|/g, "\\|"));
}
