/**
 * The integration harness every mount arm builds on: a REAL cordis context, the
 * REAL `dsh-tools` ToolRuntime, and a stand-in for the `llm` service.
 *
 * What this shape proves that a unit arm cannot: the tool is registered on the
 * public registry, it is reachable by the name the model calls, and it reaches
 * the `llm` service through the seams the harness really publishes
 * (`listModels` / `listProviders` / `listConfigurableProviders` /
 * `discoverModels`) — not through anything this plugin invented.
 *
 * The `llm` stand-in is deliberately not the real service: its *answers* are
 * what the plugin is written against, so making it lie, throw, or answer with
 * something malformed is how the suites below vary the input. Every property
 * the plugin touches is recorded, which is what makes the read-only arm a
 * measurement instead of a promise.
 *
 * What it does not prove, and does not claim: that `llm-pi-ai`'s installed
 * catalog really differs from a given vendor's listing. Only an endpoint can
 * answer that, and no test may call one.
 */

import { Context } from '@deepseek-ai/cordis'
import systemPromptPlugin from '@deepseek-ai/dsh-system-prompt'
import toolsPlugin from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

/** The tool name the model calls. */
export const TOOL = 'model_catalog_gap'

/** The route key used by most arms. */
export const ROUTE = 'opencode-go'

/** The endpoint used by the arms that interrogate. */
export const BASE = 'https://opencode.invalid/v1'

/** The settings namespace a route's discovery is registered under. */
export const NS = 'llm-pi-ai'

/** A route key nothing registers, so `listModels` refuses it. */
export const UNKNOWN_ROUTE = 'no-such-route'

/**
 * The exact refusal the real service produces for an unregistered route.
 *
 * Taken from `LlmRuntime.registration()` (`packages/llm/llm/src/index.ts`):
 * a fixture that invents its own wording would be testing this plugin against
 * an error the harness never throws.
 * @param provider - the route that was asked for.
 * @returns the message, verbatim.
 */
export function noAdapter(provider) {
  return `no adapter registered for provider "${provider}"`
}

/** The service methods this plugin is allowed to reach. */
export const READ_METHODS = ['listModels', 'listProviders', 'listConfigurableProviders', 'discoverModels']

/**
 * One model as the adapter would report it.
 * @param id - the route-local id.
 * @param provider - the route it belongs to.
 * @returns the metadata object.
 */
export function model(id, provider = ROUTE) {
  return { provider, id, name: id }
}

/**
 * A stand-in `llm` service.
 *
 * @param spec - `models` maps a route to its ids (or a function that may throw);
 *   `providers` is the registered-route list; `namespace` is the settings
 *   namespace the configurable-provider directory declares (default {@link NS});
 *   `discover` answers the endpoint interrogation (a list, or a function that
 *   may throw); `omitNamespace` removes the route from
 *   `listConfigurableProviders` instead of answering.
 * @returns the stand-in, carrying every call and every property the plugin read.
 */
export function llmService(spec = {}) {
  const calls = []
  const touched = new Set()
  const providers = spec.providers ?? [ROUTE]
  const namespace = spec.namespace ?? NS

  const surface = {
    listProviders() {
      calls.push(['listProviders'])
      return providers.map(id => ({ id, name: id }))
    },
    listConfigurableProviders() {
      calls.push(['listConfigurableProviders'])
      if (spec.omitNamespace === true) return []
      return providers.map(id => ({ provider: id, displayName: id, settingsNs: namespace, settingsPath: ['providers', id] }))
    },
    async listModels(provider) {
      calls.push(['listModels', provider])
      const answer = spec.models?.[provider]
      if (answer === undefined) throw new Error(noAdapter(provider))
      if (typeof answer === 'function') return answer(provider)
      return answer.map(id => model(id, provider))
    },
    async discoverModels(settingsNs, request, signal) {
      calls.push(['discoverModels', settingsNs, request, signal])
      if (spec.discover === undefined) throw new Error('this route registers no discovery')
      if (typeof spec.discover === 'function') return spec.discover(settingsNs, request, signal)
      return spec.discover.map(id => ({ provider: request?.provider ?? '', id, name: id }))
    },
  }

  // A recording proxy around the stand-in: every property the plugin reads is
  // noted, so "it only ever reaches the four read methods" is measured rather
  // than asserted from reading the source. Unknown properties are recorded and
  // then answered with `undefined`, which is what a write attempt would find.
  const recording = new Proxy(surface, {
    get(target, key, receiver) {
      if (typeof key === 'string') touched.add(key)
      return Reflect.get(target, key, receiver)
    },
  })
  return { service: recording, calls, touched }
}

/**
 * Mount the real registry and this plugin on a fresh context.
 * @param spec - forwarded to {@link llmService}.
 * @returns the context, the stand-in, and the captured log messages.
 */
export async function world(spec = {}) {
  const llm = llmService(spec)
  const ctx = new Context()
  const logged = []
  ctx.logger.exporter({ levels: { default: 2 }, export: message => { logged.push(message) } })
  await ctx.plugin(systemPromptPlugin, {})
  await ctx.plugin(toolsPlugin)
  // Provided from a fiber, so the service's lifetime is the test's.
  await ctx.plugin({ name: 'llm-stand-in', apply: c => { c.provide('llm', llm.service) } })
  await ctx.plugin(plugin)
  return { ctx, llm, logged }
}

/** A fresh abort signal per call, as the tool pipeline expects. */
export const signal = () => new AbortController().signal

/**
 * Drive one call through the real registry.
 * @param ctx - the mounted context.
 * @param args - tool arguments.
 * @returns the settled result.
 */
export function call(ctx, args = {}) {
  return ctx.tools.execute({ name: TOOL, arguments: args, signal: signal() })
}

/**
 * One settled result's canonical value.
 *
 * The registry wraps a tool's return value in the envelope its `output.schema`
 * declares, so the report is read from the value rather than from rendered
 * text — the same read a consumer of this tool would do.
 * @param result - the settled result.
 * @returns the canonical value.
 */
export function value(result) {
  return result.value
}

/**
 * One settled result's report text, as the renderer produced it.
 * @param result - the settled result.
 * @returns the report string.
 */
export function text(result) {
  return String(result.value?.report ?? '')
}

/** The names of every `llm` call made so far. */
export function called(llm) {
  return llm.calls.map(entry => entry[0])
}

/** The argument list of the Nth call of one name, or `undefined`. */
export function callOf(llm, name) {
  return llm.calls.find(entry => entry[0] === name)?.slice(1)
}

/** The captured log as one string. */
export function logText(logged) {
  return logged.map(message => message.args.map(a => String(a)).join(' ')).join('\n')
}
