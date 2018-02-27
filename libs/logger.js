const bunyan = require('bunyan');
const cluster = process.env.CLUSTER_NAME;
var log = bunyan.createLogger({
  name: cluster,
  streams: [
    {
      level: 'info',
      stream: process.stdout            // log INFO and above to stdout
    }
  ]
});

module.exports = log;
