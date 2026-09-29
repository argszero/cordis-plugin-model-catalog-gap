/**
 * The comparison itself, without a context: two lists in, one verdict out.
 *
 * Every arm here is a distinction the plugin exists to make, and each one is
 * something an earlier draft of this plugin got wrong or would silently get
 * wrong:
 *
 * - "the endpoint answered with nothing" and "the endpoint was never asked" are
 *   different findings, and collapsing them turns "this provider offers no
 *   models" into "this run learned nothing";
 * - a difference in one direction only is not the same finding as a difference
 *   in both, and the two need different repairs;
 * - a duplicated id in a source list must not be counted twice, and an empty or
 *   non-string entry must not become a model;
 * - a model id's standing has four values, and the one that matters most —
 *   "the provider offers it and this route cannot accept it" — is the one a
 *   picker cannot show.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { catalogGap, modelVerdict } from '../lib/gap.js'

/** The route every arm describes. */
const P = 'opencode-go'

test('a route that was never asked reports not-asked, and carries no live list', () => {
  const gap = catalogGap({ provider: P, routable: ['a', 'b'] })
  assert.equal(gap.verdict, 'not-asked')
  assert.equal(gap.live, undefined, 'an absent live list must stay absent, not become []')
  assert.deepEqual(gap.missing, [])
  assert.deepEqual(gap.dead, [], 'nothing can be dead when nothing was asked')
  assert.deepEqual(gap.routable, ['a', 'b'])
})

test('an endpoint that answered with nothing is a finding, not an absence', () => {
  const gap = catalogGap({ provider: P, routable: ['a', 'b'], live: [] })
  assert.notEqual(gap.live, undefined, 'an empty answer still happened')
  assert.deepEqual(gap.live, [])
  assert.equal(gap.verdict, 'harness-newer')
  assert.deepEqual(gap.dead, ['a', 'b'], 'every routable id is unreported by an endpoint that lists none')
  assert.deepEqual(gap.missing, [])
})

test('ids the provider added are missing, and nothing is dead', () => {
  const gap = catalogGap({ provider: P, routable: ['a'], live: ['a', 'brand-new'] })
  assert.equal(gap.verdict, 'provider-newer')
  assert.deepEqual(gap.missing, ['brand-new'])
  assert.deepEqual(gap.dead, [])
})

test('ids the provider retired are dead, and nothing is missing', () => {
  const gap = catalogGap({ provider: P, routable: ['a', 'retired'], live: ['a'] })
  assert.equal(gap.verdict, 'harness-newer')
  assert.deepEqual(gap.missing, [])
  assert.deepEqual(gap.dead, ['retired'])
})

test('a difference in both directions is divergent, and is not reported as one of the one-way cases', () => {
  const gap = catalogGap({ provider: P, routable: ['a', 'retired'], live: ['a', 'brand-new'] })
  assert.equal(gap.verdict, 'divergent')
  assert.deepEqual(gap.missing, ['brand-new'])
  assert.deepEqual(gap.dead, ['retired'])
})

test('equal lists are in sync', () => {
  const gap = catalogGap({ provider: P, routable: ['a', 'b'], live: ['b', 'a'] })
  assert.equal(gap.verdict, 'in-sync', 'membership decides, not order')
  assert.deepEqual(gap.missing, [])
  assert.deepEqual(gap.dead, [])
})

test('both differences keep the reporting list\'s own order', () => {
  const gap = catalogGap({ provider: P, routable: ['r1', 'r2', 'r3'], live: ['l3', 'l1', 'l2'] })
  assert.deepEqual(gap.missing, ['l3', 'l1', 'l2'], 'the provider\'s order is the provider\'s')
  assert.deepEqual(gap.dead, ['r1', 'r2', 'r3'], 'the route\'s order is the route\'s')
})

test('a duplicated id is a fact about the source, not a second model', () => {
  const gap = catalogGap({ provider: P, routable: ['a', 'a', 'b'], live: ['b', 'a', 'a'] })
  assert.deepEqual(gap.routable, ['a', 'b'])
  assert.deepEqual(gap.live, ['b', 'a'])
  assert.equal(gap.verdict, 'in-sync')
})

test('an empty or non-string entry never becomes a model', () => {
  const gap = catalogGap({ provider: P, routable: ['a', '', undefined, null, 'b'], live: ['a', '', 'b'] })
  assert.deepEqual(gap.routable, ['a', 'b'])
  assert.deepEqual(gap.live, ['a', 'b'])
  assert.equal(gap.verdict, 'in-sync')
})

test('de-duplication keeps first occurrence, so the report reads like the source list', () => {
  const gap = catalogGap({ provider: P, routable: ['z', 'a', 'z', 'm'], live: ['z', 'a', 'm'] })
  assert.deepEqual(gap.routable, ['z', 'a', 'm'])
})

test('the verdict is decided by the two differences, never by the list sizes', () => {
  // One id added and one retired is a different finding from two added, even
  // though both leave the provider list one longer than the route's.
  const oneEach = catalogGap({ provider: P, routable: ['a', 'retired'], live: ['a', 'new'] })
  const twoAdded = catalogGap({ provider: P, routable: ['a'], live: ['a', 'new', 'newer'] })
  assert.equal(oneEach.verdict, 'divergent')
  assert.equal(twoAdded.verdict, 'provider-newer')
})

test('a model id\'s standing distinguishes all four cases', () => {
  const notAsked = catalogGap({ provider: P, routable: ['known'] })
  assert.equal(modelVerdict(notAsked, 'known'), 'usable', 'not asking cannot retract the route\'s own answer')
  assert.equal(modelVerdict(notAsked, 'mystery'), 'unknown')

  const asked = catalogGap({ provider: P, routable: ['both', 'retired'], live: ['both', 'new'] })
  assert.equal(modelVerdict(asked, 'both'), 'usable')
  assert.equal(modelVerdict(asked, 'retired'), 'retired')
  assert.equal(modelVerdict(asked, 'new'), 'unroutable')
  assert.equal(modelVerdict(asked, 'neither'), 'unknown')
})

test('an empty live answer makes every routable id retired rather than usable', () => {
  const gap = catalogGap({ provider: P, routable: ['a'], live: [] })
  assert.equal(modelVerdict(gap, 'a'), 'retired')
})
