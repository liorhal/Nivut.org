const { handler } = require('../lib/http');
const { getEvents } = require('../lib/nivut');

module.exports = handler(() => getEvents());
