// JSON helpers: lenient parsing and strict schemas for structured output.

/** Extract JSON from model text; repairs typical mistakes of small models (missing commas, Markdown fences). */
export function parseLoose(raw: string): any {
	let s = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
	const a = s.indexOf("{");
	const b = s.lastIndexOf("}");
	if (a < 0 || b < 0) throw new Error("No JSON found");
	s = s.slice(a, b + 1);
	try {
		return JSON.parse(s);
	} catch {
		/* try to repair */
	}
	s = s.replace(/}\s*{/g, "},{").replace(/,\s*([\]}])/g, "$1");
	return JSON.parse(s);
}

/**
 * Prepare a schema for strict structured output: every object gets
 * additionalProperties: false and all properties as required.
 */
export function strictSchema(schema: any): any {
	if (Array.isArray(schema)) return schema.map(strictSchema);
	if (!schema || typeof schema !== "object") return schema;
	const out: any = {};
	for (const [k, v] of Object.entries(schema)) out[k] = k === "enum" ? v : strictSchema(v);
	if (out.type === "object" && out.properties) {
		out.additionalProperties = false;
		out.required = Object.keys(out.properties);
	}
	return out;
}
