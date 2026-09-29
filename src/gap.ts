/**
 * The comparison itself: two model lists, one route, and the verdict that says
 * which of them is behind.
 *
 * Two independent data sources answer "which models does this route have?" and
 * they are allowed to disagree:
 *
 * - **what the harness will accept** — the ids the installed adapter resolves
 *   for the route. This is the list every selector shows and the list the
 *   request path validates against, and it comes from the pi-ai build the
 *   harness pins, not from the provider.
 * - **what the provider offers** — the ids the endpoint reports about itself
 *   when asked. Nothing in an offline session reads it.
 *
 * The report exists because those two lists failing to agree is silent. A
 * model the provider added is simply absent from every picker, and a model the
 * provider retired stays listed until a request happens to be made against it.
 *
 * @module model-catalog-gap/gap
 */

/** Which side of the comparison a route's model list is behind on. */
export type CatalogVerdict =
  /** No live list was asked for, so only the routable side is known. */
  | 'not-asked'
  /** Both lists exist and agree. */
  | 'in-sync'
  /** The provider offers ids this route cannot accept. */
  | 'provider-newer'
  /** This route accepts ids the provider no longer reports. */
  | 'harness-newer'
  /** Each side has ids the other lacks. */
  | 'divergent'

/** Where one specific model id stands. */
export type ModelVerdict =
  /** The route accepts it and the provider still reports it (or was not asked). */
  | 'usable'
  /** The route accepts it; the provider no longer reports it. */
  | 'retired'
  /** The provider reports it; the route does not accept it. */
  | 'unroutable'
  /** Neither list has it. */
  | 'unknown'

/** The two lists plus the route they describe. */
export interface CatalogGapInput {
  /** Provider route being compared. */
  provider: string
  /** Ids the installed adapter resolves for this route, in adapter order. */
  routable: readonly string[]
  /**
   * Ids the endpoint reported about itself, or `undefined` when the endpoint
   * was not interrogated — which is not the same as an empty answer, and the
   * report must keep them apart.
   */
  live?: readonly string[]
}

/** The comparison, with both directions of the difference preserved. */
export interface CatalogGap {
  provider: string
  routable: readonly string[]
  live?: readonly string[]
  /** Provider ids this route cannot accept, in the provider's order. */
  missing: readonly string[]
  /** Routable ids the provider did not report, in the route's order. */
  dead: readonly string[]
  verdict: CatalogVerdict
}

/**
 * Compare the two lists for one route.
 *
 * A live list that is absent and a live list that is empty are different
 * findings and are kept apart: an endpoint that answered with nothing is a
 * fact about the provider, while never asking is a fact about this run.
 * @param input - the route and the two lists.
 * @returns the diff in both directions plus the verdict it supports.
 */
export function catalogGap(input: CatalogGapInput): CatalogGap {
  const routable = dedupe(input.routable)
  const live = input.live === undefined ? undefined : dedupe(input.live)
  const routableSet = new Set(routable)
  const liveSet = new Set(live ?? [])
  const missing = (live ?? []).filter(id => !routableSet.has(id))
  const dead = (live === undefined ? [] : routable.filter(id => !liveSet.has(id)))
  return {
    provider: input.provider,
    routable,
    ...live === undefined ? {} : { live },
    missing,
    dead,
    verdict: live === undefined
      ? 'not-asked'
      : missing.length > 0 && dead.length > 0
        ? 'divergent'
        : missing.length > 0
          ? 'provider-newer'
          : dead.length > 0
            ? 'harness-newer'
            : 'in-sync',
  }
}

/**
 * Where one model id stands on this route.
 *
 * The four answers are the reason this plugin exists: the failure a user sees
 * for a retired model and the silence they see for a new one are different
 * problems with the same appearance, and only the endpoint can separate them.
 * @param gap - the comparison for the route.
 * @param model - the id being asked about.
 * @returns the id's standing on each list.
 */
export function modelVerdict(gap: CatalogGap, model: string): ModelVerdict {
  const routable = gap.routable.includes(model)
  const live = gap.live === undefined ? undefined : gap.live.includes(model)
  if (routable && live !== false) return 'usable'
  if (routable && live === false) return 'retired'
  if (!routable && live === true) return 'unroutable'
  return 'unknown'
}

/**
 * Order-preserving de-duplication.
 *
 * A duplicated id in either list is a fact about the source, not an instruction
 * to count it twice; the diff is defined over sets while the order stays the
 * source's so the report reads like the list the user is looking at.
 * @param ids - the ids as reported.
 * @returns the ids, first occurrence kept.
 */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
