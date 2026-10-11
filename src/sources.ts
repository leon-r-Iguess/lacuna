// Turn sources (note, PDF, image, whole folder, past exam) into AI content.
// Labels sent to the AI are English; the material itself stays as it is.

import { App, TFile, TFolder, arrayBufferToBase64, loadPdfJs } from "obsidian";
import { Content } from "./ai";
import { t } from "./i18n";
import { imageEmbeds, mediaType, pageRangeText, parsePageRange } from "./core/util";
import { FigureList } from "./core/figures";
import { Figure } from "./core/types";
import { PageStats, pageStats, pickFigurePages } from "./core/figure-pages";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
const MAX_CHARS = 300_000; // ~75k tokens
const MAX_CHARS_STYLE = 60_000; // past exam: the style is enough
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit per image
const MAX_PDF_BYTES = 32 * 1024 * 1024; // API limit for PDF documents
/** Pages with figures sent as images per quiz ("include figures") */
export const MAX_FIGURE_PAGES = 10;
const FIGURE_MAX_SIDE = 1500; // px, longest side of a rendered page

export interface SourceOptions {
	/** Send PDF pages with figures as images (costs extra tokens) */
	figures?: boolean;
}

/** Renders a PDF page to a JPEG (Base64). Swappable in tests, where there is no canvas. */
export const pageRenderer = {
	async render(page: any, maxSide: number): Promise<string | null> {
		const base = page.getViewport({ scale: 1 });
		const scale = Math.min(3, maxSide / Math.max(base.width, base.height));
		const viewport = page.getViewport({ scale });
		const doc: Document = (globalThis as { activeDocument?: Document }).activeDocument ?? document;
		const canvas = doc.createElement("canvas");
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		try {
			// JPEG has no transparency: paint a white page first
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			await page.render({ canvasContext: ctx, viewport }).promise;
			const url = canvas.toDataURL("image/jpeg", 0.85);
			const i = url.indexOf(",");
			return i >= 0 ? url.slice(i + 1) : null;
		} finally {
			// Free the pixel buffer right away (matters on phones)
			canvas.width = 0;
			canvas.height = 0;
		}
	},
};

async function renderedPage(page: any): Promise<Content | null> {
	const data = await pageRenderer.render(page, FIGURE_MAX_SIDE);
	if (!data || (data.length * 3) / 4 > MAX_IMAGE_BYTES) return null;
	return { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
}

export type SourceKind = "note" | "pdf" | "image";

export function sourceKind(f: TFile): SourceKind | null {
	const e = f.extension.toLowerCase();
	if (e === "md") return "note";
	if (e === "pdf") return "pdf";
	if (IMAGE_EXTENSIONS.includes(e)) return "image";
	return null;
}

export interface SourceContent {
	content: Content[];
	/** For display, e.g. "12-30" */
	pages: string;
	hint?: string;
	/** Figures the AI is shown (images, scanned PDF pages); questions may point to them */
	figures: FigureList;
}

async function imageContent(app: App, f: TFile): Promise<Content | null> {
	const buf = await app.vault.readBinary(f);
	if (buf.byteLength > MAX_IMAGE_BYTES) return null;
	return { type: "image", source: { type: "base64", media_type: mediaType(f.path), data: arrayBufferToBase64(buf) } };
}

export async function pdfPageCount(app: App, f: TFile): Promise<number> {
	const pdfjs = await loadPdfJs();
	const doc = await pdfjs.getDocument({ data: new Uint8Array(await app.vault.readBinary(f)) }).promise;
	const n = doc.numPages;
	await doc.destroy?.();
	return n;
}

interface PdfText {
	/** With [Page n] markers */
	text: string;
	/** "" = all pages */
	range: string;
	/** Pages that were read */
	pages: number[];
	/** Hardly any text -> probably scanned */
	scanned: boolean;
	buf: ArrayBuffer;
	pageCount: number;
	/** Pages with figures, rendered as images (only with maxFigures > 0 and a text PDF) */
	figures: { page: number; image: Content }[];
}

async function pdfText(app: App, f: TFile, pageInput: string, maxFigures = 0): Promise<PdfText> {
	const buf = await app.vault.readBinary(f);
	const pdfjs = await loadPdfJs();
	const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
	const pages = parsePageRange(pageInput, doc.numPages);
	const parts: string[] = [];
	const stats: PageStats[] = [];
	let chars = 0;
	for (const p of pages) {
		const page = await doc.getPage(p);
		if (maxFigures > 0 && pdfjs.OPS && typeof page.getOperatorList === "function") {
			try {
				const ol = await page.getOperatorList();
				stats.push(pageStats(p, ol.fnArray ?? [], ol.argsArray ?? [], pdfjs.OPS));
			} catch (e) {
				console.warn("[Lacuna] figure detection", p, e);
			}
		}
		const tc = await page.getTextContent();
		let text = "";
		for (const it of tc.items as any[]) {
			if (typeof it.str !== "string") continue;
			text += it.str + (it.hasEOL ? "\n" : " ");
		}
		text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
		chars += text.length;
		parts.push(`[Page ${p}]\n${text}`);
	}
	const scanned = chars / Math.max(1, pages.length) < 60;
	const figures: { page: number; image: Content }[] = [];
	// A scanned PDF goes to the AI as a whole document anyway
	if (!scanned) {
		for (const p of pickFigurePages(stats, maxFigures)) {
			try {
				const image = await renderedPage(await doc.getPage(p));
				if (image) figures.push({ page: p, image });
			} catch (e) {
				console.warn("[Lacuna] render page", p, e);
			}
		}
	}
	await doc.destroy?.();
	return {
		text: parts.join("\n\n"),
		range: pageInput.trim() ? pageRangeText(pages) : "",
		pages,
		scanned,
		buf,
		pageCount: pages.length,
		figures,
	};
}

/** Rendered PDF pages, each followed by its figure label. */
function labeledPages(figures: FigureList, path: string, pages: { page: number; image: Content }[]): Content[] {
	return pages.flatMap((x) => {
		const f = figures.add(path, "pdf", [x.page]);
		return f ? [x.image, { type: "text" as const, text: figures.label(f) }] : [];
	});
}

function pdfDocument(buf: ArrayBuffer): Content {
	return { type: "document", source: { type: "base64", media_type: "application/pdf", data: arrayBufferToBase64(buf) } };
}

interface NoteImage {
	path: string;
	content: Content;
}

/** Note text plus embedded images. */
async function noteContent(app: App, f: TFile, maxImages: number): Promise<{ text: string; images: NoteImage[] }> {
	const text = await app.vault.cachedRead(f);
	const images: NoteImage[] = [];
	for (const link of imageEmbeds(text)) {
		if (images.length >= maxImages) break;
		const target = app.metadataCache.getFirstLinkpathDest(link, f.path);
		if (!target) continue;
		const b = await imageContent(app, target);
		if (b) images.push({ path: target.path, content: b });
	}
	return { text, images };
}

/** An image followed by its figure label (if it can be embedded in a quiz). */
function labeledImage(figures: FigureList, path: string, content: Content): Content[] {
	const f = figures.add(path, "image");
	return f ? [content, { type: "text", text: figures.label(f) }] : [content];
}

/** Figure label for a PDF sent as a document (scanned), or "". */
function pdfFigureLabel(figures: FigureList, path: string, pages: number[]): string {
	const f = figures.add(path, "pdf", pages);
	return f ? `\n${figures.label(f)}` : "";
}

// ------------------------------------------------------------------ Single file

export async function loadSource(app: App, f: TFile, pageInput: string, opt: SourceOptions = {}): Promise<SourceContent> {
	const s = t().sources;
	const kind = sourceKind(f);
	const figures = new FigureList();
	if (kind === "image") {
		const b = await imageContent(app, f);
		if (!b) throw new Error(s.imageTooLarge);
		const fig = figures.add(f.path, "image");
		const label = fig ? `\n${figures.label(fig)}` : "";
		return { content: [b, { type: "text", text: `Source: image "${f.name}" (e.g. blackboard photo, slide or handwritten notes).${label}` }], pages: "", figures };
	}

	if (kind === "note") {
		const { text, images } = await noteContent(app, f, MAX_IMAGES);
		if (text.length > MAX_CHARS) throw new Error(s.noteTooLong);
		if (text.trim().length < 80 && images.length === 0) throw new Error(s.noteEmpty);
		return {
			content: [
				...images.flatMap((i) => labeledImage(figures, i.path, i.content)),
				{ type: "text", text: `Source: note "${f.basename}"${images.length ? ` (with ${images.length} embedded images above)` : ""}.\n<<<\n${text}\n>>>` },
			],
			pages: "",
			figures,
		};
	}

	if (kind === "pdf") {
		const p = await pdfText(app, f, pageInput, opt.figures ? MAX_FIGURE_PAGES : 0);
		if (p.scanned) {
			// Hardly any text: probably scanned -> send the PDF itself (the AI reads the pages as images)
			if (p.buf.byteLength > MAX_PDF_BYTES) throw new Error(s.scanTooLarge);
			return {
				content: [pdfDocument(p.buf), { type: "text", text: `Source: PDF "${f.name}"${p.range ? `, only use pages ${p.range}` : ""}.${pdfFigureLabel(figures, f.path, p.pages)}` }],
				pages: p.range,
				hint: p.range ? s.scanWithRange(p.range) : s.scan,
				figures,
			};
		}
		if (p.text.length > MAX_CHARS) throw new Error(s.pdfTooLong);
		const pageImages = labeledPages(figures, f.path, p.figures);
		return {
			content: [...pageImages, { type: "text", text: `Source: PDF "${f.name}"${p.range ? `, pages ${p.range}` : ""}.\n<<<\n${p.text}\n>>>` }],
			pages: p.range,
			figures,
			hint: opt.figures ? figureHint(figures.items.length) : undefined,
		};
	}

	throw new Error(s.unsupported);
}

function figureHint(n: number): string {
	return n ? t().sources.figuresSent(n) : t().sources.noFiguresFound;
}

/** Image of a figure for grading (PDF pages are rendered), or null if it cannot be attached (file gone, too large). */
export async function figureImage(app: App, fig: Figure): Promise<Content | null> {
	const f = app.vault.getAbstractFileByPath(fig.path);
	if (!(f instanceof TFile)) return null;
	try {
		if (!fig.page) return sourceKind(f) === "image" ? await imageContent(app, f) : null;
		if (sourceKind(f) !== "pdf") return null;
		const pdfjs = await loadPdfJs();
		const doc = await pdfjs.getDocument({ data: new Uint8Array(await app.vault.readBinary(f)) }).promise;
		try {
			if (fig.page > doc.numPages) return null;
			return await renderedPage(await doc.getPage(fig.page));
		} finally {
			await doc.destroy?.();
		}
	} catch (e) {
		console.warn("[Lacuna] figure for grading", fig.path, e);
		return null;
	}
}

// ------------------------------------------------------------------ Folder

/** All usable files of a folder (recursive), sorted by path. */
export function folderFiles(o: TFolder, exclude: (f: TFile) => boolean): TFile[] {
	const out: TFile[] = [];
	const walk = (x: TFolder) => {
		for (const c of x.children) {
			if (c instanceof TFolder) walk(c);
			else if (c instanceof TFile && sourceKind(c) && !exclude(c)) out.push(c);
		}
	};
	walk(o);
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadFolderSource(app: App, o: TFolder, files: TFile[], opt: SourceOptions = {}): Promise<SourceContent & { used: number }> {
	const s = t().sources;
	if (!files.length) throw new Error(s.folderEmpty(o.name));
	const images: Content[] = [];
	const figures = new FigureList();
	let imageCount = 0;
	let figurePages = 0;
	let pdfsRead = 0;
	const texts: string[] = [];
	let chars = 0;
	let used = 0;
	const skipped: string[] = [];

	for (const f of files) {
		const kind = sourceKind(f);
		const head = `=== File: ${f.path} ===`;
		try {
			if (kind === "note") {
				const n = await noteContent(app, f, Math.max(0, MAX_IMAGES - imageCount));
				if (chars + n.text.length > MAX_CHARS) {
					skipped.push(f.name);
					continue;
				}
				for (const i of n.images) images.push(...labeledImage(figures, i.path, i.content));
				imageCount += n.images.length;
				texts.push(`${head}\n${n.text}`);
				chars += n.text.length;
			} else if (kind === "pdf") {
				const budget = opt.figures ? MAX_FIGURE_PAGES - figurePages : 0;
				const p = await pdfText(app, f, "", budget);
				if (p.scanned || chars + p.text.length > MAX_CHARS) {
					skipped.push(f.name + (p.scanned ? ` (${s.scannedShort})` : ""));
					continue;
				}
				images.push(...labeledPages(figures, f.path, p.figures));
				figurePages += p.figures.length;
				pdfsRead++;
				texts.push(`${head}\n${p.text}`);
				chars += p.text.length;
			} else if (kind === "image") {
				if (imageCount >= MAX_IMAGES) {
					skipped.push(f.name);
					continue;
				}
				const b = await imageContent(app, f);
				if (!b) {
					skipped.push(f.name);
					continue;
				}
				images.push(...labeledImage(figures, f.path, b));
				imageCount++;
				texts.push(`${head}\n(image, see above)`);
			}
			used++;
		} catch {
			skipped.push(f.name);
		}
	}
	if (!used) throw new Error(s.folderUnreadable);
	return {
		content: [...images, { type: "text", text: `Source: ${used} files from the folder "${o.name}".\n<<<\n${texts.join("\n\n")}\n>>>` }],
		pages: "",
		used,
		figures,
		hint:
			[
				skipped.length ? s.skipped(skipped.length, skipped.slice(0, 5).join(", ") + (skipped.length > 5 ? " …" : "")) : "",
				opt.figures && pdfsRead ? figureHint(figurePages) : "",
			]
				.filter(Boolean)
				.join("\n") || undefined,
	};
}

// ------------------------------------------------------------------ Folder in chunks (topic list)

export interface Chunk {
	content: Content[];
	files: string[];
}

export interface FolderChunks {
	chunks: Chunk[];
	/** All files that were read */
	files: string[];
	chars: number;
	images: number;
	scanPages: number;
	skipped: string[];
}

/** Read a whole folder and split it into chunks below maxChars – for big subjects with many scripts. */
export async function loadFolderChunks(app: App, files: TFile[], maxChars = 250_000): Promise<FolderChunks> {
	const s = t().sources;
	const chunks: Chunk[] = [];
	let texts: string[] = [];
	let images: Content[] = [];
	let names: string[] = [];
	let chunkChars = 0;
	const out: FolderChunks = { chunks, files: [], chars: 0, images: 0, scanPages: 0, skipped: [] };

	const close = () => {
		if (!names.length) return;
		chunks.push({ content: [...images, { type: "text", text: `<<<\n${texts.join("\n\n")}\n>>>` }], files: names });
		texts = [];
		images = [];
		names = [];
		chunkChars = 0;
	};
	const addText = (path: string, text: string) => {
		let x = text;
		if (x.length > maxChars) {
			x = x.slice(0, maxChars);
			out.skipped.push(`${path.split("/").pop()} (${s.truncatedShort})`);
		}
		if (chunkChars + x.length > maxChars) close();
		texts.push(`=== File: ${path} ===\n${x}`);
		names.push(path);
		chunkChars += x.length;
		out.chars += x.length;
		out.files.push(path);
	};

	for (const f of files) {
		const kind = sourceKind(f);
		try {
			if (kind === "note") {
				const n = await noteContent(app, f, 0);
				if (n.text.trim().length < 40) continue;
				addText(f.path, n.text);
			} else if (kind === "pdf") {
				const p = await pdfText(app, f, "");
				if (p.scanned) {
					if (p.buf.byteLength > MAX_PDF_BYTES) {
						out.skipped.push(`${f.name} (${s.scanTooLargeShort})`);
						continue;
					}
					// Scanned PDF: own chunk, the AI reads the pages as images
					chunks.push({ content: [pdfDocument(p.buf), { type: "text", text: `=== File: ${f.path} (scanned) ===` }], files: [f.path] });
					out.scanPages += p.pageCount;
					out.files.push(f.path);
				} else addText(f.path, p.text);
			} else if (kind === "image") {
				if (images.length >= MAX_IMAGES) close();
				const b = await imageContent(app, f);
				if (!b) {
					out.skipped.push(`${f.name} (> 5 MB)`);
					continue;
				}
				images.push(b);
				texts.push(`=== File: ${f.path} === (image, see above)`);
				names.push(f.path);
				out.images++;
				out.files.push(f.path);
			}
		} catch {
			out.skipped.push(f.name);
		}
	}
	close();
	return out;
}

// ------------------------------------------------------------------ Past exam

const EXAM_PATTERN = /klausur|exam|pr(ü|ue)fung|probeklausur|altklausur|midterm|final/i;

/** Possible past exams: PDFs/notes with "exam", "Klausur" etc. in the name, subject folder first. */
export function findPastExams(app: App, subject: TFolder): TFile[] {
	const candidates = app.vault.getFiles().filter((f) => (f.extension === "pdf" || f.extension === "md") && EXAM_PATTERN.test(f.basename));
	const prefix = subject.isRoot() ? "" : subject.path + "/";
	return candidates.sort((a, b) => Number(b.path.startsWith(prefix)) - Number(a.path.startsWith(prefix)) || a.path.localeCompare(b.path));
}

export async function loadStyleTemplate(app: App, f: TFile): Promise<Content[]> {
	const head = `=== STYLE TEMPLATE (past exam "${f.name}"): only adopt style and level, no content ===`;
	const end = "=== END STYLE TEMPLATE ===";
	if (f.extension === "md") {
		const text = (await app.vault.cachedRead(f)).slice(0, MAX_CHARS_STYLE);
		return [{ type: "text", text: `${head}\n${text}\n${end}` }];
	}
	if (f.extension === "pdf") {
		const p = await pdfText(app, f, "");
		if (p.scanned) {
			if (p.buf.byteLength > MAX_PDF_BYTES) throw new Error(t().sources.examScanTooLarge);
			return [{ type: "text", text: head }, pdfDocument(p.buf), { type: "text", text: end }];
		}
		return [{ type: "text", text: `${head}\n${p.text.slice(0, MAX_CHARS_STYLE)}\n${end}` }];
	}
	throw new Error(t().sources.examType);
}
