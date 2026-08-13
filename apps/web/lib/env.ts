/**
 * env.ts — parse USER_N_* and WS_*_* environment variables into typed structures.
 *
 * Expected format:
 *   USER_1_NAME="Alice"
 *   USER_1_TOKEN="tok_abc123"
 *   USER_1_WORKSPACES="acme,beta"
 *
 *   WS_ACME_NAME="Acme Corp"
 *   WS_ACME_LINEAR_KEY="lin_api_..."
 */

export interface Workspace {
  /** Slug used as the workspace ID in tool calls (e.g. "acme") */
  id: string
  /** Human-readable display name */
  name: string
  /** Linear API key for this workspace */
  linearApiKey: string
}

export interface AuthenticatedUser {
  name: string
  workspaces: Workspace[]
}

/** Build a map of all configured workspaces keyed by their slug. */
function parseWorkspaces(): Record<string, Workspace> {
  const workspaces: Record<string, Workspace> = {}

  for (const [key, value] of Object.entries(process.env)) {
    // Match WS_<SLUG>_NAME where slug is uppercase letters, digits, underscores
    const match = key.match(/^WS_([A-Z0-9_]+)_NAME$/)
    if (!match || !value) continue

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rawSlug = match[1]! // e.g. "ACME" or "BETA_PROJECT"
    const wsId = rawSlug.toLowerCase().replace(/_/g, "-") // "acme" or "beta-project"
    const prefix = `WS_${rawSlug}`
    const linearApiKey = process.env[`${prefix}_LINEAR_KEY`]

    if (!linearApiKey) {
      console.warn(
        `[env] Missing ${prefix}_LINEAR_KEY for workspace "${wsId}" — skipping`
      )
      continue
    }

    workspaces[wsId] = { id: wsId, name: value, linearApiKey }
  }

  return workspaces
}

/**
 * Authenticate a Bearer token and return the user with their accessible workspaces.
 * Returns null if the token is missing or doesn't match any configured user.
 */
export function authenticateToken(
  token: string | undefined
): AuthenticatedUser | null {
  if (!token) return null

  const allWorkspaces = parseWorkspaces()

  // Walk USER_1_, USER_2_, … until a gap is found
  for (let i = 1; i <= 100; i++) {
    const name = process.env[`USER_${i}_NAME`]
    const storedToken = process.env[`USER_${i}_TOKEN`]
    const workspacesStr = process.env[`USER_${i}_WORKSPACES`]

    // Stop at the first missing block
    if (!name || !storedToken) break

    if (storedToken !== token) continue

    const workspaceSlugs = workspacesStr
      ? workspacesStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    const workspaces = workspaceSlugs
      .map((slug) => allWorkspaces[slug])
      .filter((ws): ws is Workspace => ws !== undefined)

    return { name, workspaces }
  }

  return null
}
