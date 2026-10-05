// DUNGEON REALMS — THE RULES. How many gems unseal a floor's portal, and when the party
// travels up through it. Edit anything here and press Ctrl+S: the next floor (or the next
// adventure) plays under your rules on every player's screen.
//
// How it plugs into the Main graph:
//   the Game Rules node   the SETTINGS (gem share, pickup radius, travel together, no flying) —
//                         select it and change them in the ⓘ panel
//   this file             the DECISIONS made with those settings
//   kit.realms.*          the Dungeon Realms ENGINE (the module): it tells these rules when a floor
//                         is shown, a gem is taken, someone steps on the portal, the adventure
//                         starts; it shows the floor they choose (kit.realms.travel). Its gems,
//                         portals, sounds and banners all read `need` from this file's state —
//                         every peer unseals at the same moment
//   outputs               the floor's numbers and the moments, wired to the HUD and the shell
//
// The world itself is the Dungeon Kit's (the Dungeon node: seed, rooms, floors). The rules run on
// ONE player's machine (the session's authority) and their state reaches everyone.

/** gems on top of the share that a floor asks for (0 = exactly the share) */
const EXTRA_GEMS = 0;

/** how many of a floor's gems unseal its portal: the Game Rules share, rounded up */
function gemsNeeded(total, share) {
	if (!total) return 0;
	const portion = Math.min(1, Math.max(0.05, Number(share) || 0));
	return Math.min(total, Math.max(1, Math.ceil(total * portion)) + EXTRA_GEMS);
}

/** travel together: every player in a slot stands on the portal (or the setting is off) */
function everyoneOnPortal(slots, onPortal, together) {
	if (!together) return Object.values(onPortal).some(Boolean);
	const players = Object.values(slots).filter(Boolean);
	return players.length > 0 ? players.every((id) => !!onPortal[id]) : Object.values(onPortal).some(Boolean);
}

export default behaviour({
	name: 'Dungeon Realms rules',

	state: {
		floor: 0,
		total: 0,
		need: 0,
		have: 0,
		unsealed: false
	},

	outputs: ['floor', 'total', 'need', 'have', 'unsealed', 'portalOpened', 'travelled'],

	on: {
		/** the behaviour's first run: decide for the floor that is already standing */
		start() {
			this.decide();
		},
		'realms.floorShown'() {
			this.decide();
		},
		'realms.started'() {
			this.decide();
		},
		'realms.settingsChanged'() {
			this.decide();
		},
		/** a gem was taken: once enough are, the portal opens (the engine reads `need`) */
		'realms.gemCollected'({ floor, have }) {
			if (floor !== this.state.floor) this.decide();
			this.state.have = have;
			if (!this.state.unsealed && have >= this.state.need && this.state.need > 0) {
				this.state.unsealed = true;
				this.emit('portalOpened');
			}
		},
		/** someone stepped on (or off) the open portal: up we go, together if the settings say so */
		'realms.atPortal'({ floor, sealed, onPortal, slots }) {
			if (sealed || floor !== this.state.floor) return;
			const together = kit.realms.settings().allPlayersPortal;
			if (!everyoneOnPortal(slots, onPortal, together)) return;
			if (kit.realms.travel(floor + 1)) this.emit('travelled');
		}
	},

	/** what this floor asks for, from the engine's numbers and the Game Rules settings */
	decide() {
		const f = kit.realms.floor();
		const s = kit.realms.settings();
		this.state.floor = f.floor;
		this.state.total = f.total;
		this.state.have = f.have;
		this.state.need = gemsNeeded(f.total, s.gemShare);
		this.state.unsealed = this.state.need > 0 && f.have >= this.state.need;
	}
});
