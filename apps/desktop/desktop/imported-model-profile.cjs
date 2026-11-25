// Explicit profiles only: callers cannot supply executable paths or model paths.
const profiles = Object.freeze({
  'qwen3.5-9b': Object.freeze({
    id: 'qwen3.5-9b', label: 'Huihui Qwen3.5 9B abliterated',
    variant: 'abliterated',
    repository: 'mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF',
    revision: '419ca34f424adbd9276c09e0271cb6b718e8da1d',
    kvCacheMode: 'gpu-q8', minimumFreeVramMiB: 11264,
    modelStoreRoot: 'C:/Nori',
    relativePath: 'models/language/huihui-qwen3.5-9b-mradermacher-419ca34f/Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf',
    bytes: 5627045248,
    sha256: 'ea1858ef4dc4b648b8dbb44612962a0333e945060dd0545ac0f28d7c4416e4b3',
    verifyHashAtStartup: true,
    visionProjector: Object.freeze({
      relativePath: 'models/vision/huihui-qwen3.5-9b-projector-419ca34f/Huihui-Qwen3.5-9B-abliterated.mmproj-Q8_0.gguf',
      bytes: 624229760,
      sha256: 'cf54897b6bbfa89c809fdc2b8236e0977bed70760b39ee8f11d87296e1d0e046',
      revision: '419ca34f424adbd9276c09e0271cb6b718e8da1d',
    }),
    // Measured 2026-11-02 with the projector and q8_0 KV: 196608 tokens peak 13.5 GB of
    // 16 GB with ~2.9 GB used by other apps; far-recall at 163K tokens passed.
    minimumFreeVramMiB: 11264,
    gpuLayers: 99, defaultContext: 196608,
    // When other apps hold the GPU, start at 64K (~7.6 GB measured) instead of not starting.
    fallbackContexts: Object.freeze([Object.freeze({ context: 65536, minimumFreeVramMiB: 8448 })]),
  }),
  // Owner, 2026-11-17 ("make sure its qwen 3.5-9b obliterated and qwen3-14", then "i want them both
  // abliterated"): the Huihui abliterated Qwen3 14B, downloaded with his approval. R106/R107 used the plain
  // Qwen3 14B from his Ollama store under this same profile id. Native context is 32,768, so the profile
  // carries its own context floor (minimumContext); prompts that do not fit go to the 9B. Text only, no
  // projector: vision stays on the 9B. The memory figures below were measured on the plain build of the same
  // size and quantisation.
  // Measured 2026-11-17 on Nori's own server, 32K, q8_0 KV, flash attention: 12.0-12.3 GiB above idle, tool call
  // correct. Speed was not measured cleanly (another copy was generating on the same card). The floor leaves
  // about 1 GiB of margin, so under OBS (about 12.9 GiB free) it does not load and the 9B answers.
  'qwen3-14b': Object.freeze({
    id: 'qwen3-14b', label: 'Huihui Qwen3 14B abliterated',
    variant: 'abliterated',
    repository: 'mradermacher/Huihui-Qwen3-14B-abliterated-v2-GGUF',
    revision: 'daac977bbc287a398b4e46e190149142bb46c184',
    modelStoreRoot: 'C:/Nori',
    relativePath: 'models/language/huihui-qwen3-14b-abliterated-v2-mradermacher-daac977b/Huihui-Qwen3-14B-abliterated-v2.Q4_K_M.gguf',
    bytes: 9001749792,
    sha256: '66effa781874858e2d2efefa8d6d1d5b7c16f808fe018fe67c57f9014c18668f',
    // This GGUF has no chat template inside it. Without one the server falls back to a generic format: thinking
    // cannot be switched off (it leaked into every answer) and tool calls are not produced (seen live on R108).
    // The official Qwen3 template, byte for byte the one inside the plain Qwen3 14B GGUF, sits beside the model.
    // Tested 2026-11-17 with it: clean answers, a correct tool call, no refusal, about 46 tokens/s.
    chatTemplate: Object.freeze({
      relativePath: 'models/language/huihui-qwen3-14b-abliterated-v2-mradermacher-daac977b/qwen3-chat-template.jinja',
      bytes: 4614,
      sha256: '5595e8741bb5500f9d395e05a0aefe6ca1e8d54c5dd8b98bcf7760d895fdc6e6',
    }),
    kvCacheMode: 'gpu-q8', gpuLayers: 99, loadMode: 'none',
    minimumFreeVramMiB: 13312,
    defaultContext: 32768, minimumContext: 32768,
  }),
  'qwen3.6-35b': Object.freeze({
    id: 'qwen3.6-35b', label: 'Huihui Qwen3.6 35B-A3B abliterated',
    variant: 'abliterated',
    repository: 'huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated-MTP-GGUF',
    revision: 'acd5abe0c5ebd064f3863ca7d4bba2d924ec6544',
    modelStoreRoot: 'C:/Nori',
    relativePath: 'models/language/huihui-qwen3.6-35b-a3b-abliterated-acd5abe0/Huihui-Qwen3.6-35B-A3B-abliterated-ggml-model-Q4_K.gguf',
    bytes: 21712409824,
    sha256: '63b75afb4b68fc61059c78115b580037074de88146e0762f4a496081e410cf81',
    visionProjector: Object.freeze({
      relativePath: 'models/vision/huihui-qwen3.6-35b-a3b-projector-acd5abe0/mmproj-model-f16.gguf',
      bytes: 899283104,
      sha256: '41578def81dbfd5c193f3b4633f9ab45e3c85f116442d6b2025464082f201d6d',
      revision: 'acd5abe0c5ebd064f3863ca7d4bba2d924ec6544',
    }),
    // MoE (~3B active). Measured 2026-11-04 on the 16 GiB card: 20 expert layers on the CPU, 64K
    // q8_0 KV: ~12.8 GiB GPU above idle, 28-32 tok/s, 75/87 on the live suite (9B: 71/87). Packing
    // more experts onto the GPU spilled into shared memory (1-3 tok/s). Other experts stay in RAM.
    kvCacheMode: 'gpu-q8', gpuLayers: 99, cpuMoeLayers: 20,
    minimumFreeVramMiB: 13312, minimumFreeRamMiB: 10240,
    defaultContext: 65536,
  }),
  'qwen3-24b-freedom': Object.freeze({
    id: 'qwen3-24b-freedom', label: 'DavidAU Qwen3 24B-A4B Freedom abliterated',
    variant: 'abliterated',
    repository: 'DavidAU/Qwen3-24B-A4B-Freedom-HQ-Thinking-Abliterated-Heretic-NeoMAX-Imatrix-GGUF',
    revision: '66f510f36a6c165c055972dac02e295decb6c39c',
    modelStoreRoot: 'C:/Nori',
    relativePath: 'models/language/qwen3-24b-a4b-freedom-davidau-66f510f3/Qwen3-24B-A4B-Freedom-HQ-Thinking-Abliterated-Heretic-NeoMAX-D_AU-Q5_K_M-imat.gguf',
    bytes: 13161152384,
    sha256: 'b0ffca77d80e2679549eaee4673c5b9fc3a27eda5632c9a76f8a849bb3507b10',
    // Text-only middle tier (no vision projector). Live suite 2026-11-07: 94/100 (35B 96, 9B 84-85),
    // tool calls 17/18 (35B 18/18). Fully on the GPU at 32K it needs ~14.8 GiB, more than the card
    // has beside the desktop, so 6 expert layers stay on the CPU:
    // 13.1 GiB GPU above idle after a 20K-token prompt, 37-42 tok/s. Default mmap loading kept the
    // whole file resident (12.5 GB RAM); load mode 'none' reads it once and leaves ~2.7 GB in RAM.
    kvCacheMode: 'gpu-q8', gpuLayers: 99, cpuMoeLayers: 6, ubatchSize: 128, loadMode: 'none',
    // Its template has no thinking switch and the fine-tune always reasons; capping thinking at 256
    // tokens scored 92/100 at 4.9 s/answer vs 88/100 at 5.4 s uncapped (same settings, 2026-11-07).
    reasoningBudget: 256,
    minimumFreeVramMiB: 13824, minimumFreeRamMiB: 4096,
    defaultContext: 32768,
    // Measured standalone 2026-11-07 (idle card, 3.8K prompt): 32K needs 13.3 GiB; 16K with the same
    // 6 CPU expert layers needs 12.1 GiB at the same 36 tok/s (10 CPU layers at 32K also 12.1 GiB but
    // 26 tok/s). OBS plus the desktop leave about 12.9 GiB, so stream mode can use the 16K context.
    fallbackContexts: Object.freeze([Object.freeze({ context: 16384, minimumFreeVramMiB: 12600 })]),
  }),
  'gpt-oss-20b': Object.freeze({
    id: 'gpt-oss-20b', label: 'GPT-OSS 20B',
    relativePath: 'models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf',
    gpuLayers: 8, defaultContext: 78000,
  }),
  'qwen3.8-27b': Object.freeze({
    id: 'qwen3.8-27b', label: 'Qwen3.8 27B',
    // Measured 2026-11-02 on the owner's 16 GiB card: 32K with q8_0 KV fully on the GPU
    // peaks ~11.8 GiB above idle and writes ~33 tok/s (CPU KV at 64K wrote 3-6 tok/s;
    // GPU KV at 64K spilled to shared memory). Longer prompts route to the 9B.
    kvCacheMode: 'gpu-q8', minimumFreeVramMiB: 12100,
    relativePath: 'models/language/qwen3.8-27b-bartowski-87410e7b/Qwen3.8-27B-Q3_K_M.gguf',
    bytes: 13404051168,
    sha256: '14865aaef0b6c26a013538782d366443c7298b11d5df9f0fb829d34d1963f869',
    gpuLayers: 99, defaultContext: 32768,
  }),
})
function importedModelProfile(id = 'gpt-oss-20b') {
  if (typeof id !== 'string' || !Object.hasOwn(profiles, id)) throw new Error('Unsupported imported model profile')
  return profiles[id]
}
function desktopImportedModelProfile({packaged = false, args = []} = {}) {
  const everyday = args.includes('--nori-qwen35-9b')
  const qwen = args.includes('--nori-qwen38')
  const previous = args.includes('--nori-gpt-oss') || args.includes('--nori-gpt-oss-heretic')
  if (Number(everyday) + Number(qwen) + Number(previous) + Number(args.includes('--nori-norllama')) > 1) throw new Error('Select only one imported model profile')
  return importedModelProfile(previous ? 'gpt-oss-20b' : qwen ? 'qwen3.8-27b' : everyday || packaged ? 'qwen3.5-9b' : 'gpt-oss-20b')
}
module.exports = { importedModelProfile, desktopImportedModelProfile }
