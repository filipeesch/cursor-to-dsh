# Spec Delta

## MODIFIED Requirements

### Requirement: The advertised context window follows the source that describes the model

The plugin SHALL advertise the context window that the provider will actually apply, including a tier the provider accepted after rejecting an earlier one. The plugin SHALL resolve the advertised window in this order: the context tier in effect for that model, then the capacity published upstream for that model, then a manual per-model value (the model's own entry, then the wildcard entry for unlisted models), then the capacity the provider documents for that model, then a documented default. The plugin SHALL NOT let a manual value override a provider tier or a published capacity, and SHALL NOT let the provider-documented capacity override a manual value. When no source describes the model, the plugin SHALL advertise the documented default and SHALL document that it is a default rather than a measured capacity.

#### Scenario: The provider rejected a larger tier

- **WHEN** a request was rejected for an unsupported context tier and the plugin retried with a smaller tier that succeeded
- **THEN** every later advertisement of that model's context window reports the accepted tier

#### Scenario: The model publishes a tier

- **WHEN** the model publishes context tiers and a manual per-model value is also configured
- **THEN** the plugin advertises the tokens of the tier in effect
- **AND** the manual value does not change the advertised window

#### Scenario: Published capacity covers a model without a tier

- **WHEN** the model publishes no context tier and the upstream catalog publishes a capacity for it
- **THEN** the plugin advertises that published capacity
- **AND** no manual value is required

#### Scenario: A manual value covers a model nothing describes

- **WHEN** the model publishes no context tier and no published capacity applies, and the configuration names a token count for that model
- **THEN** the model advertises the configured count

#### Scenario: The provider documents a capacity without publishing it

- **WHEN** the model publishes no context tier, no published capacity applies and the configuration names no value, and the provider's own documentation states a window for that model
- **THEN** the model advertises the documented capacity instead of the documented default
- **AND** a manual value still overrides it

#### Scenario: A wildcard covers the remaining unlisted models

- **WHEN** neither a tier nor a published capacity applies and the configuration sets a wildcard entry
- **THEN** the model advertises the wildcard count instead of the default

#### Scenario: Nothing describes the model

- **WHEN** no tier, published capacity, manual value or provider-documented capacity applies
- **THEN** the plugin advertises its documented default
- **AND** the documentation states that this value is a default, not a capacity reported by the provider
