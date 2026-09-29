/**
 * Defect injection: mutate the source, rebuild, run the suite, and require that
 * the mutation is caught. An arm whose mutation leaves the suite green is
 * SILENT — it proves nothing about the suite, and it is reported as a failure of
 * the harness rather than hidden.
 *
 * The suite imports `lib/*.js`, not `src/*.ts`, so every arm rebuilds with tsc
 * first; a mutation that fails to type-check proves nothing either and is
 * reported separately as TYPEFAIL.
 *
 * Every arm below is a defect this plugin could plausibly have shipped: a
 * distinction it exists to make, removed one line at a time.
 *
 * ```sh
 * node scripts/inject-defects.mjs                  # every arm
 * node scripts/inject-defects.mjs --filter=verdict # arms whose name matches
 * ```
 *
 * @module scripts/inject-defects
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Each arm names the one distinction it removes, and the file it lives in. */
const MUTATIONS = [
  {
    name: 'gap: an unasked route is allowed to have "dead" ids',
    file: 'src/gap.ts',
    edits: [["const dead = (live === undefined ? [] : routable.filter(id => !liveSet.has(id)))", 'const dead = routable.filter(id => !liveSet.has(id))']],
  },
  {
    name: 'gap: a difference in both directions is reported as a one-way one',
    file: 'src/gap.ts',
    edits: [["      : missing.length > 0 && dead.length > 0\n        ? 'divergent'", "      : missing.length > 0 && dead.length > 0 && false\n        ? 'divergent'"]],
  },
  {
    name: 'gap: a provider that moved ahead is reported as a harness that moved ahead',
    file: 'src/gap.ts',
    edits: [["        : missing.length > 0\n          ? 'provider-newer'\n          : dead.length > 0\n            ? 'harness-newer'", "        : missing.length > 0\n          ? 'harness-newer'\n          : dead.length > 0\n            ? 'provider-newer'"]],
  },
  {
    // EQUIVALENT MUTANT, recorded rather than hidden: replacing the
    // `missing.length > 0` test with `live.length > routable.length` cannot be
    // told apart from the original, and that is provable rather than merely
    // unobserved — `missing` is empty exactly when every live id is routable,
    // so the two conditions agree on every input. Kept in the list because "we
    // tried to make this arm bite and could not, and here is why" is a fact
    // about the code, not a reason to omit the arm.
    name: 'gap: the verdict is taken from the list sizes instead of the two differences',
    file: 'src/gap.ts',
    equivalent: 'with no missing ids every live id is routable, so the size comparison and the membership test agree',
    edits: [["        ? 'divergent'\n        : missing.length > 0", "        ? 'divergent'\n        : live !== undefined && live.length > routable.length"]],
  },
  {
    name: 'gap: a duplicated id is counted twice',
    file: 'src/gap.ts',
    edits: [['if (typeof id !== \'string\' || id.length === 0 || seen.has(id)) continue', 'if (typeof id !== \'string\' || id.length === 0) continue']],
  },
  {
    name: 'gap: an empty entry becomes a model',
    file: 'src/gap.ts',
    edits: [["if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue", "if (typeof id !== 'string' || seen.has(id)) continue"]],
  },
  {
    name: 'gap: a retired id is reported as usable',
    file: 'src/gap.ts',
    edits: [["  if (routable && live !== false) return 'usable'", "  if (routable && live !== undefined) return 'usable'"]],
  },
  {
    name: 'report: the cap on listed ids is effectively removed',
    file: 'src/report.ts',
    edits: [['const MAX_LISTED = 40', 'const MAX_LISTED = 100000']],
  },
  {
    name: 'report: a failed interrogation is described as one that never happened',
    file: 'src/report.ts',
    edits: [['if (context.liveError === undefined) {', 'if (true) {']],
  },
  {
    name: 'report: an agreement is reported with an unroutable-ids section anyway',
    file: 'src/report.ts',
    edits: [['  if (gap.missing.length > 0) {\n    lines.push(`The provider offers', '  if (gap.missing.length >= 0) {\n    lines.push(`The provider offers']],
  },
  {
    name: 'report: the repair is offered even when nothing is unroutable',
    file: 'src/report.ts',
    edits: [['  if (gap.missing.length > 0) lines.push(readRepairSection(gap.missing))', '  lines.push(readRepairSection(gap.missing))']],
  },
  {
    name: 'report: the pre-dispatch consequence of an unroutable id is dropped',
    file: 'src/report.ts',
    edits: [[
      "    lines.push('These are not merely missing from a picker. The route resolves a model id out of')\n    lines.push('its installed catalog before dispatch, and an id that is not there fails the call')\n    lines.push('with UNKNOWN_MODEL before a single byte leaves the process. Naming one as the')\n    lines.push('session\\'s model is a request that can never succeed, on any endpoint.')",
      "    lines.push('These are missing from a picker.')",
    ]],
  },
  {
    name: 'report: the dead ids are not listed',
    file: 'src/report.ts',
    edits: [['  if (gap.dead.length > 0) {', '  if (false) {']],
  },
  {
    name: 'index: the discovery request names the route, so it never reaches the network',
    file: 'src/index.ts',
    edits: [['  const request: LlmModelDiscoveryRequest = {\n    ...args.baseURL === undefined ? {} : { baseURL: args.baseURL },', '  const request: LlmModelDiscoveryRequest = {\n    provider,\n    ...args.baseURL === undefined ? {} : { baseURL: args.baseURL },']],
  },
  {
    name: 'index: the settings namespace is assumed instead of read from the directory',
    file: 'src/index.ts',
    edits: [["  return ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)?.settingsNs", "  return provider === undefined ? undefined : 'llm-pi-ai'"]],
  },
  {
    name: 'index: the endpoint is interrogated even when the caller named none',
    file: 'src/index.ts',
    edits: [['      if (args.baseURL !== undefined) {', '      if (true) {']],
  },
  {
    name: 'index: a non-Error throw prints as [object Object]',
    file: 'src/index.ts',
    edits: [[
      "  if (error instanceof Error && error.message.length > 0) return error.message\n  if (typeof error === 'string' && error.length > 0) return error\n  return 'the read failed with no message.'",
      '  return String(error)',
    ]],
  },
  {
    name: 'index: an unreadable route propagates instead of being reported',
    file: 'src/index.ts',
    edits: [[
      "  } catch (error) {\n    return `  ${errorText(error)}`\n  }",
      '  } catch (error) {\n    throw error\n  }',
    ]],
  },
  {
    name: 'index: the empty-route sentinel is indented twice',
    file: 'src/index.ts',
    edits: [["  return routes.length === 0 ? ['(none — no adapter route is registered)'] : routes", "  return routes.length === 0 ? ['  (none — no adapter route is registered)'] : routes"]],
  },
]

const argv = process.argv.slice(2)
const filter = argv.find(argument => argument.startsWith('--filter='))?.slice('--filter='.length)

/** Run one command, capturing whether it succeeded. */
function run(command, args) {
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, output: '' }
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const results = []
for (const mutation of MUTATIONS) {
  if (filter !== undefined && !mutation.name.includes(filter)) continue
  const path = resolve(ROOT, mutation.file)
  const original = readFileSync(path, 'utf8')
  let mutated = original
  let applied = true
  for (const [from, to] of mutation.edits) {
    if (!mutated.includes(from)) {
      applied = false
      break
    }
    mutated = mutated.replace(from, to)
  }
  if (!applied) {
    results.push({ name: mutation.name, outcome: 'NO-OP', detail: 'the source no longer contains the text this arm mutates' })
    continue
  }
  try {
    writeFileSync(path, mutated)
    // EMIT, do not type-check: the suite imports `lib/*.js`, so a mutation that
    // is never written to `lib/` is a mutation the suite cannot see. An earlier
    // draft of this script ran `tsc --noEmit` here and every arm came back
    // SILENT for exactly that reason.
    const built = run('npx', ['tsc'])
    if (!built.ok) {
      results.push({ name: mutation.name, outcome: 'TYPEFAIL', detail: 'the mutation does not compile, so the suite never ran' })
      continue
    }
    const tested = run('node', ['--test', 'test/*.spec.mjs'])
    results.push(tested.ok
      ? { name: mutation.name, outcome: 'SILENT', detail: 'the suite stayed green — this arm proves nothing' }
      : { name: mutation.name, outcome: 'CAUGHT', detail: '' })
  } finally {
    writeFileSync(path, original)
  }
}

// Put `lib/` back. The last arm left its mutation COMPILED there — the source is
// restored in the `finally` above, but the build output is not, and a checkout
// that runs this script and then publishes would ship the last mutant. Rebuilt
// once here so the tree is consistent whether a human runs this or CI does.
const restored = run('npx', ['tsc'])
if (!restored.ok) {
  process.stdout.write('\nWARNING: the rebuild after restoring the sources failed — lib/ may hold a mutant\n')
}

const caught = results.filter(result => result.outcome === 'CAUGHT').length
const declared = new Set(MUTATIONS.filter(mutation => mutation.equivalent !== undefined).map(mutation => mutation.name))
const equivalents = results.filter(result => result.outcome === 'SILENT' && declared.has(result.name))
const silent = results.filter(result => result.outcome === 'SILENT' && !declared.has(result.name))
const other = results.filter(result => result.outcome !== 'CAUGHT' && result.outcome !== 'SILENT')

for (const result of results) {
  const label = result.outcome === 'SILENT' && declared.has(result.name) ? 'EQUIVALENT' : result.outcome
  process.stdout.write(`${label.padEnd(9)} ${result.name}${result.detail === '' ? '' : `\n          ${result.detail}`}\n`)
}
process.stdout.write(`\n${caught}/${results.length} caught`)
process.stdout.write(silent.length === 0
  ? ` — no arm is silent (${equivalents.length} declared equivalent — see the arms)\n`
  : `, ${silent.length} SILENT\n`)
if (other.length > 0) {
  process.stdout.write(`${other.length} arm(s) could not be evaluated: ${other.map(result => `${result.outcome} ${result.name}`).join(', ')}\n`)
}
process.exitCode = silent.length === 0 && other.length === 0 ? 0 : 1
