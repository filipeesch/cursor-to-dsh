# model-configuration Specification

## Purpose
Defines how the plugin resolves the model parameters it sends to the provider and the model metadata it advertises to the host, so both the request and the host's model meter describe the same effective model configuration.

## Requirements

### Requirement: The advertised context window is the effective one

The plugin SHALL advertise the context window that the provider will actually apply, including a tier the provider accepted after rejecting an earlier one. When configuration supplies a value, the plugin SHALL advertise the most specific configured value that applies, in this order: an entry for that model, a wildcard entry for unlisted models, then a global configured value. When the provider publishes no tier for a model and no configured value applies, the plugin SHALL advertise a documented default and SHALL document that it is a default rather than a measured capacity.

#### Scenario: The provider rejected a larger tier

- **WHEN** a request was rejected for an unsupported context tier and the plugin retried with a smaller tier that succeeded
- **THEN** every later advertisement of that model's context window reports the accepted tier

#### Scenario: The window is configured explicitly

- **WHEN** the configuration sets a global context window to an explicit token count
- **THEN** the plugin advertises that count for every model without a more specific entry

#### Scenario: A model has its own window

- **WHEN** the configuration names a token count for a specific model
- **THEN** that model advertises the configured count
- **AND** the model's provider tier no longer decides the advertised value

#### Scenario: A wildcard covers the models the provider does not describe

- **WHEN** the provider publishes no context tier for a model and the configuration sets a wildcard entry
- **THEN** the model advertises the wildcard count instead of the default

#### Scenario: Nothing describes the model

- **WHEN** the provider publishes no context tier for a model and no configured value applies
- **THEN** the plugin advertises its documented default
- **AND** the documentation states that this value is a default, not a capacity reported by the provider

### Requirement: The requested context tier is configurable and defaults to the largest offered

The plugin SHALL request the largest context tier the model offers that the Max Mode policy allows by default. A configuration value SHALL select a specific tier. When the provider rejects the selected tier, the plugin SHALL retry with the next smaller offered tier and remember the accepted tier for that model across process restarts.

#### Scenario: Default configuration

- **WHEN** no context tier is configured, the model offers several tiers, and the Max Mode policy is off
- **THEN** the largest tier that does not require Max Mode is requested

#### Scenario: A tier is rejected

- **WHEN** the provider rejects the requested tier
- **THEN** the plugin retries once with the next smaller offered tier
- **AND** records the accepted tier so the same model does not repeat the rejection after a restart

#### Scenario: A specific tier is configured

- **WHEN** the configuration names an offered tier
- **THEN** that tier is requested instead of the default

### Requirement: Fast mode is configurable and off by default

The plugin SHALL expose a configuration option selecting the provider's priority-latency mode, with three states: off, on, and provider default. The default state SHALL be off. When the selected model offers no such control, the request SHALL proceed unchanged instead of failing.

#### Scenario: Default configuration

- **WHEN** no Fast mode is configured and the model offers the control
- **THEN** the request disables it, matching the plugin's previous behaviour

#### Scenario: Fast mode is enabled

- **WHEN** Fast mode is configured as on and the model offers the control
- **THEN** the request enables it

#### Scenario: The model has no such control

- **WHEN** Fast mode is configured as on and the model offers no such control
- **THEN** the request is sent without it and no error is raised

### Requirement: The default reasoning effort stays high where offered

When a model offers named effort levels, the plugin SHALL advertise `high` as its default effort if `high` is offered, otherwise the highest offered level. An explicit host-selected effort SHALL map to the nearest offered level that does not exceed it.

#### Scenario: The host selects no effort

- **WHEN** the host selects a model without choosing a reasoning effort and the model offers named levels
- **THEN** `high` is advertised as the default when the model offers it, otherwise the highest offered level

#### Scenario: The host selects an offered level

- **WHEN** the host selects a reasoning effort the provider offers
- **THEN** exactly that level is sent

#### Scenario: The host selects an unavailable level

- **WHEN** the host selects a reasoning effort the provider does not offer
- **THEN** the nearest offered level below it is sent

### Requirement: The route stays selectable without a live catalog

The plugin SHALL advertise a fallback model list whenever the provider catalog cannot be read, including when no credential is available, so the route remains selectable.

#### Scenario: The catalog cannot be read

- **WHEN** the catalog request fails
- **THEN** the fallback list is advertised and the route remains selectable

#### Scenario: No credential is available

- **WHEN** no credential can be resolved
- **THEN** the fallback list is advertised and no credential error is raised while advertising

### Requirement: The model catalog is served without blocking a request

The plugin SHALL prepare a call from the last known catalog without waiting for a catalog fetch, SHALL refresh the catalog in the background, and SHALL persist the last known catalog across process restarts.

#### Scenario: A cached catalog exists but is stale

- **WHEN** a call is prepared after the catalog's freshness window has elapsed
- **THEN** the call is prepared immediately from the cached catalog
- **AND** the refresh happens out of band

#### Scenario: No catalog has ever been read

- **WHEN** a call is prepared with neither a cached nor a live catalog and no credential
- **THEN** the call fails with the missing-credential error rather than waiting on a fetch

#### Scenario: The process restarts

- **WHEN** the plugin loads with a persisted catalog from a previous process
- **THEN** the first call is prepared from that catalog before any network access

### Requirement: Max mode is explicit and never implied

The plugin SHALL expose a Max Mode policy with three states: off, on, and provider-derived. The default SHALL be off. While the policy is off, the plugin SHALL NOT request a tier that the provider marks as requiring Max Mode, and SHALL NOT send a Max Mode flag. While the policy is on, the plugin SHALL request the largest offered tier and SHALL send the Max Mode flag. While the policy is provider-derived, the provider's own catalog SHALL decide whether the selected tier runs in Max Mode.

#### Scenario: Default configuration

- **WHEN** no Max Mode policy is configured and the model offers a tier that requires Max Mode and a tier that does not
- **THEN** the tier that does not require Max Mode is requested
- **AND** no Max Mode flag is sent

#### Scenario: Max Mode is enabled

- **WHEN** the policy is on and the model offers a tier that requires Max Mode
- **THEN** that tier is requested with the Max Mode flag set

#### Scenario: The policy is provider-derived

- **WHEN** the policy is provider-derived and the requested tier requires Max Mode
- **THEN** the provider's catalog decides whether the request runs in Max Mode

#### Scenario: The model publishes no Max Mode information

- **WHEN** the model's catalog entry carries no Max Mode marking
- **THEN** the policy does not change the request and no error is raised
