const { handler } = require('../lib/http');
const { getNews } = require('../lib/nivut');

module.exports = handler(() => getNews());
