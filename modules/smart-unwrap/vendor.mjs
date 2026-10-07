// vendor.mjs — refresh the vendored xatlas-wasm build inside this module.
//
//   mkdir /tmp/xw && cd /tmp/xw && npm pack xatlas-wasm@0.1.3 --ignore-scripts && tar xzf *.tgz
//   node modules/smart-unwrap/vendor.mjs /tmp/xw/package/dist/index.mjs
//
// xatlas-wasm ships ONE file: an esbuild'd ES module whose emscripten glue carries the
// .wasm inline as a binary string (SINGLE_FILE). A module entry must be self-contained
// and small enough to read, so this script splits that file in two WITHOUT running it:
//
//   assets/xatlas.wasm   the binary, decoded from the string literal by hand
//                        (a JS string-literal parser + emscripten's binaryDecode maths)
//   module.js            the glue spliced between the VENDORED markers, with exactly two
//                        edits: the inline binary is dropped (findWasmBinary returns
//                        nothing — the wasm arrives through Module.instantiateWasm from
//                        api.assetUrl) and the trailing `export {...}` is removed (the
//                        module's own `export default` is the only export).
//
// Nothing from the package is executed here: it is read as text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) {
	console.error('usage: node vendor.mjs <xatlas-wasm>/dist/index.mjs');
	process.exit(1);
}
const text = fs.readFileSync(source, 'utf8');
const lines = text.split('\n');

// ---- 1. the binary --------------------------------------------------------
const OPEN = "return binaryDecode('";
const blobLine = lines.findIndex((line) => line.trimStart().startsWith(OPEN));
if (blobLine < 0) throw new Error('no inline wasm (binaryDecode literal) found');
const literal = lines[blobLine];
let i = literal.indexOf(OPEN) + OPEN.length;
/** @type {number[]} */
const codes = [];
const SIMPLE = { n: 10, r: 13, t: 9, b: 8, f: 12, v: 11, '\\': 92, "'": 39, '"': 34 };
for (;;) {
	const ch = literal[i];
	if (ch === undefined) throw new Error('unterminated wasm literal');
	if (ch === "'") break;
	if (ch !== '\\') {
		const cp = /** @type {number} */ (literal.codePointAt(i));
		codes.push(cp);
		i += cp > 0xffff ? 2 : 1;
		continue;
	}
	const e = literal[i + 1];
	i += 2;
	if (e in SIMPLE) codes.push(SIMPLE[/** @type {keyof typeof SIMPLE} */ (e)]);
	else if (e === '0' && !/[0-9]/.test(literal[i])) codes.push(0);
	else if (e === 'x') {
		codes.push(parseInt(literal.slice(i, i + 2), 16));
		i += 2;
	} else if (e === 'u' && literal[i] === '{') {
		const end = literal.indexOf('}', i);
		codes.push(parseInt(literal.slice(i + 1, end), 16));
		i = end + 1;
	} else if (e === 'u') {
		codes.push(parseInt(literal.slice(i, i + 4), 16));
		i += 4;
	} else throw new Error('unhandled escape \\' + e);
}
if (literal.slice(i) !== "');") throw new Error('unexpected text after the wasm literal');
const wasm = new Uint8Array(codes.length);
// emscripten's binaryDecode: o[i] = ~c >> 8 & c
for (let k = 0; k < codes.length; k++) wasm[k] = (~codes[k] >> 8) & codes[k];
if (!WebAssembly.validate(wasm)) throw new Error('decoded bytes are not a valid wasm module');
fs.writeFileSync(path.join(HERE, 'assets', 'xatlas.wasm'), wasm);

// ---- 2. the glue ----------------------------------------------------------
const exportLine = lines.findIndex((line) => line.startsWith('export {'));
if (exportLine < 0) throw new Error('no trailing export block found');
const glue = lines
	.slice(0, exportLine)
	.map((line, n) =>
		n === blobLine ? '    return void 0; // smart-unwrap: wasm supplied via Module.instantiateWasm' : line
	);
if (glue.some((line) => /^\s*(import|export)[\s{*'"]/.test(line)))
	throw new Error('the glue has a static import/export the module loader cannot take');

const BEGIN = '// ---- BEGIN VENDORED xatlas-wasm glue';
const END = '// ---- END VENDORED xatlas-wasm glue';
const modulePath = path.join(HERE, 'module.js');
const current = fs.readFileSync(modulePath, 'utf8');
const a = current.indexOf(BEGIN);
const b = current.indexOf(END);
if (a < 0 || b < a) throw new Error('module.js has no VENDORED markers');
const beginLineEnd = current.indexOf('\n', a) + 1;
fs.writeFileSync(modulePath, current.slice(0, beginLineEnd) + glue.join('\n') + '\n' + current.slice(b));
console.log(
	'vendored: assets/xatlas.wasm ' + wasm.length + ' bytes, glue ' + glue.length + ' lines into module.js'
);
