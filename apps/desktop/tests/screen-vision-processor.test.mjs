import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ScreenVisionProcessor,
  registerScreenVisionProcessor,
} from '../src/lib/screenVisionProcessor.ts'
import {
  VisionClient,
  VisionProcessorCoordinator,
  getGroundedVisionContext,
  canMakeVisualClaim,
} from '../src/lib/vision.ts'

const frameData = 'aGVsbG8='
const sample = (patch = {}) => ({
  id: 'vision-frame-7',
  source: 'screen',
  timestamp: Date.now() - 100,
  width: 4,
  height: 3,
  payload: {
    width: 4,
    height: 3,
    toDataURL(type, quality) {
      assert.equal(type, 'image/jpeg')
      assert.equal(quality, 0.78)
      return `data:image/jpeg;base64,${frameData}`
    },
  },
  ...patch,
})
const makeResponse = (capturedSample, findings, patch = {}) => ({
  schemaVersion: 1,
  requestId: 'rpc-1',
  sampleId: capturedSample.id,
  source: 'screen',
  capturedAt: capturedSample.timestamp,
  observedAt: Date.now(),
  status: findings.length ? 'ok' : 'no_findings',
  findings,
  backendId: 'ollama-json-screen-v1',
  modelId: 'vision-test',
  ...patch,
})
const capability = {
  available: true,
  backendId: 'ollama-json-screen-v1',
  modelId: 'vision-test',
  imageCapable: true,
  structuredOutput: true,
}
const createProcessor = (response, overrides = {}) => {
  const processor = new ScreenVisionProcessor({
    getCapability: async () => capability,
    perceive: async (input) => {
      assert.equal(input.sampleId, 'vision-frame-7')
      assert.equal(input.capturedAt, sampleValue.timestamp)
      assert.deepEqual(input.frame, { data: frameData, mimeType: 'image/jpeg' })
      return response
    },
    ...overrides,
  })
  processor.setCapability(capability)
  return processor
}
const sampleValue = sample()
const success = (response) => ({ ok: true, response })

test('explicit Windows OCR produces text-only observations without a model identity', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'visible_text', value: 'NORI LOCAL SCREEN TEST' },
  ], { backendId: 'nori-windows-ocr-v1', modelId: undefined })))
  processor.setCapability({ ...capability, backendId: 'nori-windows-ocr-v1', modelId: null })
  assert.equal(processor.metadata.availability, 'available')
  assert.equal(processor.metadata.name, 'Screen text recognition (Windows OCR)')
  const [observation] = await processor.process(sampleValue)
  assert.equal(observation.type, 'text_observation')
  assert.equal(observation.metadata.backendId, 'nori-windows-ocr-v1')
  assert.equal('modelId' in observation.metadata, false)
})

test('a different backend cannot silently substitute for selected screen text recognition', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [{ kind: 'application', value: 'Editor' }])))
  processor.setCapability({ ...capability, backendId: 'nori-windows-ocr-v1', modelId: null })
  await assert.rejects(processor.process(sampleValue), /screen_backend_mismatch/)
  processor.setCapability({ ...capability, backendId: 'nori-windows-ocr-v1', modelId: 'invented' })
  assert.equal(processor.metadata.availability, 'unavailable')
})

test('maps a validated application finding to a screen_observation', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'application', value: 'Visual Studio Code' },
  ])))
  const [observation] = await processor.process(sampleValue)
  assert.equal(observation.type, 'screen_observation')
  assert.equal(observation.source, 'screen')
  assert.equal(observation.summary, 'Visible application: Visual Studio Code')
})

test('maps visible text to a text_observation', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'visible_text', value: 'Build succeeded' },
  ])))
  const [observation] = await processor.process(sampleValue)
  assert.equal(observation.type, 'text_observation')
  assert.equal(observation.summary, 'Visible screen text: "Build succeeded"')
})

test('processes an explicitly captured encoded local display frame', async () => {
  const originalImage = globalThis.Image
  const originalDocument = globalThis.document
  globalThis.Image = class {
    naturalWidth = 4
    naturalHeight = 3
    set src(value) {
      assert.match(value, /^data:image\/jpeg;base64,aGVsbG8=$/)
      this.onload()
    }
  }
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas')
      return {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d')
          return { drawImage() {} }
        },
        toDataURL() { return `data:image/jpeg;base64,${frameData}` },
      }
    },
  }
  try {
    const timestamp = Date.now() - 100
    const processor = new ScreenVisionProcessor({
      getCapability: async () => capability,
      perceive: async (input) => {
        assert.equal(input.sampleId, 'turn-frame-1')
        assert.equal(input.capturedAt, timestamp)
        assert.deepEqual(input.frame, { data: frameData, mimeType: 'image/jpeg' })
        return success(makeResponse(sampleValue, [
          { kind: 'visible_text', value: 'ChatGPT is open' },
        ], { sampleId: input.sampleId, capturedAt: input.capturedAt }))
      },
    })
    processor.setCapability(capability)
    const observations = await processor.processEncodedFrame({
      id: 'turn-frame-1',
      timestamp,
      frame: { data: frameData, mimeType: 'image/jpeg' },
    })
    assert.equal(observations[0].type, 'text_observation')
    assert.equal(observations[0].summary, 'Visible screen text: "ChatGPT is open"')
  } finally {
    if (originalImage === undefined) delete globalThis.Image
    else globalThis.Image = originalImage
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

test('returns bounded multiple observations and deduplicates exact duplicate findings', async () => {
  const findings = Array.from({ length: 23 }, (_, index) => ({
    kind: index === 0 ? 'application' : 'ui_element',
    value: index === 0 ? 'Editor' : `Button ${index}`,
  }))
  findings.push({ kind: 'application', value: 'Editor' })
  const processor = createProcessor(success(makeResponse(sampleValue, findings)))
  const observations = await processor.process(sampleValue)
  assert.equal(observations.length, 23)
  assert.equal(observations[0].type, 'screen_observation')
  assert.equal(observations[22].summary, 'Visible UI element: Button 22')
})

test('valid no_findings result returns no observations without failing', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [])))
  assert.deepEqual(await processor.process(sampleValue), [])
  const client = new VisionClient()
  client.setEnabled(true)
  const coordinator = new VisionProcessorCoordinator(client)
  coordinator.registerProcessor(processor)
  const result = await coordinator.processSample(sampleValue)
  assert.deepEqual(result.observations, [])
  assert.deepEqual(result.processorsFailed, [])
})

test('backend timeout fails closed with no trusted observation', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [])), {
    perceive: async () => ({ ok: false, error: { code: 'perception_timeout' } }),
  })
  await assert.rejects(processor.process(sampleValue), /perception_timeout/)
})

test('malformed backend response is rejected and coordinator reports processor failure', async () => {
  const processor = createProcessor({ ok: true, response: 'ALERT: a window is open' })
  const client = new VisionClient()
  client.setEnabled(true)
  const coordinator = new VisionProcessorCoordinator(client)
  coordinator.registerProcessor(processor)
  const result = await coordinator.processSample(sampleValue)
  assert.deepEqual(result.observations, [])
  assert.equal(result.processorsFailed.length, 1)
  assert.equal(result.processorsFailed[0].processorId, processor.metadata.id)
})

test('sampleId mismatch produces no trusted observations', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'application', value: 'Editor' },
  ], { sampleId: 'another-sample' })))
  await assert.rejects(processor.process(sampleValue), /sample_id_mismatch/)
})

test('wrong response source produces no trusted observations', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'application', value: 'Editor' },
  ], { source: 'camera' })))
  await assert.rejects(processor.process(sampleValue), /invalid_source/)
})

test('invalid response timestamp produces no trusted observations', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'application', value: 'Editor' },
  ], { observedAt: sampleValue.timestamp - 1 })))
  await assert.rejects(processor.process(sampleValue), /invalid_timestamp/)
})

test('native image-unsupported capability keeps the processor unavailable and fails closed', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [])))
  processor.setCapability({
    available: false,
    backendId: 'norllama',
    modelId: null,
    imageCapable: false,
    structuredOutput: false,
    errorCode: 'image_unsupported',
  })
  assert.equal(processor.metadata.availability, 'unavailable')
  await assert.rejects(processor.process(sampleValue), /screen_backend_unavailable/)
})

test('Vision model without verified structured-output support remains unavailable', () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [])))
  processor.setCapability({
    ...capability,
    structuredOutput: false,
    errorCode: 'schema_unsupported',
  })
  assert.equal(processor.metadata.availability, 'unavailable')
})

test('confidence remains absent when the backend did not return it', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'window', value: 'Settings' },
  ])))
  const [observation] = await processor.process(sampleValue)
  assert.equal(Object.hasOwn(observation, 'confidence'), false)
})

test('uses the known configured model id when the response omits it', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'window', value: 'Settings' },
  ], { modelId: undefined })))
  const [observation] = await processor.process(sampleValue)
  assert.equal(observation.metadata.modelId, 'vision-test')
})

test('preserves only a validated backend confidence value', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'application', value: 'Editor', confidence: 0.82 },
  ])))
  const [observation] = await processor.process(sampleValue)
  assert.equal(observation.confidence, 0.82)
})

test('normalized observations contain provenance but never raw image data', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'visible_text', value: 'Ready' },
  ])))
  const [observation] = await processor.process(sampleValue)
  assert.equal(observation.metadata.sampleId, sampleValue.id)
  assert.equal(observation.metadata.processorId, processor.metadata.id)
  assert.equal(observation.metadata.backendId, 'ollama-json-screen-v1')
  assert.equal(observation.metadata.findingKind, 'visible_text')
  assert.equal(JSON.stringify(observation).includes(frameData), false)
  assert.equal(JSON.stringify(observation).includes('toDataURL'), false)
})

test('legacy ALERT prose is not accepted as a structured response', async () => {
  const processor = createProcessor(success('ALERT: Visual Studio Code is open'))
  await assert.rejects(processor.process(sampleValue), /invalid_response/)
})

test('rejects camera samples, invalid sample timestamps, and malformed dimensions', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [])))
  await assert.rejects(processor.process(sample({ source: 'camera' })), /invalid_screen_source/)
  await assert.rejects(processor.process(sample({ timestamp: Number.NaN })), /invalid_sample_timestamp/)
  await assert.rejects(processor.process(sample({ width: 0 })), /invalid_sample_dimensions/)
})

test('registered processor is run by the existing coordinator and duplicate registration is harmless', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'application', value: 'Editor' },
  ])))
  const client = new VisionClient()
  client.setEnabled(true)
  const coordinator = new VisionProcessorCoordinator(client)
  const unregister = registerScreenVisionProcessor(processor, coordinator)
  const duplicateUnregister = registerScreenVisionProcessor(processor, coordinator)
  const result = await coordinator.processSample(sampleValue)
  assert.equal(result.processorsAttempted, 1)
  assert.equal(result.observations.length, 1)
  duplicateUnregister()
  assert.equal(coordinator.getProcessors().length, 1)
  unregister()
  assert.equal(coordinator.getProcessors().length, 0)
})

test('screen evidence grounds only corresponding fresh screen questions', async () => {
  const processor = createProcessor(success(makeResponse(sampleValue, [
    { kind: 'application', value: 'Visual Studio Code' },
  ])))
  const [observation] = await processor.process(sampleValue)
  const screenContext = getGroundedVisionContext('What application is visible on the screen?', {
    enabled: true,
    observations: [observation],
  })
  const clothingContext = getGroundedVisionContext('What color shirt am I wearing?', {
    enabled: true,
    observations: [observation],
  })
  assert.equal(canMakeVisualClaim(screenContext), true)
  assert.equal(canMakeVisualClaim(clothingContext), false)
})
