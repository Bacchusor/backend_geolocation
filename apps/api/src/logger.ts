import pino, { type Logger } from 'pino';
import type { Config } from './config.js';

export type { Logger };

/** Structured JSON logs to stdout. Coordinates must be rounded by callers (see roundCoord). */
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'LOG_PRETTY'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'req.headers.cookie',
        'token',
        '*.token',
        'password',
        '*.password',
      ],
      censor: '[redacted]',
    },
    ...(config.LOG_PRETTY
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}
