import {afterEach, describe, expect, it, vi} from 'vitest'
import {AxiosError, AxiosInstance, InternalAxiosRequestConfig} from 'axios'
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

describe('Snowflake watcher recovery', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('retries watcher 404s after 1, 2, and 4 seconds without repeating creation', async () => {
    vi.useFakeTimers()
    const jira = new Jira(
      jiraConfig({
        dryRunTestData: false,
        jiraWatchers: 'watcher@example.com',
        jiraWatcherRecovery: true
      })
    )
    const client = (jira as unknown as {axiosInstance: AxiosInstance})
      .axiosInstance
    const notFound = new AxiosError(
      'Not found',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
        data: {}
      }
    )
    const post = vi
      .spyOn(client, 'post')
      .mockImplementation(async (url: string) => {
        if (url.endsWith('/issue')) return {data: {key: 'SCRUM-30', id: '30'}}
        if (
          url.endsWith('/watchers') &&
          post.mock.calls.filter(([path]) => path.endsWith('/watchers'))
            .length <= 3
        )
          throw notFound
        return {data: {}}
      })
    vi.spyOn(jira, 'getCurrentUser').mockResolvedValue({
      name: 'creator',
      accountId: 'creator-id'
    })
    vi.spyOn(client, 'delete').mockResolvedValue({})
    vi.spyOn(client, 'get').mockResolvedValue({
      data: [{accountId: 'watcher-id', emailAddress: 'watcher@example.com'}]
    })
    const pending = jira.createNewIssue({fields: {summary: 'Finding'}})
    await vi.advanceTimersByTimeAsync(7000)
    await expect(pending).resolves.toMatchObject({key: 'SCRUM-30'})
    expect(
      post.mock.calls.filter(([url]) => url.endsWith('/issue'))
    ).toHaveLength(1)
    expect(
      post.mock.calls.filter(([url]) => url.endsWith('/watchers'))
    ).toHaveLength(4)
  })

  it('keeps an explicitly configured authenticated watcher', async () => {
    const jira = new Jira(
      jiraConfig({
        dryRunTestData: false,
        jiraWatchers: 'creator@example.com',
        jiraWatcherRecovery: true
      })
    )
    const client = (jira as unknown as {axiosInstance: AxiosInstance})
      .axiosInstance
    vi.spyOn(jira, 'getCurrentUser').mockResolvedValue({
      accountId: 'creator-id',
      emailAddress: 'creator@example.com'
    })
    const remove = vi.spyOn(client, 'delete')
    await jira.removeCurrentUserAsWatcher('SCRUM-30')
    expect(remove).not.toHaveBeenCalled()
  })

  it('warns with the created issue when watcher setup fails', async () => {
    const jira = new Jira(
      jiraConfig({
        dryRunTestData: false,
        jiraWatchers: 'watcher@example.com',
        jiraWatcherRecovery: true
      })
    )
    const client = (jira as unknown as {axiosInstance: AxiosInstance})
      .axiosInstance
    vi.spyOn(client, 'post').mockResolvedValue({
      data: {key: 'SCRUM-30', id: '30'}
    })
    vi.spyOn(jira, 'removeCurrentUserAsWatcher').mockRejectedValue(
      new Error('watcher failure')
    )
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      jira.createNewIssue({fields: {summary: 'Finding'}})
    ).resolves.toMatchObject({key: 'SCRUM-30'})
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'Issue SCRUM-30 was created, but watcher setup failed'
      )
    )
  })

  it('never retries an issue creation request after a network failure', async () => {
    const jira = new Jira(
      jiraConfig({dryRunTestData: false, jiraWatcherRecovery: true})
    )
    const client = (jira as unknown as {axiosInstance: AxiosInstance})
      .axiosInstance
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError('Connection reset', 'ECONNRESET', config)
    })
    client.defaults.adapter = adapter

    await expect(
      jira.createNewIssue({fields: {summary: 'Finding'}})
    ).rejects.toThrow()
    expect(adapter).toHaveBeenCalledTimes(1)
  })
})
