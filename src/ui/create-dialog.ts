import { App, Modal, Setting, TFile } from "obsidian";
import { t } from "../i18n";
import { Level, QuestionTypes } from "../core/types";

/** What the create dialog returns. */
export interface CreateChoice {
	count: number;
	pages: string;
	focus: string;
	questionTypes: QuestionTypes;
	level: Level;
	/** Path of the past exam or "" */
	styleTemplate: string;
}

export interface CreateDialogOptions {
	title: string;
	description: string;
	pageCount: number | null;
	choice: CreateChoice;
	pastExams: TFile[];
	go: (w: CreateChoice) => void;
}

export class CreateDialog extends Modal {
	constructor(
		app: App,
		private o: CreateDialogOptions,
	) {
		super(app);
	}

	onOpen() {
		const s = t().dialog;
		const { contentEl } = this;
		this.setTitle(this.o.title);
		contentEl.createEl("p", { text: this.o.description, cls: "lacuna-source" });
		const w: CreateChoice = { ...this.o.choice };

		new Setting(contentEl)
			.setName(s.count)
			.setDesc(s.countDesc)
			.addSlider((x) =>
				x
					.setLimits(3, 20, 1)
					.setValue(w.count)
					.setDynamicTooltip()
					.onChange((v) => (w.count = v)),
			);

		if (this.o.pageCount !== null) {
			new Setting(contentEl)
				.setName(s.pages)
				.setDesc(s.pagesDesc(this.o.pageCount))
				.addText((x) => x.setPlaceholder(s.all).onChange((v) => (w.pages = v)));
		}

		new Setting(contentEl)
			.setName(s.questionTypes)
			.setDesc(s.questionTypesDesc)
			.addDropdown((d) => {
				for (const [id, name] of Object.entries(t().questionTypes)) d.addOption(id, name);
				d.setValue(w.questionTypes).onChange((v) => (w.questionTypes = v as QuestionTypes));
			});

		new Setting(contentEl).setName(s.level).addDropdown((d) => {
			for (const [id, name] of Object.entries(t().level)) d.addOption(id, name);
			d.setValue(w.level).onChange((v) => (w.level = v as Level));
		});

		const candidates = this.o.pastExams.slice(0, 40);
		if (w.styleTemplate && !candidates.some((k) => k.path === w.styleTemplate)) w.styleTemplate = "";
		new Setting(contentEl)
			.setName(s.pastExam)
			.setDesc(candidates.length ? s.pastExamDesc : s.pastExamNone)
			.addDropdown((d) => {
				d.addOption("", s.none);
				for (const k of candidates) d.addOption(k.path, k.path);
				d.setValue(w.styleTemplate).onChange((v) => (w.styleTemplate = v));
				if (!candidates.length) d.setDisabled(true);
			});

		new Setting(contentEl)
			.setName(s.focus)
			.setDesc(s.focusDesc)
			.addText((x) => x.setValue(w.focus).onChange((v) => (w.focus = v)));

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(s.create)
				.setCta()
				.onClick(() => {
					this.close();
					this.o.go(w);
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
