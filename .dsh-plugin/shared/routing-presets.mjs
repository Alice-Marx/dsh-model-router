/**
 * Routing presets. Each preset tilts the planner's objective weights between
 * quality and cost and shifts the per-task quality floor that a cheaper
 * substitute must clear. 均衡 (balanced) reproduces the original planner.
 */

export const DEFAULT_ROUTING_PRESET = 'balanced'

export const ROUTING_PRESETS = Object.freeze({
  economy: Object.freeze({
    id: 'economy', label: '省钱优先',
    description: '更看重单价，允许质量略低的模型承担简单和中等任务。',
    floorDelta: -0.04, tilt: Object.freeze({ quality: 0.75, cost: 1.6, latency: 1.1 }),
  }),
  balanced: Object.freeze({
    id: 'balanced', label: '均衡',
    description: '默认：按任务难度平衡质量、成本和速度。',
    floorDelta: 0, tilt: Object.freeze({}),
  }),
  quality: Object.freeze({
    id: 'quality', label: '效果优先',
    description: '更看重质量，提高替代模型必须达到的质量门槛。',
    floorDelta: 0.04, tilt: Object.freeze({ quality: 1.35, cost: 0.5, specialty: 1.2, reasoning: 1.2 }),
  }),
})

export function normalizeRoutingPreset(value) {
  return Object.hasOwn(ROUTING_PRESETS, value) ? value : DEFAULT_ROUTING_PRESET
}

export function routingPreset(value) {
  return ROUTING_PRESETS[normalizeRoutingPreset(value)]
}

/** Tilt objective weights and renormalize to the original total. */
export function presetWeights(weights, preset) {
  const { tilt } = routingPreset(preset)
  if (!weights || Object.keys(tilt).length === 0) return weights
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0)
  const tilted = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value * (tilt[key] ?? 1)]))
  const tiltedTotal = Object.values(tilted).reduce((sum, value) => sum + value, 0)
  return Object.freeze(Object.fromEntries(Object.entries(tilted).map(([key, value]) => [key, value * total / tiltedTotal])))
}

/** Quality floor after the preset shift, kept within [0.5, 0.97]. */
export function presetFloor(floor, preset) {
  const value = Number(floor) + routingPreset(preset).floorDelta
  return Math.max(0.5, Math.min(0.97, value))
}
