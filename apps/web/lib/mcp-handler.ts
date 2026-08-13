/**
 * mcp-handler.ts — MCP tool definitions and request dispatcher.
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0) over HTTP.
 * Supported methods: initialize, ping, tools/list, tools/call,
 * notifications/initialized (notification, no response needed).
 *
 * Docs: https://spec.modelcontextprotocol.io
 */

import { z } from "zod"
import type { AuthenticatedUser } from "@/lib/env"
import * as linear from "@/lib/linear"

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: string | number
  method: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0"
  id: string | number
  result: unknown
}

export interface JsonRpcError {
  jsonrpc: "2.0"
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError

/** MCP tool content item */
interface McpTextContent {
  type: "text"
  text: string
}

/** MCP tools/call response */
interface McpToolResult {
  content: McpTextContent[]
  isError?: boolean
}

// --------------------------------------------------------------------------
// Tool definitions (exposed in tools/list)
// --------------------------------------------------------------------------

export const MCP_TOOLS = [
  {
    name: "list_workspaces",
    description:
      "List all Linear workspaces the authenticated user has access to. Call this first to discover available workspace IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_teams",
    description: "List all teams in a Linear workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: {
          type: "string",
          description: "Workspace ID (from list_workspaces)",
        },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "list_issues",
    description:
      "List issues in a Linear workspace. Supports filtering by team, workflow state, assignee, cycle, project, and project milestone. Each issue reports the project and milestone it belongs to. Paginate with `after` using the cursor returned when more results exist.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Filter by team ID (optional)" },
        stateId: {
          type: "string",
          description: "Filter by workflow state ID (optional)",
        },
        assigneeId: {
          type: "string",
          description: "Filter by assignee user ID (optional)",
        },
        cycleId: {
          type: "string",
          description: "Filter by cycle ID (optional) — use list_cycles to find the active one",
        },
        projectId: {
          type: "string",
          description: "Filter by project ID (optional) — use list_projects to find it",
        },
        milestoneId: {
          type: "string",
          description:
            "Filter by project milestone ID (optional) — use list_milestones to find it. " +
            "Pass an empty string to list issues that have no milestone assigned.",
        },
        parentId: {
          type: "string",
          description:
            "Filter by parent issue ID (optional) — returns the sub-issues of that issue",
        },
        limit: {
          type: "number",
          description: "Max results per page (default 25, max 250)",
        },
        after: {
          type: "string",
          description:
            "Pagination cursor (optional) — pass the cursor from a previous call to fetch the next page",
        },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_issue",
    description:
      "Get full details of a single Linear issue, including description, state, assignee, and team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        issueId: { type: "string", description: "Linear issue ID" },
      },
      required: ["workspaceId", "issueId"],
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue in a Linear workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Team ID" },
        title: { type: "string", description: "Issue title" },
        description: {
          type: "string",
          description: "Issue description in Markdown (optional)",
        },
        priority: {
          type: "number",
          description: "Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low (optional)",
        },
        assigneeId: {
          type: "string",
          description: "Assignee user ID (optional)",
        },
        projectId: {
          type: "string",
          description:
            "Project ID to file the issue under (optional). The project must be accessible to `teamId`.",
        },
        milestoneId: {
          type: "string",
          description:
            "Project milestone ID to file the issue under (optional). The milestone must belong to `projectId`, " +
            "which therefore has to be set too.",
        },
        parentId: {
          type: "string",
          description:
            "Parent issue ID (optional) — creates this issue as a sub-issue of the parent.",
        },
      },
      required: ["workspaceId", "teamId", "title"],
    },
  },
  {
    name: "update_issue",
    description:
      "Update an existing Linear issue (title, description, state, assignee, priority, project, milestone, parent). Use `projectId` to move an issue into a project, `milestoneId` to put it on a project milestone, and `parentId` to nest it under a parent issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        issueId: { type: "string", description: "Linear issue ID" },
        title: { type: "string", description: "New title (optional)" },
        description: {
          type: "string",
          description: "New description in Markdown (optional)",
        },
        stateId: {
          type: "string",
          description: "New workflow state ID (optional)",
        },
        assigneeId: {
          type: "string",
          description:
            "New assignee user ID (optional; pass empty string to unassign)",
        },
        priority: {
          type: "number",
          description: "New priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low (optional)",
        },
        projectId: {
          type: "string",
          description:
            "New project ID (optional; pass empty string to remove the issue from its project). " +
            "The project must be accessible to the issue's team, otherwise Linear rejects the update " +
            "with 'Discrepancy between issue team and state, cycle or project'.",
        },
        milestoneId: {
          type: "string",
          description:
            "New project milestone ID (optional; pass empty string to remove the issue from its milestone). " +
            "The milestone must belong to the issue's project — set `projectId` in the same call when moving " +
            "an issue into a different project's milestone.",
        },
        parentId: {
          type: "string",
          description:
            "New parent issue ID (optional; pass empty string to detach the issue from its parent)",
        },
      },
      required: ["workspaceId", "issueId"],
    },
  },
  {
    name: "add_comment",
    description: "Add a Markdown comment to a Linear issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        issueId: { type: "string", description: "Linear issue ID" },
        body: {
          type: "string",
          description: "Comment text in Markdown",
        },
      },
      required: ["workspaceId", "issueId", "body"],
    },
  },
  {
    name: "get_team",
    description: "Get full details of a single Linear team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Team ID" },
      },
      required: ["workspaceId", "teamId"],
    },
  },
  {
    name: "list_users",
    description: "List all members of a Linear workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_user",
    description: "Get details of a single Linear user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        userId: { type: "string", description: "User ID" },
      },
      required: ["workspaceId", "userId"],
    },
  },
  {
    name: "list_comments",
    description: "List all comments on a Linear issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        issueId: { type: "string", description: "Linear issue ID" },
      },
      required: ["workspaceId", "issueId"],
    },
  },
  {
    name: "delete_comment",
    description: "Delete a comment from a Linear issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        commentId: { type: "string", description: "Comment ID to delete" },
      },
      required: ["workspaceId", "commentId"],
    },
  },
  {
    name: "list_issue_statuses",
    description: "List workflow states (issue statuses) in a workspace, optionally filtered by team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Filter by team ID (optional)" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_issue_status",
    description: "Get details of a single workflow state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        statusId: { type: "string", description: "Workflow state ID" },
      },
      required: ["workspaceId", "statusId"],
    },
  },
  {
    name: "list_issue_labels",
    description: "List issue labels in a workspace, optionally filtered by team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Filter by team ID (optional)" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "create_issue_label",
    description: "Create a new issue label in a Linear team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Team ID" },
        name: { type: "string", description: "Label name" },
        color: { type: "string", description: "Label color as hex (e.g. #FF0000)" },
        description: { type: "string", description: "Label description (optional)" },
      },
      required: ["workspaceId", "teamId", "name", "color"],
    },
  },
  {
    name: "list_projects",
    description: "List projects in a Linear workspace, optionally filtered by team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Filter by team ID (optional)" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_project",
    description: "Get full details of a single Linear project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["workspaceId", "projectId"],
    },
  },
  {
    name: "save_project",
    description: "Create or update a Linear project. Pass `id` to update an existing project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        id: { type: "string", description: "Project ID to update (omit to create)" },
        name: { type: "string", description: "Project name" },
        description: { type: "string", description: "Project description (optional)" },
        teamIds: {
          type: "array",
          items: { type: "string" },
          description: "Team IDs for new projects (optional)",
        },
        leadId: { type: "string", description: "User ID of the project lead (optional)" },
        startDate: { type: "string", description: "Start date YYYY-MM-DD (optional)" },
        targetDate: { type: "string", description: "Target date YYYY-MM-DD (optional)" },
      },
      required: ["workspaceId", "name"],
    },
  },
  {
    name: "list_milestones",
    description:
      "List project milestones, optionally filtered by project. Returned in the same order Linear shows them in the project view, with completion progress and status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        projectId: { type: "string", description: "Filter by project ID (optional)" },
        limit: { type: "number", description: "Max results (default 50, max 250)" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_milestone",
    description:
      "Get details of a single project milestone, including progress, status and the project it belongs to. Use list_issues with `milestoneId` to see the issues on it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        milestoneId: { type: "string", description: "Milestone ID" },
      },
      required: ["workspaceId", "milestoneId"],
    },
  },
  {
    name: "save_milestone",
    description:
      "Create or update a project milestone. Omit `id` to create — `name` and `projectId` are then both required. " +
      "Pass `id` to update, along with only the fields to change. On update, `projectId` moves the milestone to another project " +
      "and `sortOrder` reorders it within its project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        id: { type: "string", description: "Milestone ID to update (omit to create)" },
        projectId: {
          type: "string",
          description:
            "Project ID — required when creating; on update, moves the milestone (and its issues) to that project",
        },
        name: { type: "string", description: "Milestone name (required when creating)" },
        description: { type: "string", description: "Milestone description (optional)" },
        targetDate: {
          type: "string",
          description:
            "Target date YYYY-MM-DD (optional; pass empty string to clear it on update)",
        },
        sortOrder: {
          type: "number",
          description:
            "Position within the project (optional) — lower sorts first. Read the neighbours' " +
            "`sortOrder` from list_milestones and pass a value between them to slot this milestone in.",
        },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "delete_milestone",
    description:
      "Permanently delete a project milestone. Its issues are not deleted: they stay in the project with no milestone assigned. " +
      "This cannot be undone — Linear has no archive for milestones.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        milestoneId: { type: "string", description: "Milestone ID to delete" },
      },
      required: ["workspaceId", "milestoneId"],
    },
  },
  {
    name: "assign_issues_to_milestone",
    description:
      "Assign several issues to a project milestone in one call, or clear their milestone by omitting `milestoneId`. " +
      "Every issue must already belong to the milestone's project — move them with update_issue first otherwise.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        issueIds: {
          type: "array",
          items: { type: "string" },
          description: "Issue IDs to assign (max 50 per call)",
        },
        milestoneId: {
          type: "string",
          description:
            "Target milestone ID — omit (or pass an empty string) to remove these issues from their current milestone",
        },
      },
      required: ["workspaceId", "issueIds"],
    },
  },
  {
    name: "list_cycles",
    description: "List sprint cycles in a workspace, optionally filtered by team.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        teamId: { type: "string", description: "Filter by team ID (optional)" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "list_documents",
    description: "List documents in a workspace, optionally filtered by project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        projectId: { type: "string", description: "Filter by project ID (optional)" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_document",
    description: "Get full contents of a single Linear document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        documentId: { type: "string", description: "Document ID" },
      },
      required: ["workspaceId", "documentId"],
    },
  },
  {
    name: "create_document",
    description: "Create a new document in a Linear workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        title: { type: "string", description: "Document title" },
        content: { type: "string", description: "Document content in Markdown (optional)" },
        projectId: { type: "string", description: "Associate with a project (optional)" },
        initiativeId: { type: "string", description: "Associate with an initiative (optional)" },
      },
      required: ["workspaceId", "title"],
    },
  },
  {
    name: "update_document",
    description: "Update an existing Linear document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        documentId: { type: "string", description: "Document ID" },
        title: { type: "string", description: "New title (optional)" },
        content: { type: "string", description: "New content in Markdown (optional)" },
      },
      required: ["workspaceId", "documentId"],
    },
  },
  {
    name: "list_initiatives",
    description: "List all initiatives in a Linear workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_initiative",
    description: "Get details of a single Linear initiative.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        initiativeId: { type: "string", description: "Initiative ID" },
      },
      required: ["workspaceId", "initiativeId"],
    },
  },
  {
    name: "save_initiative",
    description: "Create or update a Linear initiative. Pass `id` to update.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        id: { type: "string", description: "Initiative ID to update (omit to create)" },
        name: { type: "string", description: "Initiative name" },
        description: { type: "string", description: "Initiative description (optional)" },
        ownerId: { type: "string", description: "Owner user ID (optional)" },
        targetDate: { type: "string", description: "Target date YYYY-MM-DD (optional)" },
      },
      required: ["workspaceId", "name"],
    },
  },
  {
    name: "archive_project",
    description:
      "Archive a Linear project. Reversible with unarchive_project. The project is hidden from active views but not deleted, and its issues are not deleted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        projectId: { type: "string", description: "Project ID to archive" },
      },
      required: ["workspaceId", "projectId"],
    },
  },
  {
    name: "unarchive_project",
    description: "Restore a previously archived Linear project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        projectId: { type: "string", description: "Project ID to restore" },
      },
      required: ["workspaceId", "projectId"],
    },
  },
  {
    name: "archive_initiative",
    description:
      "Archive a Linear initiative. Reversible with unarchive_initiative. The projects linked to it are not archived or deleted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        initiativeId: { type: "string", description: "Initiative ID to archive" },
      },
      required: ["workspaceId", "initiativeId"],
    },
  },
  {
    name: "unarchive_initiative",
    description: "Restore a previously archived Linear initiative.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        initiativeId: { type: "string", description: "Initiative ID to restore" },
      },
      required: ["workspaceId", "initiativeId"],
    },
  },
  {
    name: "list_initiative_projects",
    description:
      "List the projects linked to a Linear initiative. Returns each link's ID, needed by unlink_project_from_initiative.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        initiativeId: { type: "string", description: "Initiative ID" },
      },
      required: ["workspaceId", "initiativeId"],
    },
  },
  {
    name: "link_project_to_initiative",
    description:
      "Link an existing project to an initiative. Linking a project that is already linked returns an error — check list_initiative_projects first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        initiativeId: { type: "string", description: "Initiative ID (from list_initiatives)" },
        projectId: { type: "string", description: "Project ID (from list_projects)" },
        sortOrder: {
          type: "number",
          description: "Sort position of the project within the initiative (optional)",
        },
      },
      required: ["workspaceId", "initiativeId", "projectId"],
    },
  },
  {
    name: "unlink_project_from_initiative",
    description:
      "Remove the link between a project and an initiative. Takes the link ID (from list_initiative_projects), not the project ID. The project itself is not deleted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        linkId: {
          type: "string",
          description: "Initiative-to-project link ID (from list_initiative_projects)",
        },
      },
      required: ["workspaceId", "linkId"],
    },
  },
  {
    name: "get_status_updates",
    description: "Get project status updates (progress posts) for a Linear project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        projectId: { type: "string", description: "Project ID" },
      },
      required: ["workspaceId", "projectId"],
    },
  },
  {
    name: "save_status_update",
    description: "Create or update a project status update. Pass `id` to update.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        id: { type: "string", description: "Status update ID to update (omit to create)" },
        projectId: { type: "string", description: "Project ID (required for creation)" },
        body: { type: "string", description: "Update body in Markdown (optional)" },
        health: {
          type: "string",
          description: "Project health: onTrack, atRisk, offTrack (optional)",
        },
      },
      required: ["workspaceId", "projectId"],
    },
  },
  {
    name: "delete_status_update",
    description: "Delete a project status update.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        updateId: { type: "string", description: "Status update ID" },
      },
      required: ["workspaceId", "updateId"],
    },
  },
  {
    name: "list_customers",
    description: "List all customers in a Linear workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "save_customer",
    description: "Create or update a customer. Pass `id` to update.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        id: { type: "string", description: "Customer ID to update (omit to create)" },
        name: { type: "string", description: "Customer name" },
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Domain names (optional)",
        },
        revenue: { type: "number", description: "Annual revenue (optional)" },
        size: { type: "number", description: "Company size (optional)" },
        ownerId: { type: "string", description: "Owner user ID (optional)" },
      },
      required: ["workspaceId", "name"],
    },
  },
  {
    name: "delete_customer",
    description: "Delete a customer from Linear.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        customerId: { type: "string", description: "Customer ID" },
      },
      required: ["workspaceId", "customerId"],
    },
  },
  {
    name: "save_customer_need",
    description: "Create or update a customer need. Pass `id` to update.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        id: { type: "string", description: "Customer need ID to update (omit to create)" },
        customerId: { type: "string", description: "Customer ID (optional)" },
        issueId: { type: "string", description: "Linked issue ID (optional)" },
        body: { type: "string", description: "Need description in Markdown (optional)" },
        priority: { type: "number", description: "Priority: 0=not important, 1=important (optional)" },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "delete_customer_need",
    description: "Delete a customer need.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        needId: { type: "string", description: "Customer need ID" },
      },
      required: ["workspaceId", "needId"],
    },
  },
  {
    name: "get_attachment",
    description: "Get details of a single issue attachment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        attachmentId: { type: "string", description: "Attachment ID" },
      },
      required: ["workspaceId", "attachmentId"],
    },
  },
  {
    name: "create_attachment",
    description: "Create an attachment on a Linear issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        issueId: { type: "string", description: "Issue ID" },
        title: { type: "string", description: "Attachment title" },
        url: { type: "string", description: "Attachment URL (also used as unique identifier)" },
        subtitle: { type: "string", description: "Subtitle (optional)" },
        iconUrl: { type: "string", description: "Icon URL (optional)" },
      },
      required: ["workspaceId", "issueId", "title", "url"],
    },
  },
  {
    name: "delete_attachment",
    description: "Delete an issue attachment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        attachmentId: { type: "string", description: "Attachment ID" },
      },
      required: ["workspaceId", "attachmentId"],
    },
  },
  {
    name: "extract_images",
    description: "Extract all image URLs from a Linear issue or document's markdown content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        issueId: {
          type: "string",
          description: "Issue ID to extract images from (use this or documentId)",
        },
        documentId: {
          type: "string",
          description: "Document ID to extract images from (use this or issueId)",
        },
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "search_documentation",
    description: "Search documents in a Linear workspace by keyword.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: { type: "string", description: "Workspace ID" },
        term: { type: "string", description: "Search term" },
      },
      required: ["workspaceId", "term"],
    },
  },
] as const

// --------------------------------------------------------------------------
// Zod schemas for tool argument validation
// --------------------------------------------------------------------------

const WorkspaceArg = z.object({ workspaceId: z.string().min(1) })

const schemas = {
  list_workspaces: z.object({}),
  list_teams: WorkspaceArg,
  list_issues: WorkspaceArg.extend({
    teamId: z.string().optional(),
    stateId: z.string().optional(),
    assigneeId: z.string().optional(),
    cycleId: z.string().optional(),
    projectId: z.string().optional(),
    milestoneId: z.string().optional(),
    parentId: z.string().optional(),
    limit: z.number().int().min(1).max(linear.MAX_PAGE_SIZE).optional(),
    after: z.string().optional(),
  }),
  get_issue: WorkspaceArg.extend({ issueId: z.string().min(1) }),
  create_issue: WorkspaceArg.extend({
    teamId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    assigneeId: z.string().optional(),
    projectId: z.string().optional(),
    milestoneId: z.string().optional(),
    parentId: z.string().optional(),
  }),
  update_issue: WorkspaceArg.extend({
    issueId: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    stateId: z.string().optional(),
    assigneeId: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    projectId: z.string().optional(),
    milestoneId: z.string().optional(),
    parentId: z.string().optional(),
  }),
  add_comment: WorkspaceArg.extend({
    issueId: z.string().min(1),
    body: z.string().min(1),
  }),
  get_team: WorkspaceArg.extend({ teamId: z.string().min(1) }),
  list_users: WorkspaceArg,
  get_user: WorkspaceArg.extend({ userId: z.string().min(1) }),
  list_comments: WorkspaceArg.extend({ issueId: z.string().min(1) }),
  delete_comment: WorkspaceArg.extend({ commentId: z.string().min(1) }),
  list_issue_statuses: WorkspaceArg.extend({ teamId: z.string().optional() }),
  get_issue_status: WorkspaceArg.extend({ statusId: z.string().min(1) }),
  list_issue_labels: WorkspaceArg.extend({ teamId: z.string().optional() }),
  create_issue_label: WorkspaceArg.extend({
    teamId: z.string().min(1),
    name: z.string().min(1),
    color: z.string().min(1),
    description: z.string().optional(),
  }),
  list_projects: WorkspaceArg.extend({ teamId: z.string().optional() }),
  get_project: WorkspaceArg.extend({ projectId: z.string().min(1) }),
  save_project: WorkspaceArg.extend({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    teamIds: z.array(z.string()).optional(),
    leadId: z.string().optional(),
    startDate: z.string().optional(),
    targetDate: z.string().optional(),
  }),
  list_milestones: WorkspaceArg.extend({
    projectId: z.string().optional(),
    limit: z.number().int().min(1).max(linear.MAX_PAGE_SIZE).optional(),
  }),
  get_milestone: WorkspaceArg.extend({ milestoneId: z.string().min(1) }),
  save_milestone: WorkspaceArg.extend({
    id: z.string().optional(),
    projectId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    targetDate: z.string().optional(),
    sortOrder: z.number().optional(),
  }).refine((v) => v.id !== undefined || (!!v.name && !!v.projectId), {
    message: "`name` and `projectId` are required when creating a milestone (no `id` given)",
  }),
  delete_milestone: WorkspaceArg.extend({ milestoneId: z.string().min(1) }),
  assign_issues_to_milestone: WorkspaceArg.extend({
    issueIds: z.array(z.string().min(1)).min(1).max(50),
    milestoneId: z.string().optional(),
  }),
  list_cycles: WorkspaceArg.extend({ teamId: z.string().optional() }),
  list_documents: WorkspaceArg.extend({ projectId: z.string().optional() }),
  get_document: WorkspaceArg.extend({ documentId: z.string().min(1) }),
  create_document: WorkspaceArg.extend({
    title: z.string().min(1),
    content: z.string().optional(),
    projectId: z.string().optional(),
    initiativeId: z.string().optional(),
  }),
  update_document: WorkspaceArg.extend({
    documentId: z.string().min(1),
    title: z.string().optional(),
    content: z.string().optional(),
  }),
  list_initiatives: WorkspaceArg,
  get_initiative: WorkspaceArg.extend({ initiativeId: z.string().min(1) }),
  save_initiative: WorkspaceArg.extend({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    ownerId: z.string().optional(),
    targetDate: z.string().optional(),
  }),
  archive_project: WorkspaceArg.extend({ projectId: z.string().min(1) }),
  unarchive_project: WorkspaceArg.extend({ projectId: z.string().min(1) }),
  archive_initiative: WorkspaceArg.extend({ initiativeId: z.string().min(1) }),
  unarchive_initiative: WorkspaceArg.extend({ initiativeId: z.string().min(1) }),
  list_initiative_projects: WorkspaceArg.extend({
    initiativeId: z.string().min(1),
  }),
  link_project_to_initiative: WorkspaceArg.extend({
    initiativeId: z.string().min(1),
    projectId: z.string().min(1),
    sortOrder: z.number().optional(),
  }),
  unlink_project_from_initiative: WorkspaceArg.extend({
    linkId: z.string().min(1),
  }),
  get_status_updates: WorkspaceArg.extend({ projectId: z.string().min(1) }),
  save_status_update: WorkspaceArg.extend({
    id: z.string().optional(),
    projectId: z.string().min(1),
    body: z.string().optional(),
    health: z.string().optional(),
  }),
  delete_status_update: WorkspaceArg.extend({ updateId: z.string().min(1) }),
  list_customers: WorkspaceArg,
  save_customer: WorkspaceArg.extend({
    id: z.string().optional(),
    name: z.string().min(1),
    domains: z.array(z.string()).optional(),
    revenue: z.number().optional(),
    size: z.number().optional(),
    ownerId: z.string().optional(),
  }),
  delete_customer: WorkspaceArg.extend({ customerId: z.string().min(1) }),
  save_customer_need: WorkspaceArg.extend({
    id: z.string().optional(),
    customerId: z.string().optional(),
    issueId: z.string().optional(),
    body: z.string().optional(),
    priority: z.number().optional(),
  }),
  delete_customer_need: WorkspaceArg.extend({ needId: z.string().min(1) }),
  get_attachment: WorkspaceArg.extend({ attachmentId: z.string().min(1) }),
  create_attachment: WorkspaceArg.extend({
    issueId: z.string().min(1),
    title: z.string().min(1),
    url: z.string().min(1),
    subtitle: z.string().optional(),
    iconUrl: z.string().optional(),
  }),
  delete_attachment: WorkspaceArg.extend({ attachmentId: z.string().min(1) }),
  extract_images: WorkspaceArg.extend({
    issueId: z.string().optional(),
    documentId: z.string().optional(),
  }),
  search_documentation: WorkspaceArg.extend({ term: z.string().min(1) }),
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Find a workspace the user has access to, or throw. */
function resolveWorkspace(user: AuthenticatedUser, workspaceId: string) {
  const ws = user.workspaces.find((w) => w.id === workspaceId)
  if (!ws)
    throw new Error(
      `Workspace "${workspaceId}" not found or not accessible. ` +
        `Available: ${user.workspaces.map((w) => w.id).join(", ") || "(none)"}`
    )
  return ws
}

function ok(text: string): McpToolResult {
  return { content: [{ type: "text", text }] }
}

function err(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true }
}

// --------------------------------------------------------------------------
// Tool execution
// --------------------------------------------------------------------------

async function executeTool(
  user: AuthenticatedUser,
  name: string,
  rawArgs: unknown
): Promise<McpToolResult> {
  // Validate & parse arguments
  const schema = schemas[name as keyof typeof schemas]
  if (!schema) return err(`Unknown tool: ${name}`)

  const parsed = schema.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    return err(`Invalid arguments: ${parsed.error.message}`)
  }

  const args = parsed.data as Record<string, unknown>

  try {
    switch (name) {
      case "list_workspaces": {
        if (user.workspaces.length === 0)
          return ok("No workspaces configured for this user.")
        const lines = user.workspaces.map(
          (w) => `- **${w.name}** (id: \`${w.id}\`)`
        )
        return ok(`## Accessible workspaces\n\n${lines.join("\n")}`)
      }

      case "list_teams": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const teams = await linear.listTeams(ws.linearApiKey)
        if (teams.length === 0) return ok("No teams found in this workspace.")
        const lines = teams.map(
          (t) => `- **${t.name}** [${t.key}] (id: \`${t.id}\`)`
        )
        return ok(`## Teams in ${ws.name}\n\n${lines.join("\n")}`)
      }

      case "list_issues": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const { issues, hasNextPage, endCursor } = await linear.listIssues(
          ws.linearApiKey,
          {
            teamId: args["teamId"] as string | undefined,
            stateId: args["stateId"] as string | undefined,
            assigneeId: args["assigneeId"] as string | undefined,
            cycleId: args["cycleId"] as string | undefined,
            projectId: args["projectId"] as string | undefined,
            milestoneId: args["milestoneId"] as string | undefined,
            parentId: args["parentId"] as string | undefined,
            limit: args["limit"] as number | undefined,
            after: args["after"] as string | undefined,
          }
        )
        if (issues.length === 0) return ok("No issues found matching the filters.")
        const lines = issues.map(
          (i) =>
            `- **${i.identifier}** ${i.title}\n` +
            `  State: ${i.state} | Priority: ${i.priorityLabel}` +
            (i.assignee ? ` | Assignee: ${i.assignee}` : "") +
            `\n  Project: ${i.project ? `${i.project} (id: \`${i.projectId}\`)` : "None"}` +
            `\n  Milestone: ${i.milestone ? `${i.milestone} (id: \`${i.milestoneId}\`)` : "None"}` +
            (i.parent ? `\n  Parent: ${i.parent} (id: \`${i.parentId}\`)` : "") +
            `\n  URL: ${i.url} | id: \`${i.id}\``
        )
        const footer = hasNextPage
          ? `\n\n_More results available — call again with \`after: "${endCursor}"\`._`
          : `\n\n_End of results._`
        return ok(`## Issues (${issues.length})\n\n${lines.join("\n\n")}${footer}`)
      }

      case "get_issue": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const issue = await linear.getIssue(ws.linearApiKey, args["issueId"] as string)
        const lines = [
          `# ${issue.identifier}: ${issue.title}`,
          ``,
          `**State:** ${issue.state}`,
          `**Priority:** ${issue.priorityLabel}`,
          `**Team:** ${issue.team}`,
          issue.assignee ? `**Assignee:** ${issue.assignee}` : `**Assignee:** Unassigned`,
          issue.project
            ? `**Project:** ${issue.project} (id: \`${issue.projectId}\`)`
            : `**Project:** None`,
          issue.milestone
            ? `**Milestone:** ${issue.milestone} (id: \`${issue.milestoneId}\`)`
            : `**Milestone:** None`,
          issue.parent
            ? `**Parent:** ${issue.parent} (id: \`${issue.parentId}\`)`
            : `**Parent:** None (top-level issue)`,
          `**Created:** ${issue.createdAt}`,
          `**Updated:** ${issue.updatedAt}`,
          `**URL:** ${issue.url}`,
        ]
        if (issue.description) {
          lines.push(``, `## Description`, ``, issue.description)
        }
        return ok(lines.join("\n"))
      }

      case "create_issue": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const issue = await linear.createIssue(ws.linearApiKey, {
          teamId: args["teamId"] as string,
          title: args["title"] as string,
          description: args["description"] as string | undefined,
          priority: args["priority"] as number | undefined,
          assigneeId: args["assigneeId"] as string | undefined,
          projectId: args["projectId"] as string | undefined,
          milestoneId: args["milestoneId"] as string | undefined,
          parentId: args["parentId"] as string | undefined,
        })
        return ok(
          `## Issue created\n\n` +
            `**${issue.identifier}:** ${issue.title}\n` +
            `State: ${issue.state} | Priority: ${issue.priorityLabel}\n` +
            `Project: ${issue.project ?? "None"}\n` +
            `Milestone: ${issue.milestone ?? "None"}\n` +
            `Parent: ${issue.parent ?? "None"}\n` +
            `URL: ${issue.url}`
        )
      }

      case "update_issue": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const issue = await linear.updateIssue(
          ws.linearApiKey,
          args["issueId"] as string,
          {
            title: args["title"] as string | undefined,
            description: args["description"] as string | undefined,
            stateId: args["stateId"] as string | undefined,
            assigneeId: args["assigneeId"] as string | undefined,
            priority: args["priority"] as number | undefined,
            projectId: args["projectId"] as string | undefined,
            milestoneId: args["milestoneId"] as string | undefined,
            parentId: args["parentId"] as string | undefined,
          }
        )
        return ok(
          `## Issue updated\n\n` +
            `**${issue.identifier}:** ${issue.title}\n` +
            `State: ${issue.state} | Priority: ${issue.priorityLabel}` +
            (issue.assignee ? ` | Assignee: ${issue.assignee}` : "") +
            `\nProject: ${issue.project ?? "None"}` +
            `\nMilestone: ${issue.milestone ?? "None"}` +
            `\nParent: ${issue.parent ?? "None"}` +
            `\nURL: ${issue.url}`
        )
      }

      case "add_comment": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const comment = await linear.addComment(
          ws.linearApiKey,
          args["issueId"] as string,
          args["body"] as string
        )
        return ok(`Comment added (id: ${comment.id})`)
      }

      case "get_team": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const team = await linear.getTeam(ws.linearApiKey, args["teamId"] as string)
        return ok(
          `# Team: ${team.name} [${team.key}]\n\n` +
            `**ID:** ${team.id}\n` +
            (team.description ? `**Description:** ${team.description}\n` : "") +
            `**Timezone:** ${team.timezone}\n` +
            `**Issues:** ${team.issueCount}`
        )
      }

      case "list_users": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const users = await linear.listUsers(ws.linearApiKey)
        if (users.length === 0) return ok("No users found.")
        const lines = users.map(
          (u) => `- **${u.displayName}** (${u.email}) id: \`${u.id}\`` + (u.active ? "" : " [inactive]")
        )
        return ok(`## Users (${users.length})\n\n${lines.join("\n")}`)
      }

      case "get_user": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const u = await linear.getUser(ws.linearApiKey, args["userId"] as string)
        return ok(
          `# ${u.displayName}\n\n**Name:** ${u.name}\n**Email:** ${u.email}\n**Active:** ${u.active}\n**ID:** ${u.id}`
        )
      }

      case "list_comments": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const comments = await linear.listComments(ws.linearApiKey, args["issueId"] as string)
        if (comments.length === 0) return ok("No comments found on this issue.")
        const lines = comments.map(
          (c) =>
            `### Comment by ${c.author ?? "Unknown"} (${c.createdAt})\n\n${c.body}\n\n_id: ${c.id}_`
        )
        return ok(`## Comments (${comments.length})\n\n${lines.join("\n\n---\n\n")}`)
      }

      case "delete_comment": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        await linear.deleteComment(ws.linearApiKey, args["commentId"] as string)
        return ok(`Comment \`${args["commentId"]}\` deleted.`)
      }

      case "list_issue_statuses": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const statuses = await linear.listIssueStatuses(
          ws.linearApiKey,
          args["teamId"] as string | undefined
        )
        if (statuses.length === 0) return ok("No workflow states found.")
        const lines = statuses.map(
          (s) => `- **${s.name}** [${s.type}] color: ${s.color} | id: \`${s.id}\``
        )
        return ok(`## Workflow states (${statuses.length})\n\n${lines.join("\n")}`)
      }

      case "get_issue_status": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const s = await linear.getIssueStatus(ws.linearApiKey, args["statusId"] as string)
        return ok(
          `# State: ${s.name}\n\n**Type:** ${s.type}\n**Color:** ${s.color}\n**Team ID:** ${s.teamId}\n**ID:** ${s.id}`
        )
      }

      case "list_issue_labels": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const labels = await linear.listIssueLabels(
          ws.linearApiKey,
          args["teamId"] as string | undefined
        )
        if (labels.length === 0) return ok("No labels found.")
        const lines = labels.map(
          (l) => `- **${l.name}** color: ${l.color} | id: \`${l.id}\``
        )
        return ok(`## Issue labels (${labels.length})\n\n${lines.join("\n")}`)
      }

      case "create_issue_label": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const label = await linear.createIssueLabel(ws.linearApiKey, {
          teamId: args["teamId"] as string,
          name: args["name"] as string,
          color: args["color"] as string,
          description: args["description"] as string | undefined,
        })
        return ok(`Label **${label.name}** created (id: \`${label.id}\`)`)
      }

      case "list_projects": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const projects = await linear.listProjects(
          ws.linearApiKey,
          args["teamId"] as string | undefined
        )
        if (projects.length === 0) return ok("No projects found.")
        const lines = projects.map(
          (p) =>
            `- **${p.name}** [${p.state}] ${Math.round(p.progress * 100)}% complete` +
            (p.targetDate ? ` | Due: ${p.targetDate}` : "") +
            `\n  URL: ${p.url} | id: \`${p.id}\``
        )
        return ok(`## Projects (${projects.length})\n\n${lines.join("\n\n")}`)
      }

      case "get_project": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const p = await linear.getProject(ws.linearApiKey, args["projectId"] as string)
        const lines = [
          `# ${p.name}`,
          ``,
          `**State:** ${p.state}`,
          `**Progress:** ${Math.round(p.progress * 100)}%`,
          p.startDate ? `**Start date:** ${p.startDate}` : null,
          p.targetDate ? `**Target date:** ${p.targetDate}` : null,
          `**URL:** ${p.url}`,
          `**ID:** ${p.id}`,
        ].filter(Boolean)
        if (p.description) lines.push("", "## Description", "", p.description)
        return ok(lines.join("\n"))
      }

      case "save_project": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const p = await linear.saveProject(ws.linearApiKey, {
          id: args["id"] as string | undefined,
          name: args["name"] as string,
          description: args["description"] as string | undefined,
          teamIds: args["teamIds"] as string[] | undefined,
          leadId: args["leadId"] as string | undefined,
          startDate: args["startDate"] as string | undefined,
          targetDate: args["targetDate"] as string | undefined,
        })
        const action = args["id"] ? "updated" : "created"
        return ok(`Project **${p.name}** ${action} (id: \`${p.id}\`)\nURL: ${p.url}`)
      }

      case "list_milestones": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const milestones = await linear.listMilestones(ws.linearApiKey, {
          projectId: args["projectId"] as string | undefined,
          limit: args["limit"] as number | undefined,
        })
        if (milestones.length === 0) return ok("No milestones found.")
        const lines = milestones.map(
          (m) =>
            `- **${m.name}** [${m.status ?? "unknown"}] ${Math.round(m.progress * 100)}% complete` +
            (m.targetDate ? ` | Due: ${m.targetDate}` : "") +
            (args["projectId"] ? "" : ` | Project: ${m.project ?? "None"}`) +
            `\n  sortOrder: ${m.sortOrder} | id: \`${m.id}\``
        )
        return ok(`## Milestones (${milestones.length})\n\n${lines.join("\n")}`)
      }

      case "get_milestone": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const m = await linear.getMilestone(ws.linearApiKey, args["milestoneId"] as string)
        const lines = [
          `# ${m.name}`,
          ``,
          `**Status:** ${m.status ?? "unknown"}`,
          `**Progress:** ${Math.round(m.progress * 100)}%`,
          m.targetDate ? `**Target date:** ${m.targetDate}` : null,
          `**Project:** ${m.project ?? "None"} (id: \`${m.projectId}\`)`,
          `**Sort order:** ${m.sortOrder}`,
          `**ID:** ${m.id}`,
        ].filter(Boolean)
        if (m.description) lines.push("", "## Description", "", m.description)
        return ok(lines.join("\n"))
      }

      case "save_milestone": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const m = await linear.saveMilestone(ws.linearApiKey, {
          id: args["id"] as string | undefined,
          projectId: args["projectId"] as string | undefined,
          name: args["name"] as string | undefined,
          description: args["description"] as string | undefined,
          targetDate: args["targetDate"] as string | undefined,
          sortOrder: args["sortOrder"] as number | undefined,
        })
        const action = args["id"] ? "updated" : "created"
        return ok(
          `Milestone **${m.name}** ${action} (id: \`${m.id}\`)\n` +
            `Project: ${m.project ?? "None"} | Status: ${m.status ?? "unknown"}` +
            (m.targetDate ? ` | Due: ${m.targetDate}` : "")
        )
      }

      case "delete_milestone": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const m = await linear.deleteMilestone(
          ws.linearApiKey,
          args["milestoneId"] as string
        )
        const detached = m.detachedIssuesCapped
          ? `${m.detachedIssues}+`
          : `${m.detachedIssues}`
        return ok(
          `Milestone **${m.name}** deleted (id: \`${m.id}\`).\n` +
            `${detached} issue(s) stayed in the project with no milestone assigned.`
        )
      }

      case "assign_issues_to_milestone": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const milestoneId = (args["milestoneId"] as string | undefined) || null
        const result = await linear.assignIssuesToMilestone(
          ws.linearApiKey,
          args["issueIds"] as string[],
          milestoneId
        )
        const lines = result.issues.map((i) => `- **${i.identifier}** ${i.title}`)
        const target = result.milestone
          ? `milestone **${result.milestone}**`
          : "no milestone"
        return ok(
          `## ${result.issues.length} issue(s) assigned to ${target}\n\n${lines.join("\n")}`
        )
      }

      case "list_cycles": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const cycles = await linear.listCycles(
          ws.linearApiKey,
          args["teamId"] as string | undefined
        )
        if (cycles.length === 0) return ok("No cycles found.")
        const lines = cycles.map(
          (c) =>
            `- **Cycle #${c.number}**${c.name ? ` "${c.name}"` : ""}` +
            ` | ${c.startsAt.slice(0, 10)} → ${c.endsAt.slice(0, 10)}` +
            (c.completedAt ? ` [completed]` : "") +
            ` | id: \`${c.id}\``
        )
        return ok(`## Cycles (${cycles.length})\n\n${lines.join("\n")}`)
      }

      case "list_documents": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const docs = await linear.listDocuments(
          ws.linearApiKey,
          args["projectId"] as string | undefined
        )
        if (docs.length === 0) return ok("No documents found.")
        const lines = docs.map(
          (d) => `- **${d.title}** | Updated: ${d.updatedAt.slice(0, 10)} | URL: ${d.url} | id: \`${d.id}\``
        )
        return ok(`## Documents (${docs.length})\n\n${lines.join("\n")}`)
      }

      case "get_document": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const d = await linear.getDocument(ws.linearApiKey, args["documentId"] as string)
        const lines = [
          `# ${d.title}`,
          `**URL:** ${d.url}`,
          `**Updated:** ${d.updatedAt}`,
          `**ID:** ${d.id}`,
        ]
        if (d.content) lines.push("", "## Content", "", d.content)
        return ok(lines.join("\n"))
      }

      case "create_document": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const d = await linear.createDocument(ws.linearApiKey, {
          title: args["title"] as string,
          content: args["content"] as string | undefined,
          projectId: args["projectId"] as string | undefined,
          initiativeId: args["initiativeId"] as string | undefined,
        })
        return ok(`Document **${d.title}** created (id: \`${d.id}\`)\nURL: ${d.url}`)
      }

      case "update_document": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const d = await linear.updateDocument(
          ws.linearApiKey,
          args["documentId"] as string,
          {
            title: args["title"] as string | undefined,
            content: args["content"] as string | undefined,
          }
        )
        return ok(`Document **${d.title}** updated (id: \`${d.id}\`)\nURL: ${d.url}`)
      }

      case "list_initiatives": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const initiatives = await linear.listInitiatives(ws.linearApiKey)
        if (initiatives.length === 0) return ok("No initiatives found.")
        const lines = initiatives.map(
          (i) =>
            `- **${i.name}** [${i.status}]` +
            (i.targetDate ? ` | Due: ${i.targetDate}` : "") +
            ` | URL: ${i.url} | id: \`${i.id}\``
        )
        return ok(`## Initiatives (${initiatives.length})\n\n${lines.join("\n")}`)
      }

      case "get_initiative": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const i = await linear.getInitiative(ws.linearApiKey, args["initiativeId"] as string)
        const lines = [
          `# ${i.name}`,
          `**Status:** ${i.status}`,
          i.targetDate ? `**Target date:** ${i.targetDate}` : null,
          `**URL:** ${i.url}`,
          `**ID:** ${i.id}`,
        ].filter(Boolean)
        if (i.description) lines.push("", "## Description", "", i.description)
        return ok(lines.join("\n"))
      }

      case "save_initiative": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const i = await linear.saveInitiative(ws.linearApiKey, {
          id: args["id"] as string | undefined,
          name: args["name"] as string,
          description: args["description"] as string | undefined,
          ownerId: args["ownerId"] as string | undefined,
          targetDate: args["targetDate"] as string | undefined,
        })
        const action = args["id"] ? "updated" : "created"
        return ok(`Initiative **${i.name}** ${action} (id: \`${i.id}\`)\nURL: ${i.url}`)
      }

      case "archive_project": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const p = await linear.archiveProject(
          ws.linearApiKey,
          args["projectId"] as string
        )
        return ok(
          `Project **${p.name}** archived (id: \`${p.id}\`)\n` +
            `Restore it with unarchive_project. Its issues were not deleted.`
        )
      }

      case "unarchive_project": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const p = await linear.unarchiveProject(
          ws.linearApiKey,
          args["projectId"] as string
        )
        return ok(`Project **${p.name}** restored (id: \`${p.id}\`)`)
      }

      case "archive_initiative": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const i = await linear.archiveInitiative(
          ws.linearApiKey,
          args["initiativeId"] as string
        )
        return ok(
          `Initiative **${i.name}** archived (id: \`${i.id}\`)\n` +
            `Restore it with unarchive_initiative. Its linked projects were not archived.`
        )
      }

      case "unarchive_initiative": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const i = await linear.unarchiveInitiative(
          ws.linearApiKey,
          args["initiativeId"] as string
        )
        return ok(`Initiative **${i.name}** restored (id: \`${i.id}\`)`)
      }

      case "list_initiative_projects": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const links = await linear.listInitiativeProjects(
          ws.linearApiKey,
          args["initiativeId"] as string
        )
        if (links.length === 0)
          return ok("No projects are linked to this initiative.")
        const lines = links.map(
          (l) =>
            `- **${l.projectName}** [${l.state}]` +
            (l.targetDate ? ` | Due: ${l.targetDate}` : "") +
            `\n  project id: \`${l.projectId}\` | link id: \`${l.linkId}\`` +
            `\n  URL: ${l.url}`
        )
        return ok(
          `## Projects in this initiative (${links.length})\n\n${lines.join("\n\n")}`
        )
      }

      case "link_project_to_initiative": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const link = await linear.linkProjectToInitiative(ws.linearApiKey, {
          initiativeId: args["initiativeId"] as string,
          projectId: args["projectId"] as string,
          sortOrder: args["sortOrder"] as number | undefined,
        })
        return ok(
          `Project **${link.projectName}** linked to initiative **${link.initiativeName}**\n` +
            `link id: \`${link.id}\` (use it with unlink_project_from_initiative)`
        )
      }

      case "unlink_project_from_initiative": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        await linear.unlinkProjectFromInitiative(
          ws.linearApiKey,
          args["linkId"] as string
        )
        return ok(
          `Link \`${args["linkId"]}\` removed. The project itself was not deleted.`
        )
      }

      case "get_status_updates": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const updates = await linear.getStatusUpdates(
          ws.linearApiKey,
          args["projectId"] as string
        )
        if (updates.length === 0) return ok("No status updates found for this project.")
        const lines = updates.map(
          (u) =>
            `### Update (${u.createdAt.slice(0, 10)}) — Health: ${u.health}\n\n${u.body}\n\n_id: ${u.id}_`
        )
        return ok(`## Status updates (${updates.length})\n\n${lines.join("\n\n---\n\n")}`)
      }

      case "save_status_update": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const u = await linear.saveStatusUpdate(ws.linearApiKey, {
          id: args["id"] as string | undefined,
          projectId: args["projectId"] as string,
          body: args["body"] as string | undefined,
          health: args["health"] as string | undefined,
        })
        const action = args["id"] ? "updated" : "created"
        return ok(`Status update ${action} (id: \`${u.id}\`) — Health: ${u.health}`)
      }

      case "delete_status_update": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        await linear.deleteStatusUpdate(ws.linearApiKey, args["updateId"] as string)
        return ok(`Status update \`${args["updateId"]}\` deleted.`)
      }

      case "list_customers": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const customers = await linear.listCustomers(ws.linearApiKey)
        if (customers.length === 0) return ok("No customers found.")
        const lines = customers.map(
          (c) =>
            `- **${c.name}**` +
            (c.domains.length > 0 ? ` (${c.domains.join(", ")})` : "") +
            ` | id: \`${c.id}\``
        )
        return ok(`## Customers (${customers.length})\n\n${lines.join("\n")}`)
      }

      case "save_customer": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const c = await linear.saveCustomer(ws.linearApiKey, {
          id: args["id"] as string | undefined,
          name: args["name"] as string,
          domains: args["domains"] as string[] | undefined,
          revenue: args["revenue"] as number | undefined,
          size: args["size"] as number | undefined,
          ownerId: args["ownerId"] as string | undefined,
        })
        const action = args["id"] ? "updated" : "created"
        return ok(`Customer **${c.name}** ${action} (id: \`${c.id}\`)`)
      }

      case "delete_customer": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        await linear.deleteCustomer(ws.linearApiKey, args["customerId"] as string)
        return ok(`Customer \`${args["customerId"]}\` deleted.`)
      }

      case "save_customer_need": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const n = await linear.saveCustomerNeed(ws.linearApiKey, {
          id: args["id"] as string | undefined,
          customerId: args["customerId"] as string | undefined,
          issueId: args["issueId"] as string | undefined,
          body: args["body"] as string | undefined,
          priority: args["priority"] as number | undefined,
        })
        const action = args["id"] ? "updated" : "created"
        return ok(`Customer need ${action} (id: \`${n.id}\`)`)
      }

      case "delete_customer_need": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        await linear.deleteCustomerNeed(ws.linearApiKey, args["needId"] as string)
        return ok(`Customer need \`${args["needId"]}\` deleted.`)
      }

      case "get_attachment": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const a = await linear.getAttachment(ws.linearApiKey, args["attachmentId"] as string)
        return ok(
          `# Attachment: ${a.title}\n\n` +
            (a.subtitle ? `**Subtitle:** ${a.subtitle}\n` : "") +
            `**URL:** ${a.url}\n` +
            `**Issue ID:** ${a.issueId}\n` +
            `**ID:** ${a.id}`
        )
      }

      case "create_attachment": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const a = await linear.createAttachment(ws.linearApiKey, {
          issueId: args["issueId"] as string,
          title: args["title"] as string,
          url: args["url"] as string,
          subtitle: args["subtitle"] as string | undefined,
          iconUrl: args["iconUrl"] as string | undefined,
        })
        return ok(`Attachment **${a.title}** created (id: \`${a.id}\`)`)
      }

      case "delete_attachment": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        await linear.deleteAttachment(ws.linearApiKey, args["attachmentId"] as string)
        return ok(`Attachment \`${args["attachmentId"]}\` deleted.`)
      }

      case "extract_images": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        let content: string | null = null
        if (args["issueId"]) {
          const issue = await linear.getIssue(ws.linearApiKey, args["issueId"] as string)
          content = issue.description
        } else if (args["documentId"]) {
          const doc = await linear.getDocument(ws.linearApiKey, args["documentId"] as string)
          content = doc.content
        } else {
          return err("Provide either issueId or documentId.")
        }
        if (!content) return ok("No content found — no images to extract.")
        const urls = linear.extractImages(content)
        if (urls.length === 0) return ok("No images found in the content.")
        const lines = urls.map((u, i) => `${i + 1}. ${u}`)
        return ok(`## Extracted images (${urls.length})\n\n${lines.join("\n")}`)
      }

      case "search_documentation": {
        const ws = resolveWorkspace(user, args["workspaceId"] as string)
        const results = await linear.searchDocumentation(
          ws.linearApiKey,
          args["term"] as string
        )
        if (results.length === 0) return ok(`No documents found matching "${args["term"] as string}".`)
        const lines = results.map(
          (d) => `- **${d.title}** | URL: ${d.url} | id: \`${d.id}\``
        )
        return ok(`## Search results for "${args["term"] as string}" (${results.length})\n\n${lines.join("\n")}`)
      }

      default:
        return err(`Tool "${name}" is not implemented`)
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`Error executing tool "${name}": ${message}`)
  }
}

// --------------------------------------------------------------------------
// MCP request dispatcher
// --------------------------------------------------------------------------

const PROTOCOL_VERSION = "2024-11-05"

export async function handleMcpRequest(
  user: AuthenticatedUser,
  body: unknown
): Promise<JsonRpcResponse | null> {
  // Basic structural check
  if (
    typeof body !== "object" ||
    body === null ||
    (body as JsonRpcRequest).jsonrpc !== "2.0"
  ) {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid JSON-RPC request" },
    }
  }

  const req = body as JsonRpcRequest

  // Notifications (no id) — acknowledge silently
  if (req.id === undefined || req.id === null) {
    return null
  }

  const id = req.id

  switch (req.method) {
    case "initialize": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "linear-mcp-gateway", version: "1.0.0" },
        },
      }
    }

    case "ping": {
      return { jsonrpc: "2.0", id, result: {} }
    }

    case "tools/list": {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: MCP_TOOLS },
      }
    }

    case "tools/call": {
      const params = req.params as { name?: string; arguments?: unknown } | undefined
      if (!params?.name) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing tool name" },
        }
      }
      const toolResult = await executeTool(user, params.name, params.arguments)
      return { jsonrpc: "2.0", id, result: toolResult }
    }

    default: {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      }
    }
  }
}
