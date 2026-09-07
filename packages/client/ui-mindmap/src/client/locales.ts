/**
 * Locale dictionaries for the Mind-Map entry shell.
 * @module ui-mindmap/client/locales
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Mind-Map dictionary namespace. */
    mindmap: MindMapKey
  }
}

/** Locale namespace owned by this package. */
export const MINDMAP_LOCALE_NS = 'mindmap'

/** Every key the Mind-Map view reads through its locale seat. */
export type MindMapKey =
  | 'view.mindmap'
  | 'placeholder.title'
  | 'placeholder.description'
  | 'session.label'
  | 'stage.label'

export const mindmapZh: Record<MindMapKey, string> = {
  'view.mindmap': '思维导图',
  'placeholder.title': 'Mind-Map 画布',
  'placeholder.description': '节点图式会话画布在此入口壳中待后续实现：Issue/PR → 分支 → 泳道。当前为占位分页。',
  'session.label': '当前会话',
  'stage.label': '阶段',
}

export const mindmapEn: Record<MindMapKey, string> = {
  'view.mindmap': 'Mind-Map',
  'placeholder.title': 'Mind-Map Canvas',
  'placeholder.description': 'The node-graph conversation canvas is pending on this entry shell: Issue/PR → branches → swimlanes. This is a placeholder tab for now.',
  'session.label': 'Active session',
  'stage.label': 'Stage',
}