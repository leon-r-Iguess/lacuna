// Turn sources (note, PDF, image, whole folder, past exam) into AI content.
// Labels sent to the AI are English; the material itself stays as it is.

import { App, TFile, TFolder, arrayBufferToBase64, loadPdfJs } from "obsidian";
import { Content } from "./ai";
import { t } from "./i18n";
import { imageEmbeds, mediaType, pageRangeText, parsePageRange } from "./core/util";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
const MAX_CHARS = 300_000; // ~75k tokens
const MAX_CHARS_STYLE = 60_000; // past exam: the style is enough
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit per image
const MAX_PDF_BYTES = 32 * 1024 * 1024; // API limit for PDF documents

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
	/** Hardly any text -> probably scanned */
	scanned: boolean;
	buf: ArrayBuffer;
	pageCount: number;
}

async function pdfText(app: App, f: TFile, pageInput: string): Promise<PdfText> {
	const buf = await app.vault.readBinary(f);
	const pdfjs = await loadPdfJs();
	const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
	const pages = parsePageRange(pageInput, doc.numPages);
	const parts: string[] = [];
	let chars = 0;
	for (const p of pages) {
		const page = await doc.getPage(p);
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
	await doc.destroy?.();
	return {
		text: parts.join("\n\n"),
		range: pageInput.trim() ? pageRangeText(pages) : "",
		scanned: chars / Math.max(1, pages.length) < 60,
		buf,
		pageCount: pages.length,
	};
}

function pdfDocument(buf: ArrayBuffer): Content {
	return { type: "document", source: { type: "base64", media_type: "application/pdf", data: arrayBufferToBase64(buf) } };
}

/** Note text plus embedded images. */
async function noteContent(app: App, f: TFile, maxImages: number): Promise<{ text: string; images: Content[] }> {
	const text = await app.vault.cachedRead(f);
	const images: Content[] = [];
	for (const link of imageEmbeds(text)) {
		if (images.length >= maxImages) break;
		const target = app.metadataCache.getFirstLinkpathDest(link, f.path);
		if (!target) continue;
		const b = await imageContent(app, target);
		if (b) images.push(b);
	}
	return { text, images };
}

// ------------------------------------------------------------------ Single file

export async function loadSource(app: App, f: TFile, pageInput: string): Promise<SourceContent> {
	const s = t().sources;
	const kind = sourceKind(f);
	if (kind === "image") {
		const b = await imageContent(app, f);
		if (!b) throw new Error(s.imageTooLarge);
		return { content: [b, { type: "text", text: `Source: image "${f.name}" (e.g. blackboard photo, slide or handwritten notes).` }], pages: "" };
	}

	if (kind === "note") {
		const { text, images } = await noteContent(app, f, MAX_IMAGES);
		if (text.length > MAX_CHARS) throw new Error(s.noteTooLong);
		if (text.trim().length < 80 && images.length === 0) throw new Error(s.noteEmpty);
		return {
			content: [...images, { type: "text", text: `Source: note "${f.basename}"${images.length ? ` (with ${images.length} embedded images above)` : ""}.\n<<<\n${text}\n>>>` }],
			pages: "",
		};
	}

	if (kind === "pdf") {
		const p = await pdfText(app, f, pageInput);
		if (p.scanned) {
			// Hardly any text: probably scanned -> send the PDF itself (the AI reads the pages as images)
			if (p.buf.byteLength > MAX_PDF_BYTES) throw new Error(s.scanTooLarge);
			return {
				content: [pdfDocument(p.buf), { type: "text", text: `Source: PDF "${f.name}"${p.range ? `, only use pages ${p.range}` : ""}.` }],
				pages: p.range,
				hint: p.range ? s.scanWithRange(p.range) : s.scan,
			};
		}
		if (p.text.length > MAX_CHARS) throw new Error(s.pdfTooLong);
		return { content: [{ type: "text", text: `Source: PDF "${f.name}"${p.range ? `, pages ${p.range}` : ""}.\n<<<\n${p.text}\n>>>` }], pages: p.range };
	}

	throw new Error(s.unsupported);
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

export async function loadFolderSource(app: App, o: TFolder, files: TFile[]): Promise<SourceContent & { used: number }> {
	const s = t().sources;
	if (!files.length) throw new Error(s.folderEmpty(o.name));
	const images: Content[] = [];
	const texts: string[] = [];
	let chars = 0;
	let used = 0;
	const skipped: string[] = [];

	for (const f of files) {
		const kind = sourceKind(f);
		const head = `=== File: ${f.path} ===`;
		try {
			if (kind === "note") {
				const n = await noteContent(app, f, Math.max(0, MAX_IMAGES - images.length));
				if (chars + n.text.length > MAX_CHARS) {
					skipped.push(f.name);
					continue;
				}
				images.push(...n.images);
				texts.push(`${head}\n${n.text}`);
				chars += n.text.length;
			} else if (kind === "pdf") {
				const p = await pdfText(app, f, "");
				if (p.scanned || chars + p.text.length > MAX_CHARS) {
					skipped.push(f.name + (p.scanned ? ` (${s.scannedShort})` : ""));
					continue;
				}
				texts.push(`${head}\n${p.text}`);
				chars += p.text.length;
			} else if (kind === "image") {
				if (images.length >= MAX_IMAGES) {
					skipped.push(f.name);
					continue;
				}
				const b = await imageContent(app, f);
				if (!b) {
					skipped.push(f.name);
					continue;
				}
				images.push(b);
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
		hint: skipped.length ? s.skipped(skipped.length, skipped.slice(0, 5).join(", ") + (skipped.length > 5 ? " …" : "")) : undefined,
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
