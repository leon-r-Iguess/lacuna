// Store quiz data (including solutions) invisibly inside the quiz note:
// as an Obsidian comment %%lacuna-data … %% containing Base64-encoded JSON.
// Everything stays in the vault, even if the plugin folder is not synced.
// Notes created by Skript-Check (the German predecessor) use %%skript-check-daten and are still read.

import { t } from "../i18n";
import { fromLegacy } from "./legacy";
import { QuizData } from "./types";

const START = "%%lacuna-data";
const LEGACY_START = "%%skript-check-daten";
const END = "%%";

function toBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

function fromBase64(b64: string): string {
	const bin = atob(b64.replace(/\s+/g, ""));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

export function dataBlock(q: QuizData): string {
	// Wrap at 76 characters so the editor does not choke on one huge line
	const b64 = toBase64(JSON.stringify(q)).replace(/(.{76})/g, "$1\n");
	return `${START} ${t().md.dataBlockNote}\n${b64}\n${END}`;
}

/** Position of the last data block (new or legacy marker). */
function findStart(md: string): { index: number; marker: string } | null {
	const a = md.lastIndexOf(START);
	const b = md.lastIndexOf(LEGACY_START);
	if (a < 0 && b < 0) return null;
	return a >= b ? { index: a, marker: START } : { index: b, marker: LEGACY_START };
}

export function readDataBlock(md: string): QuizData | null {
	const s = findStart(md);
	if (!s) return null;
	const rest = md.slice(s.index + s.marker.length);
	const lineEnd = rest.indexOf("\n");
	const end = rest.indexOf(END, lineEnd);
	if (lineEnd < 0 || end < 0) return null;
	try {
		return fromLegacy(JSON.parse(fromBase64(rest.slice(lineEnd + 1, end))));
	} catch {
		return null;
	}
}

export function withoutDataBlock(md: string): string {
	const s = findStart(md);
	if (!s) return md;
	const end = md.indexOf(END, md.indexOf("\n", s.index));
	return (md.slice(0, s.index) + (end >= 0 ? md.slice(end + END.length) : "")).replace(/\n{3,}$/, "\n");
}

export function withDataBlock(md: string, q: QuizData): string {
	return withoutDataBlock(md).replace(/\s*$/, "") + "\n\n" + dataBlock(q) + "\n";
}
