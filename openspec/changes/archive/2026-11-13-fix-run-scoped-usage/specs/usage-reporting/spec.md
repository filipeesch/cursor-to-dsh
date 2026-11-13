# Spec Delta

## MODIFIED Requirements

### Requirement: Usage is attributed to the call that produced it

The provider reports usage once per run, accumulated over every model call that run made. The plugin SHALL report that run-scoped report once, on the call where it arrives, with every bucket divided by the number of model calls the run served, so the host receives one request's worth of usage rather than a run's total. A run that served one call SHALL be reported exactly. The plugin SHALL NOT report the run-scoped total as if it were one call's usage.

#### Scenario: A provider run spans several tool round trips

- **WHEN** one provider run serves four model calls and reports 40,000 prompt tokens and 400 completion tokens at its end
- **THEN** the call that receives the report reports 10,000 prompt tokens and 100 completion tokens
- **AND** the earlier calls of that run report no usage

#### Scenario: The provider reports nothing for a turn

- **WHEN** a run ends without a provider usage report
- **THEN** no call of that run reports usage
- **AND** the plugin does not substitute an estimate, and does not carry the run's tokens into a later call

### Requirement: Prompt buckets are never rescaled from an estimate

The plugin SHALL NOT scale, replace or derive any reported bucket from a character-based or heuristic token estimate. Dividing a provider report by the number of model calls the run observed is not an estimate: both operands are facts the provider or the session produced.

#### Scenario: A run with several model turns

- **WHEN** a call follows four earlier calls of the same provider run
- **THEN** its buckets are the provider's report divided by five
- **AND** no bucket is adjusted toward a character-based context size
