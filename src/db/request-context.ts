import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tx } from './client.js';

export interface Actor {
  userId: string;
  clientId: string | null;
  scopes: readonly string[];
}

export interface RequestContext extends Actor {
  tx: Tx;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runInContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext {
  const context = storage.getStore();
  if (!context) throw new Error('No request context. Wrap the call in runAsUser().');
  return context;
}
