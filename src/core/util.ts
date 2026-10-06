// Small helpers without Obsidian dependencies.

import { t } from "../i18n";

/** "12-30, 35, 40-41" -> [12..30, 35, 40, 41], limited to 1..maxPage. Empty = all pages. */
export function parsePageRange(input: string, maxPage: number): number[] {
	const s = input.trim();
	if (!s) return Array.from({ length: maxPage }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of s.split(/[,;]+/)) {
		const p = part.trim();
		if (!p) continue;
		const m = p.match(/^(\d+)\s*[-–]\s*(\d+)$/);
		if (m) {
			let a = parseInt(m[1], 10);
			let b = parseInt(m[2], 10);
			if (a > b) [a, b] = [b, a];
			for (let i = a; i <= b; i++) if (i >= 1 && i <= maxPage) pages.add(i);
		} else if (/^\d+$/.test(p)) {
			const n = parseInt(p, 10);
			if (n >= 1 && n <= maxPage) pages.add(n);
		} else {
			throw new Error(t().errors.pageRangeInvalid(p));
		}
	}
	if (pages.size === 0) throw new Error(t().errors.noValidPages(maxPage));
	return [...pages].sort((a, b) => a - b);
}

/** Compact page list: [1,2,3,7] -> "1-3, 7" */
export function pageRangeText(pages: number[]): string {
	const parts: string[] = [];
	let i = 0;
	while (i < pages.length) {
		let j = i;
		while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
		parts.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
		i = j + 1;
	}
	return parts.join(", ");
}

/** Remove characters that are not allowed in file names. */
export function safeFileName(s: string): string {
	return s
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
}

export function newId(now: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	const d = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
	return `${d}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Local date and time for file names: "2026-10-06 14.30" */
export function localStamp(now: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}`;
}

export function localDate(now: Date = new Date()): string {
	return localStamp(now).slice(0, 10);
}

/** Image embeds in a note: ![[image.png]] and ![](path.png) */
export function imageEmbeds(md: string): string[] {
	const out: string[] = [];
	const re1 = /!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp))(?:[|#][^\]]*)?\]\]/gi;
	const re2 = /!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|gif|webp))\)/gi;
	let m: RegExpExecArray | null;
	while ((m = re1.exec(md))) out.push(m[1].trim());
	while ((m = re2.exec(md))) {
		const p = decodeURIComponent(m[1]);
		if (!/^https?:/i.test(p)) out.push(p);
	}
	return [...new Set(out)];
}

export function mediaType(path: string): string {
	const e = path.split(".").pop()?.toLowerCase();
	if (e === "png") return "image/png";
	if (e === "gif") return "image/gif";
	if (e === "webp") return "image/webp";
	return "image/jpeg";
}
