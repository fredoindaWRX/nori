export function encodeNeuraleseSpeech(text: string): Promise<{
  frame: {
    schema: 'nori.neuralese.speech-transcription.v1'
    opcode: number
    status: 'transcribed' | 'empty'
    payload_cell: 'human_boundary.transcript'
    payload_sha256: string
    provenance: 'local_stt_untrusted_input'
    confidence: null
    timing: null
    execution_authorized: false
    frame_sha256: string
  }
  payload: string
}>

export function decodeNeuraleseSpeech(envelope: unknown): Promise<string>
