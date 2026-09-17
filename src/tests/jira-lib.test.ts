import {describe, expect, it} from 'vitest'
import {resolveJiraApiVersion} from '../libs/jira-lib'

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
