import type { DatabaseClient } from './database.ts';

export interface ApplicationContext {
  request: Request;
  requestId?: string;
}

export function createApplication(options: {
  db: DatabaseClient;
  origin: string | (() => string | undefined);
}): (context: ApplicationContext) => Promise<Response>;
