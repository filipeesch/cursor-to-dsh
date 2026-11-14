# Spec Delta

## Purpose

Records what one model step costs in the plugin's own terms — time spent in each stage, streamed volume, the collection window in effect and the provider's usage report when it arrives — so the turn cycle can be verified against real traffic.

## ADDED Requirements

### Requirement: Telemetry is off unless configured

The plugin SHALL record step telemetry only when its configuration enables it, and the default SHALL be off. With telemetry disabled the plugin SHALL NOT attach a per-update listener for it and SHALL NOT write records.

#### Scenario: Default configuration

- **WHEN** telemetry is not configured
- **THEN** no record is produced and no telemetry listener is attached

#### Scenario: Telemetry is enabled

- **WHEN** the configuration enables telemetry
- **THEN** the plugin writes one record per completed step

### Requirement: One record describes the plugin's own view of a step

A record SHALL describe one host model call and SHALL include: whether the provider session was created or reused; the time spent before the provider was asked; the time to the first delivered content; the time to the tool-call delivery or to the end of the call; the collection window in effect; the number of tool calls delivered; the conversation bytes sent for that call; the number of streamed text and reasoning chunks; whether a sibling call arrived after the delivery; and the provider's usage report when that call carried one.

#### Scenario: A step that ends by handing tool calls to the host

- **WHEN** a step ends by delivering tool calls
- **THEN** the record carries the delivery time, the collection window in effect and how many calls were delivered

#### Scenario: A step that ends with an answer

- **WHEN** the provider run ends with an answer
- **THEN** the record carries the time to the end of the call and the usage report when one arrived

#### Scenario: A sibling arrives after the delivery

- **WHEN** a tool call is registered after that turn's delivery
- **THEN** the following step's record shows the arrival and the window it prompted

### Requirement: Telemetry never changes a call

Recording SHALL NOT delay, block, fail or alter a call, and a record that cannot be written SHALL be skipped without affecting the call.

#### Scenario: The state directory is unwritable

- **WHEN** a record cannot be written
- **THEN** the call completes unaffected and the next call proceeds normally

#### Scenario: The provider reports nothing

- **WHEN** a step carries no usage report
- **THEN** the record omits usage and carries no estimate in its place
