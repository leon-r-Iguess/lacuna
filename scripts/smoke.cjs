// Loads the built dist/main.js against a stubbed Obsidian API and runs onload().
// Catches bundle and startup errors that unit tests (which import the TypeScript sources) cannot see.
// Run after `npm run build`: npm run smoke
const Module = require("module");
const path = require("path");
const orig = Module._load;
const registered = new Set(["skript-check"]); // pretend Skript-Check is still enabled
class El { constructor(){} empty(){} setText(){} addClass(){} createEl(){return new El()} createDiv(){return new El()} createSpan(){return new El()} setCssProps(){} setAttr(){} }
const obsidian = new Proxy({
  Plugin: class { constructor(app, manifest){ this.app=app; this.manifest=manifest; } addCommand(){} addSettingTab(){} registerEvent(){} registerMarkdownCodeBlockProcessor(lang){ if (registered.has(lang)) throw new Error("already registered: " + lang); registered.add(lang); } addStatusBarItem(){ return new El(); } async loadData(){ return null; } async saveData(){} },
  PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class { constructor(m){} hide(){} },
  MarkdownView: class {}, TFile: class {}, TFolder: class {}, TAbstractFile: class {},
  normalizePath: (p)=>p, requestUrl: ()=>{}, loadPdfJs: ()=>{}, arrayBufferToBase64: ()=>"",
  moment: { locale: () => "de" },
}, { get(t, k){ if (typeof k === "string" && !(k in t) && k !== "__esModule" && k !== "then") { console.error("Missing Obsidian export in smoke stub:", k); process.exitCode = 1; } return t[k]; } });
Module._load = function (req, ...rest) { if (req === "obsidian") return obsidian; return orig.call(this, req, ...rest); };
(async () => {
  const mod = require(path.resolve(process.argv[2] || "dist/main.js"));
  const P = mod.default || mod;
  const app = { vault: { configDir: ".obsidian", adapter: { exists: async()=>false, read: async()=>"" }, getAbstractFileByPath: ()=>null, getMarkdownFiles: ()=>[], getFiles: ()=>[] }, workspace: { on: ()=>({}), onLayoutReady: (f)=>f(), getActiveFile: ()=>null }, metadataCache: {} };
  const p = new P(app, { dir: ".obsidian/plugins/lacuna", id: "lacuna" });
  await p.onload();
  if (!p.settings || !p.settings.provider) throw new Error("settings not loaded");
  console.log("Smoke test passed: plugin loads and runs onload().");
})().catch(e => { console.error("Plugin failed to load:", e); process.exit(1); });
