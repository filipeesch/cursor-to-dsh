# Spec Delta

## Purpose

Defines how the plugin resolves the model parameters it sends to the provider and the model metadata it advertises to the host, so both the request and the host's model meter describe the same effective model configuration.

## ADDED Requirements

### Requirement: The advertised context window is the effective one

The plugin SHALL advertise the context window that the provider will actually apply, including a tier the provider accepted after rejecting an earlier one. The plugin SHALL advertise an explicit configured value when the configuration names one.

#### Scenario: The provider rejected a larger tier

- **WHEN** a request was rejected for an unsupported context tier and the plugin retried with a smaller tier that succeeded
- **THEN** every later advertisement of that model's context window reports the accepted tier

#### Scenario: The window is configured explicitly

- **WHEN** the configuration sets the reported context window to an explicit token count
- **THEN** the plugin advertises that count for the model, regardless of the tier the provider offers

### Requirement: The requested context tier is configurable and defaults to the largest offered

The plugin SHALL request the largest context tier the model offers by default. A configuration value SHALL select a specific tier. When the provider rejects the selected tier, the plugin SHALL retry with the next smaller offered tier and remember the accepted tier for that model across process restarts.

#### Scenario: Default configuration

- **WHEN** no context tier is configured and the model offers several tiers
- **THEN** the largest offered tier is requested

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
