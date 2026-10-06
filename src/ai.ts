// AI providers: Claude, Gemini and ChatGPT (OpenAI) via Obsidian's requestUrl (no CORS issues).
// All three return JSON following the same schema.

import { requestUrl } from "obsidian";
import { t } from "./i18n";
import { parseLoose, strictSchema } from "./core/json";
import { Cost, Usage, computeCost } from "./core/cost";

export type Provider = "claude" | "gemini" | "openai";

export const PROVIDER_NAMES: Record<Provider, string> = {
	claude: "Claude (Anthropic)",
	gemini: "Gemini (Google)",
	openai: "ChatGPT (OpenAI)",
};

export const SHORT_NAMES: Record<Provider, string> = { claude: "Claude", gemini: "Gemini", openai: "ChatGPT" };

export const DEFAULT_MODELS: Record<Provider, string> = {
	claude: "claude-sonnet-5-5",
	gemini: "gemini-3.8-flash",
	openai: "gpt-6.1-sol",
};

export const KEY_LINKS: Record<Provider, string> = {
	claude: "platform.claude.com → API Keys",
	gemini: "aistudio.google.com → Get API key",
	openai: "platform.openai.com → API keys",
};

export type Content =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } }
	| { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export interface SchemaDef {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export interface AIConfig {
	provider: Provider;
	apiKey: string;
	model: string;
	/** Claude only: for keys that are not scoped to a workspace (wrkspc_…) */
	workspaceId?: string;
}

interface Response {
	status: number;
	json: any;
	text: string;
	headers?: Record<string, string>;
}

/** Fallback when the main Gemini model is overloaded (also in the free tier). */
export const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const MAX_ATTEMPTS = 4; // 1 + 3 retries
const WAIT_MS = [2000, 5000, 12000];
const MAX_WAIT_MS = 30000;

/** Swappable in tests. */
export const clock = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

export interface AIOptions {
	/** Called before retrying after overload / short-term limits. */
	onWait?: (info: { seconds: number; attempt: number; model: string; status: number }) => void;
	/** Called when switching to the fallback model. */
	onFallback?: (model: string) => void;
}

/** Errors worth retrying (overload, short-term limits). */
export function isTransient(r: { status: number; json?: any; text?: string }): boolean {
	if (![429, 500, 502, 503, 504, 529].includes(r.status)) return false;
	const msg = (r.json?.error?.message || r.text || "") as string;
	// No credit or daily quota used up: waiting does not help
	if (/insufficient_quota|exceeded your current quota|credit|billing|per day|PerDay|daily/i.test(msg)) return false;
	return true;
}

/** How long to wait before the next attempt (Retry-After or Gemini retryDelay, otherwise staggered). */
export function waitMs(r: Response, attempt: number): number {
	const h = r.headers ?? {};
	const ra = h["retry-after"] ?? h["Retry-After"];
	if (ra && /^\d+(\.\d+)?$/.test(String(ra).trim())) return Math.min(MAX_WAIT_MS, Math.ceil(parseFloat(ra) * 1000));
	const details = r.json?.error?.details;
	if (Array.isArray(details)) {
		for (const d of details) {
			const m = typeof d?.retryDelay === "string" ? d.retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
			if (m) return Math.min(MAX_WAIT_MS, Math.ceil(parseFloat(m[1]) * 1000));
		}
	}
	return WAIT_MS[Math.min(attempt, WAIT_MS.length - 1)];
}

interface Request {
	url: string;
	headers: Record<string, string>;
	body: unknown;
}

const JSON_INSTRUCTION = (schema: unknown) => `Reply with a single JSON object only (no Markdown) following this schema:\n${JSON.stringify(schema)}`;

// ------------------------------------------------------------------ Build requests

export function buildRequest(cfg: AIConfig, system: string, content: Content[], def: SchemaDef, maxTokens: number, withSchema: boolean): Request {
	const schema = strictSchema(def.input_schema);
	const extra: Content[] = withSchema ? [] : [{ type: "text", text: JSON_INSTRUCTION(def.input_schema) }];
	const all = [...content, ...extra];

	if (cfg.provider === "claude") {
		return {
			url: "https://api.anthropic.com/v1/messages",
			headers: {
				"x-api-key": cfg.apiKey,
				"anthropic-version": "2023-06-01",
				...(cfg.workspaceId?.trim() ? { "anthropic-workspace-id": cfg.workspaceId.trim() } : {}),
			},
			body: {
				model: cfg.model,
				max_tokens: maxTokens,
				system,
				messages: [{ role: "user", content: all }],
				...(withSchema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
			},
		};
	}

	if (cfg.provider === "gemini") {
		const parts = all.map((i) => (i.type === "text" ? { text: i.text } : { inline_data: { mime_type: i.source.media_type, data: i.source.data } }));
		return {
			url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
			headers: { "x-goog-api-key": cfg.apiKey },
			body: {
				systemInstruction: { parts: [{ text: system }] },
				contents: [{ role: "user", parts }],
				generationConfig: {
					maxOutputTokens: maxTokens,
					responseMimeType: "application/json",
					...(withSchema ? { responseJsonSchema: schema } : {}),
				},
			},
		};
	}

	// OpenAI Responses API
	const input = all.map((i) => {
		if (i.type === "text") return { type: "input_text", text: i.text };
		if (i.type === "image") return { type: "input_image", image_url: `data:${i.source.media_type};base64,${i.source.data}` };
		return { type: "input_file", filename: "source.pdf", file_data: `data:application/pdf;base64,${i.source.data}` };
	});
	return {
		url: "https://api.openai.com/v1/responses",
		headers: { Authorization: `Bearer ${cfg.apiKey}` },
		body: {
			model: cfg.model,
			instructions: system,
			input: [{ role: "user", content: input }],
			max_output_tokens: maxTokens,
			...(withSchema ? { text: { format: { type: "json_schema", name: def.name, schema, strict: true } } } : { text: { format: { type: "json_object" } } }),
		},
	};
}

// ------------------------------------------------------------------ Read responses

/** Extract the text from a response; throws on truncation or refusal. */
export function readText(provider: Provider, json: any): string {
	const s = t().ai;
	if (provider === "claude") {
		if (json?.stop_reason === "max_tokens") throw truncated();
		if (json?.stop_reason === "refusal") throw new Error(s.refused("Claude"));
		return (json?.content ?? [])
			.filter((b: any) => b.type === "text")
			.map((b: any) => b.text)
			.join("");
	}
	if (provider === "gemini") {
		if (json?.promptFeedback?.blockReason) throw new Error(s.blocked(json.promptFeedback.blockReason));
		const c = json?.candidates?.[0];
		if (c?.finishReason === "MAX_TOKENS") throw truncated();
		if (c?.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(c.finishReason) && !c?.content?.parts?.length) throw new Error(s.aborted("Gemini", c.finishReason));
		return (c?.content?.parts ?? [])
			.filter((p: any) => typeof p.text === "string" && !p.thought)
			.map((p: any) => p.text)
			.join("");
	}
	// openai
	if (json?.status === "incomplete") {
		if (json?.incomplete_details?.reason === "max_output_tokens") throw truncated();
		throw new Error(s.aborted("ChatGPT", json?.incomplete_details?.reason ?? "incomplete"));
	}
	if (typeof json?.output_text === "string" && json.output_text) return json.output_text;
	const parts: string[] = [];
	for (const o of json?.output ?? []) {
		if (o.type !== "message") continue;
		for (const c of o.content ?? []) {
			if (c.type === "refusal") throw new Error(s.refused("ChatGPT"));
			if (c.type === "output_text") parts.push(c.text);
		}
	}
	return parts.join("");
}

function truncated() {
	return new Error(t().ai.truncated);
}

function errorText(r: Response): string {
	return r.json?.error?.message || r.text?.slice(0, 300) || `HTTP ${r.status}`;
}

/** Whether the error means the JSON schema is not supported (then retry without schema). */
export function isSchemaError(r: Response): boolean {
	return r.status === 400 && /output_config|json_schema|responseJsonSchema|response_?schema|text\.format|schema|structured/i.test(errorText(r));
}

export function translateError(provider: Provider, status: number, msg: string): Error {
	const name = PROVIDER_NAMES[provider];
	const s = t().ai;
	if (status === 401 || /API_KEY_INVALID|invalid api key|incorrect api key|invalid x-api-key/i.test(msg)) return new Error(s.invalidKey(name));
	if (provider === "claude" && status === 400 && /workspace/i.test(msg)) return new Error(s.noWorkspace);
	if (/credit|balance|billing|insufficient_quota|exceeded your current quota/i.test(msg)) return new Error(s.noCredit(name));
	if ((status === 404 || status === 400) && /model/i.test(msg) && /not found|does not exist|not supported|unknown|invalid/i.test(msg)) return new Error(s.modelUnavailable(name));
	if (status === 403) return new Error(s.forbidden(name, msg));
	if (status === 429) return new Error(s.rateLimit(name));
	if (status === 529 || status === 503 || status === 500) return new Error(s.overloadedShort(name));
	return new Error(s.generic(name, status, msg));
}

// ------------------------------------------------------------------ Send

async function send(a: Request): Promise<Response> {
	try {
		const r = await requestUrl({
			url: a.url,
			method: "POST",
			contentType: "application/json",
			headers: a.headers,
			body: JSON.stringify(a.body),
			throw: false,
		});
		let json: any = null;
		try {
			json = r.json;
		} catch {
			json = null;
		}
		return { status: r.status, json: json ?? safeJson(r.text), text: r.text ?? "", headers: (r as any).headers ?? {} };
	} catch (e) {
		throw new Error(t().ai.unreachable((e as Error).message));
	}
}

/** Token usage from a response. */
export function readUsage(provider: Provider, json: any): Usage {
	const n = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : 0);
	if (provider === "claude") {
		const u = json?.usage ?? {};
		return { input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), output: n(u.output_tokens) };
	}
	if (provider === "gemini") {
		const u = json?.usageMetadata ?? {};
		return { input: n(u.promptTokenCount), output: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount) };
	}
	const u = json?.usage ?? {};
	return { input: n(u.input_tokens), output: n(u.output_tokens) };
}

/** Send with automatic retries on overload / short-term limits. */
async function sendWithRetry(a: Request, model: string, opt: AIOptions, maxAttempts = MAX_ATTEMPTS): Promise<Response> {
	let res = await send(a);
	for (let attempt = 0; attempt < maxAttempts - 1 && isTransient(res); attempt++) {
		const ms = waitMs(res, attempt);
		opt.onWait?.({ seconds: Math.round(ms / 1000), attempt: attempt + 1, model, status: res.status });
		await clock.sleep(ms);
		res = await send(a);
	}
	return res;
}

/** One complete attempt with one model (including the no-schema fallback). */
async function attempt(cfg: AIConfig, system: string, content: Content[], def: SchemaDef, maxTokens: number, opt: AIOptions, maxAttempts = MAX_ATTEMPTS) {
	let res = await sendWithRetry(buildRequest(cfg, system, content, def, maxTokens, true), cfg.model, opt, maxAttempts);
	let before: Usage = { input: 0, output: 0 };
	if (isSchemaError(res)) {
		before = readUsage(cfg.provider, res.json);
		res = await sendWithRetry(buildRequest(cfg, system, content, def, maxTokens, false), cfg.model, opt, maxAttempts);
	}
	return { res, before };
}

/** Call the AI; returns the JSON result and the cost of the call. */
export async function aiJsonWithCost<T = any>(
	cfg: AIConfig,
	system: string,
	content: Content[],
	def: SchemaDef,
	maxTokens = 8000,
	opt: AIOptions = {},
): Promise<{ data: T; cost: Cost }> {
	const s = t().ai;
	if (!cfg.apiKey) throw new Error(s.noKey(PROVIDER_NAMES[cfg.provider]));

	let active = cfg;
	// Gemini with fallback: only one quick second try, then switch instead of waiting long
	const canFallBack = cfg.provider === "gemini" && cfg.model !== GEMINI_FALLBACK_MODEL;
	let { res, before } = await attempt(active, system, content, def, maxTokens, opt, canFallBack ? 2 : MAX_ATTEMPTS);
	if (canFallBack && isTransient(res)) {
		active = { ...cfg, model: GEMINI_FALLBACK_MODEL };
		opt.onFallback?.(active.model);
		({ res, before } = await attempt(active, system, content, def, maxTokens, opt));
	}
	if (res.status >= 400) {
		if (isTransient(res)) throw new Error(s.overloaded(PROVIDER_NAMES[cfg.provider], active !== cfg));
		throw translateError(cfg.provider, res.status, errorText(res));
	}

	const text = readText(cfg.provider, res.json);
	if (!text.trim()) throw new Error(s.empty(PROVIDER_NAMES[cfg.provider]));
	const now = readUsage(cfg.provider, res.json);
	const cost = computeCost(cfg.provider, active.model, { input: before.input + now.input, output: before.output + now.output });
	try {
		return { data: parseLoose(text) as T, cost };
	} catch {
		throw new Error(s.invalidJson);
	}
}

/** Call the AI and return only the JSON result. */
export async function aiJson<T = any>(cfg: AIConfig, system: string, content: Content[], def: SchemaDef, maxTokens = 8000, opt: AIOptions = {}): Promise<T> {
	return (await aiJsonWithCost<T>(cfg, system, content, def, maxTokens, opt)).data;
}

function safeJson(text: string | undefined): any {
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		return null;
	}
}
