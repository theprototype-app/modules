// The OVERLAY — what Realms adds to the Kit's world: gems (the objective) and the two
// portals, built from the Kit's play contract (userData.play.props / .portals, world
// coordinates) into Realms' OWN scene-root group. The Kit never draws these: a rule
// module owns what it plays with (21-C C6).

/** 30: the glow levels — over 1 so the bloom pass haloes them */
export const GEM_GLOW = 2.4;
export const PORTAL_GLOW = 2.2;

/** colour + glow of a portal ring @param {any} ring @param {number} hex @param {number} glow */
function paintRing(ring, hex, glow) {
	ring.material.color.setHex(hex);
	if (ring.material.emissive) {
		ring.material.emissive.setHex(hex);
		ring.material.emissiveIntensity = glow;
	}
}

/**
 * @param {any} THREE @param {any} play the Kit's userData.play record
 * @param {Set<number>} collected collected gem indices on this floor
 */
export function buildOverlay(THREE, play, collected) {
	const group = new THREE.Group();
	const theme = play.theme ?? {};
	const gemColor = theme.gemColor ?? 0x39e0c0;

	// ---- gems (one InstancedMesh, zero-scaled when collected) --------------------
	const gems = (play.props ?? []).filter((p) => p.kind === 'gem').slice().sort((a, b) => a.index - b.index);
	const gemWorld = gems.map((p) => ({ x: p.wx, y: 0.55, z: p.wz, index: p.index }));
	// 30: the gems GLOW — emissive over 1, so the bloom pass haloes them down a dark corridor
	const gemMesh = new THREE.InstancedMesh(
		new THREE.OctahedronGeometry(0.17, 0),
		new THREE.MeshStandardMaterial({ color: gemColor, emissive: gemColor, emissiveIntensity: GEM_GLOW, roughness: 0.25, metalness: 0.1 }),
		Math.max(1, gemWorld.length)
	);
	gemMesh.name = 'dr-gems';
	gemMesh.count = gemWorld.length;
	group.add(gemMesh);

	// ---- portals -------------------------------------------------------------------
	for (const portal of play.portals ?? []) {
		const portalGroup = new THREE.Group();
		portalGroup.name = 'dr-portal-' + portal.kind;
		portalGroup.position.set(portal.wx, 0, portal.wz);
		// 30: an emissive ring (bright when open), a disc that breathes, and a column of light
		// that rises out of an OPEN portal (animateOverlay drives all three)
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(1.05, 0.1, 10, 36),
			new THREE.MeshStandardMaterial({ color: 0x555a66, emissive: 0x555a66, emissiveIntensity: 0.3, roughness: 0.4, metalness: 0.3 })
		);
		ring.name = 'dr-portal-ring';
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.1;
		const disc = new THREE.Mesh(
			new THREE.CircleGeometry(0.92, 28),
			new THREE.MeshBasicMaterial({ color: 0x394050, transparent: true, opacity: 0.55 })
		);
		disc.name = 'dr-portal-disc';
		disc.rotation.x = -Math.PI / 2;
		disc.position.y = 0.08;
		const column = new THREE.Mesh(
			new THREE.CylinderGeometry(0.9, 0.9, 2.6, 28, 1, true),
			new THREE.MeshBasicMaterial({ color: 0x39e0ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
		);
		column.name = 'dr-portal-column';
		column.position.y = 1.35;
		column.visible = false;
		portalGroup.add(ring, disc, column);
		portalGroup.userData.portal = { kind: portal.kind, gated: portal.gated };
		group.add(portalGroup);
	}

	// runtime bookkeeping the game loop reads (scene-root only — never serialized)
	group.userData._dr = { gemWorld, theme };
	applyGems(group, collected);
	return group;
}

/** Zero-scale collected gems; bob+spin comes from animateOverlay. */
export function applyGems(group, collected) {
	const gemMesh = group.getObjectByName('dr-gems');
	const { gemWorld } = group.userData._dr;
	if (!gemMesh || !gemWorld.length) return;
	const matrix = new (gemMesh.matrixWorld.constructor)();
	gemWorld.forEach((gem, i) => {
		if (collected.has(gem.index)) matrix.makeScale(0, 0, 0);
		else matrix.makeTranslation(gem.x, gem.y, gem.z);
		gemMesh.setMatrixAt(i, matrix);
	});
	gemMesh.instanceMatrix.needsUpdate = true;
}

/** Seal/unseal the UP portal visuals. @param {boolean} sealed */
export function setPortalSealed(group, sealed, theme) {
	const portal = group.getObjectByName('dr-portal-up');
	if (portal) {
		const ring = portal.getObjectByName('dr-portal-ring');
		const disc = portal.getObjectByName('dr-portal-disc');
		if (ring) paintRing(ring, sealed ? 0x555a66 : 0x39e0ff, sealed ? 0.3 : PORTAL_GLOW);
		const column = portal.getObjectByName('dr-portal-column');
		if (column) {
			column.visible = !sealed;
			column.material.color.setHex(theme?.gemColor ?? 0x39e0ff);
		}
		if (disc) {
			disc.material.color.setHex(sealed ? 0x394050 : theme?.gemColor ?? 0x39e0c0);
			disc.material.opacity = sealed ? 0.35 : 0.75;
		}
		portal.userData.portal.sealed = sealed;
	}
	const down = group.getObjectByName('dr-portal-down');
	if (down) {
		const downRing = down.getObjectByName('dr-portal-ring');
		if (downRing) paintRing(downRing, 0x39a0ff, PORTAL_GLOW * 0.6);
		down.userData.portal.sealed = false;
	}
}

/** Per-frame juice: gem spin/bob and unsealed portal ring spin. */
export function animateOverlay(THREE, group, collected, time) {
	const data = group.userData._dr;
	if (!data) return;
	const gemMesh = group.getObjectByName('dr-gems');
	if (gemMesh && data.gemWorld.length) {
		const matrix = new THREE.Matrix4();
		const position = new THREE.Vector3();
		const quaternion = new THREE.Quaternion();
		const scale = new THREE.Vector3(1, 1, 1);
		const axis = new THREE.Vector3(0, 1, 0);
		data.gemWorld.forEach((gem, i) => {
			if (collected.has(gem.index)) return; // stays zero-scaled
			position.set(gem.x, gem.y + Math.sin(time * 2 + gem.x) * 0.08, gem.z);
			quaternion.setFromAxisAngle(axis, time * 1.6 + gem.index);
			matrix.compose(position, quaternion, scale);
			gemMesh.setMatrixAt(i, matrix);
		});
		gemMesh.instanceMatrix.needsUpdate = true;
	}
	group.children.forEach((child) => {
		if (child.name === 'dr-portal-up' || child.name === 'dr-portal-down') {
			const open = child.userData.portal?.sealed === false;
			const ring = child.getObjectByName('dr-portal-ring');
			if (ring && open) ring.rotation.z = time * 0.8;
			// 30: an open portal breathes — the disc's opacity and the column's shimmer, both
			// pure functions of the synced time (no accumulation)
			const disc = child.getObjectByName('dr-portal-disc');
			if (disc && open) disc.material.opacity = 0.6 + Math.sin(time * 2.4) * 0.15;
			const column = child.getObjectByName('dr-portal-column');
			if (column?.visible) {
				column.material.opacity = 0.16 + Math.sin(time * 3.1) * 0.06;
				column.rotation.y = time * 0.5;
			}
		}
	});
}
