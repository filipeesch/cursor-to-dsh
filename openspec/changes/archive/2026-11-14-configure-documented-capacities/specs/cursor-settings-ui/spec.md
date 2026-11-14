# Spec Delta

## MODIFIED Requirements

### Requirement: Context provenance is visible

For each model the page SHALL make where the advertised context window comes from available on the control that shows it — the provider's own tier, a capacity published upstream, a manual value, a provider-documented capacity or the documented default — as the control's tooltip and accessible name. The page SHALL NOT dedicate a separate label to provenance. When the value cannot be edited it SHALL be shown as a chip carrying the number only. The page SHALL describe a published upstream capacity as a published value, not as a capacity measured from the provider.

#### Scenario: The window comes from the provider

- **WHEN** the model publishes context tiers
- **THEN** the page attributes the window to the selected tier on the control's tooltip

#### Scenario: The window comes from upstream

- **WHEN** the model publishes no tier and the upstream catalog publishes a capacity
- **THEN** the page attributes the window to the upstream catalog
- **AND** does not present it as measured from the provider

#### Scenario: The window comes from a manual value

- **WHEN** neither a tier nor a published capacity applies and a manual value is set
- **THEN** the page attributes the window to the manual value

#### Scenario: The window comes from the provider's documentation

- **WHEN** neither a tier nor a published capacity applies and the provider documents a capacity for the model
- **THEN** the page shows that number in the model's window field
- **AND** attributes it to the provider's documentation on the tooltip

#### Scenario: The window is the default

- **WHEN** nothing describes the model
- **THEN** the page attributes the window to the documented default

#### Scenario: The row carries no provenance label

- **WHEN** the page renders a model row
- **THEN** the row shows the window value without a provenance label beside it
