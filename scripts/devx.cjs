#!/usr/bin/env node
// DEVX requests — ONE FILE EACH (core roadmap 34, R4 A4).
//
// DEVX-REQUESTS.md used to be one hand-edited file every module lane appended to: it conflicted
// five times in two rounds and was renumbered twice, and the section headers kept the numbers a
// lane gave them while the summary table moved on (three sections were "#26"). Now each request is
// devx/<slug>.md with a small front matter, a lane adds a file and touches NOTHING shared, and the
// number is assigned once, at merge, by the integrator:
//
//   node scripts/devx.cjs            validate every file (unique numbers, required fields) — what a lane runs
//   node scripts/devx.cjs --assign   number the unnumbered files (next free, oldest `filed` first, then slug)
//                                    and regenerate devx/index.json + DEVX-REQUESTS.md — the integrator's step
//   node scripts/devx.cjs --write    regenerate the index without assigning
//
// Front matter (one `key: value` per line; strings are JSON-quoted):
//   number: 42 | null     null = not numbered yet (a new request)
//   title: "…"            the request in one line
//   status: open | shipped | fixed | answered | declined
//   gap / blocks / workaround: the summary-table cells (optional; gap defaults to the title)
//   filed: "2026-10-02"   optional, orders the assignment
//   aliases: [23]         numbers older text used for this request (optional)
// devx/log/*.md (`kind: log`) are the "felt again" / core-status notes: listed, never numbered.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'devx');
const LOG = path.join(DIR, 'log');
const STATUSES = ['open', 'shipped', 'fixed', 'answered', 'declined'];

/** @param {string} file */
function read(file) {
	const text = fs.readFileSync(file, 'utf8');
	const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!m) throw new Error(path.relative(ROOT, file) + ': no front matter');
	/** @type {Record<string, any>} */
	const fm = {};
	for (const line of m[1].split('\n')) {
		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (!kv) throw new Error(path.relative(ROOT, file) + ': bad front-matter line ' + JSON.stringify(line));
		const raw = kv[2].trim();
		fm[kv[1]] = raw === '' ? '' : /^["[\d-]|^null$|^true$|^false$/.test(raw) ? JSON.parse(raw) : raw;
	}
	return { fm, body: text.slice(m[0].length), text, head: m[0] };
}

function load() {
	const reqs = fs
		.readdirSync(DIR)
		.filter((f) => f.endsWith('.md') && f !== 'README.md')
		.sort()
		.map((f) => ({ slug: f.slice(0, -3), file: path.join(DIR, f), ...read(path.join(DIR, f)) }));
	const logs = fs.existsSync(LOG)
		? fs
				.readdirSync(LOG)
				.filter((f) => f.endsWith('.md'))
				.sort()
				.map((f) => ({ slug: f.slice(0, -3), file: path.join(LOG, f), ...read(path.join(LOG, f)) }))
		: [];
	return { reqs, logs };
}

/** @param {ReturnType<typeof load>} all @returns {string[]} problems */
function validate({ reqs, logs }) {
	const problems = [];
	const byNumber = new Map();
	for (const r of reqs) {
		const where = 'devx/' + r.slug + '.md';
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)) problems.push(where + ': the file name must be a kebab-case slug');
		if (typeof r.fm.title !== 'string' || !r.fm.title) problems.push(where + ': `title` is required');
		if (!STATUSES.includes(r.fm.status)) problems.push(where + ': `status` must be one of ' + STATUSES.join(', '));
		if (r.fm.number !== null && !(Number.isInteger(r.fm.number) && r.fm.number > 0))
			problems.push(where + ': `number` must be a positive integer, or null until it is assigned');
		if (Number.isInteger(r.fm.number)) {
			if (byNumber.has(r.fm.number)) problems.push(where + ': #' + r.fm.number + ' is also ' + byNumber.get(r.fm.number));
			else byNumber.set(r.fm.number, where);
		}
	}
	for (const l of logs) if (l.fm.kind !== 'log') problems.push('devx/log/' + l.slug + '.md: `kind: log` is required');
	return problems;
}

/** @param {any[]} reqs */
function assign(reqs) {
	let next = Math.max(0, ...reqs.map((r) => (Number.isInteger(r.fm.number) ? r.fm.number : 0))) + 1;
	const fresh = reqs
		.filter((r) => r.fm.number === null)
		.sort((a, b) => String(a.fm.filed ?? '').localeCompare(String(b.fm.filed ?? '')) || a.slug.localeCompare(b.slug));
	for (const r of fresh) {
		r.fm.number = next++;
		const head = r.head.replace(/^number:\s*null$/m, 'number: ' + r.fm.number);
		fs.writeFileSync(r.file, head + r.body);
		console.log('#' + r.fm.number + '  devx/' + r.slug + '.md');
	}
}

/** @param {string} cell */
const cell = (cell) => String(cell ?? '').replace(/\|/g, '\\|');

/** @param {ReturnType<typeof load>} all */
function write({ reqs, logs }) {
	const numbered = reqs.filter((r) => Number.isInteger(r.fm.number)).sort((a, b) => a.fm.number - b.fm.number);
	const pending = reqs.filter((r) => !Number.isInteger(r.fm.number));
	const rows = [...numbered, ...pending].map((r) => ({
		number: r.fm.number,
		slug: r.slug,
		title: r.fm.title,
		status: r.fm.status,
		gap: r.fm.gap ?? r.fm.title,
		blocks: r.fm.blocks ?? '',
		workaround: r.fm.workaround ?? '',
		...(r.fm.aliases ? { aliases: r.fm.aliases } : {}),
		file: 'devx/' + r.slug + '.md'
	}));
	fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(rows, null, '\t') + '\n');
	const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
	const intro = readme.split('\n<!-- intro-end -->')[0].replace(/^# .*\n/, '').trim();
	const out = [
		'# SDK gaps found while writing these modules',
		'',
		intro,
		'',
		'<!-- GENERATED by `node scripts/devx.cjs --write` from devx/*.md (34 R4 A4). Do not edit this file:',
		'     add or change devx/<slug>.md; the integrator numbers new requests and regenerates this index. -->',
		'',
		'| # | Gap | Blocks | Worked around? |',
		'|---|---|---|---|',
		...rows.map(
			(r) =>
				'| ' +
				(r.number ?? '—') +
				' | [' +
				cell(r.gap).replace(/\]/g, '\\]') +
				'](' +
				r.file +
				') | ' +
				(cell(r.blocks) || '—') +
				' | ' +
				(cell(r.workaround) || 'see the request') +
				' |'
		),
		'',
		'## Notes (round logs, core status)',
		'',
		...logs.map((l) => '- [' + l.fm.title + '](devx/log/' + l.slug + '.md)'),
		''
	];
	fs.writeFileSync(path.join(ROOT, 'DEVX-REQUESTS.md'), out.join('\n'));
	console.log('devx: ' + numbered.length + ' numbered, ' + pending.length + ' pending, ' + logs.length + ' notes');
}

const args = process.argv.slice(2);
let all = load();
const problems = validate(all);
if (problems.length) {
	for (const p of problems) console.error('devx: ' + p);
	process.exit(1);
}
if (args.includes('--assign')) {
	assign(all.reqs);
	all = load();
}
if (args.includes('--assign') || args.includes('--write')) write(all);
else console.log('devx: ' + all.reqs.length + ' requests, ' + all.logs.length + ' notes — valid');
