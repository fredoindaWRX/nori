import type { SpatialNode } from './spatial-contract'

/** Candidates are catalog metadata only; listing never implies local installation or activation. */
export const MODEL_CATALOG_CANDIDATES: readonly SpatialNode[] = Object.freeze([
  Object.freeze({
    id: 'model-candidate-qwen36', kind: 'model', title: 'Qwen3.6-35B-A3B',
    status: 'CANDIDATE · NOT LOADED', room: 'MODELS', x: .22, y: .74, z: 0,
    detail: 'Selectable catalog candidate only. The official Qwen model card describes 35B total parameters, 3B active, multimodal input, and 73.4 SWE-bench Verified. Nori has no qualified Qwen runtime adapter or installed weights; local memory fit, speed, and task/tool qualification are unverified. Screenshot hardware estimates are not measurements on this PC.',
    sourceId: 'https://huggingface.co/Qwen/Qwen3.6-35B-A3B', origin: 'nori_live',
  }),
])
