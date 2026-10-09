/**
 * MyLogger-shaped logger: context, message, payload, error — error always last.
 * The browser console is the sink; nothing is swallowed silently.
 */
export class Logger {
  private constructor(private readonly context: string) {}

  static create(context: string): Logger {
    return new Logger(context);
  }

  info(message: string, payload?: Record<string, unknown>): void {
    console.info(`[${this.context}] ${message}`, payload ?? '');
  }

  warn(message: string, payload?: Record<string, unknown>, error?: unknown): void {
    console.warn(`[${this.context}] ${message}`, payload ?? '', error ?? '');
  }

  error(message: string, payload?: Record<string, unknown>, error?: unknown): void {
    console.error(`[${this.context}] ${message}`, payload ?? '', error ?? '');
  }
}
