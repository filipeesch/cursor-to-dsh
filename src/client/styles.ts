/**
 * The page's stylesheet, injected once by the plugin and removed with it.
 *
 * Class names carry the plugin prefix so the rules cannot reach another surface, and colors and
 * type come from the product's theme tokens so light and dark both work without a theme branch.
 * The segmented controls come from the product's primitives and bring their own styles.
 */
export const STYLES = [
  ".ctd-page { display: flex; flex-direction: column; gap: 28px; padding: 8px 0 24px; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }",
  ".ctd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }",
  ".ctd-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }",
  ".ctd-intro { margin: 6px 0 0; max-width: 640px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }",
  ".ctd-section { display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: 12px; background: var(--dsw-alias-settings-card-fill); border: 0.5px solid var(--dsw-alias-settings-card-stroke); }",
  ".ctd-section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }",
  ".ctd-section-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }",
  ".ctd-section-note { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }",
  ".ctd-key { display: flex; flex-direction: column; gap: 10px; }",
  ".ctd-key-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
  ".ctd-input { box-sizing: border-box; min-width: 220px; padding: 7px 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }",
  ".ctd-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }",
  ".ctd-key-input { flex: 1 1 320px; }",
  ".ctd-window-input { width: 140px; min-width: 0; }",
  ".ctd-button { padding: 6px 12px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }",
  ".ctd-button:disabled { opacity: 0.45; cursor: default; }",
  "@media (hover: hover) { .ctd-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); } }",
  ".ctd-button-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); border-color: transparent; }",
  "@media (hover: hover) { .ctd-button-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); } }",
  ".ctd-status { margin: 0; font-size: 12px; line-height: 18px; max-width: 40%; }",
  ".ctd-status-ok { color: var(--dsw-alias-state-success-primary); }",
  ".ctd-status-warn { color: var(--dsw-alias-state-warn-label); }",
  ".ctd-status-error { color: var(--dsw-alias-state-error-primary); }",
  ".ctd-status-dim { color: var(--dsw-alias-label-tertiary); }",
  ".ctd-models { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }",
  ".ctd-model { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); }",
  ".ctd-model:first-child { border-top: 0; }",
  ".ctd-model-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }",
  ".ctd-model-toggle { display: flex; align-items: center; gap: 8px; min-width: 200px; cursor: pointer; }",
  ".ctd-model-name { font-size: 13px; line-height: 18px; font-weight: 500; }",
  ".ctd-model-id { color: var(--dsw-alias-label-tertiary); font-family: var(--dsw-font-family-monospace, monospace); font-size: 11px; }",
  ".ctd-model-off .ctd-model-name, .ctd-model-off .ctd-model-id { color: var(--dsw-alias-label-dimmed); }",
  ".ctd-model-controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding-left: 24px; }",
  ".ctd-control { display: flex; align-items: center; gap: 8px; }",
  ".ctd-control-label { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }",
  ".ctd-chip { padding: 2px 8px; border-radius: 999px; border: 0.5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }",
  ".ctd-note { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }",
  ".ctd-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }",
  ".ctd-check-label { font-size: 13px; line-height: 18px; }",
  ".ctd-alert { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }",
].join("\n");
