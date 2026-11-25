// The host owns the active model selection. Never infer a different backend
// from an unfamiliar checkpoint name or silently accept a stale saved choice.
export function importedChatSelection(environment = process.env) {
  const model = environment.NORI_GPT_OSS_SERVER_MODEL === undefined
    ? 'gpt-oss-20b' : environment.NORI_GPT_OSS_SERVER_MODEL
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(model)) {
    throw new Error('Invalid imported local model identifier')
  }
  if (model === 'gpt-oss-20b') return 'gpt-oss:20b'
  if (model === 'qwen3.8-27b') return 'qwen3.8:27b'
  return model
}

export function migrateImportedChatSelection(selection, environment = process.env) {
  const active = importedChatSelection(environment)
  if (!selection || selection === 'nori-auto') return active
  if (active === 'nori-auto' && ['qwen3.5-9b','qwen3.8:27b','gpt-oss:20b'].includes(selection)) return active
  // Preserve only the previously owner-requested GPT-OSS -> Qwen migration.
  if (active === 'qwen3.8:27b' && selection === 'gpt-oss:20b') return active
  if ((active === 'qwen3.5-9b' && ['qwen3.8:27b', 'gpt-oss:20b'].includes(selection))
    || (active === 'qwen3.8:27b' && selection === 'qwen3.5-9b')) return active
  if (selection !== active) throw new Error('Saved model selection does not match the active local model')
  return active
}

export function importedChatLabel(environment = process.env) {
  const selection = importedChatSelection(environment)
  if (selection === 'nori-auto') return 'Nori automatic local models'
  if (selection === 'qwen3.8:27b') return 'Qwen3.8 27B'
  if (selection === 'gpt-oss:20b') return 'GPT-OSS 20B'
  if (selection === 'qwen3.5-9b') return 'Qwen3.5 9B'
  return selection
}
