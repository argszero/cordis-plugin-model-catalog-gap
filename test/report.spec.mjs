/**
 * The report: what a session can actually say about the gap.
 *
 * The arms below pin the distinctions that make the report worth having rather
 * than a restatement of two arrays, and each one is a sentence a wrong draft
 * would have printed:
 *
 * - a route that was never compared must not be described as if it had been;
 * - a route whose interrogation FAILED must not be told to supply the baseURL it
 *   already supplied (that sends the caller round the loop it just left);
 * - the consequence of an unroutable id — a failure before dispatch, not a
 *   rejected request — must be stated, because it is what makes the finding
 *   actionable;
 * - the repair section is offered only where there is something to repair, and
 *   never as a certain fix where the protocol question is open.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { catalogGap } from '../lib/gap.js'
import { renderGap } from '../lib/report.js'

/** The route every report describes. */
const P = 'opencode-go'

/** Render one route's report. */
function render(gap, focus, context = {}) {
  return renderGap(gap, focus, context)
}

test('every report opens with the route it is about and both list sizes', () => {
  const text = render(catalogGap({ provider: P, routable: ['a', 'b'], live: ['a', 'b', 'c'] }))
  assert.ok(text.startsWith(`Model catalog gap for route "${P}".`), 'the route is named first')
  assert.match(text, /routable now\s+2\s+\(what this harness accepts for the route\)/)
  assert.match(text, /provider list\s+3\s+\(what the endpoint reports about itself\)/)
})

test('a route that was not asked says so, in the list and in the prose', () => {
  const text = render(catalogGap({ provider: P, routable: ['a'] }))
  assert.match(text, /provider list\s+\?\s+\(not asked -- no baseURL was supplied\)/)
  assert.ok(text.includes('Nothing was compared: the provider was not asked.'))
  assert.ok(text.includes('supply the\nendpoint\'s baseURL to compare.'))
  assert.ok(!text.includes('provider list 0'), 'not asking must never render as an empty answer')
})

test('a failed interrogation is never told to supply the baseURL it already supplied', () => {
  // The verdict is the same as the unasked case -- no list was obtained -- and
  // the situation is not: the caller supplied an endpoint and it refused.
  const gap = catalogGap({ provider: P, routable: ['a'] })
  const text = render(gap, undefined, { liveError: '  connect ECONNREFUSED' })
  assert.ok(text.includes('The provider side is unknown, because no listing was obtained:'))
  assert.ok(text.includes('connect ECONNREFUSED'), 'the endpoint\'s own words are quoted back')
  assert.ok(text.includes('Nothing was compared, because no listing was obtained.'))
  assert.ok(
    !text.includes('supply the\nendpoint\'s baseURL to compare.'),
    'the caller already supplied one; repeating the instruction is the loop it came out of',
  )
  assert.ok(!text.includes('The provider offers'), 'nothing was compared, so nothing may be claimed')
})

test('a route whose lists agree says so and names no repair', () => {
  const text = render(catalogGap({ provider: P, routable: ['a'], live: ['a'] }))
  assert.ok(text.includes('The two lists agree, so this route is not the reason a model is missing.'))
  assert.ok(!text.includes('Making the unroutable ids accept-able'))
  assert.ok(!text.includes('cannot accept'))
})

test('the unroutable ids are named, listed in the provider\'s order, with the pre-dispatch consequence', () => {
  const text = render(catalogGap({ provider: P, routable: ['a'], live: ['a', 'z', 'm'] }))
  assert.ok(text.includes('The provider offers 2 model(s) this route cannot accept:'))
  assert.ok(text.indexOf('  z\n') < text.indexOf('  m\n'), 'the provider\'s order is preserved')
  assert.ok(text.includes('UNKNOWN_MODEL before a single byte leaves the process'))
  assert.ok(text.includes('can never succeed, on any endpoint'))
})

test('the retired ids are a separate finding from the added ones', () => {
  const text = render(catalogGap({ provider: P, routable: ['a', 'old'], live: ['a'] }))
  assert.ok(text.includes('The route offers 1 model(s) the provider no longer reports:'))
  assert.ok(text.includes('  old'))
  assert.ok(!text.includes('cannot accept'), 'nothing was added, so nothing is unroutable')
})

test('a long difference is summarized rather than printed whole', () => {
  const live = Array.from({ length: 45 }, (_, index) => `m${String(index).padStart(2, '0')}`)
  const text = render(catalogGap({ provider: P, routable: [], live }))
  assert.ok(text.includes('The provider offers 45 model(s) this route cannot accept:'))
  assert.ok(text.includes('  ... and 5 more'))
  assert.ok(text.includes('  m39'), 'the 40th id is still listed')
  assert.ok(!text.includes('  m44'), 'the ids past the cap are rolled up, not printed')
})

test('the repair is offered only where an id is actually unroutable', () => {
  const added = render(catalogGap({ provider: P, routable: ['a'], live: ['a', 'new'] }))
  assert.ok(added.includes('Making the unroutable ids accept-able'))
  assert.ok(added.includes('  - id: new'), 'the repair quotes a real id, not a placeholder')

  const retiredOnly = render(catalogGap({ provider: P, routable: ['a', 'old'], live: ['a'] }))
  assert.ok(!retiredOnly.includes('Making the unroutable ids accept-able'))
})

test('the repair states the one thing that decides its shape, and refuses to guess', () => {
  const text = render(catalogGap({ provider: P, routable: [], live: ['new'] }))
  assert.ok(text.includes('a model entry cannot declare'))
  assert.ok(text.includes('its own wire protocol'))
  assert.ok(text.includes('If this route speaks ONE protocol'))
  assert.ok(text.includes('If this route speaks SEVERAL'))
  assert.ok(
    text.includes('is not derivable\n  from either list'),
    'the report must hand the protocol decision over instead of inventing one',
  )
  assert.ok(text.includes('openai-completions | openai-responses | anthropic-messages'), 'the vocabulary is named')
})

test('the mechanism section says where the routable list comes from, and quotes the source when given one', () => {
  const bare = render(catalogGap({ provider: P, routable: ['a'], live: ['a'] }))
  assert.ok(bare.includes('It comes from the installed pi-ai build, not from the endpoint.'))
  assert.ok(bare.includes('The harness itself carries no refresh path for this'))

  const sourced = render(catalogGap({ provider: P, routable: ['a'], live: ['a'] }), undefined, { catalogSource: 'pi-ai 0.9.4' })
  assert.ok(sourced.includes('It comes from pi-ai 0.9.4, not from the endpoint.'))
})

test('the read-only limits are stated on every report that offers a repair', () => {
  const text = render(catalogGap({ provider: P, routable: [], live: ['new'] }))
  assert.ok(text.includes('It writes no configuration'))
  assert.ok(text.includes('It cannot make the catalog live'))
})

test('a named model is placed in prose, with the consequence of its standing', () => {
  const gap = catalogGap({ provider: P, routable: ['both', 'retired'], live: ['both', 'new'] })
  assert.ok(render(gap, 'new').includes(`"new" on this route: offered by the provider but NOT accepted by this route.`))
  assert.ok(render(gap, 'retired').includes('"retired" on this route: accepted by the route, but the provider no longer lists it'))
  assert.ok(render(gap, 'both').includes('"both" on this route: accepted by the route, and the provider still lists it.'))
  assert.ok(render(gap, 'neither').includes('"neither" on this route: on neither list.'))
})

test('a model verdict survives a route that was never compared', () => {
  const text = render(catalogGap({ provider: P, routable: ['a'] }), 'a')
  assert.ok(text.includes('"a" on this route: accepted by the route, and the provider still lists it.'))
  // The unasked case must still say what "unknown" does NOT mean.
  assert.ok(render(catalogGap({ provider: P, routable: ['a'] }), 'q').includes('If the provider was not asked, this says nothing'))
})

test('a report is plain text: no ANSI escapes, no markdown fences, no trailing blank line', () => {
  const text = render(catalogGap({ provider: P, routable: ['a'], live: ['a', 'new'] }), 'new', { liveError: undefined })
  assert.ok(!/\u001B\[/.test(text), 'no terminal escapes')
  assert.ok(!text.includes('```'), 'no code fences')
  assert.ok(!text.endsWith('\n'), 'the report is joined, not terminated')
})
