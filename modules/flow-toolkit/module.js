// Flow Toolkit — the reference module for flow v2 (roadmap #13 batch H).
// Demonstrates api.registerNodeDefs: node definitions that ship WITH a module
// but stay CODE-EDITABLE in the app (open one in the Node Designer to tweak
// the formula; your edit wins over module reloads).
//
// How to use with per-object flows (H1):
//   1. Select an object -> Flow editor shows "<name> has no flow yet" -> Create flow.
//   2. Add "Wobble (toolkit)" or "Breathe (toolkit)" from the palette's Custom
//      section — no Object Selector needed: nodes inside an object flow drive
//      that object implicitly.
//   3. Declare Flow Input / Flow Output nodes to give the flow public sockets,
//      then embed it in the Scene graph via the object's context menu
//      ("Add flow to Scene graph") — scene values feed your module nodes.
//
// User modules must be SELF-CONTAINED: no import statements; everything comes
// from the `api` surface (api.THREE, api.registerNodeDefs, ...).

export default {
	id: 'flow-toolkit',
	name: 'Flow Toolkit',
	version: '1.0.0',
	description: 'Code-editable flow nodes: Wobble + Breathe (registerNodeDefs example).',
	register(api) {
		api.registerNodeDefs([
			{
				key: 'wobble',
				name: 'Wobble (toolkit)',
				params: [
					{ key: 'angle', kind: 'range', min: 0, max: 1.2, step: 0.05 },
					{ key: 'speed', kind: 'range', min: 0.2, max: 12, step: 0.1 }
				],
				code:
					'// wobbles the object like a jelly — editable in the Node Designer\n' +
					'const angle = data.angle ?? 0.3;\n' +
					'const speed = data.speed ?? 4;\n' +
					'object.rotation.x = base.rot[0] + Math.sin(time * speed) * angle;\n' +
					'object.rotation.z = base.rot[2] + Math.cos(time * speed * 0.9) * angle;\n'
			},
			{
				key: 'breathe',
				name: 'Breathe (toolkit)',
				params: [
					{ key: 'amount', kind: 'range', min: 0, max: 0.6, step: 0.02 },
					{ key: 'speed', kind: 'range', min: 0.2, max: 6, step: 0.1 }
				],
				code:
					'// slow scale pulse — wire a Flow Input into `amount` to drive it\n' +
					'// from the Scene graph through an embedded Object Flow node\n' +
					'const amount = data.amount ?? 0.15;\n' +
					'const speed = data.speed ?? 1.2;\n' +
					'const factor = 1 + Math.sin(time * speed) * amount;\n' +
					'object.scale.set(base.scale[0] * factor, base.scale[1] * factor, base.scale[2] * factor);\n'
			}
		]);

		api.toast?.('Flow Toolkit loaded — find Wobble/Breathe under Custom in the node palette');
	}
};
