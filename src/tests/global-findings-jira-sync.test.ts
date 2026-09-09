import {describe, expect, it} from 'vitest'
import {
  findingIdentity,
  findingIdentityLabel,
  findingFismaLabels,
  reconciliationFismaLabel,
  reconciliationLabels,
  reconciliationToolLabel,
  findingTitle,
  SNOWFLAKE_FINDINGS_LABEL
} from '../global-findings-jira-sync'
import {GlobalSecurityFinding} from '../libs/snowflake-lib'

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
})
