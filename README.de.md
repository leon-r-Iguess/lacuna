# Lacuna

**Finde deine Wissenslücken, bevor die Klausur es tut.**

Lacuna ist ein Plugin für [Obsidian](https://obsidian.md). Es macht aus deinen Vorlesungsnotizen, PDFs und Bildern Verständnistests, bewertet deine Antworten mit Punktzahl und Fehleranalyse und zeigt dir, wie klausurreif du bist – berechnet aus deinen echten Ergebnissen, nicht aus deinem Bauchgefühl.

*Lacuna* ist Latein für „Lücke“.

🇬🇧 [English README](README.md)

---

## Funktionen

- **Tests aus allem in deinem Vault** – eine Notiz, eine PDF (mit Seitenbereich), ein Tafelbild oder ein ganzer Ordner. Multiple Choice und offene Fragen, drei Niveaus.
- **Echte Bewertung statt nur richtig/falsch** – Teilpunkte bei offenen Fragen, zu jedem Fehler ein Fehlertyp (Wissenslücke, Verwechslung, unvollständig, Anwendungsfehler, Rechenfehler, ungenau), was falsch war, die richtige Herleitung, die Fundstelle und eine Nachfrage.
- **Nachfragen-Runde** – ein Klick macht aus den Nachfragen einen neuen Test, ohne weiteren KI-Aufruf.
- **Altklausur als Stilvorlage** – Fragen im Stil und auf dem Niveau einer alten Klausur, Inhalt aus deinen Unterlagen.
- **Klausurreife** – ein Live-Balken in der Lernstand-Notiz:
  - **Abdeckung**: welche Themen der Vorlesung du schon getestet hast (mit einer bearbeitbaren Themenliste, die erst nach deiner Bestätigung erstellt wird).
  - **Beherrschung**: dein Score in den letzten Tests pro Thema.
  - **Erinnerung**: wie viel du heute vermutlich noch weißt, berechnet mit [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) (Free Spaced Repetition Scheduler, der Algorithmus hinter dem heutigen Anki) – **nur aus deinen Testergebnissen**.
  - **Klausurdatum**: Countdown und Prognose, wie viel am Klausurtag noch übrig ist, wenn du ab jetzt nichts mehr wiederholst.
  - **Größte Hebel**: die drei Themen, bei denen sich Lernen gerade am meisten lohnt, jeweils mit Knopf „Test dazu“.
- **„Wie sicher bist du?“** – optionale Selbsteinschätzung pro Frage. Sie ändert nie Punkte oder Wiederholungsplan, zeigt aber, wo du dich überschätzt, und bringt „sicher, aber falsch“ im nächsten Wiederholungstest nach vorne.
- **Alles ist Markdown** – Tests, Ergebnisse, Lernstand und Themenlisten sind normale Notizen. Die Lösungen liegen versteckt in der Test-Notiz und werden mit dem Rest des Vaults synchronisiert.
- **Deine KI, dein Key** – Claude (Anthropic), Gemini (Google) oder ChatGPT (OpenAI). Unter jedem Test stehen Token-Verbrauch und ungefähre Kosten.
- **Deutsch und Englisch** – die Oberfläche folgt der Sprache von Obsidian; die Tests sind immer in der Sprache deiner Unterlagen.

## So funktioniert's

1. Rechtsklick auf Notiz, PDF oder Bild → **Lacuna: Test erstellen** (oder auf einen Ordner → **Lacuna: Test aus Ordner erstellen**).
2. In der Notiz antworten: bei Multiple Choice ankreuzen, bei offenen Fragen unter **Antwort:** schreiben.
3. **Auswerten** klicken. Die Test-Notiz wird zum Ergebnis mit Score, Fehleranalyse und Nachfragen.
4. Rechtsklick auf den Fach-Ordner → **Lacuna: Lernstand aktualisieren** für Fehlermuster über alle Tests, die Klausurreife und die nächsten Schritte.

## Installation

Lacuna ist noch nicht im offiziellen Plugin-Verzeichnis.

**Mit BRAT (empfohlen zum Testen)**
1. Das Community-Plugin **BRAT** (Beta Reviewers Auto-update Tester) installieren.
2. BRAT → *Add beta plugin* → die URL dieses Repositorys eintragen.
3. Unter *Einstellungen → Community-Plugins* **Lacuna** aktivieren.

**Manuell**
1. `main.js`, `manifest.json` und `styles.css` aus dem [neuesten Release](../../releases/latest) herunterladen.
2. In `<dein Vault>/.obsidian/plugins/lacuna/` legen.
3. Obsidian neu laden und unter *Einstellungen → Community-Plugins* **Lacuna** aktivieren.

Danach unter *Einstellungen → Lacuna* den Anbieter wählen und den API-Key eintragen:

| Anbieter | Key bekommen | Standardmodell |
|---|---|---|
| Claude (Anthropic) | platform.claude.com → API Keys | `claude-sonnet-5-5` |
| Gemini (Google) | aistudio.google.com → Get API key (mit kostenlosem Kontingent) | `gemini-3.8-flash` |
| ChatGPT (OpenAI) | platform.openai.com → API keys | `gpt-6.1-sol` |

Ein typischer Test (erstellen + auswerten) kostet mit den Standardmodellen ein paar Cent, im kostenlosen Gemini-Kontingent nichts.

## Wie die Klausurreife berechnet wird

Jedes Thema ist eine Karte in FSRS. Jeder ausgewertete Test ist eine Wiederholung jedes Themas, das darin vorkommt, bewertet nach dem Score für dieses Thema:

| Score im Thema | FSRS-Bewertung |
|---|---|
| unter 40 % | Again (vergessen) |
| 40–69 % | Hard (schwer) |
| 70–89 % | Good (gut) |
| ab 90 % | Easy (leicht) |

Tests auf Klausurniveau werden etwas milder bewertet, Einstiegstests etwas strenger.

Pro Thema gilt: **Reife = Beherrschung × Erinnerung × Beleg**. Der Beleg erreicht 100 %, sobald mindestens 6 Punkte zu einem Thema abgefragt wurden – eine einzelne Glückstreffer-Antwort zählt also nicht als „sitzt“. Der Wert fürs Fach ist der gewichtete Mittelwert über alle Themen der Themenliste (ungetestete zählen 0). Ohne einen Test auf Klausurniveau oder mit Altklausur ist die Reife bei 80 % gedeckelt (einstellbar).

Die Selbsteinschätzung fließt bewusst **nicht** ein: Sie wird nur als Kalibrierung angezeigt.

## Datenschutz und Hinweise

- **Netzwerk:** Lacuna schickt Inhalte an den KI-Anbieter, den du wählst (Anthropic, Google oder OpenAI), und nur wenn du
  - einen Test erstellst (die gewählte Notiz, PDF-Seiten, Bilder oder den Ordner),
  - einen Test auswertest (Fragen, Musterlösungen und deine Antworten),
  - den Lernstand von Hand aktualisierst (deine bisherigen Fehler, um Fehlermuster zu finden),
  - eine Themenliste erstellst oder ergänzt (die Unterlagen des Fach-Ordners, nach Bestätigung einer Kostenschätzung).

  Sonst wird nichts gesendet, es gibt keine Telemetrie.
- **Konto / Kosten:** Du brauchst einen API-Key von einem dieser Anbieter. Claude und ChatGPT rechnen nach Nutzung ab, Gemini hat ein kostenloses Kontingent. Lacuna selbst ist kostenlos.
- API-Keys liegen lokal in `.obsidian/plugins/lacuna/data.json`. Diesen Ordner nie weitergeben – zum Teilen die Release-Dateien nehmen.
- Lacuna schreibt nur in Notizen, die es selbst angelegt hat (erkennbar an `lacuna:` im Frontmatter). Heißt eine deiner Notizen schon wie die Lernstand-Notiz oder die Themenliste, bleibt sie unverändert. Eigene Eigenschaften (Tags, Aliase …) in Test- und Lernstand-Notizen bleiben erhalten.

## Umstieg von Skript-Check

Lacuna ist der Nachfolger von *Skript-Check*, der rein deutschen Version dieses Plugins. Beim ersten Start übernimmt Lacuna dessen Einstellungen und API-Keys und liest alles, was Skript-Check angelegt hat: Tests (auch noch nicht ausgewertete), Lernstand-Notizen, Themenlisten und das Klausurdatum. Skript-Check danach deaktivieren.

## Entwicklung

```bash
npm install
npm test           # Vitest, läuft gegen einen kleinen Nachbau der Obsidian-API
npm run build      # Typprüfung + Bundle nach dist/main.js
```

## Lizenz

[MIT](LICENSE)
