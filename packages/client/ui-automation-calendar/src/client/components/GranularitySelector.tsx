/**
 * GranularitySelector - Dropdown of builtin + custom levels, with an inline
 * custom-granularity form.
 * @module ui-automation-calendar/client/components/GranularitySelector
 */

import { useMemo, useState } from 'react'
import type { GranularityId } from '../contract/time-granularity.ts'
import { getTimeGranularityEngine } from '../engine/time-granularity-engine.ts'
import type { Translate } from './translate.ts'
import { CustomGranularityForm } from './CustomGranularityForm.tsx'
import css from './GranularitySelector.module.css'

interface GranularitySelectorProps {
  value: GranularityId
  onChange: (id: GranularityId) => void
  t: Translate
}

export function GranularitySelector({ value, onChange, t }: GranularitySelectorProps) {
  const engine = getTimeGranularityEngine()
  const [open, setOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Plain object-layer read; the registry only changes through this UI.
  const options = useMemo(() => engine.getAvailableGranularities(), [engine, open, showForm])

  const currentLabel = options.find(o => o.id === value)?.name ?? value

  return (
    <div className={css.selector}>
      <button className={css.trigger} onClick={() => setOpen(prev => !prev)}>
        ⏱ {t('granularity.label')}: {currentLabel} ▾
      </button>
      {open && (
        <div className={css.dropdown}>
          {options.map(option => (
            <button
              key={option.id}
              className={`${css.option} ${option.id === value ? css.active : ''}`}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
                setShowForm(false)
              }}
            >
              <span>{option.icon}</span>
              <span>{option.name.startsWith('custom-') ? option.name.slice('custom-'.length) : option.name}</span>
            </button>
          ))}
          <button
            className={`${css.option} ${css.addOption}`}
            onClick={() => setShowForm(prev => !prev)}
          >
            ＋ 自定义…
          </button>
          {showForm && (
            <CustomGranularityForm onSelect={(id) => {
              onChange(id)
              setOpen(false)
              setShowForm(false)
            }} />
          )}
        </div>
      )}
    </div>
  )
}
