---
skript-check: test
id: 20261004-1000-efgh
quelle: "[[Uni/Netze/Kapitel 4.md|Kapitel 4.md]]"
erstellt: 2026-10-04T10:00
status: ausgewertet
ausgewertet: 2026-10-04T10:30
fragen: 2
score: 50
punkte: "2 / 4"
themen:
  - "VLAN-Grundlagen: 100 %"
  - "Inter-VLAN-Routing: 33 %"
fehlertypen:
  Unvollständig: 1
---

# Test: VLANs

> [!abstract] Ergebnis: 2 / 4 Punkte (50 %)
> **Themen (schwächstes zuerst):** Inter-VLAN-Routing 33 % · VLAN-Grundlagen 100 %
> **Fehlertypen:** Unvollständig (1)
> **Selbsteinschätzung:** sicher 1/1 richtig · unsicher 0/1 richtig
> **Klausurreife Netze: 30 %**
> **Fazit:** Fazit

## Frage 1 · leicht · VLAN-Grundlagen — 1/1

Was macht ein VLAN?

- [ ] A) Routing
- [x] B) Trennt Broadcast-Domänen ✅
- [ ] C) Verschlüsselt
- [ ] D) DHCP

> [!success] Richtig · du warst: sicher

## Frage 2 · schwer · Inter-VLAN-Routing — 1/3

Erkläre Router-on-a-Stick.

**Deine Antwort:**

Ein Router mit Subinterfaces.

> [!warning] 1/3 · Unvollständig · du warst: unsicher
> **Was falsch war:** dot1q fehlt
> **Richtig:** Subinterfaces mit encapsulation dot1q
> **Fundstelle:** Seite 5
> **Nachfrage:** Welcher Befehl?

## Nachfragen-Runde

Macht aus den Nachfragen oben einen kurzen Folgetest, damit du die Lücken direkt schließt.

```skript-check
nachfragen
```

<small>KI-Nutzung: claude-sonnet-5-5 · 23.000 Tokens · ca. 0,07 $</small>

%%skript-check-daten (Lösungen und Auswertungsdaten, bitte nicht bearbeiten)
eyJpZCI6IjIwMjYxMDA0LTEwMDAtZWZnaCIsInRpdGVsIjoiVkxBTnMiLCJxdWVsbGUiOiJVbmkv
TmV0emUvS2FwaXRlbCA0Lm1kIiwic2VpdGVuIjoiIiwiZXJzdGVsbHQiOiIyMDI2LTEwLTA0VDEw
OjAwIiwiZnJhZ2VuIjpbeyJuciI6MSwidHlwIjoibWMiLCJzY2h3aWVyaWdrZWl0IjoibGVpY2h0
IiwidGhlbWEiOiJWTEFOLUdydW5kbGFnZW4iLCJmcmFnZSI6IldhcyBtYWNodCBlaW4gVkxBTj8i
LCJvcHRpb25lbiI6WyJSb3V0aW5nIiwiVHJlbm50IEJyb2FkY2FzdC1Eb23DpG5lbiIsIlZlcnNj
aGzDvHNzZWx0IiwiREhDUCJdLCJyaWNodGlnIjoxLCJsb2VzdW5nIjoiVHJlbm50IEJyb2FkY2Fz
dC1Eb23DpG5lbi4iLCJmdW5kc3RlbGxlIjoiU2VpdGUgMyJ9LHsibnIiOjIsInR5cCI6Im9mZmVu
Iiwic2Nod2llcmlna2VpdCI6InNjaHdlciIsInRoZW1hIjoiSW50ZXItVkxBTi1Sb3V0aW5nIiwi
ZnJhZ2UiOiJFcmtsw6RyZSBSb3V0ZXItb24tYS1TdGljay4iLCJvcHRpb25lbiI6W10sInJpY2h0
aWciOm51bGwsImxvZXN1bmciOiJTdWJpbnRlcmZhY2VzIG1pdCBkb3QxcS4iLCJmdW5kc3RlbGxl
IjoiU2VpdGUgNSJ9XSwibml2ZWF1Ijoia2xhdXN1ciIsImtvc3RlbiI6eyJhbmJpZXRlciI6ImNs
YXVkZSIsIm1vZGVsbCI6ImNsYXVkZS1zb25uZXQtNS01IiwiaW5wdXQiOjIwMDAwLCJvdXRwdXQi
OjMwMDAsInVzZCI6MC4wN30sImVyZ2VibmlzIjp7ImF1c2dld2VydGV0IjoiMjAyNi0xMC0wNFQx
MDozMCIsInB1bmt0ZSI6MiwibWF4Ijo0LCJwcm96ZW50Ijo1MCwiYmV3ZXJ0dW5nZW4iOlt7Im5y
IjoxLCJwdW5rdGUiOjEsIm1heCI6MSwiZmVobGVydHlwIjpudWxsLCJ3YXNfZmFsc2NoIjoiIiwi
cmljaHRpZyI6IiIsImZ1bmRzdGVsbGUiOiIiLCJuYWNoZnJhZ2UiOiIiLCJzaWNoZXJoZWl0Ijoi
c2ljaGVyIn0seyJuciI6MiwicHVua3RlIjoxLCJtYXgiOjMsImZlaGxlcnR5cCI6IlVudm9sbHN0
w6RuZGlnIiwid2FzX2ZhbHNjaCI6ImRvdDFxIGZlaGx0IiwicmljaHRpZyI6IlN1YmludGVyZmFj
ZXMgbWl0IGVuY2Fwc3VsYXRpb24gZG90MXEiLCJmdW5kc3RlbGxlIjoiU2VpdGUgNSIsIm5hY2hm
cmFnZSI6IldlbGNoZXIgQmVmZWhsPyIsInNpY2hlcmhlaXQiOiJ1bnNpY2hlciJ9XSwidGhlbWVu
IjpbeyJ0aGVtYSI6IlZMQU4tR3J1bmRsYWdlbiIsInB1bmt0ZSI6MSwibWF4IjoxLCJwcm96ZW50
IjoxMDB9LHsidGhlbWEiOiJJbnRlci1WTEFOLVJvdXRpbmciLCJwdW5rdGUiOjEsIm1heCI6Mywi
cHJvemVudCI6MzN9XSwiZmVobGVydHlwZW4iOnsiVW52b2xsc3TDpG5kaWciOjF9LCJmYXppdCI6
IkZheml0In0sImFudHdvcnRlbiI6W3sibnIiOjEsImFuZ2VrcmV1enQiOlsxXSwidGV4dCI6IiIs
InNpY2hlcmhlaXQiOiJzaWNoZXIifSx7Im5yIjoyLCJhbmdla3JldXp0IjpbXSwidGV4dCI6IkVp
biBSb3V0ZXIgbWl0IFN1YmludGVyZmFjZXMuIiwic2ljaGVyaGVpdCI6InVuc2ljaGVyIn1dfQ==

%%
