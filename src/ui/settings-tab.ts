import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_MODELS, KEY_LINKS, PROVIDER_NAMES, Provider } from "../ai";
import { LangSetting, setLang, t } from "../i18n";
import { Level, QuestionTypes } from "../core/types";
import { safeFileName } from "../core/util";
import type LacunaPlugin from "../main";

export class SettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: LacunaPlugin,
	) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		const st = this.plugin.settings;
		const s = t().settings;
		const save = async () => this.plugin.saveSettings();

		new Setting(containerEl)
			.setName(s.language)
			.setDesc(s.languageDesc)
			.addDropdown((d) => {
				d.addOption("auto", s.languageAuto).addOption("en", "English").addOption("de", "Deutsch");
				d.setValue(st.language).onChange(async (v) => {
					st.language = v as LangSetting;
					setLang(st.language);
					await save();
					this.display();
				});
			});

		new Setting(containerEl).setName(s.aiHeading).setHeading();

		new Setting(containerEl)
			.setName(s.provider)
			.setDesc(s.providerDesc)
			.addDropdown((d) => {
				for (const [id, name] of Object.entries(PROVIDER_NAMES)) d.addOption(id, name);
				d.setValue(st.provider).onChange(async (v) => {
					st.provider = v as Provider;
					await save();
					this.display();
				});
			});

		const p = st.provider;
		const keyField: "claudeKey" | "geminiKey" | "openaiKey" = p === "gemini" ? "geminiKey" : p === "openai" ? "openaiKey" : "claudeKey";
		const modelField: "claudeModel" | "geminiModel" | "openaiModel" = p === "gemini" ? "geminiModel" : p === "openai" ? "openaiModel" : "claudeModel";

		new Setting(containerEl)
			.setName(s.apiKey(PROVIDER_NAMES[p]))
			.setDesc(s.apiKeyDesc(KEY_LINKS[p]))
			.addText((x) => {
				x.inputEl.type = "password";
				x.setPlaceholder(p === "claude" ? "sk-ant-…" : p === "openai" ? "sk-…" : "AIza…")
					.setValue(st[keyField])
					.onChange(async (v) => {
						st[keyField] = v.trim();
						await save();
					});
			});

		new Setting(containerEl)
			.setName(s.model)
			.setDesc(s.modelDesc(s.modelHints[p]))
			.addText((x) =>
				x
					.setPlaceholder(DEFAULT_MODELS[p])
					.setValue(st[modelField])
					.onChange(async (v) => {
						st[modelField] = v.trim();
						await save();
					}),
			);

		if (p === "claude") {
			new Setting(containerEl)
				.setName(s.workspace)
				.setDesc(s.workspaceDesc)
				.addText((x) =>
					x
						.setPlaceholder("wrkspc_…")
						.setValue(st.workspaceId)
						.onChange(async (v) => {
							st.workspaceId = v.trim();
							await save();
						}),
				);
		}

		new Setting(containerEl).setName(s.quizHeading).setHeading();

		new Setting(containerEl).setName(s.defaultCount).addSlider((x) =>
			x
				.setLimits(3, 20, 1)
				.setValue(st.defaultCount)
				.setDynamicTooltip()
				.onChange(async (v) => {
					st.defaultCount = v;
					await save();
				}),
		);

		new Setting(containerEl)
			.setName(s.defaultTypes)
			.setDesc(s.defaultTypesDesc)
			.addDropdown((d) => {
				for (const [id, name] of Object.entries(t().questionTypes)) d.addOption(id, name);
				d.setValue(st.questionTypes).onChange(async (v) => {
					st.questionTypes = v as QuestionTypes;
					await save();
				});
			});

		new Setting(containerEl).setName(s.defaultLevel).addDropdown((d) => {
			for (const [id, name] of Object.entries(t().level)) d.addOption(id, name);
			d.setValue(st.level).onChange(async (v) => {
				st.level = v as Level;
				await save();
			});
		});

		new Setting(containerEl)
			.setName(s.askConfidence)
			.setDesc(s.askConfidenceDesc)
			.addToggle((x) =>
				x.setValue(st.askConfidence).onChange(async (v) => {
					st.askConfidence = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(s.quizFolder)
			.setDesc(s.quizFolderDesc)
			.addText((x) =>
				x.setValue(st.quizFolder).onChange(async (v) => {
					st.quizFolder = safeFileName(v) || "Quizzes";
					await save();
				}),
			);

		new Setting(containerEl).setName(s.progressName).addText((x) =>
			x.setValue(st.progressName).onChange(async (v) => {
				st.progressName = safeFileName(v) || "Progress";
				await save();
			}),
		);

		new Setting(containerEl).setName(s.readinessHeading).setHeading();

		new Setting(containerEl)
			.setName(s.target)
			.setDesc(s.targetDesc)
			.addDropdown((d) => {
				for (const z of [0.8, 0.85, 0.9, 0.95]) d.addOption(String(z), `${Math.round(z * 100)} %${z === 0.9 ? ` (${s.recommended})` : ""}`);
				d.setValue(String(st.targetRetention)).onChange(async (v) => {
					st.targetRetention = parseFloat(v);
					await save();
				});
			});

		new Setting(containerEl)
			.setName(s.cap)
			.setDesc(s.capDesc)
			.addDropdown((d) => {
				for (const z of [70, 80, 90, 100]) d.addOption(String(z), z === 100 ? s.noCap : `${z} %`);
				d.setValue(String(st.readinessCap)).onChange(async (v) => {
					st.readinessCap = parseInt(v, 10);
					await save();
				});
			});

		new Setting(containerEl)
			.setName(s.statusBar)
			.setDesc(s.statusBarDesc)
			.addToggle((x) =>
				x.setValue(st.statusBar).onChange(async (v) => {
					st.statusBar = v;
					await save();
				}),
			);

		new Setting(containerEl).setName(s.topicsName).addText((x) =>
			x.setValue(st.topicsName).onChange(async (v) => {
				st.topicsName = safeFileName(v) || "Topics";
				await save();
			}),
		);

		if (st.noTopicList.length) {
			new Setting(containerEl)
				.setName(s.declinedLists)
				.setDesc(st.noTopicList.map((x) => x || "Vault").join(", "))
				.addButton((b) =>
					b.setButtonText(s.askAgain).onClick(async () => {
						st.noTopicList = [];
						await save();
						this.display();
					}),
				);
		}
	}
}
