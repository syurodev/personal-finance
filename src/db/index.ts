import { getEnv } from '../config/env.js';
import { createDb } from './client.js';

export const { db, pool } = createDb(getEnv().DATABASE_URL);
