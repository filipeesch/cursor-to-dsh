/**
 * Stable identifiers shared by both halves of the plugin.
 *
 * The route path and the conventional credential reference are also read by the browser bundle, so
 * they live in a module with no runtime dependency on either side.
 */

/** Provider route id: the value DSH uses for `provider` in requests and model listings. */
export const PROVIDER_ID = "cursor";

/** npm package name: the browser half registers under it and the row key starts with it. */
export const PACKAGE_NAME = "cursor-to-dsh";

/** Credential reference used when the configuration names none. */
export const DEFAULT_KEY_REF = "CURSOR_API_KEY";

/** Authenticated route that serves the live catalog to the configuration page. */
export const CATALOG_PATH = "/cursor-to-dsh/catalog.json";

/** Row id the bundled patch mounts: the default key of the page's Configure registration. */
export const DEFAULT_ROW_ID = "llm-cursor";
