import { NEURAL_REGIONS } from './neural-activity.ts'

// Functional architecture analogies, not biological equivalence or live model telemetry.
export const NEURAL_FUNCTIONAL_MAP: Record<typeof NEURAL_REGIONS[number], string> = {
  language:'Language networks',
  project:'Semantic knowledge networks',
  memory:'Memory formation and retrieval',
  voice:'Speech production',
  vision:'Visual processing',
  tools:'Action selection and execution',
  connections:'Communication between brain systems',
  auditory:'Auditory processing',
  planning:'Executive planning',
  protection:'Inhibitory and protective control',
  spatial:'Spatial processing',
  lifecycle:'Vital runtime regulation',
  working_memory:'Active working memory',
}

export const NEURAL_REGION_INFO: Record<typeof NEURAL_REGIONS[number], {label:string; description:string}> = {
  language:{label:'Language',description:'Reply generation and received response text. This does not expose private thoughts or learned neuron activations.'},
  project:{label:'Project',description:'Observed file, code, and workspace tool announcements. An announcement does not establish successful completion.'},
  memory:{label:'Memory',description:'Observed memory operations, locally saved preferences and corrections, or a named memory tool. Merovingian retrieval is not connected to this view yet.'},
  voice:{label:'Speech output',description:'The interface reports that Nori is speaking.'},
  vision:{label:'Vision',description:'Reported screen inspection or a named visual tool. Enabled camera settings alone do not activate this region.'},
  tools:{label:'Actions',description:'A tool is announced or reported active. This does not establish that the action succeeded.'},
  connections:{label:'Signal routing',description:'Accepted activity arriving through the local bridge. Connection availability alone is not activity.'},
  auditory:{label:'Hearing',description:'The interface is listening with its microphone unmuted.'},
  planning:{label:'Planning',description:'Observed planning starts and outcomes, or a named planning tool. A pulse does not establish that a plan succeeded. Native planning execution is still awaiting qualification.'},
  protection:{label:'Protection',description:'Observed write authorization decisions or a named safety tool. Permission does not establish successful execution.'},
  spatial:{label:'Spatial awareness',description:'A named location or spatial-processing tool. No world map is inferred from decorative motion.'},
  lifecycle:{label:'Runtime lifecycle',description:'Interface startup or waking state. This does not establish model readiness.'},
  working_memory:{label:'Working context',description:'Observed context updates and workspace or reference context assembled for a reply. This represents active context, not private thoughts. No conversation contents appear in this card.'},
}

export function neuralRegionAtPoint(regions:readonly number[], index:unknown) {
  if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=regions.length)return null
  return NEURAL_REGIONS[regions[index]] ?? null
}
