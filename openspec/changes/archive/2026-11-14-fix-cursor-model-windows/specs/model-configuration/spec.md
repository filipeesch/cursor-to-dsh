# Spec Delta

## MODIFIED Requirements

### Requirement: A published capacity is a fallback the request path never waits for

When the provider publishes no context tier for a model, the plugin SHALL fall back to a capacity published in a public upstream model catalog, refreshed out of band and persisted across restarts. User-facing surfaces SHALL identify that value as a published capacity rather than a capacity measured from the provider. When candidates disagree for the same model, the plugin SHALL prefer the capacity published by the model's own vendor provider, and when no vendor provider carries the model SHALL use the capacity most candidates declare, preferring the larger on a tie. A configuration value SHALL disable the upstream fetch; while it is disabled the plugin SHALL use only manual values and the documented default. The plugin SHALL NOT wait for the upstream catalog on any request path and SHALL continue without it when the fetch fails.

#### Scenario: The upstream catalog describes the model

- **WHEN** the provider publishes no tier for a model and the upstream catalog publishes a capacity for it
- **THEN** the plugin advertises that capacity and identifies it as published upstream

#### Scenario: The upstream catalog is unavailable

- **WHEN** the fetch fails, times out or is disabled
- **THEN** the plugin advertises manual values and the documented default
- **AND** no request path waits for the fetch

#### Scenario: Candidates disagree

- **WHEN** the upstream catalog publishes different capacities for the same model id across providers
- **THEN** the plugin uses the capacity published by the model's own vendor provider
- **AND** when no vendor provider carries the model, it uses the capacity most candidates declare, preferring the larger on a tie

#### Scenario: A third party declares a smaller variant

- **WHEN** a provider that is not the model's vendor publishes a reduced-window variant of it
- **THEN** that capacity does not replace the vendor's own capacity
