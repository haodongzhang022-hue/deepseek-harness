// Decisive validation: run the ACTUAL installed lib against the ACTUAL settings.yaml
// to find the first provider/model that makes assertServiceable / resolveProfiles throw.
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { Config, resolveProfiles } from './lib/types/config.js'
import { catalogProviderIds } from './lib/types/catalog.js'

const doc = load(readFileSync('E:/1shuju/dsh-home/settings.yaml', 'utf8'))
const providers = doc?.['llm-pi-ai']?.providers
console.log('=== provider routes in settings.yaml ===')
console.log(Object.keys(providers ?? {}))

console.log('\n=== installed catalog provider ids (from lib via pi-ai) ===')
try {
  console.log(catalogProviderIds())
} catch (e) {
  console.log('catalogProviderIds THREW:', e.message)
}

console.log('\n=== 1) WHOLE section through Config.parse (zod) ===')
try {
  const parsed = Config.parse({ providers })
  console.log('PASS whole-section parse. route count =', Object.keys(parsed.providers).length)
} catch (e) {
  console.log('FAIL whole-section parse:', e.issues ? JSON.stringify(e.issues, null, 2) : e.message)
}

console.log('\n=== 2) per-provider resolveProfiles ===')
for (const [name, profile] of Object.entries(providers ?? {})) {
  try {
    const resolved = resolveProfiles({ [name]: profile })
    const entry = resolved.get(name)
    console.log('OK  ', name, '| piProvider ok=', !!entry?.piProvider, '| models=', entry?.models?.length ?? entry?.piProvider?.models?.length ?? '?')
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
  }
}

console.log('\n=== 3) whole providers through resolveProfiles (equivalent to assertServiceable) ===')
try {
  const resolved = resolveProfiles(providers)
  console.log('PASS whole resolve. routes =', [...resolved.keys()])
} catch (e) {
  console.log('FAIL whole resolve:', e.message)
}