// emit dungeon-realms.def.json beside the module — the orchestrator's input for the scenes
// def (run by `npm run build:dungeon-realms`). The entrance arch is placed at the entrance
// room the SEED produces, computed here with the Kit's own generator (node-side only: the
// module entry never imports across modules; this emitter is a build step).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCampaign } from '../dungeon/src/gen/campaign.js';
import { playPayload } from '../dungeon/src/contract.js';
import { realmsDef, RECIPE } from './src/def.js';

const here = dirname(fileURLToPath(import.meta.url));
const { seed, apply, ...params } = RECIPE;
const play = playPayload(generateCampaign(seed, params), 1);
const entrance = play.rooms[0];
const def = realmsDef({ x: Math.round(entrance.cx * 100) / 100, z: Math.round(entrance.cz * 100) / 100 });
writeFileSync(join(here, 'dungeon-realms.def.json'), JSON.stringify(def, null, '\t') + '\n');
console.log('dungeon-realms.def.json written — entrance at', entrance.cx, entrance.cz, '(' + play.name + ', ' + play.rooms.length + ' rooms, floor checksum ' + play.checksum + ')');
