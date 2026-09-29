/**
 * A model missing from a pi-ai provider route has two possible causes, and the
 * harness reports both the same way: the provider may have retired it, or the
 * route's installed catalog may simply be older than the provider.
 *
 * The two lists that answer the question come from different places. What the
 * route accepts is resolved from the pinned pi-ai build inside `node_modules`;
 * what the provider offers is only knowable by asking it. Nothing in a session
 * asks, so a new model is silently unpickable, and the remedy a user reaches
 * for -- correcting the catalog file under `node_modules` -- is erased by the
 * next install.
 *
 * This plugin adds no capability to the adapter. It runs the comparison a
 * session otherwise cannot, from public seams only:
 *
 * - the route's own list, through the `llm` service (`listModels`), which is
 *   the same list every selector is built from and the same list the request
 *   path resolves a model id against;
 * - the provider's list, through the same service's discovery seam, asked with
 *   the endpoint instead of the route name. That distinction is the whole
 *   reason the comparison is possible at all: a discovery request naming a
 *   route is answered from the adapter's own registry, deliberately, because
 *   the registry's answer carries capacities no listing endpoint reports. Only
 *   a request that names no route reaches the network.
 *
 * The report says which of the two lists is behind, which ids are on the wrong
 * side, and the one shape of configuration that makes an id acceptable today --
 * including the case where the route's own protocol spread makes that shape
 * something other than the obvious one.
 *
 * It is deliberately read-only: no configuration is written, no file under
 * `node_modules` is touched, and no endpoint is called unless the caller names
 * one.
 *
 * ```yaml
 * - id: model-catalog-gap
 *   name: '@argszero/cordis-plugin-model-catalog-gap'
 * ```
 *
 * @module @argszero/cordis-plugin-model-catalog-gap
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { catalogGap, modelVerdict } from './gap.ts'
import type { CatalogGap } from './gap.ts'
import { renderGap } from './report.ts'

export { catalogGap, modelVerdict } from './gap.ts'
export type { CatalogGap, CatalogGapInput, CatalogVerdict, ModelVerdict } from './gap.ts'
export { renderGap } from './report.ts'
export type { ReportContext } from './report.ts'

export const name = 'model-catalog-gap'
export const inject = ['llm', 'tools']

/** Tool name the model calls. */
export const TOOL = 'model_catalog_gap'

/** Arguments the tool accepts. */
export interface GapToolArgs {
  /** Configured provider route to inspect, e.g. `opencode-go`. */
  provider: string
  /** One model id to place, when the caller is asking about a specific one. */
  model?: string
  /** Endpoint to interrogate; supplying it enables the provider-side comparison. */
  baseURL?: string
  /** Wire protocol of that endpoint, when the draft names one. */
  api?: string
  /** Credential for this interrogation alone; never stored. */
  apiKey?: string
}

/** The tool's canonical value. */
export interface GapToolValue {
  provider: string
  verdict: string
  routableCount: number
  /** Absent rather than zero when the provider was never asked. */
  liveCount?: number
  missing: string[]
  dead: string[]
  /** Standing of `model` on this route, when one was named. */
  model?: string
  modelVerdict?: string
  /** The rendered report, so the value is self-describing off the tool path. */
  report: string
}

/** Register the comparison tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: TOOL,
    description:
      'Explain why a model id is unusable on a configured LLM provider route, by comparing the models this'
      + ' harness accepts for the route against the models the provider itself reports. Call this when a model is'
      + ' missing from a picker, when a call fails with UNKNOWN_MODEL, when a model that used to work stopped'
      + ' working after an update, or when a provider is said to offer a model this harness does not list.'
      + ' Passing baseURL makes it interrogate the endpoint (one request, no key stored); without it the report'
      + ' states what is known without comparing.',
    parameters: {
      provider: {
        type: 'string',
        required: true,
        description: 'Configured provider route to inspect, e.g. "opencode-go" or "openrouter".',
      },
      model: {
        type: 'string',
        description: 'One model id to place on this route, e.g. the id a failed call named.',
      },
      baseURL: {
        type: 'string',
        description:
          'Base URL of the provider endpoint. Supplying it enables the provider-side comparison; omit it to'
          + ' compare nothing and only read the route.',
      },
      api: {
        type: 'string',
        description: 'Wire protocol the endpoint speaks, when known. Optional for the interrogation.',
      },
      apiKey: {
        type: 'string',
        description: 'Credential for this one interrogation only. It is never stored or logged by this plugin.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true },
          verdict: { type: 'string', required: true },
          routableCount: { type: 'integer', required: true },
          liveCount: { type: 'integer' },
          missing: { type: 'array', required: true, items: { type: 'string' } },
          dead: { type: 'array', required: true, items: { type: 'string' } },
          model: { type: 'string' },
          modelVerdict: { type: 'string' },
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value.report ?? '') }],
    },
    async execute(rawArgs, exec): Promise<GapToolValue> {
      const args = rawArgs as GapToolArgs
      const provider = args.provider
      const unavailable = await readRoutable(ctx, provider)
      if (typeof unavailable === 'string') {
        const report = [
          `Model catalog gap: route "${provider}" could not be read.`,
          '',
          unavailable,
          '',
          'Routes this harness currently knows:',
          ...knownRoutes(ctx).map(id => `  ${id}`),
        ].join('\n')
        return { provider, verdict: 'unreadable', routableCount: 0, missing: [], dead: [], report }
      }

      let live: string[] | undefined
      let liveError: string | undefined
      if (args.baseURL !== undefined) {
        const asked = await readLive(ctx, provider, args, exec.signal)
        if (typeof asked === 'string') liveError = asked
        else live = asked
      }

      const gap = catalogGap({ provider, routable: unavailable, ...live === undefined ? {} : { live } })
      const report = renderGap(gap, args.model, liveError === undefined ? {} : { liveError })
      return {
        provider,
        verdict: gap.verdict,
        routableCount: gap.routable.length,
        ...gap.live === undefined ? {} : { liveCount: gap.live.length },
        missing: [...gap.missing],
        dead: [...gap.dead],
        ...args.model === undefined ? {} : { model: args.model, modelVerdict: modelVerdict(gap, args.model) },
        report,
      }
    },
  }))
}

/**
 * The route's own list, as the harness resolves it.
 *
 * A route the adapter does not own and a route whose configuration does not
 * resolve both arrive here as a thrown error, and both are answers worth
 * reporting rather than failures to propagate: the caller asked a question
 * about a route, and "this route cannot be read, here are the ones that can"
 * is the honest reply.
 * @param ctx - the plugin context.
 * @param provider - route to read.
 * @returns the routable ids, or the reason they could not be read.
 */
async function readRoutable(ctx: Context, provider: string): Promise<string[] | string> {
  try {
    const models = await ctx.llm.listModels(provider)
    return models.map(model => model.id)
  } catch (error) {
    return `  ${errorText(error)}`
  }
}

/**
 * The provider's own list, through the discovery seam.
 *
 * The route name is deliberately left out of the request: naming it is exactly
 * what makes the adapter answer from its own registry instead of asking the
 * endpoint. What is given up with it is the stored credential and the
 * deployment's headers -- both are resolved by the adapter for a named route
 * and by nobody for an unnamed one -- so an endpoint that requires
 * authentication needs its key supplied here.
 * @param ctx - the plugin context.
 * @param provider - route whose own listing is being checked.
 * @param args - the call's endpoint, protocol, and one-shot credential.
 * @param signal - caller cancellation, forwarded to the interrogation.
 * @returns the endpoint's ids, or the reason the interrogation failed.
 */
async function readLive(
  ctx: Context,
  provider: string,
  args: GapToolArgs,
  signal: AbortSignal | undefined,
): Promise<string[] | string> {
  const settingsNs = settingsNamespaceFor(ctx, provider)
  if (settingsNs === undefined) {
    return `  no route named "${provider}" is declared by a plugin that offers endpoint interrogation,`
      + ' so there is nothing to ask.'
  }
  const request: LlmModelDiscoveryRequest = {
    ...args.baseURL === undefined ? {} : { baseURL: args.baseURL },
    ...args.api === undefined ? {} : { api: args.api },
    ...args.apiKey === undefined ? {} : { apiKey: args.apiKey },
  }
  try {
    const found = await ctx.llm.discoverModels(settingsNs, request, signal)
    return found.map(model => model.id)
  } catch (error) {
    return `  ${errorText(error)}`
  }
}

/**
 * The settings namespace that serves a route's endpoint interrogation.
 *
 * Read from the configurable-provider directory rather than assumed: the
 * namespace is the mounting plugin's, and a deployment that renames its mount
 * would leave a hard-coded guess asking the wrong plugin -- or, worse, asking
 * the right one under a name nothing else uses.
 * @param ctx - the plugin context.
 * @param provider - route to look up.
 * @returns the namespace, when a declared route matches.
 */
function settingsNamespaceFor(ctx: Context, provider: string): string | undefined {
  return ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)?.settingsNs
}

/** Every route the runtime currently registers, unindented for the caller. */
function knownRoutes(ctx: Context): string[] {
  const routes = ctx.llm.listProviders().map(info => info.id)
  return routes.length === 0 ? ['(none — no adapter route is registered)'] : routes
}

/**
 * One error as a single readable line.
 *
 * The message is taken from the error and never from `String(error)`: a
 * non-`Error` throw would otherwise print as `[object Object]`, and an error
 * whose message is empty would print as `Error`.
 * @param error - whatever was thrown.
 * @returns the most informative single line available.
 */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return 'the read failed with no message.'
}
