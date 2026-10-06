import { MarkdownView, Notice, Plugin, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { AIConfig, Content, DEFAULT_MODELS, PROVIDER_NAMES, Provider, SHORT_NAMES, SchemaDef, aiJsonWithCost } from "./ai";
import { LangSetting, lang, setLang, t } from "./i18n";
import { Cost, addCost, computeCost, costText } from "./core/cost";
import { readDataBlock } from "./core/embed";
import { fromLegacy, settingsFromLegacy } from "./core/legacy";
import { Pattern, aggregate, readPatterns, renderProgress, reviewMaterial } from "./core/progress";
import {
	SCHEMA_EVALUATE,
	SCHEMA_PATTERNS,
	SCHEMA_TOPICS,
	SYSTEM_CREATE,
	SYSTEM_EVALUATE,
	SYSTEM_PATTERNS,
	SYSTEM_TOPICS,
	SYSTEM_TOPICS_MERGE,
	evaluationItems,
	normalizeQuestions,
	schemaCreate,
	userPromptCreate,
	userPromptEvaluate,
	userPromptTopics,
} from "./core/prompts";
import {
	LEGACY_KEY,
	PLUGIN_KEY,
	frontmatterValue,
	PROGRESS_KEYS,
	QUIZ_KEYS,
	isEvaluatedNote,
	keepUserFrontmatter,
	normalizeAction,
	noteKind,
	parseAnswers,
	renderEvaluated,
	renderQuiz,
	setFrontmatterValue,
} from "./core/quiz-markdown";
import { Lever, SubjectReadiness, computeReadiness, readinessLine, timestamp } from "./core/readiness";
import { AIEvaluation, computeResult, isEmpty, maxPoints, questionsForAI } from "./core/scoring";
import {
	TopicList,
	asReadinessInput,
	estimateTopicTokens,
	extendTopics,
	filesAsReadinessInput,
	newSources,
	normalizeTopics,
	parseTopics,
	renderTopics,
	updateTopicsMarkdown,
} from "./core/topics";
import { Level, Question, QuestionTypes, QuizData } from "./core/types";
import { localDate, localStamp, newId, safeFileName } from "./core/util";
import { FolderChunks, findPastExams, folderFiles, loadFolderChunks, loadFolderSource, loadSource, loadStyleTemplate, pdfPageCount, sourceKind } from "./sources";
import { ChoiceDialog, ChoiceOption } from "./ui/choice-dialog";
import { CreateDialog, CreateChoice } from "./ui/create-dialog";
import { DateDialog } from "./ui/date-dialog";
import { renderReadinessView } from "./ui/readiness-view";
import { SettingsTab } from "./ui/settings-tab";

export interface Settings {
	/** UI and note language; "auto" follows Obsidian */
	language: LangSetting;
	provider: Provider;
	claudeKey: string;
	geminiKey: string;
	openaiKey: string;
	claudeModel: string;
	geminiModel: string;
	openaiModel: string;
	workspaceId: string;
	defaultCount: number;
	questionTypes: QuestionTypes;
	level: Level;
	/** Last chosen past exam per subject folder */
	styleTemplates: Record<string, string>;
	/** Subfolder for quizzes next to the source */
	quizFolder: string;
	progressName: string;
	topicsName: string;
	/** Target retention for review planning (FSRS), e.g. 0.9 */
	targetRetention: number;
	/** Highest readiness in % as long as there is no exam-level quiz */
	readinessCap: number;
	/** Ask "How sure are you?" per question */
	askConfidence: boolean;
	/** Exam readiness of the current subject in the status bar */
	statusBar: boolean;
	/** Subject folders where the learner declined a topic list */
	noTopicList: string[];
}

export const DEFAULTS: Settings = {
	language: "auto",
	provider: "claude",
	claudeKey: "",
	geminiKey: "",
	openaiKey: "",
	claudeModel: DEFAULT_MODELS.claude,
	geminiModel: DEFAULT_MODELS.gemini,
	openaiModel: DEFAULT_MODELS.openai,
	workspaceId: "",
	defaultCount: 8,
	questionTypes: "mixed",
	level: "normal",
	styleTemplates: {},
	quizFolder: "Quizzes",
	progressName: "Progress",
	topicsName: "Topics",
	targetRetention: 0.9,
	readinessCap: 80,
	askConfidence: true,
	statusBar: true,
	noTopicList: [],
};

/** Quiz plus the path of its note. */
interface StoredQuiz extends QuizData {
	file: string;
}

/** Everything the readiness view of a subject needs. */
export interface ReadinessContext {
	subject: TFolder;
	name: string;
	r: SubjectReadiness;
	list: TopicList | null;
	/** Files not yet in the topic list */
	newFiles: string[];
	exam: string | null;
	declinedList: boolean;
}

export default class LacunaPlugin extends Plugin {
	settings: Settings = { ...DEFAULTS };
	private busy = new Set<string>();
	private later = new Set<string>();
	private statusEl: HTMLElement | null = null;
	private statusCache = new Map<string, { time: number; text: string }>();

	/** Choice dialog; resolves with the id of the chosen option (null = closed). Replaceable in tests. */
	choose: (title: string, text: string[], options: ChoiceOption[]) => Promise<string | null> = (title, text, options) =>
		new Promise((done) => new ChoiceDialog(this.app, title, text, options, done).open());

	/** Ask for a date (YYYY-MM-DD, "" = remove, null = cancelled). Replaceable in tests. */
	askDate: (title: string, value: string) => Promise<string | null> = (title, value) =>
		new Promise((done) => new DateDialog(this.app, title, value, done).open());

	/** Active AI configuration. */
	aiConfig(): AIConfig {
		const s = this.settings;
		if (s.provider === "gemini") return { provider: "gemini", apiKey: s.geminiKey, model: s.geminiModel || DEFAULT_MODELS.gemini };
		if (s.provider === "openai") return { provider: "openai", apiKey: s.openaiKey, model: s.openaiModel || DEFAULT_MODELS.openai };
		return { provider: "claude", apiKey: s.claudeKey, model: s.claudeModel || DEFAULT_MODELS.claude, workspaceId: s.workspaceId };
	}

	get aiName(): string {
		return SHORT_NAMES[this.settings.provider] ?? "AI";
	}

	/** AI call with notices on waiting and model fallback. */
	private ai<T = any>(system: string, content: Content[], def: SchemaDef, maxTokens: number) {
		return aiJsonWithCost<T>(this.aiConfig(), system, content, def, maxTokens, {
			onWait: ({ seconds, attempt }) => new Notice(t().notices.overloadedRetry(this.aiName, attempt, seconds), Math.max(3000, seconds * 1000)),
			onFallback: (model) => new Notice(t().notices.fallback(this.aiName, model), 5000),
		});
	}

	private keyMissing(): boolean {
		if (this.aiConfig().apiKey) return false;
		new Notice(t().notices.keyMissing(PROVIDER_NAMES[this.settings.provider]), 8000);
		return true;
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SettingsTab(this.app, this));
		const c = t().commands;

		this.addCommand({
			id: "create-quiz",
			name: c.createQuiz,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f || !sourceKind(f) || this.isQuizNote(f)) return false;
				if (!checking) this.openCreateDialog(f);
				return true;
			},
		});
		this.addCommand({
			id: "folder-quiz",
			name: c.folderQuiz,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f) return false;
				if (!checking) this.openFolderDialog(this.subjectFolder(f));
				return true;
			},
		});
		this.addCommand({
			id: "evaluate",
			name: c.evaluate,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f || !this.isQuizNote(f)) return false;
				if (!checking) this.evaluate(f);
				return true;
			},
		});
		this.addCommand({
			id: "progress",
			name: c.progress,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f) return false;
				if (!checking) this.progress(this.subjectFolder(f));
				return true;
			},
		});
		this.addCommand({
			id: "review",
			name: c.review,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f) return false;
				if (!checking) this.review(this.subjectFolder(f));
				return true;
			},
		});
		this.addCommand({
			id: "topic-list",
			name: c.topicList,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f) return false;
				if (!checking) this.topicList(this.subjectFolder(f), true);
				return true;
			},
		});
		this.addCommand({
			id: "exam-date",
			name: c.examDate,
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f) return false;
				if (!checking) this.setExamDate(this.subjectFolder(f));
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
				const m = t().menu;
				if (file instanceof TFile && sourceKind(file) && !this.isQuizNote(file)) {
					menu.addItem((i) => i.setTitle(m.createQuiz).setIcon("graduation-cap").onClick(() => this.openCreateDialog(file)));
				}
				if (file instanceof TFolder) {
					menu.addItem((i) => i.setTitle(m.folderQuiz).setIcon("graduation-cap").onClick(() => this.openFolderDialog(file)));
					menu.addItem((i) => i.setTitle(m.progress).setIcon("bar-chart-3").onClick(() => this.progress(file)));
					menu.addItem((i) => i.setTitle(m.review).setIcon("repeat").onClick(() => this.review(file)));
					menu.addItem((i) => i.setTitle(m.topicList).setIcon("list-checks").onClick(() => this.topicList(file, true)));
				}
			}),
		);

		this.registerMarkdownCodeBlockProcessor(PLUGIN_KEY, (src, el, ctx) => this.codeBlock(src, el, ctx.sourcePath));
		// Buttons in notes created by Skript-Check (the German predecessor). If Skript-Check is still
		// enabled it owns this block type and Obsidian refuses a second registration – that must not stop Lacuna.
		try {
			this.registerMarkdownCodeBlockProcessor(LEGACY_KEY, (src, el, ctx) => this.codeBlock(src, el, ctx.sourcePath));
		} catch (e) {
			console.warn("[Lacuna] skript-check blocks are handled by Skript-Check while it is enabled", e);
		}

		if (this.settings.statusBar) {
			this.statusEl = this.addStatusBarItem();
			this.statusEl.addClass("lacuna-status");
			this.registerEvent(this.app.workspace.on("file-open", () => this.updateStatus()));
			this.app.workspace.onLayoutReady?.(() => this.updateStatus());
		}
	}

	private codeBlock(src: string, el: HTMLElement, sourcePath: string) {
		const action = normalizeAction(src.trim().split("\n")[0].trim());
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return;
		const b = t().buttons;
		const button = (text: string, running: string, fn: () => Promise<unknown>) => {
			const btn = el.createEl("button", { cls: "lacuna-button mod-cta", text });
			btn.onclick = async () => {
				btn.disabled = true;
				btn.setText(running);
				try {
					await fn();
				} finally {
					btn.disabled = false;
					btn.setText(text);
				}
			};
		};
		if (action === "evaluate") button(b.evaluate, b.evaluating, () => this.evaluate(file));
		else if (action === "review") button(b.review, b.creating, () => this.review(file.parent ?? this.app.vault.getRoot()));
		else if (action === "follow-up") button(b.followUp, b.creating, () => this.followUp(file));
		else if (action === "readiness") {
			el.addClass("lacuna-readiness");
			el.setText(t().readiness.computing);
			this.readinessData(this.subjectFolder(file))
				.then((k) =>
					renderReadinessView(el, k, this.settings.readinessCap, {
						setExamDate: () => this.setExamDate(k.subject),
						quizForLever: (h) => this.quizForLever(k, h),
						topicList: () => this.topicList(k.subject, true),
						openTopicList: () => this.open(this.topicsPath(k.subject)),
					}),
				)
				.catch((e) => el.setText(`${t().readiness.title("")}: ${(e as Error)?.message ?? e}`));
		} else el.setText(b.unknown(action));
	}

	// ------------------------------------------------------------ Reading quizzes

	/** Before Skript-Check 0.2.2, solutions were stored as JSON in the plugin folder. */
	private async loadOldQuiz(id: string): Promise<QuizData | null> {
		const dirs = [this.manifest.dir, `${this.app.vault.configDir ?? ".obsidian"}/plugins/${LEGACY_KEY}`];
		for (const dir of dirs) {
			const p = normalizePath(`${dir}/tests/${id}.json`);
			try {
				if (await this.app.vault.adapter.exists(p)) return fromLegacy(JSON.parse(await this.app.vault.adapter.read(p)));
			} catch {
				/* try next */
			}
		}
		return null;
	}

	/** Quiz data from the note (or the old storage location). */
	async readQuiz(f: TFile, md?: string): Promise<StoredQuiz | null> {
		const text = md ?? (await this.app.vault.read(f));
		let q = readDataBlock(text);
		if (!q) {
			const id = frontmatterValue(text, "id");
			if (id) q = await this.loadOldQuiz(id);
		}
		return q ? { ...q, file: f.path } : null;
	}

	private async allQuizzes(prefix = ""): Promise<StoredQuiz[]> {
		const out: StoredQuiz[] = [];
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (!f.path.startsWith(prefix) || !this.isQuizNote(f)) continue;
			const q = await this.readQuiz(f);
			if (q) out.push(q);
		}
		return out;
	}

	// ------------------------------------------------------------ Helpers

	private frontmatter(f: TFile): Record<string, unknown> | undefined {
		if (f.extension !== "md") return undefined;
		return this.app.metadataCache.getFileCache(f)?.frontmatter;
	}

	isQuizNote(f: TFile): boolean {
		const fm = this.frontmatter(f);
		return fm?.[PLUGIN_KEY] === "quiz" || fm?.[LEGACY_KEY] === "test";
	}

	/** Notes the plugin manages itself (quizzes, progress, topic lists) – never used as sources. */
	private isPluginNote(f: TFile): boolean {
		const fm = this.frontmatter(f);
		return !!(fm?.[PLUGIN_KEY] || fm?.[LEGACY_KEY]);
	}

	/** Subject folder of a file: for files in the quiz subfolder its parent. */
	subjectFolder(f: TAbstractFile): TFolder {
		let o = f instanceof TFolder ? f : (f.parent ?? this.app.vault.getRoot());
		if (o.name === this.settings.quizFolder && o.parent) o = o.parent;
		return o;
	}

	private async ensureFolder(path: string) {
		if (!path || path === "/") return;
		if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
	}

	private async freePath(folder: string, name: string): Promise<string> {
		let p = normalizePath(`${folder}/${name}.md`);
		let i = 2;
		while (this.app.vault.getAbstractFileByPath(p)) p = normalizePath(`${folder}/${name} (${i++}).md`);
		return p;
	}

	private quizFolderOf(o: TFolder): string {
		return normalizePath(`${o.isRoot() ? "" : o.path}/${this.settings.quizFolder}`);
	}

	private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
		if (this.busy.has(key)) {
			new Notice(t().notices.alreadyRunning);
			return;
		}
		this.busy.add(key);
		try {
			return await fn();
		} finally {
			this.busy.delete(key);
		}
	}

	private fail(e: unknown) {
		console.error("[Lacuna]", e);
		new Notice("Lacuna: " + ((e as Error)?.message ?? String(e)), 10000);
	}

	private defaultChoice(): CreateChoice {
		return { count: this.settings.defaultCount, pages: "", focus: "", questionTypes: this.settings.questionTypes, level: this.settings.level, styleTemplate: "" };
	}

	private async open(path: string) {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(f);
	}

	// ------------------------------------------------------------ Dialogs

	async openCreateDialog(f: TFile) {
		if (this.keyMissing()) return;
		let pageCount: number | null = null;
		if (sourceKind(f) === "pdf") {
			try {
				pageCount = await pdfPageCount(this.app, f);
			} catch (e) {
				this.fail(new Error(t().notices.pdfUnreadable((e as Error).message)));
				return;
			}
		}
		const subject = this.subjectFolder(f);
		new CreateDialog(this.app, {
			title: t().dialog.createTitle,
			description: t().dialog.source(f.path),
			pageCount,
			choice: { ...this.defaultChoice(), styleTemplate: this.settings.styleTemplates[subject.path] ?? "" },
			pastExams: findPastExams(this.app, subject).filter((k) => k.path !== f.path),
			go: (w) => this.createQuiz(f, w),
		}).open();
	}

	/** Material of a folder: everything except notes Lacuna wrote itself (recognized by frontmatter) and the past exam. */
	private folderSources(o: TFolder, styleTemplate = ""): TFile[] {
		return folderFiles(o, (f) => f.path === styleTemplate || this.isPluginNote(f));
	}

	async openFolderDialog(o: TFolder, preset: Partial<CreateChoice> = {}) {
		if (this.keyMissing()) return;
		const files = this.folderSources(o);
		if (!files.length) {
			new Notice(t().notices.folderEmpty(o.name));
			return;
		}
		new CreateDialog(this.app, {
			title: t().dialog.folderTitle,
			description: t().dialog.folder(o.path && o.path !== "/" ? o.path : t().vault, files.length),
			pageCount: null,
			choice: { ...this.defaultChoice(), count: Math.max(this.settings.defaultCount, 12), styleTemplate: this.settings.styleTemplates[o.path] ?? "", ...preset },
			pastExams: findPastExams(this.app, o),
			go: (w) => this.createFolderQuiz(o, w),
		}).open();
	}

	// ------------------------------------------------------------ Create

	private async rememberStyleTemplate(subject: TFolder, path: string) {
		if ((this.settings.styleTemplates[subject.path] ?? "") === path) return;
		if (path) this.settings.styleTemplates[subject.path] = path;
		else delete this.settings.styleTemplates[subject.path];
		await this.saveSettings();
	}

	private async styleTemplateContent(path: string): Promise<Content[]> {
		if (!path) return [];
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) {
			new Notice(t().notices.pastExamMissing, 6000);
			return [];
		}
		return loadStyleTemplate(this.app, f);
	}

	/** Shared flow: ask the AI, create the quiz note, open it. */
	private async generateQuiz(o: {
		statusText: string;
		sourceContent: Content[];
		choice: CreateChoice;
		fromFolder?: boolean;
		review?: boolean;
		source: string;
		pages: string;
		targetFolder: string;
		fileName: (title: string, now: Date) => string;
		titlePrefix?: string;
		/** Folder whose topic list applies */
		subject: TFolder;
	}) {
		const status = new Notice(o.statusText, 0);
		try {
			const style = await this.styleTemplateContent(o.choice.styleTemplate);
			const topics = (await this.findTopics(o.subject))?.list.topics.map((x) => x.name);
			const { data: raw, cost } = await this.ai(
				SYSTEM_CREATE,
				[
					...style,
					...o.sourceContent,
					{
						type: "text",
						text: userPromptCreate({
							count: o.choice.count,
							focus: o.choice.focus,
							questionTypes: o.choice.questionTypes,
							level: o.choice.level,
							withStyleTemplate: style.length > 0,
							fromFolder: o.fromFolder,
							review: o.review,
							topics,
						}),
					},
				],
				schemaCreate(topics),
				Math.min(16000, 1500 + o.choice.count * 700),
			);
			const { title, questions } = normalizeQuestions(raw, o.choice.questionTypes, t().defaultTopic);
			const now = new Date();
			await this.ensureFolder(o.targetFolder);
			const q: QuizData = {
				id: newId(now),
				title: (o.titlePrefix ?? "") + title,
				source: o.source,
				pages: o.pages,
				created: now.toISOString().slice(0, 16),
				questions,
				cost,
				level: o.choice.level,
				...(style.length ? { styleTemplate: o.choice.styleTemplate } : {}),
			};
			const path = await this.freePath(o.targetFolder, o.fileName(title, now));
			const file = await this.app.vault.create(path, renderQuiz(q, { confidence: this.settings.askConfidence }));
			status.hide();
			new Notice(t().notices.created(questions.length, costText(cost)), 6000);
			await this.app.workspace.getLeaf("tab").openFile(file);
		} catch (e) {
			status.hide();
			this.fail(e);
		}
	}

	async createQuiz(f: TFile, choice: Partial<CreateChoice> = {}) {
		const w: CreateChoice = { ...this.defaultChoice(), ...choice };
		await this.rememberStyleTemplate(this.subjectFolder(f), w.styleTemplate);
		await this.exclusive("create:" + f.path, async () => {
			let src;
			try {
				src = await loadSource(this.app, f, w.pages);
			} catch (e) {
				return this.fail(e);
			}
			if (src.hint) new Notice(src.hint, 6000);
			await this.generateQuiz({
				statusText: t().notices.creating(this.aiName, w.count, f.name),
				sourceContent: src.content,
				choice: w,
				source: f.path,
				pages: src.pages,
				targetFolder: normalizePath(`${f.parent?.path ?? ""}/${this.settings.quizFolder}`),
				fileName: (title, now) => t().files.quiz(safeFileName(title), localStamp(now)),
				subject: this.subjectFolder(f),
			});
		});
	}

	async createFolderQuiz(o: TFolder, choice: Partial<CreateChoice> = {}) {
		const w: CreateChoice = { ...this.defaultChoice(), ...choice };
		await this.rememberStyleTemplate(o, w.styleTemplate);
		await this.exclusive("folder:" + o.path, async () => {
			let src;
			try {
				src = await loadFolderSource(this.app, o, this.folderSources(o, w.styleTemplate));
			} catch (e) {
				return this.fail(e);
			}
			if (src.hint) new Notice(src.hint, 8000);
			await this.generateQuiz({
				statusText: t().notices.creatingFolder(this.aiName, w.count, src.used, o.name),
				sourceContent: src.content,
				choice: w,
				fromFolder: true,
				source: o.path,
				pages: "",
				targetFolder: this.quizFolderOf(o),
				fileName: (title, now) => t().files.folderQuiz(safeFileName(o.name || t().vault), safeFileName(title), localStamp(now)),
				subject: o,
			});
		});
	}

	// ------------------------------------------------------------ Evaluate

	async evaluate(f: TFile) {
		await this.exclusive("evaluate:" + f.path, async () => {
			// Save unsaved edits first
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file?.path === f.path) await view.save();

			const md = await this.app.vault.read(f);
			if (isEvaluatedNote(md)) {
				new Notice(t().notices.alreadyEvaluated);
				return;
			}
			const q = await this.readQuiz(f, md);
			if (!q) return this.fail(new Error(t().notices.dataMissing));

			const answers = parseAnswers(md, q.questions);
			if (q.questions.every((x) => isEmpty(x, answers.find((a) => a.nr === x.nr)))) {
				new Notice(t().notices.nothingAnswered, 6000);
				return;
			}

			const status = new Notice(t().notices.evaluating(this.aiName), 0);
			try {
				const toAI = questionsForAI(q.questions, answers);
				let ai: AIEvaluation[] = [];
				let summary = "";
				let cost: Cost | undefined = q.cost;
				if (toAI.length) {
					const items = evaluationItems(toAI, answers, maxPoints);
					const r = await this.ai<{ evaluations: AIEvaluation[]; summary: string }>(
						SYSTEM_EVALUATE,
						[{ type: "text", text: userPromptEvaluate(q.title, items) }],
						SCHEMA_EVALUATE,
						Math.min(16000, 1500 + toAI.length * 600),
					);
					ai = Array.isArray(r.data?.evaluations) ? r.data.evaluations : [];
					summary = String(r.data?.summary ?? "");
					cost = addCost(cost, r.cost);
				} else {
					summary = t().notices.allCorrect;
				}
				const result = computeResult(q.questions, answers, ai, summary);
				const next: QuizData = { ...q, cost };
				delete (next as Partial<StoredQuiz>).file;
				// Exam readiness before/after (results only)
				let line = "";
				try {
					const subject = this.subjectFolder(f);
					const before = await this.readinessData(subject);
					const after = await this.readinessData(subject, { ...next, result, answers });
					line = readinessLine(after.name, before.r.evaluatedQuizzes ? before.r.percent : null, after.r.percent);
					this.statusCache.clear();
				} catch (err) {
					console.warn("[Lacuna] readiness", err);
				}
				// Write atomically. If the learner changed answers while the AI was grading, keep their
				// note untouched instead of overwriting it with a result for the old answers.
				const rendered = renderEvaluated(next, answers, result, line);
				let changed = false;
				await this.app.vault.process(f, (current) => {
					if (current !== md && (isEvaluatedNote(current) || JSON.stringify(parseAnswers(current, q.questions)) !== JSON.stringify(answers))) {
						changed = true;
						return current;
					}
					return keepUserFrontmatter(current, rendered, QUIZ_KEYS);
				});
				status.hide();
				if (changed) {
					new Notice(t().notices.changedDuringEvaluation, 10000);
					return;
				}
				new Notice(t().notices.result(result.percent, result.points, result.max) + (line ? `\n${line}` : ""), 6000);
				this.updateStatus();
				// Keep the progress note up to date in the background (no AI patterns, they cost extra)
				this.progress(this.subjectFolder(f), false).catch(() => {});
			} catch (err) {
				status.hide();
				this.fail(err);
			}
		});
	}

	// ------------------------------------------------------------ Follow-up round

	/** Follow-up quiz from the follow-up questions of an evaluated quiz – no AI call, instant and free. */
	async followUp(f: TFile) {
		await this.exclusive("follow-up:" + f.path, async () => {
			const q = await this.readQuiz(f);
			if (!q?.result) {
				new Notice(t().notices.evaluateFirst);
				return;
			}
			const questions: Question[] = [];
			for (const e of q.result.evaluations) {
				if (!e.errorType || !e.followUp) continue;
				const orig = q.questions.find((x) => x.nr === e.nr);
				questions.push({
					nr: questions.length + 1,
					type: "open",
					difficulty: orig?.difficulty ?? "medium",
					topic: orig?.topic ?? t().defaultTopic,
					question: e.followUp,
					options: [],
					correct: null,
					solution: [e.correct, orig?.solution].filter(Boolean).join(" "),
					reference: e.reference || orig?.reference || "",
				});
			}
			if (!questions.length) {
				new Notice(t().notices.noFollowUps);
				return;
			}
			const now = new Date();
			const n: QuizData = {
				id: newId(now),
				title: t().files.followUpTitle(q.title),
				source: f.path,
				pages: "",
				created: now.toISOString().slice(0, 16),
				questions,
			};
			const path = await this.freePath(f.parent?.path ?? "", t().files.followUp(safeFileName(q.title), localStamp(now)));
			const file = await this.app.vault.create(path, renderQuiz(n, { confidence: this.settings.askConfidence }));
			new Notice(t().notices.followUpCreated(questions.length));
			await this.app.workspace.getLeaf("tab").openFile(file);
		});
	}

	// ------------------------------------------------------------ Exam readiness

	private progressPath(o: TFolder): string {
		return normalizePath(`${o.isRoot() ? "" : o.path + "/"}${this.settings.progressName}.md`);
	}

	topicsPath(o: TFolder): string {
		return normalizePath(`${o.isRoot() ? "" : o.path + "/"}${this.settings.topicsName}.md`);
	}

	/** Nearest topic list: in the folder itself or a parent folder. */
	async findTopics(o: TFolder): Promise<{ folder: TFolder; list: TopicList } | null> {
		let x: TFolder | null = o;
		while (x) {
			const f = this.app.vault.getAbstractFileByPath(this.topicsPath(x));
			if (f instanceof TFile) {
				const list = parseTopics(await this.app.vault.read(f), x.name);
				if (list) return { folder: x, list };
			}
			x = x.isRoot() ? null : x.parent;
		}
		return null;
	}

	private async examOf(o: TFolder): Promise<string | null> {
		const f = this.app.vault.getAbstractFileByPath(this.progressPath(o));
		if (!(f instanceof TFile)) return null;
		const md = await this.app.vault.read(f);
		const v = frontmatterValue(md, "exam") ?? frontmatterValue(md, "klausur");
		return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
	}

	/** Exam readiness of a subject. `replace`: use this newer version of a quiz in the calculation. */
	async readinessData(o: TFolder, replace?: QuizData, now: Date = new Date()): Promise<ReadinessContext> {
		const found = await this.findTopics(o);
		const subject = found?.folder ?? o;
		const list = found?.list ?? null;
		let quizzes: QuizData[] = await this.quizzesIn(subject);
		if (replace) quizzes = [...quizzes.filter((q) => q.id !== replace.id), replace];
		const sources = this.folderSources(subject).map((f) => f.path);
		const exam = (await this.examOf(subject)) ?? (subject !== o ? await this.examOf(o) : null);
		const input = list ? asReadinessInput(list) : null;
		const r = computeReadiness(quizzes, {
			now,
			target: this.settings.targetRetention,
			cap: this.settings.readinessCap,
			exam: exam ? timestamp(exam) : null,
			topics: input?.topics ?? null,
			aliases: input?.aliases,
			files: filesAsReadinessInput(sources),
		});
		return {
			subject,
			name: subject.isRoot() ? t().vault : subject.name,
			r,
			list,
			newFiles: list ? newSources(list, sources) : [],
			exam,
			declinedList: this.settings.noTopicList.includes(subject.path),
		};
	}

	/** Folder-quiz dialog with the lever topic as focus. */
	private quizForLever(k: ReadinessContext, h: Lever) {
		const reference = k.list?.topics.find((x) => x.name === h.topic)?.reference;
		this.openFolderDialog(k.subject, { focus: t().dialog.leverFocus(h.topic, reference), count: 6 });
	}

	async setExamDate(o: TFolder) {
		const found = await this.findTopics(o);
		const subject = found?.folder ?? o;
		const old = (await this.examOf(subject)) ?? "";
		const value = await this.askDate(t().dialog.examDateTitle(subject.isRoot() ? t().vault : subject.name), old);
		if (value === null || value === old) return;
		if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			new Notice(t().notices.dateFormat);
			return;
		}
		const path = this.progressPath(subject);
		if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) await this.progress(subject, false, true);
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return;
		const current = await this.app.vault.read(f);
		if (noteKind(current) !== "progress") return; // a note of the user's with that name: progress() already warned
		let md = setFrontmatterValue(current, "klausur", null);
		md = setFrontmatterValue(md, "exam", value || null);
		await this.app.vault.modify(f, md);
		await this.progress(subject, false, true);
		new Notice(value ? t().notices.examSaved(value) : t().notices.examRemoved);
	}

	async updateStatus() {
		const el = this.statusEl;
		if (!el) return;
		const f = this.app.workspace.getActiveFile();
		if (!f) return el.setText("");
		const o = this.subjectFolder(f);
		const c = this.statusCache.get(o.path);
		if (c && Date.now() - c.time < 5 * 60_000) return el.setText(c.text);
		try {
			const k = await this.readinessData(o);
			const text = k.r.evaluatedQuizzes ? `🎓 ${k.name}: ${k.r.percent} %` : "";
			this.statusCache.set(o.path, { time: Date.now(), text });
			if (this.app.workspace.getActiveFile()?.path === f.path) el.setText(text);
		} catch {
			el.setText("");
		}
	}

	// ------------------------------------------------------------ Progress

	private async quizzesIn(o: TFolder): Promise<StoredQuiz[]> {
		return this.allQuizzes(o.isRoot() ? "" : o.path + "/");
	}

	/**
	 * Update the progress note.
	 * manual: triggered by the learner (AI error patterns, offer a topic list, open the note).
	 * force: create it even without evaluated quizzes (e.g. for the exam date).
	 */
	async progress(o: TFolder, manual = true, force = false) {
		if (manual) await this.offerTopicList(o);
		await this.exclusive("progress:" + o.path, async () => {
			const quizzes = await this.quizzesIn(o);
			const path = this.progressPath(o);
			const existing = this.app.vault.getAbstractFileByPath(path);
			const oldMd = existing instanceof TFile ? await this.app.vault.read(existing) : null;
			if (oldMd !== null && noteKind(oldMd) !== "progress") {
				// The name is taken by one of the learner's own notes: never overwrite it
				if (manual || force) new Notice(t().notices.nameTaken(path), 10000);
				else console.warn(`[Lacuna] ${path} is not a Lacuna progress note, not updating it`);
				return;
			}
			if (!quizzes.some((q) => q.result) && !force && oldMd === null) {
				if (manual) new Notice(t().notices.noEvaluated(o.name));
				return;
			}
			const d = aggregate(quizzes, new Map(quizzes.map((q) => [q.id, q.file])));
			let patterns: Pattern[] | null = null;
			let recommendation = "";
			let readiness: SubjectReadiness | null = null;
			let exam: string | null = null;
			try {
				readiness = (await this.readinessData(o)).r;
				exam = await this.examOf(o);
			} catch (e) {
				console.warn("[Lacuna] readiness", e);
			}

			const status = manual && d.mistakes.length ? new Notice(t().notices.patterns(this.aiName), 0) : null;
			try {
				if (manual && d.mistakes.length && this.aiConfig().apiKey) {
					const r = await this.ai<{ patterns: Pattern[]; recommendation: string }>(
						SYSTEM_PATTERNS,
						[
							{
								type: "text",
								text: `Subject: ${o.name}\nTopic scores: ${JSON.stringify(d.topics)}\nError types: ${JSON.stringify(d.errorTypes)}\n\nIndividual mistakes (newest last):\n${JSON.stringify(d.mistakes.slice(-60), null, 1)}`,
							},
						],
						SCHEMA_PATTERNS,
						3000,
					);
					patterns = Array.isArray(r.data?.patterns) ? r.data.patterns : null;
					recommendation = String(r.data?.recommendation ?? "");
				} else if (oldMd !== null) {
					// Without a new analysis: keep the previous patterns
					const old = readPatterns(oldMd);
					if (old) ({ patterns, recommendation } = old);
				}
				const md = renderProgress(o.isRoot() ? t().vault : o.name, d, patterns, recommendation, new Date(), { readiness, exam, cap: this.settings.readinessCap });
				if (existing instanceof TFile) await this.app.vault.process(existing, (current) => keepUserFrontmatter(current, md, PROGRESS_KEYS));
				else await this.app.vault.create(path, md);
				status?.hide();
				this.statusCache.clear();
				if (manual) await this.open(path);
			} catch (e) {
				status?.hide();
				this.fail(e);
			}
		});
	}

	// ------------------------------------------------------------ Review

	async review(o: TFolder) {
		if (this.keyMissing()) return;
		await this.exclusive("review:" + o.path, async () => {
			const quizzes = await this.quizzesIn(o);
			const d = aggregate(quizzes, new Map());
			if (!d.mistakes.length) {
				new Notice(t().notices.noMistakes(o.name));
				return;
			}
			const count = Math.min(this.settings.defaultCount, Math.max(4, Math.ceil(d.mistakes.length * 0.8)));
			let due = "";
			try {
				const k = await this.readinessData(o);
				const names = k.r.topics
					.filter((x) => x.tested && x.due)
					.sort((a, b) => a.recall - b.recall)
					.map((x) => x.name);
				if (names.length) due = `\n\nDue according to the review plan (probably partly forgotten), please cover these too: ${names.slice(0, 6).join(", ")}`;
			} catch {
				/* continue without plan */
			}
			await this.generateQuiz({
				statusText: t().notices.creatingReview(this.aiName, count),
				sourceContent: [{ type: "text", text: `Earlier mistakes of the student in the subject "${o.name}":\n\n${reviewMaterial(d)}${due}` }],
				choice: { ...this.defaultChoice(), count, styleTemplate: this.settings.styleTemplates[o.path] ?? "" },
				review: true,
				source: this.progressPath(o),
				pages: "",
				targetFolder: this.quizFolderOf(o),
				fileName: (_t, now) => t().files.review(safeFileName(o.name), localStamp(now)),
				titlePrefix: t().files.reviewPrefix,
				subject: o,
			});
		});
	}

	// ------------------------------------------------------------ Topic list

	/** On a manual progress update: offer a topic list or point out new files. Never without asking. */
	private async offerTopicList(o: TFolder) {
		if (!this.aiConfig().apiKey) return;
		const found = await this.findTopics(o);
		const subject = found?.folder ?? o;
		if (this.later.has(subject.path)) return;
		if (found) {
			if (newSources(found.list, this.folderSources(subject).map((f) => f.path)).length) await this.topicList(subject, false);
		} else if (!this.settings.noTopicList.includes(subject.path)) {
			await this.topicList(subject, false);
		}
	}

	/** Create a topic list or extend it with new files – always with a cost estimate and confirmation. */
	async topicList(o: TFolder, manual: boolean) {
		if (this.keyMissing()) return;
		const s = t().topicDialog;
		const found = await this.findTopics(o);
		const subject = found?.folder ?? o;
		const list = found?.list ?? null;
		const name = subject.isRoot() ? t().vault : subject.name;
		const target = this.app.vault.getAbstractFileByPath(this.topicsPath(subject));
		if (!list && target instanceof TFile) {
			// A note with that name exists but is not a topic list: never overwrite it
			new Notice(t().notices.nameTaken(target.path), 10000);
			return;
		}
		const all = this.folderSources(subject);
		const toRead = list ? all.filter((f) => newSources(list, [f.path]).length) : all;
		if (!all.length) {
			if (manual) new Notice(s.noMaterial(name));
			return;
		}
		if (list && !toRead.length) {
			if (manual) {
				new Notice(s.upToDate);
				await this.open(this.topicsPath(subject));
			}
			return;
		}

		const reading = new Notice(s.reading(toRead.length), 0);
		let b: FolderChunks;
		try {
			b = await loadFolderChunks(this.app, toRead);
		} catch (e) {
			reading.hide();
			return this.fail(e);
		}
		reading.hide();
		if (!b.chunks.length) {
			if (manual) new Notice(s.nothingReadable);
			return;
		}
		const cfg = this.aiConfig();
		const estimate = computeCost(cfg.provider, cfg.model, estimateTopicTokens({ chars: b.chars, images: b.images, scanPages: b.scanPages, chunks: b.chunks.length }));

		const names = toRead.slice(0, 4).map((f) => f.name).join(", ") + (toRead.length > 4 ? " …" : "");
		const text = list ? [s.newFiles(toRead.length, names), s.extendExplain(this.aiName)] : [s.createIntro(name), s.createExplain(this.aiName, b.files.length, b.chunks.length)];
		text.push(s.estimate(costText(estimate)));
		if (b.skipped.length) text.push(s.partlyRead(b.skipped.slice(0, 4).join(", ") + (b.skipped.length > 4 ? " …" : "")));
		const options: ChoiceOption[] = list
			? [
					{ id: "yes", text: s.extend, cta: true },
					{ id: "later", text: s.notNow },
				]
			: [
					{ id: "yes", text: s.create, cta: true },
					{ id: "later", text: s.later },
					{ id: "never", text: s.without },
				];
		const choice = await this.choose(list ? s.extendTitle : s.createTitle, text, options);
		if (choice === "never") {
			if (!this.settings.noTopicList.includes(subject.path)) this.settings.noTopicList.push(subject.path);
			await this.saveSettings();
			new Notice(s.declined, 6000);
			return;
		}
		if (choice !== "yes") {
			this.later.add(subject.path);
			return;
		}
		this.settings.noTopicList = this.settings.noTopicList.filter((p) => p !== subject.path);
		await this.saveSettings();
		this.later.delete(subject.path);

		await this.exclusive("topics:" + subject.path, async () => {
			const status = new Notice(s.creating(this.aiName), 0);
			try {
				const oldTopics = [...new Set((await this.quizzesIn(subject)).flatMap((q) => q.questions.map((x) => x.topic)))].slice(0, 150);
				const existing = list?.topics.map((x) => x.name);
				let cost: Cost | undefined;
				const parts: ReturnType<typeof normalizeTopics>[] = [];
				for (let i = 0; i < b.chunks.length; i++) {
					status.setMessage?.(s.creatingPart(this.aiName, i + 1, b.chunks.length));
					const r = await this.ai(
						SYSTEM_TOPICS,
						[...b.chunks[i].content, { type: "text", text: userPromptTopics({ subject: name, oldTopics, existing, part: { nr: i + 1, of: b.chunks.length } }) }],
						SCHEMA_TOPICS,
						6000,
					);
					cost = addCost(cost, r.cost);
					parts.push(normalizeTopics(r.data));
				}
				let topics = parts.flat();
				if (parts.length > 1 && !list) {
					status.setMessage?.(s.merging(this.aiName));
					const r = await this.ai(
						SYSTEM_TOPICS_MERGE,
						[{ type: "text", text: `Subject: ${name}\n\n${parts.map((x, i) => `Part ${i + 1}:\n${JSON.stringify(x)}`).join("\n\n")}` }],
						SCHEMA_TOPICS,
						8000,
					);
					cost = addCost(cost, r.cost);
					const merged = normalizeTopics(r.data);
					if (merged.length) topics = merged;
				}
				topics = normalizeTopics({ topics });
				if (!topics.length && !list) throw new Error(s.noTopics);
				const today = localDate(new Date());
				const next = list ? extendTopics(list, topics, b.files, today) : { subject: name, topics, sources: [...b.files].sort(), updated: today };
				const path = this.topicsPath(subject);
				const existingFile = this.app.vault.getAbstractFileByPath(path);
				if (existingFile instanceof TFile) {
					// Only the table and the sources block change; the learner's edits around them stay
					await this.app.vault.process(existingFile, (current) => (noteKind(current) === "topics" ? updateTopicsMarkdown(current, next) : current));
				} else await this.app.vault.create(path, renderTopics(next));
				status.hide();
				const added = list ? next.topics.length - list.topics.length : next.topics.length;
				new Notice(s.done(added, !!list, cost ? costText(cost) : ""), 8000);
				this.statusCache.clear();
				await this.open(path);
			} catch (e) {
				status.hide();
				this.fail(e);
			}
		});
	}

	// ------------------------------------------------------------ Settings

	async loadSettings() {
		let data = await this.loadData();
		const loaded = !!data;
		let imported = false;
		if (!data) {
			// First start: take over settings from Skript-Check (the German predecessor), if installed
			data = await this.legacySettings();
			imported = !!data;
		}
		setLang((data?.language as LangSetting) ?? "auto");
		const languageDefaults: Partial<Settings> = lang() === "de" ? { quizFolder: "Tests", progressName: "Lernstand", topicsName: "Themen" } : {};
		this.settings = Object.assign({}, DEFAULTS, languageDefaults, data ?? {});
		this.settings.styleTemplates = { ...(this.settings.styleTemplates ?? {}) };
		this.settings.noTopicList = [...(this.settings.noTopicList ?? [])];
		if (!loaded) await this.saveSettings(); // fix the language-dependent folder names right away
		if (imported) new Notice(t().notices.importedLegacy, 8000);
	}

	private async legacySettings(): Promise<Record<string, unknown> | null> {
		const p = normalizePath(`${this.app.vault.configDir ?? ".obsidian"}/plugins/${LEGACY_KEY}/data.json`);
		try {
			if (!(await this.app.vault.adapter.exists(p))) return null;
			const s = settingsFromLegacy(JSON.parse(await this.app.vault.adapter.read(p)));
			// Skript-Check was German-only: keep the German folder names it created
			return Object.keys(s).length ? { quizFolder: "Tests", progressName: "Lernstand", topicsName: "Themen", ...s } : null;
		} catch {
			return null;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
