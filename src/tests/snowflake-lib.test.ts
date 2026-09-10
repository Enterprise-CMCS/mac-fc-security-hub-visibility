import {describe, expect, it} from 'vitest'
import {
  SnowflakeFindings,
  SnowflakeFindingsConfig,
  describeSnowflakeError,
  validateSnowflakeObjectName
} from '../libs/snowflake-lib'

const baseConfig: SnowflakeFindingsConfig = {
  account: 'example-account',
  username: 'jira-sync',
  privateKey: 'test-key',
  authenticator: 'SNOWFLAKE_JWT',
  warehouse: 'TEAM_CMCS_WH',
  database: 'BUS_CMCS',
  schema: 'PRIVATE',
  view: 'BUS_CMCS.PRIVATE.VW_GLOBAL_SECURITY_FINDINGS',
  fismaIds: [],
  fismaAcronyms: ['MAC-FC'],
  maxRows: 5000
}

describe('Snowflake object-name validation', () => {
  it('allows unquoted one-to-three-part identifiers', () => {
    expect(
      validateSnowflakeObjectName(
        'BUS_CMCS.PRIVATE.VW_GLOBAL_SECURITY_FINDINGS',
        'snowflake-view'
      )
    ).toBe('BUS_CMCS.PRIVATE.VW_GLOBAL_SECURITY_FINDINGS')
  })

  it('rejects SQL expressions and extra qualification', () => {
    expect(() =>
      validateSnowflakeObjectName('SAFE_VIEW; DROP TABLE X', 'snowflake-view')
    ).toThrow(/unquoted Snowflake identifier/)
    expect(() =>
      validateSnowflakeObjectName('A.B.C.D', 'snowflake-view')
    ).toThrow(/unquoted Snowflake identifier/)
  })
})

describe('Snowflake connection diagnostics', () => {
  it('reports safe driver and HTTP response details', () => {
    const error = Object.assign(new Error('Request to Snowflake failed.'), {
      code: 401002,
      response: {
        statusCode: 403,
        statusMessage: 'Forbidden',
        body: JSON.stringify({
          code: '390422',
          message: 'Incoming request rejected by network policy.'
        })
      }
    })

    expect(describeSnowflakeError(error)).toBe(
      'message=Request to Snowflake failed.; driverCode=401002; httpStatus=403; httpStatusMessage=Forbidden; snowflakeCode=390422; snowflakeMessage=Incoming request rejected by network policy.'
    )
  })
})

describe('Snowflake query safety', () => {
  it('requires exactly one authoritative FISMA boundary', () => {
    expect(
      () =>
        new SnowflakeFindings({
          ...baseConfig,
          fismaAcronyms: []
        })
    ).toThrow(/one authoritative FISMA boundary/)
    expect(
      () =>
        new SnowflakeFindings({
          ...baseConfig,
          fismaIds: ['FISMA-1']
        })
    ).toThrow(/one authoritative FISMA boundary/)
  })

  it('requires credentials for the selected authenticator', () => {
    expect(
      () => new SnowflakeFindings({...baseConfig, privateKey: undefined})
    ).toThrow(/snowflake-private-key is required/)
    expect(
      () =>
        new SnowflakeFindings({
          ...baseConfig,
          authenticator: 'SNOWFLAKE',
          privateKey: undefined
        })
    ).toThrow(/snowflake-password is required/)
  })

  it('binds filter values and reserves one extra row for truncation detection', () => {
    const client = new SnowflakeFindings(baseConfig) as unknown as {
      buildQuery(): {sqlText: string; binds: Array<string | number>}
    }
    const query = client.buildQuery()

    expect(query.sqlText).toContain(
      'FROM BUS_CMCS.PRIVATE.VW_GLOBAL_SECURITY_FINDINGS'
    )
    expect(query.sqlText).toContain('LIMIT 5001')
    expect(query.sqlText).not.toContain('MAC-FC')
    expect(query.sqlText).not.toContain('TOOL_NAME) IN')
    expect(query.sqlText).not.toContain('NORMALIZED_SEVERITY) IN')
    expect(query.sqlText).not.toContain('DATEADD')
    expect(query.binds).toEqual(['MAC-FC'])
    expect(query.sqlText.match(/\?/g)).toHaveLength(query.binds.length)
  })

  it('queries all open tools and severities for one bound FISMA ID', () => {
    const client = new SnowflakeFindings({
      ...baseConfig,
      fismaIds: ['FISMA-1'],
      fismaAcronyms: []
    }) as unknown as {
      buildQuery(): {sqlText: string; binds: Array<string | number>}
    }
    const query = client.buildQuery()

    expect(query.sqlText).toContain("UPPER(STATUS) = 'OPEN'")
    expect(query.sqlText).toContain('UPPER(FISMA_ID) = ?')
    expect(query.sqlText).not.toContain('UPPER(TOOL_NAME) IN')
    expect(query.sqlText).not.toContain('UPPER(NORMALIZED_SEVERITY) IN')
    expect(query.binds).toEqual(['FISMA-1'])
  })

  it('optionally binds one tool after the authoritative FISMA filter', () => {
    const client = new SnowflakeFindings({
      ...baseConfig,
      toolName: ' kubebench '
    }) as unknown as {
      buildQuery(): {sqlText: string; binds: Array<string | number>}
    }
    const query = client.buildQuery()

    expect(query.sqlText).toContain('UPPER(FISMA_ACRONYM) = ?')
    expect(query.sqlText).toContain('UPPER(TOOL_NAME) = ?')
    expect(query.sqlText).not.toContain('KUBEBENCH')
    expect(query.binds).toEqual(['MAC-FC', 'KUBEBENCH'])
    expect(query.sqlText.match(/\?/g)).toHaveLength(query.binds.length)
  })

  it('rejects a supplied tool filter that is blank', () => {
    expect(
      () => new SnowflakeFindings({...baseConfig, toolName: '   '})
    ).toThrow(/snowflake-tool must not be blank/)
  })
})
