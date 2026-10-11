import type { SerenadaLogLevel, SerenadaLogger } from './types.js';

/** Default logger that writes to the browser console. Pass to {@link SerenadaConfig.logger} for debug output. */
export class ConsoleSerenadaLogger implements SerenadaLogger {
    log(level: SerenadaLogLevel, tag: string, message: string): void {
        const formatted = `[${tag}] ${message}`;
        switch (level) {
            case 'debug': console.debug(formatted); break;
            case 'info': console.info(formatted); break;
            case 'warning': console.warn(formatted); break;
            case 'error': console.error(formatted); break;
        }
    }
}
