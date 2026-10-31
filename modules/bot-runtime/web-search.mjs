// Keep the frozen provider in the unified package's real Loader graph. This
// entry has no Bot runtime/client and never performs a search during startup.
export { name, inject, apply } from './vendor/ds-bot/web-search.js'
