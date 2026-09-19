// emit waves.def.json beside the module — the orchestrator's input for the scenes def
// (run by `npm run build:waves`)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wavesDef } from './src/def.js';

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'waves.def.json'), JSON.stringify(wavesDef(), null, '\t') + '\n');
console.log('waves.def.json written');
