import snowflake from 'snowflake-sdk'

export type SnowflakeAuthenticator = 'SNOWFLAKE' | 'SNOWFLAKE_JWT'

export interface SnowflakeFindingsConfig {
  account: string
  username: string
  password?: string
  privateKey?: string
  privateKeyPassphrase?: string
  authenticator: SnowflakeAuthenticator
  warehouse: string
  role?: string
  database: string
  schema: string
  view: string
  fismaIds: string[]
  fismaAcronyms: string[]
  toolName?: string
  maxRows: number
}

export interface GlobalSecurityFinding {
  fismaId: string
  fismaAcronym: string
  resourceId: string
  findingId: string
  toolName: string
  status: string
  severity: string
  normalizedSeverity: string
  severityScore: number
  createdAt?: Date
  closedAt?: Date
  findingAge: number
  rawFinding: Record<string, unknown>
}

type SnowflakeRow = Record<string, unknown>
type UnknownRecord = Record<string, unknown>

const OBJECT_NAME_PART = '[A-Za-z_][A-Za-z0-9_$]*'
const QUALIFIED_OBJECT_NAME = new RegExp(
  `^${OBJECT_NAME_PART}(\\.${OBJECT_NAME_PART}){0,2}$`
)

export function validateSnowflakeObjectName(
  value: string,
  inputName: string
): string {
  if (!QUALIFIED_OBJECT_NAME.test(value)) {
    throw new Error(
      `${inputName} must be an unquoted Snowflake identifier with at most three parts.`
    )
  }
  return value
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function parseRawFinding(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object'
    ? (value as UnknownRecord)
    : undefined
}

export function describeSnowflakeError(error: unknown): string {
  const details = asRecord(error)
  if (!details) return String(error)

  const parts: string[] = []
  const add = (label: string, value: unknown): void => {
    if (value !== undefined && value !== null && String(value).trim()) {
      parts.push(`${label}=${String(value)}`)
    }
  }

  add('message', details.message)
  add('driverCode', details.code)
  add('sqlState', details.sqlState)

  const response = asRecord(details.response)
  add('httpStatus', response?.statusCode)
  add('httpStatusMessage', response?.statusMessage)

  let responseBody: UnknownRecord | undefined
  if (typeof response?.body === 'string') {
    try {
      responseBody = asRecord(JSON.parse(response.body))
    } catch {
      // Do not emit an unstructured response body because it can contain
      // gateway or proxy details that are unrelated to the Snowflake error.
    }
  } else {
    responseBody = asRecord(response?.body)
  }
  add('snowflakeCode', responseBody?.code)
  add('snowflakeMessage', responseBody?.message)

  const cause = asRecord(details.cause)
  add('causeCode', cause?.code)
  add('causeMessage', cause?.message)

  return parts.length > 0 ? parts.join('; ') : String(error)
}

function mapRow(row: SnowflakeRow): GlobalSecurityFinding {
  return {
    fismaId: asString(row.FISMA_ID),
    fismaAcronym: asString(row.FISMA_ACRONYM),
    resourceId: asString(row.RESOURCE_ID),
    findingId: asString(row.FINDING_ID),
    toolName: asString(row.TOOL_NAME).toUpperCase(),
    status: asString(row.STATUS).toUpperCase(),
    severity: asString(row.SEVERITY).toUpperCase(),
    normalizedSeverity: asString(row.NORMALIZED_SEVERITY).toUpperCase(),
    severityScore: Number(row.SEVERITY_SCORE ?? -1),
    createdAt: asDate(row.CREATED_AT),
    closedAt: asDate(row.CLOSED_AT),
    findingAge: Number(row.FINDING_AGE ?? 0),
    rawFinding: parseRawFinding(row.RAW_FINDING_JSON)
  }
}

export class SnowflakeFindings {
  constructor(private readonly config: SnowflakeFindingsConfig) {
    validateSnowflakeObjectName(config.database, 'snowflake-database')
    validateSnowflakeObjectName(config.schema, 'snowflake-schema')
    validateSnowflakeObjectName(config.view, 'snowflake-view')

    if (config.fismaIds.length + config.fismaAcronyms.length !== 1) {
      throw new Error(
        'Exactly one snowflake-fisma-id or snowflake-fisma-acronym is required. Refusing a global-view query without one authoritative FISMA boundary.'
      )
    }
    if (config.toolName !== undefined && !config.toolName.trim()) {
      throw new Error('snowflake-tool must not be blank when supplied.')
    }
    if (!Number.isSafeInteger(config.maxRows) || config.maxRows < 1) {
      throw new Error('snowflake-max-rows must be a positive integer.')
    }
    if (config.authenticator === 'SNOWFLAKE' && !config.password) {
      throw new Error(
        'snowflake-password is required for SNOWFLAKE authentication.'
      )
    }
    if (config.authenticator === 'SNOWFLAKE_JWT' && !config.privateKey) {
      throw new Error(
        'snowflake-private-key is required for SNOWFLAKE_JWT authentication.'
      )
    }
  }

  private buildQuery(): {sqlText: string; binds: Array<string | number>} {
    const predicates = ["UPPER(STATUS) = 'OPEN'"]
    const binds: Array<string | number> = []

    if (this.config.fismaIds.length > 0) {
      predicates.push('UPPER(FISMA_ID) = ?')
      binds.push(...this.config.fismaIds)
    } else {
      predicates.push('UPPER(FISMA_ACRONYM) = ?')
      binds.push(...this.config.fismaAcronyms)
    }

    if (this.config.toolName) {
      predicates.push('UPPER(TOOL_NAME) = ?')
      binds.push(this.config.toolName.trim().toUpperCase())
    }

    const rowLimit = this.config.maxRows + 1
    return {
      sqlText: `
SELECT
  FISMA_ID,
  FISMA_ACRONYM,
  RESOURCE_ID,
  FINDING_ID,
  TOOL_NAME,
  STATUS,
  SEVERITY,
  CREATED_AT,
  CLOSED_AT,
  FINDING_AGE,
  NORMALIZED_SEVERITY,
  SEVERITY_SCORE,
  TO_JSON(RAW_FINDING) AS RAW_FINDING_JSON
FROM ${this.config.view}
WHERE ${predicates.join('\n  AND ')}
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY UPPER(TOOL_NAME), FISMA_ID, RESOURCE_ID, FINDING_ID
  ORDER BY CREATED_AT DESC NULLS LAST
) = 1
ORDER BY SEVERITY_SCORE DESC, CREATED_AT, TOOL_NAME, FINDING_ID
LIMIT ${rowLimit}`,
      binds
    }
  }

  async getOpenFindings(): Promise<GlobalSecurityFinding[]> {
    const connection = snowflake.createConnection({
      account: this.config.account,
      username: this.config.username,
      password: this.config.password,
      privateKey: this.config.privateKey,
      privateKeyPass: this.config.privateKeyPassphrase,
      authenticator: this.config.authenticator,
      warehouse: this.config.warehouse,
      database: this.config.database,
      schema: this.config.schema,
      role: this.config.role,
      application: 'MACFC_GLOBAL_SECURITY_FINDINGS_JIRA_SYNC',
      queryTag: 'macfc-global-security-findings-jira-sync'
    })

    await new Promise<void>((resolve, reject) => {
      connection.connect(error => {
        if (error)
          reject(
            new Error(
              `Unable to connect to Snowflake: ${describeSnowflakeError(error)}`
            )
          )
        else resolve()
      })
    })

    try {
      const {sqlText, binds} = this.buildQuery()
      const rows = await new Promise<SnowflakeRow[]>((resolve, reject) => {
        connection.execute({
          sqlText,
          binds,
          complete: (error, _statement, resultRows) => {
            if (error) {
              reject(
                new Error(
                  `Unable to query Snowflake findings: ${error.message}`
                )
              )
            } else {
              resolve((resultRows ?? []) as SnowflakeRow[])
            }
          }
        })
      })

      if (rows.length > this.config.maxRows) {
        throw new Error(
          `Snowflake returned more than snowflake-max-rows (${this.config.maxRows}). Increase the limit or review the authoritative FISMA boundary; no Jira reconciliation was attempted.`
        )
      }

      return rows.map(mapRow)
    } finally {
      await new Promise<void>((resolve, reject) => {
        connection.destroy(error => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  }
}
