import build from 'pino-abstract-transport';

const PINO_TO_METHOD = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export default async function (opts = {}) {
  const modulePath = opts.module;
  if (!modulePath) {
    throw new Error('generic transport requires "module" in LOG_TRANSPORT_OPTIONS');
  }

  const mod = await import(modulePath);
  const exportName = opts.export || 'logger';
  const extLogger = mod[exportName];

  if (!extLogger) {
    throw new Error(`generic transport: export "${exportName}" not found in module "${modulePath}"`);
  }

  return build(async function (source) {
    for await (const obj of source) {
      let method = PINO_TO_METHOD[obj.level] || 'info';

      // Fall back if the target logger doesn't have the exact method
      if (typeof extLogger[method] !== 'function') {
        method = method === 'fatal' ? 'error' : 'info';
      }
      if (typeof extLogger[method] !== 'function') continue;

      const msg = obj.msg || '';
      const { level: _l, time: _t, pid: _p, hostname: _h, msg: _m, ...rest } = obj;
      const hasExtra = Object.keys(rest).length > 0;

      if (hasExtra) {
        extLogger[method](msg, rest);
      } else {
        extLogger[method](msg);
      }
    }
  });
}
