// The clock's headset text (core 1.24's VR HUD band draws a module kind through `vrText`).
import { statsText } from '../src/menu.js';

export function run(check) {
	const play = statsText({ ms: 83000, best: 61000 }, 'play');
	check(play.includes('1:23') && play.includes('1:01') && /best/.test(play), 'the playing clock reads the time and the best (' + play + ')');
	const done = statsText({ ms: 59000, best: 59000, newBest: true }, 'result');
	check(/^Time 0:59/.test(done) && /NEW BEST$/.test(done), 'the result line says a new best (' + done + ')');
	check(!/NEW BEST/.test(statsText({ ms: 70000, best: 59000 }, 'result')), 'no new best, no claim');
}
