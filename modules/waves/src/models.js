// waves — THE GUN MODELS (30b), built from primitives so the zip carries no asset: each is a
// THREE.Group whose barrel runs down -Z (a WebXR controller's aim), grip at the origin, with a
// `muzzle` child at the barrel's tip (where the flash and the tracer start) and a `glow`
// material the heat or the charge can drive. ~25 cm long: sized to a hand.

/** @param {any} THREE @param {'blaster' | 'scatter' | 'beam'} id @param {number} accent */
export function buildGun(THREE, id, accent) {
	const g = new THREE.Group();
	g.name = 'Waves gun ' + id;
	const body = new THREE.MeshStandardMaterial({ color: 0x2b303a, roughness: 0.42, metalness: 0.55 });
	const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.7, metalness: 0.2 });
	const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2, roughness: 0.3 });
	/** @param {any} geo @param {any} mat @param {number[]} pos @param {number[]=} rot */
	const add = (geo, mat, pos, rot) => {
		const m = new THREE.Mesh(geo, mat);
		m.position.fromArray(pos);
		if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
		m.castShadow = false;
		m.receiveShadow = false;
		g.add(m);
		return m;
	};
	const barrel = (/** @type {number} */ r, /** @type {number} */ len) => new THREE.CylinderGeometry(r, r, len, 14).rotateX(Math.PI / 2);
	let tip = -0.24;
	if (id === 'scatter') {
		add(new THREE.BoxGeometry(0.075, 0.07, 0.2), body, [0, 0.03, -0.07]);
		add(barrel(0.018, 0.2), dark, [-0.021, 0.045, -0.2]);
		add(barrel(0.018, 0.2), dark, [0.021, 0.045, -0.2]);
		add(new THREE.BoxGeometry(0.09, 0.03, 0.08), body, [0, 0.01, -0.2]); // the pump
		add(new THREE.BoxGeometry(0.08, 0.012, 0.16), glow, [0, 0.068, -0.08]);
		tip = -0.3;
	} else if (id === 'beam') {
		add(new THREE.CylinderGeometry(0.036, 0.042, 0.2, 18).rotateX(Math.PI / 2), body, [0, 0.035, -0.08]);
		for (const z of [-0.05, -0.1, -0.15]) add(new THREE.TorusGeometry(0.043, 0.008, 8, 20), glow, [0, 0.035, z]);
		add(barrel(0.014, 0.1), dark, [0, 0.035, -0.22]);
		add(new THREE.SphereGeometry(0.02, 12, 10), glow, [0, 0.035, -0.27]);
		tip = -0.28;
	} else {
		add(new THREE.BoxGeometry(0.05, 0.065, 0.18), body, [0, 0.03, -0.06]);
		add(barrel(0.014, 0.14), dark, [0, 0.042, -0.19]);
		add(new THREE.BoxGeometry(0.056, 0.012, 0.12), glow, [0, 0.066, -0.06]);
		add(new THREE.TorusGeometry(0.018, 0.005, 8, 16), glow, [0, 0.042, -0.25]);
	}
	// the grip and the guard, the same on every gun
	add(new THREE.BoxGeometry(0.04, 0.1, 0.045), dark, [0, -0.03, 0.01], [0.35, 0, 0]);
	add(new THREE.TorusGeometry(0.022, 0.005, 6, 12, Math.PI), dark, [0, -0.005, -0.035], [0, Math.PI / 2, 0]);
	const muzzle = new THREE.Object3D();
	muzzle.name = 'muzzle';
	muzzle.position.set(0, id === 'scatter' ? 0.045 : id === 'beam' ? 0.035 : 0.042, tip);
	g.add(muzzle);
	g.userData.muzzle = muzzle;
	g.userData.glow = glow;
	g.userData.accent = accent;
	return g;
}
