import { useCallback, useEffect, useState } from 'react'
import { deleteLearnedMemory, editLearnedMemory, readLearnedMemory, type LearnedMemoryEntry, type LearnedMemoryInventory } from '../lib/memory'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Date not available'
}

export function MemoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [inventory, setInventory] = useState<LearnedMemoryInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setInventory(await readLearnedMemory()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nori could not read saved memory.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open) void refresh() }, [open, refresh])
  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [open, onClose])

  if (!open) return null

  const beginEdit = (entry: LearnedMemoryEntry) => { setEditing(entry.id); setDraft(entry.text); setError('') }
  const saveEdit = async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      setInventory(await editLearnedMemory(id, draft))
      setEditing(null)
      setDraft('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nori could not save that correction.') }
    finally { setBusyId(null) }
  }
  const removeEntry = async (entry: LearnedMemoryEntry) => {
    if (!window.confirm(`Remove this saved memory?\n\n${entry.text}`)) return
    setBusyId(entry.id)
    setError('')
    try { setInventory(await deleteLearnedMemory(entry.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nori could not remove that memory.') }
    finally { setBusyId(null) }
  }
  const exportInventory = () => {
    if (!inventory) return
    const payload = JSON.stringify({ ...inventory, exportedAt: new Date().toISOString() }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `nori-saved-memory-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="memory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="memory-panel" role="dialog" aria-modal="true" aria-labelledby="memory-title">
        <header className="memory-header">
          <div>
            <div className="memory-kicker">N.O.R.I. · LOCAL MEMORY</div>
            <h2 id="memory-title">What Nori remembers</h2>
          </div>
          <button className="memory-close" onClick={onClose} aria-label="Close memory">×</button>
        </header>
        <p className="memory-scope">{inventory?.note || 'Loading the exact contents of Nori’s explicit local learning store…'}</p>
        <div className="memory-toolbar">
          <span>{loading ? 'Reading saved entries…' : `${inventory?.entries.length ?? 0} saved entries`}</span>
          <div>
            <button onClick={() => void refresh()} disabled={loading}>Refresh</button>
            <button onClick={exportInventory} disabled={!inventory}>Export JSON</button>
          </div>
        </div>
        {error && <div className="memory-error" role="alert">{error}</div>}
        <div className="memory-coverage" aria-label="Memory categories">
          <span>Knowledge <b>{inventory?.counts.knowledge ?? '—'}</b></span>
          <span>Preferences <b>{inventory?.counts.preferences ?? '—'}</b></span>
          <span>Corrections <b>{inventory?.counts.feedback ?? '—'}</b></span>
        </div>
        <div className="memory-list">
          {inventory?.entries.map((entry) => (
            <article className="memory-entry" key={`${entry.kind}:${entry.id}`}>
              <div className="memory-entry-meta"><span>{entry.label}</span><time dateTime={entry.at}>{dateLabel(entry.at)}</time></div>
              {editing === entry.id ? (
                <>
                  <textarea value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} aria-label="Edit saved memory" />
                  <div className="memory-entry-actions">
                    <button onClick={() => void saveEdit(entry.id)} disabled={busyId === entry.id || draft.trim().length < 5}>Save correction</button>
                    <button onClick={() => { setEditing(null); setDraft('') }}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <p>{entry.text}</p>
                  <div className="memory-entry-actions">
                    <button onClick={() => beginEdit(entry)} disabled={busyId === entry.id}>Correct</button>
                    <button className="memory-remove" onClick={() => void removeEntry(entry)} disabled={busyId === entry.id}>Forget</button>
                  </div>
                </>
              )}
            </article>
          ))}
          {!loading && inventory?.entries.length === 0 && !error && <p className="memory-empty">Nothing has been explicitly saved in this memory store yet.</p>}
        </div>
        <footer className="memory-footer">Only entries in this local memory store are shown here. Nori does not infer or add unsaved chat details to this list.</footer>
      </section>
    </div>
  )
}
