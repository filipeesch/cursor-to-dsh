# Spec Delta

## REMOVED Requirements

### Requirement: Max mode is explicit and never implied

**Reason**: Cursor removed Max Mode from the model picker for usage-based pricing; the same context windows are selectable directly, the 20% upcharge was removed for those plans, and Max Mode remains only on legacy request-based plans. The plugin's route authenticates with an API key, so refusing the largest tier unless a Max Mode policy allowed it capped requests at 300k/272k while 1M cost the same.

**Migration**: Delete `maxMode` and any per-model `maxMode` from the configuration. The largest offered tier is now requested by default, and a specific tier is chosen with `context` (globally) or `models["<id>"].context` (per model). No Max Mode flag is sent.

## MODIFIED Requirements

### Requirement: The requested context tier is configurable and defaults to the largest offered

The plugin SHALL request the largest context tier the model offers by default. A global preference SHALL select the largest or the smallest offered tier. A per-model value SHALL select a specific tier for that model and SHALL take precedence over the global preference. When the provider rejects the selected tier, the plugin SHALL retry with the next smaller offered tier and remember the accepted tier for that model across process restarts.

#### Scenario: Default configuration

- **WHEN** no context tier is configured and the model offers several tiers
- **THEN** the largest offered tier is requested

#### Scenario: A tier is rejected

- **WHEN** the provider rejects the requested tier
- **THEN** the plugin retries once with the next smaller offered tier
- **AND** records the accepted tier so the same model does not repeat the rejection after a restart

#### Scenario: A specific tier is configured

- **WHEN** the configuration names one offered tier for a model
- **THEN** that tier is requested for that model instead of the global preference

#### Scenario: A global preference selects the smallest tier

- **WHEN** the global preference selects the smallest tier and the model offers several tiers
- **THEN** the smallest offered tier is requested
