/**
 * MindMapRoot - placeholder presenter for the Mind-Map conversation-view tab.
 * It leans on the standard `useSession` hook to identify the occupying session
 * and the locale seat for copy; the node canvas itself is a backlog item.
 * @module ui-mindmap/client/components/MindMapRoot
 */

import type { CSSProperties } from 'react'
import type { MindMapComponentProps } from '../contract/slots.ts'

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 24,
}

export function MindMapRoot({ useSession, stage, t }: MindMapComponentProps) {
  const sessionId = useSession(s => s.sessionId)

  return (
    <div style={containerStyle} data-stage={stage}>
      <h2>{t('placeholder.title')}</h2>
      <p>{t('placeholder.description')}</p>
      <p>
        {t('session.label')}: <code>{String(sessionId)}</code>
      </p>
      <p>
        {t('stage.label')}: <code>{stage}</code>
      </p>
    </div>
  )
}