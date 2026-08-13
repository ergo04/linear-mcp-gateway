import {
  Building2,
  CircleDot,
  FileText,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  TrendingUp,
  Users2,
  Wrench,
} from "lucide-react"
import { SectionLabel } from "@/components/ui/section-label"

const toolGroups = [
  {
    icon: Wrench,
    label: "Gateway extras",
    description:
      "The gaps in Linear's own MCP: milestone deletion and reordering, batch assignment, archiving, and initiative↔project links.",
    tools: [
      "list_workspaces",
      "delete_milestone",
      "reorder_milestone",
      "assign_issues_to_milestone",
      "archive_project",
      "unarchive_project",
      "archive_initiative",
      "unarchive_initiative",
      "list_initiative_projects",
      "link_project_to_initiative",
      "unlink_project_from_initiative",
    ],
  },
  {
    icon: CircleDot,
    label: "Issues & comments",
    description:
      "Create, update and query issues — including blocking relations via save_issue.",
    tools: [
      "list_issues",
      "get_issue",
      "save_issue",
      "list_comments",
      "save_comment",
      "delete_comment",
    ],
  },
  {
    icon: GitBranch,
    label: "Workflow",
    description: "Workflow states, labels, and sprint cycles.",
    tools: [
      "list_issue_statuses",
      "get_issue_status",
      "list_issue_labels",
      "create_issue_label",
      "list_cycles",
    ],
  },
  {
    icon: FolderKanban,
    label: "Projects & milestones",
    description: "Track projects, set milestones, and post health updates.",
    tools: [
      "list_projects",
      "get_project",
      "save_project",
      "list_project_labels",
      "list_milestones",
      "get_milestone",
      "save_milestone",
      "get_status_updates",
      "save_status_update",
      "delete_status_update",
    ],
  },
  {
    icon: TrendingUp,
    label: "Initiatives",
    description: "Cross-team initiatives, their labels and lifecycle.",
    tools: [
      "list_initiatives",
      "get_initiative",
      "save_initiative",
      "list_initiative_labels",
      "create_initiative_label",
    ],
  },
  {
    icon: FileText,
    label: "Documents & attachments",
    description: "Read, write and search documents. Upload and extract attachments.",
    tools: [
      "list_documents",
      "get_document",
      "save_document",
      "search_documentation",
      "extract_images",
      "get_attachment",
      "create_attachment",
      "prepare_attachment_upload",
      "create_attachment_from_upload",
      "delete_attachment",
    ],
  },
  {
    icon: GitPullRequest,
    label: "Code review & releases",
    description: "Review diffs, resolve threads, merge, and manage release pipelines.",
    tools: [
      "list_diffs",
      "get_diff",
      "get_diff_threads",
      "save_diff_comment",
      "delete_diff_comment",
      "resolve_diff_thread",
      "submit_diff_review",
      "merge_diff",
      "list_release_pipelines",
      "list_releases",
      "get_release",
      "save_release",
      "list_release_notes",
      "get_release_note",
      "save_release_note",
    ],
  },
  {
    icon: Users2,
    label: "Customers",
    description:
      "Track customers and link needs to issues. Linear gates these on the workspace plan.",
    tools: [
      "list_customers",
      "save_customer",
      "delete_customer",
      "save_customer_need",
      "delete_customer_need",
    ],
  },
  {
    icon: Building2,
    label: "Workspace & teams",
    description: "Teams, members, workspace metadata, and agent skills.",
    tools: [
      "list_teams",
      "get_team",
      "list_users",
      "get_user",
      "get_workspace",
      "list_agent_skills",
      "get_agent_skill",
    ],
  },
]

export function ToolsSection() {
  return (
    <section id="tools" className="border-b border-border/60">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <SectionLabel>MCP tools</SectionLabel>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">
          Everything you need to work with Linear
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          74 tools: 63 proxied straight from Linear&apos;s own MCP, plus 11 that fill its gaps.
          Every one takes a <code className="font-mono text-xs">workspace</code> argument.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {toolGroups.map(({ icon: Icon, label, description, tools }) => (
            <div
              key={label}
              className="flex flex-col gap-4 rounded-xl border border-border p-5"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-4 text-primary" />
                </div>
                <h3 className="font-medium text-sm">{label}</h3>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>

              <div className="flex flex-wrap gap-1.5">
                {tools.map((tool) => (
                  <code
                    key={tool}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {tool}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
