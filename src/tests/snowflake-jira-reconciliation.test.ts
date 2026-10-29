import {afterEach, describe, expect, it, vi} from 'vitest'
import {AxiosInstance} from 'axios'
import {Jira, JiraConfig, NewIssueData} from '../libs/jira-lib'
import {
  assertIdentity,
  creationState,
  DESCRIPTION_END,
  DESCRIPTION_START,
  dueDateAnchor,
  mergeDescription,
  reconcileFields,
  SNOWFLAKE_STATE_KEY,
  SnowflakeIssue,
  SnowflakePatch
} from '../libs/snowflake-jira-reconciliation'

const identity = 'global-finding-test'
const anchor = '2026-10-01T00:00:00.000Z'
const block = (text: string) =>
  `${DESCRIPTION_START}\n${text}\n${DESCRIPTION_END}`
const desired = (): NewIssueData => ({
  fields: {
    summary: '[KUBEBENCH] Finding',
    description: block('Current evidence'),
    labels: [
      'global-security-findings',
      'snowflake-findings',
      identity,
      'severity-high',
      'HIGH',
      'configured'
    ],
    priority: {name: 'High'},
    assignee: {accountId: 'user-1'},
    duedate: '2026-10-31',
    customfield_123: 'configured value'
  }
})
function existing(): SnowflakeIssue {
  return {
    id: '30',
    key: 'SCRUM-30',
    webUrl: '',
    fields: {
      summary: 'Old title',
      description: 'Analyst notes',
      labels: [identity, 'human-label', 'severity-low', 'LOW'],
      customfield_999: 'Human-owned value',
      created: anchor
    }
  }
}
function apply(issue: SnowflakeIssue, patch: SnowflakePatch): SnowflakeIssue {
  const labels = new Set(issue.fields.labels)
  for (const operation of patch.update?.labels ?? []) {
    if ('add' in operation) labels.add(operation.add)
    else labels.delete(operation.remove)
  }
  return {
    ...issue,
    fields: {...issue.fields, ...patch.fields, labels: [...labels]},
    properties: {
      ...issue.properties,
      ...Object.fromEntries(
        patch.properties.map(property => [property.key, property.value])
      )
    }
  }
}
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{type: 'text', text}]
})
const adf = (text: string) => ({
  type: 'doc',
  version: 1,
  content: [
    paragraph(DESCRIPTION_START),
    paragraph(text),
    paragraph(DESCRIPTION_END)
  ]
})

describe('Snowflake field reconciliation', () => {
  it('merges managed fields without deleting human labels, notes or unrelated fields', () => {
    const issue = existing()
    const patch = reconcileFields(issue, desired(), anchor, ['duedate'])!
    const merged = apply(issue, patch)
    expect(merged.fields.labels).toEqual(
      expect.arrayContaining([
        identity,
        'human-label',
        'severity-high',
        'HIGH',
        'configured'
      ])
    )
    expect(merged.fields.labels).not.toContain('severity-low')
    expect(merged.fields.labels).not.toContain('LOW')
    expect(patch.fields).not.toHaveProperty('labels')
    expect(patch.fields).not.toHaveProperty('customfield_999')
    expect(merged.fields.customfield_999).toBe('Human-owned value')
    expect(merged.fields.description).toBe(
      `Analyst notes\n\n${block('Current evidence')}`
    )
    expect(merged.fields.assignee).toEqual({accountId: 'user-1'})
    expect(merged.fields.priority).toEqual({name: 'High'})
    expect(merged.fields.summary).toBe('[KUBEBENCH] Finding')
    // Jira enriches values in GET responses; that must not cause perpetual PUTs.
    merged.fields.assignee = {
      accountId: 'user-1',
      displayName: 'A User'
    } as typeof merged.fields.assignee
    merged.fields.priority = {name: 'High', id: '2'}
    expect(
      reconcileFields(merged, desired(), anchor, ['duedate'])
    ).toBeUndefined()
  })

  it('removes obsolete owned labels while preserving pre-existing configured labels', () => {
    const initial = existing()
    initial.fields.labels!.push('pre-existing')
    const first = desired()
    first.fields.labels!.push('pre-existing')
    const adopted = apply(
      initial,
      reconcileFields(initial, first, anchor, ['duedate'])!
    )
    const changed = desired()
    changed.fields.labels = [
      'global-security-findings',
      'snowflake-findings',
      identity,
      'severity-critical',
      'CRITICAL',
      'new-config'
    ]
    const patch = reconcileFields(adopted, changed, anchor, ['duedate'])!
    const merged = apply(adopted, patch)
    expect(merged.fields.labels).toContain('pre-existing')
    expect(merged.fields.labels).toContain('human-label')
    expect(merged.fields.labels).not.toContain('configured')
    expect(merged.fields.labels).not.toContain('severity-high')
    expect(
      reconcileFields(merged, changed, anchor, ['duedate'])
    ).toBeUndefined()
  })

  it('updates automation-owned dates from a fixed anchor and preserves manual overrides', () => {
    const prepared = desired()
    const issue = {
      ...existing(),
      fields: {...prepared.fields, created: anchor},
      properties: {
        [SNOWFLAKE_STATE_KEY]: creationState(prepared, anchor, ['duedate'])
      }
    }
    expect(dueDateAnchor(issue, new Date('2027-01-01'))).toBe(anchor)
    const changed = desired()
    changed.fields.duedate = '2026-10-16'
    expect(
      reconcileFields(issue, changed, anchor, ['duedate'])?.fields.duedate
    ).toBe('2026-10-16')
    issue.fields.duedate = '2026-10-10'
    expect(reconcileFields(issue, changed, anchor, ['duedate'])).toBeUndefined()
    const legacy = existing()
    legacy.fields.duedate = '2026-12-01'
    expect(
      reconcileFields(legacy, desired(), anchor, ['duedate'])?.fields
    ).not.toHaveProperty('duedate')
  })

  it('preserves fields whose configuration is absent and compares enriched custom values', () => {
    const issue = existing()
    issue.fields.assignee = {accountId: 'human-assignee'}
    issue.fields.customfield_123 = [
      {id: '1', value: 'Red', self: 'url'},
      {id: '2', value: 'Blue'}
    ]
    const target = desired()
    delete target.fields.assignee
    target.fields.customfield_123 = [{value: 'Blue'}, {value: 'Red'}]
    const patch = reconcileFields(issue, target, anchor, ['duedate'])!
    expect(patch.fields).not.toHaveProperty('assignee')
    expect(patch.fields).not.toHaveProperty('customfield_123')
  })

  it('preserves ADF notes and formatting while refreshing only the managed section', () => {
    const note = {
      type: 'paragraph',
      content: [{type: 'text', text: 'Analyst note', marks: [{type: 'strong'}]}]
    }
    const table = {type: 'table', content: []}
    const current = {
      ...adf('Old evidence'),
      content: [note, ...adf('Old evidence').content, table]
    }
    const result = mergeDescription(current, adf('New evidence'))
    expect(result).toEqual({
      ...current,
      content: [note, ...adf('New evidence').content, table]
    })
    expect(mergeDescription(result, adf('New evidence'))).toEqual(result)
    expect(
      mergeDescription(
        {type: 'doc', version: 1, content: [note]},
        adf('New evidence')
      )
    ).toEqual({
      type: 'doc',
      version: 1,
      content: [note, ...adf('New evidence').content]
    })
  })

  it('refuses conflicting identities and malformed description boundaries', () => {
    const issue = existing()
    issue.fields.labels!.push('global-finding-other')
    expect(() => assertIdentity(issue, identity)).toThrow(
      'conflicting or missing'
    )
    expect(() =>
      reconcileFields(issue, desired(), anchor, ['duedate'])
    ).toThrow('conflicting or missing')
    expect(() =>
      mergeDescription(`${DESCRIPTION_START}\nHuman notes`, block('New'))
    ).toThrow('Ambiguous')
  })
})

const config = (overrides: Partial<JiraConfig> = {}): JiraConfig => ({
  jiraBaseURI: 'https://sfji.atlassian.net',
  jiraUsername: 'user@example.com',
  jiraToken: 'test',
  jiraProjectKey: 'SCRUM',
  jiraIgnoreStatuses: 'Done',
  transitionMap: [],
  includeAllProducts: false,
  dryRunTestData: true,
  jiraAssigneeUseAccountId: true,
  jiraAssignee: 'user-1',
  jiraDueDateField: 'customfield_456',
  ...overrides
})

describe('Snowflake Jira transport isolation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('anchors creation and update preparation to the same date', async () => {
    const jira = new Jira(config())
    const first = await jira.prepareSnowflakeFields(desired(), anchor)
    const second = await jira.prepareSnowflakeFields(desired(), anchor)
    expect(second).toEqual(first)
    expect(first.fields.duedate).toBe('2026-10-31')
    expect(first.fields.customfield_456).toBe('2026-10-31')
    expect(first.fields.assignee).toEqual({accountId: 'user-1'})
    expect(first.fields.description.type).toBe('doc')
  })

  it('does not mutate Jira during dry-run creation, field updates or watcher repair', async () => {
    const jira = new Jira(config({jiraWatchers: 'watcher@example.com'}))
    const client = (jira as unknown as {axiosInstance: AxiosInstance})
      .axiosInstance
    const post = vi.spyOn(client, 'post')
    const put = vi.spyOn(client, 'put')
    const remove = vi.spyOn(client, 'delete')
    const state = creationState(desired(), anchor, ['duedate'])
    await jira.createSnowflakeIssue(desired(), state)
    await jira.updateSnowflakeIssue(
      'SCRUM-30',
      reconcileFields(existing(), desired(), anchor, ['duedate'])!
    )
    await jira.reconcileSnowflakeWatchers('SCRUM-30')
    expect(post).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('writes fields and ownership metadata together using label add/remove operations', async () => {
    const jira = new Jira(config({dryRunTestData: false}))
    const client = (jira as unknown as {axiosInstance: AxiosInstance})
      .axiosInstance
    const put = vi.spyOn(client, 'put').mockResolvedValue({})
    const patch = reconcileFields(existing(), desired(), anchor, ['duedate'])!
    await jira.updateSnowflakeIssue('SCRUM-30', patch)
    expect(put).toHaveBeenCalledWith('/rest/api/3/issue/SCRUM-30', patch)
    expect(patch.properties[0].key).toBe(SNOWFLAKE_STATE_KEY)
    expect(patch.update?.labels).toContainEqual({add: 'severity-high'})
    expect(patch.update?.labels).toContainEqual({remove: 'severity-low'})
  })

  it('keeps a successful creation when watcher setup fails', async () => {
    const jira = new Jira(
      config({dryRunTestData: false, jiraWatchers: 'watcher@example.com'})
    )
    const client = (jira as unknown as {axiosInstance: AxiosInstance})
      .axiosInstance
    const post = vi
      .spyOn(client, 'post')
      .mockResolvedValue({data: {id: '30', key: 'SCRUM-30'}})
    vi.spyOn(jira, 'removeCurrentUserAsWatcher').mockRejectedValue(
      new Error('Watcher removal failed')
    )
    vi.spyOn(jira, 'addUserAsWatcher').mockRejectedValue(
      new Error('Watcher setup failed')
    )
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = creationState(desired(), anchor, ['duedate'])
    const created = await jira.createSnowflakeIssue(desired(), state)
    expect(created.key).toBe('SCRUM-30')
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/rest/api/3/issue', {
      ...desired(),
      properties: [{key: SNOWFLAKE_STATE_KEY, value: state}]
    })
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('[Jira partial success] Issue SCRUM-30')
    )
  })
})
