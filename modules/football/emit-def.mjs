// emit football.def.json beside the module — the orchestrator's input for the scenes
// def (run by `npm run build:football`)
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { footballDef } from './src/def.js';

const here = dirname(fileURLToPath(import.meta.url));
// 36 (U10): the def's Main graph carries the RULES behaviour — the file beside the source
const rulesCode = readFileSync(join(here, 'src', 'football.rules.js'), 'utf8');
writeFileSync(join(here, 'football.def.json'), JSON.stringify(footballDef({ rulesCode }), null, '\t') + '\n');
console.log('football.def.json written');
