/**
 * linear.ts — thin wrapper around the Linear SDK.
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
// Teams
// --------------------------------------------------------------------------

export interface TeamSummary {
  id: string
  name: string
  key: string
}

export async function listTeams(apiKey: string): Promise<TeamSummary[]> {
  const client = getClient(apiKey)
  const result = await client.teams()
  return result.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key }))
}

// --------------------------------------------------------------------------
// Issues
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

export interface IssueDetail extends IssueSummary {
  description: string | null
  team: string
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
      params.milestoneId === "" ? { null: true } : { id: { eq: params.milestoneId } }
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

export async function getIssue(apiKey: string, issueId: string): Promise<IssueDetail> {
  const client = getClient(apiKey)
  const issue = await client.issue(issueId)

  const [state, assignee, team, project, milestone, parent] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.team,
    issue.project,
    issue.projectMilestone,
    issue.parent,
  ])

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    state: state?.name ?? "Unknown",
    assignee: assignee?.name ?? null,
    team: team?.name ?? "Unknown",
    project: project?.name ?? null,
    projectId: project?.id ?? null,
    milestone: milestone?.name ?? null,
    milestoneId: milestone?.id ?? null,
    parent: parent?.identifier ?? null,
    parentId: parent?.id ?? null,
    url: issue.url,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  }
}

// --------------------------------------------------------------------------
// Create / update issue
// --------------------------------------------------------------------------

export interface CreateIssueParams {
  teamId: string
  title: string
  description?: string
  priority?: number
  assigneeId?: string
  projectId?: string
  milestoneId?: string
  parentId?: string
}

export async function createIssue(
  apiKey: string,
  params: CreateIssueParams
): Promise<IssueSummary> {
  const client = getClient(apiKey)

  const payload = await client.createIssue({
    teamId: params.teamId,
    title: params.title,
    description: params.description,
    priority: params.priority,
    assigneeId: params.assigneeId || undefined,
    projectId: params.projectId || undefined,
    projectMilestoneId: params.milestoneId || undefined,
    parentId: params.parentId || undefined,
  })

  const issue = await payload.issue
  if (!issue) throw new Error("Issue creation failed — no issue returned")

  return summarizeIssue(issue)
}

export interface UpdateIssueParams {
  title?: string
  description?: string
  stateId?: string
  assigneeId?: string
  priority?: number
  projectId?: string
  milestoneId?: string
  parentId?: string
}

export async function updateIssue(
  apiKey: string,
  issueId: string,
  params: UpdateIssueParams
): Promise<IssueSummary> {
  const client = getClient(apiKey)

  // Empty string clears the relation; undefined leaves it untouched
  const updatePayload: Record<string, unknown> = {}
  if (params.title !== undefined) updatePayload["title"] = params.title
  if (params.description !== undefined) updatePayload["description"] = params.description
  if (params.stateId !== undefined) updatePayload["stateId"] = params.stateId
  if (params.assigneeId !== undefined)
    updatePayload["assigneeId"] = params.assigneeId === "" ? null : params.assigneeId
  if (params.priority !== undefined) updatePayload["priority"] = params.priority
  if (params.projectId !== undefined)
    updatePayload["projectId"] = params.projectId === "" ? null : params.projectId
  if (params.milestoneId !== undefined)
    updatePayload["projectMilestoneId"] =
      params.milestoneId === "" ? null : params.milestoneId
  if (params.parentId !== undefined)
    updatePayload["parentId"] = params.parentId === "" ? null : params.parentId

  const payload = await client.updateIssue(issueId, updatePayload)
  const issue = await payload.issue
  if (!issue) throw new Error("Issue update failed — no issue returned")

  return summarizeIssue(issue)
}

/** Shared mapping for the mutation payloads, which return a full Issue entity. */
async function summarizeIssue(
  issue: Awaited<NonNullable<Awaited<ReturnType<LinearClient["createIssue"]>>["issue"]>>
): Promise<IssueSummary> {
  const [state, assignee, project, milestone, parent] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.project,
    issue.projectMilestone,
    issue.parent,
  ])

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    state: state?.name ?? "Unknown",
    assignee: assignee?.name ?? null,
    project: project?.name ?? null,
    projectId: project?.id ?? null,
    milestone: milestone?.name ?? null,
    milestoneId: milestone?.id ?? null,
    parent: parent?.identifier ?? null,
    parentId: parent?.id ?? null,
    url: issue.url,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  }
}

// --------------------------------------------------------------------------
// Comments
// --------------------------------------------------------------------------

export async function addComment(
  apiKey: string,
  issueId: string,
  body: string
): Promise<{ id: string; body: string }> {
  const client = getClient(apiKey)
  const payload = await client.createComment({ issueId, body })
  const comment = await payload.comment
  if (!comment) throw new Error("Comment creation failed — no comment returned")
  return { id: comment.id, body: comment.body }
}

// --------------------------------------------------------------------------
// Teams (extended)
// --------------------------------------------------------------------------

export interface TeamDetail extends TeamSummary {
  description: string | null
  timezone: string
  issueCount: number
}

export async function getTeam(apiKey: string, teamId: string): Promise<TeamDetail> {
  const client = getClient(apiKey)
  const team = await client.team(teamId)
  return {
    id: team.id,
    name: team.name,
    key: team.key,
    description: team.description ?? null,
    timezone: team.timezone,
    issueCount: team.issueCount,
  }
}

// --------------------------------------------------------------------------
// Users
// --------------------------------------------------------------------------

export interface UserSummary {
  id: string
  name: string
  displayName: string
  email: string
  active: boolean
}

export async function listUsers(apiKey: string): Promise<UserSummary[]> {
  const client = getClient(apiKey)
  const result = await client.users({ first: 100 })
  return result.nodes.map((u) => ({
    id: u.id,
    name: u.name,
    displayName: u.displayName,
    email: u.email,
    active: u.active,
  }))
}

export async function getUser(apiKey: string, userId: string): Promise<UserSummary> {
  const client = getClient(apiKey)
  const u = await client.user(userId)
  return {
    id: u.id,
    name: u.name,
    displayName: u.displayName,
    email: u.email,
    active: u.active,
  }
}

// --------------------------------------------------------------------------
// Comments (extended)
// --------------------------------------------------------------------------

export interface CommentSummary {
  id: string
  body: string
  author: string | null
  createdAt: string
  updatedAt: string
}

export async function listComments(
  apiKey: string,
  issueId: string
): Promise<CommentSummary[]> {
  const client = getClient(apiKey)
  const issue = await client.issue(issueId)
  const result = await issue.comments({ first: 50 })
  return Promise.all(
    result.nodes.map(async (c) => {
      const user = await c.user
      return {
        id: c.id,
        body: c.body,
        author: user?.name ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }
    })
  )
}

export async function deleteComment(apiKey: string, commentId: string): Promise<void> {
  const client = getClient(apiKey)
  await client.deleteComment(commentId)
}

// --------------------------------------------------------------------------
// Workflow states (issue statuses)
// --------------------------------------------------------------------------

export interface WorkflowStateSummary {
  id: string
  name: string
  type: string
  color: string
  teamId: string | null
}

export async function listIssueStatuses(
  apiKey: string,
  teamId?: string
): Promise<WorkflowStateSummary[]> {
  const client = getClient(apiKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (teamId) filter["team"] = { id: { eq: teamId } }
  const result = await client.workflowStates({
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    first: 100,
  })
  return result.nodes.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    color: s.color,
    teamId: s.teamId ?? null,
  }))
}

export async function getIssueStatus(
  apiKey: string,
  statusId: string
): Promise<WorkflowStateSummary> {
  const client = getClient(apiKey)
  const s = await client.workflowState(statusId)
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    color: s.color,
    teamId: s.teamId ?? null,
  }
}

// --------------------------------------------------------------------------
// Issue labels
// --------------------------------------------------------------------------

export interface IssueLabelSummary {
  id: string
  name: string
  color: string
  teamId: string | null
}

export async function listIssueLabels(
  apiKey: string,
  teamId?: string
): Promise<IssueLabelSummary[]> {
  const client = getClient(apiKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (teamId) filter["team"] = { id: { eq: teamId } }
  const result = await client.issueLabels({
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    first: 100,
  })
  return result.nodes.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    teamId: l.teamId ?? null,
  }))
}

export async function createIssueLabel(
  apiKey: string,
  params: { name: string; color: string; teamId: string; description?: string }
): Promise<IssueLabelSummary> {
  const client = getClient(apiKey)
  const payload = await client.createIssueLabel({
    name: params.name,
    color: params.color,
    teamId: params.teamId,
    description: params.description,
  })
  const label = await payload.issueLabel
  if (!label) throw new Error("Label creation failed — no label returned")
  return {
    id: label.id,
    name: label.name,
    color: label.color,
    teamId: label.teamId ?? null,
  }
}

// --------------------------------------------------------------------------
// Projects
// --------------------------------------------------------------------------

export interface ProjectSummary {
  id: string
  name: string
  description: string | null
  state: string
  progress: number
  startDate: string | null
  targetDate: string | null
  url: string
}

export async function listProjects(
  apiKey: string,
  teamId?: string
): Promise<ProjectSummary[]> {
  const client = getClient(apiKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (teamId) filter["accessibleTeams"] = { some: { id: { eq: teamId } } }
  const result = await client.projects({
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    first: 50,
  })
  return result.nodes.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    state: p.state,
    progress: p.progress,
    startDate: p.startDate ?? null,
    targetDate: p.targetDate ?? null,
    url: p.url,
  }))
}

export async function getProject(apiKey: string, projectId: string): Promise<ProjectSummary> {
  const client = getClient(apiKey)
  const p = await client.project(projectId)
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    state: p.state,
    progress: p.progress,
    startDate: p.startDate ?? null,
    targetDate: p.targetDate ?? null,
    url: p.url,
  }
}

export interface SaveProjectParams {
  id?: string
  name: string
  description?: string
  teamIds?: string[]
  leadId?: string
  startDate?: string
  targetDate?: string
}

export async function saveProject(
  apiKey: string,
  params: SaveProjectParams
): Promise<ProjectSummary> {
  const client = getClient(apiKey)
  if (params.id) {
    const payload = await client.updateProject(params.id, {
      name: params.name,
      description: params.description,
      leadId: params.leadId,
      startDate: params.startDate,
      targetDate: params.targetDate,
    })
    const p = await payload.project
    if (!p) throw new Error("Project update failed")
    return getProject(apiKey, p.id)
  } else {
    const payload = await client.createProject({
      name: params.name,
      description: params.description,
      teamIds: params.teamIds ?? [],
      leadId: params.leadId,
      startDate: params.startDate,
      targetDate: params.targetDate,
    })
    const p = await payload.project
    if (!p) throw new Error("Project creation failed")
    return getProject(apiKey, p.id)
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
    progress: m.progress ?? 0,
    status: m.status ?? null,
    sortOrder: m.sortOrder ?? 0,
    project: m.project?.name ?? null,
    projectId: m.project?.id ?? null,
  }
}

export interface ListMilestonesParams {
  projectId?: string
  limit?: number
}

/**
 * Raw query rather than `client.projectMilestones()`: the SDK's `project` getter
 * re-fetches the project per milestone, so listing a project's milestones would
 * cost one request each just to render the project name.
 */
export async function listMilestones(
  apiKey: string,
  params: ListMilestonesParams = {}
): Promise<MilestoneSummary[]> {
  const client = getClient(apiKey)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (params.projectId) filter["project"] = { id: { eq: params.projectId } }

  const { data } = await client.client.rawRequest<
    { projectMilestones: { nodes: RawMilestoneNode[] } },
    Record<string, unknown>
  >(
    `query ListProjectMilestones($first: Int!, $filter: ProjectMilestoneFilter) {
      projectMilestones(first: $first, filter: $filter) {
        nodes { ${MILESTONE_FIELDS} }
      }
    }`,
    {
      first: Math.min(params.limit ?? 50, MAX_PAGE_SIZE),
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    }
  )

  if (!data) throw new Error("Milestone listing failed — no data returned")

  // `projectMilestones` only orders by created/updated date, but the meaningful
  // order for a milestone list is the one shown in Linear's project view —
  // grouped per project, since sortOrder is only comparable within one.
  return data.projectMilestones.nodes
    .map(mapMilestone)
    .sort(
      (a, b) =>
        (a.project ?? "").localeCompare(b.project ?? "") || a.sortOrder - b.sortOrder
    )
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

  if (!data?.projectMilestone) throw new Error(`Milestone "${milestoneId}" not found`)
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
    if (params.description !== undefined) update["description"] = params.description
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
  if (!params.projectId) throw new Error("`projectId` is required to create a milestone")

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
export async function deleteMilestone(
  apiKey: string,
  milestoneId: string
): Promise<DeleteMilestoneResult> {
  const client = getClient(apiKey)
  const { name } = await getMilestone(apiKey, milestoneId)
  const affected = await listIssues(apiKey, { milestoneId, limit: MAX_PAGE_SIZE })

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
    milestone: milestoneId ? (await getMilestone(apiKey, milestoneId)).name : null,
    issues: payload.issues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
    })),
  }
}

// --------------------------------------------------------------------------
// Cycles
// --------------------------------------------------------------------------

export interface CycleSummary {
  id: string
  name: string | null
  number: number
  startsAt: string
  endsAt: string
  completedAt: string | null
  teamId: string | null
}

export async function listCycles(
  apiKey: string,
  teamId?: string
): Promise<CycleSummary[]> {
  const client = getClient(apiKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (teamId) filter["team"] = { id: { eq: teamId } }
  const result = await client.cycles({
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    first: 50,
  })
  return result.nodes.map((c) => ({
    id: c.id,
    name: c.name ?? null,
    number: c.number,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
    teamId: c.teamId ?? null,
  }))
}

// --------------------------------------------------------------------------
// Documents
// --------------------------------------------------------------------------

export interface DocumentSummary {
  id: string
  title: string
  content: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string
  url: string
}

export async function listDocuments(
  apiKey: string,
  projectId?: string
): Promise<DocumentSummary[]> {
  const client = getClient(apiKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filter: Record<string, any> = {}
  if (projectId) filter["project"] = { id: { eq: projectId } }
  const result = await client.documents({
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    first: 50,
  })
  return result.nodes.map((d) => ({
    id: d.id,
    title: d.title,
    content: d.content ?? null,
    projectId: d.projectId ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    url: d.url,
  }))
}

export async function getDocument(
  apiKey: string,
  documentId: string
): Promise<DocumentSummary> {
  const client = getClient(apiKey)
  const d = await client.document(documentId)
  return {
    id: d.id,
    title: d.title,
    content: d.content ?? null,
    projectId: d.projectId ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    url: d.url,
  }
}

export async function createDocument(
  apiKey: string,
  params: { title: string; content?: string; projectId?: string; initiativeId?: string }
): Promise<DocumentSummary> {
  const client = getClient(apiKey)
  const payload = await client.createDocument({
    title: params.title,
    content: params.content,
    projectId: params.projectId,
    initiativeId: params.initiativeId,
  })
  const d = await payload.document
  if (!d) throw new Error("Document creation failed")
  return getDocument(apiKey, d.id)
}

export async function updateDocument(
  apiKey: string,
  documentId: string,
  params: { title?: string; content?: string }
): Promise<DocumentSummary> {
  const client = getClient(apiKey)
  const payload = await client.updateDocument(documentId, {
    title: params.title,
    content: params.content,
  })
  const d = await payload.document
  if (!d) throw new Error("Document update failed")
  return getDocument(apiKey, d.id)
}

// --------------------------------------------------------------------------
// Initiatives
// --------------------------------------------------------------------------

export interface InitiativeSummary {
  id: string
  name: string
  description: string | null
  status: string
  targetDate: string | null
  url: string
}

export async function listInitiatives(apiKey: string): Promise<InitiativeSummary[]> {
  const client = getClient(apiKey)
  const result = await client.initiatives({ first: 50 })
  return result.nodes.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description ?? null,
    status: i.status,
    targetDate: i.targetDate ?? null,
    url: i.url,
  }))
}

export async function getInitiative(
  apiKey: string,
  initiativeId: string
): Promise<InitiativeSummary> {
  const client = getClient(apiKey)
  const i = await client.initiative(initiativeId)
  return {
    id: i.id,
    name: i.name,
    description: i.description ?? null,
    status: i.status,
    targetDate: i.targetDate ?? null,
    url: i.url,
  }
}

export interface SaveInitiativeParams {
  id?: string
  name: string
  description?: string
  ownerId?: string
  targetDate?: string
  status?: string
}

export async function saveInitiative(
  apiKey: string,
  params: SaveInitiativeParams
): Promise<InitiativeSummary> {
  const client = getClient(apiKey)
  if (params.id) {
    const payload = await client.updateInitiative(params.id, {
      name: params.name,
      description: params.description,
      ownerId: params.ownerId,
      targetDate: params.targetDate,
    })
    const i = await payload.initiative
    if (!i) throw new Error("Initiative update failed")
    return getInitiative(apiKey, i.id)
  } else {
    const payload = await client.createInitiative({
      name: params.name,
      description: params.description,
      ownerId: params.ownerId,
      targetDate: params.targetDate,
    })
    const i = await payload.initiative
    if (!i) throw new Error("Initiative creation failed")
    return getInitiative(apiKey, i.id)
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
  if (!link) throw new Error("Initiative-to-project link failed — no link returned")

  const [initiative, project] = await Promise.all([link.initiative, link.project])

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
export async function unlinkProjectFromInitiative(
  apiKey: string,
  linkId: string
): Promise<void> {
  const client = getClient(apiKey)
  await client.deleteInitiativeToProject(linkId)
}

// --------------------------------------------------------------------------
// Status updates (project updates)
// --------------------------------------------------------------------------

export interface StatusUpdateSummary {
  id: string
  body: string
  health: string
  projectId: string | null
  createdAt: string
  updatedAt: string
}

export async function getStatusUpdates(
  apiKey: string,
  projectId: string
): Promise<StatusUpdateSummary[]> {
  const client = getClient(apiKey)
  const project = await client.project(projectId)
  const result = await project.projectUpdates({ first: 25 })
  return result.nodes.map((u) => ({
    id: u.id,
    body: u.body,
    health: u.health,
    projectId: u.projectId ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  }))
}

export interface SaveStatusUpdateParams {
  id?: string
  projectId: string
  body?: string
  health?: string
}

export async function saveStatusUpdate(
  apiKey: string,
  params: SaveStatusUpdateParams
): Promise<StatusUpdateSummary> {
  const client = getClient(apiKey)
  if (params.id) {
    const payload = await client.updateProjectUpdate(params.id, {
      body: params.body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      health: params.health as any,
    })
    const u = await payload.projectUpdate
    if (!u) throw new Error("Status update update failed")
    return {
      id: u.id,
      body: u.body,
      health: u.health,
      projectId: u.projectId ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }
  } else {
    const payload = await client.createProjectUpdate({
      projectId: params.projectId,
      body: params.body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      health: params.health as any,
    })
    const u = await payload.projectUpdate
    if (!u) throw new Error("Status update creation failed")
    return {
      id: u.id,
      body: u.body,
      health: u.health,
      projectId: u.projectId ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }
  }
}

export async function deleteStatusUpdate(apiKey: string, updateId: string): Promise<void> {
  const client = getClient(apiKey)
  await client.deleteProjectUpdate(updateId)
}

// --------------------------------------------------------------------------
// Customers
// --------------------------------------------------------------------------

export interface CustomerSummary {
  id: string
  name: string
  domains: string[]
  revenue: number | null
  size: number | null
}

export async function listCustomers(apiKey: string): Promise<CustomerSummary[]> {
  const client = getClient(apiKey)
  const result = await client.customers({ first: 50 })
  return result.nodes.map((c) => ({
    id: c.id,
    name: c.name,
    domains: c.domains ?? [],
    revenue: c.revenue ?? null,
    size: c.size ?? null,
  }))
}

export interface SaveCustomerParams {
  id?: string
  name: string
  domains?: string[]
  revenue?: number
  size?: number
  ownerId?: string
}

export async function saveCustomer(
  apiKey: string,
  params: SaveCustomerParams
): Promise<CustomerSummary> {
  const client = getClient(apiKey)
  if (params.id) {
    const payload = await client.updateCustomer(params.id, {
      name: params.name,
      domains: params.domains,
      revenue: params.revenue,
      size: params.size,
      ownerId: params.ownerId,
    })
    const c = await payload.customer
    if (!c) throw new Error("Customer update failed")
    return {
      id: c.id,
      name: c.name,
      domains: c.domains ?? [],
      revenue: c.revenue ?? null,
      size: c.size ?? null,
    }
  } else {
    const payload = await client.createCustomer({
      name: params.name,
      domains: params.domains,
      revenue: params.revenue,
      size: params.size,
      ownerId: params.ownerId,
    })
    const c = await payload.customer
    if (!c) throw new Error("Customer creation failed")
    return {
      id: c.id,
      name: c.name,
      domains: c.domains ?? [],
      revenue: c.revenue ?? null,
      size: c.size ?? null,
    }
  }
}

export async function deleteCustomer(apiKey: string, customerId: string): Promise<void> {
  const client = getClient(apiKey)
  await client.deleteCustomer(customerId)
}

// --------------------------------------------------------------------------
// Customer needs
// --------------------------------------------------------------------------

export interface CustomerNeedSummary {
  id: string
  body: string | null
  customerId: string | null
  issueId: string | null
  priority: number | null
}

export interface SaveCustomerNeedParams {
  id?: string
  customerId?: string
  issueId?: string
  body?: string
  priority?: number
}

export async function saveCustomerNeed(
  apiKey: string,
  params: SaveCustomerNeedParams
): Promise<CustomerNeedSummary> {
  const client = getClient(apiKey)
  if (params.id) {
    const payload = await client.updateCustomerNeed(params.id, {
      body: params.body,
      priority: params.priority,
    })
    const n = await payload.need
    if (!n) throw new Error("Customer need update failed")
    const issue = await n.issue
    return {
      id: n.id,
      body: n.body ?? null,
      customerId: n.customerId ?? null,
      issueId: issue?.id ?? null,
      priority: n.priority ?? null,
    }
  } else {
    const payload = await client.createCustomerNeed({
      customerId: params.customerId,
      issueId: params.issueId,
      body: params.body,
      priority: params.priority,
    })
    const n = await payload.need
    if (!n) throw new Error("Customer need creation failed")
    const issue = await n.issue
    return {
      id: n.id,
      body: n.body ?? null,
      customerId: n.customerId ?? null,
      issueId: issue?.id ?? null,
      priority: n.priority ?? null,
    }
  }
}

export async function deleteCustomerNeed(
  apiKey: string,
  needId: string
): Promise<void> {
  const client = getClient(apiKey)
  await client.deleteCustomerNeed(needId)
}

// --------------------------------------------------------------------------
// Attachments
// --------------------------------------------------------------------------

export interface AttachmentSummary {
  id: string
  title: string
  subtitle: string | null
  url: string
  issueId: string
}

export async function getAttachment(
  apiKey: string,
  attachmentId: string
): Promise<AttachmentSummary> {
  const client = getClient(apiKey)
  const a = await client.attachment(attachmentId)
  const issue = await a.issue
  return {
    id: a.id,
    title: a.title,
    subtitle: a.subtitle ?? null,
    url: a.url,
    issueId: issue?.id ?? "",
  }
}

export interface CreateAttachmentParams {
  issueId: string
  title: string
  url: string
  subtitle?: string
  iconUrl?: string
}

export async function createAttachment(
  apiKey: string,
  params: CreateAttachmentParams
): Promise<AttachmentSummary> {
  const client = getClient(apiKey)
  const payload = await client.createAttachment({
    issueId: params.issueId,
    title: params.title,
    url: params.url,
    subtitle: params.subtitle,
    iconUrl: params.iconUrl,
  })
  const a = await payload.attachment
  if (!a) throw new Error("Attachment creation failed")
  return getAttachment(apiKey, a.id)
}

export async function deleteAttachment(
  apiKey: string,
  attachmentId: string
): Promise<void> {
  const client = getClient(apiKey)
  await client.deleteAttachment(attachmentId)
}

// --------------------------------------------------------------------------
// Search documents
// --------------------------------------------------------------------------

export interface DocumentSearchResult {
  id: string
  title: string
  url: string
}

export async function searchDocumentation(
  apiKey: string,
  term: string
): Promise<DocumentSearchResult[]> {
  const client = getClient(apiKey)
  const result = await client.searchDocuments(term, { first: 20 })
  return result.nodes.map((d) => ({
    id: d.id,
    title: d.title,
    url: d.url,
  }))
}

// --------------------------------------------------------------------------
// Extract images
// --------------------------------------------------------------------------

/** Extract all image URLs from a markdown string (![alt](url) syntax). */
export function extractImages(markdown: string): string[] {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g
  const urls: string[] = []
  for (const match of markdown.matchAll(regex)) {
    const url = match[2]
    if (url) urls.push(url)
  }
  return urls
}
