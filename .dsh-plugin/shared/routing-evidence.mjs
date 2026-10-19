// .dsh-plugin/shared/routing-evidence.mjs
// Pure, dependency-free routing evidence utilities.
// User-controlled strings are used as Map keys or JSON-serialized values, never
// as dynamic property names. Nothing reads the filesystem, network, environment
// or evaluates source. Hashed features minimize plaintext exposure; they do not
// certify anonymity. Empirical outputs require independent held-out evaluation.

const SCHEMA_VERSION = 1;
const FEATURE_DIMS = 4096;
const TOKEN_CAP = 512;
const MAX_TEXT_CHARS = 20000;
const MAX_STRING = 200;
const MAX_EFFORT = 64;
const MAX_RESOURCE_GROUPS = 10000;
const MAX_QUALITY_SAMPLES = 10000;
const MAX_INPUT_TOKENS = 5e6;
const MAX_OUTPUT_TOKENS = 2e6;
const MAX_INPUT_CHARS = 5e6;
const MAX_DURATION_MS = 86400000;
const SIM_THRESHOLD = 0.2;
const MAX_NEIGHBORS = 32;
const SHRINK_PRIOR = 2;
const NORM_TOLERANCE = 0.05;
const DEFAULT_MAX_AGE_MS = 15552000000;
const SUBJECTIVE_SOURCES = [
  'rating', 'ratings', 'self-eval', 'self-evaluation', 'self-eval-score',
  'model-judge', 'model-judgement', 'model-preference', 'manual-opinion',
  'human-opinion', 'opinion', 'subjective', 'thumbs', 'preference'
];
const ALLOWED_SAMPLE_KEYS = new Set([
  'id', 'groupId', 'provider', 'model', 'reasoningEffort', 'channel', 'type',
  'quality', 'timestamp', 'synthetic', 'split', 'provenance', 'features'
]);

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
function boundedString(s, max = MAX_STRING) { return typeof s === 'string' && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s); }
function nonEmpty(s) { return boundedString(s) && s.trim().length > 0; }
function effortOk(s) { return boundedString(s, MAX_EFFORT); }
function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
function cmp(a, b) { return a - b; }
function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function normalizeChannel(c) {
  if (!nonEmpty(c)) return null;
  return c === 'api' ? 'harness-llm' : c;
}
function routeKey(p, m, e, c) { return JSON.stringify([p, m, e, c]); }
function actionKey(rk, type, groupId) { return JSON.stringify([rk, type, groupId]); }
// Content identity for cache invalidation only, never an authenticity signature.
function contentRevision(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return `evidence-v1-${hash.toString(16).padStart(8, '0')}`;
}

function isWordCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}
function isCjkCode(c) {
  return (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff);
}
function hashIndex(tok) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % FEATURE_DIMS;
}

// Sparse L2-normalized hashed lexical features: ASCII words + CJK bigrams.
function buildFeatures(text) {
  const s = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const idxCounts = new Map();
  const seen = new Set();
  const addToken = (tok) => {
    if (!seen.has(tok)) {
      if (seen.size >= TOKEN_CAP) return;
      seen.add(tok);
    }
    const h = hashIndex(tok);
    idxCounts.set(h, (idxCounts.get(h) || 0) + 1);
  };
  let word = '';
  let cjk = '';
  const flushWord = () => { if (word) { addToken(word.toLowerCase()); word = ''; } };
  const flushCjk = () => {
    if (cjk) {
      if (cjk.length === 1) addToken(cjk);
      else for (let i = 0; i + 1 < cjk.length; i++) addToken(cjk.slice(i, i + 2));
      cjk = '';
    }
  };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isWordCode(c)) { flushCjk(); word += s[i]; }
    else if (isCjkCode(c)) { flushWord(); cjk += s[i]; }
    else { flushWord(); flushCjk(); }
    if (idxCounts.size >= FEATURE_DIMS) break;
  }
  flushWord();
  flushCjk();
  let sum = 0;
  for (const c of idxCounts.values()) sum += c * c;
  if (sum <= 0) return [];
  const norm = Math.sqrt(sum);
  const feats = [];
  for (const [idx, c] of idxCounts) feats.push([idx, c / norm]);
  feats.sort((a, b) => a[0] - b[0]);
  return feats;
}

function cosine(a, b) {
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) na += a[i][1] * a[i][1];
  for (let j = 0; j < b.length; j++) nb += b[j][1] * b[j][1];
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  let dot = 0;
  let x = 0;
  let y = 0;
  while (x < a.length && y < b.length) {
    const ai = a[x][0];
    const bi = b[y][0];
    if (ai === bi) { dot += a[x][1] * b[y][1]; x++; y++; }
    else if (ai < bi) x++;
    else y++;
  }
  return dot / denom;
}

function quantileSorted(arr, q) {
  const n = arr.length;
  if (n === 0) return null;
  if (n === 1) return arr[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const f = pos - lo;
  return lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * f;
}

function isSubjectiveSource(source) {
  const s = source.toLowerCase().replace(/[\s_]+/g, '-');
  return SUBJECTIVE_SOURCES.some((k) => s.includes(k));
}

function checkWindow(ts, now, maxAgeMs) {
  return finite(ts) && ts >= 0 && ts <= now && ts >= now - maxAgeMs;
}

function checkEvidenceConfig(now, minSamples, allowSynthetic, maxAgeMs, label) {
  if (!finite(now) || now < 0 || now > 8.64e15) throw new Error(`routing-evidence: ${label} now must be a valid finite timestamp`);
  if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 1000) {
    throw new Error(`routing-evidence: ${label} minSamples must be an integer in 1..1000`);
  }
  if (typeof allowSynthetic !== 'boolean') {
    throw new Error(`routing-evidence: ${label} allowSynthetic must be a boolean`);
  }
  if (!finite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error(`routing-evidence: ${label} maxAgeMs must be a positive finite number`);
  }
}

function validateFeatures(features) {
  if (!Array.isArray(features) || features.length === 0 || features.length > FEATURE_DIMS) return false;
  let sum = 0;
  let prev = -1;
  for (const pair of features) {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const idx = pair[0];
    const w = pair[1];
    if (!Number.isInteger(idx) || idx < 0 || idx >= FEATURE_DIMS) return false;
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return false;
    if (idx <= prev) return false;
    prev = idx;
    sum += w * w;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) return false;
  return Math.abs(norm - 1) <= NORM_TOLERANCE;
}

function validateSample(s, now, maxAgeMs, allowSynthetic) {
  if (!isObj(s)) return false;
  for (const k of Object.keys(s)) if (!ALLOWED_SAMPLE_KEYS.has(k)) return false;
  if (!nonEmpty(s.id) || !nonEmpty(s.groupId)) return false;
  if (!nonEmpty(s.provider) || !nonEmpty(s.model)) return false;
  if (!effortOk(s.reasoningEffort)) return false;
  if (!nonEmpty(s.channel) || normalizeChannel(s.channel) !== s.channel) return false;
  if (!nonEmpty(s.type)) return false;
  if (typeof s.quality !== 'number' || !Number.isFinite(s.quality) || s.quality < 0 || s.quality > 1) return false;
  if (!checkWindow(s.timestamp, now, maxAgeMs)) return false;
  if (s.split !== 'train') return false;
  if (s.synthetic === true && !allowSynthetic) return false;
  if (s.synthetic !== true && s.synthetic !== false) return false;
  const p = s.provenance;
  if (!isObj(p) || p.kind !== 'objective') return false;
  if (!nonEmpty(p.source) || !nonEmpty(p.reference)) return false;
  if (isSubjectiveSource(p.source)) return false;
  return validateFeatures(s.features);
}

function validateGroup(g) {
  if (!isObj(g)) return false;
  const id = g.identity;
  if (!isObj(id)) return false;
  if (!nonEmpty(id.provider) || !nonEmpty(id.model)) return false;
  if (!effortOk(id.reasoningEffort)) return false;
  if (!nonEmpty(id.channel) || normalizeChannel(id.channel) !== id.channel) return false;
  if (!nonEmpty(id.type)) return false;
  if (!boundedString(id.purpose)) return false;
  if (!Number.isInteger(g.sampleCount) || g.sampleCount < 1 || g.sampleCount > MAX_QUALITY_SAMPLES) return false;
  for (const k of ['inputTokenRatio', 'outputTokens']) {
    if (typeof g[k] !== 'number' || !Number.isFinite(g[k]) || g[k] < 0) return false;
  }
  for (const k of ['durationMs', 'promptCharRatio']) {
    const v = g[k];
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return false;
  }
  const p90 = g.p90;
  if (!isObj(p90)) return false;
  for (const k of ['inputTokenRatio', 'outputTokens']) {
    if (typeof p90[k] !== 'number' || !Number.isFinite(p90[k]) || p90[k] < 0) return false;
  }
  for (const k of ['durationMs', 'promptCharRatio']) {
    const v = p90[k];
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return false;
  }
  for (const k of ['inputTokenRatio', 'outputTokens', 'durationMs', 'promptCharRatio']) {
    if ((g[k] === null) !== (p90[k] === null)) return false;
    if (g[k] !== null && p90[k] < g[k]) return false;
  }
  if (g.inputTokenRatio > MAX_INPUT_TOKENS || p90.inputTokenRatio > MAX_INPUT_TOKENS ||
      g.outputTokens > MAX_OUTPUT_TOKENS || p90.outputTokens > MAX_OUTPUT_TOKENS ||
      (g.durationMs !== null && p90.durationMs > MAX_DURATION_MS) ||
      (g.promptCharRatio !== null && p90.promptCharRatio > MAX_INPUT_CHARS)) return false;
  return true;
}

// Structural validation only. Identity and provenance fields are treated as
// caller assertions, NOT authenticated facts. This never verifies that a
// sample's provenance is truthful; it only verifies shape, bounds, and
// that subjective provenance kinds are excluded.
function validateArtifactObject(artifact, opts = {}) {
  const now = hasOwn(opts, 'now') ? opts.now : Date.now();
  const allowSynthetic = hasOwn(opts, 'allowSynthetic') ? opts.allowSynthetic : false;
  const maxAgeMs = hasOwn(opts, 'maxAgeMs') ? opts.maxAgeMs : DEFAULT_MAX_AGE_MS;
  checkEvidenceConfig(now, 8, allowSynthetic, maxAgeMs, 'artifact');
  if (!isObj(artifact)) throw new Error('routing-evidence: artifact must be an object');
  if (artifact.schemaVersion !== SCHEMA_VERSION) throw new Error('routing-evidence: unsupported schemaVersion');
  if (!nonEmpty(artifact.revision)) throw new Error('routing-evidence: revision must be a non-empty string');
  if (!finite(artifact.generatedAt) || artifact.generatedAt < 0 || artifact.generatedAt > now) {
    throw new Error('routing-evidence: generatedAt must be finite and not in the future');
  }
  if (!Number.isInteger(artifact.minSamples) || artifact.minSamples < 1 || artifact.minSamples > 1000) {
    throw new Error('routing-evidence: minSamples must be an integer in 1..1000');
  }
  if (!Array.isArray(artifact.resourceGroups) || artifact.resourceGroups.length > MAX_RESOURCE_GROUPS) {
    throw new Error('routing-evidence: resourceGroups must be an array within bounds');
  }
  const seenGroups = new Set();
  for (const g of artifact.resourceGroups) {
    if (!validateGroup(g)) throw new Error('routing-evidence: malformed resourceGroup');
    const id = g.identity;
    const key = JSON.stringify([id.provider, id.model, id.reasoningEffort, id.channel, id.type, id.purpose]);
    if (seenGroups.has(key)) throw new Error('routing-evidence: duplicate resourceGroup');
    seenGroups.add(key);
  }
  if (!Array.isArray(artifact.qualitySamples) || artifact.qualitySamples.length > MAX_QUALITY_SAMPLES) {
    throw new Error('routing-evidence: qualitySamples must be an array within bounds');
  }
  const seenIds = new Set();
  const seenActions = new Set();
  for (const s of artifact.qualitySamples) {
    if (!validateSample(s, now, maxAgeMs, allowSynthetic)) {
      throw new Error('routing-evidence: malformed qualitySample');
    }
    if (seenIds.has(s.id)) throw new Error('routing-evidence: duplicate qualitySample id');
    seenIds.add(s.id);
    const ak = actionKey(routeKey(s.provider, s.model, s.reasoningEffort, s.channel), s.type, s.groupId);
    if (seenActions.has(ak)) throw new Error('routing-evidence: duplicate qualitySample action+groupId');
    seenActions.add(ak);
  }
  const stats = artifact.stats;
  if (!isObj(stats)) throw new Error('routing-evidence: stats must be an object');
  for (const k of ['accepted', 'rejected']) {
    if (!Number.isInteger(stats[k]) || stats[k] < 0) {
      throw new Error(`routing-evidence: stats.${k} must be a non-negative integer`);
    }
  }
  // Return a safe projection, rather than retaining unchecked nested metadata.
  return {
    schemaVersion: SCHEMA_VERSION, revision: artifact.revision,
    generatedAt: artifact.generatedAt, minSamples: artifact.minSamples,
    resourceGroups: artifact.resourceGroups.map(g => ({
      identity: { provider: g.identity.provider, model: g.identity.model,
        reasoningEffort: g.identity.reasoningEffort, channel: g.identity.channel,
        type: g.identity.type, purpose: g.identity.purpose },
      sampleCount: g.sampleCount, inputTokenRatio: g.inputTokenRatio,
      outputTokens: g.outputTokens, durationMs: g.durationMs, promptCharRatio: g.promptCharRatio,
      p90: { inputTokenRatio: g.p90.inputTokenRatio, outputTokens: g.p90.outputTokens,
        durationMs: g.p90.durationMs, promptCharRatio: g.p90.promptCharRatio }
    })),
    qualitySamples: artifact.qualitySamples.map(s => ({
      id: s.id, groupId: s.groupId, provider: s.provider, model: s.model,
      reasoningEffort: s.reasoningEffort, channel: s.channel, type: s.type,
      quality: s.quality, timestamp: s.timestamp, synthetic: s.synthetic, split: 'train',
      provenance: { kind: 'objective', source: s.provenance.source, reference: s.provenance.reference },
      features: s.features.map(pair => [...pair])
    })),
    stats: { accepted: stats.accepted, rejected: stats.rejected }
  };
}

function makeStats() {
  return {
    accepted: 0, rejected: 0,
    resourceAccepted: 0, qualityAccepted: 0,
    resourceRejected: 0, qualityRejected: 0,
    reasons: {}
  };
}

function makeRejecter(stats, scope) {
  return (reason) => {
    stats.rejected++;
    if (scope === 'resource') stats.resourceRejected++;
    else stats.qualityRejected++;
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
  };
}

function resolveEffort(pkg) {
  if (pkg.reasoningEffortStatus === 'requested' &&
      typeof pkg.requestedReasoningEffort === 'string' &&
      pkg.requestedReasoningEffort !== '' &&
      effortOk(pkg.requestedReasoningEffort)) {
    return pkg.requestedReasoningEffort;
  }
  return '';
}

function actualModelOk(pkg, provider, model, channel) {
  const isApi = channel === 'harness-llm';
  const accept = new Set([model, `${provider}/${model}`]);
  if (!isApi && typeof pkg.requestedCliModel === 'string' && pkg.requestedCliModel !== '') {
    accept.add(pkg.requestedCliModel);
  }
  const am = pkg.actualModel;
  if (am === undefined || am === null) return isApi;
  if (typeof am !== 'string' || am === '' || !accept.has(am)) return false;
  return true;
}

function ingestRuns(runs, evidenceContext) {
  const reject = makeRejecter(evidenceContext.stats, 'resource');
  const now = evidenceContext.now;
  const maxAgeMs = evidenceContext.maxAgeMs;
  const seenPackages = new Set();
  let totalPackages = 0;
  if (!Array.isArray(runs)) return;
  for (const run of runs) {
    if (!isObj(run)) { reject('runNotObject'); continue; }
    if (!nonEmpty(run.id)) { reject('runBadId'); continue; }
    if (typeof run.task !== 'string') { reject('runBadTask'); continue; }
    if (!finite(run.createdAt) || !finite(run.finishedAt) || run.createdAt < 0 ||
        run.createdAt > run.finishedAt) { reject('runBadTimestamps'); continue; }
    if (!checkWindow(run.finishedAt, now, maxAgeMs)) { reject('runOutOfWindow'); continue; }
    if (!Array.isArray(run.packages)) { reject('runPackagesNotArray'); continue; }
    for (const pkg of run.packages) {
      if (totalPackages >= MAX_QUALITY_SAMPLES) { reject('tooManyResources'); return; }
      if (!isObj(pkg)) { reject('packageNotObject'); continue; }
      if (pkg.ran !== true || pkg.ok !== true) { reject('packageNotSuccessful'); continue; }
      if (pkg.usageIncomplete === true) { reject('packageIncompleteUsage'); continue; }
      if (Array.isArray(pkg.qualityAttempts) && pkg.qualityAttempts.length > 1) { reject('packageMultipleQualityAttempts'); continue; }
      if (!nonEmpty(pkg.id)) { reject('packageBadId'); continue; }
      const packageKey = JSON.stringify([run.id, pkg.id, pkg.finishedAt]);
      if (seenPackages.has(packageKey)) { reject('duplicateResource'); continue; }
      const channel = normalizeChannel(pkg.channel);
      if (!channel) { reject('packageBadChannel'); continue; }
      const provider = nonEmpty(pkg.provider) ? pkg.provider : null;
      const model = nonEmpty(pkg.model) ? pkg.model : null;
      if (!provider || !model) { reject('packageBadIdentity'); continue; }
      if (!actualModelOk(pkg, provider, model, channel)) { reject('packageBadActualModel'); continue; }
      const effort = resolveEffort(pkg);
      const type = nonEmpty(pkg.type) ? pkg.type : 'general';
      const purpose = nonEmpty(pkg.purpose) ? pkg.purpose : '';
      const usage = pkg.usage;
      if (!isObj(usage)) { reject('packageBadUsage'); continue; }
      const inputTokens = usage.inputTokens;
      const outputTokens = usage.outputTokens;
      if (!finite(inputTokens) || inputTokens < 0 || inputTokens > MAX_INPUT_TOKENS ||
          !finite(outputTokens) || outputTokens < 0 || outputTokens > MAX_OUTPUT_TOKENS) {
        reject('packageBadTokens'); continue;
      }
      let invalidCache = false;
      let promptTokens = inputTokens;
      for (const ck of ['cacheReadTokens', 'cacheWriteTokens']) {
        if (hasOwn(usage, ck) && usage[ck] !== undefined) {
          const v = usage[ck];
          if (!finite(v) || v < 0 || v > MAX_INPUT_TOKENS) { invalidCache = true; break; }
          promptTokens += v;
        }
      }
      if (invalidCache || !finite(promptTokens) || promptTokens > MAX_INPUT_TOKENS) { reject('packageBadCacheCounters'); continue; }
      if (!Number.isInteger(pkg.inputChars) || pkg.inputChars <= 0 || pkg.inputChars > MAX_INPUT_CHARS) {
        reject('packageBadInputChars'); continue;
      }
      let durationMs = null;
      if (hasOwn(pkg, 'durationMs') && pkg.durationMs !== undefined && pkg.durationMs !== null) {
        if (!finite(pkg.durationMs) || pkg.durationMs < 0 || pkg.durationMs > MAX_DURATION_MS) {
          reject('packageBadDuration'); continue;
        }
        durationMs = pkg.durationMs;
      }
      if (!checkWindow(pkg.finishedAt, now, maxAgeMs) || pkg.finishedAt < run.createdAt ||
          pkg.finishedAt > run.finishedAt) { reject('packageOutOfWindow'); continue; }
      const rk = routeKey(provider, model, effort, channel);
      const gk = JSON.stringify([rk, type, purpose]);
      let group = evidenceContext.resourceMap.get(gk);
      if (!group) {
        if (evidenceContext.resourceMap.size >= MAX_RESOURCE_GROUPS) { reject('tooManyGroups'); continue; }
        group = {
          identity: { provider, model, reasoningEffort: effort, channel, type, purpose },
          samples: { ir: [], ot: [], dm: [], pr: [] }
        };
        evidenceContext.resourceMap.set(gk, group);
      }
      // Counters represent disjoint uncached/read/write input categories. Learn
      // total prompt size; future cache hits and unreported retries are unknown.
      group.samples.ir.push(promptTokens / pkg.inputChars);
      group.samples.ot.push(outputTokens);
      if (durationMs !== null) group.samples.dm.push(durationMs);
      if (run.task.length > 0) group.samples.pr.push(pkg.inputChars / run.task.length);
      evidenceContext.stats.resourceAccepted++;
      evidenceContext.stats.accepted++;
      totalPackages++;
      seenPackages.add(packageKey);
    }
  }
}

function ingestObservations(observations, evidenceContext) {
  const reject = makeRejecter(evidenceContext.stats, 'quality');
  if (!Array.isArray(observations)) return;
  // A group appearing in any held-out split must never become a train neighbor.
  const heldOutGroups = new Set(observations.filter(obs => isObj(obs) && nonEmpty(obs.groupId) &&
    ['test', 'validation', 'calibration'].includes(obs.split)).map(obs => obs.groupId));
  evidenceContext.heldOutGroups = heldOutGroups;
  for (const obs of observations) {
    if (!isObj(obs)) { reject('observationNotObject'); continue; }
    if (!nonEmpty(obs.id)) { reject('observationBadId'); continue; }
    if (evidenceContext.idSet.has(obs.id)) { reject('duplicateId'); continue; }
    if (!nonEmpty(obs.groupId)) { reject('observationBadGroupId'); continue; }
    if (heldOutGroups.has(obs.groupId)) { reject('heldOutGroup'); continue; }
    if (typeof obs.text !== 'string' || obs.text.length === 0) { reject('observationBadText'); continue; }
    const provider = nonEmpty(obs.provider) ? obs.provider : null;
    const model = nonEmpty(obs.model) ? obs.model : null;
    if (!provider || !model) { reject('observationBadIdentity'); continue; }
    if (!effortOk(obs.reasoningEffort)) { reject('observationBadEffort'); continue; }
    const channel = normalizeChannel(obs.channel);
    if (!channel) { reject('observationBadChannel'); continue; }
    if (!nonEmpty(obs.type)) { reject('observationBadType'); continue; }
    if (typeof obs.quality !== 'number' || !Number.isFinite(obs.quality) || obs.quality < 0 || obs.quality > 1) {
      reject('observationBadQuality'); continue;
    }
    if (obs.split !== 'train') { reject('observationBadSplit'); continue; }
    if (!checkWindow(obs.timestamp, evidenceContext.now, evidenceContext.maxAgeMs)) { reject('observationBadTimestamp'); continue; }
    const prov = obs.provenance;
    if (!isObj(prov) || prov.kind !== 'objective') { reject('observationBadProvenance'); continue; }
    if (!nonEmpty(prov.source) || !nonEmpty(prov.reference)) { reject('observationBadProvenance'); continue; }
    if (isSubjectiveSource(prov.source)) { reject('observationSubjectiveSource'); continue; }
    let synthetic = false;
    if (obs.synthetic === true) {
      if (!evidenceContext.allowSynthetic) { reject('syntheticDisabled'); continue; }
      synthetic = true;
    } else if (obs.synthetic !== undefined && obs.synthetic !== false) {
      reject('observationBadSynthetic'); continue;
    }
    const rk = routeKey(provider, model, obs.reasoningEffort, channel);
    const ak = actionKey(rk, obs.type, obs.groupId);
    if (evidenceContext.actionSet.has(ak)) { reject('duplicateAction'); continue; }
    if (evidenceContext.samples.length >= MAX_QUALITY_SAMPLES) { reject('tooManySamples'); continue; }
    const features = buildFeatures(obs.text);
    if (features.length === 0) { reject('observationEmptyFeatures'); continue; }
    evidenceContext.samples.push({
      id: obs.id,
      groupId: obs.groupId,
      provider, model,
      reasoningEffort: obs.reasoningEffort,
      channel,
      type: obs.type,
      quality: obs.quality,
      timestamp: obs.timestamp,
      synthetic,
      split: 'train',
      provenance: { kind: 'objective', source: prov.source, reference: prov.reference },
      features
    });
    evidenceContext.idSet.add(obs.id);
    evidenceContext.actionSet.add(ak);
    evidenceContext.stats.qualityAccepted++;
    evidenceContext.stats.accepted++;
  }
}

function finalizeResources(resourceMap, minSamples) {
  const resourceGroups = [];
  for (const g of resourceMap.values()) {
    if (resourceGroups.length >= MAX_RESOURCE_GROUPS) break;
    const ir = g.samples.ir.slice().sort(cmp);
    const ot = g.samples.ot.slice().sort(cmp);
    const dm = g.samples.dm.slice().sort(cmp);
    const pr = g.samples.pr.slice().sort(cmp);
    const hasDur = dm.length >= minSamples;
    const hasPr = pr.length >= minSamples;
    resourceGroups.push({
      identity: g.identity,
      sampleCount: ir.length,
      inputTokenRatio: quantileSorted(ir, 0.5),
      outputTokens: quantileSorted(ot, 0.5),
      durationMs: hasDur ? quantileSorted(dm, 0.5) : null,
      promptCharRatio: hasPr ? quantileSorted(pr, 0.5) : null,
      p90: {
        inputTokenRatio: quantileSorted(ir, 0.9),
        outputTokens: quantileSorted(ot, 0.9),
        durationMs: hasDur ? quantileSorted(dm, 0.9) : null,
        promptCharRatio: hasPr ? quantileSorted(pr, 0.9) : null
      }
    });
  }
  return resourceGroups;
}

export function buildRoutingEvidence({
  runs = [],
  observations = [],
  qualityEvidence = null,
  now = Date.now(),
  minSamples = 8,
  allowSynthetic = false,
  maxAgeMs = DEFAULT_MAX_AGE_MS
} = {}) {
  checkEvidenceConfig(now, minSamples, allowSynthetic, maxAgeMs, 'build');
  const stats = makeStats();
  const resourceMap = new Map();
  const evidenceContext = { now, maxAgeMs, allowSynthetic, stats, resourceMap };
  ingestRuns(runs, evidenceContext);
  const samples = [];
  const idSet = new Set();
  const actionSet = new Set();
  const qctx = { now, maxAgeMs, allowSynthetic, stats, samples, idSet, actionSet };
  ingestObservations(observations, qctx);
  if (qualityEvidence !== null && qualityEvidence !== undefined) {
    // Strictly validate the whole artifact (including resourceGroups) before
    // importing only its qualitySamples; resourceGroups are ignored because
    // live runs rebuild resource evidence.
    const art = validateArtifactObject(qualityEvidence, { now, allowSynthetic, maxAgeMs });
    const reject = makeRejecter(stats, 'quality');
    for (const s of art.qualitySamples) {
      if (qctx.heldOutGroups?.has(s.groupId)) { reject('heldOutGroup'); continue; }
      if (idSet.has(s.id)) { reject('duplicateId'); continue; }
      const ak = actionKey(routeKey(s.provider, s.model, s.reasoningEffort, s.channel), s.type, s.groupId);
      if (actionSet.has(ak)) { reject('duplicateAction'); continue; }
      if (samples.length >= MAX_QUALITY_SAMPLES) { reject('tooManySamples'); continue; }
      samples.push(s);
      idSet.add(s.id);
      actionSet.add(ak);
      stats.qualityAccepted++;
      stats.accepted++;
    }
  }
  const resourceGroups = finalizeResources(resourceMap, minSamples);
  resourceGroups.sort((a, b) => compareText(JSON.stringify(a.identity), JSON.stringify(b.identity)));
  samples.sort((a, b) => compareText(JSON.stringify([a.provider, a.model, a.reasoningEffort,
    a.channel, a.type, a.groupId, a.id]), JSON.stringify([b.provider, b.model,
    b.reasoningEffort, b.channel, b.type, b.groupId, b.id])));
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: contentRevision({ minSamples, resourceGroups, qualitySamples: samples }),
    generatedAt: now,
    minSamples,
    resourceGroups,
    qualitySamples: samples,
    stats
  };
}

export function predictResources(evidence, {
  provider, model, reasoningEffort = '', channel = 'harness-llm',
  type = 'general', purpose = '', inputChars
} = {}) {
  if (!isObj(evidence) || evidence.schemaVersion !== SCHEMA_VERSION || !Array.isArray(evidence.resourceGroups)) return null;
  if (!nonEmpty(provider) || !nonEmpty(model)) return null;
  if (!effortOk(reasoningEffort)) return null;
  const ch = normalizeChannel(channel);
  if (!ch) return null;
  const ty = nonEmpty(type) ? type : 'general';
  const pu = typeof purpose === 'string' ? purpose : '';
  const minSamples = evidence.minSamples;
  if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 1000) return null;
  void inputChars;
  for (const g of evidence.resourceGroups) {
    if (!validateGroup(g)) continue;
    const id = g.identity;
    if (id.provider === provider && id.model === model && id.reasoningEffort === reasoningEffort &&
        id.channel === ch && id.type === ty && id.purpose === pu) {
      if (!Number.isInteger(g.sampleCount) || g.sampleCount < minSamples) return null;
      return {
        inputTokenRatio: g.inputTokenRatio,
        outputTokens: g.outputTokens,
        durationMs: g.durationMs,
        promptCharRatio: g.promptCharRatio,
        p90: {
          inputTokenRatio: g.p90.inputTokenRatio,
          outputTokens: g.p90.outputTokens,
          durationMs: g.p90.durationMs,
          promptCharRatio: g.p90.promptCharRatio
        },
        sampleCount: g.sampleCount,
        source: 'recorded-resource-evidence'
      };
    }
  }
  return null;
}

export function predictQuality(evidence, {
  text, type = 'general', provider, model, reasoningEffort = '', channel = 'harness-llm'
} = {}) {
  if (!isObj(evidence) || evidence.schemaVersion !== SCHEMA_VERSION || !Array.isArray(evidence.qualitySamples)) return null;
  if (typeof text !== 'string' || text.length === 0) return null;
  if (!nonEmpty(provider) || !nonEmpty(model)) return null;
  if (!effortOk(reasoningEffort)) return null;
  const ch = normalizeChannel(channel);
  if (!ch) return null;
  const ty = nonEmpty(type) ? type : 'general';
  const minSamples = evidence.minSamples;
  if (!Number.isInteger(minSamples) || minSamples < 1 || minSamples > 1000) return null;
  const qfeat = buildFeatures(text);
  if (qfeat.length === 0) return null;
  const matched = [];
  let sumAll = 0;
  let nAll = 0;
  for (const s of evidence.qualitySamples) {
    if (!isObj(s) || !finite(s.quality) || s.quality < 0 || s.quality > 1 ||
      !validateFeatures(s.features) || s.split !== 'train') continue;
    if (s.provider !== provider || s.model !== model || s.reasoningEffort !== reasoningEffort ||
        s.channel !== ch || s.type !== ty) continue;
    sumAll += s.quality;
    nAll++;
    const sim = cosine(qfeat, s.features);
    if (sim >= SIM_THRESHOLD) matched.push({ s, sim });
  }
  if (matched.length === 0) return null;
  matched.sort((a, b) => b.sim - a.sim);
  const seenGroup = new Set();
  const neighbors = [];
  for (const m of matched) {
    if (seenGroup.has(m.s.groupId)) continue;
    seenGroup.add(m.s.groupId);
    neighbors.push(m);
    if (neighbors.length >= MAX_NEIGHBORS) break;
  }
  if (neighbors.length < minSamples) return null;
  const routeTypeMean = nAll > 0 ? sumAll / nAll :
    neighbors.reduce((a, b) => a + b.s.quality, 0) / neighbors.length;
  let wsum = 0;
  let wq = 0;
  for (const n of neighbors) { wsum += n.sim; wq += n.sim * n.s.quality; }
  if (!(wsum > 0)) return null;
  // Shrink toward the exact route+type mean with a fixed prior of 2 samples.
  const quality = (wq + SHRINK_PRIOR * routeTypeMean) / (wsum + SHRINK_PRIOR);
  const meanSim = wsum / neighbors.length;
  const wmean = wq / wsum;
  let varSum = 0;
  for (const n of neighbors) {
    const d = n.s.quality - wmean;
    varSum += n.sim * d * d;
  }
  const spread = Math.sqrt(varSum / wsum);
  const clamped = Math.min(1, Math.max(0, quality));
  return {
    quality: clamped,
    sampleCount: neighbors.length,
    similarity: Math.min(1, Math.max(0, meanSim)),
    source: 'recorded-query-evidence',
    uncertainty: {
      kind: 'empirical-neighbor-spread',
      neighborCount: neighbors.length,
      similarityThreshold: SIM_THRESHOLD,
      spread,
      calibrated: false,
      note: 'Empirical neighbor spread; not a calibrated probability.'
    }
  };
}

export function parseRoutingEvidenceJson(text, {
  now = Date.now(),
  allowSynthetic = false,
  maxAgeMs = DEFAULT_MAX_AGE_MS
} = {}) {
  if (typeof text !== 'string') {
    throw new Error('routing-evidence: parse expects a JSON string');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`routing-evidence: invalid JSON (${err.message})`);
  }
  // Validation is structural only. The artifact's identity and provenance
  // claims are caller assertions and are NEVER treated as authenticated here.
  return validateArtifactObject(data, { now, allowSynthetic, maxAgeMs });
}
