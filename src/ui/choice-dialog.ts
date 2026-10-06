import { App, Modal, Setting } from "obsidian";

export interface ChoiceOption {
	id: string;
	text: string;
	cta?: boolean;
}

/** A question with several buttons (e.g. create topic list / later / never). */
export class ChoiceDialog extends Modal {
	private chosen: string | null = null;

	constructor(
		app: App,
		private heading: string,
		private text: string[],
		private options: ChoiceOption[],
		private done: (id: string | null) => void,
	) {
		super(app);
	}

	onOpen() {
		this.setTitle(this.heading);
		for (const p of this.text) this.contentEl.createEl("p", { text: p });
		const s = new Setting(this.contentEl);
		for (const o of this.options) {
			s.addButton((b) => {
				b.setButtonText(o.text).onClick(() => {
					this.chosen = o.id;
					this.close();
				});
				if (o.cta) b.setCta();
			});
		}
	}

	onClose() {
		this.contentEl.empty();
		this.done(this.chosen);
	}
}
