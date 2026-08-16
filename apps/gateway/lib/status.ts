/**
 * status.ts — turns the environment into a checklist for the status page.
 *
 * Every workspace is probed with a real `tools/list` against Linear's MCP: one
 * request that proves the whole chain at once — the key is valid, Linear is
 * reachable, and that workspace really exposes tools.
 */

import { describeConfiguration, type Configuration } from "@/lib/env"
import { listUpstreamTools } from "@/lib/upstream-mcp"

export type CheckLevel = "ok" | "warn" | "error"

export interface Check {
  label: string
  level: CheckLevel
  detail: string
}

export interface StatusReport {
  level: CheckLevel
  checks: Check[]
  /** Tool count for the first reachable workspace, once everything is wired up. */
  toolCount: number | null
}

async function probeWorkspace(
  id: string,
  apiKey: string
): Promise<{ id: string; ok: boolean; toolCount: number; error?: string }> {
  try {
    const tools = await listUpstreamTools(apiKey)
    return { id, ok: true, toolCount: tools.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { id, ok: false, toolCount: 0, error: message }
  }
}

function checkUsers(config: Configuration): Check[] {
  const checks: Check[] = []

  if (config.users.length === 0) {
    return [
      {
        label: "Team members",
        level: "error",
        detail:
          "No USER_1_NAME / USER_1_TOKEN found. Nobody can authenticate until at least one user block exists.",
      },
    ]
  }

  const reachable = config.users.filter((u) => !u.unreachable)
  const unreachable = config.users.filter((u) => u.unreachable)

  checks.push({
    label: "Team members",
    level: reachable.length > 0 ? "ok" : "error",
    detail:
      reachable.length > 0
        ? `${reachable.length} configured: ${reachable.map((u) => u.name).join(", ")}.`
        : "Every user block sits after a gap, so none of them can authenticate.",
  })

  if (unreachable.length > 0) {
    checks.push({
      label: "Unreachable user blocks",
      level: "error",
      detail:
        `USER_${unreachable.map((u) => u.index).join(", USER_")} ` +
        `${unreachable.length === 1 ? "is" : "are"} ignored: the numbering must run 1, 2, 3… with no gaps, ` +
        `and authentication stops at the first missing block.`,
    })
  }

  const dangling = config.users.flatMap((u) =>
    u.workspaces.filter((w) => !w.known).map((w) => `${u.name} → "${w.slug}"`)
  )
  if (dangling.length > 0) {
    checks.push({
      label: "Unknown workspace references",
      level: "warn",
      detail:
        `${dangling.join(", ")}. These slugs have no WS_* block, so they are silently dropped ` +
        `and the user simply will not see that workspace.`,
    })
  }

  const noAccess = config.users.filter(
    (u) => !u.unreachable && u.workspaces.filter((w) => w.known).length === 0
  )
  if (noAccess.length > 0) {
    checks.push({
      label: "Users without workspaces",
      level: "warn",
      detail: `${noAccess.map((u) => u.name).join(", ")}: authenticated but no workspace to act on. Set USER_N_WORKSPACES.`,
    })
  }

  return checks
}

export async function buildStatusReport(): Promise<StatusReport> {
  const config = describeConfiguration()
  const checks: Check[] = [...checkUsers(config)]

  if (config.workspaces.length === 0) {
    checks.push({
      label: "Linear workspaces",
      level: "error",
      detail:
        "No WS_<SLUG>_NAME / WS_<SLUG>_LINEAR_KEY found. Add one block per Linear workspace.",
    })
    return { level: "error", checks, toolCount: null }
  }

  const missingName = config.workspaces.filter((w) => !w.name)
  const missingKey = config.workspaces.filter((w) => !w.hasKey)

  checks.push({
    label: "Linear workspaces",
    level: missingKey.length > 0 ? "error" : "ok",
    detail: `${config.workspaces.length} configured: ${config.workspaces.map((w) => w.id).join(", ")}.`,
  })

  if (missingKey.length > 0) {
    checks.push({
      label: "Missing API keys",
      level: "error",
      detail: `${missingKey.map((w) => `WS_${w.id.toUpperCase().replace(/-/g, "_")}_LINEAR_KEY`).join(", ")} not set.`,
    })
  }

  if (missingName.length > 0) {
    checks.push({
      label: "Missing workspace names",
      level: "warn",
      detail:
        `${missingName.map((w) => `WS_${w.id.toUpperCase().replace(/-/g, "_")}_NAME`).join(", ")} not set. ` +
        `A workspace without a name is skipped entirely.`,
    })
  }

  const probes = await Promise.all(
    config.workspaces
      .filter((w) => w.hasKey && w.name)
      .map((w) =>
        probeWorkspace(
          w.id,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          process.env[`WS_${w.id.toUpperCase().replace(/-/g, "_")}_LINEAR_KEY`]!
        )
      )
  )

  const failed = probes.filter((p) => !p.ok)
  const passed = probes.filter((p) => p.ok)

  if (probes.length > 0) {
    checks.push({
      label: "Linear connection",
      level: failed.length === 0 ? "ok" : "error",
      detail:
        passed.length > 0
          ? `${passed.map((p) => `${p.id} (${p.toolCount} tools)`).join(", ")} responding.`
          : "No workspace could reach Linear's MCP server.",
    })
  }

  for (const probe of failed) {
    checks.push({
      label: `Workspace "${probe.id}" rejected`,
      level: "error",
      detail:
        probe.error?.includes("401") || probe.error?.includes("403")
          ? `Linear refused the API key. Generate a new one under Settings → API → Personal API keys.`
          : (probe.error ?? "Unknown error"),
    })
  }

  const level: CheckLevel = checks.some((c) => c.level === "error")
    ? "error"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok"

  return { level, checks, toolCount: passed[0]?.toolCount ?? null }
}
