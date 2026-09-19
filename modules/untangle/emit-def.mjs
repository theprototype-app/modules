// emit untangle.def.json beside the module — the orchestrator's input for the scenes def
// (run by `npm run build:untangle`)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { untangleDef } from './src/def.js';

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'untangle.def.json'), JSON.stringify(untangleDef(), null, '\t') + '\n');
console.log('untangle.def.json written');
