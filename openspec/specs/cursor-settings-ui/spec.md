# cursor-settings-ui Specification

## Purpose
Defines the Cursor configuration page the plugin contributes to the product's Plugins settings: where it lives, how the API key is stored, how the catalog drives the per-model controls, and how the page reads the live catalog without exposing secrets.

## Requirements

### Requirement: The plugin carries its own Cursor configuration page

The plugin SHALL contribute a configuration page for its own row in Settings → Plugins, reached through a Configure control on that row's page, and SHALL provide a one-line summary on the row page. The page SHALL replace the generic configuration page generated from the plugin's configuration schema. The page SHALL exist only while the plugin row is loaded and enabled.

#### Scenario: The row offers Configure

- **WHEN** the user opens the plugin's bundle page and its row is loaded
- **THEN** the row offers a Configure control that opens the Cursor configuration page

#### Scenario: The generic page is not offered

- **WHEN** the Cursor configuration page is registered
- **THEN** the product does not additionally render its generic configuration page for that row

#### Scenario: The row is disabled

- **WHEN** the plugin row is disabled or unloaded
- **THEN** no Configure control or configuration page is offered

### Requirement: The Cursor provider is configured only from that page

The plugin SHALL NOT be listed as a configurable provider on the product's Models settings page. The provider SHALL remain selectable for conversations and SHALL count as a usable provider when first-run readiness is evaluated.

#### Scenario: Models settings page

- **WHEN** the user opens Settings → Models
- **THEN** no Cursor row is listed
- **AND** the Cursor route is still offered when a conversation selects a provider

#### Scenario: First-run readiness

- **WHEN** the only usable provider is Cursor
- **THEN** the product does not prompt for another provider's credential

### Requirement: The API key is stored as a credential from the page

The page SHALL offer a single masked API key field with reveal and save controls. A submitted key SHALL be written as a credential under the reference the plugin configuration names, or the conventional reference when it names none. The page SHALL show whether that credential is configured without reading its value back, SHALL never render a stored key, and SHALL report a host refusal instead of claiming success.

#### Scenario: A key is submitted

- **WHEN** the user types a key and saves
- **THEN** the key is stored as a credential under the reference in effect
- **AND** the field is cleared and the page reports the credential as configured

#### Scenario: A stored key is never rendered

- **WHEN** the page is opened while a key is already stored
- **THEN** the field is empty and the page reports only that the credential is configured

#### Scenario: The host refuses the write

- **WHEN** the credential write is refused
- **THEN** the page shows the host diagnostic and does not report the credential as configured

#### Scenario: Nothing is submitted

- **WHEN** the field is empty and the user saves
- **THEN** no credential write is issued

### Requirement: The model table is driven by the live catalog

The page SHALL list every model the provider advertises on one line per model, with its display name and the controls that model's own catalog entry supports, rendered as inline segmented controls: a context selector only when the entry publishes context tiers, and a Fast control only when it publishes that parameter. The page SHALL NOT require opening a model to reach those controls. For a model the catalog does not describe, the page SHALL offer enablement and a context window only, and SHALL mark the model as not described by the catalog. When the catalog cannot be read, the page SHALL state that the list is unavailable instead of presenting cached content as current.

#### Scenario: A model publishes tiers

- **WHEN** a model's catalog entry publishes context tiers
- **THEN** the page renders an inline context selector listing exactly those tiers plus an automatic choice
- **AND** the automatic choice resolves to the largest offered tier

#### Scenario: A model publishes no Fast parameter

- **WHEN** a model's catalog entry publishes no Fast parameter
- **THEN** the page offers no Fast control for that model

#### Scenario: The catalog does not describe the model

- **WHEN** the catalog lists a model but publishes no parameters or variants for it
- **THEN** the page offers only enablement and a context window for it
- **AND** marks it as not described by the catalog

#### Scenario: The catalog cannot be read

- **WHEN** the catalog request fails or no credential is configured
- **THEN** the page states that the model list is unavailable
- **AND** the API key field remains usable

### Requirement: Per-model settings are saved as configuration and reversible

The page SHALL persist, per model, enablement, the selected context tier, the context window and the Fast override, writing each change through after a short debounce and without an explicit save control. The page SHALL NOT show an in-flight indicator for those writes. Clearing a value SHALL restore inheritance from the wildcard entry, the global preference, the published capacity or the documented default, as applicable. A refused write SHALL roll the control back to the accepted value and SHALL show the refusal. The new-model default SHALL be written the same way.

#### Scenario: A per-model value is saved

- **WHEN** the user changes a model's tier
- **THEN** the stored configuration carries that tier for that model
- **AND** the page offers no Save button for it

#### Scenario: A value is cleared

- **WHEN** the user selects the automatic tier for a model
- **THEN** the stored entry no longer carries that field
- **AND** the model follows the global preference again

#### Scenario: An invalid value is refused

- **WHEN** a submitted value fails host validation
- **THEN** the page shows the refusal
- **AND** the control returns to the accepted value
- **AND** the stored configuration is unchanged

### Requirement: The new-model default is configurable

The page SHALL offer the choice of whether a model with no configuration entry is enabled, with enabled as the default. Changing it SHALL change the advertised catalog for every model without an entry and SHALL NOT change a model that carries an explicit entry.

#### Scenario: The default is enabled

- **WHEN** a model with no entry appears in the catalog
- **THEN** it is advertised and shown as enabled

#### Scenario: The default is disabled

- **WHEN** the default is disabled and a model has no entry
- **THEN** it is not advertised and the page shows it as disabled until enabled

#### Scenario: An explicit entry survives a default change

- **WHEN** the default changes and a model carries an explicit enablement value
- **THEN** that model keeps its own value

### Requirement: The page reads the catalog through an authenticated Host route

The page SHALL read the model catalog from a route served by the plugin, which SHALL apply the same Host/Origin trust fence and browser-session authentication as the product's own API routes. The response SHALL be JSON containing no credential, key or other secret material. The route SHALL be absent when the Host serves no web carrier.

#### Scenario: An authenticated read succeeds

- **WHEN** the page requests the catalog with the browser session the product issued
- **THEN** the route answers the catalog with each model's parameters and variants

#### Scenario: An unauthenticated request is refused

- **WHEN** a request reaches the route without the browser session
- **THEN** the route refuses it and returns no catalog data

#### Scenario: The payload carries no secrets

- **WHEN** the route answers
- **THEN** the payload contains no API key, credential value or token

### Requirement: Context provenance is visible

For each model the page SHALL state where the advertised context window comes from: the provider's own tier, a capacity published upstream, a manual value, or the documented default. The page SHALL describe a published upstream capacity as a published value, not as a capacity measured from the provider.

#### Scenario: The window comes from the provider

- **WHEN** the model publishes context tiers
- **THEN** the page attributes the window to the selected tier

#### Scenario: The window comes from upstream

- **WHEN** the model publishes no tier and the upstream catalog publishes a capacity
- **THEN** the page attributes the window to the upstream catalog
- **AND** does not present it as measured from the provider

#### Scenario: The window comes from a manual value

- **WHEN** neither a tier nor a published capacity applies and a manual value is set
- **THEN** the page attributes the window to the manual value

#### Scenario: The window is the default

- **WHEN** nothing describes the model
- **THEN** the page attributes the window to the documented default

### Requirement: Saving applies without restarting the plugin

A save from the page SHALL take effect on the next request without remounting the plugin, and SHALL NOT abort a provider run already in progress.

#### Scenario: The next request uses the saved value

- **WHEN** the user saves a per-model or global setting and then sends a message
- **THEN** the next request uses the saved value

#### Scenario: A run in progress survives a save

- **WHEN** a Cursor run is in progress and the user saves a setting
- **THEN** the run continues and is not restarted
