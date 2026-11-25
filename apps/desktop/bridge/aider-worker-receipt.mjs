/**
 * Bind interpretation of a foreground Aider completion to the model selected by
 * the host for that invocation. Callers must construct this before dispatch;
 * neither model output nor a later process.env lookup is an expected identity.
 * This verifies completion metadata only. It grants no execution or file scope.
 */
export function createAiderWorkerReceiptValidator(expectedModel) {
  if (!expectedModel || typeof expectedModel !== 'object' || Array.isArray(expectedModel)
      || typeof expectedModel.id !== 'string' || !/^openai\/[A-Za-z0-9._:-]{1,128}$/.test(expectedModel.id)
      || typeof expectedModel.label !== 'string' || !expectedModel.label.trim()
      || expectedModel.label.length > 160 || /[\u0000-\u001f\u007f]/.test(expectedModel.label)) {
    throw new TypeError('Host-bound local Aider model identity is required')
  }
  const modelId = expectedModel.id
  const modelLabel = expectedModel.label
  return function validateAiderWorkerReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || receipt.outcome !== 'completed' || receipt.worker !== 'aider-local'
        || receipt.model !== modelLabel || receipt.tests !== 'not run by Aider'
        || receipt.external_services !== false || !Array.isArray(receipt.changed_files)
        || receipt.changed_files.length < 1 || receipt.changed_files.length > 24
        || receipt.changed_files.some(file => typeof file !== 'string' || !file.trim()
          || file.length > 240 || /[\u0000-\u001f\u007f]/.test(file))) {
      throw new Error('Aider did not return a completed receipt for the host-bound local model')
    }
    return Object.freeze({
      modelId, modelLabel,
      changedFiles: Object.freeze([...receipt.changed_files]),
      tests: 'not run by Aider', externalServices: false,
    })
  }
}
