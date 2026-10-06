// Token usage and estimated cost.
// Prices in USD per 1M tokens (as of October 2026, from the providers' pricing pages).

import { t } from "../i18n";

export interface Usage {
	input: number;
	output: number;
}

export interface Cost extends Usage {
	/** Estimated cost in USD, null if the model is not in the price list */
	usd: number | null;
	model: string;
	provider: string;
}

type Price = { in: number; out: number };

export function priceFor(model: string, now: Date): Price | null {
	const m = model.toLowerCase();
	// Claude
	if (m.startsWith("claude-sonnet-5-5")) return { in: 2, out: 10 };
	if (m.startsWith("claude-opus-5-5")) return { in: 4, out: 20 };
	if (m.startsWith("claude-haiku-4-5")) return { in: 1, out: 5 };
	if (m.startsWith("claude-fable-5-1")) return { in: 10, out: 50 };
	// Gemini
	if (m.startsWith("gemini-3.8-flash")) return now < new Date("2027-01-01") ? { in: 0.75, out: 3.75 } : { in: 1.5, out: 7.5 };
	if (m.startsWith("gemini-3.5-flash-lite")) return { in: 0.3, out: 2.5 };
	if (m.startsWith("gemini-3.1-flash-lite")) return { in: 0.25, out: 1.5 };
	if (m.startsWith("gemini-3.1-pro")) return { in: 2, out: 12 };
	// OpenAI
	if (m.startsWith("gpt-6-astra")) return { in: 10, out: 50 };
	if (m.startsWith("gpt-6.1-sol")) return { in: 2, out: 10 };
	if (m.startsWith("gpt-6-luna")) return { in: 0.1, out: 0.5 };
	return null;
}

export function computeCost(provider: string, model: string, u: Usage, now: Date = new Date()): Cost {
	const p = priceFor(model, now);
	return {
		provider,
		model,
		input: u.input,
		output: u.output,
		usd: p ? (u.input * p.in + u.output * p.out) / 1_000_000 : null,
	};
}

/** Add two costs (e.g. create + evaluate). */
export function addCost(a: Cost | undefined, b: Cost): Cost {
	if (!a) return b;
	return {
		provider: b.provider,
		model: a.model === b.model ? a.model : `${a.model} + ${b.model}`,
		input: a.input + b.input,
		output: a.output + b.output,
		usd: a.usd === null || b.usd === null ? null : a.usd + b.usd,
	};
}

export function costText(c: Cost | undefined): string {
	if (!c) return "";
	const s = t().cost;
	const tokens = (c.input + c.output).toLocaleString(s.locale);
	let money: string;
	if (c.usd === null) money = s.unknown;
	else if (c.usd < 0.01) money = s.underOneCent;
	else money = s.approx(c.usd.toFixed(2).replace(".", s.decimal));
	const free = c.provider === "gemini" ? s.geminiFree : "";
	return `${c.model} · ${tokens} Tokens · ${money}${free}`;
}
