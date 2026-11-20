# Spec Delta

## MODIFIED Requirements

### Requirement: The page reads the catalog through an authenticated Host route

The page SHALL read the model catalog from a route served by the plugin. The route SHALL delegate its Host/Origin trust fence and browser-session authentication to the Host's own admission, SHALL require an admitted peer before it answers, and SHALL refuse a caller that is not the Host's owner. The route SHALL fail closed when the Host cannot establish an identity, answering no catalog data. The response SHALL be JSON containing no credential, key or other secret material. The route SHALL apply admission before it considers the request method, SHALL be answered only for reads, and SHALL be absent when the Host serves no web carrier.

#### Scenario: An authenticated read succeeds

- **WHEN** the page requests the catalog with the browser session the product issued
- **THEN** the route obtains an admission decision for the request before it answers
- **AND** the route answers the catalog with each model's parameters and variants

#### Scenario: An unauthenticated request is refused

- **WHEN** a request reaches the route without the browser session
- **THEN** admission refuses it
- **AND** no catalog data is returned

#### Scenario: A request from an untrusted origin is refused

- **WHEN** a request reaches the route from an authority or origin the Host does not trust
- **THEN** the route refuses it
- **AND** no catalog data is returned

#### Scenario: The Host cannot establish an identity

- **WHEN** the route cannot obtain an admission decision, because the Host exposes no admission, or admission fails
- **THEN** the route refuses the request rather than assuming an owner
- **AND** no catalog data is returned

#### Scenario: An unsupported method from an unauthenticated caller

- **WHEN** a request other than a read arrives without a browser session
- **THEN** the route refuses it on admission rather than reporting the method as unsupported
- **AND** the answer is the admission refusal, not a method description

#### Scenario: An admitted caller that does not own the Host is refused

- **WHEN** the Host admits a caller whose identity is not the Host's owner
- **THEN** the route refuses the request
- **AND** no catalog data is returned

#### Scenario: Admission carries no peer

- **WHEN** the route runs for a request whose admission produced no peer
- **THEN** the route refuses the request
- **AND** no catalog data is returned

#### Scenario: The payload carries no secrets

- **WHEN** the route answers
- **THEN** the payload contains no API key, credential value or token

#### Scenario: A non-read method is refused

- **WHEN** a request other than a read reaches the route
- **THEN** the route refuses it and returns no catalog data

### Requirement: The model table is driven by the live catalog

The page SHALL list every model the provider advertises on one line per model, ordered alphabetically by display name, with its display name and the controls that model's own catalog entry supports, rendered as inline segmented controls: a context selector only when the entry publishes context tiers, and a Fast control only when it publishes that parameter. The page SHALL NOT require opening a model to reach those controls. For a model the catalog does not describe, the page SHALL offer enablement and a context window only, and SHALL mark the model as not described by the catalog. When the catalog cannot be read, the page SHALL state that the list is unavailable instead of presenting cached content as current, and SHALL name the condition behind the failure so the reader can act on it, keeping the reported status available for diagnosis.

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

- **WHEN** the catalog request fails
- **THEN** the page states that the model list is unavailable
- **AND** the API key field remains usable

#### Scenario: The failure names the condition

- **WHEN** the catalog route refuses or fails a read
- **THEN** the page names the condition behind that failure in words a reader can act on
- **AND** keeps the reported status available for diagnosis
- **AND** does not present any previously read catalog as current

#### Scenario: A reload fails after a successful read

- **WHEN** the page has shown a catalog and a later reload fails
- **THEN** the page stops describing the previous catalog
- **AND** reports the condition instead, without a model count for rows it is no longer showing
