const { handler } = require('../lib/http');
const { getForum } = require('../lib/nivut');

module.exports = handler(() => getForum());
