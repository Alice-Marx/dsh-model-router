window.__ModuleLoader__.load({
  id: "@ljwei-stak/model-router-galgame",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// .dsh-plugin/client/official-harness.jsx
var official_harness_exports = {};
__export(official_harness_exports, {
  ROUTER_NAMESPACE: () => ROUTER_NAMESPACE,
  ROUTER_PACKAGE: () => ROUTER_PACKAGE,
  ROUTER_PANEL: () => ROUTER_PANEL,
  RouterSettingsCard: () => RouterSettingsCard,
  RouterSettingsCardController: () => RouterSettingsCardController,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(official_harness_exports);
var import_react3 = __toESM(require("react"), 1);

// .dsh-plugin/shared/official-tool-registry.mjs
var OFFICIAL_TOOLS = Object.freeze([
  Object.freeze({
    id: "kimi-code",
    label: "Kimi Code \xB7 Node",
    vendor: "Moonshot AI",
    purpose: "Kimi \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B kimi \u547D\u4EE4\u4E0E ACP \u4F1A\u8BDD\u3002",
    package: "@moonshot-ai/kimi-code",
    version: "2.1.1",
    manager: "npm",
    installArgs: ["install", "-g", "@moonshot-ai/kimi-code@2.1.1", "--registry=https://registry.npmjs.org/"],
    probeExecutables: ["kimi"],
    probeNote: "kimi \u4E0E\u65E7 Python \u7248 kimi-cli \u540C\u540D\uFF1B\u8BF7\u6838\u5BF9\u53EF\u6267\u884C\u6587\u4EF6\u6765\u6E90\u548C\u7248\u672C\u3002",
    providerHints: ["moonshot", "kimi"]
  }),
  Object.freeze({
    id: "claude-code",
    label: "Claude Code",
    vendor: "Anthropic",
    purpose: "Anthropic \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B claude \u547D\u4EE4\u3002",
    package: "@anthropic-ai/claude-code",
    version: "2.1.283",
    manager: "npm",
    installArgs: ["install", "-g", "@anthropic-ai/claude-code@2.1.283", "--registry=https://registry.npmjs.org/"],
    probeExecutables: ["claude"],
    providerHints: ["anthropic", "claude"]
  }),
  Object.freeze({
    id: "codex",
    label: "Codex CLI",
    vendor: "OpenAI",
    purpose: "OpenAI \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B codex \u547D\u4EE4\u3002",
    package: "@openai/codex",
    version: "0.157.1",
    installArgs: ["install", "-g", "@openai/codex@0.157.1", "--registry=https://registry.npmjs.org/"],
    manager: "npm",
    probeExecutables: ["codex"],
    probeNote: "Codex \u7248\u672C\u6A2A\u5E45\u7531\u9002\u914D\u5C42\u5BBD\u5339\u914D\uFF1B\u5B89\u88C5\u65F6\u56FA\u5B9A\u7248\u672C\u3002",
    providerHints: ["openai", "gpt", "codex"]
  }),
  Object.freeze({
    id: "minimax-code",
    label: "MiniMax Code",
    vendor: "MiniMax",
    purpose: "MiniMax \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B mcode \u547D\u4EE4\u3002",
    package: "@minimax-ai/code",
    version: "0.5.5",
    manager: "npm",
    installArgs: ["install", "-g", "@minimax-ai/code@0.5.5", "--registry=https://registry.npmjs.org/", "--ignore-scripts=false", "--include=optional", "--allow-scripts=@minimax-ai/code,better-sqlite3"],
    probeExecutables: ["mcode"],
    providerHints: ["minimax"]
  }),
  Object.freeze({
    id: "mimo-code",
    label: "MiMo Code",
    vendor: "XiaoMi",
    purpose: "\u5C0F\u7C73 MiMo \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B mimo \u547D\u4EE4\u3002",
    package: "@mimo-ai/cli",
    version: "0.1.15",
    manager: "npm",
    installArgs: ["install", "-g", "@mimo-ai/cli@0.1.15", "--registry=https://registry.npmjs.org/"],
    probeExecutables: ["mimo"],
    providerHints: ["mimo", "xiaomi"]
  }),
  Object.freeze({
    id: "grok-build",
    label: "Grok Build",
    vendor: "xAI",
    purpose: "xAI \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B grok \u547D\u4EE4\u4E0E ACP \u4F1A\u8BDD\u3002",
    package: "@xai-official/grok",
    version: "1.0.41",
    manager: "npm",
    installArgs: ["install", "-g", "@xai-official/grok@1.0.41", "--registry=https://registry.npmjs.org/"],
    probeExecutables: ["grok"],
    providerHints: ["xai", "grok"]
  }),
  Object.freeze({
    id: "gemini",
    label: "Gemini CLI",
    vendor: "Google",
    purpose: "Google \u5B98\u65B9 Gemini CLI\uFF0C\u65E0\u754C\u9762\u6A21\u5F0F\u4F7F\u7528 gemini -p\u3002",
    package: "@google/gemini-cli",
    version: "0.62.0",
    manager: "npm",
    installArgs: ["install", "-g", "@google/gemini-cli@0.62.0", "--registry=https://registry.npmjs.org/"],
    probeExecutables: ["gemini"],
    providerHints: ["gemini", "google"],
    // Headless runs go through the task adapter. The signed sandbox runner does
    // not launch this CLI; a missing or failed process falls back to the API.
    headlessAdapter: true
  }),
  Object.freeze({
    id: "zcode",
    label: "ZCode",
    vendor: "Z.ai",
    purpose: "\u667A\u8C31\u5B98\u65B9 ZCode \u684C\u9762\u7248\uFF0C\u5185\u542B GLM \u7F16\u7A0B\u4EE3\u7406\u3002Windows \u5B89\u88C5\u5668\u53EF\u9009\u62E9 D \u76D8\u76EE\u5F55\u3002",
    version: "3.14.3",
    manager: "signed-windows-installer",
    installArgs: [],
    probeExecutables: [],
    probeNote: "\u68C0\u6D4B\u7ECF\u8FC7\u6709\u6548\u7B7E\u540D\u7684 ZCode.exe \u548C\u540C\u76EE\u5F55 GLM \u8D44\u6E90\uFF1B\u684C\u9762\u5B89\u88C5\u5668\u9700\u4EBA\u5DE5\u9009\u62E9\u5B89\u88C5\u4F4D\u7F6E\u3002",
    providerHints: ["zai", "z.ai", "zcode", "glm", "zhipu"]
  })
]);
var TOOL_BY_ID = new Map(OFFICIAL_TOOLS.map((tool) => [tool.id, tool]));
function getOfficialTool(id2) {
  return TOOL_BY_ID.get(String(id2 ?? "").trim()) ?? null;
}
function toolForProvider(provider) {
  const value = String(provider ?? "").trim().toLowerCase();
  if (!value) return null;
  for (const tool of OFFICIAL_TOOLS) {
    if (tool.providerHints.some((hint) => value.includes(hint))) return tool;
  }
  return null;
}
function installCommandLine(tool) {
  if (!tool || tool.unsupported) return null;
  if (tool.manager === "signed-windows-installer") return "\u6253\u5F00\u5B98\u65B9\u7B7E\u540D\u5B89\u88C5\u5668\uFF08\u9009\u62E9\u5B89\u88C5\u76EE\u5F55\uFF09";
  return tool.manager === "npm" ? `npm ${tool.installArgs.join(" ")}` : `${tool.manager} ${tool.installArgs.join(" ")}`;
}

// .dsh-plugin/shared/model-profiles.mjs
var MAX_TEXT = 32e3;
var MAX_PROFILES = 200;
var id = (value) => typeof value === "string" ? value.trim() : "";
function nonnegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e6) {
    throw new Error(`${label} \u5FC5\u987B\u662F 0 \u5230 1000000 \u4E4B\u95F4\u7684\u6709\u9650\u6570\u5B57`);
  }
  return value;
}
function normalizeProfile(entry, index) {
  const label = `\u7B2C ${index + 1} \u4E2A\u6A21\u578B`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} \u5FC5\u987B\u662F\u5BF9\u8C61`);
  const allowed = /* @__PURE__ */ new Set(["provider", "model", "quality", "pricing", "specialties", "cliModel", "execution"]);
  const unknown = Object.keys(entry).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} \u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5 ${unknown}\uFF1B\u4E0D\u8981\u5728\u8FD9\u91CC\u586B\u5199\u5BC6\u94A5\u6216\u547D\u4EE4`);
  const provider = id(entry.provider);
  const model = id(entry.model);
  if (!provider || !model || provider.length > 160 || model.length > 240) {
    throw new Error(`${label} \u9700\u8981\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u51C6\u786E provider \u548C model`);
  }
  const profile = { provider, model };
  if (entry.quality !== void 0) {
    const value = nonnegative(entry.quality, `${label} \u7684 quality`);
    if (value > 100) throw new Error(`${label} \u7684 quality \u5E94\u5728 0 \u5230 100 \u4E4B\u95F4`);
    profile.quality = value / 100;
  }
  if (entry.pricing !== void 0) {
    const prices = entry.pricing;
    if (!prices || typeof prices !== "object" || Array.isArray(prices)) throw new Error(`${label} \u7684 pricing \u5FC5\u987B\u662F\u5BF9\u8C61`);
    const priceFields = /* @__PURE__ */ new Set(["input", "output", "cacheRead", "cacheWrite", "currency"]);
    const unknownPrice = Object.keys(prices).find((key) => !priceFields.has(key));
    if (unknownPrice) throw new Error(`${label} \u7684 pricing \u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5 ${unknownPrice}`);
    if (prices.currency !== void 0 && prices.currency !== "USD") throw new Error(`${label} \u7684\u4EF7\u683C\u5E01\u79CD\u76EE\u524D\u4EC5\u652F\u6301 USD`);
    profile.pricing = {
      input: nonnegative(prices.input, `${label} \u7684\u8F93\u5165\u5355\u4EF7`),
      output: nonnegative(prices.output, `${label} \u7684\u8F93\u51FA\u5355\u4EF7`),
      currency: "USD"
    };
    if (prices.cacheRead !== void 0) profile.pricing.cacheRead = nonnegative(prices.cacheRead, `${label} \u7684\u7F13\u5B58\u8BFB\u53D6\u5355\u4EF7`);
    if (prices.cacheWrite !== void 0) profile.pricing.cacheWrite = nonnegative(prices.cacheWrite, `${label} \u7684\u7F13\u5B58\u5199\u5165\u5355\u4EF7`);
  }
  if (entry.specialties !== void 0) {
    if (!Array.isArray(entry.specialties) || entry.specialties.length > 16 || entry.specialties.some((value) => !/^[a-z][a-z0-9-]{0,39}$/.test(value))) {
      throw new Error(`${label} \u7684 specialties \u5FC5\u987B\u662F\u81F3\u591A 16 \u4E2A\u82F1\u6587\u4EFB\u52A1\u6807\u7B7E`);
    }
    profile.specialties = [...new Set(entry.specialties)];
  }
  if (entry.cliModel !== void 0) {
    const cliModel = id(entry.cliModel);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(cliModel)) throw new Error(`${label} \u7684 cliModel \u65E0\u6548`);
    if (toolForProvider(provider)?.id === "zcode") throw new Error(`${label} \u5BF9\u5E94\u7684 ZCode CLI \u6682\u4E0D\u652F\u6301\u9010\u6B21\u5207\u6362\u6A21\u578B`);
    profile.cliModel = cliModel;
  }
  if (entry.execution !== void 0) {
    if (entry.execution !== "auto" && entry.execution !== "official" && entry.execution !== "api") {
      throw new Error(`${label} \u7684 execution \u53EA\u80FD\u662F auto\u3001official \u6216 api`);
    }
    if (entry.execution !== "auto") profile.execution = entry.execution;
  }
  if (Object.keys(profile).length === 2) throw new Error(`${label} \u81F3\u5C11\u63D0\u4F9B quality\u3001pricing\u3001specialties\u3001cliModel \u6216 execution \u4E4B\u4E00`);
  return profile;
}
function normalizeExecutionPreference(value) {
  if (value === void 0 || value === null || value === "" || value === "auto") return "auto";
  if (value === "official" || value === "api") return value;
  throw new TypeError("execution must be auto, official, or api");
}
function parseModelProfilesJson(value) {
  const source = value == null || value === "" ? "[]" : value;
  if (typeof source !== "string" || source.length > MAX_TEXT) throw new Error("\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u914D\u7F6E\u8D85\u8FC7 32000 \u5B57\u7B26\u4E0A\u9650");
  let input;
  try {
    input = JSON.parse(source);
  } catch {
    throw new Error("\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u914D\u7F6E\u4E0D\u662F\u6709\u6548\u7684 JSON");
  }
  if (!Array.isArray(input) || input.length > MAX_PROFILES) throw new Error("\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u914D\u7F6E\u5FC5\u987B\u662F\u6700\u591A 200 \u9879\u7684 JSON \u6570\u7EC4");
  const profiles = input.map(normalizeProfile);
  const seen = /* @__PURE__ */ new Set();
  for (const profile of profiles) {
    const key = `${profile.provider}\0${profile.model}`;
    if (seen.has(key)) throw new Error(`\u6A21\u578B ${profile.provider}/${profile.model} \u91CD\u590D\u914D\u7F6E`);
    seen.add(key);
  }
  return profiles;
}
function applyModelProfiles(routes, profiles) {
  const input = Array.isArray(routes) ? routes : [];
  const values = typeof profiles === "string" ? parseModelProfilesJson(profiles) : profiles;
  if (!Array.isArray(values)) throw new Error("\u6A21\u578B\u914D\u7F6E\u5FC5\u987B\u662F\u6570\u7EC4");
  const byKey = new Map(values.map((profile) => [`${profile.provider}\0${profile.model}`, profile]));
  return input.map((route) => {
    const profile = byKey.get(`${route.provider}\0${route.model}`);
    if (!profile) return route;
    return {
      ...route,
      ...profile.quality === void 0 ? {} : { quality: profile.quality, qualitySource: "user" },
      ...profile.pricing === void 0 ? {} : { pricing: { ...profile.pricing }, pricingSource: "user" },
      ...profile.specialties === void 0 ? {} : { specialties: [...profile.specialties] },
      ...profile.cliModel === void 0 ? {} : { cliModel: profile.cliModel },
      ...profile.execution === void 0 ? {} : { execution: profile.execution }
    };
  });
}

// .dsh-plugin/client/router-main.jsx
var import_react2 = __toESM(require("react"), 1);

// .dsh-plugin/shared/livebench.mjs
var TASK_ALIASES = Object.freeze({
  reasoning: ["reasoning", "reasoning_score", "hard_reasoning"],
  code: ["code", "coding", "coding_score"],
  math: ["math", "mathematics", "math_score"],
  research: ["research", "retrieval", "knowledge", "data_analysis"],
  writing: ["writing", "creative_writing", "language"],
  vision: ["vision", "multimodal", "visual"],
  summarization: ["summarization", "summary", "if"],
  classification: ["classification", "instruction_following"]
});
var CATEGORY_TO_TASK = Object.freeze({
  reasoning: "reasoning",
  coding: "code",
  "agentic coding": "code",
  mathematics: "math",
  "data analysis": "research",
  language: "writing",
  if: "summarization",
  vision: "vision",
  multimodal: "vision"
});
function normalized(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function liveBenchRow(snapshot, model) {
  return snapshot?.models?.[normalized(model)] ?? null;
}

// .dsh-plugin/shared/router.mjs
var OBJECTIVE_WEIGHTS = Object.freeze({
  simple: Object.freeze({ quality: 0.28, cost: 0.45, latency: 0.14, specialty: 0.04, reasoning: 0.07, risk: 0.02 }),
  balanced: Object.freeze({ quality: 0.4, cost: 0.26, latency: 0.1, specialty: 0.09, reasoning: 0.1, risk: 0.05 }),
  complex: Object.freeze({ quality: 0.48, cost: 0.14, latency: 0.06, specialty: 0.14, reasoning: 0.11, risk: 0.07 })
});
var REASONING_EFFORT_ORDER = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
var REASONING_EFFORT_MULTIPLIERS = Object.freeze({
  off: Object.freeze({ output: 0.78, latency: 0.75 }),
  minimal: Object.freeze({ output: 0.86, latency: 0.82 }),
  low: Object.freeze({ output: 0.93, latency: 0.9 }),
  medium: Object.freeze({ output: 1, latency: 1 }),
  high: Object.freeze({ output: 1.16, latency: 1.15 }),
  xhigh: Object.freeze({ output: 1.34, latency: 1.3 }),
  max: Object.freeze({ output: 1.58, latency: 1.5 })
});
var QUALITY_FLOORS = Object.freeze({ simple: 0.75, balanced: 0.78, complex: 0.82 });
var DEFAULT_ROUTER_SETTINGS = Object.freeze({
  pricing: Object.freeze({}),
  // The official site publishes versioned table/categories assets and the
  // adapter discovers the newest release from this root URL.
  liveBenchEndpoint: "https://livebench.ai",
  liveBenchTtlMs: 9e5,
  budgetUsd: 0,
  cacheReadRatio: 0,
  cacheWriteRatio: 0
});
var MODEL_CATALOG = Object.freeze([
  { id: "claude-fable-5", aliases: ["claude-fable-5", "claude fable 5"], quality: 0.99, latency: 0.34, costIn: 10, costOut: 50, specialties: ["reasoning", "writing", "research"], risk: 0.06 },
  { id: "claude-opus-4-8", aliases: ["claude-opus-4-8", "claude opus 4.8"], quality: 0.97, latency: 0.39, costIn: 5, costOut: 25, specialties: ["reasoning", "writing", "code"], risk: 0.07 },
  { id: "gpt-5.6-sol", aliases: ["gpt-5.6-sol", "gpt 5.6 sol"], quality: 0.98, latency: 0.4, costIn: 5, costOut: 30, specialties: ["reasoning", "code", "math", "vision"], risk: 0.06 },
  { id: "gpt-5.5", aliases: ["gpt-5.5", "gpt 5.5"], quality: 0.95, latency: 0.44, costIn: 5, costOut: 30, specialties: ["reasoning", "code", "math"], risk: 0.08 },
  { id: "deepseek-v4-pro", aliases: ["deepseek-v4-pro", "deepseek v4 pro"], quality: 0.93, latency: 0.52, costIn: 1.74, costOut: 3.48, specialties: ["code", "math", "reasoning"], risk: 0.1 },
  { id: "deepseek-v4-flash", aliases: ["deepseek-v4-flash", "deepseek v4 flash"], quality: 0.82, latency: 0.82, costIn: 0.14, costOut: 0.28, specialties: ["code", "summarization", "classification"], risk: 0.14 },
  { id: "kimi-k3", aliases: ["kimi-k3", "kimi k3"], quality: 0.91, latency: 0.56, costIn: 3, costOut: 15, specialties: ["reasoning", "long-context", "code"], risk: 0.1 },
  { id: "qwen3.7-max", aliases: ["qwen3.7-max", "qwen 3.7 max"], quality: 0.94, latency: 0.5, costIn: 2.5, costOut: 7.5, specialties: ["reasoning", "math", "code"], risk: 0.08 },
  { id: "qwen3.7-plus", aliases: ["qwen3.7-plus", "qwen 3.7 plus"], quality: 0.87, latency: 0.72, costIn: 0.4, costOut: 1.6, specialties: ["code", "math", "writing"], risk: 0.12 },
  { id: "glm-5.2", aliases: ["glm-5.2", "glm 5.2"], quality: 0.89, latency: 0.64, costIn: 1.4, costOut: 4.4, specialties: ["reasoning", "writing", "math"], risk: 0.11 },
  { id: "gpt-5.6-luna", aliases: ["gpt-5.6-luna", "gpt 5.6 luna"], quality: 0.84, latency: 0.86, costIn: 0.2, costOut: 1.2, specialties: ["classification", "summarization", "code"], risk: 0.14 },
  { id: "gpt-5.6-terra", aliases: ["gpt-5.6-terra", "gpt 5.6 terra"], quality: 0.91, latency: 0.66, costIn: 2, costOut: 12, specialties: ["code", "writing", "reasoning"], risk: 0.1 },
  { id: "minimax-m3", aliases: ["minimax-m3", "minimax m3"], quality: 0.86, latency: 0.69, costIn: 0.3, costOut: 1.2, specialties: ["writing", "code", "summarization"], risk: 0.13 },
  { id: "gemini-3-flash", aliases: ["gemini 3 flash", "gemini-3-flash"], quality: 0.88, latency: 0.73, costIn: 0.5, costOut: 3, specialties: ["vision", "research", "summarization"], risk: 0.12 },
  { id: "big-pickle", aliases: ["big pickle"], quality: 0.7, latency: 0.88, costIn: 0, costOut: 0, specialties: ["classification", "summarization"], risk: 0.24 }
]);
var clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
var normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
var routeKey = (provider, model) => `${String(provider ?? "")}/${String(model ?? "")}`;
var OPENCODE_CATALOG_PROVIDERS = Object.freeze([
  "opencode",
  "opencode-go",
  // Some OpenCode-compatible configuration examples use the product name as
  // the route id. Treat those aliases as catalog routes too; the pi-ai catalog
  // still owns the actual model endpoints.
  "opencode-zen",
  "opencode-go-zen"
]);
function classifyTask(text2) {
  const value = String(text2 ?? "");
  if (value.length < 80 && /翻译|解释|translate|explain/i.test(value)) return "general";
  return detectTaskTypes(value)[0] ?? "general";
}
var TASK_TYPE_RULES = Object.freeze([
  ["vision", /图片|图像|照片|视觉|image|vision|截图|识图/i],
  ["math", /数学|证明|定理|公式|方程|math|proof|theorem/i],
  ["code", /代码|编程|工程|项目|架构|接口|api|debug|实现|部署|测试|code/i],
  ["research", /研究|论文|文献|联网|检索|research|source|引用/i],
  ["summarization", /总结|摘要|提炼|提取|关键词|分类|翻译|summar|classif|extract/i],
  ["writing", /写作|润色|小说|文案|报告|writing|draft/i]
]);
var TASK_TYPE_LABELS = Object.freeze({
  vision: "\u89C6\u89C9\u5904\u7406",
  math: "\u6570\u5B66\u63A8\u5BFC",
  code: "\u5DE5\u7A0B\u4E0E\u4EE3\u7801",
  research: "\u7814\u7A76\u4E0E\u68C0\u7D22",
  summarization: "\u6458\u8981\u4E0E\u6574\u7406",
  writing: "\u5199\u4F5C\u4E0E\u8868\u8FBE"
});
function detectTaskTypes(text2) {
  const value = String(text2 ?? "");
  const ranked = TASK_TYPE_RULES.map(([type, pattern]) => ({
    type,
    signals: value.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))?.length ?? 0
  })).filter((item) => item.signals > 0);
  ranked.sort((left, right) => right.signals - left.signals || left.type.localeCompare(right.type));
  return ranked.map((item) => item.type);
}
function assessComplexity(text2) {
  const value = String(text2 ?? "");
  const lengthScore = clamp(value.length / 2200);
  const requirementScore = clamp((value.match(/(?:^|\n)\s*(?:[-*]|\d+[.)]|[一二三四五六七八九十]+[、.])/g) ?? []).length / 8);
  const codeScore = /(代码|工程|架构|接口|实现|部署|测试|code|api|debug)/i.test(value) ? 0.22 : 0;
  const highReasoningScore = /(数学|证明|定理|研究|论文|复杂|多步骤|约束|比较|评估|架构|模块|部署|math|proof|research)/i.test(value) ? 0.2 : 0;
  const visionScore = /(图片|图像|照片|截图|视觉|image|vision)/i.test(value) ? 0.12 : 0;
  const domainMarkers = (value.match(/代码|工程|架构|接口|实现|部署|测试|模块|拆分|约束|评估|证明|定理|研究|论文|图片|图像|照片|视觉|code|api|debug|proof|research|vision/gi) ?? []).length;
  const domainComplexity = clamp(domainMarkers / 5) * 0.28;
  const raw = clamp(0.1 + lengthScore * 0.3 + requirementScore * 0.18 + domainComplexity + codeScore + highReasoningScore + visionScore);
  const band = isHardRequirement(value) ? "complex" : isSimpleRequirement(value) && value.length <= 180 ? "simple" : raw < 0.34 ? "simple" : raw < 0.66 ? "balanced" : "complex";
  return { value: raw, band };
}
function specialtyMatch(model, taskType, liveScores = {}) {
  const benchmark = asScore(liveScores?.[taskType]);
  if (benchmark !== void 0) return benchmark;
  if (model.specialties.includes(taskType)) return 1;
  if (taskType === "general") return 0.58;
  if (taskType === "research" && model.specialties.includes("writing")) return 0.68;
  if (taskType === "writing" && model.specialties.includes("reasoning")) return 0.62;
  return 0.38;
}
function qualityForTask(row, taskType) {
  return asScore(row?.liveScores?.[taskType]) ?? asScore(row?.liveOverall) ?? row?.metadata?.quality ?? row?.quality ?? 0;
}
function specialtyForTask(row, taskType) {
  return specialtyMatch(row.metadata, taskType, row.liveScores);
}
function asScore(value) {
  if (value === null || value === void 0 || value === "") return void 0;
  const number = Number(value);
  if (!Number.isFinite(number)) return void 0;
  return clamp(number > 1 ? number / 100 : number);
}
function normalizePricing(pricing) {
  if (pricing === null || typeof pricing !== "object" || Array.isArray(pricing)) return {};
  const normalized2 = {};
  for (const [id2, raw] of Object.entries(pricing)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    if ((raw.input ?? raw.costIn) === null || (raw.input ?? raw.costIn) === void 0) continue;
    if ((raw.output ?? raw.costOut) === null || (raw.output ?? raw.costOut) === void 0) continue;
    const input = Number(raw.input ?? raw.costIn);
    const output = Number(raw.output ?? raw.costOut);
    const cacheRead = Number(raw.cacheRead ?? input);
    const cacheWrite = Number(raw.cacheWrite ?? input);
    if (![input, output, cacheRead, cacheWrite].every((value) => Number.isFinite(value) && value >= 0)) continue;
    if (String(raw.currency ?? "USD").toUpperCase() !== "USD") continue;
    normalized2[normalize(id2)] = {
      input,
      output,
      cacheRead,
      cacheWrite,
      currency: String(raw.currency ?? "USD").toUpperCase()
    };
  }
  return normalized2;
}
function pricingFor(model, pricing, provider = "") {
  const normalizedPricing = normalizePricing(pricing);
  const providerOverride = provider === "" ? void 0 : normalizedPricing[normalize(`${provider}/${model.id}`)];
  const override = providerOverride ?? normalizedPricing[normalize(model.id)];
  if (override) return override;
  if (!Number.isFinite(Number(model.costIn)) || !Number.isFinite(Number(model.costOut)) || model.costIn === null || model.costIn === void 0 || model.costOut === null || model.costOut === void 0) return null;
  return {
    input: Number(model.costIn),
    output: Number(model.costOut),
    cacheRead: Number(model.cacheRead ?? model.costIn),
    cacheWrite: Number(model.cacheWrite ?? model.costIn),
    currency: "USD"
  };
}
function normalizedCacheRatios(cacheReadRatio = 0, cacheWriteRatio = 0) {
  const read = Number.isFinite(Number(cacheReadRatio)) ? clamp(Number(cacheReadRatio)) : 0;
  const write = Number.isFinite(Number(cacheWriteRatio)) ? Math.min(clamp(Number(cacheWriteRatio)), 1 - read) : 0;
  return { read, write };
}
function effectivePricing(pricing, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const { read, write } = normalizedCacheRatios(cacheReadRatio, cacheWriteRatio);
  return {
    input: (1 - read - write) * Number(pricing.input) + read * Number(pricing.cacheRead) + write * Number(pricing.cacheWrite),
    output: Number(pricing.output)
  };
}
function costScore(pricing, maxCost, cacheReadRatio = 0, cacheWriteRatio = 0) {
  if (pricing === null) return 0;
  const effective = effectivePricing(pricing, cacheReadRatio, cacheWriteRatio);
  const mean = (effective.input + effective.output) / 2;
  if (maxCost <= 0) return mean === 0 ? 1 : 0;
  return clamp(1 - mean / maxCost);
}
function estimateCost(model, text2, outputTokens = 900, pricingOverrides = {}, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const pricing = pricingFor(model, pricingOverrides);
  if (pricing === null) return null;
  const inputTokens = Math.max(80, Math.ceil(String(text2 ?? "").length / 3.7));
  const ratios = normalizedCacheRatios(cacheReadRatio, cacheWriteRatio);
  const cacheReadTokens = Math.min(inputTokens, Math.max(0, Math.round(inputTokens * ratios.read)));
  const cacheWriteTokens = Math.min(inputTokens - cacheReadTokens, Math.max(0, Math.round(inputTokens * ratios.write)));
  const billableInputTokens = inputTokens - cacheReadTokens - cacheWriteTokens;
  return (billableInputTokens * pricing.input + cacheReadTokens * pricing.cacheRead + cacheWriteTokens * pricing.cacheWrite + outputTokens * pricing.output) / 1e6;
}
function modelMetadata(name) {
  const key = normalize(name);
  if (!key) return null;
  return MODEL_CATALOG.find((model) => model.aliases.some((alias) => key === normalize(alias))) ?? null;
}
function taskTokenBudget(text2, task, complexity, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const inputTokens = Math.max(80, Math.ceil(String(text2 ?? "").length / 3.7));
  const multipliers = {
    analysis: { input: 0.9, output: 0.55 },
    execution: { input: 1.2, output: (task.difficulty ?? complexity) === "complex" ? 1.45 : 1 },
    verification: { input: 1.15, output: 0.7 },
    synthesis: { input: 1.65, output: 1.3 }
  };
  const multiplier = multipliers[task.purpose] ?? { input: 1, output: 1 };
  const effortMultiplier = reasoningEffortMultiplier(task.reasoningEffort);
  const totalInputTokens = Math.max(80, Math.round(inputTokens * multiplier.input));
  const ratios = normalizedCacheRatios(cacheReadRatio, cacheWriteRatio);
  const cacheReadTokens = Math.min(totalInputTokens, Math.max(0, Math.round(totalInputTokens * ratios.read)));
  const cacheWriteTokens = Math.min(totalInputTokens - cacheReadTokens, Math.max(0, Math.round(totalInputTokens * ratios.write)));
  return {
    inputTokens: totalInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: Math.max(220, Math.round(900 * multiplier.output * effortMultiplier.output))
  };
}
function taskQualityFloor(band, task) {
  const difficulty = task.difficulty ?? band;
  const base = QUALITY_FLOORS[difficulty] ?? QUALITY_FLOORS.balanced;
  if (task.purpose === "synthesis") return Math.max(base, band === "complex" ? 0.84 : base);
  if (difficulty !== "complex") return base;
  return clamp(base + Math.max(0, Number(task.criticality ?? 0.75) - 0.65) * 0.12);
}
var MAX_EXPLICIT_EXECUTION_PACKAGES = 6;
var REQUIREMENT_ACTION = /(?:实现|新增|添加|修复|更新|构建|设计|完成|编写|优化|接入|支持|配置|部署|测试|验证|检查|整理|创建|移除|替换|迁移|适配|开发|调研|安装|下载|上传|发布|生成|集成|改造|封装|显示|提供|允许|确保|处理|解决|分析|探测|检测|选择|分配|拆分|对接|加入|保留|记录|输出|审查|核对|对比|提取|摘要|总结|分类|翻译|格式化|润色|可以|能够|需要|进行|implement|add|fix|update|build|design|write|improve|support|configure|deploy|test|verify|check|create|remove|replace|migrate|install|publish|generate|integrate|review|extract|summarize|classify|translate|format|should|must|need)/i;
var HIGH_STAKES_WORK = /架构|安全|隐私|权限|并发|事务|迁移|生产|部署|发布|证明|定理|科研|论文|复杂|多步骤|跨系统|系统设计|architecture|security|migration|production|proof|theorem|research/i;
var SIMPLE_WORK = /翻译|摘要|总结|提取|分类|格式化|列出|改写|润色|拼写|校对|translate|summarize|extract|classify|format|proofread/i;
var HIGH_STAKES_ACTION = /设计|实现|修复|审计|测试|验证|证明|推导|部署|迁移|规划|研究|解决|推理|design|implement|fix|audit|verify|prove|derive|deploy|migrate|research|solve/i;
var SIMPLE_REQUEST_START = /^(?:请|帮我)?(?:翻译|摘要|总结|提取|分类|格式化|列出|改写|润色|拼写|校对|translate|summarize|extract|classify|format|proofread)/i;
function isSimpleRequirement(value) {
  const item = String(value ?? "").trim();
  return SIMPLE_REQUEST_START.test(item) && !/(?:并|然后|最后|同时|以及|and then).{0,20}(?:设计|实现|验证|部署|证明|审计|测试|design|implement|verify|deploy|prove|audit|test)/i.test(item);
}
function isHardRequirement(value) {
  const item = String(value ?? "").trim();
  if (isSimpleRequirement(item)) return false;
  return HIGH_STAKES_WORK.test(item) && HIGH_STAKES_ACTION.test(item);
}
function requirementDifficulty(objective, type, fallback = "balanced") {
  const value = String(objective ?? "").trim();
  if (isHardRequirement(value)) return "complex";
  if (value.length <= 180 && SIMPLE_WORK.test(value)) return "simple";
  const assessed = assessComplexity(value);
  if (type === "math" && /证明|推导|proof|derive/i.test(value)) return "complex";
  if (assessed.band === "simple" && (type === "code" || type === "research")) return "balanced";
  return assessed.band === "simple" ? "simple" : assessed.band === "complex" ? "complex" : fallback;
}
function shouldSplitRequirements(requirements) {
  if (requirements.length >= 3) return true;
  if (requirements.length !== 2) return false;
  const types = requirements.map((item) => detectTaskTypes(item)[0] ?? "general");
  return types[0] !== types[1] || /^(?:最后|然后|接着|随后|再|基于|根据|测试|验证|部署|发布)|(?:完成|结束|实现)后/u.test(requirements[1]);
}
function requirementText(value) {
  return String(value ?? "").trim().replace(/[。；;\s]+$/u, "").trim();
}
function looksLikeRequirement(value) {
  const item = requirementText(value);
  return item.length >= 3 && !/[:：]$/u.test(item) && !/(?:以下|下列|如下)(?:的)?(?:任务|需求|工作|事项|要求)/u.test(item) && REQUIREMENT_ACTION.test(item.slice(0, 32));
}
function explicitRequirements(text2) {
  const visibleLines = [];
  let fence = null;
  for (const line of String(text2 ?? "").split(/\r?\n/u)) {
    const marker2 = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (marker2 && marker2[1][0] === fence.char && marker2[1].length >= fence.length && !line.slice(marker2[0].length).trim()) fence = null;
      continue;
    }
    if (marker2) {
      fence = { char: marker2[1][0], length: marker2[1].length };
      continue;
    }
    visibleLines.push(line);
  }
  const value = visibleLines.join("\n");
  const lines = visibleLines.map((line) => line.trim()).filter(Boolean);
  if (/^(?:请|帮我)?(?:总结|概括|翻译|摘要|解释)(?:以下|下列|下面|这份|这些)/u.test(lines[0] ?? "") && !/(?:执行|完成|实施|分配)/u.test(lines[0])) return [];
  const marker = /^(?:[-*•]\s+|\d{1,2}[.)、](?!\d)\s*|[一二三四五六七八九十]{1,3}[、.)]\s*)(.+)$/u;
  const marked = lines.map((line) => marker.exec(line)?.[1]).filter(Boolean).map(requirementText).filter(looksLikeRequirement);
  if (marked.length >= 2) return marked;
  const plain = lines.filter((line) => !/^#{1,6}\s|^```|[:：]$/u.test(line));
  if (plain.length >= 2 && plain.every(looksLikeRequirement)) {
    return plain.map(requirementText).filter((item) => item.length >= 3);
  }
  const clauses = value.split(/[;；，,]/u).map(requirementText).filter(Boolean);
  if (clauses.length >= 2 && clauses.every(looksLikeRequirement)) {
    return clauses;
  }
  const sentences = value.split(/[。！？]/u).map(requirementText).filter(Boolean);
  if (sentences.length >= 2 && sentences.every(looksLikeRequirement)) {
    return sentences;
  }
  return [];
}
function taskPackages(taskType, text2, band) {
  if (band !== "complex") {
    const task = { id: "execution", name: "\u76F4\u63A5\u56DE\u7B54\u4E0E\u5FC5\u8981\u6821\u9A8C", type: taskType, purpose: "execution", difficulty: band, criticality: 0.65, dependsOn: [], preferredReasoningEffort: band === "simple" ? "low" : "medium" };
    return [{ ...task, qualityFloor: taskQualityFloor(band, task) }];
  }
  const value = String(text2 ?? "");
  const packages = [
    { id: "analysis", name: "\u95EE\u9898\u5EFA\u6A21\u4E0E\u7EA6\u675F\u63D0\u53D6", type: "reasoning", purpose: "analysis", difficulty: "balanced", criticality: 0.8, dependsOn: [], preferredReasoningEffort: "medium" }
  ];
  const requirements = explicitRequirements(text2);
  if (requirements.length >= 2) {
    const groups = requirements.length > MAX_EXPLICIT_EXECUTION_PACKAGES ? [
      ...requirements.slice(0, MAX_EXPLICIT_EXECUTION_PACKAGES - 1).map((item) => [item]),
      requirements.slice(MAX_EXPLICIT_EXECUTION_PACKAGES - 1)
    ] : requirements.map((item) => [item]);
    groups.forEach((group, index) => {
      const objective = group.length === 1 ? group[0] : group.map((item, offset) => `${MAX_EXPLICIT_EXECUTION_PACKAGES + offset}. ${item}`).join("\n");
      const type = detectTaskTypes(objective)[0] ?? "general";
      const difficulty = group.length > 1 ? "complex" : requirementDifficulty(objective, type);
      const previous = packages.at(-1);
      const sequential = /^(?:最后|然后|接着|随后|再|基于|根据|测试|验证|部署|发布)|(?:完成|结束|实现)后/u.test(objective);
      packages.push({
        id: `execution-${index + 1}`,
        name: group.length === 1 ? `\u9700\u6C42 ${index + 1}\uFF1A${group[0].slice(0, 28)}` : `\u9700\u6C42 ${index + 1}\uFF1A\u5176\u4F59 ${group.length} \u9879`,
        objective,
        type,
        purpose: "execution",
        difficulty,
        criticality: difficulty === "simple" ? 0.55 : difficulty === "balanced" ? 0.72 : 0.86,
        dependsOn: sequential && previous?.purpose === "execution" ? ["analysis", previous.id] : ["analysis"],
        preferredReasoningEffort: difficulty === "simple" ? "low" : difficulty === "balanced" ? "medium" : "high"
      });
    });
  } else {
    const domains = [...new Set([...detectTaskTypes(text2), taskType].filter((type) => type !== "general"))];
    for (const type of domains.length > 0 ? domains : [taskType]) {
      const objective = value.split(/[，,。；;]|最后|然后|接着|并且/u).map((item) => item.trim()).filter((item) => detectTaskTypes(item).includes(type)).join("\uFF1B") || value;
      const difficulty = requirementDifficulty(objective, type);
      packages.push({
        id: `execution-${type}`,
        name: `${TASK_TYPE_LABELS[type] ?? type}\u65B9\u5411\u5904\u7406`,
        objective,
        type,
        purpose: "execution",
        difficulty,
        criticality: difficulty === "simple" ? 0.55 : difficulty === "balanced" ? 0.72 : 0.86,
        dependsOn: ["analysis"],
        preferredReasoningEffort: difficulty === "simple" ? "low" : difficulty === "balanced" ? "medium" : "high"
      });
    }
  }
  if (/(测试|验证|评估|对比|benchmark|test|verify|audit)/i.test(value)) {
    packages.push({
      id: "verification",
      name: "\u9A8C\u8BC1\u3001\u53CD\u4F8B\u4E0E\u98CE\u9669\u5BA1\u67E5",
      type: "reasoning",
      purpose: "verification",
      difficulty: "complex",
      criticality: 0.88,
      dependsOn: packages.filter((task) => task.purpose === "execution").map((task) => task.id),
      preferredReasoningEffort: "high"
    });
  }
  packages.push({
    id: "synthesis",
    name: "\u7ED3\u679C\u6821\u9A8C\u4E0E\u6574\u5408",
    type: "reasoning",
    purpose: "synthesis",
    difficulty: "complex",
    criticality: 1,
    dependsOn: packages.filter((task) => task.purpose !== "analysis").map((task) => task.id),
    preferredReasoningEffort: "xhigh"
  });
  return packages.map((task) => ({ ...task, qualityFloor: taskQualityFloor(band, task) }));
}
var SYNTHESIS_WEIGHTS = Object.freeze({ quality: 0.58, cost: 0.08, latency: 0.04, specialty: 0.08, reasoning: 0.16, risk: 0.06 });
var ROUTING_BEAM_WIDTH = 256;
var ROUTING_CANDIDATE_LIMIT = 12;
function weightsForTask(weights, task) {
  return task.purpose === "synthesis" ? SYNTHESIS_WEIGHTS : OBJECTIVE_WEIGHTS[task.difficulty] ?? weights;
}
function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareRowsStable(left, right) {
  return compareText(routeKey(left.provider, left.model), routeKey(right.provider, right.model));
}
function reasoningEffortRank(effort) {
  const normalized2 = String(effort ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = { none: "off", disabled: "off", extra: "xhigh", extrahigh: "xhigh", maximum: "max" };
  const canonical = aliases[normalized2] ?? normalized2;
  const index = REASONING_EFFORT_ORDER.indexOf(canonical);
  return index < 0 ? REASONING_EFFORT_ORDER.indexOf("medium") : index;
}
function reasoningEffortMultiplier(effort) {
  const normalized2 = String(effort ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = { none: "off", disabled: "off", extra: "xhigh", extrahigh: "xhigh", maximum: "max" };
  return REASONING_EFFORT_MULTIPLIERS[aliases[normalized2] ?? normalized2] ?? REASONING_EFFORT_MULTIPLIERS.medium;
}
function selectReasoningEffort(efforts, preferred = "medium") {
  const exact = Array.isArray(efforts) ? [...new Set(efforts.map((effort) => String(effort?.id ?? effort ?? "")).filter(Boolean))] : [];
  if (exact.length === 0) return void 0;
  const preferredRank = reasoningEffortRank(preferred);
  return exact.slice().sort((left, right) => {
    const distance = Math.abs(reasoningEffortRank(left) - preferredRank) - Math.abs(reasoningEffortRank(right) - preferredRank);
    if (distance !== 0) return distance;
    return reasoningEffortRank(left) - reasoningEffortRank(right) || compareText(left, right);
  })[0];
}
function reasoningDecision(row, task) {
  const preferred = String(task.preferredReasoningEffort ?? "medium");
  const efforts = Array.isArray(row.reasoningEfforts) ? row.reasoningEfforts : [];
  if (efforts.length === 0) {
    const knownUnsupported = row.reasoningKnown === true;
    const preferredRank2 = reasoningEffortRank(preferred);
    return {
      reasoningEffort: void 0,
      reasoningFit: knownUnsupported ? clamp(0.78 - preferredRank2 * 0.08) : 0.55,
      preferredReasoningEffort: preferred,
      multiplier: REASONING_EFFORT_MULTIPLIERS.medium
    };
  }
  const preferredRank = reasoningEffortRank(preferred);
  const chosen = selectReasoningEffort(efforts, preferred);
  const distance = Math.abs(reasoningEffortRank(chosen) - preferredRank);
  return {
    reasoningEffort: chosen,
    reasoningFit: clamp(1 - distance / (REASONING_EFFORT_ORDER.length - 1)),
    preferredReasoningEffort: preferred,
    multiplier: reasoningEffortMultiplier(chosen)
  };
}
function candidateUtility(row, task, weights, maxCost, usedRoutes, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const quality = qualityForTask(row, task.type);
  const floor = Number(task.qualityFloor ?? taskQualityFloor("complex", task));
  const qualityGap = Math.max(0, floor - quality);
  const duplicatePenalty = 0;
  const synthesisPreference = task.purpose === "synthesis" && /deepseek[- ]?v4[- ]?pro/i.test(row.model) ? 0.025 : 0;
  const reasoning = reasoningDecision(row, task);
  const cost = clamp(costScore(row.pricing, maxCost, cacheReadRatio, cacheWriteRatio) / Math.sqrt(reasoning.multiplier.output));
  const score = weights.quality * quality + weights.cost * cost + weights.latency * (1 - clamp(row.latency * reasoning.multiplier.latency)) + weights.specialty * specialtyForTask(row, task.type) + (weights.reasoning ?? 0) * reasoning.reasoningFit - weights.risk * row.risk - duplicatePenalty - qualityGap * (task.criticality ?? 0.75) + synthesisPreference;
  return { score, floor, qualityGap, ...reasoning };
}
function taskCost(row, task, text2, complexity, cacheReadRatio = 0, cacheWriteRatio = 0) {
  if (row?.pricing === null) return 0;
  const decision = row === null ? null : reasoningDecision(row, task);
  const tokens = taskTokenBudget(text2, { ...task, reasoningEffort: decision?.reasoningEffort }, complexity, cacheReadRatio, cacheWriteRatio);
  return row === null ? 0 : ((tokens.inputTokens - tokens.cacheReadTokens - tokens.cacheWriteTokens) * row.pricing.input + tokens.cacheReadTokens * row.pricing.cacheRead + tokens.cacheWriteTokens * row.pricing.cacheWrite + tokens.outputTokens * row.pricing.output) / 1e6;
}
function dominates(left, right, task, text2, complexity, cacheReadRatio, cacheWriteRatio) {
  if (left.pricing === null || right.pricing === null) return false;
  const leftReasoning = reasoningDecision(left, task);
  const rightReasoning = reasoningDecision(right, task);
  const leftValues = {
    quality: qualityForTask(left, task.type),
    cost: taskCost(left, task, text2, complexity, cacheReadRatio, cacheWriteRatio),
    latency: clamp(left.latency * leftReasoning.multiplier.latency),
    specialty: specialtyForTask(left, task.type),
    reasoning: leftReasoning.reasoningFit,
    risk: clamp(left.risk)
  };
  const rightValues = {
    quality: qualityForTask(right, task.type),
    cost: taskCost(right, task, text2, complexity, cacheReadRatio, cacheWriteRatio),
    latency: clamp(right.latency * rightReasoning.multiplier.latency),
    specialty: specialtyForTask(right, task.type),
    reasoning: rightReasoning.reasoningFit,
    risk: clamp(right.risk)
  };
  const noWorse = leftValues.quality >= rightValues.quality && leftValues.cost <= rightValues.cost && leftValues.latency <= rightValues.latency && leftValues.specialty >= rightValues.specialty && leftValues.reasoning >= rightValues.reasoning && leftValues.risk <= rightValues.risk;
  const strictlyBetter = leftValues.quality > rightValues.quality || leftValues.cost < rightValues.cost || leftValues.latency < rightValues.latency || leftValues.specialty > rightValues.specialty || leftValues.reasoning > rightValues.reasoning || leftValues.risk < rightValues.risk;
  return noWorse && strictlyBetter;
}
function candidatePool(rows, task, weights, maxCost, text2, complexity, cacheReadRatio, cacheWriteRatio) {
  const eligibleRows = task.type === "vision" ? rows.filter((row) => row.inputModalities.length === 0 || row.inputModalities.includes("image")) : rows;
  const floor = Number(task.qualityFloor ?? 0);
  const feasible = eligibleRows.filter((row) => qualityForTask(row, task.type) >= floor);
  const source = feasible.length > 0 ? feasible : eligibleRows.slice().sort((left, right) => qualityForTask(right, task.type) - qualityForTask(left, task.type) || compareRowsStable(left, right)).slice(0, 3);
  const taskWeights = weightsForTask(weights, task);
  const scored = source.map((row) => ({
    row,
    decision: candidateUtility(row, task, taskWeights, maxCost, /* @__PURE__ */ new Set(), cacheReadRatio, cacheWriteRatio),
    cost: taskCost(row, task, text2, complexity, cacheReadRatio, cacheWriteRatio)
  }));
  const frontier = scored.filter((item) => !source.some((other) => other !== item.row && dominates(other, item.row, task, text2, complexity, cacheReadRatio, cacheWriteRatio)));
  const essential = [
    scored.slice().sort((left, right) => left.cost - right.cost || compareRowsStable(left.row, right.row))[0],
    scored.slice().sort((left, right) => right.decision.score - left.decision.score || compareRowsStable(left.row, right.row))[0],
    scored.slice().sort((left, right) => qualityForTask(right.row, task.type) - qualityForTask(left.row, task.type) || compareRowsStable(left.row, right.row))[0]
  ].filter(Boolean);
  const ordered = [...frontier, ...essential].filter((item, index, all) => all.findIndex((candidate) => candidate.row === item.row) === index).sort((left, right) => right.decision.score - left.decision.score || left.cost - right.cost || compareRowsStable(left.row, right.row)).slice(0, ROUTING_CANDIDATE_LIMIT);
  return {
    options: ordered,
    relaxed: feasible.length === 0,
    pruned: Math.max(0, eligibleRows.length - ordered.length)
  };
}
function stateSignature(state) {
  return state.assignments.map((assignment) => `${routeKey(assignment.row?.provider, assignment.row?.model)}@${assignment.decision?.reasoningEffort ?? "provider-default"}`).join("|");
}
function compareUtilityStates(left, right) {
  return left.relaxedCount - right.relaxedCount || left.qualityShortfall - right.qualityShortfall || right.score - left.score || left.cost - right.cost || left.switches - right.switches || compareText(stateSignature(left), stateSignature(right));
}
function compareCostStates(left, right) {
  return left.relaxedCount - right.relaxedCount || left.qualityShortfall - right.qualityShortfall || left.cost - right.cost || right.score - left.score || left.switches - right.switches || compareText(stateSignature(left), stateSignature(right));
}
function solveAssignments({ rows, tasks, weights, maxCost, text: text2, complexity, budget, cacheReadRatio, cacheWriteRatio, minimizeCost = false }) {
  const pools = tasks.map((task) => candidatePool(rows, task, weights, maxCost, text2, complexity, cacheReadRatio, cacheWriteRatio));
  if (pools.some((pool) => pool.options.length === 0)) return null;
  const suffixMinimum = Array(tasks.length + 1).fill(0);
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    const costOptions = Number.isFinite(budget) ? pools[index].options.filter((option) => option.row.pricing !== null) : pools[index].options;
    if (costOptions.length === 0) return null;
    suffixMinimum[index] = suffixMinimum[index + 1] + Math.min(...costOptions.map((option) => option.cost));
  }
  if (Number.isFinite(budget) && suffixMinimum[0] > budget + 1e-12) return null;
  let states = [{ assignments: [], routesByTask: /* @__PURE__ */ new Map(), usedRoutes: /* @__PURE__ */ new Set(), score: 0, cost: 0, switches: 0, relaxedCount: 0, qualityShortfall: 0 }];
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const pool = pools[index];
    const expanded = [];
    for (const state of states) {
      for (const option of pool.options) {
        if (Number.isFinite(budget) && option.row.pricing === null) continue;
        const nextCost = state.cost + option.cost;
        if (Number.isFinite(budget) && nextCost + suffixMinimum[index + 1] > budget + 1e-12) continue;
        const taskWeights = weightsForTask(weights, task);
        const decision = candidateUtility(option.row, task, taskWeights, maxCost, state.usedRoutes, cacheReadRatio, cacheWriteRatio);
        const route = routeKey(option.row.provider, option.row.model);
        const dependencySwitches = (task.dependsOn ?? []).reduce((count, dependency) => {
          const dependencyRoute = state.routesByTask.get(dependency);
          return count + (dependencyRoute !== void 0 && dependencyRoute !== route ? 1 : 0);
        }, 0);
        const handoffPenalty = dependencySwitches * 0.015;
        const qualityShortfall = Math.max(0, decision.floor - qualityForTask(option.row, task.type));
        const usedRoutes = new Set(state.usedRoutes);
        usedRoutes.add(route);
        const routesByTask = new Map(state.routesByTask);
        routesByTask.set(task.id, route);
        expanded.push({
          assignments: [...state.assignments, { task, row: option.row, decision: { ...decision, relaxed: qualityShortfall > 0 }, estimatedCost: option.cost, handoffPenalty }],
          routesByTask,
          usedRoutes,
          score: state.score + decision.score - handoffPenalty,
          cost: nextCost,
          switches: state.switches + dependencySwitches,
          relaxedCount: state.relaxedCount + (qualityShortfall > 0 ? 1 : 0),
          qualityShortfall: state.qualityShortfall + qualityShortfall
        });
      }
    }
    if (expanded.length === 0) return null;
    expanded.sort(minimizeCost ? compareCostStates : compareUtilityStates);
    states = expanded.slice(0, ROUTING_BEAM_WIDTH);
  }
  states.sort(minimizeCost ? compareCostStates : compareUtilityStates);
  return {
    ...states[0],
    candidatePools: pools,
    minimumFeasibleCost: suffixMinimum[0]
  };
}
function buildPlan({ text: text2 = "", available = [], mode = "collective", pricing = {}, liveBench = null, liveBenchError = "", budgetUsd = 0, cacheReadRatio = 0, cacheWriteRatio = 0 } = {}) {
  const firstLine = String(text2 ?? "").split(/\r?\n/u)[0].trim();
  const transformOnly = /^(?:请|帮我)?(?:总结|概括|翻译|摘要|解释)(?:以下|下列|下面|这份|这些)/u.test(firstLine) && !/(?:执行|完成|实施|分配)/u.test(firstLine);
  const assessed = assessComplexity(transformOnly ? firstLine : text2);
  const requirements = explicitRequirements(text2);
  const compound = shouldSplitRequirements(requirements);
  const complexity = compound && assessed.band !== "complex" ? { value: Math.max(0.66, assessed.value), band: "complex" } : assessed;
  const taskType = classifyTask(transformOnly ? firstLine : text2);
  const weights = OBJECTIVE_WEIGHTS[complexity.band];
  const discovered = Array.isArray(available) ? available.map((entry) => {
    const rawEfforts = Array.isArray(entry.reasoningEfforts) ? entry.reasoningEfforts : [];
    const reasoningEfforts = rawEfforts.map((effort) => String(effort?.id ?? effort ?? "")).filter(Boolean);
    return {
      provider: String(entry.provider ?? ""),
      model: String(entry.model ?? ""),
      reasoningEfforts: [...new Set(reasoningEfforts)],
      defaultReasoningEffort: entry.defaultReasoningEffort === void 0 ? void 0 : String(entry.defaultReasoningEffort),
      reasoningKnown: entry.reasoningKnown === true || entry.reasoningKnown === void 0 && Array.isArray(entry.reasoningEfforts),
      quality: asScore(entry.quality),
      qualitySource: entry.qualitySource === "user" ? "user" : "route",
      latency: asScore(entry.latency),
      risk: asScore(entry.risk),
      specialties: Array.isArray(entry.specialties) ? entry.specialties.filter((item) => typeof item === "string") : null,
      pricing: normalizePricing({ route: entry.pricing ?? entry.price }).route ?? null,
      pricingSource: entry.pricingSource === "user" ? "user" : "route",
      inputModalities: Array.isArray(entry.inputModalities) ? entry.inputModalities.map((item) => String(item).toLowerCase()) : []
    };
  }) : [];
  const rows = [];
  const normalizedPrices = normalizePricing(pricing);
  for (const route of discovered) {
    if (!route.provider || !route.model) continue;
    const catalog = modelMetadata(route.model);
    const metadata = {
      ...catalog ?? { id: route.model, aliases: [route.model], specialties: [] },
      ...route.quality === void 0 ? {} : { quality: route.quality },
      ...route.latency === void 0 ? {} : { latency: route.latency },
      ...route.risk === void 0 ? {} : { risk: route.risk },
      ...route.specialties === null ? {} : { specialties: route.specialties }
    };
    const live = liveBenchRow(liveBench, route.model);
    const liveScores = live?.scores ?? {};
    const liveOverall = asScore(live?.overall);
    const quality = asScore(liveScores?.[taskType]) ?? liveOverall ?? asScore(metadata.quality) ?? 0;
    const qualitySource = liveOverall !== void 0 || asScore(liveScores?.[taskType]) !== void 0 ? "livebench" : route.quality !== void 0 ? route.qualitySource : catalog ? "catalog-heuristic" : "unknown";
    const userPrice = normalizedPrices[normalize(`${route.provider}/${route.model}`)] ?? normalizedPrices[normalize(route.model)];
    const pricingRow = userPrice ?? route.pricing ?? null;
    const pricingSource = userPrice ? "user" : route.pricing ? route.pricingSource : "unknown";
    const specialty = specialtyMatch(metadata, taskType, liveScores);
    rows.push({
      provider: route.provider,
      model: route.model,
      metadata,
      quality,
      qualitySource,
      pricingSource,
      liveScores,
      liveOverall,
      latency: metadata.latency ?? 0.5,
      risk: metadata.risk ?? 0.2,
      specialty,
      reasoningEfforts: route.reasoningEfforts,
      defaultReasoningEffort: route.defaultReasoningEffort,
      reasoningKnown: route.reasoningKnown,
      inputModalities: route.inputModalities,
      pricing: pricingRow,
      score: 0,
      estimatedCost: pricingRow === null ? null : estimateCost({
        id: route.model,
        costIn: pricingRow.input,
        costOut: pricingRow.output,
        cacheRead: pricingRow.cacheRead,
        cacheWrite: pricingRow.cacheWrite
      }, text2, 900, {}, cacheReadRatio, cacheWriteRatio)
    });
  }
  const maxCost = Math.max(1, ...rows.filter((row) => row.pricing !== null).map((row) => {
    const effective = effectivePricing(row.pricing, cacheReadRatio, cacheWriteRatio);
    return effective.input + effective.output;
  }));
  const taskNodes = taskPackages(taskType, text2, complexity.band);
  const unassignableTasks = taskNodes.filter((task) => task.type === "vision" && !rows.some((row) => row.inputModalities.length === 0 || row.inputModalities.includes("image"))).map((task) => task.id);
  const budget = Number(budgetUsd);
  const utilityPlan = solveAssignments({
    rows,
    tasks: taskNodes,
    weights,
    maxCost,
    text: text2,
    complexity: complexity.band,
    budget: Number.POSITIVE_INFINITY,
    cacheReadRatio,
    cacheWriteRatio
  });
  const budgetPlan = budget > 0 ? solveAssignments({
    rows,
    tasks: taskNodes,
    weights,
    maxCost,
    text: text2,
    complexity: complexity.band,
    budget,
    cacheReadRatio,
    cacheWriteRatio
  }) : null;
  const minimumCostPlan = budget > 0 && budgetPlan === null ? solveAssignments({
    rows,
    tasks: taskNodes,
    weights,
    maxCost,
    text: text2,
    complexity: complexity.band,
    budget: Number.POSITIVE_INFINITY,
    cacheReadRatio,
    cacheWriteRatio,
    minimizeCost: true
  }) : null;
  const optimized = budget > 0 ? budgetPlan ?? minimumCostPlan ?? utilityPlan : utilityPlan;
  const assignments = optimized?.assignments ?? [];
  const usedRoutes = optimized?.usedRoutes ?? /* @__PURE__ */ new Set();
  const constraintRelaxed = (optimized?.relaxedCount ?? 0) > 0;
  for (const row of rows) {
    row.score = candidateUtility(row, taskNodes[0] ?? { type: taskType, qualityFloor: QUALITY_FLOORS[complexity.band] }, weights, maxCost, /* @__PURE__ */ new Set(), cacheReadRatio, cacheWriteRatio).score;
  }
  rows.sort((left, right) => right.score - left.score || compareRowsStable(left, right));
  const selectedAssignment = assignments[0];
  const selected = selectedAssignment?.row ?? (unassignableTasks.length > 0 ? null : rows[0] ?? null);
  const synthesizerAssignment = assignments.at(-1);
  const synthesizer = synthesizerAssignment?.row ?? (unassignableTasks.length > 0 ? null : rows.find((row) => /deepseek/i.test(row.model)) ?? rows[0]);
  const subtasks = assignments.map(({ task, row, decision }) => ({
    id: task.id,
    name: task.name,
    ...task.objective ? { objective: task.objective } : {},
    type: task.type,
    difficulty: task.difficulty,
    recommended: row?.model ?? "\u5F85\u53D1\u73B0\u6A21\u578B",
    recommendedProvider: row?.provider ?? "",
    qualitySource: row?.qualitySource ?? "unknown",
    pricingSource: row?.pricingSource ?? "unknown",
    recommendedReasoningEffort: decision?.reasoningEffort,
    preferredReasoningEffort: decision?.preferredReasoningEffort ?? task.preferredReasoningEffort,
    reasoningFit: Number(Number(decision?.reasoningFit ?? 0).toFixed(3)),
    purpose: task.purpose,
    criticality: task.criticality,
    qualityFloor: Number(task.qualityFloor.toFixed(3)),
    dependsOn: [...task.dependsOn ?? []]
  }));
  const costBreakdown = assignments.map(({ task, row, decision, estimatedCost, handoffPenalty }, index) => {
    const tokens = taskTokenBudget(text2, { ...task, reasoningEffort: decision?.reasoningEffort }, complexity.band, cacheReadRatio, cacheWriteRatio);
    const taskEstimate = estimatedCost ?? taskCost(row, task, text2, complexity.band, cacheReadRatio, cacheWriteRatio);
    return {
      stage: index + 1,
      purpose: task.purpose,
      difficulty: task.difficulty,
      model: row?.model ?? "\u5F85\u53D1\u73B0\u6A21\u578B",
      provider: row?.provider ?? "",
      reasoningEffort: decision?.reasoningEffort,
      preferredReasoningEffort: decision?.preferredReasoningEffort,
      reasoningFit: Number(Number(decision?.reasoningFit ?? 0).toFixed(3)),
      reasoningOutputMultiplier: Number(Number(decision?.multiplier?.output ?? 1).toFixed(2)),
      inputTokens: tokens.inputTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      cacheWriteTokens: tokens.cacheWriteTokens,
      outputTokens: tokens.outputTokens,
      estimatedCost: row?.pricing === null || row === null ? null : Number(taskEstimate.toFixed(6)),
      quality: row?.qualitySource === "unknown" || row === null ? null : Number(qualityForTask(row, task.type).toFixed(3)),
      qualitySource: row?.qualitySource ?? "unknown",
      pricingSource: row?.pricingSource ?? "unknown",
      handoffPenalty: Number(Number(handoffPenalty ?? 0).toFixed(3))
    };
  });
  const pricingComplete = assignments.length > 0 && assignments.every(({ row }) => row?.pricing !== null);
  const totalEstimate = pricingComplete ? costBreakdown.reduce((sum, row) => sum + row.estimatedCost, 0) : null;
  const baselineRows = assignments.map(({ task }) => {
    const strongest = rows.reduce((best, row) => qualityForTask(row, task.type) > (best === null ? -1 : qualityForTask(best, task.type)) ? row : best, null);
    return { task, strongest };
  });
  const baselineCost = baselineRows.every((item) => item.strongest?.pricing !== null && item.strongest !== null) ? baselineRows.reduce((sum, { task, strongest }) => sum + taskCost(strongest, task, text2, complexity.band, cacheReadRatio, cacheWriteRatio), 0) : null;
  const qualityEvidenceComplete = assignments.length > 0 && assignments.every(({ row }) => ["livebench", "route", "user"].includes(row?.qualitySource)) && baselineRows.every(({ strongest }) => ["livebench", "route", "user"].includes(strongest?.qualitySource));
  const budgetExceeded = Number(budgetUsd) > 0 && totalEstimate !== null ? totalEstimate > Number(budgetUsd) : null;
  const savings = baselineCost === null || totalEstimate === null || !qualityEvidenceComplete ? null : baselineCost <= 0 ? 0 : clamp((baselineCost - totalEstimate) / baselineCost);
  const paretoPruned = (optimized?.candidatePools ?? []).reduce((sum, pool) => sum + pool.pruned, 0);
  const minimumFeasibleCost = rows.every((row) => row.pricing !== null) ? optimized?.minimumFeasibleCost ?? minimumCostPlan?.cost ?? 0 : null;
  const reason = selected === null ? unassignableTasks.length > 0 ? `\u56FE\u50CF\u5DE5\u4F5C\u5305 ${unassignableTasks.join("\u3001")} \u6CA1\u6709\u53EF\u7528\u7684\u56FE\u50CF\u6A21\u578B\uFF0C\u65E0\u6CD5\u5F62\u6210\u5B8C\u6574\u5206\u914D\u8BA1\u5212\u3002` : "\u5C1A\u672A\u53D1\u73B0\u53EF\u7528\u6A21\u578B\uFF0C\u4FDD\u7559 Harness \u539F\u59CB\u6A21\u578B\u9009\u62E9\u3002" : `${complexity.band === "simple" ? "\u4F4E\u590D\u6742\u5EA6\u4F18\u5148\u6210\u672C\u3001\u54CD\u5E94\u901F\u5EA6\u4E0E\u8F83\u4F4E\u63A8\u7406\u5F00\u9500" : complexity.band === "balanced" ? "\u5728\u8D28\u91CF\u3001\u6210\u672C\u3001\u63A8\u7406\u7B49\u7EA7\u3001\u5EF6\u8FDF\u4E0E\u98CE\u9669\u4E4B\u95F4\u5E73\u8861" : "\u9AD8\u590D\u6742\u5EA6\u6267\u884C\u5305\u542B\u63A8\u7406\u7B49\u7EA7\u7684\u4F9D\u8D56\u611F\u77E5\u5168\u5C40\u7EA6\u675F\u5206\u914D"}\uFF1B\u4EFB\u52A1\u7C7B\u578B\u4E3A ${taskType}\uFF0C\u5DF2\u5BF9 ${String(subtasks.length)} \u4E2A\u5DE5\u4F5C\u5305\u8FDB\u884C Pareto \u526A\u679D\u548C\u6709\u754C\u7EC4\u5408\u641C\u7D22\u3002`;
  return {
    mode,
    complexity: { value: Number(complexity.value.toFixed(3)), band: complexity.band },
    compound,
    unassignableTasks,
    taskType,
    taskTypes: [...new Set(taskNodes.map((task) => task.type).filter((type) => type !== "reasoning"))],
    objectiveWeights: weights,
    candidates: rows.slice(0, 8).map((row) => {
      const decision = candidateUtility(row, taskNodes[0] ?? { type: taskType, qualityFloor: QUALITY_FLOORS[complexity.band], preferredReasoningEffort: complexity.band === "simple" ? "low" : "medium" }, weights, maxCost, /* @__PURE__ */ new Set(), cacheReadRatio, cacheWriteRatio);
      return { provider: row.provider, model: row.model, score: Number(row.score.toFixed(3)), quality: row.qualitySource === "unknown" ? null : Number(row.quality.toFixed(3)), qualitySource: row.qualitySource, specialty: Number(row.specialty.toFixed(3)), reasoningEffort: decision.reasoningEffort, preferredReasoningEffort: decision.preferredReasoningEffort, reasoningFit: Number(decision.reasoningFit.toFixed(3)), reasoningKnown: row.reasoningKnown, reasoningEfforts: row.reasoningEfforts, estimatedCost: row.estimatedCost === null ? null : Number(row.estimatedCost.toFixed(6)), inputPrice: row.pricing?.input ?? null, outputPrice: row.pricing?.output ?? null, pricingSource: row.pricingSource };
    }),
    selected: selected === null ? null : { provider: selected.provider, model: selected.model, reasoningEffort: selectedAssignment?.decision?.reasoningEffort, estimatedCost: selected.estimatedCost === null ? null : Number(selected.estimatedCost.toFixed(6)), qualitySource: selected.qualitySource, pricingSource: selected.pricingSource },
    subtasks,
    synthesizer: synthesizer == null ? null : { provider: synthesizer.provider, model: synthesizer.model, reasoningEffort: synthesizerAssignment?.decision?.reasoningEffort },
    estimatedCost: totalEstimate === null ? null : Number(totalEstimate.toFixed(6)),
    costBreakdown,
    optimization: {
      solver: "pareto-pruned quality-constrained beam assignment",
      qualityFloor: QUALITY_FLOORS[complexity.band],
      budgetUsd: Number(Number(budgetUsd) > 0 ? Number(budgetUsd) : 0),
      cacheReadRatio: normalizedCacheRatios(cacheReadRatio, cacheWriteRatio).read,
      cacheWriteRatio: normalizedCacheRatios(cacheReadRatio, cacheWriteRatio).write,
      budgetExceeded,
      constraintRelaxed,
      pricingComplete,
      qualityEvidenceComplete,
      baselineAllStrongCost: baselineCost === null ? null : Number(baselineCost.toFixed(6)),
      estimatedSavings: savings === null ? null : Number(savings.toFixed(4)),
      distinctRoutes: usedRoutes.size,
      handoffCount: optimized?.switches ?? 0,
      paretoPruned,
      beamWidth: ROUTING_BEAM_WIDTH,
      budgetFeasible: budget <= 0 ? pricingComplete ? true : null : budgetPlan !== null,
      minimumFeasibleCost: minimumFeasibleCost === null ? null : Number(Number(minimumFeasibleCost).toFixed(6)),
      liveBench: liveBench?.fetchedAt ? { source: liveBench.source ?? "livebench", fetchedAt: liveBench.fetchedAt, models: Object.keys(liveBench.models ?? {}).length, stale: String(liveBenchError).length > 0, error: String(liveBenchError || "") } : { source: "experimental-baseline", fetchedAt: null, models: 0, stale: false, error: String(liveBenchError || "") }
    },
    reason,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// .dsh-plugin/shared/harness-plan.mjs
var clean = (value) => typeof value === "string" ? value.trim() : "";
var HEADLESS_TOOL_IDS = /* @__PURE__ */ new Set(["claude-code", "codex", "gemini"]);
function channelForProvider(provider, installedToolIds = [], runnableToolIds = [], route = null) {
  const preference = normalizeExecutionPreference(route?.execution);
  const tool = toolForProvider(provider);
  if (preference === "api") {
    return {
      kind: "harness-llm",
      preference,
      ...tool ? { tool: tool.id, label: tool.label } : {},
      detail: "\u8BE5\u6A21\u578B\u914D\u7F6E\u4E3A\u53EA\u4F7F\u7528\u6A21\u578B\u76EE\u5F55 API\u3002"
    };
  }
  if (!tool || tool.unsupported) {
    return { kind: "harness-llm", preference, detail: "\u901A\u8FC7\u5B98\u65B9\u6A21\u578B\u76EE\u5F55 API \u8C03\u7528\u3002" };
  }
  const installed = Array.isArray(installedToolIds) && installedToolIds.includes(tool.id);
  const runnable = installed && Array.isArray(runnableToolIds) && runnableToolIds.includes(tool.id);
  const headless = installed && HEADLESS_TOOL_IDS.has(tool.id);
  if (runnable || headless) {
    return {
      kind: "official-cli",
      preference,
      tool: tool.id,
      label: tool.label,
      detail: tool.id === "zcode" ? "ZCode \u5DF2\u5B89\u88C5\uFF0C\u63D2\u4EF6\u53EF\u8C03\u7528\u5176\u5B98\u65B9\u7F16\u7A0B\u4EE3\u7406\uFF1B3.14.3 \u7684 CLI \u4F7F\u7528\u81EA\u8EAB\u914D\u7F6E\u7684\u9ED8\u8BA4\u6A21\u578B\uFF0C\u4E0D\u80FD\u4FDD\u8BC1\u4E0E Harness \u5EFA\u8BAE\u6A21\u578B\u4E00\u81F4\u3002" : headless && !runnable ? `${tool.label} \u5DF2\u5B89\u88C5\u3002\u5206\u914D\u5230\u8BE5\u6A21\u578B\u7684\u4EFB\u52A1\u4F1A\u5148\u8D70\u5B98\u65B9\u65E0\u754C\u9762\u547D\u4EE4\uFF1B\u547D\u4EE4\u7F3A\u5931\u6216\u5931\u8D25\u65F6\u56DE\u9000\u6A21\u578B\u76EE\u5F55 API\u3002` : `${tool.label} \u5DF2\u5B89\u88C5\uFF0C\u63D2\u4EF6\u53EF\u6258\u7BA1\u8C03\u7528\u5176\u5B98\u65B9 CLI\uFF1BHarness \u6A21\u578B\u76EE\u5F55\u4E0E\u5382\u5546 CLI \u540D\u79F0\u53EF\u80FD\u4E0D\u540C\uFF0C\u56E2\u961F\u65E0\u6CD5\u786E\u8BA4\u6620\u5C04\u65F6\u4F7F\u7528 CLI \u9ED8\u8BA4\u6A21\u578B\uFF0C\u5B9E\u9645\u6A21\u578B\u4ECD\u987B\u6838\u5BF9\u8FD0\u884C\u8BB0\u5F55\u3002`
    };
  }
  return {
    kind: "harness-llm",
    preference,
    tool: tool.id,
    label: tool.label,
    detail: installed ? `${tool.label} \u5DF2\u5B89\u88C5\uFF0C\u4F46\u5F53\u524D\u5E73\u53F0\u7F3A\u5C11\u7ECF\u6838\u9A8C\u7684\u6258\u7BA1\u6267\u884C\u9002\u914D\u5668\uFF1B\u5B9E\u9645\u8C03\u7528\u4F7F\u7528\u5B98\u65B9\u6A21\u578B\u76EE\u5F55 API\u3002` : `${tool.label} \u672A\u5B89\u88C5\uFF1B\u5B9E\u9645\u8C03\u7528\u4F7F\u7528\u5B98\u65B9\u6A21\u578B\u76EE\u5F55 API\u3002\u53EF\u5728\u5DE5\u4F5C\u53F0\u4E00\u952E\u5B89\u88C5\uFF0C\u6216\u8FD0\u884C /tools install ${tool.id}\u3002`
  };
}
function annotate(channel) {
  return {
    executionChannel: channel.kind,
    ...channel.tool ? { channelTool: channel.tool } : {},
    ...channel.label ? { channelLabel: channel.label } : {},
    ...channel.preference ? { executionPreference: channel.preference } : {},
    channelDetail: channel.detail
  };
}
function createPlanFromRoutes(task, availableRoutes, {
  mode = "single",
  budgetUsd = 0,
  installedToolIds = [],
  runnableToolIds = [],
  pricing = {},
  liveBench = null,
  cacheReadRatio = 0,
  cacheWriteRatio = 0,
  directProvider = "",
  directModel = ""
} = {}) {
  const taskText = clean(task);
  if (!taskText) throw new Error("task must contain text");
  const requestedDirect = mode === "direct" || clean(directProvider) !== "" || clean(directModel) !== "";
  const selectedMode = mode === "team" ? "team" : "single";
  let routes = Array.isArray(availableRoutes) ? availableRoutes : [];
  let directRoute = null;
  if (requestedDirect) {
    const provider = clean(directProvider);
    const model = clean(directModel);
    if (!provider || !model) throw new Error("\u6307\u5B9A\u5355\u4E00\u6A21\u578B\u9700\u8981\u540C\u65F6\u63D0\u4F9B provider \u548C model");
    const match = routes.filter((route) => route.provider === provider && route.model === model);
    if (match.length !== 1) throw new Error(`\u6307\u5B9A\u6A21\u578B ${provider}/${model} \u4E0D\u5728\u5F53\u524D\u6A21\u578B\u76EE\u5F55\u4E2D`);
    routes = match;
    directRoute = { provider, model };
  }
  const installedIds = Array.isArray(installedToolIds) ? installedToolIds.filter(Boolean) : [];
  const channelCache = /* @__PURE__ */ new Map();
  const channelOf = (provider, model) => {
    const route = routes.find((item) => item.provider === provider && item.model === model);
    const key = `${String(provider ?? "")}\0${String(model ?? "")}\0${route?.execution ?? ""}`;
    if (!channelCache.has(key)) channelCache.set(key, channelForProvider(provider, installedIds, runnableToolIds, route));
    return channelCache.get(key);
  };
  const needsImage = detectTaskTypes(taskText).includes("vision");
  const plan = buildPlan({
    text: taskText,
    available: routes,
    mode: directRoute ? "single" : selectedMode,
    budgetUsd: Math.max(0, Number.isFinite(budgetUsd) ? budgetUsd : 0),
    pricing,
    liveBench,
    cacheReadRatio,
    cacheWriteRatio
  });
  const selectedChannel = plan.selected ? channelOf(plan.selected.provider, plan.selected.model) : null;
  return {
    ...plan,
    mode: directRoute ? "direct" : plan.mode,
    routingBypassed: directRoute !== null,
    directRoute,
    ...directRoute ? { reason: `\u5DF2\u6307\u5B9A ${directRoute.provider}/${directRoute.model}\uFF0C\u4E0D\u4E0E\u5176\u4ED6\u5DF2\u914D\u7F6E\u6A21\u578B\u6BD4\u8F83\u3002\u590D\u6742\u5EA6\u4ECD\u6309\u4EFB\u52A1\u6587\u672C\u4F30\u8BA1\u3002` } : {},
    contractVersion: 2,
    availableRoutes: routes,
    ...selectedChannel ? annotate(selectedChannel) : {},
    availabilityNotice: "\u6A21\u578B\u76EE\u5F55\u5217\u51FA\u7684\u8DEF\u7EBF\u5C1A\u672A\u9A8C\u8BC1\u5F53\u524D\u51ED\u636E\u548C\u7F51\u7EDC\uFF1B\u5B9E\u9645\u53EF\u7528\u6027\u4EE5\u5B98\u65B9\u9002\u914D\u5668\u8C03\u7528\u7ED3\u679C\u4E3A\u51C6\u3002",
    pricingNotice: plan.estimatedCost === null ? "\u90E8\u5206\u8DEF\u7EBF\u5C1A\u672A\u914D\u7F6E\u8BE5\u4F9B\u5E94\u5546\u7684\u7F8E\u5143\u8F93\u5165/\u8F93\u51FA\u5355\u4EF7\uFF0C\u65E0\u6CD5\u8BA1\u7B97\u53EF\u9760\u7684\u603B\u8D39\u7528\u4E0E\u8282\u7701\u6BD4\u4F8B\uFF1B\u8BF7\u5728\u6A21\u578B\u4EF7\u683C\u8BBE\u7F6E\u4E2D\u8865\u9F50\u3002" : "\u8D39\u7528\u6309\u5DF2\u63D0\u4F9B\u7684\u7F8E\u5143\u5355\u4EF7\u548C\u4F30\u8BA1 token \u6570\u8BA1\u7B97\uFF0C\u4E0D\u662F\u4F9B\u5E94\u5546\u8D26\u5355\uFF0C\u4E5F\u4E0D\u662F\u786C\u6027\u652F\u51FA\u4E0A\u9650\u3002",
    qualityNotice: plan.optimization.qualityEvidenceComplete ? "\u6A21\u578B\u8D28\u91CF\u4F7F\u7528\u5DF2\u63D0\u4F9B\u8BC4\u5206\u6216\u57FA\u51C6\u6570\u636E\u4F30\u8BA1\uFF0C\u4ECD\u9700\u5B9E\u9645\u4EFB\u52A1\u9A8C\u8BC1\u3002" : "\u90E8\u5206\u6A21\u578B\u8D28\u91CF\u7F3A\u5C11\u53EF\u6838\u9A8C\u8BC4\u5206\uFF1B\u76EE\u5F55\u542F\u53D1\u5F0F\u53EA\u4F9B\u9009\u62E9\u53C2\u8003\uFF0C\u8D28\u91CF\u95E8\u69DB\u548C\u8282\u7701\u6BD4\u4F8B\u65E0\u6CD5\u4FDD\u8BC1\u3002",
    modalityNotice: needsImage ? plan.unassignableTasks.length > 0 ? "\u56FE\u50CF\u5DE5\u4F5C\u5305\u6CA1\u6709\u53EF\u786E\u8BA4\u652F\u6301\u56FE\u50CF\u8F93\u5165\u7684\u8DEF\u7EBF\uFF0C\u5F53\u524D\u8BA1\u5212\u65E0\u6CD5\u5B8C\u6574\u5206\u914D\uFF1B\u8BF7\u5728\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u914D\u7F6E\u652F\u6301\u56FE\u50CF\u7684\u6A21\u578B\u3002" : routes.some((route) => !Array.isArray(route.inputModalities) || route.inputModalities.length === 0) ? "\u56FE\u50CF\u5DE5\u4F5C\u5305\u53EA\u5206\u7ED9\u5DF2\u58F0\u660E\u56FE\u50CF\u80FD\u529B\u6216\u672A\u58F0\u660E\u8F93\u5165\u80FD\u529B\u7684\u6A21\u578B\uFF1B\u672A\u58F0\u660E\u80FD\u529B\u7684\u6A21\u578B\u4ECD\u9700\u5B9E\u9645\u9A8C\u8BC1\u3002\u5176\u4ED6\u6587\u672C\u5DE5\u4F5C\u5305\u53EF\u7EE7\u7EED\u4F7F\u7528\u7ECF\u6D4E\u578B\u6587\u672C\u6A21\u578B\u3002" : "\u56FE\u50CF\u5DE5\u4F5C\u5305\u53EA\u5206\u7ED9\u660E\u786E\u652F\u6301\u56FE\u50CF\u8F93\u5165\u7684\u6A21\u578B\uFF1B\u5176\u4ED6\u6587\u672C\u5DE5\u4F5C\u5305\u53EF\u7EE7\u7EED\u4F7F\u7528\u7ECF\u6D4E\u578B\u6587\u672C\u6A21\u578B\u3002" : null,
    toolNotice: "\u6267\u884C\u6E20\u9053\u6309\u5B98\u65B9\u5DE5\u5177\u6CE8\u518C\u8868\u548C\u5DF2\u6838\u9A8C\u9002\u914D\u5668\u6807\u6CE8\uFF1Aofficial-cli \u8868\u793A\u8BE5\u5382\u5546\u5B98\u65B9 CLI \u5DF2\u5B89\u88C5\u4E14\u53EF\u6258\u7BA1\u6267\u884C\uFF1Bharness-llm \u8868\u793A\u901A\u8FC7\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u8C03\u7528\u3002\u53EF\u5728\u5DE5\u4F5C\u53F0\u67E5\u770B\u5B89\u88C5\u4E0E\u6267\u884C\u652F\u6301\u72B6\u6001\u3002",
    team: {
      requested: selectedMode === "team",
      recommended: selectedMode === "team" && plan.complexity.band === "complex" && plan.subtasks.length > 1,
      handoff: "\u53EF\u5728\u5B98\u65B9\u4F1A\u8BDD\u8C03\u7528 model_router_team_execute \u6258\u7BA1\u6267\u884C\u5F53\u524D\u5E73\u53F0\u652F\u6301\u7684\u5B98\u65B9 CLI \u5DE5\u4F5C\u5305\uFF1B\u5B98\u65B9 Agent Teams \u53EF\u534F\u4F5C\u7BA1\u7406\u4EFB\u52A1\uFF0C\u4F46\u6210\u5458\u6A21\u578B\u7531\u5BBF\u4E3B\u914D\u7F6E\uFF0C\u4E0D\u80FD\u76F4\u63A5\u6309\u672C\u8BA1\u5212\u9010\u4E2A\u5207\u6362\u3002",
      workPackages: plan.subtasks.map((item, index) => ({
        id: item.id,
        name: item.name,
        ...item.objective ? { objective: item.objective } : {},
        type: item.type,
        purpose: item.purpose,
        difficulty: item.difficulty,
        qualitySource: item.qualitySource,
        pricingSource: item.pricingSource,
        dependsOn: item.dependsOn,
        recommendedProvider: item.recommendedProvider,
        recommendedModel: item.recommended,
        estimatedCost: plan.costBreakdown[index]?.estimatedCost ?? null,
        ...item.recommendedReasoningEffort ? { recommendedReasoningEffort: item.recommendedReasoningEffort } : {},
        ...annotate(channelOf(item.recommendedProvider, item.recommended)),
        verificationChecklist: item.purpose === "synthesis" ? ["\u6838\u5BF9\u5404\u5DE5\u4F5C\u5305\u4EA4\u4ED8\u7269\u4E0E\u4F9D\u8D56", "\u8BB0\u5F55\u51B2\u7A81\u3001\u672A\u89E3\u51B3\u4E8B\u9879\u548C\u6700\u7EC8\u9A8C\u6536\u7ED3\u679C"] : item.type === "code" ? ["\u8BF4\u660E\u6539\u52A8\u6587\u4EF6\u4E0E\u63A5\u53E3", "\u8FD0\u884C\u4E0E\u6539\u52A8\u76F8\u5173\u7684\u9A8C\u8BC1\u5E76\u8BB0\u5F55\u7ED3\u679C", "\u5217\u51FA\u5C1A\u672A\u5B8C\u6210\u7684\u8FB9\u754C\u60C5\u51B5"] : item.type === "research" ? ["\u5217\u51FA\u6765\u6E90\u3001\u65E5\u671F\u548C\u53EF\u6838\u5BF9\u7684\u7ED3\u8BBA", "\u6807\u51FA\u63A8\u65AD\u4E0E\u4E0D\u786E\u5B9A\u4E8B\u9879"] : ["\u5217\u51FA\u4EA4\u4ED8\u5185\u5BB9\u548C\u9A8C\u6536\u4F9D\u636E", "\u6807\u51FA\u672A\u5B8C\u6210\u4E8B\u9879"]
      }))
    }
  };
}

// .dsh-plugin/client/catalog.mjs
var clean2 = (value) => typeof value === "string" ? value.trim() : "";
function routesFromModelCatalog(catalog) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  const routable = new Set(Array.isArray(catalog?.routableProviders) ? catalog.routableProviders : []);
  const routes = [];
  const seen = /* @__PURE__ */ new Set();
  for (const group of groups) {
    const provider = clean2(group?.id);
    if (!provider || !routable.has(provider)) continue;
    for (const entry of Array.isArray(group.models) ? group.models : []) {
      const model = clean2(entry?.id);
      if (!model) continue;
      const key = `${provider}\0${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reasoning = entry?.reasoning;
      const efforts = Array.isArray(reasoning?.efforts) ? [...new Set(reasoning.efforts.map((item) => clean2(item?.id ?? item)).filter(Boolean))] : [];
      routes.push({
        provider,
        providerName: clean2(group.name) || provider,
        model,
        name: clean2(entry.name) || model,
        reasoningKnown: reasoning !== void 0 && reasoning !== null,
        reasoningEfforts: efforts,
        ...clean2(reasoning?.defaultEffort) ? { defaultReasoningEffort: clean2(reasoning.defaultEffort) } : {},
        // modelCatalog deliberately omits modalities; unknown means the Host
        // must still validate image capability before a real request.
        inputModalities: []
      });
    }
  }
  routes.sort((left, right) => `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`));
  return routes;
}
function createWorkspacePlan(task, catalog, options = {}) {
  const routes = applyModelProfiles(
    routesFromModelCatalog(catalog),
    parseModelProfilesJson(options.modelProfilesJson ?? "[]")
  );
  return createPlanFromRoutes(task, routes, options);
}

// .dsh-plugin/client/model-profile-editor.jsx
var import_react = __toESM(require("react"), 1);

// .dsh-plugin/client/model-profile-editor-state.mjs
var PROFILE_SPECIALTY_HINT = "code, math, research, summarization, writing, vision, reasoning";
var profileRouteKey = (route) => `${String(route?.provider ?? "")}\0${String(route?.model ?? "")}`;
var field = (value) => String(value ?? "").trim();
function nonnegativeField(value, label, max = 1e6) {
  const raw = field(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`${label} \u5FC5\u987B\u662F 0 \u5230 ${max} \u7684\u6570\u5B57\u3002`);
  return parsed;
}
function profileDraft(profile) {
  return {
    quality: profile?.quality === void 0 ? "" : String(Number((profile.quality * 100).toFixed(4))),
    input: profile?.pricing?.input === void 0 ? "" : String(profile.pricing.input),
    output: profile?.pricing?.output === void 0 ? "" : String(profile.pricing.output),
    cacheRead: profile?.pricing?.cacheRead === void 0 ? "" : String(profile.pricing.cacheRead),
    cacheWrite: profile?.pricing?.cacheWrite === void 0 ? "" : String(profile.pricing.cacheWrite),
    specialties: Array.isArray(profile?.specialties) ? profile.specialties.join(", ") : "",
    cliModel: profile?.cliModel ?? "",
    execution: profile?.execution === "official" || profile?.execution === "api" ? profile.execution : "auto"
  };
}
function profileFromDraft(route, draft) {
  const provider = field(route?.provider);
  const model = field(route?.model);
  if (!provider || !model) throw new Error("\u8BF7\u5148\u4ECE\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u9009\u62E9\u4E00\u6761\u51C6\u786E\u7684\u6A21\u578B\u8DEF\u7EBF\u3002");
  const profile = { provider, model };
  const quality = nonnegativeField(draft?.quality, "\u8D28\u91CF\u8BC4\u5206", 100);
  if (quality !== null) profile.quality = quality;
  const input = nonnegativeField(draft?.input, "\u8F93\u5165\u5355\u4EF7");
  const output = nonnegativeField(draft?.output, "\u8F93\u51FA\u5355\u4EF7");
  const cacheRead = nonnegativeField(draft?.cacheRead, "\u7F13\u5B58\u8BFB\u53D6\u5355\u4EF7");
  const cacheWrite = nonnegativeField(draft?.cacheWrite, "\u7F13\u5B58\u5199\u5165\u5355\u4EF7");
  if (input === null !== (output === null)) throw new Error("\u8F93\u5165\u548C\u8F93\u51FA\u5355\u4EF7\u9700\u8981\u540C\u65F6\u586B\u5199\uFF1B\u7559\u7A7A\u8868\u793A\u4EF7\u683C\u672A\u77E5\u3002");
  if (input === null && (cacheRead !== null || cacheWrite !== null)) throw new Error("\u586B\u5199\u7F13\u5B58\u5355\u4EF7\u524D\uFF0C\u8BF7\u5148\u586B\u5199\u8F93\u5165\u548C\u8F93\u51FA\u5355\u4EF7\u3002");
  if (input !== null) {
    profile.pricing = { input, output, currency: "USD" };
    if (cacheRead !== null) profile.pricing.cacheRead = cacheRead;
    if (cacheWrite !== null) profile.pricing.cacheWrite = cacheWrite;
  }
  const rawSpecialties = field(draft?.specialties);
  if (rawSpecialties) {
    const specialties = [...new Set(rawSpecialties.split(/[,，\s]+/u).filter(Boolean))];
    if (specialties.length > 16 || specialties.some((item) => !/^[a-z][a-z0-9-]{0,39}$/.test(item))) {
      throw new Error("\u64C5\u957F\u65B9\u5411\u6700\u591A 16 \u9879\uFF0C\u7528\u82F1\u6587\u5C0F\u5199\u6807\u7B7E\u5E76\u4EE5\u9017\u53F7\u5206\u9694\uFF0C\u4F8B\u5982 code, research\u3002");
    }
    profile.specialties = specialties;
  }
  const cliModel = field(draft?.cliModel);
  if (cliModel) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(cliModel)) throw new Error("CLI \u6A21\u578B\u540D\u9700\u7531\u5B57\u6BCD\u6570\u5B57\u5F00\u5934\uFF0C\u4E14\u53EA\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u70B9\u3001\u4E0B\u5212\u7EBF\u3001\u5192\u53F7\u3001\u659C\u6760\u6216\u8FDE\u5B57\u7B26\u3002");
    profile.cliModel = cliModel;
  }
  const execution = field(draft?.execution) || "auto";
  if (!["auto", "official", "api"].includes(execution)) throw new Error("\u6267\u884C\u65B9\u5F0F\u53EA\u80FD\u662F\u81EA\u52A8\u3001\u5B98\u65B9\u5DE5\u5177\u6216\u6A21\u578B\u76EE\u5F55 API\u3002");
  if (execution !== "auto") profile.execution = execution;
  return profile;
}
function updateProfileJson(rawJson, route, draft) {
  const profiles = parseModelProfilesJson(rawJson ?? "[]");
  const candidate = draft === null ? null : profileFromDraft(route, draft);
  const selected = profileRouteKey(route);
  const others = profiles.filter((profile) => profileRouteKey(profile) !== selected).map((profile) => ({
    ...profile,
    ...profile.quality === void 0 ? {} : { quality: Number((profile.quality * 100).toFixed(6)) }
  }));
  const next = candidate && Object.keys(candidate).length > 2 ? [...others, candidate] : others;
  const json = JSON.stringify(next, null, 2);
  parseModelProfilesJson(json);
  return json;
}

// .dsh-plugin/client/model-profile-editor.jsx
var messageOf = (error) => typeof error?.message === "string" ? error.message : "\u6A21\u578B\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002";
function ModelProfileEditor({ routes, settingsScope, onSaved }) {
  const [snapshot, setSnapshot] = import_react.default.useState(() => settingsScope.getSnapshot());
  const [selected, setSelected] = import_react.default.useState("");
  const [drafts, setDrafts] = import_react.default.useState({});
  const [saving, setSaving] = import_react.default.useState(false);
  const [notice, setNotice] = import_react.default.useState(null);
  import_react.default.useEffect(() => settingsScope.subscribe(() => setSnapshot(settingsScope.getSnapshot())), [settingsScope]);
  const route = routes.find((item) => profileRouteKey(item) === selected) ?? routes[0];
  const routeKey2 = route ? profileRouteKey(route) : "";
  const rawJson = snapshot.value?.modelProfilesJson ?? "[]";
  let profiles = [];
  let loadError = "";
  try {
    profiles = parseModelProfilesJson(rawJson);
  } catch (error) {
    loadError = messageOf(error);
  }
  const saved = profiles.find((item) => profileRouteKey(item) === routeKey2);
  const pending = drafts[routeKey2];
  const draft = pending?.fields ?? profileDraft(saved);
  const writable = snapshot.status === "ready" && snapshot.writable === true && !saving && !loadError;
  const unmatched = profiles.filter((item) => !routes.some((route2) => profileRouteKey(route2) === profileRouteKey(item))).length;
  const edit = (name, value) => {
    if (!route || !writable) return;
    setDrafts((previous) => {
      const previousEntry = previous[routeKey2] ?? { fields: profileDraft(saved), baseRevision: snapshot.revision };
      return { ...previous, [routeKey2]: { ...previousEntry, fields: { ...previousEntry.fields, [name]: value } } };
    });
    setNotice(null);
  };
  const write = async (remove) => {
    if (!route || !writable) return;
    const revision = pending?.baseRevision ?? snapshot.revision;
    if (revision !== snapshot.revision) {
      setNotice({ tone: "error", text: "\u8BBE\u7F6E\u5DF2\u5728\u5176\u4ED6\u9875\u9762\u66F4\u65B0\u3002\u5F53\u524D\u8F93\u5165\u4ECD\u5728\uFF1B\u8BF7\u6838\u5BF9\u6700\u65B0\u5185\u5BB9\uFF0C\u518D\u9009\u62E9\u201C\u91CD\u65B0\u52A0\u8F7D\u6B64\u8DEF\u7EBF\u201D\u540E\u7F16\u8F91\u3002" });
      return;
    }
    let nextJson;
    try {
      nextJson = updateProfileJson(rawJson, route, remove ? null : draft);
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const accepted = await settingsScope.mutate([{ op: "set", path: ["modelProfilesJson"], value: nextJson }], revision);
      if (!accepted) throw new Error("\u8BBE\u7F6E\u672A\u88AB\u4FDD\u5B58\uFF0C\u53EF\u80FD\u88AB\u5176\u4ED6\u9875\u9762\u4FEE\u6539\u3002\u8F93\u5165\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u540E\u6838\u5BF9\u3002");
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[routeKey2];
        return next;
      });
      setNotice({ tone: "success", text: remove ? "\u5DF2\u5220\u9664\u8BE5\u6A21\u578B\u7684\u81EA\u62A5\u914D\u7F6E\u3002" : "\u8BE5\u6A21\u578B\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF1B\u91CD\u65B0\u751F\u6210\u5EFA\u8BAE\u5373\u53EF\u4F7F\u7528\u3002" });
      onSaved?.();
    } catch (error) {
      setNotice({ tone: "error", text: messageOf(error) });
    } finally {
      setSaving(false);
    }
  };
  const reload = () => {
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[routeKey2];
      return next;
    });
    setNotice(null);
  };
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "mr-card mr-profile-card", "aria-label": "\u9010\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u914D\u7F6E" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("h2", { className: "mr-card-title" }, "\u9010\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B"), /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-card-copy" }, "\u9009\u62E9\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u51C6\u786E\u8DEF\u7EBF\uFF0C\u586B\u5199\u4F60\u638C\u63E1\u7684\u8D28\u91CF\u8BC4\u5206\u4E0E\u5355\u4EF7\u3002\u914D\u7F6E\u7531\u4F60\u63D0\u4F9B\uFF0C\u63D2\u4EF6\u4E0D\u4F1A\u8BFB\u53D6\u8D26\u53F7\u5BC6\u94A5\u3002"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-card-body" }, loadError && /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-error", role: "alert" }, "\u5DF2\u6709\u914D\u7F6E\u65E0\u6CD5\u89E3\u6790\uFF1A", loadError, "\u3002\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u9875\u4FEE\u6B63 JSON\u3002"), snapshot.status !== "ready" && /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-caption" }, "\u8BBE\u7F6E\u72B6\u6001\uFF1A", snapshot.status === "loading" ? "\u6B63\u5728\u52A0\u8F7D" : "\u5F53\u524D\u4E0D\u53EF\u7528"), snapshot.status === "ready" && !snapshot.writable && /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-error", role: "status" }, "\u5F53\u524D\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\uFF0C\u8BF7\u5728\u53EF\u5199\u7684\u672C\u673A\u73AF\u5883\u914D\u7F6E\u3002"), routes.length === 0 ? /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-empty" }, "\u8BF7\u5148\u5728 DeepSeek Harness \u7684\u201C\u6A21\u578B\u201D\u9875\u6DFB\u52A0\u6A21\u578B\uFF0C\u518D\u8FD4\u56DE\u8FD9\u91CC\u586B\u5199\u4EF7\u683C\u4E0E\u80FD\u529B\u3002") : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-label", htmlFor: "mr-profile-route" }, "\u6A21\u578B\u8DEF\u7EBF"), /* @__PURE__ */ import_react.default.createElement("select", { className: "mr-input", id: "mr-profile-route", value: routeKey2, onChange: (event) => {
    setSelected(event.target.value);
    setNotice(null);
  } }, routes.map((item) => /* @__PURE__ */ import_react.default.createElement("option", { key: profileRouteKey(item), value: profileRouteKey(item) }, item.provider, "/", item.model))), /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-caption mr-profile-state" }, saved ? `\u5DF2\u914D\u7F6E${saved.pricing ? "\u5355\u4EF7" : "\u80FD\u529B\uFF0C\u4EF7\u683C\u672A\u77E5"}` : "\u672A\u914D\u7F6E\uFF0C\u4EF7\u683C\u4E0E\u8D28\u91CF\u6765\u6E90\u672A\u77E5", pending ? " \xB7 \u5F53\u524D\u6709\u672A\u4FDD\u5B58\u8F93\u5165" : "", unmatched > 0 ? ` \xB7 \u53E6\u6709 ${unmatched} \u6761\u914D\u7F6E\u4E0D\u5728\u5F53\u524D\u6A21\u578B\u76EE\u5F55\u4E2D\uFF0C\u4FDD\u5B58\u65F6\u4F1A\u4FDD\u7559` : ""), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-profile-grid" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8D28\u91CF\u8BC4\u5206\uFF080\u2013100\uFF0C\u81EA\u62A5\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", max: "100", step: "any", value: draft.quality, disabled: !writable, onChange: (event) => edit("quality", event.target.value), placeholder: "\u4F8B\u5982 85\uFF1B\u7559\u7A7A\u8868\u793A\u672A\u77E5" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8F93\u5165\u5355\u4EF7\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.input, disabled: !writable, onChange: (event) => edit("input", event.target.value), placeholder: "\u7559\u7A7A\u8868\u793A\u672A\u77E5" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8F93\u51FA\u5355\u4EF7\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.output, disabled: !writable, onChange: (event) => edit("output", event.target.value), placeholder: "\u7559\u7A7A\u8868\u793A\u672A\u77E5" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u64C5\u957F\u65B9\u5411\uFF08\u82F1\u6587\u6807\u7B7E\uFF0C\u9017\u53F7\u5206\u9694\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "text", value: draft.specialties, disabled: !writable, onChange: (event) => edit("specialties", event.target.value), placeholder: PROFILE_SPECIALTY_HINT })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u5B98\u65B9 CLI \u6A21\u578B\u540D\uFF08\u53EF\u9009\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "text", value: draft.cliModel, disabled: !writable, onChange: (event) => edit("cliModel", event.target.value), placeholder: "\u4EC5\u5728\u5382\u5546 CLI \u652F\u6301\u8BE5\u51C6\u786E\u540D\u79F0\u65F6\u586B\u5199" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u6267\u884C\u65B9\u5F0F"), /* @__PURE__ */ import_react.default.createElement("select", { className: "mr-input", value: draft.execution || "auto", disabled: !writable, onChange: (event) => edit("execution", event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "auto" }, "\u81EA\u52A8\uFF1A\u5DF2\u5B89\u88C5\u5219\u7528\u5B98\u65B9\u5DE5\u5177\uFF0C\u5931\u8D25\u56DE\u9000 API"), /* @__PURE__ */ import_react.default.createElement("option", { value: "official" }, "\u5B98\u65B9\u5DE5\u5177\uFF1A\u5931\u8D25\u6216\u672A\u5B89\u88C5\u65F6\u56DE\u9000 API"), /* @__PURE__ */ import_react.default.createElement("option", { value: "api" }, "\u4EC5\u6A21\u578B\u76EE\u5F55 API")))), /* @__PURE__ */ import_react.default.createElement("details", { className: "mr-profile-advanced" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u7F13\u5B58\u5355\u4EF7\uFF08\u53EF\u9009\uFF09"), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-profile-grid" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u7F13\u5B58\u8BFB\u53D6\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.cacheRead, disabled: !writable, onChange: (event) => edit("cacheRead", event.target.value), placeholder: "\u7559\u7A7A\u6309\u666E\u901A\u8F93\u5165\u4EF7\u683C\u4F30\u7B97" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u7F13\u5B58\u5199\u5165\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.cacheWrite, disabled: !writable, onChange: (event) => edit("cacheWrite", event.target.value), placeholder: "\u7559\u7A7A\u6309\u666E\u901A\u8F93\u5165\u4EF7\u683C\u4F30\u7B97" })))), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "mr-button", type: "button", disabled: !writable || !pending, onClick: () => {
    void write(false);
  } }, saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u6B64\u6A21\u578B"), /* @__PURE__ */ import_react.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !pending || saving, onClick: reload }, "\u91CD\u65B0\u52A0\u8F7D\u6B64\u8DEF\u7EBF"), saved && /* @__PURE__ */ import_react.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !writable, onClick: () => {
    void write(true);
  } }, "\u5220\u9664\u6B64\u6A21\u578B\u914D\u7F6E")), notice && /* @__PURE__ */ import_react.default.createElement("p", { className: notice.tone === "error" ? "mr-error" : "mr-profile-success", role: notice.tone === "error" ? "alert" : "status" }, notice.text), /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-caption" }, "\u8D28\u91CF\u8BC4\u5206\u548C\u4EF7\u683C\u90FD\u662F\u7528\u6237\u63D0\u4F9B\u7684\u4F30\u503C\u3002\u672A\u586B\u5199\u5355\u4EF7\u65F6\u663E\u793A\u201C\u4EF7\u683C\u5F85\u914D\u7F6E\u201D\uFF1B\u9884\u7B97\u53EA\u5F71\u54CD\u672C\u5730\u89C4\u5212\uFF0C\u4E0D\u9650\u5236\u5B9E\u9645\u8D26\u5355\u3002CLI \u6A21\u578B\u540D\u987B\u4E0E\u5382\u5546\u5DE5\u5177\u6838\u5BF9\u3002\u6267\u884C\u65B9\u5F0F\u51B3\u5B9A\u8BE5\u6A21\u578B\u6536\u5230\u4EFB\u52A1\u65F6\u8D70\u5B98\u65B9\u65E0\u754C\u9762\u5DE5\u5177\u8FD8\u662F\u6A21\u578B\u76EE\u5F55 API\uFF1B\u5B98\u65B9\u5DE5\u5177\u5931\u8D25\u65F6\u4ECD\u4F1A\u56DE\u9000 API\u3002"))));
}

// .dsh-plugin/client/tool-install-state.mjs
function stableVersionOrder(left, right) {
  const parse = (value) => /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(String(value ?? ""));
  const current = parse(left);
  const target = parse(right);
  if (!current || !target) return null;
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(current[index]) - Number(target[index]);
    if (delta) return Math.sign(delta);
  }
  return 0;
}
function toolInstallAction({ tool, probe, readiness, job, probeStatus }) {
  const running = job?.status === "running";
  const versionOrder = probe?.installed ? stableVersionOrder(probe.version, tool.version) : null;
  const currentAndReady = versionOrder === 0 && readiness?.ready === true;
  const repairable = versionOrder === 0 && readiness?.ready === false;
  const newerOrUncertain = probe?.installed && (versionOrder === null || versionOrder > 0);
  const label = running ? "\u5B89\u88C5\u4E2D\u2026" : currentAndReady ? "\u5DF2\u662F\u76EE\u6807\u7248\u672C" : repairable ? "\u4FEE\u590D\u5B98\u65B9\u6267\u884C\u5165\u53E3" : newerOrUncertain ? "\u8BF7\u4EBA\u5DE5\u6838\u5BF9\u7248\u672C" : probe?.installed ? "\u66F4\u65B0\u5230\u76EE\u6807\u7248\u672C" : job?.status === "failed" ? "\u91CD\u8BD5\u5B89\u88C5" : tool.manager === "signed-windows-installer" ? "\u4E0B\u8F7D\u5B89\u88C5\u5668" : "\u4E0B\u8F7D\u5B89\u88C5";
  return {
    label,
    disabled: probeStatus !== "ready" || running || currentAndReady || newerOrUncertain
  };
}

// .dsh-plugin/client/router-main.css
var router_main_default = ".mr-workspace {\n  --mr-card: rgba(255, 255, 255, .94);\n  --mr-ink: #182232;\n  --mr-muted: #526174;\n  --mr-line: rgba(38, 55, 75, .13);\n  --mr-accent: #315cc8;\n  --mr-soft: #edf3ff;\n  box-sizing: border-box;\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  overflow-y: auto;\n  background: rgba(246, 249, 253, .9);\n  backdrop-filter: blur(18px);\n  color: var(--mr-ink);\n  font-family: inherit;\n}\n.mr-workspace *, .mr-workspace *::before, .mr-workspace *::after { box-sizing: border-box; }\n.mr-shell { width: min(1160px, 100%); margin: 0 auto; padding: 36px 32px 64px; }\n.mr-header { display: flex; flex-wrap: wrap; gap: 20px; align-items: end; justify-content: space-between; margin-bottom: 24px; }\n.mr-eyebrow { margin: 0 0 8px; color: var(--mr-accent); font-size: 11px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }\n.mr-title { margin: 0; font-size: clamp(25px, 3vw, 34px); letter-spacing: -.035em; line-height: 1.16; }\n.mr-subtitle { margin: 10px 0 0; color: var(--mr-muted); font-size: 14px; line-height: 1.65; }\n.mr-status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--mr-line); border-radius: 999px; background: var(--mr-card); color: var(--mr-muted); font-size: 12px; white-space: nowrap; }\n.mr-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #2cba83; }\n.mr-status-dot.loading { background: #e9a640; }\n.mr-status-dot.error { background: #d95360; }\n.mr-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, .85fr); gap: 18px; align-items: start; }\n.mr-card { min-width: 0; border: 1px solid var(--mr-line); border-radius: 18px; background: var(--mr-card); box-shadow: 0 12px 42px rgba(25, 45, 76, .08); }\n.mr-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 22px 0; }\n.mr-card-title { margin: 0; font-size: 16px; font-weight: 700; }\n.mr-card-copy { margin: 5px 0 0; color: var(--mr-muted); font-size: 12px; line-height: 1.55; }\n.mr-card-body { padding: 18px 22px 22px; }\n.mr-label { display: block; margin: 0 0 8px; font-size: 12px; font-weight: 700; }\n.mr-textarea, .mr-input { width: 100%; border: 1px solid var(--mr-line); border-radius: 11px; background: #fff; color: var(--mr-ink); font: inherit; outline: none; }\n.mr-textarea { min-height: 154px; padding: 13px 14px; resize: vertical; line-height: 1.6; font-size: 14px; }\n.mr-input { min-height: 38px; padding: 8px 11px; font-size: 13px; }\n.mr-textarea:focus, .mr-input:focus { border-color: var(--mr-accent); box-shadow: 0 0 0 3px rgba(49, 92, 200, .13); }\n.mr-controls { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 14px; margin-top: 17px; }\n.mr-control-group { display: flex; flex-direction: column; gap: 7px; }\n.mr-control-label { color: var(--mr-muted); font-size: 11px; font-weight: 650; }\n.mr-segment { display: inline-flex; padding: 3px; border-radius: 10px; background: #edf1f7; }\n.mr-segment button { border: 0; border-radius: 8px; padding: 8px 12px; background: transparent; color: var(--mr-muted); font: inherit; font-size: 12px; cursor: pointer; }\n.mr-segment button[aria-pressed='true'] { background: #fff; color: var(--mr-ink); box-shadow: 0 2px 8px rgba(20, 35, 56, .1); font-weight: 700; }\n.mr-budget { width: 140px; }\n.mr-direct { min-width: min(100%, 280px); }\n.mr-actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin-top: 18px; }\n.mr-button { border: 1px solid transparent; border-radius: 10px; min-height: 38px; padding: 8px 14px; background: var(--mr-accent); color: #fff; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }\n.mr-button:hover:not(:disabled) { filter: brightness(.94); }\n.mr-button:disabled { cursor: not-allowed; opacity: .5; }\n.mr-button-secondary { border-color: var(--mr-line); background: #fff; color: var(--mr-ink); }\n.mr-caption { color: var(--mr-muted); font-size: 11px; line-height: 1.5; }\n.mr-search { margin-top: 14px; }\n.mr-list { display: grid; gap: 8px; margin-top: 13px; max-height: 395px; overflow-y: auto; }\n.mr-route { display: flex; justify-content: space-between; gap: 10px; padding: 10px 11px; border: 1px solid var(--mr-line); border-radius: 10px; background: #f9fbfe; }\n.mr-route-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; }\n.mr-route-provider { margin-top: 2px; color: var(--mr-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.mr-pill { align-self: start; flex: none; padding: 3px 7px; border-radius: 7px; background: var(--mr-soft); color: var(--mr-accent); font-size: 10px; font-weight: 700; }\n.mr-empty, .mr-error { padding: 14px; border-radius: 10px; background: #f4f6fa; color: var(--mr-muted); font-size: 12px; line-height: 1.6; }\n.mr-error { background: #fff0f1; color: #a52d3c; }\n.mr-results { margin-top: 18px; }\n.mr-result-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }\n.mr-metric { padding: 13px; border-radius: 12px; background: #f5f8fd; }\n.mr-metric-label { color: var(--mr-muted); font-size: 10px; }\n.mr-metric-value { margin-top: 5px; font-size: 15px; font-weight: 750; word-break: break-word; }\n.mr-section-title { margin: 20px 0 10px; font-size: 13px; font-weight: 750; }\n.mr-package { padding: 13px 14px; border: 1px solid var(--mr-line); border-radius: 11px; background: #fafcff; }\n.mr-package + .mr-package { margin-top: 8px; }\n.mr-package-top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; }\n.mr-package-name { font-size: 12px; font-weight: 750; }\n.mr-package-route { color: var(--mr-accent); font-size: 11px; font-weight: 700; }\n.mr-package-copy { margin: 7px 0 0; color: var(--mr-muted); font-size: 11px; line-height: 1.6; }\n.mr-notice { margin-top: 18px; padding: 14px 16px; border: 1px solid rgba(49, 92, 200, .16); border-radius: 12px; background: #eff4ff; color: #354d7a; font-size: 11px; line-height: 1.65; }\n.mr-notice code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }\n@media (max-width: 850px) { .mr-grid { grid-template-columns: 1fr; } .mr-shell { padding: 24px 18px 48px; } }\n@media (prefers-color-scheme: dark) {\n  .mr-workspace { --mr-card: rgba(30, 38, 51, .94); --mr-ink: #ecf2ff; --mr-muted: #aebbd0; --mr-line: rgba(210, 224, 245, .15); --mr-accent: #91adff; --mr-soft: rgba(97, 132, 222, .18); background: rgba(18, 23, 32, .91); }\n  .mr-textarea, .mr-input, .mr-segment button[aria-pressed='true'], .mr-button-secondary { background: #273245; color: var(--mr-ink); }\n  .mr-segment, .mr-empty, .mr-metric { background: #222d3e; }\n  .mr-route, .mr-package { background: #222d3e; }\n  .mr-notice { background: #243454; color: #c9d6fa; }\n  .mr-error { background: #4a2730; color: #ffd4da; }\n}\n\n/* \u5B98\u65B9\u5DE5\u5177\u5361\u7247 */\n.mr-tools { display: grid; gap: 9px; }\n.mr-tool { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px; border: 1px solid var(--mr-line); border-radius: 11px; background: var(--mr-card); }\n.mr-tool-info { min-width: 0; flex: 1; }\n.mr-tool-status { display: flex; align-items: center; gap: 6px; margin-top: 7px; color: var(--mr-muted); font-size: 11px; }\n.mr-tool-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #8d9aaa; }\n.mr-tool-dot.installed { background: #2cba83; }\n.mr-tool-dot.running { background: #e9a640; }\n.mr-tool-command { display: block; margin-top: 6px; padding: 4px 8px; font-size: 12px; background: var(--dsw-alias-markdown-code-block); border-radius: 6px; overflow-wrap: anywhere; }\n.mr-tool-button { flex-shrink: 0; }\n.mr-tool-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }\n.mr-tool-detail { margin: 7px 0 0; }\n.mr-tool-error { margin: 8px 0 0; padding: 9px 11px; }\n.mr-tool-log { margin-top: 7px; color: var(--mr-muted); font-size: 11px; }\n.mr-tool-log summary { cursor: pointer; }\n.mr-tool-log pre { max-height: 140px; overflow: auto; padding: 8px; border-radius: 7px; background: var(--dsw-alias-markdown-code-block); font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }\n.mr-channel-line { display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; }\n.mr-pill-channel-ok { border-color: var(--dsw-alias-success, #2f9e63); color: var(--dsw-alias-success, #2f9e63); }\n.mr-profile-card { margin-top: 18px; }\n.mr-profile-state { display: block; margin: 8px 0 0; }\n.mr-profile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin-top: 15px; }\n.mr-profile-field { display: grid; align-content: start; gap: 6px; color: var(--mr-muted); font-size: 11px; font-weight: 650; }\n.mr-profile-field .mr-input { color: var(--mr-ink); }\n.mr-profile-advanced { margin-top: 14px; color: var(--mr-muted); font-size: 11px; }\n.mr-profile-advanced summary { cursor: pointer; }\n.mr-profile-success { padding: 10px 12px; border-radius: 10px; background: #e5f5eb; color: #175f3a; font-size: 12px; }\n@media (prefers-color-scheme: dark) { .mr-profile-success { background: #193b2b; color: #b4f1cc; } }\n@media (max-width: 560px) { .mr-tool { align-items: stretch; flex-direction: column; gap: 10px; } .mr-tool-button { align-self: flex-start; } }\n";

// .dsh-plugin/client/router-main.jsx
var money = (value) => value === null || value === void 0 ? "\u4EF7\u683C\u5F85\u914D\u7F6E" : `$${Number(value).toFixed(4)}`;
var text = (value) => typeof value === "string" ? value.trim() : "";
function RouterPanelIcon({ size = 20, active = false }) {
  return /* @__PURE__ */ import_react2.default.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ import_react2.default.createElement("path", { d: "M7 6.5h7M7 17.5h7M15 6.5v11", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }), /* @__PURE__ */ import_react2.default.createElement("circle", { cx: "5", cy: "6.5", r: "2", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: "1.6" }), /* @__PURE__ */ import_react2.default.createElement("circle", { cx: "5", cy: "17.5", r: "2", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: "1.6" }), /* @__PURE__ */ import_react2.default.createElement("circle", { cx: "17", cy: "12", r: "3", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: "1.7" }));
}
function RouteList({ routes, query }) {
  const filtered = routes.filter((route) => {
    const haystack = `${route.providerName} ${route.provider} ${route.name} ${route.model}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  if (filtered.length === 0) return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-empty" }, routes.length === 0 ? "\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u5C1A\u65E0\u53EF\u89C4\u5212\u7684\u8DEF\u7EBF\u3002\u8BF7\u5148\u5728\u201C\u6A21\u578B\u201D\u9875\u5B8C\u6210\u914D\u7F6E\u3002" : "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B\u3002");
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-list", role: "list", "aria-label": "\u5B98\u65B9\u5DF2\u767B\u8BB0\u6A21\u578B\u8DEF\u7EBF" }, filtered.map((route) => /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-route", role: "listitem", key: `${route.provider}/${route.model}` }, /* @__PURE__ */ import_react2.default.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-route-name", title: route.name }, route.name), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-route-provider", title: `${route.provider}/${route.model}` }, route.provider, "/", route.model)), route.reasoningKnown && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-pill" }, "\u63A8\u7406\u7B49\u7EA7"))));
}
function ChannelBadge({ item }) {
  if (!item?.executionChannel) return null;
  const official = item.executionChannel === "official-cli";
  return /* @__PURE__ */ import_react2.default.createElement("span", { className: official ? "mr-pill mr-pill-channel-ok" : "mr-pill", title: item.channelDetail ?? "" }, official ? `\u5B98\u65B9 CLI \xB7 ${item.channelLabel ?? item.channelTool}` : "\u6A21\u578B\u76EE\u5F55 API");
}
function PlanResults({ plan }) {
  const selected = plan.selected;
  return /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card mr-results", "aria-label": "\u8DEF\u7531\u5EFA\u8BAE" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u8DEF\u7531\u5EFA\u8BAE"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u672C\u5730\u8BA1\u7B97\u5B8C\u6210\uFF0C\u672A\u5411\u6A21\u578B\u53D1\u9001\u4EFB\u52A1\u5185\u5BB9\u3002"))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-result-grid" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u63A8\u8350\u8DEF\u7EBF"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, selected ? `${selected.provider}/${selected.model}` : "\u6682\u65E0\u8DEF\u7EBF")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u4EFB\u52A1\u590D\u6742\u5EA6"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, { simple: "\u7B80\u5355", balanced: "\u4E2D\u7B49", complex: "\u590D\u6742" }[plan.complexity.band] || plan.complexity.band)), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u4F30\u7B97\u603B\u6210\u672C"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, money(plan.estimatedCost)))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-channel-line" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, "\u6267\u884C\u6E20\u9053"), /* @__PURE__ */ import_react2.default.createElement(ChannelBadge, { item: plan })), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, plan.reason), plan.optimization.budgetExceeded && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error" }, "\u6309\u5DF2\u63D0\u4F9B\u5355\u4EF7\u4F30\u7B97\uFF0C\u4EFB\u52A1\u53EF\u80FD\u8D85\u8FC7\u672C\u6B21\u9884\u7B97\u3002\u9884\u7B97\u53EA\u5F71\u54CD\u5EFA\u8BAE\uFF0C\u4E0D\u4F1A\u963B\u6B62\u5B9E\u9645\u6263\u8D39\u3002"), plan.mode === "team" && /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("h3", { className: "mr-section-title" }, "\u56E2\u961F\u5DE5\u4F5C\u5305"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u4E0B\u65B9\u6A21\u578B\u662F\u89C4\u5212\u5EFA\u8BAE\uFF1B\u6258\u7BA1\u6267\u884C\u4F1A\u6309\u5382\u5546 CLI \u7684\u6A21\u578B\u540D\u89C4\u5219\u9009\u7528\uFF0C\u672A\u6838\u9A8C\u6620\u5C04\u65F6\u4F7F\u7528\u8BE5 CLI \u7684\u9ED8\u8BA4\u6A21\u578B\u3002"), plan.team.workPackages.length === 0 ? /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-empty" }, "\u5F53\u524D\u76EE\u5F55\u6CA1\u6709\u53EF\u5206\u914D\u7684\u6A21\u578B\u8DEF\u7EBF\u3002") : plan.team.workPackages.map((item, index) => /* @__PURE__ */ import_react2.default.createElement("article", { className: "mr-package", key: item.id }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-package-top" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-package-name" }, index + 1, ". ", item.name), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-package-route" }, item.recommendedProvider, "/", item.recommendedModel)), item.objective && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u5177\u4F53\u76EE\u6807\uFF1A", item.objective), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, item.purpose, item.dependsOn.length > 0 ? ` \xB7 \u4F9D\u8D56\uFF1A${item.dependsOn.join("\u3001")}` : ""), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u96BE\u5EA6\uFF1A", { simple: "\u7B80\u5355", balanced: "\u4E2D\u7B49", complex: "\u56F0\u96BE" }[item.difficulty] || item.difficulty || "\u5F85\u8BC4\u4F30", " \xB7 \u8D39\u7528\uFF1A", money(item.estimatedCost)), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u9A8C\u6536\uFF1A", item.verificationChecklist.join("\uFF1B")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-channel-line" }, /* @__PURE__ */ import_react2.default.createElement(ChannelBadge, { item }))))), plan.routingBypassed && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u5DF2\u6307\u5B9A\u5355\u4E00\u6A21\u578B\uFF0C\u672A\u4E0E\u5176\u4ED6\u8DEF\u7EBF\u6BD4\u8F83\u3002\u5728\u5B98\u65B9\u4F1A\u8BDD\u4E2D\u8C03\u7528 ", /* @__PURE__ */ import_react2.default.createElement("code", null, "model_router_execute"), " \u5E76\u4F20\u5165\u8BE5 provider \u4E0E model \u5373\u53EF\u76F4\u63A5\u6267\u884C\uFF1B\u82E5\u8BE5\u6A21\u578B\u5141\u8BB8\u5B98\u65B9\u5DE5\u5177\uFF0C\u4F1A\u4F18\u5148\u4F7F\u7528\u5BF9\u5E94 CLI\u3002"), plan.mode === "team" && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, plan.team.handoff), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-notice" }, plan.pricingNotice, " ", plan.qualityNotice, " ", plan.availabilityNotice, " ", plan.modalityNotice || "")));
}
var remoteError = (response, fallback) => text(response?.error?.message) || text(response?.value?.error) || fallback;
function probeLabel(probe) {
  if (!probe) return "\u5C1A\u672A\u68C0\u6D4B";
  if (probe.installed) return `\u5DF2\u5B89\u88C5${probe.version ? ` \xB7 ${probe.version}` : ""}`;
  if (probe.status === "not-installed") return "\u672A\u5B89\u88C5";
  if (probe.status === "probe-timeout") return "\u68C0\u6D4B\u8D85\u65F6";
  if (probe.status === "probe-failed") return "\u68C0\u6D4B\u5931\u8D25";
  return probe.detail || "\u672A\u5B89\u88C5";
}
function OfficialToolsCard({ listOfficialTools, installOfficialTool, cancelOfficialToolInstall, officialToolInstallStatus, onProbes }) {
  const [probeState, setProbeState] = import_react2.default.useState({ status: "loading", probes: [], capabilities: [], readiness: [], error: "" });
  const [jobs, setJobs] = import_react2.default.useState({});
  const [rowErrors, setRowErrors] = import_react2.default.useState({});
  const mounted = import_react2.default.useRef(false);
  const request = import_react2.default.useRef(0);
  const submitting = import_react2.default.useRef(/* @__PURE__ */ new Set());
  const polling = import_react2.default.useRef(/* @__PURE__ */ new Set());
  const refresh = async () => {
    const current = ++request.current;
    setProbeState((previous) => ({ ...previous, status: "loading", error: "" }));
    try {
      if (typeof listOfficialTools !== "function") throw new Error("\u5B98\u65B9\u5DE5\u5177\u5B89\u88C5\u6865\u5C1A\u672A\u52A0\u8F7D\u3002");
      const response = await listOfficialTools();
      if (!mounted.current || current !== request.current) return;
      if (!response?.ok) throw new Error(remoteError(response, "\u65E0\u6CD5\u68C0\u6D4B\u5B98\u65B9\u5DE5\u5177\u3002"));
      const probes = Array.isArray(response.value?.tools) ? response.value.tools : [];
      const capabilities = Array.isArray(response.value?.executionCapabilities) ? response.value.executionCapabilities : [];
      const readiness = Array.isArray(response.value?.executionReadiness) ? response.value.executionReadiness : [];
      setProbeState({ status: "ready", probes, capabilities, readiness, error: "" });
      onProbes({ probes, capabilities, readiness });
    } catch (error) {
      if (!mounted.current || current !== request.current) return;
      setProbeState({ status: "error", probes: [], capabilities: [], readiness: [], error: text(error?.message) || "\u65E0\u6CD5\u68C0\u6D4B\u5B98\u65B9\u5DE5\u5177\u3002" });
      onProbes({ probes: [], capabilities: [], readiness: [] });
    }
  };
  import_react2.default.useEffect(() => {
    mounted.current = true;
    void refresh();
    if (typeof officialToolInstallStatus === "function") {
      void Promise.all(OFFICIAL_TOOLS.map(async (tool) => {
        try {
          const response = await officialToolInstallStatus(tool.id);
          return response?.ok && response.value?.job ? [tool.id, response.value.job] : null;
        } catch {
          return null;
        }
      })).then((entries) => {
        if (mounted.current) setJobs((previous) => ({ ...Object.fromEntries(entries.filter(Boolean)), ...previous }));
      });
    }
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);
  import_react2.default.useEffect(() => {
    const active = Object.values(jobs).filter((job) => job?.status === "running").map((job) => job.tool);
    if (active.length === 0 || typeof officialToolInstallStatus !== "function") return void 0;
    let listening = true;
    const poll = async (id2) => {
      if (polling.current.has(id2)) return;
      polling.current.add(id2);
      try {
        const response = await officialToolInstallStatus(id2);
        if (!listening || !mounted.current) return;
        if (!response?.ok) throw new Error(remoteError(response, "\u65E0\u6CD5\u83B7\u53D6\u5B89\u88C5\u8FDB\u5EA6\u3002"));
        const job = response.value?.job;
        if (!job) throw new Error("\u5B89\u88C5\u4EFB\u52A1\u72B6\u6001\u6682\u4E0D\u53EF\u7528\u3002");
        setJobs((previous) => ({ ...previous, [id2]: job }));
        setRowErrors((previous) => ({ ...previous, [id2]: "" }));
        if (job.status !== "running") void refresh();
      } catch (error) {
        if (listening && mounted.current) setRowErrors((previous) => ({ ...previous, [id2]: text(error?.message) || "\u5B89\u88C5\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF0C\u5C06\u7EE7\u7EED\u91CD\u8BD5\u3002" }));
      } finally {
        polling.current.delete(id2);
      }
    };
    const timer = setInterval(() => active.forEach((id2) => {
      void poll(id2);
    }), 1500);
    return () => {
      listening = false;
      clearInterval(timer);
    };
  }, [jobs, officialToolInstallStatus]);
  const install = async (id2) => {
    const tool = OFFICIAL_TOOLS.find((item) => item.id === id2);
    if (!tool || tool.unsupported || submitting.current.has(id2) || jobs[id2]?.status === "running") return;
    submitting.current.add(id2);
    setRowErrors((previous) => ({ ...previous, [id2]: "" }));
    setJobs((previous) => ({ ...previous, [id2]: { tool: id2, status: "running", outputTail: [] } }));
    try {
      if (typeof installOfficialTool !== "function") throw new Error("\u5B98\u65B9\u5DE5\u5177\u5B89\u88C5\u6865\u5C1A\u672A\u52A0\u8F7D\u3002");
      const response = await installOfficialTool(id2);
      if (!mounted.current) return;
      if (!response?.ok || !response.value?.accepted || !response.value?.job) throw new Error(remoteError(response, "\u5B89\u88C5\u4EFB\u52A1\u672A\u88AB\u63A5\u53D7\u3002"));
      setJobs((previous) => ({ ...previous, [id2]: response.value.job }));
    } catch (error) {
      if (mounted.current) {
        setJobs((previous) => ({ ...previous, [id2]: { tool: id2, status: "failed", error: text(error?.message) || "\u5B89\u88C5\u542F\u52A8\u5931\u8D25\u3002" } }));
        setRowErrors((previous) => ({ ...previous, [id2]: text(error?.message) || "\u5B89\u88C5\u542F\u52A8\u5931\u8D25\u3002" }));
      }
    } finally {
      submitting.current.delete(id2);
    }
  };
  const cancel = async (id2) => {
    if (typeof cancelOfficialToolInstall !== "function" || jobs[id2]?.status !== "running" || jobs[id2]?.cancelRequested) return;
    setRowErrors((previous) => ({ ...previous, [id2]: "" }));
    try {
      const response = await cancelOfficialToolInstall(id2);
      if (!mounted.current) return;
      if (!response?.ok || !response.value?.accepted || !response.value?.job) throw new Error(remoteError(response, "\u53D6\u6D88\u8BF7\u6C42\u672A\u88AB\u63A5\u53D7\u3002"));
      setJobs((previous) => ({ ...previous, [id2]: response.value.job }));
      if (response.value.job.status !== "running") void refresh();
    } catch (error) {
      if (mounted.current) setRowErrors((previous) => ({ ...previous, [id2]: text(error?.message) || "\u65E0\u6CD5\u53D6\u6D88\u5B89\u88C5\u3002" }));
    }
  };
  const byId = Object.fromEntries(probeState.probes.map((probe) => [probe.id, probe]));
  const capabilitiesById = Object.fromEntries(probeState.capabilities.map((item) => [item.id, item]));
  const readinessById = Object.fromEntries(probeState.readiness.map((item) => [item.id, item]));
  return /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card", "aria-label": "\u5B98\u65B9\u5DE5\u5177" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u5B98\u65B9\u5DE5\u5177"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u68C0\u6D4B\u672C\u673A\u5B98\u65B9\u5DE5\u5177\uFF0C\u5E76\u4ECE\u56FA\u5B9A\u6CE8\u518C\u8868\u4E00\u952E\u4E0B\u8F7D\u5B89\u88C5\u3002ZCode \u4F1A\u6253\u5F00\u5B98\u65B9\u5B89\u88C5\u7A97\u53E3\u4F9B\u4F60\u9009\u62E9\u76EE\u5F55\uFF1B\u5B8C\u6210\u540E\u91CD\u65B0\u68C0\u6D4B\u7248\u672C\u3002")), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: probeState.status === "loading", onClick: () => {
    void refresh();
  } }, "\u91CD\u65B0\u68C0\u6D4B")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, probeState.status === "loading" && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-empty", role: "status" }, "\u6B63\u5728\u68C0\u6D4B\u672C\u673A\u5B98\u65B9\u5DE5\u5177\u2026"), probeState.status === "error" && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, probeState.error), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-tools", role: "list", "aria-label": "\u5B98\u65B9\u5DE5\u5177\u6CE8\u518C\u8868" }, OFFICIAL_TOOLS.map((tool) => {
    const command = installCommandLine(tool);
    const probe = byId[tool.id];
    const capability = capabilitiesById[tool.id];
    const readiness = readinessById[tool.id];
    const job = jobs[tool.id];
    const running = job?.status === "running";
    const action = toolInstallAction({ tool, probe, readiness, job, probeStatus: probeState.status });
    const verified = job?.status === "succeeded" && job.postInstallProbe?.installed === true;
    const status = running ? job.cancelRequested ? "\u6B63\u5728\u53D6\u6D88\u5B89\u88C5\u2026" : "\u5B89\u88C5\u4E2D\u2026" : job?.status === "installer-opened" ? "\u5B98\u65B9\u5B89\u88C5\u5668\u5DF2\u6253\u5F00\uFF0C\u8BF7\u5B8C\u6210\u5B89\u88C5\u540E\u91CD\u65B0\u68C0\u6D4B" : job?.status === "cancelled" ? "\u5B89\u88C5\u5DF2\u53D6\u6D88\uFF0C\u8BF7\u91CD\u65B0\u68C0\u6D4B" : verified ? "\u5B89\u88C5\u6210\u529F\u5E76\u9A8C\u8BC1" : probeLabel(probe);
    return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-tool", role: "listitem", key: tool.id }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-tool-info" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-route-name", title: tool.purpose }, tool.label), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-route-provider" }, tool.vendor, " \xB7 ", tool.id), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-tool-status", role: "status" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: `mr-tool-dot ${running ? "running" : probe?.installed ? "installed" : "missing"}` }), status, tool.version ? ` \xB7 \u76EE\u6807 ${tool.version}` : ""), probe?.installed && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption mr-tool-detail" }, tool.headlessAdapter ? "\u5DF2\u53EF\u7531 model_router_execute \u4EE5\u65E0\u754C\u9762\u65B9\u5F0F\u8C03\u7528\u3002\u547D\u4EE4\u7F3A\u5931\u6216\u5931\u8D25\u65F6\u56DE\u9000\u6A21\u578B\u76EE\u5F55 API\u3002\u7B7E\u540D\u6C99\u7BB1\u5165\u53E3\u4E0D\u542F\u52A8\u6B64 CLI\u3002" : readiness?.ready ? `\u5B98\u65B9\u6267\u884C\u5165\u53E3\u5DF2\u6838\u9A8C\uFF0C\u53EF\u5728\u4F1A\u8BDD\u4E2D\u8C03\u7528 model_router_tool_run\uFF1B${capability?.modes?.includes("read-only") ? "\u652F\u6301\u53EA\u8BFB\u548C\u7ECF\u5BA1\u6279\u7684\u53EF\u7F16\u8F91\u4EFB\u52A1" : "\u4EC5\u652F\u6301\u7ECF\u5BA1\u6279\u7684\u53EF\u7F16\u8F91\u9694\u79BB\u5DE5\u4F5C\u533A\u4EFB\u52A1"}\uFF0C\u8D26\u53F7\u53CA\u6A21\u578B\u4ECD\u9700\u5B9E\u6D4B\u3002` : `\u5DF2\u5B89\u88C5\uFF0C\u4F46\u5F53\u524D\u4E0D\u53EF\u6258\u7BA1\u6267\u884C\uFF1A${readiness?.reason || capability?.reason || "\u6267\u884C\u5165\u53E3\u5C1A\u672A\u6838\u9A8C\u3002"}`), command ? /* @__PURE__ */ import_react2.default.createElement("code", { className: "mr-tool-command" }, command) : /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption", style: { margin: "6px 0 0" } }, tool.unsupportedReason), probe?.detail && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption mr-tool-detail" }, probe.detail), (rowErrors[tool.id] || job?.error) && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error mr-tool-error", role: "alert" }, rowErrors[tool.id] || job.error), Array.isArray(job?.outputTail) && job.outputTail.length > 0 && /* @__PURE__ */ import_react2.default.createElement("details", { className: "mr-tool-log" }, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u5B89\u88C5\u65E5\u5FD7"), /* @__PURE__ */ import_react2.default.createElement("pre", null, job.outputTail.slice(-6).join("\n")))), command && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-tool-actions" }, /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-tool-button", type: "button", disabled: action.disabled, onClick: () => {
      void install(tool.id);
    } }, action.label), running && /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary mr-tool-button", type: "button", disabled: job.cancelRequested, onClick: () => {
      void cancel(tool.id);
    } }, job.cancelRequested ? "\u6B63\u5728\u53D6\u6D88\u2026" : "\u53D6\u6D88\u5B89\u88C5")));
  })), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption", style: { marginTop: 12 } }, "\u5B89\u88C5\u7531 Host \u6309\u6CE8\u518C\u8868\u56FA\u5B9A\u6765\u6E90\u6267\u884C\uFF0C\u4E0D\u63A5\u53D7\u81EA\u5B9A\u4E49\u5305\u540D\uFF1B\u53EF\u70B9\u201C\u53D6\u6D88\u5B89\u88C5\u201D\u7EC8\u6B62\u4E0B\u8F7D\u4EFB\u52A1\uFF0C\u968F\u540E\u91CD\u65B0\u68C0\u6D4B\u5B9E\u9645\u7248\u672C\u3002ZCode \u5B89\u88C5\u5668\u542F\u52A8\u540E\u4ECD\u9700\u5728\u539F\u5382\u7A97\u53E3\u9009\u62E9\u76EE\u5F55\u5E76\u5B8C\u6210\u5B89\u88C5\u3002Agent \u4E5F\u53EF\u8C03\u7528 ", /* @__PURE__ */ import_react2.default.createElement("code", null, "model_router_tool_install"), "\uFF0C\u6216\u5728\u4F1A\u8BDD\u4F7F\u7528 ", /* @__PURE__ */ import_react2.default.createElement("code", null, "/tools"), "\u3002")));
}
function RouterMainPage({ loadCatalog, settingsScope, listOfficialTools, installOfficialTool, cancelOfficialToolInstall, officialToolInstallStatus }) {
  const [catalogState, setCatalogState] = import_react2.default.useState({ status: "loading", catalog: null, error: "" });
  const [task, setTask] = import_react2.default.useState("");
  const [mode, setMode] = import_react2.default.useState("single");
  const [directKey, setDirectKey] = import_react2.default.useState("");
  const [budget, setBudget] = import_react2.default.useState(() => String(settingsScope.getSnapshot().value?.budgetUsd ?? 0));
  const [query, setQuery] = import_react2.default.useState("");
  const [plan, setPlan] = import_react2.default.useState(null);
  const [planError, setPlanError] = import_react2.default.useState("");
  const [toolProbes, setToolProbes] = import_react2.default.useState(null);
  const budgetEdited = import_react2.default.useRef(false);
  const budgetValue = import_react2.default.useRef(budget);
  const mounted = import_react2.default.useRef(false);
  const catalogRequest = import_react2.default.useRef(0);
  import_react2.default.useEffect(() => {
    const syncBudget = () => {
      if (budgetEdited.current) return;
      const next = String(settingsScope.getSnapshot().value?.budgetUsd ?? 0);
      if (next !== budgetValue.current) {
        budgetValue.current = next;
        setBudget(next);
        setPlan(null);
        setPlanError("");
      }
    };
    syncBudget();
    return settingsScope.subscribe(syncBudget);
  }, [settingsScope]);
  import_react2.default.useEffect(() => {
    mounted.current = true;
    const request = ++catalogRequest.current;
    Promise.resolve().then(loadCatalog).then((response) => {
      if (!mounted.current || request !== catalogRequest.current) return;
      if (response?.ok) setCatalogState({ status: "ready", catalog: response.value, error: "" });
      else setCatalogState({ status: "error", catalog: null, error: text(response?.error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
    }).catch((error) => {
      if (mounted.current && request === catalogRequest.current) setCatalogState({ status: "error", catalog: null, error: text(error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
    });
    return () => {
      mounted.current = false;
      catalogRequest.current += 1;
    };
  }, []);
  const routes = routesFromModelCatalog(catalogState.catalog);
  const providerCount = new Set(routes.map((route) => route.provider)).size;
  const refresh = async () => {
    const request = ++catalogRequest.current;
    setCatalogState({ status: "loading", catalog: null, error: "" });
    setPlan(null);
    try {
      const response = await loadCatalog();
      if (!mounted.current || request !== catalogRequest.current) return;
      if (response?.ok) setCatalogState({ status: "ready", catalog: response.value, error: "" });
      else setCatalogState({ status: "error", catalog: null, error: text(response?.error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
    } catch (error) {
      if (mounted.current && request === catalogRequest.current) setCatalogState({ status: "error", catalog: null, error: text(error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
    }
  };
  const invalidatePlan = () => {
    setPlan(null);
    setPlanError("");
  };
  const handleToolProbes = import_react2.default.useCallback((snapshot) => {
    setToolProbes(snapshot);
    setPlan(null);
    setPlanError("");
  }, []);
  const generate = () => {
    setPlanError("");
    try {
      if (!text(task)) throw new Error("\u8BF7\u5148\u63CF\u8FF0\u4EFB\u52A1\u3002");
      if (routes.length === 0) throw new Error("\u8BF7\u5148\u5728\u5B98\u65B9\u201C\u6A21\u578B\u201D\u9875\u914D\u7F6E\u81F3\u5C11\u4E00\u6761\u6A21\u578B\u8DEF\u7EBF\u3002");
      const parsedBudget = Number(budget);
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0) throw new Error("\u9884\u7B97\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\u3002");
      const direct = mode === "direct" ? routes.find((route) => `${route.provider}/${route.model}` === directKey) ?? routes[0] : null;
      if (mode === "direct" && !direct) throw new Error("\u8BF7\u9009\u62E9\u8981\u76F4\u63A5\u4F7F\u7528\u7684\u6A21\u578B\u3002");
      setPlan(createWorkspacePlan(task, catalogState.catalog, {
        mode,
        ...direct ? { directProvider: direct.provider, directModel: direct.model } : {},
        budgetUsd: parsedBudget,
        modelProfilesJson: settingsScope.getSnapshot().value?.modelProfilesJson ?? "[]",
        installedToolIds: (toolProbes?.probes ?? []).filter((probe) => probe.installed).map((probe) => probe.id),
        runnableToolIds: (toolProbes?.readiness ?? []).filter((item) => item.ready).map((item) => item.id)
      }));
    } catch (error) {
      setPlan(null);
      setPlanError(text(error?.message) || "\u65E0\u6CD5\u751F\u6210\u8DEF\u7531\u5EFA\u8BAE\u3002");
    }
  };
  return /* @__PURE__ */ import_react2.default.createElement("main", { className: "mr-workspace" }, /* @__PURE__ */ import_react2.default.createElement("style", null, router_main_default), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-shell" }, /* @__PURE__ */ import_react2.default.createElement("header", { className: "mr-header" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-eyebrow" }, "Model Router \xB7 DeepSeek Harness"), /* @__PURE__ */ import_react2.default.createElement("h1", { className: "mr-title" }, "\u6A21\u578B\u8DEF\u7531\u5DE5\u4F5C\u53F0"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-subtitle" }, "\u67E5\u770B\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\uFF0C\u4E3A\u4EFB\u52A1\u751F\u6210\u8DEF\u7EBF\u5EFA\u8BAE\u4E0E\u56E2\u961F\u5DE5\u4F5C\u5305\u3002\u4E3B\u4F1A\u8BDD\u6A21\u578B\u4ECD\u7531\u5B98\u65B9\u9009\u62E9\u5668\u7BA1\u7406\u3002")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-status" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: `mr-status-dot ${catalogState.status === "loading" ? "loading" : catalogState.status === "error" ? "error" : ""}` }), catalogState.status === "ready" ? `${providerCount} \u4E2A\u4F9B\u5E94\u5546 \xB7 ${routes.length} \u6761\u8DEF\u7EBF` : catalogState.status === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u76EE\u5F55" : "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-grid" }, /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card", "aria-label": "\u4EFB\u52A1\u89C4\u5212" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u4EFB\u52A1\u89C4\u5212"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u89C4\u5212\u5728\u672C\u673A\u5B8C\u6210\uFF0C\u4E0D\u4F1A\u542F\u52A8\u6A21\u578B\u6216\u56E2\u961F\u4EFB\u52A1\u3002"))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-label", htmlFor: "mr-task" }, "\u4EFB\u52A1\u63CF\u8FF0"), /* @__PURE__ */ import_react2.default.createElement("textarea", { className: "mr-textarea", id: "mr-task", value: task, onChange: (event) => {
    setTask(event.target.value);
    invalidatePlan();
  }, placeholder: "\u4F8B\u5982\uFF1A\u5206\u6790\u9879\u76EE\u67B6\u6784\uFF0C\u5206\u5DE5\u4FEE\u590D\u5173\u952E\u95EE\u9898\uFF0C\u5E76\u7ED9\u51FA\u9A8C\u6536\u6E05\u5355" }), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, "\u89C4\u5212\u6A21\u5F0F"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-segment", role: "group", "aria-label": "\u89C4\u5212\u6A21\u5F0F" }, /* @__PURE__ */ import_react2.default.createElement("button", { type: "button", "aria-pressed": mode === "single", onClick: () => {
    setMode("single");
    invalidatePlan();
  } }, "\u5355\u4EFB\u52A1"), /* @__PURE__ */ import_react2.default.createElement("button", { type: "button", "aria-pressed": mode === "team", onClick: () => {
    setMode("team");
    invalidatePlan();
  } }, "\u56E2\u961F\u5206\u5DE5"), /* @__PURE__ */ import_react2.default.createElement("button", { type: "button", "aria-pressed": mode === "direct", onClick: () => {
    setMode("direct");
    invalidatePlan();
  } }, "\u6307\u5B9A\u6A21\u578B"))), mode === "direct" && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group mr-direct" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-direct-model" }, "\u76F4\u63A5\u4F7F\u7528"), /* @__PURE__ */ import_react2.default.createElement("select", { className: "mr-input", id: "mr-direct-model", value: directKey || (routes[0] ? `${routes[0].provider}/${routes[0].model}` : ""), onChange: (event) => {
    setDirectKey(event.target.value);
    invalidatePlan();
  } }, routes.map((route) => /* @__PURE__ */ import_react2.default.createElement("option", { key: `${route.provider}/${route.model}`, value: `${route.provider}/${route.model}` }, route.provider, "/", route.model)))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group mr-budget" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-budget" }, "\u672C\u6B21\u4F30\u7B97\u9884\u7B97\uFF08USD\uFF09"), /* @__PURE__ */ import_react2.default.createElement("input", { className: "mr-input", id: "mr-budget", type: "number", min: "0", step: "0.01", value: budget, onChange: (event) => {
    budgetEdited.current = true;
    budgetValue.current = event.target.value;
    setBudget(event.target.value);
    invalidatePlan();
  } }))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button", type: "button", disabled: catalogState.status !== "ready" || routes.length === 0 || toolProbes === null, onClick: generate }, "\u751F\u6210\u8DEF\u7531\u5EFA\u8BAE"), /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, toolProbes === null ? "\u6B63\u5728\u68C0\u6D4B\u5B98\u65B9\u5DE5\u5177\u2026" : "0 \u8868\u793A\u4E0D\u9650\u5236\u672C\u6B21\u5EFA\u8BAE\uFF1B\u4E0D\u4F1A\u8BBE\u7F6E\u771F\u5B9E\u652F\u51FA\u4E0A\u9650\u3002")), planError && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, planError))), /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card", "aria-label": "\u6A21\u578B\u76EE\u5F55" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u6A21\u578B\u76EE\u5F55"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u53EA\u663E\u793A\u5B98\u65B9\u5DF2\u767B\u8BB0\u7684 provider/model\uFF0C\u4E0D\u8BFB\u53D6 API Key\u3002")), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", onClick: refresh }, "\u5237\u65B0")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, catalogState.status === "error" && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-error", role: "alert" }, catalogState.error), catalogState.status === "loading" && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-empty" }, "\u6B63\u5728\u52A0\u8F7D\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u2026"), catalogState.status === "ready" && /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-label", htmlFor: "mr-model-search" }, "\u641C\u7D22\u8DEF\u7EBF"), /* @__PURE__ */ import_react2.default.createElement("input", { className: "mr-input mr-search", id: "mr-model-search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u6A21\u578B\u6216\u4F9B\u5E94\u5546" }), /* @__PURE__ */ import_react2.default.createElement(RouteList, { routes, query }), catalogState.catalog?.failures?.length > 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, catalogState.catalog.failures.length, " \u4E2A\u4F9B\u5E94\u5546\u7684\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5728\u5B98\u65B9\u6A21\u578B\u9875\u68C0\u67E5\u914D\u7F6E\u3002")), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption", style: { marginTop: 13 } }, "\u76EE\u5F55\u767B\u8BB0\u4E0D\u4EE3\u8868\u51ED\u636E\u6216\u7F51\u7EDC\u5F53\u524D\u53EF\u7528\uFF1B\u56FE\u50CF\u80FD\u529B\u9700\u8981\u5728\u5B9E\u9645\u4F7F\u7528\u524D\u6838\u5BF9\u3002")))), /* @__PURE__ */ import_react2.default.createElement(ModelProfileEditor, { routes, settingsScope, onSaved: invalidatePlan }), plan && /* @__PURE__ */ import_react2.default.createElement(PlanResults, { plan }), /* @__PURE__ */ import_react2.default.createElement(OfficialToolsCard, { listOfficialTools, installOfficialTool, cancelOfficialToolInstall, officialToolInstallStatus, onProbes: handleToolProbes }), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-notice" }, "\u5B9E\u9645\u8C03\u7528\u8BF7\u5728\u5B98\u65B9\u4F1A\u8BDD\u4E2D\u4F7F\u7528 ", /* @__PURE__ */ import_react2.default.createElement("code", null, "model_router_execute"), "\uFF08\u6309\u8DEF\u7531\u6216\u6307\u5B9A\u6A21\u578B\u6267\u884C\uFF0C\u5B98\u65B9 CLI \u5931\u8D25\u5219\u56DE\u9000 API\uFF09\u3001", /* @__PURE__ */ import_react2.default.createElement("code", null, "model_router_consult"), "\u3001", /* @__PURE__ */ import_react2.default.createElement("code", null, "model_router_tool_run"), " \u6216 ", /* @__PURE__ */ import_react2.default.createElement("code", null, "model_router_team_execute"), "\u3002\u6307\u5B9A\u6A21\u578B\u4F1A\u8DF3\u8FC7\u8DEF\u7EBF\u6BD4\u8F83\u3002\u6258\u7BA1\u6267\u884C\u80FD\u529B\u548C\u5C31\u7EEA\u72B6\u6001\u89C1\u4E0A\u65B9\u5404\u5DE5\u5177\u5361\u7247\uFF1B\u5B9E\u9645\u4F7F\u7528\u7684\u6A21\u578B\u4EE5\u5382\u5546\u8BB0\u5F55\u4E3A\u51C6\u3002ZCode 3.14.3 \u4F7F\u7528\u5176\u81EA\u8EAB\u914D\u7F6E\u7684\u9ED8\u8BA4\u6A21\u578B\u3002\u53EF\u7F16\u8F91\u56E2\u961F\u4EFB\u52A1\u8981\u6C42\u5E72\u51C0\u7684 Git \u4ED3\u5E93\uFF0C\u5E76\u7ECF\u5B98\u65B9\u5DE5\u5177\u5BA1\u6279\u3002\u8BBE\u7F6E\u4F4D\u4E8E\u201C\u63D2\u4EF6 \u2192 \u5DF2\u5B89\u88C5 \u2192 @ljwei-stak/model-router-galgame\u201D\u3002")));
}

// .dsh-plugin/shared/official-tools-remote.mjs
var OFFICIAL_TOOLS_REMOTE_PACKAGE = "@ljwei-stak/model-router-galgame";
var OFFICIAL_TOOLS_REMOTE_NAMESPACE = "modelRouterOfficialTools";
function strictCodec(typeSymbol, parse) {
  return Object.freeze({ mode: "strict", typeSymbol, create: () => ({ parse }) });
}
function plainObject(value, subject) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${subject} must be an object`);
  }
  return value;
}
var toolIdCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolId`, (value) => {
  if (typeof value !== "string" || !getOfficialTool(value)) {
    throw new TypeError("toolId must name a fixed official tool");
  }
  return value;
});
var listResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolList`, (value) => {
  const result = plainObject(value, "tool list result");
  if (!Array.isArray(result.tools)) throw new TypeError("tool list result needs a tools array");
  return result;
});
var installResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolInstall`, (value) => {
  const result = plainObject(value, "install result");
  if (typeof result.accepted !== "boolean") throw new TypeError("install result needs accepted");
  if (result.accepted && !result.job) throw new TypeError("accepted install needs a job");
  if (!result.accepted && typeof result.error !== "string") throw new TypeError("refused install needs an error");
  return result;
});
var statusResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolStatus`, (value) => {
  const result = plainObject(value, "install status result");
  if (result.job !== null && (typeof result.job !== "object" || Array.isArray(result.job))) {
    throw new TypeError("install status result needs a job or null");
  }
  return result;
});
function descriptor(method, parameters, result) {
  return Object.freeze({
    id: `${OFFICIAL_TOOLS_REMOTE_PACKAGE}#${OFFICIAL_TOOLS_REMOTE_NAMESPACE}/${method}`,
    service: OFFICIAL_TOOLS_REMOTE_NAMESPACE,
    namespace: OFFICIAL_TOOLS_REMOTE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters,
    result
  });
}
var toolIdParameter = Object.freeze({
  name: "toolId",
  wire: "toolId",
  source: "json",
  codec: toolIdCodec
});
var OFFICIAL_TOOLS_REMOTE_DESCRIPTORS = Object.freeze([
  descriptor("list", [], listResultCodec),
  descriptor("installTool", [toolIdParameter], installResultCodec),
  descriptor("cancel", [toolIdParameter], installResultCodec),
  descriptor("status", [toolIdParameter], statusResultCodec)
]);
var OFFICIAL_TOOLS_CLIENT_REMOTE = Object.freeze({
  package: OFFICIAL_TOOLS_REMOTE_PACKAGE,
  descriptors: OFFICIAL_TOOLS_REMOTE_DESCRIPTORS
});
var OFFICIAL_TOOLS_HOST_TYPERT = Object.freeze({
  package: OFFICIAL_TOOLS_REMOTE_PACKAGE,
  face: "host",
  schemas: [],
  invocations: OFFICIAL_TOOLS_REMOTE_DESCRIPTORS,
  model: { services: [], events: [], objects: [] }
});

// .dsh-plugin/client/official-harness.jsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var ROUTER_NAMESPACE = "model-router-galgame";
var ROUTER_PACKAGE = "@ljwei-stak/model-router-galgame";
var ROUTER_PANEL = "model-router-galgame";
var inject = ["remote"];
var UI_INJECT = [
  "slots",
  "configForms",
  "remote",
  "remote.session",
  `remote.${OFFICIAL_TOOLS_REMOTE_NAMESPACE}`,
  "layout"
];
var FORM_LABELS = Object.freeze({
  unavailable: "\u8BE5\u63D2\u4EF6\u5F53\u524D\u672A\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u914D\u7F6E\u3002",
  readOnly: "\u5F53\u524D\u914D\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  saveFailed: "\u8BBE\u7F6E\u6CA1\u6709\u88AB\u4FDD\u5B58\uFF0C\u8BF7\u68C0\u67E5\u8F93\u5165\u540E\u91CD\u8BD5\u3002",
  save: "\u4FDD\u5B58\u8BBE\u7F6E",
  saving: "\u4FDD\u5B58\u4E2D\u2026"
});
var FIELD_COPY = Object.freeze({
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  invalidNumber: "\u8BF7\u8F93\u5165\u5141\u8BB8\u8303\u56F4\u5185\u7684\u6570\u5B57\uFF0C\u6216\u7559\u7A7A\u6062\u590D\u9ED8\u8BA4\u3002"
});
function boundedNumberField(field2, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const numeric = (0, import_dsh_client_ui_primitives.settingsNumberField)(field2);
  return {
    ...numeric,
    parse: (text2) => {
      const write = numeric.parse(text2);
      if (write?.kind !== "set") return write;
      const value = write.value;
      if (typeof value !== "number" || value < minimum || value > maximum) return void 0;
      if (integer && (!Number.isSafeInteger(value) || Object.is(value, -0))) return void 0;
      return write;
    }
  };
}
function modelProfilesField() {
  const field2 = (0, import_dsh_client_ui_primitives.settingsTextField)("modelProfilesJson");
  return {
    ...field2,
    parse: (text2) => {
      try {
        parseModelProfilesJson(text2);
        return field2.parse(text2);
      } catch {
        return void 0;
      }
    }
  };
}
var RouterSettingsCardController = class {
  constructor(scope) {
    this.form = new import_dsh_client_ui_primitives.SettingsFormModel(scope, [
      boundedNumberField("budgetUsd", { minimum: 0 }),
      boundedNumberField("maxConsultOutputChars", { minimum: 500, maximum: 5e4, integer: true }),
      modelProfilesField()
    ]);
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      budgetUsd: this.form.field("budgetUsd"),
      maxConsultOutputChars: this.form.field("maxConsultOutputChars"),
      modelProfilesJson: this.form.field("modelProfilesJson")
    }));
  }
  /** Supply the snapshot hook and staged form actions to the Plugins slot. */
  inject() {
    return { hooks: { modelRouterSettings: this.store }, ...this.form.actions() };
  }
  /** Release the live Host-form subscription when the client plugin unloads. */
  dispose() {
    this.form.dispose();
  }
};
function RouterSettingsCard(props) {
  const state = props.useModelRouterSettings((snapshot) => snapshot);
  if (props.view === "summary") {
    return "\u4E3A\u5B98\u65B9\u5DF2\u914D\u7F6E\u7684\u6A21\u578B\u751F\u6210\u8DEF\u7531\u8BA1\u5212\uFF0C\u5E76\u63D0\u4F9B\u8DE8\u6A21\u578B\u54A8\u8BE2\u5DE5\u5177\u3002";
  }
  const disabled = !state.writable || state.saving;
  return /* @__PURE__ */ import_react3.default.createElement(import_dsh_client_ui_primitives.SettingsForm, { labels: FORM_LABELS, state, onSave: props.save, onDiscard: props.discard }, /* @__PURE__ */ import_react3.default.createElement(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      id: "model-router-budget-usd",
      label: "\u5355\u6B21\u8BA1\u5212\u9884\u7B97\u4E0A\u9650\uFF08USD\uFF09",
      hint: "0 \u8868\u793A\u4E0D\u8BBE\u9884\u7B97\u4E0A\u9650\u3002\u53EA\u6709\u586B\u5199\u4E0B\u65B9\u5B9E\u9645\u4F7F\u7528\u7684\u5355\u4EF7\u540E\uFF0C\u624D\u80FD\u4F30\u7B97\u8D39\u7528\uFF1B\u9884\u7B97\u53EA\u5F71\u54CD\u8DEF\u7531\u5EFA\u8BAE\u3002",
      help: {
        label: "\u9884\u7B97\u8BF4\u660E",
        content: "\u9884\u7B97\u53EA\u5F71\u54CD\u8DEF\u7531\u5EFA\u8BAE\uFF0C\u4E0D\u4F1A\u9650\u5236\u670D\u52A1\u5546\u6263\u8D39\uFF0C\u4E5F\u4E0D\u4F1A\u8BFB\u53D6\u6216\u4FDD\u5B58 API Key\u3002"
      },
      disabled,
      ...state.budgetUsd,
      overriddenLabel: FIELD_COPY.overridden,
      resetLabel: FIELD_COPY.reset,
      invalidLabel: FIELD_COPY.invalidNumber,
      onEdit: (text2) => {
        props.edit("budgetUsd", text2);
      },
      onReset: () => {
        props.resetField("budgetUsd");
      }
    }
  ), /* @__PURE__ */ import_react3.default.createElement(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      id: "model-router-consult-output",
      label: "\u8DE8\u6A21\u578B\u54A8\u8BE2\u6700\u5927\u8F93\u51FA\u5B57\u7B26\u6570",
      hint: "\u9650\u5236 model_router_consult \u8FD4\u56DE\u7684\u5B57\u7B26\u6570\uFF0C\u9632\u6B62\u5355\u6B21\u54A8\u8BE2\u5360\u7528\u8FC7\u591A\u4E0A\u4E0B\u6587\u3002",
      numeric: true,
      disabled,
      ...state.maxConsultOutputChars,
      overriddenLabel: FIELD_COPY.overridden,
      resetLabel: FIELD_COPY.reset,
      invalidLabel: FIELD_COPY.invalidNumber,
      onEdit: (text2) => {
        props.edit("maxConsultOutputChars", text2);
      },
      onReset: () => {
        props.resetField("maxConsultOutputChars");
      }
    }
  ), /* @__PURE__ */ import_react3.default.createElement("div", { style: styles.profileEditor }, /* @__PURE__ */ import_react3.default.createElement("label", { htmlFor: "model-router-profiles-json", style: styles.profileLabel }, "\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u914D\u7F6E\uFF08JSON\uFF09"), /* @__PURE__ */ import_react3.default.createElement("p", { style: styles.noticeText }, "\u6309\u201C\u6A21\u578B\u76EE\u5F55\u201D\u4E2D\u7684\u51C6\u786E provider/model \u586B\u5199\u3002quality \u4E3A\u81EA\u5B9A\u7684 0\u2013100 \u5206\uFF1Binput/output \u662F\u7F8E\u5143\u6BCF\u767E\u4E07 token\u3002\u7F3A\u5C11\u4EF7\u683C\u65F6\u53EA\u7ED9\u8DEF\u7EBF\u5EFA\u8BAE\uFF0C\u4E0D\u663E\u793A\u865A\u6784\u8D39\u7528\u3002"), /* @__PURE__ */ import_react3.default.createElement(
    "textarea",
    {
      id: "model-router-profiles-json",
      value: state.modelProfilesJson.text,
      disabled,
      "aria-invalid": state.modelProfilesJson.invalid,
      onChange: (event) => props.edit("modelProfilesJson", event.target.value),
      spellCheck: false,
      style: styles.profileTextarea
    }
  ), state.modelProfilesJson.invalid && /* @__PURE__ */ import_react3.default.createElement("p", { style: styles.profileError, role: "alert" }, "JSON \u683C\u5F0F\u6216\u67D0\u9879\u914D\u7F6E\u65E0\u6548\u3002\u6BCF\u9879\u9700\u63D0\u4F9B\u51C6\u786E\u7684 provider/model\uFF0C\u5355\u4EF7\u4E3A\u975E\u8D1F USD \u6570\u5B57\uFF0C\u8D28\u91CF\u4E3A 0\u2013100\u3002"), /* @__PURE__ */ import_react3.default.createElement("details", { style: styles.profileExample }, /* @__PURE__ */ import_react3.default.createElement("summary", null, "\u67E5\u770B\u914D\u7F6E\u683C\u5F0F"), /* @__PURE__ */ import_react3.default.createElement("pre", null, `[
  {
    "provider": "\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u4F9B\u5E94\u5546 ID",
    "model": "\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u6A21\u578B ID",
    "quality": 80,
    "pricing": { "input": 0.2, "output": 0.8 },
    "specialties": ["code"],
    "cliModel": "\u5382\u5546 CLI \u4F7F\u7528\u7684\u6A21\u578B\u540D\uFF08\u53EF\u9009\uFF09",
    "execution": "auto"
  }
]`), /* @__PURE__ */ import_react3.default.createElement("p", { style: styles.noticeText }, "execution \u53EF\u7701\u7565\u3002auto \u6216 official \u8868\u793A\u4F18\u5148\u5B98\u65B9\u65E0\u754C\u9762\u5DE5\u5177\uFF0C\u5931\u8D25\u540E\u56DE\u9000 API\uFF1Bapi \u8868\u793A\u59CB\u7EC8\u8D70\u6A21\u578B\u76EE\u5F55\u3002")), /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", disabled, onClick: () => props.resetField("modelProfilesJson") }, "\u6062\u590D\u9ED8\u8BA4\u914D\u7F6E")), /* @__PURE__ */ import_react3.default.createElement("aside", { style: styles.notice, "aria-label": "\u6A21\u578B\u8DEF\u7531\u4F7F\u7528\u8BF4\u660E" }, /* @__PURE__ */ import_react3.default.createElement("div", { style: styles.titleLine }, /* @__PURE__ */ import_react3.default.createElement(import_dsh_client_ui_primitives.Tag, { tone: "info" }, "\u5B98\u65B9\u6A21\u578B\u914D\u7F6E")), /* @__PURE__ */ import_react3.default.createElement("p", { style: styles.noticeText }, "\u8BF7\u5728 DeepSeek Harness \u7684\u201C\u6A21\u578B\u201D\u9875\u9762\u914D\u7F6E DeepSeek\u3001OpenAI \u517C\u5BB9\u6216 Anthropic \u517C\u5BB9\u670D\u52A1\u3002\u6B64\u63D2\u4EF6\u8BFB\u53D6\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\uFF0C\u4E0D\u4FDD\u5B58 API Key\uFF1B\u76EE\u5F55\u4E2D\u7684\u8DEF\u7EBF\u4ECD\u9700\u901A\u8FC7\u5B9E\u9645\u8C03\u7528\u9A8C\u8BC1\u8D26\u53F7\u548C\u7F51\u7EDC\u53EF\u7528\u6027\u3002"), /* @__PURE__ */ import_react3.default.createElement("p", { style: styles.noticeText }, "\u4F7F\u7528 ", /* @__PURE__ */ import_react3.default.createElement("code", null, "model_router_plan"), " \u83B7\u53D6\u53EF\u5BA1\u9605\u7684\u8DEF\u7531\u5EFA\u8BAE\uFF0C\u4F7F\u7528 ", /* @__PURE__ */ import_react3.default.createElement("code", null, "model_router_consult"), " \u54A8\u8BE2\u4E00\u4E2A\u5DF2\u914D\u7F6E\u6A21\u578B\u3002\u5EFA\u8BAE\u4E0D\u4F1A\u6539\u5199\u4E3B\u4F1A\u8BDD\u6A21\u578B\uFF1B\u591A\u4EBA\u5206\u5DE5\u7531\u5B98\u65B9 Agent Teams \u5DE5\u5177\u6267\u884C\u3002")));
}
function OpenRouterWorkspace({ subject, openPanel }) {
  if (subject?.kind !== "bundle" || subject.pkg?.name !== ROUTER_PACKAGE) return null;
  return /* @__PURE__ */ import_react3.default.createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", type: "button", onClick: openPanel }, "\u6253\u5F00\u5DE5\u4F5C\u53F0");
}
function registerUi(ctx) {
  const officialToolsRemote = ctx.remote[OFFICIAL_TOOLS_REMOTE_NAMESPACE];
  const settingsScope = ctx.configForms.get(ROUTER_NAMESPACE);
  const card = new RouterSettingsCardController(settingsScope);
  ctx.effect(() => () => {
    card.dispose();
  }, "model-router-galgame: settings form subscription");
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
    name: "plugins.bundle.config",
    key: ROUTER_PACKAGE,
    inject: () => card.inject()
  }, RouterSettingsCard))), "model-router-galgame: installed bundle settings");
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject("main", () => ctx.slots.register({
    name: "main",
    key: ROUTER_PANEL,
    inject: () => ({
      loadCatalog: () => ctx.remote.session.modelCatalog(),
      settingsScope,
      listOfficialTools: () => officialToolsRemote.list(),
      installOfficialTool: (toolId) => officialToolsRemote.installTool(toolId),
      cancelOfficialToolInstall: (toolId) => officialToolsRemote.cancel(toolId),
      officialToolInstallStatus: (toolId) => officialToolsRemote.status(toolId)
    })
  }, RouterMainPage))), "model-router-galgame: main workspace");
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: ROUTER_PANEL,
    order: 30,
    label: "\u6A21\u578B\u8DEF\u7531"
  }, RouterPanelIcon))), "model-router-galgame: sidebar entry");
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject("plugins.detail.actions", () => ctx.slots.register({
    name: "plugins.detail.actions",
    id: "model-router-open-workspace",
    order: 30,
    inject: () => ({ openPanel: () => ctx.layout.selectPanel(ROUTER_PANEL) })
  }, OpenRouterWorkspace))), "model-router-galgame: bundle open action");
}
async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(OFFICIAL_TOOLS_CLIENT_REMOTE);
  const ui = ctx.inject(UI_INJECT, registerUi);
  try {
    await ui;
  } catch (error) {
    await ui.dispose();
    await disposeRemote();
    throw error;
  }
  return async () => {
    await ui.dispose();
    await disposeRemote();
  };
}
var styles = Object.freeze({
  titleLine: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" },
  notice: {
    marginTop: "4px",
    padding: "12px",
    border: "1px solid var(--dsw-alias-border-l1)",
    borderRadius: "8px",
    background: "var(--dsw-alias-markdown-code-block)"
  },
  noticeText: {
    margin: "7px 0 0",
    color: "var(--dsw-alias-label-secondary)",
    fontSize: "13px",
    lineHeight: "20px"
  },
  profileEditor: { display: "grid", gap: "8px", marginTop: "14px" },
  profileLabel: { fontSize: "13px", fontWeight: 600 },
  profileTextarea: { width: "100%", minHeight: "150px", padding: "10px", fontFamily: "monospace", fontSize: "12px", borderRadius: "7px", border: "1px solid var(--dsw-alias-border-l1)", boxSizing: "border-box" },
  profileError: { color: "var(--dsw-alias-label-danger)", fontSize: "12px", margin: 0 },
  profileExample: { fontSize: "12px", whiteSpace: "pre-wrap" }
});
    return module.exports;
  },
});
