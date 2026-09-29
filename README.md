# @argszero/cordis-plugin-model-catalog-gap

A tool that explains **why a model id is unusable on a configured LLM provider route**, by
comparing the two lists that answer that question and are allowed to disagree:

| list | where it comes from | readable offline? |
|------|--------------------|-------------------|
| **what the route accepts** | the pinned `pi-ai` build inside `node_modules` | yes — it *is* the installation |
| **what the provider offers** | the endpoint, asked about itself | no — nothing in a session asks |

Because nothing asks, the two can diverge silently for weeks. A model the provider **added** is
absent from every picker with no error anywhere. A model the provider **retired** stays listed and
pickable, and fails only when someone happens to call it. Both look like "the model is missing",
and they have opposite remedies.

The tool is read-only: it writes no configuration, touches no file under `node_modules`, and calls
no endpoint unless you hand it one.

```
@argszero/cordis-plugin-model-catalog-gap@0.1.0
```

## The gap this exists for

[deepseek-ai/deepseek-harness discussion #8227](https://github.com/deepseek-ai/deepseek-harness/discussions/8227)
reports a provider whose model list has moved past the one this harness carries, and the remedy the
reporter reached for — editing the catalog under `node_modules` — is undone by the next install.

Reading the tree at `477b4f4205` says the situation is sharper than "the new model is not in the
picker":

- **An unlisted id is not merely unpickable, it is unusable.** The stream path resolves the model
  out of the installed snapshot before dispatch
  (`packages/llm/llm-pi-ai/src/adapter.ts`, `modelOf` at the top of the stream call) and throws
  `UNKNOWN_MODEL` when it is absent. *No byte reaches the provider.* A session configured for such a
  model is a request that can never succeed on any endpoint — no retry, no timeout, no wider
  context changes that.
- **A per-model catalog entry cannot declare its own wire protocol.** The route's protocol is
  `request.api ?? base?.api ?? routeApi` (`catalog.ts`), and the per-model field list
  (`modelFields`) carries no `api`. So an id the *provider* announced — which by definition has no
  installed entry — can only inherit a protocol from the route itself, and a route-level `api`
  outranks every other model on that route.
- **The harness consumes only the static bundle.** `builtinProviders` / `getBuiltinModels` are read
  from the installed `pi-ai` build; there is no refresh path from a running session into that
  catalog. The refresh machinery exists upstream and is not wired into the pinned build.

So the honest thing a session *can* do is compare, name the ids, and print the one shape of
configuration that works today — while saying plainly which part of it the two lists cannot decide.

## Install

```sh
npm install --save-dev @argszero/cordis-plugin-model-catalog-gap
```

then mount it (`cordis.patch.yml`):

```yaml
- insert:
    - id: model-catalog-gap
      name: '@argszero/cordis-plugin-model-catalog-gap'
```

## What it answers

The tool is called `model_catalog_gap`. One required argument, `provider` — the route key as
configured, e.g. `opencode-go`. Everything else is optional.

```jsonc
{ "provider": "opencode-go", "baseURL": "https://provider.example/v1" }
```

```
Model catalog gap for route "opencode-go".

  routable now      4   (what this harness accepts for the route)
  provider list     6   (what the endpoint reports about itself)

The provider offers 2 model(s) this route cannot accept:
  brand-new-flash
  brand-new-pro

These are not merely missing from a picker. The route resolves a model id out of
its installed catalog before dispatch, and an id that is not there fails the call
with UNKNOWN_MODEL before a single byte leaves the process. Naming one as the
session's model is a request that can never succeed, on any endpoint.
...
```

| verdict | meaning |
|---------|---------|
| `not-asked` | no `baseURL` was given, so only the route's own list is known |
| `in-sync` | both lists agree — this route is not why a model is missing |
| `provider-newer` | the provider offers ids this route cannot accept (**the #8227 case**) |
| `harness-newer` | this route accepts ids the provider no longer reports |
| `divergent` | each side has ids the other lacks |

Pass `model` to have one id placed explicitly on both lists — `usable` / `retired` / `unroutable` /
`unknown` — which is what separates "this model is gone" from "this list is old".

`api` and `apiKey` are forwarded to the endpoint interrogation when given. `apiKey` is used for that
one request and is never stored, logged, or echoed into the report.

## How the comparison is possible at all

Two public seams on the `llm` service, both used as published:

- **`listModels(provider)`** — the route's own list. This is the same list every selector is built
  from and the same list the request path validates against, so it is the right thing to compare.
- **`discoverModels(settingsNs, request, signal)`** — the provider's list, asked with the endpoint
  and **without the route name**. That omission is the whole reason the comparison works: a
  discovery request that *names* a route is answered from the adapter's own registry on purpose
  (its answer carries capacities no listing endpoint reports), so only a request naming none reaches
  the network.

The settings namespace is read from `listConfigurableProviders()` rather than assumed, so a
deployment that mounts the adapter under another namespace is still served.

## What it deliberately does not do

- It writes no configuration and edits no file. The remedy it prints is configuration the *user*
  applies, because the real cure — a catalog that refreshes — is an adapter change.
- It does not guess a wire protocol. Neither list discloses one, so the report presents both shapes
  (add the ids to the route when it speaks one protocol; add a sibling route that declares the
  protocol when it speaks several) and hands the decision over. A wrong protocol fails at request
  time, which is worse than saying so.
- It cannot make the catalog live, and says so on every report rather than implying the gap is
  fixed.

## Compatibility

Published as `@argszero/cordis-plugin-model-catalog-gap@0.1.0`.

```jsonc
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.2",
  "@deepseek-ai/dsh-llm": ">=0.1.2-rc.1 <0.2.0 || >=0.1.3-alpha.2 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-alpha.1 <0.2.0 || >=0.1.7-alpha.1 <0.2.0 || >=0.2.0-rc.1 <0.2.0",
  "@deepseek-ai/dsh-tools": ">=0.1.2-rc.1 <0.2.0 || >=0.1.3-alpha.2 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-alpha.1 <0.2.0 || >=0.1.7-alpha.1 <0.2.0 || >=0.2.0-rc.1 <0.2.0"
}
```

The floors are `0.1.2-rc.1` (`listModels`), `0.1.3-alpha.2`, `0.1.5-alpha.1`, `0.1.6-alpha.1`,
`0.1.7-alpha.1` and `0.2.0-rc.1`. Probed and passing: `0.1.2-rc.1`, `0.1.3-alpha.2`, `0.1.5-rc.3`,
`0.1.6-alpha.2`, `0.1.7-rc.1`, `0.1.7-rc.2` and `0.2.0-rc.1` — the newest published build of each
line, plus the **0.1.7** and **0.2.0** release candidates. Each probe installs that line and runs the
whole suite on it (`npm run test:probe-lines`); a line that fails is removed from the range rather
than left claimed.

The last `||` segment is not decoration. npm admits a prerelease only when a comparator in the same
`major.minor.patch` tuple also carries one, so `>=0.1.7-alpha.1 <0.2.0` matches final `0.2.0`'s
predecessors **not at all** — without the segment, everyone on the newest line installs this package
with an unmet-peer warning. Node `^22.19 || >=24`.

## Tests

```sh
npm test                # build + 43 arms: pure comparison, report rendering, mount/registry integration, packaging
npm run test:inject     # defect injection: mutate the source, rebuild, require the suite to catch it
npm run test:probe-lines  # install each claimed peer line and run the suite on it
```

The suites mount a **real** cordis context and the **real** `dsh-tools` registry, and stand in only
for the `llm` service — whose *answers* are the plugin's entire input. No test contacts a network.

## License

MIT
