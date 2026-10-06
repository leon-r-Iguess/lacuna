// Compatibility with Skript-Check, the German predecessor of Lacuna (versions 0.1–0.4).
// Old quiz notes store their data with German field names; old settings live in
// .obsidian/plugins/skript-check/data.json. Both are converted on the fly.

import type { Confidence, Difficulty, ErrorType, Level, QuestionTypes, QuizData } from "./types";

const DIFFICULTY: Record<string, Difficulty> = { leicht: "easy", mittel: "medium", schwer: "hard" };
const LEVEL: Record<string, Level> = { einstieg: "intro", normal: "normal", klausur: "exam" };
const QUESTION_TYPES: Record<string, QuestionTypes> = { gemischt: "mixed", mc: "mc", offen: "open" };
const CONFIDENCE: Record<string, Confidence> = { geraten: "guessed", unsicher: "unsure", sicher: "sure" };
const ERROR_TYPE: Record<string, ErrorType> = {
	"Wissenslücke": "knowledge_gap",
	Verwechslung: "confusion",
	"Unvollständig": "incomplete",
	Anwendungsfehler: "application",
	Rechenfehler: "calculation",
	Ungenau: "imprecise",
};

export const legacyDifficulty = (x: unknown): Difficulty | undefined => DIFFICULTY[String(x)];
export const legacyLevel = (x: unknown): Level | undefined => LEVEL[String(x)];
export const legacyConfidence = (x: unknown): Confidence | undefined => CONFIDENCE[String(x)];
export const legacyErrorType = (x: unknown): ErrorType | undefined => ERROR_TYPE[String(x)];

/** True if the object uses the German data format. */
export function isLegacyQuiz(o: any): boolean {
	return !!o && typeof o === "object" && Array.isArray(o.fragen) && !Array.isArray(o.questions);
}

/** Convert a quiz in the German format to the current one. Current data is returned unchanged. */
export function fromLegacy(o: any): QuizData {
	if (!isLegacyQuiz(o)) return o as QuizData;
	const q: QuizData = {
		id: String(o.id ?? ""),
		title: String(o.titel ?? ""),
		source: String(o.quelle ?? ""),
		pages: String(o.seiten ?? ""),
		created: String(o.erstellt ?? ""),
		questions: (o.fragen as any[]).map((f) => ({
			nr: Number(f.nr),
			type: f.typ === "mc" ? "mc" : "open",
			difficulty: DIFFICULTY[f.schwierigkeit] ?? "medium",
			topic: String(f.thema ?? ""),
			question: String(f.frage ?? ""),
			options: Array.isArray(f.optionen) ? f.optionen.map(String) : [],
			correct: typeof f.richtig === "number" && f.richtig >= 0 ? f.richtig : null,
			solution: String(f.loesung ?? ""),
			reference: String(f.fundstelle ?? ""),
		})),
	};
	if (o.stilvorlage) q.styleTemplate = String(o.stilvorlage);
	if (o.niveau && LEVEL[o.niveau]) q.level = LEVEL[o.niveau];
	if (o.kosten) {
		const k = o.kosten;
		q.cost = { input: k.input ?? 0, output: k.output ?? 0, usd: k.usd ?? null, model: k.modell ?? k.model ?? "", provider: k.anbieter ?? k.provider ?? "" };
	}
	if (Array.isArray(o.antworten)) {
		q.answers = o.antworten.map((a: any) => ({
			nr: Number(a.nr),
			checked: Array.isArray(a.angekreuzt) ? a.angekreuzt : [],
			text: String(a.text ?? ""),
			...(CONFIDENCE[a.sicherheit] ? { confidence: CONFIDENCE[a.sicherheit] } : {}),
		}));
	}
	if (o.ergebnis) {
		const e = o.ergebnis;
		const errorTypes: Partial<Record<ErrorType, number>> = {};
		for (const [k, v] of Object.entries(e.fehlertypen ?? {})) {
			const key = ERROR_TYPE[k];
			if (key) errorTypes[key] = (errorTypes[key] ?? 0) + Number(v);
		}
		q.result = {
			evaluated: String(e.ausgewertet ?? ""),
			points: Number(e.punkte ?? 0),
			max: Number(e.max ?? 0),
			percent: Number(e.prozent ?? 0),
			evaluations: (e.bewertungen ?? []).map((b: any) => ({
				nr: Number(b.nr),
				points: Number(b.punkte ?? 0),
				max: Number(b.max ?? 0),
				errorType: b.fehlertyp ? (ERROR_TYPE[b.fehlertyp] ?? "knowledge_gap") : null,
				whatWasWrong: String(b.was_falsch ?? ""),
				correct: String(b.richtig ?? ""),
				reference: String(b.fundstelle ?? ""),
				followUp: String(b.nachfrage ?? ""),
				...(CONFIDENCE[b.sicherheit] ? { confidence: CONFIDENCE[b.sicherheit] } : {}),
			})),
			topics: (e.themen ?? []).map((th: any) => ({ topic: String(th.thema ?? ""), points: th.punkte ?? 0, max: th.max ?? 0, percent: th.prozent ?? 0 })),
			errorTypes,
			summary: String(e.fazit ?? ""),
		};
	}
	return q;
}

/** Map Skript-Check settings (German keys) to Lacuna settings. Unknown keys are dropped. */
export function settingsFromLegacy(o: any): Record<string, unknown> {
	if (!o || typeof o !== "object") return {};
	const out: Record<string, unknown> = {};
	const copy = (from: string, to: string, map?: (v: any) => unknown) => {
		if (o[from] === undefined || o[from] === null) return;
		const v = map ? map(o[from]) : o[from];
		if (v !== undefined) out[to] = v;
	};
	copy("anbieter", "provider");
	copy("apiKey", "claudeKey");
	copy("geminiKey", "geminiKey");
	copy("openaiKey", "openaiKey");
	copy("modell", "claudeModel");
	copy("geminiModell", "geminiModel");
	copy("openaiModell", "openaiModel");
	copy("workspaceId", "workspaceId");
	copy("standardAnzahl", "defaultCount");
	copy("fragetypen", "questionTypes", (v) => QUESTION_TYPES[v]);
	copy("niveau", "level", (v) => LEVEL[v]);
	copy("stilvorlagen", "styleTemplates");
	copy("testOrdner", "quizFolder");
	copy("lernstandName", "progressName");
	copy("themenName", "topicsName");
	copy("zielErinnerung", "targetRetention");
	copy("reifeDeckel", "readinessCap");
	copy("sicherheitAbfragen", "askConfidence");
	copy("statusleiste", "statusBar");
	copy("ohneThemenliste", "noTopicList");
	if (o.nurMC === true && !out.questionTypes) out.questionTypes = "mc";
	return out;
}
