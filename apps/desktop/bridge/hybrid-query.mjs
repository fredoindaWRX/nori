/** Historical filename retained for compatibility: this route is native-only. */
import { query as nativeQuery } from './nori-v2-query.mjs'

export function bindNativeQuery(implementation) {
  return ({ prompt, options = {} }) => {
    const { legacyToolsAvailable: _legacy, ...localOptions } = options
    return implementation({ prompt, options: localOptions })
  }
}

// Images, chat, controls, streaming and cancellation all stay with Nori.
export const query = bindNativeQuery(nativeQuery)
