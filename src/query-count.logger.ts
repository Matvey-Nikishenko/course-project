import { AbstractLogger, LogLevel, LogMessage } from 'typeorm';

export class QueryCountLogger extends AbstractLogger {
  count = 0;
  echo = false;

  reset(): void {
    this.count = 0;
  }

  protected writeLog(_level: LogLevel, messages: LogMessage | LogMessage[]): void {
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      if (message.type === 'query') {
        this.count += 1;
        if (this.echo) {
          console.log(`  SQL#${this.count}: ${String(message.message).slice(0, 140)}`);
        }
      }
    }
  }
}
