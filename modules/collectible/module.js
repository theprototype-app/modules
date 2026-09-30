// Collectibles — ONE node where core used to need seven.
//
// Core shipped "make collectible" as a RECIPE: a click event, a Once, a Latch, a Not, a
// Visibility node and a Set Variable, wired up per object, plus a Delay branch if you
// wanted it back again. Every piece of that was an ordinary node doing an ordinary job,
// which was the point — but the thing a user actually wants ("this gem is a gem") had no
// single card, and the count could only be derived by walking the chain backwards.
//
// This module is that one card. It is deliberately NOT a re-implementation: the round
// rules, the latch semantics, the play-mode dormancy and the object hand-back all still
// belong to core, reached through the R3a SDK seams:
//
//   ctx.trigger              this node's OWN round-aware trigger-log entry, so `perRound`
//                            retirement is core's arithmetic and never ours
//   data.perRound            read by core against the replicated round
//   data.whilePlaying        core's effect loop drops the node outside play and the restore
//                            loop hands the object back — the 21-F2 bug fix, for free
//   fireNodeTrigger(...,     the per-player mechanism in one bit: a `scope: 'player'` pulse
//     {replicate:false})     stays in THIS peer's log, so the latch, the hide and the count
//                            are per-peer with no second channel and no new message type
//   api.flow.*               the graph is replicated, so reading it is reading shared state
//   api.game / api.peerVars  the shared scoreboard and the owner-only per-player rows
//
// REPLICATION (golden rules). There is nothing on the wire that this module invented:
//   - a collect is a discrete EVENT and rides the existing replicated `nodetrigger` path
//     through fireNodeTrigger — apply-locally-and-send is core's, and receivers never
//     re-broadcast because they never see a message of ours at all
//   - the hide is DERIVED, per peer, from that one stamp plus the synced clock (a respawn
//     is `age >= respawn` — a pure function, so peers agree with nothing sent)
//   - the counts are DERIVED from the graph, never from the score, so they self-heal on a
//     round bump and track a respawn back down
//   - there is no registerStateSync, on purpose: every bit of state is already replicated
//     (the graph, the trigger log, the game singleton, the peer rows), which AUTHORING.md
//     §4.3 calls the better design when you can get it
//
// A collect banks into either the SHARED game variable or the collector's OWN peer row.
// Shared adds are computed per peer from one replicated stamp — core's Set Variable
// semantics exactly, race included; per-player rows have one writer by construction.

export default {
	id: 'collectible',
	name: 'Collectibles',
	version: '1.1.2',
	description:
		'One node makes an object collectible: click it or walk into it, it hides and counts.',

	/** @param {any} api */
	register(api) {
		// A clean refusal beats a stack trace in the console: this module is nothing but a
		// consumer of the R3a game seams, so an older app cannot run it at all.
		if (!api.flow?.addNodes || !api.game?.roundUnderway || !api.peerVars?.setMine) {
			api.toast('Collectibles needs a newer app build (the game SDK seams are missing)');
			return;
		}

		const SCENE = 'scene'; // flowStore's SCENE_GRAPH
		const DEFAULT_VAR = 'gems';
		/** local sweep cadence for touch + counting. Not replicated — a pure schedule. */
		const SWEEP = 0.1;
		/** recipe layout: one node pair per row, stacked under whatever is already there */
		const COL = 220;
		const ROW = 190;
		const START = { x: 60, y: 40 };

		// =====================================================================
		// 1. THE ONE DEFINITION OF "COLLECTED"
		// =====================================================================
		// Everything reads through here — the effect (which hides), the count node, the
		// manager toolbox, the debug line and the click/touch guards. Four copies of this
		// rule is how a respawn ends up meaning something different in the HUD than it
		// does on screen.
		/**
		 * @param {{stamp: number, age: number} | null | undefined} trigger core's round-aware entry
		 * @param {any} respawn seconds, 0 = never comes back
		 */
		function collectedFrom(trigger, respawn) {
			if (!trigger) return false; // never collected, or retired by perRound
			const seconds = Number(respawn) || 0;
			return seconds <= 0 || trigger.age < seconds;
		}

		/** The same answer for a node we are looking at from outside the tick.
		 * @param {any} node an api.flow.nodes() snapshot */
		function nodeCollected(node) {
			return collectedFrom(api.flow.triggerStamp(node.id), node.data?.respawn);
		}

		/** @param {any} node @returns {string} */
		const varOf = (node) => String(node?.data?.variable ?? '').trim() || DEFAULT_VAR;

		// =====================================================================
		// 2. WHICH OBJECT DOES A NODE ACT ON
		// =====================================================================
		// Core's own rule, mirrored: an explicit Object Selector wire WINS, and a node
		// sitting in an object's own graph with no selector implicitly targets its owner.
		// The effect never needs this (core hands the effect its target), but the click and
		// touch triggers do — they start from an object and have to find the nodes.
		/** @param {any[]} edges @returns {Map<string, any[]>} */
		function bySourceIndex(edges) {
			/** @type {Map<string, any[]>} */
			const map = new Map();
			for (const edge of edges) {
				if (!map.has(edge.source)) map.set(edge.source, []);
				map.get(edge.source)?.push(edge);
			}
			return map;
		}

		/** @param {any} node @param {Map<string, any[]>} bySource @param {Map<string, any>} byId
		 * @returns {string[]} */
		function targetsOf(node, bySource, byId) {
			/** @type {string[]} */
			const out = [];
			let wired = false;
			for (const edge of bySource.get(node.id) ?? []) {
				if (byId.get(edge.target)?.type !== 'objectselector') continue;
				wired = true;
				const selected = String(byId.get(edge.target)?.data?.selected ?? '');
				if (selected && selected !== '-None-') out.push(selected);
			}
			if (!wired && node.graphId && node.graphId !== SCENE) out.push(node.graphId);
			return out;
		}

		/** One read of the graph, shaped for the three consumers that walk it. */
		function graphView() {
			const all = api.flow.nodes();
			return {
				byId: new Map(all.map((/** @type {any} */ n) => [n.id, n])),
				bySource: bySourceIndex(api.flow.edges()),
				collectibles: all.filter((/** @type {any} */ n) => n.type === 'collectible')
			};
		}

		/**
		 * The clicked MESH up to the top-level object, as a chain of uuids. A chain rather
		 * than one answer because both ends are legitimate targets: the recipe run on a
		 * Group marks every child mesh, while a hand-wired selector may name the group.
		 * @param {any} object @returns {string[]}
		 */
		function uuidChain(object) {
			const root = api.objectsGroup();
			/** @type {string[]} */
			const out = [];
			let current = object;
			while (current && current !== root && out.length < 32) {
				if (current.uuid) out.push(current.uuid);
				current = current.parent;
			}
			// only a hit INSIDE the replicated scene counts (helpers and module content live
			// at the local scene root and are nobody's collectible)
			return current === root ? out : [];
		}

		// =====================================================================
		// 3. THE COLLECT ITSELF
		// =====================================================================
		/** @param {any} node */
		function fireCollect(node) {
			api.fireNodeTrigger(
				'collectible',
				(/** @type {any} */ data, /** @type {string} */ id) => id === node.id,
				// the ONE bit that makes per-player work: the pulse never leaves this peer
				node.data?.scope === 'player' ? { replicate: false } : undefined
			);
		}

		/**
		 * Fire every not-yet-collected node of one trigger kind that targets any of these
		 * uuids. Deliberately NOT gated on play mode: the recipe's On Click was not either,
		 * and `perRound` / `whilePlaying` are what decide whether it means anything.
		 * @param {string[]} uuids @param {'click'|'touch'} kind
		 */
		function collectAt(uuids, kind) {
			if (!uuids.length) return 0;
			const wanted = new Set(uuids);
			const { byId, bySource, collectibles } = graphView();
			let fired = 0;
			for (const node of collectibles) {
				if ((node.data?.trigger ?? 'click') !== kind) continue;
				if (nodeCollected(node)) continue;
				if (!targetsOf(node, bySource, byId).some((uuid) => wanted.has(uuid))) continue;
				fireCollect(node);
				fired++;
			}
			return fired;
		}

		// A pure OBSERVER: returning false leaves selection, locks and every other click
		// consumer exactly as they were. A collectible must stay selectable — you have to be
		// able to pick the gem up in the editor to move it. And a click COLLECTS only where
		// the game is played: Interact and Play. An Edit click is a select, never a pickup.
		api.registerClickHandler(
			(/** @type {any} */ object) => {
				const chain = uuidChain(object);
				if (chain.length) collectAt(chain, 'click');
				return false;
			},
			{ modes: ['interact', 'play'] }
		);

		// =====================================================================
		// 4. COUNTING — the `once` semantics, from stamp EDGES
		// =====================================================================
		// A pulse is identified by its stamp, so "count it once" is "count it when the
		// stamp CHANGES". No Once node, no state to replicate, and a respawn re-collect is
		// a new stamp and therefore a new point.
		//
		// FIRST SIGHT NEVER COUNTS. A stamp minted before this module was watching is not a
		// pulse it witnessed — that is core's own `actionSeenAt` reasoning.
		//
		// SEEDING THE STAMP IS NOT ENOUGH, and core gaining a trigger-log handshake reply
		// (DEVX #18) is what exposed it: on a JOINER the seed can happen while the log is
		// still empty — `info` is null, so we seed null — and the history arrives a moment
		// later. The next sweep then sees a stamp where there was none, reads it as a fresh
		// pulse, and banks a point for every gem somebody else already collected.
		//
		// So we remember WHEN we first saw each node, in the same synced clock the stamps
		// are in, and a stamp older than that is history: adopted without counting. That is
		// `actionSeenAt`'s rule spelled out module-side, and it holds however the log
		// arrives — the handshake reply, a later nodesync heal, or an explicit sendNodes.
		/** @type {Map<string, number|null>} node id -> the last stamp we counted */
		const counted = new Map();
		/** @type {Map<string, number>} node id -> when THIS module first saw it */
		const firstSeen = new Map();

		/** @param {any} data */
		function bank(data) {
			const name = String(data?.variable ?? '').trim() || DEFAULT_VAR;
			if (data?.scope === 'player') api.peerVars.setMine(name, api.peerVars.mine(name, 0) + 1);
			else api.game.setVar(name, api.game.getVar(name, 0) + 1);
		}

		function countSweep() {
			/** @type {Set<string>} */
			const live = new Set();
			for (const node of api.flow.nodes('collectible')) {
				live.add(node.id);
				const info = api.flow.triggerStamp(node.id);
				if (!counted.has(node.id)) {
					counted.set(node.id, info ? info.stamp : null); // seed, never count
					firstSeen.set(node.id, api.now());
					continue;
				}
				if (!info || counted.get(node.id) === info.stamp) continue;
				// a stamp OLDER than our first sight of the node is somebody else's pulse,
				// arriving late. Adopt it so it is not re-tested every sweep, and do not bank.
				const seenAt = firstSeen.get(node.id) ?? 0;
				if (info.stamp < seenAt) {
					counted.set(node.id, info.stamp);
					continue;
				}
				counted.set(node.id, info.stamp);
				bank(node.data ?? {});
			}
			// a deleted node forgets its stamp, so an undo that brings it back re-seeds
			// rather than re-counting the collect it already banked
			for (const id of [...counted.keys()])
				if (!live.has(id)) {
					counted.delete(id);
					firstSeen.delete(id);
				}
		}

		// =====================================================================
		// 5. THE TOUCH TRIGGER — self-proximity, per peer
		// =====================================================================
		// Every peer detects ITSELF walking into the gem and fires its own pulse; there is
		// no sensor, no physics body and no initiator. Shared scope still converges because
		// the pulse replicates — the difference is only WHO can set it off.
		function touchSweep() {
			if (!api.isPlaying()) return;
			const position = api.playerPosition();
			if (!position) return;
			const root = api.objectsGroup();
			if (!root) return;
			const here = new api.THREE.Vector3(position[0], position[1], position[2]);
			const { byId, bySource, collectibles } = graphView();
			for (const node of collectibles) {
				if ((node.data?.trigger ?? 'click') !== 'touch') continue;
				if (nodeCollected(node)) continue;
				const radius = Number(node.data?.radius) || 1.5;
				for (const uuid of targetsOf(node, bySource, byId)) {
					const object = root.getObjectByProperty('uuid', uuid);
					if (!object) continue;
					const world = object.getWorldPosition(new api.THREE.Vector3());
					if (world.distanceTo(here) > radius) continue;
					fireCollect(node);
					break;
				}
			}
		}

		let lastSweep = -1;
		api.registerFrameTask(() => {
			// performance.now() and not api.now(): this is a LOCAL schedule, nothing about
			// it is replicated, and the synced clock wraps at midnight
			const now = performance.now() / 1000;
			if (now - lastSweep < SWEEP) return;
			lastSweep = now;
			touchSweep();
			countSweep();
		});

		// =====================================================================
		// 6. THE NODE
		// =====================================================================
		api.registerEffect('collectible', (object, base, data, time, ctx) => {
			// `hide: 'off'` is a COUNTING CHECKPOINT — a lap gate, a trigger plate — which
			// still collects and still counts, it just does not disappear.
			if (data.hide === 'off') return;
			if (collectedFrom(ctx?.trigger, data.respawn)) object.visible = false;
			// and nothing else, deliberately: giving the object BACK is core's restore loop,
			// which is the only path that also lets manual visibility win outside play
		});

		api.registerValueNode(
			'collectiblecount',
			(/** @type {any} */ data) => {
				const stats = statsFor(data?.variable);
				if (data?.read === 'total') return stats.total;
				if (data?.read === 'collected') return stats.collected;
				return stats.left;
			},
			{ vtype: 'number' }
		);

		api.registerNodeGroup({
			group: 'Collectibles',
			items: [
				{
					type: 'collectible',
					label: 'Collectible',
					// perRound + whilePlaying are CORE's flags, stamped here so a collectible
					// is round-scoped and play-scoped out of the box: a new round hands every
					// gem back, and leaving play hands this peer's gems back to the editor.
					defaults: {
						variable: DEFAULT_VAR,
						scope: 'shared',
						trigger: 'click',
						radius: 1.5,
						respawn: 0,
						hide: 'on',
						perRound: true,
						whilePlaying: true
					},
					params: [
						{ key: 'variable', kind: 'text', placeholder: DEFAULT_VAR, maxLength: 40 },
						{ key: 'scope', kind: 'select', options: ['shared', 'player'] },
						{ key: 'trigger', kind: 'select', options: ['click', 'touch'] },
						{ key: 'radius', kind: 'range', min: 0.5, max: 10, step: 0.5 },
						{ key: 'respawn', kind: 'range', min: 0, max: 120, step: 1 },
						{ key: 'hide', kind: 'select', options: ['on', 'off'] }
					]
				},
				{
					type: 'collectiblecount',
					label: 'Collectibles',
					defaults: { variable: DEFAULT_VAR, read: 'left' },
					params: [
						{ key: 'variable', kind: 'text', placeholder: DEFAULT_VAR, maxLength: 40 },
						{ key: 'read', kind: 'select', options: ['left', 'collected', 'total'] }
					]
				}
			]
		});

		// =====================================================================
		// 7. COUNTING BOTH SHAPES — module nodes AND core's legacy chain
		// =====================================================================
		// A scene authored before this module holds the seven-node recipe, and its numbers
		// must keep working: core's `collectcount` walk moved here verbatim in shape.
		//
		// WHAT COUNTS AS A LEGACY CHAIN, walked BACK from the counter:
		//   SetVariable(name) <-trigger- Once <-trigger- (the pickup event) -set-> Latch
		// The pickup event is unconstrained on purpose (an On Click today, an On Enter
		// tomorrow); what identifies the chain is a Once feeding this variable plus a Latch
		// armed by the same event. The LATCH is the truth — it is already `perRound` and
		// already evaluated by the runtime, so `api.flow.nodeValue` gives us core's own
		// round-aware answer and we reimplement nothing.
		/** @param {string} name @returns {any[]} deduped latch snapshots */
		function legacyLatches(name) {
			if (!name) return [];
			const nodes = api.flow.nodes();
			const edges = api.flow.edges();
			const byId = new Map(nodes.map((/** @type {any} */ n) => [n.id, n]));
			const bySource = bySourceIndex(edges);
			/** @type {Map<string, any[]>} */
			const byTarget = new Map();
			for (const edge of edges) {
				if (!byTarget.has(edge.target)) byTarget.set(edge.target, []);
				byTarget.get(edge.target)?.push(edge);
			}
			const into = (/** @type {string} */ id, /** @type {string} */ handle) =>
				(byTarget.get(id) ?? []).filter(
					(/** @type {any} */ e) => (e.targetHandle ?? null) === handle
				);
			/** @type {Map<string, any>} */
			const latches = new Map();
			for (const counter of nodes) {
				if (counter.type !== 'setvariable') continue;
				if (String(counter.data?.name ?? '').trim() !== name) continue;
				for (const toCounter of into(counter.id, 'trigger')) {
					const once = byId.get(toCounter.source);
					if (once?.type !== 'once') continue;
					for (const toOnce of into(once.id, 'trigger')) {
						for (const fromEvent of bySource.get(toOnce.source) ?? []) {
							if ((fromEvent.targetHandle ?? null) !== 'set') continue;
							const latch = byId.get(fromEvent.target);
							if (latch?.type === 'latch') latches.set(latch.id, latch);
						}
					}
				}
			}
			return [...latches.values()];
		}

		/**
		 * `{total, collected, left}` for one variable, over BOTH shapes. Counted from the
		 * graph and never from the score, which is a number that only goes up and would
		 * make `left` negative the first time something respawned.
		 * @param {any} variable
		 */
		function statsFor(variable) {
			const name = String(variable ?? '').trim() || DEFAULT_VAR;
			let total = 0;
			let collected = 0;
			for (const node of api.flow.nodes('collectible')) {
				if (varOf(node) !== name) continue;
				total++;
				if (nodeCollected(node)) collected++;
			}
			for (const latch of legacyLatches(name)) {
				total++;
				if (api.flow.nodeValue(latch.id)) collected++;
			}
			return { total, collected, left: total - collected };
		}

		/** Every variable a collectible in this scene counts into, deterministically ordered. */
		function variablesInUse() {
			/** @type {Set<string>} */
			const names = new Set();
			for (const node of api.flow.nodes('collectible')) names.add(varOf(node));
			for (const node of api.flow.nodes('setvariable')) {
				const name = String(node.data?.name ?? '').trim();
				if (name && legacyLatches(name).length) names.add(name);
			}
			return [...names].sort();
		}

		// =====================================================================
		// 8. THE DEBUG LINE + THE HUD ACTION CATALOG ENTRY
		// =====================================================================
		api.hud.registerDebugLine(() => {
			const names = variablesInUse();
			if (!names.length) return null; // nothing to say; the pill stays quiet
			return names
				.map((name) => {
					const s = statsFor(name);
					return (
						'collectibles (' + name + '): ' + s.collected + ' collected, ' + s.left + ' left of ' + s.total
					);
				})
				.join(' · ');
		});

		api.hud.registerAction({
			key: 'showleft',
			label: 'Show collectibles left',
			group: 'Data',
			role: 'drives',
			node: '',
			via: { node: 'collectiblecount', data: { variable: DEFAULT_VAR, read: 'left' }, handle: 'value' },
			hint: 'Counted from the collectible nodes and legacy chains in the graph — right after a respawn and after a round reset.'
		});

		// =====================================================================
		// 9. THE MANAGER TOOLBOX
		// =====================================================================
		// LOCAL, always (registerToolbox's contract): this window is this viewer's. What it
		// CHANGES goes through the replicated paths — api.flow.setNodeData for an edit,
		// api.flow.addNodes for the recipe.
		//
		// THE LAYOUT IS SHAPED BY THE SCENE THAT BROKE IT. A real game has sixty gems, and
		// the first version gave every one of them a two-line card carrying its own trigger
		// and scope select: a hundred and twenty lines of chrome to scroll past, and no way
		// to say "all of these are touch" short of sixty pointer trips. So the panel now
		// splits the settings by WHO OWNS THEM:
		//
		//   - the GROUP HEADER owns `trigger` and `scope`, because those are what a whole set
		//     of pickups shares. Every gem in a level is collected the same way, and the
		//     score it counts into is already the group's own identity — so a group is
		//     exactly the unit those two settings want to be edited at.
		//   - the ROW owns `respawn`, and nothing else. That one genuinely is per-object
		//     tuning: the gem behind the waterfall comes back, the rest do not.
		//   - a GROUP COLLAPSES, so sixty rows can be one line while you work on another
		//     variable.
		//
		// A group-level control then has to answer the question core's Inspector already
		// answered for a multi-selection: what does it show when the members DISAGREE? An
		// EM-DASH — never one of the values, because showing "click" over a mixed set is a
		// lie that the next pointer trip silently makes true.
		/** @param {string} tag @param {Record<string, any>=} props @param {string=} css */
		function elem(tag, props, css) {
			const node = document.createElement(tag);
			Object.assign(node, props ?? {});
			if (css) node.setAttribute('style', css);
			return node;
		}

		/** @param {string[]} options @param {string} value */
		function select(options, value, css) {
			const node = /** @type {HTMLSelectElement} */ (elem('select', {}, css ?? SELECT_CSS));
			for (const option of options) node.appendChild(elem('option', { value: option, textContent: option }));
			node.value = value;
			return node;
		}

		const SELECT_CSS =
			'background:rgba(0,0,0,0.25);color:inherit;border:1px solid rgba(255,255,255,0.15);' +
			'border-radius:4px;font-size:11px;padding:1px 3px;';
		const INPUT_CSS = SELECT_CSS + 'width:100%;';

		// ---- which groups are folded shut ------------------------------------
		// A LOCAL preference, keyed by variable NAME — the only stable identity a group has,
		// because a group has no id, it IS its name. It goes to localStorage rather than a
		// closure variable for one reason: `mount` runs again every time the window is
		// opened, so an in-memory-only flag forgets on close, which is the same as not
		// remembering at all. The Map in front of it is the authority for this session, so a
		// localStorage that throws (private mode, a sandboxed frame) costs the persistence
		// and nothing else.
		const COLLAPSE_PREFIX = 'mod-collectible:collapsed:';
		/** @type {Map<string, boolean>} */
		const collapsedGroups = new Map();
		/** @param {string} name */
		function isCollapsed(name) {
			if (!collapsedGroups.has(name)) {
				let stored = null;
				try {
					stored = localStorage.getItem(COLLAPSE_PREFIX + name);
				} catch {}
				// DEFAULT OPEN: the rows are what the panel is for, and a list that starts
				// folded shut looks empty. You fold it once and it stays folded.
				collapsedGroups.set(name, stored === '1');
			}
			return collapsedGroups.get(name) === true;
		}
		/** @param {string} name @param {boolean} value */
		function setCollapsed(name, value) {
			collapsedGroups.set(name, value);
			try {
				localStorage.setItem(COLLAPSE_PREFIX + name, value ? '1' : '0');
			} catch {}
		}

		// ---- the group-wide controls -----------------------------------------
		/** core's Inspector rule in one character: a control over members that disagree
		 * shows NEITHER of their values. */
		const MIXED_LABEL = '—';
		const MIXED_VALUE = '';

		/**
		 * The one value every member of a group carries for `key`, or `null` for MIXED.
		 * `fallback` is the node's own default, because an absent field and an explicit one
		 * are the same SETTING — without it a group where one node predates a param would
		 * read mixed forever.
		 * @param {any[]} items @param {string} key @param {string} fallback
		 * @returns {string|null}
		 */
		function agreedOn(items, key, fallback) {
			/** @type {string|null} */
			let seen = null;
			for (const item of items) {
				const value = String(item.data?.[key] ?? fallback);
				if (seen === null) seen = value;
				else if (seen !== value) return null;
			}
			return seen ?? fallback;
		}

		/**
		 * A group-wide select. `value === null` means the members disagree, which adds an
		 * em-dash option that is SELECTED and cannot be chosen back into — picking a real
		 * value out of a mixed control applies it to everyone, which is the whole point of
		 * the control. `data-mixed` is on the element so the state is readable from outside
		 * (a test, a screenshot review) and not only from the glyph.
		 * @param {string[]} options @param {string|null} value @param {string} label
		 */
		function bulkSelect(options, value, label) {
			const node = select(options, value ?? MIXED_VALUE);
			node.title =
				label + ' for EVERY collectible in this group' + (value === null ? ' (they differ right now)' : '');
			if (value !== null) return node;
			// DISABLED, and not merely "not chosen by default": the option stays in the list
			// while the control is open, so without this a user could pick the em-dash BACK
			// and every member would be written the empty string. The mixed marker is a
			// READOUT, never a value.
			const mixed = /** @type {any} */ (elem('option', { value: MIXED_VALUE, textContent: MIXED_LABEL }));
			mixed.disabled = true;
			node.insertBefore(mixed, node.firstChild);
			node.value = MIXED_VALUE;
			node.dataset.mixed = '1';
			return node;
		}

		/**
		 * Apply one setting to every member of a group, through the SAME replicated path a
		 * row edit uses. Members that ALREADY agree are skipped: making a mixed group uniform
		 * sends only the difference, and pressing a value a group already holds sends nothing
		 * at all. Core 1.15's `api.flow.setNodesData` makes the whole press ONE undo step
		 * (still one `nodedata` per member on the wire); an older core has only the per-node
		 * call, so the fallback writes them one by one.
		 * @param {any[]} items @param {string} key @param {string} value @param {string} fallback
		 * @returns {number} how many members actually changed
		 */
		function bulkApply(items, key, value, fallback) {
			// the other half of the mixed guard above: "they differ" is not a setting, so a
			// writer that reaches here with it does nothing rather than writing an empty
			// string over the whole group
			if (value === MIXED_VALUE) return 0;
			const writes = items
				.filter((item) => String(item.data?.[key] ?? fallback) !== value)
				.map((item) => ({ id: item.id, patch: { [key]: value } }));
			if (!writes.length) return 0;
			if (typeof api.flow.setNodesData === 'function') api.flow.setNodesData(writes);
			else for (const w of writes) api.flow.setNodeData(w.id, w.patch);
			return writes.length;
		}

		/** rows grouped by variable, with the target object resolved for display */
		function managerModel() {
			const { byId, bySource, collectibles } = graphView();
			const root = api.objectsGroup();
			/** @type {Map<string, any[]>} */
			const groups = new Map();
			for (const node of collectibles) {
				const name = varOf(node);
				const uuid = targetsOf(node, bySource, byId)[0] ?? null;
				const object = uuid ? root?.getObjectByProperty('uuid', uuid) : null;
				if (!groups.has(name)) groups.set(name, []);
				groups.get(name)?.push({
					id: node.id,
					data: node.data ?? {},
					uuid,
					label: object?.name || (uuid ? uuid.slice(0, 8) + '…' : '(no target)'),
					missing: !!uuid && !object
				});
			}
			for (const rows of groups.values()) rows.sort((a, b) => a.label.localeCompare(b.label));
			return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
		}

		/**
		 * THE RECIPE. One `collectible` node plus one Object Selector per selected object,
		 * created through api.flow.addNodes — so it replicates node by node, lands as ONE
		 * undo entry, and leaves behind an ordinary graph the user can take apart.
		 * @param {any} options
		 */
		function makeCollectible(options) {
			const uuids = api.selectedUuids();
			if (!uuids.length) {
				api.toast('Select an object first, then make it collectible');
				return { built: 0, skipped: 0 };
			}
			const { byId, bySource, collectibles } = graphView();
			/** @type {Set<string>} */
			const taken = new Set();
			for (const node of collectibles)
				for (const uuid of targetsOf(node, bySource, byId)) taken.add(uuid);
			// WHERE each pair lands. Core answers it when it can (`api.flow.freeRegion`, the
			// one placement rule, DEVX #16): under everything already in the graph, asked
			// again per pair because the answer moves as the graph grows. An older app has
			// no freeRegion and no positions in a snapshot, so there the row index comes
			// from how many collectibles the graph already holds — deterministic, and wrong
			// only once a user drags one, which is exactly what the seam fixed.
			const place = (/** @type {number} */ row) =>
				typeof api.flow.freeRegion === 'function'
					? api.flow.freeRegion({ w: COL + 150, h: 150, graphId: SCENE })
					: { x: START.x, y: START.y + row * ROW };
			let row = collectibles.length;
			let built = 0;
			let skipped = 0;
			for (const uuid of uuids) {
				if (taken.has(uuid)) {
					skipped++;
					continue;
				}
				const { x, y } = place(row);
				api.flow.addNodes({
					nodes: [
						{ type: 'collectible', x, y, data: { ...options, perRound: true, whilePlaying: true } },
						{ type: 'objectselector', x: x + COL, y, data: { selected: uuid } }
					],
					edges: [{ from: 0, to: 1 }]
				});
				taken.add(uuid);
				row++;
				built++;
			}
			const name = String(options.variable ?? '').trim() || DEFAULT_VAR;
			api.toast(
				built
					? built + ' collectible' + (built === 1 ? '' : 's') + ' counting into "' + name + '"' +
							(skipped ? ' (' + skipped + ' already collectible)' : '')
					: 'Already collectible — nothing to add'
			);
			return { built, skipped };
		}

		/** @param {HTMLElement} el */
		function mountManager(el) {
			el.textContent = ''; // a re-mount (dev reload) must not stack a second copy
			el.classList.add('collectible-manager');
			el.appendChild(
				elem('style', {
					textContent:
						'.collectible-manager{display:flex;flex-direction:column;gap:8px;min-width:230px;font-size:12px}' +
						'.cm-form{display:grid;grid-template-columns:auto 1fr;gap:4px 6px;align-items:center}' +
						'.cm-form label{opacity:0.75;font-size:11px}' +
						'.cm-group{margin-top:6px}' +
						// the header is TWO lines at the default width: the disclosure heading,
						// then the group-wide controls under it. Both take the full row, so the
						// selects cannot squeeze the variable name off the end of its line.
						'.cm-head{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}' +
						'.cm-disc{flex:1 1 100%;background:transparent;border:0;cursor:pointer;min-width:0}' +
						// .tbx-sec-chev's rotate-on-expanded comes from the shell, but a
						// transform does nothing to a non-replaced INLINE element
						'.cm-disc .tbx-sec-chev{display:inline-block;font-size:9px}' +
						// the variable name is user data and the counts are prose: neither wants
						// .tbx-sec-head's uppercase heading treatment, only its hit area
						'.cm-var{text-transform:none;font-size:11px;letter-spacing:0.01em}' +
						'.cm-counts{text-transform:none;letter-spacing:0;font-weight:400;font-size:10px;' +
						'opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
						// the separator is a PSEUDO-ELEMENT so the counts stay one readable string
						// (and one readable assertion) rather than a name glued to a number
						'.cm-counts::before{content:"\\00b7";opacity:0.6;margin-right:4px}' +
						'.cm-bulk{flex:1 1 100%;display:flex;align-items:center;gap:4px;margin:1px 0 3px}' +
						'.cm-bulk-label{font-size:10px;opacity:0.55;flex:0 0 auto}' +
						'.cm-bulk select{flex:1 1 0;min-width:0}' +
						// ONE LINE per collectible: name · state · respawn
						'.cm-row{display:flex;align-items:center;gap:6px;padding:3px 5px;border-radius:5px;' +
						'background:rgba(255,255,255,0.04);cursor:pointer;margin-bottom:2px}' +
						'.cm-row:hover{background:rgba(255,255,255,0.09)}' +
						'.cm-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
						'.cm-status{flex:0 0 auto;font-size:10px;opacity:0.7;white-space:nowrap}' +
						'.cm-respawn{flex:0 0 auto;width:38px}' +
						'.cm-empty{opacity:0.6;font-size:11px}' +
						'.cm-legacy{flex:1 1 100%;order:3;font-size:10px;opacity:0.6}'
				})
			);

			// ---- the recipe form -------------------------------------------------
			el.appendChild(elem('div', { className: 'tbx-label', textContent: 'Make selection collectible' }));
			const form = elem('div', { className: 'cm-form' });
			const listId = 'cm-vars-' + Math.random().toString(36).slice(2, 8);
			const variable = /** @type {HTMLInputElement} */ (
				elem('input', { type: 'text', value: DEFAULT_VAR, maxLength: 40 }, INPUT_CSS)
			);
			variable.setAttribute('list', listId);
			const datalist = elem('datalist', { id: listId });
			const scope = select(['shared', 'player'], 'shared');
			const trigger = select(['click', 'touch'], 'click');
			const hide = select(['on', 'off'], 'on');
			const respawn = /** @type {HTMLInputElement} */ (
				elem('input', { type: 'number', min: '0', max: '120', step: '1', value: '0', className: 'cm-in-respawn' }, INPUT_CSS)
			);
			// S4: the touch RADIUS was fixed at 1.5 by this form and editable only on the node
			// card afterwards. It only means something for a touch trigger, so it is disabled
			// (with the reason) under click rather than hidden — the form keeps its shape.
			const radius = /** @type {HTMLInputElement} */ (
				elem('input', { type: 'number', min: '0.5', max: '10', step: '0.5', value: '1.5', className: 'cm-in-radius' }, INPUT_CSS)
			);
			const syncRadius = () => {
				radius.disabled = trigger.value !== 'touch';
				radius.title = radius.disabled
					? 'Only a touch trigger has a radius — switch Trigger to touch'
					: 'How close (metres) you must walk to collect it';
			};
			trigger.addEventListener('change', syncRadius);
			syncRadius();
			const rows = [
				['Counts into', variable],
				['Scope', scope],
				['Trigger', trigger],
				['Touch radius', radius],
				['Hide', hide],
				['Respawn (s)', respawn]
			];
			for (const [label, control] of rows) {
				form.appendChild(elem('label', { textContent: label }));
				form.appendChild(/** @type {any} */ (control));
			}
			el.appendChild(form);
			el.appendChild(datalist);
			const build = elem('button', { className: 'tbx-btn tbx-primary', textContent: 'Make collectible' });
			build.addEventListener('click', () => {
				makeCollectible({
					variable: variable.value.trim() || DEFAULT_VAR,
					scope: scope.value,
					trigger: trigger.value,
					hide: hide.value,
					radius: Math.max(0.5, Math.min(10, Number(radius.value) || 1.5)),
					respawn: Math.max(0, Math.min(120, Number(respawn.value) || 0))
				});
				refresh(true);
			});
			el.appendChild(build);

			// ---- the live list ---------------------------------------------------
			const list = elem('div', {});
			el.appendChild(list);

			/** rebuilt only when the STRUCTURE changes, so an inline edit keeps its focus */
			let signature = '';
			/** @type {Map<string, HTMLElement>} */
			const countEls = new Map();
			/** @type {Map<string, HTMLElement>} */
			const statusEls = new Map();

			/**
			 * The live word for one row. It is the only place a respawn is legible while you
			 * look at the list: "collected" and "back in 4s" are the same latch state, and
			 * telling them apart is the difference between a gem that is gone and one you are
			 * waiting for.
			 * @param {any} item
			 */
			function statusText(item) {
				if (item.missing) return 'missing';
				const trigger = api.flow.triggerStamp(item.id);
				if (!collectedFrom(trigger, item.data.respawn)) return 'waiting';
				const seconds = Number(item.data.respawn) || 0;
				if (seconds > 0 && trigger)
					return 'back in ' + Math.max(1, Math.ceil(seconds - trigger.age)) + 's';
				return 'collected';
			}

			/** @param {boolean=} force */
			function refresh(force) {
				const model = managerModel();
				// the group-wide selects derive from the members, so the members' own fields
				// are the whole signature — a bulk apply changes them and the rebuild that
				// follows re-reads the agreed value (or drops the em-dash)
				const next = JSON.stringify(
					model.map(([name, items]) => [
						name,
						isCollapsed(name),
						items.map((i) => [i.id, i.label, i.data.trigger, i.data.scope, i.data.respawn, i.data.hide])
					])
				);
				if (force || next !== signature) {
					signature = next;
					rebuild(model);
				}
				// counts and states change with the CLOCK (a respawn ages), so they are written
				// in place rather than rebuilt — see the focus note above
				for (const [name, counts] of countEls) {
					const stats = statsFor(name);
					counts.textContent =
						stats.collected + ' collected, ' + stats.left + ' left of ' + stats.total;
				}
				for (const [, items] of model)
					for (const item of items) {
						const status = statusEls.get(item.id);
						if (!status) continue;
						const text = statusText(item);
						status.textContent = text;
						status.style.opacity = text === 'waiting' ? '0.6' : '1';
					}
				// the variable suggestions follow the scene
				const suggestions = variablesInUse();
				const known = [...datalist.children].map((c) => /** @type {any} */ (c).value);
				if (JSON.stringify(known) !== JSON.stringify(suggestions)) {
					datalist.textContent = '';
					for (const name of suggestions) datalist.appendChild(elem('option', { value: name }));
				}
			}

			/**
			 * THE GROUP HEADER: a disclosure heading carrying the live counts, plus the two
			 * settings a whole group shares.
			 * @param {string} name @param {any[]} items
			 */
			function buildHead(name, items) {
				const head = elem('div', { className: 'cm-head' });
				const collapsed = isCollapsed(name);

				// `tbx-sec-head` is core's own collapsible-section header, so the typography,
				// the hover, the focus ring and the chevron rotation all come from the shell
				// — the same treatment every collapsible section in the app has.
				const disc = /** @type {HTMLButtonElement} */ (
					elem('button', { className: 'cm-disc tbx-sec-head', type: 'button' })
				);
				disc.setAttribute('aria-expanded', String(!collapsed));
				disc.appendChild(elem('span', { className: 'tbx-sec-chev', textContent: '▸' }));
				disc.appendChild(elem('span', { className: 'cm-var', textContent: name }));
				const counts = elem('span', { className: 'cm-counts', textContent: '' });
				countEls.set(name, counts);
				disc.appendChild(counts);
				// S4: the COUNTS include older recipe chains (21-F's seven-node shape) that
				// count into the same variable, while only this module's nodes get rows — right
				// by design (the variable is what a HUD reads), and confusing unless said.
				const legacy = legacyLatches(name).length;
				if (legacy)
					head.appendChild(
						elem('div', {
							className: 'cm-legacy',
							textContent:
								'+' + legacy + ' older recipe chain' + (legacy === 1 ? '' : 's') +
								' counted here (edit in the node editor)'
						})
					);
				disc.addEventListener('click', () => {
					setCollapsed(name, !isCollapsed(name));
					// the rows are DROPPED rather than hidden (see rebuild), so folding is a
					// rebuild — and the flag rides the signature, so a later refresh cannot
					// quietly unfold what you just closed
					refresh(true);
				});
				head.appendChild(disc);

				// THE BULK CONTROLS. Both write through bulkApply — the replicated path a row
				// edit always used, aimed at the whole group, and one undo step where core has
				// the batch call.
				const bulk = elem('div', { className: 'cm-bulk' });
				bulk.appendChild(elem('span', { className: 'cm-bulk-label', textContent: 'all' }));
				const groupTrigger = bulkSelect(['click', 'touch'], agreedOn(items, 'trigger', 'click'), 'Trigger');
				const groupScope = bulkSelect(['shared', 'player'], agreedOn(items, 'scope', 'shared'), 'Scope');
				groupTrigger.addEventListener('change', () => {
					const changed = bulkApply(items, 'trigger', groupTrigger.value, 'click');
					announceBulk(changed, name, 'trigger', groupTrigger.value);
				});
				groupScope.addEventListener('change', () => {
					const changed = bulkApply(items, 'scope', groupScope.value, 'shared');
					announceBulk(changed, name, 'scope', groupScope.value);
				});
				for (const control of [groupTrigger, groupScope]) bulk.appendChild(control);
				head.appendChild(bulk);
				return head;
			}

			/** A bulk edit can touch sixty nodes off one pointer trip, and a control that
			 * looks like a per-row one has to say how far it reached.
			 * @param {number} changed @param {string} name @param {string} what @param {string} value */
			function announceBulk(changed, name, what, value) {
				api.toast(
					changed
						? changed + ' collectible' + (changed === 1 ? '' : 's') + ' in "' + name + '" set to ' + what + ' ' + value
						: 'Every collectible in "' + name + '" was already ' + what + ' ' + value
				);
				refresh(true);
			}

			/** @param {any} item */
			function buildRow(item) {
				// ONE LINE, three children: which object · what it is doing · when it returns.
				const row = elem('div', { className: 'cm-row' });
				row.dataset.node = item.id;
				row.addEventListener('click', () => {
					if (item.uuid) api.selectObject(item.uuid);
				});
				row.appendChild(elem('div', { className: 'cm-name', textContent: item.label }));
				const status = elem('div', { className: 'cm-status', textContent: '' });
				statusEls.set(item.id, status);
				row.appendChild(status);

				// respawn STAYS on the row: it is the one setting that is genuinely per-object,
				// and it writes through the same replicated nodedata path as everything else
				const rowRespawn = /** @type {HTMLInputElement} */ (
					elem(
						'input',
						{
							type: 'number',
							min: '0',
							max: '120',
							step: '1',
							value: String(Number(item.data.respawn) || 0),
							className: 'cm-respawn'
						},
						SELECT_CSS
					)
				);
				rowRespawn.title = 'Respawn seconds (0 = gone for good)';
				// a control is not the row: clicking it must not also re-select
				rowRespawn.addEventListener('click', (event) => event.stopPropagation());
				rowRespawn.addEventListener('change', () =>
					api.flow.setNodeData(item.id, {
						respawn: Math.max(0, Math.min(120, Number(rowRespawn.value) || 0))
					})
				);
				row.appendChild(rowRespawn);
				return row;
			}

			/** @param {any[]} model */
			function rebuild(model) {
				list.textContent = '';
				countEls.clear();
				statusEls.clear();
				if (!model.length) {
					list.appendChild(
						elem('div', {
							className: 'cm-empty',
							textContent: 'No collectibles yet. Select an object and press the button.'
						})
					);
					return;
				}
				for (const [name, items] of model) {
					const group = elem('div', { className: 'cm-group' });
					group.dataset.var = name;
					// a collapsed group DROPS its rows rather than hiding them: sixty number
					// inputs left in the DOM are sixty things the 500ms refresh keeps writing to
					const rows = elem('div', { className: 'cm-rows' });
					group.appendChild(buildHead(name, items));
					if (!isCollapsed(name)) for (const item of items) rows.appendChild(buildRow(item));
					group.appendChild(rows);
					list.appendChild(group);
				}
			}

			refresh(true);

			// WHEN TO REDRAW (DEVX #17). With core's change signals the panel stops polling:
			// it redraws when the graph changes or a node FIRES (`api.flow.onChange` — both
			// structure and collected state), and when the round moves (`api.game.onChange`,
			// which retires perRound stamps). Core coalesces those to one call per frame.
			// Two things are NOT events and keep a clock, each only while it is needed:
			//   - a respawn countdown ("back in 4s") ages with time, so a 1s tick runs only
			//     while some row is counting down;
			//   - an OLDER recipe chain's latch is read as a node VALUE, which core
			//     republishes a beat after the trigger, so a change is re-read once 300ms on.
			// An object renamed or deleted in the viewport is neither; the panel re-reads on
			// pointerenter, so it is fresh the moment you look at it.
			// An older app has no onChange: the 500ms poll it always had.
			/** @type {any} */ let settle = null;
			/** @type {any} */ let countdown = null;
			const counting = () => [...statusEls.values()].some((el) => /^back in /.test(el.textContent ?? ''));
			const tickCountdown = () => {
				countdown = null;
				refresh();
				if (counting()) countdown = setTimeout(tickCountdown, 1000);
			};
			const onSignal = () => {
				refresh();
				clearTimeout(settle);
				settle = setTimeout(() => {
					settle = null;
					refresh();
					if (!countdown && counting()) countdown = setTimeout(tickCountdown, 1000);
				}, 300);
				if (!countdown && counting()) countdown = setTimeout(tickCountdown, 1000);
			};
			if (typeof api.flow.onChange === 'function' && typeof api.game.onChange === 'function') {
				const offs = [api.flow.onChange(onSignal), api.game.onChange(onSignal)];
				const onEnter = () => refresh();
				el.addEventListener('pointerenter', onEnter);
				if (counting()) countdown = setTimeout(tickCountdown, 1000);
				el.dataset.refresh = 'signal';
				return () => {
					for (const off of offs) if (typeof off === 'function') off();
					clearTimeout(settle);
					clearTimeout(countdown);
					el.removeEventListener('pointerenter', onEnter);
				};
			}
			el.dataset.refresh = 'poll';
			const timer = setInterval(refresh, 500);
			return () => clearInterval(timer);
		}

		// `sidebar: false`: NO permanent row in the burger menu's Modules section. This
		// window belongs to a workflow — you open it to build or audit pickups, then close
		// it — and the burger menu is the app's permanent chrome, which one game mechanic
		// has no standing claim on (the 21-C3 Road-menu ruling, one surface over: this
		// project is not only for games). It keeps its VIEWPORT-menu row, where the work
		// is, and gains a button on its own card in the Modules manager.
		const toolbox = api.registerToolbox({
			id: 'manager',
			title: 'Collectibles',
			width: 260,
			minW: 230,
			sidebar: false,
			mount: mountManager
		});

		// ...which is this. `registerMenu` renders on our card beside Update/Remove, and
		// `openToolbox` dismisses the manager on its way out — otherwise the window would
		// open underneath the very dialog the button lives in.
		api.registerMenu('Open Collectibles', () => api.openToolbox(toolbox));

		// A new scene has none of the old scene's pulses; forget the stamps rather than
		// carrying them into a graph whose node ids may repeat.
		api.onSceneClear(() => {
			counted.clear();
			firstSeen.clear();
		});
	}
};
