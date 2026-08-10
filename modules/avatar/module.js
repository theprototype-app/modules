// Avatar controller (K-D): possess the selected object and drive it with
// WASD/arrows (tank controls — W/S move along its facing, A/D turn) or the VR
// left stick, with a chase camera. No module messages: the movement is plain
// throttled `move`s and the possession itself is the selection lock peers
// already see — nothing extra to sync.

export default {
	id: 'avatar',
	name: 'Avatar Controller',
	version: '1.1.0',
	description: 'Possess the selected object: WASD drives it with a chase camera (Esc releases).',
	/** @param {any} api */
	register(api) {
		api.registerBindings([
			{ label: 'Drive forward / back (possessed)', keys: 'W / S' },
			{ label: 'Turn left / right (possessed)', keys: 'A / D' },
			{ label: 'Release possession', keys: 'Esc' }
		]);

		// 17-A1: 'first' is only on newer app builds - feature-detect via
		// api.possessModes rather than passing a camera value that silently
		// degrades to no camera control at all.
		const hasFirstPerson = () => (api.possessModes ?? []).includes('first');

		api.registerMenu('Possess selected object', () => {
			const uuid = api.selectedUuid?.();
			if (!uuid) {
				api.toast('Select an object first, then possess it');
				return;
			}
			if (api.possess(uuid)) api.toast('Possessed — WASD drives, Esc releases');
		});

		api.registerMenu('Possess selected object (first person)', () => {
			const uuid = api.selectedUuid?.();
			if (!uuid) {
				api.toast('Select an object first, then possess it');
				return;
			}
			if (!hasFirstPerson()) {
				api.toast('This app build has no first-person possess - using the chase camera');
				api.possess(uuid);
				return;
			}
			// mouseLook needs the click that opened this menu as its user gesture
			if (api.possess(uuid, { camera: 'first', eyeHeight: 1.7, mouseLook: true }))
				api.toast('First person - mouse looks, WASD moves, Esc releases');
		});

		api.registerVRMenuEntry({
			id: 'possess',
			group: 'object', // Edit ▸ ring (needs a selection anyway)
			label: 'Possess',
			order: 20,
			closes: true,
			action: () => {
				const uuid = api.selectedUuid?.();
				if (uuid) api.possess(uuid, { camera: 'none' }); // VR keeps its own camera
			}
		});
	}
};
