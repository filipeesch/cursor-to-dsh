# Spec Delta

## MODIFIED Requirements

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
