// Which PDF pages contain figures worth showing the AI as images (circuits, diagrams, plots, photos)?
// Decided from pdf.js operator lists without rendering anything: large embedded images, or many drawn
// vector paths. Decoration that repeats on most pages (university logo, header bar) does not count.

export interface PageStats {
	page: number;
	/** Pixel size of every image painted on the page */
	images: { w: number; h: number }[];
	/** Number of drawing operations (paths, strokes, fills) */
	paths: number;
}

/** Operator codes from pdf.js (`pdfjsLib.OPS`); only the ones needed here. */
export interface PdfOps {
	paintImageXObject?: number;
	paintInlineImageXObject?: number;
	paintImageXObjectRepeat?: number;
	paintImageMaskXObject?: number;
	paintJpegXObject?: number;
	constructPath?: number;
	stroke?: number;
	closeStroke?: number;
	fill?: number;
	eoFill?: number;
	fillStroke?: number;
	eoFillStroke?: number;
	closeFillStroke?: number;
	closeEOFillStroke?: number;
}

const MIN_IMAGE_SIDE = 120; // px; smaller ones are icons and bullets
const MIN_IMAGE_AREA = 40_000;
const MIN_PATHS = 40; // a vector figure (circuit, diagram) draws many paths
const DECORATION_SHARE = 0.5; // an image size on at least half of the pages is template decoration

function size(args: unknown): { w: number; h: number } | null {
	const a = Array.isArray(args) ? args : [];
	// paintImageXObject: [objId, width, height]
	if (typeof a[1] === "number" && typeof a[2] === "number") return { w: a[1], h: a[2] };
	// paintInlineImageXObject: [{ width, height, … }]
	const o = a[0] as { width?: unknown; height?: unknown } | undefined;
	if (o && typeof o.width === "number" && typeof o.height === "number") return { w: o.width, h: o.height };
	return null;
}

/** Count images and drawing operations of one page from its operator list. */
export function pageStats(page: number, fnArray: number[], argsArray: unknown[], ops: PdfOps): PageStats {
	const imageOps = new Set(
		[ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageXObjectRepeat, ops.paintJpegXObject].filter((x): x is number => typeof x === "number"),
	);
	const pathOps = new Set(
		[ops.constructPath, ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke].filter(
			(x): x is number => typeof x === "number",
		),
	);
	const images: { w: number; h: number }[] = [];
	let paths = 0;
	fnArray.forEach((fn, i) => {
		if (imageOps.has(fn)) {
			const s = size(argsArray[i]);
			if (s) images.push(s);
		} else if (pathOps.has(fn)) paths++;
	});
	return { page, images, paths };
}

/** Pages with figures, best first up to `max`, returned in page order. */
export function pickFigurePages(stats: PageStats[], max: number): number[] {
	if (max <= 0 || !stats.length) return [];
	const key = (i: { w: number; h: number }) => `${i.w}x${i.h}`;
	// Image sizes that repeat on most pages are logos / backgrounds of the slide template
	const pagesWith = new Map<string, number>();
	for (const s of stats) for (const k of new Set(s.images.map(key))) pagesWith.set(k, (pagesWith.get(k) ?? 0) + 1);
	const decoration = new Set(stats.length >= 4 ? [...pagesWith].filter(([, n]) => n / stats.length >= DECORATION_SHARE).map(([k]) => k) : []);

	// Paths: the template draws a few on every page (the leanest page shows how many), a figure many more.
	// Not the median: in a slide deck full of circuits most pages are figures.
	const pathThreshold = Math.max(MIN_PATHS, 2 * Math.min(...stats.map((s) => s.paths)) + 10);

	const scored = stats
		.map((s) => {
			const big = s.images.filter((i) => Math.min(i.w, i.h) >= MIN_IMAGE_SIDE && i.w * i.h >= MIN_IMAGE_AREA && !decoration.has(key(i))).length;
			const vector = s.paths >= pathThreshold ? s.paths : 0;
			return { page: s.page, score: big * 100 + vector };
		})
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score || a.page - b.page)
		.slice(0, max);
	return scored.map((s) => s.page).sort((a, b) => a - b);
}
