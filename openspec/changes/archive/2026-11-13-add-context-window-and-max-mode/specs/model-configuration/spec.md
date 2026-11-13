# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
