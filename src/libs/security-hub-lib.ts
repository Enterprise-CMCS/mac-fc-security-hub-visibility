import {IAMClient, ListAccountAliasesCommand} from '@aws-sdk/client-iam'
import {
  SecurityHubClient,
  GetFindingsCommand,
  GetFindingsCommandOutput,
  Remediation,
  AwsSecurityFinding,
  Resource,
  AwsSecurityFindingFilters
} from '@aws-sdk/client-securityhub'
import {SecurityHubJiraSyncConfig} from '../macfc-security-hub-sync'
import {extractErrorMessage} from '../index'

export interface SecurityHubFinding {
  id?: string
  title?: string
  region?: string
  accountAlias?: string
  awsAccountId?: string
  severity?: string
  description?: string
  standardsControlArn?: string
  remediation?: Remediation
  ProductName?: string
  Resources?: Resource[]
  [key: string]: string | unknown
}

export class SecurityHub {
  private readonly region: string
  private readonly severityLabels: {Comparison: string; Value: string}[]
  private readonly newIssueDelay: string
  private accountAlias = ''
  private includeAllProducts?: boolean
  private skipProducts?: string[]

  constructor(securityHubJiraSyncConfig: SecurityHubJiraSyncConfig) {
    this.region = securityHubJiraSyncConfig.region
    this.severityLabels = securityHubJiraSyncConfig.severities.map(
      severity => ({
        Comparison: 'EQUALS',
        Value: severity
      })
    )
    this.newIssueDelay = securityHubJiraSyncConfig.newIssueDelay
    this.getAccountAlias().catch(error => console.error(error))
    this.includeAllProducts = securityHubJiraSyncConfig.includeAllProducts
    this.skipProducts = securityHubJiraSyncConfig.skipProducts
      ?.split(',')
      .map(product => product.trim())
  }

  private async getAccountAlias(): Promise<void> {
    const iamClient = new IAMClient({region: this.region})
    const response = await iamClient.send(new ListAccountAliasesCommand({}))
    this.accountAlias = response.AccountAliases?.[0] || ''
  }

  async getAllActiveFindings() {
    try {
      const securityHubClient = new SecurityHubClient({region: this.region})

      const currentTime = new Date()

      // delay for filtering out ephemeral issues
      const delayForNewIssues = +this.newIssueDelay
      const maxDatetime = new Date(currentTime.getTime() - delayForNewIssues)

      const filters: AwsSecurityFindingFilters = {
        RecordState: [{Comparison: 'EQUALS', Value: 'ACTIVE'}],
        WorkflowStatus: [
          {Comparison: 'EQUALS', Value: 'NEW'},
          {Comparison: 'EQUALS', Value: 'NOTIFIED'}
        ],
        SeverityLabel: this.severityLabels,
        CreatedAt: [
          {
            Start: '1970-01-01T00:00:00Z',
            End: maxDatetime.toISOString()
          }
        ]
      }
      if (this.includeAllProducts !== true) {
        filters.ProductName = [{Comparison: 'EQUALS', Value: 'Security Hub'}]
      }
      if (this.skipProducts) {
        this.skipProducts.forEach((product: string) => {
          if (!filters.ProductName) {
            filters.ProductName = []
          }
          filters.ProductName?.push({
            Comparison: 'NOT_EQUALS',
            Value: product
          })
        })
      }
      // use an object to store unique findings by title
      const uniqueFindings: {[title: string]: SecurityHubFinding} = {}

      // use a variable to track pagination
      let nextToken: string | undefined = undefined

      do {
        const response: GetFindingsCommandOutput = await securityHubClient.send(
          new GetFindingsCommand({
            Filters: filters,
            MaxResults: 100, // this is the maximum allowed per page
            NextToken: nextToken
          })
        )
        if (response && response.Findings) {
          for (const finding of response.Findings) {
            const findingForJira =
              this.awsSecurityFindingToSecurityHubFinding(finding)
            if (findingForJira.title)
              uniqueFindings[findingForJira.title] = findingForJira
          }
        }
        if (response && response.NextToken) nextToken = response.NextToken
        else nextToken = undefined
      } while (nextToken)

      return Object.values(uniqueFindings).map(finding => {
        return {
          accountAlias: this.accountAlias,
          ...finding
        }
      })
    } catch (error: unknown) {
      throw new Error(
        `Error getting Security Hub findings: ${extractErrorMessage(error)}`
      )
    }
  }

  awsSecurityFindingToSecurityHubFinding(
    finding: AwsSecurityFinding
  ): SecurityHubFinding {
    if (!finding) return {}
    return {
      id: finding.Id,
      title: finding.Title,
      region: finding.Region,
      accountAlias: this.accountAlias,
      awsAccountId: finding.AwsAccountId,
      severity:
        finding.Severity && finding.Severity.Label
          ? finding.Severity.Label
          : '',
      description: finding.Description,
      standardsControlArn:
        finding.ProductFields && finding.ProductFields.StandardsControlArn
          ? finding.ProductFields.StandardsControlArn
          : '',
      remediation: finding.Remediation,
      ProductName: finding.ProductName,
      Resources: finding.Resources
    }
  }
}
