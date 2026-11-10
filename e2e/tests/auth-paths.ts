import { fileURLToPath } from 'node:url'

/** Cookies after signing in through Authelia (deployed envs only). */
export const authFile = fileURLToPath(new URL('../playwright/.auth/user.json', import.meta.url))
