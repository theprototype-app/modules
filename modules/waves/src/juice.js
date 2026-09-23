// waves — THE SHOTS' JUICE (30b): tracers, muzzle flashes, the kill pop and its shards, and
// the beam. All pooled meshes under the module's own scene-root group, all LOCAL (every peer
// draws its own from what it already knows: its own shots, and the hurt/death edges of the
// replicated hit counters). Additive, unlit and bright, so the post floor's bloom makes them
// glow — no lights are added (a new light recompiles every lit material: a hitch per shot).
// When core offers `api.effects.burst` (30b C6) the kill ALSO throws its sparks and smoke.

const TRACER_LIFE = 0.09;
const FLASH_LIFE = 0.06;
const POP_LIFE = 0.38;
const SHARD_LIFE = 0.55;

/** @param {any} api @param {any} root */
export function createJuice(api, root) {
	const THREE = api.THREE;
	const group = new THREE.Group();
	group.name = 'Waves juice';
	root.add(group);
	const clock = () => performance.now() / 1000;

	const unit = new THREE.BoxGeometry(1, 1, 1);
	unit.translate(0, 0, -0.5); // a box that grows from its origin down -Z
	const ball = new THREE.IcosahedronGeometry(1, 1);
	const star = new THREE.PlaneGeometry(1, 1);
	/** @param {number} color @param {number=} opacity */
	const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

	/** @type {{mesh: any, born: number, life: number, kind: string, vel?: any}[]} */
	const live = [];
	/** how many of each kind were ever drawn (a flight reads it; a flash lives 60 ms) */
	const drawn = /** @type {Record<string, number>} */ ({});
	/** @type {Map<string, any[]>} */
	const pool = new Map();
	/** @param {string} kind @param {() => any} make */
	function take(kind, make) {
		const list = pool.get(kind) ?? [];
		const mesh = list.pop() ?? make();
		if (!mesh.parent) group.add(mesh);
		mesh.visible = true;
		drawn[kind] = (drawn[kind] ?? 0) + 1;
		return mesh;
	}

	const _a = new THREE.Vector3();
	const _b = new THREE.Vector3();
	/** world -> the group's frame (it may hang under a moving rig) @param {number[]} p */
	const local = (p) => group.worldToLocal(new THREE.Vector3(p[0], p[1], p[2]));

	/** a streak from `from` to `to` @param {number[]} from @param {number[]} to @param {number} color @param {number=} width */
	function tracer(from, to, color, width = 0.018) {
		const mesh = take('tracer', () => new THREE.Mesh(unit, glow(color, 0.95)));
		mesh.material.color.setHex(color);
		mesh.material.opacity = 0.95;
		place(mesh, from, to, width);
		live.push({ mesh, born: clock(), life: TRACER_LIFE, kind: 'tracer' });
	}

	/** stretch a -Z box between two world points @param {any} mesh @param {number[]} from @param {number[]} to @param {number} width */
	function place(mesh, from, to, width) {
		group.updateMatrixWorld(true);
		_a.set(from[0], from[1], from[2]);
		_b.set(to[0], to[1], to[2]);
		const len = Math.max(0.001, _a.distanceTo(_b));
		mesh.position.copy(local(from));
		// lookAt takes a WORLD point and aims +Z at it; the box grows down -Z, so aim away from `to`
		mesh.lookAt(_a.clone().multiplyScalar(2).sub(_b));
		mesh.scale.set(width, width, len);
	}

	/** the muzzle flash: two crossed additive quads at the barrel @param {number[]} at @param {number} color */
	function flash(at, color) {
		const mesh = take('flash', () => {
			const m = new THREE.Group();
			const a = new THREE.Mesh(star, glow(0xffffff, 1));
			const b = new THREE.Mesh(star, glow(0xffffff, 1));
			b.rotation.y = Math.PI / 2;
			const c = new THREE.Mesh(ball, glow(0xffffff, 0.9));
			c.scale.setScalar(0.35);
			m.add(a, b, c);
			return m;
		});
		mesh.children.forEach((/** @type {any} */ c) => c.material.color.setHex(color));
		mesh.position.copy(local(at));
		mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
		mesh.scale.setScalar(0.09);
		live.push({ mesh, born: clock(), life: FLASH_LIFE, kind: 'flash' });
	}

	/** a hit spark where a bolt lands @param {number[]} at @param {number} color */
	function spark(at, color) {
		const mesh = take('spark', () => new THREE.Mesh(ball, glow(0xffffff, 1)));
		mesh.material.color.setHex(color);
		mesh.position.copy(local(at));
		mesh.scale.setScalar(0.06);
		live.push({ mesh, born: clock(), life: 0.12, kind: 'spark' });
	}

	/** THE KILL: a hot core that swells and fades, and shards flung out under gravity
	 * @param {number[]} at @param {number} color */
	function pop(at, color) {
		const core = take('pop', () => new THREE.Mesh(ball, glow(0xffffff, 1)));
		core.material.color.setHex(color);
		core.material.opacity = 1;
		core.position.copy(local(at));
		core.scale.setScalar(0.1);
		live.push({ mesh: core, born: clock(), life: POP_LIFE, kind: 'pop' });
		for (let i = 0; i < 10; i++) {
			const shard = take('shard', () => new THREE.Mesh(unit, glow(0xffffff, 1)));
			shard.material.color.setHex(i % 2 ? color : 0xffd0a0);
			shard.material.opacity = 1;
			shard.position.copy(local(at));
			shard.scale.set(0.05, 0.05, 0.12);
			shard.rotation.set(Math.random() * 6, Math.random() * 6, 0);
			const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
			const up = 2.2 + Math.random() * 2.2;
			const out = 1.8 + Math.random() * 2;
			live.push({ mesh: shard, born: clock(), life: SHARD_LIFE, kind: 'shard', vel: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out) });
		}
		api.effects?.burst?.(at, { kind: 'sparks', color: '#' + color.toString(16).padStart(6, '0'), count: 24 });
		api.effects?.burst?.(at, { kind: 'smoke', count: 10 });
	}

	// ---- the beam: one persistent streak per hand, re-aimed every frame it fires --------------
	/** @type {Map<string, any>} */
	const beams = new Map();
	/** @param {string} hand @param {number[] | null} from @param {number[] | null} to @param {number} color @param {number} heat 0..1 */
	function beam(hand, from, to, color, heat = 0) {
		let mesh = beams.get(hand);
		if (!from || !to) {
			if (mesh) mesh.visible = false;
			return;
		}
		if (!mesh) {
			mesh = new THREE.Group();
			mesh.add(new THREE.Mesh(unit, glow(color, 0.9)));
			const outer = new THREE.Mesh(unit, glow(color, 0.25));
			outer.scale.set(3, 3, 1);
			mesh.add(outer);
			group.add(mesh);
			beams.set(hand, mesh);
		}
		mesh.visible = true;
		// hot = redder
		const c = new THREE.Color(color).lerp(new THREE.Color(0xff3020), Math.max(0, Math.min(1, heat)));
		mesh.children.forEach((/** @type {any} */ m) => m.material.color.copy(c));
		const w = 0.012 + 0.006 * Math.sin(clock() * 60);
		place(mesh, from, to, w);
	}

	let lastT = clock();
	function frame() {
		const t = clock();
		const dt = Math.min(0.05, t - lastT);
		lastT = t;
		for (let i = live.length - 1; i >= 0; i--) {
			const p = live[i];
			const age = (t - p.born) / p.life;
			if (age >= 1) {
				p.mesh.visible = false;
				(pool.get(p.kind) ?? pool.set(p.kind, []).get(p.kind))?.push(p.mesh);
				live.splice(i, 1);
				continue;
			}
			if (p.kind === 'tracer') p.mesh.material.opacity = 0.95 * (1 - age);
			else if (p.kind === 'flash') p.mesh.scale.setScalar(0.09 + 0.05 * age);
			else if (p.kind === 'spark') p.mesh.scale.setScalar(0.06 + 0.1 * age);
			else if (p.kind === 'pop') {
				p.mesh.scale.setScalar(0.12 + 0.9 * Math.sqrt(age));
				p.mesh.material.opacity = 1 - age;
			} else if (p.kind === 'shard' && p.vel) {
				p.vel.y -= 9.8 * dt;
				p.mesh.position.addScaledVector(p.vel, dt);
				p.mesh.rotation.x += dt * 9;
				p.mesh.material.opacity = 1 - age;
			}
		}
	}

	return { group, tracer, flash, spark, pop, beam, frame, live: () => live.length, drawn: () => ({ ...drawn }) };
}
