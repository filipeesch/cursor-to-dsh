# Spec Delta

## MODIFIED Requirements

### Requirement: The model table is driven by the live catalog

The page SHALL list every model the provider advertises on one line per model, ordered alphabetically by display name, with its display name and the controls that model's own catalog entry supports, rendered as inline segmented controls: a context selector only when the entry publishes context tiers, and a Fast control only when it publishes that parameter. The page SHALL NOT require opening a model to reach those controls. For a model the catalog does not describe, the page SHALL offer enablement and a context window only, and SHALL mark the model as not described by the catalog. When the catalog cannot be read, the page SHALL state that the list is unavailable instead of presenting cached content as current.

#### Scenario: A model publishes tiers

- **WHEN** a model's catalog entry publishes context tiers
- **THEN** the page renders an inline context selector listing exactly those tiers plus an automatic choice
- **AND** the automatic choice resolves to the largest offered tier

#### Scenario: A model publishes no Fast parameter

- **WHEN** a model's catalog entry publishes no Fast parameter
- **THEN** the page offers no Fast control for that model

#### Scenario: The list is ordered

- **WHEN** the catalog lists several models
- **THEN** the page lists them alphabetically by display name
- **AND** a model added later sorts into place without a code change

#### Scenario: The catalog does not describe the model

- **WHEN** the catalog lists a model but publishes no parameters or variants for it
- **THEN** the page offers only enablement and a context window for it
- **AND** marks it as not described by the catalog

#### Scenario: The catalog cannot be read

- **WHEN** the catalog request fails or no credential is configured
- **THEN** the page states that the model list is unavailable
- **AND** the API key field remains usable
