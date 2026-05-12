import { extractErrorMessage } from './index'
import { Jira, SecurityHub, SecurityHubFinding } from './libs'
import { Issue, NewIssueData, CustomFields, JiraConfig } from './libs/jira-lib'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { AwsSecurityFinding } from '@aws-sdk/client-securityhub'
import { Resource } from './libs'

/**
 * Retry helper for Jira transient 503 errors.
 */
async function retryOn503<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.response?.status
      if (status !== 503 || attempt === retries) {
        throw err
      }

      const delay = baseDelayMs * attempt
      console.warn(
        `Jira returned 503 (attempt ${attempt}/${retries}). Retrying in ${delay}ms...`
      )
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw new Error('Retry attempts exhausted')
}

interface UpdateForReturn {
  action: string
  webUrl: string
  summary: string
}

interface GeneralObj {
  [key: string]: number
}

export interface LabelConfig {
  labelField: string
  labelPrefix?: string
  labelDelimiter?: string
}

export interface SecurityHubJiraSyncConfig {
  region: string
  severities: string[]
  customJiraFields?: CustomFields
  newIssueDelay: string
  skipProducts?: string
  includeAllProducts: boolean
  consolidateTickets: boolean
}

export class SecurityHubJiraSync {
  private readonly jira: Jira
  private readonly securityHub: SecurityHub
  private readonly customJiraFields
  public readonly region
  private readonly severities
  private readonly autoClose: boolean
  private readonly jiraBaseURI: string

  private jiraLinkIdOnCreation?: string
  private jiraLinkTypeOnCreation?: string
  private jiraLinkDirectionOnCreation?: string
  private jiraLinkIdOnClosure?: string
  private jiraLinkTypeOnClosure?: string
  private jiraLinkDirectionOnClosure?: string

  public jiraLabelsConfig?: LabelConfig[]
  private jiraAddLabels?: string[]

  private createIssueErrors = 0
  private linkIssueErrors = 0
  private closureLinkIssueErrors = 0

  private jiraConsolidateTickets?: boolean
  private testFindings: AwsSecurityFinding[] = []
  private apiVersion: string

  constructor(
    jiraConfig: JiraConfig,
    securityHubConfig: SecurityHubJiraSyncConfig,
    autoClose: boolean
  ) {
    this.securityHub = new SecurityHub(securityHubConfig)
    this.region = securityHubConfig.region
    this.severities = securityHubConfig.severities
    this.jira = new Jira(jiraConfig)
    this.jiraBaseURI = jiraConfig.jiraBaseURI
    this.customJiraFields = securityHubConfig.customJiraFields
    this.autoClose = autoClose

    this.jiraLinkIdOnCreation = jiraConfig.jiraLinkIdOnCreation
    this.jiraLinkTypeOnCreation = jiraConfig.jiraLinkTypeOnCreation
    this.jiraLinkDirectionOnCreation = jiraConfig.jiraLinkDirectionOnCreation
    this.jiraLinkIdOnClosure = jiraConfig.jiraLinkIdOnClosure
    this.jiraLinkTypeOnClosure = jiraConfig.jiraLinkTypeOnClosure
    this.jiraLinkDirectionOnClosure = jiraConfig.jiraLinkDirectionOnClosure

    this.jiraAddLabels = jiraConfig.jiraAddLabels
      ?.split(',')
      .map(label => label.trim())

    if (jiraConfig.jiraLabelsConfig) {
      this.jiraLabelsConfig = JSON.parse(jiraConfig.jiraLabelsConfig)
    }

    if (securityHubConfig.consolidateTickets) {
      this.jiraConsolidateTickets = true
    }

    if (jiraConfig.testFindingsData) {
      this.testFindings = JSON.parse(jiraConfig.testFindingsData)
    }

    this.apiVersion = jiraConfig.jiraApiVersion || '3'
  }

  async closeIssuesForResolvedFindings(
    jiraIssues: Issue[],
    shFindings: SecurityHubFinding[]
  ) {
    const updatesForReturn: UpdateForReturn[] = []

    const makeComment = () => {
      const text = `As of ${new Date().toDateString()}, this Security Hub finding has been marked resolved`
      return this.apiVersion === '3'
        ? {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text }]
              }
            ]
          }
        : text
    }

    if (!this.autoClose) {
      return updatesForReturn
    }

    for (let i = 0; i < jiraIssues.length; i++) {
      if (!this.shouldCloseTicket(jiraIssues[i], shFindings)) {
        continue
      }

      // 1. Close issue (authoritative)
      await this.jira.closeIssue(jiraIssues[i].key)

      updatesForReturn.push({
        action: 'closed',
        webUrl: `${this.jiraBaseURI}/browse/${jiraIssues[i].key}`,
        summary: jiraIssues[i].fields.summary
      })

      // 2. Best effort comment with retry
      try {
        await retryOn503(() =>
          this.jira.addCommentToIssueById(jiraIssues[i].id, makeComment())
        )
      } catch (err: any) {
        console.warn(
          `Failed to add Jira comment for issue ${jiraIssues[i].id}. Continuing.`,
          err?.response?.status
        )
      }

      // 3. Optional linking
      if (this.jiraLinkIdOnClosure) {
        try {
          await this.jira.linkIssues(
            jiraIssues[i].key,
            this.jiraLinkIdOnClosure,
            this.jiraLinkTypeOnClosure,
            this.jiraLinkDirectionOnClosure || 'inward'
          )
        } catch (e) {
          this.closureLinkIssueErrors++
          console.error(
            `Failed to link closed issue ${jiraIssues[i].key}:`,
            extractErrorMessage(e)
          )
        }
      }
    }

    return updatesForReturn
  }

  /* ────────── Remaining helper methods unchanged ────────── */

  shouldCloseTicket(ticket: Issue, findings: SecurityHubFinding[]) {
    return !findings.some(
      f => f.title && ticket.fields.descriptionText?.includes(f.title)
    )
  }

  async getAWSAccountID() {
    this.createIssueErrors = 0
    this.linkIssueErrors = 0
    this.closureLinkIssueErrors = 0

    const client = new STSClient({ region: this.region })
    const response = await client.send(new GetCallerIdentityCommand({}))

    if (!response.Account || !response.Account.match(/^\d{12}$/)) {
      throw new Error('Invalid AWS Account ID')
    }

    return response.Account
  }
}
