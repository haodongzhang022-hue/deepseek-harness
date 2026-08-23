/**
 * CustomGranularityForm - Create and remove user-defined granularity levels.
 * @module ui-automation-calendar/client/components/CustomGranularityForm
 */

import { useState } from 'react'
import type { CustomGranularity } from '../contract/time-granularity.ts'
import { getTimeGranularityEngine } from '../engine/time-granularity-engine.ts'
import { formatResourceValue } from '../engine/resource-aggregator.ts'
import css from './CustomGranularityForm.module.css'

interface CustomGranularityFormProps {
  /** Current selection; switches to the new level on create. */
  onSelect: (id: string) => void
}

/** Human-friendly interval units accepted by the input. */
const UNITS = [
  { id: 'ms', label: '毫秒', ms: 1 },
  { id: 's', label: '秒', ms: 1_000 },
  { id: 'm', label: '分', ms: 60_000 },
  { id: 'h', label: '时', ms: 3_600_000 },
] as const

/** Builtin ids a custom level must not shadow. */
const RESERVED_IDS = new Set([
  'sub-second', 'second', 'five-seconds', 'fifteen-seconds', 'half-minute',
  'minute', 'five-minutes', 'fifteen-minutes', 'half-hour', 'hour',
  'three-hours', 'six-hours', 'twelve-hours', 'day', 'week', 'month',
])

export function CustomGranularityForm({ onSelect }: CustomGranularityFormProps) {
  const engine = getTimeGranularityEngine()
  const [name, setName] = useState('')
  const [value, setValue] = useState('30')
  const [unit, setUnit] = useState<(typeof UNITS)[number]['id']>('s')
  const [error, setError] = useState<string | null>(null)

  const customs = engine.getCustomGranularities()

  const handleCreate = (): void => {
    const trimmedName = name.trim()
    const numeric = Number(value)
    const unitConfig = UNITS.find(u => u.id === unit)

    if (trimmedName.length === 0) {
      setError('请填写名称')
      return
    }
    if (!Number.isFinite(numeric) || numeric <= 0 || unitConfig === undefined) {
      setError('间隔必须为正数')
      return
    }
    // A duplicate custom id replaces its entry; builtin ids stay reserved.
    if (RESERVED_IDS.has(trimmedName)) {
      setError('名称与内置级别冲突')
      return
    }

    const intervalMs = Math.round(numeric * unitConfig.ms)
    const config: CustomGranularity = {
      id: `custom-${trimmedName}`,
      name: trimmedName,
      nameKey: `granularity.custom-${trimmedName}`,
      intervalMs,
      color: '#7C4DFF',
      icon: '🔧',
      tickFormat: 'HH:mm',
      collapseThresholdMs: intervalMs * 2,
      builtin: false,
    }
    engine.addPersistentCustomGranularity(config)
    setError(null)
    setName('')
    onSelect(config.id)
  }

  return (
    <div className={css.form}>
      <div className={css.formTitle}>自定义粒度</div>

      <div className={css.row}>
        <input
          className={css.nameInput}
          placeholder="名称，如 每45秒"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div className={css.row}>
        <input
          className={css.valueInput}
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <select
          className={css.unitSelect}
          value={unit}
          onChange={e => setUnit(e.target.value as typeof unit)}
        >
          {UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
        <button className={css.createButton} onClick={handleCreate}>添加</button>
      </div>

      {error !== null && <div className={css.error}>{error}</div>}

      {customs.length > 0 && (
        <div className={css.existing}>
          {customs.map(custom => (
            <button
              key={custom.id}
              className={css.existingRow}
              onClick={() => onSelect(custom.id)}
              title="点击选用"
            >
              <span>{custom.icon} {custom.name}</span>
              <span className={css.interval}>{formatResourceValue(custom.intervalMs, 'duration')}</span>
              <span
                role="button"
                tabIndex={0}
                className={css.removeButton}
                onClick={(e) => { e.stopPropagation(); engine.removePersistentCustomGranularity(custom.id) }}
                onKeyDown={(e) => { if (e.key === 'Enter') engine.removePersistentCustomGranularity(custom.id) }}
              >
                ✕
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
