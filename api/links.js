const { handler } = require('../lib/http');
const { PAGES } = require('../lib/nivut');

module.exports = handler(() => PAGES);
