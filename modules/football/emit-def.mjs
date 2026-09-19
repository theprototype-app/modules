// emit football.def.json beside the module — the orchestrator's input for the scenes
// def (run by `npm run build:football`)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { footballDef } from './src/def.js';

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'football.def.json'), JSON.stringify(footballDef(), null, '\t') + '\n');
console.log('football.def.json written');
