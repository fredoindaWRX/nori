export function packagedConversationOptions(args) {
  const result = {}
  for (const argument of args) {
    if (argument === '--verify-corrupt-resume') {
      if (result.verifyCorruptResume) throw Error('Duplicate corruption probe flag')
      result.verifyCorruptResume = true
      continue
    }
    const match = /^--(candidate|selected-consolidated-fixture)=(.+)$/.exec(argument)
    if (!match) throw Error('Unexpected packaged conversation option')
    const key = match[1] === 'candidate' ? 'candidate' : 'fixtureName'
    if (result[key] !== undefined) throw Error('Duplicate packaged conversation option')
    const valid = key === 'candidate' ? /^[a-z0-9][a-z0-9-]{0,63}$/ : /^\.native-browser-migration-packaged-[A-Za-z0-9_-]+$/
    if (!valid.test(match[2])) throw Error('Unsafe packaged conversation option')
    result[key] = match[2]
  }
  if ((result.candidate || result.verifyCorruptResume) && !result.fixtureName) throw Error('Explicit generated synthetic fixture required')
  return result
}
