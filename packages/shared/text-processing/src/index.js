'use strict';

module.exports = {
  ...require('./pipeline'),
  ...require('./punctuation'),
  ...require('./fillers'),
  ...require('./backtracking'),
  ...require('./formatting'),
  ...require('./dev-terms'),
  ...require('./mishears'),
  ...require('./dictionary'),
  ...require('./snippets'),
  ...require('./style'),
  ...require('./fuzzy'),
};
