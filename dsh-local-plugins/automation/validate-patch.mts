import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

const doc = yaml.load(readFileSync('E:/1shuju/dsh-home/profiles/web/cordis.patch.yml', 'utf8')) as Array<Record<string, unknown>>
const entries = Array.isArray(doc) ? doc : [doc]
const inserts = entries.flatMap(e => (e?.insert ?? []) as Array<Record<string, unknown>>)
const sched = inserts.find(i => i?.id === 'automation-scheduler') as { config: Record<string, unknown> } | undefined
console.log('patch entries:', String(entries.length))
if (sched === undefined) { console.log('scheduler entry MISSING'); process.exit(1) }
const bus = sched.config.bus as Record<string, string>
console.log('bus keys:', Object.keys(bus).join(','))
console.log('jobs:', JSON.stringify(sched.config.jobs))
