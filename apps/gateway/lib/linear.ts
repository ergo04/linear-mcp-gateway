/**
 * linear.ts — thin wrapper around the Linear SDK.
 *
 * Only what the custom tools in proxy-handler.ts need. Everything Linear's own
 * MCP already covers is proxied instead, so it has no wrapper here: the way to
 * read issues or projects is to call the upstream tool, not to add a function.
 *
 * Each exported function takes an `apiKey` (resolved from the user's workspace)
 * and the parameters needed for the operation.
 */

import { LinearClient } from "@linear/sdk"

// --------------------------------------------------------------------------
// Client cache — one LinearClient per API key, reused across requests in the
// same Node.js process lifetime (relevant for local dev / long-lived servers).
// --------------------------------------------------------------------------

const clientCache = new Map<string, LinearClient>()

function getClient(apiKey: string): LinearClient {
  let client = clientCache.get(apiKey)
  if (!client) {
    client = new LinearClient({ apiKey })
    clientCache.set(apiKey, client)
  }
  return client
}

// --------------------------------------------------------------------------
// Issues — read only, to report what a milestone deletion detaches
// --------------------------------------------------------------------------

export interface IssueSummary {
  id: string
  identifier: string
  title: string
  priority: number
  priorityLabel: string
  state: string
  assignee: string | null
  project: string | null
  projectId: string | null
  milestone: string | null
  milestoneId: string | null
  parent: string | null
  parentId: string | null
  url: string
  createdAt: string
  updatedAt: string
}

export interface ListIssuesParams {
  teamId?: string
  stateId?: string
  assigneeId?: string
  cycleId?: string
  projectId?: string
  /** Empty string matches issues with no milestone. */
  milestoneId?: string
  parentId?: string
  limit?: number
  after?: string
}

export interface ListIssuesResult {
  issues: IssueSummary[]
  hasNextPage: boolean
  endCursor: string | null
}

/** Linear caps connection page size at 250. */
export const MAX_PAGE_SIZE = 250

/**
 * Resolved in a single request rather than via the SDK's lazy relation getters:
 * `issue.state`/`assignee`/`project` each issue a separate query, so a 250-issue
 * page would cost ~750 requests against a 1500/hour budget.
 */
const LIST_ISSUES_QUERY = `
  query ListIssues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        priority
        priorityLabel
        url
        createdAt
        updatedAt
        state { name }
        assignee { name }
        project { id name }
        projectMilestone { id name }
        parent { id identifier }
      }
    }
  }
`

interface RawIssueNode {
  id: string
  identifier: string
  title: string
  priority: number
  priorityLabel: string
  url: string
  createdAt: string
  updatedAt: string
  state: { name: string } | null
  assignee: { name: string } | null
  project: { id: string; name: string } | null
  projectMilestone: { id: string; name: string } | null
  parent: { id: string; identifier: string } | null
}

export async function listIssues(
  apiKey: string,
  params: ListIssuesParams = {}
): Promise<ListIssuesResult> {
  const client = getClient(apiKey)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (params.teamId) filter["team"] = { id: { eq: params.teamId } }
  if (params.stateId) filter["state"] = { id: { eq: params.stateId } }
  if (params.assigneeId) filter["assignee"] = { id: { eq: params.assigneeId } }
  if (params.cycleId) filter["cycle"] = { id: { eq: params.cycleId } }
  if (params.projectId) filter["project"] = { id: { eq: params.projectId } }
  if (params.milestoneId !== undefined)
    filter["projectMilestone"] =
      params.milestoneId === ""
        ? { null: true }
        : { id: { eq: params.milestoneId } }
  if (params.parentId) filter["parent"] = { id: { eq: params.parentId } }

  const { data } = await client.client.rawRequest<
    {
      issues: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: RawIssueNode[]
      }
    },
    Record<string, unknown>
  >(LIST_ISSUES_QUERY, {
    first: Math.min(params.limit ?? 25, MAX_PAGE_SIZE),
    after: params.after,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
  })

  if (!data) throw new Error("Issue listing failed — no data returned")

  return {
    issues: data.issues.nodes.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      state: issue.state?.name ?? "Unknown",
      assignee: issue.assignee?.name ?? null,
      project: issue.project?.name ?? null,
      projectId: issue.project?.id ?? null,
      milestone: issue.projectMilestone?.name ?? null,
      milestoneId: issue.projectMilestone?.id ?? null,
      parent: issue.parent?.identifier ?? null,
      parentId: issue.parent?.id ?? null,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    })),
    hasNextPage: data.issues.pageInfo.hasNextPage,
    endCursor: data.issues.pageInfo.endCursor,
  }
}

// --------------------------------------------------------------------------
// Project milestones
// --------------------------------------------------------------------------

export interface MilestoneSummary {
  id: string
  name: string
  description: string | null
  targetDate: string | null
  /** Completion ratio in 0..1, derived by Linear from the milestone's issues. */
  progress: number
  status: string | null
  sortOrder: number
  project: string | null
  projectId: string | null
}

const MILESTONE_FIELDS = `
  id
  name
  description
  targetDate
  progress
  status
  sortOrder
  project { id name }
`

interface RawMilestoneNode {
  id: string
  name: string
  description: string | null
  targetDate: string | null
  progress: number
  status: string | null
  sortOrder: number
  project: { id: string; name: string } | null
}

function mapMilestone(m: RawMilestoneNode): MilestoneSummary {
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? null,
    targetDate: m.targetDate ?? null,
    progress: m.progress,
    status: m.status ?? null,
    sortOrder: m.sortOrder,
    project: m.project?.name ?? null,
    projectId: m.project?.id ?? null,
  }
}

export async function getMilestone(
  apiKey: string,
  milestoneId: string
): Promise<MilestoneSummary> {
  const client = getClient(apiKey)

  const { data } = await client.client.rawRequest<
    { projectMilestone: RawMilestoneNode },
    Record<string, unknown>
  >(
    `query GetProjectMilestone($id: String!) {
      projectMilestone(id: $id) { ${MILESTONE_FIELDS} }
    }`,
    { id: milestoneId }
  )

  if (!data?.projectMilestone)
    throw new Error(`Milestone "${milestoneId}" not found`)
  return mapMilestone(data.projectMilestone)
}

export interface SaveMilestoneParams {
  id?: string
  /** Required when creating; on update, moves the milestone to another project. */
  projectId?: string
  name?: string
  description?: string
  targetDate?: string
  sortOrder?: number
}

export async function saveMilestone(
  apiKey: string,
  params: SaveMilestoneParams
): Promise<MilestoneSummary> {
  const client = getClient(apiKey)

  if (params.id) {
    // Empty string clears the field; undefined leaves it untouched
    const update: Record<string, unknown> = {}
    if (params.name !== undefined) update["name"] = params.name
    if (params.description !== undefined)
      update["description"] = params.description
    if (params.targetDate !== undefined)
      update["targetDate"] = params.targetDate === "" ? null : params.targetDate
    if (params.sortOrder !== undefined) update["sortOrder"] = params.sortOrder
    if (params.projectId !== undefined) update["projectId"] = params.projectId

    if (Object.keys(update).length === 0)
      throw new Error("Nothing to update — pass at least one field to change")

    const payload = await client.updateProjectMilestone(params.id, update)
    const m = await payload.projectMilestone
    if (!m) throw new Error("Milestone update failed")
    return getMilestone(apiKey, m.id)
  }

  if (!params.name) throw new Error("`name` is required to create a milestone")
  if (!params.projectId)
    throw new Error("`projectId` is required to create a milestone")

  const payload = await client.createProjectMilestone({
    name: params.name,
    projectId: params.projectId,
    description: params.description,
    targetDate: params.targetDate || undefined,
    sortOrder: params.sortOrder,
  })
  const m = await payload.projectMilestone
  if (!m) throw new Error("Milestone creation failed")
  return getMilestone(apiKey, m.id)
}

export interface DeleteMilestoneResult {
  id: string
  name: string
  /** Issues that were on the milestone and are now unassigned from it. */
  detachedIssues: number
  /** True when more issues were detached than a single page could report. */
  detachedIssuesCapped: boolean
}

/**
 * Deleting a milestone leaves its issues in the project, unassigned from any
 * milestone. Name and issues are read first: the row is gone afterwards, and
 * reporting how many issues got detached is the only signal of the blast radius.
 */
/**
 * Deleting a milestone leaves its issues in the project, unassigned from any
 * milestone. Name and issues are read first: the row is gone afterwards, and
 * reporting how many issues got detached is the only signal of the blast radius.
 */
export async function deleteMilestone(
  apiKey: string,
  milestoneId: string
): Promise<DeleteMilestoneResult> {
  const client = getClient(apiKey)
  const { name } = await getMilestone(apiKey, milestoneId)
  const affected = await listIssues(apiKey, {
    milestoneId,
    limit: MAX_PAGE_SIZE,
  })

  const payload = await client.deleteProjectMilestone(milestoneId)
  if (!payload.success) throw new Error("Milestone deletion failed")

  return {
    id: milestoneId,
    name,
    detachedIssues: affected.issues.length,
    detachedIssuesCapped: affected.hasNextPage,
  }
}

export interface AssignedIssueRef {
  id: string
  identifier: string
  title: string
}

export interface AssignIssuesToMilestoneResult {
  milestone: string | null
  issues: AssignedIssueRef[]
}

/**
 * `milestoneId: null` detaches the issues from whatever milestone they're on.
 * Only scalar fields are read back — resolving each issue's relations would cost
 * a handful of requests per issue, and a batch is meant to stay one round trip.
 */
/**
 * `milestoneId: null` detaches the issues from whatever milestone they're on.
 * Only scalar fields are read back — resolving each issue's relations would cost
 * a handful of requests per issue, and a batch is meant to stay one round trip.
 */
export async function assignIssuesToMilestone(
  apiKey: string,
  issueIds: string[],
  milestoneId: string | null
): Promise<AssignIssuesToMilestoneResult> {
  const client = getClient(apiKey)

  const payload = await client.updateIssueBatch(issueIds, {
    projectMilestoneId: milestoneId,
  })
  if (!payload.success) throw new Error("Batch milestone assignment failed")

  return {
    milestone: milestoneId
      ? (await getMilestone(apiKey, milestoneId)).name
      : null,
    issues: payload.issues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
    })),
  }
}

// --------------------------------------------------------------------------
// Archiving
//
// Archive only — the SDK's `trash` flag is deliberately not exposed: archived
// entities stay recoverable via the unarchive functions below, trashed ones do
// not.
// --------------------------------------------------------------------------

export interface ArchiveResult {
  id: string
  name: string
}

/**
 * The payloads' `entity` getter re-fetches the entity by id, and `initiative(id)`
 * excludes archived rows — so reading it after archiving throws "Entity not found"
 * on a mutation that actually succeeded. Read the name first, then trust `success`.
 */
/**
 * The payloads' `entity` getter re-fetches the entity by id, and `initiative(id)`
 * excludes archived rows — so reading it after archiving throws "Entity not found"
 * on a mutation that actually succeeded. Read the name first, then trust `success`.
 */
export async function archiveProject(
  apiKey: string,
  projectId: string
): Promise<ArchiveResult> {
  const client = getClient(apiKey)
  const { name } = await client.project(projectId)
  const payload = await client.archiveProject(projectId)
  if (!payload.success) throw new Error("Project archive failed")
  return { id: projectId, name }
}

export async function archiveInitiative(
  apiKey: string,
  initiativeId: string
): Promise<ArchiveResult> {
  const client = getClient(apiKey)
  const { name } = await client.initiative(initiativeId)
  const payload = await client.archiveInitiative(initiativeId)
  if (!payload.success) throw new Error("Initiative archive failed")
  return { id: initiativeId, name }
}

// Unarchiving reverses it: the entity is fetchable again once restored, so the
// name has to come from the payload rather than a pre-read.
export async function unarchiveProject(
  apiKey: string,
  projectId: string
): Promise<ArchiveResult> {
  const client = getClient(apiKey)
  const payload = await client.unarchiveProject(projectId)
  if (!payload.success) throw new Error("Project unarchive failed")
  const p = await payload.entity
  return { id: projectId, name: p?.name ?? "(unknown)" }
}

export async function unarchiveInitiative(
  apiKey: string,
  initiativeId: string
): Promise<ArchiveResult> {
  const client = getClient(apiKey)
  const payload = await client.unarchiveInitiative(initiativeId)
  if (!payload.success) throw new Error("Initiative unarchive failed")
  const i = await payload.entity
  return { id: initiativeId, name: i?.name ?? "(unknown)" }
}

// --------------------------------------------------------------------------
// Initiative ↔ project links
// --------------------------------------------------------------------------

export interface InitiativeProjectLink {
  id: string
  initiativeId: string
  initiativeName: string
  projectId: string
  projectName: string
}

export interface LinkedProject {
  linkId: string
  projectId: string
  projectName: string
  state: string
  targetDate: string | null
  url: string
}

/**
 * Two requests, no per-project fetch: `initiative.projects()` has the names but
 * not the link ids, and `initiativeToProjects` takes no filter — so the link ids
 * are collected workspace-wide and matched locally on the free `initiativeId`.
 */
/**
 * Two requests, no per-project fetch: `initiative.projects()` has the names but
 * not the link ids, and `initiativeToProjects` takes no filter — so the link ids
 * are collected workspace-wide and matched locally on the free `initiativeId`.
 */
export async function listInitiativeProjects(
  apiKey: string,
  initiativeId: string
): Promise<LinkedProject[]> {
  const client = getClient(apiKey)
  const initiative = await client.initiative(initiativeId)

  const [projectsResult, linkIdByProjectId] = await Promise.all([
    initiative.projects({ first: MAX_PAGE_SIZE }),
    collectLinkIds(apiKey, initiativeId),
  ])

  return projectsResult.nodes.map((p) => ({
    linkId: linkIdByProjectId.get(p.id) ?? "",
    projectId: p.id,
    projectName: p.name,
    state: p.state,
    targetDate: p.targetDate ?? null,
    url: p.url,
  }))
}

async function collectLinkIds(
  apiKey: string,
  initiativeId: string
): Promise<Map<string, string>> {
  const client = getClient(apiKey)
  const connection = await client.initiativeToProjects({ first: MAX_PAGE_SIZE })

  // fetchNext() accumulates into the same connection, so drain before reading
  let guard = 0
  while (connection.pageInfo.hasNextPage && guard++ < 20) {
    await connection.fetchNext()
  }

  const byProjectId = new Map<string, string>()
  for (const link of connection.nodes) {
    if (link.initiativeId === initiativeId && link.projectId) {
      byProjectId.set(link.projectId, link.id)
    }
  }
  return byProjectId
}

export async function linkProjectToInitiative(
  apiKey: string,
  params: { initiativeId: string; projectId: string; sortOrder?: number }
): Promise<InitiativeProjectLink> {
  const client = getClient(apiKey)
  const payload = await client.createInitiativeToProject({
    initiativeId: params.initiativeId,
    projectId: params.projectId,
    sortOrder: params.sortOrder,
  })

  const link = await payload.initiativeToProject
  if (!link)
    throw new Error("Initiative-to-project link failed — no link returned")

  const [initiative, project] = await Promise.all([
    link.initiative,
    link.project,
  ])

  return {
    id: link.id,
    initiativeId: initiative?.id ?? params.initiativeId,
    initiativeName: initiative?.name ?? "Unknown",
    projectId: project?.id ?? params.projectId,
    projectName: project?.name ?? "Unknown",
  }
}

/**
 * Takes the link id (from list_initiative_projects), not the project id —
 * Linear models the association as its own entity.
 */
/**
 * Takes the link id (from list_initiative_projects), not the project id —
 * Linear models the association as its own entity.
 */
export async function unlinkProjectFromInitiative(
  apiKey: string,
  linkId: string
): Promise<void> {
  const client = getClient(apiKey)
  await client.deleteInitiativeToProject(linkId)
}
