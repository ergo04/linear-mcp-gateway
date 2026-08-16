export const REPO_URL = "https://github.com/ergo04/linear-mcp-gateway"

/**
 * `root-directory` is what keeps people from deploying a copy of this
 * documentation site: the clone flow targets the gateway app instead, and `env`
 * makes the form ask for the variables it cannot work without.
 */
export const DEPLOY_URL =
  "https://vercel.com/new/clone" +
  `?repository-url=${encodeURIComponent(REPO_URL)}` +
  "&root-directory=apps%2Fgateway" +
  "&project-name=linear-mcp-gateway" +
  "&repository-name=linear-mcp-gateway" +
  "&env=USER_1_NAME,USER_1_TOKEN,USER_1_WORKSPACES,WS_MAIN_NAME,WS_MAIN_LINEAR_KEY" +
  `&envDescription=${encodeURIComponent(
    'Your name, a secret token you invent, and one Linear API key. Set USER_1_WORKSPACES to "main" to match the WS_MAIN block.'
  )}` +
  `&envLink=${encodeURIComponent(`${REPO_URL}#configuration`)}`
