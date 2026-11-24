'use strict';

// Features register themselves on the single bot router. Order matters only for /help text.
module.exports = {
  all: [
    require('./basic')
  ]
};
