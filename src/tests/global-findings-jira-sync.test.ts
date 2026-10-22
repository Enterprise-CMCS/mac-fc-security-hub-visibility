import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  configuredSnowflakeLabels,
  findingIdentity,
  findingIdentityLabel,
  findingFismaLabels,
  reconciliationFismaLabel,
  reconciliationLabels,
  reconciliationToolLabel,
  findingTitle,
  SNOWFLAKE_FINDINGS_LABEL
} from '../global-findings-jira-sync'
import {GlobalFindingsJiraSync} from '../global-findings-jira-sync'
import {Jira, JiraConfig, NewIssueData} from '../libs/jira-lib'
import {GlobalSecurityFinding} from '../libs/snowflake-lib'
import {SnowflakeFindings, SnowflakeFindingsConfig} from '../libs/snowflake-lib'

function finding(
  overrides: Partial<GlobalSecurityFinding> = {}
): GlobalSecurityFinding {
  return {
    fismaId: 'FISMA-1',
    fismaAcronym: 'MAC-FC',
    resourceId: 'arn:aws:s3:::example',
    findingId: 'finding-1',
    toolName: 'SECURITYHUB',
    status: 'OPEN',
    severity: 'HIGH',
    normalizedSeverity: 'HIGH',
    severityScore: 3,
    findingAge: 12,
    rawFinding: {TITLE: 'Public S3 bucket'},
    ...overrides
  }
}

describe('global finding identity', () => {
  it('is stable for the same finding and changes with resource identity', () => {
    const first = finding()
    expect(findingIdentity(first)).toBe(
      'SECURITYHUB|FISMA-1|arn:aws:s3:::example|finding-1'
    )
    expect(findingIdentityLabel(first)).toBe(findingIdentityLabel({...first}))
    expect(
      findingIdentityLabel(finding({resourceId: 'arn:aws:s3:::different'}))
    ).not.toBe(findingIdentityLabel(first))
  })

  it('uses a source title and falls back to the finding id', () => {
    expect(findingTitle(finding())).toBe('Public S3 bucket')
    expect(findingTitle(finding({rawFinding: {}}))).toBe(
      'SECURITYHUB finding finding-1'
    )
  })

  it('keeps FISMA ownership labels separate from finding identity', () => {
    expect(SNOWFLAKE_FINDINGS_LABEL).toBe('snowflake-findings')
    expect(findingFismaLabels(finding())).toEqual([
      'fisma-id-fisma-1',
      'fisma-acronym-mac-fc'
    ])
    expect(
      reconciliationFismaLabel({fismaIds: ['FISMA-1'], fismaAcronyms: []})
    ).toBe('fisma-id-fisma-1')
    expect(
      reconciliationFismaLabel({fismaIds: [], fismaAcronyms: ['MAC-FC']})
    ).toBe('fisma-acronym-mac-fc')
    expect(reconciliationToolLabel('KUBEBENCH')).toBe('tool-kubebench')
    expect(reconciliationToolLabel()).toBeUndefined()
    expect(
      reconciliationLabels({
        fismaIds: [],
        fismaAcronyms: ['MAC-FC']
      })
    ).toEqual([
      'global-security-findings',
      'snowflake-findings',
      'fisma-acronym-mac-fc'
    ])
    expect(
      reconciliationLabels({
        fismaIds: [],
        fismaAcronyms: ['MAC-FC'],
        toolName: 'KUBEBENCH'
      })
    ).toEqual([
      'global-security-findings',
      'snowflake-findings',
      'fisma-acronym-mac-fc',
      'tool-kubebench'
    ])
  })

  it('builds compatible Snowflake labels and ignores Security Hub-only fields', () => {
    expect(
      configuredSnowflakeLabels(
        finding({rawFinding: {CVE: 'CVE-2026-12345', RULE: 'cis rule'}}),
        [
          {labelField: 'severity'},
          {labelField: 'toolName', labelPrefix: 'tool', labelDelimiter: ':'},
          {
            labelField: 'fismaAcronym',
            labelPrefix: 'fisma',
            labelDelimiter: ':'
          },
          {labelField: 'CVE'},
          {labelField: 'RULE', labelPrefix: 'rule', labelDelimiter: ':'},
          {labelField: 'accountId'},
          {labelField: 'region'},
          {labelField: 'ProductName'}
        ]
      )
    ).toEqual([
      'HIGH',
      'tool:SECURITYHUB',
      'fisma:MAC-FC',
      'CVE-2026-12345',
      'rule:cisrule'
    ])
  })

  it('normalizes INFO for compatible severity labels', () => {
    expect(
      configuredSnowflakeLabels(finding({normalizedSeverity: 'INFO'}), [
        {labelField: 'severity'}
      ])
    ).toEqual(['INFORMATIONAL'])
  })
})

function jiraConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    jiraBaseURI: 'https://sfji.atlassian.net',
    jiraUsername: 'user@example.com',
    jiraToken: 'token',
    jiraProjectKey: 'MACFC',
    jiraIgnoreStatuses: 'Done, Closed, Resolved',
    jiraAssignee: 'account-id-1',
    jiraWatchers: '',
    jiraAddLabels: 'team-label, another-label',
    transitionMap: [],
    dryRunTestData: true,
    includeAllProducts: false,
    jiraApiVersion: '3',
    jiraLabelsConfig: JSON.stringify([
      {labelField: 'severity'},
      {labelField: 'toolName', labelPrefix: 'configured', labelDelimiter: '-'},
      {labelField: 'accountId'}
    ]),
    jiraLinkIdOnCreation: 'MACFC-1',
    jiraLinkTypeOnCreation: 'Relates',
    jiraLinkDirectionOnCreation: 'inward',
    jiraLinkIdOnClosure: 'MACFC-2',
    jiraLinkTypeOnClosure: 'Blocks',
    jiraLinkDirectionOnClosure: 'outward',
    ...overrides
  }
}

function snowflakeConfig(): SnowflakeFindingsConfig {
  return {
    account: 'account',
    username: 'username',
    privateKey: 'private-key',
    authenticator: 'SNOWFLAKE_JWT',
    warehouse: 'warehouse',
    database: 'BUS_CMCS',
    schema: 'PRIVATE',
    view: 'BUS_CMCS.PRIVATE.VW_GLOBAL_SECURITY_FINDINGS',
    fismaIds: [],
    fismaAcronyms: ['MAC-FC'],
    toolName: 'KUBEBENCH',
    maxRows: 100
  }
}

describe('Snowflake Jira configuration', () => {
  afterEach(() => vi.restoreAllMocks())

  it('applies configured labels and links newly created issues', async () => {
    vi.spyOn(
      Jira.prototype,
      'getAllManagedIssuesInJiraProject'
    ).mockResolvedValue([])
    vi.spyOn(SnowflakeFindings.prototype, 'getOpenFindings').mockResolvedValue([
      finding({toolName: 'KUBEBENCH', normalizedSeverity: 'CRITICAL'})
    ])
    const createIssue = vi
      .spyOn(Jira.prototype, 'createNewIssue')
      .mockImplementation(async (issue: NewIssueData) => ({
        id: '10001',
        key: 'MACFC-3',
        fields: issue.fields,
        webUrl: 'https://sfji.atlassian.net/browse/MACFC-3'
      }))
    const linkIssues = vi
      .spyOn(Jira.prototype, 'linkIssues')
      .mockResolvedValue()

    await new GlobalFindingsJiraSync(
      jiraConfig(),
      snowflakeConfig(),
      false
    ).sync()

    const created = createIssue.mock.calls[0][0]
    expect(created.fields.labels).toEqual(
      expect.arrayContaining([
        'global-security-findings',
        'snowflake-findings',
        'CRITICAL',
        'configured-KUBEBENCH',
        'team-label',
        'another-label'
      ])
    )
    expect(created.fields.labels).not.toContain('security-hub')
    expect(linkIssues).toHaveBeenCalledWith(
      'MACFC-3',
      'MACFC-1',
      'Relates',
      'inward'
    )
  })

  it('applies closure linking only to missing managed identities', async () => {
    vi.spyOn(
      Jira.prototype,
      'getAllManagedIssuesInJiraProject'
    ).mockResolvedValue([
      {
        id: '10002',
        key: 'MACFC-4',
        fields: {
          summary: 'stale',
          labels: ['global-finding-stale']
        },
        webUrl: 'https://sfji.atlassian.net/browse/MACFC-4'
      }
    ])
    vi.spyOn(SnowflakeFindings.prototype, 'getOpenFindings').mockResolvedValue(
      []
    )
    const closeIssue = vi
      .spyOn(Jira.prototype, 'closeIssue')
      .mockResolvedValue()
    vi.spyOn(Jira.prototype, 'addCommentToIssueById').mockResolvedValue()
    const linkIssues = vi
      .spyOn(Jira.prototype, 'linkIssues')
      .mockResolvedValue()

    await new GlobalFindingsJiraSync(
      jiraConfig(),
      snowflakeConfig(),
      true
    ).sync()

    expect(closeIssue).toHaveBeenCalledWith('MACFC-4')
    expect(linkIssues).toHaveBeenCalledWith(
      'MACFC-4',
      'MACFC-2',
      'Blocks',
      'outward'
    )
  })

  it('optionally reconciles watchers on an existing active managed ticket', async () => {
    const active = finding({toolName: 'KUBEBENCH'})
    vi.spyOn(
      Jira.prototype,
      'getAllManagedIssuesInJiraProject'
    ).mockResolvedValue([
      {
        id: '30',
        key: 'SCRUM-30',
        fields: {summary: 'Existing', labels: [findingIdentityLabel(active)]},
        webUrl: 'https://sfji.atlassian.net/browse/SCRUM-30'
      }
    ])
    vi.spyOn(SnowflakeFindings.prototype, 'getOpenFindings').mockResolvedValue([
      active
    ])
    const reconcile = vi
      .spyOn(Jira.prototype, 'reconcileWatchers')
      .mockResolvedValue()
    const create = vi.spyOn(Jira.prototype, 'createNewIssue')

    await new GlobalFindingsJiraSync(
      jiraConfig({
        jiraReconcileWatchers: true,
        jiraWatchers: 'watcher@example.com'
      }),
      snowflakeConfig(),
      false
    ).sync()

    expect(reconcile).toHaveBeenCalledWith('SCRUM-30')
    expect(create).not.toHaveBeenCalled()
  })
})
