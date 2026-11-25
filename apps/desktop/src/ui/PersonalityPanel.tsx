import { useEffect, useRef, useState } from 'react'
import { configure, watchPersonality } from '../lib/brain'
import { AFFECT_TRAITS, DEFAULT_PERSONALITY, PERSONALITY_TRAITS, type PersonalityProfile, type PersonalitySnapshot, type PersonalityTrait } from '../../bridge/personality/profile.mjs'
import './personality.css'

const descriptions: Record<PersonalityTrait, string> = {
  humor: 'Dry wit and playfulness. Zero turns jokes off.',
  honesty: 'How explicitly limitations are stated. Truthfulness is always required.',
  warmth: 'Friendly, attentive conversational tone.',
  enthusiasm: 'Upbeat delivery, without forced cheerfulness. Not the temporary Joy bar.',
  sarcasm: 'Gentle dry irony only when welcome. Never ridicule.',
  curiosity: 'Relevant interest, without needless questions or extra actions.',
  directness: 'Lead with the answer; higher values favor concision.',
  patience: 'Patient explanation without condescension.',
  discretion: 'Limit unnecessary personal disclosures. Privacy rules always apply.',
  playfulness: 'Optional playful delivery in suitable conversations.',
  empathy: 'Respectful acknowledgment of difficulty, without claiming feelings.',
  formality: 'Casual language at low values; composed formal language at high values.',
}

const affectLabels: Record<(typeof AFFECT_TRAITS)[number], string> = {
  joy: 'Joy', amusement: 'Amusement', frustration: 'Frustration', irritation: 'Irritation',
  anger: 'Anger', concern: 'Concern', excitement: 'Excitement', confidence: 'Delivery confidence',
  uncertainty: 'Delivery uncertainty', curiosity: 'Curiosity', urgency: 'Urgency',
}

export function PersonalityPanel() {
  const [state, setState] = useState<PersonalitySnapshot | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [affectOpen, setAffectOpen] = useState(false)
  const [draft, setDraft] = useState<PersonalityProfile>({ ...DEFAULT_PERSONALITY })
  const lastProfile = useRef('')
  useEffect(() => watchPersonality((value, message) => {
    setState(value)
    if (value) {
      const signature = JSON.stringify(value.profile)
      // Live mood updates must not snap an in-progress slider drag backwards.
      if (signature !== lastProfile.current) { lastProfile.current = signature; setDraft(value.profile) }
    }
    setError(message ?? '')
  }), [])

  const commit = (key: PersonalityTrait, value: number) => {
    if (!state) return
    void configure({ personality: { [key]: value } }).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'Could not save Nori’s personality setting.')
    })
  }
  return (
    <section className="nori-personality" aria-label="Nori personality and affect engine">
      <button className="nori-personality-heading" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span>NORI PERSONALITY</span>
        <span className="nori-personality-mode">{state ? state.mode : 'not connected'} <span aria-hidden="true">{open ? '−' : '+'}</span></span>
      </button>
      {open && (
        <div className="nori-personality-controls">
          <p>Stable · owner-configurable · 12 traits</p>
          <div className="nori-personality-scroll" aria-label="Stable personality settings" tabIndex={0}>
          {PERSONALITY_TRAITS.map(key => (
            <label className="nori-personality-slider" key={key} title={descriptions[key]}>
              <span>{key}<output>{draft[key]}</output></span>
              <input type="range" min={0} max={100} step={1} value={draft[key]} disabled={!state}
                aria-label={`Nori ${key} preference`}
                onChange={event => {
                  const value = Number(event.target.value)
                  setDraft(previous => ({ ...previous, [key]: value }))
                }}
                onPointerUp={event => commit(key, Number(event.currentTarget.value))}
                onKeyUp={event => commit(key, Number(event.currentTarget.value))}
                onBlur={event => { if (state && Number(event.currentTarget.value) !== state.profile[key]) commit(key, Number(event.currentTarget.value)) }}
              />
            </label>
          ))}
          </div>
          <button className="rail-btn" disabled={!state} onClick={() => {
            void configure({ personality: { ...DEFAULT_PERSONALITY } }).catch((failure: unknown) => {
              setError(failure instanceof Error ? failure.message : 'Could not restore Nori’s personality settings.')
            })
          }}>RESTORE YOUR BASELINE</button>
          <p className={state?.saved === false || error ? 'nori-personality-error' : ''} role="status">
            {error || (state?.saved === false ? 'Applied for this session; local save failed.'
              : state?.active ? 'Slider changes apply to the next reply.'
                : state?.saved ? 'Saved on this PC · applies to the next reply.' : 'Applies to the next reply.')}
          </p>
        </div>
      )}
      <button className="nori-personality-heading nori-affect-heading" onClick={() => setAffectOpen(value => !value)} aria-expanded={affectOpen}>
        <span>NORI AFFECT STATE</span><span aria-hidden="true">{affectOpen ? '−' : '+'}</span>
      </button>
      {affectOpen && <div className="nori-personality-mood" aria-label="Dynamic temporary affect" tabIndex={0}>
        <p className="nori-personality-context">Rule-based expression · temporary · {state ? state.reason : 'Waiting for the local bridge'}</p>
        {AFFECT_TRAITS.map(key => (
          <div className="nori-personality-bar" key={key}>
            <span>{affectLabels[key]}</span>
            <div className={state ? 'nori-personality-meter' : 'nori-personality-meter nori-personality-meter-unavailable'}
              role={state ? 'meter' : 'img'} aria-label={state ? `Live ${key}` : `Live ${key} unavailable`}
              {...(state ? {
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': state.affect[key],
                'aria-valuetext': `${state.affect[key]} out of 100, behavioral expression, not measured emotion or factual certainty`,
              } : { 'aria-roledescription': 'unavailable affect indicator' })}>
              {state && <span className="nori-personality-fill" style={{ width: `${state.affect[key]}%` }} />}
            </div>
            <output>{state ? state.affect[key] : '—'}</output>
          </div>
        ))}
      </div>}
      <p className="nori-personality-footnote">Conversation/task cue indicators, not feelings or sensor/model measurements. Delivery confidence and uncertainty are not factual reliability scores.</p>
    </section>
  )
}
