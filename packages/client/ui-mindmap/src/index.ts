/**
 * @deepseek-ai/dsh-client-ui-mindmap
 * Mind-Map Conversation Canvas for DeepSeek Harness
 *
 * A spatial, node-graph replacement for the linear chat transcript.
 * Every node is an Issue or PR with full DSH capability attachment.
 */

// ──────────────────────────────────────────────
// 主入口
// ──────────────────────────────────────────────

export { default as apply } from './apply.tsx'

// ──────────────────────────────────────────────
// Canvas 组件
// ──────────────────────────────────────────────

export { MindMapCanvas, MindMapOutline, MindMapSearch } from './canvas/MindMapCanvas.tsx'

// ──────────────────────────────────────────────
// Store & Hooks
// ──────────────────────────────────────────────

export { useMindMapStore } from './store/mindmap.ts'
export * from './integration/projectionHooks.ts'

// ──────────────────────────────────────────────
// Integration
// ──────────────────────────────────────────────

export { MindMapBridge, getMindMapBridge } from './integration/sessionBridge.ts'

// ──────────────────────────────────────────────
// Contracts (Types & Slots)
// ──────────────────────────────────────────────

export * from './contract/types.ts'
export * from './contract/slots.ts'

// ──────────────────────────────────────────────
// 版本信息
// ──────────────────────────────────────────────

export const VERSION = '0.1.0'
export const PLUGIN_NAME = '@deepseek-ai/dsh-client-ui-mindmap'