/**
 * status.ts — turns the environment into a checklist for the status page.
 *
 * Every workspace is probed with a real `tools/list` against Linear's MCP: one
 * request that proves the whole chain at once — the key is valid, Linear is
 * reachable, and that workspace really exposes tools.
 *
 * The page is unauthenticated and public, so a check carries two texts: a
 * `detail` that names nothing, and an optional `named` shown only to a caller
 * holding a valid token. Names and workspace slugs are not secrets on the level
 * of a key, but they identify people and are the exact values the `workspace`
 * argument takes — no reason to hand them to whoever finds the URL.
 */

import { describeConfiguration, type Configuration } from "@/lib/env"
import { listUpstreamTools } from "@/lib/upstream-mcp"

export type CheckLevel = "ok" | "warn" | "error"

interface RawCheck {
  label: string
  level: CheckLevel
  detail: string
  named?: string
}

export interface Check {
  label: string
  level: CheckLevel
  detail: string
}

export interface StatusReport {
  level: CheckLevel
  checks: Check[]
  /** True when the caller authenticated and is seeing names and slugs. */
  detailed: boolean
  /** False while nothing is configured, when there is nothing to hide yet. */
  redacted: boolean
}

function envVarName(workspaceId: string, suffix: string): string {
  return `WS_${workspaceId.toUpperCase().replace(/-/g, "_")}_${suffix}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
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

function checkUsers(config: Configuration): RawCheck[] {
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

  const checks: RawCheck[] = []
  const reachable = config.users.filter((u) => !u.unreachable)
  const unreachable = config.users.filter((u) => u.unreachable)

  checks.push({
    label: "Team members",
    level: reachable.length > 0 ? "ok" : "error",
    detail:
      reachable.length > 0
        ? `${plural(reachable.length, "member", "members")} configured.`
        : "Every user block sits after a gap, so none of them can authenticate.",
    named:
      reachable.length > 0
        ? `${reachable.length} configured: ${reachable.map((u) => u.name).join(", ")}.`
        : undefined,
  })

  if (unreachable.length > 0) {
    checks.push({
      label: "Unreachable user blocks",
      level: "error",
      detail:
        `${plural(unreachable.length, "user block is", "user blocks are")} ignored: the numbering ` +
        `must run 1, 2, 3… with no gaps, and authentication stops at the first missing block.`,
      named:
        `USER_${unreachable.map((u) => u.index).join(", USER_")} ` +
        `${unreachable.length === 1 ? "is" : "are"} ignored: the numbering must run 1, 2, 3… ` +
        `with no gaps, and authentication stops at the first missing block.`,
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
        `${plural(dangling.length, "reference points", "references point")} at a slug with no ` +
        `WS_* block. Those are silently dropped, so the user simply will not see that workspace.`,
      named:
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
      detail: `${plural(noAccess.length, "member has", "members have")} no workspace to act on. Set USER_N_WORKSPACES.`,
      named: `${noAccess.map((u) => u.name).join(", ")}: authenticated but no workspace to act on. Set USER_N_WORKSPACES.`,
    })
  }

  return checks
}

export async function buildStatusReport(
  options: { detailed: boolean } = { detailed: false }
): Promise<StatusReport> {
  const config = describeConfiguration()
  const raw: RawCheck[] = [...checkUsers(config)]

  // Nothing configured yet means nothing to redact, and this is exactly when
  // the visitor needs the instructions most.
  const nothingConfigured =
    config.users.length === 0 && config.workspaces.length === 0
  const detailed = options.detailed || nothingConfigured

  if (config.workspaces.length === 0) {
    raw.push({
      label: "Linear workspaces",
      level: "error",
      detail:
        "No WS_<SLUG>_NAME / WS_<SLUG>_LINEAR_KEY found. Add one block per Linear workspace.",
    })
  } else {
    const missingName = config.workspaces.filter((w) => !w.name)
    const missingKey = config.workspaces.filter((w) => !w.hasKey)

    raw.push({
      label: "Linear workspaces",
      level: missingKey.length > 0 ? "error" : "ok",
      detail: `${plural(config.workspaces.length, "workspace", "workspaces")} configured.`,
      named: `${config.workspaces.length} configured: ${config.workspaces.map((w) => w.id).join(", ")}.`,
    })

    if (missingKey.length > 0) {
      raw.push({
        label: "Missing API keys",
        level: "error",
        detail: `${plural(missingKey.length, "workspace has", "workspaces have")} no API key set.`,
        named: `${missingKey.map((w) => envVarName(w.id, "LINEAR_KEY")).join(", ")} not set.`,
      })
    }

    if (missingName.length > 0) {
      raw.push({
        label: "Missing workspace names",
        level: "warn",
        detail:
          `${plural(missingName.length, "workspace has", "workspaces have")} a key but no name, ` +
          `and a workspace without a name is skipped entirely.`,
        named:
          `${missingName.map((w) => envVarName(w.id, "NAME")).join(", ")} not set. ` +
          `A workspace without a name is skipped entirely.`,
      })
    }

    const probes = await Promise.all(
      config.workspaces
        .filter((w) => w.hasKey && w.name)
        .map((w) =>
          probeWorkspace(w.id, process.env[envVarName(w.id, "LINEAR_KEY")]!)
        )
    )

    const failed = probes.filter((p) => !p.ok)
    const passed = probes.filter((p) => p.ok)

    if (probes.length > 0) {
      raw.push({
        label: "Linear connection",
        level: failed.length === 0 ? "ok" : "error",
        detail:
          failed.length === 0
            ? `All ${probes.length} responding.`
            : `${passed.length} of ${probes.length} responding.`,
        // Tool counts differ by Linear plan, so they hint at the plan tier.
        named:
          passed.length > 0
            ? `${passed.map((p) => `${p.id} (${p.toolCount} tools)`).join(", ")} responding.`
            : "No workspace could reach Linear's MCP server.",
      })
    }

    if (failed.length > 0) {
      const refused = failed.filter(
        (p) => p.error?.includes("401") || p.error?.includes("403")
      )
      raw.push({
        label: "Rejected workspaces",
        level: "error",
        detail:
          refused.length === failed.length
            ? `${plural(failed.length, "API key was", "API keys were")} refused by Linear. ` +
              `Generate new ones under Settings → API → Personal API keys.`
            : `${plural(failed.length, "workspace", "workspaces")} could not reach Linear.`,
        named: failed
          .map(
            (p) =>
              `"${p.id}": ${
                p.error?.includes("401") || p.error?.includes("403")
                  ? "Linear refused the API key."
                  : (p.error ?? "unknown error")
              }`
          )
          .join(" "),
      })
    }
  }

  const level: CheckLevel = raw.some((c) => c.level === "error")
    ? "error"
    : raw.some((c) => c.level === "warn")
      ? "warn"
      : "ok"

  return {
    level,
    detailed,
    redacted: !detailed && raw.some((c) => c.named !== undefined),
    checks: raw.map((c) => ({
      label: c.label,
      level: c.level,
      detail: detailed ? (c.named ?? c.detail) : c.detail,
    })),
  }
}
