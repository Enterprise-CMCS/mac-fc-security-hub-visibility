import {createHash} from 'crypto'
import {
  CustomFields,
  Issue,
  Jira,
  JiraConfig,
  LabelConfig,
  NewIssueData
} from './libs/jira-lib'
import {
  GlobalSecurityFinding,
  SnowflakeFindings,
  SnowflakeFindingsConfig
} from './libs/snowflake-lib'
import {
  assertIdentity,
  creationState,
  DESCRIPTION_START,
  DESCRIPTION_END,
  dueDateAnchor,
  reconcileFields
} from './libs/snowflake-jira-reconciliation'

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
const SECURITY_HUB_ONLY_LABEL_FIELDS = new Set([
  'accountid',
  'region',
  'identify',
  'productname',
  'providername',
  'providerversion',
  'companyname',
  'standardscontrolarn'
])

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

function normalizedSeverityLabel(severity: string): string {
  const normalized = severity.trim().toUpperCase()
  return normalized === 'INFO' ? 'INFORMATIONAL' : normalized || 'UNKNOWN'
}

function rawValue(raw: Record<string, unknown>, requestedKey: string): unknown {
  const normalizedRequestedKey = requestedKey.toLowerCase()
  const matchingKey = Object.keys(raw).find(
    key => key.toLowerCase() === normalizedRequestedKey
  )
  return matchingKey ? raw[matchingKey] : undefined
}

function configuredLabelValue(
  finding: GlobalSecurityFinding,
  labelField: string
): string | undefined {
  const field = labelField.trim().toLowerCase()
  if (!field || SECURITY_HUB_ONLY_LABEL_FIELDS.has(field)) return undefined

  switch (field) {
    case 'severity':
    case 'normalizedseverity':
    case 'normalized_severity':
      return normalizedSeverityLabel(finding.normalizedSeverity)
    case 'tool':
    case 'toolname':
    case 'tool_name':
      return finding.toolName
    case 'fismaid':
    case 'fisma_id':
      return finding.fismaId
    case 'fismaacronym':
    case 'fisma_acronym':
      return finding.fismaAcronym
    case 'resourceid':
    case 'resource_id':
      return finding.resourceId
    case 'findingid':
    case 'finding_id':
      return finding.findingId
    case 'source':
      return 'snowflake'
    case 'cve': {
      const value = rawValue(finding.rawFinding, labelField)
      if (Array.isArray(value)) {
        return value.length > 1 ? 'multi-cve' : String(value[0] ?? '')
      }
      const stringValue =
        value === undefined ? finding.findingId : String(value)
      const cves = stringValue.match(/CVE-\d{4}-\d{4,}/gi) ?? []
      if (cves.length > 1) return 'multi-cve'
      return cves[0]
    }
    default: {
      const value = rawValue(finding.rawFinding, labelField)
      return ['string', 'number', 'boolean'].includes(typeof value)
        ? String(value)
        : undefined
    }
  }
}

export function configuredSnowflakeLabels(
  finding: GlobalSecurityFinding,
  config: LabelConfig[] = []
): string[] {
  return config.flatMap(
    ({labelField, labelPrefix = '', labelDelimiter = ''}) => {
      const value = configuredLabelValue(finding, labelField)?.trim()
      if (!value) return []
      const label = `${labelPrefix}${labelDelimiter}${value}`
        .trim()
        .replace(/\s+/g, '')
        .slice(0, 255)
      return label ? [label] : []
    }
  )
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

export function reconciliationToolLabel(toolName?: string): string | undefined {
  const value = toolName?.trim()
  return value ? `tool-${normalizeLabel(value)}` : undefined
}

export function reconciliationLabels(
  config: Pick<
    SnowflakeFindingsConfig,
    'fismaIds' | 'fismaAcronyms' | 'toolName'
  >
): string[] {
  const labels = [
    MANAGED_LABEL,
    SNOWFLAKE_FINDINGS_LABEL,
    reconciliationFismaLabel(config)
  ]
  const toolLabel = reconciliationToolLabel(config.toolName)
  if (toolLabel) labels.push(toolLabel)
  return labels
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
  private readonly jiraAddLabels: string[]
  private readonly jiraLabelsConfig: LabelConfig[]
  private readonly jiraLinkIdOnCreation?: string
  private readonly jiraLinkTypeOnCreation?: string
  private readonly jiraLinkDirectionOnCreation?: string
  private readonly jiraLinkIdOnClosure?: string
  private readonly jiraLinkTypeOnClosure?: string
  private readonly jiraLinkDirectionOnClosure?: string
  private readonly fismaLabel: string
  private readonly reconciliationLabels: string[]
  private readonly view: string
  private readonly reconcileWatchers: boolean
  private readonly reopenTransition?: string
  private readonly dueFields: string[]

  constructor(
    jiraConfig: JiraConfig,
    findingsConfig: GlobalFindingsJiraSyncConfig,
    autoClose: boolean
  ) {
    const jiraHostname = new URL(jiraConfig.jiraBaseURI).hostname.toLowerCase()
    this.jira = new Jira({
      ...jiraConfig,
      jiraWatcherRecovery: true,
      // jira-assignee is documented as an accountId. Limit this compatibility
      // correction to Snowflake mode so the Security Hub path is unchanged.
      jiraAssigneeUseAccountId:
        jiraConfig.jiraApiVersion === '3' &&
        (jiraHostname === 'atlassian.net' ||
          jiraHostname.endsWith('.atlassian.net'))
    })
    this.snowflake = new SnowflakeFindings(findingsConfig)
    this.jiraBaseURI = jiraConfig.jiraBaseURI
    this.autoClose = autoClose
    this.reconcileWatchers = jiraConfig.jiraReconcileWatchers ?? false
    this.reopenTransition = jiraConfig.jiraReopenTransition
    this.dueFields = [
      ...new Set(
        ['duedate', jiraConfig.jiraDueDateField].filter((key): key is string =>
          Boolean(key)
        )
      )
    ]
    this.customJiraFields = findingsConfig.customJiraFields
    for (const key of Object.keys(this.customJiraFields ?? {})) {
      if (!/^customfield_\d+$/.test(key))
        throw new Error(
          `Snowflake custom fields must use Jira customfield_<id> keys: ${key}`
        )
    }
    this.jiraAddLabels = (jiraConfig.jiraAddLabels ?? '')
      .split(',')
      .map(label => label.trim())
      .filter(Boolean)
    this.jiraLabelsConfig = jiraConfig.jiraLabelsConfig
      ? (JSON.parse(jiraConfig.jiraLabelsConfig) as LabelConfig[])
      : []
    this.jiraLinkIdOnCreation = jiraConfig.jiraLinkIdOnCreation
    this.jiraLinkTypeOnCreation = jiraConfig.jiraLinkTypeOnCreation
    this.jiraLinkDirectionOnCreation = jiraConfig.jiraLinkDirectionOnCreation
    this.jiraLinkIdOnClosure = jiraConfig.jiraLinkIdOnClosure
    this.jiraLinkTypeOnClosure = jiraConfig.jiraLinkTypeOnClosure
    this.jiraLinkDirectionOnClosure = jiraConfig.jiraLinkDirectionOnClosure
    this.view = findingsConfig.view
    this.fismaLabel = reconciliationFismaLabel(findingsConfig)
    this.reconciliationLabels = reconciliationLabels(findingsConfig)
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
    const identities = [
      ...new Set(
        issue.fields.labels?.filter(
          label =>
            typeof label === 'string' && label.startsWith(IDENTITY_LABEL_PREFIX)
        )
      )
    ]
    if (identities.length > 1)
      throw new Error(
        `Conflicting finding identities on ${issue.key}; refusing reconciliation`
      )
    return identities[0]
  }

  private isClosedIssue(issue: Issue): boolean {
    return (
      issue.fields.status?.statusCategory?.key?.toLowerCase() === 'done' ||
      Boolean(issue.fields.resolution)
    )
  }

  private preferredIssue(issues: Issue[]): Issue {
    return [...issues].sort((left, right) => {
      const updated = String(right.fields.updated ?? '').localeCompare(
        String(left.fields.updated ?? '')
      )
      return updated || right.key.localeCompare(left.key)
    })[0]
  }

  private async closeResolvedIssues(
    jiraIssues: Issue[],
    activeIdentityLabels: Set<string>
  ): Promise<UpdateForReturn[]> {
    const updates: UpdateForReturn[] = []
    for (const issue of jiraIssues) {
      const identityLabel = this.managedIdentityLabel(issue)
      if (
        !identityLabel ||
        activeIdentityLabels.has(identityLabel) ||
        this.isClosedIssue(issue)
      )
        continue

      if (!this.autoClose) {
        console.log(`Skipping automatic close for ${issue.key}`)
        continue
      }

      await this.jira.closeIssue(issue.key)
      await this.jira.addCommentToIssueById(
        issue.id,
        `This finding is no longer OPEN in ${this.view} as of ${new Date().toISOString()}.`
      )
      if (this.jiraLinkIdOnClosure) {
        await this.jira.linkIssues(
          issue.key,
          this.jiraLinkIdOnClosure,
          this.jiraLinkTypeOnClosure,
          this.jiraLinkDirectionOnClosure
        )
      }
      updates.push({
        action: 'closed',
        webUrl: `${this.jiraBaseURI}/browse/${issue.key}`,
        summary: issue.fields.summary
      })
    }
    return updates
  }

  private buildIssue(finding: GlobalSecurityFinding): NewIssueData {
    const identityLabel = findingIdentityLabel(finding)
    const body = this.issueBody(finding)
    if (body.includes(DESCRIPTION_START) || body.includes(DESCRIPTION_END))
      throw new Error('Source finding contains reserved description markers')
    const issue: NewIssueData = {
      fields: {
        ...this.customJiraFields,
        summary: this.summary(finding),
        description: `${DESCRIPTION_START}\n${body}\n${DESCRIPTION_END}`,
        issuetype: {name: 'Task'},
        labels: [
          ...new Set([
            MANAGED_LABEL,
            SNOWFLAKE_FINDINGS_LABEL,
            this.fismaLabel,
            identityLabel,
            `tool-${normalizeLabel(finding.toolName)}`,
            `severity-${normalizeLabel(finding.normalizedSeverity)}`,
            normalizedSeverityLabel(finding.normalizedSeverity),
            ...findingFismaLabels(finding),
            ...configuredSnowflakeLabels(finding, this.jiraLabelsConfig),
            ...this.jiraAddLabels
          ])
        ],
        priority: {name: jiraPriority(finding.normalizedSeverity)}
      }
    }
    assertIdentity(
      {id: '', key: identityLabel, webUrl: '', fields: issue.fields},
      identityLabel
    )
    return issue
  }

  private async createIssue(
    finding: GlobalSecurityFinding
  ): Promise<UpdateForReturn> {
    const anchor = dueDateAnchor(undefined, finding.createdAt)
    const issue = await this.jira.prepareSnowflakeFields(
      this.buildIssue(finding),
      anchor
    )
    const newIssue = await this.jira.createSnowflakeIssue(
      issue,
      creationState(issue, anchor, this.dueFields)
    )
    if (this.jiraLinkIdOnCreation) {
      await this.jira.linkIssues(
        newIssue.key,
        this.jiraLinkIdOnCreation,
        this.jiraLinkTypeOnCreation,
        this.jiraLinkDirectionOnCreation
      )
    }
    return {
      action: 'created',
      webUrl: newIssue.webUrl,
      summary: issue.fields.summary
    }
  }

  private async reconcileIssue(
    issue: Issue,
    finding: GlobalSecurityFinding
  ): Promise<'updated' | 'reopened' | undefined> {
    const current = await this.jira.getSnowflakeIssue(issue.key)
    assertIdentity(current, findingIdentityLabel(finding))
    const anchor = dueDateAnchor(current, finding.createdAt)
    const desired = await this.jira.prepareSnowflakeFields(
      this.buildIssue(finding),
      anchor
    )
    const patch = reconcileFields(current, desired, anchor, this.dueFields)
    const reopen = this.isClosedIssue(current)
    if (reopen)
      await this.jira.reopenIssue(issue.key, this.reopenTransition ?? '')
    if (patch) await this.jira.updateSnowflakeIssue(issue.key, patch)
    if (this.reconcileWatchers)
      await this.jira.reconcileSnowflakeWatchers(issue.key)
    return reopen ? 'reopened' : patch ? 'updated' : undefined
  }

  async sync(): Promise<void> {
    const jiraIssues = await this.jira.getAllManagedIssuesInJiraProject(
      this.reconciliationLabels,
      true
    )
    const findings = await this.snowflake.getOpenFindings()
    const activeIdentityLabels = new Set(findings.map(findingIdentityLabel))
    const issuesByIdentity = new Map<string, Issue[]>()
    for (const issue of jiraIssues) {
      const identity = this.managedIdentityLabel(issue)
      if (identity) {
        issuesByIdentity.set(identity, [
          ...(issuesByIdentity.get(identity) ?? []),
          issue
        ])
      }
    }

    const updates = await this.closeResolvedIssues(
      jiraIssues,
      activeIdentityLabels
    )
    for (const finding of findings) {
      const identity = findingIdentityLabel(finding)
      const matches = issuesByIdentity.get(identity) ?? []
      if (matches.length > 1) {
        console.warn(
          `[Jira reconciliation] Multiple managed issues share ${identity}: ${matches.map(issue => issue.key).join(', ')}.`
        )
      }
      const active = matches.filter(issue => !this.isClosedIssue(issue))
      if (matches.length > 0) {
        const issue = this.preferredIssue(active.length ? active : matches)
        const action = await this.reconcileIssue(issue, finding)
        if (action)
          updates.push({
            action,
            webUrl: `${this.jiraBaseURI}/browse/${issue.key}`,
            summary: this.summary(finding)
          })
      } else {
        updates.push(await this.createIssue(finding))
      }
    }

    console.log(JSON.stringify(updates))
  }
}
