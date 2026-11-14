# usage-reporting Specification

## Purpose
Defines the token usage and context pressure the plugin reports to the host for each model call, so the host's throughput, usage and context meters describe one request. The provider reports once per run, over every call the run served, and the plugin normalizes that report to a single request.

## Requirements

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

The plugin SHALL NOT scale, replace or derive any reported bucket from a character-based or heuristic token estimate. Dividing a provider report by the number of model calls the run observed is not an estimate: both operands are facts the provider or the session produced.

#### Scenario: A run with several model turns

- **WHEN** a call follows four earlier calls of the same provider run
- **THEN** its buckets are the provider's report divided by five
- **AND** no bucket is adjusted toward a character-based context size

### Requirement: Context pressure comes from the last real report

The context pressure the host derives for a call SHALL be based on that call's own prompt-side buckets, so occupancy reflects a real request rather than a forecast.

#### Scenario: The conversation is compacted between calls

- **WHEN** the host compacts the conversation and the next call completes with a smaller prompt
- **THEN** the reported occupancy follows that call's prompt-side buckets

#### Scenario: A call reports no usage

- **WHEN** a call ends without a provider usage report
- **THEN** that call contributes no occupancy sample, rather than a fabricated one

### Requirement: Waiting for a per-turn report is bounded

The plugin SHALL report at most one provider report per call, and SHALL accept a report only after the open call has produced content of its own turn. A report that arrives while no call is open, or before the open call has produced any content, belongs to a turn that is already closed and SHALL be discarded. When a call ends without an accepted report, the plugin SHALL report no usage for that call. The plugin SHALL NOT reserve any part of a tool-call delivery for a report: a report is reported only when it has already arrived before the call ends.

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
- **THEN** the handoff happens with no time reserved for a report
- **AND** the call reports no usage rather than delaying the host

#### Scenario: The final answer needs no extra wait

- **WHEN** the provider run has ended and the call is assembling the final answer
- **THEN** any report for that turn has already been delivered, so the call reports it without waiting

#### Scenario: A tool turn that never reports

- **WHEN** a call ends by handing tool calls to the host and the provider had not reported usage for it
- **THEN** that call reports no usage
- **AND** the plugin does not defer the report to a later call
