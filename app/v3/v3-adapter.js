(function () {
  'use strict';
  /*
   * V3 adapter boundary.
   * All UI and feature behavior lives in V3-native runtime modules.
   * This file intentionally does not load or bridge the legacy application.
   */
  window.HaressV3Adapter = Object.freeze({
    runtime: 'native',
    ready: true
  });
})();