// Minimal stand-in for the Obsidian API used by the integration tests.
import { vi } from "vitest";

export class TAbstractFile {
	constructor(
		public path: string,
		public vault: any,
	) {}
	get name() {
		return this.path.split("/").pop() || "";
	}
	get parent(): TFolder | null {
		if (!this.path) return null;
		const i = this.path.lastIndexOf("/");
		const p = i < 0 ? "" : this.path.slice(0, i);
		return this.vault.folder(p);
	}
}
export class TFile extends TAbstractFile {
	get extension() {
		return this.name.includes(".") ? this.name.split(".").pop()! : "";
	}
	get basename() {
		return this.name.replace(/\.[^.]+$/, "");
	}
}
export class TFolder extends TAbstractFile {
	isRoot() {
		return this.path === "";
	}
	get children(): TAbstractFile[] {
		const v = this.vault as FakeVault;
		const prefix = this.path ? this.path + "/" : "";
		const direct = (p: string) => p.startsWith(prefix) && p !== this.path && !p.slice(prefix.length).includes("/");
		return [
			...[...v.folders].filter((p) => p !== "" && direct(p)).map((p) => new TFolder(p, v)),
			...[...v.files.keys()].filter(direct).map((p) => new TFile(p, v)),
		];
	}
}

export function normalizePath(p: string) {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export const requestUrl = vi.fn();
export const loadPdfJs = vi.fn();
export const moment = { locale: () => "en" };
export function arrayBufferToBase64(b: ArrayBuffer) {
	return Buffer.from(b).toString("base64");
}

export const notices: string[] = [];
export class Notice {
	constructor(public msg: string) {
		notices.push(msg);
	}
	setMessage(m: string) {
		notices.push(m);
		return this;
	}
	hide() {}
}

/** Tiny DOM stand-in with the Obsidian helpers (createDiv, setText, …). */
export class FakeEl {
	children: FakeEl[] = [];
	ownText = "";
	classes: string[] = [];
	style: Record<string, string> = {};
	attrs: Record<string, string> = {};
	onclick: (() => unknown) | null = null;
	disabled = false;
	constructor(public tag = "div") {}
	empty() {
		this.children = [];
		this.ownText = "";
	}
	setText(t: string) {
		this.ownText = t;
		this.children = [];
	}
	addClass(c: string) {
		this.classes.push(c);
	}
	setCssProps(props: Record<string, string>) {
		Object.assign(this.style, props);
	}
	setAttr(k: string, v: string) {
		this.attrs[k] = v;
	}
	createEl(tag: string, o: { cls?: string; text?: string } = {}) {
		const e = new FakeEl(tag);
		if (o.cls) e.classes.push(...o.cls.split(" "));
		if (o.text) e.ownText = o.text;
		this.children.push(e);
		return e;
	}
	createDiv(o: { cls?: string; text?: string } = {}) {
		return this.createEl("div", o);
	}
	createSpan(o: { cls?: string; text?: string } = {}) {
		return this.createEl("span", o);
	}
	get text(): string {
		return [this.ownText, ...this.children.map((k) => k.text)].filter(Boolean).join(" ");
	}
	all(tag: string): FakeEl[] {
		return [...(this.tag === tag ? [this] : []), ...this.children.flatMap((k) => k.all(tag))];
	}
}

function frontmatter(text: string): any {
	const m = text.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return undefined;
	const fm: any = {};
	for (const line of m[1].split("\n")) {
		const k = line.match(/^([\w-]+):\s*(.*)$/);
		if (k) fm[k[1]] = k[2].replace(/^"(.*)"$/, "$1");
	}
	return fm;
}

export class FakeVault {
	configDir = ".obsidian";
	files = new Map<string, string | ArrayBuffer>();
	folders = new Set<string>([""]);
	folder(p: string) {
		return this.folders.has(p) ? new TFolder(p, this) : null;
	}
	getRoot() {
		return new TFolder("", this);
	}
	getAbstractFileByPath(p: string) {
		p = normalizePath(p);
		if (this.files.has(p)) return new TFile(p, this);
		if (this.folders.has(p)) return new TFolder(p, this);
		return null;
	}
	private addParents(p: string) {
		const parts = p.split("/");
		for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
	}
	async create(p: string, content: string) {
		p = normalizePath(p);
		if (this.files.has(p)) throw new Error("already exists: " + p);
		this.addParents(p);
		this.files.set(p, content);
		return new TFile(p, this);
	}
	async createFolder(p: string) {
		this.addParents(p + "/x");
		return new TFolder(p, this);
	}
	async modify(f: TFile, content: string) {
		this.files.set(f.path, content);
	}
	async read(f: TFile) {
		return this.files.get(f.path) as string;
	}
	cachedRead(f: TFile) {
		return this.read(f);
	}
	async readBinary(f: TFile) {
		return this.files.get(f.path) as ArrayBuffer;
	}
	getFiles() {
		return [...this.files.keys()].filter((p) => !p.startsWith(".obsidian/")).map((p) => new TFile(p, this));
	}
	getMarkdownFiles() {
		return [...this.files.keys()].filter((p) => p.endsWith(".md")).map((p) => new TFile(p, this));
	}
	adapter = {
		exists: async (p: string) => this.files.has(normalizePath(p)) || this.folders.has(normalizePath(p)),
		mkdir: async (p: string) => this.createFolder(normalizePath(p)),
		write: async (p: string, s: string) => {
			this.addParents(normalizePath(p));
			this.files.set(normalizePath(p), s);
		},
		read: async (p: string) => this.files.get(normalizePath(p)) as string,
		list: async (p: string) => ({
			files: [...this.files.keys()].filter((x) => x.startsWith(normalizePath(p) + "/")),
			folders: [],
		}),
	};
}

export class App {
	constructor() {
		registeredBlocks.clear(); // fresh "Obsidian" per test
	}
	vault = new FakeVault();
	active: TFile | null = null;
	opened: string[] = [];
	metadataCache = {
		getFileCache: (f: TFile) => {
			const t = this.vault.files.get(f.path);
			return typeof t === "string" ? { frontmatter: frontmatter(t) } : null;
		},
		getFirstLinkpathDest: (link: string) => {
			const hit = [...this.vault.files.keys()].find((p) => p === link || p.endsWith("/" + link));
			return hit ? new TFile(hit, this.vault) : null;
		},
	};
	workspace = {
		getActiveFile: () => this.active,
		getActiveViewOfType: () => null,
		getLeaf: () => ({ openFile: async (f: TFile) => this.opened.push(f.path) }),
		on: () => ({}),
		onLayoutReady: (fn: () => void) => fn(),
	};
}

/** Code block types registered by "other plugins" (tests can add to it). Reset per test. */
export const registeredBlocks = new Set<string>();

export class Plugin {
	commands: any[] = [];
	codeBlocks = new Map<string, any>();
	statusBar: FakeEl[] = [];
	data: any = null;
	constructor(
		public app: App,
		public manifest: any,
	) {}
	addCommand(c: any) {
		this.commands.push(c);
	}
	addSettingTab() {}
	registerEvent() {}
	addStatusBarItem() {
		const e = new FakeEl();
		this.statusBar.push(e);
		return e;
	}
	registerMarkdownCodeBlockProcessor(n: string, fn: any) {
		// Like Obsidian: a block type can only be registered once across all plugins
		if (registeredBlocks.has(n)) throw new Error(`Code block processor for "${n}" is already registered`);
		registeredBlocks.add(n);
		this.codeBlocks.set(n, fn);
	}
	async loadData() {
		return this.data;
	}
	async saveData(d: any) {
		this.data = d;
	}
}
export class Modal {
	contentEl: any = {};
	constructor(public app: App) {}
	open() {}
	close() {}
	setTitle() {}
}
export class PluginSettingTab {
	containerEl: any = {};
	constructor(
		public app: App,
		public plugin: any,
	) {}
}
export class Setting {}
export class MarkdownView {}
