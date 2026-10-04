---
number: 1
title: "First-person camera for `possess`"
status: open
gap: "first-person camera for `possess`"
blocks: "`fps-player`"
workaround: "partly — third-person walk mode ships, first person does not"
---

**Found in:** `modules/fps-player`.

`api.possess(uuid, {camera})` accepts `'chase' | 'orbit' | 'none'`. `'chase'`
sits at a hard-coded `(0, 2.2, 4.5)` behind the object and `lookAt`s it
(`possess.js: chaseCamera`); there is no eye-height / zero-distance option and no
mouse-look. Nothing else on the api can move the editor camera:
`OrbitControls.update()` re-derives the camera from its own spherical state
every frame, so a module writing `camera.position` is reverted, and `controls`
is not exposed.

**Ask:**

```js
api.possess(uuid, {
	camera: 'first',        // eye at the object, no chase offset
	eyeHeight: 1.7,         // metres above the object's origin
	mouseLook: true         // pointer lock drives yaw/pitch; Esc releases both
});
api.possessModes;           // ['chase','orbit','none','first'] — capability probe
```

The capability list matters more than the mode: a module cannot feature-detect
today, because an unknown `camera` value silently degrades to "no camera control
at all" instead of failing. `fps-player` reads `api.possessModes` and uses first
person the moment it appears.

**Meanwhile:** the module ships a complete camera-relative walk controller
(WASD/sprint/jump/crouch, ground raycasts, input claims, one undo per ride) with
the existing chase camera, and says so on screen.
