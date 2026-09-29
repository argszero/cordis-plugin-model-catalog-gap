/**
 * The plugin as a session reaches it: mounted on a real context, registered on
 * the real tool registry, driven through the real pipeline.
 *
 * These arms are about the seam, not the arithmetic — the arithmetic is
 * `gap.spec.mjs`. What is pinned here:
 *
 * - the tool is reachable by the name the model calls, and a question about an
 *   unreadable route is an ANSWER (a rendered report), never a thrown error;
 * - the endpoint interrogation leaves the route name OUT of the request, which
 *   is the only reason it reaches the network at all — naming the route is what
 *   makes the adapter answer from its own registry instead;
 * - the settings namespace comes from the configurable-provider directory, so a
 *   deployment that mounts the adapter under another namespace is still served;
 * - the plugin writes nothing: it reaches read methods only, and its shipped
 *   code opens no file, spawns nothing, and speaks to no socket except the one
 *   endpoint the caller names.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { BASE, NS, READ_METHODS, ROUTE, TOOL, UNKNOWN_ROUTE, call, called, callOf, logText, noAdapter, text, value, world } from './harness.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The two lists the standard arms compare. */
const ROUTABLE = ['known-a', 'known-b']

/** A settings namespace that is not the one this plugin happens to be tested against. */
const VENDOR_NS = 'vendor-llm'

test('the tool is mounted under the name the model calls, and a plain read needs no endpoint', async () => {
  const { ctx, llm } = await world({ models: { [ROUTE]: ROUTABLE } })
  assert.ok(ctx.tools.get(TOOL) !== undefined, `${TOOL} must be registered on the public registry`)

  const result = await call(ctx, { provider: ROUTE })
  assert.equal(result.isError, false)
  const out = value(result)
  assert.equal(out.provider, ROUTE)
  assert.equal(out.verdict, 'not-asked')
  assert.equal(out.routableCount, 2)
  assert.equal(out.liveCount, undefined, 'never asking must not report a live count')
  assert.deepEqual(out.missing, [])
  assert.deepEqual(out.dead, [])
  // The route's own list is the only thing an uncompared read needs: the
  // registered-route list is read for the report only when the route cannot be
  // read at all, so asking for it here would be a wasted call.
  assert.deepEqual(called(llm), ['listModels'])
  assert.ok(!called(llm).includes('discoverModels'), 'with no baseURL nothing may be interrogated')
})

test('a route whose provider moved ahead is reported as such, with the ids', async () => {
  const { ctx } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE, 'brand-new'] })
  const result = await call(ctx, { provider: ROUTE, baseURL: BASE })
  assert.equal(result.isError, false)
  const out = value(result)
  assert.equal(out.verdict, 'provider-newer')
  assert.equal(out.routableCount, 2)
  assert.equal(out.liveCount, 3)
  assert.deepEqual(out.missing, ['brand-new'])
  assert.deepEqual(out.dead, [])
  assert.ok(text(result).includes('  brand-new'))
  assert.ok(text(result).includes('UNKNOWN_MODEL before a single byte leaves the process'))
})

test('a route whose lists agree is reported as agreeing, and says no repair is needed', async () => {
  const { ctx } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE] })
  const out = value(await call(ctx, { provider: ROUTE, baseURL: BASE }))
  assert.equal(out.verdict, 'in-sync')
  assert.equal(out.liveCount, 2)
  assert.deepEqual(out.missing, [])
  assert.deepEqual(out.dead, [])
})

test('an unreadable route is an answer, not a failure: the caller is told and the routes are listed', async () => {
  const { ctx } = await world({ models: { [ROUTE]: ROUTABLE } })
  const result = await call(ctx, { provider: UNKNOWN_ROUTE })
  assert.equal(result.isError, false, 'a question about a route that cannot be read is still a question that was answered')
  const out = value(result)
  assert.equal(out.verdict, 'unreadable')
  assert.equal(out.routableCount, 0)
  const report = text(result)
  assert.ok(report.includes(`Model catalog gap: route "${UNKNOWN_ROUTE}" could not be read.`))
  assert.ok(report.includes(noAdapter(UNKNOWN_ROUTE)), 'the service\'s own words are quoted')
  assert.ok(report.includes('Routes this harness currently knows:'))
  assert.ok(report.includes(`  ${ROUTE}`))
})

test('with no route registered at all, the report says so once and indents it like the routes it replaces', async () => {
  const { ctx } = await world({ models: {}, providers: [] })
  const report = text(await call(ctx, { provider: ROUTE }))
  assert.match(report, /^  \(none — no adapter route is registered\)$/m, 'the sentinel sits in the route list\'s own column')
  assert.ok(!/^ {4}\(none/m.test(report), 'the sentinel must not be indented twice')
})

test('the endpoint interrogation deliberately leaves the route name out of the request', async () => {
  // This is the load-bearing detail: a discovery request that NAMES a route is
  // answered from the adapter's own registry, and never reaches the network.
  // Only a request that names no route asks the provider.
  const { ctx, llm } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE, 'brand-new'] })
  await call(ctx, { provider: ROUTE, baseURL: BASE })
  const [, request] = callOf(llm, 'discoverModels')
  assert.ok(request !== undefined, 'the endpoint must have been asked')
  assert.equal(request.provider, undefined, 'naming the route would answer from the installed registry instead of the endpoint')
  assert.equal(request.baseURL, BASE)
})

test('the optional protocol and one-shot credential reach the interrogation unchanged', async () => {
  const { ctx, llm } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE] })
  await call(ctx, { provider: ROUTE, baseURL: BASE, api: 'anthropic-messages', apiKey: 'sk-one-shot' })
  const [, request] = callOf(llm, 'discoverModels')
  assert.equal(request.api, 'anthropic-messages')
  assert.equal(request.apiKey, 'sk-one-shot')
})

test('the settings namespace is read from the directory rather than assumed', async () => {
  // A deployment that mounts the adapter under another namespace must still be
  // served: a hard-coded `llm-pi-ai` would ask the wrong plugin, or the right
  // one under a name nothing else uses.
  const { ctx, llm } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE], namespace: VENDOR_NS })
  const out = value(await call(ctx, { provider: ROUTE, baseURL: BASE }))
  assert.equal(out.verdict, 'in-sync', 'the interrogation must have been made through the declared namespace')
  const [settingsNs] = callOf(llm, 'discoverModels')
  assert.equal(settingsNs, VENDOR_NS, 'the namespace comes from the configurable-provider directory')
  assert.notEqual(VENDOR_NS, NS, 'the arm is vacuous unless the declared namespace differs from the default')
})

test('a route no plugin offers interrogation for is reported as unaskable, without a request', async () => {
  const { ctx, llm } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE], omitNamespace: true })
  const result = await call(ctx, { provider: ROUTE, baseURL: BASE })
  const out = value(result)
  assert.ok(!called(llm).includes('discoverModels'), 'nothing may be asked of a namespace nobody registered')
  assert.equal(out.liveCount, undefined)
  assert.equal(out.verdict, 'not-asked')
  const report = text(result)
  assert.ok(report.includes(`no route named "${ROUTE}" is declared by a plugin that offers endpoint interrogation`))
  assert.ok(
    report.includes('The provider side is unknown, because no listing was obtained:'),
    'the reason is stated without claiming a request was made',
  )
  assert.ok(!report.includes('failed'), 'nothing was attempted, so nothing may be described as having failed')
})

test('a failed interrogation is reported as failed, and never as a list', async () => {
  const { ctx } = await world({ models: { [ROUTE]: ROUTABLE }, discover: () => { throw new Error('connect ECONNREFUSED 127.0.0.1:443') } })
  const result = await call(ctx, { provider: ROUTE, baseURL: BASE })
  assert.equal(result.isError, false, 'an endpoint that refuses a listing is not a failed tool call')
  const out = value(result)
  assert.equal(out.liveCount, undefined, 'a failed interrogation must not become an empty provider list')
  assert.deepEqual(out.missing, [])
  const report = text(result)
  assert.ok(report.includes('connect ECONNREFUSED 127.0.0.1:443'))
  assert.ok(report.includes('Nothing was compared, because no listing was obtained.'))
  assert.ok(!report.includes("supply the\nendpoint's baseURL to compare."), 'the baseURL was supplied; repeating the instruction is the loop the caller just left')
})

test('a non-Error throw is reported as a line, never as [object Object]', async () => {
  const { ctx } = await world({ models: { [ROUTE]: () => { throw 'a bare string refusal' } } })
  const result = await call(ctx, { provider: ROUTE })
  assert.equal(value(result).verdict, 'unreadable')
  assert.ok(text(result).includes('a bare string refusal'))

  const second = await world({ models: { [ROUTE]: () => { throw { code: 'NOPE' } } } })
  const bare = value(await call(second.ctx, { provider: ROUTE }))
  assert.equal(bare.verdict, 'unreadable')
  assert.ok(!text(await call(second.ctx, { provider: ROUTE })).includes('[object Object]'))
  assert.ok(text(await call(second.ctx, { provider: ROUTE })).includes('the read failed with no message.'))
})

test('a named model is placed in the value as well as in the report', async () => {
  const { ctx } = await world({ models: { [ROUTE]: ['retired'] }, discover: ['new'] })
  const out = value(await call(ctx, { provider: ROUTE, baseURL: BASE, model: 'new' }))
  assert.equal(out.model, 'new')
  assert.equal(out.modelVerdict, 'unroutable')
  assert.ok(text(await call(ctx, { provider: ROUTE, baseURL: BASE, model: 'new' })).includes('"new" on this route:'))
})

test('the plugin reaches read methods only', async () => {
  const { ctx, llm } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE, 'brand-new'] })
  await call(ctx, { provider: ROUTE, baseURL: BASE, model: 'brand-new' })
  await call(ctx, { provider: UNKNOWN_ROUTE })

  const reached = called(llm)
  const unexpected = reached.filter(name => !READ_METHODS.includes(name))
  assert.deepEqual(unexpected, [], `the plugin reached ${unexpected.join(', ')}, which is not a read`)
  // And it never touched a property that is not a method it is entitled to:
  // `ctx.provide` and the injector may read a couple of reflexive names, so the
  // arm allows those explicitly instead of allowing everything.
  const reflexive = new Set(['then', 'toJSON', 'valueOf', 'constructor', 'inspect', 'toString'])
  const strays = [...llm.touched].filter(name => !READ_METHODS.includes(name) && !reflexive.has(name))
  assert.deepEqual(strays, [], `the plugin read ${strays.join(', ')} off the llm service`)
})

test('the shipped code opens no file, spawns nothing, and speaks to no socket of its own', () => {
  // The read-only claim, checked where it can actually be checked: the artifact
  // that gets published. A plugin that writes configuration or edits the
  // catalog under `node_modules` cannot do either without one of these.
  const lib = join(ROOT, 'lib')
  const files = readdirSync(lib).filter(name => name.endsWith('.js'))
  assert.ok(files.length >= 3, `expected the entry and its modules, saw ${files.join(', ')}`)
  const forbidden = [/from\s*['"]node:fs['"]/, /from\s*['"]node:child_process['"]/, /from\s*['"]node:net['"]/, /from\s*['"]node:http/, /\bfetch\s*\(/, /require\s*\(\s*['"]fs['"]/]
  for (const name of files) {
    const source = readFileSync(join(lib, name), 'utf8')
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(source), `${name} matches ${String(pattern)}: this plugin must not open, spawn, or fetch`)
    }
  }
})

test('the report never renders the credential it was handed', async () => {
  const secret = 'sk-do-not-print-me-0123456789'
  const { ctx, llm, logged } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE] })
  const result = await call(ctx, { provider: ROUTE, baseURL: BASE, apiKey: secret })
  assert.ok(JSON.stringify(value(result)).includes(secret) === false, 'the canonical value must not carry the key')
  assert.ok(!text(result).includes(secret), 'the report must not carry the key')
  assert.ok(!logText(logged).includes(secret), 'the log must not carry the key')
  assert.ok(JSON.stringify(llm.calls).includes(secret), 'the arm is vacuous unless the key really was forwarded')
})

test('a second call on the same route is answered independently', async () => {
  const { ctx } = await world({ models: { [ROUTE]: ROUTABLE }, discover: [...ROUTABLE, 'brand-new'] })
  const first = value(await call(ctx, { provider: ROUTE, baseURL: BASE }))
  const second = value(await call(ctx, { provider: ROUTE }))
  assert.equal(first.verdict, 'provider-newer')
  assert.equal(second.verdict, 'not-asked', 'a later bare read must not inherit the earlier answer')
  assert.equal(second.liveCount, undefined)
})
