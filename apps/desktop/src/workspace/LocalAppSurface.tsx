import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AppSpecFrame, AppSpecField } from './spatial-contract'

type Row = { id: string; values: Record<string, string | number | boolean>; updated_at: string }
type Props = { app: { id: string; frame: AppSpecFrame } }
type DraftValues = Record<string, string | boolean>

function initialValues(fields: AppSpecField[]): DraftValues {
  return Object.fromEntries(fields.map(field => [field.id,
    typeof field.default === 'boolean' ? field.default : field.default === null ? '' : String(field.default)]))
}

export function LocalAppSurface({ app }: Props) {
  const [viewId, setViewId] = useState(app.frame.views[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [values, setValues] = useState<DraftValues>({})
  const [editingId, setEditingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const view = app.frame.views.find(item => item.id === viewId) ?? app.frame.views[0]
  const collection = app.frame.data_schema.find(item => item.id === view?.collection_id)
  const fields = useMemo(() => collection?.fields.filter(field => view?.fields.includes(field.id)) ?? [], [collection, view])
  const canRead = app.frame.capabilities.includes('local_data.read')
  const canCreate = app.frame.capabilities.includes('local_data.create')
  const canUpdate = app.frame.capabilities.includes('local_data.update')
  const canDelete = app.frame.capabilities.includes('local_data.delete')

  const refresh = async () => {
    if (!view || !canRead) { setRows([]); return }
    const result = await window.noriWorkspace?.appRecords?.({ app_id: app.id, collection_id: view.collection_id })
    if (!result) throw new Error('The local app data surface is unavailable in this desktop.')
    setRows(result.records)
  }

  useEffect(() => {
    setValues(initialValues(fields))
    setEditingId('')
    setError('')
    void refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load local app data.'))
  // refresh reads app ID, view and capabilities; view changes are the data boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id, view?.id, canRead, fields])

  const normalized = () => Object.fromEntries(fields.map(field => {
    const value = values[field.id]
    if (field.type === 'boolean') return [field.id, value === true]
    if (field.type === 'integer' || field.type === 'number') return [field.id, value === '' ? undefined : Number(value)]
    return [field.id, value ?? '']
  }).filter(([, value]) => value !== undefined)) as Record<string, string | number | boolean>

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!view || (!editingId && !canCreate) || (editingId && !canUpdate)) return
    setBusy(true); setError('')
    try {
      const payload = { app_id: app.id, collection_id: view.collection_id, values: normalized() }
      const result = editingId
        ? await window.noriWorkspace?.appRecordUpdate?.({ ...payload, record_id: editingId })
        : await window.noriWorkspace?.appRecordCreate?.(payload)
      if (!result) throw new Error('Nori did not confirm the local data change.')
      setValues(initialValues(fields)); setEditingId('')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The local record could not be saved.') }
    finally { setBusy(false) }
  }

  const startEdit = (row: Row) => {
    setEditingId(row.id)
    setValues(Object.fromEntries(fields.map(field => [field.id,
      typeof row.values[field.id] === 'boolean' ? row.values[field.id] : row.values[field.id] === undefined ? '' : String(row.values[field.id])])) as DraftValues)
  }

  const remove = async (row: Row) => {
    if (!canDelete || !view || !window.confirm('Delete this local app record? This cannot be undone.')) return
    setBusy(true); setError('')
    try {
      const result = await window.noriWorkspace?.appRecordDelete?.({ app_id: app.id, collection_id: view.collection_id, record_id: row.id })
      if (!result?.deleted) throw new Error('Nori did not confirm deleting this record.')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The record could not be deleted.') }
    finally { setBusy(false) }
  }

  return <section className="local-app" aria-label={`${app.frame.title} local application`}>
    <header className="local-app-head"><h3>{app.frame.title}</h3><p>{app.frame.description}</p><span>LOCAL ONLY · TYPED UI · NO GENERATED CODE</span></header>
    {app.frame.views.length > 1 && <label className="local-app-view">View<select value={view?.id ?? ''} onChange={event => setViewId(event.target.value)}>{app.frame.views.map(item => <option key={item.id} value={item.id}>{item.name} · {item.type}</option>)}</select></label>}
    {view && collection && <>
      {(canCreate || (editingId && canUpdate)) && <form className="local-app-form" onSubmit={save}>
        <strong>{editingId ? 'Edit record' : `Add to ${collection.name}`}</strong>
        {fields.map(field => <label key={field.id}>
          <span>{field.name}{field.required ? ' *' : ''}</span>
          {field.type === 'boolean' ? <input type="checkbox" checked={values[field.id] === true} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.checked }))} />
            : field.type === 'enum' ? <select required={field.required} value={String(values[field.id] ?? '')} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}><option value="">Choose…</option>{(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select>
              : <input required={field.required} type={field.type === 'integer' || field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'integer' ? '1' : field.type === 'number' ? 'any' : undefined} maxLength={field.type === 'string' ? 4000 : undefined} value={String(values[field.id] ?? '')} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} />}
        </label>)}
        <div className="local-app-actions"><button className="spatial-primary" type="submit" disabled={busy}>{busy ? 'SAVING…' : editingId ? 'SAVE CHANGES LOCALLY' : 'SAVE LOCALLY'}</button>{editingId && <button type="button" className="spatial-tool" onClick={() => { setEditingId(''); setValues(initialValues(fields)) }}>CANCEL</button>}</div>
      </form>}
      <div className="local-app-records"><strong>{collection.name} · {rows.length} records</strong>
        {canRead ? rows.length ? <div className="local-app-table-wrap"><table><thead><tr>{fields.map(field => <th key={field.id}>{field.name}</th>)}{(canUpdate || canDelete) && <th>Actions</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{fields.map(field => <td key={field.id}>{String(row.values[field.id] ?? '')}</td>)}{(canUpdate || canDelete) && <td>{canUpdate && <button className="spatial-tool" disabled={busy} onClick={() => startEdit(row)}>EDIT</button>}{canDelete && <button className="spatial-danger" disabled={busy} onClick={() => void remove(row)}>DELETE</button>}</td>}</tr>)}</tbody></table></div> : <p>No local records yet.</p> : <p>This app does not declare local_data.read, so existing records are not shown.</p>}
      </div>
      {app.frame.workflows.length > 0 && <p className="local-app-inert">{app.frame.workflows.length} declared workflow(s) are stored as Neuralese design data only; workflow automation is not enabled.</p>}
    </>}
    {!view && <p>This proposal has no views to open.</p>}
    {error && <p className="spatial-project-message" role="alert">{error}</p>}
  </section>
}
