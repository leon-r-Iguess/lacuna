import { beforeEach, describe, expect, it } from "vitest";
import * as ob from "./fake-obsidian";
import { setLang } from "../src/i18n";
import { AIConfig, Content, GEMINI_FALLBACK_MODEL, aiJson, aiJsonWithCost, buildRequest, clock, isTransient, readText, readUsage, translateError, waitMs } from "../src/ai";
import { addCost, computeCost, costText } from "../src/core/cost";

const DEF = {
	name: "create_quiz",
	description: "",
	input_schema: { type: "object", properties: { title: { type: "string" }, n: { type: "integer" } } },
};
const CONTENT: Content[] = [
	{ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
	{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "UERG" } },
	{ type: "text", text: "Source" },
];
const cfg = (provider: AIConfig["provider"]): AIConfig => ({ provider, apiKey: "k", model: "m" });

beforeEach(() => setLang("en"));

describe("requests per provider", () => {
	it("Claude: output_config, headers", () => {
		const a = buildRequest({ ...cfg("claude"), workspaceId: "wrkspc_1" }, "SYS", CONTENT, DEF, 1000, true) as any;
		expect(a.url).toBe("https://api.anthropic.com/v1/messages");
		expect(a.headers["x-api-key"]).toBe("k");
		expect(a.headers["anthropic-workspace-id"]).toBe("wrkspc_1");
		expect(a.body.system).toBe("SYS");
		expect(a.body.output_config.format.schema.additionalProperties).toBe(false);
		expect(a.body.messages[0].content[1].type).toBe("document");
	});

	it("Gemini: generateContent, inline_data, responseJsonSchema", () => {
		const a = buildRequest(cfg("gemini"), "SYS", CONTENT, DEF, 1000, true) as any;
		expect(a.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m:generateContent");
		expect(a.headers["x-goog-api-key"]).toBe("k");
		expect(a.body.systemInstruction.parts[0].text).toBe("SYS");
		expect(a.body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: "image/png", data: "QUJD" } });
		expect(a.body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: "application/pdf", data: "UERG" } });
		expect(a.body.contents[0].parts[2]).toEqual({ text: "Source" });
		expect(a.body.generationConfig.responseMimeType).toBe("application/json");
		expect(a.body.generationConfig.responseJsonSchema.required).toEqual(["title", "n"]);
		expect(a.body.generationConfig.maxOutputTokens).toBe(1000);
	});

	it("OpenAI: Responses API, strict json_schema, input_image/input_file", () => {
		const a = buildRequest(cfg("openai"), "SYS", CONTENT, DEF, 1000, true) as any;
		expect(a.url).toBe("https://api.openai.com/v1/responses");
		expect(a.headers.Authorization).toBe("Bearer k");
		expect(a.body.instructions).toBe("SYS");
		const c = a.body.input[0].content;
		expect(c[0]).toEqual({ type: "input_image", image_url: "data:image/png;base64,QUJD" });
		expect(c[1]).toEqual({ type: "input_file", filename: "source.pdf", file_data: "data:application/pdf;base64,UERG" });
		expect(c[2]).toEqual({ type: "input_text", text: "Source" });
		expect(a.body.text.format).toMatchObject({ type: "json_schema", name: "create_quiz", strict: true });
		expect(a.body.text.format.schema.additionalProperties).toBe(false);
		expect(a.body.max_output_tokens).toBe(1000);
	});

	it("without schema: instruction in the text", () => {
		for (const p of ["claude", "gemini", "openai"] as const) {
			const a = buildRequest(cfg(p), "SYS", CONTENT, DEF, 1000, false) as any;
			expect(JSON.stringify(a.body)).toContain("Reply with a single JSON object only");
			expect(JSON.stringify(a.body)).not.toContain("json_schema");
			expect(a.body.generationConfig?.responseJsonSchema).toBeUndefined();
		}
	});
});

describe("reading responses", () => {
	it("Gemini: ignore thought parts, detect truncation", () => {
		expect(readText("gemini", { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "think", thought: true }, { text: '{"a":1}' }] } }] })).toBe('{"a":1}');
		expect(() => readText("gemini", { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] })).toThrow(/cut off/);
		expect(() => readText("gemini", { promptFeedback: { blockReason: "SAFETY" } })).toThrow(/blocked/);
	});
	it("OpenAI: output_text, output list, incomplete, refusal", () => {
		expect(readText("openai", { output_text: "X" })).toBe("X");
		expect(readText("openai", { output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: '{"a":1}' }] }] })).toBe('{"a":1}');
		expect(() => readText("openai", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toThrow(/cut off/);
		expect(() => readText("openai", { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })).toThrow(/refused/);
	});
	it("error messages, in the UI language", () => {
		expect(translateError("openai", 429, "You exceeded your current quota").message).toContain("No credit");
		expect(translateError("gemini", 400, "API key not valid. Please pass a valid API key. API_KEY_INVALID").message).toContain("invalid");
		expect(translateError("gemini", 404, "models/foo is not found for API version v1beta").message).toContain("Model not available");
		expect(translateError("openai", 429, "Rate limit reached").message).toContain("Rate limit");
		setLang("de");
		expect(translateError("openai", 429, "You exceeded your current quota").message).toContain("Kein Guthaben");
	});
});

describe("aiJson end-to-end", () => {
	beforeEach(() => ob.requestUrl.mockReset());

	it("Gemini returns JSON", async () => {
		ob.requestUrl.mockResolvedValueOnce({ status: 200, json: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"title":"T","n":2}' }] } }] }, text: "" });
		expect(await aiJson(cfg("gemini"), "S", CONTENT, DEF)).toEqual({ title: "T", n: 2 });
	});

	it("OpenAI: schema error -> second attempt without schema", async () => {
		ob.requestUrl.mockResolvedValueOnce({ status: 400, json: { error: { message: "Invalid schema for response_format 'create_quiz'" } }, text: "" });
		ob.requestUrl.mockResolvedValueOnce({ status: 200, json: { output_text: '{"title":"T","n":1}' }, text: "" });
		expect(await aiJson(cfg("openai"), "S", CONTENT, DEF)).toEqual({ title: "T", n: 1 });
		expect(JSON.parse(ob.requestUrl.mock.calls[1][0].body).text.format.type).toBe("json_object");
	});

	it("clear error without a key", async () => {
		await expect(aiJson({ ...cfg("gemini"), apiKey: "" }, "S", CONTENT, DEF)).rejects.toThrow(/Gemini/);
	});
});

describe("overload: retry and fall back", () => {
	const ok = (text: string) => ({ status: 200, json: { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }, text: "" });
	const overloaded = { status: 503, json: { error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } }, text: "" };
	let waited: number[] = [];
	beforeEach(() => {
		ob.requestUrl.mockReset();
		waited = [];
		clock.sleep = async (ms: number) => {
			waited.push(ms);
		};
	});

	it("detects transient errors, but not missing credit or daily limits", () => {
		expect(isTransient(overloaded)).toBe(true);
		expect(isTransient({ status: 429, json: { error: { message: "Resource has been exhausted (e.g. check quota)." } } })).toBe(true);
		expect(isTransient({ status: 429, json: { error: { message: "You exceeded your current quota" } } })).toBe(false);
		expect(isTransient({ status: 429, json: { error: { message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 250, GenerateRequestsPerDayPerProjectPerModel" } } })).toBe(false);
		expect(isTransient({ status: 400, json: {} })).toBe(false);
	});

	it("wait time from Retry-After, Gemini retryDelay or staggered", () => {
		expect(waitMs({ status: 429, json: null, text: "", headers: { "retry-after": "7" } }, 0)).toBe(7000);
		expect(waitMs({ status: 429, json: { error: { details: [{ "@type": "RetryInfo", retryDelay: "17s" }] } }, text: "" }, 0)).toBe(17000);
		expect(waitMs({ status: 429, json: { error: { details: [{ retryDelay: "120s" }] } }, text: "" }, 0)).toBe(30000);
		expect(waitMs({ status: 503, json: null, text: "" }, 0)).toBe(2000);
		expect(waitMs({ status: 503, json: null, text: "" }, 5)).toBe(12000);
	});

	it("succeeds on the third attempt after two overloads (no fallback model)", async () => {
		ob.requestUrl.mockResolvedValueOnce(overloaded).mockResolvedValueOnce(overloaded).mockResolvedValueOnce(ok('{"title":"T","n":1}'));
		const attempts: number[] = [];
		const r = await aiJsonWithCost({ ...cfg("gemini"), model: GEMINI_FALLBACK_MODEL }, "S", CONTENT, DEF, 1000, { onWait: (i) => attempts.push(i.attempt) });
		expect(r.data).toEqual({ title: "T", n: 1 });
		expect(waited).toEqual([2000, 5000]);
		expect(attempts).toEqual([1, 2]);
	});

	it("Gemini switches to the fallback model after 2 failed attempts, cost uses its name", async () => {
		for (let i = 0; i < 2; i++) ob.requestUrl.mockResolvedValueOnce(overloaded);
		ob.requestUrl.mockResolvedValueOnce(ok('{"title":"T","n":2}'));
		let fellBack = "";
		const r = await aiJsonWithCost({ ...cfg("gemini"), model: "gemini-3.8-flash" }, "S", CONTENT, DEF, 1000, { onFallback: (m) => (fellBack = m) });
		expect(fellBack).toBe(GEMINI_FALLBACK_MODEL);
		expect(ob.requestUrl.mock.calls[2][0].url).toContain(GEMINI_FALLBACK_MODEL);
		expect(waited).toEqual([2000]); // only a short wait
		expect(r.cost.model).toBe(GEMINI_FALLBACK_MODEL);
	});

	it("gives a clear message after all attempts", async () => {
		ob.requestUrl.mockResolvedValue(overloaded);
		await expect(aiJsonWithCost({ ...cfg("gemini"), model: "gemini-3.8-flash" }, "S", CONTENT, DEF)).rejects.toThrow(/overloaded right now \(even after several attempts and with the fallback model\)/);
		expect(ob.requestUrl).toHaveBeenCalledTimes(6); // 2 main model + 4 fallback model
	});

	it("Claude: no model switch, only retries", async () => {
		ob.requestUrl.mockResolvedValue({ status: 529, json: { error: { message: "Overloaded" } }, text: "" });
		await expect(aiJsonWithCost(cfg("claude"), "S", CONTENT, DEF)).rejects.toThrow(/overloaded/);
		expect(ob.requestUrl).toHaveBeenCalledTimes(4);
	});

	it("no retries when credit is missing", async () => {
		ob.requestUrl.mockResolvedValue({ status: 429, json: { error: { message: "You exceeded your current quota, please check your plan and billing details." } }, text: "" });
		await expect(aiJsonWithCost(cfg("openai"), "S", CONTENT, DEF)).rejects.toThrow(/No credit/);
		expect(ob.requestUrl).toHaveBeenCalledTimes(1);
	});
});

describe("cost", () => {
	it("pricing and usage per provider", () => {
		expect(computeCost("openai", "gpt-6-luna", { input: 1_000_000, output: 1_000_000 }).usd).toBeCloseTo(0.6);
		expect(computeCost("gemini", "gemini-3.8-flash", { input: 1_000_000, output: 0 }, new Date("2026-10-06")).usd).toBeCloseTo(0.75);
		expect(computeCost("gemini", "gemini-3.8-flash", { input: 1_000_000, output: 0 }, new Date("2027-02-01")).usd).toBeCloseTo(1.5);
		const unknown = computeCost("claude", "claude-something", { input: 10, output: 10 });
		expect(unknown.usd).toBeNull();
		expect(costText(unknown)).toContain("cost unknown");
		expect(costText(computeCost("gemini", "gemini-3.5-flash-lite", { input: 100, output: 100 }))).toContain("free Gemini quota");
		expect(costText(computeCost("claude", "claude-sonnet-5-5", { input: 20000, output: 3000 }))).toBe("claude-sonnet-5-5 · 23,000 Tokens · approx. $0.07");
		setLang("de");
		expect(costText(computeCost("claude", "claude-sonnet-5-5", { input: 20000, output: 3000 }))).toBe("claude-sonnet-5-5 · 23.000 Tokens · ca. 0,07 $");
		expect(addCost(unknown, computeCost("claude", "claude-sonnet-5-5", { input: 1, output: 1 })).usd).toBeNull();
		expect(readUsage("gemini", { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } })).toEqual({ input: 10, output: 12 });
		expect(readUsage("openai", { usage: { input_tokens: 3, output_tokens: 4 } })).toEqual({ input: 3, output: 4 });
		expect(readUsage("claude", { usage: { input_tokens: 3, cache_read_input_tokens: 2, output_tokens: 4 } })).toEqual({ input: 5, output: 4 });
	});
});
