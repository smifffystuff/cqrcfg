import build from 'pino-abstract-transport';

const PINO_TO_LOG4JS = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export default async function (opts = {}) {
  const log4js = await import('log4js');

  const config = opts.config || { appenders: { out: { type: 'stdout' } }, categories: { default: { appenders: ['out'], level: 'trace' } } };
  log4js.default.configure(config);

  const category = opts.category || 'default';
  const log4jsLogger = log4js.default.getLogger(category);

  return build(async function (source) {
    for await (const obj of source) {
      const level = PINO_TO_LOG4JS[obj.level] || 'info';
      const msg = obj.msg || '';
      const { level: _l, time: _t, pid: _p, hostname: _h, msg: _m, ...rest } = obj;
      const hasExtra = Object.keys(rest).length > 0;

      if (hasExtra) {
        log4jsLogger[level](msg, rest);
      } else {
        log4jsLogger[level](msg);
      }
    }
  }, { close: () => log4js.default.shutdown() });
}
