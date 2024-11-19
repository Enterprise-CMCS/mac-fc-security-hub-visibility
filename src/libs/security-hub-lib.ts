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
  Type?: string
  CompanyName?: string
  ProviderName?: string
  ProviderVersion?: string
  CVE?: string
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
  private async querySecurityHubFindings(
    filters: AwsSecurityFindingFilters,
    maxResults: number = 100,
    nextToken: string | undefined = undefined
  ): Promise<{findings: SecurityHubFinding[]; nextToken: string | undefined}> {
    try {
      const securityHubClient = new SecurityHubClient({region: this.region})

      // Send the query to Security Hub
      const response: GetFindingsCommandOutput = await securityHubClient.send(
        new GetFindingsCommand({
          Filters: filters,
          MaxResults: maxResults,
          NextToken: nextToken
        })
      )

      // Map the findings using awsSecurityFindingToSecurityHubFinding function
      const findings = response.Findings
        ? response.Findings.map(
            this.awsSecurityFindingToSecurityHubFinding.bind(this)
          )
        : []

      // Return findings and the next token for pagination
      return {findings, nextToken: response.NextToken}
    } catch (error) {
      throw new Error(
        `Error querying Security Hub findings: ${(error as Error).message}`
      )
    }
  }
  private buildActiveFindingsFilters(): AwsSecurityFindingFilters {
    const currentTime = new Date()
    const maxDatetime = new Date(
      currentTime.getTime() - (parseInt(this.newIssueDelay) ?? 0)
    ) // Adjust for ephemeral issues

    return {
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
  }
  private buildSkipProductsFilter(): {
    skipDefault: boolean
    skipTenable: boolean
    skipFilters: {Comparison: string; Value: string}[]
  } {
    const skipFilters: {Comparison: string; Value: string}[] = []
    let skipDefault = false
    let skipTenable = false

    this.skipProducts?.forEach(product => {
      if (['Default', 'Tenable'].includes(product)) {
        if (product == 'Default') {
          skipDefault = true
        }
        if (product == 'Tenable') {
          skipTenable = true
        }
      } else {
        skipFilters.push({Comparison: 'NOT_EQUALS', Value: product})
      }
    })

    // Apply the logic to exclude products as per the original requirements
    if (skipDefault || skipTenable) {
      skipFilters.push({Comparison: 'NOT_EQUALS', Value: 'Default'})
    }

    return {skipDefault, skipTenable, skipFilters}
  }

  private async fetchPaginatedFindings(
    filters: AwsSecurityFindingFilters
  ): Promise<SecurityHubFinding[]> {
    let allFindings: SecurityHubFinding[] = []
    let nextToken: string | undefined

    // Loop to handle pagination
    do {
      const {findings, nextToken: token} = await this.querySecurityHubFindings(
        filters,
        100,
        nextToken
      )
      allFindings = allFindings.concat(findings)
      nextToken = token
    } while (nextToken)

    return allFindings
  }

  public async getAllActiveFindings(): Promise<SecurityHubFinding[]> {
    try {
      // Build the base filters for active findings
      const filters = this.buildActiveFindingsFilters()
      const skipConfig = {default: false, tenable: false}
      // Apply the skip products filter if needed
      if (this.skipProducts && this.skipProducts.length > 0) {
        const {skipDefault, skipTenable, skipFilters} =
          this.buildSkipProductsFilter()
        skipConfig.default = skipDefault
        skipConfig.tenable = skipTenable
        filters.ProductName = skipFilters
      }

      // Apply the "Security Hub" product filter if includeAllProducts is not true
      if (this.includeAllProducts !== true) {
        filters.ProductName = [{Comparison: 'EQUALS', Value: 'Security Hub'}]
      }

      // Fetch all findings across multiple pages
      let allFindings = await this.fetchPaginatedFindings(filters)

      if (skipConfig.default && !skipConfig.tenable) {
        filters.ProductName = [
          {
            Value: 'Default',
            Comparison: 'EQUALS'
          }
        ]
        filters.ProductFields = [
          {
            Key: 'CompanyName',
            Value: 'Tenable',
            Comparison: 'NOT_EQUALS'
          }
        ]
      } else if (skipConfig.tenable && !skipConfig.default) {
        filters.ProductName = []
        filters.ProductFields = [
          {
            Key: 'CompanyName',
            Value: 'Tenable',
            Comparison: 'EQUALS'
          }
        ]
      }
      const extFindings = await this.fetchPaginatedFindings(filters)
      allFindings = [...extFindings, ...allFindings]

      // Return findings with account alias and any additional information
      return allFindings.map(finding => ({
        accountAlias: this.accountAlias,
        ...finding
      }))
    } catch (error) {
      throw new Error(
        `Error getting active findings: ${(error as Error).message}`
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
      Resources: finding.Resources,
      Type: finding.ProductFields?.Type,
      ProviderName: finding.ProductFields?.ProviderName,
      ProviderVersion: finding.ProductFields?.ProviderVersion,
      CompanyName: finding.ProductFields?.CompanyName,
      CVE: finding.ProductFields?.CVE
    }
  }
}
