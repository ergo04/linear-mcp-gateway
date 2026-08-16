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

import { timingSafeEqual } from "node:crypto"

export interface Workspace {
  /** Slug used as the workspace ID in tool calls (e.g. "acme") */
  id: string
  /** Human-readable display name */
  name: string
  /** Linear API key for this workspace */
  linearApiKey: string
}

export interface AuthenticatedUser {
  /** The USER_N index — the only stable id a user has in an env-var config. */
  id: number
  name: string
  workspaces: Workspace[]
}

/** Turn the env var slug into the workspace ID used in tool calls. */
function slugToId(rawSlug: string): string {
  return rawSlug.toLowerCase().replace(/_/g, "-")
}

/** Build a map of all configured workspaces keyed by their slug. */
function parseWorkspaces(): Record<string, Workspace> {
  const workspaces: Record<string, Workspace> = {}

  for (const [key, value] of Object.entries(process.env)) {
    // Match WS_<SLUG>_NAME where slug is uppercase letters, digits, underscores
    const match = key.match(/^WS_([A-Z0-9_]+)_NAME$/)
    if (!match || !value) continue

    const rawSlug = match[1]! // e.g. "ACME" or "BETA_PROJECT"
    const wsId = slugToId(rawSlug) // "acme" or "beta-project"
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

// --------------------------------------------------------------------------
// Configuration introspection — powers the status page.
//
// Deliberately reports presence and validity only, never a value: the page is
// served by a deployment whose whole job is holding these secrets.
// --------------------------------------------------------------------------

export interface ConfiguredWorkspace {
  id: string
  /** Null when only WS_<SLUG>_LINEAR_KEY is set and the NAME is missing. */
  name: string | null
  hasKey: boolean
}

export interface ConfiguredUser {
  index: number
  name: string
  workspaces: { slug: string; known: boolean }[]
  /** True when an earlier USER_N block is missing, making this one unreachable. */
  unreachable: boolean
}

export interface Configuration {
  users: ConfiguredUser[]
  workspaces: ConfiguredWorkspace[]
}

export function describeConfiguration(): Configuration {
  const slugs = new Set<string>()
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^WS_([A-Z0-9_]+)_(NAME|LINEAR_KEY)$/)
    if (match) slugs.add(match[1]!)
  }

  const workspaces = [...slugs]
    .map((rawSlug) => ({
      id: slugToId(rawSlug),
      name: process.env[`WS_${rawSlug}_NAME`] || null,
      hasKey: Boolean(process.env[`WS_${rawSlug}_LINEAR_KEY`]),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const knownIds = new Set(workspaces.map((w) => w.id))
  const users: ConfiguredUser[] = []

  // authenticateToken() stops at the first gap, so a USER_3 without a USER_2 is
  // silently never matched. Scan past the gap to be able to say so.
  let gapSeen = false
  for (let i = 1; i <= 100; i++) {
    const name = process.env[`USER_${i}_NAME`]
    const token = process.env[`USER_${i}_TOKEN`]

    // Any incomplete block is where authenticateToken() stops, so everything
    // after it is unreachable — including a block that is itself complete.
    if (!name || !token) {
      gapSeen = true
      continue
    }

    users.push({
      index: i,
      name,
      workspaces: (process.env[`USER_${i}_WORKSPACES`] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((slug) => ({ slug, known: knownIds.has(slug) })),
      unreachable: gapSeen,
    })
  }

  return { users, workspaces }
}

interface UserBlock {
  index: number
  name: string
  token: string
  workspaceSlugs: string[]
}

function readUserBlock(index: number): UserBlock | null {
  const name = process.env[`USER_${index}_NAME`]
  const token = process.env[`USER_${index}_TOKEN`]
  if (!name || !token) return null

  return {
    index,
    name,
    token,
    workspaceSlugs: (process.env[`USER_${index}_WORKSPACES`] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

function resolveUser(block: UserBlock): AuthenticatedUser {
  const allWorkspaces = parseWorkspaces()

  return {
    id: block.index,
    name: block.name,
    workspaces: block.workspaceSlugs
      .map((slug) => allWorkspaces[slug])
      .filter((ws): ws is Workspace => ws !== undefined),
  }
}

/** Compare in constant time: this runs on every request, against a secret. */
function tokensMatch(stored: string, presented: string): boolean {
  const a = Buffer.from(stored)
  const b = Buffer.from(presented)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Authenticate a Bearer token and return the user with their accessible workspaces.
 * Returns null if the token is missing or doesn't match any configured user.
 */
export function authenticateToken(
  token: string | undefined
): AuthenticatedUser | null {
  if (!token) return null

  // Walk USER_1_, USER_2_, … until a gap is found
  for (let i = 1; i <= 100; i++) {
    const block = readUserBlock(i)
    if (!block) break

    if (tokensMatch(block.token, token)) return resolveUser(block)
  }

  return null
}

/**
 * Look a user up by index, for credentials that carry one instead of a token.
 * Walks from the start so it stops at the same gap authenticateToken() does —
 * otherwise a user made unreachable by a deleted block would keep working
 * through any long-lived credential already issued to them.
 */
export function authenticateUserIndex(
  index: number
): { user: AuthenticatedUser; token: string } | null {
  for (let i = 1; i <= 100; i++) {
    const block = readUserBlock(i)
    if (!block) break

    if (i === index) return { user: resolveUser(block), token: block.token }
  }

  return null
}
