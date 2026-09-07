/**
 * Resource monitoring types for the automation calendar.
 * @module ui-automation-calendar/contract/resource-types
 */

/** Resource metric type identifiers. */
export type ResourceType = 'token' | 'cpu' | 'gpu' | 'memory' | 'storage' | 'network'

/** Resource display configuration. */
export interface ResourceDisplayConfig {
  type: ResourceType
  name: string
  nameKey: string
  icon: string
  color: string
  unit: string
  format: 'number' | 'percent' | 'bytes' | 'duration'
  maxValue?: number
}

/** Density heatmap color scale. */
export interface DensityColorScale {
  low: string
  medium: string
  high: string
  critical: string
}

/** Default resource display configurations. */
export const RESOURCE_CONFIGS: ReadonlyMap<ResourceType, ResourceDisplayConfig> = new Map([
  ['token', { type: 'token', name: 'Token消耗', nameKey: 'resource.token', icon: '🔤', color: '#2196F3', unit: 'tokens', format: 'number' }],
  ['cpu', { type: 'cpu', name: 'CPU使用率', nameKey: 'resource.cpu', icon: '🖥️', color: '#4CAF50', unit: '%', format: 'percent', maxValue: 100 }],
  ['gpu', { type: 'gpu', name: 'GPU使用率', nameKey: 'resource.gpu', icon: '🎮', color: '#9C27B0', unit: '%', format: 'percent', maxValue: 100 }],
  ['memory', { type: 'memory', name: '内存使用', nameKey: 'resource.memory', icon: '💾', color: '#FF9800', unit: 'MB', format: 'bytes' }],
  ['storage', { type: 'storage', name: '存储IO', nameKey: 'resource.storage', icon: '📀', color: '#795548', unit: 'B', format: 'bytes' }],
  ['network', { type: 'network', name: '网络流量', nameKey: 'resource.network', icon: '🌐', color: '#607D8B', unit: 'B', format: 'bytes' }],
])

/** Default density color scale for heatmaps. */
export const DEFAULT_DENSITY_COLORS: DensityColorScale = {
  low: '#E3F2FD',
  medium: '#90CAF9',
  high: '#42A5F5',
  critical: '#1565C0',
}

/** Status color mapping. */
export const STATUS_COLORS: ReadonlyMap<string, string> = new Map([
  ['running', '#4CAF50'],
  ['completed', '#8BC34A'],
  ['failed', '#F44336'],
  ['stuck', '#FF9800'],
  ['cancelled', '#9E9E9E'],
])
