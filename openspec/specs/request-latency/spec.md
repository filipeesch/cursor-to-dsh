# request-latency Specification

## Purpose
Defines what the plugin may wait on before a call produces its first output, how it delivers an unchanged conversation incrementally, and how it surfaces a provider run that stops producing content.

## Requirements

### Requirement: A call never waits for the model catalog

Preparing a call SHALL NOT perform a model catalog request on the request path. The plugin SHALL use the last known catalog and refresh it outside the call.

#### Scenario: The catalog is stale

- **WHEN** a call starts and the cached catalog is past its freshness window
- **THEN** the call starts immediately from the cached catalog
- **AND** the catalog refresh completes without delaying that call

#### Scenario: The catalog is being refreshed

- **WHEN** a background refresh is in flight and another call starts
- **THEN** that call also starts immediately from the cached catalog

### Requirement: Only new conversation content is sent

When the host sends a conversation the provider has already seen, the plugin SHALL send only the content the provider has not seen. The plugin SHALL resend the full transcript only when the provider's view of the conversation no longer matches what the host sends.

#### Scenario: A follow-up turn in the same host session

- **WHEN** the host sends a conversation whose earlier messages are unchanged and appends one user message
- **THEN** only the appended content reaches the provider
- **AND** the same provider session continues

#### Scenario: The conversation was compacted

- **WHEN** the host rewrites earlier messages so the provider's view no longer matches
- **THEN** the full transcript is resent on a fresh provider session

### Requirement: Parallel tool calls of one provider turn reach the host together

The plugin SHALL deliver all tool calls produced by one provider turn to the host together, and SHALL hold that delivery for no more than a fixed handoff budget of 100 milliseconds after the provider produced the last of them. The budget covers both collecting sibling calls and any attempt to catch the turn's usage report.

#### Scenario: Two tool calls in one turn

- **WHEN** the provider produces two tool calls a few milliseconds apart in the same turn
- **THEN** the host receives both in a single delivery
- **AND** the second call is not delayed beyond the handoff budget

#### Scenario: No usage report is coming

- **WHEN** no usage report arrives for the turn
- **THEN** the tool calls are still delivered inside the handoff budget
- **AND** the missing report does not extend the delay

### Requirement: A stalled provider run is surfaced, not waited on indefinitely

When a provider run produces no content for the configured inactivity window, the plugin SHALL end the call with a terminal error that names the stall, and SHALL record a diagnostic describing the run. The terminal error code SHALL NOT be one the host retries automatically.

#### Scenario: The run goes silent

- **WHEN** a run produces no content for longer than the configured inactivity window
- **THEN** the call ends with a terminal error whose message identifies the inactivity
- **AND** a diagnostic is recorded with the provider session, model and elapsed time

#### Scenario: Only keep-alives arrive

- **WHEN** the provider sends keep-alive signals but no content for longer than the inactivity window
- **THEN** the call ends with the same terminal error

#### Scenario: Content resumes in time

- **WHEN** content resumes before the inactivity window elapses
- **THEN** the call continues normally and no error is recorded

### Requirement: The inactivity window is configurable

The plugin SHALL expose the inactivity window as a configuration value, and the default SHALL be finite so a stalled run cannot block a call forever.

#### Scenario: Default configuration

- **WHEN** no inactivity window is configured
- **THEN** a finite default applies

#### Scenario: An explicit window is configured

- **WHEN** the configuration sets the inactivity window
- **THEN** the stall error is raised at that elapsed time
