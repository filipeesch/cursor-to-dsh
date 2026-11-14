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

The plugin SHALL deliver the tool calls produced by one provider turn to the host in a single delivery when they arrive as one burst, and SHALL NOT hold a delivery for a fixed period. A delivery SHALL wait no longer than an adaptive collection window that starts at zero, SHALL grow for a model only after a sibling call has been observed arriving after that model's delivery, SHALL grow only to a size that would have covered the observed gap, and SHALL never exceed a ceiling of 50 milliseconds. The collection window SHALL NOT reserve any time for a usage report.

#### Scenario: Two tool calls in one turn

- **WHEN** the provider produces two tool calls in one burst before the plugin delivers them
- **THEN** the host receives both in a single delivery
- **AND** neither call waits for a fixed collection period

#### Scenario: A single tool call

- **WHEN** a turn produces one tool call and no other call is pending
- **THEN** the plugin delivers it without a fixed collection delay

#### Scenario: A sibling misses the delivery

- **WHEN** the provider produces a sibling tool call after that turn's calls were delivered
- **THEN** later turns of that model may hold delivery for up to a window that would have covered the observed gap, bounded by the ceiling
- **AND** the window does not grow when the observed gap would exceed the ceiling

#### Scenario: No usage report is coming

- **WHEN** no usage report has arrived by the time the tool calls are ready
- **THEN** the calls are delivered without waiting for one
- **AND** the missing report does not extend the delivery

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

### Requirement: A tool call that arrives after the delivery is carried by the next call

The plugin SHALL deliver a tool call that arrives after its turn's delivery to the host on the next call, SHALL keep the provider run that produced it open, and SHALL NOT resend the conversation or start a new provider run to recover it.

#### Scenario: A sibling arrives while the host executes the previous delivery

- **WHEN** a sibling tool call is registered while the host is executing the previously delivered calls
- **THEN** the next call delivers that sibling to the host as that call's tool call
- **AND** the conversation is not resent and the provider run is not restarted

#### Scenario: The host returns the sibling's result

- **WHEN** the host returns the result of a tool call delivered in that next call
- **THEN** the same provider run continues with the result
- **AND** no provider request is sent for it

### Requirement: The provider SDK is warmed without a user call

The plugin SHALL warm the provider SDK in the background when it is applied, whenever a credential and a known model are available, without waiting for a live model catalog fetch. The plugin SHALL skip warm-up when warm-up is disabled, and a failed warm-up SHALL NOT affect a call.

#### Scenario: Applied with a credential and a persisted catalog

- **WHEN** the plugin is applied and a credential and a persisted catalog snapshot are available
- **THEN** warm-up starts without waiting for a live catalog fetch

#### Scenario: Warm-up is disabled

- **WHEN** warm-up is disabled by the operator
- **THEN** no warm-up agent is created

#### Scenario: Warm-up fails

- **WHEN** the warm-up attempt fails
- **THEN** the failure is ignored and the first call proceeds normally
