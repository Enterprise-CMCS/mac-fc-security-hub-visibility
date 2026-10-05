import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  Jira,
  JiraConfig,
  NewIssueData,
  resolveJiraApiVersion
} from '../libs/jira-lib'

function jiraConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    jiraBaseURI: 'https://sfji.atlassian.net',
    jiraUsername: 'user@example.com',
    jiraToken: 'token',
    jiraProjectKey: 'MACFC',
    jiraIgnoreStatuses: 'Done, Closed, Resolved',
    jiraAssignee: 'account-id-1',
    transitionMap: [],
    dryRunTestData: true,
    includeAllProducts: false,
    jiraApiVersion: '3',
    dueDateCritical: '10',
    dueDateHigh: '20',
    dueDateModerate: '30',
    dueDateLow: '40',
    jiraDueDateField: 'customfield_12345',
    ...overrides
  }
}

describe('Jira API version resolution', () => {
  it('forces Atlassian Cloud onto the supported v3 API', () => {
    expect(resolveJiraApiVersion('https://sfji.atlassian.net', '2')).toBe('3')
    expect(resolveJiraApiVersion('https://sfji.atlassian.net/', '3')).toBe('3')
  })

  it('preserves configured API versions for non-Cloud Jira servers', () => {
    expect(resolveJiraApiVersion('https://jiraent.cms.gov', '2')).toBe('2')
  })

  it('does not classify lookalike hosts as Atlassian Cloud', () => {
    expect(
      resolveJiraApiVersion('https://atlassian.net.example.com', '2')
    ).toBe('2')
  })
})

describe('Snowflake-compatible Jira creation settings', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses accountId for a Snowflake Jira Cloud assignee when requested', async () => {
    const issue: NewIssueData = {
      fields: {
        summary: 'Finding',
        description: 'Description',
        labels: ['HIGH']
      }
    }

    await new Jira(jiraConfig({jiraAssigneeUseAccountId: true})).createNewIssue(
      issue
    )

    expect(issue.fields.assignee).toEqual({accountId: 'account-id-1'})
  })

  it('preserves the existing Security Hub assignee shape by default', async () => {
    const issue: NewIssueData = {
      fields: {
        summary: 'Finding',
        description: 'Description',
        labels: ['HIGH']
      }
    }

    await new Jira(jiraConfig()).createNewIssue(issue)

    expect(issue.fields.assignee).toEqual({name: 'account-id-1'})
  })

  it('uses the plain severity label for the configured due-date field', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
    const issue: NewIssueData = {
      fields: {
        summary: 'Critical finding',
        description: 'Description',
        labels: ['severity-critical', 'CRITICAL']
      }
    }

    await new Jira(jiraConfig({jiraAssignee: undefined})).createNewIssue(issue)

    expect(issue.fields.duedate).toBe('2026-10-15')
    expect(issue.fields.customfield_12345).toBe('2026-10-15')
  })
})
