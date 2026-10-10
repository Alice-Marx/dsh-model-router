window.__ModuleLoader__.load({
  id: "@ljwei-stak/dsh-model-router",
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
var import_react6 = __toESM(require("react"), 1);

// .dsh-plugin/shared/official-tool-registry.mjs
var DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org/";
function packageManagerMethod(id2, label, manager, spec, { registryFlag = "--registry=" } = {}) {
  return Object.freeze({
    id: id2,
    label,
    kind: "package-manager",
    manager,
    spec,
    registryFlag,
    installArgs: Object.freeze(["install", "-g", spec]),
    uninstallArgs: Object.freeze(["uninstall", "-g", spec.replace(/@latest$/, "")]),
    /** npm/pnpm both accept --prefix to place a global install off the default. */
    supportsInstallDir: true,
    supportsRegistry: true
  });
}
function scriptMethod(id2, label, { shell, scriptUrl, verify, installArg = [], env = [], platforms, supportsInstallDir = false }) {
  return Object.freeze({
    id: id2,
    label,
    kind: "script",
    shell,
    scriptUrl,
    verify,
    /** Passed after the staged script path; empty means the script takes no argument. */
    installArgs: Object.freeze(installArg),
    /** Environment the vendor script itself documents for this install. */
    env: Object.freeze(env),
    platforms: Object.freeze(platforms),
    /** Whether the vendor script honours a caller-chosen directory at all. */
    supportsInstallDir,
    supportsRegistry: false
  });
}
var OFFICIAL_TOOLS = Object.freeze([
  Object.freeze({
    id: "kimi-code",
    label: "Kimi Code \xB7 Node",
    vendor: "Moonshot AI",
    purpose: "Kimi \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B kimi \u547D\u4EE4\u4E0E ACP \u4F1A\u8BDD\u3002",
    package: "@moonshot-ai/kimi-code",
    manager: "npm",
    installArgs: ["install", "-g", "@moonshot-ai/kimi-code@latest", "--registry=https://registry.npmjs.org/"],
    uninstallArgs: ["uninstall", "-g", "@moonshot-ai/kimi-code"],
    probeExecutables: ["kimi"],
    probeNote: "kimi \u4E0E\u65E7 Python \u7248 kimi-cli \u540C\u540D\uFF1B\u8BF7\u6838\u5BF9\u53EF\u6267\u884C\u6587\u4EF6\u6765\u6E90\u548C\u7248\u672C\u3002",
    providerHints: ["moonshot", "kimi"],
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "@moonshot-ai/kimi-code@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "@moonshot-ai/kimi-code@latest")
    ])
  }),
  Object.freeze({
    id: "claude-code",
    label: "Claude Code",
    vendor: "Anthropic",
    purpose: "Anthropic \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B claude \u547D\u4EE4\u3002",
    package: "@anthropic-ai/claude-code",
    manager: "npm",
    installArgs: ["install", "-g", "@anthropic-ai/claude-code@latest", "--registry=https://registry.npmjs.org/"],
    uninstallArgs: ["uninstall", "-g", "@anthropic-ai/claude-code"],
    probeExecutables: ["claude"],
    providerHints: ["anthropic", "claude"],
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "@anthropic-ai/claude-code@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "@anthropic-ai/claude-code@latest")
    ])
  }),
  Object.freeze({
    id: "codex",
    label: "Codex CLI",
    vendor: "OpenAI",
    purpose: "OpenAI \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B codex \u547D\u4EE4\u3002",
    package: "@openai/codex",
    manager: "npm",
    installArgs: ["install", "-g", "@openai/codex@latest", "--registry=https://registry.npmjs.org/"],
    uninstallArgs: ["uninstall", "-g", "@openai/codex"],
    probeExecutables: ["codex"],
    probeNote: "Codex \u7248\u672C\u6A2A\u5E45\u7531\u9002\u914D\u5C42\u5BBD\u5339\u914D\uFF1B\u5B89\u88C5\u65F6\u53D6 npm \u6700\u65B0\u7248\u3002",
    providerHints: ["openai", "gpt", "codex"],
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "@openai/codex@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "@openai/codex@latest")
    ])
  }),
  Object.freeze({
    id: "minimax-code",
    label: "MiniMax Code",
    vendor: "MiniMax",
    purpose: "MiniMax \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B mcode \u547D\u4EE4\u3002",
    package: "@minimax-ai/code",
    manager: "npm",
    installArgs: ["install", "-g", "@minimax-ai/code@latest", "--registry=https://registry.npmjs.org/", "--ignore-scripts=false", "--include=optional", "--allow-scripts=@minimax-ai/code,better-sqlite3"],
    uninstallArgs: ["uninstall", "-g", "@minimax-ai/code"],
    probeExecutables: ["mcode"],
    providerHints: ["minimax"],
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "@minimax-ai/code@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "@minimax-ai/code@latest")
    ])
  }),
  Object.freeze({
    id: "mimo-code",
    label: "MiMo Code",
    vendor: "XiaoMi",
    purpose: "\u5C0F\u7C73 MiMo \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B mimo \u547D\u4EE4\u3002",
    package: "@mimo-ai/cli",
    manager: "npm",
    installArgs: ["install", "-g", "@mimo-ai/cli@latest", "--registry=https://registry.npmjs.org/"],
    uninstallArgs: ["uninstall", "-g", "@mimo-ai/cli"],
    probeExecutables: ["mimo"],
    providerHints: ["mimo", "xiaomi"],
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "@mimo-ai/cli@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "@mimo-ai/cli@latest")
    ])
  }),
  Object.freeze({
    id: "grok-build",
    label: "Grok Build",
    vendor: "xAI",
    purpose: "xAI \u5B98\u65B9\u7F16\u7A0B CLI\uFF0C\u63D0\u4F9B grok \u547D\u4EE4\u4E0E ACP \u4F1A\u8BDD\u3002",
    package: "@xai-official/grok",
    manager: "npm",
    installArgs: ["install", "-g", "@xai-official/grok@latest", "--registry=https://registry.npmjs.org/"],
    uninstallArgs: ["uninstall", "-g", "@xai-official/grok"],
    probeExecutables: ["grok"],
    providerHints: ["xai", "grok"],
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "@xai-official/grok@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "@xai-official/grok@latest")
    ])
  }),
  Object.freeze({
    id: "gemini",
    label: "Gemini CLI",
    vendor: "Google",
    purpose: "Google \u5B98\u65B9 Gemini CLI\uFF0C\u65E0\u754C\u9762\u6A21\u5F0F\u4F7F\u7528 gemini -p\u3002",
    package: "@google/gemini-cli",
    manager: "npm",
    installArgs: ["install", "-g", "@google/gemini-cli@latest", "--registry=https://registry.npmjs.org/"],
    uninstallArgs: ["uninstall", "-g", "@google/gemini-cli"],
    probeExecutables: ["gemini"],
    providerHints: ["gemini", "google"],
    // Headless runs go through the task adapter. The signed sandbox runner does
    // not launch this CLI; a missing or failed process falls back to the API.
    headlessAdapter: true,
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "@google/gemini-cli@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "@google/gemini-cli@latest")
    ])
  }),
  Object.freeze({
    id: "opencode",
    label: "OpenCode",
    vendor: "anomalyco / SST",
    purpose: "\u5F00\u6E90\u7EC8\u7AEF\u7F16\u7A0B\u4EE3\u7406\uFF0C\u63D0\u4F9B opencode \u547D\u4EE4\uFF1B\u53EF\u7528 npm/pnpm \u6216\u5B98\u65B9\u5B89\u88C5\u811A\u672C\u83B7\u53D6\u3002",
    package: "opencode-ai",
    manager: "npm",
    installArgs: ["install", "-g", "opencode-ai@latest", "--registry=https://registry.npmjs.org/"],
    uninstallArgs: ["uninstall", "-g", "opencode-ai"],
    probeExecutables: ["opencode"],
    probeNote: "opencode \u547D\u4EE4\u7531 npm \u5168\u5C40\u5305\u6216\u5B98\u65B9\u811A\u672C\u5B89\u88C5\u7684\u4E8C\u8FDB\u5236\u63D0\u4F9B\uFF1B\u811A\u672C\u5B89\u88C5\u56FA\u5B9A\u843D\u5728 ~/.opencode/bin\u3002",
    providerHints: ["opencode", "anomalyco"],
    /** File an uninstall may delete, when the copy came from a script install. */
    scriptBinaryNames: Object.freeze(["opencode", "opencode.exe"]),
    /** Where the vendor script puts the binary when the user sets no directory. */
    defaultScriptInstallDir: ".opencode/bin",
    installMethods: Object.freeze([
      packageManagerMethod("npm", "npm", "npm", "opencode-ai@latest"),
      packageManagerMethod("pnpm", "pnpm", "pnpm", "opencode-ai@latest"),
      // The published script hardcodes $HOME/.opencode/bin, so it cannot honour
      // a custom install directory; the npm/pnpm methods above can.
      scriptMethod("script-bash", "curl | bash", {
        shell: "bash",
        scriptUrl: "https://opencode.ai/install",
        platforms: ["linux", "darwin"],
        // The published script hardcodes $HOME/.opencode/bin, so it cannot honour
        // a custom install directory; the npm/pnpm methods above can.
        supportsInstallDir: false,
        verify: Object.freeze({
          mustInclude: ["anomalyco/opencode", "opencode.ai"],
          mustNotInclude: ["static-openapi.stepfun.com"]
        })
      })
    ])
  }),
  Object.freeze({
    id: "stepcode",
    label: "Step Code",
    vendor: "StepFun \u9636\u8DC3\u661F\u8FB0",
    purpose: "\u9636\u8DC3\u661F\u8FB0\u5F00\u6E90\u7EC8\u7AEF\u7F16\u7A0B\u4EE3\u7406\uFF0C\u63D0\u4F9B step \u547D\u4EE4\uFF1B\u5B98\u65B9\u53EA\u53D1\u5E03\u5B89\u88C5\u811A\u672C\uFF0C\u6CA1\u6709 npm \u5305\u3002",
    manager: "script-installer",
    installArgs: [],
    uninstallArgs: [],
    probeExecutables: ["step"],
    probeNote: "step \u547D\u4EE4\u6765\u81EA\u9636\u8DC3\u5B98\u65B9\u5B89\u88C5\u811A\u672C\uFF0C\u6821\u9A8C\u548C\u5199\u5165 ~/.stepcode\uFF1B\u914D\u7F6E\u4E0E\u51ED\u636E\u540C\u5728\u8BE5\u76EE\u5F55\uFF0C\u5378\u8F7D\u53EA\u5220\u9664\u53EF\u6267\u884C\u6587\u4EF6\u3002",
    providerHints: ["stepfun", "stepcode"],
    scriptBinaryNames: Object.freeze(["step", "step.exe"]),
    defaultScriptInstallDir: ".stepcode/bin",
    /** The vendor installer writes this marked block into the shell profile. */
    pathProfileMarkers: Object.freeze(["# stepcode"]),
    installMethods: Object.freeze([
      scriptMethod("script-bash", "curl | bash", {
        shell: "bash",
        scriptUrl: "https://static-openapi.stepfun.com/stepcode/install.sh",
        platforms: ["linux", "darwin"],
        installArg: ["--install-dir"],
        env: ["STEP_INSTALL_DIR", "STEP_RELEASE_BASE_URL"],
        supportsInstallDir: true,
        verify: Object.freeze({
          mustInclude: ["static-openapi.stepfun.com", "stepcode installer"],
          mustNotInclude: ["anomalyco/opencode"]
        })
      }),
      scriptMethod("script-powershell", "irm | iex", {
        shell: "powershell",
        scriptUrl: "https://static-openapi.stepfun.com/stepcode/install.ps1",
        platforms: ["win32"],
        installArg: ["-InstallDir"],
        env: ["STEP_INSTALL_DIR", "STEP_RELEASE_BASE_URL"],
        supportsInstallDir: true,
        verify: Object.freeze({
          mustInclude: ["static-openapi.stepfun.com", "stepcode"],
          mustNotInclude: ["anomalyco/opencode"]
        })
      })
    ])
  }),
  Object.freeze({
    id: "zcode",
    label: "ZCode",
    vendor: "Z.ai",
    purpose: "\u667A\u8C31\u5B98\u65B9 ZCode \u684C\u9762\u7248\uFF0C\u5185\u542B GLM \u7F16\u7A0B\u4EE3\u7406\u3002Windows \u5B89\u88C5\u5668\u53EF\u9009\u62E9 D \u76D8\u76EE\u5F55\u3002",
    manager: "signed-windows-installer",
    installArgs: [],
    uninstallArgs: [],
    probeExecutables: [],
    probeNote: "\u68C0\u6D4B\u7ECF\u8FC7\u6709\u6548\u7B7E\u540D\u7684 ZCode.exe \u548C\u540C\u76EE\u5F55 GLM \u8D44\u6E90\uFF1B\u684C\u9762\u5B89\u88C5\u5668\u9700\u4EBA\u5DE5\u9009\u62E9\u5B89\u88C5\u4F4D\u7F6E\u3002",
    providerHints: ["zai", "z.ai", "zcode", "glm", "zhipu", "bigmodel"]
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
function installMethodsFor(tool) {
  return Array.isArray(tool?.installMethods) ? tool.installMethods : [];
}
function installMethodFor(tool, methodId) {
  const wanted = String(methodId ?? "").trim();
  if (!wanted) return null;
  return installMethodsFor(tool).find((method) => method.id === wanted) ?? null;
}
function defaultInstallMethod(tool) {
  return installMethodsFor(tool)[0] ?? null;
}
function installCommandLine(tool) {
  if (!tool || tool.unsupported) return null;
  if (tool.manager === "signed-windows-installer") return "\u6253\u5F00\u5B98\u65B9\u7B7E\u540D\u5B89\u88C5\u5668\uFF08\u9009\u62E9\u5B89\u88C5\u76EE\u5F55\uFF09";
  return installCommandLineFor(tool, defaultInstallMethod(tool));
}
function installCommandLineFor(tool, method) {
  if (!tool || tool.unsupported) return null;
  if (!method) return null;
  if (method.kind === "script") {
    const piped = method.shell === "powershell" ? `irm ${method.scriptUrl} | iex` : `curl -fsSL ${method.scriptUrl} | bash`;
    return method.installArgs.length ? `${piped} ${method.installArgs[0]} <\u5B89\u88C5\u76EE\u5F55>` : piped;
  }
  return `${method.manager} ${method.installArgs.join(" ")}`;
}

// .dsh-plugin/shared/model-profiles.mjs
var MAX_TEXT = 32e3;
var MAX_PROFILES = 200;
var id = (value) => typeof value === "string" ? value.trim() : "";
var BILLING_VALUES = /* @__PURE__ */ new Set(["subscription-first", "api-only", "subscription-only"]);
var SUBSCRIPTION_VALUES = /* @__PURE__ */ new Set(["plan-key", "cli-login", "none"]);
function nonnegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e6) {
    throw new Error(`${label} \u5FC5\u987B\u662F 0 \u5230 1000000 \u4E4B\u95F4\u7684\u6709\u9650\u6570\u5B57`);
  }
  return value;
}
function normalizeProfile(entry, index) {
  const label = `\u7B2C ${index + 1} \u4E2A\u6A21\u578B`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} \u5FC5\u987B\u662F\u5BF9\u8C61`);
  const allowed = /* @__PURE__ */ new Set(["provider", "model", "benchmarkModel", "quality", "pricing", "specialties", "cliModel", "execution", "billing", "subscription", "apiRoute"]);
  const unknown = Object.keys(entry).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} \u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5 ${unknown}\uFF1B\u4E0D\u8981\u5728\u8FD9\u91CC\u586B\u5199\u5BC6\u94A5\u6216\u547D\u4EE4`);
  const provider = id(entry.provider);
  const model = id(entry.model);
  if (!provider || !model || provider.length > 160 || model.length > 240) {
    throw new Error(`${label} \u9700\u8981\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u51C6\u786E provider \u548C model`);
  }
  const profile = { provider, model };
  if (entry.benchmarkModel !== void 0) {
    const benchmarkModel = id(entry.benchmarkModel);
    if (!benchmarkModel || benchmarkModel.length > 240 || /[\u0000-\u001f]/u.test(benchmarkModel)) throw new Error(`${label} \u7684 benchmarkModel \u9700\u8981\u51C6\u786E\u7684\u57FA\u51C6\u6A21\u578B\u540D\u79F0`);
    profile.benchmarkModel = benchmarkModel;
  }
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
  if (entry.billing !== void 0) {
    if (!BILLING_VALUES.has(entry.billing)) throw new Error(`${label} \u7684 billing \u53EA\u80FD\u662F subscription-first\u3001api-only \u6216 subscription-only`);
    profile.billing = entry.billing;
  }
  if (entry.subscription !== void 0) {
    if (!SUBSCRIPTION_VALUES.has(entry.subscription)) throw new Error(`${label} \u7684 subscription \u53EA\u80FD\u662F plan-key\u3001cli-login \u6216 none`);
    profile.subscription = entry.subscription;
  }
  if (entry.apiRoute !== void 0) {
    const target = entry.apiRoute;
    if (!target || typeof target !== "object" || Array.isArray(target) || Object.keys(target).some((key) => key !== "provider" && key !== "model")) {
      throw new Error(`${label} \u7684 apiRoute \u5FC5\u987B\u662F { provider, model }`);
    }
    const apiProvider = id(target.provider);
    const apiModel = id(target.model);
    if (!apiProvider || !apiModel || apiProvider.length > 160 || apiModel.length > 240) throw new Error(`${label} \u7684 apiRoute \u9700\u8981\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u51C6\u786E provider \u548C model`);
    if (profile.subscription !== "plan-key") throw new Error(`${label} \u53EA\u6709 subscription \u4E3A plan-key \u65F6\u624D\u80FD\u8BBE\u7F6E apiRoute`);
    if (apiProvider === provider && apiModel === model) throw new Error(`${label} \u7684 apiRoute \u4E0D\u80FD\u6307\u5411\u81EA\u5DF1`);
    profile.apiRoute = { provider: apiProvider, model: apiModel };
  }
  if (Object.keys(profile).length === 2) throw new Error(`${label} \u81F3\u5C11\u63D0\u4F9B quality\u3001pricing\u3001specialties\u3001cliModel\u3001execution\u3001billing \u6216 subscription \u4E4B\u4E00`);
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
      ...profile.benchmarkModel === void 0 ? {} : { benchmarkModel: profile.benchmarkModel },
      ...profile.quality === void 0 ? {} : { quality: profile.quality, qualitySource: "user" },
      ...profile.pricing === void 0 ? {} : { pricing: { ...profile.pricing }, pricingSource: "user" },
      ...profile.specialties === void 0 ? {} : { specialties: [...profile.specialties] },
      ...profile.cliModel === void 0 ? {} : { cliModel: profile.cliModel },
      ...profile.execution === void 0 ? {} : { execution: profile.execution },
      ...profile.billing === void 0 ? {} : { billing: profile.billing },
      ...profile.subscription === void 0 ? {} : { subscription: profile.subscription },
      ...profile.apiRoute === void 0 ? {} : { apiRoute: { ...profile.apiRoute } }
    };
  });
}

// .dsh-plugin/shared/subscription-billing.mjs
var BILLING_MODES = Object.freeze(["subscription-first", "api-only", "subscription-only"]);
var DEFAULT_BILLING_MODE = "subscription-first";
var MAX_COOLDOWN_MS = 31 * 24 * 60 * 6e4;
var BILLING_MODE_LABEL = Object.freeze({
  "subscription-first": "\u8BA2\u9605\u4F18\u5148",
  "api-only": "\u53EA\u7528 API Key",
  "subscription-only": "\u53EA\u7528\u8BA2\u9605"
});
var VENDOR_QUOTA_PATTERNS = Object.freeze({
  "claude-code": Object.freeze([
    { kind: "quota", source: "code.claude.com/docs/en/errors", re: /you['’]?ve hit your [a-z0-9 -]{0,24}limit/i },
    { kind: "quota", source: "\u65E7\u7248 CLI \u6587\u672C\uFF08\u672A\u6838\u9A8C\uFF09", re: /claude ai usage limit reached|usage limit reached\|\d{10}/i },
    { kind: "rate-limit", source: "code.claude.com/docs/en/errors", re: /server is temporarily limiting requests|request rejected \(429\)/i }
  ]),
  codex: Object.freeze([
    { kind: "quota", source: "Codex usage_limit_reached\uFF08\u793E\u533A\u8BB0\u5F55\u7684 API \u8FD4\u56DE\uFF09", re: /usage_limit_reached|you['’]?ve hit your usage limit|usage limit has been reached/i },
    { kind: "rate-limit", source: "OpenAI 429\uFF08\u901A\u7528\uFF09", re: /rate_limit_exceeded|rate limit reached for/i }
  ]),
  gemini: Object.freeze([
    { kind: "quota", source: "Google API RESOURCE_EXHAUSTED", re: /RESOURCE_EXHAUSTED|quota exceeded|exhausted your (?:daily )?quota|usage limit reached for all/i }
  ]),
  "kimi-code": Object.freeze([
    { kind: "quota", source: "kimi.com/code/docs \u9519\u8BEF\u53C2\u8003", re: /you['’]?ve reached your (?:5-hour|weekly \(7-day\)|monthly) usage limit/i },
    { kind: "rate-limit", source: "kimi.com/code/docs \u9519\u8BEF\u53C2\u8003", re: /you['’]?ve reached your concurrent request limit|we['’]?re receiving too many requests|engine is currently overloaded/i }
  ]),
  "minimax-code": Object.freeze([
    { kind: "quota", source: "platform.minimax.io \u9519\u8BEF\u7801 2056", re: /(?:\bcode\b["'\s:=]*|\[)2056\b|usage limit exceeded|token plan usage limit reached/i },
    { kind: "rate-limit", source: "platform.minimax.io \u9519\u8BEF\u7801 2045", re: /(?:\bcode\b["'\s:=]*|\[)2045\b|rate growth limit/i }
  ]),
  zcode: Object.freeze([
    { kind: "quota", source: "docs.z.ai / docs.bigmodel.cn \u9519\u8BEF\u7801 1308\u20131321", re: /(?:\bcode\b["'\s:=]*|\[)13(?:08|09|10|1[6-9]|2[01])\b|usage limit reached for|weekly\/monthly limit exhausted|已达到.{0,20}使用上限|套餐已到期|每周\/每月使用上限/i },
    { kind: "rate-limit", source: "docs.z.ai \u9519\u8BEF\u7801 1302/1305", re: /(?:\bcode\b["'\s:=]*|\[)130[25]\b|rate limit reached for requests|速率限制|访问量过大/i }
  ]),
  "*": Object.freeze([
    { kind: "rate-limit", source: "HTTP 429\uFF08\u901A\u7528\uFF09", re: /\b429\b|too many requests|rate[_ ]limit/i }
  ])
});
var clean = (value) => typeof value === "string" ? value.trim() : "";
function parseQuotaPatterns(value) {
  const patterns = {};
  const errors = [];
  if (value === void 0 || value === null || clean(value) === "") return { patterns, errors };
  let input;
  try {
    input = JSON.parse(value);
  } catch {
    return { patterns, errors: ["quotaPatternsJson \u4E0D\u662F\u6709\u6548\u7684 JSON"] };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { patterns, errors: ["quotaPatternsJson \u5FC5\u987B\u662F\u5BF9\u8C61"] };
  for (const [key, entry] of Object.entries(input).slice(0, 40)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${key}: \u5FC5\u987B\u662F\u5BF9\u8C61`);
      continue;
    }
    const list = [];
    for (const [field2, kind] of [["quota", "quota"], ["rateLimit", "rate-limit"]]) {
      const values = entry[field2];
      if (values === void 0) continue;
      if (!Array.isArray(values)) {
        errors.push(`${key}.${field2}: \u5FC5\u987B\u662F\u6570\u7EC4`);
        continue;
      }
      for (const source of values.slice(0, 20)) {
        if (typeof source !== "string" || !source || source.length > 200) {
          errors.push(`${key}.${field2}: \u6BCF\u9879\u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u7684\u6B63\u5219`);
          continue;
        }
        try {
          list.push({ kind, source: "\u7528\u6237\u914D\u7F6E", re: new RegExp(source, "i") });
        } catch {
          errors.push(`${key}.${field2}: \u65E0\u6548\u6B63\u5219 ${source.slice(0, 40)}`);
        }
      }
    }
    if (list.length) patterns[key] = list;
  }
  return { patterns, errors };
}
var SUBSCRIPTION_STATE_LABEL = Object.freeze({
  "logged-in": "\u5DF2\u767B\u5F55\u8BA2\u9605\u8D26\u53F7",
  "plan-key": "\u7F16\u7A0B\u5957\u9910 Key \u8DEF\u7EBF",
  "api-key-only": "\u4EC5 API Key \u767B\u5F55",
  "logged-out": "\u672A\u767B\u5F55",
  exhausted: "\u989D\u5EA6\u5DF2\u7528\u5C3D",
  unknown: "\u767B\u5F55\u72B6\u6001\u672A\u77E5",
  none: "\u65E0\u8BA2\u9605"
});

// .dsh-plugin/shared/security-boundaries.mjs
var READ_ONLY_SCOPE = Object.freeze({
  "claude-code": "\u5F53\u524D\u4F1A\u8BDD\u5DE5\u4F5C\u533A\uFF08\u4EC5 Read/Glob/Grep \u5DE5\u5177\uFF0CdontAsk \u6A21\u5F0F\u62D2\u7EDD\u672A\u6388\u6743\u7684\u5DE5\u4F5C\u533A\u5916\u8BFB\u53D6\uFF09",
  codex: "\u5F53\u524D\u7528\u6237\u53EF\u8BFB\u7684\u5168\u90E8\u6587\u4EF6\uFF08Codex read-only \u6C99\u7BB1\u53EA\u7981\u6B62\u5199\u5165\u548C\u8054\u7F51\u547D\u4EE4\uFF09",
  gemini: "\u5F53\u524D\u4F1A\u8BDD\u5DE5\u4F5C\u533A\uFF08Gemini CLI \u9ED8\u8BA4\u5DE5\u4F5C\u533A\u9650\u5236\uFF09"
});
function toolBoundary(toolId, { sandboxed = false, platform = "unknown" } = {}) {
  const directOnly = toolId === "gemini";
  const harnessSandbox = sandboxed && !directOnly;
  return {
    toolId,
    readOnly: {
      readable: READ_ONLY_SCOPE[toolId] ?? "\u5F53\u524D\u4F1A\u8BDD\u5DE5\u4F5C\u533A",
      writable: "\u65E0\uFF08\u53EA\u8BFB\u8FD0\u884C\uFF0C\u4E0D\u5E94\u7528\u4EFB\u4F55\u6539\u52A8\uFF09",
      sandbox: harnessSandbox ? platform === "win32" ? "Harness \u8FDB\u7A0B\u6C99\u7BB1\uFF08Windows ACL \u540E\u7AEF\u4E3A\u90E8\u5206\u5F3A\u5236\uFF09" : "Harness \u8FDB\u7A0B\u6C99\u7BB1" : "\u65E0 Harness \u6C99\u7BB1\uFF1A\u76F4\u63A5\u542F\u52A8 CLI\uFF0C\u53EA\u8BFB\u4EC5\u7531 CLI \u81EA\u8EAB\u53C2\u6570\u4FDD\u8BC1",
      direct: !harnessSandbox
    },
    write: toolId === "gemini" ? null : {
      readable: "\u72EC\u7ACB Git \u5DE5\u4F5C\u6811\uFF08\u5F53\u524D\u4ED3\u5E93\u7684\u5E72\u51C0\u526F\u672C\uFF09",
      writable: "\u72EC\u7ACB Git \u5DE5\u4F5C\u6811\uFF1BCLI \u6210\u529F\u4E14\u539F\u5DE5\u4F5C\u533A\u672A\u53D8\u52A8\u65F6\uFF0C\u624D\u628A\u6E90\u4EE3\u7801\u8865\u4E01\u5E94\u7528\u56DE\u5F53\u524D\u5DE5\u4F5C\u533A",
      sandbox: "Harness \u8FDB\u7A0B\u6C99\u7BB1\uFF0C\u7F3A\u5C11\u6C99\u7BB1\u65F6\u62D2\u7EDD\u542F\u52A8",
      requiresApproval: true
    }
  };
}

// .dsh-plugin/shared/tool-install-preferences.mjs
var MAX_INSTALL_DIR_CHARS = 4096;
var MAX_SOURCE_URL_CHARS = 2048;
var MAX_OVERRIDES = 64;
function isAbsolutePath(value) {
  const raw = String(value ?? "");
  if (!raw) return false;
  if (raw.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true;
  return /^\\\\[^\\]+\\[^\\]+/.test(raw);
}
function joinPath(base, ...segments) {
  const separator = String(base ?? "").includes("\\") && !String(base ?? "").includes("/") ? "\\" : "/";
  const parts = [String(base ?? "").replace(/[\\/]+$/, ""), ...segments.map((item) => String(item ?? "").replace(/^[\\/]+|[\\/]+$/g, ""))];
  return parts.filter(Boolean).join(separator) || separator;
}
function expandInstallDir(value, { home = "", env = {} } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes("\0")) throw new Error("\u5B89\u88C5\u76EE\u5F55\u5305\u542B\u65E0\u6548\u5B57\u7B26\u3002");
  let expanded = raw;
  const userHome = String(home ?? "");
  if (expanded === "~") expanded = userHome;
  else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) expanded = joinPath(userHome, expanded.slice(2));
  expanded = expanded.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name) => env[name] ?? match).replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => env[name] ?? match);
  if (expanded.length > MAX_INSTALL_DIR_CHARS) throw new Error("\u5B89\u88C5\u76EE\u5F55\u8FC7\u957F\u3002");
  if (!isAbsolutePath(expanded)) throw new Error("\u5B89\u88C5\u76EE\u5F55\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\u3002");
  const withoutTrailing = expanded.replace(/[\\/]+$/, "");
  if (!withoutTrailing) throw new Error("\u5B89\u88C5\u76EE\u5F55\u4E0D\u80FD\u662F\u6587\u4EF6\u7CFB\u7EDF\u6839\u76EE\u5F55\u3002");
  if (/^[A-Za-z]:$/.test(withoutTrailing)) throw new Error("\u5B89\u88C5\u76EE\u5F55\u4E0D\u80FD\u662F\u6587\u4EF6\u7CFB\u7EDF\u6839\u76EE\u5F55\u3002");
  if (/^\\\\[^\\]+\\[^\\]+$/.test(withoutTrailing)) throw new Error("\u5B89\u88C5\u76EE\u5F55\u4E0D\u80FD\u662F\u7F51\u7EDC\u5171\u4EAB\u6839\u76EE\u5F55\u3002");
  return expanded;
}
function normalizeSourceUrl(value, subject) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > MAX_SOURCE_URL_CHARS) throw new Error(`${subject}\u5730\u5740\u8FC7\u957F\u3002`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${subject}\u4E0D\u662F\u6709\u6548\u7F51\u5740\u3002`);
  }
  if (url.protocol !== "https:") throw new Error(`${subject}\u5FC5\u987B\u4F7F\u7528 https\u3002`);
  if (url.username || url.password) throw new Error(`${subject}\u4E0D\u80FD\u5305\u542B\u8D26\u53F7\u5BC6\u7801\u3002`);
  return url.toString();
}
function parseJsonObject(value, subject) {
  const raw = String(value ?? "").trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${subject}\u4E0D\u662F\u6709\u6548 JSON\u3002`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${subject}\u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002`);
  }
  const entries = Object.entries(parsed);
  if (entries.length > MAX_OVERRIDES) throw new Error(`${subject}\u6761\u76EE\u8FC7\u591A\u3002`);
  return Object.fromEntries(entries.filter(([, item]) => typeof item === "string" && item.trim()));
}
function valueOf(config, key, fallback) {
  const value = config?.[key];
  return value !== void 0 && typeof value?.get === "function" ? value.get() : value ?? fallback;
}
function keepKnownToolIds(raw, known, subject) {
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`${subject}\u4E2D\u7684 ${key} \u4E0D\u662F\u5B98\u65B9\u5DE5\u5177 ID\u3002`);
  }
  return raw;
}
function parseInstallPreferences(config = {}, { tools = [] } = {}) {
  const known = new Set(tools.map((tool) => tool.id));
  const installDir = expandInstallDir(valueOf(config, "toolInstallDir", ""));
  const registry = normalizeSourceUrl(valueOf(config, "toolNpmRegistry", DEFAULT_NPM_REGISTRY), "npm \u6E90") || DEFAULT_NPM_REGISTRY;
  const methodRaw = keepKnownToolIds(
    parseJsonObject(valueOf(config, "toolInstallMethodsJson", "{}"), "\u5B89\u88C5\u65B9\u5F0F\u8986\u76D6"),
    known,
    "\u5B89\u88C5\u65B9\u5F0F\u8986\u76D6"
  );
  const scriptRaw = keepKnownToolIds(
    parseJsonObject(valueOf(config, "toolScriptUrlsJson", "{}"), "\u5B89\u88C5\u811A\u672C\u6E90\u8986\u76D6"),
    known,
    "\u5B89\u88C5\u811A\u672C\u6E90\u8986\u76D6"
  );
  const methods = {};
  const scriptUrls = {};
  for (const [id2, methodId] of Object.entries(methodRaw)) methods[id2] = methodId.trim();
  for (const [id2, url] of Object.entries(scriptRaw)) scriptUrls[id2] = normalizeSourceUrl(url, `${id2} \u5B89\u88C5\u811A\u672C\u6E90`);
  for (const [id2, methodId] of Object.entries(methods)) {
    if (!installMethodFor({ id: id2, installMethods: tools.find((tool) => tool.id === id2)?.installMethods }, methodId)) {
      throw new Error(`${id2} \u4E0D\u652F\u6301\u5B89\u88C5\u65B9\u5F0F ${methodId}\u3002`);
    }
  }
  return {
    installDir,
    registry,
    methods,
    scriptUrls,
    /** Script execution stays a deliberate act; a config file alone must not run one. */
    allowScriptInstall: valueOf(config, "toolAllowScriptInstall", true) !== false
  };
}

// .dsh-plugin/client/router-main.jsx
var import_react5 = __toESM(require("react"), 1);

// .dsh-plugin/shared/routing-presets.mjs
var DEFAULT_ROUTING_PRESET = "balanced";
var ROUTING_PRESETS = Object.freeze({
  economy: Object.freeze({
    id: "economy",
    label: "\u7701\u94B1\u4F18\u5148",
    description: "\u66F4\u770B\u91CD\u5355\u4EF7\uFF0C\u5141\u8BB8\u8D28\u91CF\u7565\u4F4E\u7684\u6A21\u578B\u627F\u62C5\u7B80\u5355\u548C\u4E2D\u7B49\u4EFB\u52A1\u3002",
    floorDelta: -0.04,
    tilt: Object.freeze({ quality: 0.75, cost: 1.6, latency: 1.1 })
  }),
  balanced: Object.freeze({
    id: "balanced",
    label: "\u5747\u8861",
    description: "\u9ED8\u8BA4\uFF1A\u6309\u4EFB\u52A1\u96BE\u5EA6\u5E73\u8861\u8D28\u91CF\u3001\u6210\u672C\u548C\u901F\u5EA6\u3002",
    floorDelta: 0,
    tilt: Object.freeze({})
  }),
  quality: Object.freeze({
    id: "quality",
    label: "\u6548\u679C\u4F18\u5148",
    description: "\u66F4\u770B\u91CD\u8D28\u91CF\uFF0C\u63D0\u9AD8\u66FF\u4EE3\u6A21\u578B\u5FC5\u987B\u8FBE\u5230\u7684\u8D28\u91CF\u95E8\u69DB\u3002",
    floorDelta: 0.04,
    tilt: Object.freeze({ quality: 1.35, cost: 0.5, specialty: 1.2, reasoning: 1.2 })
  })
});
function normalizeRoutingPreset(value) {
  return Object.hasOwn(ROUTING_PRESETS, value) ? value : DEFAULT_ROUTING_PRESET;
}
function routingPreset(value) {
  return ROUTING_PRESETS[normalizeRoutingPreset(value)];
}
function presetWeights(weights, preset) {
  const { tilt } = routingPreset(preset);
  if (!weights || Object.keys(tilt).length === 0) return weights;
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const tilted = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value * (tilt[key] ?? 1)]));
  const tiltedTotal = Object.values(tilted).reduce((sum, value) => sum + value, 0);
  return Object.freeze(Object.fromEntries(Object.entries(tilted).map(([key, value]) => [key, value * total / tiltedTotal])));
}
function presetFloor(floor, preset) {
  const value = Number(floor) + routingPreset(preset).floorDelta;
  return Math.max(0.5, Math.min(0.97, value));
}

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
  // Agentic Coding is a different task family, not silently a Coding score.
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
  const row = snapshot?.models?.[normalized(model)] ?? null;
  return snapshot?.exactModelMatch === true && row?.model !== model ? null : row;
}

// .dsh-plugin/shared/assignment-solver.mjs
var EPSILON = 1e-12;
var compareText = (a, b2) => a < b2 ? -1 : a > b2 ? 1 : 0;
var signature = (state) => JSON.stringify(state.choices.map((option) => option.route));
function compareStates(left, right, minimizeCost = false) {
  return left.relaxedCount - right.relaxedCount || left.qualityShortfall - right.qualityShortfall || (minimizeCost ? left.cost - right.cost : right.score - left.score) || (minimizeCost ? right.score - left.score : left.cost - right.cost) || left.switches - right.switches || compareText(signature(left), signature(right));
}
function solveCandidateAssignments({ tasks = [], pools = [], budget = Infinity, beamWidth = 256, exactLimit = 4096, handoffPenalty = 0.015, minimizeCost = false } = {}) {
  if (!tasks.length || tasks.length !== pools.length) return null;
  const preceding = /* @__PURE__ */ new Set();
  for (const task of tasks) {
    if (!task.id || preceding.has(task.id) || (task.dependsOn ?? []).some((id2) => !preceding.has(id2))) {
      throw new RangeError("Assignment tasks must have unique ids and known dependencies in topological order");
    }
    preceding.add(task.id);
  }
  const constrained = Number.isFinite(budget);
  const options = pools.map((pool) => (Array.isArray(pool) ? pool : []).filter((option) => Number.isFinite(option.cost) && option.cost >= 0 && Number.isFinite(option.score) && (!constrained || option.pricingKnown === true)));
  if (options.some((pool) => pool.length === 0)) return null;
  const suffixMinimum = Array(tasks.length + 1).fill(0);
  let searchSpace = 1;
  let searchSpaceCapped = false;
  for (let index = tasks.length - 1; index >= 0; index--) {
    suffixMinimum[index] = suffixMinimum[index + 1] + Math.min(...options[index].map((option) => option.cost));
    const product = searchSpace * options[index].length;
    if (product > Number.MAX_SAFE_INTEGER) searchSpaceCapped = true;
    searchSpace = Math.min(Number.MAX_SAFE_INTEGER, product);
  }
  if (constrained && suffixMinimum[0] > budget + EPSILON) return null;
  const exact = !searchSpaceCapped && searchSpace <= Math.max(1, exactLimit);
  const width = Math.max(1, Math.floor(beamWidth) || 256);
  const search = { method: exact ? "exact" : "beam", exact, searchSpace, searchSpaceCapped, expandedStates: 0, beamPruned: 0 };
  let states = [{ choices: [], routesByTask: /* @__PURE__ */ new Map(), score: 0, cost: 0, switches: 0, relaxedCount: 0, qualityShortfall: 0 }];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const expanded = [];
    for (const state of states) {
      for (const option of options[index]) {
        const cost = state.cost + option.cost;
        if (constrained && cost + suffixMinimum[index + 1] > budget + EPSILON) continue;
        const switches = (task.dependsOn ?? []).reduce((count, dependency) => {
          const route = state.routesByTask.get(dependency);
          return count + (route !== void 0 && route !== option.route ? 1 : 0);
        }, 0);
        const penalty = switches * handoffPenalty;
        const shortfall = Math.max(0, Number(option.qualityShortfall) || 0);
        const routesByTask2 = new Map(state.routesByTask);
        routesByTask2.set(task.id, option.route);
        expanded.push({
          choices: [...state.choices, { ...option, handoffPenalty: penalty }],
          routesByTask: routesByTask2,
          score: state.score + option.score - penalty,
          cost,
          switches: state.switches + switches,
          relaxedCount: state.relaxedCount + (shortfall > 0 ? 1 : 0),
          qualityShortfall: state.qualityShortfall + shortfall
        });
        search.expandedStates++;
      }
    }
    if (!expanded.length) return null;
    expanded.sort((left, right) => compareStates(left, right, minimizeCost));
    if (!exact && expanded.length > width) {
      states = expanded.slice(0, width);
      if (constrained && index < tasks.length - 1) {
        const cheapest = expanded.reduce((best2, state) => compareStates(state, best2, true) < 0 ? state : best2);
        if (!states.includes(cheapest)) states[width - 1] = cheapest;
      }
      search.beamPruned += expanded.length - states.length;
    } else states = expanded;
  }
  states.sort((left, right) => compareStates(left, right, minimizeCost));
  const best = states[0];
  const { routesByTask, ...result } = best;
  return { ...result, minimumCostLowerBound: suffixMinimum[0], search };
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
function classifyTask(text7) {
  const value = String(text7 ?? "");
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
function detectTaskTypes(text7) {
  const value = String(text7 ?? "");
  const ranked = TASK_TYPE_RULES.map(([type, pattern]) => ({
    type,
    signals: value.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))?.length ?? 0
  })).filter((item) => item.signals > 0);
  ranked.sort((left, right) => right.signals - left.signals || left.type.localeCompare(right.type));
  return ranked.map((item) => item.type);
}
function assessComplexity(text7) {
  const value = String(text7 ?? "");
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
  const base = asScore(row?.liveScores?.[taskType]) ?? asScore(row?.liveOverall) ?? row?.metadata?.quality ?? row?.baseQuality ?? row?.quality ?? 0;
  return row?.qualityBias ? clamp(base + row.qualityBias) : base;
}
function qualitySourceForTask(row, taskType) {
  return asScore(row?.liveScores?.[taskType]) !== void 0 || asScore(row?.liveOverall) !== void 0 ? "livebench" : row?.fallbackQualitySource ?? row?.qualitySource ?? "unknown";
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
var COST_REFERENCE_PRICING = Object.freeze({ input: 1, output: 5, cacheRead: 1, cacheWrite: 1, currency: "USD" });
function estimateCost(model, text7, outputTokens = 900, pricingOverrides = {}, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const pricing = pricingFor(model, pricingOverrides);
  if (pricing === null) return null;
  const inputTokens = Math.max(80, Math.ceil(String(text7 ?? "").length / 3.7));
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
function taskTokenBudget(text7, task, complexity, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const inputTokens = Math.max(80, Math.ceil(String(text7 ?? "").length / 3.7));
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
function explicitRequirements(text7) {
  const visibleLines = [];
  let fence = null;
  for (const line of String(text7 ?? "").split(/\r?\n/u)) {
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
var CN_DIGITS = Object.freeze({ \u4E00: 1, \u4E8C: 2, \u4E24: 2, \u4E09: 3, \u56DB: 4, \u4E94: 5, \u516D: 6, \u4E03: 7, \u516B: 8, \u4E5D: 9, \u5341: 10 });
var stepNumber = (token) => {
  const value = String(token ?? "").trim();
  if (/^\d{1,2}$/u.test(value)) return Number(value);
  if (/^十[一二三四五六七八九]?$/u.test(value)) return 10 + (CN_DIGITS[value[1]] ?? 0);
  if (/^[一二两三四五六七八九]十?$/u.test(value)) return CN_DIGITS[value[0]] * (value.length === 2 ? 10 : 1);
  return null;
};
var STEP_TOKEN = "(?:\\d{1,2}|[\u4E00\u4E8C\u4E24\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341]{1,2})";
var STEP_LIST = `${STEP_TOKEN}(?:\\s*(?:[\u3001,\uFF0C/]|\u548C|\u4E0E|\u53CA|\u4EE5\u53CA|and|&|-|~|\u5230|\u81F3)\\s*(?:\u7B2C\\s*)?${STEP_TOKEN})*`;
var STEP_REFERENCE_PATTERNS = Object.freeze([
  // 依赖第 1 步 / 基于第 2、3 步 / 根据步骤 1 / 在第 2 步完成后 / 第 1 步之后
  new RegExp(`(?:\u4F9D\u8D56|\u4F9D\u9760|\u53D6\u51B3\u4E8E|\u57FA\u4E8E|\u6839\u636E|\u627F\u63A5|\u4F7F\u7528|\u5229\u7528|\u9700\u8981|\u7B49\u5F85|\u5F85)(?:\u4E8E)?\\s*(?:\u7B2C\\s*(${STEP_LIST})\\s*(?:\u6B65|\u9879|\u4E2A?\u6B65\u9AA4|\u6761)|\u6B65\u9AA4\\s*(${STEP_LIST}))`, "giu"),
  new RegExp(`(?:\u5728|\u7B49)?\\s*\u7B2C\\s*(${STEP_LIST})\\s*(?:\u6B65|\u9879|\u4E2A?\u6B65\u9AA4|\u6761)(?:\u5B8C\u6210|\u7ED3\u675F|\u505A\u5B8C)?(?:\u4E4B\u540E|\u4EE5\u540E|\u540E)`, "giu"),
  new RegExp(`\u6B65\u9AA4\\s*(${STEP_LIST})\\s*(?:\u5B8C\u6210|\u7ED3\u675F)?(?:\u4E4B\u540E|\u4EE5\u540E|\u540E)`, "giu"),
  // depends on step 1 / after steps 1 and 2 / based on step #2 / requires step 3
  new RegExp(`(?:depends?\\s+on|depending\\s+on|after|based\\s+on|builds?\\s+on|requires?|using(?:\\s+the\\s+output\\s+of)?)\\s+(?:the\\s+(?:result|output)s?\\s+of\\s+)?(?:steps?|items?|#)\\s*#?(${STEP_LIST})`, "giu")
]);
function explicitStepReferences(objective) {
  const found = /* @__PURE__ */ new Set();
  const value = String(objective ?? "");
  for (const pattern of STEP_REFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const list = match.slice(1).find(Boolean) ?? "";
      const parts = list.split(/\s*(?:[、,，/]|和|与|及|以及|and|&)\s*/iu);
      for (const part of parts) {
        const range = /^(.+?)\s*(?:-|~|到|至)\s*(?:第\s*)?(.+)$/u.exec(part);
        if (range) {
          const from = stepNumber(range[1]);
          const to = stepNumber(range[2]);
          if (from && to && to >= from && to - from < 20) for (let step2 = from; step2 <= to; step2 += 1) found.add(step2);
          continue;
        }
        const step = stepNumber(part.replace(/^第\s*/u, ""));
        if (step) found.add(step);
      }
    }
  }
  return [...found].sort((a, b2) => a - b2);
}
function taskPackages(taskType, text7, band) {
  if (band !== "complex") {
    const task = { id: "execution", name: "\u76F4\u63A5\u56DE\u7B54\u4E0E\u5FC5\u8981\u6821\u9A8C", type: taskType, purpose: "execution", difficulty: band, criticality: 0.65, dependsOn: [], preferredReasoningEffort: band === "simple" ? "low" : "medium" };
    return [{ ...task, qualityFloor: taskQualityFloor(band, task) }];
  }
  const value = String(text7 ?? "");
  const packages = [
    { id: "analysis", name: "\u95EE\u9898\u5EFA\u6A21\u4E0E\u7EA6\u675F\u63D0\u53D6", type: "reasoning", purpose: "analysis", difficulty: "balanced", criticality: 0.8, dependsOn: [], preferredReasoningEffort: "medium" }
  ];
  const requirements = explicitRequirements(text7);
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
      const groupOf = (step) => requirements.length > MAX_EXPLICIT_EXECUTION_PACKAGES && step >= MAX_EXPLICIT_EXECUTION_PACKAGES ? MAX_EXPLICIT_EXECUTION_PACKAGES - 1 : step - 1;
      const explicit = [...new Set(group.flatMap((item) => explicitStepReferences(item)).map(groupOf))].filter((target) => target >= 0 && target < index).map((target) => `execution-${target + 1}`);
      const sequential = explicit.length === 0 && /^(?:最后|然后|接着|随后|再|基于|根据|测试|验证|部署|发布)|(?:完成|结束|实现)后/u.test(objective);
      packages.push({
        id: `execution-${index + 1}`,
        name: group.length === 1 ? `\u9700\u6C42 ${index + 1}\uFF1A${group[0].slice(0, 28)}` : `\u9700\u6C42 ${index + 1}\uFF1A\u5176\u4F59 ${group.length} \u9879`,
        objective,
        type,
        purpose: "execution",
        difficulty,
        criticality: difficulty === "simple" ? 0.55 : difficulty === "balanced" ? 0.72 : 0.86,
        dependsOn: explicit.length ? ["analysis", ...explicit] : sequential && previous?.purpose === "execution" ? ["analysis", previous.id] : ["analysis"],
        preferredReasoningEffort: difficulty === "simple" ? "low" : difficulty === "balanced" ? "medium" : "high"
      });
    });
  } else {
    const domains = [...new Set([...detectTaskTypes(text7), taskType].filter((type) => type !== "general"))];
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
  if (task.weights) return task.weights;
  return task.purpose === "synthesis" ? SYNTHESIS_WEIGHTS : OBJECTIVE_WEIGHTS[task.difficulty] ?? weights;
}
function compareText2(left, right) {
  const a = String(left);
  const b2 = String(right);
  return a < b2 ? -1 : a > b2 ? 1 : 0;
}
function compareRowsStable(left, right) {
  return compareText2(routeKey(left.provider, left.model), routeKey(right.provider, right.model));
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
    return reasoningEffortRank(left) - reasoningEffortRank(right) || compareText2(left, right);
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
function candidateUtility(row, task, weights, cacheReadRatio = 0, cacheWriteRatio = 0, text7 = "", complexity = "balanced") {
  const quality = qualityForTask(row, task.type);
  const rawPreference = row.preferenceAdjustments?.[task.type];
  const preferenceAdjustment = Number.isFinite(rawPreference) ? clamp(rawPreference, -0.1, 0.1) : 0;
  const floor = Number(task.qualityFloor ?? taskQualityFloor("complex", task));
  const qualityGap = Math.max(0, floor - quality);
  const reasoning = reasoningDecision(row, task);
  const reference = taskCost({ pricing: COST_REFERENCE_PRICING, reasoningKnown: true, reasoningEfforts: [] }, task, text7, complexity, cacheReadRatio, cacheWriteRatio);
  const cost = row.pricing === null ? 0 : 1 / (1 + taskCost(row, task, text7, complexity, cacheReadRatio, cacheWriteRatio) / Math.max(reference, 1e-12));
  const score = weights.quality * quality + weights.cost * cost + weights.latency * (1 - clamp(row.latency * reasoning.multiplier.latency)) + weights.specialty * specialtyForTask(row, task.type) + (weights.reasoning ?? 0) * reasoning.reasoningFit - weights.risk * row.risk - qualityGap * (task.criticality ?? 0.75) + preferenceAdjustment;
  return { score, floor, qualityGap, preferenceAdjustment, ...reasoning };
}
function taskCost(row, task, text7, complexity, cacheReadRatio = 0, cacheWriteRatio = 0) {
  if (row?.pricing === null) return 0;
  const decision = row === null ? null : reasoningDecision(row, task);
  const tokens = taskTokenBudget(text7, { ...task, reasoningEffort: decision?.reasoningEffort }, complexity, cacheReadRatio, cacheWriteRatio);
  return row === null ? 0 : ((tokens.inputTokens - tokens.cacheReadTokens - tokens.cacheWriteTokens) * row.pricing.input + tokens.cacheReadTokens * row.pricing.cacheRead + tokens.cacheWriteTokens * row.pricing.cacheWrite + tokens.outputTokens * row.pricing.output) / 1e6;
}
function dominates(left, right, task, text7, complexity, cacheReadRatio, cacheWriteRatio) {
  if (left.pricing === null || right.pricing === null) return false;
  const leftReasoning = reasoningDecision(left, task);
  const rightReasoning = reasoningDecision(right, task);
  const leftValues = {
    quality: qualityForTask(left, task.type),
    cost: taskCost(left, task, text7, complexity, cacheReadRatio, cacheWriteRatio),
    latency: clamp(left.latency * leftReasoning.multiplier.latency),
    specialty: specialtyForTask(left, task.type),
    reasoning: leftReasoning.reasoningFit,
    risk: clamp(left.risk)
  };
  const rightValues = {
    quality: qualityForTask(right, task.type),
    cost: taskCost(right, task, text7, complexity, cacheReadRatio, cacheWriteRatio),
    latency: clamp(right.latency * rightReasoning.multiplier.latency),
    specialty: specialtyForTask(right, task.type),
    reasoning: rightReasoning.reasoningFit,
    risk: clamp(right.risk)
  };
  const noWorse = leftValues.quality >= rightValues.quality && leftValues.cost <= rightValues.cost && leftValues.latency <= rightValues.latency && leftValues.specialty >= rightValues.specialty && leftValues.reasoning >= rightValues.reasoning && leftValues.risk <= rightValues.risk;
  const strictlyBetter = leftValues.quality > rightValues.quality || leftValues.cost < rightValues.cost || leftValues.latency < rightValues.latency || leftValues.specialty > rightValues.specialty || leftValues.reasoning > rightValues.reasoning || leftValues.risk < rightValues.risk;
  return noWorse && strictlyBetter;
}
function eligibleRowsForTask(rows, task) {
  return task.type === "vision" ? rows.filter((row) => row.inputModalities.length === 0 || row.inputModalities.includes("image")) : rows;
}
function candidatePool(rows, task, weights, text7, complexity, cacheReadRatio, cacheWriteRatio, dependencySensitive = false) {
  const eligibleRows = eligibleRowsForTask(rows, task);
  const floor = Number(task.qualityFloor ?? 0);
  const feasible = eligibleRows.filter((row) => qualityForTask(row, task.type) >= floor);
  const source = feasible.length > 0 ? feasible : eligibleRows.slice().sort((left, right) => qualityForTask(right, task.type) - qualityForTask(left, task.type) || compareRowsStable(left, right)).slice(0, 3);
  const taskWeights = weightsForTask(weights, task);
  const scored = source.map((row) => ({
    row,
    decision: candidateUtility(row, task, taskWeights, cacheReadRatio, cacheWriteRatio, text7, complexity),
    cost: taskCost(row, task, text7, complexity, cacheReadRatio, cacheWriteRatio)
  }));
  const frontier = dependencySensitive ? scored : scored.filter((item) => !scored.some((other) => other !== item && other.decision.score >= item.decision.score && dominates(other.row, item.row, task, text7, complexity, cacheReadRatio, cacheWriteRatio)));
  const essential = [
    scored.filter((item) => item.row.pricing !== null).sort((left, right) => left.cost - right.cost || compareRowsStable(left.row, right.row))[0],
    scored.slice().sort((left, right) => right.decision.score - left.decision.score || compareRowsStable(left.row, right.row))[0],
    scored.slice().sort((left, right) => qualityForTask(right.row, task.type) - qualityForTask(left.row, task.type) || compareRowsStable(left.row, right.row))[0]
  ].filter(Boolean);
  const all = [...frontier, ...essential].filter((item, index, all2) => all2.findIndex((candidate) => candidate.row === item.row) === index).sort((left, right) => right.decision.score - left.decision.score || left.cost - right.cost || compareRowsStable(left.row, right.row));
  const anchors = [...new Set(essential)];
  const ordered = [...anchors, ...all.filter((item) => !anchors.includes(item))].slice(0, ROUTING_CANDIDATE_LIMIT).sort((left, right) => right.decision.score - left.decision.score || left.cost - right.cost || compareRowsStable(left.row, right.row));
  return {
    options: ordered,
    relaxed: feasible.length === 0,
    pruned: Math.max(0, scored.length - all.length),
    filtered: Math.max(0, eligibleRows.length - source.length),
    truncated: Math.max(0, all.length - ordered.length),
    dependencySensitive
  };
}
function solveAssignments({ rows, tasks, weights, text: text7, complexity, budget, cacheReadRatio, cacheWriteRatio, minimizeCost = false }) {
  const dependencySensitive = tasks.some((task) => (task.dependsOn ?? []).length > 0);
  const pools = tasks.map((task) => candidatePool(rows, task, weights, text7, complexity, cacheReadRatio, cacheWriteRatio, dependencySensitive));
  const result = solveCandidateAssignments({ tasks, pools: pools.map((pool, index) => pool.options.map((option) => ({
    route: routeKey(option.row.provider, option.row.model),
    score: option.decision.score,
    cost: option.cost,
    qualityShortfall: Math.max(0, option.decision.floor - qualityForTask(option.row, tasks[index].type)),
    pricingKnown: option.row.pricing !== null,
    payload: option
  }))), budget, beamWidth: ROUTING_BEAM_WIDTH, minimizeCost });
  if (!result) return null;
  return {
    ...result,
    assignments: result.choices.map((choice, index) => ({
      task: tasks[index],
      row: choice.payload.row,
      decision: { ...choice.payload.decision, relaxed: choice.qualityShortfall > 0 },
      estimatedCost: choice.cost,
      handoffPenalty: choice.handoffPenalty
    })),
    usedRoutes: new Set(result.choices.map((choice) => choice.route)),
    candidatePools: pools,
    minimumFeasibleCost: result.minimumCostLowerBound
  };
}
function buildPlan({ text: text7 = "", available = [], mode = "collective", pricing = {}, liveBench = null, liveBenchError = "", dataVersions = null, learning = null, budgetUsd = 0, cacheReadRatio = 0, cacheWriteRatio = 0, preset = DEFAULT_ROUTING_PRESET } = {}) {
  const presetId = normalizeRoutingPreset(preset);
  const firstLine = String(text7 ?? "").split(/\r?\n/u)[0].trim();
  const transformOnly = /^(?:请|帮我)?(?:总结|概括|翻译|摘要|解释)(?:以下|下列|下面|这份|这些)/u.test(firstLine) && !/(?:执行|完成|实施|分配)/u.test(firstLine);
  const assessed = assessComplexity(transformOnly ? firstLine : text7);
  const requirements = explicitRequirements(text7);
  const compound = shouldSplitRequirements(requirements);
  const complexity = compound && assessed.band !== "complex" ? { value: Math.max(0.66, assessed.value), band: "complex" } : assessed;
  const taskType = classifyTask(transformOnly ? firstLine : text7);
  const weights = presetWeights(OBJECTIVE_WEIGHTS[complexity.band], presetId);
  const discovered = Array.isArray(available) ? available.map((entry) => {
    const rawEfforts = Array.isArray(entry.reasoningEfforts) ? entry.reasoningEfforts : [];
    const reasoningEfforts = rawEfforts.map((effort) => String(effort?.id ?? effort ?? "")).filter(Boolean);
    return {
      provider: String(entry.provider ?? ""),
      model: String(entry.model ?? ""),
      benchmarkModel: typeof entry.benchmarkModel === "string" ? entry.benchmarkModel : void 0,
      reasoningEfforts: [...new Set(reasoningEfforts)],
      defaultReasoningEffort: entry.defaultReasoningEffort === void 0 ? void 0 : String(entry.defaultReasoningEffort),
      reasoningKnown: entry.reasoningKnown === true || entry.reasoningKnown === void 0 && Array.isArray(entry.reasoningEfforts),
      quality: asScore(entry.quality),
      qualityBias: Number.isFinite(entry.qualityBias) ? clamp(entry.qualityBias, -0.05, 0.05) : 0,
      preferenceAdjustments: entry.preferenceAdjustments ?? null,
      qualitySource: entry.qualitySource === "user" ? "user" : "route",
      latency: asScore(entry.latency),
      risk: asScore(entry.risk),
      specialties: Array.isArray(entry.specialties) ? entry.specialties.filter((item) => typeof item === "string") : null,
      pricing: normalizePricing({ route: entry.pricing ?? entry.price }).route ?? null,
      pricingSource: entry.pricingSource === "user" ? "user" : entry.pricingSource === "dynamic" ? "dynamic" : "route",
      pricingVersion: entry.pricingVersion ?? null,
      snapshotAsOf: entry.snapshotAsOf ?? null,
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
    const live = liveBenchRow(liveBench, route.benchmarkModel ?? route.model);
    const liveScores = live?.scores ?? {};
    const liveOverall = live?.overallSource === "explicit" || live?.overallSource === void 0 && Object.keys(liveScores).length === 0 ? asScore(live?.overall) : void 0;
    const baseQuality = asScore(metadata.quality) ?? 0;
    const quality = clamp((asScore(liveScores?.[taskType]) ?? liveOverall ?? baseQuality) + route.qualityBias);
    const fallbackQualitySource = route.quality !== void 0 ? route.qualitySource : catalog ? "catalog-heuristic" : "unknown";
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
      baseQuality,
      fallbackQualitySource,
      qualityBias: route.qualityBias,
      preferenceAdjustments: route.preferenceAdjustments,
      qualitySource,
      pricingSource,
      pricingVersion: route.pricingVersion,
      snapshotAsOf: route.snapshotAsOf,
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
      }, text7, 900, {}, cacheReadRatio, cacheWriteRatio)
    });
  }
  const taskNodes = taskPackages(taskType, text7, complexity.band).map((task) => presetId === DEFAULT_ROUTING_PRESET ? task : {
    ...task,
    qualityFloor: presetFloor(task.qualityFloor, presetId),
    weights: presetWeights(weightsForTask(weights, task), presetId)
  });
  const unassignableTasks = taskNodes.filter((task) => task.type === "vision" && !rows.some((row) => row.inputModalities.length === 0 || row.inputModalities.includes("image"))).map((task) => task.id);
  const budget = Number(budgetUsd);
  const utilityPlan = solveAssignments({
    rows,
    tasks: taskNodes,
    weights,
    text: text7,
    complexity: complexity.band,
    budget: Number.POSITIVE_INFINITY,
    cacheReadRatio,
    cacheWriteRatio
  });
  const budgetPlan = budget > 0 ? solveAssignments({
    rows,
    tasks: taskNodes,
    weights,
    text: text7,
    complexity: complexity.band,
    budget,
    cacheReadRatio,
    cacheWriteRatio
  }) : null;
  const minimumCostPlan = budget > 0 && budgetPlan === null ? solveAssignments({
    rows,
    tasks: taskNodes,
    weights,
    text: text7,
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
    row.score = candidateUtility(row, taskNodes[0] ?? { type: taskType, qualityFloor: QUALITY_FLOORS[complexity.band] }, weights, cacheReadRatio, cacheWriteRatio, text7, complexity.band).score;
    if (row.pricing !== null && taskNodes[0]) row.estimatedCost = taskCost(row, taskNodes[0], text7, complexity.band, cacheReadRatio, cacheWriteRatio);
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
    qualitySource: qualitySourceForTask(row, task.type),
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
    const tokens = taskTokenBudget(text7, { ...task, reasoningEffort: decision?.reasoningEffort }, complexity.band, cacheReadRatio, cacheWriteRatio);
    const taskEstimate = estimatedCost ?? taskCost(row, task, text7, complexity.band, cacheReadRatio, cacheWriteRatio);
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
      quality: qualitySourceForTask(row, task.type) === "unknown" || row === null ? null : Number(qualityForTask(row, task.type).toFixed(3)),
      qualitySource: qualitySourceForTask(row, task.type),
      pricingSource: row?.pricingSource ?? "unknown",
      handoffPenalty: Number(Number(handoffPenalty ?? 0).toFixed(3))
    };
  });
  const pricingComplete = assignments.length > 0 && assignments.every(({ row }) => row?.pricing !== null);
  const totalEstimate = pricingComplete ? assignments.reduce((sum, { task, row, estimatedCost }) => sum + (estimatedCost ?? taskCost(row, task, text7, complexity.band, cacheReadRatio, cacheWriteRatio)), 0) : null;
  const baselineRows = assignments.map(({ task }) => {
    const strongest = eligibleRowsForTask(rows, task).reduce((best, row) => qualityForTask(row, task.type) > (best === null ? -1 : qualityForTask(best, task.type)) ? row : best, null);
    return { task, strongest };
  });
  const baselineCost = baselineRows.every((item) => item.strongest?.pricing !== null && item.strongest !== null) ? baselineRows.reduce((sum, { task, strongest }) => sum + taskCost(strongest, task, text7, complexity.band, cacheReadRatio, cacheWriteRatio), 0) : null;
  const qualityEvidenceComplete = assignments.length > 0 && assignments.every(({ row, task }) => ["livebench", "route", "user"].includes(qualitySourceForTask(row, task.type))) && baselineRows.every(({ strongest, task }) => ["livebench", "route", "user"].includes(qualitySourceForTask(strongest, task.type)));
  const budgetExceeded = Number(budgetUsd) > 0 && totalEstimate !== null ? totalEstimate > Number(budgetUsd) : null;
  const savings = baselineCost === null || totalEstimate === null || !qualityEvidenceComplete ? null : baselineCost <= 0 ? 0 : clamp((baselineCost - totalEstimate) / baselineCost);
  const paretoPruned = (optimized?.candidatePools ?? []).reduce((sum, pool) => sum + pool.pruned, 0);
  const minimumFeasibleCost = rows.every((row) => row.pricing !== null) ? optimized?.minimumFeasibleCost ?? minimumCostPlan?.cost ?? 0 : null;
  const reason = selected === null ? unassignableTasks.length > 0 ? `\u56FE\u50CF\u5DE5\u4F5C\u5305 ${unassignableTasks.join("\u3001")} \u6CA1\u6709\u53EF\u7528\u7684\u56FE\u50CF\u6A21\u578B\uFF0C\u65E0\u6CD5\u5F62\u6210\u5B8C\u6574\u5206\u914D\u8BA1\u5212\u3002` : "\u5C1A\u672A\u53D1\u73B0\u53EF\u7528\u6A21\u578B\uFF0C\u4FDD\u7559 Harness \u539F\u59CB\u6A21\u578B\u9009\u62E9\u3002" : `${complexity.band === "simple" ? "\u4F4E\u590D\u6742\u5EA6\u4F18\u5148\u6210\u672C\u3001\u54CD\u5E94\u901F\u5EA6\u4E0E\u8F83\u4F4E\u63A8\u7406\u5F00\u9500" : complexity.band === "balanced" ? "\u5728\u8D28\u91CF\u3001\u6210\u672C\u3001\u63A8\u7406\u7B49\u7EA7\u3001\u5EF6\u8FDF\u4E0E\u98CE\u9669\u4E4B\u95F4\u5E73\u8861" : "\u9AD8\u590D\u6742\u5EA6\u6267\u884C\u5305\u542B\u63A8\u7406\u7B49\u7EA7\u7684\u4F9D\u8D56\u611F\u77E5\u7EA6\u675F\u5206\u914D"}\uFF1B\u4EFB\u52A1\u7C7B\u578B\u4E3A ${taskType}\uFF0C${String(subtasks.length)} \u4E2A\u5DE5\u4F5C\u5305\u91C7\u7528${optimized?.search?.exact ? "\u4FDD\u7559\u5019\u9009\u7A7A\u95F4\u5185\u7684\u7CBE\u786E\u641C\u7D22" : "\u4FDD\u7559\u5019\u9009\u7A7A\u95F4\u5185\u7684\u6709\u754C\u8FD1\u4F3C\u641C\u7D22"}\u3002\u8D28\u91CF\u5206\u4E0E\u95E8\u69DB\u662F\u672A\u6821\u51C6\u7684\u4F30\u8BA1\uFF0C\u4E0D\u662F\u7B54\u5BF9\u6982\u7387\u3002`;
  return {
    mode,
    preset: presetId,
    complexity: { value: Number(complexity.value.toFixed(3)), band: complexity.band },
    compound,
    unassignableTasks,
    taskType,
    taskTypes: [...new Set(taskNodes.map((task) => task.type).filter((type) => type !== "reasoning"))],
    objectiveWeights: weights,
    candidates: rows.slice(0, 8).map((row) => {
      const decision = candidateUtility(row, taskNodes[0] ?? { type: taskType, qualityFloor: QUALITY_FLOORS[complexity.band], preferredReasoningEffort: complexity.band === "simple" ? "low" : "medium" }, weights, cacheReadRatio, cacheWriteRatio, text7, complexity.band);
      return { provider: row.provider, model: row.model, score: Number(row.score.toFixed(3)), preferenceAdjustment: decision.preferenceAdjustment, quality: row.qualitySource === "unknown" ? null : Number(row.quality.toFixed(3)), qualitySource: row.qualitySource, specialty: Number(row.specialty.toFixed(3)), reasoningEffort: decision.reasoningEffort, preferredReasoningEffort: decision.preferredReasoningEffort, reasoningFit: Number(decision.reasoningFit.toFixed(3)), reasoningKnown: row.reasoningKnown, reasoningEfforts: row.reasoningEfforts, estimatedCost: row.estimatedCost === null ? null : Number(row.estimatedCost.toFixed(6)), inputPrice: row.pricing?.input ?? null, outputPrice: row.pricing?.output ?? null, pricingSource: row.pricingSource, pricingVersion: row.pricingVersion, pricingAsOf: row.snapshotAsOf };
    }),
    selected: selected === null ? null : { provider: selected.provider, model: selected.model, reasoningEffort: selectedAssignment?.decision?.reasoningEffort, estimatedCost: selected.estimatedCost === null ? null : Number(selected.estimatedCost.toFixed(6)), qualitySource: qualitySourceForTask(selected, selectedAssignment?.task.type ?? taskType), pricingSource: selected.pricingSource },
    subtasks,
    synthesizer: synthesizer == null ? null : { provider: synthesizer.provider, model: synthesizer.model, reasoningEffort: synthesizerAssignment?.decision?.reasoningEffort },
    // Preserve precision for downstream budget gates; formatting belongs to UI.
    estimatedCost: totalEstimate,
    costBreakdown,
    optimization: {
      dataVersions,
      personalization: learning ? {
        policyVersion: learning.policyVersion,
        revision: learning.revision,
        enabled: learning.enabled,
        scope: learning.scope,
        window: learning.window,
        feedbackCount: learning.feedbackCount,
        effectiveWeight: learning.effectiveWeight,
        halfLifeDays: learning.halfLifeDays,
        priorWeight: learning.priorWeight,
        maxAdjustment: learning.maxAdjustment,
        resetAt: learning.resetAt,
        semantics: "subjective-utility-not-objective-quality"
      } : null,
      solver: "dependency-safe quality-constrained exact/beam assignment",
      qualitySemantics: "uncalibrated-surrogate",
      costUtility: { method: "1/(1+estimated-task-cost/reference-task-cost)", referencePricing: COST_REFERENCE_PRICING },
      search: optimized?.search ?? null,
      optimalityScope: "retained-candidates-and-surrogate-objective",
      candidateTruncated: (optimized?.candidatePools ?? []).reduce((sum, pool) => sum + pool.truncated, 0),
      qualityFiltered: (optimized?.candidatePools ?? []).reduce((sum, pool) => sum + pool.filtered, 0),
      localParetoDisabled: (optimized?.candidatePools ?? []).some((pool) => pool.dependencySensitive),
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
      liveBench: liveBench?.fetchedAt ?? liveBench?.verifiedAt ? { source: liveBench.source ?? "livebench", fetchedAt: liveBench.fetchedAt ?? liveBench.verifiedAt, verifiedAt: liveBench.verifiedAt ?? liveBench.fetchedAt, publishedAt: liveBench.publishedAt ?? null, version: liveBench.version ?? null, models: Object.keys(liveBench.models ?? {}).length, stale: String(liveBenchError).length > 0, error: String(liveBenchError || "") } : { source: "experimental-baseline", fetchedAt: null, models: 0, stale: false, error: String(liveBenchError || "") }
    },
    reason,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// .dsh-plugin/shared/harness-plan.mjs
var clean2 = (value) => typeof value === "string" ? value.trim() : "";
var HEADLESS_TOOL_IDS = /* @__PURE__ */ new Set(["claude-code", "codex", "gemini"]);
function channelForProvider(provider, installedToolIds = [], runnableToolIds = [], route = null, loggedOutToolIds = []) {
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
  if (installed && Array.isArray(loggedOutToolIds) && loggedOutToolIds.includes(tool.id)) {
    return {
      kind: "harness-llm",
      preference,
      tool: tool.id,
      label: tool.label,
      loginRequired: true,
      detail: `${tool.label} \u5DF2\u5B89\u88C5\u4F46\u672A\u767B\u5F55\uFF08\u5F00\u7BB1\u4F53\u68C0\u7ED3\u679C\uFF09\uFF1B\u5B9E\u9645\u8C03\u7528\u76F4\u63A5\u4F7F\u7528\u6A21\u578B\u76EE\u5F55 API\uFF0C\u4E0D\u7B49\u5F85 CLI \u5931\u8D25\u3002`
    };
  }
  const runnable = installed && Array.isArray(runnableToolIds) && runnableToolIds.includes(tool.id);
  const headless = installed && HEADLESS_TOOL_IDS.has(tool.id);
  if (runnable || headless) {
    return {
      kind: "official-cli",
      preference,
      tool: tool.id,
      label: tool.label,
      detail: tool.id === "zcode" ? "ZCode \u5DF2\u5B89\u88C5\uFF0C\u63D2\u4EF6\u53EF\u8C03\u7528\u5176\u5B98\u65B9\u7F16\u7A0B\u4EE3\u7406\uFF1B\u5176 CLI \u4F7F\u7528\u81EA\u8EAB\u914D\u7F6E\u7684\u9ED8\u8BA4\u6A21\u578B\uFF0C\u4E0D\u80FD\u4FDD\u8BC1\u4E0E Harness \u5EFA\u8BAE\u6A21\u578B\u4E00\u81F4\u3002" : headless && !runnable ? `${tool.label} \u5DF2\u5B89\u88C5\u3002\u5206\u914D\u5230\u8BE5\u6A21\u578B\u7684\u4EFB\u52A1\u4F1A\u5148\u8D70\u5B98\u65B9\u65E0\u754C\u9762\u547D\u4EE4\uFF1B\u547D\u4EE4\u7F3A\u5931\u6216\u5931\u8D25\u65F6\u56DE\u9000\u6A21\u578B\u76EE\u5F55 API\u3002` : `${tool.label} \u5DF2\u5B89\u88C5\uFF0C\u63D2\u4EF6\u53EF\u6258\u7BA1\u8C03\u7528\u5176\u5B98\u65B9 CLI\uFF1BHarness \u6A21\u578B\u76EE\u5F55\u4E0E\u5382\u5546 CLI \u540D\u79F0\u53EF\u80FD\u4E0D\u540C\uFF0C\u56E2\u961F\u65E0\u6CD5\u786E\u8BA4\u6620\u5C04\u65F6\u4F7F\u7528 CLI \u9ED8\u8BA4\u6A21\u578B\uFF0C\u5B9E\u9645\u6A21\u578B\u4ECD\u987B\u6838\u5BF9\u8FD0\u884C\u8BB0\u5F55\u3002`
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
    ...channel.loginRequired ? { loginRequired: true } : {},
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
  liveBenchError = "",
  dataVersions = null,
  learning = null,
  cacheReadRatio = 0,
  cacheWriteRatio = 0,
  directProvider = "",
  directModel = "",
  preset = "balanced",
  loggedOutToolIds = []
} = {}) {
  const taskText = clean2(task);
  if (!taskText) throw new Error("task must contain text");
  const requestedDirect = mode === "direct" || clean2(directProvider) !== "" || clean2(directModel) !== "";
  const selectedMode = mode === "team" ? "team" : "single";
  let routes = Array.isArray(availableRoutes) ? availableRoutes : [];
  let directRoute = null;
  if (requestedDirect) {
    const provider = clean2(directProvider);
    const model = clean2(directModel);
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
    if (!channelCache.has(key)) channelCache.set(key, channelForProvider(provider, installedIds, runnableToolIds, route, loggedOutToolIds));
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
    liveBenchError,
    dataVersions,
    learning,
    cacheReadRatio,
    cacheWriteRatio,
    preset
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
    qualityNotice: plan.optimization.qualityEvidenceComplete ? "\u6A21\u578B\u8D28\u91CF\u4F7F\u7528\u5DF2\u63D0\u4F9B\u8BC4\u5206\u6216\u57FA\u51C6\u6570\u636E\u4F30\u8BA1\uFF1B\u5206\u6570\u4E0E\u95E8\u69DB\u4E0D\u662F\u7B54\u5BF9\u6982\u7387\uFF0C\u4E5F\u4E0D\u4FDD\u8BC1\u5B9E\u9645\u8D28\u91CF\uFF0C\u4ECD\u9700\u72EC\u7ACB\u4EFB\u52A1\u9A8C\u8BC1\u3002" : "\u90E8\u5206\u6A21\u578B\u8D28\u91CF\u7F3A\u5C11\u53EF\u6838\u9A8C\u8BC4\u5206\uFF1B\u76EE\u5F55\u542F\u53D1\u5F0F\u53EA\u4F9B\u9009\u62E9\u53C2\u8003\uFF0C\u8D28\u91CF\u95E8\u69DB\u548C\u8282\u7701\u6BD4\u4F8B\u65E0\u6CD5\u4FDD\u8BC1\u3002",
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

// .dsh-plugin/shared/run-ledger.mjs
var finite = (value) => typeof value === "number" && Number.isFinite(value);
var routeKey2 = (provider, model) => `${String(provider ?? "")}\0${String(model ?? "")}`;
var MAX_SPENDING_DAYS = 90;
var MAX_SPENDING_MONTHS = 24;
function periodSpending(value) {
  const amount = (field2) => finite(value?.[field2]) && value[field2] >= 0 ? value[field2] : 0;
  return {
    costUsd: amount("costUsd"),
    unknown: Math.floor(amount("unknown")),
    subscriptionUsd: amount("subscriptionUsd"),
    subscriptionRuns: Math.floor(amount("subscriptionRuns"))
  };
}
function sanitizeArchivedSpending(value) {
  const periods = (entries, pattern, limit) => Object.fromEntries(Object.entries(entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {}).filter(([key, entry]) => pattern.test(key) && entry && typeof entry === "object" && !Array.isArray(entry)).sort(([left], [right]) => left.localeCompare(right)).slice(-limit).map(([key, entry]) => [key, periodSpending(entry)]));
  return {
    days: periods(value?.days, /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/, MAX_SPENDING_DAYS),
    months: periods(value?.months, /^\d{4}-(?:0[1-9]|1[0-2])$/, MAX_SPENDING_MONTHS)
  };
}
function formatUsd(value) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(4)}` : "\u2014";
}
function budgetCheck({ estimateUsd = null, spent = { today: 0, month: 0 }, dailyLimitUsd = 0, monthlyLimitUsd = 0 } = {}) {
  const limits = [];
  if (finite(dailyLimitUsd) && dailyLimitUsd > 0) limits.push({ period: "daily", label: "\u4ECA\u65E5", limit: dailyLimitUsd, spent: spent.today ?? 0 });
  if (finite(monthlyLimitUsd) && monthlyLimitUsd > 0) limits.push({ period: "monthly", label: "\u672C\u6708", limit: monthlyLimitUsd, spent: spent.month ?? 0 });
  const estimateKnown = finite(estimateUsd);
  const remaining = limits.length ? Math.max(0, Math.min(...limits.map((item) => item.limit - item.spent))) : null;
  const exceeded = limits.find((item) => item.spent >= item.limit || estimateKnown && item.spent + estimateUsd > item.limit) ?? null;
  return {
    limited: limits.length > 0,
    estimateKnown,
    estimateUsd: estimateKnown ? estimateUsd : null,
    remainingUsd: remaining,
    exceeded: exceeded ? exceeded.period : null,
    message: exceeded ? `${exceeded.label}\u9884\u7B97 ${formatUsd(exceeded.limit)}\uFF0C\u5DF2\u7528 ${formatUsd(exceeded.spent)}${estimateKnown ? `\uFF0C\u672C\u6B21\u9884\u4F30 ${formatUsd(estimateUsd)}` : ""}\uFF0C\u5C06\u8D85\u51FA\u4E0A\u9650\u3002` : limits.length && !estimateKnown ? "\u90E8\u5206\u8DEF\u7EBF\u7F3A\u5C11\u5355\u4EF7\uFF0C\u65E0\u6CD5\u9884\u4F30\u672C\u6B21\u8D39\u7528\uFF1B\u4EC5\u5728\u5DF2\u7528\u91D1\u989D\u8FBE\u5230\u4E0A\u9650\u65F6\u963B\u6B62\u3002" : ""
  };
}
function applyQualityBiases(routes, biases) {
  if (!biases || typeof biases !== "object") return routes;
  return (Array.isArray(routes) ? routes : []).map((route) => {
    const bias = biases[routeKey2(route.provider, route.model)];
    return finite(bias) && bias !== 0 ? { ...route, qualityBias: bias } : route;
  });
}

// .dsh-plugin/shared/adaptive-feedback.mjs
var finite2 = (value) => typeof value === "number" && Number.isFinite(value);
var clean3 = (value) => typeof value === "string" ? value.trim() : "";
var routeKey3 = (provider, model) => `${provider}\0${model}`;
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function applyFeedbackProfile(routes, profile) {
  if (!Array.isArray(routes) || !record(profile) || typeof profile.enabled !== "boolean") return routes;
  return routes.map((route) => {
    if (!record(route)) return route;
    let base = route;
    if (Object.hasOwn(route, "preferenceAdjustments") || Object.hasOwn(route, "preferenceAdjustmentMeta")) {
      base = { ...route };
      delete base.preferenceAdjustments;
      delete base.preferenceAdjustmentMeta;
    }
    if (profile.enabled !== true || !record(profile.adjustments)) return base;
    const key = routeKey3(clean3(route.provider), clean3(route.model));
    if (!Object.hasOwn(profile.adjustments, key)) return base;
    const value = profile.adjustments[key];
    if (!record(value)) return base;
    const limit = finite2(profile.maxAdjustment) && profile.maxAdjustment >= 0 && profile.maxAdjustment <= 0.1 ? profile.maxAdjustment : 0.1;
    const adjustments = Object.fromEntries(Object.entries(value).filter(([, bias]) => finite2(bias) && Math.abs(bias) <= limit));
    if (!Object.keys(adjustments).length) return base;
    return {
      ...base,
      preferenceAdjustments: adjustments,
      preferenceAdjustmentMeta: {
        policyVersion: profile.policyVersion,
        revision: profile.revision,
        scope: profile.scope,
        feedbackCount: profile.feedbackCount,
        effectiveWeight: profile.effectiveWeight,
        updatedAt: profile.updatedAt,
        halfLifeDays: profile.halfLifeDays,
        maxAdjustment: profile.maxAdjustment,
        window: profile.window,
        cellStats: Object.hasOwn(profile.cellStats ?? {}, key) ? profile.cellStats[key] : {},
        evaluatedAt: profile.evaluatedAt,
        decayRefreshMs: profile.decayRefreshMs,
        revisionSemantics: profile.revisionSemantics
      }
    };
  });
}

// .dsh-plugin/shared/dynamic-data-view.mjs
var exactRouteKey = (route) => `${String(route?.provider ?? "")}\0${String(route?.model ?? "")}`;
function applyPricingSnapshot(routes, snapshot) {
  if (snapshot?.kind !== "pricing" || !snapshot.prices || typeof snapshot.prices !== "object") return routes;
  return (Array.isArray(routes) ? routes : []).map((route) => {
    if (route?.pricingSource === "user") return route;
    const entry = snapshot.prices[exactRouteKey(route)];
    if (!entry) return route;
    return {
      ...route,
      pricing: {
        input: entry.input,
        output: entry.output,
        currency: "USD",
        ...entry.cacheRead === void 0 ? {} : { cacheRead: entry.cacheRead },
        ...entry.cacheWrite === void 0 ? {} : { cacheWrite: entry.cacheWrite }
      },
      pricingSource: "dynamic",
      pricingVersion: snapshot.version,
      snapshotAsOf: entry.asOf
    };
  });
}

// .dsh-plugin/client/catalog.mjs
var clean4 = (value) => typeof value === "string" ? value.trim() : "";
function routesFromModelCatalog(catalog) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  const routable = new Set(Array.isArray(catalog?.routableProviders) ? catalog.routableProviders : []);
  const routes = [];
  const seen = /* @__PURE__ */ new Set();
  for (const group of groups) {
    const provider = clean4(group?.id);
    if (!provider || !routable.has(provider)) continue;
    for (const entry of Array.isArray(group.models) ? group.models : []) {
      const model = clean4(entry?.id);
      if (!model) continue;
      const key = `${provider}\0${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reasoning = entry?.reasoning;
      const efforts = Array.isArray(reasoning?.efforts) ? [...new Set(reasoning.efforts.map((item) => clean4(item?.id ?? item)).filter(Boolean))] : [];
      routes.push({
        provider,
        providerName: clean4(group.name) || provider,
        model,
        name: clean4(entry.name) || model,
        reasoningKnown: reasoning !== void 0 && reasoning !== null,
        reasoningEfforts: efforts,
        ...clean4(reasoning?.defaultEffort) ? { defaultReasoningEffort: clean4(reasoning.defaultEffort) } : {},
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
  const profiled = applyModelProfiles(routesFromModelCatalog(catalog), parseModelProfilesJson(options.modelProfilesJson ?? "[]"));
  const priced = applyPricingSnapshot(profiled, options.pricingSnapshot ?? null);
  const routes = options.learning ? applyFeedbackProfile(priced, options.learning) : applyQualityBiases(priced, options.qualityBiases ?? null);
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
    benchmarkModel: profile?.benchmarkModel ?? "",
    execution: profile?.execution === "official" || profile?.execution === "api" ? profile.execution : "auto",
    billing: BILLING_MODES.includes(profile?.billing) ? profile.billing : DEFAULT_BILLING_MODE,
    subscription: ["plan-key", "cli-login", "none"].includes(profile?.subscription) ? profile.subscription : "auto",
    apiRoute: profile?.apiRoute ? profileRouteKey(profile.apiRoute) : ""
  };
}
function profileFromDraft(route, draft) {
  const provider = field(route?.provider);
  const model = field(route?.model);
  if (!provider || !model) throw new Error("\u8BF7\u5148\u4ECE\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u9009\u62E9\u4E00\u6761\u51C6\u786E\u7684\u6A21\u578B\u8DEF\u7EBF\u3002");
  const profile = { provider, model };
  const benchmarkModel = field(draft?.benchmarkModel);
  if (benchmarkModel) profile.benchmarkModel = benchmarkModel;
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
  const billing = field(draft?.billing) || DEFAULT_BILLING_MODE;
  if (!BILLING_MODES.includes(billing)) throw new Error("\u8BA1\u8D39\u65B9\u5F0F\u53EA\u80FD\u662F\u8BA2\u9605\u4F18\u5148\u3001\u53EA\u7528 API Key \u6216\u53EA\u7528\u8BA2\u9605\u3002");
  if (billing !== DEFAULT_BILLING_MODE) profile.billing = billing;
  const subscription = field(draft?.subscription) || "auto";
  if (!["auto", "plan-key", "cli-login", "none"].includes(subscription)) throw new Error("\u8BA2\u9605\u6765\u6E90\u53EA\u80FD\u662F\u81EA\u52A8\u3001\u7F16\u7A0B\u5957\u9910 Key\u3001CLI \u8D26\u53F7\u767B\u5F55\u6216\u65E0\u8BA2\u9605\u3002");
  if (subscription !== "auto") profile.subscription = subscription;
  const apiKey = String(draft?.apiRoute ?? "");
  if (apiKey) {
    if (subscription !== "plan-key") throw new Error("\u53EA\u6709\u201C\u7F16\u7A0B\u5957\u9910 Key\u201D\u8DEF\u7EBF\u9700\u8981\u9009\u62E9\u56DE\u9000\u7684 API \u8DEF\u7EBF\u3002");
    const [apiProvider, apiModel] = apiKey.split("\0");
    if (!field(apiProvider) || !field(apiModel)) throw new Error("\u56DE\u9000 API \u8DEF\u7EBF\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002");
    if (field(apiProvider) === provider && field(apiModel) === model) throw new Error("\u56DE\u9000 API \u8DEF\u7EBF\u4E0D\u80FD\u662F\u5957\u9910\u8DEF\u7EBF\u672C\u8EAB\u3002");
    profile.apiRoute = { provider: field(apiProvider), model: field(apiModel) };
  }
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
  const routeKey4 = route ? profileRouteKey(route) : "";
  const rawJson = snapshot.value?.modelProfilesJson ?? "[]";
  let profiles = [];
  let loadError = "";
  try {
    profiles = parseModelProfilesJson(rawJson);
  } catch (error) {
    loadError = messageOf(error);
  }
  const saved = profiles.find((item) => profileRouteKey(item) === routeKey4);
  const pending = drafts[routeKey4];
  const draft = pending?.fields ?? profileDraft(saved);
  const writable = snapshot.status === "ready" && snapshot.writable === true && !saving && !loadError;
  const unmatched = profiles.filter((item) => !routes.some((route2) => profileRouteKey(route2) === profileRouteKey(item))).length;
  const edit = (name, value) => {
    if (!route || !writable) return;
    setDrafts((previous) => {
      const previousEntry = previous[routeKey4] ?? { fields: profileDraft(saved), baseRevision: snapshot.revision };
      return { ...previous, [routeKey4]: { ...previousEntry, fields: { ...previousEntry.fields, [name]: value } } };
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
        delete next[routeKey4];
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
      delete next[routeKey4];
      return next;
    });
    setNotice(null);
  };
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "mr-card mr-profile-card", "aria-label": "\u9010\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u914D\u7F6E" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("h2", { className: "mr-card-title" }, "\u9010\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B"), /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-card-copy" }, "\u9009\u62E9\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u51C6\u786E\u8DEF\u7EBF\uFF0C\u586B\u5199\u4F60\u638C\u63E1\u7684\u8D28\u91CF\u8BC4\u5206\u4E0E\u5355\u4EF7\u3002\u914D\u7F6E\u7531\u4F60\u63D0\u4F9B\uFF0C\u63D2\u4EF6\u4E0D\u4F1A\u8BFB\u53D6\u8D26\u53F7\u5BC6\u94A5\u3002"))), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-card-body" }, loadError && /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-error", role: "alert" }, "\u5DF2\u6709\u914D\u7F6E\u65E0\u6CD5\u89E3\u6790\uFF1A", loadError, "\u3002\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u9875\u4FEE\u6B63 JSON\u3002"), snapshot.status !== "ready" && /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-caption" }, "\u8BBE\u7F6E\u72B6\u6001\uFF1A", snapshot.status === "loading" ? "\u6B63\u5728\u52A0\u8F7D" : "\u5F53\u524D\u4E0D\u53EF\u7528"), snapshot.status === "ready" && !snapshot.writable && /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-error", role: "status" }, "\u5F53\u524D\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\uFF0C\u8BF7\u5728\u53EF\u5199\u7684\u672C\u673A\u73AF\u5883\u914D\u7F6E\u3002"), routes.length === 0 ? /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-empty" }, "\u8BF7\u5148\u5728 DeepSeek Harness \u7684\u201C\u6A21\u578B\u201D\u9875\u6DFB\u52A0\u6A21\u578B\uFF0C\u518D\u8FD4\u56DE\u8FD9\u91CC\u586B\u5199\u4EF7\u683C\u4E0E\u80FD\u529B\u3002") : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-label", htmlFor: "mr-profile-route" }, "\u6A21\u578B\u8DEF\u7EBF"), /* @__PURE__ */ import_react.default.createElement("select", { className: "mr-input", id: "mr-profile-route", value: routeKey4, onChange: (event) => {
    setSelected(event.target.value);
    setNotice(null);
  } }, routes.map((item) => /* @__PURE__ */ import_react.default.createElement("option", { key: profileRouteKey(item), value: profileRouteKey(item) }, item.provider, "/", item.model))), /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-caption mr-profile-state" }, saved ? `\u5DF2\u914D\u7F6E${saved.pricing ? "\u5355\u4EF7" : "\u80FD\u529B\uFF0C\u4EF7\u683C\u672A\u77E5"}` : "\u672A\u914D\u7F6E\uFF0C\u4EF7\u683C\u4E0E\u8D28\u91CF\u6765\u6E90\u672A\u77E5", pending ? " \xB7 \u5F53\u524D\u6709\u672A\u4FDD\u5B58\u8F93\u5165" : "", unmatched > 0 ? ` \xB7 \u53E6\u6709 ${unmatched} \u6761\u914D\u7F6E\u4E0D\u5728\u5F53\u524D\u6A21\u578B\u76EE\u5F55\u4E2D\uFF0C\u4FDD\u5B58\u65F6\u4F1A\u4FDD\u7559` : ""), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-profile-grid" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8D28\u91CF\u8BC4\u5206\uFF080\u2013100\uFF0C\u81EA\u62A5\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", max: "100", step: "any", value: draft.quality, disabled: !writable, onChange: (event) => edit("quality", event.target.value), placeholder: "\u4F8B\u5982 85\uFF1B\u7559\u7A7A\u8868\u793A\u672A\u77E5" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8F93\u5165\u5355\u4EF7\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.input, disabled: !writable, onChange: (event) => edit("input", event.target.value), placeholder: "\u7559\u7A7A\u8868\u793A\u672A\u77E5" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8F93\u51FA\u5355\u4EF7\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.output, disabled: !writable, onChange: (event) => edit("output", event.target.value), placeholder: "\u7559\u7A7A\u8868\u793A\u672A\u77E5" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u64C5\u957F\u65B9\u5411\uFF08\u82F1\u6587\u6807\u7B7E\uFF0C\u9017\u53F7\u5206\u9694\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "text", value: draft.specialties, disabled: !writable, onChange: (event) => edit("specialties", event.target.value), placeholder: PROFILE_SPECIALTY_HINT })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u5B98\u65B9 CLI \u6A21\u578B\u540D\uFF08\u53EF\u9009\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "text", value: draft.cliModel, disabled: !writable, onChange: (event) => edit("cliModel", event.target.value), placeholder: "\u4EC5\u5728\u5382\u5546 CLI \u652F\u6301\u8BE5\u51C6\u786E\u540D\u79F0\u65F6\u586B\u5199" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "LiveBench \u51C6\u786E\u6A21\u578B\u540D\u79F0\uFF08\u53EF\u9009\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "text", value: draft.benchmarkModel ?? "", disabled: !writable, onChange: (event) => edit("benchmarkModel", event.target.value), placeholder: "\u786E\u8BA4\u7248\u672C\u4E0E\u63A8\u7406\u6863\u4F4D\u4E00\u81F4\uFF1B\u4E0D\u81EA\u52A8\u731C\u6D4B\u522B\u540D" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u6267\u884C\u65B9\u5F0F"), /* @__PURE__ */ import_react.default.createElement("select", { className: "mr-input", value: draft.execution || "auto", disabled: !writable, onChange: (event) => edit("execution", event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "auto" }, "\u81EA\u52A8\uFF1A\u5DF2\u5B89\u88C5\u5219\u7528\u5B98\u65B9\u5DE5\u5177\uFF0C\u5931\u8D25\u56DE\u9000 API"), /* @__PURE__ */ import_react.default.createElement("option", { value: "official" }, "\u5B98\u65B9\u5DE5\u5177\uFF1A\u5931\u8D25\u6216\u672A\u5B89\u88C5\u65F6\u56DE\u9000 API"), /* @__PURE__ */ import_react.default.createElement("option", { value: "api" }, "\u4EC5\u6A21\u578B\u76EE\u5F55 API"))), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8BA1\u8D39\u65B9\u5F0F"), /* @__PURE__ */ import_react.default.createElement("select", { className: "mr-input", value: draft.billing, disabled: !writable, onChange: (event) => edit("billing", event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "subscription-first" }, "\u8BA2\u9605\u4F18\u5148\uFF1A\u989D\u5EA6\u7528\u5C3D\u6216\u9650\u6D41\u65F6\u5207\u6362 API Key"), /* @__PURE__ */ import_react.default.createElement("option", { value: "api-only" }, "\u53EA\u7528 API Key"), /* @__PURE__ */ import_react.default.createElement("option", { value: "subscription-only" }, "\u53EA\u7528\u8BA2\u9605\uFF1A\u989D\u5EA6\u7528\u5C3D\u65F6\u4E0D\u5207\u6362"))), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u8BA2\u9605\u6765\u6E90"), /* @__PURE__ */ import_react.default.createElement("select", { className: "mr-input", value: draft.subscription, disabled: !writable, onChange: (event) => edit("subscription", event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "auto" }, "\u81EA\u52A8\uFF1A\u6709\u5B98\u65B9 CLI \u65F6\u7528 CLI \u8D26\u53F7\u767B\u5F55"), /* @__PURE__ */ import_react.default.createElement("option", { value: "plan-key" }, "\u7F16\u7A0B\u5957\u9910 Key\uFF1A\u8BE5\u8DEF\u7EBF\u672C\u8EAB\u662F\u5957\u9910\u7AEF\u70B9"), /* @__PURE__ */ import_react.default.createElement("option", { value: "cli-login" }, "\u5B98\u65B9 CLI \u8D26\u53F7\u767B\u5F55"), /* @__PURE__ */ import_react.default.createElement("option", { value: "none" }, "\u65E0\u8BA2\u9605\uFF1A\u59CB\u7EC8\u6309 API \u8BA1\u8D39"))), draft.subscription === "plan-key" && /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u989D\u5EA6\u7528\u5C3D\u65F6\u56DE\u9000\u7684 API \u8DEF\u7EBF"), /* @__PURE__ */ import_react.default.createElement("select", { className: "mr-input", value: draft.apiRoute, disabled: !writable, onChange: (event) => edit("apiRoute", event.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "\u4E0D\u56DE\u9000\uFF08\u672A\u914D\u7F6E API \u8DEF\u7EBF\uFF09"), routes.filter((item) => profileRouteKey(item) !== routeKey4).map((item) => /* @__PURE__ */ import_react.default.createElement("option", { key: profileRouteKey(item), value: profileRouteKey(item) }, item.provider, "/", item.model))))), /* @__PURE__ */ import_react.default.createElement("details", { className: "mr-profile-advanced" }, /* @__PURE__ */ import_react.default.createElement("summary", null, "\u7F13\u5B58\u5355\u4EF7\uFF08\u53EF\u9009\uFF09"), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-profile-grid" }, /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u7F13\u5B58\u8BFB\u53D6\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.cacheRead, disabled: !writable, onChange: (event) => edit("cacheRead", event.target.value), placeholder: "\u7559\u7A7A\u6309\u666E\u901A\u8F93\u5165\u4EF7\u683C\u4F30\u7B97" })), /* @__PURE__ */ import_react.default.createElement("label", { className: "mr-profile-field" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u7F13\u5B58\u5199\u5165\uFF08USD / \u767E\u4E07 token\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { className: "mr-input", type: "number", min: "0", step: "any", value: draft.cacheWrite, disabled: !writable, onChange: (event) => edit("cacheWrite", event.target.value), placeholder: "\u7559\u7A7A\u6309\u666E\u901A\u8F93\u5165\u4EF7\u683C\u4F30\u7B97" })))), /* @__PURE__ */ import_react.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "mr-button", type: "button", disabled: !writable || !pending, onClick: () => {
    void write(false);
  } }, saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u6B64\u6A21\u578B"), /* @__PURE__ */ import_react.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !pending || saving, onClick: reload }, "\u91CD\u65B0\u52A0\u8F7D\u6B64\u8DEF\u7EBF"), saved && /* @__PURE__ */ import_react.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !writable, onClick: () => {
    void write(true);
  } }, "\u5220\u9664\u6B64\u6A21\u578B\u914D\u7F6E")), notice && /* @__PURE__ */ import_react.default.createElement("p", { className: notice.tone === "error" ? "mr-error" : "mr-profile-success", role: notice.tone === "error" ? "alert" : "status" }, notice.text), /* @__PURE__ */ import_react.default.createElement("p", { className: "mr-caption" }, "\u8D28\u91CF\u8BC4\u5206\u548C\u4EF7\u683C\u90FD\u662F\u7528\u6237\u63D0\u4F9B\u7684\u4F30\u503C\u3002\u672A\u586B\u5199\u5355\u4EF7\u65F6\u663E\u793A\u201C\u4EF7\u683C\u5F85\u914D\u7F6E\u201D\uFF1B\u9884\u7B97\u53EA\u5F71\u54CD\u672C\u5730\u89C4\u5212\uFF0C\u4E0D\u9650\u5236\u5B9E\u9645\u8D26\u5355\u3002CLI \u6A21\u578B\u540D\u987B\u4E0E\u5382\u5546\u5DE5\u5177\u6838\u5BF9\u3002\u6267\u884C\u65B9\u5F0F\u51B3\u5B9A\u8BE5\u6A21\u578B\u6536\u5230\u4EFB\u52A1\u65F6\u8D70\u5B98\u65B9\u65E0\u754C\u9762\u5DE5\u5177\u8FD8\u662F\u6A21\u578B\u76EE\u5F55 API\uFF1B\u5B98\u65B9\u5DE5\u5177\u5931\u8D25\u65F6\u4ECD\u4F1A\u56DE\u9000 API\u3002\u8BA1\u8D39\u65B9\u5F0F\u9ED8\u8BA4\u8BA2\u9605\u4F18\u5148\uFF1A\u5148\u7528 CLI \u8D26\u53F7\u767B\u5F55\u6216\u7F16\u7A0B\u5957\u9910 Key \u8DEF\u7EBF\uFF0C\u8BA2\u9605\u989D\u5EA6\u7528\u5C3D\u6216\u9650\u6D41\u65F6\u540C\u4E00\u6B65\u9AA4\u81EA\u52A8\u6539\u7528 API Key\uFF0C\u5E76\u8BB0\u5165\u8FD0\u884C\u5386\u53F2\u3002"))));
}

// .dsh-plugin/shared/version-order.mjs
var VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]{1,64})?$/;
function compareReleaseVersions(left, right) {
  const parse = (value) => {
    const match = VERSION.exec(String(value ?? ""));
    return match ? { parts: match.slice(1, 4).map(Number), pre: String(value).includes("-") } : null;
  };
  const a = parse(left);
  const b2 = parse(right);
  if (!a || !b2) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b2.parts[index]) return a.parts[index] > b2.parts[index] ? 1 : -1;
  }
  if (a.pre !== b2.pre) return a.pre ? -1 : 1;
  return 0;
}

// .dsh-plugin/client/tool-install-state.mjs
function toolInstallAction({ tool, probe, readiness, job, probeStatus, latestVersion = null }) {
  const running = job?.status === "running";
  const installed = probe?.installed === true;
  const order = installed && latestVersion ? compareReleaseVersions(probe.version, latestVersion) : null;
  const desktop = tool.manager === "signed-windows-installer";
  const noRunner = desktop || tool.headlessAdapter === true;
  const repair = installed && !noRunner && readiness?.ready === false && order !== 0;
  const label = running ? "\u5B89\u88C5\u4E2D\u2026" : !installed ? job?.status === "failed" ? "\u91CD\u8BD5\u5B89\u88C5" : desktop ? "\u4E0B\u8F7D\u6700\u65B0\u5B89\u88C5\u5668" : "\u4E00\u952E\u5B89\u88C5\u6700\u65B0\u7248" : order === -1 ? `\u66F4\u65B0\u5230\u6700\u65B0\u7248 ${latestVersion}` : order === 1 ? "\u5DF2\u9AD8\u4E8E\u6700\u65B0\u6B63\u5F0F\u7248" : repair ? "\u4FEE\u590D\u5B98\u65B9\u6267\u884C\u5165\u53E3" : order === 0 ? "\u5DF2\u662F\u6700\u65B0\u7248\u672C" : "\u5B89\u88C5\u6700\u65B0\u7248";
  const current = order === 0;
  const interactive = probeStatus === "ready" || probeStatus === "refreshing";
  return {
    label,
    disabled: !interactive || running || installed && (order === 1 || current)
  };
}
function toolMaintenanceActions({ tool, probe, job, probeStatus, summary }) {
  const running = job?.status === "running";
  const installed = probe?.installed === true;
  const interactive = probeStatus === "ready" || probeStatus === "refreshing";
  const desktop = tool.manager === "signed-windows-installer";
  const busy = running || !interactive;
  return {
    repair: {
      label: "\u4E00\u952E\u4FEE\u590D",
      title: "\u7528\u540C\u4E00\u6761\u56FA\u5B9A\u5B98\u65B9\u5B89\u88C5\u547D\u4EE4\u91CD\u65B0\u5B89\u88C5\u4E00\u904D\uFF0C\u4FEE\u590D\u635F\u574F\u6216\u4E0D\u5B8C\u6574\u7684\u5B89\u88C5",
      disabled: busy || desktop || summary?.installable === false
    },
    uninstall: {
      label: "\u4E00\u952E\u5378\u8F7D",
      title: "\u53EA\u5220\u9664\u7A0B\u5E8F\u672C\u8EAB\uFF1B\u914D\u7F6E\u3001\u767B\u5F55\u4FE1\u606F\u548C\u5386\u53F2\u8BB0\u5F55\u4FDD\u7559",
      disabled: busy || desktop || !installed || summary?.removable === false
    }
  };
}
function installClickRefusal({ tool, submitting = false, running = false, operation = "install" } = {}) {
  if (!tool) return "\u672A\u77E5\u5B98\u65B9\u5DE5\u5177\uFF0C\u65E0\u6CD5\u5F00\u59CB\u5B89\u88C5\u3002";
  if (tool.unsupported) return String(tool.unsupportedReason ?? "").trim() || "\u6B64\u5DE5\u5177\u6682\u4E0D\u652F\u6301\u4E00\u952E\u5B89\u88C5\u3002";
  if (tool.manager === "signed-windows-installer" && operation !== "install") {
    return `${tool.label} \u7531\u5B98\u65B9\u7B7E\u540D\u684C\u9762\u5B89\u88C5\u5668\u5B89\u88C5\uFF0C\u8BF7\u5728\u7CFB\u7EDF\u201C\u5E94\u7528\u201D\u4E2D\u5378\u8F7D\u5B83\u3002`;
  }
  if (submitting || running) {
    return operation === "uninstall" ? "\u8BE5\u5DE5\u5177\u6B63\u5728\u5378\u8F7D\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u4EFB\u52A1\u7ED3\u675F\u3002" : operation === "repair" ? "\u8BE5\u5DE5\u5177\u6B63\u5728\u4FEE\u590D\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u4EFB\u52A1\u7ED3\u675F\u3002" : "\u8BE5\u5DE5\u5177\u6B63\u5728\u5B89\u88C5\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u4EFB\u52A1\u7ED3\u675F\u3002";
  }
  return "";
}
function payloadError(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
  const message = payload.error?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  return fallback;
}
function acceptedInstallJob(response) {
  const fallback = "\u5B89\u88C5\u4EFB\u52A1\u672A\u88AB\u63A5\u53D7\u3002";
  if (!response || typeof response !== "object") return { job: null, error: fallback };
  let payload = response;
  if (payload.ok === false) return { job: null, error: payloadError(payload, fallback) };
  if (payload.ok === true && payload.value && typeof payload.value === "object") {
    payload = payload.value;
    if (payload.ok === false) return { job: null, error: payloadError(payload, fallback) };
    if (payload.ok === true && payload.value && typeof payload.value === "object") payload = payload.value;
  }
  if (payload.accepted === true && payload.job && typeof payload.job === "object") return { job: payload.job, error: "" };
  return { job: null, error: payloadError(payload, fallback) };
}
function shouldApplyInstallStatus(localJob, remoteJob) {
  if (!remoteJob || typeof remoteJob !== "object") return false;
  const localStarted = typeof localJob?.startedAt === "string" ? localJob.startedAt : "";
  const remoteStarted = typeof remoteJob.startedAt === "string" ? remoteJob.startedAt : "";
  if (!localStarted || !remoteStarted) return true;
  return remoteStarted >= localStarted;
}

// .dsh-plugin/client/router-insights.jsx
var import_react2 = __toESM(require("react"), 1);

// .dsh-plugin/client/insights-state.mjs
var PACKAGE_STATUS = Object.freeze({
  pending: Object.freeze({ label: "\u5F85\u6267\u884C", tone: "pending" }),
  succeeded: Object.freeze({ label: "\u5B98\u65B9 CLI \u5B8C\u6210", tone: "ok" }),
  fallback: Object.freeze({ label: "\u5DF2\u56DE\u9000 API \u5B8C\u6210", tone: "warn" }),
  failed: Object.freeze({ label: "\u5931\u8D25", tone: "error" }),
  blocked: Object.freeze({ label: "\u4F9D\u8D56\u672A\u5B8C\u6210", tone: "blocked" }),
  cancelled: Object.freeze({ label: "\u5DF2\u53D6\u6D88", tone: "blocked" }),
  paused: Object.freeze({ label: "\u7B49\u5F85\u786E\u8BA4", tone: "warn" }),
  waiting: Object.freeze({ label: "\u7B49\u5F85\u4E0A\u6E38\u786E\u8BA4", tone: "blocked" })
});
function packageStatus(item) {
  if (item?.status === "succeeded" && item.channel === "harness-llm") return { label: "API \u5B8C\u6210", tone: "ok" };
  return PACKAGE_STATUS[item?.status] ?? PACKAGE_STATUS.pending;
}
function dagLayers(packages) {
  const list = Array.isArray(packages) ? packages : [];
  const byId = new Map(list.map((item) => [item.id, item]));
  const depth = /* @__PURE__ */ new Map();
  const visit = (id2, trail = /* @__PURE__ */ new Set()) => {
    if (depth.has(id2)) return depth.get(id2);
    if (trail.has(id2) || !byId.has(id2)) return -1;
    trail.add(id2);
    const deps = (byId.get(id2).dependsOn ?? []).map((dep) => visit(dep, trail));
    const value = deps.length ? Math.max(...deps) + 1 : 0;
    depth.set(id2, Math.max(0, value));
    return depth.get(id2);
  };
  list.forEach((item) => visit(item.id));
  const layers = [];
  for (const item of list) {
    const level = depth.get(item.id) ?? 0;
    (layers[level] ?? (layers[level] = [])).push(item);
  }
  return layers.filter(Boolean);
}
var LOGIN_LABEL = Object.freeze({ "logged-in": "\u5DF2\u767B\u5F55", "logged-out": "\u672A\u767B\u5F55", unknown: "\u767B\u5F55\u72B6\u6001\u672A\u77E5" });
var VERSION_LABEL = Object.freeze({ latest: "\u5DF2\u662F\u6700\u65B0\u7248", "update-available": "\u6709\u65B0\u7248\u672C", unknown: "\u6700\u65B0\u7248\u672C\u672A\u77E5" });
var UNTESTED_VERSION_NOTE = "\u63D2\u4EF6\u4E0D\u518D\u56FA\u5B9A\u5B98\u65B9\u5DE5\u5177\u7248\u672C\uFF0C\u5B89\u88C5\u548C\u66F4\u65B0\u90FD\u53D6\u5404\u5382\u5546\u7684\u6700\u65B0\u7248\uFF1B\u65B0\u7248\u672C\u672A\u7ECF\u63D2\u4EF6\u6D4B\u8BD5\uFF0C\u8F93\u51FA\u683C\u5F0F\u53D8\u5316\u65F6\u63D2\u4EF6\u4F1A\u5C3D\u91CF\u517C\u5BB9\uFF0C\u9047\u5230\u95EE\u9898\u8BF7\u53CD\u9988\u3002";
function versionLine(entry) {
  if (!entry?.installed) return "";
  const installed = entry.version ? `\u5DF2\u5B89\u88C5 ${entry.version}` : "\u5DF2\u5B89\u88C5\uFF08\u7248\u672C\u672A\u77E5\uFF09";
  if (!entry.latestVersion) return `${installed} \xB7 ${VERSION_LABEL.unknown}`;
  return entry.versionStatus === "update-available" ? `${installed} \xB7 \u6700\u65B0 ${entry.latestVersion}\uFF08\u6709\u65B0\u7248\u672C\uFF0C\u53EF\u5728\u4E0B\u65B9\u66F4\u65B0\uFF09` : `${installed} \xB7 ${VERSION_LABEL.latest}`;
}
function healthSummary(tools) {
  const list = Array.isArray(tools) ? tools : [];
  const installed = list.filter((item) => item.installed);
  return {
    total: list.length,
    installed: installed.length,
    ready: installed.filter((item) => item.login?.state === "logged-in").length,
    loggedOut: installed.filter((item) => item.login?.state === "logged-out").length,
    unknown: installed.filter((item) => item.login?.state === "unknown").length,
    updates: installed.filter((item) => item.versionStatus === "update-available").length
  };
}
var money = formatUsd;
function budgetMeter(spent, limit) {
  if (!(limit > 0)) return { limited: false, share: 0, text: `${money(spent)}\uFF08\u672A\u8BBE\u4E0A\u9650\uFF09` };
  const share = Math.min(1, Math.max(0, spent / limit));
  return { limited: true, share, over: spent >= limit, text: `${money(spent)} / ${money(limit)}` };
}
function planBudget(ledger, estimateUsd) {
  if (!ledger?.budget) return null;
  return budgetCheck({
    estimateUsd,
    spent: ledger.spent ?? { today: 0, month: 0 },
    dailyLimitUsd: ledger.budget.dailyLimitUsd,
    monthlyLimitUsd: ledger.budget.monthlyLimitUsd
  });
}
function unwrapRemote(response, fallback) {
  if (!response?.ok) throw new Error(String(response?.error?.message ?? "") || fallback);
  const inner = response.value;
  if (inner && typeof inner === "object" && "ok" in inner && !inner.ok) {
    const error = inner.error;
    throw new Error(String((error && typeof error === "object" ? error.message : error) ?? "") || fallback);
  }
  return inner && typeof inner === "object" && "ok" in inner ? inner.value : inner;
}
var RUN_KIND_LABEL = Object.freeze({ assign: "\u8DEF\u7531\u6267\u884C", team: "\u56E2\u961F\u6267\u884C", tool: "\u5355\u5DE5\u5177\u8C03\u7528" });
var RUN_STATUS_LABEL = Object.freeze({
  completed: "\u5B8C\u6210",
  partial: "\u90E8\u5206\u5B8C\u6210",
  failed: "\u5931\u8D25",
  "cli-completed": "\u5B8C\u6210",
  incomplete: "\u672A\u5B8C\u6210",
  paused: "\u7B49\u5F85\u786E\u8BA4",
  "integration-pending": "\u5F85\u6574\u5408",
  blocked: "\u88AB\u963B\u6B62",
  cancelled: "\u5DF2\u53D6\u6D88",
  pending: "\u5F85\u6267\u884C"
});
function packageCost(item) {
  if (item?.billing === "subscription") {
    return {
      budget: "\u4E0D\u8BA1\u5165\u9884\u7B97",
      reference: item.referenceCostUsd !== null && item.referenceCostUsd !== void 0 ? `\u8BA2\u9605\u53C2\u8003\u8D39\u7528 ${money(item.referenceCostUsd)}\uFF08\u6309 API \u4EF7\u6298\u7B97\uFF09` : "\u8BA2\u9605\u767B\u5F55\uFF0C\u672A\u56DE\u62A5\u53EF\u6298\u7B97\u7684\u7528\u91CF"
    };
  }
  if (item?.costUsd !== null && item?.costUsd !== void 0) {
    return { budget: `${money(item.costUsd)}${item.costSource === "cli-reported" ? "\uFF08CLI \u81EA\u62A5\uFF09" : ""}`, reference: null };
  }
  return { budget: item?.ran ? "\u8D39\u7528\u672A\u77E5" : "\u2014", reference: null };
}
function priorAttemptTotals(run) {
  const months = sanitizeArchivedSpending(run?.priorAttemptSpending).months;
  const totals = { budgetUsd: 0, referenceUsd: 0, unknownCalls: 0, subscriptionRuns: 0 };
  for (const period of Object.values(months)) {
    totals.budgetUsd += period.costUsd;
    totals.referenceUsd += period.subscriptionUsd;
    totals.unknownCalls += period.unknown;
    totals.subscriptionRuns += period.subscriptionRuns;
  }
  return totals;
}
function runTotals(run) {
  const items = [...run?.packages ?? [], ...run?.reviews ?? []];
  const prior = priorAttemptTotals(run);
  let budgetUsd = prior.budgetUsd;
  let referenceUsd = prior.referenceUsd;
  let subscription = prior.subscriptionRuns > 0;
  for (const item of items) {
    if (item.billing === "subscription") {
      subscription = true;
      if (typeof item.referenceCostUsd === "number") referenceUsd += item.referenceCostUsd;
    } else if (typeof item.costUsd === "number") budgetUsd += item.costUsd;
  }
  return { budgetUsd, referenceUsd, subscription };
}
function rerunSupport(run) {
  if (run?.kind === "tool") {
    const editable = run.executionMode === "workspace-write";
    return {
      supported: true,
      writes: editable,
      reassign: false,
      reason: "",
      confirm: editable ? "\u91CD\u8DD1\u4F1A\u5728\u65B0\u7684\u72EC\u7ACB Git \u5DE5\u4F5C\u6811\u4E2D\u518D\u6B21\u6267\u884C\u8FD9\u6B21\u53EF\u7F16\u8F91\u8C03\u7528\uFF0C\u6210\u529F\u540E\u628A\u6539\u52A8\u6574\u5408\u56DE\u5DE5\u4F5C\u533A\uFF08\u5DE5\u4F5C\u533A\u987B\u4E3A\u5E72\u51C0\u7684 Git \u4ED3\u5E93\uFF09\u3002" : ""
    };
  }
  if (run?.kind === "team" && run.executionMode === "workspace-write") {
    if (!["incomplete", "cancelled"].includes(run.status)) {
      return { supported: false, writes: true, reassign: false, reason: run.status === "integration-pending" ? "\u6539\u52A8\u5C1A\u5F85\u4EBA\u5DE5\u6574\u5408\uFF08\u72EC\u7ACB\u5DE5\u4F5C\u533A\u5DF2\u4FDD\u7559\uFF09\uFF0C\u4E0D\u80FD\u5355\u6B65\u91CD\u8DD1\uFF1B\u8BF7\u5148\u6838\u5BF9\u5E76\u6574\u5408\uFF0C\u518D\u5728\u4F1A\u8BDD\u4E2D\u91CD\u65B0\u6267\u884C\u56E2\u961F\u4EFB\u52A1\u3002" : "\u6539\u52A8\u5DF2\u6574\u5408\u5230\u5DE5\u4F5C\u533A\uFF0C\u5355\u6B65\u91CD\u8DD1\u4F1A\u91CD\u590D\u5957\u7528\u6539\u52A8\uFF1B\u5982\u9700\u91CD\u505A\u8BF7\u5728\u4F1A\u8BDD\u4E2D\u91CD\u65B0\u8C03\u7528 model_router_team_execute\u3002" };
    }
    if (!run.isolatedWorkspace || !run.baseCommit) {
      return { supported: false, writes: true, reassign: false, reason: "\u65E7\u7248\u672C\u8BB0\u5F55\u7F3A\u5C11\u72EC\u7ACB\u5DE5\u4F5C\u533A\u6216 Git \u57FA\u7EBF\uFF0C\u65E0\u6CD5\u5B89\u5168\u7EED\u8DD1\uFF1B\u8BF7\u5728\u4F1A\u8BDD\u4E2D\u91CD\u65B0\u8C03\u7528 model_router_team_execute\u3002" };
    }
    return {
      supported: true,
      writes: true,
      reassign: true,
      reason: "",
      confirm: "\u7EED\u8DD1\u4F1A\u5728\u65B0\u7684\u72EC\u7ACB Git \u5DE5\u4F5C\u6811\u4E2D\u5148\u5957\u7528\u4E4B\u524D\u7684\u6539\u52A8\uFF0C\u518D\u91CD\u8DD1\u8BE5\u6B65\u9AA4\u53CA\u5176\u4E0B\u6E38\uFF1B\u6210\u529F\u540E\u628A\u5408\u5E76\u8865\u4E01\u6574\u5408\u56DE\u5DE5\u4F5C\u533A\uFF08\u5DE5\u4F5C\u533A\u987B\u5E72\u51C0\u4E14\u4ECD\u5728\u539F\u57FA\u7EBF\u63D0\u4EA4\uFF09\u3002"
    };
  }
  return { supported: true, writes: false, reassign: true, reason: "", confirm: "" };
}
var pad2 = (value) => String(value).padStart(2, "0");
function formatResetTime(at2) {
  if (!Number.isFinite(at2)) return "";
  const date = new Date(at2);
  return `${date.getMonth() + 1}-${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
var BILLING_CHANNEL_LABEL = Object.freeze({ subscription: "\u8BA2\u9605", api: "API Key" });
function billingRows(billing) {
  return (billing?.providers ?? []).map((row) => {
    const sub = row.subscription ?? {};
    const subscription = sub.kind === "plan-key" ? `\u7F16\u7A0B\u5957\u9910 Key${sub.planRoute ? `\uFF08${sub.planRoute.provider}/${sub.planRoute.model}\uFF09` : ""}` : sub.kind === "cli-login" ? `\u5B98\u65B9 CLI \u8D26\u53F7\u767B\u5F55 \xB7 ${sub.toolId}` : "\u65E0\u8BA2\u9605";
    const state = sub.state === "exhausted" ? `${sub.exhaustedKind === "rate-limit" ? "\u9650\u6D41\u4E2D" : "\u989D\u5EA6\u5DF2\u7528\u5C3D"}\uFF0C\u9884\u8BA1 ${formatResetTime(sub.exhaustedUntil)} \u6062\u590D${sub.resetReported ? "" : "\uFF08\u5382\u5546\u672A\u7ED9\u51FA\u65F6\u95F4\uFF0C\u6309\u51B7\u5374\u65F6\u95F4\u4F30\u7B97\uFF09"}` : sub.stateLabel ?? "\u2014";
    const api = row.mode === "subscription-only" ? "\u4E0D\u56DE\u9000\uFF08\u53EA\u7528\u8BA2\u9605\uFF09" : row.api?.available ? `\u53EF\u7528${row.api.route ? `\uFF1A${row.api.route.provider}/${row.api.route.model}` : ""}${row.api.cliKeyEnv ? " \xB7 CLI \u73AF\u5883\u53D8\u91CF\u4E5F\u6709 Key" : ""}` : "\u672A\u914D\u7F6E\u56DE\u9000\u7684 API \u8DEF\u7EBF";
    return {
      key: `${row.provider}\0${sub.key ?? "none"}\0${row.mode}`,
      provider: row.provider,
      models: (row.models ?? []).join("\u3001"),
      mode: row.modeLabel ?? row.mode,
      subscription,
      state,
      exhausted: sub.state === "exhausted",
      api,
      apiAvailable: row.api?.available === true
    };
  });
}
function billingSwitchText(item) {
  const note = item?.billingSwitch;
  if (!note?.reason) return null;
  return note.reason;
}
function launchRequest({ task, mode, directRoute, budgetUsd, preset, workspace } = {}) {
  const budget = Number(budgetUsd);
  return {
    task: typeof task === "string" ? task : "",
    ...mode === "direct" && directRoute ? { provider: directRoute.provider, model: directRoute.model } : { planMode: mode === "team" ? "team" : "single", preset },
    ...Number.isFinite(budget) && budget >= 0 ? { budgetUsd: budget } : {},
    ...typeof workspace === "string" && workspace.trim() ? { workspace: workspace.trim() } : {}
  };
}
function rerunConfirmations({ run, item, override = null, choice = null, ledger = null, health = null, toolFor = () => null, headlessIds = /* @__PURE__ */ new Set() } = {}) {
  const reasons = [];
  const support = rerunSupport(run);
  if (support.writes) reasons.push({ code: "workspace-write", text: support.confirm });
  if (choice === "api") reasons.push({ code: "subscription-api", text: "\u6539\u7528 API Key \u91CD\u8BD5\uFF1A\u4F1A\u6309 API \u8BA1\u8D39\u5E76\u8BA1\u5165\u9884\u7B97\u3002" });
  const tool = toolFor(override?.provider ?? item?.provider);
  const entry = (health?.tools ?? []).find((candidate) => candidate.id === tool?.id);
  if (choice !== "api" && choice !== "cancel" && run?.kind !== "team" && run?.kind !== "tool" && ledger?.settings?.confirmUnsandboxedCli !== false && tool && headlessIds.has(tool.id) && entry?.installed && entry.login?.state !== "logged-out") {
    reasons.push({ code: "unsandboxed", text: `\u4F1A\u76F4\u63A5\u542F\u52A8 ${tool.label} \u7684\u65E0\u754C\u9762 CLI\uFF0C\u4E0D\u7ECF\u8FC7 Harness \u8FDB\u7A0B\u6C99\u7BB1\uFF0C\u53EA\u8BFB\u4EC5\u7531 CLI \u53C2\u6570\u4FDD\u8BC1\u3002` });
  }
  const estimate = override ? null : item?.estimatedCost;
  const check = ledger?.budget ? budgetCheck({
    estimateUsd: typeof estimate === "number" ? estimate : null,
    spent: ledger.spent ?? {},
    dailyLimitUsd: ledger.budget.dailyLimitUsd,
    monthlyLimitUsd: ledger.budget.monthlyLimitUsd
  }) : null;
  if (check?.exceeded) reasons.push({ code: "over-budget", text: `\u8D85\u51FA\u9884\u7B97\uFF1A${check.message}` });
  return reasons;
}

// .dsh-plugin/client/adaptive-state.mjs
var ADAPTIVE_DEFAULTS = Object.freeze({
  feedbackLearningEnabled: true,
  feedbackHalfLifeDays: 30,
  feedbackPriorWeight: 3,
  feedbackMaxAdjustment: 0.04,
  feedbackResetAt: 0,
  dynamicDataEnabled: false,
  liveBenchEndpoint: "https://livebench.ai",
  dynamicDataTtlMinutes: 1440,
  pricingSnapshotEndpoint: ""
});
var ADAPTIVE_NUMBER_FIELDS = Object.freeze([
  Object.freeze({ key: "feedbackHalfLifeDays", min: 1, max: 3650, step: 1 }),
  Object.freeze({ key: "feedbackPriorWeight", min: 1, max: 1e6, step: 1 }),
  Object.freeze({ key: "feedbackMaxAdjustment", min: 0, max: 0.1, step: 0.01 }),
  Object.freeze({ key: "dynamicDataTtlMinutes", min: 1, max: 10080, step: 1 })
]);
function adaptiveSettingValue(settings, key) {
  return settings?.[key] ?? ADAPTIVE_DEFAULTS[key];
}
function parseAdaptiveNumber(key, draft) {
  const field2 = ADAPTIVE_NUMBER_FIELDS.find((item) => item.key === key);
  if (!field2) throw new TypeError("Unknown numeric setting");
  if (typeof draft !== "string" && typeof draft !== "number" || String(draft).trim() === "") throw new TypeError("Enter a number");
  const value = Number(draft);
  if (!Number.isFinite(value) || value < field2.min || value > field2.max) throw new RangeError(`Expected ${field2.min}..${field2.max}`);
  return value;
}
function parsePublicEndpoint(key, draft) {
  if (!["liveBenchEndpoint", "pricingSnapshotEndpoint"].includes(key)) throw new TypeError("Unknown endpoint setting");
  if (typeof draft !== "string") throw new TypeError("Enter a public HTTPS URL");
  const value = draft.trim();
  if (key === "pricingSnapshotEndpoint" && value === "") return "";
  if (!value || value.length > 2048) throw new TypeError("Enter a public HTTPS URL");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Enter a public HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port && parsed.port !== "443") {
    throw new TypeError("Use a public HTTPS URL without credentials, query or fragment");
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/iu.test(parsed.hostname) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/iu.test(parsed.hostname)) throw new TypeError("Use a public hostname");
  return value;
}
function publicEndpointDraft(key, value) {
  try {
    return parsePublicEndpoint(key, value);
  } catch {
    return "";
  }
}
function feedbackRatingArguments(run, item, direction) {
  if (!["up", "down"].includes(direction)) throw new TypeError("Unknown rating direction");
  const active = direction === "up" ? item?.rating === 1 : item?.rating === -1;
  return [run?.id, item?.id, active ? "clear" : direction, item?.finishedAt];
}
var nonnegative2 = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
function learningView(learning, settings = {}) {
  return {
    available: Boolean(learning && typeof learning === "object" && !Array.isArray(learning)),
    // Current settings govern the next plan; a failed refresh must not make an
    // older profile claim that a newly disabled policy is still enabled.
    enabled: adaptiveSettingValue(settings, "feedbackLearningEnabled") !== false,
    feedbackCount: nonnegative2(learning?.feedbackCount),
    ignoredCount: nonnegative2(learning?.ignoredCount),
    effectiveWeight: nonnegative2(learning?.effectiveWeight),
    policyVersion: typeof learning?.policyVersion === "string" ? learning.policyVersion.slice(0, 100) : null,
    resetAt: nonnegative2(adaptiveSettingValue(settings, "feedbackResetAt"))
  };
}
function learningEvidenceRows(learning, limit = 12) {
  const cells = learning?.cellStats;
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return { rows: [], total: 0 };
  const rows = [];
  for (const [key, domains] of Object.entries(cells)) {
    const identity = key.split("\0");
    if (identity.length !== 2 || identity.some((part) => !part.trim()) || !domains || typeof domains !== "object" || Array.isArray(domains)) continue;
    for (const [domain, cell] of Object.entries(domains)) {
      if (!domain.trim() || !cell || typeof cell !== "object" || Array.isArray(cell) || !Number.isFinite(cell.adjustment) || Math.abs(cell.adjustment) > 0.1 || ["feedbackCount", "positiveCount", "negativeCount", "effectiveWeight", "effectiveSampleSize"].some((name) => !Number.isFinite(cell[name]) || cell[name] < 0) || !Number.isFinite(cell.shrinkage) || cell.shrinkage < 0 || cell.shrinkage > 1) continue;
      rows.push({
        id: JSON.stringify([key, domain]),
        route: identity.map((part) => part.slice(0, 100)).join("/"),
        domain: domain.slice(0, 80),
        feedbackCount: nonnegative2(cell.feedbackCount),
        positiveCount: nonnegative2(cell.positiveCount),
        negativeCount: nonnegative2(cell.negativeCount),
        effectiveWeight: nonnegative2(cell.effectiveWeight),
        effectiveSampleSize: nonnegative2(cell.effectiveSampleSize),
        shrinkage: Number.isFinite(cell.shrinkage) && cell.shrinkage >= 0 && cell.shrinkage <= 1 ? cell.shrinkage : 0,
        adjustment: cell.adjustment
      });
    }
  }
  rows.sort((left, right) => left.route === right.route ? left.domain.localeCompare(right.domain) : left.route.localeCompare(right.route));
  const count = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 12;
  return { rows: rows.slice(0, count), total: rows.length };
}
var EXCLUSION_LABELS = Object.freeze({
  "unrated": "\u5C1A\u672A\u8BC4\u4EF7\uFF08\u4E0D\u662F\u4E0D\u6EE1\u610F\uFF09",
  "not-successful": "\u6CA1\u6709\u6210\u529F\u6267\u884C\u7ED3\u679C",
  "cli-model-unverified": "CLI \u5B9E\u9645\u6A21\u578B\u672A\u6838\u9A8C",
  "before-reset": "\u7ED3\u679C\u65E9\u4E8E\u5B66\u4E60\u8D77\u70B9",
  "superseded": "\u5DF2\u88AB\u540C\u4E00\u7ED3\u679C\u7684\u65B0\u8BB0\u5F55\u66FF\u4EE3",
  "missing-identity": "\u7F3A\u5C11\u8FD0\u884C\u6216\u6B65\u9AA4\u6807\u8BC6",
  "invalid-route": "\u8DEF\u7EBF\u6807\u8BC6\u65E0\u6548",
  "invalid-time": "\u7ED3\u679C\u6216\u8BC4\u4EF7\u65F6\u95F4\u65E0\u6548",
  "future-time": "\u65F6\u95F4\u665A\u4E8E\u5F53\u524D\u65F6\u523B"
});
function learningExclusionRows(learning) {
  return Object.entries(EXCLUSION_LABELS).flatMap(([reason, label]) => {
    const count = nonnegative2(learning?.exclusionReasons?.[reason]);
    return count > 0 ? [{ reason, label, count }] : [];
  });
}
var STATUS_LABEL = Object.freeze({ disabled: "\u672A\u542F\u7528", missing: "\u5C1A\u65E0\u5FEB\u7167", fresh: "\u5FEB\u7167\u6709\u6548", stale: "\u5FEB\u7167\u8FC7\u671F", error: "\u66F4\u65B0\u5931\u8D25" });
var PUBLIC_ERROR_CODES = /* @__PURE__ */ new Set(["refresh-failed", "snapshot-rollback-rejected", "storage-failed", "refresh-interrupted"]);
var positiveTime = (value) => Number.isFinite(value) && value > 0 ? value : null;
function dynamicSourceView(source, enabled = true) {
  const status = enabled === false ? "disabled" : Object.hasOwn(STATUS_LABEL, source?.status ?? "") ? source.status : "missing";
  let publicSource = "";
  if (enabled !== false && typeof source?.source === "string") publicSource = publicEndpointDraft("pricingSnapshotEndpoint", source.source);
  return {
    status,
    label: STATUS_LABEL[status],
    source: publicSource,
    version: enabled !== false && typeof source?.version === "string" ? source.version.slice(0, 160) : null,
    verifiedAt: enabled !== false && Number.isFinite(source?.verifiedAt) && source.verifiedAt > 0 ? source.verifiedAt : null,
    count: enabled === false ? 0 : nonnegative2(source?.modelCount ?? source?.rowCount),
    refreshing: enabled !== false && source?.refreshing === true,
    pending: enabled !== false && source?.pending === true,
    lastAttemptAt: enabled === false ? null : positiveTime(source?.lastAttemptAt),
    lastSuccessAt: enabled === false ? null : positiveTime(source?.lastSuccessAt),
    errorCode: enabled !== false && PUBLIC_ERROR_CODES.has(source?.error) ? source.error : "",
    endpoint: enabled === false ? "" : publicEndpointDraft("pricingSnapshotEndpoint", source?.configuredEndpoint ?? source?.endpoint ?? ""),
    lastGoodEndpoint: enabled === false ? "" : publicEndpointDraft("pricingSnapshotEndpoint", source?.lastGoodEndpoint ?? "")
  };
}

// .dsh-plugin/client/router-insights.jsx
var text = (value) => typeof value === "string" ? value.trim() : "";
var BAND = { simple: "\u7B80\u5355", balanced: "\u4E2D\u7B49", complex: "\u56F0\u96BE" };
var SUBSCRIPTION_FAILURE_OPTIONS = [["ask", "\u6682\u505C\u5E76\u8BE2\u95EE"], ["api", "\u81EA\u52A8\u6539\u7528 API"], ["fail", "\u76F4\u63A5\u5931\u8D25"]];
var SUBSCRIPTION_CHOICE_BUTTONS = [["api", "\u6539\u7528 API \u91CD\u8BD5", false], ["subscription", "\u91CD\u8BD5\u8BA2\u9605", true], ["cancel", "\u53D6\u6D88", true]];
function OnboardingBanner({ health, onDone, onRefresh, refreshing, error }) {
  const summary = healthSummary(health?.tools);
  const problems = (health?.tools ?? []).filter((item) => item.installed && item.login?.state === "logged-out");
  const updates = (health?.tools ?? []).filter((item) => item.installed && item.versionStatus === "update-available");
  return /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card mr-onboarding", "aria-label": "\u5F00\u7BB1\u4F53\u68C0" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u5F00\u7BB1\u4F53\u68C0"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u9996\u6B21\u6253\u5F00\u65F6\u68C0\u6D4B\u6BCF\u4E2A\u5B98\u65B9\u5DE5\u5177\u662F\u5426\u5DF2\u5B89\u88C5\u3001\u5F53\u524D\u7248\u672C\uFF08\u4EE5\u53CA\u80FD\u67E5\u5230\u65F6\u7684\u6700\u65B0\u7248\u672C\uFF09\u3001\u662F\u5426\u5DF2\u767B\u5F55\u3002\u672A\u767B\u5F55\u7684\u5DE5\u5177\u4F1A\u88AB\u8DEF\u7531\u76F4\u63A5\u8DF3\u8FC7\uFF0C\u6539\u8D70\u6A21\u578B\u76EE\u5F55 API\uFF0C\u4E0D\u5FC5\u7B49\u5F85 CLI \u5931\u8D25\u3002")), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: refreshing, onClick: onRefresh }, refreshing ? "\u68C0\u6D4B\u4E2D\u2026" : "\u91CD\u65B0\u4F53\u68C0")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, error), !health && !error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-empty", role: "status" }, "\u6B63\u5728\u4F53\u68C0\u672C\u673A\u5B98\u65B9\u5DE5\u5177\u2026"), health && /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-result-grid" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u5DF2\u5B89\u88C5"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, summary.installed, " / ", summary.total)), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u5DF2\u767B\u5F55\u53EF\u7528"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, summary.ready)), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u672A\u767B\u5F55"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, summary.loggedOut)), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u767B\u5F55\u72B6\u6001\u672A\u77E5"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, summary.unknown))), problems.length > 0 ? /* @__PURE__ */ import_react2.default.createElement("ul", { className: "mr-checklist" }, problems.map((item) => /* @__PURE__ */ import_react2.default.createElement("li", { key: item.id }, /* @__PURE__ */ import_react2.default.createElement("strong", null, item.label), "\uFF1A\u672A\u767B\u5F55\uFF0C\u53EF\u5728\u4E0B\u65B9\u70B9\u201C\u53BB\u767B\u5F55\u201D\u67E5\u770B\u767B\u5F55\u65B9\u6CD5\uFF08", item.login.command ?? "\u89C1\u8BF4\u660E", "\uFF09\u3002"))) : /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u5DF2\u5B89\u88C5\u7684\u5DE5\u5177\u6CA1\u6709\u53D1\u73B0\u672A\u767B\u5F55\u7684\u95EE\u9898\u3002\u672A\u5B89\u88C5\u7684\u5DE5\u5177\u53EF\u5728\u4E0B\u65B9\u4E00\u952E\u5B89\u88C5\u3002"), updates.length > 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u6709\u65B0\u7248\u672C\uFF1A", updates.map((item) => `${item.label} ${item.version ?? "?"} \u2192 ${item.latestVersion}`).join("\uFF1B"), "\u3002\u53EF\u5728\u4E0B\u65B9\u201C\u5B98\u65B9\u5DE5\u5177\u201D\u4E2D\u66F4\u65B0\uFF08\u53EF\u9009\uFF09\u3002"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, UNTESTED_VERSION_NOTE), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button", type: "button", onClick: onDone }, "\u5B8C\u6210\u4F53\u68C0"), /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u4E4B\u540E\u53EF\u968F\u65F6\u5728\u201C\u5B98\u65B9\u5DE5\u5177\u201D\u5361\u7247\u4E2D\u91CD\u65B0\u4F53\u68C0\u3002")))));
}
function ToolLoginLine({ entry }) {
  const [open, setOpen] = import_react2.default.useState(false);
  const [copied, setCopied] = import_react2.default.useState(false);
  if (!entry?.installed) return null;
  const state = entry.login?.state ?? "unknown";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry.login.command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-login" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-tool-status" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: `mr-tool-dot ${state === "logged-in" ? "installed" : state === "logged-out" ? "missing-strong" : ""}` }), LOGIN_LABEL[state], " \xB7 ", versionLine(entry)), entry.login?.detail && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption mr-tool-detail" }, entry.login.detail), state === "logged-in" && entry.login?.billing === "subscription" && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption mr-tool-detail" }, "\u8BA2\u9605\u8D26\u53F7\u767B\u5F55\uFF1A\u8D39\u7528\u53EA\u4F5C\u53C2\u8003\u663E\u793A\uFF0C\u4E0D\u8BA1\u5165\u9884\u7B97\u3002"), state === "logged-in" && entry.login?.billing === "api-key" && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption mr-tool-detail" }, "API Key \u8BA1\u8D39\uFF1A\u8D39\u7528\u8BA1\u5165\u6BCF\u65E5/\u6BCF\u6708\u9884\u7B97\u3002"), state !== "logged-in" && /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary mr-tool-button mr-login-button", type: "button", "aria-expanded": open, onClick: () => setOpen((value) => !value) }, "\u53BB\u767B\u5F55"), open && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-login-guide" }, /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, entry.login.steps), entry.login.command && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-login-command" }, /* @__PURE__ */ import_react2.default.createElement("code", { className: "mr-tool-command" }, entry.login.command), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", onClick: () => {
    void copy();
  } }, copied ? "\u5DF2\u590D\u5236" : "\u590D\u5236\u547D\u4EE4")), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u63D2\u4EF6\u4E0D\u4F1A\u66FF\u4F60\u542F\u52A8\u4EA4\u4E92\u5F0F\u767B\u5F55\u3002\u767B\u5F55\u5B8C\u6210\u540E\u70B9\u201C\u91CD\u65B0\u4F53\u68C0\u201D\u3002")));
}
function Meter({ label, meter }) {
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-meter" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-meter-top" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, label), /* @__PURE__ */ import_react2.default.createElement("span", { className: meter.over ? "mr-meter-over" : "" }, meter.text)), meter.limited && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-meter-track", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(meter.share * 100) }, /* @__PURE__ */ import_react2.default.createElement("div", { className: `mr-meter-fill ${meter.over ? "over" : meter.share > 0.8 ? "near" : ""}`, style: { width: `${Math.round(meter.share * 100)}%` } })));
}
function useSettingsWriter(settingsScope) {
  const [snapshot, setSnapshot] = import_react2.default.useState(() => settingsScope.getSnapshot());
  const [notice, setNotice] = import_react2.default.useState("");
  const [busy, setBusy] = import_react2.default.useState(false);
  const pending = import_react2.default.useRef(false);
  const mounted = import_react2.default.useRef(true);
  import_react2.default.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  import_react2.default.useEffect(() => settingsScope.subscribe(() => setSnapshot(settingsScope.getSnapshot())), [settingsScope]);
  const writable = snapshot.status === "ready" && snapshot.writable === true && !busy;
  const write = async (key, value) => {
    const current = settingsScope.getSnapshot();
    if (pending.current || current.status !== "ready" || current.writable !== true) return false;
    pending.current = true;
    setBusy(true);
    setNotice("");
    try {
      const accepted = await settingsScope.mutate([{ op: "set", path: [key], value }], current.revision);
      if (!accepted && mounted.current) setNotice("\u8BBE\u7F6E\u672A\u4FDD\u5B58\uFF0C\u53EF\u80FD\u5DF2\u5728\u5176\u4ED6\u9875\u9762\u4FEE\u6539\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      return accepted;
    } catch (error) {
      if (mounted.current) setNotice(text(error?.message) || "\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002");
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { value: snapshot.value ?? {}, writable, busy, write, notice };
}
var ADAPTIVE_FIELD_LABEL = {
  feedbackHalfLifeDays: "\u53CD\u9988\u534A\u8870\u671F\uFF08\u5929\uFF09",
  feedbackPriorWeight: "\u6536\u7F29\u5F3A\u5EA6",
  feedbackMaxAdjustment: "\u6700\u5927\u504F\u597D\u6548\u7528\u8C03\u6574",
  dynamicDataTtlMinutes: "\u516C\u5171\u5FEB\u7167\u68C0\u67E5\u95F4\u9694\uFF08\u5206\u949F\uFF09"
};
function AdaptiveNumberControl({ field: field2, value, writable, onSave }) {
  const [draft, setDraft] = import_react2.default.useState("");
  const [notice, setNotice] = import_react2.default.useState("");
  const save = async () => {
    let next;
    try {
      next = parseAdaptiveNumber(field2.key, draft);
    } catch {
      setNotice(`\u8BF7\u8F93\u5165 ${field2.min} \u5230 ${field2.max} \u7684\u6570\u5B57\u3002`);
      return;
    }
    setNotice("");
    try {
      if (await onSave(field2.key, next)) setDraft((current) => current === draft ? "" : current);
    } catch {
      setNotice("\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    }
  };
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-control-label", htmlFor: `mr-${field2.key}` }, ADAPTIVE_FIELD_LABEL[field2.key]), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-inline" }, /* @__PURE__ */ import_react2.default.createElement(
    "input",
    {
      className: "mr-input mr-budget",
      id: `mr-${field2.key}`,
      type: "number",
      min: field2.min,
      max: field2.max,
      step: field2.step,
      placeholder: String(value),
      value: draft,
      disabled: !writable,
      onChange: (event) => setDraft(event.target.value)
    }
  ), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !writable || draft === "", onClick: () => {
    void save();
  } }, "\u4FDD\u5B58")), notice && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-error", role: "alert" }, notice));
}
function PublicEndpointControl({ name, label, value, writable, onSave }) {
  const [draft, setDraft] = import_react2.default.useState(null);
  const [notice, setNotice] = import_react2.default.useState("");
  const current = publicEndpointDraft(name, value);
  const save = async () => {
    let next;
    try {
      next = parsePublicEndpoint(name, draft ?? current);
    } catch {
      setNotice("\u8BF7\u8F93\u5165\u4E0D\u542B\u8BA4\u8BC1\u3001\u67E5\u8BE2\u53C2\u6570\u6216\u7247\u6BB5\u7684\u516C\u5F00 HTTPS \u5730\u5740\uFF1B\u4EF7\u683C\u5FEB\u7167\u53EF\u7559\u7A7A\u3002");
      return;
    }
    setNotice("");
    try {
      if (await onSave(name, next)) setDraft((currentDraft) => currentDraft === draft ? null : currentDraft);
    } catch {
      setNotice("\u5730\u5740\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    }
  };
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-control-label", htmlFor: `mr-${name}` }, label), /* @__PURE__ */ import_react2.default.createElement(
    "input",
    {
      className: "mr-input",
      id: `mr-${name}`,
      type: "url",
      maxLength: 2048,
      value: draft ?? current,
      disabled: !writable,
      placeholder: name === "liveBenchEndpoint" ? "https://livebench.ai" : "\u7559\u7A7A\uFF1A\u4E0D\u8BFB\u53D6\u8FDC\u7A0B\u4EF7\u683C\u5FEB\u7167",
      onChange: (event) => setDraft(event.target.value)
    }
  ), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !writable || draft === null, onClick: () => {
    void save();
  } }, "\u4FDD\u5B58\u5730\u5740"), notice && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-error", role: "alert" }, notice));
}
function PublicSourceStatus({ label, source, enabled }) {
  const view = dynamicSourceView(source, enabled);
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, label, "\uFF1A", view.label), view.status !== "disabled" && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, view.version ? `\u7248\u672C ${view.version} \xB7 ` : "", view.count, " \u6761\u8BB0\u5F55", view.verifiedAt ? ` \xB7 \u6700\u8FD1\u6821\u9A8C ${new Date(view.verifiedAt).toLocaleString()}` : ""), view.source && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u516C\u5F00\u6765\u6E90\uFF1A", view.source), (view.refreshing || view.pending) && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption", role: "status" }, "\u516C\u5F00\u6E90\u6B63\u5728\u5237\u65B0\uFF1B\u4E0A\u9762\u7684\u7248\u672C\u4ECD\u662F\u6700\u8FD1\u4E00\u6B21\u5DF2\u4FDD\u5B58\u5FEB\u7167\uFF0C\u4E0D\u662F\u672C\u6B21\u8BF7\u6C42\u5DF2\u6210\u529F\u3002"), view.lastAttemptAt && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u6700\u8FD1\u5C1D\u8BD5 ", new Date(view.lastAttemptAt).toLocaleString(), view.lastSuccessAt ? ` \xB7 \u6700\u8FD1\u6210\u529F ${new Date(view.lastSuccessAt).toLocaleString()}` : ""), view.status === "error" && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u66F4\u65B0\u5931\u8D25\uFF1B\u662F\u5426\u53EF\u7528\u7531 Host \u6821\u9A8C\uFF0C\u4E0D\u5C06\u7F3A\u5931\u6570\u636E\u5F53\u4F5C\u96F6\u6210\u672C\u6216\u6EE1\u5206\u3002"), view.status === "stale" && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u4E0A\u6B21\u6709\u6548\u5FEB\u7167\u5DF2\u8FC7\u671F\u6216\u672C\u6B21\u66F4\u65B0\u5931\u8D25\uFF1BHost \u53EF\u80FD\u6CBF\u7528\u65E7\u6570\u636E\uFF0C\u4E0D\u80FD\u5F53\u4F5C\u6700\u65B0\u4EF7\u683C\u6216\u80FD\u529B\u3002"), view.errorCode === "storage-failed" && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u672C\u6B21\u72B6\u6001\u4FDD\u5B58\u5931\u8D25\uFF1B\u53EA\u80FD\u4F7F\u7528\u6B64\u524D\u5DF2\u4FDD\u5B58\u7684\u5F53\u524D\u6E90\u5FEB\u7167\uFF0C\u8BF7\u91CD\u8BD5\u5237\u65B0\u3002"), view.errorCode === "refresh-interrupted" && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u4E0A\u6B21\u516C\u5F00\u6570\u636E\u5237\u65B0\u4E2D\u65AD\uFF1B\u8BF7\u5237\u65B0\u6458\u8981\u67E5\u770B Host \u7684\u540E\u7EED\u91CD\u8BD5\u72B6\u6001\u3002"), view.lastGoodEndpoint && view.endpoint && view.lastGoodEndpoint !== view.endpoint && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u6B64\u524D\u6765\u6E90\u7684\u6709\u6548\u5FEB\u7167\u4ECD\u4FDD\u7559\u5728\u672C\u5730\uFF0C\u4F46\u4E0D\u5E94\u7528\u5230\u5F53\u524D\u516C\u5F00\u6E90\u3002"), view.status === "disabled" && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u5F53\u524D\u8BBE\u7F6E\u4E0D\u4F7F\u7528\u6B64\u516C\u5F00\u6E90\uFF1B\u4FDD\u7559\u7684\u5386\u53F2\u5FEB\u7167\u4E0D\u4EE3\u8868\u6B63\u5728\u4F7F\u7528\u3002"));
}
function LearningEvidence({ learning }) {
  const evidence = learningEvidenceRows(learning);
  const exclusions = learningExclusionRows(learning);
  return /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, evidence.total > 0 && /* @__PURE__ */ import_react2.default.createElement("details", { className: "mr-tool-log" }, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u67E5\u770B\u5206\u6A21\u578B / \u4EFB\u52A1\u7C7B\u578B\u7684\u5DF2\u89C2\u5BDF\u53CD\u9988\uFF08", evidence.total, " \u7EC4\uFF09"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u53EA\u63CF\u8FF0\u5DF2\u9009\u62E9\u5E76\u83B7\u5F97\u8BC4\u4EF7\u7684\u7ED3\u679C\uFF0C\u4E0D\u4EE3\u8868\u6240\u6709\u6A21\u578B\u7684\u771F\u5B9E\u8D28\u91CF\u6216\u6536\u76CA\uFF1B\u6709\u6548\u6837\u672C\u91CF\u53CD\u6620\u6743\u91CD\u96C6\u4E2D\u7A0B\u5EA6\uFF0C\u4E0D\u662F\u8D28\u91CF\u7F6E\u4FE1\u5EA6\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-table-wrap" }, /* @__PURE__ */ import_react2.default.createElement("table", { className: "mr-table" }, /* @__PURE__ */ import_react2.default.createElement("thead", null, /* @__PURE__ */ import_react2.default.createElement("tr", null, /* @__PURE__ */ import_react2.default.createElement("th", null, "\u8DEF\u7EBF / \u4EFB\u52A1\u7C7B\u578B"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u6709\u7528 / \u4E0D\u597D"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u504F\u597D\u6548\u7528\u8C03\u6574"))), /* @__PURE__ */ import_react2.default.createElement("tbody", null, evidence.rows.map((row) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: row.id }, /* @__PURE__ */ import_react2.default.createElement("td", null, row.route, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-caption" }, row.domain)), /* @__PURE__ */ import_react2.default.createElement("td", null, row.positiveCount, " / ", row.negativeCount, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-caption" }, "\u5DF2\u89C2\u5BDF ", row.feedbackCount, " \xB7 \u6709\u6548\u6743\u91CD ", row.effectiveWeight.toFixed(2), " \xB7 \u6709\u6548\u6837\u672C\u91CF ", row.effectiveSampleSize.toFixed(2))), /* @__PURE__ */ import_react2.default.createElement("td", null, row.adjustment > 0 ? "+" : "", row.adjustment.toFixed(4), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-caption" }, "\u6536\u7F29\u7CFB\u6570 ", row.shrinkage.toFixed(2)))))))), evidence.total > evidence.rows.length && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u4EC5\u5C55\u793A\u524D ", evidence.rows.length, " \u7EC4\uFF1B\u4E0D\u662F\u6240\u6709\u6A21\u578B\u7684\u8986\u76D6\u7387\u3002")), exclusions.length > 0 && /* @__PURE__ */ import_react2.default.createElement("details", { className: "mr-tool-log" }, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u67E5\u770B\u672A\u53C2\u4E0E\u5B66\u4E60\u7684\u539F\u56E0"), /* @__PURE__ */ import_react2.default.createElement("ul", { className: "mr-checklist" }, exclusions.map((row) => /* @__PURE__ */ import_react2.default.createElement("li", { key: row.reason }, row.label, "\uFF1A", row.count)))));
}
function AdaptiveControls({ ledger, settings, onChanged, refreshing }) {
  const value = settings.value;
  const learning = learningView(ledger?.learning, value);
  const [resetBusy, setResetBusy] = import_react2.default.useState(false);
  const [refreshNotice, setRefreshNotice] = import_react2.default.useState("");
  const resetPending = import_react2.default.useRef(false);
  const save = async (key, next) => {
    const accepted = await settings.write(key, next);
    if (accepted) {
      setRefreshNotice("");
      try {
        await onChanged?.();
      } catch {
        setRefreshNotice("\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u6458\u8981\u5237\u65B0\u5931\u8D25\uFF1B\u8BF7\u5237\u65B0\u6267\u884C\u8BB0\u5F55\u540E\u91CD\u65B0\u89C4\u5212\u3002");
      }
    }
    return accepted;
  };
  const reset = async () => {
    if (resetPending.current || !settings.writable) return;
    resetPending.current = true;
    try {
      if (!window.confirm("\u4ECE\u73B0\u5728\u91CD\u65B0\u5B66\u4E60\u4F60\u7684\u504F\u597D\uFF1F\u6B64\u524D\u53CD\u9988\u5C06\u4E0D\u518D\u53C2\u4E0E\u8C03\u6574\uFF0C\u4F46\u6267\u884C\u8BB0\u5F55\u3001\u8D39\u7528\u5386\u53F2\u548C\u539F\u8BC4\u4EF7\u4E0D\u4F1A\u5220\u9664\u3002")) return;
      setResetBusy(true);
      await save("feedbackResetAt", Date.now());
    } finally {
      resetPending.current = false;
      setResetBusy(false);
    }
  };
  return /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("h3", { className: "mr-section-title" }, "\u6301\u7EED\u53CD\u9988\u4E0E\u672C\u5730\u504F\u597D"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u53EA\u4F7F\u7528\u4F60\u5BF9\u5DF2\u8BB0\u5F55\u7ED3\u679C\u7684\u70B9\u8D5E / \u4E0D\u597D / \u64A4\u56DE\uFF0C\u6309\u4EFB\u52A1\u7C7B\u578B\u548C\u65F6\u95F4\u8870\u51CF\u8C03\u6574\u504F\u597D\u6548\u7528\uFF1B\u4E0D\u62AC\u9AD8\u8D28\u91CF\u786C\u95E8\u69DB\u3002\u7CFB\u7EDF\u6267\u884C\u6210\u529F\u4E0D\u7B49\u4E8E\u4F60\u6EE1\u610F\uFF0C\u6A21\u578B\u590D\u6838\u4E5F\u4E0D\u4F5C\u4E3A\u4EBA\u5DE5\u8BC4\u5206\u3002\u4E0D\u4F1A\u4E3A\u4E86\u5B66\u4E60\u53D1\u8D77\u4ED8\u8D39\u63A2\u7D22\u3002"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u8303\u56F4\uFF1A\u672C\u5730 DSH_HOME \u5DE5\u4F5C\u5BA4\u5171\u4EAB\uFF0C\u4E0D\u662F\u6309\u8D26\u53F7\u9694\u79BB\uFF1B\u6700\u591A\u6700\u8FD1 200 \u6B21\u8FD0\u884C\u7684\u6ED1\u52A8\u7A97\u53E3\uFF0C\u4E0D\u4E0A\u4F20\u53CD\u9988\u6216\u4EFB\u52A1\u5185\u5BB9\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-check" }, /* @__PURE__ */ import_react2.default.createElement(
    "input",
    {
      type: "checkbox",
      checked: adaptiveSettingValue(value, "feedbackLearningEnabled") !== false,
      disabled: !settings.writable,
      onChange: (event) => {
        void save("feedbackLearningEnabled", event.target.checked);
      }
    }
  ), "\u542F\u7528\u7528\u6237\u53CD\u9988\u5B66\u4E60"), ADAPTIVE_NUMBER_FIELDS.filter((field2) => field2.key !== "dynamicDataTtlMinutes").map((field2) => /* @__PURE__ */ import_react2.default.createElement(
    AdaptiveNumberControl,
    {
      key: field2.key,
      field: field2,
      value: adaptiveSettingValue(value, field2.key),
      writable: settings.writable,
      onSave: save
    }
  ))), settings.busy && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption", role: "status" }, "\u6B63\u5728\u4FDD\u5B58\u8BBE\u7F6E\uFF0C\u8BF7\u7A0D\u5019\u2026"), refreshing && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption", role: "status" }, "\u6B63\u5728\u8BFB\u53D6\u53CD\u9988\u4E0E\u516C\u5F00\u6570\u636E\u6458\u8981\u2026"), refreshNotice && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, refreshNotice), learning.available ? /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption", role: "status" }, learning.enabled ? "\u5B66\u4E60\u5DF2\u542F\u7528" : "\u5B66\u4E60\u5DF2\u505C\u7528", " \xB7 \u6700\u8FD1\u4E00\u6B21\u8D26\u672C\u6458\u8981\uFF1A\u6709\u6548\u53CD\u9988 ", learning.feedbackCount, " \xB7 \u6709\u6548\u6743\u91CD ", learning.effectiveWeight.toFixed(2), " \xB7 \u5FFD\u7565 ", learning.ignoredCount, learning.policyVersion ? ` \xB7 \u7B56\u7565 ${learning.policyVersion}` : "") : /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption", role: "status" }, "\u5B66\u4E60\u6458\u8981\u5C1A\u672A\u8BFB\u53D6\uFF1B\u4FDD\u5B58\u540E\u5237\u65B0\u6267\u884C\u8BB0\u5F55\u67E5\u770B\u3002"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u6458\u8981\u662F\u6700\u8FD1\u4E00\u6B21\u8BFB\u53D6\u7684\u5DF2\u89C2\u5BDF\u8BC1\u636E\u3002\u4FEE\u6539\u8BC4\u4EF7 / \u5B66\u4E60\u8BBE\u7F6E\u540E\u9700\u5237\u65B0\u6458\u8981\u5E76\u91CD\u65B0\u751F\u6210\u5EFA\u8BAE\uFF1B\u5237\u65B0\u6309\u68C0\u67E5\u95F4\u9694\u590D\u7528\u516C\u5F00\u5FEB\u7167\uFF0C\u4E0D\u4FDD\u8BC1\u6BCF\u6B21\u4E0B\u8F7D\u65B0\u6570\u636E\u3002"), /* @__PURE__ */ import_react2.default.createElement(LearningEvidence, { learning: ledger?.learning }), learning.resetAt > 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u5B66\u4E60\u8D77\u70B9\uFF1A", new Date(learning.resetAt).toLocaleString(), "\uFF0C\u6B64\u524D\u53CD\u9988\u4E0D\u518D\u53C2\u4E0E\u8C03\u6574\u3002"), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !settings.writable || resetBusy, onClick: () => {
    void reset();
  } }, resetBusy ? "\u6B63\u5728\u8BBE\u7F6E\u2026" : "\u4ECE\u73B0\u5728\u91CD\u65B0\u5B66\u4E60"), /* @__PURE__ */ import_react2.default.createElement("h3", { className: "mr-section-title" }, "\u52A8\u6001\u516C\u5171\u6570\u636E"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u9ED8\u8BA4\u5173\u95ED\u3002\u660E\u786E\u542F\u7528\u540E\uFF0C\u5728\u6253\u5F00 / \u5237\u65B0\u8D26\u672C\u53CA\u6267\u884C\u524D\u6309\u68C0\u67E5\u95F4\u9694\u8BFB\u53D6\u516C\u5F00 LiveBench \u548C\u53EF\u9009\u4EF7\u683C\u5FEB\u7167\uFF1B\u4EF7\u683C\u4E0E\u80FD\u529B\u5148\u9A8C\u4FDD\u7559\u7248\u672C\uFF0C\u4E0D\u4EE3\u8868\u771F\u5B9E\u4EFB\u52A1\u6536\u76CA\u3002\u53EA\u6709\u6253\u5F00\u516C\u5171\u6E90\u5F00\u5173\u624D\u4F1A\u8BFB\u53D6\u8FDC\u7A0B\u6570\u636E\uFF0C\u4E0D\u53D1\u9001\u4EFB\u52A1\u6216\u53CD\u9988\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-check" }, /* @__PURE__ */ import_react2.default.createElement(
    "input",
    {
      type: "checkbox",
      checked: adaptiveSettingValue(value, "dynamicDataEnabled") === true,
      disabled: !settings.writable,
      onChange: (event) => {
        void save("dynamicDataEnabled", event.target.checked);
      }
    }
  ), "\u542F\u7528\u52A8\u6001\u516C\u5171\u6570\u636E"), /* @__PURE__ */ import_react2.default.createElement(
    AdaptiveNumberControl,
    {
      field: ADAPTIVE_NUMBER_FIELDS.find((field2) => field2.key === "dynamicDataTtlMinutes"),
      value: adaptiveSettingValue(value, "dynamicDataTtlMinutes"),
      writable: settings.writable,
      onSave: save
    }
  ), /* @__PURE__ */ import_react2.default.createElement(PublicEndpointControl, { name: "liveBenchEndpoint", label: "LiveBench \u516C\u5F00\u6E90", value: adaptiveSettingValue(value, "liveBenchEndpoint"), writable: settings.writable, onSave: save }), /* @__PURE__ */ import_react2.default.createElement(PublicEndpointControl, { name: "pricingSnapshotEndpoint", label: "\u4EF7\u683C\u5FEB\u7167\u516C\u5F00\u6E90\uFF08\u53EF\u9009\uFF09", value: adaptiveSettingValue(value, "pricingSnapshotEndpoint"), writable: settings.writable, onSave: save }), /* @__PURE__ */ import_react2.default.createElement(PublicSourceStatus, { label: "LiveBench", source: ledger?.dynamicData?.liveBench, enabled: adaptiveSettingValue(value, "dynamicDataEnabled") === true }), /* @__PURE__ */ import_react2.default.createElement(PublicSourceStatus, { label: "\u4EF7\u683C", source: ledger?.dynamicData?.pricing, enabled: adaptiveSettingValue(value, "dynamicDataEnabled") === true && Boolean(adaptiveSettingValue(value, "pricingSnapshotEndpoint")) })));
}
function CostControlCard({ ledger, settingsScope, onChanged, error, refreshing = false }) {
  const settings = useSettingsWriter(settingsScope);
  const [dailyDraft, setDailyDraft] = import_react2.default.useState("");
  const [monthlyDraft, setMonthlyDraft] = import_react2.default.useState("");
  const value = settings.value;
  const preset = value.routingPreset ?? "balanced";
  const daily = Number(value.dailyBudgetUsd ?? 0);
  const monthly = Number(value.monthlyBudgetUsd ?? 0);
  const spent = ledger?.spent ?? { today: 0, month: 0, unknownToday: 0, unknownMonth: 0 };
  const set = async (key, next) => {
    if (await settings.write(key, next)) onChanged?.();
  };
  const saveLimit = async (key, draft, reset) => {
    const parsed = Number(draft);
    if (draft === "" || !Number.isFinite(parsed) || parsed < 0) return;
    if (await settings.write(key, parsed)) {
      reset("");
      onChanged?.();
    }
  };
  return /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card mr-cost", "aria-label": "\u6210\u672C\u63A7\u5236" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u6210\u672C\u63A7\u5236\u4E0E\u8DEF\u7531\u65B9\u6848"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u9884\u7B97\u53EA\u8BA1\u7B97\u8D70 API Key \u6216\u6A21\u578B\u76EE\u5F55 API \u7684\u82B1\u8D39\uFF08CLI \u81EA\u62A5\u91D1\u989D\u6216 token \u7528\u91CF \xD7 \u4F60\u914D\u7F6E\u7684\u5355\u4EF7\uFF09\u3002\u5B98\u65B9 CLI \u7528\u8BA2\u9605\u8D26\u53F7\u767B\u5F55\u3001\u672A\u6CE8\u5165 API Key \u65F6\uFF0C\u53EA\u663E\u793A\u6309 API \u4EF7\u6298\u7B97\u7684\u201C\u8BA2\u9605\u53C2\u8003\u8D39\u7528\u201D\uFF0C\u4E0D\u8BA1\u5165\u9884\u7B97\u3002\u7F3A\u5C11\u5355\u4EF7\u7684\u8C03\u7528\u8BA1\u4E3A\u201C\u8D39\u7528\u672A\u77E5\u201D\u3002\u8FD9\u662F\u672C\u673A\u4F30\u7B97\uFF0C\u4E0D\u662F\u5382\u5546\u8D26\u5355\u3002"))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, error), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-meters" }, /* @__PURE__ */ import_react2.default.createElement(Meter, { label: "\u4ECA\u65E5\u5DF2\u7528\uFF08\u8BA1\u5165\u9884\u7B97\uFF09", meter: budgetMeter(spent.today, daily) }), /* @__PURE__ */ import_react2.default.createElement(Meter, { label: "\u672C\u6708\u5DF2\u7528\uFF08\u8BA1\u5165\u9884\u7B97\uFF09", meter: budgetMeter(spent.month, monthly) })), (spent.subscriptionRunsMonth ?? 0) > 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u8BA2\u9605\u53C2\u8003\u8D39\u7528\uFF08\u6309 API \u4EF7\u6298\u7B97\uFF0C\u4E0D\u8BA1\u5165\u9884\u7B97\uFF09\uFF1A\u4ECA\u65E5 ", money(spent.subscriptionToday ?? 0), " \xB7 \u672C\u6708 ", money(spent.subscriptionMonth ?? 0), "\uFF0C\u672C\u6708\u5171 ", spent.subscriptionRunsMonth, " \u6B21\u8BA2\u9605\u767B\u5F55\u8C03\u7528\u3002"), (spent.unknownToday > 0 || spent.unknownMonth > 0) && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u672C\u6708\u6709 ", spent.unknownMonth, " \u6B21\u8C03\u7528\u7F3A\u5C11\u5355\u4EF7\u6216\u7528\u91CF\uFF0C\u672A\u8BA1\u5165\u91D1\u989D\u3002\u8BF7\u5728\u201C\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u201D\u4E2D\u8865\u9F50\u5355\u4EF7\u3002"), ledger?.budget?.exceeded && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, ledger.budget.message, " ", ledger.budget.action === "pause" ? "\u65B0\u7684\u6267\u884C\u4F1A\u5148\u6682\u505C\u5E76\u8BF7\u6C42\u786E\u8BA4\u3002" : "\u65B0\u7684\u6267\u884C\u4F1A\u5C1D\u8BD5\u81EA\u52A8\u964D\u7EA7\u4E3A\u201C\u7701\u94B1\u4F18\u5148\u201D\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, "\u8DEF\u7531\u65B9\u6848"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-segment", role: "group", "aria-label": "\u8DEF\u7531\u65B9\u6848" }, Object.values(ROUTING_PRESETS).map((item) => /* @__PURE__ */ import_react2.default.createElement("button", { key: item.id, type: "button", title: item.description, "aria-pressed": preset === item.id, disabled: !settings.writable, onClick: () => {
    void set("routingPreset", item.id);
  } }, item.label))), /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, ROUTING_PRESETS[preset]?.description)), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-daily-budget" }, "\u6BCF\u65E5\u4E0A\u9650\uFF08USD\uFF0C0 \u4E3A\u4E0D\u9650\uFF09"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-inline" }, /* @__PURE__ */ import_react2.default.createElement("input", { className: "mr-input mr-budget", id: "mr-daily-budget", type: "number", min: "0", step: "0.5", placeholder: String(daily), value: dailyDraft, onChange: (event) => setDailyDraft(event.target.value) }), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !settings.writable || dailyDraft === "", onClick: () => {
    void saveLimit("dailyBudgetUsd", dailyDraft, setDailyDraft);
  } }, "\u4FDD\u5B58"))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-monthly-budget" }, "\u6BCF\u6708\u4E0A\u9650\uFF08USD\uFF0C0 \u4E3A\u4E0D\u9650\uFF09"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-inline" }, /* @__PURE__ */ import_react2.default.createElement("input", { className: "mr-input mr-budget", id: "mr-monthly-budget", type: "number", min: "0", step: "1", placeholder: String(monthly), value: monthlyDraft, onChange: (event) => setMonthlyDraft(event.target.value) }), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: !settings.writable || monthlyDraft === "", onClick: () => {
    void saveLimit("monthlyBudgetUsd", monthlyDraft, setMonthlyDraft);
  } }, "\u4FDD\u5B58"))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, "\u8D85\u51FA\u9884\u7B97\u65F6"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-segment", role: "group", "aria-label": "\u8D85\u51FA\u9884\u7B97\u65F6" }, /* @__PURE__ */ import_react2.default.createElement("button", { type: "button", "aria-pressed": (value.overBudgetAction ?? "downgrade") === "downgrade", disabled: !settings.writable, onClick: () => {
    void set("overBudgetAction", "downgrade");
  } }, "\u81EA\u52A8\u964D\u7EA7"), /* @__PURE__ */ import_react2.default.createElement("button", { type: "button", "aria-pressed": value.overBudgetAction === "pause", disabled: !settings.writable, onClick: () => {
    void set("overBudgetAction", "pause");
  } }, "\u6682\u505C\u5E76\u8BE2\u95EE"))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, "\u8BA2\u9605\u8C03\u7528\u5931\u8D25\uFF08\u975E\u989D\u5EA6\u7528\u5C3D\uFF09\u65F6"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-segment", role: "group", "aria-label": "\u8BA2\u9605\u8C03\u7528\u5931\u8D25\u65F6" }, SUBSCRIPTION_FAILURE_OPTIONS.map(([id2, label]) => /* @__PURE__ */ import_react2.default.createElement("button", { key: id2, type: "button", "aria-pressed": (value.onSubscriptionFailure ?? "ask") === id2, disabled: !settings.writable, onClick: () => {
    void set("onSubscriptionFailure", id2);
  } }, label))), /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u8D85\u65F6\u3001\u5D29\u6E83\u3001\u89E3\u6790\u5931\u8D25\u3001\u975E\u96F6\u9000\u51FA\u3001\u767B\u5F55\u9519\u8BEF\u7B49\u3002\u989D\u5EA6\u7528\u5C3D\u6216\u9650\u6D41\u4ECD\u4F1A\u81EA\u52A8\u5207\u6362 API Key\u3002"))), /* @__PURE__ */ import_react2.default.createElement("h3", { className: "mr-section-title" }, "\u8D28\u91CF\u56DE\u8DEF"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-control-label" }, "\u5F3A\u6A21\u578B\u62BD\u67E5"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-segment", role: "group", "aria-label": "\u5F3A\u6A21\u578B\u62BD\u67E5" }, [["off", "\u5173\u95ED"], ["sample", "\u6309\u6BD4\u4F8B\u62BD\u67E5"], ["always", "\u6BCF\u6B21\u5BA1\u9605"]].map(([id2, label]) => /* @__PURE__ */ import_react2.default.createElement("button", { key: id2, type: "button", "aria-pressed": (value.reviewMode ?? "off") === id2, disabled: !settings.writable, onClick: () => {
    void set("reviewMode", id2);
  } }, label))), /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u62BD\u67E5\u7531\u76EE\u5F55\u4E2D\u8D28\u91CF\u6700\u9AD8\u7684\u5DF2\u914D\u7F6E\u6A21\u578B\u5B8C\u6210\uFF0C\u53EA\u5BA1\u9605\u66F4\u4FBF\u5B9C\u6A21\u578B\u7684\u7ED3\u679C\uFF1B\u5BA1\u9605\u672C\u8EAB\u4E5F\u4F1A\u8BA1\u8D39\u3002\u62BD\u67E5\u6BD4\u4F8B ", Math.round(Number(value.reviewSampleRate ?? 0.2) * 100), "%\uFF08\u53EF\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u8C03\u6574\uFF09\u3002")), /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-check" }, /* @__PURE__ */ import_react2.default.createElement("input", { type: "checkbox", checked: value.allowManualReassign !== false, disabled: !settings.writable, onChange: (event) => {
    void set("allowManualReassign", event.target.checked);
  } }), "\u5141\u8BB8\u624B\u52A8\u6539\u6D3E\u5DE5\u4F5C\u5305"), /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-check" }, /* @__PURE__ */ import_react2.default.createElement("input", { type: "checkbox", checked: value.confirmUnsandboxedCli !== false, disabled: !settings.writable, onChange: (event) => {
    void set("confirmUnsandboxedCli", event.target.checked);
  } }), "\u76F4\u63A5\u542F\u52A8\u65E0\u6C99\u7BB1 CLI \u524D\u5148\u786E\u8BA4")), /* @__PURE__ */ import_react2.default.createElement(AdaptiveControls, { ledger, settings, onChanged, refreshing }), settings.notice && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, settings.notice)));
}
function DagView({ packages, renderNode, label = "\u5B50\u4EFB\u52A1\u4F9D\u8D56\u56FE" }) {
  const layers = dagLayers(packages);
  if (layers.length === 0) return null;
  const names = new Map((packages ?? []).map((item) => [item.id, item.name]));
  return /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-dag", role: "list", "aria-label": label }, layers.map((layer, index) => /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-dag-column", key: index }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-dag-step" }, "\u7B2C ", index + 1, " \u6B65"), layer.map((item) => {
    const status = packageStatus(item);
    return /* @__PURE__ */ import_react2.default.createElement("article", { className: `mr-dag-node ${status.tone}`, role: "listitem", key: item.id }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-dag-node-top" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-package-name" }, item.name), /* @__PURE__ */ import_react2.default.createElement("span", { className: `mr-pill mr-status-${status.tone}` }, status.label)), (item.dependsOn ?? []).length > 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u4F9D\u8D56\uFF1A", item.dependsOn.map((id2) => names.get(id2) ?? id2).join("\u3001")), renderNode?.(item));
  }))));
}
function ChannelText({ item }) {
  if (!item.channel) return /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-pill" }, "\u5F85\u6267\u884C");
  return /* @__PURE__ */ import_react2.default.createElement("span", { className: item.channel === "official-cli" ? "mr-pill mr-pill-channel-ok" : "mr-pill" }, item.channel === "official-cli" ? `\u5B98\u65B9 CLI \xB7 ${item.toolId ?? ""}` : "\u6A21\u578B\u76EE\u5F55 API");
}
function RunNode({ run, item, routes, allowReassign, busy, onRate, onRerun }) {
  const [target, setTarget] = import_react2.default.useState("");
  if (item.status === "paused") return /* @__PURE__ */ import_react2.default.createElement(PausedNode, { run, item, busy, onRerun });
  const cost = packageCost(item);
  const rerun = rerunSupport(run);
  const canRerun = rerun.supported && !item.ok && !busy;
  const others = routes.filter((route) => `${route.provider}/${route.model}` !== `${item.provider}/${item.model}`);
  return /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-route" }, item.provider, "/", item.model, item.reassigned ? "\uFF08\u5DF2\u6539\u6D3E\uFF09" : ""), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-channel-line" }, /* @__PURE__ */ import_react2.default.createElement(ChannelText, { item }), /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u9884\u4F30 ", money(item.estimatedCost), " \xB7 \u5B9E\u9645 ", cost.budget, item.difficulty ? ` \xB7 \u96BE\u5EA6 ${BAND[item.difficulty] ?? item.difficulty}` : "")), cost.reference && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, cost.reference), item.actualModel && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "CLI \u56DE\u62A5\u6A21\u578B\uFF1A", item.actualModel), (item.billing || item.billingMode) && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u8BA1\u8D39\uFF1A", BILLING_CHANNEL_LABEL[item.billing] ?? "\u2014", item.subscriptionRoute ? ` \xB7 \u5957\u9910\u8DEF\u7EBF ${item.subscriptionRoute.provider}/${item.subscriptionRoute.model}` : "", item.billingMode && item.billingMode !== "subscription-first" ? ` \xB7 ${BILLING_MODE_LABEL[item.billingMode] ?? item.billingMode}` : ""), billingSwitchText(item) && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy mr-warn-text" }, "\u8BA1\u8D39\u5207\u6362\uFF1A", billingSwitchText(item)), item.fallback?.reason && item.fallback.reason !== billingSwitchText(item) && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u56DE\u9000\u539F\u56E0\uFF1A", item.fallback.reason), item.fallback?.error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy mr-fallback-error" }, "CLI \u539F\u59CB\u9519\u8BEF\uFF1A", /* @__PURE__ */ import_react2.default.createElement("code", null, item.fallback.error)), !item.ok && item.error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy mr-fallback-error" }, item.error), item.review && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u5F3A\u6A21\u578B\u62BD\u67E5\uFF08", item.review.provider, "/", item.review.model, "\uFF09\uFF1A", item.review.score ? `${item.review.score}/5` : "\u672A\u8BC4\u5206", " ", item.review.summary), item.answer && /* @__PURE__ */ import_react2.default.createElement("details", { className: "mr-tool-log" }, /* @__PURE__ */ import_react2.default.createElement("summary", null, "\u67E5\u770B\u7ED3\u679C"), /* @__PURE__ */ import_react2.default.createElement("pre", null, item.answer, item.answerTruncated ? "\n\u2026\uFF08\u5DF2\u622A\u65AD\uFF09" : "")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-node-actions" }, item.ok && /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary mr-mini", type: "button", title: item.rating === 1 ? "\u518D\u6B21\u70B9\u51FB\u64A4\u56DE\u6709\u7528\u8BC4\u4EF7" : "\u8BC4\u4EF7\u6B64\u7ED3\u679C\u6709\u7528", "aria-pressed": item.rating === 1, disabled: busy, onClick: () => onRate(...feedbackRatingArguments(run, item, "up")) }, "\u{1F44D} \u6709\u7528"), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary mr-mini", type: "button", title: item.rating === -1 ? "\u518D\u6B21\u70B9\u51FB\u64A4\u56DE\u4E0D\u597D\u8BC4\u4EF7" : "\u8BC4\u4EF7\u6B64\u7ED3\u679C\u4E0D\u597D", "aria-pressed": item.rating === -1, disabled: busy, onClick: () => onRate(...feedbackRatingArguments(run, item, "down")) }, "\u{1F44E} \u4E0D\u597D")), canRerun && /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-mini", type: "button", title: rerun.confirm || void 0, onClick: () => onRerun(run.id, item.id, null) }, run.kind === "tool" ? "\u91CD\u65B0\u6267\u884C\u6B64\u8C03\u7528" : rerun.writes ? "\u5728\u65B0\u5DE5\u4F5C\u533A\u7EED\u8DD1" : "\u91CD\u8DD1\u6B64\u6B65"), !rerun.supported && !item.ok && item.ran && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, rerun.reason), rerun.supported && rerun.reassign && !(rerun.writes && item.ok) && allowReassign && others.length > 0 && !busy && /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-inline" }, /* @__PURE__ */ import_react2.default.createElement("select", { className: "mr-input mr-mini-select", "aria-label": "\u6539\u6D3E\u5230", value: target, onChange: (event) => setTarget(event.target.value) }, /* @__PURE__ */ import_react2.default.createElement("option", { value: "" }, "\u6539\u6D3E\u5230\u2026"), others.map((route) => /* @__PURE__ */ import_react2.default.createElement("option", { key: `${route.provider}/${route.model}`, value: `${route.provider}\0${route.model}` }, route.provider, "/", route.model))), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary mr-mini", type: "button", disabled: !target, onClick: () => {
    const [provider, model] = target.split("\0");
    onRerun(run.id, item.id, { provider, model });
  } }, "\u6539\u6D3E\u5E76\u91CD\u8DD1"))));
}
function PausedNode({ run, item, busy, onRerun }) {
  const pause = item.pause ?? {};
  return /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-route" }, item.provider, "/", item.model), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-channel-line" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-pill mr-pill-warn" }, "\u7B49\u5F85\u786E\u8BA4"), /* @__PURE__ */ import_react2.default.createElement("span", { className: "mr-caption" }, "\u8BA2\u9605\u8C03\u7528\u5931\u8D25\uFF0C\u672A\u81EA\u52A8\u6539\u7528 API Key")), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy mr-warn-text" }, pause.reason ?? item.error), pause.detail && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy mr-fallback-error" }, "\u771F\u5B9E\u9519\u8BEF\uFF1A", /* @__PURE__ */ import_react2.default.createElement("code", null, pause.detail)), pause.loginRequired && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-package-copy" }, "\u770B\u8D77\u6765\u662F\u767B\u5F55\u95EE\u9898\uFF1A\u8BF7\u5148\u5728\u7EC8\u7AEF\u91CD\u65B0\u767B\u5F55\u8BE5 CLI\uFF0C\u518D\u70B9\u201C\u91CD\u8BD5\u8BA2\u9605\u201D\u3002"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-node-actions" }, SUBSCRIPTION_CHOICE_BUTTONS.map(([choice, label, secondary]) => /* @__PURE__ */ import_react2.default.createElement(
    "button",
    {
      key: choice,
      className: `mr-button mr-mini${secondary ? " mr-button-secondary" : ""}`,
      type: "button",
      disabled: busy,
      onClick: () => onRerun(run.id, item.id, null, choice)
    },
    label
  ))));
}
function RunHistoryCard({ ledger, routes, onRefresh, onRate, onRerun, busy, error }) {
  const runs = ledger?.runs ?? [];
  const [openId, setOpenId] = import_react2.default.useState(null);
  const current = runs.find((run) => run.id === openId) ?? runs[0];
  const totals = runTotals(current);
  const prior = priorAttemptTotals(current);
  const unknownCalls = prior.unknownCalls + [...current?.packages ?? [], ...current?.reviews ?? []].filter((item) => item.ran && item.billing !== "subscription" && !Number.isFinite(item.costUsd)).length;
  return /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card mr-results", "aria-label": "\u6267\u884C\u8BB0\u5F55" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u6267\u884C\u8BB0\u5F55\u4E0E\u5B50\u4EFB\u52A1"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u67E5\u770B\u6A21\u578B\u5206\u914D\u3001\u9010\u6B65\u7ED3\u679C\u4E0E\u8D39\u7528\u3002\u5931\u8D25\u6B65\u9AA4\u53EF\u91CD\u8DD1\u6216\u6539\u6D3E\uFF1B\u5DF2\u5B8C\u6210\u7684\u4E0A\u6E38\u4FDD\u6301\u539F\u7ED3\u679C\u3002")), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: busy, onClick: onRefresh }, "\u5237\u65B0")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, error), !ledger && !error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-empty", role: "status" }, "\u6B63\u5728\u8BFB\u53D6\u6267\u884C\u8BB0\u5F55\u2026"), ledger && runs.length === 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-empty" }, "\u8FD8\u6CA1\u6709\u6267\u884C\u8BB0\u5F55\u3002\u53EF\u5728\u4E0A\u65B9\u201C\u5728\u5DE5\u4F5C\u53F0\u6267\u884C\u201D\u4E2D\u9884\u89C8\u5E76\u6267\u884C\uFF0C\u6216\u5728\u5B98\u65B9\u4F1A\u8BDD\u4E2D\u8C03\u7528 model_router_execute\u3001model_router_team_execute\u3001model_router_tool_run\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u51B3\u7B56\u548C\u7ED3\u679C\u3002"), runs.length > 0 && /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, /* @__PURE__ */ import_react2.default.createElement("label", { className: "mr-label", htmlFor: "mr-run-select" }, "\u9009\u62E9\u8BB0\u5F55"), /* @__PURE__ */ import_react2.default.createElement("select", { className: "mr-input", id: "mr-run-select", value: current?.id ?? "", onChange: (event) => setOpenId(event.target.value) }, runs.map((run) => /* @__PURE__ */ import_react2.default.createElement("option", { key: run.id, value: run.id }, new Date(run.createdAt).toLocaleString(), " \xB7 ", RUN_KIND_LABEL[run.kind ?? "assign"] ?? run.kind, " \xB7 ", RUN_STATUS_LABEL[run.status] ?? run.status, " \xB7 ", run.task.slice(0, 40)))), current && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-run" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-result-grid" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u65B9\u6848"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, ROUTING_PRESETS[current.preset]?.label ?? current.preset, current.budget?.downgraded ? "\uFF08\u8D85\u9884\u7B97\u81EA\u52A8\u964D\u7EA7\uFF09" : "")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u96BE\u5EA6"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, BAND[current.decision?.complexity?.band] ?? "\u2014", current.decision?.complexity?.value !== null && current.decision?.complexity?.value !== void 0 ? ` \xB7 ${current.decision.complexity.value}` : "")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u9884\u4F30 / ", unknownCalls ? "\u5DF2\u77E5\u5B9E\u9645" : "\u5B9E\u9645", "\uFF08\u8BA1\u5165\u9884\u7B97\uFF09"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, money(current.decision?.estimatedCost), " / ", money(totals.budgetUsd))), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-label" }, "\u7C7B\u578B"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-metric-value" }, RUN_KIND_LABEL[current.kind ?? "assign"] ?? current.kind, current.kind === "team" || current.kind === "tool" ? ` \xB7 ${current.executionMode === "workspace-write" ? "\u53EF\u7F16\u8F91" : "\u53EA\u8BFB"}` : ""))), totals.subscription && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u8BA2\u9605\u53C2\u8003\u8D39\u7528\uFF08\u6309 API \u4EF7\u6298\u7B97\uFF0C\u4E0D\u8BA1\u5165\u9884\u7B97\uFF09\uFF1A", money(totals.referenceUsd)), unknownCalls > 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u53E6\u6709 ", unknownCalls, " \u6B21\u8C03\u7528\u8D39\u7528\u672A\u77E5\uFF0C\u672A\u8BA1\u5165\u4E0A\u65B9\u91D1\u989D\u3002"), (prior.budgetUsd > 0 || prior.subscriptionRuns > 0 || prior.unknownCalls > 0) && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u7D2F\u8BA1\u5305\u542B\u6B64\u524D\u91CD\u8DD1\u5C1D\u8BD5\uFF1AAPI ", money(prior.budgetUsd), " \xB7 \u8BA2\u9605\u53C2\u8003 ", money(prior.referenceUsd), prior.unknownCalls > 0 ? ` \xB7 \u8D39\u7528\u672A\u77E5 ${prior.unknownCalls} \u6B21` : "", "\u3002\u4E0B\u65B9\u8282\u70B9\u663E\u793A\u6700\u8FD1\u4E00\u6B21\u7ED3\u679C\u3002"), current.isolatedWorkspace && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u72EC\u7ACB\u5DE5\u4F5C\u533A\uFF1A", /* @__PURE__ */ import_react2.default.createElement("code", null, current.isolatedWorkspace)), current.rerunOf && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u91CD\u65B0\u6267\u884C\u81EA\u8FD0\u884C ", current.rerunOf.slice(0, 8), "\u3002"), current.decision?.reason && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u8DEF\u7531\u539F\u56E0\uFF1A", current.decision.reason), /* @__PURE__ */ import_react2.default.createElement(DagView, { packages: current.packages, renderNode: (item) => /* @__PURE__ */ import_react2.default.createElement(RunNode, { run: current, item, routes, allowReassign: ledger?.settings?.allowManualReassign !== false, busy, onRate, onRerun }) })))));
}
function BillingCard({ billing, error, onRefresh, refreshing }) {
  const rows = billingRows(billing);
  return /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card mr-results", "aria-label": "\u8BA2\u9605\u4E0E API Key" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u8BA2\u9605\u4E0E API Key"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u9ED8\u8BA4\u8BA2\u9605\u4F18\u5148\uFF1A\u6709\u8BA2\u9605\uFF08\u5B98\u65B9 CLI \u8D26\u53F7\u767B\u5F55\u6216\u7F16\u7A0B\u5957\u9910 Key \u8DEF\u7EBF\uFF09\u5C31\u5148\u7528\u8BA2\u9605\uFF1B\u8BA2\u9605\u989D\u5EA6\u7528\u5C3D\u6216\u9650\u6D41\u65F6\uFF0C\u540C\u4E00\u6B65\u9AA4\u81EA\u52A8\u6539\u7528 API Key\uFF0C\u5E76\u5728\u6267\u884C\u8BB0\u5F55\u4E2D\u5199\u660E\u539F\u56E0\u3002\u8BA2\u9605\u8FD0\u884C\u53EA\u663E\u793A\u53C2\u8003\u8D39\u7528\uFF0C\u4E0D\u8BA1\u5165\u9884\u7B97\u3002")), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: refreshing, onClick: onRefresh }, "\u91CD\u65B0\u4F53\u68C0")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, error), billing?.quotaPatternErrors?.length > 0 && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, "\u989D\u5EA6\u8BC6\u522B\u89C4\u5219\u6709\u8BEF\uFF0C\u5DF2\u5FFD\u7565\uFF1A", billing.quotaPatternErrors.join("\uFF1B")), rows.length === 0 && !error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-empty", role: billing ? void 0 : "status" }, billing ? "\u6A21\u578B\u76EE\u5F55\u4E2D\u6CA1\u6709\u8DEF\u7EBF\uFF1B\u8BF7\u5148\u5728\u5B98\u65B9\u201C\u6A21\u578B\u201D\u9875\u6DFB\u52A0\u6A21\u578B\uFF0C\u518D\u70B9\u201C\u5237\u65B0\u201D\u3002" : "\u6B63\u5728\u8BFB\u53D6\u8BA1\u8D39\u72B6\u6001\u2026"), rows.length > 0 && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-table-wrap" }, /* @__PURE__ */ import_react2.default.createElement("table", { className: "mr-table" }, /* @__PURE__ */ import_react2.default.createElement("thead", null, /* @__PURE__ */ import_react2.default.createElement("tr", null, /* @__PURE__ */ import_react2.default.createElement("th", null, "\u4F9B\u5E94\u5546"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u8BA1\u8D39\u65B9\u5F0F"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u8BA2\u9605"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u8BA2\u9605\u72B6\u6001 / \u6062\u590D\u65F6\u95F4"), /* @__PURE__ */ import_react2.default.createElement("th", null, "API Key \u56DE\u9000"))), /* @__PURE__ */ import_react2.default.createElement("tbody", null, rows.map((row) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: row.key }, /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("strong", null, row.provider), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-caption" }, row.models)), /* @__PURE__ */ import_react2.default.createElement("td", null, row.mode), /* @__PURE__ */ import_react2.default.createElement("td", null, row.subscription), /* @__PURE__ */ import_react2.default.createElement("td", { className: row.exhausted ? "mr-warn-text" : "" }, row.state), /* @__PURE__ */ import_react2.default.createElement("td", { className: row.apiAvailable ? "" : "mr-warn-text" }, row.api)))))), billing && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-caption" }, "\u5382\u5546\u6CA1\u6709\u7ED9\u51FA\u6062\u590D\u65F6\u95F4\u65F6\uFF0C\u6309\u8BBE\u7F6E\u4E2D\u7684\u51B7\u5374\u65F6\u95F4\uFF08", billing.cooldownMinutes ?? 60, " \u5206\u949F\uFF09\u6682\u505C\u4F7F\u7528\u8BE5\u8BA2\u9605\u3002\u56E2\u961F\u6267\u884C\u548C\u5355\u5DE5\u5177\u8C03\u7528\u53EA\u80FD\u901A\u8FC7\u5B98\u65B9 CLI \u4FEE\u6539\u6587\u4EF6\uFF0C\u989D\u5EA6\u7528\u5C3D\u65F6\u4F1A\u8BB0\u5F55\u5E76\u63D0\u793A\uFF0C\u4F46\u4E0D\u4F1A\u81EA\u52A8\u6539\u7528 API Key\u3002")));
}
function SecurityCard({ data, error, onRefresh }) {
  const rows = data?.boundaries ?? [];
  return /* @__PURE__ */ import_react2.default.createElement("section", { className: "mr-card mr-results", "aria-label": "\u5B89\u5168\u8FB9\u754C" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "mr-card-title" }, "\u5B89\u5168\u8FB9\u754C"), /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-card-copy" }, "\u6BCF\u6761\u5DF2\u914D\u7F6E\u8DEF\u7EBF\u53EF\u8BFB\u3001\u53EF\u5199\u7684\u8303\u56F4\u548C\u662F\u5426\u7ECF\u8FC7 Harness \u8FDB\u7A0B\u6C99\u7BB1\u3002\u53EF\u7F16\u8F91\u8FD0\u884C\u603B\u662F\u9700\u8981\u4F60\u5728\u5B98\u65B9\u5BA1\u6279\u4E2D\u786E\u8BA4\uFF1B\u76F4\u63A5\u542F\u52A8\u65E0\u6C99\u7BB1 CLI \u524D\u9ED8\u8BA4\u4E5F\u4F1A\u8BE2\u95EE\u3002")), /* @__PURE__ */ import_react2.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", onClick: onRefresh }, "\u5237\u65B0")), /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-card-body" }, error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error", role: "alert" }, error), data && !data.sandboxAvailable && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-error" }, "\u5F53\u524D Host \u6CA1\u6709\u63D0\u4F9B Harness \u8FDB\u7A0B\u6C99\u7BB1\uFF1A\u53EF\u7F16\u8F91\u8FD0\u884C\u4F1A\u88AB\u62D2\u7EDD\uFF0C\u53EA\u8BFB\u7684\u65E0\u754C\u9762 CLI \u5C06\u76F4\u63A5\u542F\u52A8\u3002"), rows.length === 0 && !error && /* @__PURE__ */ import_react2.default.createElement("p", { className: "mr-empty", role: data ? void 0 : "status" }, data ? "\u6A21\u578B\u76EE\u5F55\u4E2D\u6CA1\u6709\u8DEF\u7EBF\uFF1B\u8BF7\u5148\u5728\u5B98\u65B9\u201C\u6A21\u578B\u201D\u9875\u6DFB\u52A0\u6A21\u578B\uFF0C\u518D\u70B9\u201C\u5237\u65B0\u201D\u3002" : "\u6B63\u5728\u8BFB\u53D6\u5B89\u5168\u8FB9\u754C\u2026"), rows.length > 0 && /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-table-wrap" }, /* @__PURE__ */ import_react2.default.createElement("table", { className: "mr-table" }, /* @__PURE__ */ import_react2.default.createElement("thead", null, /* @__PURE__ */ import_react2.default.createElement("tr", null, /* @__PURE__ */ import_react2.default.createElement("th", null, "\u8DEF\u7EBF"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u53EA\u8BFB\u8FD0\u884C\u53EF\u8BFB"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u53EA\u8BFB\u8FD0\u884C\u6C99\u7BB1"), /* @__PURE__ */ import_react2.default.createElement("th", null, "\u53EF\u7F16\u8F91\u8FD0\u884C"))), /* @__PURE__ */ import_react2.default.createElement("tbody", null, rows.map((row) => /* @__PURE__ */ import_react2.default.createElement("tr", { key: `${row.provider}/${row.model}` }, /* @__PURE__ */ import_react2.default.createElement("td", null, /* @__PURE__ */ import_react2.default.createElement("strong", null, row.provider, "/", row.model), row.toolLabel ? /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-caption" }, row.toolLabel) : /* @__PURE__ */ import_react2.default.createElement("div", { className: "mr-caption" }, "\u4EC5 API")), /* @__PURE__ */ import_react2.default.createElement("td", null, row.readOnly.readable), /* @__PURE__ */ import_react2.default.createElement("td", { className: row.readOnly.direct ? "mr-warn-text" : "" }, row.readOnly.sandbox), /* @__PURE__ */ import_react2.default.createElement("td", null, row.write ? `${row.write.writable}\uFF1B\u9700\u5BA1\u6279` : "\u4E0D\u652F\u6301"))))))));
}

// .dsh-plugin/client/run-launcher.jsx
var import_react3 = __toESM(require("react"), 1);
var text2 = (value) => typeof value === "string" ? value.trim() : "";
var STATUS_TEXT = Object.freeze({
  succeeded: "\u6267\u884C\u5B8C\u6210",
  completed: "\u6267\u884C\u5B8C\u6210",
  partial: "\u90E8\u5206\u6B65\u9AA4\u5931\u8D25",
  failed: "\u6267\u884C\u5931\u8D25",
  cancelled: "\u5DF2\u53D6\u6D88",
  "paused-budget": "\u5DF2\u56E0\u9884\u7B97\u6682\u505C\uFF0C\u672A\u542F\u52A8\u6A21\u578B",
  "paused-subscription-failure": "\u6709\u6B65\u9AA4\u56E0\u8BA2\u9605\u8C03\u7528\u5931\u8D25\u800C\u6682\u505C\uFF0C\u8BF7\u5728\u4E0B\u65B9\u6267\u884C\u8BB0\u5F55\u4E2D\u9009\u62E9\u5982\u4F55\u7EE7\u7EED"
});
function RunLauncher({ task, mode, directRoute, budgetUsd, defaultPreset, ledger, previewRun, startRun, onStarted, disabledReason, planningRevision }) {
  const [preset, setPreset] = import_react3.default.useState(defaultPreset || "balanced");
  const lastWorkspace = [...ledger?.runs ?? []].map((run) => run.workspace).find(Boolean) ?? "";
  const [workspace, setWorkspace] = import_react3.default.useState("");
  const [phase, setPhase] = import_react3.default.useState({ kind: "idle" });
  const mounted = import_react3.default.useRef(true);
  const confirmRef = import_react3.default.useRef(null);
  const pendingRequest = import_react3.default.useRef(0);
  const inputSignature = JSON.stringify([task, mode, directRoute?.provider, directRoute?.model, budgetUsd, preset, workspace, lastWorkspace, planningRevision, disabledReason]);
  const latestSignature = import_react3.default.useRef(inputSignature);
  latestSignature.current = inputSignature;
  import_react3.default.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRequest.current += 1;
    };
  }, []);
  import_react3.default.useEffect(() => {
    setPreset(defaultPreset || "balanced");
  }, [defaultPreset]);
  import_react3.default.useEffect(() => {
    pendingRequest.current += 1;
    setPhase((previous) => ["previewing", "preview", "error"].includes(previous.kind) ? { kind: "idle" } : previous);
  }, [inputSignature]);
  import_react3.default.useEffect(() => {
    if (phase.kind === "preview") confirmRef.current?.focus();
  }, [phase.kind]);
  const request = () => launchRequest({ task, mode, directRoute, budgetUsd, preset, workspace: text2(workspace) || lastWorkspace });
  const unavailable = typeof previewRun !== "function" || typeof startRun !== "function";
  const blocked = disabledReason || (unavailable ? "\u5DE5\u4F5C\u53F0\u6267\u884C\u670D\u52A1\u5C1A\u672A\u52A0\u8F7D\uFF0C\u8BF7\u66F4\u65B0\u63D2\u4EF6\u540E\u91CD\u8BD5\u3002" : !text2(task) ? "\u5148\u5728\u4E0A\u65B9\u201C\u4EFB\u52A1\u89C4\u5212\u201D\u4E2D\u63CF\u8FF0\u4EFB\u52A1\u3002" : "");
  const busy = phase.kind === "previewing" || phase.kind === "running";
  const preview = async () => {
    if (blocked || busy) return;
    const current = ++pendingRequest.current;
    const snapshot = request();
    const signature2 = inputSignature;
    setPhase({ kind: "previewing" });
    try {
      const value = unwrapRemote(await previewRun(snapshot), "\u6267\u884C\u9884\u89C8\u5931\u8D25\u3002");
      if (mounted.current && current === pendingRequest.current && signature2 === latestSignature.current) setPhase({ kind: "preview", value, request: snapshot, signature: signature2 });
    } catch (error) {
      if (mounted.current && current === pendingRequest.current && signature2 === latestSignature.current) setPhase({ kind: "error", message: text2(error?.message) || "\u6267\u884C\u9884\u89C8\u5931\u8D25\u3002" });
    }
  };
  const confirm2 = async () => {
    if (phase.kind !== "preview" || phase.signature !== latestSignature.current) return;
    const shown = phase.value;
    const snapshot = phase.request;
    const signature2 = phase.signature;
    setPhase({ kind: "running", value: shown, request: snapshot, signature: signature2 });
    try {
      const value = unwrapRemote(await startRun({ ...snapshot, confirmedReasons: (shown.reasons ?? []).map((item) => item.code) }), "\u6267\u884C\u5931\u8D25\u3002");
      if (!mounted.current) return;
      if (value.status === "needs-confirmation") {
        setPhase(signature2 === latestSignature.current ? { kind: "preview", value, request: snapshot, signature: signature2, changed: true } : { kind: "idle" });
        return;
      }
      setPhase({ kind: "done", value });
      onStarted?.(value.runId);
    } catch (error) {
      if (mounted.current) setPhase({ kind: "error", message: text2(error?.message) || "\u6267\u884C\u5931\u8D25\u3002" });
    }
  };
  return /* @__PURE__ */ import_react3.default.createElement("section", { className: "mr-card", "aria-label": "\u5728\u5DE5\u4F5C\u53F0\u6267\u884C" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react3.default.createElement("div", null, /* @__PURE__ */ import_react3.default.createElement("h2", { className: "mr-card-title" }, "\u5728\u5DE5\u4F5C\u53F0\u6267\u884C"), /* @__PURE__ */ import_react3.default.createElement("p", { className: "mr-card-copy" }, "\u4F7F\u7528\u4E0A\u65B9\u7684\u4EFB\u52A1\u63CF\u8FF0\u4E0E\u89C4\u5212\u6A21\u5F0F\uFF0C\u5148\u9884\u89C8\u6267\u884C\u8BA1\u5212\u4E0E\u9884\u4F30\u8D39\u7528\uFF0C\u786E\u8BA4\u540E\u624D\u4F1A\u8C03\u7528\u6A21\u578B\u3002\u6267\u884C\u4E3A\u53EA\u8BFB\uFF1A\u5B98\u65B9 CLI \u4EE5\u65E0\u754C\u9762\u53EA\u8BFB\u65B9\u5F0F\u8FD0\u884C\uFF0C\u4E0D\u4FEE\u6539\u6587\u4EF6\uFF1B\u53EF\u7F16\u8F91\u4EFB\u52A1\u8BF7\u5728\u5B98\u65B9\u4F1A\u8BDD\u4E2D\u4F7F\u7528 model_router_tool_run \u6216 model_router_team_execute\u3002"))), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-card-body" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react3.default.createElement("span", { className: "mr-control-label", id: "mr-launch-preset" }, "\u8DEF\u7531\u65B9\u6848"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-segment", role: "group", "aria-labelledby": "mr-launch-preset" }, Object.values(ROUTING_PRESETS).map((item) => /* @__PURE__ */ import_react3.default.createElement("button", { key: item.id, type: "button", title: item.description, "aria-pressed": preset === item.id, disabled: busy || mode === "direct", onClick: () => setPreset(item.id) }, item.label)))), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-control-group mr-launch-workspace" }, /* @__PURE__ */ import_react3.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-launch-workspace" }, "\u5DE5\u4F5C\u533A\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF09"), /* @__PURE__ */ import_react3.default.createElement("input", { className: "mr-input", id: "mr-launch-workspace", value: workspace, disabled: busy, placeholder: lastWorkspace ? `\u7559\u7A7A\u6CBF\u7528\u4E0A\u6B21\u8FD0\u884C\uFF1A${lastWorkspace}` : "\u4F8B\u5982 D:\\projects\\demo \u6216 /home/me/demo", onChange: (event) => setWorkspace(event.target.value) }))), /* @__PURE__ */ import_react3.default.createElement("p", { className: "mr-caption" }, mode === "direct" ? `\u6307\u5B9A\u6A21\u578B\uFF1A${directRoute ? `${directRoute.provider}/${directRoute.model}` : "\u672A\u9009\u62E9"}\uFF08\u8DF3\u8FC7\u8DEF\u7531\uFF0C\u65B9\u6848\u4E0D\u751F\u6548\uFF09` : mode === "team" ? "\u56E2\u961F\u5206\u5DE5\uFF1A\u6309\u65B9\u6848\u62C6\u5206\u5DE5\u4F5C\u5305\uFF0C\u9010\u4E2A\u5206\u914D\u6A21\u578B\u3002" : "\u5355\u4EFB\u52A1\uFF1A\u6309\u65B9\u6848\u9009\u62E9\u4E00\u6761\u8DEF\u7EBF\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react3.default.createElement("button", { className: "mr-button", type: "button", disabled: Boolean(blocked) || busy, onClick: () => {
    void preview();
  } }, phase.kind === "previewing" ? "\u6B63\u5728\u751F\u6210\u9884\u89C8\u2026" : "\u9884\u89C8\u6267\u884C\u8BA1\u5212"), blocked && /* @__PURE__ */ import_react3.default.createElement("span", { className: "mr-caption" }, blocked)), phase.kind === "previewing" && /* @__PURE__ */ import_react3.default.createElement("p", { className: "mr-empty", role: "status" }, "\u6B63\u5728\u6309\u5F53\u524D\u6A21\u578B\u76EE\u5F55\u3001\u767B\u5F55\u72B6\u6001\u548C\u9884\u7B97\u751F\u6210\u6267\u884C\u8BA1\u5212\u2026"), phase.kind === "error" && /* @__PURE__ */ import_react3.default.createElement("p", { className: "mr-error", role: "alert" }, phase.message), (phase.kind === "preview" || phase.kind === "running") && /* @__PURE__ */ import_react3.default.createElement(
    LaunchPreview,
    {
      value: phase.value,
      changed: phase.changed,
      running: phase.kind === "running",
      confirmRef,
      onConfirm: () => {
        void confirm2();
      },
      onCancel: () => setPhase({ kind: "idle" })
    }
  ), phase.kind === "done" && /* @__PURE__ */ import_react3.default.createElement("div", { className: phase.value.status === "failed" || phase.value.status === "partial" || phase.value.status?.startsWith("paused") ? "mr-error" : "mr-empty", role: "status" }, STATUS_TEXT[phase.value.status] ?? `\u72B6\u6001\uFF1A${phase.value.status}`, phase.value.runId ? `\uFF1B\u7ED3\u679C\u5DF2\u8BB0\u5F55\uFF08\u8FD0\u884C ${phase.value.runId.slice(0, 8)}\uFF09\uFF0C\u89C1\u4E0B\u65B9\u201C\u6267\u884C\u8BB0\u5F55\u4E0E\u5B50\u4EFB\u52A1\u201D\u3002` : "\u3002", phase.value.budget?.message ? ` ${phase.value.budget.exceeded && phase.value.status !== "paused-budget" ? "\u5DF2\u6309\u4F60\u7684\u786E\u8BA4\u8D85\u9884\u7B97\u6267\u884C\uFF1A" : ""}${phase.value.budget.message}` : "")));
}
function LaunchPreview({ value, changed, running, confirmRef, onConfirm, onCancel }) {
  const packages = value.decision?.packages ?? [];
  const reasons = value.reasons ?? [];
  return /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-launch-preview", role: "region", "aria-label": "\u6267\u884C\u9884\u89C8" }, changed && /* @__PURE__ */ import_react3.default.createElement("p", { className: "mr-error", role: "alert" }, "\u786E\u8BA4\u671F\u95F4\u60C5\u51B5\u6709\u53D8\u5316\uFF08\u4F8B\u5982\u9884\u7B97\u6216\u767B\u5F55\u72B6\u6001\uFF09\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u4E0B\u9762\u7684\u786E\u8BA4\u9879\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-result-grid" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-label" }, "\u8DEF\u7EBF"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-value" }, value.selected ? `${value.selected.provider}/${value.selected.model}` : "\u6682\u65E0\u8DEF\u7EBF", value.routingBypassed ? "\uFF08\u6307\u5B9A\u6A21\u578B\uFF09" : "")), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-label" }, "\u9884\u4F30\u8D39\u7528"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-value" }, value.estimatedCost === null || value.estimatedCost === void 0 ? "\u4EF7\u683C\u5F85\u914D\u7F6E" : money(value.estimatedCost))), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-label" }, "\u65B9\u6848"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-value" }, ROUTING_PRESETS[value.decision?.preset]?.label ?? "\u2014", value.budget?.downgraded ? "\uFF08\u8D85\u9884\u7B97\u81EA\u52A8\u964D\u7EA7\uFF09" : "")), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-label" }, "\u5DE5\u4F5C\u533A"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-metric-value mr-break" }, /* @__PURE__ */ import_react3.default.createElement("code", null, value.workspace)))), value.budget?.message && /* @__PURE__ */ import_react3.default.createElement("p", { className: value.budget.exceeded ? "mr-error" : "mr-caption" }, "\u9884\u7B97\u68C0\u67E5\uFF1A", value.budget.message), packages.length > 0 && /* @__PURE__ */ import_react3.default.createElement("ol", { className: "mr-launch-packages" }, packages.map((item) => /* @__PURE__ */ import_react3.default.createElement("li", { key: item.id }, /* @__PURE__ */ import_react3.default.createElement("strong", null, item.name), " \u2192 ", item.route, " ", /* @__PURE__ */ import_react3.default.createElement("span", { className: "mr-caption" }, "\uFF08\u9884\u4F30 ", money(item.estimatedCost), item.channel === "official-cli" ? " \xB7 \u5B98\u65B9 CLI" : item.channel ? " \xB7 \u6A21\u578B\u76EE\u5F55 API" : "", "\uFF09")))), reasons.length > 0 ? /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-confirm-box" }, /* @__PURE__ */ import_react3.default.createElement("p", { className: "mr-section-title" }, "\u6267\u884C\u524D\u9700\u8981\u786E\u8BA4\u4EE5\u4E0B ", reasons.length, " \u9879\uFF1A"), /* @__PURE__ */ import_react3.default.createElement("ol", null, reasons.map((item) => /* @__PURE__ */ import_react3.default.createElement("li", { key: item.code }, item.zh)))) : /* @__PURE__ */ import_react3.default.createElement("p", { className: "mr-caption" }, "\u65E0\u9700\u989D\u5916\u786E\u8BA4\uFF1A\u672A\u8D85\u9884\u7B97\uFF0C\u4E5F\u4E0D\u4F1A\u4E0D\u7ECF\u6C99\u7BB1\u542F\u52A8 CLI\u3002"), /* @__PURE__ */ import_react3.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react3.default.createElement("button", { ref: confirmRef, className: "mr-button", type: "button", disabled: running, onClick: onConfirm }, running ? "\u6B63\u5728\u6267\u884C\u2026" : reasons.length ? "\u5168\u90E8\u786E\u8BA4\u5E76\u6267\u884C" : "\u786E\u8BA4\u6267\u884C"), /* @__PURE__ */ import_react3.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: running, onClick: onCancel }, "\u53D6\u6D88"), running && /* @__PURE__ */ import_react3.default.createElement("span", { className: "mr-caption", role: "status", "aria-live": "polite" }, "\u6A21\u578B\u8C03\u7528\u53EF\u80FD\u9700\u8981\u51E0\u5206\u949F\uFF0C\u8BF7\u52FF\u5173\u95ED\u5DE5\u4F5C\u53F0\u3002")));
}

// .dsh-plugin/client/cli-terminal.jsx
var import_react4 = __toESM(require("react"), 1);

// node_modules/.pnpm/@xterm+xterm@6.0.0/node_modules/@xterm/xterm/lib/xterm.mjs
var zs = Object.defineProperty;
var Rl = Object.getOwnPropertyDescriptor;
var Ll = (s15, t) => {
  for (var e in t) zs(s15, e, { get: t[e], enumerable: true });
};
var M = (s15, t, e, i) => {
  for (var r = i > 1 ? void 0 : i ? Rl(t, e) : t, n = s15.length - 1, o2; n >= 0; n--) (o2 = s15[n]) && (r = (i ? o2(t, e, r) : o2(r)) || r);
  return i && r && zs(t, e, r), r;
};
var S = (s15, t) => (e, i) => t(e, i, s15);
var Gs = "Terminal input";
var mi = { get: () => Gs, set: (s15) => Gs = s15 };
var $s = "Too much output to announce, navigate to rows manually to read";
var _i = { get: () => $s, set: (s15) => $s = s15 };
function Al(s15) {
  return s15.replace(/\r?\n/g, "\r");
}
function kl(s15, t) {
  return t ? "\x1B[200~" + s15 + "\x1B[201~" : s15;
}
function Vs(s15, t) {
  s15.clipboardData && s15.clipboardData.setData("text/plain", t.selectionText), s15.preventDefault();
}
function qs(s15, t, e, i) {
  if (s15.stopPropagation(), s15.clipboardData) {
    let r = s15.clipboardData.getData("text/plain");
    Cn(r, t, e, i);
  }
}
function Cn(s15, t, e, i) {
  s15 = Al(s15), s15 = kl(s15, e.decPrivateModes.bracketedPasteMode && i.rawOptions.ignoreBracketedPasteMode !== true), e.triggerDataEvent(s15, true), t.value = "";
}
function Mn(s15, t, e) {
  let i = e.getBoundingClientRect(), r = s15.clientX - i.left - 10, n = s15.clientY - i.top - 10;
  t.style.width = "20px", t.style.height = "20px", t.style.left = `${r}px`, t.style.top = `${n}px`, t.style.zIndex = "1000", t.focus();
}
function Pn(s15, t, e, i, r) {
  Mn(s15, t, e), r && i.rightClickSelect(s15), t.value = i.selectionText, t.select();
}
function Ce(s15) {
  return s15 > 65535 ? (s15 -= 65536, String.fromCharCode((s15 >> 10) + 55296) + String.fromCharCode(s15 % 1024 + 56320)) : String.fromCharCode(s15);
}
function It(s15, t = 0, e = s15.length) {
  let i = "";
  for (let r = t; r < e; ++r) {
    let n = s15[r];
    n > 65535 ? (n -= 65536, i += String.fromCharCode((n >> 10) + 55296) + String.fromCharCode(n % 1024 + 56320)) : i += String.fromCharCode(n);
  }
  return i;
}
var er = class {
  constructor() {
    this._interim = 0;
  }
  clear() {
    this._interim = 0;
  }
  decode(t, e) {
    let i = t.length;
    if (!i) return 0;
    let r = 0, n = 0;
    if (this._interim) {
      let o2 = t.charCodeAt(n++);
      56320 <= o2 && o2 <= 57343 ? e[r++] = (this._interim - 55296) * 1024 + o2 - 56320 + 65536 : (e[r++] = this._interim, e[r++] = o2), this._interim = 0;
    }
    for (let o2 = n; o2 < i; ++o2) {
      let l = t.charCodeAt(o2);
      if (55296 <= l && l <= 56319) {
        if (++o2 >= i) return this._interim = l, r;
        let a = t.charCodeAt(o2);
        56320 <= a && a <= 57343 ? e[r++] = (l - 55296) * 1024 + a - 56320 + 65536 : (e[r++] = l, e[r++] = a);
        continue;
      }
      l !== 65279 && (e[r++] = l);
    }
    return r;
  }
};
var tr = class {
  constructor() {
    this.interim = new Uint8Array(3);
  }
  clear() {
    this.interim.fill(0);
  }
  decode(t, e) {
    let i = t.length;
    if (!i) return 0;
    let r = 0, n, o2, l, a, u = 0, h2 = 0;
    if (this.interim[0]) {
      let _2 = false, p = this.interim[0];
      p &= (p & 224) === 192 ? 31 : (p & 240) === 224 ? 15 : 7;
      let m = 0, f;
      for (; (f = this.interim[++m] & 63) && m < 4; ) p <<= 6, p |= f;
      let A = (this.interim[0] & 224) === 192 ? 2 : (this.interim[0] & 240) === 224 ? 3 : 4, R = A - m;
      for (; h2 < R; ) {
        if (h2 >= i) return 0;
        if (f = t[h2++], (f & 192) !== 128) {
          h2--, _2 = true;
          break;
        } else this.interim[m++] = f, p <<= 6, p |= f & 63;
      }
      _2 || (A === 2 ? p < 128 ? h2-- : e[r++] = p : A === 3 ? p < 2048 || p >= 55296 && p <= 57343 || p === 65279 || (e[r++] = p) : p < 65536 || p > 1114111 || (e[r++] = p)), this.interim.fill(0);
    }
    let c = i - 4, d = h2;
    for (; d < i; ) {
      for (; d < c && !((n = t[d]) & 128) && !((o2 = t[d + 1]) & 128) && !((l = t[d + 2]) & 128) && !((a = t[d + 3]) & 128); ) e[r++] = n, e[r++] = o2, e[r++] = l, e[r++] = a, d += 4;
      if (n = t[d++], n < 128) e[r++] = n;
      else if ((n & 224) === 192) {
        if (d >= i) return this.interim[0] = n, r;
        if (o2 = t[d++], (o2 & 192) !== 128) {
          d--;
          continue;
        }
        if (u = (n & 31) << 6 | o2 & 63, u < 128) {
          d--;
          continue;
        }
        e[r++] = u;
      } else if ((n & 240) === 224) {
        if (d >= i) return this.interim[0] = n, r;
        if (o2 = t[d++], (o2 & 192) !== 128) {
          d--;
          continue;
        }
        if (d >= i) return this.interim[0] = n, this.interim[1] = o2, r;
        if (l = t[d++], (l & 192) !== 128) {
          d--;
          continue;
        }
        if (u = (n & 15) << 12 | (o2 & 63) << 6 | l & 63, u < 2048 || u >= 55296 && u <= 57343 || u === 65279) continue;
        e[r++] = u;
      } else if ((n & 248) === 240) {
        if (d >= i) return this.interim[0] = n, r;
        if (o2 = t[d++], (o2 & 192) !== 128) {
          d--;
          continue;
        }
        if (d >= i) return this.interim[0] = n, this.interim[1] = o2, r;
        if (l = t[d++], (l & 192) !== 128) {
          d--;
          continue;
        }
        if (d >= i) return this.interim[0] = n, this.interim[1] = o2, this.interim[2] = l, r;
        if (a = t[d++], (a & 192) !== 128) {
          d--;
          continue;
        }
        if (u = (n & 7) << 18 | (o2 & 63) << 12 | (l & 63) << 6 | a & 63, u < 65536 || u > 1114111) continue;
        e[r++] = u;
      }
    }
    return r;
  }
};
var ir = "";
var we = " ";
var De = class s {
  constructor() {
    this.fg = 0;
    this.bg = 0;
    this.extended = new rt();
  }
  static toColorRGB(t) {
    return [t >>> 16 & 255, t >>> 8 & 255, t & 255];
  }
  static fromColorRGB(t) {
    return (t[0] & 255) << 16 | (t[1] & 255) << 8 | t[2] & 255;
  }
  clone() {
    let t = new s();
    return t.fg = this.fg, t.bg = this.bg, t.extended = this.extended.clone(), t;
  }
  isInverse() {
    return this.fg & 67108864;
  }
  isBold() {
    return this.fg & 134217728;
  }
  isUnderline() {
    return this.hasExtendedAttrs() && this.extended.underlineStyle !== 0 ? 1 : this.fg & 268435456;
  }
  isBlink() {
    return this.fg & 536870912;
  }
  isInvisible() {
    return this.fg & 1073741824;
  }
  isItalic() {
    return this.bg & 67108864;
  }
  isDim() {
    return this.bg & 134217728;
  }
  isStrikethrough() {
    return this.fg & 2147483648;
  }
  isProtected() {
    return this.bg & 536870912;
  }
  isOverline() {
    return this.bg & 1073741824;
  }
  getFgColorMode() {
    return this.fg & 50331648;
  }
  getBgColorMode() {
    return this.bg & 50331648;
  }
  isFgRGB() {
    return (this.fg & 50331648) === 50331648;
  }
  isBgRGB() {
    return (this.bg & 50331648) === 50331648;
  }
  isFgPalette() {
    return (this.fg & 50331648) === 16777216 || (this.fg & 50331648) === 33554432;
  }
  isBgPalette() {
    return (this.bg & 50331648) === 16777216 || (this.bg & 50331648) === 33554432;
  }
  isFgDefault() {
    return (this.fg & 50331648) === 0;
  }
  isBgDefault() {
    return (this.bg & 50331648) === 0;
  }
  isAttributeDefault() {
    return this.fg === 0 && this.bg === 0;
  }
  getFgColor() {
    switch (this.fg & 50331648) {
      case 16777216:
      case 33554432:
        return this.fg & 255;
      case 50331648:
        return this.fg & 16777215;
      default:
        return -1;
    }
  }
  getBgColor() {
    switch (this.bg & 50331648) {
      case 16777216:
      case 33554432:
        return this.bg & 255;
      case 50331648:
        return this.bg & 16777215;
      default:
        return -1;
    }
  }
  hasExtendedAttrs() {
    return this.bg & 268435456;
  }
  updateExtended() {
    this.extended.isEmpty() ? this.bg &= -268435457 : this.bg |= 268435456;
  }
  getUnderlineColor() {
    if (this.bg & 268435456 && ~this.extended.underlineColor) switch (this.extended.underlineColor & 50331648) {
      case 16777216:
      case 33554432:
        return this.extended.underlineColor & 255;
      case 50331648:
        return this.extended.underlineColor & 16777215;
      default:
        return this.getFgColor();
    }
    return this.getFgColor();
  }
  getUnderlineColorMode() {
    return this.bg & 268435456 && ~this.extended.underlineColor ? this.extended.underlineColor & 50331648 : this.getFgColorMode();
  }
  isUnderlineColorRGB() {
    return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 50331648 : this.isFgRGB();
  }
  isUnderlineColorPalette() {
    return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 16777216 || (this.extended.underlineColor & 50331648) === 33554432 : this.isFgPalette();
  }
  isUnderlineColorDefault() {
    return this.bg & 268435456 && ~this.extended.underlineColor ? (this.extended.underlineColor & 50331648) === 0 : this.isFgDefault();
  }
  getUnderlineStyle() {
    return this.fg & 268435456 ? this.bg & 268435456 ? this.extended.underlineStyle : 1 : 0;
  }
  getUnderlineVariantOffset() {
    return this.extended.underlineVariantOffset;
  }
};
var rt = class s2 {
  constructor(t = 0, e = 0) {
    this._ext = 0;
    this._urlId = 0;
    this._ext = t, this._urlId = e;
  }
  get ext() {
    return this._urlId ? this._ext & -469762049 | this.underlineStyle << 26 : this._ext;
  }
  set ext(t) {
    this._ext = t;
  }
  get underlineStyle() {
    return this._urlId ? 5 : (this._ext & 469762048) >> 26;
  }
  set underlineStyle(t) {
    this._ext &= -469762049, this._ext |= t << 26 & 469762048;
  }
  get underlineColor() {
    return this._ext & 67108863;
  }
  set underlineColor(t) {
    this._ext &= -67108864, this._ext |= t & 67108863;
  }
  get urlId() {
    return this._urlId;
  }
  set urlId(t) {
    this._urlId = t;
  }
  get underlineVariantOffset() {
    let t = (this._ext & 3758096384) >> 29;
    return t < 0 ? t ^ 4294967288 : t;
  }
  set underlineVariantOffset(t) {
    this._ext &= 536870911, this._ext |= t << 29 & 3758096384;
  }
  clone() {
    return new s2(this._ext, this._urlId);
  }
  isEmpty() {
    return this.underlineStyle === 0 && this._urlId === 0;
  }
};
var q = class s3 extends De {
  constructor() {
    super(...arguments);
    this.content = 0;
    this.fg = 0;
    this.bg = 0;
    this.extended = new rt();
    this.combinedData = "";
  }
  static fromCharData(e) {
    let i = new s3();
    return i.setFromCharData(e), i;
  }
  isCombined() {
    return this.content & 2097152;
  }
  getWidth() {
    return this.content >> 22;
  }
  getChars() {
    return this.content & 2097152 ? this.combinedData : this.content & 2097151 ? Ce(this.content & 2097151) : "";
  }
  getCode() {
    return this.isCombined() ? this.combinedData.charCodeAt(this.combinedData.length - 1) : this.content & 2097151;
  }
  setFromCharData(e) {
    this.fg = e[0], this.bg = 0;
    let i = false;
    if (e[1].length > 2) i = true;
    else if (e[1].length === 2) {
      let r = e[1].charCodeAt(0);
      if (55296 <= r && r <= 56319) {
        let n = e[1].charCodeAt(1);
        56320 <= n && n <= 57343 ? this.content = (r - 55296) * 1024 + n - 56320 + 65536 | e[2] << 22 : i = true;
      } else i = true;
    } else this.content = e[1].charCodeAt(0) | e[2] << 22;
    i && (this.combinedData = e[1], this.content = 2097152 | e[2] << 22);
  }
  getAsCharData() {
    return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
  }
};
var js = "di$target";
var Hn = "di$dependencies";
var Fn = /* @__PURE__ */ new Map();
function Xs(s15) {
  return s15[Hn] || [];
}
function ie(s15) {
  if (Fn.has(s15)) return Fn.get(s15);
  let t = function(e, i, r) {
    if (arguments.length !== 3) throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
    Pl(t, e, r);
  };
  return t._id = s15, Fn.set(s15, t), t;
}
function Pl(s15, t, e) {
  t[js] === t ? t[Hn].push({ id: s15, index: e }) : (t[Hn] = [{ id: s15, index: e }], t[js] = t);
}
var F = ie("BufferService");
var rr = ie("CoreMouseService");
var ge = ie("CoreService");
var Zs = ie("CharsetService");
var xt = ie("InstantiationService");
var nr = ie("LogService");
var H = ie("OptionsService");
var sr = ie("OscLinkService");
var Js = ie("UnicodeService");
var Be = ie("DecorationService");
var wt = class {
  constructor(t, e, i) {
    this._bufferService = t;
    this._optionsService = e;
    this._oscLinkService = i;
  }
  provideLinks(t, e) {
    let i = this._bufferService.buffer.lines.get(t - 1);
    if (!i) {
      e(void 0);
      return;
    }
    let r = [], n = this._optionsService.rawOptions.linkHandler, o2 = new q(), l = i.getTrimmedLength(), a = -1, u = -1, h2 = false;
    for (let c = 0; c < l; c++) if (!(u === -1 && !i.hasContent(c))) {
      if (i.loadCell(c, o2), o2.hasExtendedAttrs() && o2.extended.urlId) if (u === -1) {
        u = c, a = o2.extended.urlId;
        continue;
      } else h2 = o2.extended.urlId !== a;
      else u !== -1 && (h2 = true);
      if (h2 || u !== -1 && c === l - 1) {
        let d = this._oscLinkService.getLinkData(a)?.uri;
        if (d) {
          let _2 = { start: { x: u + 1, y: t }, end: { x: c + (!h2 && c === l - 1 ? 1 : 0), y: t } }, p = false;
          if (!n?.allowNonHttpProtocols) try {
            let m = new URL(d);
            ["http:", "https:"].includes(m.protocol) || (p = true);
          } catch {
            p = true;
          }
          p || r.push({ text: d, range: _2, activate: (m, f) => n ? n.activate(m, f, _2) : Ol(m, f), hover: (m, f) => n?.hover?.(m, f, _2), leave: (m, f) => n?.leave?.(m, f, _2) });
        }
        h2 = false, o2.hasExtendedAttrs() && o2.extended.urlId ? (u = c, a = o2.extended.urlId) : (u = -1, a = -1);
      }
    }
    e(r);
  }
};
wt = M([S(0, F), S(1, H), S(2, sr)], wt);
function Ol(s15, t) {
  if (confirm(`Do you want to navigate to ${t}?

WARNING: This link could potentially be dangerous`)) {
    let i = window.open();
    if (i) {
      try {
        i.opener = null;
      } catch {
      }
      i.location.href = t;
    } else console.warn("Opening link blocked as opener could not be cleared");
  }
}
var nt = ie("CharSizeService");
var ae = ie("CoreBrowserService");
var Dt = ie("MouseService");
var ce = ie("RenderService");
var Qs = ie("SelectionService");
var or = ie("CharacterJoinerService");
var Re = ie("ThemeService");
var lr = ie("LinkProviderService");
var Wn = class {
  constructor() {
    this.listeners = [], this.unexpectedErrorHandler = function(t) {
      setTimeout(() => {
        throw t.stack ? ar.isErrorNoTelemetry(t) ? new ar(t.message + `

` + t.stack) : new Error(t.message + `

` + t.stack) : t;
      }, 0);
    };
  }
  addListener(t) {
    return this.listeners.push(t), () => {
      this._removeListener(t);
    };
  }
  emit(t) {
    this.listeners.forEach((e) => {
      e(t);
    });
  }
  _removeListener(t) {
    this.listeners.splice(this.listeners.indexOf(t), 1);
  }
  setUnexpectedErrorHandler(t) {
    this.unexpectedErrorHandler = t;
  }
  getUnexpectedErrorHandler() {
    return this.unexpectedErrorHandler;
  }
  onUnexpectedError(t) {
    this.unexpectedErrorHandler(t), this.emit(t);
  }
  onUnexpectedExternalError(t) {
    this.unexpectedErrorHandler(t);
  }
};
var Bl = new Wn();
function Lt(s15) {
  Nl(s15) || Bl.onUnexpectedError(s15);
}
var Un = "Canceled";
function Nl(s15) {
  return s15 instanceof bi ? true : s15 instanceof Error && s15.name === Un && s15.message === Un;
}
var bi = class extends Error {
  constructor() {
    super(Un), this.name = this.message;
  }
};
function eo(s15) {
  return s15 ? new Error(`Illegal argument: ${s15}`) : new Error("Illegal argument");
}
var ar = class s4 extends Error {
  constructor(t) {
    super(t), this.name = "CodeExpectedError";
  }
  static fromError(t) {
    if (t instanceof s4) return t;
    let e = new s4();
    return e.message = t.message, e.stack = t.stack, e;
  }
  static isErrorNoTelemetry(t) {
    return t.name === "CodeExpectedError";
  }
};
var Rt = class s5 extends Error {
  constructor(t) {
    super(t || "An unexpected bug occurred."), Object.setPrototypeOf(this, s5.prototype);
  }
};
function Fl(s15, t, e = 0, i = s15.length) {
  let r = e, n = i;
  for (; r < n; ) {
    let o2 = Math.floor((r + n) / 2);
    t(s15[o2]) ? r = o2 + 1 : n = o2;
  }
  return r - 1;
}
var cr = class cr2 {
  constructor(t) {
    this._array = t;
    this._findLastMonotonousLastIdx = 0;
  }
  findLastMonotonous(t) {
    if (cr2.assertInvariants) {
      if (this._prevFindLastPredicate) {
        for (let i of this._array) if (this._prevFindLastPredicate(i) && !t(i)) throw new Error("MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.");
      }
      this._prevFindLastPredicate = t;
    }
    let e = Fl(this._array, t, this._findLastMonotonousLastIdx);
    return this._findLastMonotonousLastIdx = e + 1, e === -1 ? void 0 : this._array[e];
  }
};
cr.assertInvariants = false;
function Se(s15, t = 0) {
  return s15[s15.length - (1 + t)];
}
var ro;
((l) => {
  function s15(a) {
    return a < 0;
  }
  l.isLessThan = s15;
  function t(a) {
    return a <= 0;
  }
  l.isLessThanOrEqual = t;
  function e(a) {
    return a > 0;
  }
  l.isGreaterThan = e;
  function i(a) {
    return a === 0;
  }
  l.isNeitherLessOrGreaterThan = i, l.greaterThan = 1, l.lessThan = -1, l.neitherLessOrGreaterThan = 0;
})(ro || (ro = {}));
function no(s15, t) {
  return (e, i) => t(s15(e), s15(i));
}
var so = (s15, t) => s15 - t;
var At = class At2 {
  constructor(t) {
    this.iterate = t;
  }
  forEach(t) {
    this.iterate((e) => (t(e), true));
  }
  toArray() {
    let t = [];
    return this.iterate((e) => (t.push(e), true)), t;
  }
  filter(t) {
    return new At2((e) => this.iterate((i) => t(i) ? e(i) : true));
  }
  map(t) {
    return new At2((e) => this.iterate((i) => e(t(i))));
  }
  some(t) {
    let e = false;
    return this.iterate((i) => (e = t(i), !e)), e;
  }
  findFirst(t) {
    let e;
    return this.iterate((i) => t(i) ? (e = i, false) : true), e;
  }
  findLast(t) {
    let e;
    return this.iterate((i) => (t(i) && (e = i), true)), e;
  }
  findLastMaxBy(t) {
    let e, i = true;
    return this.iterate((r) => ((i || ro.isGreaterThan(t(r, e))) && (i = false, e = r), true)), e;
  }
};
At.empty = new At((t) => {
});
function co(s15, t) {
  let e = /* @__PURE__ */ Object.create(null);
  for (let i of s15) {
    let r = t(i), n = e[r];
    n || (n = e[r] = []), n.push(i);
  }
  return e;
}
var lo;
var ao;
var oo = class {
  constructor(t, e) {
    this.toKey = e;
    this._map = /* @__PURE__ */ new Map();
    this[lo] = "SetWithKey";
    for (let i of t) this.add(i);
  }
  get size() {
    return this._map.size;
  }
  add(t) {
    let e = this.toKey(t);
    return this._map.set(e, t), this;
  }
  delete(t) {
    return this._map.delete(this.toKey(t));
  }
  has(t) {
    return this._map.has(this.toKey(t));
  }
  *entries() {
    for (let t of this._map.values()) yield [t, t];
  }
  keys() {
    return this.values();
  }
  *values() {
    for (let t of this._map.values()) yield t;
  }
  clear() {
    this._map.clear();
  }
  forEach(t, e) {
    this._map.forEach((i) => t.call(e, i, i, this));
  }
  [(ao = Symbol.iterator, lo = Symbol.toStringTag, ao)]() {
    return this.values();
  }
};
var ur = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  add(t, e) {
    let i = this.map.get(t);
    i || (i = /* @__PURE__ */ new Set(), this.map.set(t, i)), i.add(e);
  }
  delete(t, e) {
    let i = this.map.get(t);
    i && (i.delete(e), i.size === 0 && this.map.delete(t));
  }
  forEach(t, e) {
    let i = this.map.get(t);
    i && i.forEach(e);
  }
  get(t) {
    let e = this.map.get(t);
    return e || /* @__PURE__ */ new Set();
  }
};
function Kn(s15, t) {
  let e = this, i = false, r;
  return function() {
    if (i) return r;
    if (i = true, t) try {
      r = s15.apply(e, arguments);
    } finally {
      t();
    }
    else r = s15.apply(e, arguments);
    return r;
  };
}
var zn;
((O) => {
  function s15(I) {
    return I && typeof I == "object" && typeof I[Symbol.iterator] == "function";
  }
  O.is = s15;
  let t = Object.freeze([]);
  function e() {
    return t;
  }
  O.empty = e;
  function* i(I) {
    yield I;
  }
  O.single = i;
  function r(I) {
    return s15(I) ? I : i(I);
  }
  O.wrap = r;
  function n(I) {
    return I || t;
  }
  O.from = n;
  function* o2(I) {
    for (let k = I.length - 1; k >= 0; k--) yield I[k];
  }
  O.reverse = o2;
  function l(I) {
    return !I || I[Symbol.iterator]().next().done === true;
  }
  O.isEmpty = l;
  function a(I) {
    return I[Symbol.iterator]().next().value;
  }
  O.first = a;
  function u(I, k) {
    let P = 0;
    for (let oe of I) if (k(oe, P++)) return true;
    return false;
  }
  O.some = u;
  function h2(I, k) {
    for (let P of I) if (k(P)) return P;
  }
  O.find = h2;
  function* c(I, k) {
    for (let P of I) k(P) && (yield P);
  }
  O.filter = c;
  function* d(I, k) {
    let P = 0;
    for (let oe of I) yield k(oe, P++);
  }
  O.map = d;
  function* _2(I, k) {
    let P = 0;
    for (let oe of I) yield* k(oe, P++);
  }
  O.flatMap = _2;
  function* p(...I) {
    for (let k of I) yield* k;
  }
  O.concat = p;
  function m(I, k, P) {
    let oe = P;
    for (let Me of I) oe = k(oe, Me);
    return oe;
  }
  O.reduce = m;
  function* f(I, k, P = I.length) {
    for (k < 0 && (k += I.length), P < 0 ? P += I.length : P > I.length && (P = I.length); k < P; k++) yield I[k];
  }
  O.slice = f;
  function A(I, k = Number.POSITIVE_INFINITY) {
    let P = [];
    if (k === 0) return [P, I];
    let oe = I[Symbol.iterator]();
    for (let Me = 0; Me < k; Me++) {
      let Pe = oe.next();
      if (Pe.done) return [P, O.empty()];
      P.push(Pe.value);
    }
    return [P, { [Symbol.iterator]() {
      return oe;
    } }];
  }
  O.consume = A;
  async function R(I) {
    let k = [];
    for await (let P of I) k.push(P);
    return Promise.resolve(k);
  }
  O.asyncToArray = R;
})(zn || (zn = {}));
var Wl = false;
var dt = null;
var hr = class hr2 {
  constructor() {
    this.livingDisposables = /* @__PURE__ */ new Map();
  }
  getDisposableData(t) {
    let e = this.livingDisposables.get(t);
    return e || (e = { parent: null, source: null, isSingleton: false, value: t, idx: hr2.idx++ }, this.livingDisposables.set(t, e)), e;
  }
  trackDisposable(t) {
    let e = this.getDisposableData(t);
    e.source || (e.source = new Error().stack);
  }
  setParent(t, e) {
    let i = this.getDisposableData(t);
    i.parent = e;
  }
  markAsDisposed(t) {
    this.livingDisposables.delete(t);
  }
  markAsSingleton(t) {
    this.getDisposableData(t).isSingleton = true;
  }
  getRootParent(t, e) {
    let i = e.get(t);
    if (i) return i;
    let r = t.parent ? this.getRootParent(this.getDisposableData(t.parent), e) : t;
    return e.set(t, r), r;
  }
  getTrackedDisposables() {
    let t = /* @__PURE__ */ new Map();
    return [...this.livingDisposables.entries()].filter(([, i]) => i.source !== null && !this.getRootParent(i, t).isSingleton).flatMap(([i]) => i);
  }
  computeLeakingDisposables(t = 10, e) {
    let i;
    if (e) i = e;
    else {
      let a = /* @__PURE__ */ new Map(), u = [...this.livingDisposables.values()].filter((c) => c.source !== null && !this.getRootParent(c, a).isSingleton);
      if (u.length === 0) return;
      let h2 = new Set(u.map((c) => c.value));
      if (i = u.filter((c) => !(c.parent && h2.has(c.parent))), i.length === 0) throw new Error("There are cyclic diposable chains!");
    }
    if (!i) return;
    function r(a) {
      function u(c, d) {
        for (; c.length > 0 && d.some((_2) => typeof _2 == "string" ? _2 === c[0] : c[0].match(_2)); ) c.shift();
      }
      let h2 = a.source.split(`
`).map((c) => c.trim().replace("at ", "")).filter((c) => c !== "");
      return u(h2, ["Error", /^trackDisposable \(.*\)$/, /^DisposableTracker.trackDisposable \(.*\)$/]), h2.reverse();
    }
    let n = new ur();
    for (let a of i) {
      let u = r(a);
      for (let h2 = 0; h2 <= u.length; h2++) n.add(u.slice(0, h2).join(`
`), a);
    }
    i.sort(no((a) => a.idx, so));
    let o2 = "", l = 0;
    for (let a of i.slice(0, t)) {
      l++;
      let u = r(a), h2 = [];
      for (let c = 0; c < u.length; c++) {
        let d = u[c];
        d = `(shared with ${n.get(u.slice(0, c + 1).join(`
`)).size}/${i.length} leaks) at ${d}`;
        let p = n.get(u.slice(0, c).join(`
`)), m = co([...p].map((f) => r(f)[c]), (f) => f);
        delete m[u[c]];
        for (let [f, A] of Object.entries(m)) h2.unshift(`    - stacktraces of ${A.length} other leaks continue with ${f}`);
        h2.unshift(d);
      }
      o2 += `


==================== Leaking disposable ${l}/${i.length}: ${a.value.constructor.name} ====================
${h2.join(`
`)}
============================================================

`;
    }
    return i.length > t && (o2 += `


... and ${i.length - t} more leaking disposables

`), { leaks: i, details: o2 };
  }
};
hr.idx = 0;
function Ul(s15) {
  dt = s15;
}
if (Wl) {
  let s15 = "__is_disposable_tracked__";
  Ul(new class {
    trackDisposable(t) {
      let e = new Error("Potentially leaked disposable").stack;
      setTimeout(() => {
        t[s15] || console.log(e);
      }, 3e3);
    }
    setParent(t, e) {
      if (t && t !== D.None) try {
        t[s15] = true;
      } catch {
      }
    }
    markAsDisposed(t) {
      if (t && t !== D.None) try {
        t[s15] = true;
      } catch {
      }
    }
    markAsSingleton(t) {
    }
  }());
}
function fr(s15) {
  return dt?.trackDisposable(s15), s15;
}
function pr(s15) {
  dt?.markAsDisposed(s15);
}
function vi(s15, t) {
  dt?.setParent(s15, t);
}
function Kl(s15, t) {
  if (dt) for (let e of s15) dt.setParent(e, t);
}
function Gn(s15) {
  return dt?.markAsSingleton(s15), s15;
}
function Ne(s15) {
  if (zn.is(s15)) {
    let t = [];
    for (let e of s15) if (e) try {
      e.dispose();
    } catch (i) {
      t.push(i);
    }
    if (t.length === 1) throw t[0];
    if (t.length > 1) throw new AggregateError(t, "Encountered errors while disposing of store");
    return Array.isArray(s15) ? [] : s15;
  } else if (s15) return s15.dispose(), s15;
}
function ho(...s15) {
  let t = C(() => Ne(s15));
  return Kl(s15, t), t;
}
function C(s15) {
  let t = fr({ dispose: Kn(() => {
    pr(t), s15();
  }) });
  return t;
}
var dr = class dr2 {
  constructor() {
    this._toDispose = /* @__PURE__ */ new Set();
    this._isDisposed = false;
    fr(this);
  }
  dispose() {
    this._isDisposed || (pr(this), this._isDisposed = true, this.clear());
  }
  get isDisposed() {
    return this._isDisposed;
  }
  clear() {
    if (this._toDispose.size !== 0) try {
      Ne(this._toDispose);
    } finally {
      this._toDispose.clear();
    }
  }
  add(t) {
    if (!t) return t;
    if (t === this) throw new Error("Cannot register a disposable on itself!");
    return vi(t, this), this._isDisposed ? dr2.DISABLE_DISPOSED_WARNING || console.warn(new Error("Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!").stack) : this._toDispose.add(t), t;
  }
  delete(t) {
    if (t) {
      if (t === this) throw new Error("Cannot dispose a disposable on itself!");
      this._toDispose.delete(t), t.dispose();
    }
  }
  deleteAndLeak(t) {
    t && this._toDispose.has(t) && (this._toDispose.delete(t), vi(t, null));
  }
};
dr.DISABLE_DISPOSED_WARNING = false;
var Ee = dr;
var D = class {
  constructor() {
    this._store = new Ee();
    fr(this), vi(this._store, this);
  }
  dispose() {
    pr(this), this._store.dispose();
  }
  _register(t) {
    if (t === this) throw new Error("Cannot register a disposable on itself!");
    return this._store.add(t);
  }
};
D.None = Object.freeze({ dispose() {
} });
var ye = class {
  constructor() {
    this._isDisposed = false;
    fr(this);
  }
  get value() {
    return this._isDisposed ? void 0 : this._value;
  }
  set value(t) {
    this._isDisposed || t === this._value || (this._value?.dispose(), t && vi(t, this), this._value = t);
  }
  clear() {
    this.value = void 0;
  }
  dispose() {
    this._isDisposed = true, pr(this), this._value?.dispose(), this._value = void 0;
  }
  clearAndLeak() {
    let t = this._value;
    return this._value = void 0, t && vi(t, null), t;
  }
};
var fe = typeof window == "object" ? window : globalThis;
var kt = class kt2 {
  constructor(t) {
    this.element = t, this.next = kt2.Undefined, this.prev = kt2.Undefined;
  }
};
kt.Undefined = new kt(void 0);
var G = kt;
var Ct = class {
  constructor() {
    this._first = G.Undefined;
    this._last = G.Undefined;
    this._size = 0;
  }
  get size() {
    return this._size;
  }
  isEmpty() {
    return this._first === G.Undefined;
  }
  clear() {
    let t = this._first;
    for (; t !== G.Undefined; ) {
      let e = t.next;
      t.prev = G.Undefined, t.next = G.Undefined, t = e;
    }
    this._first = G.Undefined, this._last = G.Undefined, this._size = 0;
  }
  unshift(t) {
    return this._insert(t, false);
  }
  push(t) {
    return this._insert(t, true);
  }
  _insert(t, e) {
    let i = new G(t);
    if (this._first === G.Undefined) this._first = i, this._last = i;
    else if (e) {
      let n = this._last;
      this._last = i, i.prev = n, n.next = i;
    } else {
      let n = this._first;
      this._first = i, i.next = n, n.prev = i;
    }
    this._size += 1;
    let r = false;
    return () => {
      r || (r = true, this._remove(i));
    };
  }
  shift() {
    if (this._first !== G.Undefined) {
      let t = this._first.element;
      return this._remove(this._first), t;
    }
  }
  pop() {
    if (this._last !== G.Undefined) {
      let t = this._last.element;
      return this._remove(this._last), t;
    }
  }
  _remove(t) {
    if (t.prev !== G.Undefined && t.next !== G.Undefined) {
      let e = t.prev;
      e.next = t.next, t.next.prev = e;
    } else t.prev === G.Undefined && t.next === G.Undefined ? (this._first = G.Undefined, this._last = G.Undefined) : t.next === G.Undefined ? (this._last = this._last.prev, this._last.next = G.Undefined) : t.prev === G.Undefined && (this._first = this._first.next, this._first.prev = G.Undefined);
    this._size -= 1;
  }
  *[Symbol.iterator]() {
    let t = this._first;
    for (; t !== G.Undefined; ) yield t.element, t = t.next;
  }
};
var zl = globalThis.performance && typeof globalThis.performance.now == "function";
var mr = class s6 {
  static create(t) {
    return new s6(t);
  }
  constructor(t) {
    this._now = zl && t === false ? Date.now : globalThis.performance.now.bind(globalThis.performance), this._startTime = this._now(), this._stopTime = -1;
  }
  stop() {
    this._stopTime = this._now();
  }
  reset() {
    this._startTime = this._now(), this._stopTime = -1;
  }
  elapsed() {
    return this._stopTime !== -1 ? this._stopTime - this._startTime : this._now() - this._startTime;
  }
};
var Gl = false;
var fo = false;
var $l = false;
var $;
((Qe) => {
  Qe.None = () => D.None;
  function t(y) {
    if ($l) {
      let { onDidAddListener: T } = y, g = gi.create(), w = 0;
      y.onDidAddListener = () => {
        ++w === 2 && (console.warn("snapshotted emitter LIKELY used public and SHOULD HAVE BEEN created with DisposableStore. snapshotted here"), g.print()), T?.();
      };
    }
  }
  function e(y, T) {
    return d(y, () => {
    }, 0, void 0, true, void 0, T);
  }
  Qe.defer = e;
  function i(y) {
    return (T, g = null, w) => {
      let E = false, x;
      return x = y((N) => {
        if (!E) return x ? x.dispose() : E = true, T.call(g, N);
      }, null, w), E && x.dispose(), x;
    };
  }
  Qe.once = i;
  function r(y, T, g) {
    return h2((w, E = null, x) => y((N) => w.call(E, T(N)), null, x), g);
  }
  Qe.map = r;
  function n(y, T, g) {
    return h2((w, E = null, x) => y((N) => {
      T(N), w.call(E, N);
    }, null, x), g);
  }
  Qe.forEach = n;
  function o2(y, T, g) {
    return h2((w, E = null, x) => y((N) => T(N) && w.call(E, N), null, x), g);
  }
  Qe.filter = o2;
  function l(y) {
    return y;
  }
  Qe.signal = l;
  function a(...y) {
    return (T, g = null, w) => {
      let E = ho(...y.map((x) => x((N) => T.call(g, N))));
      return c(E, w);
    };
  }
  Qe.any = a;
  function u(y, T, g, w) {
    let E = g;
    return r(y, (x) => (E = T(E, x), E), w);
  }
  Qe.reduce = u;
  function h2(y, T) {
    let g, w = { onWillAddFirstListener() {
      g = y(E.fire, E);
    }, onDidRemoveLastListener() {
      g?.dispose();
    } };
    T || t(w);
    let E = new v(w);
    return T?.add(E), E.event;
  }
  function c(y, T) {
    return T instanceof Array ? T.push(y) : T && T.add(y), y;
  }
  function d(y, T, g = 100, w = false, E = false, x, N) {
    let Z, te, Oe, ze = 0, le, et = { leakWarningThreshold: x, onWillAddFirstListener() {
      Z = y((ht) => {
        ze++, te = T(te, ht), w && !Oe && (me.fire(te), te = void 0), le = () => {
          let fi = te;
          te = void 0, Oe = void 0, (!w || ze > 1) && me.fire(fi), ze = 0;
        }, typeof g == "number" ? (clearTimeout(Oe), Oe = setTimeout(le, g)) : Oe === void 0 && (Oe = 0, queueMicrotask(le));
      });
    }, onWillRemoveListener() {
      E && ze > 0 && le?.();
    }, onDidRemoveLastListener() {
      le = void 0, Z.dispose();
    } };
    N || t(et);
    let me = new v(et);
    return N?.add(me), me.event;
  }
  Qe.debounce = d;
  function _2(y, T = 0, g) {
    return Qe.debounce(y, (w, E) => w ? (w.push(E), w) : [E], T, void 0, true, void 0, g);
  }
  Qe.accumulate = _2;
  function p(y, T = (w, E) => w === E, g) {
    let w = true, E;
    return o2(y, (x) => {
      let N = w || !T(x, E);
      return w = false, E = x, N;
    }, g);
  }
  Qe.latch = p;
  function m(y, T, g) {
    return [Qe.filter(y, T, g), Qe.filter(y, (w) => !T(w), g)];
  }
  Qe.split = m;
  function f(y, T = false, g = [], w) {
    let E = g.slice(), x = y((te) => {
      E ? E.push(te) : Z.fire(te);
    });
    w && w.add(x);
    let N = () => {
      E?.forEach((te) => Z.fire(te)), E = null;
    }, Z = new v({ onWillAddFirstListener() {
      x || (x = y((te) => Z.fire(te)), w && w.add(x));
    }, onDidAddFirstListener() {
      E && (T ? setTimeout(N) : N());
    }, onDidRemoveLastListener() {
      x && x.dispose(), x = null;
    } });
    return w && w.add(Z), Z.event;
  }
  Qe.buffer = f;
  function A(y, T) {
    return (w, E, x) => {
      let N = T(new O());
      return y(function(Z) {
        let te = N.evaluate(Z);
        te !== R && w.call(E, te);
      }, void 0, x);
    };
  }
  Qe.chain = A;
  let R = /* @__PURE__ */ Symbol("HaltChainable");
  class O {
    constructor() {
      this.steps = [];
    }
    map(T) {
      return this.steps.push(T), this;
    }
    forEach(T) {
      return this.steps.push((g) => (T(g), g)), this;
    }
    filter(T) {
      return this.steps.push((g) => T(g) ? g : R), this;
    }
    reduce(T, g) {
      let w = g;
      return this.steps.push((E) => (w = T(w, E), w)), this;
    }
    latch(T = (g, w) => g === w) {
      let g = true, w;
      return this.steps.push((E) => {
        let x = g || !T(E, w);
        return g = false, w = E, x ? E : R;
      }), this;
    }
    evaluate(T) {
      for (let g of this.steps) if (T = g(T), T === R) break;
      return T;
    }
  }
  function I(y, T, g = (w) => w) {
    let w = (...Z) => N.fire(g(...Z)), E = () => y.on(T, w), x = () => y.removeListener(T, w), N = new v({ onWillAddFirstListener: E, onDidRemoveLastListener: x });
    return N.event;
  }
  Qe.fromNodeEventEmitter = I;
  function k(y, T, g = (w) => w) {
    let w = (...Z) => N.fire(g(...Z)), E = () => y.addEventListener(T, w), x = () => y.removeEventListener(T, w), N = new v({ onWillAddFirstListener: E, onDidRemoveLastListener: x });
    return N.event;
  }
  Qe.fromDOMEventEmitter = k;
  function P(y) {
    return new Promise((T) => i(y)(T));
  }
  Qe.toPromise = P;
  function oe(y) {
    let T = new v();
    return y.then((g) => {
      T.fire(g);
    }, () => {
      T.fire(void 0);
    }).finally(() => {
      T.dispose();
    }), T.event;
  }
  Qe.fromPromise = oe;
  function Me(y, T) {
    return y((g) => T.fire(g));
  }
  Qe.forward = Me;
  function Pe(y, T, g) {
    return T(g), y((w) => T(w));
  }
  Qe.runAndSubscribe = Pe;
  class Ke {
    constructor(T, g) {
      this._observable = T;
      this._counter = 0;
      this._hasChanged = false;
      let w = { onWillAddFirstListener: () => {
        T.addObserver(this);
      }, onDidRemoveLastListener: () => {
        T.removeObserver(this);
      } };
      g || t(w), this.emitter = new v(w), g && g.add(this.emitter);
    }
    beginUpdate(T) {
      this._counter++;
    }
    handlePossibleChange(T) {
    }
    handleChange(T, g) {
      this._hasChanged = true;
    }
    endUpdate(T) {
      this._counter--, this._counter === 0 && (this._observable.reportChanges(), this._hasChanged && (this._hasChanged = false, this.emitter.fire(this._observable.get())));
    }
  }
  function di(y, T) {
    return new Ke(y, T).emitter.event;
  }
  Qe.fromObservable = di;
  function V(y) {
    return (T, g, w) => {
      let E = 0, x = false, N = { beginUpdate() {
        E++;
      }, endUpdate() {
        E--, E === 0 && (y.reportChanges(), x && (x = false, T.call(g)));
      }, handlePossibleChange() {
      }, handleChange() {
        x = true;
      } };
      y.addObserver(N), y.reportChanges();
      let Z = { dispose() {
        y.removeObserver(N);
      } };
      return w instanceof Ee ? w.add(Z) : Array.isArray(w) && w.push(Z), Z;
    };
  }
  Qe.fromObservableLight = V;
})($ || ($ = {}));
var Mt = class Mt2 {
  constructor(t) {
    this.listenerCount = 0;
    this.invocationCount = 0;
    this.elapsedOverall = 0;
    this.durations = [];
    this.name = `${t}_${Mt2._idPool++}`, Mt2.all.add(this);
  }
  start(t) {
    this._stopWatch = new mr(), this.listenerCount = t;
  }
  stop() {
    if (this._stopWatch) {
      let t = this._stopWatch.elapsed();
      this.durations.push(t), this.elapsedOverall += t, this.invocationCount += 1, this._stopWatch = void 0;
    }
  }
};
Mt.all = /* @__PURE__ */ new Set(), Mt._idPool = 0;
var $n = Mt;
var po = -1;
var br = class br2 {
  constructor(t, e, i = (br2._idPool++).toString(16).padStart(3, "0")) {
    this._errorHandler = t;
    this.threshold = e;
    this.name = i;
    this._warnCountdown = 0;
  }
  dispose() {
    this._stacks?.clear();
  }
  check(t, e) {
    let i = this.threshold;
    if (i <= 0 || e < i) return;
    this._stacks || (this._stacks = /* @__PURE__ */ new Map());
    let r = this._stacks.get(t.value) || 0;
    if (this._stacks.set(t.value, r + 1), this._warnCountdown -= 1, this._warnCountdown <= 0) {
      this._warnCountdown = i * 0.5;
      let [n, o2] = this.getMostFrequentStack(), l = `[${this.name}] potential listener LEAK detected, having ${e} listeners already. MOST frequent listener (${o2}):`;
      console.warn(l), console.warn(n);
      let a = new qn(l, n);
      this._errorHandler(a);
    }
    return () => {
      let n = this._stacks.get(t.value) || 0;
      this._stacks.set(t.value, n - 1);
    };
  }
  getMostFrequentStack() {
    if (!this._stacks) return;
    let t, e = 0;
    for (let [i, r] of this._stacks) (!t || e < r) && (t = [i, r], e = r);
    return t;
  }
};
br._idPool = 1;
var Vn = br;
var gi = class s7 {
  constructor(t) {
    this.value = t;
  }
  static create() {
    let t = new Error();
    return new s7(t.stack ?? "");
  }
  print() {
    console.warn(this.value.split(`
`).slice(2).join(`
`));
  }
};
var qn = class extends Error {
  constructor(t, e) {
    super(t), this.name = "ListenerLeakError", this.stack = e;
  }
};
var Yn = class extends Error {
  constructor(t, e) {
    super(t), this.name = "ListenerRefusalError", this.stack = e;
  }
};
var Vl = 0;
var Pt = class {
  constructor(t) {
    this.value = t;
    this.id = Vl++;
  }
};
var ql = 2;
var Yl = (s15, t) => {
  if (s15 instanceof Pt) t(s15);
  else for (let e = 0; e < s15.length; e++) {
    let i = s15[e];
    i && t(i);
  }
};
var _r;
if (Gl) {
  let s15 = [];
  setInterval(() => {
    s15.length !== 0 && (console.warn("[LEAKING LISTENERS] GC'ed these listeners that were NOT yet disposed:"), console.warn(s15.join(`
`)), s15.length = 0);
  }, 3e3), _r = new FinalizationRegistry((t) => {
    typeof t == "string" && s15.push(t);
  });
}
var v = class {
  constructor(t) {
    this._size = 0;
    this._options = t, this._leakageMon = po > 0 || this._options?.leakWarningThreshold ? new Vn(t?.onListenerError ?? Lt, this._options?.leakWarningThreshold ?? po) : void 0, this._perfMon = this._options?._profName ? new $n(this._options._profName) : void 0, this._deliveryQueue = this._options?.deliveryQueue;
  }
  dispose() {
    if (!this._disposed) {
      if (this._disposed = true, this._deliveryQueue?.current === this && this._deliveryQueue.reset(), this._listeners) {
        if (fo) {
          let t = this._listeners;
          queueMicrotask(() => {
            Yl(t, (e) => e.stack?.print());
          });
        }
        this._listeners = void 0, this._size = 0;
      }
      this._options?.onDidRemoveLastListener?.(), this._leakageMon?.dispose();
    }
  }
  get event() {
    return this._event ?? (this._event = (t, e, i) => {
      if (this._leakageMon && this._size > this._leakageMon.threshold ** 2) {
        let a = `[${this._leakageMon.name}] REFUSES to accept new listeners because it exceeded its threshold by far (${this._size} vs ${this._leakageMon.threshold})`;
        console.warn(a);
        let u = this._leakageMon.getMostFrequentStack() ?? ["UNKNOWN stack", -1], h2 = new Yn(`${a}. HINT: Stack shows most frequent listener (${u[1]}-times)`, u[0]);
        return (this._options?.onListenerError || Lt)(h2), D.None;
      }
      if (this._disposed) return D.None;
      e && (t = t.bind(e));
      let r = new Pt(t), n, o2;
      this._leakageMon && this._size >= Math.ceil(this._leakageMon.threshold * 0.2) && (r.stack = gi.create(), n = this._leakageMon.check(r.stack, this._size + 1)), fo && (r.stack = o2 ?? gi.create()), this._listeners ? this._listeners instanceof Pt ? (this._deliveryQueue ?? (this._deliveryQueue = new jn()), this._listeners = [this._listeners, r]) : this._listeners.push(r) : (this._options?.onWillAddFirstListener?.(this), this._listeners = r, this._options?.onDidAddFirstListener?.(this)), this._size++;
      let l = C(() => {
        _r?.unregister(l), n?.(), this._removeListener(r);
      });
      if (i instanceof Ee ? i.add(l) : Array.isArray(i) && i.push(l), _r) {
        let a = new Error().stack.split(`
`).slice(2, 3).join(`
`).trim(), u = /(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+:\d+)/.exec(a);
        _r.register(l, u?.[2] ?? a, l);
      }
      return l;
    }), this._event;
  }
  _removeListener(t) {
    if (this._options?.onWillRemoveListener?.(this), !this._listeners) return;
    if (this._size === 1) {
      this._listeners = void 0, this._options?.onDidRemoveLastListener?.(this), this._size = 0;
      return;
    }
    let e = this._listeners, i = e.indexOf(t);
    if (i === -1) throw console.log("disposed?", this._disposed), console.log("size?", this._size), console.log("arr?", JSON.stringify(this._listeners)), new Error("Attempted to dispose unknown listener");
    this._size--, e[i] = void 0;
    let r = this._deliveryQueue.current === this;
    if (this._size * ql <= e.length) {
      let n = 0;
      for (let o2 = 0; o2 < e.length; o2++) e[o2] ? e[n++] = e[o2] : r && (this._deliveryQueue.end--, n < this._deliveryQueue.i && this._deliveryQueue.i--);
      e.length = n;
    }
  }
  _deliver(t, e) {
    if (!t) return;
    let i = this._options?.onListenerError || Lt;
    if (!i) {
      t.value(e);
      return;
    }
    try {
      t.value(e);
    } catch (r) {
      i(r);
    }
  }
  _deliverQueue(t) {
    let e = t.current._listeners;
    for (; t.i < t.end; ) this._deliver(e[t.i++], t.value);
    t.reset();
  }
  fire(t) {
    if (this._deliveryQueue?.current && (this._deliverQueue(this._deliveryQueue), this._perfMon?.stop()), this._perfMon?.start(this._size), this._listeners) if (this._listeners instanceof Pt) this._deliver(this._listeners, t);
    else {
      let e = this._deliveryQueue;
      e.enqueue(this, t, this._listeners.length), this._deliverQueue(e);
    }
    this._perfMon?.stop();
  }
  hasListeners() {
    return this._size > 0;
  }
};
var jn = class {
  constructor() {
    this.i = -1;
    this.end = 0;
  }
  enqueue(t, e, i) {
    this.i = 0, this.end = i, this.current = t, this.value = e;
  }
  reset() {
    this.i = this.end, this.current = void 0, this.value = void 0;
  }
};
var gr = class gr2 {
  constructor() {
    this.mapWindowIdToZoomLevel = /* @__PURE__ */ new Map();
    this._onDidChangeZoomLevel = new v();
    this.onDidChangeZoomLevel = this._onDidChangeZoomLevel.event;
    this.mapWindowIdToZoomFactor = /* @__PURE__ */ new Map();
    this._onDidChangeFullscreen = new v();
    this.onDidChangeFullscreen = this._onDidChangeFullscreen.event;
    this.mapWindowIdToFullScreen = /* @__PURE__ */ new Map();
  }
  getZoomLevel(t) {
    return this.mapWindowIdToZoomLevel.get(this.getWindowId(t)) ?? 0;
  }
  setZoomLevel(t, e) {
    if (this.getZoomLevel(e) === t) return;
    let i = this.getWindowId(e);
    this.mapWindowIdToZoomLevel.set(i, t), this._onDidChangeZoomLevel.fire(i);
  }
  getZoomFactor(t) {
    return this.mapWindowIdToZoomFactor.get(this.getWindowId(t)) ?? 1;
  }
  setZoomFactor(t, e) {
    this.mapWindowIdToZoomFactor.set(this.getWindowId(e), t);
  }
  setFullscreen(t, e) {
    if (this.isFullscreen(e) === t) return;
    let i = this.getWindowId(e);
    this.mapWindowIdToFullScreen.set(i, t), this._onDidChangeFullscreen.fire(i);
  }
  isFullscreen(t) {
    return !!this.mapWindowIdToFullScreen.get(this.getWindowId(t));
  }
  getWindowId(t) {
    return t.vscodeWindowId;
  }
};
gr.INSTANCE = new gr();
var Si = gr;
function Xl(s15, t, e) {
  typeof t == "string" && (t = s15.matchMedia(t)), t.addEventListener("change", e);
}
var Eu = Si.INSTANCE.onDidChangeZoomLevel;
function mo(s15) {
  return Si.INSTANCE.getZoomFactor(s15);
}
var Tu = Si.INSTANCE.onDidChangeFullscreen;
var Ot = typeof navigator == "object" ? navigator.userAgent : "";
var Ei = Ot.indexOf("Firefox") >= 0;
var Bt = Ot.indexOf("AppleWebKit") >= 0;
var Ti = Ot.indexOf("Chrome") >= 0;
var Sr = !Ti && Ot.indexOf("Safari") >= 0;
var Iu = Ot.indexOf("Electron/") >= 0;
var yu = Ot.indexOf("Android") >= 0;
var vr = false;
if (typeof fe.matchMedia == "function") {
  let s15 = fe.matchMedia("(display-mode: standalone) or (display-mode: window-controls-overlay)"), t = fe.matchMedia("(display-mode: fullscreen)");
  vr = s15.matches, Xl(fe, s15, ({ matches: e }) => {
    vr && t.matches || (vr = e);
  });
}
function _o() {
  return vr;
}
var Nt = "en";
var yr = false;
var xr = false;
var Ii = false;
var Zl = false;
var vo = false;
var go = false;
var Jl = false;
var Ql = false;
var ea = false;
var ta = false;
var Tr;
var Ir = Nt;
var bo = Nt;
var ia;
var $e;
var Ve = globalThis;
var xe;
typeof Ve.vscode < "u" && typeof Ve.vscode.process < "u" ? xe = Ve.vscode.process : typeof process < "u" && typeof process?.versions?.node == "string" && (xe = process);
var So = typeof xe?.versions?.electron == "string";
var ra = So && xe?.type === "renderer";
if (typeof xe == "object") {
  yr = xe.platform === "win32", xr = xe.platform === "darwin", Ii = xe.platform === "linux", Zl = Ii && !!xe.env.SNAP && !!xe.env.SNAP_REVISION, Jl = So, ea = !!xe.env.CI || !!xe.env.BUILD_ARTIFACTSTAGINGDIRECTORY, Tr = Nt, Ir = Nt;
  let s15 = xe.env.VSCODE_NLS_CONFIG;
  if (s15) try {
    let t = JSON.parse(s15);
    Tr = t.userLocale, bo = t.osLocale, Ir = t.resolvedLanguage || Nt, ia = t.languagePack?.translationsConfigFile;
  } catch {
  }
  vo = true;
} else typeof navigator == "object" && !ra ? ($e = navigator.userAgent, yr = $e.indexOf("Windows") >= 0, xr = $e.indexOf("Macintosh") >= 0, Ql = ($e.indexOf("Macintosh") >= 0 || $e.indexOf("iPad") >= 0 || $e.indexOf("iPhone") >= 0) && !!navigator.maxTouchPoints && navigator.maxTouchPoints > 0, Ii = $e.indexOf("Linux") >= 0, ta = $e?.indexOf("Mobi") >= 0, go = true, Ir = globalThis._VSCODE_NLS_LANGUAGE || Nt, Tr = navigator.language.toLowerCase(), bo = Tr) : console.error("Unable to resolve platform.");
var Xn = 0;
xr ? Xn = 1 : yr ? Xn = 3 : Ii && (Xn = 2);
var wr = yr;
var Te = xr;
var Zn = Ii;
var Dr = vo;
var na = go && typeof Ve.importScripts == "function";
var xu = na ? Ve.origin : void 0;
var Fe = $e;
var st = Ir;
var sa;
((i) => {
  function s15() {
    return st;
  }
  i.value = s15;
  function t() {
    return st.length === 2 ? st === "en" : st.length >= 3 ? st[0] === "e" && st[1] === "n" && st[2] === "-" : false;
  }
  i.isDefaultVariant = t;
  function e() {
    return st === "en";
  }
  i.isDefault = e;
})(sa || (sa = {}));
var oa = typeof Ve.postMessage == "function" && !Ve.importScripts;
var Eo = (() => {
  if (oa) {
    let s15 = [];
    Ve.addEventListener("message", (e) => {
      if (e.data && e.data.vscodeScheduleAsyncWork) for (let i = 0, r = s15.length; i < r; i++) {
        let n = s15[i];
        if (n.id === e.data.vscodeScheduleAsyncWork) {
          s15.splice(i, 1), n.callback();
          return;
        }
      }
    });
    let t = 0;
    return (e) => {
      let i = ++t;
      s15.push({ id: i, callback: e }), Ve.postMessage({ vscodeScheduleAsyncWork: i }, "*");
    };
  }
  return (s15) => setTimeout(s15);
})();
var la = !!(Fe && Fe.indexOf("Chrome") >= 0);
var wu = !!(Fe && Fe.indexOf("Firefox") >= 0);
var Du = !!(!la && Fe && Fe.indexOf("Safari") >= 0);
var Ru = !!(Fe && Fe.indexOf("Edg/") >= 0);
var Lu = !!(Fe && Fe.indexOf("Android") >= 0);
var ot = typeof navigator == "object" ? navigator : {};
var aa = { clipboard: { writeText: Dr || document.queryCommandSupported && document.queryCommandSupported("copy") || !!(ot && ot.clipboard && ot.clipboard.writeText), readText: Dr || !!(ot && ot.clipboard && ot.clipboard.readText) }, keyboard: Dr || _o() ? 0 : ot.keyboard || Sr ? 1 : 2, touch: "ontouchstart" in fe || ot.maxTouchPoints > 0, pointerEvents: fe.PointerEvent && ("ontouchstart" in fe || navigator.maxTouchPoints > 0) };
var yi = class {
  constructor() {
    this._keyCodeToStr = [], this._strToKeyCode = /* @__PURE__ */ Object.create(null);
  }
  define(t, e) {
    this._keyCodeToStr[t] = e, this._strToKeyCode[e.toLowerCase()] = t;
  }
  keyCodeToStr(t) {
    return this._keyCodeToStr[t];
  }
  strToKeyCode(t) {
    return this._strToKeyCode[t.toLowerCase()] || 0;
  }
};
var Jn = new yi();
var To = new yi();
var Io = new yi();
var yo = new Array(230);
var Qn;
((o2) => {
  function s15(l) {
    return Jn.keyCodeToStr(l);
  }
  o2.toString = s15;
  function t(l) {
    return Jn.strToKeyCode(l);
  }
  o2.fromString = t;
  function e(l) {
    return To.keyCodeToStr(l);
  }
  o2.toUserSettingsUS = e;
  function i(l) {
    return Io.keyCodeToStr(l);
  }
  o2.toUserSettingsGeneral = i;
  function r(l) {
    return To.strToKeyCode(l) || Io.strToKeyCode(l);
  }
  o2.fromUserSettings = r;
  function n(l) {
    if (l >= 98 && l <= 113) return null;
    switch (l) {
      case 16:
        return "Up";
      case 18:
        return "Down";
      case 15:
        return "Left";
      case 17:
        return "Right";
    }
    return Jn.keyCodeToStr(l);
  }
  o2.toElectronAccelerator = n;
})(Qn || (Qn = {}));
var Rr = class s8 {
  constructor(t, e, i, r, n) {
    this.ctrlKey = t;
    this.shiftKey = e;
    this.altKey = i;
    this.metaKey = r;
    this.keyCode = n;
  }
  equals(t) {
    return t instanceof s8 && this.ctrlKey === t.ctrlKey && this.shiftKey === t.shiftKey && this.altKey === t.altKey && this.metaKey === t.metaKey && this.keyCode === t.keyCode;
  }
  getHashCode() {
    let t = this.ctrlKey ? "1" : "0", e = this.shiftKey ? "1" : "0", i = this.altKey ? "1" : "0", r = this.metaKey ? "1" : "0";
    return `K${t}${e}${i}${r}${this.keyCode}`;
  }
  isModifierKey() {
    return this.keyCode === 0 || this.keyCode === 5 || this.keyCode === 57 || this.keyCode === 6 || this.keyCode === 4;
  }
  toKeybinding() {
    return new es([this]);
  }
  isDuplicateModifierCase() {
    return this.ctrlKey && this.keyCode === 5 || this.shiftKey && this.keyCode === 4 || this.altKey && this.keyCode === 6 || this.metaKey && this.keyCode === 57;
  }
};
var es = class {
  constructor(t) {
    if (t.length === 0) throw eo("chords");
    this.chords = t;
  }
  getHashCode() {
    let t = "";
    for (let e = 0, i = this.chords.length; e < i; e++) e !== 0 && (t += ";"), t += this.chords[e].getHashCode();
    return t;
  }
  equals(t) {
    if (t === null || this.chords.length !== t.chords.length) return false;
    for (let e = 0; e < this.chords.length; e++) if (!this.chords[e].equals(t.chords[e])) return false;
    return true;
  }
};
function ca(s15) {
  if (s15.charCode) {
    let e = String.fromCharCode(s15.charCode).toUpperCase();
    return Qn.fromString(e);
  }
  let t = s15.keyCode;
  if (t === 3) return 7;
  if (Ei) switch (t) {
    case 59:
      return 85;
    case 60:
      if (Zn) return 97;
      break;
    case 61:
      return 86;
    case 107:
      return 109;
    case 109:
      return 111;
    case 173:
      return 88;
    case 224:
      if (Te) return 57;
      break;
  }
  else if (Bt) {
    if (Te && t === 93) return 57;
    if (!Te && t === 92) return 57;
  }
  return yo[t] || 0;
}
var ua = Te ? 256 : 2048;
var ha = 512;
var da = 1024;
var fa = Te ? 2048 : 256;
var ft = class {
  constructor(t) {
    this._standardKeyboardEventBrand = true;
    let e = t;
    this.browserEvent = e, this.target = e.target, this.ctrlKey = e.ctrlKey, this.shiftKey = e.shiftKey, this.altKey = e.altKey, this.metaKey = e.metaKey, this.altGraphKey = e.getModifierState?.("AltGraph"), this.keyCode = ca(e), this.code = e.code, this.ctrlKey = this.ctrlKey || this.keyCode === 5, this.altKey = this.altKey || this.keyCode === 6, this.shiftKey = this.shiftKey || this.keyCode === 4, this.metaKey = this.metaKey || this.keyCode === 57, this._asKeybinding = this._computeKeybinding(), this._asKeyCodeChord = this._computeKeyCodeChord();
  }
  preventDefault() {
    this.browserEvent && this.browserEvent.preventDefault && this.browserEvent.preventDefault();
  }
  stopPropagation() {
    this.browserEvent && this.browserEvent.stopPropagation && this.browserEvent.stopPropagation();
  }
  toKeyCodeChord() {
    return this._asKeyCodeChord;
  }
  equals(t) {
    return this._asKeybinding === t;
  }
  _computeKeybinding() {
    let t = 0;
    this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t = this.keyCode);
    let e = 0;
    return this.ctrlKey && (e |= ua), this.altKey && (e |= ha), this.shiftKey && (e |= da), this.metaKey && (e |= fa), e |= t, e;
  }
  _computeKeyCodeChord() {
    let t = 0;
    return this.keyCode !== 5 && this.keyCode !== 4 && this.keyCode !== 6 && this.keyCode !== 57 && (t = this.keyCode), new Rr(this.ctrlKey, this.shiftKey, this.altKey, this.metaKey, t);
  }
};
var wo = /* @__PURE__ */ new WeakMap();
function pa(s15) {
  if (!s15.parent || s15.parent === s15) return null;
  try {
    let t = s15.location, e = s15.parent.location;
    if (t.origin !== "null" && e.origin !== "null" && t.origin !== e.origin) return null;
  } catch {
    return null;
  }
  return s15.parent;
}
var Lr = class {
  static getSameOriginWindowChain(t) {
    let e = wo.get(t);
    if (!e) {
      e = [], wo.set(t, e);
      let i = t, r;
      do
        r = pa(i), r ? e.push({ window: new WeakRef(i), iframeElement: i.frameElement || null }) : e.push({ window: new WeakRef(i), iframeElement: null }), i = r;
      while (i);
    }
    return e.slice(0);
  }
  static getPositionOfChildWindowRelativeToAncestorWindow(t, e) {
    if (!e || t === e) return { top: 0, left: 0 };
    let i = 0, r = 0, n = this.getSameOriginWindowChain(t);
    for (let o2 of n) {
      let l = o2.window.deref();
      if (i += l?.scrollY ?? 0, r += l?.scrollX ?? 0, l === e || !o2.iframeElement) break;
      let a = o2.iframeElement.getBoundingClientRect();
      i += a.top, r += a.left;
    }
    return { top: i, left: r };
  }
};
var qe = class {
  constructor(t, e) {
    this.timestamp = Date.now(), this.browserEvent = e, this.leftButton = e.button === 0, this.middleButton = e.button === 1, this.rightButton = e.button === 2, this.buttons = e.buttons, this.target = e.target, this.detail = e.detail || 1, e.type === "dblclick" && (this.detail = 2), this.ctrlKey = e.ctrlKey, this.shiftKey = e.shiftKey, this.altKey = e.altKey, this.metaKey = e.metaKey, typeof e.pageX == "number" ? (this.posx = e.pageX, this.posy = e.pageY) : (this.posx = e.clientX + this.target.ownerDocument.body.scrollLeft + this.target.ownerDocument.documentElement.scrollLeft, this.posy = e.clientY + this.target.ownerDocument.body.scrollTop + this.target.ownerDocument.documentElement.scrollTop);
    let i = Lr.getPositionOfChildWindowRelativeToAncestorWindow(t, e.view);
    this.posx -= i.left, this.posy -= i.top;
  }
  preventDefault() {
    this.browserEvent.preventDefault();
  }
  stopPropagation() {
    this.browserEvent.stopPropagation();
  }
};
var xi = class {
  constructor(t, e = 0, i = 0) {
    this.browserEvent = t || null, this.target = t ? t.target || t.targetNode || t.srcElement : null, this.deltaY = i, this.deltaX = e;
    let r = false;
    if (Ti) {
      let n = navigator.userAgent.match(/Chrome\/(\d+)/);
      r = (n ? parseInt(n[1]) : 123) <= 122;
    }
    if (t) {
      let n = t, o2 = t, l = t.view?.devicePixelRatio || 1;
      if (typeof n.wheelDeltaY < "u") r ? this.deltaY = n.wheelDeltaY / (120 * l) : this.deltaY = n.wheelDeltaY / 120;
      else if (typeof o2.VERTICAL_AXIS < "u" && o2.axis === o2.VERTICAL_AXIS) this.deltaY = -o2.detail / 3;
      else if (t.type === "wheel") {
        let a = t;
        a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaY = -t.deltaY / 3 : this.deltaY = -t.deltaY : this.deltaY = -t.deltaY / 40;
      }
      if (typeof n.wheelDeltaX < "u") Sr && wr ? this.deltaX = -(n.wheelDeltaX / 120) : r ? this.deltaX = n.wheelDeltaX / (120 * l) : this.deltaX = n.wheelDeltaX / 120;
      else if (typeof o2.HORIZONTAL_AXIS < "u" && o2.axis === o2.HORIZONTAL_AXIS) this.deltaX = -t.detail / 3;
      else if (t.type === "wheel") {
        let a = t;
        a.deltaMode === a.DOM_DELTA_LINE ? Ei && !Te ? this.deltaX = -t.deltaX / 3 : this.deltaX = -t.deltaX : this.deltaX = -t.deltaX / 40;
      }
      this.deltaY === 0 && this.deltaX === 0 && t.wheelDelta && (r ? this.deltaY = t.wheelDelta / (120 * l) : this.deltaY = t.wheelDelta / 120);
    }
  }
  preventDefault() {
    this.browserEvent?.preventDefault();
  }
  stopPropagation() {
    this.browserEvent?.stopPropagation();
  }
};
var Do = Object.freeze(function(s15, t) {
  let e = setTimeout(s15.bind(t), 0);
  return { dispose() {
    clearTimeout(e);
  } };
});
var ma;
((i) => {
  function s15(r) {
    return r === i.None || r === i.Cancelled || r instanceof ts ? true : !r || typeof r != "object" ? false : typeof r.isCancellationRequested == "boolean" && typeof r.onCancellationRequested == "function";
  }
  i.isCancellationToken = s15, i.None = Object.freeze({ isCancellationRequested: false, onCancellationRequested: $.None }), i.Cancelled = Object.freeze({ isCancellationRequested: true, onCancellationRequested: Do });
})(ma || (ma = {}));
var ts = class {
  constructor() {
    this._isCancelled = false;
    this._emitter = null;
  }
  cancel() {
    this._isCancelled || (this._isCancelled = true, this._emitter && (this._emitter.fire(void 0), this.dispose()));
  }
  get isCancellationRequested() {
    return this._isCancelled;
  }
  get onCancellationRequested() {
    return this._isCancelled ? Do : (this._emitter || (this._emitter = new v()), this._emitter.event);
  }
  dispose() {
    this._emitter && (this._emitter.dispose(), this._emitter = null);
  }
};
var Ye = class {
  constructor(t, e) {
    this._isDisposed = false;
    this._token = -1, typeof t == "function" && typeof e == "number" && this.setIfNotSet(t, e);
  }
  dispose() {
    this.cancel(), this._isDisposed = true;
  }
  cancel() {
    this._token !== -1 && (clearTimeout(this._token), this._token = -1);
  }
  cancelAndSet(t, e) {
    if (this._isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed TimeoutTimer");
    this.cancel(), this._token = setTimeout(() => {
      this._token = -1, t();
    }, e);
  }
  setIfNotSet(t, e) {
    if (this._isDisposed) throw new Rt("Calling 'setIfNotSet' on a disposed TimeoutTimer");
    this._token === -1 && (this._token = setTimeout(() => {
      this._token = -1, t();
    }, e));
  }
};
var kr = class {
  constructor() {
    this.disposable = void 0;
    this.isDisposed = false;
  }
  cancel() {
    this.disposable?.dispose(), this.disposable = void 0;
  }
  cancelAndSet(t, e, i = globalThis) {
    if (this.isDisposed) throw new Rt("Calling 'cancelAndSet' on a disposed IntervalTimer");
    this.cancel();
    let r = i.setInterval(() => {
      t();
    }, e);
    this.disposable = C(() => {
      i.clearInterval(r), this.disposable = void 0;
    });
  }
  dispose() {
    this.cancel(), this.isDisposed = true;
  }
};
var ba;
var Ar;
(function() {
  typeof globalThis.requestIdleCallback != "function" || typeof globalThis.cancelIdleCallback != "function" ? Ar = (s15, t) => {
    Eo(() => {
      if (e) return;
      let i = Date.now() + 15;
      t(Object.freeze({ didTimeout: true, timeRemaining() {
        return Math.max(0, i - Date.now());
      } }));
    });
    let e = false;
    return { dispose() {
      e || (e = true);
    } };
  } : Ar = (s15, t, e) => {
    let i = s15.requestIdleCallback(t, typeof e == "number" ? { timeout: e } : void 0), r = false;
    return { dispose() {
      r || (r = true, s15.cancelIdleCallback(i));
    } };
  }, ba = (s15) => Ar(globalThis, s15);
})();
var va;
((e) => {
  async function s15(i) {
    let r, n = await Promise.all(i.map((o2) => o2.then((l) => l, (l) => {
      r || (r = l);
    })));
    if (typeof r < "u") throw r;
    return n;
  }
  e.settled = s15;
  function t(i) {
    return new Promise(async (r, n) => {
      try {
        await i(r, n);
      } catch (o2) {
        n(o2);
      }
    });
  }
  e.withAsyncBody = t;
})(va || (va = {}));
var _e = class _e2 {
  static fromArray(t) {
    return new _e2((e) => {
      e.emitMany(t);
    });
  }
  static fromPromise(t) {
    return new _e2(async (e) => {
      e.emitMany(await t);
    });
  }
  static fromPromises(t) {
    return new _e2(async (e) => {
      await Promise.all(t.map(async (i) => e.emitOne(await i)));
    });
  }
  static merge(t) {
    return new _e2(async (e) => {
      await Promise.all(t.map(async (i) => {
        for await (let r of i) e.emitOne(r);
      }));
    });
  }
  constructor(t, e) {
    this._state = 0, this._results = [], this._error = null, this._onReturn = e, this._onStateChanged = new v(), queueMicrotask(async () => {
      let i = { emitOne: (r) => this.emitOne(r), emitMany: (r) => this.emitMany(r), reject: (r) => this.reject(r) };
      try {
        await Promise.resolve(t(i)), this.resolve();
      } catch (r) {
        this.reject(r);
      } finally {
        i.emitOne = void 0, i.emitMany = void 0, i.reject = void 0;
      }
    });
  }
  [Symbol.asyncIterator]() {
    let t = 0;
    return { next: async () => {
      do {
        if (this._state === 2) throw this._error;
        if (t < this._results.length) return { done: false, value: this._results[t++] };
        if (this._state === 1) return { done: true, value: void 0 };
        await $.toPromise(this._onStateChanged.event);
      } while (true);
    }, return: async () => (this._onReturn?.(), { done: true, value: void 0 }) };
  }
  static map(t, e) {
    return new _e2(async (i) => {
      for await (let r of t) i.emitOne(e(r));
    });
  }
  map(t) {
    return _e2.map(this, t);
  }
  static filter(t, e) {
    return new _e2(async (i) => {
      for await (let r of t) e(r) && i.emitOne(r);
    });
  }
  filter(t) {
    return _e2.filter(this, t);
  }
  static coalesce(t) {
    return _e2.filter(t, (e) => !!e);
  }
  coalesce() {
    return _e2.coalesce(this);
  }
  static async toPromise(t) {
    let e = [];
    for await (let i of t) e.push(i);
    return e;
  }
  toPromise() {
    return _e2.toPromise(this);
  }
  emitOne(t) {
    this._state === 0 && (this._results.push(t), this._onStateChanged.fire());
  }
  emitMany(t) {
    this._state === 0 && (this._results = this._results.concat(t), this._onStateChanged.fire());
  }
  resolve() {
    this._state === 0 && (this._state = 1, this._onStateChanged.fire());
  }
  reject(t) {
    this._state === 0 && (this._state = 2, this._error = t, this._onStateChanged.fire());
  }
};
_e.EMPTY = _e.fromArray([]);
function Lo(s15) {
  return 55296 <= s15 && s15 <= 56319;
}
function is(s15) {
  return 56320 <= s15 && s15 <= 57343;
}
function Ao(s15, t) {
  return (s15 - 55296 << 10) + (t - 56320) + 65536;
}
function Mo(s15) {
  return ns(s15, 0);
}
function ns(s15, t) {
  switch (typeof s15) {
    case "object":
      return s15 === null ? je(349, t) : Array.isArray(s15) ? Ea(s15, t) : Ta(s15, t);
    case "string":
      return Po(s15, t);
    case "boolean":
      return Sa(s15, t);
    case "number":
      return je(s15, t);
    case "undefined":
      return je(937, t);
    default:
      return je(617, t);
  }
}
function je(s15, t) {
  return (t << 5) - t + s15 | 0;
}
function Sa(s15, t) {
  return je(s15 ? 433 : 863, t);
}
function Po(s15, t) {
  t = je(149417, t);
  for (let e = 0, i = s15.length; e < i; e++) t = je(s15.charCodeAt(e), t);
  return t;
}
function Ea(s15, t) {
  return t = je(104579, t), s15.reduce((e, i) => ns(i, e), t);
}
function Ta(s15, t) {
  return t = je(181387, t), Object.keys(s15).sort().reduce((e, i) => (e = Po(i, e), ns(s15[i], e)), t);
}
function rs(s15, t, e = 32) {
  let i = e - t, r = ~((1 << i) - 1);
  return (s15 << t | (r & s15) >>> i) >>> 0;
}
function ko(s15, t = 0, e = s15.byteLength, i = 0) {
  for (let r = 0; r < e; r++) s15[t + r] = i;
}
function Ia(s15, t, e = "0") {
  for (; s15.length < t; ) s15 = e + s15;
  return s15;
}
function wi(s15, t = 32) {
  return s15 instanceof ArrayBuffer ? Array.from(new Uint8Array(s15)).map((e) => e.toString(16).padStart(2, "0")).join("") : Ia((s15 >>> 0).toString(16), t / 4);
}
var Cr = class Cr2 {
  constructor() {
    this._h0 = 1732584193;
    this._h1 = 4023233417;
    this._h2 = 2562383102;
    this._h3 = 271733878;
    this._h4 = 3285377520;
    this._buff = new Uint8Array(67), this._buffDV = new DataView(this._buff.buffer), this._buffLen = 0, this._totalLen = 0, this._leftoverHighSurrogate = 0, this._finished = false;
  }
  update(t) {
    let e = t.length;
    if (e === 0) return;
    let i = this._buff, r = this._buffLen, n = this._leftoverHighSurrogate, o2, l;
    for (n !== 0 ? (o2 = n, l = -1, n = 0) : (o2 = t.charCodeAt(0), l = 0); ; ) {
      let a = o2;
      if (Lo(o2)) if (l + 1 < e) {
        let u = t.charCodeAt(l + 1);
        is(u) ? (l++, a = Ao(o2, u)) : a = 65533;
      } else {
        n = o2;
        break;
      }
      else is(o2) && (a = 65533);
      if (r = this._push(i, r, a), l++, l < e) o2 = t.charCodeAt(l);
      else break;
    }
    this._buffLen = r, this._leftoverHighSurrogate = n;
  }
  _push(t, e, i) {
    return i < 128 ? t[e++] = i : i < 2048 ? (t[e++] = 192 | (i & 1984) >>> 6, t[e++] = 128 | (i & 63) >>> 0) : i < 65536 ? (t[e++] = 224 | (i & 61440) >>> 12, t[e++] = 128 | (i & 4032) >>> 6, t[e++] = 128 | (i & 63) >>> 0) : (t[e++] = 240 | (i & 1835008) >>> 18, t[e++] = 128 | (i & 258048) >>> 12, t[e++] = 128 | (i & 4032) >>> 6, t[e++] = 128 | (i & 63) >>> 0), e >= 64 && (this._step(), e -= 64, this._totalLen += 64, t[0] = t[64], t[1] = t[65], t[2] = t[66]), e;
  }
  digest() {
    return this._finished || (this._finished = true, this._leftoverHighSurrogate && (this._leftoverHighSurrogate = 0, this._buffLen = this._push(this._buff, this._buffLen, 65533)), this._totalLen += this._buffLen, this._wrapUp()), wi(this._h0) + wi(this._h1) + wi(this._h2) + wi(this._h3) + wi(this._h4);
  }
  _wrapUp() {
    this._buff[this._buffLen++] = 128, ko(this._buff, this._buffLen), this._buffLen > 56 && (this._step(), ko(this._buff));
    let t = 8 * this._totalLen;
    this._buffDV.setUint32(56, Math.floor(t / 4294967296), false), this._buffDV.setUint32(60, t % 4294967296, false), this._step();
  }
  _step() {
    let t = Cr2._bigBlock32, e = this._buffDV;
    for (let c = 0; c < 64; c += 4) t.setUint32(c, e.getUint32(c, false), false);
    for (let c = 64; c < 320; c += 4) t.setUint32(c, rs(t.getUint32(c - 12, false) ^ t.getUint32(c - 32, false) ^ t.getUint32(c - 56, false) ^ t.getUint32(c - 64, false), 1), false);
    let i = this._h0, r = this._h1, n = this._h2, o2 = this._h3, l = this._h4, a, u, h2;
    for (let c = 0; c < 80; c++) c < 20 ? (a = r & n | ~r & o2, u = 1518500249) : c < 40 ? (a = r ^ n ^ o2, u = 1859775393) : c < 60 ? (a = r & n | r & o2 | n & o2, u = 2400959708) : (a = r ^ n ^ o2, u = 3395469782), h2 = rs(i, 5) + a + l + u + t.getUint32(c * 4, false) & 4294967295, l = o2, o2 = n, n = rs(r, 30), r = i, i = h2;
    this._h0 = this._h0 + i & 4294967295, this._h1 = this._h1 + r & 4294967295, this._h2 = this._h2 + n & 4294967295, this._h3 = this._h3 + o2 & 4294967295, this._h4 = this._h4 + l & 4294967295;
  }
};
Cr._bigBlock32 = new DataView(new ArrayBuffer(320));
var { registerWindow: Bh, getWindow: be, getDocument: Nh, getWindows: Fh, getWindowsCount: Hh, getWindowId: Oo, getWindowById: Wh, hasWindow: Uh, onDidRegisterWindow: No, onWillUnregisterWindow: Kh, onDidUnregisterWindow: zh } = (function() {
  let s15 = /* @__PURE__ */ new Map();
  fe;
  let t = { window: fe, disposables: new Ee() };
  s15.set(fe.vscodeWindowId, t);
  let e = new v(), i = new v(), r = new v();
  function n(o2, l) {
    return (typeof o2 == "number" ? s15.get(o2) : void 0) ?? (l ? t : void 0);
  }
  return { onDidRegisterWindow: e.event, onWillUnregisterWindow: r.event, onDidUnregisterWindow: i.event, registerWindow(o2) {
    if (s15.has(o2.vscodeWindowId)) return D.None;
    let l = new Ee(), a = { window: o2, disposables: l.add(new Ee()) };
    return s15.set(o2.vscodeWindowId, a), l.add(C(() => {
      s15.delete(o2.vscodeWindowId), i.fire(o2);
    })), l.add(L(o2, Y.BEFORE_UNLOAD, () => {
      r.fire(o2);
    })), e.fire(a), l;
  }, getWindows() {
    return s15.values();
  }, getWindowsCount() {
    return s15.size;
  }, getWindowId(o2) {
    return o2.vscodeWindowId;
  }, hasWindow(o2) {
    return s15.has(o2);
  }, getWindowById: n, getWindow(o2) {
    let l = o2;
    if (l?.ownerDocument?.defaultView) return l.ownerDocument.defaultView.window;
    let a = o2;
    return a?.view ? a.view.window : fe;
  }, getDocument(o2) {
    return be(o2).document;
  } };
})();
var ss = class {
  constructor(t, e, i, r) {
    this._node = t, this._type = e, this._handler = i, this._options = r || false, this._node.addEventListener(this._type, this._handler, this._options);
  }
  dispose() {
    this._handler && (this._node.removeEventListener(this._type, this._handler, this._options), this._node = null, this._handler = null);
  }
};
function L(s15, t, e, i) {
  return new ss(s15, t, e, i);
}
function ya(s15, t) {
  return function(e) {
    return t(new qe(s15, e));
  };
}
function xa(s15) {
  return function(t) {
    return s15(new ft(t));
  };
}
var os = function(t, e, i, r) {
  let n = i;
  return e === "click" || e === "mousedown" || e === "contextmenu" ? n = ya(be(t), i) : (e === "keydown" || e === "keypress" || e === "keyup") && (n = xa(i)), L(t, e, n, r);
};
var wa;
var mt;
var Mr = class extends kr {
  constructor(t) {
    super(), this.defaultTarget = t && be(t);
  }
  cancelAndSet(t, e, i) {
    return super.cancelAndSet(t, e, i ?? this.defaultTarget);
  }
};
var Di = class {
  constructor(t, e = 0) {
    this._runner = t, this.priority = e, this._canceled = false;
  }
  dispose() {
    this._canceled = true;
  }
  execute() {
    if (!this._canceled) try {
      this._runner();
    } catch (t) {
      Lt(t);
    }
  }
  static sort(t, e) {
    return e.priority - t.priority;
  }
};
(function() {
  let s15 = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Map(), e = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), r = (n) => {
    e.set(n, false);
    let o2 = s15.get(n) ?? [];
    for (t.set(n, o2), s15.set(n, []), i.set(n, true); o2.length > 0; ) o2.sort(Di.sort), o2.shift().execute();
    i.set(n, false);
  };
  mt = (n, o2, l = 0) => {
    let a = Oo(n), u = new Di(o2, l), h2 = s15.get(a);
    return h2 || (h2 = [], s15.set(a, h2)), h2.push(u), e.get(a) || (e.set(a, true), n.requestAnimationFrame(() => r(a))), u;
  }, wa = (n, o2, l) => {
    let a = Oo(n);
    if (i.get(a)) {
      let u = new Di(o2, l), h2 = t.get(a);
      return h2 || (h2 = [], t.set(a, h2)), h2.push(u), u;
    } else return mt(n, o2, l);
  };
})();
var pt = class pt2 {
  constructor(t, e) {
    this.width = t;
    this.height = e;
  }
  with(t = this.width, e = this.height) {
    return t !== this.width || e !== this.height ? new pt2(t, e) : this;
  }
  static is(t) {
    return typeof t == "object" && typeof t.height == "number" && typeof t.width == "number";
  }
  static lift(t) {
    return t instanceof pt2 ? t : new pt2(t.width, t.height);
  }
  static equals(t, e) {
    return t === e ? true : !t || !e ? false : t.width === e.width && t.height === e.height;
  }
};
pt.None = new pt(0, 0);
function Fo(s15) {
  let t = s15.getBoundingClientRect(), e = be(s15);
  return { left: t.left + e.scrollX, top: t.top + e.scrollY, width: t.width, height: t.height };
}
var Gh = new class {
  constructor() {
    this.mutationObservers = /* @__PURE__ */ new Map();
  }
  observe(s15, t, e) {
    let i = this.mutationObservers.get(s15);
    i || (i = /* @__PURE__ */ new Map(), this.mutationObservers.set(s15, i));
    let r = Mo(e), n = i.get(r);
    if (n) n.users += 1;
    else {
      let o2 = new v(), l = new MutationObserver((u) => o2.fire(u));
      l.observe(s15, e);
      let a = n = { users: 1, observer: l, onDidMutate: o2.event };
      t.add(C(() => {
        a.users -= 1, a.users === 0 && (o2.dispose(), l.disconnect(), i?.delete(r), i?.size === 0 && this.mutationObservers.delete(s15));
      })), i.set(r, n);
    }
    return n.onDidMutate;
  }
}();
var Y = { CLICK: "click", AUXCLICK: "auxclick", DBLCLICK: "dblclick", MOUSE_UP: "mouseup", MOUSE_DOWN: "mousedown", MOUSE_OVER: "mouseover", MOUSE_MOVE: "mousemove", MOUSE_OUT: "mouseout", MOUSE_ENTER: "mouseenter", MOUSE_LEAVE: "mouseleave", MOUSE_WHEEL: "wheel", POINTER_UP: "pointerup", POINTER_DOWN: "pointerdown", POINTER_MOVE: "pointermove", POINTER_LEAVE: "pointerleave", CONTEXT_MENU: "contextmenu", WHEEL: "wheel", KEY_DOWN: "keydown", KEY_PRESS: "keypress", KEY_UP: "keyup", LOAD: "load", BEFORE_UNLOAD: "beforeunload", UNLOAD: "unload", PAGE_SHOW: "pageshow", PAGE_HIDE: "pagehide", PASTE: "paste", ABORT: "abort", ERROR: "error", RESIZE: "resize", SCROLL: "scroll", FULLSCREEN_CHANGE: "fullscreenchange", WK_FULLSCREEN_CHANGE: "webkitfullscreenchange", SELECT: "select", CHANGE: "change", SUBMIT: "submit", RESET: "reset", FOCUS: "focus", FOCUS_IN: "focusin", FOCUS_OUT: "focusout", BLUR: "blur", INPUT: "input", STORAGE: "storage", DRAG_START: "dragstart", DRAG: "drag", DRAG_ENTER: "dragenter", DRAG_LEAVE: "dragleave", DRAG_OVER: "dragover", DROP: "drop", DRAG_END: "dragend", ANIMATION_START: Bt ? "webkitAnimationStart" : "animationstart", ANIMATION_END: Bt ? "webkitAnimationEnd" : "animationend", ANIMATION_ITERATION: Bt ? "webkitAnimationIteration" : "animationiteration" };
var Da = /([\w\-]+)?(#([\w\-]+))?((\.([\w\-]+))*)/;
function Ho(s15, t, e, ...i) {
  let r = Da.exec(t);
  if (!r) throw new Error("Bad use of emmet");
  let n = r[1] || "div", o2;
  return s15 !== "http://www.w3.org/1999/xhtml" ? o2 = document.createElementNS(s15, n) : o2 = document.createElement(n), r[3] && (o2.id = r[3]), r[4] && (o2.className = r[4].replace(/\./g, " ").trim()), e && Object.entries(e).forEach(([l, a]) => {
    typeof a > "u" || (/^on\w+$/.test(l) ? o2[l] = a : l === "selected" ? a && o2.setAttribute(l, "true") : o2.setAttribute(l, a));
  }), o2.append(...i), o2;
}
function Ra(s15, t, ...e) {
  return Ho("http://www.w3.org/1999/xhtml", s15, t, ...e);
}
Ra.SVG = function(s15, t, ...e) {
  return Ho("http://www.w3.org/2000/svg", s15, t, ...e);
};
var ls = class {
  constructor(t) {
    this.domNode = t;
    this._maxWidth = "";
    this._width = "";
    this._height = "";
    this._top = "";
    this._left = "";
    this._bottom = "";
    this._right = "";
    this._paddingTop = "";
    this._paddingLeft = "";
    this._paddingBottom = "";
    this._paddingRight = "";
    this._fontFamily = "";
    this._fontWeight = "";
    this._fontSize = "";
    this._fontStyle = "";
    this._fontFeatureSettings = "";
    this._fontVariationSettings = "";
    this._textDecoration = "";
    this._lineHeight = "";
    this._letterSpacing = "";
    this._className = "";
    this._display = "";
    this._position = "";
    this._visibility = "";
    this._color = "";
    this._backgroundColor = "";
    this._layerHint = false;
    this._contain = "none";
    this._boxShadow = "";
  }
  setMaxWidth(t) {
    let e = Ie(t);
    this._maxWidth !== e && (this._maxWidth = e, this.domNode.style.maxWidth = this._maxWidth);
  }
  setWidth(t) {
    let e = Ie(t);
    this._width !== e && (this._width = e, this.domNode.style.width = this._width);
  }
  setHeight(t) {
    let e = Ie(t);
    this._height !== e && (this._height = e, this.domNode.style.height = this._height);
  }
  setTop(t) {
    let e = Ie(t);
    this._top !== e && (this._top = e, this.domNode.style.top = this._top);
  }
  setLeft(t) {
    let e = Ie(t);
    this._left !== e && (this._left = e, this.domNode.style.left = this._left);
  }
  setBottom(t) {
    let e = Ie(t);
    this._bottom !== e && (this._bottom = e, this.domNode.style.bottom = this._bottom);
  }
  setRight(t) {
    let e = Ie(t);
    this._right !== e && (this._right = e, this.domNode.style.right = this._right);
  }
  setPaddingTop(t) {
    let e = Ie(t);
    this._paddingTop !== e && (this._paddingTop = e, this.domNode.style.paddingTop = this._paddingTop);
  }
  setPaddingLeft(t) {
    let e = Ie(t);
    this._paddingLeft !== e && (this._paddingLeft = e, this.domNode.style.paddingLeft = this._paddingLeft);
  }
  setPaddingBottom(t) {
    let e = Ie(t);
    this._paddingBottom !== e && (this._paddingBottom = e, this.domNode.style.paddingBottom = this._paddingBottom);
  }
  setPaddingRight(t) {
    let e = Ie(t);
    this._paddingRight !== e && (this._paddingRight = e, this.domNode.style.paddingRight = this._paddingRight);
  }
  setFontFamily(t) {
    this._fontFamily !== t && (this._fontFamily = t, this.domNode.style.fontFamily = this._fontFamily);
  }
  setFontWeight(t) {
    this._fontWeight !== t && (this._fontWeight = t, this.domNode.style.fontWeight = this._fontWeight);
  }
  setFontSize(t) {
    let e = Ie(t);
    this._fontSize !== e && (this._fontSize = e, this.domNode.style.fontSize = this._fontSize);
  }
  setFontStyle(t) {
    this._fontStyle !== t && (this._fontStyle = t, this.domNode.style.fontStyle = this._fontStyle);
  }
  setFontFeatureSettings(t) {
    this._fontFeatureSettings !== t && (this._fontFeatureSettings = t, this.domNode.style.fontFeatureSettings = this._fontFeatureSettings);
  }
  setFontVariationSettings(t) {
    this._fontVariationSettings !== t && (this._fontVariationSettings = t, this.domNode.style.fontVariationSettings = this._fontVariationSettings);
  }
  setTextDecoration(t) {
    this._textDecoration !== t && (this._textDecoration = t, this.domNode.style.textDecoration = this._textDecoration);
  }
  setLineHeight(t) {
    let e = Ie(t);
    this._lineHeight !== e && (this._lineHeight = e, this.domNode.style.lineHeight = this._lineHeight);
  }
  setLetterSpacing(t) {
    let e = Ie(t);
    this._letterSpacing !== e && (this._letterSpacing = e, this.domNode.style.letterSpacing = this._letterSpacing);
  }
  setClassName(t) {
    this._className !== t && (this._className = t, this.domNode.className = this._className);
  }
  toggleClassName(t, e) {
    this.domNode.classList.toggle(t, e), this._className = this.domNode.className;
  }
  setDisplay(t) {
    this._display !== t && (this._display = t, this.domNode.style.display = this._display);
  }
  setPosition(t) {
    this._position !== t && (this._position = t, this.domNode.style.position = this._position);
  }
  setVisibility(t) {
    this._visibility !== t && (this._visibility = t, this.domNode.style.visibility = this._visibility);
  }
  setColor(t) {
    this._color !== t && (this._color = t, this.domNode.style.color = this._color);
  }
  setBackgroundColor(t) {
    this._backgroundColor !== t && (this._backgroundColor = t, this.domNode.style.backgroundColor = this._backgroundColor);
  }
  setLayerHinting(t) {
    this._layerHint !== t && (this._layerHint = t, this.domNode.style.transform = this._layerHint ? "translate3d(0px, 0px, 0px)" : "");
  }
  setBoxShadow(t) {
    this._boxShadow !== t && (this._boxShadow = t, this.domNode.style.boxShadow = t);
  }
  setContain(t) {
    this._contain !== t && (this._contain = t, this.domNode.style.contain = this._contain);
  }
  setAttribute(t, e) {
    this.domNode.setAttribute(t, e);
  }
  removeAttribute(t) {
    this.domNode.removeAttribute(t);
  }
  appendChild(t) {
    this.domNode.appendChild(t.domNode);
  }
  removeChild(t) {
    this.domNode.removeChild(t.domNode);
  }
};
function Ie(s15) {
  return typeof s15 == "number" ? `${s15}px` : s15;
}
function _t(s15) {
  return new ls(s15);
}
var Wt = class {
  constructor() {
    this._hooks = new Ee();
    this._pointerMoveCallback = null;
    this._onStopCallback = null;
  }
  dispose() {
    this.stopMonitoring(false), this._hooks.dispose();
  }
  stopMonitoring(t, e) {
    if (!this.isMonitoring()) return;
    this._hooks.clear(), this._pointerMoveCallback = null;
    let i = this._onStopCallback;
    this._onStopCallback = null, t && i && i(e);
  }
  isMonitoring() {
    return !!this._pointerMoveCallback;
  }
  startMonitoring(t, e, i, r, n) {
    this.isMonitoring() && this.stopMonitoring(false), this._pointerMoveCallback = r, this._onStopCallback = n;
    let o2 = t;
    try {
      t.setPointerCapture(e), this._hooks.add(C(() => {
        try {
          t.releasePointerCapture(e);
        } catch {
        }
      }));
    } catch {
      o2 = be(t);
    }
    this._hooks.add(L(o2, Y.POINTER_MOVE, (l) => {
      if (l.buttons !== i) {
        this.stopMonitoring(true);
        return;
      }
      l.preventDefault(), this._pointerMoveCallback(l);
    })), this._hooks.add(L(o2, Y.POINTER_UP, (l) => this.stopMonitoring(true)));
  }
};
function Wo(s15, t, e) {
  let i = null, r = null;
  if (typeof e.value == "function" ? (i = "value", r = e.value, r.length !== 0 && console.warn("Memoize should only be used in functions with zero parameters")) : typeof e.get == "function" && (i = "get", r = e.get), !r) throw new Error("not supported");
  let n = `$memoize$${t}`;
  e[i] = function(...o2) {
    return this.hasOwnProperty(n) || Object.defineProperty(this, n, { configurable: false, enumerable: false, writable: false, value: r.apply(this, o2) }), this[n];
  };
}
var He;
((n) => (n.Tap = "-xterm-gesturetap", n.Change = "-xterm-gesturechange", n.Start = "-xterm-gesturestart", n.End = "-xterm-gesturesend", n.Contextmenu = "-xterm-gesturecontextmenu"))(He || (He = {}));
var Q = class Q2 extends D {
  constructor() {
    super();
    this.dispatched = false;
    this.targets = new Ct();
    this.ignoreTargets = new Ct();
    this.activeTouches = {}, this.handle = null, this._lastSetTapCountTime = 0, this._register($.runAndSubscribe(No, ({ window: e, disposables: i }) => {
      i.add(L(e.document, "touchstart", (r) => this.onTouchStart(r), { passive: false })), i.add(L(e.document, "touchend", (r) => this.onTouchEnd(e, r))), i.add(L(e.document, "touchmove", (r) => this.onTouchMove(r), { passive: false }));
    }, { window: fe, disposables: this._store }));
  }
  static addTarget(e) {
    if (!Q2.isTouchDevice()) return D.None;
    Q2.INSTANCE || (Q2.INSTANCE = Gn(new Q2()));
    let i = Q2.INSTANCE.targets.push(e);
    return C(i);
  }
  static ignoreTarget(e) {
    if (!Q2.isTouchDevice()) return D.None;
    Q2.INSTANCE || (Q2.INSTANCE = Gn(new Q2()));
    let i = Q2.INSTANCE.ignoreTargets.push(e);
    return C(i);
  }
  static isTouchDevice() {
    return "ontouchstart" in fe || navigator.maxTouchPoints > 0;
  }
  dispose() {
    this.handle && (this.handle.dispose(), this.handle = null), super.dispose();
  }
  onTouchStart(e) {
    let i = Date.now();
    this.handle && (this.handle.dispose(), this.handle = null);
    for (let r = 0, n = e.targetTouches.length; r < n; r++) {
      let o2 = e.targetTouches.item(r);
      this.activeTouches[o2.identifier] = { id: o2.identifier, initialTarget: o2.target, initialTimeStamp: i, initialPageX: o2.pageX, initialPageY: o2.pageY, rollingTimestamps: [i], rollingPageX: [o2.pageX], rollingPageY: [o2.pageY] };
      let l = this.newGestureEvent(He.Start, o2.target);
      l.pageX = o2.pageX, l.pageY = o2.pageY, this.dispatchEvent(l);
    }
    this.dispatched && (e.preventDefault(), e.stopPropagation(), this.dispatched = false);
  }
  onTouchEnd(e, i) {
    let r = Date.now(), n = Object.keys(this.activeTouches).length;
    for (let o2 = 0, l = i.changedTouches.length; o2 < l; o2++) {
      let a = i.changedTouches.item(o2);
      if (!this.activeTouches.hasOwnProperty(String(a.identifier))) {
        console.warn("move of an UNKNOWN touch", a);
        continue;
      }
      let u = this.activeTouches[a.identifier], h2 = Date.now() - u.initialTimeStamp;
      if (h2 < Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
        let c = this.newGestureEvent(He.Tap, u.initialTarget);
        c.pageX = Se(u.rollingPageX), c.pageY = Se(u.rollingPageY), this.dispatchEvent(c);
      } else if (h2 >= Q2.HOLD_DELAY && Math.abs(u.initialPageX - Se(u.rollingPageX)) < 30 && Math.abs(u.initialPageY - Se(u.rollingPageY)) < 30) {
        let c = this.newGestureEvent(He.Contextmenu, u.initialTarget);
        c.pageX = Se(u.rollingPageX), c.pageY = Se(u.rollingPageY), this.dispatchEvent(c);
      } else if (n === 1) {
        let c = Se(u.rollingPageX), d = Se(u.rollingPageY), _2 = Se(u.rollingTimestamps) - u.rollingTimestamps[0], p = c - u.rollingPageX[0], m = d - u.rollingPageY[0], f = [...this.targets].filter((A) => u.initialTarget instanceof Node && A.contains(u.initialTarget));
        this.inertia(e, f, r, Math.abs(p) / _2, p > 0 ? 1 : -1, c, Math.abs(m) / _2, m > 0 ? 1 : -1, d);
      }
      this.dispatchEvent(this.newGestureEvent(He.End, u.initialTarget)), delete this.activeTouches[a.identifier];
    }
    this.dispatched && (i.preventDefault(), i.stopPropagation(), this.dispatched = false);
  }
  newGestureEvent(e, i) {
    let r = document.createEvent("CustomEvent");
    return r.initEvent(e, false, true), r.initialTarget = i, r.tapCount = 0, r;
  }
  dispatchEvent(e) {
    if (e.type === He.Tap) {
      let i = (/* @__PURE__ */ new Date()).getTime(), r = 0;
      i - this._lastSetTapCountTime > Q2.CLEAR_TAP_COUNT_TIME ? r = 1 : r = 2, this._lastSetTapCountTime = i, e.tapCount = r;
    } else (e.type === He.Change || e.type === He.Contextmenu) && (this._lastSetTapCountTime = 0);
    if (e.initialTarget instanceof Node) {
      for (let r of this.ignoreTargets) if (r.contains(e.initialTarget)) return;
      let i = [];
      for (let r of this.targets) if (r.contains(e.initialTarget)) {
        let n = 0, o2 = e.initialTarget;
        for (; o2 && o2 !== r; ) n++, o2 = o2.parentElement;
        i.push([n, r]);
      }
      i.sort((r, n) => r[0] - n[0]);
      for (let [r, n] of i) n.dispatchEvent(e), this.dispatched = true;
    }
  }
  inertia(e, i, r, n, o2, l, a, u, h2) {
    this.handle = mt(e, () => {
      let c = Date.now(), d = c - r, _2 = 0, p = 0, m = true;
      n += Q2.SCROLL_FRICTION * d, a += Q2.SCROLL_FRICTION * d, n > 0 && (m = false, _2 = o2 * n * d), a > 0 && (m = false, p = u * a * d);
      let f = this.newGestureEvent(He.Change);
      f.translationX = _2, f.translationY = p, i.forEach((A) => A.dispatchEvent(f)), m || this.inertia(e, i, c, n, o2, l + _2, a, u, h2 + p);
    });
  }
  onTouchMove(e) {
    let i = Date.now();
    for (let r = 0, n = e.changedTouches.length; r < n; r++) {
      let o2 = e.changedTouches.item(r);
      if (!this.activeTouches.hasOwnProperty(String(o2.identifier))) {
        console.warn("end of an UNKNOWN touch", o2);
        continue;
      }
      let l = this.activeTouches[o2.identifier], a = this.newGestureEvent(He.Change, l.initialTarget);
      a.translationX = o2.pageX - Se(l.rollingPageX), a.translationY = o2.pageY - Se(l.rollingPageY), a.pageX = o2.pageX, a.pageY = o2.pageY, this.dispatchEvent(a), l.rollingPageX.length > 3 && (l.rollingPageX.shift(), l.rollingPageY.shift(), l.rollingTimestamps.shift()), l.rollingPageX.push(o2.pageX), l.rollingPageY.push(o2.pageY), l.rollingTimestamps.push(i);
    }
    this.dispatched && (e.preventDefault(), e.stopPropagation(), this.dispatched = false);
  }
};
Q.SCROLL_FRICTION = -5e-3, Q.HOLD_DELAY = 700, Q.CLEAR_TAP_COUNT_TIME = 400, M([Wo], Q, "isTouchDevice", 1);
var Pr = Q;
var lt = class extends D {
  onclick(t, e) {
    this._register(L(t, Y.CLICK, (i) => e(new qe(be(t), i))));
  }
  onmousedown(t, e) {
    this._register(L(t, Y.MOUSE_DOWN, (i) => e(new qe(be(t), i))));
  }
  onmouseover(t, e) {
    this._register(L(t, Y.MOUSE_OVER, (i) => e(new qe(be(t), i))));
  }
  onmouseleave(t, e) {
    this._register(L(t, Y.MOUSE_LEAVE, (i) => e(new qe(be(t), i))));
  }
  onkeydown(t, e) {
    this._register(L(t, Y.KEY_DOWN, (i) => e(new ft(i))));
  }
  onkeyup(t, e) {
    this._register(L(t, Y.KEY_UP, (i) => e(new ft(i))));
  }
  oninput(t, e) {
    this._register(L(t, Y.INPUT, e));
  }
  onblur(t, e) {
    this._register(L(t, Y.BLUR, e));
  }
  onfocus(t, e) {
    this._register(L(t, Y.FOCUS, e));
  }
  onchange(t, e) {
    this._register(L(t, Y.CHANGE, e));
  }
  ignoreGesture(t) {
    return Pr.ignoreTarget(t);
  }
};
var Uo = 11;
var Or = class extends lt {
  constructor(t) {
    super(), this._onActivate = t.onActivate, this.bgDomNode = document.createElement("div"), this.bgDomNode.className = "arrow-background", this.bgDomNode.style.position = "absolute", this.bgDomNode.style.width = t.bgWidth + "px", this.bgDomNode.style.height = t.bgHeight + "px", typeof t.top < "u" && (this.bgDomNode.style.top = "0px"), typeof t.left < "u" && (this.bgDomNode.style.left = "0px"), typeof t.bottom < "u" && (this.bgDomNode.style.bottom = "0px"), typeof t.right < "u" && (this.bgDomNode.style.right = "0px"), this.domNode = document.createElement("div"), this.domNode.className = t.className, this.domNode.style.position = "absolute", this.domNode.style.width = Uo + "px", this.domNode.style.height = Uo + "px", typeof t.top < "u" && (this.domNode.style.top = t.top + "px"), typeof t.left < "u" && (this.domNode.style.left = t.left + "px"), typeof t.bottom < "u" && (this.domNode.style.bottom = t.bottom + "px"), typeof t.right < "u" && (this.domNode.style.right = t.right + "px"), this._pointerMoveMonitor = this._register(new Wt()), this._register(os(this.bgDomNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._register(os(this.domNode, Y.POINTER_DOWN, (e) => this._arrowPointerDown(e))), this._pointerdownRepeatTimer = this._register(new Mr()), this._pointerdownScheduleRepeatTimer = this._register(new Ye());
  }
  _arrowPointerDown(t) {
    if (!t.target || !(t.target instanceof Element)) return;
    let e = () => {
      this._pointerdownRepeatTimer.cancelAndSet(() => this._onActivate(), 1e3 / 24, be(t));
    };
    this._onActivate(), this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancelAndSet(e, 200), this._pointerMoveMonitor.startMonitoring(t.target, t.pointerId, t.buttons, (i) => {
    }, () => {
      this._pointerdownRepeatTimer.cancel(), this._pointerdownScheduleRepeatTimer.cancel();
    }), t.preventDefault();
  }
};
var cs = class s9 {
  constructor(t, e, i, r, n, o2, l) {
    this._forceIntegerValues = t;
    this._scrollStateBrand = void 0;
    this._forceIntegerValues && (e = e | 0, i = i | 0, r = r | 0, n = n | 0, o2 = o2 | 0, l = l | 0), this.rawScrollLeft = r, this.rawScrollTop = l, e < 0 && (e = 0), r + e > i && (r = i - e), r < 0 && (r = 0), n < 0 && (n = 0), l + n > o2 && (l = o2 - n), l < 0 && (l = 0), this.width = e, this.scrollWidth = i, this.scrollLeft = r, this.height = n, this.scrollHeight = o2, this.scrollTop = l;
  }
  equals(t) {
    return this.rawScrollLeft === t.rawScrollLeft && this.rawScrollTop === t.rawScrollTop && this.width === t.width && this.scrollWidth === t.scrollWidth && this.scrollLeft === t.scrollLeft && this.height === t.height && this.scrollHeight === t.scrollHeight && this.scrollTop === t.scrollTop;
  }
  withScrollDimensions(t, e) {
    return new s9(this._forceIntegerValues, typeof t.width < "u" ? t.width : this.width, typeof t.scrollWidth < "u" ? t.scrollWidth : this.scrollWidth, e ? this.rawScrollLeft : this.scrollLeft, typeof t.height < "u" ? t.height : this.height, typeof t.scrollHeight < "u" ? t.scrollHeight : this.scrollHeight, e ? this.rawScrollTop : this.scrollTop);
  }
  withScrollPosition(t) {
    return new s9(this._forceIntegerValues, this.width, this.scrollWidth, typeof t.scrollLeft < "u" ? t.scrollLeft : this.rawScrollLeft, this.height, this.scrollHeight, typeof t.scrollTop < "u" ? t.scrollTop : this.rawScrollTop);
  }
  createScrollEvent(t, e) {
    let i = this.width !== t.width, r = this.scrollWidth !== t.scrollWidth, n = this.scrollLeft !== t.scrollLeft, o2 = this.height !== t.height, l = this.scrollHeight !== t.scrollHeight, a = this.scrollTop !== t.scrollTop;
    return { inSmoothScrolling: e, oldWidth: t.width, oldScrollWidth: t.scrollWidth, oldScrollLeft: t.scrollLeft, width: this.width, scrollWidth: this.scrollWidth, scrollLeft: this.scrollLeft, oldHeight: t.height, oldScrollHeight: t.scrollHeight, oldScrollTop: t.scrollTop, height: this.height, scrollHeight: this.scrollHeight, scrollTop: this.scrollTop, widthChanged: i, scrollWidthChanged: r, scrollLeftChanged: n, heightChanged: o2, scrollHeightChanged: l, scrollTopChanged: a };
  }
};
var Ri = class extends D {
  constructor(e) {
    super();
    this._scrollableBrand = void 0;
    this._onScroll = this._register(new v());
    this.onScroll = this._onScroll.event;
    this._smoothScrollDuration = e.smoothScrollDuration, this._scheduleAtNextAnimationFrame = e.scheduleAtNextAnimationFrame, this._state = new cs(e.forceIntegerValues, 0, 0, 0, 0, 0, 0), this._smoothScrolling = null;
  }
  dispose() {
    this._smoothScrolling && (this._smoothScrolling.dispose(), this._smoothScrolling = null), super.dispose();
  }
  setSmoothScrollDuration(e) {
    this._smoothScrollDuration = e;
  }
  validateScrollPosition(e) {
    return this._state.withScrollPosition(e);
  }
  getScrollDimensions() {
    return this._state;
  }
  setScrollDimensions(e, i) {
    let r = this._state.withScrollDimensions(e, i);
    this._setState(r, !!this._smoothScrolling), this._smoothScrolling?.acceptScrollDimensions(this._state);
  }
  getFutureScrollPosition() {
    return this._smoothScrolling ? this._smoothScrolling.to : this._state;
  }
  getCurrentScrollPosition() {
    return this._state;
  }
  setScrollPositionNow(e) {
    let i = this._state.withScrollPosition(e);
    this._smoothScrolling && (this._smoothScrolling.dispose(), this._smoothScrolling = null), this._setState(i, false);
  }
  setScrollPositionSmooth(e, i) {
    if (this._smoothScrollDuration === 0) return this.setScrollPositionNow(e);
    if (this._smoothScrolling) {
      e = { scrollLeft: typeof e.scrollLeft > "u" ? this._smoothScrolling.to.scrollLeft : e.scrollLeft, scrollTop: typeof e.scrollTop > "u" ? this._smoothScrolling.to.scrollTop : e.scrollTop };
      let r = this._state.withScrollPosition(e);
      if (this._smoothScrolling.to.scrollLeft === r.scrollLeft && this._smoothScrolling.to.scrollTop === r.scrollTop) return;
      let n;
      i ? n = new Nr(this._smoothScrolling.from, r, this._smoothScrolling.startTime, this._smoothScrolling.duration) : n = this._smoothScrolling.combine(this._state, r, this._smoothScrollDuration), this._smoothScrolling.dispose(), this._smoothScrolling = n;
    } else {
      let r = this._state.withScrollPosition(e);
      this._smoothScrolling = Nr.start(this._state, r, this._smoothScrollDuration);
    }
    this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
      this._smoothScrolling && (this._smoothScrolling.animationFrameDisposable = null, this._performSmoothScrolling());
    });
  }
  hasPendingScrollAnimation() {
    return !!this._smoothScrolling;
  }
  _performSmoothScrolling() {
    if (!this._smoothScrolling) return;
    let e = this._smoothScrolling.tick(), i = this._state.withScrollPosition(e);
    if (this._setState(i, true), !!this._smoothScrolling) {
      if (e.isDone) {
        this._smoothScrolling.dispose(), this._smoothScrolling = null;
        return;
      }
      this._smoothScrolling.animationFrameDisposable = this._scheduleAtNextAnimationFrame(() => {
        this._smoothScrolling && (this._smoothScrolling.animationFrameDisposable = null, this._performSmoothScrolling());
      });
    }
  }
  _setState(e, i) {
    let r = this._state;
    r.equals(e) || (this._state = e, this._onScroll.fire(this._state.createScrollEvent(r, i)));
  }
};
var Br = class {
  constructor(t, e, i) {
    this.scrollLeft = t, this.scrollTop = e, this.isDone = i;
  }
};
function as(s15, t) {
  let e = t - s15;
  return function(i) {
    return s15 + e * ka(i);
  };
}
function La(s15, t, e) {
  return function(i) {
    return i < e ? s15(i / e) : t((i - e) / (1 - e));
  };
}
var Nr = class s10 {
  constructor(t, e, i, r) {
    this.from = t, this.to = e, this.duration = r, this.startTime = i, this.animationFrameDisposable = null, this._initAnimations();
  }
  _initAnimations() {
    this.scrollLeft = this._initAnimation(this.from.scrollLeft, this.to.scrollLeft, this.to.width), this.scrollTop = this._initAnimation(this.from.scrollTop, this.to.scrollTop, this.to.height);
  }
  _initAnimation(t, e, i) {
    if (Math.abs(t - e) > 2.5 * i) {
      let n, o2;
      return t < e ? (n = t + 0.75 * i, o2 = e - 0.75 * i) : (n = t - 0.75 * i, o2 = e + 0.75 * i), La(as(t, n), as(o2, e), 0.33);
    }
    return as(t, e);
  }
  dispose() {
    this.animationFrameDisposable !== null && (this.animationFrameDisposable.dispose(), this.animationFrameDisposable = null);
  }
  acceptScrollDimensions(t) {
    this.to = t.withScrollPosition(this.to), this._initAnimations();
  }
  tick() {
    return this._tick(Date.now());
  }
  _tick(t) {
    let e = (t - this.startTime) / this.duration;
    if (e < 1) {
      let i = this.scrollLeft(e), r = this.scrollTop(e);
      return new Br(i, r, false);
    }
    return new Br(this.to.scrollLeft, this.to.scrollTop, true);
  }
  combine(t, e, i) {
    return s10.start(t, e, i);
  }
  static start(t, e, i) {
    i = i + 10;
    let r = Date.now() - 10;
    return new s10(t, e, r, i);
  }
};
function Aa(s15) {
  return Math.pow(s15, 3);
}
function ka(s15) {
  return 1 - Aa(1 - s15);
}
var Fr = class extends D {
  constructor(t, e, i) {
    super(), this._visibility = t, this._visibleClassName = e, this._invisibleClassName = i, this._domNode = null, this._isVisible = false, this._isNeeded = false, this._rawShouldBeVisible = false, this._shouldBeVisible = false, this._revealTimer = this._register(new Ye());
  }
  setVisibility(t) {
    this._visibility !== t && (this._visibility = t, this._updateShouldBeVisible());
  }
  setShouldBeVisible(t) {
    this._rawShouldBeVisible = t, this._updateShouldBeVisible();
  }
  _applyVisibilitySetting() {
    return this._visibility === 2 ? false : this._visibility === 3 ? true : this._rawShouldBeVisible;
  }
  _updateShouldBeVisible() {
    let t = this._applyVisibilitySetting();
    this._shouldBeVisible !== t && (this._shouldBeVisible = t, this.ensureVisibility());
  }
  setIsNeeded(t) {
    this._isNeeded !== t && (this._isNeeded = t, this.ensureVisibility());
  }
  setDomNode(t) {
    this._domNode = t, this._domNode.setClassName(this._invisibleClassName), this.setShouldBeVisible(false);
  }
  ensureVisibility() {
    if (!this._isNeeded) {
      this._hide(false);
      return;
    }
    this._shouldBeVisible ? this._reveal() : this._hide(true);
  }
  _reveal() {
    this._isVisible || (this._isVisible = true, this._revealTimer.setIfNotSet(() => {
      this._domNode?.setClassName(this._visibleClassName);
    }, 0));
  }
  _hide(t) {
    this._revealTimer.cancel(), this._isVisible && (this._isVisible = false, this._domNode?.setClassName(this._invisibleClassName + (t ? " fade" : "")));
  }
};
var Ca = 140;
var Ut = class extends lt {
  constructor(t) {
    super(), this._lazyRender = t.lazyRender, this._host = t.host, this._scrollable = t.scrollable, this._scrollByPage = t.scrollByPage, this._scrollbarState = t.scrollbarState, this._visibilityController = this._register(new Fr(t.visibility, "visible scrollbar " + t.extraScrollbarClassName, "invisible scrollbar " + t.extraScrollbarClassName)), this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._pointerMoveMonitor = this._register(new Wt()), this._shouldRender = true, this.domNode = _t(document.createElement("div")), this.domNode.setAttribute("role", "presentation"), this.domNode.setAttribute("aria-hidden", "true"), this._visibilityController.setDomNode(this.domNode), this.domNode.setPosition("absolute"), this._register(L(this.domNode.domNode, Y.POINTER_DOWN, (e) => this._domNodePointerDown(e)));
  }
  _createArrow(t) {
    let e = this._register(new Or(t));
    this.domNode.domNode.appendChild(e.bgDomNode), this.domNode.domNode.appendChild(e.domNode);
  }
  _createSlider(t, e, i, r) {
    this.slider = _t(document.createElement("div")), this.slider.setClassName("slider"), this.slider.setPosition("absolute"), this.slider.setTop(t), this.slider.setLeft(e), typeof i == "number" && this.slider.setWidth(i), typeof r == "number" && this.slider.setHeight(r), this.slider.setLayerHinting(true), this.slider.setContain("strict"), this.domNode.domNode.appendChild(this.slider.domNode), this._register(L(this.slider.domNode, Y.POINTER_DOWN, (n) => {
      n.button === 0 && (n.preventDefault(), this._sliderPointerDown(n));
    })), this.onclick(this.slider.domNode, (n) => {
      n.leftButton && n.stopPropagation();
    });
  }
  _onElementSize(t) {
    return this._scrollbarState.setVisibleSize(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
  }
  _onElementScrollSize(t) {
    return this._scrollbarState.setScrollSize(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
  }
  _onElementScrollPosition(t) {
    return this._scrollbarState.setScrollPosition(t) && (this._visibilityController.setIsNeeded(this._scrollbarState.isNeeded()), this._shouldRender = true, this._lazyRender || this.render()), this._shouldRender;
  }
  beginReveal() {
    this._visibilityController.setShouldBeVisible(true);
  }
  beginHide() {
    this._visibilityController.setShouldBeVisible(false);
  }
  render() {
    this._shouldRender && (this._shouldRender = false, this._renderDomNode(this._scrollbarState.getRectangleLargeSize(), this._scrollbarState.getRectangleSmallSize()), this._updateSlider(this._scrollbarState.getSliderSize(), this._scrollbarState.getArrowSize() + this._scrollbarState.getSliderPosition()));
  }
  _domNodePointerDown(t) {
    t.target === this.domNode.domNode && this._onPointerDown(t);
  }
  delegatePointerDown(t) {
    let e = this.domNode.domNode.getClientRects()[0].top, i = e + this._scrollbarState.getSliderPosition(), r = e + this._scrollbarState.getSliderPosition() + this._scrollbarState.getSliderSize(), n = this._sliderPointerPosition(t);
    i <= n && n <= r ? t.button === 0 && (t.preventDefault(), this._sliderPointerDown(t)) : this._onPointerDown(t);
  }
  _onPointerDown(t) {
    let e, i;
    if (t.target === this.domNode.domNode && typeof t.offsetX == "number" && typeof t.offsetY == "number") e = t.offsetX, i = t.offsetY;
    else {
      let n = Fo(this.domNode.domNode);
      e = t.pageX - n.left, i = t.pageY - n.top;
    }
    let r = this._pointerDownRelativePosition(e, i);
    this._setDesiredScrollPositionNow(this._scrollByPage ? this._scrollbarState.getDesiredScrollPositionFromOffsetPaged(r) : this._scrollbarState.getDesiredScrollPositionFromOffset(r)), t.button === 0 && (t.preventDefault(), this._sliderPointerDown(t));
  }
  _sliderPointerDown(t) {
    if (!t.target || !(t.target instanceof Element)) return;
    let e = this._sliderPointerPosition(t), i = this._sliderOrthogonalPointerPosition(t), r = this._scrollbarState.clone();
    this.slider.toggleClassName("active", true), this._pointerMoveMonitor.startMonitoring(t.target, t.pointerId, t.buttons, (n) => {
      let o2 = this._sliderOrthogonalPointerPosition(n), l = Math.abs(o2 - i);
      if (wr && l > Ca) {
        this._setDesiredScrollPositionNow(r.getScrollPosition());
        return;
      }
      let u = this._sliderPointerPosition(n) - e;
      this._setDesiredScrollPositionNow(r.getDesiredScrollPositionFromDelta(u));
    }, () => {
      this.slider.toggleClassName("active", false), this._host.onDragEnd();
    }), this._host.onDragStart();
  }
  _setDesiredScrollPositionNow(t) {
    let e = {};
    this.writeScrollPosition(e, t), this._scrollable.setScrollPositionNow(e);
  }
  updateScrollbarSize(t) {
    this._updateScrollbarSize(t), this._scrollbarState.setScrollbarSize(t), this._shouldRender = true, this._lazyRender || this.render();
  }
  isNeeded() {
    return this._scrollbarState.isNeeded();
  }
};
var Kt = class s11 {
  constructor(t, e, i, r, n, o2) {
    this._scrollbarSize = Math.round(e), this._oppositeScrollbarSize = Math.round(i), this._arrowSize = Math.round(t), this._visibleSize = r, this._scrollSize = n, this._scrollPosition = o2, this._computedAvailableSize = 0, this._computedIsNeeded = false, this._computedSliderSize = 0, this._computedSliderRatio = 0, this._computedSliderPosition = 0, this._refreshComputedValues();
  }
  clone() {
    return new s11(this._arrowSize, this._scrollbarSize, this._oppositeScrollbarSize, this._visibleSize, this._scrollSize, this._scrollPosition);
  }
  setVisibleSize(t) {
    let e = Math.round(t);
    return this._visibleSize !== e ? (this._visibleSize = e, this._refreshComputedValues(), true) : false;
  }
  setScrollSize(t) {
    let e = Math.round(t);
    return this._scrollSize !== e ? (this._scrollSize = e, this._refreshComputedValues(), true) : false;
  }
  setScrollPosition(t) {
    let e = Math.round(t);
    return this._scrollPosition !== e ? (this._scrollPosition = e, this._refreshComputedValues(), true) : false;
  }
  setScrollbarSize(t) {
    this._scrollbarSize = Math.round(t);
  }
  setOppositeScrollbarSize(t) {
    this._oppositeScrollbarSize = Math.round(t);
  }
  static _computeValues(t, e, i, r, n) {
    let o2 = Math.max(0, i - t), l = Math.max(0, o2 - 2 * e), a = r > 0 && r > i;
    if (!a) return { computedAvailableSize: Math.round(o2), computedIsNeeded: a, computedSliderSize: Math.round(l), computedSliderRatio: 0, computedSliderPosition: 0 };
    let u = Math.round(Math.max(20, Math.floor(i * l / r))), h2 = (l - u) / (r - i), c = n * h2;
    return { computedAvailableSize: Math.round(o2), computedIsNeeded: a, computedSliderSize: Math.round(u), computedSliderRatio: h2, computedSliderPosition: Math.round(c) };
  }
  _refreshComputedValues() {
    let t = s11._computeValues(this._oppositeScrollbarSize, this._arrowSize, this._visibleSize, this._scrollSize, this._scrollPosition);
    this._computedAvailableSize = t.computedAvailableSize, this._computedIsNeeded = t.computedIsNeeded, this._computedSliderSize = t.computedSliderSize, this._computedSliderRatio = t.computedSliderRatio, this._computedSliderPosition = t.computedSliderPosition;
  }
  getArrowSize() {
    return this._arrowSize;
  }
  getScrollPosition() {
    return this._scrollPosition;
  }
  getRectangleLargeSize() {
    return this._computedAvailableSize;
  }
  getRectangleSmallSize() {
    return this._scrollbarSize;
  }
  isNeeded() {
    return this._computedIsNeeded;
  }
  getSliderSize() {
    return this._computedSliderSize;
  }
  getSliderPosition() {
    return this._computedSliderPosition;
  }
  getDesiredScrollPositionFromOffset(t) {
    if (!this._computedIsNeeded) return 0;
    let e = t - this._arrowSize - this._computedSliderSize / 2;
    return Math.round(e / this._computedSliderRatio);
  }
  getDesiredScrollPositionFromOffsetPaged(t) {
    if (!this._computedIsNeeded) return 0;
    let e = t - this._arrowSize, i = this._scrollPosition;
    return e < this._computedSliderPosition ? i -= this._visibleSize : i += this._visibleSize, i;
  }
  getDesiredScrollPositionFromDelta(t) {
    if (!this._computedIsNeeded) return 0;
    let e = this._computedSliderPosition + t;
    return Math.round(e / this._computedSliderRatio);
  }
};
var Wr = class extends Ut {
  constructor(t, e, i) {
    let r = t.getScrollDimensions(), n = t.getCurrentScrollPosition();
    if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.horizontalHasArrows ? e.arrowSize : 0, e.horizontal === 2 ? 0 : e.horizontalScrollbarSize, e.vertical === 2 ? 0 : e.verticalScrollbarSize, r.width, r.scrollWidth, n.scrollLeft), visibility: e.horizontal, extraScrollbarClassName: "horizontal", scrollable: t, scrollByPage: e.scrollByPage }), e.horizontalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
    this._createSlider(Math.floor((e.horizontalScrollbarSize - e.horizontalSliderSize) / 2), 0, void 0, e.horizontalSliderSize);
  }
  _updateSlider(t, e) {
    this.slider.setWidth(t), this.slider.setLeft(e);
  }
  _renderDomNode(t, e) {
    this.domNode.setWidth(t), this.domNode.setHeight(e), this.domNode.setLeft(0), this.domNode.setBottom(0);
  }
  onDidScroll(t) {
    return this._shouldRender = this._onElementScrollSize(t.scrollWidth) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t.scrollLeft) || this._shouldRender, this._shouldRender = this._onElementSize(t.width) || this._shouldRender, this._shouldRender;
  }
  _pointerDownRelativePosition(t, e) {
    return t;
  }
  _sliderPointerPosition(t) {
    return t.pageX;
  }
  _sliderOrthogonalPointerPosition(t) {
    return t.pageY;
  }
  _updateScrollbarSize(t) {
    this.slider.setHeight(t);
  }
  writeScrollPosition(t, e) {
    t.scrollLeft = e;
  }
  updateOptions(t) {
    this.updateScrollbarSize(t.horizontal === 2 ? 0 : t.horizontalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(t.vertical === 2 ? 0 : t.verticalScrollbarSize), this._visibilityController.setVisibility(t.horizontal), this._scrollByPage = t.scrollByPage;
  }
};
var Ur = class extends Ut {
  constructor(t, e, i) {
    let r = t.getScrollDimensions(), n = t.getCurrentScrollPosition();
    if (super({ lazyRender: e.lazyRender, host: i, scrollbarState: new Kt(e.verticalHasArrows ? e.arrowSize : 0, e.vertical === 2 ? 0 : e.verticalScrollbarSize, 0, r.height, r.scrollHeight, n.scrollTop), visibility: e.vertical, extraScrollbarClassName: "vertical", scrollable: t, scrollByPage: e.scrollByPage }), e.verticalHasArrows) throw new Error("horizontalHasArrows is not supported in xterm.js");
    this._createSlider(0, Math.floor((e.verticalScrollbarSize - e.verticalSliderSize) / 2), e.verticalSliderSize, void 0);
  }
  _updateSlider(t, e) {
    this.slider.setHeight(t), this.slider.setTop(e);
  }
  _renderDomNode(t, e) {
    this.domNode.setWidth(e), this.domNode.setHeight(t), this.domNode.setRight(0), this.domNode.setTop(0);
  }
  onDidScroll(t) {
    return this._shouldRender = this._onElementScrollSize(t.scrollHeight) || this._shouldRender, this._shouldRender = this._onElementScrollPosition(t.scrollTop) || this._shouldRender, this._shouldRender = this._onElementSize(t.height) || this._shouldRender, this._shouldRender;
  }
  _pointerDownRelativePosition(t, e) {
    return e;
  }
  _sliderPointerPosition(t) {
    return t.pageY;
  }
  _sliderOrthogonalPointerPosition(t) {
    return t.pageX;
  }
  _updateScrollbarSize(t) {
    this.slider.setWidth(t);
  }
  writeScrollPosition(t, e) {
    t.scrollTop = e;
  }
  updateOptions(t) {
    this.updateScrollbarSize(t.vertical === 2 ? 0 : t.verticalScrollbarSize), this._scrollbarState.setOppositeScrollbarSize(0), this._visibilityController.setVisibility(t.vertical), this._scrollByPage = t.scrollByPage;
  }
};
var Ma = 500;
var Ko = 50;
var zo = true;
var us = class {
  constructor(t, e, i) {
    this.timestamp = t, this.deltaX = e, this.deltaY = i, this.score = 0;
  }
};
var zr = class zr2 {
  constructor() {
    this._capacity = 5, this._memory = [], this._front = -1, this._rear = -1;
  }
  isPhysicalMouseWheel() {
    if (this._front === -1 && this._rear === -1) return false;
    let t = 1, e = 0, i = 1, r = this._rear;
    do {
      let n = r === this._front ? t : Math.pow(2, -i);
      if (t -= n, e += this._memory[r].score * n, r === this._front) break;
      r = (this._capacity + r - 1) % this._capacity, i++;
    } while (true);
    return e <= 0.5;
  }
  acceptStandardWheelEvent(t) {
    if (Ti) {
      let e = be(t.browserEvent), i = mo(e);
      this.accept(Date.now(), t.deltaX * i, t.deltaY * i);
    } else this.accept(Date.now(), t.deltaX, t.deltaY);
  }
  accept(t, e, i) {
    let r = null, n = new us(t, e, i);
    this._front === -1 && this._rear === -1 ? (this._memory[0] = n, this._front = 0, this._rear = 0) : (r = this._memory[this._rear], this._rear = (this._rear + 1) % this._capacity, this._rear === this._front && (this._front = (this._front + 1) % this._capacity), this._memory[this._rear] = n), n.score = this._computeScore(n, r);
  }
  _computeScore(t, e) {
    if (Math.abs(t.deltaX) > 0 && Math.abs(t.deltaY) > 0) return 1;
    let i = 0.5;
    if ((!this._isAlmostInt(t.deltaX) || !this._isAlmostInt(t.deltaY)) && (i += 0.25), e) {
      let r = Math.abs(t.deltaX), n = Math.abs(t.deltaY), o2 = Math.abs(e.deltaX), l = Math.abs(e.deltaY), a = Math.max(Math.min(r, o2), 1), u = Math.max(Math.min(n, l), 1), h2 = Math.max(r, o2), c = Math.max(n, l);
      h2 % a === 0 && c % u === 0 && (i -= 0.5);
    }
    return Math.min(Math.max(i, 0), 1);
  }
  _isAlmostInt(t) {
    return Math.abs(Math.round(t) - t) < 0.01;
  }
};
zr.INSTANCE = new zr();
var hs = zr;
var ds = class extends lt {
  constructor(e, i, r) {
    super();
    this._onScroll = this._register(new v());
    this.onScroll = this._onScroll.event;
    this._onWillScroll = this._register(new v());
    this.onWillScroll = this._onWillScroll.event;
    this._options = Pa(i), this._scrollable = r, this._register(this._scrollable.onScroll((o2) => {
      this._onWillScroll.fire(o2), this._onDidScroll(o2), this._onScroll.fire(o2);
    }));
    let n = { onMouseWheel: (o2) => this._onMouseWheel(o2), onDragStart: () => this._onDragStart(), onDragEnd: () => this._onDragEnd() };
    this._verticalScrollbar = this._register(new Ur(this._scrollable, this._options, n)), this._horizontalScrollbar = this._register(new Wr(this._scrollable, this._options, n)), this._domNode = document.createElement("div"), this._domNode.className = "xterm-scrollable-element " + this._options.className, this._domNode.setAttribute("role", "presentation"), this._domNode.style.position = "relative", this._domNode.appendChild(e), this._domNode.appendChild(this._horizontalScrollbar.domNode.domNode), this._domNode.appendChild(this._verticalScrollbar.domNode.domNode), this._options.useShadows ? (this._leftShadowDomNode = _t(document.createElement("div")), this._leftShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._leftShadowDomNode.domNode), this._topShadowDomNode = _t(document.createElement("div")), this._topShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._topShadowDomNode.domNode), this._topLeftShadowDomNode = _t(document.createElement("div")), this._topLeftShadowDomNode.setClassName("shadow"), this._domNode.appendChild(this._topLeftShadowDomNode.domNode)) : (this._leftShadowDomNode = null, this._topShadowDomNode = null, this._topLeftShadowDomNode = null), this._listenOnDomNode = this._options.listenOnDomNode || this._domNode, this._mouseWheelToDispose = [], this._setListeningToMouseWheel(this._options.handleMouseWheel), this.onmouseover(this._listenOnDomNode, (o2) => this._onMouseOver(o2)), this.onmouseleave(this._listenOnDomNode, (o2) => this._onMouseLeave(o2)), this._hideTimeout = this._register(new Ye()), this._isDragging = false, this._mouseIsOver = false, this._shouldRender = true, this._revealOnScroll = true;
  }
  get options() {
    return this._options;
  }
  dispose() {
    this._mouseWheelToDispose = Ne(this._mouseWheelToDispose), super.dispose();
  }
  getDomNode() {
    return this._domNode;
  }
  getOverviewRulerLayoutInfo() {
    return { parent: this._domNode, insertBefore: this._verticalScrollbar.domNode.domNode };
  }
  delegateVerticalScrollbarPointerDown(e) {
    this._verticalScrollbar.delegatePointerDown(e);
  }
  getScrollDimensions() {
    return this._scrollable.getScrollDimensions();
  }
  setScrollDimensions(e) {
    this._scrollable.setScrollDimensions(e, false);
  }
  updateClassName(e) {
    this._options.className = e, Te && (this._options.className += " mac"), this._domNode.className = "xterm-scrollable-element " + this._options.className;
  }
  updateOptions(e) {
    typeof e.handleMouseWheel < "u" && (this._options.handleMouseWheel = e.handleMouseWheel, this._setListeningToMouseWheel(this._options.handleMouseWheel)), typeof e.mouseWheelScrollSensitivity < "u" && (this._options.mouseWheelScrollSensitivity = e.mouseWheelScrollSensitivity), typeof e.fastScrollSensitivity < "u" && (this._options.fastScrollSensitivity = e.fastScrollSensitivity), typeof e.scrollPredominantAxis < "u" && (this._options.scrollPredominantAxis = e.scrollPredominantAxis), typeof e.horizontal < "u" && (this._options.horizontal = e.horizontal), typeof e.vertical < "u" && (this._options.vertical = e.vertical), typeof e.horizontalScrollbarSize < "u" && (this._options.horizontalScrollbarSize = e.horizontalScrollbarSize), typeof e.verticalScrollbarSize < "u" && (this._options.verticalScrollbarSize = e.verticalScrollbarSize), typeof e.scrollByPage < "u" && (this._options.scrollByPage = e.scrollByPage), this._horizontalScrollbar.updateOptions(this._options), this._verticalScrollbar.updateOptions(this._options), this._options.lazyRender || this._render();
  }
  setRevealOnScroll(e) {
    this._revealOnScroll = e;
  }
  delegateScrollFromMouseWheelEvent(e) {
    this._onMouseWheel(new xi(e));
  }
  _setListeningToMouseWheel(e) {
    if (this._mouseWheelToDispose.length > 0 !== e && (this._mouseWheelToDispose = Ne(this._mouseWheelToDispose), e)) {
      let r = (n) => {
        this._onMouseWheel(new xi(n));
      };
      this._mouseWheelToDispose.push(L(this._listenOnDomNode, Y.MOUSE_WHEEL, r, { passive: false }));
    }
  }
  _onMouseWheel(e) {
    if (e.browserEvent?.defaultPrevented) return;
    let i = hs.INSTANCE;
    zo && i.acceptStandardWheelEvent(e);
    let r = false;
    if (e.deltaY || e.deltaX) {
      let o2 = e.deltaY * this._options.mouseWheelScrollSensitivity, l = e.deltaX * this._options.mouseWheelScrollSensitivity;
      this._options.scrollPredominantAxis && (this._options.scrollYToX && l + o2 === 0 ? l = o2 = 0 : Math.abs(o2) >= Math.abs(l) ? l = 0 : o2 = 0), this._options.flipAxes && ([o2, l] = [l, o2]);
      let a = !Te && e.browserEvent && e.browserEvent.shiftKey;
      (this._options.scrollYToX || a) && !l && (l = o2, o2 = 0), e.browserEvent && e.browserEvent.altKey && (l = l * this._options.fastScrollSensitivity, o2 = o2 * this._options.fastScrollSensitivity);
      let u = this._scrollable.getFutureScrollPosition(), h2 = {};
      if (o2) {
        let c = Ko * o2, d = u.scrollTop - (c < 0 ? Math.floor(c) : Math.ceil(c));
        this._verticalScrollbar.writeScrollPosition(h2, d);
      }
      if (l) {
        let c = Ko * l, d = u.scrollLeft - (c < 0 ? Math.floor(c) : Math.ceil(c));
        this._horizontalScrollbar.writeScrollPosition(h2, d);
      }
      h2 = this._scrollable.validateScrollPosition(h2), (u.scrollLeft !== h2.scrollLeft || u.scrollTop !== h2.scrollTop) && (zo && this._options.mouseWheelSmoothScroll && i.isPhysicalMouseWheel() ? this._scrollable.setScrollPositionSmooth(h2) : this._scrollable.setScrollPositionNow(h2), r = true);
    }
    let n = r;
    !n && this._options.alwaysConsumeMouseWheel && (n = true), !n && this._options.consumeMouseWheelIfScrollbarIsNeeded && (this._verticalScrollbar.isNeeded() || this._horizontalScrollbar.isNeeded()) && (n = true), n && (e.preventDefault(), e.stopPropagation());
  }
  _onDidScroll(e) {
    this._shouldRender = this._horizontalScrollbar.onDidScroll(e) || this._shouldRender, this._shouldRender = this._verticalScrollbar.onDidScroll(e) || this._shouldRender, this._options.useShadows && (this._shouldRender = true), this._revealOnScroll && this._reveal(), this._options.lazyRender || this._render();
  }
  renderNow() {
    if (!this._options.lazyRender) throw new Error("Please use `lazyRender` together with `renderNow`!");
    this._render();
  }
  _render() {
    if (this._shouldRender && (this._shouldRender = false, this._horizontalScrollbar.render(), this._verticalScrollbar.render(), this._options.useShadows)) {
      let e = this._scrollable.getCurrentScrollPosition(), i = e.scrollTop > 0, r = e.scrollLeft > 0, n = r ? " left" : "", o2 = i ? " top" : "", l = r || i ? " top-left-corner" : "";
      this._leftShadowDomNode.setClassName(`shadow${n}`), this._topShadowDomNode.setClassName(`shadow${o2}`), this._topLeftShadowDomNode.setClassName(`shadow${l}${o2}${n}`);
    }
  }
  _onDragStart() {
    this._isDragging = true, this._reveal();
  }
  _onDragEnd() {
    this._isDragging = false, this._hide();
  }
  _onMouseLeave(e) {
    this._mouseIsOver = false, this._hide();
  }
  _onMouseOver(e) {
    this._mouseIsOver = true, this._reveal();
  }
  _reveal() {
    this._verticalScrollbar.beginReveal(), this._horizontalScrollbar.beginReveal(), this._scheduleHide();
  }
  _hide() {
    !this._mouseIsOver && !this._isDragging && (this._verticalScrollbar.beginHide(), this._horizontalScrollbar.beginHide());
  }
  _scheduleHide() {
    !this._mouseIsOver && !this._isDragging && this._hideTimeout.cancelAndSet(() => this._hide(), Ma);
  }
};
var Kr = class extends ds {
  constructor(t, e, i) {
    super(t, e, i);
  }
  setScrollPosition(t) {
    t.reuseAnimation ? this._scrollable.setScrollPositionSmooth(t, t.reuseAnimation) : this._scrollable.setScrollPositionNow(t);
  }
  getScrollPosition() {
    return this._scrollable.getCurrentScrollPosition();
  }
};
function Pa(s15) {
  let t = { lazyRender: typeof s15.lazyRender < "u" ? s15.lazyRender : false, className: typeof s15.className < "u" ? s15.className : "", useShadows: typeof s15.useShadows < "u" ? s15.useShadows : true, handleMouseWheel: typeof s15.handleMouseWheel < "u" ? s15.handleMouseWheel : true, flipAxes: typeof s15.flipAxes < "u" ? s15.flipAxes : false, consumeMouseWheelIfScrollbarIsNeeded: typeof s15.consumeMouseWheelIfScrollbarIsNeeded < "u" ? s15.consumeMouseWheelIfScrollbarIsNeeded : false, alwaysConsumeMouseWheel: typeof s15.alwaysConsumeMouseWheel < "u" ? s15.alwaysConsumeMouseWheel : false, scrollYToX: typeof s15.scrollYToX < "u" ? s15.scrollYToX : false, mouseWheelScrollSensitivity: typeof s15.mouseWheelScrollSensitivity < "u" ? s15.mouseWheelScrollSensitivity : 1, fastScrollSensitivity: typeof s15.fastScrollSensitivity < "u" ? s15.fastScrollSensitivity : 5, scrollPredominantAxis: typeof s15.scrollPredominantAxis < "u" ? s15.scrollPredominantAxis : true, mouseWheelSmoothScroll: typeof s15.mouseWheelSmoothScroll < "u" ? s15.mouseWheelSmoothScroll : true, arrowSize: typeof s15.arrowSize < "u" ? s15.arrowSize : 11, listenOnDomNode: typeof s15.listenOnDomNode < "u" ? s15.listenOnDomNode : null, horizontal: typeof s15.horizontal < "u" ? s15.horizontal : 1, horizontalScrollbarSize: typeof s15.horizontalScrollbarSize < "u" ? s15.horizontalScrollbarSize : 10, horizontalSliderSize: typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : 0, horizontalHasArrows: typeof s15.horizontalHasArrows < "u" ? s15.horizontalHasArrows : false, vertical: typeof s15.vertical < "u" ? s15.vertical : 1, verticalScrollbarSize: typeof s15.verticalScrollbarSize < "u" ? s15.verticalScrollbarSize : 10, verticalHasArrows: typeof s15.verticalHasArrows < "u" ? s15.verticalHasArrows : false, verticalSliderSize: typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : 0, scrollByPage: typeof s15.scrollByPage < "u" ? s15.scrollByPage : false };
  return t.horizontalSliderSize = typeof s15.horizontalSliderSize < "u" ? s15.horizontalSliderSize : t.horizontalScrollbarSize, t.verticalSliderSize = typeof s15.verticalSliderSize < "u" ? s15.verticalSliderSize : t.verticalScrollbarSize, Te && (t.className += " mac"), t;
}
var zt = class extends D {
  constructor(e, i, r, n, o2, l, a, u) {
    super();
    this._bufferService = r;
    this._optionsService = a;
    this._renderService = u;
    this._onRequestScrollLines = this._register(new v());
    this.onRequestScrollLines = this._onRequestScrollLines.event;
    this._isSyncing = false;
    this._isHandlingScroll = false;
    this._suppressOnScrollHandler = false;
    let h2 = this._register(new Ri({ forceIntegerValues: false, smoothScrollDuration: this._optionsService.rawOptions.smoothScrollDuration, scheduleAtNextAnimationFrame: (c) => mt(n.window, c) }));
    this._register(this._optionsService.onSpecificOptionChange("smoothScrollDuration", () => {
      h2.setSmoothScrollDuration(this._optionsService.rawOptions.smoothScrollDuration);
    })), this._scrollableElement = this._register(new Kr(i, { vertical: 1, horizontal: 2, useShadows: false, mouseWheelSmoothScroll: true, ...this._getChangeOptions() }, h2)), this._register(this._optionsService.onMultipleOptionChange(["scrollSensitivity", "fastScrollSensitivity", "overviewRuler"], () => this._scrollableElement.updateOptions(this._getChangeOptions()))), this._register(o2.onProtocolChange((c) => {
      this._scrollableElement.updateOptions({ handleMouseWheel: !(c & 16) });
    })), this._scrollableElement.setScrollDimensions({ height: 0, scrollHeight: 0 }), this._register($.runAndSubscribe(l.onChangeColors, () => {
      this._scrollableElement.getDomNode().style.backgroundColor = l.colors.background.css;
    })), e.appendChild(this._scrollableElement.getDomNode()), this._register(C(() => this._scrollableElement.getDomNode().remove())), this._styleElement = n.mainDocument.createElement("style"), i.appendChild(this._styleElement), this._register(C(() => this._styleElement.remove())), this._register($.runAndSubscribe(l.onChangeColors, () => {
      this._styleElement.textContent = [".xterm .xterm-scrollable-element > .scrollbar > .slider {", `  background: ${l.colors.scrollbarSliderBackground.css};`, "}", ".xterm .xterm-scrollable-element > .scrollbar > .slider:hover {", `  background: ${l.colors.scrollbarSliderHoverBackground.css};`, "}", ".xterm .xterm-scrollable-element > .scrollbar > .slider.active {", `  background: ${l.colors.scrollbarSliderActiveBackground.css};`, "}"].join(`
`);
    })), this._register(this._bufferService.onResize(() => this.queueSync())), this._register(this._bufferService.buffers.onBufferActivate(() => {
      this._latestYDisp = void 0, this.queueSync();
    })), this._register(this._bufferService.onScroll(() => this._sync())), this._register(this._scrollableElement.onScroll((c) => this._handleScroll(c)));
  }
  scrollLines(e) {
    let i = this._scrollableElement.getScrollPosition();
    this._scrollableElement.setScrollPosition({ reuseAnimation: true, scrollTop: i.scrollTop + e * this._renderService.dimensions.css.cell.height });
  }
  scrollToLine(e, i) {
    i && (this._latestYDisp = e), this._scrollableElement.setScrollPosition({ reuseAnimation: !i, scrollTop: e * this._renderService.dimensions.css.cell.height });
  }
  _getChangeOptions() {
    return { mouseWheelScrollSensitivity: this._optionsService.rawOptions.scrollSensitivity, fastScrollSensitivity: this._optionsService.rawOptions.fastScrollSensitivity, verticalScrollbarSize: this._optionsService.rawOptions.overviewRuler?.width || 14 };
  }
  queueSync(e) {
    e !== void 0 && (this._latestYDisp = e), this._queuedAnimationFrame === void 0 && (this._queuedAnimationFrame = this._renderService.addRefreshCallback(() => {
      this._queuedAnimationFrame = void 0, this._sync(this._latestYDisp);
    }));
  }
  _sync(e = this._bufferService.buffer.ydisp) {
    !this._renderService || this._isSyncing || (this._isSyncing = true, this._suppressOnScrollHandler = true, this._scrollableElement.setScrollDimensions({ height: this._renderService.dimensions.css.canvas.height, scrollHeight: this._renderService.dimensions.css.cell.height * this._bufferService.buffer.lines.length }), this._suppressOnScrollHandler = false, e !== this._latestYDisp && this._scrollableElement.setScrollPosition({ scrollTop: e * this._renderService.dimensions.css.cell.height }), this._isSyncing = false);
  }
  _handleScroll(e) {
    if (!this._renderService || this._isHandlingScroll || this._suppressOnScrollHandler) return;
    this._isHandlingScroll = true;
    let i = Math.round(e.scrollTop / this._renderService.dimensions.css.cell.height), r = i - this._bufferService.buffer.ydisp;
    r !== 0 && (this._latestYDisp = i, this._onRequestScrollLines.fire(r)), this._isHandlingScroll = false;
  }
};
zt = M([S(2, F), S(3, ae), S(4, rr), S(5, Re), S(6, H), S(7, ce)], zt);
var Gt = class extends D {
  constructor(e, i, r, n, o2) {
    super();
    this._screenElement = e;
    this._bufferService = i;
    this._coreBrowserService = r;
    this._decorationService = n;
    this._renderService = o2;
    this._decorationElements = /* @__PURE__ */ new Map();
    this._altBufferIsActive = false;
    this._dimensionsChanged = false;
    this._container = document.createElement("div"), this._container.classList.add("xterm-decoration-container"), this._screenElement.appendChild(this._container), this._register(this._renderService.onRenderedViewportChange(() => this._doRefreshDecorations())), this._register(this._renderService.onDimensionsChange(() => {
      this._dimensionsChanged = true, this._queueRefresh();
    })), this._register(this._coreBrowserService.onDprChange(() => this._queueRefresh())), this._register(this._bufferService.buffers.onBufferActivate(() => {
      this._altBufferIsActive = this._bufferService.buffer === this._bufferService.buffers.alt;
    })), this._register(this._decorationService.onDecorationRegistered(() => this._queueRefresh())), this._register(this._decorationService.onDecorationRemoved((l) => this._removeDecoration(l))), this._register(C(() => {
      this._container.remove(), this._decorationElements.clear();
    }));
  }
  _queueRefresh() {
    this._animationFrame === void 0 && (this._animationFrame = this._renderService.addRefreshCallback(() => {
      this._doRefreshDecorations(), this._animationFrame = void 0;
    }));
  }
  _doRefreshDecorations() {
    for (let e of this._decorationService.decorations) this._renderDecoration(e);
    this._dimensionsChanged = false;
  }
  _renderDecoration(e) {
    this._refreshStyle(e), this._dimensionsChanged && this._refreshXPosition(e);
  }
  _createElement(e) {
    let i = this._coreBrowserService.mainDocument.createElement("div");
    i.classList.add("xterm-decoration"), i.classList.toggle("xterm-decoration-top-layer", e?.options?.layer === "top"), i.style.width = `${Math.round((e.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, i.style.height = `${(e.options.height || 1) * this._renderService.dimensions.css.cell.height}px`, i.style.top = `${(e.marker.line - this._bufferService.buffers.active.ydisp) * this._renderService.dimensions.css.cell.height}px`, i.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`;
    let r = e.options.x ?? 0;
    return r && r > this._bufferService.cols && (i.style.display = "none"), this._refreshXPosition(e, i), i;
  }
  _refreshStyle(e) {
    let i = e.marker.line - this._bufferService.buffers.active.ydisp;
    if (i < 0 || i >= this._bufferService.rows) e.element && (e.element.style.display = "none", e.onRenderEmitter.fire(e.element));
    else {
      let r = this._decorationElements.get(e);
      r || (r = this._createElement(e), e.element = r, this._decorationElements.set(e, r), this._container.appendChild(r), e.onDispose(() => {
        this._decorationElements.delete(e), r.remove();
      })), r.style.display = this._altBufferIsActive ? "none" : "block", this._altBufferIsActive || (r.style.width = `${Math.round((e.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, r.style.height = `${(e.options.height || 1) * this._renderService.dimensions.css.cell.height}px`, r.style.top = `${i * this._renderService.dimensions.css.cell.height}px`, r.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`), e.onRenderEmitter.fire(r);
    }
  }
  _refreshXPosition(e, i = e.element) {
    if (!i) return;
    let r = e.options.x ?? 0;
    (e.options.anchor || "left") === "right" ? i.style.right = r ? `${r * this._renderService.dimensions.css.cell.width}px` : "" : i.style.left = r ? `${r * this._renderService.dimensions.css.cell.width}px` : "";
  }
  _removeDecoration(e) {
    this._decorationElements.get(e)?.remove(), this._decorationElements.delete(e), e.dispose();
  }
};
Gt = M([S(1, F), S(2, ae), S(3, Be), S(4, ce)], Gt);
var Gr = class {
  constructor() {
    this._zones = [];
    this._zonePool = [];
    this._zonePoolIndex = 0;
    this._linePadding = { full: 0, left: 0, center: 0, right: 0 };
  }
  get zones() {
    return this._zonePool.length = Math.min(this._zonePool.length, this._zones.length), this._zones;
  }
  clear() {
    this._zones.length = 0, this._zonePoolIndex = 0;
  }
  addDecoration(t) {
    if (t.options.overviewRulerOptions) {
      for (let e of this._zones) if (e.color === t.options.overviewRulerOptions.color && e.position === t.options.overviewRulerOptions.position) {
        if (this._lineIntersectsZone(e, t.marker.line)) return;
        if (this._lineAdjacentToZone(e, t.marker.line, t.options.overviewRulerOptions.position)) {
          this._addLineToZone(e, t.marker.line);
          return;
        }
      }
      if (this._zonePoolIndex < this._zonePool.length) {
        this._zonePool[this._zonePoolIndex].color = t.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = t.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = t.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = t.marker.line, this._zones.push(this._zonePool[this._zonePoolIndex++]);
        return;
      }
      this._zones.push({ color: t.options.overviewRulerOptions.color, position: t.options.overviewRulerOptions.position, startBufferLine: t.marker.line, endBufferLine: t.marker.line }), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
    }
  }
  setPadding(t) {
    this._linePadding = t;
  }
  _lineIntersectsZone(t, e) {
    return e >= t.startBufferLine && e <= t.endBufferLine;
  }
  _lineAdjacentToZone(t, e, i) {
    return e >= t.startBufferLine - this._linePadding[i || "full"] && e <= t.endBufferLine + this._linePadding[i || "full"];
  }
  _addLineToZone(t, e) {
    t.startBufferLine = Math.min(t.startBufferLine, e), t.endBufferLine = Math.max(t.endBufferLine, e);
  }
};
var We = { full: 0, left: 0, center: 0, right: 0 };
var at = { full: 0, left: 0, center: 0, right: 0 };
var Li = { full: 0, left: 0, center: 0, right: 0 };
var bt = class extends D {
  constructor(e, i, r, n, o2, l, a, u) {
    super();
    this._viewportElement = e;
    this._screenElement = i;
    this._bufferService = r;
    this._decorationService = n;
    this._renderService = o2;
    this._optionsService = l;
    this._themeService = a;
    this._coreBrowserService = u;
    this._colorZoneStore = new Gr();
    this._shouldUpdateDimensions = true;
    this._shouldUpdateAnchor = true;
    this._lastKnownBufferLength = 0;
    this._canvas = this._coreBrowserService.mainDocument.createElement("canvas"), this._canvas.classList.add("xterm-decoration-overview-ruler"), this._refreshCanvasDimensions(), this._viewportElement.parentElement?.insertBefore(this._canvas, this._viewportElement), this._register(C(() => this._canvas?.remove()));
    let h2 = this._canvas.getContext("2d");
    if (h2) this._ctx = h2;
    else throw new Error("Ctx cannot be null");
    this._register(this._decorationService.onDecorationRegistered(() => this._queueRefresh(void 0, true))), this._register(this._decorationService.onDecorationRemoved(() => this._queueRefresh(void 0, true))), this._register(this._renderService.onRenderedViewportChange(() => this._queueRefresh())), this._register(this._bufferService.buffers.onBufferActivate(() => {
      this._canvas.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? "none" : "block";
    })), this._register(this._bufferService.onScroll(() => {
      this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length && (this._refreshDrawHeightConstants(), this._refreshColorZonePadding());
    })), this._register(this._renderService.onRender(() => {
      (!this._containerHeight || this._containerHeight !== this._screenElement.clientHeight) && (this._queueRefresh(true), this._containerHeight = this._screenElement.clientHeight);
    })), this._register(this._coreBrowserService.onDprChange(() => this._queueRefresh(true))), this._register(this._optionsService.onSpecificOptionChange("overviewRuler", () => this._queueRefresh(true))), this._register(this._themeService.onChangeColors(() => this._queueRefresh())), this._queueRefresh(true);
  }
  get _width() {
    return this._optionsService.options.overviewRuler?.width || 0;
  }
  _refreshDrawConstants() {
    let e = Math.floor((this._canvas.width - 1) / 3), i = Math.ceil((this._canvas.width - 1) / 3);
    at.full = this._canvas.width, at.left = e, at.center = i, at.right = e, this._refreshDrawHeightConstants(), Li.full = 1, Li.left = 1, Li.center = 1 + at.left, Li.right = 1 + at.left + at.center;
  }
  _refreshDrawHeightConstants() {
    We.full = Math.round(2 * this._coreBrowserService.dpr);
    let e = this._canvas.height / this._bufferService.buffer.lines.length, i = Math.round(Math.max(Math.min(e, 12), 6) * this._coreBrowserService.dpr);
    We.left = i, We.center = i, We.right = i;
  }
  _refreshColorZonePadding() {
    this._colorZoneStore.setPadding({ full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.full), left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.left), center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.center), right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * We.right) }), this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
  }
  _refreshCanvasDimensions() {
    this._canvas.style.width = `${this._width}px`, this._canvas.width = Math.round(this._width * this._coreBrowserService.dpr), this._canvas.style.height = `${this._screenElement.clientHeight}px`, this._canvas.height = Math.round(this._screenElement.clientHeight * this._coreBrowserService.dpr), this._refreshDrawConstants(), this._refreshColorZonePadding();
  }
  _refreshDecorations() {
    this._shouldUpdateDimensions && this._refreshCanvasDimensions(), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height), this._colorZoneStore.clear();
    for (let i of this._decorationService.decorations) this._colorZoneStore.addDecoration(i);
    this._ctx.lineWidth = 1, this._renderRulerOutline();
    let e = this._colorZoneStore.zones;
    for (let i of e) i.position !== "full" && this._renderColorZone(i);
    for (let i of e) i.position === "full" && this._renderColorZone(i);
    this._shouldUpdateDimensions = false, this._shouldUpdateAnchor = false;
  }
  _renderRulerOutline() {
    this._ctx.fillStyle = this._themeService.colors.overviewRulerBorder.css, this._ctx.fillRect(0, 0, 1, this._canvas.height), this._optionsService.rawOptions.overviewRuler.showTopBorder && this._ctx.fillRect(1, 0, this._canvas.width - 1, 1), this._optionsService.rawOptions.overviewRuler.showBottomBorder && this._ctx.fillRect(1, this._canvas.height - 1, this._canvas.width - 1, this._canvas.height);
  }
  _renderColorZone(e) {
    this._ctx.fillStyle = e.color, this._ctx.fillRect(Li[e.position || "full"], Math.round((this._canvas.height - 1) * (e.startBufferLine / this._bufferService.buffers.active.lines.length) - We[e.position || "full"] / 2), at[e.position || "full"], Math.round((this._canvas.height - 1) * ((e.endBufferLine - e.startBufferLine) / this._bufferService.buffers.active.lines.length) + We[e.position || "full"]));
  }
  _queueRefresh(e, i) {
    this._shouldUpdateDimensions = e || this._shouldUpdateDimensions, this._shouldUpdateAnchor = i || this._shouldUpdateAnchor, this._animationFrame === void 0 && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => {
      this._refreshDecorations(), this._animationFrame = void 0;
    }));
  }
};
bt = M([S(2, F), S(3, Be), S(4, ce), S(5, H), S(6, Re), S(7, ae)], bt);
var b;
((E) => (E.NUL = "\0", E.SOH = "", E.STX = "", E.ETX = "", E.EOT = "", E.ENQ = "", E.ACK = "", E.BEL = "\x07", E.BS = "\b", E.HT = "	", E.LF = `
`, E.VT = "\v", E.FF = "\f", E.CR = "\r", E.SO = "", E.SI = "", E.DLE = "", E.DC1 = "", E.DC2 = "", E.DC3 = "", E.DC4 = "", E.NAK = "", E.SYN = "", E.ETB = "", E.CAN = "", E.EM = "", E.SUB = "", E.ESC = "\x1B", E.FS = "", E.GS = "", E.RS = "", E.US = "", E.SP = " ", E.DEL = "\x7F"))(b || (b = {}));
var Ai;
((g) => (g.PAD = "\x80", g.HOP = "\x81", g.BPH = "\x82", g.NBH = "\x83", g.IND = "\x84", g.NEL = "\x85", g.SSA = "\x86", g.ESA = "\x87", g.HTS = "\x88", g.HTJ = "\x89", g.VTS = "\x8A", g.PLD = "\x8B", g.PLU = "\x8C", g.RI = "\x8D", g.SS2 = "\x8E", g.SS3 = "\x8F", g.DCS = "\x90", g.PU1 = "\x91", g.PU2 = "\x92", g.STS = "\x93", g.CCH = "\x94", g.MW = "\x95", g.SPA = "\x96", g.EPA = "\x97", g.SOS = "\x98", g.SGCI = "\x99", g.SCI = "\x9A", g.CSI = "\x9B", g.ST = "\x9C", g.OSC = "\x9D", g.PM = "\x9E", g.APC = "\x9F"))(Ai || (Ai = {}));
var fs;
((t) => t.ST = `${b.ESC}\\`)(fs || (fs = {}));
var $t = class {
  constructor(t, e, i, r, n, o2) {
    this._textarea = t;
    this._compositionView = e;
    this._bufferService = i;
    this._optionsService = r;
    this._coreService = n;
    this._renderService = o2;
    this._isComposing = false, this._isSendingComposition = false, this._compositionPosition = { start: 0, end: 0 }, this._dataAlreadySent = "";
  }
  get isComposing() {
    return this._isComposing;
  }
  compositionstart() {
    this._isComposing = true, this._compositionPosition.start = this._textarea.value.length, this._compositionView.textContent = "", this._dataAlreadySent = "", this._compositionView.classList.add("active");
  }
  compositionupdate(t) {
    this._compositionView.textContent = t.data, this.updateCompositionElements(), setTimeout(() => {
      this._compositionPosition.end = this._textarea.value.length;
    }, 0);
  }
  compositionend() {
    this._finalizeComposition(true);
  }
  keydown(t) {
    if (this._isComposing || this._isSendingComposition) {
      if (t.keyCode === 20 || t.keyCode === 229 || t.keyCode === 16 || t.keyCode === 17 || t.keyCode === 18) return false;
      this._finalizeComposition(false);
    }
    return t.keyCode === 229 ? (this._handleAnyTextareaChanges(), false) : true;
  }
  _finalizeComposition(t) {
    if (this._compositionView.classList.remove("active"), this._isComposing = false, t) {
      let e = { start: this._compositionPosition.start, end: this._compositionPosition.end };
      this._isSendingComposition = true, setTimeout(() => {
        if (this._isSendingComposition) {
          this._isSendingComposition = false;
          let i;
          e.start += this._dataAlreadySent.length, this._isComposing ? i = this._textarea.value.substring(e.start, this._compositionPosition.start) : i = this._textarea.value.substring(e.start), i.length > 0 && this._coreService.triggerDataEvent(i, true);
        }
      }, 0);
    } else {
      this._isSendingComposition = false;
      let e = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
      this._coreService.triggerDataEvent(e, true);
    }
  }
  _handleAnyTextareaChanges() {
    let t = this._textarea.value;
    setTimeout(() => {
      if (!this._isComposing) {
        let e = this._textarea.value, i = e.replace(t, "");
        this._dataAlreadySent = i, e.length > t.length ? this._coreService.triggerDataEvent(i, true) : e.length < t.length ? this._coreService.triggerDataEvent(`${b.DEL}`, true) : e.length === t.length && e !== t && this._coreService.triggerDataEvent(e, true);
      }
    }, 0);
  }
  updateCompositionElements(t) {
    if (this._isComposing) {
      if (this._bufferService.buffer.isCursorInViewport) {
        let e = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), i = this._renderService.dimensions.css.cell.height, r = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, n = e * this._renderService.dimensions.css.cell.width;
        this._compositionView.style.left = n + "px", this._compositionView.style.top = r + "px", this._compositionView.style.height = i + "px", this._compositionView.style.lineHeight = i + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
        let o2 = this._compositionView.getBoundingClientRect();
        this._textarea.style.left = n + "px", this._textarea.style.top = r + "px", this._textarea.style.width = Math.max(o2.width, 1) + "px", this._textarea.style.height = Math.max(o2.height, 1) + "px", this._textarea.style.lineHeight = o2.height + "px";
      }
      t || setTimeout(() => this.updateCompositionElements(true), 0);
    }
  }
};
$t = M([S(2, F), S(3, H), S(4, ge), S(5, ce)], $t);
var ue = 0;
var he = 0;
var de = 0;
var J = 0;
var ps = { css: "#00000000", rgba: 0 };
var j;
((i) => {
  function s15(r, n, o2, l) {
    return l !== void 0 ? `#${vt(r)}${vt(n)}${vt(o2)}${vt(l)}` : `#${vt(r)}${vt(n)}${vt(o2)}`;
  }
  i.toCss = s15;
  function t(r, n, o2, l = 255) {
    return (r << 24 | n << 16 | o2 << 8 | l) >>> 0;
  }
  i.toRgba = t;
  function e(r, n, o2, l) {
    return { css: i.toCss(r, n, o2, l), rgba: i.toRgba(r, n, o2, l) };
  }
  i.toColor = e;
})(j || (j = {}));
var U;
((l) => {
  function s15(a, u) {
    if (J = (u.rgba & 255) / 255, J === 1) return { css: u.css, rgba: u.rgba };
    let h2 = u.rgba >> 24 & 255, c = u.rgba >> 16 & 255, d = u.rgba >> 8 & 255, _2 = a.rgba >> 24 & 255, p = a.rgba >> 16 & 255, m = a.rgba >> 8 & 255;
    ue = _2 + Math.round((h2 - _2) * J), he = p + Math.round((c - p) * J), de = m + Math.round((d - m) * J);
    let f = j.toCss(ue, he, de), A = j.toRgba(ue, he, de);
    return { css: f, rgba: A };
  }
  l.blend = s15;
  function t(a) {
    return (a.rgba & 255) === 255;
  }
  l.isOpaque = t;
  function e(a, u, h2) {
    let c = $r.ensureContrastRatio(a.rgba, u.rgba, h2);
    if (c) return j.toColor(c >> 24 & 255, c >> 16 & 255, c >> 8 & 255);
  }
  l.ensureContrastRatio = e;
  function i(a) {
    let u = (a.rgba | 255) >>> 0;
    return [ue, he, de] = $r.toChannels(u), { css: j.toCss(ue, he, de), rgba: u };
  }
  l.opaque = i;
  function r(a, u) {
    return J = Math.round(u * 255), [ue, he, de] = $r.toChannels(a.rgba), { css: j.toCss(ue, he, de, J), rgba: j.toRgba(ue, he, de, J) };
  }
  l.opacity = r;
  function n(a, u) {
    return J = a.rgba & 255, r(a, J * u / 255);
  }
  l.multiplyOpacity = n;
  function o2(a) {
    return [a.rgba >> 24 & 255, a.rgba >> 16 & 255, a.rgba >> 8 & 255];
  }
  l.toColorRGB = o2;
})(U || (U = {}));
var z;
((i) => {
  let s15, t;
  try {
    let r = document.createElement("canvas");
    r.width = 1, r.height = 1;
    let n = r.getContext("2d", { willReadFrequently: true });
    n && (s15 = n, s15.globalCompositeOperation = "copy", t = s15.createLinearGradient(0, 0, 1, 1));
  } catch {
  }
  function e(r) {
    if (r.match(/#[\da-f]{3,8}/i)) switch (r.length) {
      case 4:
        return ue = parseInt(r.slice(1, 2).repeat(2), 16), he = parseInt(r.slice(2, 3).repeat(2), 16), de = parseInt(r.slice(3, 4).repeat(2), 16), j.toColor(ue, he, de);
      case 5:
        return ue = parseInt(r.slice(1, 2).repeat(2), 16), he = parseInt(r.slice(2, 3).repeat(2), 16), de = parseInt(r.slice(3, 4).repeat(2), 16), J = parseInt(r.slice(4, 5).repeat(2), 16), j.toColor(ue, he, de, J);
      case 7:
        return { css: r, rgba: (parseInt(r.slice(1), 16) << 8 | 255) >>> 0 };
      case 9:
        return { css: r, rgba: parseInt(r.slice(1), 16) >>> 0 };
    }
    let n = r.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);
    if (n) return ue = parseInt(n[1]), he = parseInt(n[2]), de = parseInt(n[3]), J = Math.round((n[5] === void 0 ? 1 : parseFloat(n[5])) * 255), j.toColor(ue, he, de, J);
    if (!s15 || !t) throw new Error("css.toColor: Unsupported css format");
    if (s15.fillStyle = t, s15.fillStyle = r, typeof s15.fillStyle != "string") throw new Error("css.toColor: Unsupported css format");
    if (s15.fillRect(0, 0, 1, 1), [ue, he, de, J] = s15.getImageData(0, 0, 1, 1).data, J !== 255) throw new Error("css.toColor: Unsupported css format");
    return { rgba: j.toRgba(ue, he, de, J), css: r };
  }
  i.toColor = e;
})(z || (z = {}));
var ve;
((e) => {
  function s15(i) {
    return t(i >> 16 & 255, i >> 8 & 255, i & 255);
  }
  e.relativeLuminance = s15;
  function t(i, r, n) {
    let o2 = i / 255, l = r / 255, a = n / 255, u = o2 <= 0.03928 ? o2 / 12.92 : Math.pow((o2 + 0.055) / 1.055, 2.4), h2 = l <= 0.03928 ? l / 12.92 : Math.pow((l + 0.055) / 1.055, 2.4), c = a <= 0.03928 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
    return u * 0.2126 + h2 * 0.7152 + c * 0.0722;
  }
  e.relativeLuminance2 = t;
})(ve || (ve = {}));
var $r;
((n) => {
  function s15(o2, l) {
    if (J = (l & 255) / 255, J === 1) return l;
    let a = l >> 24 & 255, u = l >> 16 & 255, h2 = l >> 8 & 255, c = o2 >> 24 & 255, d = o2 >> 16 & 255, _2 = o2 >> 8 & 255;
    return ue = c + Math.round((a - c) * J), he = d + Math.round((u - d) * J), de = _2 + Math.round((h2 - _2) * J), j.toRgba(ue, he, de);
  }
  n.blend = s15;
  function t(o2, l, a) {
    let u = ve.relativeLuminance(o2 >> 8), h2 = ve.relativeLuminance(l >> 8);
    if (Xe(u, h2) < a) {
      if (h2 < u) {
        let p = e(o2, l, a), m = Xe(u, ve.relativeLuminance(p >> 8));
        if (m < a) {
          let f = i(o2, l, a), A = Xe(u, ve.relativeLuminance(f >> 8));
          return m > A ? p : f;
        }
        return p;
      }
      let d = i(o2, l, a), _2 = Xe(u, ve.relativeLuminance(d >> 8));
      if (_2 < a) {
        let p = e(o2, l, a), m = Xe(u, ve.relativeLuminance(p >> 8));
        return _2 > m ? d : p;
      }
      return d;
    }
  }
  n.ensureContrastRatio = t;
  function e(o2, l, a) {
    let u = o2 >> 24 & 255, h2 = o2 >> 16 & 255, c = o2 >> 8 & 255, d = l >> 24 & 255, _2 = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _2, p), ve.relativeLuminance2(u, h2, c));
    for (; m < a && (d > 0 || _2 > 0 || p > 0); ) d -= Math.max(0, Math.ceil(d * 0.1)), _2 -= Math.max(0, Math.ceil(_2 * 0.1)), p -= Math.max(0, Math.ceil(p * 0.1)), m = Xe(ve.relativeLuminance2(d, _2, p), ve.relativeLuminance2(u, h2, c));
    return (d << 24 | _2 << 16 | p << 8 | 255) >>> 0;
  }
  n.reduceLuminance = e;
  function i(o2, l, a) {
    let u = o2 >> 24 & 255, h2 = o2 >> 16 & 255, c = o2 >> 8 & 255, d = l >> 24 & 255, _2 = l >> 16 & 255, p = l >> 8 & 255, m = Xe(ve.relativeLuminance2(d, _2, p), ve.relativeLuminance2(u, h2, c));
    for (; m < a && (d < 255 || _2 < 255 || p < 255); ) d = Math.min(255, d + Math.ceil((255 - d) * 0.1)), _2 = Math.min(255, _2 + Math.ceil((255 - _2) * 0.1)), p = Math.min(255, p + Math.ceil((255 - p) * 0.1)), m = Xe(ve.relativeLuminance2(d, _2, p), ve.relativeLuminance2(u, h2, c));
    return (d << 24 | _2 << 16 | p << 8 | 255) >>> 0;
  }
  n.increaseLuminance = i;
  function r(o2) {
    return [o2 >> 24 & 255, o2 >> 16 & 255, o2 >> 8 & 255, o2 & 255];
  }
  n.toChannels = r;
})($r || ($r = {}));
function vt(s15) {
  let t = s15.toString(16);
  return t.length < 2 ? "0" + t : t;
}
function Xe(s15, t) {
  return s15 < t ? (t + 0.05) / (s15 + 0.05) : (s15 + 0.05) / (t + 0.05);
}
var Vr = class extends De {
  constructor(e, i, r) {
    super();
    this.content = 0;
    this.combinedData = "";
    this.fg = e.fg, this.bg = e.bg, this.combinedData = i, this._width = r;
  }
  isCombined() {
    return 2097152;
  }
  getWidth() {
    return this._width;
  }
  getChars() {
    return this.combinedData;
  }
  getCode() {
    return 2097151;
  }
  setFromCharData(e) {
    throw new Error("not implemented");
  }
  getAsCharData() {
    return [this.fg, this.getChars(), this.getWidth(), this.getCode()];
  }
};
var ct = class {
  constructor(t) {
    this._bufferService = t;
    this._characterJoiners = [];
    this._nextCharacterJoinerId = 0;
    this._workCell = new q();
  }
  register(t) {
    let e = { id: this._nextCharacterJoinerId++, handler: t };
    return this._characterJoiners.push(e), e.id;
  }
  deregister(t) {
    for (let e = 0; e < this._characterJoiners.length; e++) if (this._characterJoiners[e].id === t) return this._characterJoiners.splice(e, 1), true;
    return false;
  }
  getJoinedCharacters(t) {
    if (this._characterJoiners.length === 0) return [];
    let e = this._bufferService.buffer.lines.get(t);
    if (!e || e.length === 0) return [];
    let i = [], r = e.translateToString(true), n = 0, o2 = 0, l = 0, a = e.getFg(0), u = e.getBg(0);
    for (let h2 = 0; h2 < e.getTrimmedLength(); h2++) if (e.loadCell(h2, this._workCell), this._workCell.getWidth() !== 0) {
      if (this._workCell.fg !== a || this._workCell.bg !== u) {
        if (h2 - n > 1) {
          let c = this._getJoinedRanges(r, l, o2, e, n);
          for (let d = 0; d < c.length; d++) i.push(c[d]);
        }
        n = h2, l = o2, a = this._workCell.fg, u = this._workCell.bg;
      }
      o2 += this._workCell.getChars().length || we.length;
    }
    if (this._bufferService.cols - n > 1) {
      let h2 = this._getJoinedRanges(r, l, o2, e, n);
      for (let c = 0; c < h2.length; c++) i.push(h2[c]);
    }
    return i;
  }
  _getJoinedRanges(t, e, i, r, n) {
    let o2 = t.substring(e, i), l = [];
    try {
      l = this._characterJoiners[0].handler(o2);
    } catch (a) {
      console.error(a);
    }
    for (let a = 1; a < this._characterJoiners.length; a++) try {
      let u = this._characterJoiners[a].handler(o2);
      for (let h2 = 0; h2 < u.length; h2++) ct._mergeRanges(l, u[h2]);
    } catch (u) {
      console.error(u);
    }
    return this._stringRangesToCellRanges(l, r, n), l;
  }
  _stringRangesToCellRanges(t, e, i) {
    let r = 0, n = false, o2 = 0, l = t[r];
    if (l) {
      for (let a = i; a < this._bufferService.cols; a++) {
        let u = e.getWidth(a), h2 = e.getString(a).length || we.length;
        if (u !== 0) {
          if (!n && l[0] <= o2 && (l[0] = a, n = true), l[1] <= o2) {
            if (l[1] = a, l = t[++r], !l) break;
            l[0] <= o2 ? (l[0] = a, n = true) : n = false;
          }
          o2 += h2;
        }
      }
      l && (l[1] = this._bufferService.cols);
    }
  }
  static _mergeRanges(t, e) {
    let i = false;
    for (let r = 0; r < t.length; r++) {
      let n = t[r];
      if (i) {
        if (e[1] <= n[0]) return t[r - 1][1] = e[1], t;
        if (e[1] <= n[1]) return t[r - 1][1] = Math.max(e[1], n[1]), t.splice(r, 1), t;
        t.splice(r, 1), r--;
      } else {
        if (e[1] <= n[0]) return t.splice(r, 0, e), t;
        if (e[1] <= n[1]) return n[0] = Math.min(e[0], n[0]), t;
        e[0] < n[1] && (n[0] = Math.min(e[0], n[0]), i = true);
        continue;
      }
    }
    return i ? t[t.length - 1][1] = e[1] : t.push(e), t;
  }
};
ct = M([S(0, F)], ct);
function Oa(s15) {
  return 57508 <= s15 && s15 <= 57558;
}
function Ba(s15) {
  return 9472 <= s15 && s15 <= 9631;
}
function $o(s15) {
  return Oa(s15) || Ba(s15);
}
function Vo() {
  return { css: { canvas: qr(), cell: qr() }, device: { canvas: qr(), cell: qr(), char: { width: 0, height: 0, left: 0, top: 0 } } };
}
function qr() {
  return { width: 0, height: 0 };
}
var Vt = class {
  constructor(t, e, i, r, n, o2, l) {
    this._document = t;
    this._characterJoinerService = e;
    this._optionsService = i;
    this._coreBrowserService = r;
    this._coreService = n;
    this._decorationService = o2;
    this._themeService = l;
    this._workCell = new q();
    this._columnSelectMode = false;
    this.defaultSpacing = 0;
  }
  handleSelectionChanged(t, e, i) {
    this._selectionStart = t, this._selectionEnd = e, this._columnSelectMode = i;
  }
  createRow(t, e, i, r, n, o2, l, a, u, h2, c) {
    let d = [], _2 = this._characterJoinerService.getJoinedCharacters(e), p = this._themeService.colors, m = t.getNoBgTrimmedLength();
    i && m < o2 + 1 && (m = o2 + 1);
    let f, A = 0, R = "", O = 0, I = 0, k = 0, P = 0, oe = false, Me = 0, Pe = false, Ke = 0, di = 0, V = [], Qe = h2 !== -1 && c !== -1;
    for (let y = 0; y < m; y++) {
      t.loadCell(y, this._workCell);
      let T = this._workCell.getWidth();
      if (T === 0) continue;
      let g = false, w = y >= di, E = y, x = this._workCell;
      if (_2.length > 0 && y === _2[0][0] && w) {
        let W = _2.shift(), An = this._isCellInSelection(W[0], e);
        for (O = W[0] + 1; O < W[1]; O++) w && (w = An === this._isCellInSelection(O, e));
        w && (w = !i || o2 < W[0] || o2 >= W[1]), w ? (g = true, x = new Vr(this._workCell, t.translateToString(true, W[0], W[1]), W[1] - W[0]), E = W[1] - 1, T = x.getWidth()) : di = W[1];
      }
      let N = this._isCellInSelection(y, e), Z = i && y === o2, te = Qe && y >= h2 && y <= c, Oe = false;
      this._decorationService.forEachDecorationAtCell(y, e, void 0, (W) => {
        Oe = true;
      });
      let ze = x.getChars() || we;
      if (ze === " " && (x.isUnderline() || x.isOverline()) && (ze = "\xA0"), Ke = T * a - u.get(ze, x.isBold(), x.isItalic()), !f) f = this._document.createElement("span");
      else if (A && (N && Pe || !N && !Pe && x.bg === I) && (N && Pe && p.selectionForeground || x.fg === k) && x.extended.ext === P && te === oe && Ke === Me && !Z && !g && !Oe && w) {
        x.isInvisible() ? R += we : R += ze, A++;
        continue;
      } else A && (f.textContent = R), f = this._document.createElement("span"), A = 0, R = "";
      if (I = x.bg, k = x.fg, P = x.extended.ext, oe = te, Me = Ke, Pe = N, g && o2 >= y && o2 <= E && (o2 = y), !this._coreService.isCursorHidden && Z && this._coreService.isCursorInitialized) {
        if (V.push("xterm-cursor"), this._coreBrowserService.isFocused) l && V.push("xterm-cursor-blink"), V.push(r === "bar" ? "xterm-cursor-bar" : r === "underline" ? "xterm-cursor-underline" : "xterm-cursor-block");
        else if (n) switch (n) {
          case "outline":
            V.push("xterm-cursor-outline");
            break;
          case "block":
            V.push("xterm-cursor-block");
            break;
          case "bar":
            V.push("xterm-cursor-bar");
            break;
          case "underline":
            V.push("xterm-cursor-underline");
            break;
          default:
            break;
        }
      }
      if (x.isBold() && V.push("xterm-bold"), x.isItalic() && V.push("xterm-italic"), x.isDim() && V.push("xterm-dim"), x.isInvisible() ? R = we : R = x.getChars() || we, x.isUnderline() && (V.push(`xterm-underline-${x.extended.underlineStyle}`), R === " " && (R = "\xA0"), !x.isUnderlineColorDefault())) if (x.isUnderlineColorRGB()) f.style.textDecorationColor = `rgb(${De.toColorRGB(x.getUnderlineColor()).join(",")})`;
      else {
        let W = x.getUnderlineColor();
        this._optionsService.rawOptions.drawBoldTextInBrightColors && x.isBold() && W < 8 && (W += 8), f.style.textDecorationColor = p.ansi[W].css;
      }
      x.isOverline() && (V.push("xterm-overline"), R === " " && (R = "\xA0")), x.isStrikethrough() && V.push("xterm-strikethrough"), te && (f.style.textDecoration = "underline");
      let le = x.getFgColor(), et = x.getFgColorMode(), me = x.getBgColor(), ht = x.getBgColorMode(), fi = !!x.isInverse();
      if (fi) {
        let W = le;
        le = me, me = W;
        let An = et;
        et = ht, ht = An;
      }
      let tt, Qi, pi = false;
      this._decorationService.forEachDecorationAtCell(y, e, void 0, (W) => {
        W.options.layer !== "top" && pi || (W.backgroundColorRGB && (ht = 50331648, me = W.backgroundColorRGB.rgba >> 8 & 16777215, tt = W.backgroundColorRGB), W.foregroundColorRGB && (et = 50331648, le = W.foregroundColorRGB.rgba >> 8 & 16777215, Qi = W.foregroundColorRGB), pi = W.options.layer === "top");
      }), !pi && N && (tt = this._coreBrowserService.isFocused ? p.selectionBackgroundOpaque : p.selectionInactiveBackgroundOpaque, me = tt.rgba >> 8 & 16777215, ht = 50331648, pi = true, p.selectionForeground && (et = 50331648, le = p.selectionForeground.rgba >> 8 & 16777215, Qi = p.selectionForeground)), pi && V.push("xterm-decoration-top");
      let it;
      switch (ht) {
        case 16777216:
        case 33554432:
          it = p.ansi[me], V.push(`xterm-bg-${me}`);
          break;
        case 50331648:
          it = j.toColor(me >> 16, me >> 8 & 255, me & 255), this._addStyle(f, `background-color:#${qo((me >>> 0).toString(16), "0", 6)}`);
          break;
        case 0:
        default:
          fi ? (it = p.foreground, V.push(`xterm-bg-${257}`)) : it = p.background;
      }
      switch (tt || x.isDim() && (tt = U.multiplyOpacity(it, 0.5)), et) {
        case 16777216:
        case 33554432:
          x.isBold() && le < 8 && this._optionsService.rawOptions.drawBoldTextInBrightColors && (le += 8), this._applyMinimumContrast(f, it, p.ansi[le], x, tt, void 0) || V.push(`xterm-fg-${le}`);
          break;
        case 50331648:
          let W = j.toColor(le >> 16 & 255, le >> 8 & 255, le & 255);
          this._applyMinimumContrast(f, it, W, x, tt, Qi) || this._addStyle(f, `color:#${qo(le.toString(16), "0", 6)}`);
          break;
        case 0:
        default:
          this._applyMinimumContrast(f, it, p.foreground, x, tt, Qi) || fi && V.push(`xterm-fg-${257}`);
      }
      V.length && (f.className = V.join(" "), V.length = 0), !Z && !g && !Oe && w ? A++ : f.textContent = R, Ke !== this.defaultSpacing && (f.style.letterSpacing = `${Ke}px`), d.push(f), y = E;
    }
    return f && A && (f.textContent = R), d;
  }
  _applyMinimumContrast(t, e, i, r, n, o2) {
    if (this._optionsService.rawOptions.minimumContrastRatio === 1 || $o(r.getCode())) return false;
    let l = this._getContrastCache(r), a;
    if (!n && !o2 && (a = l.getColor(e.rgba, i.rgba)), a === void 0) {
      let u = this._optionsService.rawOptions.minimumContrastRatio / (r.isDim() ? 2 : 1);
      a = U.ensureContrastRatio(n || e, o2 || i, u), l.setColor((n || e).rgba, (o2 || i).rgba, a ?? null);
    }
    return a ? (this._addStyle(t, `color:${a.css}`), true) : false;
  }
  _getContrastCache(t) {
    return t.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
  }
  _addStyle(t, e) {
    t.setAttribute("style", `${t.getAttribute("style") || ""}${e};`);
  }
  _isCellInSelection(t, e) {
    let i = this._selectionStart, r = this._selectionEnd;
    return !i || !r ? false : this._columnSelectMode ? i[0] <= r[0] ? t >= i[0] && e >= i[1] && t < r[0] && e <= r[1] : t < i[0] && e >= i[1] && t >= r[0] && e <= r[1] : e > i[1] && e < r[1] || i[1] === r[1] && e === i[1] && t >= i[0] && t < r[0] || i[1] < r[1] && e === r[1] && t < r[0] || i[1] < r[1] && e === i[1] && t >= i[0];
  }
};
Vt = M([S(1, or), S(2, H), S(3, ae), S(4, ge), S(5, Be), S(6, Re)], Vt);
function qo(s15, t, e) {
  for (; s15.length < e; ) s15 = t + s15;
  return s15;
}
var Yr = class {
  constructor(t, e) {
    this._flat = new Float32Array(256);
    this._font = "";
    this._fontSize = 0;
    this._weight = "normal";
    this._weightBold = "bold";
    this._measureElements = [];
    this._container = t.createElement("div"), this._container.classList.add("xterm-width-cache-measure-container"), this._container.setAttribute("aria-hidden", "true"), this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
    let i = t.createElement("span");
    i.classList.add("xterm-char-measure-element");
    let r = t.createElement("span");
    r.classList.add("xterm-char-measure-element"), r.style.fontWeight = "bold";
    let n = t.createElement("span");
    n.classList.add("xterm-char-measure-element"), n.style.fontStyle = "italic";
    let o2 = t.createElement("span");
    o2.classList.add("xterm-char-measure-element"), o2.style.fontWeight = "bold", o2.style.fontStyle = "italic", this._measureElements = [i, r, n, o2], this._container.appendChild(i), this._container.appendChild(r), this._container.appendChild(n), this._container.appendChild(o2), e.appendChild(this._container), this.clear();
  }
  dispose() {
    this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
  }
  clear() {
    this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
  }
  setFont(t, e, i, r) {
    t === this._font && e === this._fontSize && i === this._weight && r === this._weightBold || (this._font = t, this._fontSize = e, this._weight = i, this._weightBold = r, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i}`, this._measureElements[1].style.fontWeight = `${r}`, this._measureElements[2].style.fontWeight = `${i}`, this._measureElements[3].style.fontWeight = `${r}`, this.clear());
  }
  get(t, e, i) {
    let r = 0;
    if (!e && !i && t.length === 1 && (r = t.charCodeAt(0)) < 256) {
      if (this._flat[r] !== -9999) return this._flat[r];
      let l = this._measure(t, 0);
      return l > 0 && (this._flat[r] = l), l;
    }
    let n = t;
    e && (n += "B"), i && (n += "I");
    let o2 = this._holey.get(n);
    if (o2 === void 0) {
      let l = 0;
      e && (l |= 1), i && (l |= 2), o2 = this._measure(t, l), o2 > 0 && this._holey.set(n, o2);
    }
    return o2;
  }
  _measure(t, e) {
    let i = this._measureElements[e];
    return i.textContent = t.repeat(32), i.offsetWidth / 32;
  }
};
var ms = class {
  constructor() {
    this.clear();
  }
  clear() {
    this.hasSelection = false, this.columnSelectMode = false, this.viewportStartRow = 0, this.viewportEndRow = 0, this.viewportCappedStartRow = 0, this.viewportCappedEndRow = 0, this.startCol = 0, this.endCol = 0, this.selectionStart = void 0, this.selectionEnd = void 0;
  }
  update(t, e, i, r = false) {
    if (this.selectionStart = e, this.selectionEnd = i, !e || !i || e[0] === i[0] && e[1] === i[1]) {
      this.clear();
      return;
    }
    let n = t.buffers.active.ydisp, o2 = e[1] - n, l = i[1] - n, a = Math.max(o2, 0), u = Math.min(l, t.rows - 1);
    if (a >= t.rows || u < 0) {
      this.clear();
      return;
    }
    this.hasSelection = true, this.columnSelectMode = r, this.viewportStartRow = o2, this.viewportEndRow = l, this.viewportCappedStartRow = a, this.viewportCappedEndRow = u, this.startCol = e[0], this.endCol = i[0];
  }
  isCellSelected(t, e, i) {
    return this.hasSelection ? (i -= t.buffer.active.viewportY, this.columnSelectMode ? this.startCol <= this.endCol ? e >= this.startCol && i >= this.viewportCappedStartRow && e < this.endCol && i <= this.viewportCappedEndRow : e < this.startCol && i >= this.viewportCappedStartRow && e >= this.endCol && i <= this.viewportCappedEndRow : i > this.viewportStartRow && i < this.viewportEndRow || this.viewportStartRow === this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportEndRow && e < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportStartRow && e >= this.startCol) : false;
  }
};
function Yo() {
  return new ms();
}
var _s = "xterm-dom-renderer-owner-";
var Le = "xterm-rows";
var jr = "xterm-fg-";
var jo = "xterm-bg-";
var ki = "xterm-focus";
var Xr = "xterm-selection";
var Na = 1;
var Yt = class extends D {
  constructor(e, i, r, n, o2, l, a, u, h2, c, d, _2, p, m) {
    super();
    this._terminal = e;
    this._document = i;
    this._element = r;
    this._screenElement = n;
    this._viewportElement = o2;
    this._helperContainer = l;
    this._linkifier2 = a;
    this._charSizeService = h2;
    this._optionsService = c;
    this._bufferService = d;
    this._coreService = _2;
    this._coreBrowserService = p;
    this._themeService = m;
    this._terminalClass = Na++;
    this._rowElements = [];
    this._selectionRenderModel = Yo();
    this.onRequestRedraw = this._register(new v()).event;
    this._rowContainer = this._document.createElement("div"), this._rowContainer.classList.add(Le), this._rowContainer.style.lineHeight = "normal", this._rowContainer.setAttribute("aria-hidden", "true"), this._refreshRowElements(this._bufferService.cols, this._bufferService.rows), this._selectionContainer = this._document.createElement("div"), this._selectionContainer.classList.add(Xr), this._selectionContainer.setAttribute("aria-hidden", "true"), this.dimensions = Vo(), this._updateDimensions(), this._register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this._register(this._themeService.onChangeColors((f) => this._injectCss(f))), this._injectCss(this._themeService.colors), this._rowFactory = u.createInstance(Vt, document), this._element.classList.add(_s + this._terminalClass), this._screenElement.appendChild(this._rowContainer), this._screenElement.appendChild(this._selectionContainer), this._register(this._linkifier2.onShowLinkUnderline((f) => this._handleLinkHover(f))), this._register(this._linkifier2.onHideLinkUnderline((f) => this._handleLinkLeave(f))), this._register(C(() => {
      this._element.classList.remove(_s + this._terminalClass), this._rowContainer.remove(), this._selectionContainer.remove(), this._widthCache.dispose(), this._themeStyleElement.remove(), this._dimensionsStyleElement.remove();
    })), this._widthCache = new Yr(this._document, this._helperContainer), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
  }
  _updateDimensions() {
    let e = this._coreBrowserService.dpr;
    this.dimensions.device.char.width = this._charSizeService.width * e, this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * e), this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing), this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight), this.dimensions.device.char.left = 0, this.dimensions.device.char.top = 0, this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols, this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows, this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / e), this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / e), this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols, this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
    for (let r of this._rowElements) r.style.width = `${this.dimensions.css.canvas.width}px`, r.style.height = `${this.dimensions.css.cell.height}px`, r.style.lineHeight = `${this.dimensions.css.cell.height}px`, r.style.overflow = "hidden";
    this._dimensionsStyleElement || (this._dimensionsStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._dimensionsStyleElement));
    let i = `${this._terminalSelector} .${Le} span { display: inline-block; height: 100%; vertical-align: top;}`;
    this._dimensionsStyleElement.textContent = i, this._selectionContainer.style.height = this._viewportElement.style.height, this._screenElement.style.width = `${this.dimensions.css.canvas.width}px`, this._screenElement.style.height = `${this.dimensions.css.canvas.height}px`;
  }
  _injectCss(e) {
    this._themeStyleElement || (this._themeStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._themeStyleElement));
    let i = `${this._terminalSelector} .${Le} { pointer-events: none; color: ${e.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;
    i += `${this._terminalSelector} .${Le} .xterm-dim { color: ${U.multiplyOpacity(e.foreground, 0.5).css};}`, i += `${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`;
    let r = `blink_underline_${this._terminalClass}`, n = `blink_bar_${this._terminalClass}`, o2 = `blink_block_${this._terminalClass}`;
    i += `@keyframes ${r} { 50% {  border-bottom-style: hidden; }}`, i += `@keyframes ${n} { 50% {  box-shadow: none; }}`, i += `@keyframes ${o2} { 0% {  background-color: ${e.cursor.css};  color: ${e.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e.cursor.css}; }}`, i += `${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-underline { animation: ${r} 1s step-end infinite;}${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-bar { animation: ${n} 1s step-end infinite;}${this._terminalSelector} .${Le}.${ki} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: ${o2} 1s step-end infinite;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-block { background-color: ${e.cursor.css}; color: ${e.cursorAccent.css};}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-block:not(.xterm-cursor-blink) { background-color: ${e.cursor.css} !important; color: ${e.cursorAccent.css} !important;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e.cursor.css} inset;}${this._terminalSelector} .${Le} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`, i += `${this._terminalSelector} .${Xr} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${Xr} div { position: absolute; background-color: ${e.selectionBackgroundOpaque.css};}${this._terminalSelector} .${Xr} div { position: absolute; background-color: ${e.selectionInactiveBackgroundOpaque.css};}`;
    for (let [l, a] of e.ansi.entries()) i += `${this._terminalSelector} .${jr}${l} { color: ${a.css}; }${this._terminalSelector} .${jr}${l}.xterm-dim { color: ${U.multiplyOpacity(a, 0.5).css}; }${this._terminalSelector} .${jo}${l} { background-color: ${a.css}; }`;
    i += `${this._terminalSelector} .${jr}${257} { color: ${U.opaque(e.background).css}; }${this._terminalSelector} .${jr}${257}.xterm-dim { color: ${U.multiplyOpacity(U.opaque(e.background), 0.5).css}; }${this._terminalSelector} .${jo}${257} { background-color: ${e.foreground.css}; }`, this._themeStyleElement.textContent = i;
  }
  _setDefaultSpacing() {
    let e = this.dimensions.css.cell.width - this._widthCache.get("W", false, false);
    this._rowContainer.style.letterSpacing = `${e}px`, this._rowFactory.defaultSpacing = e;
  }
  handleDevicePixelRatioChange() {
    this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
  }
  _refreshRowElements(e, i) {
    for (let r = this._rowElements.length; r <= i; r++) {
      let n = this._document.createElement("div");
      this._rowContainer.appendChild(n), this._rowElements.push(n);
    }
    for (; this._rowElements.length > i; ) this._rowContainer.removeChild(this._rowElements.pop());
  }
  handleResize(e, i) {
    this._refreshRowElements(e, i), this._updateDimensions(), this.handleSelectionChanged(this._selectionRenderModel.selectionStart, this._selectionRenderModel.selectionEnd, this._selectionRenderModel.columnSelectMode);
  }
  handleCharSizeChanged() {
    this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
  }
  handleBlur() {
    this._rowContainer.classList.remove(ki), this.renderRows(0, this._bufferService.rows - 1);
  }
  handleFocus() {
    this._rowContainer.classList.add(ki), this.renderRows(this._bufferService.buffer.y, this._bufferService.buffer.y);
  }
  handleSelectionChanged(e, i, r) {
    if (this._selectionContainer.replaceChildren(), this._rowFactory.handleSelectionChanged(e, i, r), this.renderRows(0, this._bufferService.rows - 1), !e || !i || (this._selectionRenderModel.update(this._terminal, e, i, r), !this._selectionRenderModel.hasSelection)) return;
    let n = this._selectionRenderModel.viewportStartRow, o2 = this._selectionRenderModel.viewportEndRow, l = this._selectionRenderModel.viewportCappedStartRow, a = this._selectionRenderModel.viewportCappedEndRow, u = this._document.createDocumentFragment();
    if (r) {
      let h2 = e[0] > i[0];
      u.appendChild(this._createSelectionElement(l, h2 ? i[0] : e[0], h2 ? e[0] : i[0], a - l + 1));
    } else {
      let h2 = n === l ? e[0] : 0, c = l === o2 ? i[0] : this._bufferService.cols;
      u.appendChild(this._createSelectionElement(l, h2, c));
      let d = a - l - 1;
      if (u.appendChild(this._createSelectionElement(l + 1, 0, this._bufferService.cols, d)), l !== a) {
        let _2 = o2 === a ? i[0] : this._bufferService.cols;
        u.appendChild(this._createSelectionElement(a, 0, _2));
      }
    }
    this._selectionContainer.appendChild(u);
  }
  _createSelectionElement(e, i, r, n = 1) {
    let o2 = this._document.createElement("div"), l = i * this.dimensions.css.cell.width, a = this.dimensions.css.cell.width * (r - i);
    return l + a > this.dimensions.css.canvas.width && (a = this.dimensions.css.canvas.width - l), o2.style.height = `${n * this.dimensions.css.cell.height}px`, o2.style.top = `${e * this.dimensions.css.cell.height}px`, o2.style.left = `${l}px`, o2.style.width = `${a}px`, o2;
  }
  handleCursorMove() {
  }
  _handleOptionsChanged() {
    this._updateDimensions(), this._injectCss(this._themeService.colors), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
  }
  clear() {
    for (let e of this._rowElements) e.replaceChildren();
  }
  renderRows(e, i) {
    let r = this._bufferService.buffer, n = r.ybase + r.y, o2 = Math.min(r.x, this._bufferService.cols - 1), l = this._coreService.decPrivateModes.cursorBlink ?? this._optionsService.rawOptions.cursorBlink, a = this._coreService.decPrivateModes.cursorStyle ?? this._optionsService.rawOptions.cursorStyle, u = this._optionsService.rawOptions.cursorInactiveStyle;
    for (let h2 = e; h2 <= i; h2++) {
      let c = h2 + r.ydisp, d = this._rowElements[h2], _2 = r.lines.get(c);
      if (!d || !_2) break;
      d.replaceChildren(...this._rowFactory.createRow(_2, c, c === n, a, u, o2, l, this.dimensions.css.cell.width, this._widthCache, -1, -1));
    }
  }
  get _terminalSelector() {
    return `.${_s}${this._terminalClass}`;
  }
  _handleLinkHover(e) {
    this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, true);
  }
  _handleLinkLeave(e) {
    this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, false);
  }
  _setCellUnderline(e, i, r, n, o2, l) {
    r < 0 && (e = 0), n < 0 && (i = 0);
    let a = this._bufferService.rows - 1;
    r = Math.max(Math.min(r, a), 0), n = Math.max(Math.min(n, a), 0), o2 = Math.min(o2, this._bufferService.cols);
    let u = this._bufferService.buffer, h2 = u.ybase + u.y, c = Math.min(u.x, o2 - 1), d = this._optionsService.rawOptions.cursorBlink, _2 = this._optionsService.rawOptions.cursorStyle, p = this._optionsService.rawOptions.cursorInactiveStyle;
    for (let m = r; m <= n; ++m) {
      let f = m + u.ydisp, A = this._rowElements[m], R = u.lines.get(f);
      if (!A || !R) break;
      A.replaceChildren(...this._rowFactory.createRow(R, f, f === h2, _2, p, c, d, this.dimensions.css.cell.width, this._widthCache, l ? m === r ? e : 0 : -1, l ? (m === n ? i : o2) - 1 : -1));
    }
  }
};
Yt = M([S(7, xt), S(8, nt), S(9, H), S(10, F), S(11, ge), S(12, ae), S(13, Re)], Yt);
var jt = class extends D {
  constructor(e, i, r) {
    super();
    this._optionsService = r;
    this.width = 0;
    this.height = 0;
    this._onCharSizeChange = this._register(new v());
    this.onCharSizeChange = this._onCharSizeChange.event;
    try {
      this._measureStrategy = this._register(new vs(this._optionsService));
    } catch {
      this._measureStrategy = this._register(new bs(e, i, this._optionsService));
    }
    this._register(this._optionsService.onMultipleOptionChange(["fontFamily", "fontSize"], () => this.measure()));
  }
  get hasValidSize() {
    return this.width > 0 && this.height > 0;
  }
  measure() {
    let e = this._measureStrategy.measure();
    (e.width !== this.width || e.height !== this.height) && (this.width = e.width, this.height = e.height, this._onCharSizeChange.fire());
  }
};
jt = M([S(2, H)], jt);
var Zr = class extends D {
  constructor() {
    super(...arguments);
    this._result = { width: 0, height: 0 };
  }
  _validateAndSet(e, i) {
    e !== void 0 && e > 0 && i !== void 0 && i > 0 && (this._result.width = e, this._result.height = i);
  }
};
var bs = class extends Zr {
  constructor(e, i, r) {
    super();
    this._document = e;
    this._parentElement = i;
    this._optionsService = r;
    this._measureElement = this._document.createElement("span"), this._measureElement.classList.add("xterm-char-measure-element"), this._measureElement.textContent = "W".repeat(32), this._measureElement.setAttribute("aria-hidden", "true"), this._measureElement.style.whiteSpace = "pre", this._measureElement.style.fontKerning = "none", this._parentElement.appendChild(this._measureElement);
  }
  measure() {
    return this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._measureElement.style.fontSize = `${this._optionsService.rawOptions.fontSize}px`, this._validateAndSet(Number(this._measureElement.offsetWidth) / 32, Number(this._measureElement.offsetHeight)), this._result;
  }
};
var vs = class extends Zr {
  constructor(e) {
    super();
    this._optionsService = e;
    this._canvas = new OffscreenCanvas(100, 100), this._ctx = this._canvas.getContext("2d");
    let i = this._ctx.measureText("W");
    if (!("width" in i && "fontBoundingBoxAscent" in i && "fontBoundingBoxDescent" in i)) throw new Error("Required font metrics not supported");
  }
  measure() {
    this._ctx.font = `${this._optionsService.rawOptions.fontSize}px ${this._optionsService.rawOptions.fontFamily}`;
    let e = this._ctx.measureText("W");
    return this._validateAndSet(e.width, e.fontBoundingBoxAscent + e.fontBoundingBoxDescent), this._result;
  }
};
var Jr = class extends D {
  constructor(e, i, r) {
    super();
    this._textarea = e;
    this._window = i;
    this.mainDocument = r;
    this._isFocused = false;
    this._cachedIsFocused = void 0;
    this._screenDprMonitor = this._register(new gs(this._window));
    this._onDprChange = this._register(new v());
    this.onDprChange = this._onDprChange.event;
    this._onWindowChange = this._register(new v());
    this.onWindowChange = this._onWindowChange.event;
    this._register(this.onWindowChange((n) => this._screenDprMonitor.setWindow(n))), this._register($.forward(this._screenDprMonitor.onDprChange, this._onDprChange)), this._register(L(this._textarea, "focus", () => this._isFocused = true)), this._register(L(this._textarea, "blur", () => this._isFocused = false));
  }
  get window() {
    return this._window;
  }
  set window(e) {
    this._window !== e && (this._window = e, this._onWindowChange.fire(this._window));
  }
  get dpr() {
    return this.window.devicePixelRatio;
  }
  get isFocused() {
    return this._cachedIsFocused === void 0 && (this._cachedIsFocused = this._isFocused && this._textarea.ownerDocument.hasFocus(), queueMicrotask(() => this._cachedIsFocused = void 0)), this._cachedIsFocused;
  }
};
var gs = class extends D {
  constructor(e) {
    super();
    this._parentWindow = e;
    this._windowResizeListener = this._register(new ye());
    this._onDprChange = this._register(new v());
    this.onDprChange = this._onDprChange.event;
    this._outerListener = () => this._setDprAndFireIfDiffers(), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._updateDpr(), this._setWindowResizeListener(), this._register(C(() => this.clearListener()));
  }
  setWindow(e) {
    this._parentWindow = e, this._setWindowResizeListener(), this._setDprAndFireIfDiffers();
  }
  _setWindowResizeListener() {
    this._windowResizeListener.value = L(this._parentWindow, "resize", () => this._setDprAndFireIfDiffers());
  }
  _setDprAndFireIfDiffers() {
    this._parentWindow.devicePixelRatio !== this._currentDevicePixelRatio && this._onDprChange.fire(this._parentWindow.devicePixelRatio), this._updateDpr();
  }
  _updateDpr() {
    this._outerListener && (this._resolutionMediaMatchList?.removeListener(this._outerListener), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._resolutionMediaMatchList = this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`), this._resolutionMediaMatchList.addListener(this._outerListener));
  }
  clearListener() {
    !this._resolutionMediaMatchList || !this._outerListener || (this._resolutionMediaMatchList.removeListener(this._outerListener), this._resolutionMediaMatchList = void 0, this._outerListener = void 0);
  }
};
var Qr = class extends D {
  constructor() {
    super();
    this.linkProviders = [];
    this._register(C(() => this.linkProviders.length = 0));
  }
  registerLinkProvider(e) {
    return this.linkProviders.push(e), { dispose: () => {
      let i = this.linkProviders.indexOf(e);
      i !== -1 && this.linkProviders.splice(i, 1);
    } };
  }
};
function Ci(s15, t, e) {
  let i = e.getBoundingClientRect(), r = s15.getComputedStyle(e), n = parseInt(r.getPropertyValue("padding-left")), o2 = parseInt(r.getPropertyValue("padding-top"));
  return [t.clientX - i.left - n, t.clientY - i.top - o2];
}
function Xo(s15, t, e, i, r, n, o2, l, a) {
  if (!n) return;
  let u = Ci(s15, t, e);
  if (u) return u[0] = Math.ceil((u[0] + (a ? o2 / 2 : 0)) / o2), u[1] = Math.ceil(u[1] / l), u[0] = Math.min(Math.max(u[0], 1), i + (a ? 1 : 0)), u[1] = Math.min(Math.max(u[1], 1), r), u;
}
var Xt = class {
  constructor(t, e) {
    this._renderService = t;
    this._charSizeService = e;
  }
  getCoords(t, e, i, r, n) {
    return Xo(window, t, e, i, r, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, n);
  }
  getMouseReportCoords(t, e) {
    let i = Ci(window, t, e);
    if (this._charSizeService.hasValidSize) return i[0] = Math.min(Math.max(i[0], 0), this._renderService.dimensions.css.canvas.width - 1), i[1] = Math.min(Math.max(i[1], 0), this._renderService.dimensions.css.canvas.height - 1), { col: Math.floor(i[0] / this._renderService.dimensions.css.cell.width), row: Math.floor(i[1] / this._renderService.dimensions.css.cell.height), x: Math.floor(i[0]), y: Math.floor(i[1]) };
  }
};
Xt = M([S(0, ce), S(1, nt)], Xt);
var en = class {
  constructor(t, e) {
    this._renderCallback = t;
    this._coreBrowserService = e;
    this._refreshCallbacks = [];
  }
  dispose() {
    this._animationFrame && (this._coreBrowserService.window.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
  }
  addRefreshCallback(t) {
    return this._refreshCallbacks.push(t), this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh())), this._animationFrame;
  }
  refresh(t, e, i) {
    this._rowCount = i, t = t !== void 0 ? t : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t) : t, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e, !this._animationFrame && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._innerRefresh()));
  }
  _innerRefresh() {
    if (this._animationFrame = void 0, this._rowStart === void 0 || this._rowEnd === void 0 || this._rowCount === void 0) {
      this._runRefreshCallbacks();
      return;
    }
    let t = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
    this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t, e), this._runRefreshCallbacks();
  }
  _runRefreshCallbacks() {
    for (let t of this._refreshCallbacks) t(0);
    this._refreshCallbacks = [];
  }
};
var tn = {};
Ll(tn, { getSafariVersion: () => Ha, isChromeOS: () => Ts, isFirefox: () => Ss, isIpad: () => Wa, isIphone: () => Ua, isLegacyEdge: () => Fa, isLinux: () => Bi, isMac: () => Zt, isNode: () => Mi, isSafari: () => Zo, isWindows: () => Es });
var Mi = typeof process < "u" && "title" in process;
var Pi = Mi ? "node" : navigator.userAgent;
var Oi = Mi ? "node" : navigator.platform;
var Ss = Pi.includes("Firefox");
var Fa = Pi.includes("Edge");
var Zo = /^((?!chrome|android).)*safari/i.test(Pi);
function Ha() {
  if (!Zo) return 0;
  let s15 = Pi.match(/Version\/(\d+)/);
  return s15 === null || s15.length < 2 ? 0 : parseInt(s15[1]);
}
var Zt = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(Oi);
var Wa = Oi === "iPad";
var Ua = Oi === "iPhone";
var Es = ["Windows", "Win16", "Win32", "WinCE"].includes(Oi);
var Bi = Oi.indexOf("Linux") >= 0;
var Ts = /\bCrOS\b/.test(Pi);
var rn = class {
  constructor() {
    this._tasks = [];
    this._i = 0;
  }
  enqueue(t) {
    this._tasks.push(t), this._start();
  }
  flush() {
    for (; this._i < this._tasks.length; ) this._tasks[this._i]() || this._i++;
    this.clear();
  }
  clear() {
    this._idleCallback && (this._cancelCallback(this._idleCallback), this._idleCallback = void 0), this._i = 0, this._tasks.length = 0;
  }
  _start() {
    this._idleCallback || (this._idleCallback = this._requestCallback(this._process.bind(this)));
  }
  _process(t) {
    this._idleCallback = void 0;
    let e = 0, i = 0, r = t.timeRemaining(), n = 0;
    for (; this._i < this._tasks.length; ) {
      if (e = performance.now(), this._tasks[this._i]() || this._i++, e = Math.max(1, performance.now() - e), i = Math.max(e, i), n = t.timeRemaining(), i * 1.5 > n) {
        r - e < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(r - e))}ms`), this._start();
        return;
      }
      r = n;
    }
    this.clear();
  }
};
var Is = class extends rn {
  _requestCallback(t) {
    return setTimeout(() => t(this._createDeadline(16)));
  }
  _cancelCallback(t) {
    clearTimeout(t);
  }
  _createDeadline(t) {
    let e = performance.now() + t;
    return { timeRemaining: () => Math.max(0, e - performance.now()) };
  }
};
var ys = class extends rn {
  _requestCallback(t) {
    return requestIdleCallback(t);
  }
  _cancelCallback(t) {
    cancelIdleCallback(t);
  }
};
var Jt = !Mi && "requestIdleCallback" in window ? ys : Is;
var nn = class {
  constructor() {
    this._queue = new Jt();
  }
  set(t) {
    this._queue.clear(), this._queue.enqueue(t);
  }
  flush() {
    this._queue.flush();
  }
};
var Qt = class extends D {
  constructor(e, i, r, n, o2, l, a, u, h2) {
    super();
    this._rowCount = e;
    this._optionsService = r;
    this._charSizeService = n;
    this._coreService = o2;
    this._coreBrowserService = u;
    this._renderer = this._register(new ye());
    this._pausedResizeTask = new nn();
    this._observerDisposable = this._register(new ye());
    this._isPaused = false;
    this._needsFullRefresh = false;
    this._isNextRenderRedrawOnly = true;
    this._needsSelectionRefresh = false;
    this._canvasWidth = 0;
    this._canvasHeight = 0;
    this._selectionState = { start: void 0, end: void 0, columnSelectMode: false };
    this._onDimensionsChange = this._register(new v());
    this.onDimensionsChange = this._onDimensionsChange.event;
    this._onRenderedViewportChange = this._register(new v());
    this.onRenderedViewportChange = this._onRenderedViewportChange.event;
    this._onRender = this._register(new v());
    this.onRender = this._onRender.event;
    this._onRefreshRequest = this._register(new v());
    this.onRefreshRequest = this._onRefreshRequest.event;
    this._renderDebouncer = new en((c, d) => this._renderRows(c, d), this._coreBrowserService), this._register(this._renderDebouncer), this._syncOutputHandler = new xs(this._coreBrowserService, this._coreService, () => this._fullRefresh()), this._register(C(() => this._syncOutputHandler.dispose())), this._register(this._coreBrowserService.onDprChange(() => this.handleDevicePixelRatioChange())), this._register(a.onResize(() => this._fullRefresh())), this._register(a.buffers.onBufferActivate(() => this._renderer.value?.clear())), this._register(this._optionsService.onOptionChange(() => this._handleOptionsChanged())), this._register(this._charSizeService.onCharSizeChange(() => this.handleCharSizeChanged())), this._register(l.onDecorationRegistered(() => this._fullRefresh())), this._register(l.onDecorationRemoved(() => this._fullRefresh())), this._register(this._optionsService.onMultipleOptionChange(["customGlyphs", "drawBoldTextInBrightColors", "letterSpacing", "lineHeight", "fontFamily", "fontSize", "fontWeight", "fontWeightBold", "minimumContrastRatio", "rescaleOverlappingGlyphs"], () => {
      this.clear(), this.handleResize(a.cols, a.rows), this._fullRefresh();
    })), this._register(this._optionsService.onMultipleOptionChange(["cursorBlink", "cursorStyle"], () => this.refreshRows(a.buffer.y, a.buffer.y, true))), this._register(h2.onChangeColors(() => this._fullRefresh())), this._registerIntersectionObserver(this._coreBrowserService.window, i), this._register(this._coreBrowserService.onWindowChange((c) => this._registerIntersectionObserver(c, i)));
  }
  get dimensions() {
    return this._renderer.value.dimensions;
  }
  _registerIntersectionObserver(e, i) {
    if ("IntersectionObserver" in e) {
      let r = new e.IntersectionObserver((n) => this._handleIntersectionChange(n[n.length - 1]), { threshold: 0 });
      r.observe(i), this._observerDisposable.value = C(() => r.disconnect());
    }
  }
  _handleIntersectionChange(e) {
    this._isPaused = e.isIntersecting === void 0 ? e.intersectionRatio === 0 : !e.isIntersecting, !this._isPaused && !this._charSizeService.hasValidSize && this._charSizeService.measure(), !this._isPaused && this._needsFullRefresh && (this._pausedResizeTask.flush(), this.refreshRows(0, this._rowCount - 1), this._needsFullRefresh = false);
  }
  refreshRows(e, i, r = false) {
    if (this._isPaused) {
      this._needsFullRefresh = true;
      return;
    }
    if (this._coreService.decPrivateModes.synchronizedOutput) {
      this._syncOutputHandler.bufferRows(e, i);
      return;
    }
    let n = this._syncOutputHandler.flush();
    n && (e = Math.min(e, n.start), i = Math.max(i, n.end)), r || (this._isNextRenderRedrawOnly = false), this._renderDebouncer.refresh(e, i, this._rowCount);
  }
  _renderRows(e, i) {
    if (this._renderer.value) {
      if (this._coreService.decPrivateModes.synchronizedOutput) {
        this._syncOutputHandler.bufferRows(e, i);
        return;
      }
      e = Math.min(e, this._rowCount - 1), i = Math.min(i, this._rowCount - 1), this._renderer.value.renderRows(e, i), this._needsSelectionRefresh && (this._renderer.value.handleSelectionChanged(this._selectionState.start, this._selectionState.end, this._selectionState.columnSelectMode), this._needsSelectionRefresh = false), this._isNextRenderRedrawOnly || this._onRenderedViewportChange.fire({ start: e, end: i }), this._onRender.fire({ start: e, end: i }), this._isNextRenderRedrawOnly = true;
    }
  }
  resize(e, i) {
    this._rowCount = i, this._fireOnCanvasResize();
  }
  _handleOptionsChanged() {
    this._renderer.value && (this.refreshRows(0, this._rowCount - 1), this._fireOnCanvasResize());
  }
  _fireOnCanvasResize() {
    this._renderer.value && (this._renderer.value.dimensions.css.canvas.width === this._canvasWidth && this._renderer.value.dimensions.css.canvas.height === this._canvasHeight || this._onDimensionsChange.fire(this._renderer.value.dimensions));
  }
  hasRenderer() {
    return !!this._renderer.value;
  }
  setRenderer(e) {
    this._renderer.value = e, this._renderer.value && (this._renderer.value.onRequestRedraw((i) => this.refreshRows(i.start, i.end, true)), this._needsSelectionRefresh = true, this._fullRefresh());
  }
  addRefreshCallback(e) {
    return this._renderDebouncer.addRefreshCallback(e);
  }
  _fullRefresh() {
    this._isPaused ? this._needsFullRefresh = true : this.refreshRows(0, this._rowCount - 1);
  }
  clearTextureAtlas() {
    this._renderer.value && (this._renderer.value.clearTextureAtlas?.(), this._fullRefresh());
  }
  handleDevicePixelRatioChange() {
    this._charSizeService.measure(), this._renderer.value && (this._renderer.value.handleDevicePixelRatioChange(), this.refreshRows(0, this._rowCount - 1));
  }
  handleResize(e, i) {
    this._renderer.value && (this._isPaused ? this._pausedResizeTask.set(() => this._renderer.value?.handleResize(e, i)) : this._renderer.value.handleResize(e, i), this._fullRefresh());
  }
  handleCharSizeChanged() {
    this._renderer.value?.handleCharSizeChanged();
  }
  handleBlur() {
    this._renderer.value?.handleBlur();
  }
  handleFocus() {
    this._renderer.value?.handleFocus();
  }
  handleSelectionChanged(e, i, r) {
    this._selectionState.start = e, this._selectionState.end = i, this._selectionState.columnSelectMode = r, this._renderer.value?.handleSelectionChanged(e, i, r);
  }
  handleCursorMove() {
    this._renderer.value?.handleCursorMove();
  }
  clear() {
    this._renderer.value?.clear();
  }
};
Qt = M([S(2, H), S(3, nt), S(4, ge), S(5, Be), S(6, F), S(7, ae), S(8, Re)], Qt);
var xs = class {
  constructor(t, e, i) {
    this._coreBrowserService = t;
    this._coreService = e;
    this._onTimeout = i;
    this._start = 0;
    this._end = 0;
    this._isBuffering = false;
  }
  bufferRows(t, e) {
    this._isBuffering ? (this._start = Math.min(this._start, t), this._end = Math.max(this._end, e)) : (this._start = t, this._end = e, this._isBuffering = true), this._timeout === void 0 && (this._timeout = this._coreBrowserService.window.setTimeout(() => {
      this._timeout = void 0, this._coreService.decPrivateModes.synchronizedOutput = false, this._onTimeout();
    }, 1e3));
  }
  flush() {
    if (this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0), !this._isBuffering) return;
    let t = { start: this._start, end: this._end };
    return this._isBuffering = false, t;
  }
  dispose() {
    this._timeout !== void 0 && (this._coreBrowserService.window.clearTimeout(this._timeout), this._timeout = void 0);
  }
};
function Jo(s15, t, e, i) {
  let r = e.buffer.x, n = e.buffer.y;
  if (!e.buffer.hasScrollback) return Ga(r, n, s15, t, e, i) + sn(n, t, e, i) + $a(r, n, s15, t, e, i);
  let o2;
  if (n === t) return o2 = r > s15 ? "D" : "C", Fi(Math.abs(r - s15), Ni(o2, i));
  o2 = n > t ? "D" : "C";
  let l = Math.abs(n - t), a = za(n > t ? s15 : r, e) + (l - 1) * e.cols + 1 + Ka(n > t ? r : s15, e);
  return Fi(a, Ni(o2, i));
}
function Ka(s15, t) {
  return s15 - 1;
}
function za(s15, t) {
  return t.cols - s15;
}
function Ga(s15, t, e, i, r, n) {
  return sn(t, i, r, n).length === 0 ? "" : Fi(el(s15, t, s15, t - gt(t, r), false, r).length, Ni("D", n));
}
function sn(s15, t, e, i) {
  let r = s15 - gt(s15, e), n = t - gt(t, e), o2 = Math.abs(r - n) - Va(s15, t, e);
  return Fi(o2, Ni(Qo(s15, t), i));
}
function $a(s15, t, e, i, r, n) {
  let o2;
  sn(t, i, r, n).length > 0 ? o2 = i - gt(i, r) : o2 = t;
  let l = i, a = qa(s15, t, e, i, r, n);
  return Fi(el(s15, o2, e, l, a === "C", r).length, Ni(a, n));
}
function Va(s15, t, e) {
  let i = 0, r = s15 - gt(s15, e), n = t - gt(t, e);
  for (let o2 = 0; o2 < Math.abs(r - n); o2++) {
    let l = Qo(s15, t) === "A" ? -1 : 1;
    e.buffer.lines.get(r + l * o2)?.isWrapped && i++;
  }
  return i;
}
function gt(s15, t) {
  let e = 0, i = t.buffer.lines.get(s15), r = i?.isWrapped;
  for (; r && s15 >= 0 && s15 < t.rows; ) e++, i = t.buffer.lines.get(--s15), r = i?.isWrapped;
  return e;
}
function qa(s15, t, e, i, r, n) {
  let o2;
  return sn(e, i, r, n).length > 0 ? o2 = i - gt(i, r) : o2 = t, s15 < e && o2 <= i || s15 >= e && o2 < i ? "C" : "D";
}
function Qo(s15, t) {
  return s15 > t ? "A" : "B";
}
function el(s15, t, e, i, r, n) {
  let o2 = s15, l = t, a = "";
  for (; (o2 !== e || l !== i) && l >= 0 && l < n.buffer.lines.length; ) o2 += r ? 1 : -1, r && o2 > n.cols - 1 ? (a += n.buffer.translateBufferLineToString(l, false, s15, o2), o2 = 0, s15 = 0, l++) : !r && o2 < 0 && (a += n.buffer.translateBufferLineToString(l, false, 0, s15 + 1), o2 = n.cols - 1, s15 = o2, l--);
  return a + n.buffer.translateBufferLineToString(l, false, s15, o2);
}
function Ni(s15, t) {
  let e = t ? "O" : "[";
  return b.ESC + e + s15;
}
function Fi(s15, t) {
  s15 = Math.floor(s15);
  let e = "";
  for (let i = 0; i < s15; i++) e += t;
  return e;
}
var on = class {
  constructor(t) {
    this._bufferService = t;
    this.isSelectAllActive = false;
    this.selectionStartLength = 0;
  }
  clearSelection() {
    this.selectionStart = void 0, this.selectionEnd = void 0, this.isSelectAllActive = false, this.selectionStartLength = 0;
  }
  get finalSelectionStart() {
    return this.isSelectAllActive ? [0, 0] : !this.selectionEnd || !this.selectionStart ? this.selectionStart : this.areSelectionValuesReversed() ? this.selectionEnd : this.selectionStart;
  }
  get finalSelectionEnd() {
    if (this.isSelectAllActive) return [this._bufferService.cols, this._bufferService.buffer.ybase + this._bufferService.rows - 1];
    if (this.selectionStart) {
      if (!this.selectionEnd || this.areSelectionValuesReversed()) {
        let t = this.selectionStart[0] + this.selectionStartLength;
        return t > this._bufferService.cols ? t % this._bufferService.cols === 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols) - 1] : [t % this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols)] : [t, this.selectionStart[1]];
      }
      if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
        let t = this.selectionStart[0] + this.selectionStartLength;
        return t > this._bufferService.cols ? [t % this._bufferService.cols, this.selectionStart[1] + Math.floor(t / this._bufferService.cols)] : [Math.max(t, this.selectionEnd[0]), this.selectionEnd[1]];
      }
      return this.selectionEnd;
    }
  }
  areSelectionValuesReversed() {
    let t = this.selectionStart, e = this.selectionEnd;
    return !t || !e ? false : t[1] > e[1] || t[1] === e[1] && t[0] > e[0];
  }
  handleTrim(t) {
    return this.selectionStart && (this.selectionStart[1] -= t), this.selectionEnd && (this.selectionEnd[1] -= t), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), true) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), false);
  }
};
function ws(s15, t) {
  if (s15.start.y > s15.end.y) throw new Error(`Buffer range end (${s15.end.x}, ${s15.end.y}) cannot be before start (${s15.start.x}, ${s15.start.y})`);
  return t * (s15.end.y - s15.start.y) + (s15.end.x - s15.start.x + 1);
}
var Ds = 50;
var Ya = 15;
var ja = 50;
var Xa = 500;
var Za = "\xA0";
var Ja = new RegExp(Za, "g");
var ei = class extends D {
  constructor(e, i, r, n, o2, l, a, u, h2) {
    super();
    this._element = e;
    this._screenElement = i;
    this._linkifier = r;
    this._bufferService = n;
    this._coreService = o2;
    this._mouseService = l;
    this._optionsService = a;
    this._renderService = u;
    this._coreBrowserService = h2;
    this._dragScrollAmount = 0;
    this._enabled = true;
    this._workCell = new q();
    this._mouseDownTimeStamp = 0;
    this._oldHasSelection = false;
    this._oldSelectionStart = void 0;
    this._oldSelectionEnd = void 0;
    this._onLinuxMouseSelection = this._register(new v());
    this.onLinuxMouseSelection = this._onLinuxMouseSelection.event;
    this._onRedrawRequest = this._register(new v());
    this.onRequestRedraw = this._onRedrawRequest.event;
    this._onSelectionChange = this._register(new v());
    this.onSelectionChange = this._onSelectionChange.event;
    this._onRequestScrollLines = this._register(new v());
    this.onRequestScrollLines = this._onRequestScrollLines.event;
    this._mouseMoveListener = (c) => this._handleMouseMove(c), this._mouseUpListener = (c) => this._handleMouseUp(c), this._coreService.onUserInput(() => {
      this.hasSelection && this.clearSelection();
    }), this._trimListener = this._bufferService.buffer.lines.onTrim((c) => this._handleTrim(c)), this._register(this._bufferService.buffers.onBufferActivate((c) => this._handleBufferActivate(c))), this.enable(), this._model = new on(this._bufferService), this._activeSelectionMode = 0, this._register(C(() => {
      this._removeMouseDownListeners();
    })), this._register(this._bufferService.onResize((c) => {
      c.rowsChanged && this.clearSelection();
    }));
  }
  reset() {
    this.clearSelection();
  }
  disable() {
    this.clearSelection(), this._enabled = false;
  }
  enable() {
    this._enabled = true;
  }
  get selectionStart() {
    return this._model.finalSelectionStart;
  }
  get selectionEnd() {
    return this._model.finalSelectionEnd;
  }
  get hasSelection() {
    let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd;
    return !e || !i ? false : e[0] !== i[0] || e[1] !== i[1];
  }
  get selectionText() {
    let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd;
    if (!e || !i) return "";
    let r = this._bufferService.buffer, n = [];
    if (this._activeSelectionMode === 3) {
      if (e[0] === i[0]) return "";
      let l = e[0] < i[0] ? e[0] : i[0], a = e[0] < i[0] ? i[0] : e[0];
      for (let u = e[1]; u <= i[1]; u++) {
        let h2 = r.translateBufferLineToString(u, true, l, a);
        n.push(h2);
      }
    } else {
      let l = e[1] === i[1] ? i[0] : void 0;
      n.push(r.translateBufferLineToString(e[1], true, e[0], l));
      for (let a = e[1] + 1; a <= i[1] - 1; a++) {
        let u = r.lines.get(a), h2 = r.translateBufferLineToString(a, true);
        u?.isWrapped ? n[n.length - 1] += h2 : n.push(h2);
      }
      if (e[1] !== i[1]) {
        let a = r.lines.get(i[1]), u = r.translateBufferLineToString(i[1], true, 0, i[0]);
        a && a.isWrapped ? n[n.length - 1] += u : n.push(u);
      }
    }
    return n.map((l) => l.replace(Ja, " ")).join(Es ? `\r
` : `
`);
  }
  clearSelection() {
    this._model.clearSelection(), this._removeMouseDownListeners(), this.refresh(), this._onSelectionChange.fire();
  }
  refresh(e) {
    this._refreshAnimationFrame || (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame(() => this._refresh())), Bi && e && this.selectionText.length && this._onLinuxMouseSelection.fire(this.selectionText);
  }
  _refresh() {
    this._refreshAnimationFrame = void 0, this._onRedrawRequest.fire({ start: this._model.finalSelectionStart, end: this._model.finalSelectionEnd, columnSelectMode: this._activeSelectionMode === 3 });
  }
  _isClickInSelection(e) {
    let i = this._getMouseBufferCoords(e), r = this._model.finalSelectionStart, n = this._model.finalSelectionEnd;
    return !r || !n || !i ? false : this._areCoordsInSelection(i, r, n);
  }
  isCellInSelection(e, i) {
    let r = this._model.finalSelectionStart, n = this._model.finalSelectionEnd;
    return !r || !n ? false : this._areCoordsInSelection([e, i], r, n);
  }
  _areCoordsInSelection(e, i, r) {
    return e[1] > i[1] && e[1] < r[1] || i[1] === r[1] && e[1] === i[1] && e[0] >= i[0] && e[0] < r[0] || i[1] < r[1] && e[1] === r[1] && e[0] < r[0] || i[1] < r[1] && e[1] === i[1] && e[0] >= i[0];
  }
  _selectWordAtCursor(e, i) {
    let r = this._linkifier.currentLink?.link?.range;
    if (r) return this._model.selectionStart = [r.start.x - 1, r.start.y - 1], this._model.selectionStartLength = ws(r, this._bufferService.cols), this._model.selectionEnd = void 0, true;
    let n = this._getMouseBufferCoords(e);
    return n ? (this._selectWordAt(n, i), this._model.selectionEnd = void 0, true) : false;
  }
  selectAll() {
    this._model.isSelectAllActive = true, this.refresh(), this._onSelectionChange.fire();
  }
  selectLines(e, i) {
    this._model.clearSelection(), e = Math.max(e, 0), i = Math.min(i, this._bufferService.buffer.lines.length - 1), this._model.selectionStart = [0, e], this._model.selectionEnd = [this._bufferService.cols, i], this.refresh(), this._onSelectionChange.fire();
  }
  _handleTrim(e) {
    this._model.handleTrim(e) && this.refresh();
  }
  _getMouseBufferCoords(e) {
    let i = this._mouseService.getCoords(e, this._screenElement, this._bufferService.cols, this._bufferService.rows, true);
    if (i) return i[0]--, i[1]--, i[1] += this._bufferService.buffer.ydisp, i;
  }
  _getMouseEventScrollAmount(e) {
    let i = Ci(this._coreBrowserService.window, e, this._screenElement)[1], r = this._renderService.dimensions.css.canvas.height;
    return i >= 0 && i <= r ? 0 : (i > r && (i -= r), i = Math.min(Math.max(i, -Ds), Ds), i /= Ds, i / Math.abs(i) + Math.round(i * (Ya - 1)));
  }
  shouldForceSelection(e) {
    return Zt ? e.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection : e.shiftKey;
  }
  handleMouseDown(e) {
    if (this._mouseDownTimeStamp = e.timeStamp, !(e.button === 2 && this.hasSelection) && e.button === 0) {
      if (!this._enabled) {
        if (!this.shouldForceSelection(e)) return;
        e.stopPropagation();
      }
      e.preventDefault(), this._dragScrollAmount = 0, this._enabled && e.shiftKey ? this._handleIncrementalClick(e) : e.detail === 1 ? this._handleSingleClick(e) : e.detail === 2 ? this._handleDoubleClick(e) : e.detail === 3 && this._handleTripleClick(e), this._addMouseDownListeners(), this.refresh(true);
    }
  }
  _addMouseDownListeners() {
    this._screenElement.ownerDocument && (this._screenElement.ownerDocument.addEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.addEventListener("mouseup", this._mouseUpListener)), this._dragScrollIntervalTimer = this._coreBrowserService.window.setInterval(() => this._dragScroll(), ja);
  }
  _removeMouseDownListeners() {
    this._screenElement.ownerDocument && (this._screenElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.removeEventListener("mouseup", this._mouseUpListener)), this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer), this._dragScrollIntervalTimer = void 0;
  }
  _handleIncrementalClick(e) {
    this._model.selectionStart && (this._model.selectionEnd = this._getMouseBufferCoords(e));
  }
  _handleSingleClick(e) {
    if (this._model.selectionStartLength = 0, this._model.isSelectAllActive = false, this._activeSelectionMode = this.shouldColumnSelect(e) ? 3 : 0, this._model.selectionStart = this._getMouseBufferCoords(e), !this._model.selectionStart) return;
    this._model.selectionEnd = void 0;
    let i = this._bufferService.buffer.lines.get(this._model.selectionStart[1]);
    i && i.length !== this._model.selectionStart[0] && i.hasWidth(this._model.selectionStart[0]) === 0 && this._model.selectionStart[0]++;
  }
  _handleDoubleClick(e) {
    this._selectWordAtCursor(e, true) && (this._activeSelectionMode = 1);
  }
  _handleTripleClick(e) {
    let i = this._getMouseBufferCoords(e);
    i && (this._activeSelectionMode = 2, this._selectLineAt(i[1]));
  }
  shouldColumnSelect(e) {
    return e.altKey && !(Zt && this._optionsService.rawOptions.macOptionClickForcesSelection);
  }
  _handleMouseMove(e) {
    if (e.stopImmediatePropagation(), !this._model.selectionStart) return;
    let i = this._model.selectionEnd ? [this._model.selectionEnd[0], this._model.selectionEnd[1]] : null;
    if (this._model.selectionEnd = this._getMouseBufferCoords(e), !this._model.selectionEnd) {
      this.refresh(true);
      return;
    }
    this._activeSelectionMode === 2 ? this._model.selectionEnd[1] < this._model.selectionStart[1] ? this._model.selectionEnd[0] = 0 : this._model.selectionEnd[0] = this._bufferService.cols : this._activeSelectionMode === 1 && this._selectToWordAt(this._model.selectionEnd), this._dragScrollAmount = this._getMouseEventScrollAmount(e), this._activeSelectionMode !== 3 && (this._dragScrollAmount > 0 ? this._model.selectionEnd[0] = this._bufferService.cols : this._dragScrollAmount < 0 && (this._model.selectionEnd[0] = 0));
    let r = this._bufferService.buffer;
    if (this._model.selectionEnd[1] < r.lines.length) {
      let n = r.lines.get(this._model.selectionEnd[1]);
      n && n.hasWidth(this._model.selectionEnd[0]) === 0 && this._model.selectionEnd[0] < this._bufferService.cols && this._model.selectionEnd[0]++;
    }
    (!i || i[0] !== this._model.selectionEnd[0] || i[1] !== this._model.selectionEnd[1]) && this.refresh(true);
  }
  _dragScroll() {
    if (!(!this._model.selectionEnd || !this._model.selectionStart) && this._dragScrollAmount) {
      this._onRequestScrollLines.fire({ amount: this._dragScrollAmount, suppressScrollEvent: false });
      let e = this._bufferService.buffer;
      this._dragScrollAmount > 0 ? (this._activeSelectionMode !== 3 && (this._model.selectionEnd[0] = this._bufferService.cols), this._model.selectionEnd[1] = Math.min(e.ydisp + this._bufferService.rows, e.lines.length - 1)) : (this._activeSelectionMode !== 3 && (this._model.selectionEnd[0] = 0), this._model.selectionEnd[1] = e.ydisp), this.refresh();
    }
  }
  _handleMouseUp(e) {
    let i = e.timeStamp - this._mouseDownTimeStamp;
    if (this._removeMouseDownListeners(), this.selectionText.length <= 1 && i < Xa && e.altKey && this._optionsService.rawOptions.altClickMovesCursor) {
      if (this._bufferService.buffer.ybase === this._bufferService.buffer.ydisp) {
        let r = this._mouseService.getCoords(e, this._element, this._bufferService.cols, this._bufferService.rows, false);
        if (r && r[0] !== void 0 && r[1] !== void 0) {
          let n = Jo(r[0] - 1, r[1] - 1, this._bufferService, this._coreService.decPrivateModes.applicationCursorKeys);
          this._coreService.triggerDataEvent(n, true);
        }
      }
    } else this._fireEventIfSelectionChanged();
  }
  _fireEventIfSelectionChanged() {
    let e = this._model.finalSelectionStart, i = this._model.finalSelectionEnd, r = !!e && !!i && (e[0] !== i[0] || e[1] !== i[1]);
    if (!r) {
      this._oldHasSelection && this._fireOnSelectionChange(e, i, r);
      return;
    }
    !e || !i || (!this._oldSelectionStart || !this._oldSelectionEnd || e[0] !== this._oldSelectionStart[0] || e[1] !== this._oldSelectionStart[1] || i[0] !== this._oldSelectionEnd[0] || i[1] !== this._oldSelectionEnd[1]) && this._fireOnSelectionChange(e, i, r);
  }
  _fireOnSelectionChange(e, i, r) {
    this._oldSelectionStart = e, this._oldSelectionEnd = i, this._oldHasSelection = r, this._onSelectionChange.fire();
  }
  _handleBufferActivate(e) {
    this.clearSelection(), this._trimListener.dispose(), this._trimListener = e.activeBuffer.lines.onTrim((i) => this._handleTrim(i));
  }
  _convertViewportColToCharacterIndex(e, i) {
    let r = i;
    for (let n = 0; i >= n; n++) {
      let o2 = e.loadCell(n, this._workCell).getChars().length;
      this._workCell.getWidth() === 0 ? r-- : o2 > 1 && i !== n && (r += o2 - 1);
    }
    return r;
  }
  setSelection(e, i, r) {
    this._model.clearSelection(), this._removeMouseDownListeners(), this._model.selectionStart = [e, i], this._model.selectionStartLength = r, this.refresh(), this._fireEventIfSelectionChanged();
  }
  rightClickSelect(e) {
    this._isClickInSelection(e) || (this._selectWordAtCursor(e, false) && this.refresh(true), this._fireEventIfSelectionChanged());
  }
  _getWordAt(e, i, r = true, n = true) {
    if (e[0] >= this._bufferService.cols) return;
    let o2 = this._bufferService.buffer, l = o2.lines.get(e[1]);
    if (!l) return;
    let a = o2.translateBufferLineToString(e[1], false), u = this._convertViewportColToCharacterIndex(l, e[0]), h2 = u, c = e[0] - u, d = 0, _2 = 0, p = 0, m = 0;
    if (a.charAt(u) === " ") {
      for (; u > 0 && a.charAt(u - 1) === " "; ) u--;
      for (; h2 < a.length && a.charAt(h2 + 1) === " "; ) h2++;
    } else {
      let R = e[0], O = e[0];
      l.getWidth(R) === 0 && (d++, R--), l.getWidth(O) === 2 && (_2++, O++);
      let I = l.getString(O).length;
      for (I > 1 && (m += I - 1, h2 += I - 1); R > 0 && u > 0 && !this._isCharWordSeparator(l.loadCell(R - 1, this._workCell)); ) {
        l.loadCell(R - 1, this._workCell);
        let k = this._workCell.getChars().length;
        this._workCell.getWidth() === 0 ? (d++, R--) : k > 1 && (p += k - 1, u -= k - 1), u--, R--;
      }
      for (; O < l.length && h2 + 1 < a.length && !this._isCharWordSeparator(l.loadCell(O + 1, this._workCell)); ) {
        l.loadCell(O + 1, this._workCell);
        let k = this._workCell.getChars().length;
        this._workCell.getWidth() === 2 ? (_2++, O++) : k > 1 && (m += k - 1, h2 += k - 1), h2++, O++;
      }
    }
    h2++;
    let f = u + c - d + p, A = Math.min(this._bufferService.cols, h2 - u + d + _2 - p - m);
    if (!(!i && a.slice(u, h2).trim() === "")) {
      if (r && f === 0 && l.getCodePoint(0) !== 32) {
        let R = o2.lines.get(e[1] - 1);
        if (R && l.isWrapped && R.getCodePoint(this._bufferService.cols - 1) !== 32) {
          let O = this._getWordAt([this._bufferService.cols - 1, e[1] - 1], false, true, false);
          if (O) {
            let I = this._bufferService.cols - O.start;
            f -= I, A += I;
          }
        }
      }
      if (n && f + A === this._bufferService.cols && l.getCodePoint(this._bufferService.cols - 1) !== 32) {
        let R = o2.lines.get(e[1] + 1);
        if (R?.isWrapped && R.getCodePoint(0) !== 32) {
          let O = this._getWordAt([0, e[1] + 1], false, false, true);
          O && (A += O.length);
        }
      }
      return { start: f, length: A };
    }
  }
  _selectWordAt(e, i) {
    let r = this._getWordAt(e, i);
    if (r) {
      for (; r.start < 0; ) r.start += this._bufferService.cols, e[1]--;
      this._model.selectionStart = [r.start, e[1]], this._model.selectionStartLength = r.length;
    }
  }
  _selectToWordAt(e) {
    let i = this._getWordAt(e, true);
    if (i) {
      let r = e[1];
      for (; i.start < 0; ) i.start += this._bufferService.cols, r--;
      if (!this._model.areSelectionValuesReversed()) for (; i.start + i.length > this._bufferService.cols; ) i.length -= this._bufferService.cols, r++;
      this._model.selectionEnd = [this._model.areSelectionValuesReversed() ? i.start : i.start + i.length, r];
    }
  }
  _isCharWordSeparator(e) {
    return e.getWidth() === 0 ? false : this._optionsService.rawOptions.wordSeparator.indexOf(e.getChars()) >= 0;
  }
  _selectLineAt(e) {
    let i = this._bufferService.buffer.getWrappedRangeForLine(e), r = { start: { x: 0, y: i.first }, end: { x: this._bufferService.cols - 1, y: i.last } };
    this._model.selectionStart = [0, i.first], this._model.selectionEnd = void 0, this._model.selectionStartLength = ws(r, this._bufferService.cols);
  }
};
ei = M([S(3, F), S(4, ge), S(5, Dt), S(6, H), S(7, ce), S(8, ae)], ei);
var Hi = class {
  constructor() {
    this._data = {};
  }
  set(t, e, i) {
    this._data[t] || (this._data[t] = {}), this._data[t][e] = i;
  }
  get(t, e) {
    return this._data[t] ? this._data[t][e] : void 0;
  }
  clear() {
    this._data = {};
  }
};
var Wi = class {
  constructor() {
    this._color = new Hi();
    this._css = new Hi();
  }
  setCss(t, e, i) {
    this._css.set(t, e, i);
  }
  getCss(t, e) {
    return this._css.get(t, e);
  }
  setColor(t, e, i) {
    this._color.set(t, e, i);
  }
  getColor(t, e) {
    return this._color.get(t, e);
  }
  clear() {
    this._color.clear(), this._css.clear();
  }
};
var re = Object.freeze((() => {
  let s15 = [z.toColor("#2e3436"), z.toColor("#cc0000"), z.toColor("#4e9a06"), z.toColor("#c4a000"), z.toColor("#3465a4"), z.toColor("#75507b"), z.toColor("#06989a"), z.toColor("#d3d7cf"), z.toColor("#555753"), z.toColor("#ef2929"), z.toColor("#8ae234"), z.toColor("#fce94f"), z.toColor("#729fcf"), z.toColor("#ad7fa8"), z.toColor("#34e2e2"), z.toColor("#eeeeec")], t = [0, 95, 135, 175, 215, 255];
  for (let e = 0; e < 216; e++) {
    let i = t[e / 36 % 6 | 0], r = t[e / 6 % 6 | 0], n = t[e % 6];
    s15.push({ css: j.toCss(i, r, n), rgba: j.toRgba(i, r, n) });
  }
  for (let e = 0; e < 24; e++) {
    let i = 8 + e * 10;
    s15.push({ css: j.toCss(i, i, i), rgba: j.toRgba(i, i, i) });
  }
  return s15;
})());
var St = z.toColor("#ffffff");
var Ki = z.toColor("#000000");
var tl = z.toColor("#ffffff");
var il = Ki;
var Ui = { css: "rgba(255, 255, 255, 0.3)", rgba: 4294967117 };
var Qa = St;
var ti = class extends D {
  constructor(e) {
    super();
    this._optionsService = e;
    this._contrastCache = new Wi();
    this._halfContrastCache = new Wi();
    this._onChangeColors = this._register(new v());
    this.onChangeColors = this._onChangeColors.event;
    this._colors = { foreground: St, background: Ki, cursor: tl, cursorAccent: il, selectionForeground: void 0, selectionBackgroundTransparent: Ui, selectionBackgroundOpaque: U.blend(Ki, Ui), selectionInactiveBackgroundTransparent: Ui, selectionInactiveBackgroundOpaque: U.blend(Ki, Ui), scrollbarSliderBackground: U.opacity(St, 0.2), scrollbarSliderHoverBackground: U.opacity(St, 0.4), scrollbarSliderActiveBackground: U.opacity(St, 0.5), overviewRulerBorder: St, ansi: re.slice(), contrastCache: this._contrastCache, halfContrastCache: this._halfContrastCache }, this._updateRestoreColors(), this._setTheme(this._optionsService.rawOptions.theme), this._register(this._optionsService.onSpecificOptionChange("minimumContrastRatio", () => this._contrastCache.clear())), this._register(this._optionsService.onSpecificOptionChange("theme", () => this._setTheme(this._optionsService.rawOptions.theme)));
  }
  get colors() {
    return this._colors;
  }
  _setTheme(e = {}) {
    let i = this._colors;
    if (i.foreground = K(e.foreground, St), i.background = K(e.background, Ki), i.cursor = U.blend(i.background, K(e.cursor, tl)), i.cursorAccent = U.blend(i.background, K(e.cursorAccent, il)), i.selectionBackgroundTransparent = K(e.selectionBackground, Ui), i.selectionBackgroundOpaque = U.blend(i.background, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundTransparent = K(e.selectionInactiveBackground, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundOpaque = U.blend(i.background, i.selectionInactiveBackgroundTransparent), i.selectionForeground = e.selectionForeground ? K(e.selectionForeground, ps) : void 0, i.selectionForeground === ps && (i.selectionForeground = void 0), U.isOpaque(i.selectionBackgroundTransparent) && (i.selectionBackgroundTransparent = U.opacity(i.selectionBackgroundTransparent, 0.3)), U.isOpaque(i.selectionInactiveBackgroundTransparent) && (i.selectionInactiveBackgroundTransparent = U.opacity(i.selectionInactiveBackgroundTransparent, 0.3)), i.scrollbarSliderBackground = K(e.scrollbarSliderBackground, U.opacity(i.foreground, 0.2)), i.scrollbarSliderHoverBackground = K(e.scrollbarSliderHoverBackground, U.opacity(i.foreground, 0.4)), i.scrollbarSliderActiveBackground = K(e.scrollbarSliderActiveBackground, U.opacity(i.foreground, 0.5)), i.overviewRulerBorder = K(e.overviewRulerBorder, Qa), i.ansi = re.slice(), i.ansi[0] = K(e.black, re[0]), i.ansi[1] = K(e.red, re[1]), i.ansi[2] = K(e.green, re[2]), i.ansi[3] = K(e.yellow, re[3]), i.ansi[4] = K(e.blue, re[4]), i.ansi[5] = K(e.magenta, re[5]), i.ansi[6] = K(e.cyan, re[6]), i.ansi[7] = K(e.white, re[7]), i.ansi[8] = K(e.brightBlack, re[8]), i.ansi[9] = K(e.brightRed, re[9]), i.ansi[10] = K(e.brightGreen, re[10]), i.ansi[11] = K(e.brightYellow, re[11]), i.ansi[12] = K(e.brightBlue, re[12]), i.ansi[13] = K(e.brightMagenta, re[13]), i.ansi[14] = K(e.brightCyan, re[14]), i.ansi[15] = K(e.brightWhite, re[15]), e.extendedAnsi) {
      let r = Math.min(i.ansi.length - 16, e.extendedAnsi.length);
      for (let n = 0; n < r; n++) i.ansi[n + 16] = K(e.extendedAnsi[n], re[n + 16]);
    }
    this._contrastCache.clear(), this._halfContrastCache.clear(), this._updateRestoreColors(), this._onChangeColors.fire(this.colors);
  }
  restoreColor(e) {
    this._restoreColor(e), this._onChangeColors.fire(this.colors);
  }
  _restoreColor(e) {
    if (e === void 0) {
      for (let i = 0; i < this._restoreColors.ansi.length; ++i) this._colors.ansi[i] = this._restoreColors.ansi[i];
      return;
    }
    switch (e) {
      case 256:
        this._colors.foreground = this._restoreColors.foreground;
        break;
      case 257:
        this._colors.background = this._restoreColors.background;
        break;
      case 258:
        this._colors.cursor = this._restoreColors.cursor;
        break;
      default:
        this._colors.ansi[e] = this._restoreColors.ansi[e];
    }
  }
  modifyColors(e) {
    e(this._colors), this._onChangeColors.fire(this.colors);
  }
  _updateRestoreColors() {
    this._restoreColors = { foreground: this._colors.foreground, background: this._colors.background, cursor: this._colors.cursor, ansi: this._colors.ansi.slice() };
  }
};
ti = M([S(0, H)], ti);
function K(s15, t) {
  if (s15 !== void 0) try {
    return z.toColor(s15);
  } catch {
  }
  return t;
}
var Rs = class {
  constructor(...t) {
    this._entries = /* @__PURE__ */ new Map();
    for (let [e, i] of t) this.set(e, i);
  }
  set(t, e) {
    let i = this._entries.get(t);
    return this._entries.set(t, e), i;
  }
  forEach(t) {
    for (let [e, i] of this._entries.entries()) t(e, i);
  }
  has(t) {
    return this._entries.has(t);
  }
  get(t) {
    return this._entries.get(t);
  }
};
var ln = class {
  constructor() {
    this._services = new Rs();
    this._services.set(xt, this);
  }
  setService(t, e) {
    this._services.set(t, e);
  }
  getService(t) {
    return this._services.get(t);
  }
  createInstance(t, ...e) {
    let i = Xs(t).sort((o2, l) => o2.index - l.index), r = [];
    for (let o2 of i) {
      let l = this._services.get(o2.id);
      if (!l) throw new Error(`[createInstance] ${t.name} depends on UNKNOWN service ${o2.id._id}.`);
      r.push(l);
    }
    let n = i.length > 0 ? i[0].index : e.length;
    if (e.length !== n) throw new Error(`[createInstance] First service dependency of ${t.name} at position ${n + 1} conflicts with ${e.length} static arguments`);
    return new t(...e, ...r);
  }
};
var ec = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, off: 5 };
var tc = "xterm.js: ";
var ii = class extends D {
  constructor(e) {
    super();
    this._optionsService = e;
    this._logLevel = 5;
    this._updateLogLevel(), this._register(this._optionsService.onSpecificOptionChange("logLevel", () => this._updateLogLevel())), ic = this;
  }
  get logLevel() {
    return this._logLevel;
  }
  _updateLogLevel() {
    this._logLevel = ec[this._optionsService.rawOptions.logLevel];
  }
  _evalLazyOptionalParams(e) {
    for (let i = 0; i < e.length; i++) typeof e[i] == "function" && (e[i] = e[i]());
  }
  _log(e, i, r) {
    this._evalLazyOptionalParams(r), e.call(console, (this._optionsService.options.logger ? "" : tc) + i, ...r);
  }
  trace(e, ...i) {
    this._logLevel <= 0 && this._log(this._optionsService.options.logger?.trace.bind(this._optionsService.options.logger) ?? console.log, e, i);
  }
  debug(e, ...i) {
    this._logLevel <= 1 && this._log(this._optionsService.options.logger?.debug.bind(this._optionsService.options.logger) ?? console.log, e, i);
  }
  info(e, ...i) {
    this._logLevel <= 2 && this._log(this._optionsService.options.logger?.info.bind(this._optionsService.options.logger) ?? console.info, e, i);
  }
  warn(e, ...i) {
    this._logLevel <= 3 && this._log(this._optionsService.options.logger?.warn.bind(this._optionsService.options.logger) ?? console.warn, e, i);
  }
  error(e, ...i) {
    this._logLevel <= 4 && this._log(this._optionsService.options.logger?.error.bind(this._optionsService.options.logger) ?? console.error, e, i);
  }
};
ii = M([S(0, H)], ii);
var ic;
var zi = class extends D {
  constructor(e) {
    super();
    this._maxLength = e;
    this.onDeleteEmitter = this._register(new v());
    this.onDelete = this.onDeleteEmitter.event;
    this.onInsertEmitter = this._register(new v());
    this.onInsert = this.onInsertEmitter.event;
    this.onTrimEmitter = this._register(new v());
    this.onTrim = this.onTrimEmitter.event;
    this._array = new Array(this._maxLength), this._startIndex = 0, this._length = 0;
  }
  get maxLength() {
    return this._maxLength;
  }
  set maxLength(e) {
    if (this._maxLength === e) return;
    let i = new Array(e);
    for (let r = 0; r < Math.min(e, this.length); r++) i[r] = this._array[this._getCyclicIndex(r)];
    this._array = i, this._maxLength = e, this._startIndex = 0;
  }
  get length() {
    return this._length;
  }
  set length(e) {
    if (e > this._length) for (let i = this._length; i < e; i++) this._array[i] = void 0;
    this._length = e;
  }
  get(e) {
    return this._array[this._getCyclicIndex(e)];
  }
  set(e, i) {
    this._array[this._getCyclicIndex(e)] = i;
  }
  push(e) {
    this._array[this._getCyclicIndex(this._length)] = e, this._length === this._maxLength ? (this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1)) : this._length++;
  }
  recycle() {
    if (this._length !== this._maxLength) throw new Error("Can only recycle when the buffer is full");
    return this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1), this._array[this._getCyclicIndex(this._length - 1)];
  }
  get isFull() {
    return this._length === this._maxLength;
  }
  pop() {
    return this._array[this._getCyclicIndex(this._length-- - 1)];
  }
  splice(e, i, ...r) {
    if (i) {
      for (let n = e; n < this._length - i; n++) this._array[this._getCyclicIndex(n)] = this._array[this._getCyclicIndex(n + i)];
      this._length -= i, this.onDeleteEmitter.fire({ index: e, amount: i });
    }
    for (let n = this._length - 1; n >= e; n--) this._array[this._getCyclicIndex(n + r.length)] = this._array[this._getCyclicIndex(n)];
    for (let n = 0; n < r.length; n++) this._array[this._getCyclicIndex(e + n)] = r[n];
    if (r.length && this.onInsertEmitter.fire({ index: e, amount: r.length }), this._length + r.length > this._maxLength) {
      let n = this._length + r.length - this._maxLength;
      this._startIndex += n, this._length = this._maxLength, this.onTrimEmitter.fire(n);
    } else this._length += r.length;
  }
  trimStart(e) {
    e > this._length && (e = this._length), this._startIndex += e, this._length -= e, this.onTrimEmitter.fire(e);
  }
  shiftElements(e, i, r) {
    if (!(i <= 0)) {
      if (e < 0 || e >= this._length) throw new Error("start argument out of range");
      if (e + r < 0) throw new Error("Cannot shift elements in list beyond index 0");
      if (r > 0) {
        for (let o2 = i - 1; o2 >= 0; o2--) this.set(e + o2 + r, this.get(e + o2));
        let n = e + i + r - this._length;
        if (n > 0) for (this._length += n; this._length > this._maxLength; ) this._length--, this._startIndex++, this.onTrimEmitter.fire(1);
      } else for (let n = 0; n < i; n++) this.set(e + n + r, this.get(e + n));
    }
  }
  _getCyclicIndex(e) {
    return (this._startIndex + e) % this._maxLength;
  }
};
var B = 3;
var X = Object.freeze(new De());
var an = 0;
var Ls = 2;
var Ze = class s12 {
  constructor(t, e, i = false) {
    this.isWrapped = i;
    this._combined = {};
    this._extendedAttrs = {};
    this._data = new Uint32Array(t * B);
    let r = e || q.fromCharData([0, ir, 1, 0]);
    for (let n = 0; n < t; ++n) this.setCell(n, r);
    this.length = t;
  }
  get(t) {
    let e = this._data[t * B + 0], i = e & 2097151;
    return [this._data[t * B + 1], e & 2097152 ? this._combined[t] : i ? Ce(i) : "", e >> 22, e & 2097152 ? this._combined[t].charCodeAt(this._combined[t].length - 1) : i];
  }
  set(t, e) {
    this._data[t * B + 1] = e[0], e[1].length > 1 ? (this._combined[t] = e[1], this._data[t * B + 0] = t | 2097152 | e[2] << 22) : this._data[t * B + 0] = e[1].charCodeAt(0) | e[2] << 22;
  }
  getWidth(t) {
    return this._data[t * B + 0] >> 22;
  }
  hasWidth(t) {
    return this._data[t * B + 0] & 12582912;
  }
  getFg(t) {
    return this._data[t * B + 1];
  }
  getBg(t) {
    return this._data[t * B + 2];
  }
  hasContent(t) {
    return this._data[t * B + 0] & 4194303;
  }
  getCodePoint(t) {
    let e = this._data[t * B + 0];
    return e & 2097152 ? this._combined[t].charCodeAt(this._combined[t].length - 1) : e & 2097151;
  }
  isCombined(t) {
    return this._data[t * B + 0] & 2097152;
  }
  getString(t) {
    let e = this._data[t * B + 0];
    return e & 2097152 ? this._combined[t] : e & 2097151 ? Ce(e & 2097151) : "";
  }
  isProtected(t) {
    return this._data[t * B + 2] & 536870912;
  }
  loadCell(t, e) {
    return an = t * B, e.content = this._data[an + 0], e.fg = this._data[an + 1], e.bg = this._data[an + 2], e.content & 2097152 && (e.combinedData = this._combined[t]), e.bg & 268435456 && (e.extended = this._extendedAttrs[t]), e;
  }
  setCell(t, e) {
    e.content & 2097152 && (this._combined[t] = e.combinedData), e.bg & 268435456 && (this._extendedAttrs[t] = e.extended), this._data[t * B + 0] = e.content, this._data[t * B + 1] = e.fg, this._data[t * B + 2] = e.bg;
  }
  setCellFromCodepoint(t, e, i, r) {
    r.bg & 268435456 && (this._extendedAttrs[t] = r.extended), this._data[t * B + 0] = e | i << 22, this._data[t * B + 1] = r.fg, this._data[t * B + 2] = r.bg;
  }
  addCodepointToCell(t, e, i) {
    let r = this._data[t * B + 0];
    r & 2097152 ? this._combined[t] += Ce(e) : r & 2097151 ? (this._combined[t] = Ce(r & 2097151) + Ce(e), r &= -2097152, r |= 2097152) : r = e | 1 << 22, i && (r &= -12582913, r |= i << 22), this._data[t * B + 0] = r;
  }
  insertCells(t, e, i) {
    if (t %= this.length, t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length - t) {
      let r = new q();
      for (let n = this.length - t - e - 1; n >= 0; --n) this.setCell(t + e + n, this.loadCell(t + n, r));
      for (let n = 0; n < e; ++n) this.setCell(t + n, i);
    } else for (let r = t; r < this.length; ++r) this.setCell(r, i);
    this.getWidth(this.length - 1) === 2 && this.setCellFromCodepoint(this.length - 1, 0, 1, i);
  }
  deleteCells(t, e, i) {
    if (t %= this.length, e < this.length - t) {
      let r = new q();
      for (let n = 0; n < this.length - t - e; ++n) this.setCell(t + n, this.loadCell(t + e + n, r));
      for (let n = this.length - e; n < this.length; ++n) this.setCell(n, i);
    } else for (let r = t; r < this.length; ++r) this.setCell(r, i);
    t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), this.getWidth(t) === 0 && !this.hasContent(t) && this.setCellFromCodepoint(t, 0, 1, i);
  }
  replaceCells(t, e, i, r = false) {
    if (r) {
      for (t && this.getWidth(t - 1) === 2 && !this.isProtected(t - 1) && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && !this.isProtected(e) && this.setCellFromCodepoint(e, 0, 1, i); t < e && t < this.length; ) this.isProtected(t) || this.setCell(t, i), t++;
      return;
    }
    for (t && this.getWidth(t - 1) === 2 && this.setCellFromCodepoint(t - 1, 0, 1, i), e < this.length && this.getWidth(e - 1) === 2 && this.setCellFromCodepoint(e, 0, 1, i); t < e && t < this.length; ) this.setCell(t++, i);
  }
  resize(t, e) {
    if (t === this.length) return this._data.length * 4 * Ls < this._data.buffer.byteLength;
    let i = t * B;
    if (t > this.length) {
      if (this._data.buffer.byteLength >= i * 4) this._data = new Uint32Array(this._data.buffer, 0, i);
      else {
        let r = new Uint32Array(i);
        r.set(this._data), this._data = r;
      }
      for (let r = this.length; r < t; ++r) this.setCell(r, e);
    } else {
      this._data = this._data.subarray(0, i);
      let r = Object.keys(this._combined);
      for (let o2 = 0; o2 < r.length; o2++) {
        let l = parseInt(r[o2], 10);
        l >= t && delete this._combined[l];
      }
      let n = Object.keys(this._extendedAttrs);
      for (let o2 = 0; o2 < n.length; o2++) {
        let l = parseInt(n[o2], 10);
        l >= t && delete this._extendedAttrs[l];
      }
    }
    return this.length = t, i * 4 * Ls < this._data.buffer.byteLength;
  }
  cleanupMemory() {
    if (this._data.length * 4 * Ls < this._data.buffer.byteLength) {
      let t = new Uint32Array(this._data.length);
      return t.set(this._data), this._data = t, 1;
    }
    return 0;
  }
  fill(t, e = false) {
    if (e) {
      for (let i = 0; i < this.length; ++i) this.isProtected(i) || this.setCell(i, t);
      return;
    }
    this._combined = {}, this._extendedAttrs = {};
    for (let i = 0; i < this.length; ++i) this.setCell(i, t);
  }
  copyFrom(t) {
    this.length !== t.length ? this._data = new Uint32Array(t._data) : this._data.set(t._data), this.length = t.length, this._combined = {};
    for (let e in t._combined) this._combined[e] = t._combined[e];
    this._extendedAttrs = {};
    for (let e in t._extendedAttrs) this._extendedAttrs[e] = t._extendedAttrs[e];
    this.isWrapped = t.isWrapped;
  }
  clone() {
    let t = new s12(0);
    t._data = new Uint32Array(this._data), t.length = this.length;
    for (let e in this._combined) t._combined[e] = this._combined[e];
    for (let e in this._extendedAttrs) t._extendedAttrs[e] = this._extendedAttrs[e];
    return t.isWrapped = this.isWrapped, t;
  }
  getTrimmedLength() {
    for (let t = this.length - 1; t >= 0; --t) if (this._data[t * B + 0] & 4194303) return t + (this._data[t * B + 0] >> 22);
    return 0;
  }
  getNoBgTrimmedLength() {
    for (let t = this.length - 1; t >= 0; --t) if (this._data[t * B + 0] & 4194303 || this._data[t * B + 2] & 50331648) return t + (this._data[t * B + 0] >> 22);
    return 0;
  }
  copyCellsFrom(t, e, i, r, n) {
    let o2 = t._data;
    if (n) for (let a = r - 1; a >= 0; a--) {
      for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o2[(e + a) * B + u];
      o2[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t._extendedAttrs[e + a]);
    }
    else for (let a = 0; a < r; a++) {
      for (let u = 0; u < B; u++) this._data[(i + a) * B + u] = o2[(e + a) * B + u];
      o2[(e + a) * B + 2] & 268435456 && (this._extendedAttrs[i + a] = t._extendedAttrs[e + a]);
    }
    let l = Object.keys(t._combined);
    for (let a = 0; a < l.length; a++) {
      let u = parseInt(l[a], 10);
      u >= e && (this._combined[u - e + i] = t._combined[u]);
    }
  }
  translateToString(t, e, i, r) {
    e = e ?? 0, i = i ?? this.length, t && (i = Math.min(i, this.getTrimmedLength())), r && (r.length = 0);
    let n = "";
    for (; e < i; ) {
      let o2 = this._data[e * B + 0], l = o2 & 2097151, a = o2 & 2097152 ? this._combined[e] : l ? Ce(l) : we;
      if (n += a, r) for (let u = 0; u < a.length; ++u) r.push(e);
      e += o2 >> 22 || 1;
    }
    return r && r.push(e), n;
  }
};
function sl(s15, t, e, i, r, n) {
  let o2 = [];
  for (let l = 0; l < s15.length - 1; l++) {
    let a = l, u = s15.get(++a);
    if (!u.isWrapped) continue;
    let h2 = [s15.get(l)];
    for (; a < s15.length && u.isWrapped; ) h2.push(u), u = s15.get(++a);
    if (!n && i >= l && i < a) {
      l += h2.length - 1;
      continue;
    }
    let c = 0, d = ri(h2, c, t), _2 = 1, p = 0;
    for (; _2 < h2.length; ) {
      let f = ri(h2, _2, t), A = f - p, R = e - d, O = Math.min(A, R);
      h2[c].copyCellsFrom(h2[_2], p, d, O, false), d += O, d === e && (c++, d = 0), p += O, p === f && (_2++, p = 0), d === 0 && c !== 0 && h2[c - 1].getWidth(e - 1) === 2 && (h2[c].copyCellsFrom(h2[c - 1], e - 1, d++, 1, false), h2[c - 1].setCell(e - 1, r));
    }
    h2[c].replaceCells(d, e, r);
    let m = 0;
    for (let f = h2.length - 1; f > 0 && (f > c || h2[f].getTrimmedLength() === 0); f--) m++;
    m > 0 && (o2.push(l + h2.length - m), o2.push(m)), l += h2.length - 1;
  }
  return o2;
}
function ol(s15, t) {
  let e = [], i = 0, r = t[i], n = 0;
  for (let o2 = 0; o2 < s15.length; o2++) if (r === o2) {
    let l = t[++i];
    s15.onDeleteEmitter.fire({ index: o2 - n, amount: l }), o2 += l - 1, n += l, r = t[++i];
  } else e.push(o2);
  return { layout: e, countRemoved: n };
}
function ll(s15, t) {
  let e = [];
  for (let i = 0; i < t.length; i++) e.push(s15.get(t[i]));
  for (let i = 0; i < e.length; i++) s15.set(i, e[i]);
  s15.length = t.length;
}
function al(s15, t, e) {
  let i = [], r = s15.map((a, u) => ri(s15, u, t)).reduce((a, u) => a + u), n = 0, o2 = 0, l = 0;
  for (; l < r; ) {
    if (r - l < e) {
      i.push(r - l);
      break;
    }
    n += e;
    let a = ri(s15, o2, t);
    n > a && (n -= a, o2++);
    let u = s15[o2].getWidth(n - 1) === 2;
    u && n--;
    let h2 = u ? e - 1 : e;
    i.push(h2), l += h2;
  }
  return i;
}
function ri(s15, t, e) {
  if (t === s15.length - 1) return s15[t].getTrimmedLength();
  let i = !s15[t].hasContent(e - 1) && s15[t].getWidth(e - 1) === 1, r = s15[t + 1].getWidth(0) === 2;
  return i && r ? e - 1 : e;
}
var un = class un2 {
  constructor(t) {
    this.line = t;
    this.isDisposed = false;
    this._disposables = [];
    this._id = un2._nextId++;
    this._onDispose = this.register(new v());
    this.onDispose = this._onDispose.event;
  }
  get id() {
    return this._id;
  }
  dispose() {
    this.isDisposed || (this.isDisposed = true, this.line = -1, this._onDispose.fire(), Ne(this._disposables), this._disposables.length = 0);
  }
  register(t) {
    return this._disposables.push(t), t;
  }
};
un._nextId = 1;
var cn = un;
var ne = {};
var Je = ne.B;
ne[0] = { "`": "\u25C6", a: "\u2592", b: "\u2409", c: "\u240C", d: "\u240D", e: "\u240A", f: "\xB0", g: "\xB1", h: "\u2424", i: "\u240B", j: "\u2518", k: "\u2510", l: "\u250C", m: "\u2514", n: "\u253C", o: "\u23BA", p: "\u23BB", q: "\u2500", r: "\u23BC", s: "\u23BD", t: "\u251C", u: "\u2524", v: "\u2534", w: "\u252C", x: "\u2502", y: "\u2264", z: "\u2265", "{": "\u03C0", "|": "\u2260", "}": "\xA3", "~": "\xB7" };
ne.A = { "#": "\xA3" };
ne.B = void 0;
ne[4] = { "#": "\xA3", "@": "\xBE", "[": "ij", "\\": "\xBD", "]": "|", "{": "\xA8", "|": "f", "}": "\xBC", "~": "\xB4" };
ne.C = ne[5] = { "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" };
ne.R = { "#": "\xA3", "@": "\xE0", "[": "\xB0", "\\": "\xE7", "]": "\xA7", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xA8" };
ne.Q = { "@": "\xE0", "[": "\xE2", "\\": "\xE7", "]": "\xEA", "^": "\xEE", "`": "\xF4", "{": "\xE9", "|": "\xF9", "}": "\xE8", "~": "\xFB" };
ne.K = { "@": "\xA7", "[": "\xC4", "\\": "\xD6", "]": "\xDC", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xDF" };
ne.Y = { "#": "\xA3", "@": "\xA7", "[": "\xB0", "\\": "\xE7", "]": "\xE9", "`": "\xF9", "{": "\xE0", "|": "\xF2", "}": "\xE8", "~": "\xEC" };
ne.E = ne[6] = { "@": "\xC4", "[": "\xC6", "\\": "\xD8", "]": "\xC5", "^": "\xDC", "`": "\xE4", "{": "\xE6", "|": "\xF8", "}": "\xE5", "~": "\xFC" };
ne.Z = { "#": "\xA3", "@": "\xA7", "[": "\xA1", "\\": "\xD1", "]": "\xBF", "{": "\xB0", "|": "\xF1", "}": "\xE7" };
ne.H = ne[7] = { "@": "\xC9", "[": "\xC4", "\\": "\xD6", "]": "\xC5", "^": "\xDC", "`": "\xE9", "{": "\xE4", "|": "\xF6", "}": "\xE5", "~": "\xFC" };
ne["="] = { "#": "\xF9", "@": "\xE0", "[": "\xE9", "\\": "\xE7", "]": "\xEA", "^": "\xEE", _: "\xE8", "`": "\xF4", "{": "\xE4", "|": "\xF6", "}": "\xFC", "~": "\xFB" };
var cl = 4294967295;
var $i = class {
  constructor(t, e, i) {
    this._hasScrollback = t;
    this._optionsService = e;
    this._bufferService = i;
    this.ydisp = 0;
    this.ybase = 0;
    this.y = 0;
    this.x = 0;
    this.tabs = {};
    this.savedY = 0;
    this.savedX = 0;
    this.savedCurAttrData = X.clone();
    this.savedCharset = Je;
    this.markers = [];
    this._nullCell = q.fromCharData([0, ir, 1, 0]);
    this._whitespaceCell = q.fromCharData([0, we, 1, 32]);
    this._isClearing = false;
    this._memoryCleanupQueue = new Jt();
    this._memoryCleanupPosition = 0;
    this._cols = this._bufferService.cols, this._rows = this._bufferService.rows, this.lines = new zi(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
  }
  getNullCell(t) {
    return t ? (this._nullCell.fg = t.fg, this._nullCell.bg = t.bg, this._nullCell.extended = t.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new rt()), this._nullCell;
  }
  getWhitespaceCell(t) {
    return t ? (this._whitespaceCell.fg = t.fg, this._whitespaceCell.bg = t.bg, this._whitespaceCell.extended = t.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new rt()), this._whitespaceCell;
  }
  getBlankLine(t, e) {
    return new Ze(this._bufferService.cols, this.getNullCell(t), e);
  }
  get hasScrollback() {
    return this._hasScrollback && this.lines.maxLength > this._rows;
  }
  get isCursorInViewport() {
    let e = this.ybase + this.y - this.ydisp;
    return e >= 0 && e < this._rows;
  }
  _getCorrectBufferLength(t) {
    if (!this._hasScrollback) return t;
    let e = t + this._optionsService.rawOptions.scrollback;
    return e > cl ? cl : e;
  }
  fillViewportRows(t) {
    if (this.lines.length === 0) {
      t === void 0 && (t = X);
      let e = this._rows;
      for (; e--; ) this.lines.push(this.getBlankLine(t));
    }
  }
  clear() {
    this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new zi(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
  }
  resize(t, e) {
    let i = this.getNullCell(X), r = 0, n = this._getCorrectBufferLength(e);
    if (n > this.lines.maxLength && (this.lines.maxLength = n), this.lines.length > 0) {
      if (this._cols < t) for (let l = 0; l < this.lines.length; l++) r += +this.lines.get(l).resize(t, i);
      let o2 = 0;
      if (this._rows < e) for (let l = this._rows; l < e; l++) this.lines.length < e + this.ybase && (this._optionsService.rawOptions.windowsMode || this._optionsService.rawOptions.windowsPty.backend !== void 0 || this._optionsService.rawOptions.windowsPty.buildNumber !== void 0 ? this.lines.push(new Ze(t, i)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + o2 + 1 ? (this.ybase--, o2++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new Ze(t, i)));
      else for (let l = this._rows; l > e; l--) this.lines.length > e + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
      if (n < this.lines.maxLength) {
        let l = this.lines.length - n;
        l > 0 && (this.lines.trimStart(l), this.ybase = Math.max(this.ybase - l, 0), this.ydisp = Math.max(this.ydisp - l, 0), this.savedY = Math.max(this.savedY - l, 0)), this.lines.maxLength = n;
      }
      this.x = Math.min(this.x, t - 1), this.y = Math.min(this.y, e - 1), o2 && (this.y += o2), this.savedX = Math.min(this.savedX, t - 1), this.scrollTop = 0;
    }
    if (this.scrollBottom = e - 1, this._isReflowEnabled && (this._reflow(t, e), this._cols > t)) for (let o2 = 0; o2 < this.lines.length; o2++) r += +this.lines.get(o2).resize(t, i);
    this._cols = t, this._rows = e, this._memoryCleanupQueue.clear(), r > 0.1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue(() => this._batchedMemoryCleanup()));
  }
  _batchedMemoryCleanup() {
    let t = true;
    this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, t = false);
    let e = 0;
    for (; this._memoryCleanupPosition < this.lines.length; ) if (e += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), e > 100) return true;
    return t;
  }
  get _isReflowEnabled() {
    let t = this._optionsService.rawOptions.windowsPty;
    return t && t.buildNumber ? this._hasScrollback && t.backend === "conpty" && t.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
  }
  _reflow(t, e) {
    this._cols !== t && (t > this._cols ? this._reflowLarger(t, e) : this._reflowSmaller(t, e));
  }
  _reflowLarger(t, e) {
    let i = this._optionsService.rawOptions.reflowCursorLine, r = sl(this.lines, this._cols, t, this.ybase + this.y, this.getNullCell(X), i);
    if (r.length > 0) {
      let n = ol(this.lines, r);
      ll(this.lines, n.layout), this._reflowLargerAdjustViewport(t, e, n.countRemoved);
    }
  }
  _reflowLargerAdjustViewport(t, e, i) {
    let r = this.getNullCell(X), n = i;
    for (; n-- > 0; ) this.ybase === 0 ? (this.y > 0 && this.y--, this.lines.length < e && this.lines.push(new Ze(t, r))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
    this.savedY = Math.max(this.savedY - i, 0);
  }
  _reflowSmaller(t, e) {
    let i = this._optionsService.rawOptions.reflowCursorLine, r = this.getNullCell(X), n = [], o2 = 0;
    for (let l = this.lines.length - 1; l >= 0; l--) {
      let a = this.lines.get(l);
      if (!a || !a.isWrapped && a.getTrimmedLength() <= t) continue;
      let u = [a];
      for (; a.isWrapped && l > 0; ) a = this.lines.get(--l), u.unshift(a);
      if (!i) {
        let I = this.ybase + this.y;
        if (I >= l && I < l + u.length) continue;
      }
      let h2 = u[u.length - 1].getTrimmedLength(), c = al(u, this._cols, t), d = c.length - u.length, _2;
      this.ybase === 0 && this.y !== this.lines.length - 1 ? _2 = Math.max(0, this.y - this.lines.maxLength + d) : _2 = Math.max(0, this.lines.length - this.lines.maxLength + d);
      let p = [];
      for (let I = 0; I < d; I++) {
        let k = this.getBlankLine(X, true);
        p.push(k);
      }
      p.length > 0 && (n.push({ start: l + u.length + o2, newLines: p }), o2 += p.length), u.push(...p);
      let m = c.length - 1, f = c[m];
      f === 0 && (m--, f = c[m]);
      let A = u.length - d - 1, R = h2;
      for (; A >= 0; ) {
        let I = Math.min(R, f);
        if (u[m] === void 0) break;
        if (u[m].copyCellsFrom(u[A], R - I, f - I, I, true), f -= I, f === 0 && (m--, f = c[m]), R -= I, R === 0) {
          A--;
          let k = Math.max(A, 0);
          R = ri(u, k, this._cols);
        }
      }
      for (let I = 0; I < u.length; I++) c[I] < t && u[I].setCell(c[I], r);
      let O = d - _2;
      for (; O-- > 0; ) this.ybase === 0 ? this.y < e - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + o2) - e && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
      this.savedY = Math.min(this.savedY + d, this.ybase + e - 1);
    }
    if (n.length > 0) {
      let l = [], a = [];
      for (let f = 0; f < this.lines.length; f++) a.push(this.lines.get(f));
      let u = this.lines.length, h2 = u - 1, c = 0, d = n[c];
      this.lines.length = Math.min(this.lines.maxLength, this.lines.length + o2);
      let _2 = 0;
      for (let f = Math.min(this.lines.maxLength - 1, u + o2 - 1); f >= 0; f--) if (d && d.start > h2 + _2) {
        for (let A = d.newLines.length - 1; A >= 0; A--) this.lines.set(f--, d.newLines[A]);
        f++, l.push({ index: h2 + 1, amount: d.newLines.length }), _2 += d.newLines.length, d = n[++c];
      } else this.lines.set(f, a[h2--]);
      let p = 0;
      for (let f = l.length - 1; f >= 0; f--) l[f].index += p, this.lines.onInsertEmitter.fire(l[f]), p += l[f].amount;
      let m = Math.max(0, u + o2 - this.lines.maxLength);
      m > 0 && this.lines.onTrimEmitter.fire(m);
    }
  }
  translateBufferLineToString(t, e, i = 0, r) {
    let n = this.lines.get(t);
    return n ? n.translateToString(e, i, r) : "";
  }
  getWrappedRangeForLine(t) {
    let e = t, i = t;
    for (; e > 0 && this.lines.get(e).isWrapped; ) e--;
    for (; i + 1 < this.lines.length && this.lines.get(i + 1).isWrapped; ) i++;
    return { first: e, last: i };
  }
  setupTabStops(t) {
    for (t != null ? this.tabs[t] || (t = this.prevStop(t)) : (this.tabs = {}, t = 0); t < this._cols; t += this._optionsService.rawOptions.tabStopWidth) this.tabs[t] = true;
  }
  prevStop(t) {
    for (t == null && (t = this.x); !this.tabs[--t] && t > 0; ) ;
    return t >= this._cols ? this._cols - 1 : t < 0 ? 0 : t;
  }
  nextStop(t) {
    for (t == null && (t = this.x); !this.tabs[++t] && t < this._cols; ) ;
    return t >= this._cols ? this._cols - 1 : t < 0 ? 0 : t;
  }
  clearMarkers(t) {
    this._isClearing = true;
    for (let e = 0; e < this.markers.length; e++) this.markers[e].line === t && (this.markers[e].dispose(), this.markers.splice(e--, 1));
    this._isClearing = false;
  }
  clearAllMarkers() {
    this._isClearing = true;
    for (let t = 0; t < this.markers.length; t++) this.markers[t].dispose();
    this.markers.length = 0, this._isClearing = false;
  }
  addMarker(t) {
    let e = new cn(t);
    return this.markers.push(e), e.register(this.lines.onTrim((i) => {
      e.line -= i, e.line < 0 && e.dispose();
    })), e.register(this.lines.onInsert((i) => {
      e.line >= i.index && (e.line += i.amount);
    })), e.register(this.lines.onDelete((i) => {
      e.line >= i.index && e.line < i.index + i.amount && e.dispose(), e.line > i.index && (e.line -= i.amount);
    })), e.register(e.onDispose(() => this._removeMarker(e))), e;
  }
  _removeMarker(t) {
    this._isClearing || this.markers.splice(this.markers.indexOf(t), 1);
  }
};
var hn = class extends D {
  constructor(e, i) {
    super();
    this._optionsService = e;
    this._bufferService = i;
    this._onBufferActivate = this._register(new v());
    this.onBufferActivate = this._onBufferActivate.event;
    this.reset(), this._register(this._optionsService.onSpecificOptionChange("scrollback", () => this.resize(this._bufferService.cols, this._bufferService.rows))), this._register(this._optionsService.onSpecificOptionChange("tabStopWidth", () => this.setupTabStops()));
  }
  reset() {
    this._normal = new $i(true, this._optionsService, this._bufferService), this._normal.fillViewportRows(), this._alt = new $i(false, this._optionsService, this._bufferService), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }), this.setupTabStops();
  }
  get alt() {
    return this._alt;
  }
  get active() {
    return this._activeBuffer;
  }
  get normal() {
    return this._normal;
  }
  activateNormalBuffer() {
    this._activeBuffer !== this._normal && (this._normal.x = this._alt.x, this._normal.y = this._alt.y, this._alt.clearAllMarkers(), this._alt.clear(), this._activeBuffer = this._normal, this._onBufferActivate.fire({ activeBuffer: this._normal, inactiveBuffer: this._alt }));
  }
  activateAltBuffer(e) {
    this._activeBuffer !== this._alt && (this._alt.fillViewportRows(e), this._alt.x = this._normal.x, this._alt.y = this._normal.y, this._activeBuffer = this._alt, this._onBufferActivate.fire({ activeBuffer: this._alt, inactiveBuffer: this._normal }));
  }
  resize(e, i) {
    this._normal.resize(e, i), this._alt.resize(e, i), this.setupTabStops(e);
  }
  setupTabStops(e) {
    this._normal.setupTabStops(e), this._alt.setupTabStops(e);
  }
};
var ks = 2;
var Cs = 1;
var ni = class extends D {
  constructor(e) {
    super();
    this.isUserScrolling = false;
    this._onResize = this._register(new v());
    this.onResize = this._onResize.event;
    this._onScroll = this._register(new v());
    this.onScroll = this._onScroll.event;
    this.cols = Math.max(e.rawOptions.cols || 0, ks), this.rows = Math.max(e.rawOptions.rows || 0, Cs), this.buffers = this._register(new hn(e, this)), this._register(this.buffers.onBufferActivate((i) => {
      this._onScroll.fire(i.activeBuffer.ydisp);
    }));
  }
  get buffer() {
    return this.buffers.active;
  }
  resize(e, i) {
    let r = this.cols !== e, n = this.rows !== i;
    this.cols = e, this.rows = i, this.buffers.resize(e, i), this._onResize.fire({ cols: e, rows: i, colsChanged: r, rowsChanged: n });
  }
  reset() {
    this.buffers.reset(), this.isUserScrolling = false;
  }
  scroll(e, i = false) {
    let r = this.buffer, n;
    n = this._cachedBlankLine, (!n || n.length !== this.cols || n.getFg(0) !== e.fg || n.getBg(0) !== e.bg) && (n = r.getBlankLine(e, i), this._cachedBlankLine = n), n.isWrapped = i;
    let o2 = r.ybase + r.scrollTop, l = r.ybase + r.scrollBottom;
    if (r.scrollTop === 0) {
      let a = r.lines.isFull;
      l === r.lines.length - 1 ? a ? r.lines.recycle().copyFrom(n) : r.lines.push(n.clone()) : r.lines.splice(l + 1, 0, n.clone()), a ? this.isUserScrolling && (r.ydisp = Math.max(r.ydisp - 1, 0)) : (r.ybase++, this.isUserScrolling || r.ydisp++);
    } else {
      let a = l - o2 + 1;
      r.lines.shiftElements(o2 + 1, a - 1, -1), r.lines.set(l, n.clone());
    }
    this.isUserScrolling || (r.ydisp = r.ybase), this._onScroll.fire(r.ydisp);
  }
  scrollLines(e, i) {
    let r = this.buffer;
    if (e < 0) {
      if (r.ydisp === 0) return;
      this.isUserScrolling = true;
    } else e + r.ydisp >= r.ybase && (this.isUserScrolling = false);
    let n = r.ydisp;
    r.ydisp = Math.max(Math.min(r.ydisp + e, r.ybase), 0), n !== r.ydisp && (i || this._onScroll.fire(r.ydisp));
  }
};
ni = M([S(0, H)], ni);
var si = { cols: 80, rows: 24, cursorBlink: false, cursorStyle: "block", cursorWidth: 1, cursorInactiveStyle: "outline", customGlyphs: true, drawBoldTextInBrightColors: true, documentOverride: null, fastScrollModifier: "alt", fastScrollSensitivity: 5, fontFamily: "monospace", fontSize: 15, fontWeight: "normal", fontWeightBold: "bold", ignoreBracketedPasteMode: false, lineHeight: 1, letterSpacing: 0, linkHandler: null, logLevel: "info", logger: null, scrollback: 1e3, scrollOnEraseInDisplay: false, scrollOnUserInput: true, scrollSensitivity: 1, screenReaderMode: false, smoothScrollDuration: 0, macOptionIsMeta: false, macOptionClickForcesSelection: false, minimumContrastRatio: 1, disableStdin: false, allowProposedApi: false, allowTransparency: false, tabStopWidth: 8, theme: {}, reflowCursorLine: false, rescaleOverlappingGlyphs: false, rightClickSelectsWord: Zt, windowOptions: {}, windowsMode: false, windowsPty: {}, wordSeparator: " ()[]{}',\"`", altClickMovesCursor: true, convertEol: false, termName: "xterm", cancelEvents: false, overviewRuler: {} };
var nc = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
var dn = class extends D {
  constructor(e) {
    super();
    this._onOptionChange = this._register(new v());
    this.onOptionChange = this._onOptionChange.event;
    let i = { ...si };
    for (let r in e) if (r in i) try {
      let n = e[r];
      i[r] = this._sanitizeAndValidateOption(r, n);
    } catch (n) {
      console.error(n);
    }
    this.rawOptions = i, this.options = { ...i }, this._setupOptions(), this._register(C(() => {
      this.rawOptions.linkHandler = null, this.rawOptions.documentOverride = null;
    }));
  }
  onSpecificOptionChange(e, i) {
    return this.onOptionChange((r) => {
      r === e && i(this.rawOptions[e]);
    });
  }
  onMultipleOptionChange(e, i) {
    return this.onOptionChange((r) => {
      e.indexOf(r) !== -1 && i();
    });
  }
  _setupOptions() {
    let e = (r) => {
      if (!(r in si)) throw new Error(`No option with key "${r}"`);
      return this.rawOptions[r];
    }, i = (r, n) => {
      if (!(r in si)) throw new Error(`No option with key "${r}"`);
      n = this._sanitizeAndValidateOption(r, n), this.rawOptions[r] !== n && (this.rawOptions[r] = n, this._onOptionChange.fire(r));
    };
    for (let r in this.rawOptions) {
      let n = { get: e.bind(this, r), set: i.bind(this, r) };
      Object.defineProperty(this.options, r, n);
    }
  }
  _sanitizeAndValidateOption(e, i) {
    switch (e) {
      case "cursorStyle":
        if (i || (i = si[e]), !sc(i)) throw new Error(`"${i}" is not a valid value for ${e}`);
        break;
      case "wordSeparator":
        i || (i = si[e]);
        break;
      case "fontWeight":
      case "fontWeightBold":
        if (typeof i == "number" && 1 <= i && i <= 1e3) break;
        i = nc.includes(i) ? i : si[e];
        break;
      case "cursorWidth":
        i = Math.floor(i);
      case "lineHeight":
      case "tabStopWidth":
        if (i < 1) throw new Error(`${e} cannot be less than 1, value: ${i}`);
        break;
      case "minimumContrastRatio":
        i = Math.max(1, Math.min(21, Math.round(i * 10) / 10));
        break;
      case "scrollback":
        if (i = Math.min(i, 4294967295), i < 0) throw new Error(`${e} cannot be less than 0, value: ${i}`);
        break;
      case "fastScrollSensitivity":
      case "scrollSensitivity":
        if (i <= 0) throw new Error(`${e} cannot be less than or equal to 0, value: ${i}`);
        break;
      case "rows":
      case "cols":
        if (!i && i !== 0) throw new Error(`${e} must be numeric, value: ${i}`);
        break;
      case "windowsPty":
        i = i ?? {};
        break;
    }
    return i;
  }
};
function sc(s15) {
  return s15 === "block" || s15 === "underline" || s15 === "bar";
}
function oi(s15, t = 5) {
  if (typeof s15 != "object") return s15;
  let e = Array.isArray(s15) ? [] : {};
  for (let i in s15) e[i] = t <= 1 ? s15[i] : s15[i] && oi(s15[i], t - 1);
  return e;
}
var ul = Object.freeze({ insertMode: false });
var hl = Object.freeze({ applicationCursorKeys: false, applicationKeypad: false, bracketedPasteMode: false, cursorBlink: void 0, cursorStyle: void 0, origin: false, reverseWraparound: false, sendFocus: false, synchronizedOutput: false, wraparound: true });
var li = class extends D {
  constructor(e, i, r) {
    super();
    this._bufferService = e;
    this._logService = i;
    this._optionsService = r;
    this.isCursorInitialized = false;
    this.isCursorHidden = false;
    this._onData = this._register(new v());
    this.onData = this._onData.event;
    this._onUserInput = this._register(new v());
    this.onUserInput = this._onUserInput.event;
    this._onBinary = this._register(new v());
    this.onBinary = this._onBinary.event;
    this._onRequestScrollToBottom = this._register(new v());
    this.onRequestScrollToBottom = this._onRequestScrollToBottom.event;
    this.modes = oi(ul), this.decPrivateModes = oi(hl);
  }
  reset() {
    this.modes = oi(ul), this.decPrivateModes = oi(hl);
  }
  triggerDataEvent(e, i = false) {
    if (this._optionsService.rawOptions.disableStdin) return;
    let r = this._bufferService.buffer;
    i && this._optionsService.rawOptions.scrollOnUserInput && r.ybase !== r.ydisp && this._onRequestScrollToBottom.fire(), i && this._onUserInput.fire(), this._logService.debug(`sending data "${e}"`), this._logService.trace("sending data (codes)", () => e.split("").map((n) => n.charCodeAt(0))), this._onData.fire(e);
  }
  triggerBinaryEvent(e) {
    this._optionsService.rawOptions.disableStdin || (this._logService.debug(`sending binary "${e}"`), this._logService.trace("sending binary (codes)", () => e.split("").map((i) => i.charCodeAt(0))), this._onBinary.fire(e));
  }
};
li = M([S(0, F), S(1, nr), S(2, H)], li);
var dl = { NONE: { events: 0, restrict: () => false }, X10: { events: 1, restrict: (s15) => s15.button === 4 || s15.action !== 1 ? false : (s15.ctrl = false, s15.alt = false, s15.shift = false, true) }, VT200: { events: 19, restrict: (s15) => s15.action !== 32 }, DRAG: { events: 23, restrict: (s15) => !(s15.action === 32 && s15.button === 3) }, ANY: { events: 31, restrict: (s15) => true } };
function Ms(s15, t) {
  let e = (s15.ctrl ? 16 : 0) | (s15.shift ? 4 : 0) | (s15.alt ? 8 : 0);
  return s15.button === 4 ? (e |= 64, e |= s15.action) : (e |= s15.button & 3, s15.button & 4 && (e |= 64), s15.button & 8 && (e |= 128), s15.action === 32 ? e |= 32 : s15.action === 0 && !t && (e |= 3)), e;
}
var Ps = String.fromCharCode;
var fl = { DEFAULT: (s15) => {
  let t = [Ms(s15, false) + 32, s15.col + 32, s15.row + 32];
  return t[0] > 255 || t[1] > 255 || t[2] > 255 ? "" : `\x1B[M${Ps(t[0])}${Ps(t[1])}${Ps(t[2])}`;
}, SGR: (s15) => {
  let t = s15.action === 0 && s15.button !== 4 ? "m" : "M";
  return `\x1B[<${Ms(s15, true)};${s15.col};${s15.row}${t}`;
}, SGR_PIXELS: (s15) => {
  let t = s15.action === 0 && s15.button !== 4 ? "m" : "M";
  return `\x1B[<${Ms(s15, true)};${s15.x};${s15.y}${t}`;
} };
var ai = class extends D {
  constructor(e, i, r) {
    super();
    this._bufferService = e;
    this._coreService = i;
    this._optionsService = r;
    this._protocols = {};
    this._encodings = {};
    this._activeProtocol = "";
    this._activeEncoding = "";
    this._lastEvent = null;
    this._wheelPartialScroll = 0;
    this._onProtocolChange = this._register(new v());
    this.onProtocolChange = this._onProtocolChange.event;
    for (let n of Object.keys(dl)) this.addProtocol(n, dl[n]);
    for (let n of Object.keys(fl)) this.addEncoding(n, fl[n]);
    this.reset();
  }
  addProtocol(e, i) {
    this._protocols[e] = i;
  }
  addEncoding(e, i) {
    this._encodings[e] = i;
  }
  get activeProtocol() {
    return this._activeProtocol;
  }
  get areMouseEventsActive() {
    return this._protocols[this._activeProtocol].events !== 0;
  }
  set activeProtocol(e) {
    if (!this._protocols[e]) throw new Error(`unknown protocol "${e}"`);
    this._activeProtocol = e, this._onProtocolChange.fire(this._protocols[e].events);
  }
  get activeEncoding() {
    return this._activeEncoding;
  }
  set activeEncoding(e) {
    if (!this._encodings[e]) throw new Error(`unknown encoding "${e}"`);
    this._activeEncoding = e;
  }
  reset() {
    this.activeProtocol = "NONE", this.activeEncoding = "DEFAULT", this._lastEvent = null, this._wheelPartialScroll = 0;
  }
  consumeWheelEvent(e, i, r) {
    if (e.deltaY === 0 || e.shiftKey || i === void 0 || r === void 0) return 0;
    let n = i / r, o2 = this._applyScrollModifier(e.deltaY, e);
    return e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? (o2 /= n + 0, Math.abs(e.deltaY) < 50 && (o2 *= 0.3), this._wheelPartialScroll += o2, o2 = Math.floor(Math.abs(this._wheelPartialScroll)) * (this._wheelPartialScroll > 0 ? 1 : -1), this._wheelPartialScroll %= 1) : e.deltaMode === WheelEvent.DOM_DELTA_PAGE && (o2 *= this._bufferService.rows), o2;
  }
  _applyScrollModifier(e, i) {
    return i.altKey || i.ctrlKey || i.shiftKey ? e * this._optionsService.rawOptions.fastScrollSensitivity * this._optionsService.rawOptions.scrollSensitivity : e * this._optionsService.rawOptions.scrollSensitivity;
  }
  triggerMouseEvent(e) {
    if (e.col < 0 || e.col >= this._bufferService.cols || e.row < 0 || e.row >= this._bufferService.rows || e.button === 4 && e.action === 32 || e.button === 3 && e.action !== 32 || e.button !== 4 && (e.action === 2 || e.action === 3) || (e.col++, e.row++, e.action === 32 && this._lastEvent && this._equalEvents(this._lastEvent, e, this._activeEncoding === "SGR_PIXELS")) || !this._protocols[this._activeProtocol].restrict(e)) return false;
    let i = this._encodings[this._activeEncoding](e);
    return i && (this._activeEncoding === "DEFAULT" ? this._coreService.triggerBinaryEvent(i) : this._coreService.triggerDataEvent(i, true)), this._lastEvent = e, true;
  }
  explainEvents(e) {
    return { down: !!(e & 1), up: !!(e & 2), drag: !!(e & 4), move: !!(e & 8), wheel: !!(e & 16) };
  }
  _equalEvents(e, i, r) {
    if (r) {
      if (e.x !== i.x || e.y !== i.y) return false;
    } else if (e.col !== i.col || e.row !== i.row) return false;
    return !(e.button !== i.button || e.action !== i.action || e.ctrl !== i.ctrl || e.alt !== i.alt || e.shift !== i.shift);
  }
};
ai = M([S(0, F), S(1, ge), S(2, H)], ai);
var Os = [[768, 879], [1155, 1158], [1160, 1161], [1425, 1469], [1471, 1471], [1473, 1474], [1476, 1477], [1479, 1479], [1536, 1539], [1552, 1557], [1611, 1630], [1648, 1648], [1750, 1764], [1767, 1768], [1770, 1773], [1807, 1807], [1809, 1809], [1840, 1866], [1958, 1968], [2027, 2035], [2305, 2306], [2364, 2364], [2369, 2376], [2381, 2381], [2385, 2388], [2402, 2403], [2433, 2433], [2492, 2492], [2497, 2500], [2509, 2509], [2530, 2531], [2561, 2562], [2620, 2620], [2625, 2626], [2631, 2632], [2635, 2637], [2672, 2673], [2689, 2690], [2748, 2748], [2753, 2757], [2759, 2760], [2765, 2765], [2786, 2787], [2817, 2817], [2876, 2876], [2879, 2879], [2881, 2883], [2893, 2893], [2902, 2902], [2946, 2946], [3008, 3008], [3021, 3021], [3134, 3136], [3142, 3144], [3146, 3149], [3157, 3158], [3260, 3260], [3263, 3263], [3270, 3270], [3276, 3277], [3298, 3299], [3393, 3395], [3405, 3405], [3530, 3530], [3538, 3540], [3542, 3542], [3633, 3633], [3636, 3642], [3655, 3662], [3761, 3761], [3764, 3769], [3771, 3772], [3784, 3789], [3864, 3865], [3893, 3893], [3895, 3895], [3897, 3897], [3953, 3966], [3968, 3972], [3974, 3975], [3984, 3991], [3993, 4028], [4038, 4038], [4141, 4144], [4146, 4146], [4150, 4151], [4153, 4153], [4184, 4185], [4448, 4607], [4959, 4959], [5906, 5908], [5938, 5940], [5970, 5971], [6002, 6003], [6068, 6069], [6071, 6077], [6086, 6086], [6089, 6099], [6109, 6109], [6155, 6157], [6313, 6313], [6432, 6434], [6439, 6440], [6450, 6450], [6457, 6459], [6679, 6680], [6912, 6915], [6964, 6964], [6966, 6970], [6972, 6972], [6978, 6978], [7019, 7027], [7616, 7626], [7678, 7679], [8203, 8207], [8234, 8238], [8288, 8291], [8298, 8303], [8400, 8431], [12330, 12335], [12441, 12442], [43014, 43014], [43019, 43019], [43045, 43046], [64286, 64286], [65024, 65039], [65056, 65059], [65279, 65279], [65529, 65531]];
var ac = [[68097, 68099], [68101, 68102], [68108, 68111], [68152, 68154], [68159, 68159], [119143, 119145], [119155, 119170], [119173, 119179], [119210, 119213], [119362, 119364], [917505, 917505], [917536, 917631], [917760, 917999]];
var se;
function cc(s15, t) {
  let e = 0, i = t.length - 1, r;
  if (s15 < t[0][0] || s15 > t[i][1]) return false;
  for (; i >= e; ) if (r = e + i >> 1, s15 > t[r][1]) e = r + 1;
  else if (s15 < t[r][0]) i = r - 1;
  else return true;
  return false;
}
var fn = class {
  constructor() {
    this.version = "6";
    if (!se) {
      se = new Uint8Array(65536), se.fill(1), se[0] = 0, se.fill(0, 1, 32), se.fill(0, 127, 160), se.fill(2, 4352, 4448), se[9001] = 2, se[9002] = 2, se.fill(2, 11904, 42192), se[12351] = 1, se.fill(2, 44032, 55204), se.fill(2, 63744, 64256), se.fill(2, 65040, 65050), se.fill(2, 65072, 65136), se.fill(2, 65280, 65377), se.fill(2, 65504, 65511);
      for (let t = 0; t < Os.length; ++t) se.fill(0, Os[t][0], Os[t][1] + 1);
    }
  }
  wcwidth(t) {
    return t < 32 ? 0 : t < 127 ? 1 : t < 65536 ? se[t] : cc(t, ac) ? 0 : t >= 131072 && t <= 196605 || t >= 196608 && t <= 262141 ? 2 : 1;
  }
  charProperties(t, e) {
    let i = this.wcwidth(t), r = i === 0 && e !== 0;
    if (r) {
      let n = Ae.extractWidth(e);
      n === 0 ? r = false : n > i && (i = n);
    }
    return Ae.createPropertyValue(0, i, r);
  }
};
var Ae = class s13 {
  constructor() {
    this._providers = /* @__PURE__ */ Object.create(null);
    this._active = "";
    this._onChange = new v();
    this.onChange = this._onChange.event;
    let t = new fn();
    this.register(t), this._active = t.version, this._activeProvider = t;
  }
  static extractShouldJoin(t) {
    return (t & 1) !== 0;
  }
  static extractWidth(t) {
    return t >> 1 & 3;
  }
  static extractCharKind(t) {
    return t >> 3;
  }
  static createPropertyValue(t, e, i = false) {
    return (t & 16777215) << 3 | (e & 3) << 1 | (i ? 1 : 0);
  }
  dispose() {
    this._onChange.dispose();
  }
  get versions() {
    return Object.keys(this._providers);
  }
  get activeVersion() {
    return this._active;
  }
  set activeVersion(t) {
    if (!this._providers[t]) throw new Error(`unknown Unicode version "${t}"`);
    this._active = t, this._activeProvider = this._providers[t], this._onChange.fire(t);
  }
  register(t) {
    this._providers[t.version] = t;
  }
  wcwidth(t) {
    return this._activeProvider.wcwidth(t);
  }
  getStringCellWidth(t) {
    let e = 0, i = 0, r = t.length;
    for (let n = 0; n < r; ++n) {
      let o2 = t.charCodeAt(n);
      if (55296 <= o2 && o2 <= 56319) {
        if (++n >= r) return e + this.wcwidth(o2);
        let u = t.charCodeAt(n);
        56320 <= u && u <= 57343 ? o2 = (o2 - 55296) * 1024 + u - 56320 + 65536 : e += this.wcwidth(u);
      }
      let l = this.charProperties(o2, i), a = s13.extractWidth(l);
      s13.extractShouldJoin(l) && (a -= s13.extractWidth(i)), e += a, i = l;
    }
    return e;
  }
  charProperties(t, e) {
    return this._activeProvider.charProperties(t, e);
  }
};
var pn = class {
  constructor() {
    this.glevel = 0;
    this._charsets = [];
  }
  reset() {
    this.charset = void 0, this._charsets = [], this.glevel = 0;
  }
  setgLevel(t) {
    this.glevel = t, this.charset = this._charsets[t];
  }
  setgCharset(t, e) {
    this._charsets[t] = e, this.glevel === t && (this.charset = e);
  }
};
function Bs(s15) {
  let e = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y - 1)?.get(s15.cols - 1), i = s15.buffer.lines.get(s15.buffer.ybase + s15.buffer.y);
  i && e && (i.isWrapped = e[3] !== 0 && e[3] !== 32);
}
var Vi = 2147483647;
var uc = 256;
var ci = class s14 {
  constructor(t = 32, e = 32) {
    this.maxLength = t;
    this.maxSubParamsLength = e;
    if (e > uc) throw new Error("maxSubParamsLength must not be greater than 256");
    this.params = new Int32Array(t), this.length = 0, this._subParams = new Int32Array(e), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(t), this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
  }
  static fromArray(t) {
    let e = new s14();
    if (!t.length) return e;
    for (let i = Array.isArray(t[0]) ? 1 : 0; i < t.length; ++i) {
      let r = t[i];
      if (Array.isArray(r)) for (let n = 0; n < r.length; ++n) e.addSubParam(r[n]);
      else e.addParam(r);
    }
    return e;
  }
  clone() {
    let t = new s14(this.maxLength, this.maxSubParamsLength);
    return t.params.set(this.params), t.length = this.length, t._subParams.set(this._subParams), t._subParamsLength = this._subParamsLength, t._subParamsIdx.set(this._subParamsIdx), t._rejectDigits = this._rejectDigits, t._rejectSubDigits = this._rejectSubDigits, t._digitIsSub = this._digitIsSub, t;
  }
  toArray() {
    let t = [];
    for (let e = 0; e < this.length; ++e) {
      t.push(this.params[e]);
      let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
      r - i > 0 && t.push(Array.prototype.slice.call(this._subParams, i, r));
    }
    return t;
  }
  reset() {
    this.length = 0, this._subParamsLength = 0, this._rejectDigits = false, this._rejectSubDigits = false, this._digitIsSub = false;
  }
  addParam(t) {
    if (this._digitIsSub = false, this.length >= this.maxLength) {
      this._rejectDigits = true;
      return;
    }
    if (t < -1) throw new Error("values lesser than -1 are not allowed");
    this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = t > Vi ? Vi : t;
  }
  addSubParam(t) {
    if (this._digitIsSub = true, !!this.length) {
      if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength) {
        this._rejectSubDigits = true;
        return;
      }
      if (t < -1) throw new Error("values lesser than -1 are not allowed");
      this._subParams[this._subParamsLength++] = t > Vi ? Vi : t, this._subParamsIdx[this.length - 1]++;
    }
  }
  hasSubParams(t) {
    return (this._subParamsIdx[t] & 255) - (this._subParamsIdx[t] >> 8) > 0;
  }
  getSubParams(t) {
    let e = this._subParamsIdx[t] >> 8, i = this._subParamsIdx[t] & 255;
    return i - e > 0 ? this._subParams.subarray(e, i) : null;
  }
  getSubParamsAll() {
    let t = {};
    for (let e = 0; e < this.length; ++e) {
      let i = this._subParamsIdx[e] >> 8, r = this._subParamsIdx[e] & 255;
      r - i > 0 && (t[e] = this._subParams.slice(i, r));
    }
    return t;
  }
  addDigit(t) {
    let e;
    if (this._rejectDigits || !(e = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits) return;
    let i = this._digitIsSub ? this._subParams : this.params, r = i[e - 1];
    i[e - 1] = ~r ? Math.min(r * 10 + t, Vi) : t;
  }
};
var qi = [];
var mn = class {
  constructor() {
    this._state = 0;
    this._active = qi;
    this._id = -1;
    this._handlers = /* @__PURE__ */ Object.create(null);
    this._handlerFb = () => {
    };
    this._stack = { paused: false, loopPosition: 0, fallThrough: false };
  }
  registerHandler(t, e) {
    this._handlers[t] === void 0 && (this._handlers[t] = []);
    let i = this._handlers[t];
    return i.push(e), { dispose: () => {
      let r = i.indexOf(e);
      r !== -1 && i.splice(r, 1);
    } };
  }
  clearHandler(t) {
    this._handlers[t] && delete this._handlers[t];
  }
  setHandlerFallback(t) {
    this._handlerFb = t;
  }
  dispose() {
    this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
    }, this._active = qi;
  }
  reset() {
    if (this._state === 2) for (let t = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t >= 0; --t) this._active[t].end(false);
    this._stack.paused = false, this._active = qi, this._id = -1, this._state = 0;
  }
  _start() {
    if (this._active = this._handlers[this._id] || qi, !this._active.length) this._handlerFb(this._id, "START");
    else for (let t = this._active.length - 1; t >= 0; t--) this._active[t].start();
  }
  _put(t, e, i) {
    if (!this._active.length) this._handlerFb(this._id, "PUT", It(t, e, i));
    else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t, e, i);
  }
  start() {
    this.reset(), this._state = 1;
  }
  put(t, e, i) {
    if (this._state !== 3) {
      if (this._state === 1) for (; e < i; ) {
        let r = t[e++];
        if (r === 59) {
          this._state = 2, this._start();
          break;
        }
        if (r < 48 || 57 < r) {
          this._state = 3;
          return;
        }
        this._id === -1 && (this._id = 0), this._id = this._id * 10 + r - 48;
      }
      this._state === 2 && i - e > 0 && this._put(t, e, i);
    }
  }
  end(t, e = true) {
    if (this._state !== 0) {
      if (this._state !== 3) if (this._state === 1 && this._start(), !this._active.length) this._handlerFb(this._id, "END", t);
      else {
        let i = false, r = this._active.length - 1, n = false;
        if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
          for (; r >= 0 && (i = this._active[r].end(t), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
          r--;
        }
        for (; r >= 0; r--) if (i = this._active[r].end(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
      }
      this._active = qi, this._id = -1, this._state = 0;
    }
  }
};
var pe = class {
  constructor(t) {
    this._handler = t;
    this._data = "";
    this._hitLimit = false;
  }
  start() {
    this._data = "", this._hitLimit = false;
  }
  put(t, e, i) {
    this._hitLimit || (this._data += It(t, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
  }
  end(t) {
    let e = false;
    if (this._hitLimit) e = false;
    else if (t && (e = this._handler(this._data), e instanceof Promise)) return e.then((i) => (this._data = "", this._hitLimit = false, i));
    return this._data = "", this._hitLimit = false, e;
  }
};
var Yi = [];
var _n = class {
  constructor() {
    this._handlers = /* @__PURE__ */ Object.create(null);
    this._active = Yi;
    this._ident = 0;
    this._handlerFb = () => {
    };
    this._stack = { paused: false, loopPosition: 0, fallThrough: false };
  }
  dispose() {
    this._handlers = /* @__PURE__ */ Object.create(null), this._handlerFb = () => {
    }, this._active = Yi;
  }
  registerHandler(t, e) {
    this._handlers[t] === void 0 && (this._handlers[t] = []);
    let i = this._handlers[t];
    return i.push(e), { dispose: () => {
      let r = i.indexOf(e);
      r !== -1 && i.splice(r, 1);
    } };
  }
  clearHandler(t) {
    this._handlers[t] && delete this._handlers[t];
  }
  setHandlerFallback(t) {
    this._handlerFb = t;
  }
  reset() {
    if (this._active.length) for (let t = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; t >= 0; --t) this._active[t].unhook(false);
    this._stack.paused = false, this._active = Yi, this._ident = 0;
  }
  hook(t, e) {
    if (this.reset(), this._ident = t, this._active = this._handlers[t] || Yi, !this._active.length) this._handlerFb(this._ident, "HOOK", e);
    else for (let i = this._active.length - 1; i >= 0; i--) this._active[i].hook(e);
  }
  put(t, e, i) {
    if (!this._active.length) this._handlerFb(this._ident, "PUT", It(t, e, i));
    else for (let r = this._active.length - 1; r >= 0; r--) this._active[r].put(t, e, i);
  }
  unhook(t, e = true) {
    if (!this._active.length) this._handlerFb(this._ident, "UNHOOK", t);
    else {
      let i = false, r = this._active.length - 1, n = false;
      if (this._stack.paused && (r = this._stack.loopPosition - 1, i = e, n = this._stack.fallThrough, this._stack.paused = false), !n && i === false) {
        for (; r >= 0 && (i = this._active[r].unhook(t), i !== true); r--) if (i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = false, i;
        r--;
      }
      for (; r >= 0; r--) if (i = this._active[r].unhook(false), i instanceof Promise) return this._stack.paused = true, this._stack.loopPosition = r, this._stack.fallThrough = true, i;
    }
    this._active = Yi, this._ident = 0;
  }
};
var ji = new ci();
ji.addParam(0);
var Xi = class {
  constructor(t) {
    this._handler = t;
    this._data = "";
    this._params = ji;
    this._hitLimit = false;
  }
  hook(t) {
    this._params = t.length > 1 || t.params[0] ? t.clone() : ji, this._data = "", this._hitLimit = false;
  }
  put(t, e, i) {
    this._hitLimit || (this._data += It(t, e, i), this._data.length > 1e7 && (this._data = "", this._hitLimit = true));
  }
  unhook(t) {
    let e = false;
    if (this._hitLimit) e = false;
    else if (t && (e = this._handler(this._data, this._params), e instanceof Promise)) return e.then((i) => (this._params = ji, this._data = "", this._hitLimit = false, i));
    return this._params = ji, this._data = "", this._hitLimit = false, e;
  }
};
var Fs = class {
  constructor(t) {
    this.table = new Uint8Array(t);
  }
  setDefault(t, e) {
    this.table.fill(t << 4 | e);
  }
  add(t, e, i, r) {
    this.table[e << 8 | t] = i << 4 | r;
  }
  addMany(t, e, i, r) {
    for (let n = 0; n < t.length; n++) this.table[e << 8 | t[n]] = i << 4 | r;
  }
};
var ke = 160;
var hc = (function() {
  let s15 = new Fs(4095), e = Array.apply(null, Array(256)).map((a, u) => u), i = (a, u) => e.slice(a, u), r = i(32, 127), n = i(0, 24);
  n.push(25), n.push.apply(n, i(28, 32));
  let o2 = i(0, 14), l;
  s15.setDefault(1, 0), s15.addMany(r, 0, 2, 0);
  for (l in o2) s15.addMany([24, 26, 153, 154], l, 3, 0), s15.addMany(i(128, 144), l, 3, 0), s15.addMany(i(144, 152), l, 3, 0), s15.add(156, l, 0, 0), s15.add(27, l, 11, 1), s15.add(157, l, 4, 8), s15.addMany([152, 158, 159], l, 0, 7), s15.add(155, l, 11, 3), s15.add(144, l, 11, 9);
  return s15.addMany(n, 0, 3, 0), s15.addMany(n, 1, 3, 1), s15.add(127, 1, 0, 1), s15.addMany(n, 8, 0, 8), s15.addMany(n, 3, 3, 3), s15.add(127, 3, 0, 3), s15.addMany(n, 4, 3, 4), s15.add(127, 4, 0, 4), s15.addMany(n, 6, 3, 6), s15.addMany(n, 5, 3, 5), s15.add(127, 5, 0, 5), s15.addMany(n, 2, 3, 2), s15.add(127, 2, 0, 2), s15.add(93, 1, 4, 8), s15.addMany(r, 8, 5, 8), s15.add(127, 8, 5, 8), s15.addMany([156, 27, 24, 26, 7], 8, 6, 0), s15.addMany(i(28, 32), 8, 0, 8), s15.addMany([88, 94, 95], 1, 0, 7), s15.addMany(r, 7, 0, 7), s15.addMany(n, 7, 0, 7), s15.add(156, 7, 0, 0), s15.add(127, 7, 0, 7), s15.add(91, 1, 11, 3), s15.addMany(i(64, 127), 3, 7, 0), s15.addMany(i(48, 60), 3, 8, 4), s15.addMany([60, 61, 62, 63], 3, 9, 4), s15.addMany(i(48, 60), 4, 8, 4), s15.addMany(i(64, 127), 4, 7, 0), s15.addMany([60, 61, 62, 63], 4, 0, 6), s15.addMany(i(32, 64), 6, 0, 6), s15.add(127, 6, 0, 6), s15.addMany(i(64, 127), 6, 0, 0), s15.addMany(i(32, 48), 3, 9, 5), s15.addMany(i(32, 48), 5, 9, 5), s15.addMany(i(48, 64), 5, 0, 6), s15.addMany(i(64, 127), 5, 7, 0), s15.addMany(i(32, 48), 4, 9, 5), s15.addMany(i(32, 48), 1, 9, 2), s15.addMany(i(32, 48), 2, 9, 2), s15.addMany(i(48, 127), 2, 10, 0), s15.addMany(i(48, 80), 1, 10, 0), s15.addMany(i(81, 88), 1, 10, 0), s15.addMany([89, 90, 92], 1, 10, 0), s15.addMany(i(96, 127), 1, 10, 0), s15.add(80, 1, 11, 9), s15.addMany(n, 9, 0, 9), s15.add(127, 9, 0, 9), s15.addMany(i(28, 32), 9, 0, 9), s15.addMany(i(32, 48), 9, 9, 12), s15.addMany(i(48, 60), 9, 8, 10), s15.addMany([60, 61, 62, 63], 9, 9, 10), s15.addMany(n, 11, 0, 11), s15.addMany(i(32, 128), 11, 0, 11), s15.addMany(i(28, 32), 11, 0, 11), s15.addMany(n, 10, 0, 10), s15.add(127, 10, 0, 10), s15.addMany(i(28, 32), 10, 0, 10), s15.addMany(i(48, 60), 10, 8, 10), s15.addMany([60, 61, 62, 63], 10, 0, 11), s15.addMany(i(32, 48), 10, 9, 12), s15.addMany(n, 12, 0, 12), s15.add(127, 12, 0, 12), s15.addMany(i(28, 32), 12, 0, 12), s15.addMany(i(32, 48), 12, 9, 12), s15.addMany(i(48, 64), 12, 0, 11), s15.addMany(i(64, 127), 12, 12, 13), s15.addMany(i(64, 127), 10, 12, 13), s15.addMany(i(64, 127), 9, 12, 13), s15.addMany(n, 13, 13, 13), s15.addMany(r, 13, 13, 13), s15.add(127, 13, 0, 13), s15.addMany([27, 156, 24, 26], 13, 14, 0), s15.add(ke, 0, 2, 0), s15.add(ke, 8, 5, 8), s15.add(ke, 6, 0, 6), s15.add(ke, 11, 0, 11), s15.add(ke, 13, 13, 13), s15;
})();
var bn = class extends D {
  constructor(e = hc) {
    super();
    this._transitions = e;
    this._parseStack = { state: 0, handlers: [], handlerPos: 0, transition: 0, chunkPos: 0 };
    this.initialState = 0, this.currentState = this.initialState, this._params = new ci(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._printHandlerFb = (i, r, n) => {
    }, this._executeHandlerFb = (i) => {
    }, this._csiHandlerFb = (i, r) => {
    }, this._escHandlerFb = (i) => {
    }, this._errorHandlerFb = (i) => i, this._printHandler = this._printHandlerFb, this._executeHandlers = /* @__PURE__ */ Object.create(null), this._csiHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null), this._register(C(() => {
      this._csiHandlers = /* @__PURE__ */ Object.create(null), this._executeHandlers = /* @__PURE__ */ Object.create(null), this._escHandlers = /* @__PURE__ */ Object.create(null);
    })), this._oscParser = this._register(new mn()), this._dcsParser = this._register(new _n()), this._errorHandler = this._errorHandlerFb, this.registerEscHandler({ final: "\\" }, () => true);
  }
  _identifier(e, i = [64, 126]) {
    let r = 0;
    if (e.prefix) {
      if (e.prefix.length > 1) throw new Error("only one byte as prefix supported");
      if (r = e.prefix.charCodeAt(0), r && 60 > r || r > 63) throw new Error("prefix must be in range 0x3c .. 0x3f");
    }
    if (e.intermediates) {
      if (e.intermediates.length > 2) throw new Error("only two bytes as intermediates are supported");
      for (let o2 = 0; o2 < e.intermediates.length; ++o2) {
        let l = e.intermediates.charCodeAt(o2);
        if (32 > l || l > 47) throw new Error("intermediate must be in range 0x20 .. 0x2f");
        r <<= 8, r |= l;
      }
    }
    if (e.final.length !== 1) throw new Error("final must be a single byte");
    let n = e.final.charCodeAt(0);
    if (i[0] > n || n > i[1]) throw new Error(`final must be in range ${i[0]} .. ${i[1]}`);
    return r <<= 8, r |= n, r;
  }
  identToString(e) {
    let i = [];
    for (; e; ) i.push(String.fromCharCode(e & 255)), e >>= 8;
    return i.reverse().join("");
  }
  setPrintHandler(e) {
    this._printHandler = e;
  }
  clearPrintHandler() {
    this._printHandler = this._printHandlerFb;
  }
  registerEscHandler(e, i) {
    let r = this._identifier(e, [48, 126]);
    this._escHandlers[r] === void 0 && (this._escHandlers[r] = []);
    let n = this._escHandlers[r];
    return n.push(i), { dispose: () => {
      let o2 = n.indexOf(i);
      o2 !== -1 && n.splice(o2, 1);
    } };
  }
  clearEscHandler(e) {
    this._escHandlers[this._identifier(e, [48, 126])] && delete this._escHandlers[this._identifier(e, [48, 126])];
  }
  setEscHandlerFallback(e) {
    this._escHandlerFb = e;
  }
  setExecuteHandler(e, i) {
    this._executeHandlers[e.charCodeAt(0)] = i;
  }
  clearExecuteHandler(e) {
    this._executeHandlers[e.charCodeAt(0)] && delete this._executeHandlers[e.charCodeAt(0)];
  }
  setExecuteHandlerFallback(e) {
    this._executeHandlerFb = e;
  }
  registerCsiHandler(e, i) {
    let r = this._identifier(e);
    this._csiHandlers[r] === void 0 && (this._csiHandlers[r] = []);
    let n = this._csiHandlers[r];
    return n.push(i), { dispose: () => {
      let o2 = n.indexOf(i);
      o2 !== -1 && n.splice(o2, 1);
    } };
  }
  clearCsiHandler(e) {
    this._csiHandlers[this._identifier(e)] && delete this._csiHandlers[this._identifier(e)];
  }
  setCsiHandlerFallback(e) {
    this._csiHandlerFb = e;
  }
  registerDcsHandler(e, i) {
    return this._dcsParser.registerHandler(this._identifier(e), i);
  }
  clearDcsHandler(e) {
    this._dcsParser.clearHandler(this._identifier(e));
  }
  setDcsHandlerFallback(e) {
    this._dcsParser.setHandlerFallback(e);
  }
  registerOscHandler(e, i) {
    return this._oscParser.registerHandler(e, i);
  }
  clearOscHandler(e) {
    this._oscParser.clearHandler(e);
  }
  setOscHandlerFallback(e) {
    this._oscParser.setHandlerFallback(e);
  }
  setErrorHandler(e) {
    this._errorHandler = e;
  }
  clearErrorHandler() {
    this._errorHandler = this._errorHandlerFb;
  }
  reset() {
    this.currentState = this.initialState, this._oscParser.reset(), this._dcsParser.reset(), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._parseStack.state !== 0 && (this._parseStack.state = 2, this._parseStack.handlers = []);
  }
  _preserveStack(e, i, r, n, o2) {
    this._parseStack.state = e, this._parseStack.handlers = i, this._parseStack.handlerPos = r, this._parseStack.transition = n, this._parseStack.chunkPos = o2;
  }
  parse(e, i, r) {
    let n = 0, o2 = 0, l = 0, a;
    if (this._parseStack.state) if (this._parseStack.state === 2) this._parseStack.state = 0, l = this._parseStack.chunkPos + 1;
    else {
      if (r === void 0 || this._parseStack.state === 1) throw this._parseStack.state = 1, new Error("improper continuation due to previous async handler, giving up parsing");
      let u = this._parseStack.handlers, h2 = this._parseStack.handlerPos - 1;
      switch (this._parseStack.state) {
        case 3:
          if (r === false && h2 > -1) {
            for (; h2 >= 0 && (a = u[h2](this._params), a !== true); h2--) if (a instanceof Promise) return this._parseStack.handlerPos = h2, a;
          }
          this._parseStack.handlers = [];
          break;
        case 4:
          if (r === false && h2 > -1) {
            for (; h2 >= 0 && (a = u[h2](), a !== true); h2--) if (a instanceof Promise) return this._parseStack.handlerPos = h2, a;
          }
          this._parseStack.handlers = [];
          break;
        case 6:
          if (n = e[this._parseStack.chunkPos], a = this._dcsParser.unhook(n !== 24 && n !== 26, r), a) return a;
          n === 27 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
          break;
        case 5:
          if (n = e[this._parseStack.chunkPos], a = this._oscParser.end(n !== 24 && n !== 26, r), a) return a;
          n === 27 && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
          break;
      }
      this._parseStack.state = 0, l = this._parseStack.chunkPos + 1, this.precedingJoinState = 0, this.currentState = this._parseStack.transition & 15;
    }
    for (let u = l; u < i; ++u) {
      switch (n = e[u], o2 = this._transitions.table[this.currentState << 8 | (n < 160 ? n : ke)], o2 >> 4) {
        case 2:
          for (let m = u + 1; ; ++m) {
            if (m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
              this._printHandler(e, u, m), u = m - 1;
              break;
            }
            if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
              this._printHandler(e, u, m), u = m - 1;
              break;
            }
            if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
              this._printHandler(e, u, m), u = m - 1;
              break;
            }
            if (++m >= i || (n = e[m]) < 32 || n > 126 && n < ke) {
              this._printHandler(e, u, m), u = m - 1;
              break;
            }
          }
          break;
        case 3:
          this._executeHandlers[n] ? this._executeHandlers[n]() : this._executeHandlerFb(n), this.precedingJoinState = 0;
          break;
        case 0:
          break;
        case 1:
          if (this._errorHandler({ position: u, code: n, currentState: this.currentState, collect: this._collect, params: this._params, abort: false }).abort) return;
          break;
        case 7:
          let c = this._csiHandlers[this._collect << 8 | n], d = c ? c.length - 1 : -1;
          for (; d >= 0 && (a = c[d](this._params), a !== true); d--) if (a instanceof Promise) return this._preserveStack(3, c, d, o2, u), a;
          d < 0 && this._csiHandlerFb(this._collect << 8 | n, this._params), this.precedingJoinState = 0;
          break;
        case 8:
          do
            switch (n) {
              case 59:
                this._params.addParam(0);
                break;
              case 58:
                this._params.addSubParam(-1);
                break;
              default:
                this._params.addDigit(n - 48);
            }
          while (++u < i && (n = e[u]) > 47 && n < 60);
          u--;
          break;
        case 9:
          this._collect <<= 8, this._collect |= n;
          break;
        case 10:
          let _2 = this._escHandlers[this._collect << 8 | n], p = _2 ? _2.length - 1 : -1;
          for (; p >= 0 && (a = _2[p](), a !== true); p--) if (a instanceof Promise) return this._preserveStack(4, _2, p, o2, u), a;
          p < 0 && this._escHandlerFb(this._collect << 8 | n), this.precedingJoinState = 0;
          break;
        case 11:
          this._params.reset(), this._params.addParam(0), this._collect = 0;
          break;
        case 12:
          this._dcsParser.hook(this._collect << 8 | n, this._params);
          break;
        case 13:
          for (let m = u + 1; ; ++m) if (m >= i || (n = e[m]) === 24 || n === 26 || n === 27 || n > 127 && n < ke) {
            this._dcsParser.put(e, u, m), u = m - 1;
            break;
          }
          break;
        case 14:
          if (a = this._dcsParser.unhook(n !== 24 && n !== 26), a) return this._preserveStack(6, [], 0, o2, u), a;
          n === 27 && (o2 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
          break;
        case 4:
          this._oscParser.start();
          break;
        case 5:
          for (let m = u + 1; ; m++) if (m >= i || (n = e[m]) < 32 || n > 127 && n < ke) {
            this._oscParser.put(e, u, m), u = m - 1;
            break;
          }
          break;
        case 6:
          if (a = this._oscParser.end(n !== 24 && n !== 26), a) return this._preserveStack(5, [], 0, o2, u), a;
          n === 27 && (o2 |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
          break;
      }
      this.currentState = o2 & 15;
    }
  }
};
var dc = /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/;
var fc = /^[\da-f]+$/;
function Ws(s15) {
  if (!s15) return;
  let t = s15.toLowerCase();
  if (t.indexOf("rgb:") === 0) {
    t = t.slice(4);
    let e = dc.exec(t);
    if (e) {
      let i = e[1] ? 15 : e[4] ? 255 : e[7] ? 4095 : 65535;
      return [Math.round(parseInt(e[1] || e[4] || e[7] || e[10], 16) / i * 255), Math.round(parseInt(e[2] || e[5] || e[8] || e[11], 16) / i * 255), Math.round(parseInt(e[3] || e[6] || e[9] || e[12], 16) / i * 255)];
    }
  } else if (t.indexOf("#") === 0 && (t = t.slice(1), fc.exec(t) && [3, 6, 9, 12].includes(t.length))) {
    let e = t.length / 3, i = [0, 0, 0];
    for (let r = 0; r < 3; ++r) {
      let n = parseInt(t.slice(e * r, e * r + e), 16);
      i[r] = e === 1 ? n << 4 : e === 2 ? n : e === 3 ? n >> 4 : n >> 8;
    }
    return i;
  }
}
function Hs(s15, t) {
  let e = s15.toString(16), i = e.length < 2 ? "0" + e : e;
  switch (t) {
    case 4:
      return e[0];
    case 8:
      return i;
    case 12:
      return (i + i).slice(0, 3);
    default:
      return i + i;
  }
}
function ml(s15, t = 16) {
  let [e, i, r] = s15;
  return `rgb:${Hs(e, t)}/${Hs(i, t)}/${Hs(r, t)}`;
}
var mc = { "(": 0, ")": 1, "*": 2, "+": 3, "-": 1, ".": 2 };
var ut = 131072;
var _l = 10;
function bl(s15, t) {
  if (s15 > 24) return t.setWinLines || false;
  switch (s15) {
    case 1:
      return !!t.restoreWin;
    case 2:
      return !!t.minimizeWin;
    case 3:
      return !!t.setWinPosition;
    case 4:
      return !!t.setWinSizePixels;
    case 5:
      return !!t.raiseWin;
    case 6:
      return !!t.lowerWin;
    case 7:
      return !!t.refreshWin;
    case 8:
      return !!t.setWinSizeChars;
    case 9:
      return !!t.maximizeWin;
    case 10:
      return !!t.fullscreenWin;
    case 11:
      return !!t.getWinState;
    case 13:
      return !!t.getWinPosition;
    case 14:
      return !!t.getWinSizePixels;
    case 15:
      return !!t.getScreenSizePixels;
    case 16:
      return !!t.getCellSizePixels;
    case 18:
      return !!t.getWinSizeChars;
    case 19:
      return !!t.getScreenSizeChars;
    case 20:
      return !!t.getIconTitle;
    case 21:
      return !!t.getWinTitle;
    case 22:
      return !!t.pushTitle;
    case 23:
      return !!t.popTitle;
    case 24:
      return !!t.setWinLines;
  }
  return false;
}
var vl = 5e3;
var gl = 0;
var vn = class extends D {
  constructor(e, i, r, n, o2, l, a, u, h2 = new bn()) {
    super();
    this._bufferService = e;
    this._charsetService = i;
    this._coreService = r;
    this._logService = n;
    this._optionsService = o2;
    this._oscLinkService = l;
    this._coreMouseService = a;
    this._unicodeService = u;
    this._parser = h2;
    this._parseBuffer = new Uint32Array(4096);
    this._stringDecoder = new er();
    this._utf8Decoder = new tr();
    this._windowTitle = "";
    this._iconName = "";
    this._windowTitleStack = [];
    this._iconNameStack = [];
    this._curAttrData = X.clone();
    this._eraseAttrDataInternal = X.clone();
    this._onRequestBell = this._register(new v());
    this.onRequestBell = this._onRequestBell.event;
    this._onRequestRefreshRows = this._register(new v());
    this.onRequestRefreshRows = this._onRequestRefreshRows.event;
    this._onRequestReset = this._register(new v());
    this.onRequestReset = this._onRequestReset.event;
    this._onRequestSendFocus = this._register(new v());
    this.onRequestSendFocus = this._onRequestSendFocus.event;
    this._onRequestSyncScrollBar = this._register(new v());
    this.onRequestSyncScrollBar = this._onRequestSyncScrollBar.event;
    this._onRequestWindowsOptionsReport = this._register(new v());
    this.onRequestWindowsOptionsReport = this._onRequestWindowsOptionsReport.event;
    this._onA11yChar = this._register(new v());
    this.onA11yChar = this._onA11yChar.event;
    this._onA11yTab = this._register(new v());
    this.onA11yTab = this._onA11yTab.event;
    this._onCursorMove = this._register(new v());
    this.onCursorMove = this._onCursorMove.event;
    this._onLineFeed = this._register(new v());
    this.onLineFeed = this._onLineFeed.event;
    this._onScroll = this._register(new v());
    this.onScroll = this._onScroll.event;
    this._onTitleChange = this._register(new v());
    this.onTitleChange = this._onTitleChange.event;
    this._onColor = this._register(new v());
    this.onColor = this._onColor.event;
    this._parseStack = { paused: false, cursorStartX: 0, cursorStartY: 0, decodedLength: 0, position: 0 };
    this._specialColors = [256, 257, 258];
    this._register(this._parser), this._dirtyRowTracker = new Zi(this._bufferService), this._activeBuffer = this._bufferService.buffer, this._register(this._bufferService.buffers.onBufferActivate((c) => this._activeBuffer = c.activeBuffer)), this._parser.setCsiHandlerFallback((c, d) => {
      this._logService.debug("Unknown CSI code: ", { identifier: this._parser.identToString(c), params: d.toArray() });
    }), this._parser.setEscHandlerFallback((c) => {
      this._logService.debug("Unknown ESC code: ", { identifier: this._parser.identToString(c) });
    }), this._parser.setExecuteHandlerFallback((c) => {
      this._logService.debug("Unknown EXECUTE code: ", { code: c });
    }), this._parser.setOscHandlerFallback((c, d, _2) => {
      this._logService.debug("Unknown OSC code: ", { identifier: c, action: d, data: _2 });
    }), this._parser.setDcsHandlerFallback((c, d, _2) => {
      d === "HOOK" && (_2 = _2.toArray()), this._logService.debug("Unknown DCS code: ", { identifier: this._parser.identToString(c), action: d, payload: _2 });
    }), this._parser.setPrintHandler((c, d, _2) => this.print(c, d, _2)), this._parser.registerCsiHandler({ final: "@" }, (c) => this.insertChars(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "@" }, (c) => this.scrollLeft(c)), this._parser.registerCsiHandler({ final: "A" }, (c) => this.cursorUp(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "A" }, (c) => this.scrollRight(c)), this._parser.registerCsiHandler({ final: "B" }, (c) => this.cursorDown(c)), this._parser.registerCsiHandler({ final: "C" }, (c) => this.cursorForward(c)), this._parser.registerCsiHandler({ final: "D" }, (c) => this.cursorBackward(c)), this._parser.registerCsiHandler({ final: "E" }, (c) => this.cursorNextLine(c)), this._parser.registerCsiHandler({ final: "F" }, (c) => this.cursorPrecedingLine(c)), this._parser.registerCsiHandler({ final: "G" }, (c) => this.cursorCharAbsolute(c)), this._parser.registerCsiHandler({ final: "H" }, (c) => this.cursorPosition(c)), this._parser.registerCsiHandler({ final: "I" }, (c) => this.cursorForwardTab(c)), this._parser.registerCsiHandler({ final: "J" }, (c) => this.eraseInDisplay(c, false)), this._parser.registerCsiHandler({ prefix: "?", final: "J" }, (c) => this.eraseInDisplay(c, true)), this._parser.registerCsiHandler({ final: "K" }, (c) => this.eraseInLine(c, false)), this._parser.registerCsiHandler({ prefix: "?", final: "K" }, (c) => this.eraseInLine(c, true)), this._parser.registerCsiHandler({ final: "L" }, (c) => this.insertLines(c)), this._parser.registerCsiHandler({ final: "M" }, (c) => this.deleteLines(c)), this._parser.registerCsiHandler({ final: "P" }, (c) => this.deleteChars(c)), this._parser.registerCsiHandler({ final: "S" }, (c) => this.scrollUp(c)), this._parser.registerCsiHandler({ final: "T" }, (c) => this.scrollDown(c)), this._parser.registerCsiHandler({ final: "X" }, (c) => this.eraseChars(c)), this._parser.registerCsiHandler({ final: "Z" }, (c) => this.cursorBackwardTab(c)), this._parser.registerCsiHandler({ final: "`" }, (c) => this.charPosAbsolute(c)), this._parser.registerCsiHandler({ final: "a" }, (c) => this.hPositionRelative(c)), this._parser.registerCsiHandler({ final: "b" }, (c) => this.repeatPrecedingCharacter(c)), this._parser.registerCsiHandler({ final: "c" }, (c) => this.sendDeviceAttributesPrimary(c)), this._parser.registerCsiHandler({ prefix: ">", final: "c" }, (c) => this.sendDeviceAttributesSecondary(c)), this._parser.registerCsiHandler({ final: "d" }, (c) => this.linePosAbsolute(c)), this._parser.registerCsiHandler({ final: "e" }, (c) => this.vPositionRelative(c)), this._parser.registerCsiHandler({ final: "f" }, (c) => this.hVPosition(c)), this._parser.registerCsiHandler({ final: "g" }, (c) => this.tabClear(c)), this._parser.registerCsiHandler({ final: "h" }, (c) => this.setMode(c)), this._parser.registerCsiHandler({ prefix: "?", final: "h" }, (c) => this.setModePrivate(c)), this._parser.registerCsiHandler({ final: "l" }, (c) => this.resetMode(c)), this._parser.registerCsiHandler({ prefix: "?", final: "l" }, (c) => this.resetModePrivate(c)), this._parser.registerCsiHandler({ final: "m" }, (c) => this.charAttributes(c)), this._parser.registerCsiHandler({ final: "n" }, (c) => this.deviceStatus(c)), this._parser.registerCsiHandler({ prefix: "?", final: "n" }, (c) => this.deviceStatusPrivate(c)), this._parser.registerCsiHandler({ intermediates: "!", final: "p" }, (c) => this.softReset(c)), this._parser.registerCsiHandler({ intermediates: " ", final: "q" }, (c) => this.setCursorStyle(c)), this._parser.registerCsiHandler({ final: "r" }, (c) => this.setScrollRegion(c)), this._parser.registerCsiHandler({ final: "s" }, (c) => this.saveCursor(c)), this._parser.registerCsiHandler({ final: "t" }, (c) => this.windowOptions(c)), this._parser.registerCsiHandler({ final: "u" }, (c) => this.restoreCursor(c)), this._parser.registerCsiHandler({ intermediates: "'", final: "}" }, (c) => this.insertColumns(c)), this._parser.registerCsiHandler({ intermediates: "'", final: "~" }, (c) => this.deleteColumns(c)), this._parser.registerCsiHandler({ intermediates: '"', final: "q" }, (c) => this.selectProtected(c)), this._parser.registerCsiHandler({ intermediates: "$", final: "p" }, (c) => this.requestMode(c, true)), this._parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, (c) => this.requestMode(c, false)), this._parser.setExecuteHandler(b.BEL, () => this.bell()), this._parser.setExecuteHandler(b.LF, () => this.lineFeed()), this._parser.setExecuteHandler(b.VT, () => this.lineFeed()), this._parser.setExecuteHandler(b.FF, () => this.lineFeed()), this._parser.setExecuteHandler(b.CR, () => this.carriageReturn()), this._parser.setExecuteHandler(b.BS, () => this.backspace()), this._parser.setExecuteHandler(b.HT, () => this.tab()), this._parser.setExecuteHandler(b.SO, () => this.shiftOut()), this._parser.setExecuteHandler(b.SI, () => this.shiftIn()), this._parser.setExecuteHandler(Ai.IND, () => this.index()), this._parser.setExecuteHandler(Ai.NEL, () => this.nextLine()), this._parser.setExecuteHandler(Ai.HTS, () => this.tabSet()), this._parser.registerOscHandler(0, new pe((c) => (this.setTitle(c), this.setIconName(c), true))), this._parser.registerOscHandler(1, new pe((c) => this.setIconName(c))), this._parser.registerOscHandler(2, new pe((c) => this.setTitle(c))), this._parser.registerOscHandler(4, new pe((c) => this.setOrReportIndexedColor(c))), this._parser.registerOscHandler(8, new pe((c) => this.setHyperlink(c))), this._parser.registerOscHandler(10, new pe((c) => this.setOrReportFgColor(c))), this._parser.registerOscHandler(11, new pe((c) => this.setOrReportBgColor(c))), this._parser.registerOscHandler(12, new pe((c) => this.setOrReportCursorColor(c))), this._parser.registerOscHandler(104, new pe((c) => this.restoreIndexedColor(c))), this._parser.registerOscHandler(110, new pe((c) => this.restoreFgColor(c))), this._parser.registerOscHandler(111, new pe((c) => this.restoreBgColor(c))), this._parser.registerOscHandler(112, new pe((c) => this.restoreCursorColor(c))), this._parser.registerEscHandler({ final: "7" }, () => this.saveCursor()), this._parser.registerEscHandler({ final: "8" }, () => this.restoreCursor()), this._parser.registerEscHandler({ final: "D" }, () => this.index()), this._parser.registerEscHandler({ final: "E" }, () => this.nextLine()), this._parser.registerEscHandler({ final: "H" }, () => this.tabSet()), this._parser.registerEscHandler({ final: "M" }, () => this.reverseIndex()), this._parser.registerEscHandler({ final: "=" }, () => this.keypadApplicationMode()), this._parser.registerEscHandler({ final: ">" }, () => this.keypadNumericMode()), this._parser.registerEscHandler({ final: "c" }, () => this.fullReset()), this._parser.registerEscHandler({ final: "n" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "o" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "|" }, () => this.setgLevel(3)), this._parser.registerEscHandler({ final: "}" }, () => this.setgLevel(2)), this._parser.registerEscHandler({ final: "~" }, () => this.setgLevel(1)), this._parser.registerEscHandler({ intermediates: "%", final: "@" }, () => this.selectDefaultCharset()), this._parser.registerEscHandler({ intermediates: "%", final: "G" }, () => this.selectDefaultCharset());
    for (let c in ne) this._parser.registerEscHandler({ intermediates: "(", final: c }, () => this.selectCharset("(" + c)), this._parser.registerEscHandler({ intermediates: ")", final: c }, () => this.selectCharset(")" + c)), this._parser.registerEscHandler({ intermediates: "*", final: c }, () => this.selectCharset("*" + c)), this._parser.registerEscHandler({ intermediates: "+", final: c }, () => this.selectCharset("+" + c)), this._parser.registerEscHandler({ intermediates: "-", final: c }, () => this.selectCharset("-" + c)), this._parser.registerEscHandler({ intermediates: ".", final: c }, () => this.selectCharset("." + c)), this._parser.registerEscHandler({ intermediates: "/", final: c }, () => this.selectCharset("/" + c));
    this._parser.registerEscHandler({ intermediates: "#", final: "8" }, () => this.screenAlignmentPattern()), this._parser.setErrorHandler((c) => (this._logService.error("Parsing error: ", c), c)), this._parser.registerDcsHandler({ intermediates: "$", final: "q" }, new Xi((c, d) => this.requestStatusString(c, d)));
  }
  getAttrData() {
    return this._curAttrData;
  }
  _preserveStack(e, i, r, n) {
    this._parseStack.paused = true, this._parseStack.cursorStartX = e, this._parseStack.cursorStartY = i, this._parseStack.decodedLength = r, this._parseStack.position = n;
  }
  _logSlowResolvingAsync(e) {
    this._logService.logLevel <= 3 && Promise.race([e, new Promise((i, r) => setTimeout(() => r("#SLOW_TIMEOUT"), vl))]).catch((i) => {
      if (i !== "#SLOW_TIMEOUT") throw i;
      console.warn(`async parser handler taking longer than ${vl} ms`);
    });
  }
  _getCurrentLinkId() {
    return this._curAttrData.extended.urlId;
  }
  parse(e, i) {
    let r, n = this._activeBuffer.x, o2 = this._activeBuffer.y, l = 0, a = this._parseStack.paused;
    if (a) {
      if (r = this._parser.parse(this._parseBuffer, this._parseStack.decodedLength, i)) return this._logSlowResolvingAsync(r), r;
      n = this._parseStack.cursorStartX, o2 = this._parseStack.cursorStartY, this._parseStack.paused = false, e.length > ut && (l = this._parseStack.position + ut);
    }
    if (this._logService.logLevel <= 1 && this._logService.debug(`parsing data ${typeof e == "string" ? ` "${e}"` : ` "${Array.prototype.map.call(e, (c) => String.fromCharCode(c)).join("")}"`}`), this._logService.logLevel === 0 && this._logService.trace("parsing data (codes)", typeof e == "string" ? e.split("").map((c) => c.charCodeAt(0)) : e), this._parseBuffer.length < e.length && this._parseBuffer.length < ut && (this._parseBuffer = new Uint32Array(Math.min(e.length, ut))), a || this._dirtyRowTracker.clearRange(), e.length > ut) for (let c = l; c < e.length; c += ut) {
      let d = c + ut < e.length ? c + ut : e.length, _2 = typeof e == "string" ? this._stringDecoder.decode(e.substring(c, d), this._parseBuffer) : this._utf8Decoder.decode(e.subarray(c, d), this._parseBuffer);
      if (r = this._parser.parse(this._parseBuffer, _2)) return this._preserveStack(n, o2, _2, c), this._logSlowResolvingAsync(r), r;
    }
    else if (!a) {
      let c = typeof e == "string" ? this._stringDecoder.decode(e, this._parseBuffer) : this._utf8Decoder.decode(e, this._parseBuffer);
      if (r = this._parser.parse(this._parseBuffer, c)) return this._preserveStack(n, o2, c, 0), this._logSlowResolvingAsync(r), r;
    }
    (this._activeBuffer.x !== n || this._activeBuffer.y !== o2) && this._onCursorMove.fire();
    let u = this._dirtyRowTracker.end + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp), h2 = this._dirtyRowTracker.start + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
    h2 < this._bufferService.rows && this._onRequestRefreshRows.fire({ start: Math.min(h2, this._bufferService.rows - 1), end: Math.min(u, this._bufferService.rows - 1) });
  }
  print(e, i, r) {
    let n, o2, l = this._charsetService.charset, a = this._optionsService.rawOptions.screenReaderMode, u = this._bufferService.cols, h2 = this._coreService.decPrivateModes.wraparound, c = this._coreService.modes.insertMode, d = this._curAttrData, _2 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
    this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._activeBuffer.x && r - i > 0 && _2.getWidth(this._activeBuffer.x - 1) === 2 && _2.setCellFromCodepoint(this._activeBuffer.x - 1, 0, 1, d);
    let p = this._parser.precedingJoinState;
    for (let m = i; m < r; ++m) {
      if (n = e[m], n < 127 && l) {
        let O = l[String.fromCharCode(n)];
        O && (n = O.charCodeAt(0));
      }
      let f = this._unicodeService.charProperties(n, p);
      o2 = Ae.extractWidth(f);
      let A = Ae.extractShouldJoin(f), R = A ? Ae.extractWidth(p) : 0;
      if (p = f, a && this._onA11yChar.fire(Ce(n)), this._getCurrentLinkId() && this._oscLinkService.addLineToLink(this._getCurrentLinkId(), this._activeBuffer.ybase + this._activeBuffer.y), this._activeBuffer.x + o2 - R > u) {
        if (h2) {
          let O = _2, I = this._activeBuffer.x - R;
          for (this._activeBuffer.x = R, this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData(), true)) : (this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = true), _2 = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y), R > 0 && _2 instanceof Ze && _2.copyCellsFrom(O, I, 0, R, false); I < u; ) O.setCellFromCodepoint(I++, 0, 1, d);
        } else if (this._activeBuffer.x = u - 1, o2 === 2) continue;
      }
      if (A && this._activeBuffer.x) {
        let O = _2.getWidth(this._activeBuffer.x - 1) ? 1 : 2;
        _2.addCodepointToCell(this._activeBuffer.x - O, n, o2);
        for (let I = o2 - R; --I >= 0; ) _2.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, d);
        continue;
      }
      if (c && (_2.insertCells(this._activeBuffer.x, o2 - R, this._activeBuffer.getNullCell(d)), _2.getWidth(u - 1) === 2 && _2.setCellFromCodepoint(u - 1, 0, 1, d)), _2.setCellFromCodepoint(this._activeBuffer.x++, n, o2, d), o2 > 0) for (; --o2; ) _2.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, d);
    }
    this._parser.precedingJoinState = p, this._activeBuffer.x < u && r - i > 0 && _2.getWidth(this._activeBuffer.x) === 0 && !_2.hasContent(this._activeBuffer.x) && _2.setCellFromCodepoint(this._activeBuffer.x, 0, 1, d), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
  }
  registerCsiHandler(e, i) {
    return e.final === "t" && !e.prefix && !e.intermediates ? this._parser.registerCsiHandler(e, (r) => bl(r.params[0], this._optionsService.rawOptions.windowOptions) ? i(r) : true) : this._parser.registerCsiHandler(e, i);
  }
  registerDcsHandler(e, i) {
    return this._parser.registerDcsHandler(e, new Xi(i));
  }
  registerEscHandler(e, i) {
    return this._parser.registerEscHandler(e, i);
  }
  registerOscHandler(e, i) {
    return this._parser.registerOscHandler(e, new pe(i));
  }
  bell() {
    return this._onRequestBell.fire(), true;
  }
  lineFeed() {
    return this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._optionsService.rawOptions.convertEol && (this._activeBuffer.x = 0), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows ? this._activeBuffer.y = this._bufferService.rows - 1 : this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.x >= this._bufferService.cols && this._activeBuffer.x--, this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._onLineFeed.fire(), true;
  }
  carriageReturn() {
    return this._activeBuffer.x = 0, true;
  }
  backspace() {
    if (!this._coreService.decPrivateModes.reverseWraparound) return this._restrictCursor(), this._activeBuffer.x > 0 && this._activeBuffer.x--, true;
    if (this._restrictCursor(this._bufferService.cols), this._activeBuffer.x > 0) this._activeBuffer.x--;
    else if (this._activeBuffer.x === 0 && this._activeBuffer.y > this._activeBuffer.scrollTop && this._activeBuffer.y <= this._activeBuffer.scrollBottom && this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)?.isWrapped) {
      this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = false, this._activeBuffer.y--, this._activeBuffer.x = this._bufferService.cols - 1;
      let e = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
      e.hasWidth(this._activeBuffer.x) && !e.hasContent(this._activeBuffer.x) && this._activeBuffer.x--;
    }
    return this._restrictCursor(), true;
  }
  tab() {
    if (this._activeBuffer.x >= this._bufferService.cols) return true;
    let e = this._activeBuffer.x;
    return this._activeBuffer.x = this._activeBuffer.nextStop(), this._optionsService.rawOptions.screenReaderMode && this._onA11yTab.fire(this._activeBuffer.x - e), true;
  }
  shiftOut() {
    return this._charsetService.setgLevel(1), true;
  }
  shiftIn() {
    return this._charsetService.setgLevel(0), true;
  }
  _restrictCursor(e = this._bufferService.cols - 1) {
    this._activeBuffer.x = Math.min(e, Math.max(0, this._activeBuffer.x)), this._activeBuffer.y = this._coreService.decPrivateModes.origin ? Math.min(this._activeBuffer.scrollBottom, Math.max(this._activeBuffer.scrollTop, this._activeBuffer.y)) : Math.min(this._bufferService.rows - 1, Math.max(0, this._activeBuffer.y)), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
  }
  _setCursor(e, i) {
    this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._coreService.decPrivateModes.origin ? (this._activeBuffer.x = e, this._activeBuffer.y = this._activeBuffer.scrollTop + i) : (this._activeBuffer.x = e, this._activeBuffer.y = i), this._restrictCursor(), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
  }
  _moveCursor(e, i) {
    this._restrictCursor(), this._setCursor(this._activeBuffer.x + e, this._activeBuffer.y + i);
  }
  cursorUp(e) {
    let i = this._activeBuffer.y - this._activeBuffer.scrollTop;
    return i >= 0 ? this._moveCursor(0, -Math.min(i, e.params[0] || 1)) : this._moveCursor(0, -(e.params[0] || 1)), true;
  }
  cursorDown(e) {
    let i = this._activeBuffer.scrollBottom - this._activeBuffer.y;
    return i >= 0 ? this._moveCursor(0, Math.min(i, e.params[0] || 1)) : this._moveCursor(0, e.params[0] || 1), true;
  }
  cursorForward(e) {
    return this._moveCursor(e.params[0] || 1, 0), true;
  }
  cursorBackward(e) {
    return this._moveCursor(-(e.params[0] || 1), 0), true;
  }
  cursorNextLine(e) {
    return this.cursorDown(e), this._activeBuffer.x = 0, true;
  }
  cursorPrecedingLine(e) {
    return this.cursorUp(e), this._activeBuffer.x = 0, true;
  }
  cursorCharAbsolute(e) {
    return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), true;
  }
  cursorPosition(e) {
    return this._setCursor(e.length >= 2 ? (e.params[1] || 1) - 1 : 0, (e.params[0] || 1) - 1), true;
  }
  charPosAbsolute(e) {
    return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), true;
  }
  hPositionRelative(e) {
    return this._moveCursor(e.params[0] || 1, 0), true;
  }
  linePosAbsolute(e) {
    return this._setCursor(this._activeBuffer.x, (e.params[0] || 1) - 1), true;
  }
  vPositionRelative(e) {
    return this._moveCursor(0, e.params[0] || 1), true;
  }
  hVPosition(e) {
    return this.cursorPosition(e), true;
  }
  tabClear(e) {
    let i = e.params[0];
    return i === 0 ? delete this._activeBuffer.tabs[this._activeBuffer.x] : i === 3 && (this._activeBuffer.tabs = {}), true;
  }
  cursorForwardTab(e) {
    if (this._activeBuffer.x >= this._bufferService.cols) return true;
    let i = e.params[0] || 1;
    for (; i--; ) this._activeBuffer.x = this._activeBuffer.nextStop();
    return true;
  }
  cursorBackwardTab(e) {
    if (this._activeBuffer.x >= this._bufferService.cols) return true;
    let i = e.params[0] || 1;
    for (; i--; ) this._activeBuffer.x = this._activeBuffer.prevStop();
    return true;
  }
  selectProtected(e) {
    let i = e.params[0];
    return i === 1 && (this._curAttrData.bg |= 536870912), (i === 2 || i === 0) && (this._curAttrData.bg &= -536870913), true;
  }
  _eraseInBufferLine(e, i, r, n = false, o2 = false) {
    let l = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
    l.replaceCells(i, r, this._activeBuffer.getNullCell(this._eraseAttrData()), o2), n && (l.isWrapped = false);
  }
  _resetBufferLine(e, i = false) {
    let r = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
    r && (r.fill(this._activeBuffer.getNullCell(this._eraseAttrData()), i), this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase + e), r.isWrapped = false);
  }
  eraseInDisplay(e, i = false) {
    this._restrictCursor(this._bufferService.cols);
    let r;
    switch (e.params[0]) {
      case 0:
        for (r = this._activeBuffer.y, this._dirtyRowTracker.markDirty(r), this._eraseInBufferLine(r++, this._activeBuffer.x, this._bufferService.cols, this._activeBuffer.x === 0, i); r < this._bufferService.rows; r++) this._resetBufferLine(r, i);
        this._dirtyRowTracker.markDirty(r);
        break;
      case 1:
        for (r = this._activeBuffer.y, this._dirtyRowTracker.markDirty(r), this._eraseInBufferLine(r, 0, this._activeBuffer.x + 1, true, i), this._activeBuffer.x + 1 >= this._bufferService.cols && (this._activeBuffer.lines.get(r + 1).isWrapped = false); r--; ) this._resetBufferLine(r, i);
        this._dirtyRowTracker.markDirty(0);
        break;
      case 2:
        if (this._optionsService.rawOptions.scrollOnEraseInDisplay) {
          for (r = this._bufferService.rows, this._dirtyRowTracker.markRangeDirty(0, r - 1); r-- && !this._activeBuffer.lines.get(this._activeBuffer.ybase + r)?.getTrimmedLength(); ) ;
          for (; r >= 0; r--) this._bufferService.scroll(this._eraseAttrData());
        } else {
          for (r = this._bufferService.rows, this._dirtyRowTracker.markDirty(r - 1); r--; ) this._resetBufferLine(r, i);
          this._dirtyRowTracker.markDirty(0);
        }
        break;
      case 3:
        let n = this._activeBuffer.lines.length - this._bufferService.rows;
        n > 0 && (this._activeBuffer.lines.trimStart(n), this._activeBuffer.ybase = Math.max(this._activeBuffer.ybase - n, 0), this._activeBuffer.ydisp = Math.max(this._activeBuffer.ydisp - n, 0), this._onScroll.fire(0));
        break;
    }
    return true;
  }
  eraseInLine(e, i = false) {
    switch (this._restrictCursor(this._bufferService.cols), e.params[0]) {
      case 0:
        this._eraseInBufferLine(this._activeBuffer.y, this._activeBuffer.x, this._bufferService.cols, this._activeBuffer.x === 0, i);
        break;
      case 1:
        this._eraseInBufferLine(this._activeBuffer.y, 0, this._activeBuffer.x + 1, false, i);
        break;
      case 2:
        this._eraseInBufferLine(this._activeBuffer.y, 0, this._bufferService.cols, true, i);
        break;
    }
    return this._dirtyRowTracker.markDirty(this._activeBuffer.y), true;
  }
  insertLines(e) {
    this._restrictCursor();
    let i = e.params[0] || 1;
    if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
    let r = this._activeBuffer.ybase + this._activeBuffer.y, n = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, o2 = this._bufferService.rows - 1 + this._activeBuffer.ybase - n + 1;
    for (; i--; ) this._activeBuffer.lines.splice(o2 - 1, 1), this._activeBuffer.lines.splice(r, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
  }
  deleteLines(e) {
    this._restrictCursor();
    let i = e.params[0] || 1;
    if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
    let r = this._activeBuffer.ybase + this._activeBuffer.y, n;
    for (n = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, n = this._bufferService.rows - 1 + this._activeBuffer.ybase - n; i--; ) this._activeBuffer.lines.splice(r, 1), this._activeBuffer.lines.splice(n, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, true;
  }
  insertChars(e) {
    this._restrictCursor();
    let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
    return i && (i.insertCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
  }
  deleteChars(e) {
    this._restrictCursor();
    let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
    return i && (i.deleteCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
  }
  scrollUp(e) {
    let i = e.params[0] || 1;
    for (; i--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
  }
  scrollDown(e) {
    let i = e.params[0] || 1;
    for (; i--; ) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 0, this._activeBuffer.getBlankLine(X));
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
  }
  scrollLeft(e) {
    if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
    let i = e.params[0] || 1;
    for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
      let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
      n.deleteCells(0, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
    }
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
  }
  scrollRight(e) {
    if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
    let i = e.params[0] || 1;
    for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
      let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
      n.insertCells(0, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
    }
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
  }
  insertColumns(e) {
    if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
    let i = e.params[0] || 1;
    for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
      let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
      n.insertCells(this._activeBuffer.x, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
    }
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
  }
  deleteColumns(e) {
    if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return true;
    let i = e.params[0] || 1;
    for (let r = this._activeBuffer.scrollTop; r <= this._activeBuffer.scrollBottom; ++r) {
      let n = this._activeBuffer.lines.get(this._activeBuffer.ybase + r);
      n.deleteCells(this._activeBuffer.x, i, this._activeBuffer.getNullCell(this._eraseAttrData())), n.isWrapped = false;
    }
    return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), true;
  }
  eraseChars(e) {
    this._restrictCursor();
    let i = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
    return i && (i.replaceCells(this._activeBuffer.x, this._activeBuffer.x + (e.params[0] || 1), this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), true;
  }
  repeatPrecedingCharacter(e) {
    let i = this._parser.precedingJoinState;
    if (!i) return true;
    let r = e.params[0] || 1, n = Ae.extractWidth(i), o2 = this._activeBuffer.x - n, a = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).getString(o2), u = new Uint32Array(a.length * r), h2 = 0;
    for (let d = 0; d < a.length; ) {
      let _2 = a.codePointAt(d) || 0;
      u[h2++] = _2, d += _2 > 65535 ? 2 : 1;
    }
    let c = h2;
    for (let d = 1; d < r; ++d) u.copyWithin(c, 0, h2), c += h2;
    return this.print(u, 0, c), true;
  }
  sendDeviceAttributesPrimary(e) {
    return e.params[0] > 0 || (this._is("xterm") || this._is("rxvt-unicode") || this._is("screen") ? this._coreService.triggerDataEvent(b.ESC + "[?1;2c") : this._is("linux") && this._coreService.triggerDataEvent(b.ESC + "[?6c")), true;
  }
  sendDeviceAttributesSecondary(e) {
    return e.params[0] > 0 || (this._is("xterm") ? this._coreService.triggerDataEvent(b.ESC + "[>0;276;0c") : this._is("rxvt-unicode") ? this._coreService.triggerDataEvent(b.ESC + "[>85;95;0c") : this._is("linux") ? this._coreService.triggerDataEvent(e.params[0] + "c") : this._is("screen") && this._coreService.triggerDataEvent(b.ESC + "[>83;40003;0c")), true;
  }
  _is(e) {
    return (this._optionsService.rawOptions.termName + "").indexOf(e) === 0;
  }
  setMode(e) {
    for (let i = 0; i < e.length; i++) switch (e.params[i]) {
      case 4:
        this._coreService.modes.insertMode = true;
        break;
      case 20:
        this._optionsService.options.convertEol = true;
        break;
    }
    return true;
  }
  setModePrivate(e) {
    for (let i = 0; i < e.length; i++) switch (e.params[i]) {
      case 1:
        this._coreService.decPrivateModes.applicationCursorKeys = true;
        break;
      case 2:
        this._charsetService.setgCharset(0, Je), this._charsetService.setgCharset(1, Je), this._charsetService.setgCharset(2, Je), this._charsetService.setgCharset(3, Je);
        break;
      case 3:
        this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(132, this._bufferService.rows), this._onRequestReset.fire());
        break;
      case 6:
        this._coreService.decPrivateModes.origin = true, this._setCursor(0, 0);
        break;
      case 7:
        this._coreService.decPrivateModes.wraparound = true;
        break;
      case 12:
        this._optionsService.options.cursorBlink = true;
        break;
      case 45:
        this._coreService.decPrivateModes.reverseWraparound = true;
        break;
      case 66:
        this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire();
        break;
      case 9:
        this._coreMouseService.activeProtocol = "X10";
        break;
      case 1e3:
        this._coreMouseService.activeProtocol = "VT200";
        break;
      case 1002:
        this._coreMouseService.activeProtocol = "DRAG";
        break;
      case 1003:
        this._coreMouseService.activeProtocol = "ANY";
        break;
      case 1004:
        this._coreService.decPrivateModes.sendFocus = true, this._onRequestSendFocus.fire();
        break;
      case 1005:
        this._logService.debug("DECSET 1005 not supported (see #2507)");
        break;
      case 1006:
        this._coreMouseService.activeEncoding = "SGR";
        break;
      case 1015:
        this._logService.debug("DECSET 1015 not supported (see #2507)");
        break;
      case 1016:
        this._coreMouseService.activeEncoding = "SGR_PIXELS";
        break;
      case 25:
        this._coreService.isCursorHidden = false;
        break;
      case 1048:
        this.saveCursor();
        break;
      case 1049:
        this.saveCursor();
      case 47:
      case 1047:
        this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(void 0), this._onRequestSyncScrollBar.fire();
        break;
      case 2004:
        this._coreService.decPrivateModes.bracketedPasteMode = true;
        break;
      case 2026:
        this._coreService.decPrivateModes.synchronizedOutput = true;
        break;
    }
    return true;
  }
  resetMode(e) {
    for (let i = 0; i < e.length; i++) switch (e.params[i]) {
      case 4:
        this._coreService.modes.insertMode = false;
        break;
      case 20:
        this._optionsService.options.convertEol = false;
        break;
    }
    return true;
  }
  resetModePrivate(e) {
    for (let i = 0; i < e.length; i++) switch (e.params[i]) {
      case 1:
        this._coreService.decPrivateModes.applicationCursorKeys = false;
        break;
      case 3:
        this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(80, this._bufferService.rows), this._onRequestReset.fire());
        break;
      case 6:
        this._coreService.decPrivateModes.origin = false, this._setCursor(0, 0);
        break;
      case 7:
        this._coreService.decPrivateModes.wraparound = false;
        break;
      case 12:
        this._optionsService.options.cursorBlink = false;
        break;
      case 45:
        this._coreService.decPrivateModes.reverseWraparound = false;
        break;
      case 66:
        this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire();
        break;
      case 9:
      case 1e3:
      case 1002:
      case 1003:
        this._coreMouseService.activeProtocol = "NONE";
        break;
      case 1004:
        this._coreService.decPrivateModes.sendFocus = false;
        break;
      case 1005:
        this._logService.debug("DECRST 1005 not supported (see #2507)");
        break;
      case 1006:
        this._coreMouseService.activeEncoding = "DEFAULT";
        break;
      case 1015:
        this._logService.debug("DECRST 1015 not supported (see #2507)");
        break;
      case 1016:
        this._coreMouseService.activeEncoding = "DEFAULT";
        break;
      case 25:
        this._coreService.isCursorHidden = true;
        break;
      case 1048:
        this.restoreCursor();
        break;
      case 1049:
      case 47:
      case 1047:
        this._bufferService.buffers.activateNormalBuffer(), e.params[i] === 1049 && this.restoreCursor(), this._coreService.isCursorInitialized = true, this._onRequestRefreshRows.fire(void 0), this._onRequestSyncScrollBar.fire();
        break;
      case 2004:
        this._coreService.decPrivateModes.bracketedPasteMode = false;
        break;
      case 2026:
        this._coreService.decPrivateModes.synchronizedOutput = false, this._onRequestRefreshRows.fire(void 0);
        break;
    }
    return true;
  }
  requestMode(e, i) {
    let r;
    ((P) => (P[P.NOT_RECOGNIZED = 0] = "NOT_RECOGNIZED", P[P.SET = 1] = "SET", P[P.RESET = 2] = "RESET", P[P.PERMANENTLY_SET = 3] = "PERMANENTLY_SET", P[P.PERMANENTLY_RESET = 4] = "PERMANENTLY_RESET"))(r || (r = {}));
    let n = this._coreService.decPrivateModes, { activeProtocol: o2, activeEncoding: l } = this._coreMouseService, a = this._coreService, { buffers: u, cols: h2 } = this._bufferService, { active: c, alt: d } = u, _2 = this._optionsService.rawOptions, p = (A, R) => (a.triggerDataEvent(`${b.ESC}[${i ? "" : "?"}${A};${R}$y`), true), m = (A) => A ? 1 : 2, f = e.params[0];
    return i ? f === 2 ? p(f, 4) : f === 4 ? p(f, m(a.modes.insertMode)) : f === 12 ? p(f, 3) : f === 20 ? p(f, m(_2.convertEol)) : p(f, 0) : f === 1 ? p(f, m(n.applicationCursorKeys)) : f === 3 ? p(f, _2.windowOptions.setWinLines ? h2 === 80 ? 2 : h2 === 132 ? 1 : 0 : 0) : f === 6 ? p(f, m(n.origin)) : f === 7 ? p(f, m(n.wraparound)) : f === 8 ? p(f, 3) : f === 9 ? p(f, m(o2 === "X10")) : f === 12 ? p(f, m(_2.cursorBlink)) : f === 25 ? p(f, m(!a.isCursorHidden)) : f === 45 ? p(f, m(n.reverseWraparound)) : f === 66 ? p(f, m(n.applicationKeypad)) : f === 67 ? p(f, 4) : f === 1e3 ? p(f, m(o2 === "VT200")) : f === 1002 ? p(f, m(o2 === "DRAG")) : f === 1003 ? p(f, m(o2 === "ANY")) : f === 1004 ? p(f, m(n.sendFocus)) : f === 1005 ? p(f, 4) : f === 1006 ? p(f, m(l === "SGR")) : f === 1015 ? p(f, 4) : f === 1016 ? p(f, m(l === "SGR_PIXELS")) : f === 1048 ? p(f, 1) : f === 47 || f === 1047 || f === 1049 ? p(f, m(c === d)) : f === 2004 ? p(f, m(n.bracketedPasteMode)) : f === 2026 ? p(f, m(n.synchronizedOutput)) : p(f, 0);
  }
  _updateAttrColor(e, i, r, n, o2) {
    return i === 2 ? (e |= 50331648, e &= -16777216, e |= De.fromColorRGB([r, n, o2])) : i === 5 && (e &= -50331904, e |= 33554432 | r & 255), e;
  }
  _extractColor(e, i, r) {
    let n = [0, 0, -1, 0, 0, 0], o2 = 0, l = 0;
    do {
      if (n[l + o2] = e.params[i + l], e.hasSubParams(i + l)) {
        let a = e.getSubParams(i + l), u = 0;
        do
          n[1] === 5 && (o2 = 1), n[l + u + 1 + o2] = a[u];
        while (++u < a.length && u + l + 1 + o2 < n.length);
        break;
      }
      if (n[1] === 5 && l + o2 >= 2 || n[1] === 2 && l + o2 >= 5) break;
      n[1] && (o2 = 1);
    } while (++l + i < e.length && l + o2 < n.length);
    for (let a = 2; a < n.length; ++a) n[a] === -1 && (n[a] = 0);
    switch (n[0]) {
      case 38:
        r.fg = this._updateAttrColor(r.fg, n[1], n[3], n[4], n[5]);
        break;
      case 48:
        r.bg = this._updateAttrColor(r.bg, n[1], n[3], n[4], n[5]);
        break;
      case 58:
        r.extended = r.extended.clone(), r.extended.underlineColor = this._updateAttrColor(r.extended.underlineColor, n[1], n[3], n[4], n[5]);
    }
    return l;
  }
  _processUnderline(e, i) {
    i.extended = i.extended.clone(), (!~e || e > 5) && (e = 1), i.extended.underlineStyle = e, i.fg |= 268435456, e === 0 && (i.fg &= -268435457), i.updateExtended();
  }
  _processSGR0(e) {
    e.fg = X.fg, e.bg = X.bg, e.extended = e.extended.clone(), e.extended.underlineStyle = 0, e.extended.underlineColor &= -67108864, e.updateExtended();
  }
  charAttributes(e) {
    if (e.length === 1 && e.params[0] === 0) return this._processSGR0(this._curAttrData), true;
    let i = e.length, r, n = this._curAttrData;
    for (let o2 = 0; o2 < i; o2++) r = e.params[o2], r >= 30 && r <= 37 ? (n.fg &= -50331904, n.fg |= 16777216 | r - 30) : r >= 40 && r <= 47 ? (n.bg &= -50331904, n.bg |= 16777216 | r - 40) : r >= 90 && r <= 97 ? (n.fg &= -50331904, n.fg |= 16777216 | r - 90 | 8) : r >= 100 && r <= 107 ? (n.bg &= -50331904, n.bg |= 16777216 | r - 100 | 8) : r === 0 ? this._processSGR0(n) : r === 1 ? n.fg |= 134217728 : r === 3 ? n.bg |= 67108864 : r === 4 ? (n.fg |= 268435456, this._processUnderline(e.hasSubParams(o2) ? e.getSubParams(o2)[0] : 1, n)) : r === 5 ? n.fg |= 536870912 : r === 7 ? n.fg |= 67108864 : r === 8 ? n.fg |= 1073741824 : r === 9 ? n.fg |= 2147483648 : r === 2 ? n.bg |= 134217728 : r === 21 ? this._processUnderline(2, n) : r === 22 ? (n.fg &= -134217729, n.bg &= -134217729) : r === 23 ? n.bg &= -67108865 : r === 24 ? (n.fg &= -268435457, this._processUnderline(0, n)) : r === 25 ? n.fg &= -536870913 : r === 27 ? n.fg &= -67108865 : r === 28 ? n.fg &= -1073741825 : r === 29 ? n.fg &= 2147483647 : r === 39 ? (n.fg &= -67108864, n.fg |= X.fg & 16777215) : r === 49 ? (n.bg &= -67108864, n.bg |= X.bg & 16777215) : r === 38 || r === 48 || r === 58 ? o2 += this._extractColor(e, o2, n) : r === 53 ? n.bg |= 1073741824 : r === 55 ? n.bg &= -1073741825 : r === 59 ? (n.extended = n.extended.clone(), n.extended.underlineColor = -1, n.updateExtended()) : r === 100 ? (n.fg &= -67108864, n.fg |= X.fg & 16777215, n.bg &= -67108864, n.bg |= X.bg & 16777215) : this._logService.debug("Unknown SGR attribute: %d.", r);
    return true;
  }
  deviceStatus(e) {
    switch (e.params[0]) {
      case 5:
        this._coreService.triggerDataEvent(`${b.ESC}[0n`);
        break;
      case 6:
        let i = this._activeBuffer.y + 1, r = this._activeBuffer.x + 1;
        this._coreService.triggerDataEvent(`${b.ESC}[${i};${r}R`);
        break;
    }
    return true;
  }
  deviceStatusPrivate(e) {
    switch (e.params[0]) {
      case 6:
        let i = this._activeBuffer.y + 1, r = this._activeBuffer.x + 1;
        this._coreService.triggerDataEvent(`${b.ESC}[?${i};${r}R`);
        break;
      case 15:
        break;
      case 25:
        break;
      case 26:
        break;
      case 53:
        break;
    }
    return true;
  }
  softReset(e) {
    return this._coreService.isCursorHidden = false, this._onRequestSyncScrollBar.fire(), this._activeBuffer.scrollTop = 0, this._activeBuffer.scrollBottom = this._bufferService.rows - 1, this._curAttrData = X.clone(), this._coreService.reset(), this._charsetService.reset(), this._activeBuffer.savedX = 0, this._activeBuffer.savedY = this._activeBuffer.ybase, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, this._coreService.decPrivateModes.origin = false, true;
  }
  setCursorStyle(e) {
    let i = e.length === 0 ? 1 : e.params[0];
    if (i === 0) this._coreService.decPrivateModes.cursorStyle = void 0, this._coreService.decPrivateModes.cursorBlink = void 0;
    else {
      switch (i) {
        case 1:
        case 2:
          this._coreService.decPrivateModes.cursorStyle = "block";
          break;
        case 3:
        case 4:
          this._coreService.decPrivateModes.cursorStyle = "underline";
          break;
        case 5:
        case 6:
          this._coreService.decPrivateModes.cursorStyle = "bar";
          break;
      }
      let r = i % 2 === 1;
      this._coreService.decPrivateModes.cursorBlink = r;
    }
    return true;
  }
  setScrollRegion(e) {
    let i = e.params[0] || 1, r;
    return (e.length < 2 || (r = e.params[1]) > this._bufferService.rows || r === 0) && (r = this._bufferService.rows), r > i && (this._activeBuffer.scrollTop = i - 1, this._activeBuffer.scrollBottom = r - 1, this._setCursor(0, 0)), true;
  }
  windowOptions(e) {
    if (!bl(e.params[0], this._optionsService.rawOptions.windowOptions)) return true;
    let i = e.length > 1 ? e.params[1] : 0;
    switch (e.params[0]) {
      case 14:
        i !== 2 && this._onRequestWindowsOptionsReport.fire(0);
        break;
      case 16:
        this._onRequestWindowsOptionsReport.fire(1);
        break;
      case 18:
        this._bufferService && this._coreService.triggerDataEvent(`${b.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);
        break;
      case 22:
        (i === 0 || i === 2) && (this._windowTitleStack.push(this._windowTitle), this._windowTitleStack.length > _l && this._windowTitleStack.shift()), (i === 0 || i === 1) && (this._iconNameStack.push(this._iconName), this._iconNameStack.length > _l && this._iconNameStack.shift());
        break;
      case 23:
        (i === 0 || i === 2) && this._windowTitleStack.length && this.setTitle(this._windowTitleStack.pop()), (i === 0 || i === 1) && this._iconNameStack.length && this.setIconName(this._iconNameStack.pop());
        break;
    }
    return true;
  }
  saveCursor(e) {
    return this._activeBuffer.savedX = this._activeBuffer.x, this._activeBuffer.savedY = this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, true;
  }
  restoreCursor(e) {
    return this._activeBuffer.x = this._activeBuffer.savedX || 0, this._activeBuffer.y = Math.max(this._activeBuffer.savedY - this._activeBuffer.ybase, 0), this._curAttrData.fg = this._activeBuffer.savedCurAttrData.fg, this._curAttrData.bg = this._activeBuffer.savedCurAttrData.bg, this._charsetService.charset = this._savedCharset, this._activeBuffer.savedCharset && (this._charsetService.charset = this._activeBuffer.savedCharset), this._restrictCursor(), true;
  }
  setTitle(e) {
    return this._windowTitle = e, this._onTitleChange.fire(e), true;
  }
  setIconName(e) {
    return this._iconName = e, true;
  }
  setOrReportIndexedColor(e) {
    let i = [], r = e.split(";");
    for (; r.length > 1; ) {
      let n = r.shift(), o2 = r.shift();
      if (/^\d+$/.exec(n)) {
        let l = parseInt(n);
        if (Sl(l)) if (o2 === "?") i.push({ type: 0, index: l });
        else {
          let a = Ws(o2);
          a && i.push({ type: 1, index: l, color: a });
        }
      }
    }
    return i.length && this._onColor.fire(i), true;
  }
  setHyperlink(e) {
    let i = e.indexOf(";");
    if (i === -1) return true;
    let r = e.slice(0, i).trim(), n = e.slice(i + 1);
    return n ? this._createHyperlink(r, n) : r.trim() ? false : this._finishHyperlink();
  }
  _createHyperlink(e, i) {
    this._getCurrentLinkId() && this._finishHyperlink();
    let r = e.split(":"), n, o2 = r.findIndex((l) => l.startsWith("id="));
    return o2 !== -1 && (n = r[o2].slice(3) || void 0), this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = this._oscLinkService.registerLink({ id: n, uri: i }), this._curAttrData.updateExtended(), true;
  }
  _finishHyperlink() {
    return this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = 0, this._curAttrData.updateExtended(), true;
  }
  _setOrReportSpecialColor(e, i) {
    let r = e.split(";");
    for (let n = 0; n < r.length && !(i >= this._specialColors.length); ++n, ++i) if (r[n] === "?") this._onColor.fire([{ type: 0, index: this._specialColors[i] }]);
    else {
      let o2 = Ws(r[n]);
      o2 && this._onColor.fire([{ type: 1, index: this._specialColors[i], color: o2 }]);
    }
    return true;
  }
  setOrReportFgColor(e) {
    return this._setOrReportSpecialColor(e, 0);
  }
  setOrReportBgColor(e) {
    return this._setOrReportSpecialColor(e, 1);
  }
  setOrReportCursorColor(e) {
    return this._setOrReportSpecialColor(e, 2);
  }
  restoreIndexedColor(e) {
    if (!e) return this._onColor.fire([{ type: 2 }]), true;
    let i = [], r = e.split(";");
    for (let n = 0; n < r.length; ++n) if (/^\d+$/.exec(r[n])) {
      let o2 = parseInt(r[n]);
      Sl(o2) && i.push({ type: 2, index: o2 });
    }
    return i.length && this._onColor.fire(i), true;
  }
  restoreFgColor(e) {
    return this._onColor.fire([{ type: 2, index: 256 }]), true;
  }
  restoreBgColor(e) {
    return this._onColor.fire([{ type: 2, index: 257 }]), true;
  }
  restoreCursorColor(e) {
    return this._onColor.fire([{ type: 2, index: 258 }]), true;
  }
  nextLine() {
    return this._activeBuffer.x = 0, this.index(), true;
  }
  keypadApplicationMode() {
    return this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = true, this._onRequestSyncScrollBar.fire(), true;
  }
  keypadNumericMode() {
    return this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = false, this._onRequestSyncScrollBar.fire(), true;
  }
  selectDefaultCharset() {
    return this._charsetService.setgLevel(0), this._charsetService.setgCharset(0, Je), true;
  }
  selectCharset(e) {
    return e.length !== 2 ? (this.selectDefaultCharset(), true) : (e[0] === "/" || this._charsetService.setgCharset(mc[e[0]], ne[e[1]] || Je), true);
  }
  index() {
    return this._restrictCursor(), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._restrictCursor(), true;
  }
  tabSet() {
    return this._activeBuffer.tabs[this._activeBuffer.x] = true, true;
  }
  reverseIndex() {
    if (this._restrictCursor(), this._activeBuffer.y === this._activeBuffer.scrollTop) {
      let e = this._activeBuffer.scrollBottom - this._activeBuffer.scrollTop;
      this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase + this._activeBuffer.y, e, 1), this._activeBuffer.lines.set(this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.getBlankLine(this._eraseAttrData())), this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom);
    } else this._activeBuffer.y--, this._restrictCursor();
    return true;
  }
  fullReset() {
    return this._parser.reset(), this._onRequestReset.fire(), true;
  }
  reset() {
    this._curAttrData = X.clone(), this._eraseAttrDataInternal = X.clone();
  }
  _eraseAttrData() {
    return this._eraseAttrDataInternal.bg &= -67108864, this._eraseAttrDataInternal.bg |= this._curAttrData.bg & 67108863, this._eraseAttrDataInternal;
  }
  setgLevel(e) {
    return this._charsetService.setgLevel(e), true;
  }
  screenAlignmentPattern() {
    let e = new q();
    e.content = 1 << 22 | 69, e.fg = this._curAttrData.fg, e.bg = this._curAttrData.bg, this._setCursor(0, 0);
    for (let i = 0; i < this._bufferService.rows; ++i) {
      let r = this._activeBuffer.ybase + this._activeBuffer.y + i, n = this._activeBuffer.lines.get(r);
      n && (n.fill(e), n.isWrapped = false);
    }
    return this._dirtyRowTracker.markAllDirty(), this._setCursor(0, 0), true;
  }
  requestStatusString(e, i) {
    let r = (a) => (this._coreService.triggerDataEvent(`${b.ESC}${a}${b.ESC}\\`), true), n = this._bufferService.buffer, o2 = this._optionsService.rawOptions, l = { block: 2, underline: 4, bar: 6 };
    return r(e === '"q' ? `P1$r${this._curAttrData.isProtected() ? 1 : 0}"q` : e === '"p' ? 'P1$r61;1"p' : e === "r" ? `P1$r${n.scrollTop + 1};${n.scrollBottom + 1}r` : e === "m" ? "P1$r0m" : e === " q" ? `P1$r${l[o2.cursorStyle] - (o2.cursorBlink ? 1 : 0)} q` : "P0$r");
  }
  markRangeDirty(e, i) {
    this._dirtyRowTracker.markRangeDirty(e, i);
  }
};
var Zi = class {
  constructor(t) {
    this._bufferService = t;
    this.clearRange();
  }
  clearRange() {
    this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
  }
  markDirty(t) {
    t < this.start ? this.start = t : t > this.end && (this.end = t);
  }
  markRangeDirty(t, e) {
    t > e && (gl = t, t = e, e = gl), t < this.start && (this.start = t), e > this.end && (this.end = e);
  }
  markAllDirty() {
    this.markRangeDirty(0, this._bufferService.rows - 1);
  }
};
Zi = M([S(0, F)], Zi);
function Sl(s15) {
  return 0 <= s15 && s15 < 256;
}
var _c = 5e7;
var El = 12;
var bc = 50;
var gn = class extends D {
  constructor(e) {
    super();
    this._action = e;
    this._writeBuffer = [];
    this._callbacks = [];
    this._pendingData = 0;
    this._bufferOffset = 0;
    this._isSyncWriting = false;
    this._syncCalls = 0;
    this._didUserInput = false;
    this._onWriteParsed = this._register(new v());
    this.onWriteParsed = this._onWriteParsed.event;
  }
  handleUserInput() {
    this._didUserInput = true;
  }
  writeSync(e, i) {
    if (i !== void 0 && this._syncCalls > i) {
      this._syncCalls = 0;
      return;
    }
    if (this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(void 0), this._syncCalls++, this._isSyncWriting) return;
    this._isSyncWriting = true;
    let r;
    for (; r = this._writeBuffer.shift(); ) {
      this._action(r);
      let n = this._callbacks.shift();
      n && n();
    }
    this._pendingData = 0, this._bufferOffset = 2147483647, this._isSyncWriting = false, this._syncCalls = 0;
  }
  write(e, i) {
    if (this._pendingData > _c) throw new Error("write data discarded, use flow control to avoid losing data");
    if (!this._writeBuffer.length) {
      if (this._bufferOffset = 0, this._didUserInput) {
        this._didUserInput = false, this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(i), this._innerWrite();
        return;
      }
      setTimeout(() => this._innerWrite());
    }
    this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(i);
  }
  _innerWrite(e = 0, i = true) {
    let r = e || performance.now();
    for (; this._writeBuffer.length > this._bufferOffset; ) {
      let n = this._writeBuffer[this._bufferOffset], o2 = this._action(n, i);
      if (o2) {
        let a = (u) => performance.now() - r >= El ? setTimeout(() => this._innerWrite(0, u)) : this._innerWrite(r, u);
        o2.catch((u) => (queueMicrotask(() => {
          throw u;
        }), Promise.resolve(false))).then(a);
        return;
      }
      let l = this._callbacks[this._bufferOffset];
      if (l && l(), this._bufferOffset++, this._pendingData -= n.length, performance.now() - r >= El) break;
    }
    this._writeBuffer.length > this._bufferOffset ? (this._bufferOffset > bc && (this._writeBuffer = this._writeBuffer.slice(this._bufferOffset), this._callbacks = this._callbacks.slice(this._bufferOffset), this._bufferOffset = 0), setTimeout(() => this._innerWrite())) : (this._writeBuffer.length = 0, this._callbacks.length = 0, this._pendingData = 0, this._bufferOffset = 0), this._onWriteParsed.fire();
  }
};
var ui = class {
  constructor(t) {
    this._bufferService = t;
    this._nextId = 1;
    this._entriesWithId = /* @__PURE__ */ new Map();
    this._dataByLinkId = /* @__PURE__ */ new Map();
  }
  registerLink(t) {
    let e = this._bufferService.buffer;
    if (t.id === void 0) {
      let a = e.addMarker(e.ybase + e.y), u = { data: t, id: this._nextId++, lines: [a] };
      return a.onDispose(() => this._removeMarkerFromLink(u, a)), this._dataByLinkId.set(u.id, u), u.id;
    }
    let i = t, r = this._getEntryIdKey(i), n = this._entriesWithId.get(r);
    if (n) return this.addLineToLink(n.id, e.ybase + e.y), n.id;
    let o2 = e.addMarker(e.ybase + e.y), l = { id: this._nextId++, key: this._getEntryIdKey(i), data: i, lines: [o2] };
    return o2.onDispose(() => this._removeMarkerFromLink(l, o2)), this._entriesWithId.set(l.key, l), this._dataByLinkId.set(l.id, l), l.id;
  }
  addLineToLink(t, e) {
    let i = this._dataByLinkId.get(t);
    if (i && i.lines.every((r) => r.line !== e)) {
      let r = this._bufferService.buffer.addMarker(e);
      i.lines.push(r), r.onDispose(() => this._removeMarkerFromLink(i, r));
    }
  }
  getLinkData(t) {
    return this._dataByLinkId.get(t)?.data;
  }
  _getEntryIdKey(t) {
    return `${t.id};;${t.uri}`;
  }
  _removeMarkerFromLink(t, e) {
    let i = t.lines.indexOf(e);
    i !== -1 && (t.lines.splice(i, 1), t.lines.length === 0 && (t.data.id !== void 0 && this._entriesWithId.delete(t.key), this._dataByLinkId.delete(t.id)));
  }
};
ui = M([S(0, F)], ui);
var Tl = false;
var Sn = class extends D {
  constructor(e) {
    super();
    this._windowsWrappingHeuristics = this._register(new ye());
    this._onBinary = this._register(new v());
    this.onBinary = this._onBinary.event;
    this._onData = this._register(new v());
    this.onData = this._onData.event;
    this._onLineFeed = this._register(new v());
    this.onLineFeed = this._onLineFeed.event;
    this._onResize = this._register(new v());
    this.onResize = this._onResize.event;
    this._onWriteParsed = this._register(new v());
    this.onWriteParsed = this._onWriteParsed.event;
    this._onScroll = this._register(new v());
    this._instantiationService = new ln(), this.optionsService = this._register(new dn(e)), this._instantiationService.setService(H, this.optionsService), this._bufferService = this._register(this._instantiationService.createInstance(ni)), this._instantiationService.setService(F, this._bufferService), this._logService = this._register(this._instantiationService.createInstance(ii)), this._instantiationService.setService(nr, this._logService), this.coreService = this._register(this._instantiationService.createInstance(li)), this._instantiationService.setService(ge, this.coreService), this.coreMouseService = this._register(this._instantiationService.createInstance(ai)), this._instantiationService.setService(rr, this.coreMouseService), this.unicodeService = this._register(this._instantiationService.createInstance(Ae)), this._instantiationService.setService(Js, this.unicodeService), this._charsetService = this._instantiationService.createInstance(pn), this._instantiationService.setService(Zs, this._charsetService), this._oscLinkService = this._instantiationService.createInstance(ui), this._instantiationService.setService(sr, this._oscLinkService), this._inputHandler = this._register(new vn(this._bufferService, this._charsetService, this.coreService, this._logService, this.optionsService, this._oscLinkService, this.coreMouseService, this.unicodeService)), this._register($.forward(this._inputHandler.onLineFeed, this._onLineFeed)), this._register(this._inputHandler), this._register($.forward(this._bufferService.onResize, this._onResize)), this._register($.forward(this.coreService.onData, this._onData)), this._register($.forward(this.coreService.onBinary, this._onBinary)), this._register(this.coreService.onRequestScrollToBottom(() => this.scrollToBottom(true))), this._register(this.coreService.onUserInput(() => this._writeBuffer.handleUserInput())), this._register(this.optionsService.onMultipleOptionChange(["windowsMode", "windowsPty"], () => this._handleWindowsPtyOptionChange())), this._register(this._bufferService.onScroll(() => {
      this._onScroll.fire({ position: this._bufferService.buffer.ydisp }), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
    })), this._writeBuffer = this._register(new gn((i, r) => this._inputHandler.parse(i, r))), this._register($.forward(this._writeBuffer.onWriteParsed, this._onWriteParsed));
  }
  get onScroll() {
    return this._onScrollApi || (this._onScrollApi = this._register(new v()), this._onScroll.event((e) => {
      this._onScrollApi?.fire(e.position);
    })), this._onScrollApi.event;
  }
  get cols() {
    return this._bufferService.cols;
  }
  get rows() {
    return this._bufferService.rows;
  }
  get buffers() {
    return this._bufferService.buffers;
  }
  get options() {
    return this.optionsService.options;
  }
  set options(e) {
    for (let i in e) this.optionsService.options[i] = e[i];
  }
  write(e, i) {
    this._writeBuffer.write(e, i);
  }
  writeSync(e, i) {
    this._logService.logLevel <= 3 && !Tl && (this._logService.warn("writeSync is unreliable and will be removed soon."), Tl = true), this._writeBuffer.writeSync(e, i);
  }
  input(e, i = true) {
    this.coreService.triggerDataEvent(e, i);
  }
  resize(e, i) {
    isNaN(e) || isNaN(i) || (e = Math.max(e, ks), i = Math.max(i, Cs), this._bufferService.resize(e, i));
  }
  scroll(e, i = false) {
    this._bufferService.scroll(e, i);
  }
  scrollLines(e, i) {
    this._bufferService.scrollLines(e, i);
  }
  scrollPages(e) {
    this.scrollLines(e * (this.rows - 1));
  }
  scrollToTop() {
    this.scrollLines(-this._bufferService.buffer.ydisp);
  }
  scrollToBottom(e) {
    this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
  }
  scrollToLine(e) {
    let i = e - this._bufferService.buffer.ydisp;
    i !== 0 && this.scrollLines(i);
  }
  registerEscHandler(e, i) {
    return this._inputHandler.registerEscHandler(e, i);
  }
  registerDcsHandler(e, i) {
    return this._inputHandler.registerDcsHandler(e, i);
  }
  registerCsiHandler(e, i) {
    return this._inputHandler.registerCsiHandler(e, i);
  }
  registerOscHandler(e, i) {
    return this._inputHandler.registerOscHandler(e, i);
  }
  _setup() {
    this._handleWindowsPtyOptionChange();
  }
  reset() {
    this._inputHandler.reset(), this._bufferService.reset(), this._charsetService.reset(), this.coreService.reset(), this.coreMouseService.reset();
  }
  _handleWindowsPtyOptionChange() {
    let e = false, i = this.optionsService.rawOptions.windowsPty;
    i && i.buildNumber !== void 0 && i.buildNumber !== void 0 ? e = i.backend === "conpty" && i.buildNumber < 21376 : this.optionsService.rawOptions.windowsMode && (e = true), e ? this._enableWindowsWrappingHeuristics() : this._windowsWrappingHeuristics.clear();
  }
  _enableWindowsWrappingHeuristics() {
    if (!this._windowsWrappingHeuristics.value) {
      let e = [];
      e.push(this.onLineFeed(Bs.bind(null, this._bufferService))), e.push(this.registerCsiHandler({ final: "H" }, () => (Bs(this._bufferService), false))), this._windowsWrappingHeuristics.value = C(() => {
        for (let i of e) i.dispose();
      });
    }
  }
};
var gc = { 48: ["0", ")"], 49: ["1", "!"], 50: ["2", "@"], 51: ["3", "#"], 52: ["4", "$"], 53: ["5", "%"], 54: ["6", "^"], 55: ["7", "&"], 56: ["8", "*"], 57: ["9", "("], 186: [";", ":"], 187: ["=", "+"], 188: [",", "<"], 189: ["-", "_"], 190: [".", ">"], 191: ["/", "?"], 192: ["`", "~"], 219: ["[", "{"], 220: ["\\", "|"], 221: ["]", "}"], 222: ["'", '"'] };
function Il(s15, t, e, i) {
  let r = { type: 0, cancel: false, key: void 0 }, n = (s15.shiftKey ? 1 : 0) | (s15.altKey ? 2 : 0) | (s15.ctrlKey ? 4 : 0) | (s15.metaKey ? 8 : 0);
  switch (s15.keyCode) {
    case 0:
      s15.key === "UIKeyInputUpArrow" ? t ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A" : s15.key === "UIKeyInputLeftArrow" ? t ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D" : s15.key === "UIKeyInputRightArrow" ? t ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C" : s15.key === "UIKeyInputDownArrow" && (t ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B");
      break;
    case 8:
      r.key = s15.ctrlKey ? "\b" : b.DEL, s15.altKey && (r.key = b.ESC + r.key);
      break;
    case 9:
      if (s15.shiftKey) {
        r.key = b.ESC + "[Z";
        break;
      }
      r.key = b.HT, r.cancel = true;
      break;
    case 13:
      r.key = s15.altKey ? b.ESC + b.CR : b.CR, r.cancel = true;
      break;
    case 27:
      r.key = b.ESC, s15.altKey && (r.key = b.ESC + b.ESC), r.cancel = true;
      break;
    case 37:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "D" : t ? r.key = b.ESC + "OD" : r.key = b.ESC + "[D";
      break;
    case 39:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "C" : t ? r.key = b.ESC + "OC" : r.key = b.ESC + "[C";
      break;
    case 38:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "A" : t ? r.key = b.ESC + "OA" : r.key = b.ESC + "[A";
      break;
    case 40:
      if (s15.metaKey) break;
      n ? r.key = b.ESC + "[1;" + (n + 1) + "B" : t ? r.key = b.ESC + "OB" : r.key = b.ESC + "[B";
      break;
    case 45:
      !s15.shiftKey && !s15.ctrlKey && (r.key = b.ESC + "[2~");
      break;
    case 46:
      n ? r.key = b.ESC + "[3;" + (n + 1) + "~" : r.key = b.ESC + "[3~";
      break;
    case 36:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "H" : t ? r.key = b.ESC + "OH" : r.key = b.ESC + "[H";
      break;
    case 35:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "F" : t ? r.key = b.ESC + "OF" : r.key = b.ESC + "[F";
      break;
    case 33:
      s15.shiftKey ? r.type = 2 : s15.ctrlKey ? r.key = b.ESC + "[5;" + (n + 1) + "~" : r.key = b.ESC + "[5~";
      break;
    case 34:
      s15.shiftKey ? r.type = 3 : s15.ctrlKey ? r.key = b.ESC + "[6;" + (n + 1) + "~" : r.key = b.ESC + "[6~";
      break;
    case 112:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "P" : r.key = b.ESC + "OP";
      break;
    case 113:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "Q" : r.key = b.ESC + "OQ";
      break;
    case 114:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "R" : r.key = b.ESC + "OR";
      break;
    case 115:
      n ? r.key = b.ESC + "[1;" + (n + 1) + "S" : r.key = b.ESC + "OS";
      break;
    case 116:
      n ? r.key = b.ESC + "[15;" + (n + 1) + "~" : r.key = b.ESC + "[15~";
      break;
    case 117:
      n ? r.key = b.ESC + "[17;" + (n + 1) + "~" : r.key = b.ESC + "[17~";
      break;
    case 118:
      n ? r.key = b.ESC + "[18;" + (n + 1) + "~" : r.key = b.ESC + "[18~";
      break;
    case 119:
      n ? r.key = b.ESC + "[19;" + (n + 1) + "~" : r.key = b.ESC + "[19~";
      break;
    case 120:
      n ? r.key = b.ESC + "[20;" + (n + 1) + "~" : r.key = b.ESC + "[20~";
      break;
    case 121:
      n ? r.key = b.ESC + "[21;" + (n + 1) + "~" : r.key = b.ESC + "[21~";
      break;
    case 122:
      n ? r.key = b.ESC + "[23;" + (n + 1) + "~" : r.key = b.ESC + "[23~";
      break;
    case 123:
      n ? r.key = b.ESC + "[24;" + (n + 1) + "~" : r.key = b.ESC + "[24~";
      break;
    default:
      if (s15.ctrlKey && !s15.shiftKey && !s15.altKey && !s15.metaKey) s15.keyCode >= 65 && s15.keyCode <= 90 ? r.key = String.fromCharCode(s15.keyCode - 64) : s15.keyCode === 32 ? r.key = b.NUL : s15.keyCode >= 51 && s15.keyCode <= 55 ? r.key = String.fromCharCode(s15.keyCode - 51 + 27) : s15.keyCode === 56 ? r.key = b.DEL : s15.keyCode === 219 ? r.key = b.ESC : s15.keyCode === 220 ? r.key = b.FS : s15.keyCode === 221 && (r.key = b.GS);
      else if ((!e || i) && s15.altKey && !s15.metaKey) {
        let l = gc[s15.keyCode]?.[s15.shiftKey ? 1 : 0];
        if (l) r.key = b.ESC + l;
        else if (s15.keyCode >= 65 && s15.keyCode <= 90) {
          let a = s15.ctrlKey ? s15.keyCode - 64 : s15.keyCode + 32, u = String.fromCharCode(a);
          s15.shiftKey && (u = u.toUpperCase()), r.key = b.ESC + u;
        } else if (s15.keyCode === 32) r.key = b.ESC + (s15.ctrlKey ? b.NUL : " ");
        else if (s15.key === "Dead" && s15.code.startsWith("Key")) {
          let a = s15.code.slice(3, 4);
          s15.shiftKey || (a = a.toLowerCase()), r.key = b.ESC + a, r.cancel = true;
        }
      } else e && !s15.altKey && !s15.ctrlKey && !s15.shiftKey && s15.metaKey ? s15.keyCode === 65 && (r.type = 1) : s15.key && !s15.ctrlKey && !s15.altKey && !s15.metaKey && s15.keyCode >= 48 && s15.key.length === 1 ? r.key = s15.key : s15.key && s15.ctrlKey && (s15.key === "_" && (r.key = b.US), s15.key === "@" && (r.key = b.NUL));
      break;
  }
  return r;
}
var ee = 0;
var En = class {
  constructor(t) {
    this._getKey = t;
    this._array = [];
    this._insertedValues = [];
    this._flushInsertedTask = new Jt();
    this._isFlushingInserted = false;
    this._deletedIndices = [];
    this._flushDeletedTask = new Jt();
    this._isFlushingDeleted = false;
  }
  clear() {
    this._array.length = 0, this._insertedValues.length = 0, this._flushInsertedTask.clear(), this._isFlushingInserted = false, this._deletedIndices.length = 0, this._flushDeletedTask.clear(), this._isFlushingDeleted = false;
  }
  insert(t) {
    this._flushCleanupDeleted(), this._insertedValues.length === 0 && this._flushInsertedTask.enqueue(() => this._flushInserted()), this._insertedValues.push(t);
  }
  _flushInserted() {
    let t = this._insertedValues.sort((n, o2) => this._getKey(n) - this._getKey(o2)), e = 0, i = 0, r = new Array(this._array.length + this._insertedValues.length);
    for (let n = 0; n < r.length; n++) i >= this._array.length || this._getKey(t[e]) <= this._getKey(this._array[i]) ? (r[n] = t[e], e++) : r[n] = this._array[i++];
    this._array = r, this._insertedValues.length = 0;
  }
  _flushCleanupInserted() {
    !this._isFlushingInserted && this._insertedValues.length > 0 && this._flushInsertedTask.flush();
  }
  delete(t) {
    if (this._flushCleanupInserted(), this._array.length === 0) return false;
    let e = this._getKey(t);
    if (e === void 0 || (ee = this._search(e), ee === -1) || this._getKey(this._array[ee]) !== e) return false;
    do
      if (this._array[ee] === t) return this._deletedIndices.length === 0 && this._flushDeletedTask.enqueue(() => this._flushDeleted()), this._deletedIndices.push(ee), true;
    while (++ee < this._array.length && this._getKey(this._array[ee]) === e);
    return false;
  }
  _flushDeleted() {
    this._isFlushingDeleted = true;
    let t = this._deletedIndices.sort((n, o2) => n - o2), e = 0, i = new Array(this._array.length - t.length), r = 0;
    for (let n = 0; n < this._array.length; n++) t[e] === n ? e++ : i[r++] = this._array[n];
    this._array = i, this._deletedIndices.length = 0, this._isFlushingDeleted = false;
  }
  _flushCleanupDeleted() {
    !this._isFlushingDeleted && this._deletedIndices.length > 0 && this._flushDeletedTask.flush();
  }
  *getKeyIterator(t) {
    if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t)) do
      yield this._array[ee];
    while (++ee < this._array.length && this._getKey(this._array[ee]) === t);
  }
  forEachByKey(t, e) {
    if (this._flushCleanupInserted(), this._flushCleanupDeleted(), this._array.length !== 0 && (ee = this._search(t), !(ee < 0 || ee >= this._array.length) && this._getKey(this._array[ee]) === t)) do
      e(this._array[ee]);
    while (++ee < this._array.length && this._getKey(this._array[ee]) === t);
  }
  values() {
    return this._flushCleanupInserted(), this._flushCleanupDeleted(), [...this._array].values();
  }
  _search(t) {
    let e = 0, i = this._array.length - 1;
    for (; i >= e; ) {
      let r = e + i >> 1, n = this._getKey(this._array[r]);
      if (n > t) i = r - 1;
      else if (n < t) e = r + 1;
      else {
        for (; r > 0 && this._getKey(this._array[r - 1]) === t; ) r--;
        return r;
      }
    }
    return e;
  }
};
var Us = 0;
var yl = 0;
var Tn = class extends D {
  constructor() {
    super();
    this._decorations = new En((e) => e?.marker.line);
    this._onDecorationRegistered = this._register(new v());
    this.onDecorationRegistered = this._onDecorationRegistered.event;
    this._onDecorationRemoved = this._register(new v());
    this.onDecorationRemoved = this._onDecorationRemoved.event;
    this._register(C(() => this.reset()));
  }
  get decorations() {
    return this._decorations.values();
  }
  registerDecoration(e) {
    if (e.marker.isDisposed) return;
    let i = new Ks(e);
    if (i) {
      let r = i.marker.onDispose(() => i.dispose()), n = i.onDispose(() => {
        n.dispose(), i && (this._decorations.delete(i) && this._onDecorationRemoved.fire(i), r.dispose());
      });
      this._decorations.insert(i), this._onDecorationRegistered.fire(i);
    }
    return i;
  }
  reset() {
    for (let e of this._decorations.values()) e.dispose();
    this._decorations.clear();
  }
  *getDecorationsAtCell(e, i, r) {
    let n = 0, o2 = 0;
    for (let l of this._decorations.getKeyIterator(i)) n = l.options.x ?? 0, o2 = n + (l.options.width ?? 1), e >= n && e < o2 && (!r || (l.options.layer ?? "bottom") === r) && (yield l);
  }
  forEachDecorationAtCell(e, i, r, n) {
    this._decorations.forEachByKey(i, (o2) => {
      Us = o2.options.x ?? 0, yl = Us + (o2.options.width ?? 1), e >= Us && e < yl && (!r || (o2.options.layer ?? "bottom") === r) && n(o2);
    });
  }
};
var Ks = class extends Ee {
  constructor(e) {
    super();
    this.options = e;
    this.onRenderEmitter = this.add(new v());
    this.onRender = this.onRenderEmitter.event;
    this._onDispose = this.add(new v());
    this.onDispose = this._onDispose.event;
    this._cachedBg = null;
    this._cachedFg = null;
    this.marker = e.marker, this.options.overviewRulerOptions && !this.options.overviewRulerOptions.position && (this.options.overviewRulerOptions.position = "full");
  }
  get backgroundColorRGB() {
    return this._cachedBg === null && (this.options.backgroundColor ? this._cachedBg = z.toColor(this.options.backgroundColor) : this._cachedBg = void 0), this._cachedBg;
  }
  get foregroundColorRGB() {
    return this._cachedFg === null && (this.options.foregroundColor ? this._cachedFg = z.toColor(this.options.foregroundColor) : this._cachedFg = void 0), this._cachedFg;
  }
  dispose() {
    this._onDispose.fire(), super.dispose();
  }
};
var Sc = 1e3;
var In = class {
  constructor(t, e = Sc) {
    this._renderCallback = t;
    this._debounceThresholdMS = e;
    this._lastRefreshMs = 0;
    this._additionalRefreshRequested = false;
  }
  dispose() {
    this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
  }
  refresh(t, e, i) {
    this._rowCount = i, t = t !== void 0 ? t : 0, e = e !== void 0 ? e : this._rowCount - 1, this._rowStart = this._rowStart !== void 0 ? Math.min(this._rowStart, t) : t, this._rowEnd = this._rowEnd !== void 0 ? Math.max(this._rowEnd, e) : e;
    let r = performance.now();
    if (r - this._lastRefreshMs >= this._debounceThresholdMS) this._lastRefreshMs = r, this._innerRefresh();
    else if (!this._additionalRefreshRequested) {
      let n = r - this._lastRefreshMs, o2 = this._debounceThresholdMS - n;
      this._additionalRefreshRequested = true, this._refreshTimeoutID = window.setTimeout(() => {
        this._lastRefreshMs = performance.now(), this._innerRefresh(), this._additionalRefreshRequested = false, this._refreshTimeoutID = void 0;
      }, o2);
    }
  }
  _innerRefresh() {
    if (this._rowStart === void 0 || this._rowEnd === void 0 || this._rowCount === void 0) return;
    let t = Math.max(this._rowStart, 0), e = Math.min(this._rowEnd, this._rowCount - 1);
    this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(t, e);
  }
};
var xl = 20;
var wl = false;
var Tt = class extends D {
  constructor(e, i, r, n) {
    super();
    this._terminal = e;
    this._coreBrowserService = r;
    this._renderService = n;
    this._rowColumns = /* @__PURE__ */ new WeakMap();
    this._liveRegionLineCount = 0;
    this._charsToConsume = [];
    this._charsToAnnounce = "";
    let o2 = this._coreBrowserService.mainDocument;
    this._accessibilityContainer = o2.createElement("div"), this._accessibilityContainer.classList.add("xterm-accessibility"), this._rowContainer = o2.createElement("div"), this._rowContainer.setAttribute("role", "list"), this._rowContainer.classList.add("xterm-accessibility-tree"), this._rowElements = [];
    for (let l = 0; l < this._terminal.rows; l++) this._rowElements[l] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[l]);
    if (this._topBoundaryFocusListener = (l) => this._handleBoundaryFocus(l, 0), this._bottomBoundaryFocusListener = (l) => this._handleBoundaryFocus(l, 1), this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._accessibilityContainer.appendChild(this._rowContainer), this._liveRegion = o2.createElement("div"), this._liveRegion.classList.add("live-region"), this._liveRegion.setAttribute("aria-live", "assertive"), this._accessibilityContainer.appendChild(this._liveRegion), this._liveRegionDebouncer = this._register(new In(this._renderRows.bind(this))), !this._terminal.element) throw new Error("Cannot enable accessibility before Terminal.open");
    wl ? (this._accessibilityContainer.classList.add("debug"), this._rowContainer.classList.add("debug"), this._debugRootContainer = o2.createElement("div"), this._debugRootContainer.classList.add("xterm"), this._debugRootContainer.appendChild(o2.createTextNode("------start a11y------")), this._debugRootContainer.appendChild(this._accessibilityContainer), this._debugRootContainer.appendChild(o2.createTextNode("------end a11y------")), this._terminal.element.insertAdjacentElement("afterend", this._debugRootContainer)) : this._terminal.element.insertAdjacentElement("afterbegin", this._accessibilityContainer), this._register(this._terminal.onResize((l) => this._handleResize(l.rows))), this._register(this._terminal.onRender((l) => this._refreshRows(l.start, l.end))), this._register(this._terminal.onScroll(() => this._refreshRows())), this._register(this._terminal.onA11yChar((l) => this._handleChar(l))), this._register(this._terminal.onLineFeed(() => this._handleChar(`
`))), this._register(this._terminal.onA11yTab((l) => this._handleTab(l))), this._register(this._terminal.onKey((l) => this._handleKey(l.key))), this._register(this._terminal.onBlur(() => this._clearLiveRegion())), this._register(this._renderService.onDimensionsChange(() => this._refreshRowsDimensions())), this._register(L(o2, "selectionchange", () => this._handleSelectionChange())), this._register(this._coreBrowserService.onDprChange(() => this._refreshRowsDimensions())), this._refreshRowsDimensions(), this._refreshRows(), this._register(C(() => {
      wl ? this._debugRootContainer.remove() : this._accessibilityContainer.remove(), this._rowElements.length = 0;
    }));
  }
  _handleTab(e) {
    for (let i = 0; i < e; i++) this._handleChar(" ");
  }
  _handleChar(e) {
    this._liveRegionLineCount < xl + 1 && (this._charsToConsume.length > 0 ? this._charsToConsume.shift() !== e && (this._charsToAnnounce += e) : this._charsToAnnounce += e, e === `
` && (this._liveRegionLineCount++, this._liveRegionLineCount === xl + 1 && (this._liveRegion.textContent += _i.get())));
  }
  _clearLiveRegion() {
    this._liveRegion.textContent = "", this._liveRegionLineCount = 0;
  }
  _handleKey(e) {
    this._clearLiveRegion(), /\p{Control}/u.test(e) || this._charsToConsume.push(e);
  }
  _refreshRows(e, i) {
    this._liveRegionDebouncer.refresh(e, i, this._terminal.rows);
  }
  _renderRows(e, i) {
    let r = this._terminal.buffer, n = r.lines.length.toString();
    for (let o2 = e; o2 <= i; o2++) {
      let l = r.lines.get(r.ydisp + o2), a = [], u = l?.translateToString(true, void 0, void 0, a) || "", h2 = (r.ydisp + o2 + 1).toString(), c = this._rowElements[o2];
      c && (u.length === 0 ? (c.textContent = "\xA0", this._rowColumns.set(c, [0, 1])) : (c.textContent = u, this._rowColumns.set(c, a)), c.setAttribute("aria-posinset", h2), c.setAttribute("aria-setsize", n), this._alignRowWidth(c));
    }
    this._announceCharacters();
  }
  _announceCharacters() {
    this._charsToAnnounce.length !== 0 && (this._liveRegion.textContent += this._charsToAnnounce, this._charsToAnnounce = "");
  }
  _handleBoundaryFocus(e, i) {
    let r = e.target, n = this._rowElements[i === 0 ? 1 : this._rowElements.length - 2], o2 = r.getAttribute("aria-posinset"), l = i === 0 ? "1" : `${this._terminal.buffer.lines.length}`;
    if (o2 === l || e.relatedTarget !== n) return;
    let a, u;
    if (i === 0 ? (a = r, u = this._rowElements.pop(), this._rowContainer.removeChild(u)) : (a = this._rowElements.shift(), u = r, this._rowContainer.removeChild(a)), a.removeEventListener("focus", this._topBoundaryFocusListener), u.removeEventListener("focus", this._bottomBoundaryFocusListener), i === 0) {
      let h2 = this._createAccessibilityTreeNode();
      this._rowElements.unshift(h2), this._rowContainer.insertAdjacentElement("afterbegin", h2);
    } else {
      let h2 = this._createAccessibilityTreeNode();
      this._rowElements.push(h2), this._rowContainer.appendChild(h2);
    }
    this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._terminal.scrollLines(i === 0 ? -1 : 1), this._rowElements[i === 0 ? 1 : this._rowElements.length - 2].focus(), e.preventDefault(), e.stopImmediatePropagation();
  }
  _handleSelectionChange() {
    if (this._rowElements.length === 0) return;
    let e = this._coreBrowserService.mainDocument.getSelection();
    if (!e) return;
    if (e.isCollapsed) {
      this._rowContainer.contains(e.anchorNode) && this._terminal.clearSelection();
      return;
    }
    if (!e.anchorNode || !e.focusNode) {
      console.error("anchorNode and/or focusNode are null");
      return;
    }
    let i = { node: e.anchorNode, offset: e.anchorOffset }, r = { node: e.focusNode, offset: e.focusOffset };
    if ((i.node.compareDocumentPosition(r.node) & Node.DOCUMENT_POSITION_PRECEDING || i.node === r.node && i.offset > r.offset) && ([i, r] = [r, i]), i.node.compareDocumentPosition(this._rowElements[0]) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING) && (i = { node: this._rowElements[0].childNodes[0], offset: 0 }), !this._rowContainer.contains(i.node)) return;
    let n = this._rowElements.slice(-1)[0];
    if (r.node.compareDocumentPosition(n) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_PRECEDING) && (r = { node: n, offset: n.textContent?.length ?? 0 }), !this._rowContainer.contains(r.node)) return;
    let o2 = ({ node: u, offset: h2 }) => {
      let c = u instanceof Text ? u.parentNode : u, d = parseInt(c?.getAttribute("aria-posinset"), 10) - 1;
      if (isNaN(d)) return console.warn("row is invalid. Race condition?"), null;
      let _2 = this._rowColumns.get(c);
      if (!_2) return console.warn("columns is null. Race condition?"), null;
      let p = h2 < _2.length ? _2[h2] : _2.slice(-1)[0] + 1;
      return p >= this._terminal.cols && (++d, p = 0), { row: d, column: p };
    }, l = o2(i), a = o2(r);
    if (!(!l || !a)) {
      if (l.row > a.row || l.row === a.row && l.column >= a.column) throw new Error("invalid range");
      this._terminal.select(l.column, l.row, (a.row - l.row) * this._terminal.cols - l.column + a.column);
    }
  }
  _handleResize(e) {
    this._rowElements[this._rowElements.length - 1].removeEventListener("focus", this._bottomBoundaryFocusListener);
    for (let i = this._rowContainer.children.length; i < this._terminal.rows; i++) this._rowElements[i] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[i]);
    for (; this._rowElements.length > e; ) this._rowContainer.removeChild(this._rowElements.pop());
    this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions();
  }
  _createAccessibilityTreeNode() {
    let e = this._coreBrowserService.mainDocument.createElement("div");
    return e.setAttribute("role", "listitem"), e.tabIndex = -1, this._refreshRowDimensions(e), e;
  }
  _refreshRowsDimensions() {
    if (this._renderService.dimensions.css.cell.height) {
      Object.assign(this._accessibilityContainer.style, { width: `${this._renderService.dimensions.css.canvas.width}px`, fontSize: `${this._terminal.options.fontSize}px` }), this._rowElements.length !== this._terminal.rows && this._handleResize(this._terminal.rows);
      for (let e = 0; e < this._terminal.rows; e++) this._refreshRowDimensions(this._rowElements[e]), this._alignRowWidth(this._rowElements[e]);
    }
  }
  _refreshRowDimensions(e) {
    e.style.height = `${this._renderService.dimensions.css.cell.height}px`;
  }
  _alignRowWidth(e) {
    e.style.transform = "";
    let i = e.getBoundingClientRect().width, r = this._rowColumns.get(e)?.slice(-1)?.[0];
    if (!r) return;
    let n = r * this._renderService.dimensions.css.cell.width;
    e.style.transform = `scaleX(${n / i})`;
  }
};
Tt = M([S(1, xt), S(2, ae), S(3, ce)], Tt);
var hi = class extends D {
  constructor(e, i, r, n, o2) {
    super();
    this._element = e;
    this._mouseService = i;
    this._renderService = r;
    this._bufferService = n;
    this._linkProviderService = o2;
    this._linkCacheDisposables = [];
    this._isMouseOut = true;
    this._wasResized = false;
    this._activeLine = -1;
    this._onShowLinkUnderline = this._register(new v());
    this.onShowLinkUnderline = this._onShowLinkUnderline.event;
    this._onHideLinkUnderline = this._register(new v());
    this.onHideLinkUnderline = this._onHideLinkUnderline.event;
    this._register(C(() => {
      Ne(this._linkCacheDisposables), this._linkCacheDisposables.length = 0, this._lastMouseEvent = void 0, this._activeProviderReplies?.clear();
    })), this._register(this._bufferService.onResize(() => {
      this._clearCurrentLink(), this._wasResized = true;
    })), this._register(L(this._element, "mouseleave", () => {
      this._isMouseOut = true, this._clearCurrentLink();
    })), this._register(L(this._element, "mousemove", this._handleMouseMove.bind(this))), this._register(L(this._element, "mousedown", this._handleMouseDown.bind(this))), this._register(L(this._element, "mouseup", this._handleMouseUp.bind(this)));
  }
  get currentLink() {
    return this._currentLink;
  }
  _handleMouseMove(e) {
    this._lastMouseEvent = e;
    let i = this._positionFromMouseEvent(e, this._element, this._mouseService);
    if (!i) return;
    this._isMouseOut = false;
    let r = e.composedPath();
    for (let n = 0; n < r.length; n++) {
      let o2 = r[n];
      if (o2.classList.contains("xterm")) break;
      if (o2.classList.contains("xterm-hover")) return;
    }
    (!this._lastBufferCell || i.x !== this._lastBufferCell.x || i.y !== this._lastBufferCell.y) && (this._handleHover(i), this._lastBufferCell = i);
  }
  _handleHover(e) {
    if (this._activeLine !== e.y || this._wasResized) {
      this._clearCurrentLink(), this._askForLink(e, false), this._wasResized = false;
      return;
    }
    this._currentLink && this._linkAtPosition(this._currentLink.link, e) || (this._clearCurrentLink(), this._askForLink(e, true));
  }
  _askForLink(e, i) {
    (!this._activeProviderReplies || !i) && (this._activeProviderReplies?.forEach((n) => {
      n?.forEach((o2) => {
        o2.link.dispose && o2.link.dispose();
      });
    }), this._activeProviderReplies = /* @__PURE__ */ new Map(), this._activeLine = e.y);
    let r = false;
    for (let [n, o2] of this._linkProviderService.linkProviders.entries()) i ? this._activeProviderReplies?.get(n) && (r = this._checkLinkProviderResult(n, e, r)) : o2.provideLinks(e.y, (l) => {
      if (this._isMouseOut) return;
      let a = l?.map((u) => ({ link: u }));
      this._activeProviderReplies?.set(n, a), r = this._checkLinkProviderResult(n, e, r), this._activeProviderReplies?.size === this._linkProviderService.linkProviders.length && this._removeIntersectingLinks(e.y, this._activeProviderReplies);
    });
  }
  _removeIntersectingLinks(e, i) {
    let r = /* @__PURE__ */ new Set();
    for (let n = 0; n < i.size; n++) {
      let o2 = i.get(n);
      if (o2) for (let l = 0; l < o2.length; l++) {
        let a = o2[l], u = a.link.range.start.y < e ? 0 : a.link.range.start.x, h2 = a.link.range.end.y > e ? this._bufferService.cols : a.link.range.end.x;
        for (let c = u; c <= h2; c++) {
          if (r.has(c)) {
            o2.splice(l--, 1);
            break;
          }
          r.add(c);
        }
      }
    }
  }
  _checkLinkProviderResult(e, i, r) {
    if (!this._activeProviderReplies) return r;
    let n = this._activeProviderReplies.get(e), o2 = false;
    for (let l = 0; l < e; l++) (!this._activeProviderReplies.has(l) || this._activeProviderReplies.get(l)) && (o2 = true);
    if (!o2 && n) {
      let l = n.find((a) => this._linkAtPosition(a.link, i));
      l && (r = true, this._handleNewLink(l));
    }
    if (this._activeProviderReplies.size === this._linkProviderService.linkProviders.length && !r) for (let l = 0; l < this._activeProviderReplies.size; l++) {
      let a = this._activeProviderReplies.get(l)?.find((u) => this._linkAtPosition(u.link, i));
      if (a) {
        r = true, this._handleNewLink(a);
        break;
      }
    }
    return r;
  }
  _handleMouseDown() {
    this._mouseDownLink = this._currentLink;
  }
  _handleMouseUp(e) {
    if (!this._currentLink) return;
    let i = this._positionFromMouseEvent(e, this._element, this._mouseService);
    i && this._mouseDownLink && Ec(this._mouseDownLink.link, this._currentLink.link) && this._linkAtPosition(this._currentLink.link, i) && this._currentLink.link.activate(e, this._currentLink.link.text);
  }
  _clearCurrentLink(e, i) {
    !this._currentLink || !this._lastMouseEvent || (!e || !i || this._currentLink.link.range.start.y >= e && this._currentLink.link.range.end.y <= i) && (this._linkLeave(this._element, this._currentLink.link, this._lastMouseEvent), this._currentLink = void 0, Ne(this._linkCacheDisposables), this._linkCacheDisposables.length = 0);
  }
  _handleNewLink(e) {
    if (!this._lastMouseEvent) return;
    let i = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
    i && this._linkAtPosition(e.link, i) && (this._currentLink = e, this._currentLink.state = { decorations: { underline: e.link.decorations === void 0 ? true : e.link.decorations.underline, pointerCursor: e.link.decorations === void 0 ? true : e.link.decorations.pointerCursor }, isHovered: true }, this._linkHover(this._element, e.link, this._lastMouseEvent), e.link.decorations = {}, Object.defineProperties(e.link.decorations, { pointerCursor: { get: () => this._currentLink?.state?.decorations.pointerCursor, set: (r) => {
      this._currentLink?.state && this._currentLink.state.decorations.pointerCursor !== r && (this._currentLink.state.decorations.pointerCursor = r, this._currentLink.state.isHovered && this._element.classList.toggle("xterm-cursor-pointer", r));
    } }, underline: { get: () => this._currentLink?.state?.decorations.underline, set: (r) => {
      this._currentLink?.state && this._currentLink?.state?.decorations.underline !== r && (this._currentLink.state.decorations.underline = r, this._currentLink.state.isHovered && this._fireUnderlineEvent(e.link, r));
    } } }), this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange((r) => {
      if (!this._currentLink) return;
      let n = r.start === 0 ? 0 : r.start + 1 + this._bufferService.buffer.ydisp, o2 = this._bufferService.buffer.ydisp + 1 + r.end;
      if (this._currentLink.link.range.start.y >= n && this._currentLink.link.range.end.y <= o2 && (this._clearCurrentLink(n, o2), this._lastMouseEvent)) {
        let l = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
        l && this._askForLink(l, false);
      }
    })));
  }
  _linkHover(e, i, r) {
    this._currentLink?.state && (this._currentLink.state.isHovered = true, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(i, true), this._currentLink.state.decorations.pointerCursor && e.classList.add("xterm-cursor-pointer")), i.hover && i.hover(r, i.text);
  }
  _fireUnderlineEvent(e, i) {
    let r = e.range, n = this._bufferService.buffer.ydisp, o2 = this._createLinkUnderlineEvent(r.start.x - 1, r.start.y - n - 1, r.end.x, r.end.y - n - 1, void 0);
    (i ? this._onShowLinkUnderline : this._onHideLinkUnderline).fire(o2);
  }
  _linkLeave(e, i, r) {
    this._currentLink?.state && (this._currentLink.state.isHovered = false, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(i, false), this._currentLink.state.decorations.pointerCursor && e.classList.remove("xterm-cursor-pointer")), i.leave && i.leave(r, i.text);
  }
  _linkAtPosition(e, i) {
    let r = e.range.start.y * this._bufferService.cols + e.range.start.x, n = e.range.end.y * this._bufferService.cols + e.range.end.x, o2 = i.y * this._bufferService.cols + i.x;
    return r <= o2 && o2 <= n;
  }
  _positionFromMouseEvent(e, i, r) {
    let n = r.getCoords(e, i, this._bufferService.cols, this._bufferService.rows);
    if (n) return { x: n[0], y: n[1] + this._bufferService.buffer.ydisp };
  }
  _createLinkUnderlineEvent(e, i, r, n, o2) {
    return { x1: e, y1: i, x2: r, y2: n, cols: this._bufferService.cols, fg: o2 };
  }
};
hi = M([S(1, Dt), S(2, ce), S(3, F), S(4, lr)], hi);
function Ec(s15, t) {
  return s15.text === t.text && s15.range.start.x === t.range.start.x && s15.range.start.y === t.range.start.y && s15.range.end.x === t.range.end.x && s15.range.end.y === t.range.end.y;
}
var yn = class extends Sn {
  constructor(e = {}) {
    super(e);
    this._linkifier = this._register(new ye());
    this.browser = tn;
    this._keyDownHandled = false;
    this._keyDownSeen = false;
    this._keyPressHandled = false;
    this._unprocessedDeadKey = false;
    this._accessibilityManager = this._register(new ye());
    this._onCursorMove = this._register(new v());
    this.onCursorMove = this._onCursorMove.event;
    this._onKey = this._register(new v());
    this.onKey = this._onKey.event;
    this._onRender = this._register(new v());
    this.onRender = this._onRender.event;
    this._onSelectionChange = this._register(new v());
    this.onSelectionChange = this._onSelectionChange.event;
    this._onTitleChange = this._register(new v());
    this.onTitleChange = this._onTitleChange.event;
    this._onBell = this._register(new v());
    this.onBell = this._onBell.event;
    this._onFocus = this._register(new v());
    this._onBlur = this._register(new v());
    this._onA11yCharEmitter = this._register(new v());
    this._onA11yTabEmitter = this._register(new v());
    this._onWillOpen = this._register(new v());
    this._setup(), this._decorationService = this._instantiationService.createInstance(Tn), this._instantiationService.setService(Be, this._decorationService), this._linkProviderService = this._instantiationService.createInstance(Qr), this._instantiationService.setService(lr, this._linkProviderService), this._linkProviderService.registerLinkProvider(this._instantiationService.createInstance(wt)), this._register(this._inputHandler.onRequestBell(() => this._onBell.fire())), this._register(this._inputHandler.onRequestRefreshRows((i) => this.refresh(i?.start ?? 0, i?.end ?? this.rows - 1))), this._register(this._inputHandler.onRequestSendFocus(() => this._reportFocus())), this._register(this._inputHandler.onRequestReset(() => this.reset())), this._register(this._inputHandler.onRequestWindowsOptionsReport((i) => this._reportWindowsOptions(i))), this._register(this._inputHandler.onColor((i) => this._handleColorEvent(i))), this._register($.forward(this._inputHandler.onCursorMove, this._onCursorMove)), this._register($.forward(this._inputHandler.onTitleChange, this._onTitleChange)), this._register($.forward(this._inputHandler.onA11yChar, this._onA11yCharEmitter)), this._register($.forward(this._inputHandler.onA11yTab, this._onA11yTabEmitter)), this._register(this._bufferService.onResize((i) => this._afterResize(i.cols, i.rows))), this._register(C(() => {
      this._customKeyEventHandler = void 0, this.element?.parentNode?.removeChild(this.element);
    }));
  }
  get linkifier() {
    return this._linkifier.value;
  }
  get onFocus() {
    return this._onFocus.event;
  }
  get onBlur() {
    return this._onBlur.event;
  }
  get onA11yChar() {
    return this._onA11yCharEmitter.event;
  }
  get onA11yTab() {
    return this._onA11yTabEmitter.event;
  }
  get onWillOpen() {
    return this._onWillOpen.event;
  }
  _handleColorEvent(e) {
    if (this._themeService) for (let i of e) {
      let r, n = "";
      switch (i.index) {
        case 256:
          r = "foreground", n = "10";
          break;
        case 257:
          r = "background", n = "11";
          break;
        case 258:
          r = "cursor", n = "12";
          break;
        default:
          r = "ansi", n = "4;" + i.index;
      }
      switch (i.type) {
        case 0:
          let o2 = U.toColorRGB(r === "ansi" ? this._themeService.colors.ansi[i.index] : this._themeService.colors[r]);
          this.coreService.triggerDataEvent(`${b.ESC}]${n};${ml(o2)}${fs.ST}`);
          break;
        case 1:
          if (r === "ansi") this._themeService.modifyColors((l) => l.ansi[i.index] = j.toColor(...i.color));
          else {
            let l = r;
            this._themeService.modifyColors((a) => a[l] = j.toColor(...i.color));
          }
          break;
        case 2:
          this._themeService.restoreColor(i.index);
          break;
      }
    }
  }
  _setup() {
    super._setup(), this._customKeyEventHandler = void 0;
  }
  get buffer() {
    return this.buffers.active;
  }
  focus() {
    this.textarea && this.textarea.focus({ preventScroll: true });
  }
  _handleScreenReaderModeOptionChange(e) {
    e ? !this._accessibilityManager.value && this._renderService && (this._accessibilityManager.value = this._instantiationService.createInstance(Tt, this)) : this._accessibilityManager.clear();
  }
  _handleTextAreaFocus(e) {
    this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(b.ESC + "[I"), this.element.classList.add("focus"), this._showCursor(), this._onFocus.fire();
  }
  blur() {
    return this.textarea?.blur();
  }
  _handleTextAreaBlur() {
    this.textarea.value = "", this.refresh(this.buffer.y, this.buffer.y), this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(b.ESC + "[O"), this.element.classList.remove("focus"), this._onBlur.fire();
  }
  _syncTextArea() {
    if (!this.textarea || !this.buffer.isCursorInViewport || this._compositionHelper.isComposing || !this._renderService) return;
    let e = this.buffer.ybase + this.buffer.y, i = this.buffer.lines.get(e);
    if (!i) return;
    let r = Math.min(this.buffer.x, this.cols - 1), n = this._renderService.dimensions.css.cell.height, o2 = i.getWidth(r), l = this._renderService.dimensions.css.cell.width * o2, a = this.buffer.y * this._renderService.dimensions.css.cell.height, u = r * this._renderService.dimensions.css.cell.width;
    this.textarea.style.left = u + "px", this.textarea.style.top = a + "px", this.textarea.style.width = l + "px", this.textarea.style.height = n + "px", this.textarea.style.lineHeight = n + "px", this.textarea.style.zIndex = "-5";
  }
  _initGlobal() {
    this._bindKeys(), this._register(L(this.element, "copy", (i) => {
      this.hasSelection() && Vs(i, this._selectionService);
    }));
    let e = (i) => qs(i, this.textarea, this.coreService, this.optionsService);
    this._register(L(this.textarea, "paste", e)), this._register(L(this.element, "paste", e)), Ss ? this._register(L(this.element, "mousedown", (i) => {
      i.button === 2 && Pn(i, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
    })) : this._register(L(this.element, "contextmenu", (i) => {
      Pn(i, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
    })), Bi && this._register(L(this.element, "auxclick", (i) => {
      i.button === 1 && Mn(i, this.textarea, this.screenElement);
    }));
  }
  _bindKeys() {
    this._register(L(this.textarea, "keyup", (e) => this._keyUp(e), true)), this._register(L(this.textarea, "keydown", (e) => this._keyDown(e), true)), this._register(L(this.textarea, "keypress", (e) => this._keyPress(e), true)), this._register(L(this.textarea, "compositionstart", () => this._compositionHelper.compositionstart())), this._register(L(this.textarea, "compositionupdate", (e) => this._compositionHelper.compositionupdate(e))), this._register(L(this.textarea, "compositionend", () => this._compositionHelper.compositionend())), this._register(L(this.textarea, "input", (e) => this._inputEvent(e), true)), this._register(this.onRender(() => this._compositionHelper.updateCompositionElements()));
  }
  open(e) {
    if (!e) throw new Error("Terminal requires a parent element.");
    if (e.isConnected || this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"), this.element?.ownerDocument.defaultView && this._coreBrowserService) {
      this.element.ownerDocument.defaultView !== this._coreBrowserService.window && (this._coreBrowserService.window = this.element.ownerDocument.defaultView);
      return;
    }
    this._document = e.ownerDocument, this.options.documentOverride && this.options.documentOverride instanceof Document && (this._document = this.optionsService.rawOptions.documentOverride), this.element = this._document.createElement("div"), this.element.dir = "ltr", this.element.classList.add("terminal"), this.element.classList.add("xterm"), e.appendChild(this.element);
    let i = this._document.createDocumentFragment();
    this._viewportElement = this._document.createElement("div"), this._viewportElement.classList.add("xterm-viewport"), i.appendChild(this._viewportElement), this.screenElement = this._document.createElement("div"), this.screenElement.classList.add("xterm-screen"), this._register(L(this.screenElement, "mousemove", (o2) => this.updateCursorStyle(o2))), this._helperContainer = this._document.createElement("div"), this._helperContainer.classList.add("xterm-helpers"), this.screenElement.appendChild(this._helperContainer), i.appendChild(this.screenElement);
    let r = this.textarea = this._document.createElement("textarea");
    this.textarea.classList.add("xterm-helper-textarea"), this.textarea.setAttribute("aria-label", mi.get()), Ts || this.textarea.setAttribute("aria-multiline", "false"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.tabIndex = 0, this._register(this.optionsService.onSpecificOptionChange("disableStdin", () => r.readOnly = this.optionsService.rawOptions.disableStdin)), this.textarea.readOnly = this.optionsService.rawOptions.disableStdin, this._coreBrowserService = this._register(this._instantiationService.createInstance(Jr, this.textarea, e.ownerDocument.defaultView ?? window, this._document ?? typeof window < "u" ? window.document : null)), this._instantiationService.setService(ae, this._coreBrowserService), this._register(L(this.textarea, "focus", (o2) => this._handleTextAreaFocus(o2))), this._register(L(this.textarea, "blur", () => this._handleTextAreaBlur())), this._helperContainer.appendChild(this.textarea), this._charSizeService = this._instantiationService.createInstance(jt, this._document, this._helperContainer), this._instantiationService.setService(nt, this._charSizeService), this._themeService = this._instantiationService.createInstance(ti), this._instantiationService.setService(Re, this._themeService), this._characterJoinerService = this._instantiationService.createInstance(ct), this._instantiationService.setService(or, this._characterJoinerService), this._renderService = this._register(this._instantiationService.createInstance(Qt, this.rows, this.screenElement)), this._instantiationService.setService(ce, this._renderService), this._register(this._renderService.onRenderedViewportChange((o2) => this._onRender.fire(o2))), this.onResize((o2) => this._renderService.resize(o2.cols, o2.rows)), this._compositionView = this._document.createElement("div"), this._compositionView.classList.add("composition-view"), this._compositionHelper = this._instantiationService.createInstance($t, this.textarea, this._compositionView), this._helperContainer.appendChild(this._compositionView), this._mouseService = this._instantiationService.createInstance(Xt), this._instantiationService.setService(Dt, this._mouseService);
    let n = this._linkifier.value = this._register(this._instantiationService.createInstance(hi, this.screenElement));
    this.element.appendChild(i);
    try {
      this._onWillOpen.fire(this.element);
    } catch {
    }
    this._renderService.hasRenderer() || this._renderService.setRenderer(this._createRenderer()), this._register(this.onCursorMove(() => {
      this._renderService.handleCursorMove(), this._syncTextArea();
    })), this._register(this.onResize(() => this._renderService.handleResize(this.cols, this.rows))), this._register(this.onBlur(() => this._renderService.handleBlur())), this._register(this.onFocus(() => this._renderService.handleFocus())), this._viewport = this._register(this._instantiationService.createInstance(zt, this.element, this.screenElement)), this._register(this._viewport.onRequestScrollLines((o2) => {
      super.scrollLines(o2, false), this.refresh(0, this.rows - 1);
    })), this._selectionService = this._register(this._instantiationService.createInstance(ei, this.element, this.screenElement, n)), this._instantiationService.setService(Qs, this._selectionService), this._register(this._selectionService.onRequestScrollLines((o2) => this.scrollLines(o2.amount, o2.suppressScrollEvent))), this._register(this._selectionService.onSelectionChange(() => this._onSelectionChange.fire())), this._register(this._selectionService.onRequestRedraw((o2) => this._renderService.handleSelectionChanged(o2.start, o2.end, o2.columnSelectMode))), this._register(this._selectionService.onLinuxMouseSelection((o2) => {
      this.textarea.value = o2, this.textarea.focus(), this.textarea.select();
    })), this._register($.any(this._onScroll.event, this._inputHandler.onScroll)(() => {
      this._selectionService.refresh(), this._viewport?.queueSync();
    })), this._register(this._instantiationService.createInstance(Gt, this.screenElement)), this._register(L(this.element, "mousedown", (o2) => this._selectionService.handleMouseDown(o2))), this.coreMouseService.areMouseEventsActive ? (this._selectionService.disable(), this.element.classList.add("enable-mouse-events")) : this._selectionService.enable(), this.options.screenReaderMode && (this._accessibilityManager.value = this._instantiationService.createInstance(Tt, this)), this._register(this.optionsService.onSpecificOptionChange("screenReaderMode", (o2) => this._handleScreenReaderModeOptionChange(o2))), this.options.overviewRuler.width && (this._overviewRulerRenderer = this._register(this._instantiationService.createInstance(bt, this._viewportElement, this.screenElement))), this.optionsService.onSpecificOptionChange("overviewRuler", (o2) => {
      !this._overviewRulerRenderer && o2 && this._viewportElement && this.screenElement && (this._overviewRulerRenderer = this._register(this._instantiationService.createInstance(bt, this._viewportElement, this.screenElement)));
    }), this._charSizeService.measure(), this.refresh(0, this.rows - 1), this._initGlobal(), this.bindMouse();
  }
  _createRenderer() {
    return this._instantiationService.createInstance(Yt, this, this._document, this.element, this.screenElement, this._viewportElement, this._helperContainer, this.linkifier);
  }
  bindMouse() {
    let e = this, i = this.element;
    function r(l) {
      let a = e._mouseService.getMouseReportCoords(l, e.screenElement);
      if (!a) return false;
      let u, h2;
      switch (l.overrideType || l.type) {
        case "mousemove":
          h2 = 32, l.buttons === void 0 ? (u = 3, l.button !== void 0 && (u = l.button < 3 ? l.button : 3)) : u = l.buttons & 1 ? 0 : l.buttons & 4 ? 1 : l.buttons & 2 ? 2 : 3;
          break;
        case "mouseup":
          h2 = 0, u = l.button < 3 ? l.button : 3;
          break;
        case "mousedown":
          h2 = 1, u = l.button < 3 ? l.button : 3;
          break;
        case "wheel":
          if (e._customWheelEventHandler && e._customWheelEventHandler(l) === false) return false;
          let c = l.deltaY;
          if (c === 0 || e.coreMouseService.consumeWheelEvent(l, e._renderService?.dimensions?.device?.cell?.height, e._coreBrowserService?.dpr) === 0) return false;
          h2 = c < 0 ? 0 : 1, u = 4;
          break;
        default:
          return false;
      }
      return h2 === void 0 || u === void 0 || u > 4 ? false : e.coreMouseService.triggerMouseEvent({ col: a.col, row: a.row, x: a.x, y: a.y, button: u, action: h2, ctrl: l.ctrlKey, alt: l.altKey, shift: l.shiftKey });
    }
    let n = { mouseup: null, wheel: null, mousedrag: null, mousemove: null }, o2 = { mouseup: (l) => (r(l), l.buttons || (this._document.removeEventListener("mouseup", n.mouseup), n.mousedrag && this._document.removeEventListener("mousemove", n.mousedrag)), this.cancel(l)), wheel: (l) => (r(l), this.cancel(l, true)), mousedrag: (l) => {
      l.buttons && r(l);
    }, mousemove: (l) => {
      l.buttons || r(l);
    } };
    this._register(this.coreMouseService.onProtocolChange((l) => {
      l ? (this.optionsService.rawOptions.logLevel === "debug" && this._logService.debug("Binding to mouse events:", this.coreMouseService.explainEvents(l)), this.element.classList.add("enable-mouse-events"), this._selectionService.disable()) : (this._logService.debug("Unbinding from mouse events."), this.element.classList.remove("enable-mouse-events"), this._selectionService.enable()), l & 8 ? n.mousemove || (i.addEventListener("mousemove", o2.mousemove), n.mousemove = o2.mousemove) : (i.removeEventListener("mousemove", n.mousemove), n.mousemove = null), l & 16 ? n.wheel || (i.addEventListener("wheel", o2.wheel, { passive: false }), n.wheel = o2.wheel) : (i.removeEventListener("wheel", n.wheel), n.wheel = null), l & 2 ? n.mouseup || (n.mouseup = o2.mouseup) : (this._document.removeEventListener("mouseup", n.mouseup), n.mouseup = null), l & 4 ? n.mousedrag || (n.mousedrag = o2.mousedrag) : (this._document.removeEventListener("mousemove", n.mousedrag), n.mousedrag = null);
    })), this.coreMouseService.activeProtocol = this.coreMouseService.activeProtocol, this._register(L(i, "mousedown", (l) => {
      if (l.preventDefault(), this.focus(), !(!this.coreMouseService.areMouseEventsActive || this._selectionService.shouldForceSelection(l))) return r(l), n.mouseup && this._document.addEventListener("mouseup", n.mouseup), n.mousedrag && this._document.addEventListener("mousemove", n.mousedrag), this.cancel(l);
    })), this._register(L(i, "wheel", (l) => {
      if (!n.wheel) {
        if (this._customWheelEventHandler && this._customWheelEventHandler(l) === false) return false;
        if (!this.buffer.hasScrollback) {
          if (l.deltaY === 0) return false;
          if (e.coreMouseService.consumeWheelEvent(l, e._renderService?.dimensions?.device?.cell?.height, e._coreBrowserService?.dpr) === 0) return this.cancel(l, true);
          let h2 = b.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (l.deltaY < 0 ? "A" : "B");
          return this.coreService.triggerDataEvent(h2, true), this.cancel(l, true);
        }
      }
    }, { passive: false }));
  }
  refresh(e, i) {
    this._renderService?.refreshRows(e, i);
  }
  updateCursorStyle(e) {
    this._selectionService?.shouldColumnSelect(e) ? this.element.classList.add("column-select") : this.element.classList.remove("column-select");
  }
  _showCursor() {
    this.coreService.isCursorInitialized || (this.coreService.isCursorInitialized = true, this.refresh(this.buffer.y, this.buffer.y));
  }
  scrollLines(e, i) {
    this._viewport ? this._viewport.scrollLines(e) : super.scrollLines(e, i), this.refresh(0, this.rows - 1);
  }
  scrollPages(e) {
    this.scrollLines(e * (this.rows - 1));
  }
  scrollToTop() {
    this.scrollLines(-this._bufferService.buffer.ydisp);
  }
  scrollToBottom(e) {
    e && this._viewport ? this._viewport.scrollToLine(this.buffer.ybase, true) : this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
  }
  scrollToLine(e) {
    let i = e - this._bufferService.buffer.ydisp;
    i !== 0 && this.scrollLines(i);
  }
  paste(e) {
    Cn(e, this.textarea, this.coreService, this.optionsService);
  }
  attachCustomKeyEventHandler(e) {
    this._customKeyEventHandler = e;
  }
  attachCustomWheelEventHandler(e) {
    this._customWheelEventHandler = e;
  }
  registerLinkProvider(e) {
    return this._linkProviderService.registerLinkProvider(e);
  }
  registerCharacterJoiner(e) {
    if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
    let i = this._characterJoinerService.register(e);
    return this.refresh(0, this.rows - 1), i;
  }
  deregisterCharacterJoiner(e) {
    if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
    this._characterJoinerService.deregister(e) && this.refresh(0, this.rows - 1);
  }
  get markers() {
    return this.buffer.markers;
  }
  registerMarker(e) {
    return this.buffer.addMarker(this.buffer.ybase + this.buffer.y + e);
  }
  registerDecoration(e) {
    return this._decorationService.registerDecoration(e);
  }
  hasSelection() {
    return this._selectionService ? this._selectionService.hasSelection : false;
  }
  select(e, i, r) {
    this._selectionService.setSelection(e, i, r);
  }
  getSelection() {
    return this._selectionService ? this._selectionService.selectionText : "";
  }
  getSelectionPosition() {
    if (!(!this._selectionService || !this._selectionService.hasSelection)) return { start: { x: this._selectionService.selectionStart[0], y: this._selectionService.selectionStart[1] }, end: { x: this._selectionService.selectionEnd[0], y: this._selectionService.selectionEnd[1] } };
  }
  clearSelection() {
    this._selectionService?.clearSelection();
  }
  selectAll() {
    this._selectionService?.selectAll();
  }
  selectLines(e, i) {
    this._selectionService?.selectLines(e, i);
  }
  _keyDown(e) {
    if (this._keyDownHandled = false, this._keyDownSeen = true, this._customKeyEventHandler && this._customKeyEventHandler(e) === false) return false;
    let i = this.browser.isMac && this.options.macOptionIsMeta && e.altKey;
    if (!i && !this._compositionHelper.keydown(e)) return this.options.scrollOnUserInput && this.buffer.ybase !== this.buffer.ydisp && this.scrollToBottom(true), false;
    !i && (e.key === "Dead" || e.key === "AltGraph") && (this._unprocessedDeadKey = true);
    let r = Il(e, this.coreService.decPrivateModes.applicationCursorKeys, this.browser.isMac, this.options.macOptionIsMeta);
    if (this.updateCursorStyle(e), r.type === 3 || r.type === 2) {
      let n = this.rows - 1;
      return this.scrollLines(r.type === 2 ? -n : n), this.cancel(e, true);
    }
    if (r.type === 1 && this.selectAll(), this._isThirdLevelShift(this.browser, e) || (r.cancel && this.cancel(e, true), !r.key) || e.key && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key.charCodeAt(0) >= 65 && e.key.charCodeAt(0) <= 90) return true;
    if (this._unprocessedDeadKey) return this._unprocessedDeadKey = false, true;
    if ((r.key === b.ETX || r.key === b.CR) && (this.textarea.value = ""), this._onKey.fire({ key: r.key, domEvent: e }), this._showCursor(), this.coreService.triggerDataEvent(r.key, true), !this.optionsService.rawOptions.screenReaderMode || e.altKey || e.ctrlKey) return this.cancel(e, true);
    this._keyDownHandled = true;
  }
  _isThirdLevelShift(e, i) {
    let r = e.isMac && !this.options.macOptionIsMeta && i.altKey && !i.ctrlKey && !i.metaKey || e.isWindows && i.altKey && i.ctrlKey && !i.metaKey || e.isWindows && i.getModifierState("AltGraph");
    return i.type === "keypress" ? r : r && (!i.keyCode || i.keyCode > 47);
  }
  _keyUp(e) {
    this._keyDownSeen = false, !(this._customKeyEventHandler && this._customKeyEventHandler(e) === false) && (Tc(e) || this.focus(), this.updateCursorStyle(e), this._keyPressHandled = false);
  }
  _keyPress(e) {
    let i;
    if (this._keyPressHandled = false, this._keyDownHandled || this._customKeyEventHandler && this._customKeyEventHandler(e) === false) return false;
    if (this.cancel(e), e.charCode) i = e.charCode;
    else if (e.which === null || e.which === void 0) i = e.keyCode;
    else if (e.which !== 0 && e.charCode !== 0) i = e.which;
    else return false;
    return !i || (e.altKey || e.ctrlKey || e.metaKey) && !this._isThirdLevelShift(this.browser, e) ? false : (i = String.fromCharCode(i), this._onKey.fire({ key: i, domEvent: e }), this._showCursor(), this.coreService.triggerDataEvent(i, true), this._keyPressHandled = true, this._unprocessedDeadKey = false, true);
  }
  _inputEvent(e) {
    if (e.data && e.inputType === "insertText" && (!e.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {
      if (this._keyPressHandled) return false;
      this._unprocessedDeadKey = false;
      let i = e.data;
      return this.coreService.triggerDataEvent(i, true), this.cancel(e), true;
    }
    return false;
  }
  resize(e, i) {
    if (e === this.cols && i === this.rows) {
      this._charSizeService && !this._charSizeService.hasValidSize && this._charSizeService.measure();
      return;
    }
    super.resize(e, i);
  }
  _afterResize(e, i) {
    this._charSizeService?.measure();
  }
  clear() {
    if (!(this.buffer.ybase === 0 && this.buffer.y === 0)) {
      this.buffer.clearAllMarkers(), this.buffer.lines.set(0, this.buffer.lines.get(this.buffer.ybase + this.buffer.y)), this.buffer.lines.length = 1, this.buffer.ydisp = 0, this.buffer.ybase = 0, this.buffer.y = 0;
      for (let e = 1; e < this.rows; e++) this.buffer.lines.push(this.buffer.getBlankLine(X));
      this._onScroll.fire({ position: this.buffer.ydisp }), this.refresh(0, this.rows - 1);
    }
  }
  reset() {
    this.options.rows = this.rows, this.options.cols = this.cols;
    let e = this._customKeyEventHandler;
    this._setup(), super.reset(), this._selectionService?.reset(), this._decorationService.reset(), this._customKeyEventHandler = e, this.refresh(0, this.rows - 1);
  }
  clearTextureAtlas() {
    this._renderService?.clearTextureAtlas();
  }
  _reportFocus() {
    this.element?.classList.contains("focus") ? this.coreService.triggerDataEvent(b.ESC + "[I") : this.coreService.triggerDataEvent(b.ESC + "[O");
  }
  _reportWindowsOptions(e) {
    if (this._renderService) switch (e) {
      case 0:
        let i = this._renderService.dimensions.css.canvas.width.toFixed(0), r = this._renderService.dimensions.css.canvas.height.toFixed(0);
        this.coreService.triggerDataEvent(`${b.ESC}[4;${r};${i}t`);
        break;
      case 1:
        let n = this._renderService.dimensions.css.cell.width.toFixed(0), o2 = this._renderService.dimensions.css.cell.height.toFixed(0);
        this.coreService.triggerDataEvent(`${b.ESC}[6;${o2};${n}t`);
        break;
    }
  }
  cancel(e, i) {
    if (!(!this.options.cancelEvents && !i)) return e.preventDefault(), e.stopPropagation(), false;
  }
};
function Tc(s15) {
  return s15.keyCode === 16 || s15.keyCode === 17 || s15.keyCode === 18;
}
var xn = class {
  constructor() {
    this._addons = [];
  }
  dispose() {
    for (let t = this._addons.length - 1; t >= 0; t--) this._addons[t].instance.dispose();
  }
  loadAddon(t, e) {
    let i = { instance: e, dispose: e.dispose, isDisposed: false };
    this._addons.push(i), e.dispose = () => this._wrappedAddonDispose(i), e.activate(t);
  }
  _wrappedAddonDispose(t) {
    if (t.isDisposed) return;
    let e = -1;
    for (let i = 0; i < this._addons.length; i++) if (this._addons[i] === t) {
      e = i;
      break;
    }
    if (e === -1) throw new Error("Could not dispose an addon that has not been loaded");
    t.isDisposed = true, t.dispose.apply(t.instance), this._addons.splice(e, 1);
  }
};
var wn = class {
  constructor(t) {
    this._line = t;
  }
  get isWrapped() {
    return this._line.isWrapped;
  }
  get length() {
    return this._line.length;
  }
  getCell(t, e) {
    if (!(t < 0 || t >= this._line.length)) return e ? (this._line.loadCell(t, e), e) : this._line.loadCell(t, new q());
  }
  translateToString(t, e, i) {
    return this._line.translateToString(t, e, i);
  }
};
var Ji = class {
  constructor(t, e) {
    this._buffer = t;
    this.type = e;
  }
  init(t) {
    return this._buffer = t, this;
  }
  get cursorY() {
    return this._buffer.y;
  }
  get cursorX() {
    return this._buffer.x;
  }
  get viewportY() {
    return this._buffer.ydisp;
  }
  get baseY() {
    return this._buffer.ybase;
  }
  get length() {
    return this._buffer.lines.length;
  }
  getLine(t) {
    let e = this._buffer.lines.get(t);
    if (e) return new wn(e);
  }
  getNullCell() {
    return new q();
  }
};
var Dn = class extends D {
  constructor(e) {
    super();
    this._core = e;
    this._onBufferChange = this._register(new v());
    this.onBufferChange = this._onBufferChange.event;
    this._normal = new Ji(this._core.buffers.normal, "normal"), this._alternate = new Ji(this._core.buffers.alt, "alternate"), this._core.buffers.onBufferActivate(() => this._onBufferChange.fire(this.active));
  }
  get active() {
    if (this._core.buffers.active === this._core.buffers.normal) return this.normal;
    if (this._core.buffers.active === this._core.buffers.alt) return this.alternate;
    throw new Error("Active buffer is neither normal nor alternate");
  }
  get normal() {
    return this._normal.init(this._core.buffers.normal);
  }
  get alternate() {
    return this._alternate.init(this._core.buffers.alt);
  }
};
var Rn = class {
  constructor(t) {
    this._core = t;
  }
  registerCsiHandler(t, e) {
    return this._core.registerCsiHandler(t, (i) => e(i.toArray()));
  }
  addCsiHandler(t, e) {
    return this.registerCsiHandler(t, e);
  }
  registerDcsHandler(t, e) {
    return this._core.registerDcsHandler(t, (i, r) => e(i, r.toArray()));
  }
  addDcsHandler(t, e) {
    return this.registerDcsHandler(t, e);
  }
  registerEscHandler(t, e) {
    return this._core.registerEscHandler(t, e);
  }
  addEscHandler(t, e) {
    return this.registerEscHandler(t, e);
  }
  registerOscHandler(t, e) {
    return this._core.registerOscHandler(t, e);
  }
  addOscHandler(t, e) {
    return this.registerOscHandler(t, e);
  }
};
var Ln = class {
  constructor(t) {
    this._core = t;
  }
  register(t) {
    this._core.unicodeService.register(t);
  }
  get versions() {
    return this._core.unicodeService.versions;
  }
  get activeVersion() {
    return this._core.unicodeService.activeVersion;
  }
  set activeVersion(t) {
    this._core.unicodeService.activeVersion = t;
  }
};
var Ic = ["cols", "rows"];
var Ue = 0;
var Dl = class extends D {
  constructor(t) {
    super(), this._core = this._register(new yn(t)), this._addonManager = this._register(new xn()), this._publicOptions = { ...this._core.options };
    let e = (r) => this._core.options[r], i = (r, n) => {
      this._checkReadonlyOptions(r), this._core.options[r] = n;
    };
    for (let r in this._core.options) {
      let n = { get: e.bind(this, r), set: i.bind(this, r) };
      Object.defineProperty(this._publicOptions, r, n);
    }
  }
  _checkReadonlyOptions(t) {
    if (Ic.includes(t)) throw new Error(`Option "${t}" can only be set in the constructor`);
  }
  _checkProposedApi() {
    if (!this._core.optionsService.rawOptions.allowProposedApi) throw new Error("You must set the allowProposedApi option to true to use proposed API");
  }
  get onBell() {
    return this._core.onBell;
  }
  get onBinary() {
    return this._core.onBinary;
  }
  get onCursorMove() {
    return this._core.onCursorMove;
  }
  get onData() {
    return this._core.onData;
  }
  get onKey() {
    return this._core.onKey;
  }
  get onLineFeed() {
    return this._core.onLineFeed;
  }
  get onRender() {
    return this._core.onRender;
  }
  get onResize() {
    return this._core.onResize;
  }
  get onScroll() {
    return this._core.onScroll;
  }
  get onSelectionChange() {
    return this._core.onSelectionChange;
  }
  get onTitleChange() {
    return this._core.onTitleChange;
  }
  get onWriteParsed() {
    return this._core.onWriteParsed;
  }
  get element() {
    return this._core.element;
  }
  get parser() {
    return this._parser || (this._parser = new Rn(this._core)), this._parser;
  }
  get unicode() {
    return this._checkProposedApi(), new Ln(this._core);
  }
  get textarea() {
    return this._core.textarea;
  }
  get rows() {
    return this._core.rows;
  }
  get cols() {
    return this._core.cols;
  }
  get buffer() {
    return this._buffer || (this._buffer = this._register(new Dn(this._core))), this._buffer;
  }
  get markers() {
    return this._checkProposedApi(), this._core.markers;
  }
  get modes() {
    let t = this._core.coreService.decPrivateModes, e = "none";
    switch (this._core.coreMouseService.activeProtocol) {
      case "X10":
        e = "x10";
        break;
      case "VT200":
        e = "vt200";
        break;
      case "DRAG":
        e = "drag";
        break;
      case "ANY":
        e = "any";
        break;
    }
    return { applicationCursorKeysMode: t.applicationCursorKeys, applicationKeypadMode: t.applicationKeypad, bracketedPasteMode: t.bracketedPasteMode, insertMode: this._core.coreService.modes.insertMode, mouseTrackingMode: e, originMode: t.origin, reverseWraparoundMode: t.reverseWraparound, sendFocusMode: t.sendFocus, synchronizedOutputMode: t.synchronizedOutput, wraparoundMode: t.wraparound };
  }
  get options() {
    return this._publicOptions;
  }
  set options(t) {
    for (let e in t) this._publicOptions[e] = t[e];
  }
  blur() {
    this._core.blur();
  }
  focus() {
    this._core.focus();
  }
  input(t, e = true) {
    this._core.input(t, e);
  }
  resize(t, e) {
    this._verifyIntegers(t, e), this._core.resize(t, e);
  }
  open(t) {
    this._core.open(t);
  }
  attachCustomKeyEventHandler(t) {
    this._core.attachCustomKeyEventHandler(t);
  }
  attachCustomWheelEventHandler(t) {
    this._core.attachCustomWheelEventHandler(t);
  }
  registerLinkProvider(t) {
    return this._core.registerLinkProvider(t);
  }
  registerCharacterJoiner(t) {
    return this._checkProposedApi(), this._core.registerCharacterJoiner(t);
  }
  deregisterCharacterJoiner(t) {
    this._checkProposedApi(), this._core.deregisterCharacterJoiner(t);
  }
  registerMarker(t = 0) {
    return this._verifyIntegers(t), this._core.registerMarker(t);
  }
  registerDecoration(t) {
    return this._checkProposedApi(), this._verifyPositiveIntegers(t.x ?? 0, t.width ?? 0, t.height ?? 0), this._core.registerDecoration(t);
  }
  hasSelection() {
    return this._core.hasSelection();
  }
  select(t, e, i) {
    this._verifyIntegers(t, e, i), this._core.select(t, e, i);
  }
  getSelection() {
    return this._core.getSelection();
  }
  getSelectionPosition() {
    return this._core.getSelectionPosition();
  }
  clearSelection() {
    this._core.clearSelection();
  }
  selectAll() {
    this._core.selectAll();
  }
  selectLines(t, e) {
    this._verifyIntegers(t, e), this._core.selectLines(t, e);
  }
  dispose() {
    super.dispose();
  }
  scrollLines(t) {
    this._verifyIntegers(t), this._core.scrollLines(t);
  }
  scrollPages(t) {
    this._verifyIntegers(t), this._core.scrollPages(t);
  }
  scrollToTop() {
    this._core.scrollToTop();
  }
  scrollToBottom() {
    this._core.scrollToBottom();
  }
  scrollToLine(t) {
    this._verifyIntegers(t), this._core.scrollToLine(t);
  }
  clear() {
    this._core.clear();
  }
  write(t, e) {
    this._core.write(t, e);
  }
  writeln(t, e) {
    this._core.write(t), this._core.write(`\r
`, e);
  }
  paste(t) {
    this._core.paste(t);
  }
  refresh(t, e) {
    this._verifyIntegers(t, e), this._core.refresh(t, e);
  }
  reset() {
    this._core.reset();
  }
  clearTextureAtlas() {
    this._core.clearTextureAtlas();
  }
  loadAddon(t) {
    this._addonManager.loadAddon(this, t);
  }
  static get strings() {
    return { get promptLabel() {
      return mi.get();
    }, set promptLabel(t) {
      mi.set(t);
    }, get tooMuchOutput() {
      return _i.get();
    }, set tooMuchOutput(t) {
      _i.set(t);
    } };
  }
  _verifyIntegers(...t) {
    for (Ue of t) if (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0) throw new Error("This API only accepts integers");
  }
  _verifyPositiveIntegers(...t) {
    for (Ue of t) if (Ue && (Ue === 1 / 0 || isNaN(Ue) || Ue % 1 !== 0 || Ue < 0)) throw new Error("This API only accepts positive integers");
  }
};

// node_modules/.pnpm/@xterm+addon-fit@0.11.0/node_modules/@xterm/addon-fit/lib/addon-fit.mjs
var h = 2;
var _ = 1;
var o = class {
  activate(e) {
    this._terminal = e;
  }
  dispose() {
  }
  fit() {
    let e = this.proposeDimensions();
    if (!e || !this._terminal || isNaN(e.cols) || isNaN(e.rows)) return;
    let t = this._terminal._core;
    (this._terminal.rows !== e.rows || this._terminal.cols !== e.cols) && (t._renderService.clear(), this._terminal.resize(e.cols, e.rows));
  }
  proposeDimensions() {
    if (!this._terminal || !this._terminal.element || !this._terminal.element.parentElement) return;
    let t = this._terminal._core._renderService.dimensions;
    if (t.css.cell.width === 0 || t.css.cell.height === 0) return;
    let s15 = this._terminal.options.scrollback === 0 ? 0 : this._terminal.options.overviewRuler?.width || 14, r = window.getComputedStyle(this._terminal.element.parentElement), l = parseInt(r.getPropertyValue("height")), a = Math.max(0, parseInt(r.getPropertyValue("width"))), i = window.getComputedStyle(this._terminal.element), n = { top: parseInt(i.getPropertyValue("padding-top")), bottom: parseInt(i.getPropertyValue("padding-bottom")), right: parseInt(i.getPropertyValue("padding-right")), left: parseInt(i.getPropertyValue("padding-left")) }, m = n.top + n.bottom, d = n.right + n.left, c = l - m, p = a - d - s15;
    return { cols: Math.max(h, Math.floor(p / t.css.cell.width)), rows: Math.max(_, Math.floor(c / t.css.cell.height)) };
  }
};

// node_modules/.pnpm/@xterm+xterm@6.0.0/node_modules/@xterm/xterm/css/xterm.css
var xterm_default = `/**
 * Copyright (c) 2014 The xterm.js authors. All rights reserved.
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * https://github.com/chjj/term.js
 * @license MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 *   The original design remains. The terminal itself
 *   has been extended to include xterm CSI codes, among
 *   other features.
 */

/**
 *  Default styles for xterm.js
 */

.xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
}

.xterm.focus,
.xterm:focus {
    outline: none;
}

.xterm .xterm-helpers {
    position: absolute;
    top: 0;
    /**
     * The z-index of the helpers must be higher than the canvases in order for
     * IMEs to appear on top.
     */
    z-index: 5;
}

.xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    /* Move textarea out of the screen to the far left, so that the cursor is not visible */
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    /** Prevent wrapping so the IME appears against the textarea at the correct position */
    white-space: nowrap;
    overflow: hidden;
    resize: none;
}

.xterm .composition-view {
    /* TODO: Composition position got messed up somewhere */
    background: #000;
    color: #FFF;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
}

.xterm .composition-view.active {
    display: block;
}

.xterm .xterm-viewport {
    /* On OS X this is required in order for the scroll bar to appear fully opaque */
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
}

.xterm .xterm-screen {
    position: relative;
}

.xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
}

.xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
}

.xterm.enable-mouse-events {
    /* When mouse events are enabled (eg. tmux), revert to the standard pointer cursor */
    cursor: default;
}

.xterm.xterm-cursor-pointer,
.xterm .xterm-cursor-pointer {
    cursor: pointer;
}

.xterm.column-select.focus {
    /* Column selection mode */
    cursor: crosshair;
}

.xterm .xterm-accessibility:not(.debug),
.xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
}

.xterm .xterm-accessibility-tree:not(.debug) *::selection {
  color: transparent;
}

.xterm .xterm-accessibility-tree {
  font-family: monospace;
  user-select: text;
  white-space: pre;
}

.xterm .xterm-accessibility-tree > div {
  transform-origin: left;
  width: fit-content;
}

.xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
}

.xterm-dim {
    /* Dim should not apply to background, so the opacity of the foreground color is applied
     * explicitly in the generated class and reset to 1 here */
    opacity: 1 !important;
}

.xterm-underline-1 { text-decoration: underline; }
.xterm-underline-2 { text-decoration: double underline; }
.xterm-underline-3 { text-decoration: wavy underline; }
.xterm-underline-4 { text-decoration: dotted underline; }
.xterm-underline-5 { text-decoration: dashed underline; }

.xterm-overline {
    text-decoration: overline;
}

.xterm-overline.xterm-underline-1 { text-decoration: overline underline; }
.xterm-overline.xterm-underline-2 { text-decoration: overline double underline; }
.xterm-overline.xterm-underline-3 { text-decoration: overline wavy underline; }
.xterm-overline.xterm-underline-4 { text-decoration: overline dotted underline; }
.xterm-overline.xterm-underline-5 { text-decoration: overline dashed underline; }

.xterm-strikethrough {
    text-decoration: line-through;
}

.xterm-screen .xterm-decoration-container .xterm-decoration {
	z-index: 6;
	position: absolute;
}

.xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer {
	z-index: 7;
}

.xterm-decoration-overview-ruler {
    z-index: 8;
    position: absolute;
    top: 0;
    right: 0;
    pointer-events: none;
}

.xterm-decoration-top {
    z-index: 2;
    position: relative;
}



/* Derived from vs/base/browser/ui/scrollbar/media/scrollbar.css */

/* xterm.js customization: Override xterm's cursor style */
.xterm .xterm-scrollable-element > .scrollbar {
    cursor: default;
}

/* Arrows */
.xterm .xterm-scrollable-element > .scrollbar > .scra {
	cursor: pointer;
	font-size: 11px !important;
}

.xterm .xterm-scrollable-element > .visible {
	opacity: 1;

	/* Background rule added for IE9 - to allow clicks on dom node */
	background:rgba(0,0,0,0);

	transition: opacity 100ms linear;
	/* In front of peek view */
	z-index: 11;
}
.xterm .xterm-scrollable-element > .invisible {
	opacity: 0;
	pointer-events: none;
}
.xterm .xterm-scrollable-element > .invisible.fade {
	transition: opacity 800ms linear;
}

/* Scrollable Content Inset Shadow */
.xterm .xterm-scrollable-element > .shadow {
	position: absolute;
	display: none;
}
.xterm .xterm-scrollable-element > .shadow.top {
	display: block;
	top: 0;
	left: 3px;
	height: 3px;
	width: 100%;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 0 6px 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.left {
	display: block;
	top: 3px;
	left: 0;
	height: 100%;
	width: 3px;
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
.xterm .xterm-scrollable-element > .shadow.top-left-corner {
	display: block;
	top: 0;
	left: 0;
	height: 3px;
	width: 3px;
}
.xterm .xterm-scrollable-element > .shadow.top.left {
	box-shadow: var(--vscode-scrollbar-shadow, #000) 6px 0 6px -6px inset;
}
`;

// .dsh-plugin/client/host-version.mjs
var ROUTER_CLIENT_VERSION = true ? "0.17.0" : "";
var STALE_HOST_MESSAGE = "\u63D2\u4EF6\u540E\u53F0\u7248\u672C\u8F83\u65E7\uFF0C\u8BF7\u5B8C\u5168\u9000\u51FA\u5E76\u91CD\u542F Harness\uFF08\u5305\u62EC\u6258\u76D8\u56FE\u6807\uFF09\u540E\u518D\u4F7F\u7528\u3002";
function isMissingRemoteMethod(message) {
  const value = String(message ?? "");
  return /transport failure for [^:]+: HTTP 404\b/.test(value) || /Remote method \S+ is no longer mounted/.test(value);
}
function remoteErrorText(message, fallback = "") {
  if (isMissingRemoteMethod(message)) return STALE_HOST_MESSAGE;
  return String(message ?? "").trim() || fallback;
}
function staleHostNotice({ hostVersion, clientVersion = ROUTER_CLIENT_VERSION, loaded = true } = {}) {
  if (!loaded || !clientVersion) return "";
  if (typeof hostVersion !== "string" || !hostVersion) return `${STALE_HOST_MESSAGE}\uFF08\u754C\u9762\u4E3A ${clientVersion}\uFF0C\u540E\u53F0\u4E3A\u66F4\u65E9\u7248\u672C\uFF09`;
  if (hostVersion !== clientVersion) return `${STALE_HOST_MESSAGE}\uFF08\u754C\u9762\u4E3A ${clientVersion}\uFF0C\u540E\u53F0\u4E3A ${hostVersion}\uFF09`;
  return "";
}

// .dsh-plugin/shared/cli-terminal-protocol.mjs
var TERMINAL_TOOL_IDS = Object.freeze(["codex", "claude-code", "kimi-code", "minimax-code", "mimo-code", "grok-build", "gemini"]);
var TERMINAL_SHELL_ID = "shell";
var TERMINAL_TARGETS = Object.freeze([TERMINAL_SHELL_ID, ...TERMINAL_TOOL_IDS]);
var TERMINAL_MODES = Object.freeze(["interactive", "login"]);
var TERMINAL_LIMITS = Object.freeze({
  maxSessions: 4,
  /** A session nobody reads (panel closed, client gone) is killed after this. */
  orphanTimeoutMs: 12e4,
  /** Hard lifetime of one session. */
  maxLifetimeMs: 6 * 60 * 6e4,
  /** Output kept per session for the client to catch up. */
  bufferChars: 1e6,
  /** Largest output slice returned by one read. */
  readChars: 256e3,
  /** Longest long-poll wait for new output. */
  maxWaitMs: 1e3,
  /** Largest single input write (a paste). */
  writeChars: 65536,
  minCols: 10,
  maxCols: 500,
  minRows: 3,
  maxRows: 300
});
var TERMINAL_LOGIN_ARGS = Object.freeze({
  codex: Object.freeze(["login"]),
  "claude-code": Object.freeze(["auth", "login"]),
  "kimi-code": Object.freeze(["login"]),
  "minimax-code": Object.freeze(["login"]),
  "mimo-code": Object.freeze(["auth", "login"]),
  "grok-build": Object.freeze(["login"]),
  gemini: Object.freeze([])
});
var SESSION_ID = /^term-[a-z0-9]{6,40}$/;
function plainObject(value, subject) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${subject} must be an object`);
  return value;
}
function sessionIdOf(value) {
  if (typeof value !== "string" || !SESSION_ID.test(value)) throw new TypeError("sessionId is invalid");
  return value;
}
function boundedInteger(value, min, max, subject) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${subject} must be an integer from ${min} to ${max}`);
  return value;
}
function isAbsoluteDirectoryText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.includes("\0")) return false;
  const path = value.trim();
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}
function terminalTargetLabel(target) {
  if (target === TERMINAL_SHELL_ID) return "\u7CFB\u7EDF\u7EC8\u7AEF";
  return getOfficialTool(target)?.label ?? String(target);
}
function terminalCommandPreview(target, mode = "interactive", platform = "win32") {
  if (target === TERMINAL_SHELL_ID) return platform === "win32" ? "powershell.exe -NoLogo" : "$SHELL -l";
  const tool = getOfficialTool(target);
  const executable = tool?.probeExecutables?.[0] ?? String(target);
  const args = mode === "login" ? TERMINAL_LOGIN_ARGS[target] ?? [] : [];
  return [executable, ...args].join(" ");
}
function parseTerminalStart(value) {
  const request = plainObject(value, "terminal start request");
  if (!TERMINAL_TARGETS.includes(request.target)) throw new TypeError("target must be the shell or a fixed official CLI");
  const mode = request.mode === void 0 ? "interactive" : request.mode;
  if (!TERMINAL_MODES.includes(mode)) throw new TypeError("mode must be interactive or login");
  if (mode === "login" && request.target === TERMINAL_SHELL_ID) throw new TypeError("the shell has no login mode");
  if (!isAbsoluteDirectoryText(request.cwd)) throw new TypeError("cwd must be an absolute directory path");
  if (request.confirmed !== true) throw new TypeError("starting a terminal requires the user's confirmation");
  return {
    target: request.target,
    mode,
    cwd: request.cwd.trim(),
    cols: boundedInteger(request.cols ?? 100, TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols, "cols"),
    rows: boundedInteger(request.rows ?? 30, TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows, "rows"),
    confirmed: true
  };
}
function parseTerminalRead(value) {
  const request = plainObject(value, "terminal read request");
  const cursor = request.cursor ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError("cursor must be a non-negative integer");
  const waitMs = request.waitMs ?? 0;
  return { sessionId: sessionIdOf(request.sessionId), cursor, waitMs: boundedInteger(waitMs, 0, TERMINAL_LIMITS.maxWaitMs, "waitMs") };
}
function parseTerminalWrite(value) {
  const request = plainObject(value, "terminal write request");
  if (typeof request.data !== "string" || request.data.length === 0 || request.data.length > TERMINAL_LIMITS.writeChars) {
    throw new TypeError(`data must be 1 to ${TERMINAL_LIMITS.writeChars} characters`);
  }
  return { sessionId: sessionIdOf(request.sessionId), data: request.data };
}
function parseTerminalResize(value) {
  const request = plainObject(value, "terminal resize request");
  return {
    sessionId: sessionIdOf(request.sessionId),
    cols: boundedInteger(request.cols, TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.maxCols, "cols"),
    rows: boundedInteger(request.rows, TERMINAL_LIMITS.minRows, TERMINAL_LIMITS.maxRows, "rows")
  };
}
function parseTerminalStop(value) {
  const request = plainObject(value, "terminal stop request");
  return { sessionId: sessionIdOf(request.sessionId) };
}
var isTerminalSessionId = (value) => typeof value === "string" && SESSION_ID.test(value);

// .dsh-plugin/client/cli-terminal-state.mjs
var text3 = (value) => typeof value === "string" ? value.trim() : "";
function clientPlatform(nav = globalThis.navigator) {
  const value = `${nav?.userAgentData?.platform ?? ""} ${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  return /win/i.test(value) ? "win32" : /mac/i.test(value) ? "darwin" : "linux";
}
function terminalTargets(healthTools = [], platform = "win32") {
  const installed = new Set((Array.isArray(healthTools) ? healthTools : []).filter((item) => item?.installed).map((item) => item.id));
  return [
    { id: TERMINAL_SHELL_ID, label: platform === "win32" ? "PowerShell\uFF08\u7CFB\u7EDF\u7EC8\u7AEF\uFF09" : "Shell\uFF08\u7CFB\u7EDF\u7EC8\u7AEF\uFF09", canLogin: false },
    ...TERMINAL_TOOL_IDS.filter((id2) => installed.has(id2)).map((id2) => ({ id: id2, label: terminalTargetLabel(id2), canLogin: id2 !== "gemini" }))
  ];
}
function startProblem({ target, cwd, targets }) {
  if (!targets.some((item) => item.id === target)) return "\u8BF7\u9009\u62E9\u8981\u542F\u52A8\u7684\u7EC8\u7AEF\u3002";
  if (!text3(cwd)) return "\u8BF7\u586B\u5199\u5DE5\u4F5C\u76EE\u5F55\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF09\u3002";
  if (!isAbsoluteDirectoryText(cwd)) return "\u5DE5\u4F5C\u76EE\u5F55\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u4F8B\u5982 D:\\projects\\demo \u6216 /home/me/project\u3002";
  return "";
}
function confirmationDetails({ target, mode = "interactive", cwd, platform = "win32" }) {
  const label = target === TERMINAL_SHELL_ID ? platform === "win32" ? "PowerShell" : "\u7CFB\u7EDF Shell" : terminalTargetLabel(target);
  return {
    title: `\u542F\u52A8 ${label}${mode === "login" ? " \u767B\u5F55" : ""}\uFF1F`,
    command: terminalCommandPreview(target, mode, platform),
    cwd: text3(cwd),
    points: [
      "\u8BE5\u7EC8\u7AEF\u4E0D\u7ECF\u8FC7 Harness \u8FDB\u7A0B\u6C99\u7BB1\uFF1A\u5B83\u548C\u4F60\u81EA\u5DF1\u6253\u5F00\u7684\u7EC8\u7AEF\u4E00\u6837\uFF0C\u80FD\u8BFB\u5199\u4F60\u8D26\u53F7\u53EF\u8BBF\u95EE\u7684\u6240\u6709\u6587\u4EF6\u3001\u8FD0\u884C\u4EFB\u4F55\u547D\u4EE4\u3002",
      target === TERMINAL_SHELL_ID ? "\u4F7F\u7528\u4F60\u7684\u767B\u5F55\u73AF\u5883\u53D8\u91CF\uFF08PATH\u3001\u4EE3\u7406\u3001API Key \u7B49\uFF09\u3002" : "\u4F7F\u7528\u4F60\u81EA\u5DF1\u7684 CLI \u767B\u5F55\u72B6\u6001\u548C\u73AF\u5883\u53D8\u91CF\uFF08PATH\u3001\u4EE3\u7406\u3001API Key \u7B49\uFF09\uFF1B\u4EA7\u751F\u7684\u8D39\u7528\u6309\u8BE5 CLI \u7684\u8D26\u53F7\u6216\u5957\u9910\u8BA1\u8D39\u3002",
      "\u8F93\u5165\u548C\u8F93\u51FA\u4E0D\u4F1A\u88AB\u8BB0\u5F55\uFF1B\u6267\u884C\u5386\u53F2\u53EA\u4FDD\u5B58\u5DE5\u5177\u3001\u5DE5\u4F5C\u76EE\u5F55\u3001\u5F00\u59CB/\u7ED3\u675F\u65F6\u95F4\u548C\u9000\u51FA\u7801\u3002",
      "\u5173\u95ED\u5DE5\u4F5C\u53F0\u9762\u677F\u3001\u7ED3\u675F\u4F1A\u8BDD\u6216\u957F\u65F6\u95F4\u65E0\u4EBA\u67E5\u770B\uFF08\u7EA6 2 \u5206\u949F\uFF09\u65F6\uFF0C\u7EC8\u7AEF\u8FDB\u7A0B\u4F1A\u88AB\u7ED3\u675F\u3002"
    ]
  };
}
function endDescription({ endReason, exitCode }) {
  const code = exitCode === null || exitCode === void 0 ? "" : `\uFF0C\u9000\u51FA\u7801 ${exitCode}`;
  switch (endReason) {
    case "stopped":
      return `\u5DF2\u7531\u4F60\u7ED3\u675F${code}\u3002`;
    case "orphan":
      return "\u957F\u65F6\u95F4\u6CA1\u6709\u9762\u677F\u8BFB\u53D6\u8F93\u51FA\uFF0C\u5DF2\u81EA\u52A8\u7ED3\u675F\u3002";
    case "lifetime":
      return "\u4F1A\u8BDD\u8FBE\u5230\u6700\u957F\u65F6\u957F\uFF086 \u5C0F\u65F6\uFF09\uFF0C\u5DF2\u81EA\u52A8\u7ED3\u675F\u3002";
    case "dispose":
      return "\u63D2\u4EF6\u5DF2\u5378\u8F7D\u6216\u91CD\u65B0\u52A0\u8F7D\uFF0C\u4F1A\u8BDD\u5DF2\u7ED3\u675F\u3002";
    default:
      return `\u8FDB\u7A0B\u5DF2\u9000\u51FA${code}\u3002`;
  }
}
var formatDuration = (ms2) => {
  if (!Number.isFinite(ms2)) return "\u2014";
  const seconds = Math.round(ms2 / 1e3);
  if (seconds < 60) return `${seconds} \u79D2`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} \u5206 ${seconds % 60} \u79D2` : `${Math.floor(minutes / 60)} \u5C0F\u65F6 ${minutes % 60} \u5206`;
};
function unwrapTerminal(response, fallback) {
  if (!response?.ok) throw new Error(remoteErrorText(text3(response?.error?.message) || text3(response?.error), fallback));
  const inner = response.value;
  if (inner && typeof inner === "object" && typeof inner.ok === "boolean") {
    if (!inner.ok) throw new Error(remoteErrorText(text3(inner.error?.message) || text3(inner.error), fallback));
    return inner.value;
  }
  return inner;
}
var unwrap = unwrapTerminal;
async function loadTerminalInfo(api) {
  const info = unwrap(await api.terminalInfo(), "\u65E0\u6CD5\u8BFB\u53D6\u7EC8\u7AEF\u72B6\u6001\u3002");
  if (!info || typeof info !== "object" || !["pty", "pipe"].includes(info.backend)) throw new Error("\u7EC8\u7AEF\u72B6\u6001\u683C\u5F0F\u65E0\u6548\u3002");
  return info;
}
async function startTerminal(api, request) {
  const session = unwrap(await api.terminalStart({ ...request, confirmed: true }), "\u7EC8\u7AEF\u542F\u52A8\u5931\u8D25\u3002");
  if (!isTerminalSessionId(session?.sessionId)) throw new Error("\u7EC8\u7AEF\u542F\u52A8\u7ED3\u679C\u7F3A\u5C11\u6709\u6548\u7684\u4F1A\u8BDD ID\u3002");
  return session;
}
var TerminalConnection = class {
  constructor({ api, sessionId, onData, onExit, onError, waitMs = 800, retryMs = 1e3, resizeDelayMs = 120, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { api, sessionId, onData, onExit, onError, waitMs, retryMs, resizeDelayMs });
    this.setTimer = (callback, ms2) => setTimer(callback, ms2);
    this.clearTimer = (id2) => clearTimer(id2);
    this.cursor = 0;
    this.closed = false;
    this.pendingInput = "";
    this.writing = null;
    this.resizeTimer = null;
    this.failures = 0;
  }
  start() {
    if (!isTerminalSessionId(this.sessionId)) {
      this.closed = true;
      this.onError?.(new Error("\u7EC8\u7AEF\u4F1A\u8BDD ID \u65E0\u6548\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u8F93\u51FA\u3002"));
      this.onExit?.({ endReason: "lost", exitCode: null });
      this.loop = Promise.resolve();
      return this.loop;
    }
    this.loop = this.readLoop();
    return this.loop;
  }
  async readLoop() {
    while (!this.closed) {
      let output;
      try {
        output = unwrap(await this.api.terminalRead({ sessionId: this.sessionId, cursor: this.cursor, waitMs: this.waitMs }), "\u8BFB\u53D6\u7EC8\u7AEF\u8F93\u51FA\u5931\u8D25\u3002");
        this.failures = 0;
      } catch (error) {
        if (this.closed) return;
        this.failures += 1;
        this.onError?.(error);
        if (this.failures >= 5) {
          this.closed = true;
          this.onExit?.({ endReason: "lost", exitCode: null });
          return;
        }
        await new Promise((resolve) => this.setTimer(resolve, this.retryMs));
        continue;
      }
      if (this.closed) return;
      if (output.dropped) this.onData?.("\r\n[\u90E8\u5206\u8F83\u65E9\u7684\u8F93\u51FA\u5DF2\u4E22\u5F03]\r\n");
      if (output.data) this.onData?.(output.data);
      this.cursor = output.cursor;
      if (output.exited) {
        this.closed = true;
        this.onExit?.({ endReason: output.endReason, exitCode: output.exitCode });
        return;
      }
    }
  }
  send(data) {
    if (this.closed || !data) return;
    this.pendingInput += data;
    if (!this.writing) this.writing = this.flush();
  }
  async flush() {
    try {
      while (this.pendingInput && !this.closed) {
        const chunk = this.pendingInput.slice(0, 6e4);
        this.pendingInput = this.pendingInput.slice(chunk.length);
        try {
          unwrap(await this.api.terminalWrite({ sessionId: this.sessionId, data: chunk }), "\u53D1\u9001\u8F93\u5165\u5931\u8D25\u3002");
        } catch (error) {
          this.onError?.(error);
        }
      }
    } finally {
      this.writing = null;
    }
  }
  resize(cols, rows) {
    if (this.closed || !Number.isFinite(cols) || !Number.isFinite(rows)) return;
    cols = Math.min(TERMINAL_LIMITS.maxCols, Math.max(TERMINAL_LIMITS.minCols, Math.round(cols)));
    rows = Math.min(TERMINAL_LIMITS.maxRows, Math.max(TERMINAL_LIMITS.minRows, Math.round(rows)));
    if (this.resizeTimer) this.clearTimer(this.resizeTimer);
    this.resizeTimer = this.setTimer(() => {
      this.resizeTimer = null;
      void Promise.resolve(this.api.terminalResize({ sessionId: this.sessionId, cols, rows })).catch(() => {
      });
    }, this.resizeDelayMs);
  }
  /** Stop reading and ask the Host to kill the process. Safe to call twice. */
  async stop() {
    const wasOpen = !this.closed;
    this.closed = true;
    if (this.resizeTimer) this.clearTimer(this.resizeTimer);
    if (wasOpen) {
      try {
        await this.api.terminalStop({ sessionId: this.sessionId });
      } catch {
      }
    }
  }
};

// .dsh-plugin/client/cli-terminal.jsx
var CWD_STORAGE_KEY = "model-router.terminal.cwd";
var text4 = (value) => typeof value === "string" ? value.trim() : "";
var errorText = (error, fallback) => remoteErrorText(text4(error?.message), fallback);
function storedCwd() {
  try {
    return globalThis.localStorage?.getItem(CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
function storeCwd(value) {
  try {
    globalThis.localStorage?.setItem(CWD_STORAGE_KEY, value);
  } catch {
  }
}
var THEME = Object.freeze({
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#264f78"
});
function TerminalPane({ api, session, active, onEnded }) {
  const host = import_react4.default.useRef(null);
  const [error, setError] = import_react4.default.useState("");
  import_react4.default.useEffect(() => {
    const term = new Dl({
      cursorBlink: true,
      convertEol: false,
      fontSize: 13,
      scrollback: 5e3,
      theme: THEME,
      fontFamily: 'Cascadia Mono, Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", Menlo, monospace'
    });
    const fit = new o();
    term.loadAddon(fit);
    term.open(host.current);
    const connection = new TerminalConnection({
      api,
      sessionId: session.sessionId,
      onData: (data) => term.write(data),
      onExit: (event) => {
        term.write(`\r
\x1B[90m[${endDescription(event)}]\x1B[0m\r
`);
        onEnded(session.sessionId, event);
      },
      onError: (failure) => setError(errorText(failure, "\u7EC8\u7AEF\u901A\u4FE1\u5931\u8D25\u3002"))
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && (key === "c" && (event.shiftKey || term.hasSelection()))) {
        void globalThis.navigator?.clipboard?.writeText(term.getSelection()).catch(() => {
        });
        term.clearSelection();
        return false;
      }
      if (event.ctrlKey && event.shiftKey && key === "v") {
        void globalThis.navigator?.clipboard?.readText().then((value) => {
          if (value) term.paste(value);
        }).catch(() => {
        });
        return false;
      }
      return true;
    });
    const input = term.onData((data) => connection.send(data));
    const resized = term.onResize(({ cols, rows }) => connection.resize(cols, rows));
    const refit = () => {
      try {
        if (host.current?.offsetParent !== null) fit.fit();
      } catch {
      }
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(refit) : null;
    observer?.observe(host.current);
    refit();
    void connection.start();
    term.focus();
    return () => {
      observer?.disconnect();
      input.dispose();
      resized.dispose();
      void connection.stop();
      term.dispose();
    };
  }, [session.sessionId]);
  return /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-term-pane", style: { display: active ? "block" : "none" } }, session.limitation && /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-caption mr-term-warning" }, session.limitation, session.ptyError ? `\uFF08${session.ptyError}\uFF09` : ""), error && /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-caption mr-term-warning", role: "alert" }, error), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-term-screen", ref: host }));
}
function CliTerminalCard({ api, health }) {
  const [info, setInfo] = import_react4.default.useState({ status: "loading", value: null, error: "" });
  const [target, setTarget] = import_react4.default.useState("shell");
  const [mode, setMode] = import_react4.default.useState("interactive");
  const [cwd, setCwd] = import_react4.default.useState(storedCwd);
  const [confirming, setConfirming] = import_react4.default.useState(false);
  const [starting, setStarting] = import_react4.default.useState(false);
  const [startError, setStartError] = import_react4.default.useState("");
  const [sessions, setSessions] = import_react4.default.useState([]);
  const [activeId, setActiveId] = import_react4.default.useState("");
  const mounted = import_react4.default.useRef(true);
  const loadInfo = import_react4.default.useCallback(async () => {
    try {
      const value = await loadTerminalInfo(api);
      if (!mounted.current) return;
      setInfo({ status: "ready", value, error: "" });
    } catch (error) {
      if (mounted.current) setInfo({ status: "error", value: null, error: errorText(error, "\u65E0\u6CD5\u8BFB\u53D6\u7EC8\u7AEF\u72B6\u6001\u3002") });
    }
  }, [api]);
  import_react4.default.useEffect(() => {
    mounted.current = true;
    void loadInfo();
    return () => {
      mounted.current = false;
    };
  }, [loadInfo]);
  const platform = info.value?.platform ?? clientPlatform();
  const targets = terminalTargets(health?.tools ?? [], platform);
  const selected = targets.find((item) => item.id === target) ?? targets[0];
  import_react4.default.useEffect(() => {
    if (!targets.some((item) => item.id === target)) setTarget("shell");
  }, [targets.length]);
  import_react4.default.useEffect(() => {
    if (!selected?.canLogin && mode === "login") setMode("interactive");
  }, [selected?.id]);
  const problem = startProblem({ target: selected?.id, cwd, targets });
  const details = confirmationDetails({ target: selected?.id, mode, cwd, platform });
  const live = sessions.filter((item) => !item.ended).length;
  const maxSessions = info.value?.limits?.maxSessions ?? 4;
  const start = async () => {
    setStarting(true);
    setStartError("");
    try {
      const session = await startTerminal(api, { target: selected.id, mode, cwd: text4(cwd), cols: 100, rows: 30 });
      storeCwd(text4(cwd));
      if (!mounted.current) {
        void api.terminalStop({ sessionId: session.sessionId });
        return;
      }
      setSessions((previous) => [...previous, { ...session, ended: null }]);
      setActiveId(session.sessionId);
      setConfirming(false);
    } catch (error) {
      if (mounted.current) setStartError(errorText(error, "\u7EC8\u7AEF\u542F\u52A8\u5931\u8D25\u3002"));
    } finally {
      if (mounted.current) setStarting(false);
    }
  };
  const onEnded = import_react4.default.useCallback((sessionId, event) => {
    if (!mounted.current) return;
    setSessions((previous) => previous.map((item) => item.sessionId === sessionId ? { ...item, ended: event } : item));
    void loadInfo();
  }, [loadInfo]);
  const closeTab = (sessionId) => {
    setSessions((previous) => {
      const next = previous.filter((item) => item.sessionId !== sessionId);
      if (activeId === sessionId) setActiveId(next.at(-1)?.sessionId ?? "");
      return next;
    });
  };
  const stopSession = (sessionId) => {
    void api.terminalStop({ sessionId });
  };
  const active = sessions.find((item) => item.sessionId === activeId);
  const history = info.value?.history ?? [];
  return /* @__PURE__ */ import_react4.default.createElement("section", { className: "mr-card", "aria-label": "\u5B98\u65B9\u5DE5\u5177\u7EC8\u7AEF" }, /* @__PURE__ */ import_react4.default.createElement("style", null, xterm_default), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react4.default.createElement("div", null, /* @__PURE__ */ import_react4.default.createElement("h2", { className: "mr-card-title" }, "\u5B98\u65B9\u5DE5\u5177\u7EC8\u7AEF"), /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-card-copy" }, "\u5728\u5DE5\u4F5C\u53F0\u91CC\u4EA4\u4E92\u5F0F\u8FD0\u884C PowerShell \u6216\u5DF2\u5B89\u88C5\u7684\u5B98\u65B9 CLI\uFF08\u591A\u8F6E\u5BF9\u8BDD\u3001\u5B9E\u65F6\u8F93\u51FA\uFF0C\u53EF\u7528\u4E8E ", /* @__PURE__ */ import_react4.default.createElement("code", null, "codex login"), " \u7B49\u767B\u5F55\uFF09\u3002\u7EC8\u7AEF\u4E0D\u7ECF\u8FC7 Harness \u6C99\u7BB1\uFF0C\u4F7F\u7528\u4F60\u81EA\u5DF1\u7684 CLI \u767B\u5F55\u548C\u73AF\u5883\u53D8\u91CF\u3002")), /* @__PURE__ */ import_react4.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", onClick: () => {
    void loadInfo();
  } }, "\u5237\u65B0")), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-card-body" }, info.status === "error" && /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-error", role: "alert" }, info.error), info.value && /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-caption" }, info.value.backend === "pty" ? "\u7EC8\u7AEF\u7EC4\u4EF6\uFF1A\u4F2A\u7EC8\u7AEF\uFF08PTY\uFF09\uFF0C\u652F\u6301\u5168\u5C4F\u754C\u9762\u3001\u989C\u8272\u548C\u7A97\u53E3\u5927\u5C0F\u540C\u6B65\u3002" : `\u7EC8\u7AEF\u7EC4\u4EF6\uFF1A\u7BA1\u9053\u6A21\u5F0F\u3002${info.value.limitation ?? ""}${info.value.ptyError ? `\uFF08PTY \u52A0\u8F7D\u5931\u8D25\uFF1A${info.value.ptyError}\uFF09` : ""}`), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react4.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-term-target" }, "\u542F\u52A8"), /* @__PURE__ */ import_react4.default.createElement("select", { className: "mr-input", id: "mr-term-target", value: selected?.id ?? "shell", onChange: (event) => {
    setTarget(event.target.value);
    setConfirming(false);
  } }, targets.map((item) => /* @__PURE__ */ import_react4.default.createElement("option", { key: item.id, value: item.id }, item.label)))), selected?.canLogin && /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react4.default.createElement("span", { className: "mr-control-label" }, "\u65B9\u5F0F"), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-segment", role: "group", "aria-label": "\u542F\u52A8\u65B9\u5F0F" }, /* @__PURE__ */ import_react4.default.createElement("button", { type: "button", "aria-pressed": mode === "interactive", onClick: () => {
    setMode("interactive");
    setConfirming(false);
  } }, "\u4EA4\u4E92\u4F1A\u8BDD"), /* @__PURE__ */ import_react4.default.createElement("button", { type: "button", "aria-pressed": mode === "login", onClick: () => {
    setMode("login");
    setConfirming(false);
  } }, "\u767B\u5F55"))), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-control-group mr-term-cwd" }, /* @__PURE__ */ import_react4.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-term-cwd" }, "\u5DE5\u4F5C\u76EE\u5F55\uFF08\u7EDD\u5BF9\u8DEF\u5F84\uFF09"), /* @__PURE__ */ import_react4.default.createElement(
    "input",
    {
      className: "mr-input",
      id: "mr-term-cwd",
      value: cwd,
      spellCheck: false,
      placeholder: platform === "win32" ? "D:\\projects\\demo" : "/home/me/project",
      onChange: (event) => {
        setCwd(event.target.value);
        setConfirming(false);
      }
    }
  ))), targets.length === 1 && /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-caption" }, "\u4F53\u68C0\u5C1A\u672A\u53D1\u73B0\u5DF2\u5B89\u88C5\u7684\u5B98\u65B9 CLI\uFF1B\u5B89\u88C5\u540E\u70B9\u201C\u5B98\u65B9\u5DE5\u5177 \xB7 \u4F53\u68C0\u201D\u7684\u201C\u91CD\u65B0\u4F53\u68C0\u201D\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u5BF9\u5E94\u9009\u9879\u3002"), !confirming && /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react4.default.createElement("button", { className: "mr-button", type: "button", disabled: Boolean(problem) || live >= maxSessions || info.status !== "ready", onClick: () => {
    setStartError("");
    setConfirming(true);
  } }, "\u5F00\u59CB"), /* @__PURE__ */ import_react4.default.createElement("span", { className: "mr-caption" }, problem || (live >= maxSessions ? `\u6700\u591A\u540C\u65F6\u8FD0\u884C ${maxSessions} \u4E2A\u4F1A\u8BDD\u3002` : `\u5C06\u8FD0\u884C\uFF1A${details.command}`))), confirming && /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-term-confirm", role: "dialog", "aria-label": "\u786E\u8BA4\u542F\u52A8\u7EC8\u7AEF" }, /* @__PURE__ */ import_react4.default.createElement("strong", null, details.title), /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-caption" }, "\u547D\u4EE4\uFF1A", /* @__PURE__ */ import_react4.default.createElement("code", null, details.command), /* @__PURE__ */ import_react4.default.createElement("br", null), "\u5DE5\u4F5C\u76EE\u5F55\uFF1A", /* @__PURE__ */ import_react4.default.createElement("code", null, details.cwd)), /* @__PURE__ */ import_react4.default.createElement("ul", null, details.points.map((point) => /* @__PURE__ */ import_react4.default.createElement("li", { key: point }, point))), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react4.default.createElement("button", { className: "mr-button", type: "button", disabled: starting, onClick: () => {
    void start();
  } }, starting ? "\u6B63\u5728\u542F\u52A8\u2026" : "\u786E\u8BA4\u542F\u52A8"), /* @__PURE__ */ import_react4.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: starting, onClick: () => setConfirming(false) }, "\u53D6\u6D88"))), startError && /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-error", role: "alert" }, startError), sessions.length > 0 && /* @__PURE__ */ import_react4.default.createElement("div", { className: "mr-term-tabs", role: "tablist", "aria-label": "\u7EC8\u7AEF\u4F1A\u8BDD" }, sessions.map((item) => /* @__PURE__ */ import_react4.default.createElement("div", { key: item.sessionId, className: "mr-term-tab", role: "tab", "aria-selected": item.sessionId === activeId }, /* @__PURE__ */ import_react4.default.createElement("button", { type: "button", className: "mr-term-tab-label", onClick: () => setActiveId(item.sessionId), title: `${item.display} \xB7 ${item.cwd}` }, item.label, item.mode === "login" ? " \xB7 \u767B\u5F55" : "", item.ended ? " \xB7 \u5DF2\u7ED3\u675F" : ""), item.ended ? /* @__PURE__ */ import_react4.default.createElement("button", { type: "button", className: "mr-term-tab-close", "aria-label": "\u5173\u95ED\u6807\u7B7E", onClick: () => closeTab(item.sessionId) }, "\xD7") : /* @__PURE__ */ import_react4.default.createElement("button", { type: "button", className: "mr-term-tab-close", "aria-label": "\u7ED3\u675F\u4F1A\u8BDD", title: "\u7ED3\u675F\u4F1A\u8BDD", onClick: () => stopSession(item.sessionId) }, "\u25A0")))), sessions.map((item) => /* @__PURE__ */ import_react4.default.createElement(TerminalPane, { key: item.sessionId, api, session: item, active: item.sessionId === activeId, onEnded })), active && /* @__PURE__ */ import_react4.default.createElement("p", { className: "mr-caption" }, active.ended ? endDescription(active.ended) : `${active.display} \xB7 ${active.cwd} \xB7 \u9009\u4E2D\u6587\u5B57\u540E Ctrl+C \u590D\u5236\uFF0CCtrl+Shift+V \u7C98\u8D34\uFF1B\u62D6\u52A8\u53F3\u4E0B\u89D2\u53EF\u8C03\u6574\u9AD8\u5EA6\u3002`), history.length > 0 && /* @__PURE__ */ import_react4.default.createElement("details", { className: "mr-term-history" }, /* @__PURE__ */ import_react4.default.createElement("summary", null, "\u6700\u8FD1\u7684\u7EC8\u7AEF\u4F1A\u8BDD\uFF08\u53EA\u8BB0\u5F55\u5DE5\u5177\u3001\u76EE\u5F55\u548C\u65F6\u957F\uFF09"), /* @__PURE__ */ import_react4.default.createElement("table", { className: "mr-term-table" }, /* @__PURE__ */ import_react4.default.createElement("thead", null, /* @__PURE__ */ import_react4.default.createElement("tr", null, /* @__PURE__ */ import_react4.default.createElement("th", null, "\u5F00\u59CB"), /* @__PURE__ */ import_react4.default.createElement("th", null, "\u5DE5\u5177"), /* @__PURE__ */ import_react4.default.createElement("th", null, "\u5DE5\u4F5C\u76EE\u5F55"), /* @__PURE__ */ import_react4.default.createElement("th", null, "\u65F6\u957F"), /* @__PURE__ */ import_react4.default.createElement("th", null, "\u7ED3\u679C"))), /* @__PURE__ */ import_react4.default.createElement("tbody", null, history.map((item) => /* @__PURE__ */ import_react4.default.createElement("tr", { key: item.id }, /* @__PURE__ */ import_react4.default.createElement("td", null, item.startedAt ? new Date(item.startedAt).toLocaleString() : "\u2014"), /* @__PURE__ */ import_react4.default.createElement("td", null, item.label, item.mode === "login" ? " \xB7 \u767B\u5F55" : "", item.backend === "pipe" ? " \xB7 \u7BA1\u9053" : ""), /* @__PURE__ */ import_react4.default.createElement("td", { title: item.cwd }, item.cwd), /* @__PURE__ */ import_react4.default.createElement("td", null, formatDuration(item.durationMs)), /* @__PURE__ */ import_react4.default.createElement("td", null, endDescription(item)))))))));
}

// .dsh-plugin/client/router-main.css
var router_main_default = `.mr-workspace {
  --mr-card: #fff;
  --mr-ink: #1e2c3e;
  --mr-muted: #586b80;
  --mr-line: #dce4ed;
  --mr-accent: #2859c5;
  --mr-soft: #edf3ff;
  --mr-surface: #f3f6fa;
  --mr-button-ink: #fff;
  container: mr-workspace / inline-size;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  background: var(--mr-surface);
  color: var(--mr-ink);
  font-family: inherit;
}
.mr-workspace *, .mr-workspace *::before, .mr-workspace *::after { box-sizing: border-box; }
.mr-shell { width: min(1320px, 100%); margin: 0 auto; padding: 24px 32px 48px; }
.mr-header { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.mr-eyebrow { margin: 0 0 8px; color: var(--mr-accent); font-size: 11px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
.mr-title { margin: 0; font-size: clamp(25px, 3vw, 30px); letter-spacing: -.035em; line-height: 1.3; }
.mr-subtitle { margin: 10px 0 0; color: var(--mr-muted); font-size: 14px; line-height: 1.65; }
.mr-status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--mr-line); border-radius: 999px; background: var(--mr-card); color: var(--mr-muted); font-size: 12px; white-space: nowrap; }
.mr-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #2cba83; }
.mr-status-dot.loading { background: #e9a640; }
.mr-status-dot.error { background: #d95360; }
.mr-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, .85fr); gap: 20px; align-items: start; }
.mr-card { min-width: 0; border: 1px solid var(--mr-line); border-radius: 14px; background: var(--mr-card); box-shadow: 0 3px 12px rgba(25, 45, 76, .025); }
.mr-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 22px 0; }
.mr-card-title { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.5; }
.mr-card-copy { margin: 5px 0 0; color: var(--mr-muted); font-size: 12px; line-height: 1.55; }
.mr-card-body { padding: 18px 22px 22px; }
.mr-label { display: block; margin: 0 0 8px; font-size: 12px; font-weight: 700; }
.mr-textarea, .mr-input { width: 100%; border: 1px solid var(--mr-line); border-radius: 11px; background: #fff; color: var(--mr-ink); font: inherit; outline: none; }
.mr-textarea { min-height: 150px; padding: 13px 14px; resize: vertical; line-height: 1.7; font-size: 14px; }
.mr-input { min-height: 38px; padding: 8px 11px; font-size: 13px; }
.mr-textarea:focus, .mr-input:focus { border-color: var(--mr-accent); box-shadow: 0 0 0 3px rgba(49, 92, 200, .13); }
.mr-controls { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 14px; margin-top: 17px; }
.mr-control-group { display: flex; flex-direction: column; gap: 7px; min-width: 0; max-width: 100%; }
.mr-control-label { color: var(--mr-muted); font-size: 12px; font-weight: 650; }
.mr-segment { display: inline-flex; padding: 3px; border-radius: 10px; background: #edf1f7; }
.mr-segment button { border: 0; border-radius: 8px; padding: 8px 12px; background: transparent; color: var(--mr-muted); font: inherit; font-size: 12px; cursor: pointer; }
.mr-segment button[aria-pressed='true'] { background: #fff; color: var(--mr-ink); box-shadow: 0 2px 8px rgba(20, 35, 56, .1); font-weight: 700; }
.mr-budget { width: 140px; }
.mr-direct { min-width: min(100%, 280px); }
.mr-actions { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; margin-top: 18px; }
.mr-button { border: 1px solid transparent; border-radius: 9px; min-height: 38px; padding: 8px 14px; background: var(--mr-accent); color: var(--mr-button-ink); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.mr-button:hover:not(:disabled) { filter: brightness(.94); }
.mr-button:disabled { cursor: not-allowed; opacity: .5; }
.mr-button-secondary { border-color: var(--mr-line); background: #fff; color: var(--mr-ink); }
.mr-caption { color: var(--mr-muted); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.mr-search { margin-top: 0; }
.mr-list { display: grid; gap: 8px; margin-top: 13px; max-height: 395px; overflow-y: auto; }
.mr-route { display: flex; justify-content: space-between; gap: 10px; padding: 10px 11px; border: 1px solid var(--mr-line); border-radius: 10px; background: #f9fbfe; }
.mr-route-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; }
.mr-route-provider { margin-top: 4px; color: var(--mr-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-pill { align-self: start; flex: none; padding: 3px 7px; border-radius: 7px; background: var(--mr-soft); color: var(--mr-accent); font-size: 10px; font-weight: 700; }
.mr-empty, .mr-error { padding: 14px; border-radius: 10px; background: #f4f6fa; color: var(--mr-muted); font-size: 12px; line-height: 1.6; }
.mr-error { background: #fff0f1; color: #a52d3c; }
.mr-results { margin-top: 18px; }
.mr-result-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
.mr-metric { padding: 13px; border-radius: 12px; background: #f5f8fd; }
.mr-metric-label { color: var(--mr-muted); font-size: 10px; }
.mr-metric-value { margin-top: 5px; font-size: 15px; font-weight: 750; word-break: break-word; }
.mr-section-title { margin: 20px 0 10px; font-size: 13px; font-weight: 750; }
.mr-package { padding: 13px 14px; border: 1px solid var(--mr-line); border-radius: 11px; background: #fafcff; }
.mr-package + .mr-package { margin-top: 8px; }
.mr-package-top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; }
.mr-package-name { font-size: 12px; font-weight: 750; }
.mr-package-route { color: var(--mr-accent); font-size: 11px; font-weight: 700; }
.mr-package-copy { margin: 7px 0 0; color: var(--mr-muted); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.mr-notice { margin-top: 18px; padding: 14px 16px; border: 1px solid rgba(49, 92, 200, .16); border-radius: 12px; background: #eff4ff; color: #354d7a; font-size: 11px; line-height: 1.65; }
.mr-notice code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
@media (max-width: 850px) { .mr-grid { grid-template-columns: 1fr; } .mr-shell { padding: 24px 18px 48px; } }
@media (prefers-color-scheme: dark) {
  .mr-workspace { --mr-card: #1e2633; --mr-ink: #ecf2ff; --mr-muted: #aebbd0; --mr-line: #354154; --mr-accent: #a1baff; --mr-soft: #2b3959; --mr-surface: #141b26; --mr-button-ink: #17243b; color-scheme: dark; }
  .mr-textarea, .mr-input, .mr-segment button[aria-pressed='true'], .mr-button-secondary { background: #273245; color: var(--mr-ink); }
  .mr-segment, .mr-empty, .mr-metric { background: #222d3e; }
  .mr-route, .mr-package { background: #222d3e; }
  .mr-notice { background: #243454; color: #c9d6fa; }
  .mr-error { background: #4a2730; color: #ffd4da; }
}

/* \u5B98\u65B9\u5DE5\u5177\u5361\u7247 */
.mr-tools { display: grid; gap: 9px; }
.mr-tool { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px; border: 1px solid var(--mr-line); border-radius: 11px; background: var(--mr-card); }
.mr-tool-info { min-width: 0; flex: 1; }
.mr-tool-status { display: flex; align-items: center; gap: 6px; margin-top: 7px; color: var(--mr-muted); font-size: 11px; }
.mr-tool-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #8d9aaa; }
.mr-tool-dot.installed { background: #2cba83; }
.mr-tool-dot.running { background: #e9a640; }
.mr-tool-command { display: block; margin-top: 6px; padding: 4px 8px; font-size: 12px; background: var(--dsw-alias-markdown-code-block); border-radius: 6px; overflow-wrap: anywhere; }
.mr-tool-button { flex-shrink: 0; }
.mr-tool-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.mr-tool-detail { margin: 7px 0 0; }
.mr-tool-error { margin: 8px 0 0; padding: 9px 11px; }
.mr-tool-log { margin-top: 7px; color: var(--mr-muted); font-size: 11px; }
.mr-tool-log summary { cursor: pointer; }
.mr-tool-log pre { max-height: 140px; overflow: auto; padding: 8px; border-radius: 7px; background: var(--dsw-alias-markdown-code-block); font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.mr-tool-methods { display: flex; align-items: center; gap: 6px; margin-right: 2px; }
.mr-tool-methods label { display: flex; align-items: center; gap: 6px; color: var(--mr-muted); font-size: 11px; }
.mr-install-settings { margin-bottom: 14px; padding: 13px 14px; border: 1px solid var(--mr-line); border-radius: 11px; background: var(--mr-card); }
.mr-install-settings-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.mr-install-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.mr-install-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--mr-muted); }
.mr-install-field > span { font-weight: 600; color: var(--mr-ink); }
.mr-install-field small { font-size: 11px; line-height: 1.6; }
.mr-install-error { color: #d95360; }
.mr-install-toggle-row { display: flex; align-items: center; gap: 7px; }
.mr-channel-line { display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
.mr-pill-channel-ok { border-color: var(--dsw-alias-success, #2f9e63); color: var(--dsw-alias-success, #2f9e63); }
.mr-pill-warn { border-color: var(--dsw-alias-warning, #c27c0e); color: var(--dsw-alias-warning, #c27c0e); }
.mr-profile-card { margin-top: 18px; }
.mr-profile-state { display: block; margin: 8px 0 0; }
.mr-profile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin-top: 15px; }
.mr-profile-field { display: grid; align-content: start; gap: 6px; color: var(--mr-muted); font-size: 11px; font-weight: 650; }
.mr-profile-field .mr-input { color: var(--mr-ink); }
.mr-profile-advanced { margin-top: 14px; color: var(--mr-muted); font-size: 11px; }
.mr-profile-advanced summary { cursor: pointer; }
.mr-profile-success { padding: 10px 12px; border-radius: 10px; background: #e5f5eb; color: #175f3a; font-size: 12px; }
@media (prefers-color-scheme: dark) { .mr-profile-success { background: #193b2b; color: #b4f1cc; } }
@media (max-width: 560px) { .mr-tool { align-items: stretch; flex-direction: column; gap: 10px; } .mr-tool-button { align-self: flex-start; } }

/* \u5F00\u7BB1\u4F53\u68C0\u3001\u6210\u672C\u63A7\u5236\u3001\u6267\u884C\u8BB0\u5F55\u3001\u5B89\u5168\u8FB9\u754C */
.mr-onboarding, .mr-cost { margin-bottom: 18px; }
.mr-onboarding { border-color: rgba(49, 92, 200, .35); }
.mr-checklist { margin: 4px 0 0; padding-left: 18px; color: var(--mr-ink); font-size: 12px; line-height: 1.8; }
.mr-login { margin-top: 4px; }
.mr-login-button { margin-top: 8px; min-height: 30px; padding: 4px 10px; font-size: 12px; }
.mr-login-guide { margin-top: 8px; padding: 10px 12px; border: 1px dashed var(--mr-line); border-radius: 10px; }
.mr-login-command { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mr-login-command .mr-tool-command { margin: 0; }
.mr-tool-dot.missing-strong { background: #d95360; }
.mr-meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.mr-meter { padding: 12px 13px; border-radius: 12px; background: #f5f8fd; }
.mr-meter-top { display: flex; justify-content: space-between; gap: 8px; font-size: 15px; font-weight: 750; }
.mr-meter-over { color: #a52d3c; }
.mr-meter-track { height: 7px; margin-top: 9px; border-radius: 999px; background: rgba(38, 55, 75, .1); overflow: hidden; }
.mr-meter-fill { height: 100%; border-radius: inherit; background: #2cba83; }
.mr-meter-fill.near { background: #e9a640; }
.mr-meter-fill.over { background: #d95360; }
.mr-inline { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mr-check { display: inline-flex; align-items: center; gap: 7px; color: var(--mr-ink); font-size: 12px; }
.mr-dag { display: flex; gap: 12px; margin: 12px 0; overflow-x: auto; padding-bottom: 6px; }
.mr-dag-column { display: grid; align-content: start; gap: 8px; min-width: 240px; flex: 1 0 240px; }
.mr-dag-step { color: var(--mr-muted); font-size: 10px; font-weight: 750; letter-spacing: .08em; }
.mr-dag-node { padding: 11px 12px; border: 1px solid var(--mr-line); border-left-width: 4px; border-radius: 11px; background: #fafcff; }
.mr-dag-node.ok { border-left-color: #2cba83; }
.mr-dag-node.warn { border-left-color: #e9a640; }
.mr-dag-node.error { border-left-color: #d95360; }
.mr-dag-node.blocked { border-left-color: #8d9aaa; }
.mr-dag-node.pending { border-left-color: var(--mr-accent); }
.mr-dag-node-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.mr-status-error { background: #fff0f1; color: #a52d3c; }
.mr-status-warn { background: #fff6e6; color: #8a5a08; }
.mr-status-ok { background: #e5f5eb; color: #175f3a; }
.mr-fallback-error code { font-size: 10px; overflow-wrap: anywhere; }
.mr-node-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.mr-mini { min-height: 28px; padding: 3px 9px; font-size: 11px; }
.mr-mini-select { min-height: 28px; width: auto; max-width: 180px; padding: 3px 7px; font-size: 11px; }
.mr-run { margin-top: 14px; }
.mr-table-wrap { overflow-x: auto; }
.mr-table { width: 100%; border-collapse: collapse; font-size: 11px; line-height: 1.55; }
.mr-table th, .mr-table td { padding: 8px 9px; border-bottom: 1px solid var(--mr-line); text-align: left; vertical-align: top; }
.mr-table th { color: var(--mr-muted); font-weight: 700; }
.mr-warn-text { color: #8a5a08; }
@media (prefers-color-scheme: dark) {
  .mr-meter, .mr-dag-node { background: #222d3e; }
  .mr-status-error { background: #4a2730; color: #ffd4da; }
  .mr-status-warn { background: #4a3a1c; color: #ffe2a8; }
  .mr-status-ok { background: #193b2b; color: #b4f1cc; }
  .mr-warn-text { color: #ffd38a; }
}
/* Keyboard focus: every interactive control shows a visible ring. */
.mr-workspace button:focus-visible, .mr-workspace select:focus-visible, .mr-workspace input:focus-visible, .mr-workspace textarea:focus-visible, .mr-workspace summary:focus-visible, .mr-workspace a:focus-visible { outline: 2px solid var(--mr-accent); outline-offset: 2px; }
.mr-segment button:disabled { cursor: not-allowed; opacity: .55; }
.mr-launch-workspace { flex: 1 1 320px; min-width: min(100%, 260px); }
.mr-launch-preview { margin-top: 16px; padding: 14px; border: 1px solid var(--mr-line); border-radius: 12px; background: #f9fbfe; }
.mr-launch-packages { margin: 12px 0 0; padding-left: 20px; font-size: 12px; line-height: 1.7; }
.mr-confirm-box { margin-top: 12px; padding: 10px 14px; border: 1px solid rgba(217, 140, 30, .35); border-radius: 10px; background: #fff8ec; color: #6d4a12; font-size: 12px; line-height: 1.6; }
.mr-confirm-box .mr-section-title { margin: 0 0 6px; }
.mr-confirm-box ol { margin: 0; padding-left: 20px; }
.mr-break { overflow-wrap: anywhere; }
@media (prefers-color-scheme: dark) {
  .mr-launch-preview { background: rgba(255, 255, 255, .04); }
  .mr-confirm-box { background: rgba(217, 140, 30, .12); color: #f2d39b; }
}

/* \u5B98\u65B9\u5DE5\u5177\u7EC8\u7AEF */
.mr-term-cwd { flex: 1 1 320px; min-width: 240px; }
.mr-term-cwd .mr-input { width: 100%; box-sizing: border-box; }
.mr-term-confirm { margin-top: 12px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-markdown-code-block); font-size: 13px; line-height: 20px; }
.mr-term-confirm ul { margin: 6px 0 0; padding-left: 20px; }
.mr-term-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.mr-term-tab { display: inline-flex; align-items: center; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; font-size: 12px; }
.mr-term-tab[aria-selected="true"] { border-color: var(--dsw-alias-label-primary, currentColor); font-weight: 600; }
.mr-term-tab button { border: 0; background: transparent; color: inherit; padding: 4px 8px; cursor: pointer; font: inherit; }
.mr-term-tab-close { opacity: .7; }
.mr-term-pane { margin-top: 8px; }
.mr-term-screen { height: 420px; min-height: 160px; resize: vertical; overflow: hidden; padding: 6px; background: #1e1e1e; border-radius: 8px; box-sizing: border-box; }
.mr-term-warning { color: var(--dsw-alias-label-danger); }
.mr-term-history { margin-top: 14px; font-size: 12px; }
.mr-term-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.mr-term-table th, .mr-term-table td { padding: 4px 6px; border-bottom: 1px solid rgba(127, 127, 127, .25); text-align: left; vertical-align: top; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Workspace navigation keeps every panel mounted, including running terminals. */
.mr-view[hidden] { display: none !important; }
.mr-view { min-width: 0; }
.mr-stack { display: grid; gap: 20px; }
.mr-stack > .mr-card, .mr-model-grid > .mr-card { margin: 0; }
.mr-overview { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--mr-line); background: var(--mr-card); border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
.mr-overview-item { display: grid; align-content: start; gap: 4px; min-width: 0; padding: 12px 22px; border: 0; text-align: left; background: transparent; color: var(--mr-ink); font: inherit; cursor: pointer; }
.mr-overview-item + .mr-overview-item { border-left: 1px solid var(--mr-line); }
.mr-overview-item:hover { background: var(--mr-soft); }
.mr-overview-label { color: var(--mr-muted); font-size: 12px; }
.mr-overview-item strong { font-size: 25px; font-weight: 650; line-height: 1.3; font-variant-numeric: tabular-nums; }
.mr-overview-item small { color: var(--mr-muted); font-size: 14px; font-weight: 400; }
.mr-overview-detail { color: var(--mr-muted); font-size: 11px; line-height: 1.5; }
.mr-workspace-tabs { display: flex; gap: 6px; position: sticky; top: 0; z-index: 5; background: var(--mr-surface); padding: 10px 0; margin-bottom: 14px; border-bottom: 1px solid var(--mr-line); }
.mr-workspace-tabs button { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 44px; padding: 10px 18px; border: 1px solid transparent; border-radius: 9px; color: var(--mr-muted); background: transparent; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.mr-workspace-tabs button:hover { background: var(--mr-card); color: var(--mr-ink); }
.mr-workspace-tabs button[aria-selected='true'] { background: var(--mr-card); border-color: var(--mr-line); color: var(--mr-accent); box-shadow: 0 2px 4px rgba(25, 45, 76, .04); }
.mr-tab-number { font-size: 10px; font-weight: 500; opacity: .7; font-variant-numeric: tabular-nums; }
.mr-view-heading { margin: 4px 0 20px; }
.mr-stack > .mr-view-heading { margin-bottom: 0; }
.mr-view-heading h2 { margin: 0; font-size: 20px; }
.mr-view-heading p { margin: 7px 0 0; color: var(--mr-muted); font-size: 13px; line-height: 1.6; }
.mr-planning-grid { grid-template-columns: minmax(0, 1fr) 290px; }
.mr-planning-guide { min-width: 0; padding: 20px 4px 4px 8px; }
.mr-workflow { display: grid; gap: 24px; margin: 20px 0 24px; padding: 0; list-style: none; }
.mr-workflow li { display: flex; align-items: start; gap: 12px; }
.mr-workflow li > span { display: grid; place-items: center; flex: 0 0 30px; height: 30px; border: 1px solid var(--mr-line); border-radius: 50%; background: var(--mr-card); color: var(--mr-accent); font-size: 10px; font-weight: 650; }
.mr-workflow strong { font-size: 13px; line-height: 30px; }
.mr-workflow p { margin: 2px 0 0; color: var(--mr-muted); font-size: 12px; line-height: 1.65; }
.mr-guide-links { display: grid; gap: 8px; }
.mr-guide-links .mr-button { text-align: left; font-weight: 500; font-size: 12px; }
.mr-task-hint { margin: 8px 0 0; }
.mr-plan-explanation { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--mr-line); border-radius: 9px; color: var(--mr-muted); font-size: 12px; line-height: 1.65; }
.mr-plan-explanation summary, .mr-package-details summary { cursor: pointer; }
.mr-package-details summary { line-height: 1.8; }
.mr-package-details summary .mr-package-route { display: block; margin-left: 16px; overflow-wrap: anywhere; }
.mr-package-details[open] { border-color: var(--mr-accent); }
.mr-footer { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--mr-line); color: var(--mr-muted); font-size: 11px; line-height: 1.8; overflow-wrap: anywhere; }
.mr-footer code { font-size: 11px; }
.mr-tool-status { flex-wrap: wrap; line-height: 1.6; }
.mr-table td { overflow-wrap: anywhere; }
.mr-term-cwd { min-width: min(100%, 240px); }

/* Respond to the Harness panel width, even when a wide window has a sidebar. */
@container mr-workspace (max-width: 960px) {
  .mr-shell { padding: 24px 22px 40px; }
  .mr-planning-grid { grid-template-columns: minmax(0, 1fr) 240px; }
  .mr-model-grid { grid-template-columns: 1fr; }
  .mr-planning-grid .mr-card-head { flex-wrap: wrap; }
  .mr-profile-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container mr-workspace (max-width: 680px) {
  .mr-shell { padding: 20px 14px 32px; }
  .mr-header { gap: 14px; margin-bottom: 18px; }
  .mr-subtitle { font-size: 13px; }
  .mr-overview { margin-bottom: 12px; }
  .mr-overview-item { padding: 13px 10px; gap: 6px; }
  .mr-overview-item strong { font-size: 20px; }
  .mr-overview-detail { font-size: 10px; }
  .mr-overview-item small { font-size: 11px; }
  .mr-workspace-tabs { gap: 2px; }
  .mr-workspace-tabs button { flex: 1; min-width: 0; padding: 9px 4px; font-size: 12px; }
  .mr-tab-number { display: none; }
  .mr-grid { grid-template-columns: 1fr; }
  .mr-planning-guide { padding: 12px 4px 0; }
  .mr-workflow { gap: 12px; margin: 14px 0; }
  .mr-guide-links { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mr-guide-links .mr-button { font-size: 11px; }
  .mr-card-head { padding: 18px 16px 0; align-items: start; flex-wrap: wrap; }
  .mr-card-body { padding: 14px 16px 18px; }
  .mr-profile-grid { grid-template-columns: 1fr; }
  .mr-tool { align-items: stretch; flex-direction: column; gap: 10px; }
  .mr-tool-actions { justify-content: flex-start; }
  .mr-segment { flex-wrap: wrap; max-width: 100%; }
  .mr-launch-workspace { min-width: 0; }
  .mr-result-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mr-meters { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .mr-workspace { scroll-behavior: auto; } }
`;

// .dsh-plugin/client/router-main.jsx
var money2 = (value) => value === null || value === void 0 ? "\u4EF7\u683C\u5F85\u914D\u7F6E" : `$${Number(value).toFixed(4)}`;
var text5 = (value) => typeof value === "string" ? value.trim() : "";
var routingSettingsSignature = (value) => JSON.stringify([
  value.modelProfilesJson,
  value.routingPreset,
  ...Object.keys(ADAPTIVE_DEFAULTS).map((key) => value[key] ?? ADAPTIVE_DEFAULTS[key])
]);
function RouterPanelIcon({ size = 20, active = false }) {
  return /* @__PURE__ */ import_react5.default.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, /* @__PURE__ */ import_react5.default.createElement("path", { d: "M7 6.5h7M7 17.5h7M15 6.5v11", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }), /* @__PURE__ */ import_react5.default.createElement("circle", { cx: "5", cy: "6.5", r: "2", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: "1.6" }), /* @__PURE__ */ import_react5.default.createElement("circle", { cx: "5", cy: "17.5", r: "2", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: "1.6" }), /* @__PURE__ */ import_react5.default.createElement("circle", { cx: "17", cy: "12", r: "3", fill: active ? "currentColor" : "none", stroke: "currentColor", strokeWidth: "1.7" }));
}
function RouteList({ routes, query }) {
  const filtered = routes.filter((route) => {
    const haystack = `${route.providerName} ${route.provider} ${route.name} ${route.model}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  if (filtered.length === 0) return /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-empty" }, routes.length === 0 ? "\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u5C1A\u65E0\u53EF\u89C4\u5212\u7684\u8DEF\u7EBF\u3002\u8BF7\u5148\u5728\u201C\u6A21\u578B\u201D\u9875\u5B8C\u6210\u914D\u7F6E\u3002" : "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B\u3002");
  return /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-list", role: "list", "aria-label": "\u5B98\u65B9\u5DF2\u767B\u8BB0\u6A21\u578B\u8DEF\u7EBF" }, filtered.map((route) => /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-route", role: "listitem", key: `${route.provider}/${route.model}` }, /* @__PURE__ */ import_react5.default.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-route-name", title: route.name }, route.name), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-route-provider", title: `${route.provider}/${route.model}` }, route.provider, "/", route.model)), route.reasoningKnown && /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-pill" }, "\u63A8\u7406\u7B49\u7EA7"))));
}
function ChannelBadge({ item }) {
  if (!item?.executionChannel) return null;
  const official = item.executionChannel === "official-cli";
  return /* @__PURE__ */ import_react5.default.createElement("span", { className: official ? "mr-pill mr-pill-channel-ok" : "mr-pill", title: item.channelDetail ?? "" }, official ? `\u5B98\u65B9 CLI \xB7 ${item.channelLabel ?? item.channelTool}` : "\u6A21\u578B\u76EE\u5F55 API");
}
function PlanResults({ plan, ledger, headingRef }) {
  const selected = plan.selected;
  const budget = planBudget(ledger, plan.estimatedCost);
  const packageNames = new Map((plan.team?.workPackages ?? []).map((item) => [item.id, item.name]));
  const purposeLabel = { analysis: "\u4EFB\u52A1\u5206\u6790", execution: "\u4EFB\u52A1\u5B9E\u65BD", verification: "\u72EC\u7ACB\u9A8C\u8BC1", synthesis: "\u7ED3\u679C\u6574\u5408" };
  return /* @__PURE__ */ import_react5.default.createElement("section", { className: "mr-card mr-results", "aria-label": "\u8DEF\u7531\u5EFA\u8BAE" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("h2", { className: "mr-card-title", ref: headingRef, tabIndex: -1 }, "\u8DEF\u7531\u5EFA\u8BAE"), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-card-copy" }, "\u672C\u5730\u8BA1\u7B97\u5B8C\u6210\uFF0C\u672A\u5411\u6A21\u578B\u53D1\u9001\u4EFB\u52A1\u5185\u5BB9\u3002"))), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-body" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-result-grid" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-label" }, "\u63A8\u8350\u8DEF\u7EBF"), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-value" }, selected ? `${selected.provider}/${selected.model}` : "\u6682\u65E0\u8DEF\u7EBF")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-label" }, "\u4EFB\u52A1\u590D\u6742\u5EA6 \xB7 \u5206\u503C\uFF080\u20131\uFF09"), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-value" }, { simple: "\u7B80\u5355", balanced: "\u4E2D\u7B49", complex: "\u590D\u6742" }[plan.complexity.band] || plan.complexity.band, " \xB7 ", plan.complexity.value)), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-label" }, "\u4F30\u7B97\u603B\u6210\u672C"), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-value" }, money2(plan.estimatedCost))), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-label" }, "\u8DEF\u7531\u65B9\u6848"), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-metric-value" }, ROUTING_PRESETS[plan.preset]?.label ?? "\u5747\u8861"))), budget?.exceeded && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-error", role: "alert" }, "\u6267\u884C\u524D\u9884\u7B97\u68C0\u67E5\uFF1A", budget.message, " \u5B9E\u9645\u6267\u884C\u65F6\u5C06\u6309\u8BBE\u7F6E\u81EA\u52A8\u964D\u7EA7\u6216\u6682\u505C\u8BE2\u95EE\u3002"), budget?.limited && !budget.exceeded && budget.estimateKnown && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, "\u6267\u884C\u524D\u9884\u7B97\u68C0\u67E5\uFF1A\u672C\u6B21\u9884\u4F30 ", money2(plan.estimatedCost), "\uFF0C\u5269\u4F59\u989D\u5EA6 ", money2(budget.remainingUsd), "\u3002"), plan.loginRequired && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, "\u63A8\u8350\u6A21\u578B\u7684\u5B98\u65B9 CLI \u672A\u767B\u5F55\uFF0C\u6267\u884C\u65F6\u76F4\u63A5\u8D70\u6A21\u578B\u76EE\u5F55 API\uFF1B\u53EF\u5728\u201C\u5B98\u65B9\u5DE5\u5177\u201D\u5361\u7247\u70B9\u201C\u53BB\u767B\u5F55\u201D\u3002"), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-channel-line" }, /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-control-label" }, "\u6267\u884C\u6E20\u9053"), /* @__PURE__ */ import_react5.default.createElement(ChannelBadge, { item: plan })), /* @__PURE__ */ import_react5.default.createElement("details", { className: "mr-plan-explanation" }, /* @__PURE__ */ import_react5.default.createElement("summary", null, "\u67E5\u770B\u89C4\u5212\u4F9D\u636E\u4E0E\u4F30\u7B97\u8BF4\u660E"), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, plan.reason), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, plan.pricingNotice, " ", plan.qualityNotice, " ", plan.availabilityNotice, " ", plan.modalityNotice || "")), plan.optimization.budgetExceeded && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-error" }, "\u6309\u5DF2\u63D0\u4F9B\u5355\u4EF7\u4F30\u7B97\uFF0C\u4EFB\u52A1\u53EF\u80FD\u8D85\u8FC7\u672C\u6B21\u9884\u7B97\u3002\u9884\u7B97\u53EA\u5F71\u54CD\u5EFA\u8BAE\uFF0C\u4E0D\u4F1A\u963B\u6B62\u5B9E\u9645\u6263\u8D39\u3002"), plan.mode === "team" && /* @__PURE__ */ import_react5.default.createElement(import_react5.default.Fragment, null, /* @__PURE__ */ import_react5.default.createElement("h3", { className: "mr-section-title" }, "\u56E2\u961F\u5DE5\u4F5C\u5305"), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, "\u4E0B\u65B9\u6A21\u578B\u662F\u89C4\u5212\u5EFA\u8BAE\uFF1B\u6258\u7BA1\u6267\u884C\u4F1A\u6309\u5382\u5546 CLI \u7684\u6A21\u578B\u540D\u89C4\u5219\u9009\u7528\uFF0C\u672A\u6838\u9A8C\u6620\u5C04\u65F6\u4F7F\u7528\u8BE5 CLI \u7684\u9ED8\u8BA4\u6A21\u578B\u3002"), plan.team.workPackages.length > 1 && /* @__PURE__ */ import_react5.default.createElement(DagView, { packages: plan.team.workPackages, label: "\u5DE5\u4F5C\u5305\u4F9D\u8D56\u56FE", renderNode: (item) => /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-package-route" }, item.recommendedProvider, "/", item.recommendedModel) }), plan.team.workPackages.length === 0 ? /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-empty" }, "\u5F53\u524D\u76EE\u5F55\u6CA1\u6709\u53EF\u5206\u914D\u7684\u6A21\u578B\u8DEF\u7EBF\u3002") : plan.team.workPackages.map((item, index) => /* @__PURE__ */ import_react5.default.createElement("details", { className: "mr-package mr-package-details", key: item.id }, /* @__PURE__ */ import_react5.default.createElement("summary", null, /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-package-name" }, index + 1, ". ", item.name), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-package-route" }, item.recommendedProvider, "/", item.recommendedModel)), item.objective && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-package-copy" }, "\u5177\u4F53\u76EE\u6807\uFF1A", item.objective), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-package-copy" }, purposeLabel[item.purpose] ?? item.purpose, item.dependsOn.length > 0 ? ` \xB7 \u4F9D\u8D56\uFF1A${item.dependsOn.map((id2) => packageNames.get(id2) ?? id2).join("\u3001")}` : ""), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-package-copy" }, "\u96BE\u5EA6\uFF1A", { simple: "\u7B80\u5355", balanced: "\u4E2D\u7B49", complex: "\u56F0\u96BE" }[item.difficulty] || item.difficulty || "\u5F85\u8BC4\u4F30", " \xB7 \u8D39\u7528\uFF1A", money2(item.estimatedCost)), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-package-copy" }, "\u9A8C\u6536\uFF1A", item.verificationChecklist.join("\uFF1B")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-channel-line" }, /* @__PURE__ */ import_react5.default.createElement(ChannelBadge, { item }), item.loginRequired && /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-pill" }, "CLI \u672A\u767B\u5F55")), item.channelDetail && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-package-copy" }, "\u6E20\u9053\u8BF4\u660E\uFF1A", item.channelDetail)))), plan.routingBypassed && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, "\u5DF2\u6307\u5B9A\u5355\u4E00\u6A21\u578B\uFF0C\u672A\u4E0E\u5176\u4ED6\u8DEF\u7EBF\u6BD4\u8F83\u3002\u5728\u5B98\u65B9\u4F1A\u8BDD\u4E2D\u8C03\u7528 ", /* @__PURE__ */ import_react5.default.createElement("code", null, "model_router_execute"), " \u5E76\u4F20\u5165\u8BE5 provider \u4E0E model \u5373\u53EF\u76F4\u63A5\u6267\u884C\uFF1B\u82E5\u8BE5\u6A21\u578B\u5141\u8BB8\u5B98\u65B9\u5DE5\u5177\uFF0C\u4F1A\u4F18\u5148\u4F7F\u7528\u5BF9\u5E94 CLI\u3002"), plan.mode === "team" && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, plan.team.handoff)));
}
var remoteError = (response, fallback) => remoteErrorText(
  text5(response?.error?.message) || text5(response?.value?.error) || (typeof response?.error === "string" ? response.error : ""),
  fallback
);
function probeLabel(probe) {
  if (!probe) return "\u5C1A\u672A\u68C0\u6D4B";
  if (probe.installed) return `\u5DF2\u5B89\u88C5${probe.version ? ` \xB7 ${probe.version}` : ""}`;
  if (probe.status === "not-installed") return "\u672A\u5B89\u88C5";
  if (probe.status === "probe-timeout") return "\u68C0\u6D4B\u8D85\u65F6";
  if (probe.status === "probe-failed") return "\u68C0\u6D4B\u5931\u8D25";
  return probe.detail || "\u672A\u5B89\u88C5";
}
var INSTALL_SETTING_FIELDS = [
  {
    key: "toolInstallDir",
    label: "\u7EDF\u4E00\u5B89\u88C5\u76EE\u5F55",
    fallback: "",
    placeholder: "\u7559\u7A7A = \u5404\u5382\u5546\u9ED8\u8BA4\u76EE\u5F55",
    hint: "npm / pnpm \u65B9\u5F0F\u4F1A\u52A0 --prefix\uFF1B\u811A\u672C\u65B9\u5F0F\u770B\u5382\u5546\u662F\u5426\u652F\u6301\u76EE\u5F55\u53C2\u6570\u3002",
    validate: () => null
  },
  {
    key: "toolNpmRegistry",
    label: "npm \u6E90\u5730\u5740",
    fallback: "https://registry.npmjs.org/",
    placeholder: "https://registry.npmjs.org/",
    hint: "\u5FC5\u987B\u4EE5 https:// \u5F00\u5934\u3002\u6362\u6210\u56FD\u5185\u955C\u50CF\u540E\uFF0C\u6240\u6709\u5305\u7BA1\u7406\u5668\u65B9\u5F0F\u90FD\u4ECE\u8FD9\u91CC\u4E0B\u8F7D\u3002",
    validate: (raw) => /^https:\/\/\S+$/i.test(raw.trim()) ? null : "\u9700\u8981 https \u5F00\u5934\u7684\u5B8C\u6574\u5730\u5740\uFF0C\u4F8B\u5982 https://registry.npmmirror.com/"
  },
  {
    key: "toolScriptUrlsJson",
    label: "\u5B89\u88C5\u811A\u672C\u6E90\u8986\u76D6\uFF08JSON\uFF0C\u53EF\u9009\uFF09",
    fallback: "{}",
    placeholder: '{ "stepcode": "https://mirror/stepcode/install.ps1" }',
    hint: "\u6309\u5DE5\u5177 ID \u6307\u5B9A\u5382\u5546\u5B89\u88C5\u811A\u672C\u7684\u955C\u50CF\u5730\u5740\u3002\u811A\u672C\u4ECD\u4F1A\u4E0B\u8F7D\u540E\u6821\u9A8C\u5382\u5546\u6807\u8BB0\u518D\u6267\u884C\uFF0C\u955C\u50CF\u4E0D\u80FD\u6362\u6210\u522B\u7684\u7A0B\u5E8F\u3002",
    validate: (raw) => {
      if (!raw.trim()) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return "JSON \u683C\u5F0F\u65E0\u6548\u3002";
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "\u9700\u8981 JSON \u5BF9\u8C61\u3002";
      for (const [id2, url] of Object.entries(parsed)) {
        if (!OFFICIAL_TOOLS.some((tool) => tool.id === id2)) return `${id2} \u4E0D\u662F\u5B98\u65B9\u5DE5\u5177 ID\u3002`;
        if (typeof url !== "string" || !/^https:\/\/\S+$/i.test(url.trim())) return `${id2} \u7684\u5730\u5740\u5FC5\u987B\u662F https \u94FE\u63A5\u3002`;
      }
      return null;
    }
  }
];
function InstallSettings({ settingsScope, install }) {
  const [snapshot, setSnapshot] = import_react5.default.useState(() => settingsScope?.getSnapshot?.() ?? { value: {}, writable: false });
  const [drafts, setDrafts] = import_react5.default.useState({});
  const [saving, setSaving] = import_react5.default.useState(false);
  const [notice, setNotice] = import_react5.default.useState("");
  import_react5.default.useEffect(() => {
    if (typeof settingsScope?.subscribe !== "function") return void 0;
    const unsubscribe = settingsScope.subscribe(() => {
      setSnapshot(settingsScope.getSnapshot());
      setDrafts({});
    });
    setSnapshot(settingsScope.getSnapshot());
    return unsubscribe;
  }, [settingsScope]);
  if (!settingsScope) return null;
  const writable = snapshot.writable === true && !saving;
  const shown = (field2) => drafts[field2.key] ?? String(snapshot.value?.[field2.key] ?? field2.fallback);
  const errors = Object.fromEntries(INSTALL_SETTING_FIELDS.map((field2) => [field2.key, field2.validate(shown(field2))]));
  const apply2 = async (entries, successText) => {
    setSaving(true);
    setNotice("");
    try {
      const accepted = await settingsScope.mutate(entries, snapshot.revision);
      if (!accepted) throw new Error("\u8BBE\u7F6E\u672A\u88AB\u4FDD\u5B58\uFF0C\u53EF\u80FD\u88AB\u5176\u4ED6\u9875\u9762\u4FEE\u6539\uFF1B\u8F93\u5165\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u3002");
      setNotice(successText);
    } catch (error) {
      setNotice(text5(error?.message) || "\u5B89\u88C5\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002");
    } finally {
      setSaving(false);
    }
  };
  const commit = (field2) => {
    const saved = String(snapshot.value?.[field2.key] ?? field2.fallback);
    const raw = shown(field2);
    if (raw === saved || errors[field2.key]) return;
    return apply2([{ op: "set", path: [field2.key], value: raw }], `\u5DF2\u4FDD\u5B58${field2.label}\uFF0C\u4E0B\u4E00\u6B21\u5B89\u88C5\u8D77\u751F\u6548\u3002`);
  };
  return /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-install-settings", "aria-label": "\u7EDF\u4E00\u5B89\u88C5\u8BBE\u7F6E" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-install-settings-head" }, /* @__PURE__ */ import_react5.default.createElement("strong", null, "\u7EDF\u4E00\u5B89\u88C5\u8BBE\u7F6E"), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-caption" }, "\u5BF9\u6240\u6709\u5B98\u65B9\u5DE5\u5177\u751F\u6548\uFF0C\u6539\u52A8\u540E\u4E0B\u4E00\u6B21\u4E00\u952E\u5B89\u88C5\u3001\u4FEE\u590D\u6216\u5378\u8F7D\u7ACB\u5373\u4F7F\u7528\u3002\u63D2\u4EF6\u8BBE\u7F6E\u9875\u91CC\u6709\u540C\u6837\u7684\u5B57\u6BB5\u3002")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-install-grid" }, INSTALL_SETTING_FIELDS.map((field2) => /* @__PURE__ */ import_react5.default.createElement("label", { className: "mr-install-field", key: field2.key }, /* @__PURE__ */ import_react5.default.createElement("span", null, field2.label), /* @__PURE__ */ import_react5.default.createElement(
    "input",
    {
      className: "mr-input",
      value: shown(field2),
      placeholder: field2.placeholder,
      disabled: !writable,
      "aria-invalid": Boolean(errors[field2.key]),
      onChange: (event) => setDrafts((previous) => ({ ...previous, [field2.key]: event.target.value })),
      onBlur: () => {
        void commit(field2);
      }
    }
  ), errors[field2.key] ? /* @__PURE__ */ import_react5.default.createElement("small", { className: "mr-install-error", role: "alert" }, errors[field2.key]) : /* @__PURE__ */ import_react5.default.createElement("small", null, field2.hint))), /* @__PURE__ */ import_react5.default.createElement("label", { className: "mr-install-field" }, /* @__PURE__ */ import_react5.default.createElement("span", null, "\u5B89\u88C5\u811A\u672C\u65B9\u5F0F"), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-install-toggle-row" }, /* @__PURE__ */ import_react5.default.createElement(
    "input",
    {
      type: "checkbox",
      checked: snapshot.value?.toolAllowScriptInstall !== false,
      disabled: !writable,
      onChange: (event) => {
        const allowed = event.target.checked;
        void apply2(
          [{ op: "set", path: ["toolAllowScriptInstall"], value: allowed }],
          allowed ? "\u5DF2\u5141\u8BB8\u811A\u672C\u5B89\u88C5\u65B9\u5F0F\uFF08curl / irm\uFF09\u3002" : "\u5DF2\u5173\u95ED\u811A\u672C\u5B89\u88C5\u65B9\u5F0F\uFF0C\u53EA\u80FD\u4F7F\u7528 npm / pnpm\u3002"
        );
      }
    }
  ), /* @__PURE__ */ import_react5.default.createElement("span", null, "\u5141\u8BB8 curl / irm \u5B89\u88C5\u811A\u672C")), /* @__PURE__ */ import_react5.default.createElement("small", null, "\u5173\u95ED\u540E\u53EA\u80FD\u4F7F\u7528 npm / pnpm \u65B9\u5F0F\uFF1B\u811A\u672C\u65B9\u5F0F\u9700\u8981\u5148\u4E0B\u8F7D\u5E76\u6821\u9A8C\u5382\u5546\u6807\u8BB0\u518D\u6267\u884C\u3002"))), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption", style: { marginTop: 8 }, role: notice ? "status" : void 0 }, "\u5F53\u524D\u751F\u6548\uFF1A\u5B89\u88C5\u76EE\u5F55 ", install?.installDir || "\uFF08\u5404\u5382\u5546\u9ED8\u8BA4\uFF09", " \xB7 npm \u6E90 ", install?.registry || "\uFF08\u9ED8\u8BA4\uFF09", notice ? ` \xB7 ${notice}` : ""));
}
function OfficialToolsCard({ listOfficialTools, installOfficialTool, uninstallOfficialTool, repairOfficialTool, cancelOfficialToolInstall, officialToolInstallStatus, onProbes, health, onRefreshHealth, settingsScope }) {
  const healthById = Object.fromEntries((health?.tools ?? []).map((item) => [item.id, item]));
  const [probeState, setProbeState] = import_react5.default.useState({ status: "loading", probes: [], capabilities: [], readiness: [], install: null, error: "" });
  const [jobs, setJobs] = import_react5.default.useState({});
  const [rowErrors, setRowErrors] = import_react5.default.useState({});
  const mounted = import_react5.default.useRef(false);
  const request = import_react5.default.useRef(0);
  const submitting = import_react5.default.useRef(/* @__PURE__ */ new Set());
  const polling = import_react5.default.useRef(/* @__PURE__ */ new Set());
  const jobsRef = import_react5.default.useRef({});
  const rememberJobs = (updater) => {
    setJobs((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      jobsRef.current = next;
      return next;
    });
  };
  const refresh = async () => {
    onRefreshHealth?.();
    const current = ++request.current;
    setProbeState((previous) => ({
      ...previous,
      status: previous.probes.length > 0 ? "refreshing" : "loading",
      error: ""
    }));
    try {
      if (typeof listOfficialTools !== "function") throw new Error("\u5B98\u65B9\u5DE5\u5177\u5B89\u88C5\u6865\u5C1A\u672A\u52A0\u8F7D\u3002");
      const response = await listOfficialTools();
      if (!mounted.current || current !== request.current) return;
      if (!response?.ok) throw new Error(remoteError(response, "\u65E0\u6CD5\u68C0\u6D4B\u5B98\u65B9\u5DE5\u5177\u3002"));
      const probes = Array.isArray(response.value?.tools) ? response.value.tools : [];
      const capabilities = Array.isArray(response.value?.executionCapabilities) ? response.value.executionCapabilities : [];
      const readiness = Array.isArray(response.value?.executionReadiness) ? response.value.executionReadiness : [];
      setProbeState({ status: "ready", probes, capabilities, readiness, install: response.value?.install ?? null, error: "" });
      onProbes({ probes, capabilities, readiness, hostVersion: typeof response.value?.hostVersion === "string" ? response.value.hostVersion : null });
    } catch (error) {
      if (!mounted.current || current !== request.current) return;
      const message = remoteErrorText(text5(error?.message), "\u65E0\u6CD5\u68C0\u6D4B\u5B98\u65B9\u5DE5\u5177\u3002");
      let kept = false;
      setProbeState((previous) => {
        if (previous.probes.length > 0) {
          kept = true;
          return { ...previous, status: "ready", error: message };
        }
        return { status: "error", probes: [], capabilities: [], readiness: [], install: null, error: message };
      });
      if (!kept) onProbes({ probes: [], capabilities: [], readiness: [] });
    }
  };
  import_react5.default.useEffect(() => {
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
        if (!mounted.current) return;
        rememberJobs((previous) => {
          const next = { ...previous };
          for (const entry of entries) {
            if (!entry) continue;
            const [id2, job] = entry;
            if (shouldApplyInstallStatus(previous[id2], job)) next[id2] = job;
          }
          return next;
        });
      });
    }
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);
  import_react5.default.useEffect(() => {
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
        const local = jobsRef.current[id2];
        if (!job) {
          if (local?.status === "running") return;
          throw new Error("\u5B89\u88C5\u4EFB\u52A1\u72B6\u6001\u6682\u4E0D\u53EF\u7528\u3002");
        }
        if (!shouldApplyInstallStatus(local, job)) return;
        rememberJobs((previous) => shouldApplyInstallStatus(previous[id2], job) ? { ...previous, [id2]: job } : previous);
        setRowErrors((previous) => ({
          ...previous,
          [id2]: job.status === "failed" ? text5(job.error) || "\u5B89\u88C5\u5931\u8D25\u3002" : ""
        }));
        if (job.status !== "running") void refresh();
      } catch (error) {
        if (listening && mounted.current) setRowErrors((previous) => ({ ...previous, [id2]: remoteErrorText(text5(error?.message), "\u5B89\u88C5\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF0C\u5C06\u7EE7\u7EED\u91CD\u8BD5\u3002") }));
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
  const run = async (id2, operation) => {
    const tool = OFFICIAL_TOOLS.find((item) => item.id === id2);
    const bridge = { install: installOfficialTool, repair: repairOfficialTool, uninstall: uninstallOfficialTool }[operation];
    const refusal = installClickRefusal({
      tool,
      submitting: submitting.current.has(id2),
      running: jobsRef.current[id2]?.status === "running",
      operation
    });
    if (refusal) {
      setRowErrors((previous) => ({ ...previous, [id2]: refusal }));
      return;
    }
    if (typeof bridge !== "function") throw new Error("\u5B98\u65B9\u5DE5\u5177\u5B89\u88C5\u6865\u5C1A\u672A\u52A0\u8F7D\u3002");
    submitting.current.add(id2);
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    setRowErrors((previous) => ({ ...previous, [id2]: "" }));
    rememberJobs((previous) => ({
      ...previous,
      [id2]: { tool: id2, operation, status: "running", outputTail: [], startedAt, error: null }
    }));
    try {
      const response = await bridge({ tool: id2 });
      if (!mounted.current) return;
      const accepted = acceptedInstallJob(response);
      if (!accepted.job) throw new Error(remoteErrorText(accepted.error, "\u4EFB\u52A1\u672A\u88AB\u63A5\u53D7\u3002"));
      rememberJobs((previous) => shouldApplyInstallStatus(previous[id2], accepted.job) ? { ...previous, [id2]: accepted.job } : previous);
    } catch (error) {
      if (!mounted.current) return;
      const message = remoteErrorText(text5(error?.message), "\u542F\u52A8\u5931\u8D25\u3002");
      rememberJobs((previous) => ({
        ...previous,
        [id2]: {
          ...previous[id2] ?? {},
          tool: id2,
          status: "failed",
          error: message,
          startedAt: previous[id2]?.startedAt || startedAt
        }
      }));
      setRowErrors((previous) => ({ ...previous, [id2]: message }));
    } finally {
      submitting.current.delete(id2);
    }
  };
  const install = (id2) => run(id2, "install");
  const repair = (id2) => run(id2, "repair");
  const uninstall = (id2) => run(id2, "uninstall");
  const setInstallMethod = async (toolId, methodId) => {
    const snapshot = settingsScope?.getSnapshot?.();
    if (!snapshot) return;
    let map = {};
    try {
      map = JSON.parse(String(snapshot.value?.toolInstallMethodsJson ?? "{}")) || {};
    } catch {
      map = {};
    }
    if (typeof map !== "object" || Array.isArray(map)) map = {};
    if (methodId) map[toolId] = methodId;
    else delete map[toolId];
    try {
      const accepted = await settingsScope.mutate([{ op: "set", path: ["toolInstallMethodsJson"], value: JSON.stringify(map) }], snapshot.revision);
      if (!accepted) throw new Error("\u5B89\u88C5\u65B9\u5F0F\u672A\u88AB\u4FDD\u5B58\uFF0C\u53EF\u80FD\u88AB\u5176\u4ED6\u9875\u9762\u4FEE\u6539\u3002");
      void refresh();
    } catch (error) {
      if (mounted.current) setRowErrors((previous) => ({ ...previous, [toolId]: text5(error?.message) || "\u5B89\u88C5\u65B9\u5F0F\u4FDD\u5B58\u5931\u8D25\u3002" }));
    }
  };
  const cancel = async (id2) => {
    if (typeof cancelOfficialToolInstall !== "function" || jobs[id2]?.status !== "running" || jobs[id2]?.cancelRequested) return;
    setRowErrors((previous) => ({ ...previous, [id2]: "" }));
    try {
      const response = await cancelOfficialToolInstall(id2);
      if (!mounted.current) return;
      if (!response?.ok || !response.value?.accepted || !response.value?.job) throw new Error(remoteError(response, "\u53D6\u6D88\u8BF7\u6C42\u672A\u88AB\u63A5\u53D7\u3002"));
      rememberJobs((previous) => ({ ...previous, [id2]: response.value.job }));
      if (response.value.job.status !== "running") void refresh();
    } catch (error) {
      if (mounted.current) setRowErrors((previous) => ({ ...previous, [id2]: text5(error?.message) || "\u65E0\u6CD5\u53D6\u6D88\u5B89\u88C5\u3002" }));
    }
  };
  const byId = Object.fromEntries(probeState.probes.map((probe) => [probe.id, probe]));
  const capabilitiesById = Object.fromEntries(probeState.capabilities.map((item) => [item.id, item]));
  const readinessById = Object.fromEntries(probeState.readiness.map((item) => [item.id, item]));
  const installById = Object.fromEntries((probeState.install?.tools ?? []).map((item) => [item.id, item]));
  return /* @__PURE__ */ import_react5.default.createElement("section", { className: "mr-card", "aria-label": "\u5B98\u65B9\u5DE5\u5177" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("h2", { className: "mr-card-title" }, "\u5B98\u65B9\u5DE5\u5177 \xB7 \u4F53\u68C0"), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-card-copy" }, "\u68C0\u6D4B\u672C\u673A\u5B98\u65B9\u5DE5\u5177\u7684\u5B89\u88C5\u3001\u7248\u672C\u548C\u767B\u5F55\u72B6\u6001\uFF0C\u5E76\u4ECE\u56FA\u5B9A\u6CE8\u518C\u8868\u4E00\u952E\u5B89\u88C5\u6216\u66F4\u65B0\u5230\u5404\u5382\u5546\u6700\u65B0\u7248\uFF08\u65B0\u7248\u672C\u672A\u7ECF\u63D2\u4EF6\u6D4B\u8BD5\uFF09\u3002\u53EF\u6309\u5DE5\u5177\u9009\u62E9 npm\u3001pnpm \u6216\u5382\u5546\u5B89\u88C5\u811A\u672C\u65B9\u5F0F\uFF0C\u5E76\u7EDF\u4E00\u8BBE\u7F6E\u5B89\u88C5\u76EE\u5F55\u4E0E\u4E0B\u8F7D\u6E90\uFF1B\u5378\u8F7D\u53EA\u5220\u9664\u7A0B\u5E8F\uFF0C\u914D\u7F6E\u4E0E\u767B\u5F55\u4FDD\u7559\u3002\u672A\u767B\u5F55\u7684\u5DE5\u5177\u70B9\u201C\u53BB\u767B\u5F55\u201D\u67E5\u770B\u767B\u5F55\u547D\u4EE4\u3002ZCode \u4F1A\u6253\u5F00\u5B98\u65B9\u5B89\u88C5\u7A97\u53E3\u4F9B\u4F60\u9009\u62E9\u76EE\u5F55\uFF1B\u5B8C\u6210\u540E\u91CD\u65B0\u4F53\u68C0\u3002")), /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: probeState.status === "loading", onClick: () => {
    void refresh();
  } }, "\u91CD\u65B0\u4F53\u68C0")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-body" }, /* @__PURE__ */ import_react5.default.createElement(InstallSettings, { settingsScope, install: probeState.install }), probeState.status === "loading" && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-empty", role: "status" }, "\u6B63\u5728\u68C0\u6D4B\u672C\u673A\u5B98\u65B9\u5DE5\u5177\u2026"), probeState.error && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-error", role: "alert" }, probeState.error), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-tools", role: "list", "aria-label": "\u5B98\u65B9\u5DE5\u5177\u6CE8\u518C\u8868" }, OFFICIAL_TOOLS.map((tool) => {
    const summary = installById[tool.id];
    const command = summary?.command ?? installCommandLine(tool);
    const methods = summary?.methods ?? installMethodsFor(tool).map((method) => ({ id: method.id, label: method.label }));
    const probe = byId[tool.id];
    const capability = capabilitiesById[tool.id];
    const readiness = readinessById[tool.id];
    const job = jobs[tool.id];
    const running = job?.status === "running";
    const action = toolInstallAction({ tool, probe, readiness, job, probeStatus: probeState.status, latestVersion: healthById[tool.id]?.latestVersion ?? null });
    const maintenance = toolMaintenanceActions({
      tool,
      probe,
      job,
      probeStatus: probeState.status,
      summary: { installable: !summary?.error, removable: !summary?.error }
    });
    const verified = job?.status === "succeeded" && (job.operation === "uninstall" ? job.postInstallProbe?.installed === false : job.postInstallProbe?.installed === true);
    const operation = job?.operation === "uninstall" ? "\u5378\u8F7D" : job?.operation === "repair" ? "\u4FEE\u590D" : "\u5B89\u88C5";
    const status = running ? job.cancelRequested ? `\u6B63\u5728\u53D6\u6D88${operation}\u2026` : `${operation}\u4E2D\u2026` : job?.status === "installer-opened" ? "\u5B98\u65B9\u5B89\u88C5\u5668\u5DF2\u6253\u5F00\uFF0C\u8BF7\u5B8C\u6210\u5B89\u88C5\u540E\u91CD\u65B0\u68C0\u6D4B" : job?.status === "cancelled" ? `${operation}\u5DF2\u53D6\u6D88\uFF0C\u8BF7\u91CD\u65B0\u68C0\u6D4B` : verified ? `${operation}\u6210\u529F\u5E76\u9A8C\u8BC1` : probeLabel(probe);
    return /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-tool", role: "listitem", key: tool.id }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-tool-info" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-route-name", title: tool.purpose }, tool.label), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-route-provider" }, tool.vendor, " \xB7 ", tool.id), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-tool-status", role: "status" }, /* @__PURE__ */ import_react5.default.createElement("span", { className: `mr-tool-dot ${running ? "running" : probe?.installed ? "installed" : "missing"}` }), status, probe?.installed && probe.version ? ` \xB7 ${probe.version}` : "", healthById[tool.id]?.latestVersion ? ` \xB7 \u6700\u65B0 ${healthById[tool.id].latestVersion}` : ""), /* @__PURE__ */ import_react5.default.createElement(ToolLoginLine, { entry: healthById[tool.id] }), probe?.installed && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption mr-tool-detail" }, tool.headlessAdapter ? "\u5DF2\u53EF\u7531 model_router_execute \u4EE5\u65E0\u754C\u9762\u65B9\u5F0F\u8C03\u7528\u3002\u547D\u4EE4\u7F3A\u5931\u6216\u5931\u8D25\u65F6\u56DE\u9000\u6A21\u578B\u76EE\u5F55 API\u3002\u7B7E\u540D\u6C99\u7BB1\u5165\u53E3\u4E0D\u542F\u52A8\u6B64 CLI\u3002" : readiness?.ready ? `\u5B98\u65B9\u6267\u884C\u5165\u53E3\u5DF2\u6838\u9A8C\uFF0C\u53EF\u5728\u4F1A\u8BDD\u4E2D\u8C03\u7528 model_router_tool_run\uFF1B${capability?.modes?.includes("read-only") ? "\u652F\u6301\u53EA\u8BFB\u548C\u7ECF\u5BA1\u6279\u7684\u53EF\u7F16\u8F91\u4EFB\u52A1" : "\u4EC5\u652F\u6301\u7ECF\u5BA1\u6279\u7684\u53EF\u7F16\u8F91\u9694\u79BB\u5DE5\u4F5C\u533A\u4EFB\u52A1"}\uFF0C\u8D26\u53F7\u53CA\u6A21\u578B\u4ECD\u9700\u5B9E\u6D4B\u3002` : `\u5DF2\u5B89\u88C5\uFF0C\u4F46\u5F53\u524D\u4E0D\u53EF\u6258\u7BA1\u6267\u884C\uFF1A${readiness?.reason || capability?.reason || "\u6267\u884C\u5165\u53E3\u5C1A\u672A\u6838\u9A8C\u3002"}`), command ? /* @__PURE__ */ import_react5.default.createElement("code", { className: "mr-tool-command" }, command) : /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption", style: { margin: "6px 0 0" } }, summary?.error ?? tool.unsupportedReason), (summary?.notices ?? []).map((notice) => /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption mr-tool-detail", key: notice }, notice)), probe?.detail && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption mr-tool-detail" }, probe.detail), (rowErrors[tool.id] || job?.error) && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-error mr-tool-error", role: "alert" }, rowErrors[tool.id] || job.error), Array.isArray(job?.outputTail) && job.outputTail.length > 0 && /* @__PURE__ */ import_react5.default.createElement("details", { className: "mr-tool-log" }, /* @__PURE__ */ import_react5.default.createElement("summary", null, "\u5B89\u88C5\u65E5\u5FD7"), /* @__PURE__ */ import_react5.default.createElement("pre", null, job.outputTail.slice(-6).join("\n")))), command && /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-tool-actions" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-tool-methods" }, /* @__PURE__ */ import_react5.default.createElement("label", null, /* @__PURE__ */ import_react5.default.createElement("span", null, "\u5B89\u88C5\u65B9\u5F0F"), /* @__PURE__ */ import_react5.default.createElement(
      "select",
      {
        className: "mr-mini-select",
        value: summary?.savedMethodId ?? summary?.methodId ?? "",
        disabled: running || methods.length === 0,
        onChange: (event) => {
          void setInstallMethod(tool.id, event.target.value);
        }
      },
      methods.map((method) => /* @__PURE__ */ import_react5.default.createElement("option", { key: method.id, value: method.id, disabled: Boolean(method.blocked) }, method.label, method.blocked ? `\uFF08${method.blocked}\uFF09` : ""))
    ))), /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-tool-button", type: "button", disabled: action.disabled, onClick: () => {
      void install(tool.id);
    } }, action.label), /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-button-secondary mr-tool-button", type: "button", disabled: maintenance.repair.disabled, title: maintenance.repair.title, onClick: () => {
      void repair(tool.id);
    } }, maintenance.repair.label), /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-button-secondary mr-tool-button", type: "button", disabled: maintenance.uninstall.disabled, title: maintenance.uninstall.title, onClick: () => {
      void uninstall(tool.id);
    } }, maintenance.uninstall.label), running && /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-button-secondary mr-tool-button", type: "button", disabled: job.cancelRequested, onClick: () => {
      void cancel(tool.id);
    } }, job.cancelRequested ? "\u6B63\u5728\u53D6\u6D88\u2026" : `\u53D6\u6D88${operation}`)));
  })), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption", style: { marginTop: 12 } }, "\u5B89\u88C5\u7531 Host \u6309\u6CE8\u518C\u8868\u56FA\u5B9A\u6765\u6E90\u6267\u884C\uFF0C\u4E0D\u63A5\u53D7\u81EA\u5B9A\u4E49\u5305\u540D\uFF1B\u5B89\u88C5\u76EE\u5F55\u4E0E\u4E0B\u8F7D\u6E90\u6765\u81EA\u4F60\u81EA\u5DF1\u586B\u5199\u7684\u8BBE\u7F6E\uFF0C\u547D\u4EE4\u4E0A\u65B9\u5B9E\u65F6\u663E\u793A\u5C06\u8981\u6267\u884C\u7684\u5185\u5BB9\u3002\u53EF\u70B9\u201C\u53D6\u6D88\u201D\u7EC8\u6B62\u4E0B\u8F7D\u4EFB\u52A1\uFF0C\u968F\u540E\u91CD\u65B0\u68C0\u6D4B\u5B9E\u9645\u7248\u672C\u3002\u4E00\u952E\u5378\u8F7D\u53EA\u5220\u9664\u7A0B\u5E8F\u672C\u8EAB\uFF08\u811A\u672C\u5B89\u88C5\u4F1A\u987A\u5E26\u6E05\u6389\u5B83\u5728 shell \u914D\u7F6E\u91CC\u5199\u7684 PATH \u8BB0\u5F55\uFF09\uFF0C\u914D\u7F6E\u3001\u767B\u5F55\u4FE1\u606F\u548C\u5386\u53F2\u8BB0\u5F55\u4FDD\u7559\u3002ZCode \u5B89\u88C5\u5668\u542F\u52A8\u540E\u4ECD\u9700\u5728\u539F\u5382\u7A97\u53E3\u9009\u62E9\u76EE\u5F55\u5E76\u5B8C\u6210\u5B89\u88C5\u3002Agent \u4E5F\u53EF\u8C03\u7528 ", /* @__PURE__ */ import_react5.default.createElement("code", null, "model_router_tool_install"), " / ", /* @__PURE__ */ import_react5.default.createElement("code", null, "model_router_tool_repair"), " / ", /* @__PURE__ */ import_react5.default.createElement("code", null, "model_router_tool_uninstall"), "\uFF0C\u6216\u5728\u4F1A\u8BDD\u4F7F\u7528 ", /* @__PURE__ */ import_react5.default.createElement("code", null, "/tools"), "\u3002")));
}
var HEADLESS_TOOLS = /* @__PURE__ */ new Set(["claude-code", "codex", "gemini"]);
var WORKSPACE_VIEWS = [
  { id: "plan", label: "\u4EFB\u52A1\u4E0E\u6267\u884C", number: "01" },
  { id: "models", label: "\u6A21\u578B\u914D\u7F6E", number: "02" },
  { id: "tools", label: "\u5B98\u65B9\u5DE5\u5177", number: "03" },
  { id: "controls", label: "\u9884\u7B97\u4E0E\u5B89\u5168", number: "04" }
];
function useWorkbenchData({ toolHealth, completeOnboarding, loadLedger, rateResult, rerunStep, loadBoundaries }) {
  const [health, setHealth] = import_react5.default.useState({ report: null, error: "", refreshing: false });
  const [ledger, setLedger] = import_react5.default.useState({ value: null, error: "", refreshing: false });
  const [boundaries, setBoundaries] = import_react5.default.useState({ value: null, error: "" });
  const [busy, setBusy] = import_react5.default.useState(false);
  const mounted = import_react5.default.useRef(true);
  const ledgerRequest = import_react5.default.useRef(0);
  const mutationBusy = import_react5.default.useRef(false);
  import_react5.default.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ledgerRequest.current += 1;
    };
  }, []);
  const call = async (operation, fallback) => {
    if (typeof operation !== "function") throw new Error("\u5DE5\u4F5C\u53F0\u670D\u52A1\u5C1A\u672A\u52A0\u8F7D\uFF0C\u8BF7\u66F4\u65B0\u63D2\u4EF6\u540E\u91CD\u8BD5\u3002");
    return unwrapRemote(await operation(), fallback);
  };
  const refreshHealth = async (fresh) => {
    setHealth((previous) => ({ ...previous, refreshing: true, error: "" }));
    try {
      const report = await call(() => toolHealth(fresh === true), "\u4F53\u68C0\u5931\u8D25\u3002");
      if (mounted.current) setHealth({ report, error: "", refreshing: false });
    } catch (error) {
      if (mounted.current) setHealth((previous) => ({ ...previous, refreshing: false, error: text5(error?.message) || "\u4F53\u68C0\u5931\u8D25\u3002" }));
    }
  };
  const refreshLedger = async () => {
    const request = ++ledgerRequest.current;
    if (mounted.current) setLedger((previous) => ({ ...previous, error: "", refreshing: true }));
    try {
      const value = await call(loadLedger, "\u6267\u884C\u8BB0\u5F55\u8BFB\u53D6\u5931\u8D25\u3002");
      if (mounted.current && request === ledgerRequest.current) setLedger({ value, error: "", refreshing: false });
      if (!mounted.current || request !== ledgerRequest.current) return null;
      return value;
    } catch (error) {
      if (mounted.current && request === ledgerRequest.current) setLedger((previous) => ({
        ...previous,
        refreshing: false,
        error: `${text5(error?.message) || "\u6267\u884C\u8BB0\u5F55\u8BFB\u53D6\u5931\u8D25\u3002"}${previous.value ? " \u4E0B\u65B9\u4FDD\u7559\u6700\u8FD1\u4E00\u6B21\u6458\u8981\uFF0C\u5C1A\u672A\u91CD\u65B0\u6838\u9A8C\u3002" : ""}`
      }));
      return null;
    }
  };
  const refreshBoundaries = async () => {
    try {
      const value = await call(loadBoundaries, "\u5B89\u5168\u8FB9\u754C\u8BFB\u53D6\u5931\u8D25\u3002");
      if (mounted.current) setBoundaries({ value, error: "" });
    } catch (error) {
      if (mounted.current) setBoundaries({ value: null, error: text5(error?.message) || "\u5B89\u5168\u8FB9\u754C\u8BFB\u53D6\u5931\u8D25\u3002" });
    }
  };
  const finishOnboarding = async () => {
    try {
      const onboarding = await call(completeOnboarding, "\u65E0\u6CD5\u4FDD\u5B58\u4F53\u68C0\u72B6\u6001\u3002");
      if (mounted.current) setHealth((previous) => ({ ...previous, report: { ...previous.report, onboarding } }));
    } catch (error) {
      if (mounted.current) setHealth((previous) => ({ ...previous, error: text5(error?.message) || "\u65E0\u6CD5\u4FDD\u5B58\u4F53\u68C0\u72B6\u6001\u3002" }));
    }
  };
  const rate = async (runId, packageId, rating, expectedFinishedAt) => {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    try {
      await call(() => rateResult({ runId, packageId, rating, ...expectedFinishedAt === void 0 ? {} : { expectedFinishedAt } }), "\u8BC4\u4EF7\u4FDD\u5B58\u5931\u8D25\u3002");
      await refreshLedger();
    } catch (error) {
      if (mounted.current) setLedger((previous) => ({ ...previous, error: text5(error?.message) || "\u8BC4\u4EF7\u4FDD\u5B58\u5931\u8D25\u3002" }));
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const rerun = async (runId, packageId, override, choice = null) => {
    if (mutationBusy.current) return;
    const run = ledger.value?.runs?.find((item2) => item2.id === runId);
    const item = run?.packages?.find((entry) => entry.id === packageId);
    const reasons = rerunConfirmations({ run, item, override, choice, ledger: ledger.value, health: health.report, toolFor: toolForProvider, headlessIds: HEADLESS_TOOLS });
    if (reasons.length && !window.confirm(reasons.length === 1 ? `${reasons[0].text}
\u7EE7\u7EED\u5417\uFF1F` : `\u91CD\u8DD1\u524D\u9700\u8981\u786E\u8BA4\u4EE5\u4E0B ${reasons.length} \u9879\uFF1A
${reasons.map((entry, index) => `${index + 1}. ${entry.text}`).join("\n")}
\u5168\u90E8\u786E\u8BA4\u5E76\u7EE7\u7EED\u5417\uFF1F`)) return;
    const codes = new Set(reasons.map((entry) => entry.code));
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    try {
      const request = {
        runId,
        packageId,
        ...override ? { provider: override.provider, model: override.model } : {},
        ...choice ? { subscriptionChoice: choice } : {},
        ...codes.has("over-budget") ? { confirmOverBudget: true } : {},
        ...codes.has("workspace-write") ? { confirmWrite: true } : {}
      };
      let result = await call(() => rerunStep(request), "\u91CD\u8DD1\u5931\u8D25\u3002");
      if (result?.paused && result.budget?.exceeded && !request.confirmOverBudget) {
        if (!window.confirm(`${result.budget?.message ?? "\u672C\u6B21\u91CD\u8DD1\u4F1A\u8D85\u51FA\u9884\u7B97\u3002"}
\u4ECD\u8981\u7EE7\u7EED\u5417\uFF1F`)) return;
        result = await call(() => rerunStep({ ...request, confirmOverBudget: true }), "\u91CD\u8DD1\u5931\u8D25\u3002");
      }
      await refreshLedger();
    } catch (error) {
      if (mounted.current) setLedger((previous) => ({ ...previous, error: `${text5(error?.message) || "\u91CD\u8DD1\u5931\u8D25\u3002"} \u53EF\u4EE5\u4FEE\u6B63\u540E\u518D\u70B9\u201C\u91CD\u8DD1\u6B64\u6B65\u201D\uFF0C\u6216\u5728\u5B98\u65B9\u4F1A\u8BDD\u4E2D\u8C03\u7528 model_router_rerun_step\u3002` }));
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  import_react5.default.useEffect(() => {
    void refreshHealth(false);
    void refreshLedger();
    void refreshBoundaries();
  }, []);
  return { health, ledger, boundaries, busy, refreshHealth, refreshLedger, refreshBoundaries, finishOnboarding, rate, rerun };
}
function RouterMainPage({ loadCatalog, settingsScope, listOfficialTools, installOfficialTool, uninstallOfficialTool, repairOfficialTool, cancelOfficialToolInstall, officialToolInstallStatus, toolHealth, completeOnboarding, loadLedger, rateResult, rerunStep, loadBoundaries, previewRun, startRun, terminalApi }) {
  const workbench = useWorkbenchData({ toolHealth, completeOnboarding, loadLedger, rateResult, rerunStep, loadBoundaries });
  const [catalogState, setCatalogState] = import_react5.default.useState({ status: "loading", catalog: null, error: "" });
  const [task, setTask] = import_react5.default.useState("");
  const [mode, setMode] = import_react5.default.useState("single");
  const [directKey, setDirectKey] = import_react5.default.useState("");
  const [budget, setBudget] = import_react5.default.useState(() => String(settingsScope.getSnapshot().value?.budgetUsd ?? 0));
  const [query, setQuery] = import_react5.default.useState("");
  const [plan, setPlan] = import_react5.default.useState(null);
  const [planError, setPlanError] = import_react5.default.useState("");
  const [toolProbes, setToolProbes] = import_react5.default.useState(null);
  const [routingSettings, setRoutingSettings] = import_react5.default.useState(() => {
    const value = settingsScope.getSnapshot().value ?? {};
    return routingSettingsSignature(value);
  });
  const [view, setView] = import_react5.default.useState("plan");
  const tabRefs = import_react5.default.useRef({});
  const resultHeading = import_react5.default.useRef(null);
  const budgetEdited = import_react5.default.useRef(false);
  const budgetValue = import_react5.default.useRef(budget);
  const mounted = import_react5.default.useRef(false);
  const catalogRequest = import_react5.default.useRef(0);
  const generationRequest = import_react5.default.useRef(0);
  const generationInputs = import_react5.default.useRef("");
  generationInputs.current = JSON.stringify([task, budget, mode, directKey, routingSettings, catalogState.catalog, toolProbes, workbench.health.report?.tools]);
  import_react5.default.useEffect(() => {
    if (plan) resultHeading.current?.focus({ preventScroll: true });
  }, [plan]);
  const selectView = (id2) => {
    setView(id2);
    tabRefs.current[id2]?.focus({ preventScroll: true });
  };
  const navigateTabs = (event, index) => {
    const next = event.key === "ArrowRight" ? (index + 1) % WORKSPACE_VIEWS.length : event.key === "ArrowLeft" ? (index + WORKSPACE_VIEWS.length - 1) % WORKSPACE_VIEWS.length : event.key === "Home" ? 0 : event.key === "End" ? WORKSPACE_VIEWS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectView(WORKSPACE_VIEWS[next].id);
  };
  import_react5.default.useEffect(() => {
    const syncBudget = () => {
      const value = settingsScope.getSnapshot().value ?? {};
      const signature2 = routingSettingsSignature(value);
      setRoutingSettings((previous) => {
        if (previous === signature2) return previous;
        return signature2;
      });
      if (budgetEdited.current) return;
      const next = String(value.budgetUsd ?? 0);
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
  import_react5.default.useEffect(() => {
    setPlan(null);
    setPlanError("");
  }, [routingSettings]);
  const dataRevision = workbench.ledger.value?.dynamicData?.revision ?? "";
  const feedbackRevision = workbench.ledger.value?.learning?.revision ?? "";
  import_react5.default.useEffect(() => {
    if (plan && plan.workbenchRevision !== `${dataRevision}/${feedbackRevision}`) {
      setPlan(null);
      setPlanError("");
    }
  }, [dataRevision, feedbackRevision, plan]);
  import_react5.default.useEffect(() => {
    mounted.current = true;
    const request = ++catalogRequest.current;
    Promise.resolve().then(loadCatalog).then((response) => {
      if (!mounted.current || request !== catalogRequest.current) return;
      if (response?.ok) setCatalogState({ status: "ready", catalog: response.value, error: "" });
      else setCatalogState({ status: "error", catalog: null, error: text5(response?.error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
    }).catch((error) => {
      if (mounted.current && request === catalogRequest.current) setCatalogState({ status: "error", catalog: null, error: text5(error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
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
      else setCatalogState({ status: "error", catalog: null, error: text5(response?.error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
    } catch (error) {
      if (mounted.current && request === catalogRequest.current) setCatalogState({ status: "error", catalog: null, error: text5(error?.message) || "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25" });
    }
  };
  const invalidatePlan = () => {
    generationRequest.current += 1;
    setPlan(null);
    setPlanError("");
  };
  const handleToolProbes = import_react5.default.useCallback((snapshot) => {
    generationRequest.current += 1;
    setToolProbes(snapshot);
    setPlan(null);
    setPlanError("");
  }, []);
  const generate = async () => {
    const request = ++generationRequest.current;
    const inputs = generationInputs.current;
    setPlanError("");
    try {
      if (!text5(task)) throw new Error("\u8BF7\u5148\u63CF\u8FF0\u4EFB\u52A1\u3002");
      if (routes.length === 0) throw new Error("\u8BF7\u5148\u5728\u5B98\u65B9\u201C\u6A21\u578B\u201D\u9875\u914D\u7F6E\u81F3\u5C11\u4E00\u6761\u6A21\u578B\u8DEF\u7EBF\u3002");
      const parsedBudget = Number(budget);
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0) throw new Error("\u9884\u7B97\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\u3002");
      const direct = mode === "direct" ? routes.find((route) => `${route.provider}/${route.model}` === directKey) ?? routes[0] : null;
      if (mode === "direct" && !direct) throw new Error("\u8BF7\u9009\u62E9\u8981\u76F4\u63A5\u4F7F\u7528\u7684\u6A21\u578B\u3002");
      const signature2 = routingSettingsSignature(settingsScope.getSnapshot().value ?? {});
      const ledger = await workbench.refreshLedger();
      if (request !== generationRequest.current || inputs !== generationInputs.current || !mounted.current) return;
      if (!ledger) throw new Error("\u8BF7\u5148\u6062\u590D\u6267\u884C\u8BB0\u5F55\u8FDE\u63A5\uFF1B\u65E0\u6CD5\u6838\u5BF9\u6700\u65B0\u6570\u636E\u4E0E\u5B66\u4E60\u72B6\u6001\u3002");
      if (ledger.storageAvailable === false) throw new Error("\u6267\u884C\u8BB0\u5F55\u5B58\u50A8\u6682\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u6838\u5BF9\u8D39\u7528\u4E0E\u5B66\u4E60\u72B6\u6001\uFF1B\u8BF7\u6062\u590D\u8FDE\u63A5\u540E\u518D\u89C4\u5212\u3002");
      if (ledger.budget?.historyVerified === false) throw new Error("\u8D39\u7528\u5386\u53F2\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u4ECE\u5907\u4EFD\u6062\u590D\u5E76\u6838\u9A8C\u540E\u518D\u89C4\u5212\u3002");
      if (signature2 !== routingSettingsSignature(settingsScope.getSnapshot().value ?? {})) throw new Error("\u89C4\u5212\u8BBE\u7F6E\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u5EFA\u8BAE\u3002");
      const next = createWorkspacePlan(task, catalogState.catalog, {
        ...ledger.routingData,
        learning: ledger.learning,
        mode,
        ...direct ? { directProvider: direct.provider, directModel: direct.model } : {},
        budgetUsd: parsedBudget,
        modelProfilesJson: settingsScope.getSnapshot().value?.modelProfilesJson ?? "[]",
        installedToolIds: (toolProbes?.probes ?? []).filter((probe) => probe.installed).map((probe) => probe.id),
        runnableToolIds: (toolProbes?.readiness ?? []).filter((item) => item.ready).map((item) => item.id),
        preset: settingsScope.getSnapshot().value?.routingPreset ?? "balanced",
        loggedOutToolIds: (workbench.health.report?.tools ?? []).filter((item) => item.installed && item.login?.state === "logged-out").map((item) => item.id)
      });
      setPlan({ ...next, workbenchRevision: `${ledger.dynamicData?.revision ?? ""}/${ledger.learning?.revision ?? ""}` });
    } catch (error) {
      if (request !== generationRequest.current || inputs !== generationInputs.current || !mounted.current) return;
      setPlan(null);
      setPlanError(text5(error?.message) || "\u65E0\u6CD5\u751F\u6210\u8DEF\u7531\u5EFA\u8BAE\u3002");
    }
  };
  const summary = healthSummary(workbench.health.report?.tools);
  return /* @__PURE__ */ import_react5.default.createElement("main", { className: "mr-workspace" }, /* @__PURE__ */ import_react5.default.createElement("style", null, router_main_default), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-shell" }, /* @__PURE__ */ import_react5.default.createElement("header", { className: "mr-header" }, /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-eyebrow" }, "Model Router \xB7 DeepSeek Harness"), /* @__PURE__ */ import_react5.default.createElement("h1", { className: "mr-title" }, "\u6A21\u578B\u8DEF\u7531\u5DE5\u4F5C\u53F0"), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-subtitle" }, "\u628A\u4EFB\u52A1\u4EA4\u7ED9\u5408\u9002\u7684\u6A21\u578B\u3002\u4ECE\u672C\u5730\u89C4\u5212\uFF0C\u5230\u53EF\u786E\u8BA4\u7684\u6267\u884C\u3002")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-status" }, /* @__PURE__ */ import_react5.default.createElement("span", { className: `mr-status-dot ${catalogState.status === "loading" ? "loading" : catalogState.status === "error" ? "error" : ""}` }), catalogState.status === "ready" ? `${providerCount} \u4E2A\u4F9B\u5E94\u5546 \xB7 ${routes.length} \u6761\u8DEF\u7EBF` : catalogState.status === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u76EE\u5F55" : "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-overview", "aria-label": "\u5DE5\u4F5C\u53F0\u6982\u89C8" }, /* @__PURE__ */ import_react5.default.createElement("button", { type: "button", className: "mr-overview-item", onClick: () => selectView("models") }, /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-overview-label" }, "\u6A21\u578B\u8DEF\u7EBF"), /* @__PURE__ */ import_react5.default.createElement("strong", null, catalogState.status === "ready" ? routes.length : "\u2014"), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-overview-detail" }, catalogState.status === "ready" ? `${providerCount} \u4E2A\u4F9B\u5E94\u5546 \xB7 \u914D\u7F6E\u4EF7\u683C\u4E0E\u80FD\u529B \u2192` : "\u7B49\u5F85\u76EE\u5F55\u52A0\u8F7D")), /* @__PURE__ */ import_react5.default.createElement("button", { type: "button", className: "mr-overview-item", onClick: () => selectView("tools") }, /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-overview-label" }, "\u5B98\u65B9\u5DE5\u5177"), /* @__PURE__ */ import_react5.default.createElement("strong", null, workbench.health.report ? summary.installed : "\u2014", /* @__PURE__ */ import_react5.default.createElement("small", null, " / ", OFFICIAL_TOOLS.length)), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-overview-detail" }, workbench.health.report ? `${summary.ready} \u4E2A\u5DF2\u767B\u5F55 \xB7 \u67E5\u770B\u4F53\u68C0 \u2192` : "\u67E5\u770B\u5B89\u88C5\u4E0E\u767B\u5F55\u72B6\u6001 \u2192")), /* @__PURE__ */ import_react5.default.createElement("button", { type: "button", className: "mr-overview-item", onClick: () => selectView("controls") }, /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-overview-label" }, "\u4ECA\u65E5 API \u8D39\u7528"), /* @__PURE__ */ import_react5.default.createElement("strong", null, workbench.ledger.value ? money2(workbench.ledger.value.spent?.today ?? 0) : "\u2014"), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-overview-detail" }, "\u672C\u673A\u8BB0\u5F55\u4F30\u7B97 \xB7 \u67E5\u770B\u9884\u7B97 \u2192"))), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-workspace-tabs", role: "tablist", "aria-label": "\u5DE5\u4F5C\u53F0\u529F\u80FD" }, WORKSPACE_VIEWS.map((item, index) => /* @__PURE__ */ import_react5.default.createElement("button", { key: item.id, ref: (element) => {
    tabRefs.current[item.id] = element;
  }, type: "button", role: "tab", id: `mr-tab-${item.id}`, "aria-selected": view === item.id, "aria-controls": `mr-panel-${item.id}`, tabIndex: view === item.id ? 0 : -1, onKeyDown: (event) => navigateTabs(event, index), onClick: () => setView(item.id) }, /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-tab-number", "aria-hidden": "true" }, item.number), item.label))), staleHostNotice({ hostVersion: toolProbes?.hostVersion, loaded: Boolean(toolProbes?.probes?.length) }) && /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-error", role: "alert" }, staleHostNotice({ hostVersion: toolProbes?.hostVersion })), (workbench.health.report?.notices ?? []).map((notice) => /* @__PURE__ */ import_react5.default.createElement("div", { key: `${notice.kind}-${notice.at}`, className: "mr-error", role: "alert" }, notice.message)), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-view mr-stack", role: "tabpanel", id: "mr-panel-plan", "aria-labelledby": "mr-tab-plan", hidden: view !== "plan" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-grid mr-planning-grid" }, /* @__PURE__ */ import_react5.default.createElement("section", { className: "mr-card", "aria-label": "\u4EFB\u52A1\u89C4\u5212" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("h2", { className: "mr-card-title" }, "\u4EFB\u52A1\u89C4\u5212"), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-card-copy" }, "\u5199\u6E05\u76EE\u6807\u4E0E\u9A8C\u6536\u6807\u51C6\uFF0C\u5148\u751F\u6210\u672C\u5730\u5EFA\u8BAE\uFF0C\u518D\u9884\u89C8\u6267\u884C\u3002")), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-pill" }, "\u672C\u5730\u89C4\u5212 \xB7 \u4E0D\u6D88\u8017 token")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-body" }, /* @__PURE__ */ import_react5.default.createElement("label", { className: "mr-label", htmlFor: "mr-task" }, "\u4EFB\u52A1\u63CF\u8FF0"), /* @__PURE__ */ import_react5.default.createElement("textarea", { className: "mr-textarea", id: "mr-task", value: task, onChange: (event) => {
    setTask(event.target.value);
    invalidatePlan();
  }, placeholder: "\u4F8B\u5982\uFF1A\u5206\u6790\u9879\u76EE\u67B6\u6784\uFF0C\u5206\u5DE5\u4FEE\u590D\u5173\u952E\u95EE\u9898\uFF0C\u5E76\u7ED9\u51FA\u9A8C\u6536\u6E05\u5355", "aria-describedby": "mr-task-hint" }), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption mr-task-hint", id: "mr-task-hint" }, "\u56E2\u961F\u4EFB\u52A1\u53EF\u6309\u7F16\u53F7\u5199\u51FA\u6B65\u9AA4\u3001\u4EA4\u4ED8\u7269\u548C\u4F9D\u8D56\uFF1B\u89C4\u5212\u4E0D\u4F1A\u66F4\u6539\u4E3B\u4F1A\u8BDD\u6A21\u578B\u3002"), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-controls" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-control-group" }, /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-control-label" }, "\u89C4\u5212\u6A21\u5F0F"), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-segment", role: "group", "aria-label": "\u89C4\u5212\u6A21\u5F0F" }, /* @__PURE__ */ import_react5.default.createElement("button", { type: "button", "aria-pressed": mode === "single", onClick: () => {
    setMode("single");
    invalidatePlan();
  } }, "\u5355\u4EFB\u52A1"), /* @__PURE__ */ import_react5.default.createElement("button", { type: "button", "aria-pressed": mode === "team", onClick: () => {
    setMode("team");
    invalidatePlan();
  } }, "\u56E2\u961F\u5206\u5DE5"), /* @__PURE__ */ import_react5.default.createElement("button", { type: "button", "aria-pressed": mode === "direct", onClick: () => {
    setMode("direct");
    invalidatePlan();
  } }, "\u6307\u5B9A\u6A21\u578B"))), mode === "direct" && /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-control-group mr-direct" }, /* @__PURE__ */ import_react5.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-direct-model" }, "\u76F4\u63A5\u4F7F\u7528"), /* @__PURE__ */ import_react5.default.createElement("select", { className: "mr-input", id: "mr-direct-model", value: directKey || (routes[0] ? `${routes[0].provider}/${routes[0].model}` : ""), onChange: (event) => {
    setDirectKey(event.target.value);
    invalidatePlan();
  } }, routes.map((route) => /* @__PURE__ */ import_react5.default.createElement("option", { key: `${route.provider}/${route.model}`, value: `${route.provider}/${route.model}` }, route.provider, "/", route.model)))), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-control-group mr-budget" }, /* @__PURE__ */ import_react5.default.createElement("label", { className: "mr-control-label", htmlFor: "mr-budget" }, "\u672C\u6B21\u4F30\u7B97\u9884\u7B97\uFF08USD\uFF09"), /* @__PURE__ */ import_react5.default.createElement("input", { className: "mr-input", id: "mr-budget", type: "number", min: "0", step: "0.01", value: budget, onChange: (event) => {
    budgetEdited.current = true;
    budgetValue.current = event.target.value;
    setBudget(event.target.value);
    invalidatePlan();
  } }))), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-actions" }, /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button", type: "button", disabled: catalogState.status !== "ready" || routes.length === 0 || toolProbes === null, onClick: generate }, "\u751F\u6210\u8DEF\u7531\u5EFA\u8BAE"), /* @__PURE__ */ import_react5.default.createElement("span", { className: "mr-caption" }, catalogState.status === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u76EE\u5F55\u2026" : catalogState.status === "error" ? "\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5728\u201C\u6A21\u578B\u914D\u7F6E\u201D\u4E2D\u5237\u65B0\u3002" : routes.length === 0 ? "\u8BF7\u5148\u5728 Harness \u7684\u201C\u6A21\u578B\u201D\u9875\u6DFB\u52A0\u6A21\u578B\u3002" : toolProbes === null ? "\u6B63\u5728\u68C0\u6D4B\u5B98\u65B9\u5DE5\u5177\u2026" : "\u9884\u7B97 0 \u4E3A\u4E0D\u9650\uFF1B\u8D39\u7528\u4E3A\u4F30\u7B97\u3002")), planError && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-error", role: "alert" }, planError))), /* @__PURE__ */ import_react5.default.createElement("aside", { className: "mr-planning-guide", "aria-label": "\u89C4\u5212\u4F7F\u7528\u63D0\u793A" }, /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-eyebrow" }, "\u5DE5\u4F5C\u6D41\u7A0B"), /* @__PURE__ */ import_react5.default.createElement("ol", { className: "mr-workflow" }, /* @__PURE__ */ import_react5.default.createElement("li", null, /* @__PURE__ */ import_react5.default.createElement("span", null, "01"), /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("strong", null, "\u63CF\u8FF0\u4EFB\u52A1"), /* @__PURE__ */ import_react5.default.createElement("p", null, "\u9009\u62E9\u5355\u4EFB\u52A1\u3001\u56E2\u961F\u5206\u5DE5\u6216\u6307\u5B9A\u6A21\u578B\u3002"))), /* @__PURE__ */ import_react5.default.createElement("li", null, /* @__PURE__ */ import_react5.default.createElement("span", null, "02"), /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("strong", null, "\u6838\u5BF9\u8DEF\u7531\u5EFA\u8BAE"), /* @__PURE__ */ import_react5.default.createElement("p", null, "\u68C0\u67E5\u6A21\u578B\u3001\u5DE5\u4F5C\u5305\u4F9D\u8D56\u548C\u4F30\u7B97\u8D39\u7528\u3002"))), /* @__PURE__ */ import_react5.default.createElement("li", null, /* @__PURE__ */ import_react5.default.createElement("span", null, "03"), /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("strong", null, "\u9884\u89C8\u5E76\u786E\u8BA4\u6267\u884C"), /* @__PURE__ */ import_react5.default.createElement("p", null, "\u786E\u8BA4\u540E\u8C03\u7528\u6A21\u578B\uFF0C\u7ED3\u679C\u5199\u5165\u6267\u884C\u8BB0\u5F55\u3002")))), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-guide-links" }, /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", onClick: () => selectView("models") }, "\u914D\u7F6E\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B \u2192"), /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", onClick: () => selectView("tools") }, "\u68C0\u67E5\u5B98\u65B9\u5DE5\u5177\u4E0E\u767B\u5F55 \u2192")), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, "\u7F3A\u5C11\u4EF7\u683C\u65F6\u4F1A\u63D0\u793A\u201C\u4EF7\u683C\u5F85\u914D\u7F6E\u201D\u3002\u53EA\u8BFB\u6267\u884C\u53EF\u5728\u6B64\u5B8C\u6210\uFF1B\u4FEE\u6539\u6587\u4EF6\u7684\u4EFB\u52A1\u9700\u5728\u5B98\u65B9\u4F1A\u8BDD\u4E2D\u5BA1\u6279\u3002"))), plan && /* @__PURE__ */ import_react5.default.createElement(PlanResults, { plan, ledger: workbench.ledger.value, headingRef: resultHeading }), /* @__PURE__ */ import_react5.default.createElement(
    RunLauncher,
    {
      task,
      mode,
      budgetUsd: budget,
      ledger: workbench.ledger.value,
      previewRun,
      startRun,
      planningRevision: `${routingSettings}/${dataRevision}/${feedbackRevision}`,
      directRoute: mode === "direct" ? routes.find((route) => `${route.provider}/${route.model}` === directKey) ?? routes[0] ?? null : null,
      defaultPreset: settingsScope.getSnapshot().value?.routingPreset ?? "balanced",
      disabledReason: catalogState.status === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u76EE\u5F55\u2026" : catalogState.status === "error" ? "\u6A21\u578B\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5728\u201C\u6A21\u578B\u914D\u7F6E\u201D\u4E2D\u5237\u65B0\u3002" : routes.length === 0 ? "\u8BF7\u5148\u5728\u5B98\u65B9\u201C\u6A21\u578B\u201D\u9875\u914D\u7F6E\u81F3\u5C11\u4E00\u6761\u6A21\u578B\u8DEF\u7EBF\u3002" : "",
      onStarted: () => {
        void workbench.refreshLedger();
      }
    }
  ), /* @__PURE__ */ import_react5.default.createElement(
    RunHistoryCard,
    {
      ledger: workbench.ledger.value,
      routes,
      busy: workbench.busy,
      error: workbench.ledger.error,
      onRefresh: () => {
        void workbench.refreshLedger();
      },
      onRate: (runId, packageId, rating, expectedFinishedAt) => {
        void workbench.rate(runId, packageId, rating, expectedFinishedAt);
      },
      onRerun: (runId, packageId, override, choice) => {
        void workbench.rerun(runId, packageId, override, choice);
      }
    }
  )), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-view", role: "tabpanel", id: "mr-panel-models", "aria-labelledby": "mr-tab-models", hidden: view !== "models" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-view-heading" }, /* @__PURE__ */ import_react5.default.createElement("h2", null, "\u6A21\u578B\u914D\u7F6E"), /* @__PURE__ */ import_react5.default.createElement("p", null, "\u4ECE\u5B98\u65B9\u76EE\u5F55\u9009\u62E9\u8DEF\u7EBF\uFF0C\u8865\u9F50\u6BD4\u8F83\u6240\u9700\u7684\u4EF7\u683C\u3001\u80FD\u529B\u4E0E\u6267\u884C\u65B9\u5F0F\u3002")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-grid mr-model-grid" }, /* @__PURE__ */ import_react5.default.createElement(ModelProfileEditor, { routes, settingsScope, onSaved: invalidatePlan }), /* @__PURE__ */ import_react5.default.createElement("section", { className: "mr-card", "aria-label": "\u6A21\u578B\u76EE\u5F55" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-head" }, /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("h2", { className: "mr-card-title" }, "\u6A21\u578B\u76EE\u5F55"), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-card-copy" }, routes.length, " \u6761\u8DEF\u7EBF \xB7 \u53EA\u8BFB\u53D6\u5B98\u65B9\u76EE\u5F55\uFF0C\u4E0D\u8BFB\u53D6 API Key\u3002")), /* @__PURE__ */ import_react5.default.createElement("button", { className: "mr-button mr-button-secondary", type: "button", disabled: catalogState.status === "loading", onClick: refresh }, "\u5237\u65B0")), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-card-body" }, catalogState.status === "error" && /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-error", role: "alert" }, catalogState.error), catalogState.status === "loading" && /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-empty" }, "\u6B63\u5728\u52A0\u8F7D\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\u2026"), catalogState.status === "ready" && /* @__PURE__ */ import_react5.default.createElement(import_react5.default.Fragment, null, /* @__PURE__ */ import_react5.default.createElement("label", { className: "mr-label", htmlFor: "mr-model-search" }, "\u641C\u7D22\u8DEF\u7EBF"), /* @__PURE__ */ import_react5.default.createElement("input", { className: "mr-input mr-search", id: "mr-model-search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u6A21\u578B\u6216\u4F9B\u5E94\u5546" }), /* @__PURE__ */ import_react5.default.createElement(RouteList, { routes, query }), catalogState.catalog?.failures?.length > 0 && /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption" }, catalogState.catalog.failures.length, " \u4E2A\u4F9B\u5E94\u5546\u7684\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u5728\u5B98\u65B9\u6A21\u578B\u9875\u68C0\u67E5\u914D\u7F6E\u3002")), /* @__PURE__ */ import_react5.default.createElement("p", { className: "mr-caption", style: { marginTop: 13 } }, "\u76EE\u5F55\u767B\u8BB0\u4E0D\u4EE3\u8868\u51ED\u636E\u6216\u7F51\u7EDC\u5F53\u524D\u53EF\u7528\uFF1B\u56FE\u50CF\u80FD\u529B\u9700\u8981\u5728\u5B9E\u9645\u4F7F\u7528\u524D\u6838\u5BF9\u3002"))))), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-view mr-stack", role: "tabpanel", id: "mr-panel-tools", "aria-labelledby": "mr-tab-tools", hidden: view !== "tools" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-view-heading" }, /* @__PURE__ */ import_react5.default.createElement("h2", null, "\u5B98\u65B9\u5DE5\u5177"), /* @__PURE__ */ import_react5.default.createElement("p", null, "\u7BA1\u7406\u672C\u673A CLI\u3001\u68C0\u67E5\u767B\u5F55\u72B6\u6001\uFF0C\u6216\u6253\u5F00\u4EA4\u4E92\u5F0F\u7EC8\u7AEF\u3002")), workbench.health.report && !workbench.health.report.onboarding?.completedAt && /* @__PURE__ */ import_react5.default.createElement(
    OnboardingBanner,
    {
      health: workbench.health.report,
      error: workbench.health.error,
      refreshing: workbench.health.refreshing,
      onRefresh: () => {
        void workbench.refreshHealth(true);
      },
      onDone: () => {
        void workbench.finishOnboarding();
      }
    }
  ), /* @__PURE__ */ import_react5.default.createElement(
    OfficialToolsCard,
    {
      listOfficialTools,
      installOfficialTool,
      uninstallOfficialTool,
      repairOfficialTool,
      cancelOfficialToolInstall,
      officialToolInstallStatus,
      onProbes: handleToolProbes,
      settingsScope,
      health: workbench.health.report,
      onRefreshHealth: () => {
        void workbench.refreshHealth(true);
      }
    }
  ), terminalApi && /* @__PURE__ */ import_react5.default.createElement(CliTerminalCard, { api: terminalApi, health: workbench.health.report })), /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-view mr-stack", role: "tabpanel", id: "mr-panel-controls", "aria-labelledby": "mr-tab-controls", hidden: view !== "controls" }, /* @__PURE__ */ import_react5.default.createElement("div", { className: "mr-view-heading" }, /* @__PURE__ */ import_react5.default.createElement("h2", null, "\u9884\u7B97\u4E0E\u5B89\u5168"), /* @__PURE__ */ import_react5.default.createElement("p", null, "\u8BBE\u7F6E\u6210\u672C\u4E0E\u8D28\u91CF\u7B56\u7565\uFF0C\u6838\u5BF9\u8BA2\u9605\u8BA1\u8D39\u548C\u6267\u884C\u8FB9\u754C\u3002")), /* @__PURE__ */ import_react5.default.createElement(
    CostControlCard,
    {
      ledger: workbench.ledger.value,
      error: workbench.ledger.error || workbench.ledger.value?.storageNotice || "",
      refreshing: workbench.ledger.refreshing,
      settingsScope,
      onChanged: () => {
        invalidatePlan();
        return workbench.refreshLedger();
      }
    }
  ), /* @__PURE__ */ import_react5.default.createElement(
    BillingCard,
    {
      billing: workbench.health.report?.billing ?? null,
      error: workbench.health.report ? "" : workbench.health.error,
      refreshing: workbench.health.refreshing,
      onRefresh: () => {
        void workbench.refreshHealth(true);
      }
    }
  ), /* @__PURE__ */ import_react5.default.createElement(SecurityCard, { data: workbench.boundaries.value, error: workbench.boundaries.error, onRefresh: () => {
    void workbench.refreshBoundaries();
  } })), /* @__PURE__ */ import_react5.default.createElement("footer", { className: "mr-footer" }, "\u4E3B\u4F1A\u8BDD\u6A21\u578B\u7531 Harness \u7BA1\u7406\u3002\u66F4\u591A\u8BBE\u7F6E\uFF1A\u63D2\u4EF6 \u2192 \u5DF2\u5B89\u88C5 \u2192 ", /* @__PURE__ */ import_react5.default.createElement("code", null, "@ljwei-stak/dsh-model-router"), "\u3002")));
}

// .dsh-plugin/shared/official-tools-remote.mjs
var OFFICIAL_TOOLS_REMOTE_PACKAGE = "@ljwei-stak/dsh-model-router";
var OFFICIAL_TOOLS_REMOTE_NAMESPACE = "modelRouterOfficialTools";
function strictCodec(typeSymbol, parse) {
  return Object.freeze({ mode: "strict", typeSymbol, create: () => ({ parse }) });
}
function plainObject2(value, subject) {
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
var MAX_METHOD_ID_CHARS = 40;
var text6 = (value) => typeof value === "string" ? value.trim() : "";
var toolActionCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolAction`, (value) => {
  const request = plainObject2(value, "tool action request");
  for (const key of Object.keys(request)) {
    if (key !== "tool" && key !== "method") throw new TypeError(`unknown field ${key} in tool action request`);
  }
  const tool = getOfficialTool(text6(request.tool));
  if (!tool) throw new TypeError("tool must name a fixed official tool");
  const method = request.method === void 0 || request.method === null || request.method === "" ? null : text6(request.method);
  if (method !== null) {
    if (method.length > MAX_METHOD_ID_CHARS || !/^[A-Za-z0-9-]+$/.test(method)) {
      throw new TypeError("method must be one of the tool's declared install methods");
    }
    if (!installMethodsFor(tool).some((item) => item.id === method)) {
      throw new TypeError(`${tool.label} does not offer the install method ${method}`);
    }
  }
  return method === null ? { tool: tool.id } : { tool: tool.id, method };
});
var listResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolList`, (value) => {
  const result = plainObject2(value, "tool list result");
  if (!Array.isArray(result.tools)) throw new TypeError("tool list result needs a tools array");
  return result;
});
var installResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolInstall`, (value) => {
  const result = plainObject2(value, "install result");
  if (typeof result.accepted !== "boolean") throw new TypeError("install result needs accepted");
  if (result.accepted && !result.job) throw new TypeError("accepted install needs a job");
  if (!result.accepted && typeof result.error !== "string") throw new TypeError("refused install needs an error");
  return result;
});
var statusResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolStatus`, (value) => {
  const result = plainObject2(value, "install status result");
  if (result.job !== null && (typeof result.job !== "object" || Array.isArray(result.job))) {
    throw new TypeError("install status result needs a job or null");
  }
  return result;
});
var anyObjectCodec = (name) => strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#${name}`, (value) => plainObject2(value, name));
var freshCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#HealthFresh`, (value) => {
  if (typeof value !== "boolean") throw new TypeError("fresh must be a boolean");
  return value;
});
var idText = (value, subject) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,80}$/.test(value)) throw new TypeError(`${subject} must be a short id`);
  return value;
};
var optionalRouteText = (value, subject) => {
  if (value === void 0 || value === null || value === "") return void 0;
  if (typeof value !== "string" || value.length > 240 || value.includes("\0")) throw new TypeError(`${subject} is invalid`);
  return value;
};
var rateRequestCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#RateRequest`, (value) => {
  const request = plainObject2(value, "rate request");
  if (!["up", "down", "clear"].includes(request.rating)) throw new TypeError("rating must be up, down or clear");
  if (request.expectedFinishedAt !== void 0 && (!Number.isFinite(request.expectedFinishedAt) || request.expectedFinishedAt < 0)) throw new TypeError("expectedFinishedAt must be a non-negative timestamp");
  return {
    runId: idText(request.runId, "runId"),
    packageId: idText(request.packageId, "packageId"),
    rating: request.rating,
    ...request.expectedFinishedAt === void 0 ? {} : { expectedFinishedAt: request.expectedFinishedAt }
  };
});
var rerunRequestCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#RerunRequest`, (value) => {
  const request = plainObject2(value, "rerun request");
  const provider = optionalRouteText(request.provider, "provider");
  const model = optionalRouteText(request.model, "model");
  if (Boolean(provider) !== Boolean(model)) throw new TypeError("provider and model must be supplied together");
  return {
    runId: idText(request.runId, "runId"),
    packageId: idText(request.packageId, "packageId"),
    ...provider ? { provider, model } : {},
    confirmOverBudget: request.confirmOverBudget === true,
    confirmWrite: request.confirmWrite === true,
    ...["api", "subscription", "cancel"].includes(request.subscriptionChoice) ? { subscriptionChoice: request.subscriptionChoice } : {}
  };
});
var RUN_CONFIRMATION_CODES = Object.freeze(["workspace-write", "rerun-write", "subscription-api", "over-budget", "unsandboxed"]);
var MAX_RUN_TASK_CHARS = 2e5;
function parseRunRequest(value) {
  const request = plainObject2(value, "run request");
  if (typeof request.task !== "string" || !request.task.trim() || request.task.length > MAX_RUN_TASK_CHARS) {
    throw new TypeError("task must be a non-empty string");
  }
  const provider = optionalRouteText(request.provider, "provider");
  const model = optionalRouteText(request.model, "model");
  if (Boolean(provider) !== Boolean(model)) throw new TypeError("provider and model must be supplied together");
  const workspace = request.workspace === void 0 || request.workspace === null || request.workspace === "" ? void 0 : request.workspace;
  if (workspace !== void 0 && (typeof workspace !== "string" || workspace.length > 4096 || workspace.includes("\0"))) throw new TypeError("workspace is invalid");
  if (request.budgetUsd !== void 0 && (typeof request.budgetUsd !== "number" || !Number.isFinite(request.budgetUsd) || request.budgetUsd < 0)) {
    throw new TypeError("budgetUsd must be a non-negative number");
  }
  const confirmed = Array.isArray(request.confirmedReasons) ? request.confirmedReasons : [];
  if (confirmed.length > RUN_CONFIRMATION_CODES.length || confirmed.some((code) => !RUN_CONFIRMATION_CODES.includes(code))) {
    throw new TypeError("confirmedReasons contains an unknown reason");
  }
  return {
    task: request.task,
    ...provider ? { provider, model } : {},
    ...["single", "team"].includes(request.planMode) ? { planMode: request.planMode } : {},
    ...["economy", "balanced", "quality"].includes(request.preset) ? { preset: request.preset } : {},
    ...request.budgetUsd !== void 0 ? { budgetUsd: request.budgetUsd } : {},
    ...workspace ? { workspace } : {},
    confirmedReasons: [...new Set(confirmed)]
  };
}
var terminalStartCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#TerminalStart`, parseTerminalStart);
var terminalReadCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#TerminalRead`, parseTerminalRead);
var terminalWriteCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#TerminalWrite`, parseTerminalWrite);
var terminalResizeCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#TerminalResize`, parseTerminalResize);
var terminalStopCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#TerminalStop`, parseTerminalStop);
var runRequestCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#RunRequest`, parseRunRequest);
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
var jsonParameter = (name, codec) => Object.freeze({ name, wire: name, source: "json", codec });
var OFFICIAL_TOOLS_REMOTE_DESCRIPTORS = Object.freeze([
  descriptor("list", [], listResultCodec),
  descriptor("installTool", [jsonParameter("request", toolActionCodec)], installResultCodec),
  descriptor("uninstallTool", [jsonParameter("request", toolActionCodec)], installResultCodec),
  descriptor("repairTool", [jsonParameter("request", toolActionCodec)], installResultCodec),
  descriptor("cancel", [toolIdParameter], installResultCodec),
  descriptor("status", [toolIdParameter], statusResultCodec),
  // Workbench: onboarding health check, run ledger, ratings, step retry, security boundaries.
  descriptor("health", [jsonParameter("fresh", freshCodec)], anyObjectCodec("HealthReport")),
  descriptor("completeOnboarding", [], anyObjectCodec("OnboardingState")),
  descriptor("ledger", [], anyObjectCodec("RunLedger")),
  descriptor("rateResult", [jsonParameter("request", rateRequestCodec)], anyObjectCodec("RateResult")),
  descriptor("rerunStep", [jsonParameter("request", rerunRequestCodec)], anyObjectCodec("RerunResult")),
  descriptor("boundaries", [], anyObjectCodec("SecurityBoundaries")),
  // Workbench "start a run": plan preview with cost estimate and confirmation reasons, then execute.
  descriptor("previewRun", [jsonParameter("request", runRequestCodec)], anyObjectCodec("RunPreview")),
  descriptor("startRun", [jsonParameter("request", runRequestCodec)], anyObjectCodec("RunStarted")),
  // Workbench "官方工具终端": interactive shell / fixed official CLI sessions.
  // Output streams through long-poll reads; input and resize are unary calls.
  descriptor("terminalInfo", [], anyObjectCodec("TerminalInfo")),
  descriptor("terminalStart", [jsonParameter("request", terminalStartCodec)], anyObjectCodec("TerminalStarted")),
  descriptor("terminalRead", [jsonParameter("request", terminalReadCodec)], anyObjectCodec("TerminalOutput")),
  descriptor("terminalWrite", [jsonParameter("request", terminalWriteCodec)], anyObjectCodec("TerminalWritten")),
  descriptor("terminalResize", [jsonParameter("request", terminalResizeCodec)], anyObjectCodec("TerminalResized")),
  descriptor("terminalStop", [jsonParameter("request", terminalStopCodec)], anyObjectCodec("TerminalStopped"))
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
var ROUTER_PACKAGE = "@ljwei-stak/dsh-model-router";
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
    parse: (text7) => {
      const write = numeric.parse(text7);
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
    parse: (text7) => {
      try {
        parseModelProfilesJson(text7);
        return field2.parse(text7);
      } catch {
        return void 0;
      }
    }
  };
}
function quotaPatternsField() {
  const field2 = (0, import_dsh_client_ui_primitives.settingsTextField)("quotaPatternsJson");
  return {
    ...field2,
    parse: (text7) => {
      const raw = String(text7 ?? "").trim() || "{}";
      try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
      } catch {
        return void 0;
      }
      return parseQuotaPatterns(raw).errors.length ? void 0 : field2.parse(text7);
    }
  };
}
function installDirField() {
  const field2 = (0, import_dsh_client_ui_primitives.settingsTextField)("toolInstallDir");
  return {
    ...field2,
    parse: (text7) => {
      if (!String(text7 ?? "").trim()) return field2.parse(text7);
      try {
        expandInstallDir(text7);
      } catch {
        return void 0;
      }
      return field2.parse(text7);
    }
  };
}
function npmRegistryField() {
  const field2 = (0, import_dsh_client_ui_primitives.settingsTextField)("toolNpmRegistry");
  return {
    ...field2,
    parse: (text7) => {
      const raw = String(text7 ?? "").trim() || DEFAULT_NPM_REGISTRY;
      try {
        normalizeSourceUrl(raw, "npm \u6E90");
      } catch {
        return void 0;
      }
      return field2.parse(text7);
    }
  };
}
function scriptUrlsField() {
  const field2 = (0, import_dsh_client_ui_primitives.settingsTextField)("toolScriptUrlsJson");
  return {
    ...field2,
    parse: (text7) => {
      const raw = String(text7 ?? "").trim() || "{}";
      try {
        const parsed = JSON.parse(raw);
        parseInstallPreferences({ toolScriptUrlsJson: raw }, { tools: OFFICIAL_TOOLS });
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
      } catch {
        return void 0;
      }
      return field2.parse(text7);
    }
  };
}
function installMethodsField() {
  const field2 = (0, import_dsh_client_ui_primitives.settingsTextField)("toolInstallMethodsJson");
  return {
    ...field2,
    parse: (text7) => {
      const raw = String(text7 ?? "").trim() || "{}";
      try {
        const parsed = JSON.parse(raw);
        parseInstallPreferences({ toolInstallMethodsJson: raw }, { tools: OFFICIAL_TOOLS });
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
      } catch {
        return void 0;
      }
      return field2.parse(text7);
    }
  };
}
var RouterSettingsCardController = class {
  constructor(scope) {
    this.form = new import_dsh_client_ui_primitives.SettingsFormModel(scope, [
      boundedNumberField("budgetUsd", { minimum: 0 }),
      boundedNumberField("maxConsultOutputChars", { minimum: 500, maximum: 5e4, integer: true }),
      boundedNumberField("dailyBudgetUsd", { minimum: 0, maximum: 1e6 }),
      boundedNumberField("monthlyBudgetUsd", { minimum: 0, maximum: 1e6 }),
      boundedNumberField("reviewSampleRate", { minimum: 0, maximum: 1 }),
      boundedNumberField("subscriptionCooldownMinutes", { minimum: 1, maximum: 10080, integer: true }),
      modelProfilesField(),
      quotaPatternsField(),
      installDirField(),
      npmRegistryField(),
      installMethodsField(),
      scriptUrlsField()
    ]);
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      budgetUsd: this.form.field("budgetUsd"),
      maxConsultOutputChars: this.form.field("maxConsultOutputChars"),
      dailyBudgetUsd: this.form.field("dailyBudgetUsd"),
      monthlyBudgetUsd: this.form.field("monthlyBudgetUsd"),
      reviewSampleRate: this.form.field("reviewSampleRate"),
      subscriptionCooldownMinutes: this.form.field("subscriptionCooldownMinutes"),
      modelProfilesJson: this.form.field("modelProfilesJson"),
      quotaPatternsJson: this.form.field("quotaPatternsJson"),
      toolInstallDir: this.form.field("toolInstallDir"),
      toolNpmRegistry: this.form.field("toolNpmRegistry"),
      toolInstallMethodsJson: this.form.field("toolInstallMethodsJson"),
      toolScriptUrlsJson: this.form.field("toolScriptUrlsJson")
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
  return /* @__PURE__ */ import_react6.default.createElement(import_dsh_client_ui_primitives.SettingsForm, { labels: FORM_LABELS, state, onSave: props.save, onDiscard: props.discard }, /* @__PURE__ */ import_react6.default.createElement(
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
      onEdit: (text7) => {
        props.edit("budgetUsd", text7);
      },
      onReset: () => {
        props.resetField("budgetUsd");
      }
    }
  ), /* @__PURE__ */ import_react6.default.createElement(
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
      onEdit: (text7) => {
        props.edit("maxConsultOutputChars", text7);
      },
      onReset: () => {
        props.resetField("maxConsultOutputChars");
      }
    }
  ), [
    ["dailyBudgetUsd", "model-router-daily-budget", "\u6BCF\u65E5\u6267\u884C\u9884\u7B97\uFF08USD\uFF09", "0 \u8868\u793A\u4E0D\u9650\u3002\u6309\u672C\u673A\u6267\u884C\u8BB0\u5F55\u7684\u5B9E\u9645\u8D39\u7528\u7D2F\u8BA1\uFF0C\u8D85\u51FA\u540E\u6309\u5DE5\u4F5C\u53F0\u8BBE\u7F6E\u81EA\u52A8\u964D\u7EA7\u6216\u6682\u505C\u8BE2\u95EE\u3002"],
    ["monthlyBudgetUsd", "model-router-monthly-budget", "\u6BCF\u6708\u6267\u884C\u9884\u7B97\uFF08USD\uFF09", "0 \u8868\u793A\u4E0D\u9650\u3002\u6309\u672C\u5730\u65F6\u533A\u7684\u81EA\u7136\u6708\u7D2F\u8BA1\u3002"],
    ["reviewSampleRate", "model-router-review-rate", "\u5F3A\u6A21\u578B\u62BD\u68C0\u6BD4\u4F8B\uFF080\u20131\uFF09", "\u8D28\u91CF\u56DE\u8DEF\u8BBE\u4E3A\u201C\u62BD\u68C0\u201D\u65F6\uFF0C\u6309\u6B64\u6BD4\u4F8B\u8BA9\u66F4\u5F3A\u7684\u6A21\u578B\u590D\u6838\u4FBF\u5B9C\u6A21\u578B\u7684\u7ED3\u679C\u3002"],
    ["subscriptionCooldownMinutes", "model-router-subscription-cooldown", "\u8BA2\u9605\u989D\u5EA6\u51B7\u5374\u65F6\u95F4\uFF08\u5206\u949F\uFF09", "\u8BA2\u9605\u989D\u5EA6\u7528\u5C3D\u6216\u9650\u6D41\u3001\u4F46\u5382\u5546\u6CA1\u6709\u7ED9\u51FA\u6062\u590D\u65F6\u95F4\u65F6\uFF0C\u6682\u505C\u4F7F\u7528\u8BE5\u8BA2\u9605\u7684\u65F6\u957F\uFF1B\u671F\u95F4\u540C\u4E00\u8DEF\u7EBF\u76F4\u63A5\u4F7F\u7528 API Key\u3002"]
  ].map(([key, id2, label, hint]) => /* @__PURE__ */ import_react6.default.createElement(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      key,
      id: id2,
      label,
      hint,
      disabled,
      ...state[key],
      overriddenLabel: FIELD_COPY.overridden,
      resetLabel: FIELD_COPY.reset,
      invalidLabel: FIELD_COPY.invalidNumber,
      onEdit: (text7) => {
        props.edit(key, text7);
      },
      onReset: () => {
        props.resetField(key);
      }
    }
  )), /* @__PURE__ */ import_react6.default.createElement("div", { style: styles.profileEditor }, /* @__PURE__ */ import_react6.default.createElement("span", { style: styles.profileLabel }, "\u5B98\u65B9 CLI \u8BFB\u5199\u8FB9\u754C"), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "\u53EA\u8BFB\u6267\u884C\u4E0D\u5199\u4EFB\u4F55\u6587\u4EF6\uFF1B\u4FEE\u6539\u6587\u4EF6\u7684\u6267\u884C\u5728\u72EC\u7ACB Git \u5DE5\u4F5C\u6811\u4E2D\u8FDB\u884C\uFF0C\u9700\u8981\u4F60\u786E\u8BA4\u540E\u624D\u4F1A\u628A\u8865\u4E01\u5E94\u7528\u56DE\u5F53\u524D\u5DE5\u4F5C\u533A\u3002\u5DE5\u4F5C\u53F0\u201C\u5B89\u5168\u8FB9\u754C\u201D\u5361\u7247\u6309\u5DF2\u914D\u7F6E\u6A21\u578B\u9010\u6761\u5217\u51FA\u3002"), /* @__PURE__ */ import_react6.default.createElement("table", { style: styles.boundaryTable }, /* @__PURE__ */ import_react6.default.createElement("thead", null, /* @__PURE__ */ import_react6.default.createElement("tr", null, /* @__PURE__ */ import_react6.default.createElement("th", { style: styles.boundaryCell }, "\u5DE5\u5177"), /* @__PURE__ */ import_react6.default.createElement("th", { style: styles.boundaryCell }, "\u53EA\u8BFB\u6267\u884C\u53EF\u8BFB"), /* @__PURE__ */ import_react6.default.createElement("th", { style: styles.boundaryCell }, "\u4FEE\u6539\u6267\u884C\u53EF\u5199"))), /* @__PURE__ */ import_react6.default.createElement("tbody", null, [["claude-code", "Claude Code"], ["codex", "Codex"], ["gemini", "Gemini CLI"]].map(([toolId, label]) => {
    const boundary = toolBoundary(toolId);
    return /* @__PURE__ */ import_react6.default.createElement("tr", { key: toolId }, /* @__PURE__ */ import_react6.default.createElement("td", { style: styles.boundaryCell }, label), /* @__PURE__ */ import_react6.default.createElement("td", { style: styles.boundaryCell }, boundary.readOnly.readable), /* @__PURE__ */ import_react6.default.createElement("td", { style: styles.boundaryCell }, boundary.write?.writable ?? "\u4E0D\u652F\u6301\u4FEE\u6539\u6267\u884C"));
  })))), /* @__PURE__ */ import_react6.default.createElement("div", { style: styles.profileEditor }, /* @__PURE__ */ import_react6.default.createElement("label", { htmlFor: "model-router-profiles-json", style: styles.profileLabel }, "\u6A21\u578B\u4EF7\u683C\u4E0E\u80FD\u529B\u914D\u7F6E\uFF08JSON\uFF09"), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "\u6309\u201C\u6A21\u578B\u76EE\u5F55\u201D\u4E2D\u7684\u51C6\u786E provider/model \u586B\u5199\u3002quality \u4E3A\u81EA\u5B9A\u7684 0\u2013100 \u5206\uFF1Binput/output \u662F\u7F8E\u5143\u6BCF\u767E\u4E07 token\u3002\u7F3A\u5C11\u4EF7\u683C\u65F6\u53EA\u7ED9\u8DEF\u7EBF\u5EFA\u8BAE\uFF0C\u4E0D\u663E\u793A\u865A\u6784\u8D39\u7528\u3002"), /* @__PURE__ */ import_react6.default.createElement(
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
  ), state.modelProfilesJson.invalid && /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.profileError, role: "alert" }, "JSON \u683C\u5F0F\u6216\u67D0\u9879\u914D\u7F6E\u65E0\u6548\u3002\u6BCF\u9879\u9700\u63D0\u4F9B\u51C6\u786E\u7684 provider/model\uFF0C\u5355\u4EF7\u4E3A\u975E\u8D1F USD \u6570\u5B57\uFF0C\u8D28\u91CF\u4E3A 0\u2013100\u3002"), /* @__PURE__ */ import_react6.default.createElement("details", { style: styles.profileExample }, /* @__PURE__ */ import_react6.default.createElement("summary", null, "\u67E5\u770B\u914D\u7F6E\u683C\u5F0F"), /* @__PURE__ */ import_react6.default.createElement("pre", null, `[
  {
    "provider": "\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u4F9B\u5E94\u5546 ID",
    "model": "\u6A21\u578B\u76EE\u5F55\u4E2D\u7684\u6A21\u578B ID",
    "quality": 80,
    "pricing": { "input": 0.2, "output": 0.8 },
    "specialties": ["code"],
    "cliModel": "\u5382\u5546 CLI \u4F7F\u7528\u7684\u6A21\u578B\u540D\uFF08\u53EF\u9009\uFF09",
    "execution": "auto",
    "billing": "subscription-first",
    "subscription": "plan-key",
    "apiRoute": { "provider": "\u6309\u91CF\u4ED8\u8D39\u4F9B\u5E94\u5546 ID", "model": "\u6A21\u578B ID" }
  }
]`), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "execution \u53EF\u7701\u7565\u3002auto \u6216 official \u8868\u793A\u4F18\u5148\u5B98\u65B9\u65E0\u754C\u9762\u5DE5\u5177\uFF0C\u5931\u8D25\u540E\u56DE\u9000 API\uFF1Bapi \u8868\u793A\u59CB\u7EC8\u8D70\u6A21\u578B\u76EE\u5F55\u3002billing \u9ED8\u8BA4 subscription-first\uFF08\u8BA2\u9605\u4F18\u5148\uFF0C\u989D\u5EA6\u7528\u5C3D\u6216\u9650\u6D41\u65F6\u5207\u6362 API Key\uFF09\uFF0C\u4E5F\u53EF\u8BBE\u4E3A api-only \u6216 subscription-only\u3002subscription \u4E3A plan-key \u8868\u793A\u8BE5\u8DEF\u7EBF\u672C\u8EAB\u662F\u7F16\u7A0B\u5957\u9910\u7AEF\u70B9\uFF08\u5982 GLM Coding Plan\u3001Kimi Code\u3001MiniMax Token Plan\uFF09\uFF0CapiRoute \u6307\u5B9A\u989D\u5EA6\u7528\u5C3D\u65F6\u56DE\u9000\u7684\u6309\u91CF\u4ED8\u8D39\u8DEF\u7EBF\u3002")), /* @__PURE__ */ import_react6.default.createElement("button", { type: "button", disabled, onClick: () => props.resetField("modelProfilesJson") }, "\u6062\u590D\u9ED8\u8BA4\u914D\u7F6E")), /* @__PURE__ */ import_react6.default.createElement("div", { style: styles.profileEditor }, /* @__PURE__ */ import_react6.default.createElement("label", { htmlFor: "model-router-quota-patterns", style: styles.profileLabel }, "\u8BA2\u9605\u989D\u5EA6\u8BC6\u522B\u89C4\u5219\uFF08JSON\uFF0C\u53EF\u9009\uFF09"), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "\u5185\u7F6E\u89C4\u5219\u5DF2\u8986\u76D6 Claude\u3001Codex\u3001Gemini\u3001Kimi\u3001MiniMax\u3001GLM \u7684\u6587\u6863\u5316\u62A5\u9519\u3002\u5382\u5546\u6539\u4E86\u62A5\u9519\u6587\u6848\u65F6\uFF0C\u53EF\u6309\u5DE5\u5177 ID\u3001\u4F9B\u5E94\u5546 ID \u6216 * \u8FFD\u52A0\u6B63\u5219\uFF1Aquota \u8868\u793A\u989D\u5EA6\u7528\u5C3D\uFF0CrateLimit \u8868\u793A\u9650\u6D41\u3002"), /* @__PURE__ */ import_react6.default.createElement(
    "textarea",
    {
      id: "model-router-quota-patterns",
      value: state.quotaPatternsJson.text,
      disabled,
      "aria-invalid": state.quotaPatternsJson.invalid,
      onChange: (event) => props.edit("quotaPatternsJson", event.target.value),
      spellCheck: false,
      style: styles.profileTextarea
    }
  ), state.quotaPatternsJson.invalid && /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.profileError, role: "alert" }, "\u9700\u8981 JSON \u5BF9\u8C61\uFF0C\u4E14\u6BCF\u6761\u89C4\u5219\u90FD\u662F\u6709\u6548\u7684\u6B63\u5219\u8868\u8FBE\u5F0F\u3002"), /* @__PURE__ */ import_react6.default.createElement("details", { style: styles.profileExample }, /* @__PURE__ */ import_react6.default.createElement("summary", null, "\u67E5\u770B\u89C4\u5219\u683C\u5F0F"), /* @__PURE__ */ import_react6.default.createElement("pre", null, `{
  "kimi-code": { "quota": ["\u989D\u5EA6\u5DF2\u7528\u5B8C"], "rateLimit": ["\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41"] },
  "my-glm-plan": { "quota": ["Usage limit reached for", "1308"] }
}`)), /* @__PURE__ */ import_react6.default.createElement("button", { type: "button", disabled, onClick: () => props.resetField("quotaPatternsJson") }, "\u6062\u590D\u9ED8\u8BA4\u89C4\u5219")), /* @__PURE__ */ import_react6.default.createElement("div", { style: styles.profileEditor }, /* @__PURE__ */ import_react6.default.createElement("span", { style: styles.profileLabel }, "\u5B98\u65B9\u5DE5\u5177\u7EDF\u4E00\u5B89\u88C5\u8BBE\u7F6E"), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "\u5BF9\u6240\u6709\u5B98\u65B9\u5DE5\u5177\u7684\u4E00\u952E\u5B89\u88C5\u3001\u4FEE\u590D\u548C\u5378\u8F7D\u751F\u6548\u3002\u5DE5\u4F5C\u53F0\u7684\u201C\u5B98\u65B9\u5DE5\u5177\u201D\u9875\u4E5F\u80FD\u6539\u540C\u6837\u7684\u5B57\u6BB5\uFF0C\u5E76\u4F1A\u5B9E\u65F6\u663E\u793A\u6BCF\u4E2A\u5DE5\u5177\u5C06\u8981\u6267\u884C\u7684\u547D\u4EE4\u3002 \u5B89\u88C5\u547D\u4EE4\u59CB\u7EC8\u6765\u81EA\u56FA\u5B9A\u6CE8\u518C\u8868\uFF0C\u8FD9\u91CC\u53EA\u51B3\u5B9A\u76EE\u5F55\u4E0E\u4E0B\u8F7D\u6E90\uFF0C\u4E0D\u63A5\u53D7\u81EA\u5B9A\u4E49\u5305\u540D\u6216\u4EFB\u610F\u5730\u5740\u3002"), /* @__PURE__ */ import_react6.default.createElement(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      id: "model-router-tool-install-dir",
      label: "\u7EDF\u4E00\u5B89\u88C5\u76EE\u5F55",
      hint: "\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u5404\u5382\u5546\u9ED8\u8BA4\u4F4D\u7F6E\uFF08npm \u5168\u5C40\u76EE\u5F55 / \u5382\u5546\u811A\u672C\u76EE\u5F55\uFF09\u3002npm \u4E0E pnpm \u65B9\u5F0F\u4F1A\u5E26\u4E0A --prefix\uFF1B\u5382\u5546\u5B89\u88C5\u811A\u672C\u662F\u5426\u652F\u6301\u76EE\u5F55\u53C2\u6570\u53D6\u51B3\u4E8E\u8BE5\u5382\u5546\u3002\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\u3002",
      disabled,
      ...state.toolInstallDir,
      overriddenLabel: FIELD_COPY.overridden,
      resetLabel: FIELD_COPY.reset,
      invalidLabel: "\u8BF7\u8F93\u5165\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u6216\u7559\u7A7A\u6062\u590D\u9ED8\u8BA4\u3002",
      onEdit: (value) => {
        props.edit("toolInstallDir", value);
      },
      onReset: () => {
        props.resetField("toolInstallDir");
      }
    }
  ), /* @__PURE__ */ import_react6.default.createElement(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      id: "model-router-tool-npm-registry",
      label: "npm \u6E90\u5730\u5740",
      hint: "\u6240\u6709\u5305\u7BA1\u7406\u5668\u5B89\u88C5\u65B9\u5F0F\u4ECE\u8BE5\u5730\u5740\u4E0B\u8F7D\uFF0C\u5FC5\u987B\u662F https \u94FE\u63A5\u3002\u56FD\u5185\u7F51\u7EDC\u53EF\u586B\u955C\u50CF\u6E90\uFF0C\u4F8B\u5982 https://registry.npmmirror.com/\u3002",
      disabled,
      ...state.toolNpmRegistry,
      overriddenLabel: FIELD_COPY.overridden,
      resetLabel: FIELD_COPY.reset,
      invalidLabel: "\u9700\u8981 https \u5F00\u5934\u7684\u5B8C\u6574\u5730\u5740\u3002",
      onEdit: (value) => {
        props.edit("toolNpmRegistry", value);
      },
      onReset: () => {
        props.resetField("toolNpmRegistry");
      }
    }
  ), /* @__PURE__ */ import_react6.default.createElement(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      id: "model-router-tool-install-methods",
      label: "\u9ED8\u8BA4\u5B89\u88C5\u65B9\u5F0F\uFF08JSON\uFF0C\u53EF\u9009\uFF09",
      hint: "\u6309\u5DE5\u5177 ID \u56FA\u5B9A\u4E00\u79CD\u5B89\u88C5\u65B9\u5F0F\uFF0C\u4F8B\u5982\u56FA\u5B9A Step Code \u5728 Windows \u4E0A\u7528 irm | iex\u3002\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u8BE5\u5DE5\u5177\u7684\u9ED8\u8BA4\u65B9\u5F0F\u3002\u53EF\u9009\u503C\uFF1Anpm\u3001pnpm\u3001script-bash\uFF08curl | bash\uFF09\u3001script-powershell\uFF08irm | iex\uFF09\u3002",
      disabled,
      ...state.toolInstallMethodsJson,
      overriddenLabel: FIELD_COPY.overridden,
      resetLabel: FIELD_COPY.reset,
      invalidLabel: "\u9700\u8981 JSON \u5BF9\u8C61\uFF0C\u4E14\u6BCF\u4E2A\u952E\u90FD\u662F\u5B98\u65B9\u5DE5\u5177 ID\u3001\u6BCF\u4E2A\u503C\u90FD\u662F\u8BE5\u5DE5\u5177\u652F\u6301\u7684\u5B89\u88C5\u65B9\u5F0F\u3002",
      onEdit: (value) => {
        props.edit("toolInstallMethodsJson", value);
      },
      onReset: () => {
        props.resetField("toolInstallMethodsJson");
      }
    }
  ), /* @__PURE__ */ import_react6.default.createElement(
    import_dsh_client_ui_primitives.SettingsValueField,
    {
      id: "model-router-tool-script-urls",
      label: "\u5B89\u88C5\u811A\u672C\u6E90\u8986\u76D6\uFF08JSON\uFF0C\u53EF\u9009\uFF09",
      hint: "\u6309\u5DE5\u5177 ID \u6307\u5B9A\u5382\u5546\u5B89\u88C5\u811A\u672C\u7684\u955C\u50CF\u5730\u5740\uFF08\u5FC5\u987B\u662F https\uFF09\u3002\u63D2\u4EF6\u4F1A\u5148\u4E0B\u8F7D\u811A\u672C\u3001\u6838\u5BF9\u5B83\u4ECD\u7136\u662F\u8BE5\u5382\u5546\u7684\u5B98\u65B9\u5B89\u88C5\u811A\u672C\uFF0C\u518D\u6267\u884C\u672C\u5730\u526F\u672C\uFF1B\u955C\u50CF\u4E0D\u80FD\u66FF\u6362\u6210\u522B\u7684\u7A0B\u5E8F\u3002",
      disabled,
      ...state.toolScriptUrlsJson,
      overriddenLabel: FIELD_COPY.overridden,
      resetLabel: FIELD_COPY.reset,
      invalidLabel: "\u9700\u8981 JSON \u5BF9\u8C61\uFF0C\u952E\u662F\u5B98\u65B9\u5DE5\u5177 ID\uFF0C\u503C\u662F https \u94FE\u63A5\u3002",
      onEdit: (value) => {
        props.edit("toolScriptUrlsJson", value);
      },
      onReset: () => {
        props.resetField("toolScriptUrlsJson");
      }
    }
  ), /* @__PURE__ */ import_react6.default.createElement("details", { style: styles.profileExample }, /* @__PURE__ */ import_react6.default.createElement("summary", null, "\u67E5\u770B\u683C\u5F0F"), /* @__PURE__ */ import_react6.default.createElement("pre", null, `{
  "stepcode": "https://mirror.example.com/stepcode/install.ps1",
  "opencode": "https://mirror.example.com/opencode/install"
}`), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "\u5B89\u88C5\u811A\u672C\u65B9\u5F0F\uFF08curl / irm\uFF09\u53EF\u4EE5\u5728\u5DE5\u4F5C\u53F0\u7684\u201C\u5B98\u65B9\u5DE5\u5177\u201D\u9875\u5173\u95ED\uFF1B\u5173\u95ED\u540E\u6240\u6709\u5DE5\u5177\u53EA\u80FD\u901A\u8FC7 npm \u6216 pnpm \u5B89\u88C5\u3002"))), /* @__PURE__ */ import_react6.default.createElement("aside", { style: styles.notice, "aria-label": "\u6A21\u578B\u8DEF\u7531\u4F7F\u7528\u8BF4\u660E" }, /* @__PURE__ */ import_react6.default.createElement("div", { style: styles.titleLine }, /* @__PURE__ */ import_react6.default.createElement(import_dsh_client_ui_primitives.Tag, { tone: "info" }, "\u5B98\u65B9\u6A21\u578B\u914D\u7F6E")), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "\u8BF7\u5728 DeepSeek Harness \u7684\u201C\u6A21\u578B\u201D\u9875\u9762\u914D\u7F6E DeepSeek\u3001OpenAI \u517C\u5BB9\u6216 Anthropic \u517C\u5BB9\u670D\u52A1\u3002\u6B64\u63D2\u4EF6\u8BFB\u53D6\u5B98\u65B9\u6A21\u578B\u76EE\u5F55\uFF0C\u4E0D\u4FDD\u5B58 API Key\uFF1B\u76EE\u5F55\u4E2D\u7684\u8DEF\u7EBF\u4ECD\u9700\u901A\u8FC7\u5B9E\u9645\u8C03\u7528\u9A8C\u8BC1\u8D26\u53F7\u548C\u7F51\u7EDC\u53EF\u7528\u6027\u3002"), /* @__PURE__ */ import_react6.default.createElement("p", { style: styles.noticeText }, "\u4F7F\u7528 ", /* @__PURE__ */ import_react6.default.createElement("code", null, "model_router_plan"), " \u83B7\u53D6\u53EF\u5BA1\u9605\u7684\u8DEF\u7531\u5EFA\u8BAE\uFF0C\u4F7F\u7528 ", /* @__PURE__ */ import_react6.default.createElement("code", null, "model_router_consult"), " \u54A8\u8BE2\u4E00\u4E2A\u5DF2\u914D\u7F6E\u6A21\u578B\u3002\u5EFA\u8BAE\u4E0D\u4F1A\u6539\u5199\u4E3B\u4F1A\u8BDD\u6A21\u578B\uFF1B\u591A\u4EBA\u5206\u5DE5\u7531\u5B98\u65B9 Agent Teams \u5DE5\u5177\u6267\u884C\u3002")));
}
function OpenRouterWorkspace({ subject, openPanel }) {
  if (subject?.kind !== "bundle" || subject.pkg?.name !== ROUTER_PACKAGE) return null;
  return /* @__PURE__ */ import_react6.default.createElement(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", type: "button", onClick: openPanel }, "\u6253\u5F00\u5DE5\u4F5C\u53F0");
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
      installOfficialTool: (request) => officialToolsRemote.installTool(request),
      uninstallOfficialTool: (request) => officialToolsRemote.uninstallTool(request),
      repairOfficialTool: (request) => officialToolsRemote.repairTool(request),
      cancelOfficialToolInstall: (toolId) => officialToolsRemote.cancel(toolId),
      officialToolInstallStatus: (toolId) => officialToolsRemote.status(toolId),
      toolHealth: (fresh) => officialToolsRemote.health(fresh),
      completeOnboarding: () => officialToolsRemote.completeOnboarding(),
      loadLedger: () => officialToolsRemote.ledger(),
      rateResult: (request) => officialToolsRemote.rateResult(request),
      rerunStep: (request) => officialToolsRemote.rerunStep(request),
      loadBoundaries: () => officialToolsRemote.boundaries(),
      previewRun: (request) => officialToolsRemote.previewRun(request),
      startRun: (request) => officialToolsRemote.startRun(request),
      terminalApi: Object.freeze({
        terminalInfo: () => officialToolsRemote.terminalInfo(),
        terminalStart: (request) => officialToolsRemote.terminalStart(request),
        terminalRead: (request) => officialToolsRemote.terminalRead(request),
        terminalWrite: (request) => officialToolsRemote.terminalWrite(request),
        terminalResize: (request) => officialToolsRemote.terminalResize(request),
        terminalStop: (request) => officialToolsRemote.terminalStop(request)
      })
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
  const ui2 = ctx.inject(UI_INJECT, registerUi);
  try {
    await ui2;
  } catch (error) {
    await ui2.dispose();
    await disposeRemote();
    throw error;
  }
  return async () => {
    await ui2.dispose();
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
  boundaryTable: { width: "100%", borderCollapse: "collapse", fontSize: 12, lineHeight: 1.5 },
  boundaryCell: { padding: "6px 8px", borderBottom: "1px solid rgba(127, 127, 127, .25)", textAlign: "left", verticalAlign: "top" },
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
/*! Bundled license information:

@xterm/xterm/lib/xterm.mjs:
@xterm/addon-fit/lib/addon-fit.mjs:
  (**
   * Copyright (c) 2014-2024 The xterm.js authors. All rights reserved.
   * @license MIT
   *
   * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
   * @license MIT
   *
   * Originally forked from (with the author's permission):
   *   Fabrice Bellard's javascript vt100 for jslinux:
   *   http://bellard.org/jslinux/
   *   Copyright (c) 2011 Fabrice Bellard
   *)
*/
    return module.exports;
  },
});
