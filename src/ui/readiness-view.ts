// Live exam-readiness view inside the progress note (```lacuna readiness``` block).

import { t } from "../i18n";
import { Lever, leverReasonText } from "../core/readiness";
import type { ReadinessContext } from "../main";

export interface ReadinessActions {
	setExamDate: () => void;
	quizForLever: (h: Lever) => void;
	topicList: () => void;
	openTopicList: () => void;
}

export function renderReadinessView(el: HTMLElement, k: ReadinessContext, cap: number, act: ReadinessActions) {
	const s = t().readiness;
	el.empty();
	const { r } = k;
	const level = r.percent >= 75 ? "good" : r.percent >= 50 ? "medium" : "weak";

	const head = el.createDiv({ cls: "lacuna-readiness-head" });
	head.createSpan({ text: s.title(k.name) });
	head.createSpan({ cls: "lacuna-readiness-number", text: `${r.percent} %` });

	const track = el.createDiv({ cls: "lacuna-readiness-bar" });
	const fill = track.createDiv({ cls: `lacuna-readiness-fill lacuna-${level}` });
	fill.style.width = `${r.percent}%`;
	if (r.percentAtExam !== null && r.daysToExam !== null && r.daysToExam > 0) {
		const marker = track.createDiv({ cls: "lacuna-readiness-forecast" });
		marker.style.left = `${r.percentAtExam}%`;
		marker.setAttr("aria-label", s.forecast(r.percentAtExam));
	}
	el.createDiv({
		cls: "lacuna-readiness-info",
		text: s.breakdown(Math.round(r.coverage * 100), r.mode === "files", Math.round(r.mastery * 100), s.freshness[r.freshness]),
	});

	const examRow = el.createDiv({ cls: "lacuna-readiness-info" });
	if (r.daysToExam !== null && r.daysToExam >= 0) {
		examRow.setText(`${s.examIn(r.daysToExam)} (${k.exam})` + (r.percentAtExam !== null ? ` · ${s.forecast(r.percentAtExam)}` : ""));
	} else examRow.setText(k.exam ? s.examWas(k.exam) : s.noExamDate);
	const dateBtn = examRow.createEl("button", { cls: "lacuna-small", text: k.exam ? s.change : s.setExamDate });
	dateBtn.onclick = act.setExamDate;

	if (r.capped) el.createDiv({ cls: "lacuna-readiness-hint", text: s.capped(cap) });
	const q = r.calibration.confidentErrorRate;
	if (q !== null && q > 0.25) el.createDiv({ cls: "lacuna-readiness-hint", text: s.overconfidence(Math.round(q * 100)) });
	if (!r.evaluatedQuizzes) el.createDiv({ cls: "lacuna-readiness-info", text: s.noQuizzes });

	if (r.levers.length) {
		el.createDiv({ cls: "lacuna-readiness-sub", text: s.levers });
		const ol = el.createEl("ol", { cls: "lacuna-levers" });
		for (const h of r.levers) {
			const li = ol.createEl("li");
			li.createSpan({ text: `${h.topic} – ${leverReasonText(h.reason)} ` });
			const b = li.createEl("button", { cls: "lacuna-small", text: s.quizOnIt });
			b.onclick = () => act.quizForLever(h);
		}
	}

	const row = el.createDiv({ cls: "lacuna-readiness-row" });
	if (k.list) {
		if (k.newFiles.length) {
			const b = row.createEl("button", { text: s.extendList(k.newFiles.length) });
			b.onclick = act.topicList;
		}
		const b = row.createEl("button", { text: s.openList });
		b.onclick = act.openTopicList;
	} else {
		const b = row.createEl("button", { text: s.createList });
		b.onclick = act.topicList;
		row.createSpan({ cls: "lacuna-readiness-info", text: " " + (k.declinedList ? s.listDeclined : s.listHint) });
	}
}
