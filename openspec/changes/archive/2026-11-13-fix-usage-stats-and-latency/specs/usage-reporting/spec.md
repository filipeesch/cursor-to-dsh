# Spec Delta

## Purpose

Defines the token usage and context pressure the plugin reports to the host for each model call, so the host's throughput, usage and context meters show what the provider actually billed for that call.

## ADDED Requirements

### Requirement: Usage is attributed to the call that produced it

The plugin SHALL report token usage for the model call that just finished, taken from the provider's own per-turn report for that call. The plugin SHALL NOT report, for one call, a total accumulated over several provider turns.

#### Scenario: A provider run spans several tool round trips

- **WHEN** one provider run performs four model turns, each ending with a tool call, and a fifth ending with a final answer
- **THEN** each of the five calls reports only the tokens billed for its own turn
- **AND** the final call does not carry the tokens of the four earlier turns

#### Scenario: The provider reports nothing for a turn

- **WHEN** a turn completes without a provider usage report
- **THEN** that call reports no usage at all
- **AND** the plugin does not substitute an estimate, and does not carry that turn's tokens into a later call

### Requirement: Usage buckets are reported as the provider states them

The plugin SHALL report prompt-side and completion tokens in the disjoint buckets the provider states, and SHALL omit a combined total.

#### Scenario: The provider bills cache traffic

- **WHEN** the provider reports uncached input tokens, cache-read tokens and cache-write tokens for one turn
- **THEN** each bucket reaches the host unchanged
- **AND** the sum of the three prompt-side buckets equals the prompt total the provider reported
- **AND** no combined total token field is emitted

#### Scenario: The host reconciles the buckets

- **WHEN** the host compares a reported total with the sum of the buckets
- **THEN** the plugin has emitted no total, so the host keeps the bucket values

### Requirement: Prompt buckets are never rescaled from an estimate

The plugin SHALL NOT scale, replace or derive any reported prompt-side bucket from a character-based or heuristic token estimate.

#### Scenario: A run with several model turns

- **WHEN** a call follows four earlier turns of the same provider run
- **THEN** its prompt-side buckets are the provider's values for that turn
- **AND** no bucket is adjusted toward an estimated context size

### Requirement: Context pressure comes from the last real report

The context pressure the host derives for a call SHALL be based on that call's own prompt-side buckets, so occupancy reflects a real request rather than a forecast.

#### Scenario: The conversation is compacted between calls

- **WHEN** the host compacts the conversation and the next call completes with a smaller prompt
- **THEN** the reported occupancy follows that call's prompt-side buckets

#### Scenario: A call reports no usage

- **WHEN** a call ends without a provider usage report
- **THEN** that call contributes no occupancy sample, rather than a fabricated one

### Requirement: Waiting for a per-turn report is bounded

The plugin SHALL report at most one provider report per call, and SHALL accept a report only after the open call has produced content of its own turn. A report that arrives while no call is open, or before the open call has produced any content, belongs to a turn that is already closed and SHALL be discarded. When a call ends without an accepted report, the plugin SHALL report no usage for that call and SHALL NOT wait for one beyond the handoff budget.

#### Scenario: The report arrives with the turn it belongs to

- **WHEN** the provider's usage report for a turn arrives after that turn's content
- **THEN** the call ends carrying that usage

#### Scenario: The report arrives after the call closed

- **WHEN** the provider's usage report arrives while no call is open, such as during the host's tool execution
- **THEN** the report is discarded
- **AND** no later call reports it

#### Scenario: The previous turn's report arrives after the next call opened

- **WHEN** the report for turn N arrives after the call for turn N+1 has opened but before that call has produced any of its own content
- **THEN** the report is discarded
- **AND** the call for turn N+1 reports only its own report, or nothing when the provider sends none

#### Scenario: A late report never delays the host's tools

- **WHEN** a call is ready to hand tool calls to the host and no report has arrived
- **THEN** the handoff happens within its budget
- **AND** the call reports no usage rather than delaying the host

#### Scenario: The final answer needs no extra wait

- **WHEN** the provider run has ended and the call is assembling the final answer
- **THEN** any report for that turn has already been delivered, so the call reports it without waiting
