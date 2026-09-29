/**
 * The report: what the two lists are, why they disagree, and the one shape of
 * repair that is expressible today.
 *
 * Every claim here is about the harness as it is installed. The report never
 * guesses a wire protocol (nothing in either list carries one -- see
 * `modelCatalogGap` in `index.ts` for why the plugin cannot read it), and it
 * never presents a configuration block as certain to work where the protocol
 * question is open.
 *
 * @module model-catalog-gap/report
 */

import type { CatalogGap, ModelVerdict } from './gap.ts'

/** Route facts the report needs beyond the two lists. */
export interface ReportContext {
  /** `pi-ai` version the installed adapter resolves its catalog from, when known. */
  catalogSource?: string
  /** Why the live list is absent, when it was asked for and failed. */
  liveError?: string
}

/**
 * Render the comparison for one route.
 * @param gap - the diff and its verdict.
 * @param focus - the id the caller asked about, when one was named.
 * @param context - extra facts the report quotes.
 * @returns the report as plain text.
 */
export function renderGap(gap: CatalogGap, focus: string | undefined, context: ReportContext): string {
  const lines: string[] = []
  lines.push(`Model catalog gap for route "${gap.provider}".`)
  lines.push('')
  lines.push(`  routable now  ${String(gap.routable.length).padStart(5)}   (what this harness accepts for the route)`)
  if (gap.live === undefined) {
    lines.push('  provider list     ?   (not asked -- no baseURL was supplied)')
  } else {
    lines.push(`  provider list ${String(gap.live.length).padStart(5)}   (what the endpoint reports about itself)`)
  }
  lines.push('')

  if (context.liveError !== undefined) {
    // Neutral on purpose: this channel carries both "the endpoint refused" and
    // "nothing here can ask this route", and only the reason underneath tells
    // them apart. A header that says the interrogation failed would be wrong
    // for the second, where no request was made at all.
    lines.push('The provider side is unknown, because no listing was obtained:')
    lines.push(`  ${context.liveError}`)
    lines.push('')
  }

  if (focus !== undefined) {
    lines.push(`"${focus}" on this route: ${describeModelVerdict(modelVerdictOf(gap, focus))}`)
    lines.push('')
  }

  if (gap.verdict === 'not-asked') {
    // "Not asked" and "asked and failed" are one verdict and two situations.
    // A report that tells a caller to supply the baseURL it has already
    // supplied -- and that the endpoint refused -- sends it round the loop it
    // just came out of, so the two are told apart here.
    if (context.liveError === undefined) {
      lines.push('Nothing was compared: the provider was not asked. Only its own listing can')
      lines.push('separate "this model is gone" from "this list is old", so supply the')
      lines.push('endpoint\'s baseURL to compare.')
    } else {
      lines.push('Nothing was compared, because no listing was obtained. Only the provider\'s own')
      lines.push('listing can separate "this model is gone" from "this list is old" -- settle the')
      lines.push('reason above and ask again.')
    }
    lines.push('')
    lines.push(readMechanismSection(context))
    return lines.join('\n')
  }

  if (gap.verdict === 'in-sync') {
    lines.push('The two lists agree, so this route is not the reason a model is missing.')
    lines.push('')
    lines.push(readMechanismSection(context))
    return lines.join('\n')
  }

  if (gap.missing.length > 0) {
    lines.push(`The provider offers ${gap.missing.length} model(s) this route cannot accept:`.padEnd(0))
    for (const id of gap.missing.slice(0, MAX_LISTED)) lines.push(`  ${id}`)
    if (gap.missing.length > MAX_LISTED) lines.push(`  ... and ${gap.missing.length - MAX_LISTED} more`)
    lines.push('')
    lines.push('These are not merely missing from a picker. The route resolves a model id out of')
    lines.push('its installed catalog before dispatch, and an id that is not there fails the call')
    lines.push('with UNKNOWN_MODEL before a single byte leaves the process. Naming one as the')
    lines.push('session\'s model is a request that can never succeed, on any endpoint.')
    lines.push('')
  }

  if (gap.dead.length > 0) {
    lines.push(`The route offers ${gap.dead.length} model(s) the provider no longer reports:`.padEnd(0))
    for (const id of gap.dead.slice(0, MAX_LISTED)) lines.push(`  ${id}`)
    if (gap.dead.length > MAX_LISTED) lines.push(`  ... and ${gap.dead.length - MAX_LISTED} more`)
    lines.push('')
    lines.push('These stay pickable, so selecting one produces whatever the provider answers for')
    lines.push('an id it has retired -- which is the failure this plugin was written after: a')
    lines.push('session configured for a model that the next package update removed from the list.')
    lines.push('')
  }

  lines.push(readMechanismSection(context))
  if (gap.missing.length > 0) lines.push(readRepairSection(gap.missing))
  return lines.join('\n')
}

/** The why: two lists, one of which is a build artifact. */
function readMechanismSection(context: ReportContext): string {
  const source = context.catalogSource === undefined ? 'the installed pi-ai build' : context.catalogSource
  return [
    'Why the routable list is what it is',
    `  It comes from ${source}, not from the endpoint. The adapter reads a static bundle`,
    '  and never asks the provider, so a model the provider adds is unreachable from this',
    '  harness until that dependency moves -- and a model the provider retires stays',
    '  listed. The bundle is inside node_modules, so editing it is undone by the next',
    '  install, which is the whole of the problem this report describes.',
    '',
    '  The harness itself carries no refresh path for this: the refresh machinery exists',
    '  upstream and is not wired into the pinned build, so nothing in a session can',
    '  update the list at run time. What can be done today is to make the ids this report',
    '  names accept-able for the route, which is configuration, not a catalog refresh.',
  ].join('\n')
}

/**
 * The repair, and the one thing that decides its shape.
 *
 * A `models:` entry cannot carry a wire protocol: the only protocol a route can
 * be told is the route's own, and a route-level protocol outranks every
 * catalog entry's. So the shape of a working addition depends on whether the
 * route speaks one protocol or several, and this plugin cannot read that off
 * either list -- it says so and hands the decision over instead of guessing.
 */
function readRepairSection(missing: readonly string[]): string {
  const sample = missing[0] ?? '<id>'
  return [
    'Making the unroutable ids accept-able',
    '  An id can be added to a route\'s `models:` list, but a model entry cannot declare',
    '  its own wire protocol. The protocol is taken from the route\'s `api`, then from the',
    '  installed entry for that id, then from the route\'s catalog when every entry in it',
    '  speaks one protocol. A new id has no installed entry, so it needs one of the other',
    '  two -- and a route-level `api` outranks every other model on the route.',
    '',
    '  If this route speaks ONE protocol, add the ids to the route itself:',
    '    providers:',
    `      ${'<route>'}:`,
    `        models:`,
    `          - id: ${sample}`,
    '            contextWindow: <required-capacity>',
    '',
    '  If this route speaks SEVERAL (which is why it needs no `api` today), the same',
    '  addition cannot work: the new id has nothing to inherit, and setting the route\'s',
    '  `api` to give it one would retarget every other model on the route -- including the',
    '  ones that speak something else. The shape that works is a sibling route that',
    '  declares the protocol for the ids it carries:',
    '    providers:',
    `      ${'<route>-<protocol>'}:`,
    '        api: <one of: openai-completions | openai-responses | anthropic-messages>',
    '        baseURL: <the same endpoint>',
    '        apiKeyEnv: <the same credential reference>',
    '        models:',
    `          - id: ${sample}`,
    '            contextWindow: <required-capacity>',
    '',
    '  Which of the two applies, and which protocol each new id speaks, is not derivable',
    '  from either list -- no listing endpoint discloses it. Split the ids by the protocol',
    '  you know they use, one sibling route per protocol, and leave the ids you cannot',
    '  place out rather than guessing: a wrong protocol fails at request time.',
    '',
    'What this plugin does not do',
    '  It writes no configuration, edits no file under node_modules, and calls no endpoint',
    '  unless you give it one. It cannot make the catalog live; that is a change to the',
    '  adapter, and this report is what a session can say about it from the outside.',
  ].join('\n')
}

/** How many ids of a set the report lists before summarizing. */
const MAX_LISTED = 40

/** Import-free mirror of {@link modelVerdict} for rendering. */
function modelVerdictOf(gap: CatalogGap, model: string): ModelVerdict {
  const routable = gap.routable.includes(model)
  const live = gap.live === undefined ? undefined : gap.live.includes(model)
  if (routable && live !== false) return 'usable'
  if (routable && live === false) return 'retired'
  if (!routable && live === true) return 'unroutable'
  return 'unknown'
}

/** One sentence per standing. */
function describeModelVerdict(verdict: ModelVerdict): string {
  switch (verdict) {
    case 'usable':
      return 'accepted by the route, and the provider still lists it.'
    case 'retired':
      return 'accepted by the route, but the provider no longer lists it -- the endpoint will'
        + ' answer for an id it has retired.'
    case 'unroutable':
      return 'offered by the provider but NOT accepted by this route. A call naming it fails'
        + ' with UNKNOWN_MODEL before any network call, so the endpoint never sees the attempt.'
    case 'unknown':
      return 'on neither list. If the provider was not asked, this says nothing; if it was,'
        + ' the provider does not offer this id either.'
  }
}
