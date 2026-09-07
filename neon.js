import { createClient } from '@neondatabase/neon-js';
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters';

const AUTH_URL = import.meta.env.VITE_NEON_AUTH_URL || 'https://ep-gentle-bonus-axjqgf5k.neonauth.c-4.us-east-2.aws.neon.tech/asl_learning/auth';
const DATA_URL = import.meta.env.VITE_NEON_DATA_API_URL || 'https://ep-gentle-bonus-axjqgf5k.apirest.c-4.us-east-2.aws.neon.tech/asl_learning/rest/v1';

export const neon = createClient({
  auth: {
    adapter: BetterAuthReactAdapter(),
    url: AUTH_URL,
  },
  dataApi: {
    url: DATA_URL,
  },
});
