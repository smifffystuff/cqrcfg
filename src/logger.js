import { join } from 'path';
import pino from 'pino';
import { config } from './config.js';

const TRANSPORT_ALIASES = {
  'log4js': './src/transports/log4js.js',
  'winston': './src/transports/winston.js',
  'generic': './src/transports/generic.js',
};

function resolveTarget(target) {
  target = TRANSPORT_ALIASES[target] || target;
  if (target.startsWith('./') || target.startsWith('../')) {
    return join(process.cwd(), target);
  }
  return target;
}

function buildTransportOptions() {
  const target = process.env.LOG_TRANSPORT;
  if (!target) return undefined;

  return {
    target: resolveTarget(target),
    options: JSON.parse(process.env.LOG_TRANSPORT_OPTIONS || '{}'),
  };
}

export const loggerConfig = {
  level: config.logLevel,
  transport: buildTransportOptions(),
};

export const logger = pino(loggerConfig);
