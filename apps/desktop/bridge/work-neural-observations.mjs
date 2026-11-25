/** Polling metadata only; task ownership is independent of human-facing messages. */
import { createNeuralEventLedger } from './neural-event-contract.mjs'
export function createWorkNeuralObservations(taskId) {
  if(typeof taskId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(taskId)) throw new TypeError('Invalid work task identity')
  const ledger=createNeuralEventLedger('work-snapshot')
  return Object.freeze({
    collect(snapshot) {
      if(!snapshot||snapshot.task_id!==taskId||!Array.isArray(snapshot.neural_events)||snapshot.neural_events.length>512)return []
      const accepted=[]
      for(const raw of snapshot.neural_events) {
        if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype)continue
        const descriptors=Object.getOwnPropertyDescriptors(raw)
        if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||key==='ask'||!Object.hasOwn(descriptors[key],'value')))continue
        const event=Object.fromEntries(Object.entries(descriptors).map(([key,descriptor])=>[key,descriptor.value]))
        if(ledger.accept({...event,ask:'work-snapshot'}))accepted.push(event)
      }
      return accepted
    },
    close() { ledger.close() },
  })
}
