// waves — THE BOARD (30b): a sign that stands in the world, drawn on a canvas. The DOM HUD
// does not render inside a headset (core hides the whole HUD layer in VR), so on its own a
// headset player never sees the menu, never presses Start, the round never begins and the
// enemies stand still — the "they do not move" report. The board is what a headset CAN see:
// the start prompt ("shoot here to start"), and the level cards. LOCAL — module content on
// this peer only, never in the scene file, never sent.

const W = 1.6;
const H = 0.9;
const PX = 640; // canvas px per metre

/**
 * @param {any} api
 * @returns {{group: any, rect: () => {center: number[], normal: number[], right: number[], w: number, h: number},
 *   draw: (card: {title: string, lines?: string[], button?: string, color?: string}) => void,
 *   placeFacing: (at: number[], yaw: number) => void, show: (on: boolean) => void, visible: () => boolean, dispose: () => void}}
 */
export function createBoard(api) {
	const THREE = api.THREE;
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(W * PX);
	canvas.height = Math.round(H * PX);
	const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), material);
	mesh.name = 'Waves board face';
	mesh.renderOrder = 10;
	const group = new THREE.Group();
	group.name = 'Waves board';
	group.visible = false;
	group.add(mesh);
	let key = '';

	/** @param {{title: string, lines?: string[], button?: string, color?: string}} card */
	function draw(card) {
		const next = JSON.stringify(card);
		if (next === key) return;
		key = next;
		const w = canvas.width;
		const h = canvas.height;
		const accent = card.color ?? '#ff9c6b';
		ctx.clearRect(0, 0, w, h);
		// the panel
		roundRect(ctx, 8, 8, w - 16, h - 16, 44);
		ctx.fillStyle = 'rgba(22, 18, 28, 0.9)';
		ctx.fill();
		ctx.lineWidth = 6;
		ctx.strokeStyle = 'rgba(255, 140, 100, 0.55)';
		ctx.stroke();
		ctx.fillStyle = accent;
		roundRect(ctx, 8, 8, w - 16, 18, 9);
		ctx.fill();
		// the title
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = accent;
		ctx.font = '800 112px system-ui, sans-serif';
		ctx.fillText(card.title, w / 2, 120);
		// the lines
		ctx.fillStyle = '#efe6e6';
		ctx.font = '500 36px system-ui, sans-serif';
		(card.lines ?? []).slice(0, 4).forEach((line, i) => ctx.fillText(line, w / 2, 222 + i * 50));
		// the button
		if (card.button) {
			const bw = w * 0.62;
			const bh = 104;
			const bx = (w - bw) / 2;
			const by = h - bh - 44;
			roundRect(ctx, bx, by, bw, bh, 30);
			ctx.fillStyle = '#d9533f';
			ctx.fill();
			ctx.lineWidth = 4;
			ctx.strokeStyle = '#ffd0c0';
			ctx.stroke();
			ctx.fillStyle = '#ffffff';
			ctx.font = '800 50px system-ui, sans-serif';
			ctx.fillText(card.button, w / 2, by + bh / 2 + 2);
		}
		texture.needsUpdate = true;
	}

	const _m = new THREE.Matrix4();
	const _p = new THREE.Vector3();
	const _q = new THREE.Quaternion();
	const _s = new THREE.Vector3();
	/** stand the board at WORLD `at`, turned to `yaw` — through the parent's inverse, so it
	 * holds wherever core parents module content (30b C1 moves it under the world rig)
	 * @param {number[]} at @param {number} yaw */
	function placeFacing(at, yaw) {
		const world = new THREE.Matrix4().compose(new THREE.Vector3(at[0], at[1], at[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
		const parent = group.parent;
		if (parent) {
			parent.updateMatrixWorld?.(true);
			_m.copy(parent.matrixWorld).invert().multiply(world);
		} else _m.copy(world);
		_m.decompose(_p, _q, _s);
		group.position.copy(_p);
		group.quaternion.copy(_q);
		group.scale.copy(_s);
		group.updateMatrixWorld(true);
	}

	/** the board's face in WORLD space, for a ray test */
	function rect() {
		group.updateMatrixWorld(true);
		const center = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
		const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
		const right = new THREE.Vector3(1, 0, 0).transformDirection(mesh.matrixWorld);
		const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld);
		return { center: center.toArray(), normal: normal.toArray(), right: right.toArray(), w: W * scale.x, h: H * scale.y };
	}

	return {
		group,
		rect,
		draw,
		placeFacing,
		show: (on) => {
			group.visible = !!on;
		},
		visible: () => group.visible,
		dispose: () => {
			group.parent?.remove(group);
			mesh.geometry.dispose();
			material.dispose();
			texture.dispose();
		}
	};
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
