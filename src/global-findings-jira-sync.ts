import {createHash} from 'crypto'
import {
  CustomFields,
  Issue,
  Jira,
  JiraConfig,
  NewIssueData
} from './libs/jira-lib'
import {
  GlobalSecurityFinding,
  SnowflakeFindings,
  SnowflakeFindingsConfig
} from './libs/snowflake-lib'

interface UpdateForReturn {
  action: string
  webUrl: string
  summary: string
}

export interface GlobalFindingsJiraSyncConfig extends SnowflakeFindingsConfig {
  customJiraFields?: CustomFields
}

const MANAGED_LABEL = 'global-security-findings'
export const SNOWFLAKE_FINDINGS_LABEL = 'snowflake-findings'
const IDENTITY_LABEL_PREFIX = 'global-finding-'

function hash(value: string, length = 24): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function normalizeLabel(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  return normalized || 'unknown'
}

function rawString(
  raw: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = raw[key] ?? raw[key.toUpperCase()] ?? raw[key.toLowerCase()]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function findingIdentity(finding: GlobalSecurityFinding): string {
  return [
    finding.toolName,
    finding.fismaId,
    finding.resourceId,
    finding.findingId
  ].join('|')
}

export function findingIdentityLabel(finding: GlobalSecurityFinding): string {
  return `${IDENTITY_LABEL_PREFIX}${hash(findingIdentity(finding))}`
}

export function findingFismaLabels(finding: GlobalSecurityFinding): string[] {
  const labels: string[] = []
  if (finding.fismaId.trim()) {
    labels.push(`fisma-id-${normalizeLabel(finding.fismaId)}`)
  }
  if (finding.fismaAcronym.trim()) {
    labels.push(`fisma-acronym-${normalizeLabel(finding.fismaAcronym)}`)
  }
  return labels
}

export function reconciliationFismaLabel(
  config: Pick<SnowflakeFindingsConfig, 'fismaIds' | 'fismaAcronyms'>
): string {
  if (config.fismaIds.length === 1 && config.fismaAcronyms.length === 0) {
    return `fisma-id-${normalizeLabel(config.fismaIds[0])}`
  }
  if (config.fismaAcronyms.length === 1 && config.fismaIds.length === 0) {
    return `fisma-acronym-${normalizeLabel(config.fismaAcronyms[0])}`
  }
  throw new Error(
    'Exactly one snowflake-fisma-id or snowflake-fisma-acronym is required for Jira reconciliation.'
  )
}

export function findingTitle(finding: GlobalSecurityFinding): string {
  return (
    rawString(finding.rawFinding, [
      'TITLE',
      'NAME',
      'RULE_NAME',
      'PROBLEM_TITLE',
      'MESSAGE'
    ]) ?? `${finding.toolName} finding ${finding.findingId}`
  )
}

function jiraPriority(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
      return 'Critical'
    case 'HIGH':
      return 'High'
    case 'MEDIUM':
      return 'Medium'
    case 'LOW':
      return 'Low'
    case 'INFO':
    case 'INFORMATIONAL':
    case 'UNKNOWN':
      return 'Lowest'
    default:
      return 'Lowest'
  }
}

function isoDate(value: Date | undefined): string {
  return value ? value.toISOString() : 'Unknown'
}

export class GlobalFindingsJiraSync {
  private readonly jira: Jira
  private readonly snowflake: SnowflakeFindings
  private readonly jiraBaseURI: string
  private readonly autoClose: boolean
  private readonly customJiraFields?: CustomFields
  private readonly fismaLabel: string
  private readonly view: string

  constructor(
    jiraConfig: JiraConfig,
    findingsConfig: GlobalFindingsJiraSyncConfig,
    autoClose: boolean
  ) {
    this.jira = new Jira(jiraConfig)
    this.snowflake = new SnowflakeFindings(findingsConfig)
    this.jiraBaseURI = jiraConfig.jiraBaseURI
    this.autoClose = autoClose
    this.customJiraFields = findingsConfig.customJiraFields
    this.view = findingsConfig.view
    this.fismaLabel = reconciliationFismaLabel(findingsConfig)
  }

  private summary(finding: GlobalSecurityFinding): string {
    return `[${finding.toolName}] ${findingTitle(finding)}`.slice(0, 255)
  }

  private issueBody(finding: GlobalSecurityFinding): string {
    const description =
      rawString(finding.rawFinding, [
        'DESCRIPTION',
        'DETAILS',
        'MESSAGE',
        'RECOMMENDATION'
      ]) ?? 'No source description was available.'
    const remediation = rawString(finding.rawFinding, [
      'REMEDIATION_URL',
      'REMEDIATION',
      'SOLUTION',
      'RECOMMENDATION_URL'
    ])

    return `----

*This issue is generated from ${this.view} and managed by automation.*
Do not remove the ${MANAGED_LABEL}, ${SNOWFLAKE_FINDINGS_LABEL}, FISMA, or identity labels.

h2. Finding

* Tool: ${finding.toolName}
* Finding ID: ${finding.findingId}
* FISMA ID: ${finding.fismaId}
* FISMA acronym: ${finding.fismaAcronym}
* Resource ID: ${finding.resourceId}
* Source severity: ${finding.severity || 'Unknown'}
* Normalized severity: ${finding.normalizedSeverity}
* Created at: ${isoDate(finding.createdAt)}
* Finding age: ${finding.findingAge} day(s)

h2. Description

${description}
${remediation ? `\n\nh2. Remediation\n\n${remediation}` : ''}

h2. Acceptance criteria

* The source row is no longer OPEN in ${this.view}.`
  }

  private managedIdentityLabel(issue: Issue): string | undefined {
    return issue.fields.labels?.find(
      label =>
        typeof label === 'string' && label.startsWith(IDENTITY_LABEL_PREFIX)
    ) as string | undefined
  }

  private async closeResolvedIssues(
    jiraIssues: Issue[],
    activeIdentityLabels: Set<string>
  ): Promise<UpdateForReturn[]> {
    const updates: UpdateForReturn[] = []
    for (const issue of jiraIssues) {
      const identityLabel = this.managedIdentityLabel(issue)
      if (!identityLabel || activeIdentityLabels.has(identityLabel)) continue

      if (!this.autoClose) {
        console.log(`Skipping automatic close for ${issue.key}`)
        continue
      }

      await this.jira.closeIssue(issue.key)
      await this.jira.addCommentToIssueById(
        issue.id,
        `This finding is no longer OPEN in ${this.view} as of ${new Date().toISOString()}.`
      )
      updates.push({
        action: 'closed',
        webUrl: `${this.jiraBaseURI}/browse/${issue.key}`,
        summary: issue.fields.summary
      })
    }
    return updates
  }

  private async createIssue(
    finding: GlobalSecurityFinding
  ): Promise<UpdateForReturn> {
    const identityLabel = findingIdentityLabel(finding)
    const issue: NewIssueData = {
      fields: {
        ...this.customJiraFields,
        summary: this.summary(finding),
        description: this.issueBody(finding),
        issuetype: {name: 'Task'},
        labels: [
          ...new Set([
            MANAGED_LABEL,
            SNOWFLAKE_FINDINGS_LABEL,
            this.fismaLabel,
            identityLabel,
            `tool-${normalizeLabel(finding.toolName)}`,
            `severity-${normalizeLabel(finding.normalizedSeverity)}`,
            ...findingFismaLabels(finding)
          ])
        ],
        priority: {name: jiraPriority(finding.normalizedSeverity)}
      }
    }
    const newIssue = await this.jira.createNewIssue(issue)
    return {
      action: 'created',
      webUrl: newIssue.webUrl,
      summary: issue.fields.summary
    }
  }

  async sync(): Promise<void> {
    const jiraIssues = await this.jira.getAllManagedIssuesInJiraProject([
      MANAGED_LABEL,
      SNOWFLAKE_FINDINGS_LABEL,
      this.fismaLabel
    ])
    const findings = await this.snowflake.getOpenFindings()
    const activeIdentityLabels = new Set(findings.map(findingIdentityLabel))
    const existingIdentityLabels = new Set(
      jiraIssues
        .map(issue => this.managedIdentityLabel(issue))
        .filter((label): label is string => Boolean(label))
    )

    const updates = await this.closeResolvedIssues(
      jiraIssues,
      activeIdentityLabels
    )
    for (const finding of findings) {
      if (!existingIdentityLabels.has(findingIdentityLabel(finding))) {
        updates.push(await this.createIssue(finding))
      }
    }

    console.log(JSON.stringify(updates))
  }
}
