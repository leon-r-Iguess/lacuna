import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";

/** Pick the exam date of a subject. Resolves with YYYY-MM-DD, "" (remove) or null (cancelled). */
export class DateDialog extends Modal {
	private result: string | null = null;

	constructor(
		app: App,
		private heading: string,
		private value: string,
		private done: (d: string | null) => void,
	) {
		super(app);
	}

	onOpen() {
		const s = t().dialog;
		this.setTitle(this.heading);
		this.contentEl.createEl("p", { text: s.examDateExplain });
		let value = this.value;
		new Setting(this.contentEl).setName(s.date).addText((x) => {
			x.inputEl.type = "date";
			x.setValue(value).onChange((v) => (value = v));
		});
		const row = new Setting(this.contentEl);
		if (this.value)
			row.addButton((b) =>
				b.setButtonText(s.remove).onClick(() => {
					this.result = "";
					this.close();
				}),
			);
		row.addButton((b) =>
			b
				.setButtonText(s.save)
				.setCta()
				.onClick(() => {
					this.result = value;
					this.close();
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
		this.done(this.result);
	}
}
