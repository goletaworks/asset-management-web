// backend/config_test_algorithm.js
// Configuration for TEST algorithm tab visibility

/**
 * TEST_TAB_ENABLED controls whether the TEST tab appears in the Optimization section.
 *
 * When enabled (true):
 * - TEST tab appears as the first tab in optimization.html
 * - Users can upload Excel files with test repair data
 * - Test data overrides normal repair data flow through all optimization algorithms
 *
 * When disabled (false):
 * - TEST tab is hidden from the UI
 * - Normal optimization workflow using getAllRepairs() data
 *
 * Set to false in production to hide TEST functionality from end users.
 */
const { getFeatureFlags } = require('./feature_flags');
const TEST_TAB_ENABLED = getFeatureFlags().testTabEnabled;

module.exports = {
  TEST_TAB_ENABLED
};
