import build from 'pino-abstract-transport';

const PINO_TO_WINSTON = {
  10: 'silly',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};

export default async function (opts = {}) {
  const winston = await import('winston');

  const transports = [];
  if (opts.transports) {
    for (const t of opts.transports) {
      if (t.type === 'file') {
        transports.push(new winston.default.transports.File(t.options || {}));
      } else if (t.type === 'console') {
        transports.push(new winston.default.transports.Console(t.options || {}));
      }
    }
  }
  if (transports.length === 0) {
    transports.push(new winston.default.transports.Console({ format: winston.default.format.simple() }));
  }

  const winstonLogger = winston.default.createLogger({
    level: opts.level || 'debug',
    format: opts.json ? winston.default.format.json() : winston.default.format.combine(
      winston.default.format.timestamp(),
      winston.default.format.simple()
    ),
    transports,
  });

  return build(async function (source) {
    for await (const obj of source) {
      const level = PINO_TO_WINSTON[obj.level] || 'info';
      const msg = obj.msg || '';
      const { level: _l, time: _t, pid: _p, hostname: _h, msg: _m, ...rest } = obj;
      const hasExtra = Object.keys(rest).length > 0;

      winstonLogger.log(level, msg, hasExtra ? rest : undefined);
    }
  }, { close: () => winstonLogger.close() });
}
