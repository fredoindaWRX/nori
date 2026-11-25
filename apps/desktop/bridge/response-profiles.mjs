/** These tune answer style, not a provider's private reasoning budget. */
export const RESPONSE_PROFILES = ['lightning-fast', 'balanced', 'deep', 'adult-companion']
export const RESPONSE_INSTRUCTIONS = {
  'lightning-fast': 'Answer directly in a few short sentences. Focus on the requested result; expand when asked. Preserve relevant conversation context.',
  balanced: 'Give a clear answer with enough useful context and the most relevant next step. Match detail to the question and preserve conversation context.',
  deep: 'Examine relevant assumptions, alternatives, and tradeoffs before giving a thorough, structured answer. Explain the conclusion and evidence; preserve conversation context.',
  'adult-companion': 'Optional adult companion style, enabled only by the user selecting it and confirming they are 18+ (self-attestation, not age verification). Be warm, affectionate, and flirtatious when invited; discuss adult intimacy or fictional consensual adult roleplay respectfully. Keep every participant clearly 18+ and consenting. Do not sexualize minors or age-ambiguous people, facilitate coercion or exploitation, or impersonate a real person sexually. Respect requests to stop or change tone immediately. This changes conversation style only: it grants no device, camera, microphone, network, or other tool access and does not change Nori’s existing safety, approval, or action rules. Do not claim to be the user’s real partner.',
}
export function responseProfile(value, fallback = 'lightning-fast') {
  return RESPONSE_PROFILES.includes(value) ? value : fallback
}
export function currentResponseProfile(options) {
  return responseProfile(options.getResponseProfile?.() ?? options.responseProfile)
}
export function legacyEffort(profile) {
  return { 'lightning-fast': 'low', balanced: 'medium', deep: 'high', 'adult-companion': 'medium' }[responseProfile(profile)]
}
