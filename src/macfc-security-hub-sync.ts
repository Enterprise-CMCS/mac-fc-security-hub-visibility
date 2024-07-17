import {extractErrorMessage} from 'index'
import {Jira, SecurityHub, SecurityHubFinding} from './libs'
import {Issue, NewIssueData, CustomFields, JiraConfig} from './libs/jira-lib'
import {STSClient, GetCallerIdentityCommand} from '@aws-sdk/client-sts'
import {Resource} from '@aws-sdk/client-securityhub'

interface UpdateForReturn {
  action: string
  webUrl: string
  summary: string
}

interface LabelConfig {
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
}

export class SecurityHubJiraSync {
  private readonly jira: Jira
  private readonly securityHub: SecurityHub
  private readonly customJiraFields
  private readonly region
  private readonly severities
  private readonly autoClose: boolean
  private readonly jiraBaseURI: string
  private includeAllProducts?: boolean
  private skipProducts?: string[]
  private jiraLinkId?: string
  private jiraLinkType?: string
  private jiraLinkDirection?: string
  private jiraLabelsConfig?: LabelConfig[]

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
    this.includeAllProducts = securityHubConfig.includeAllProducts
    this.skipProducts = securityHubConfig.skipProducts
      ?.split(',')
      .map(product => product.trim())
    this.jiraLinkId = jiraConfig.jiraLinkId
    this.jiraLinkType = jiraConfig.jiraLinkType
    this.jiraLinkDirection = jiraConfig.jiraLinkDirection
    if (jiraConfig.jiraLabelsConfig) {
      this.jiraLabelsConfig = JSON.parse(jiraConfig.jiraLabelsConfig)
    }
  }

  async sync() {
    const updatesForReturn: UpdateForReturn[] = []
    // Step 0. Gather and set some information that will be used throughout this function
    const accountId = await this.getAWSAccountID()
    const identifyingLabels: string[] = [accountId, this.region]

    // Step 1. Get all open Security Hub issues from Jira
    const jiraIssues = await this.jira.getAllSecurityHubIssuesInJiraProject(
      identifyingLabels
    )

    // Step 2. Get all current findings from Security Hub
    console.log(
      'Getting active Security Hub Findings with severities: ' + this.severities
    )
    const shFindingsObj = await this.securityHub.getAllActiveFindings()
    const shFindings = Object.values(shFindingsObj)
    console.log(shFindings)
    // Step 3. Close existing Jira issues if their finding is no longer active/current
    updatesForReturn.push(
      ...(await this.closeIssuesForResolvedFindings(jiraIssues, shFindings))
    )

    // Step 4. Create Jira issue for current findings that do not already have a Jira issue
    updatesForReturn.push(
      ...(await this.createJiraIssuesForNewFindings(
        jiraIssues,
        shFindings,
        identifyingLabels
      ))
    )

    console.log(JSON.stringify(updatesForReturn))
  }

  async getAWSAccountID() {
    const client = new STSClient({
      region: this.region
    })
    const command = new GetCallerIdentityCommand({})
    let response
    try {
      response = await client.send(command)
    } catch (e: unknown) {
      throw new Error(`Error getting AWS Account ID: ${extractErrorMessage(e)}`)
    }
    const accountID: string = response.Account || ''
    if (!accountID.match('[0-9]{12}')) {
      throw new Error(
        'ERROR:  An issue was encountered when looking up your AWS Account ID.  Refusing to continue.'
      )
    }
    return accountID
  }
  async closeIssuesForResolvedFindings(
    jiraIssues: Issue[],
    shFindings: SecurityHubFinding[]
  ) {
    const updatesForReturn: UpdateForReturn[] = []
    const expectedJiraIssueTitles = Array.from(
      new Set(
        shFindings.map(finding => `SecurityHub Finding - ${finding.title}`)
      )
    )
    try {
      const makeComment = () =>
        `As of ${new Date(
          Date.now()
        ).toDateString()}, this Security Hub finding has been marked resolved`
      // close all security-hub labeled Jira issues that do not have an active finding
      if (this.autoClose) {
        for (let i = 0; i < jiraIssues.length; i++) {
          if (!expectedJiraIssueTitles.includes(jiraIssues[i].fields.summary)) {
            await this.jira.closeIssue(jiraIssues[i].key)
            updatesForReturn.push({
              action: 'closed',
              webUrl: `${this.jiraBaseURI}/browse/${jiraIssues[i].key}`,
              summary: jiraIssues[i].fields.summary
            })
            await this.jira.addCommentToIssueById(
              jiraIssues[i].id,
              makeComment()
            )
          }
        }
      } else {
        console.log('Skipping auto closing...')
        for (let i = 0; i < jiraIssues.length; i++) {
          if (
            !expectedJiraIssueTitles.includes(jiraIssues[i].fields.summary) &&
            !jiraIssues[i].fields.summary.includes('Resolved') // skip already resolved issues
          ) {
            try {
              await this.jira.updateIssueTitleById(jiraIssues[i].id, {
                fields: {
                  summary: `Resolved ${jiraIssues[i].fields.summary}`
                }
              })
              await this.jira.addCommentToIssueById(
                jiraIssues[i].id,
                makeComment()
              )
            } catch (e) {
              console.log(
                `Title of ISSUE with id ${
                  jiraIssues[i].id
                } is not changed with error: ${JSON.stringify(e)}`
              )
            }
          }
        }
      }
    } catch (e: unknown) {
      throw new Error(
        `Error closing Jira issue for resolved finding: ${extractErrorMessage(
          e
        )}`
      )
    }
    return updatesForReturn
  }
  makeResourceList(resources: Resource[] | undefined) {
    if (!resources) {
      return `No Resources`
    }
    const maxLength = Math.max(...resources.map(({Id}) => Id?.length || 0))
    const title = 'Resource Id'.padEnd(maxLength + maxLength / 2 + 4)

    let Table = `${title}| Partition   | Region     | Type    \n`
    resources.forEach(({Id, Partition, Region, Type}) => {
      Table += `${Id?.padEnd(maxLength + 2)}| ${(Partition ?? '').padEnd(
        11
      )} | ${(Region ?? '').padEnd(9)} | ${Type ?? ''} \n`
    })

    Table += `------------------------------------------------------------------------------------------------`
    return Table
  }
  createSecurityHubFindingUrlThroughFilters(findingId: string) {
    let region, accountId;

    if (findingId.startsWith("arn:")) {
      // Extract region and account ID from the ARN
      const arnParts = findingId.split(":");
      region = arnParts[3];
      accountId = arnParts[4];
    } else {
      // Extract region and account ID from the non-ARN format
      const parts = findingId.split("/");
      region = parts[1];
      accountId = parts[2];
    }

    const baseUrl = `https://${region}.console.aws.amazon.com/securityhub/home?region=${region}`
    const searchParam = `Id%3D%255Coperator%255C%253AEQUALS%255C%253A${findingId}`
    const url = `${baseUrl}#/findings?search=${searchParam}`

    return url
  }
  createIssueBody(finding: SecurityHubFinding) {
    const {
      remediation: {
        Recommendation: {
          Url: remediationUrl = '',
          Text: remediationText = ''
        } = {}
      } = {},
      id = '',
      title = '',
      description = '',
      accountAlias = '',
      awsAccountId = '',
      severity = '',
      standardsControlArn = ''
    } = finding

    return `----

      *This issue was generated from Security Hub data and is managed through automation.*
      Please do not edit the title or body of this issue, or remove the security-hub tag.  All other edits/comments are welcome.
      Finding Title: ${title}

      ----

      h2. Type of Issue:

      * Security Hub Finding

      h2. Title:

      ${title}

      h2. Description:

      ${description}

      h2. Remediation:

      ${remediationUrl}
      ${remediationText}

      h2. AWS Account:
      ${awsAccountId} (${accountAlias})

      h2. Severity:
      ${severity}

      h2. SecurityHubFindingUrl:
      ${
        standardsControlArn
          ? this.createSecurityHubFindingUrl(standardsControlArn)
          : this.createSecurityHubFindingUrlThroughFilters(id)
      }

      h2. Resources:
      Following are the resources those were non-compliant at the time of the issue creation
      ${this.makeResourceList(finding.Resources)}

      To check the latest list of resources, kindly refer to the finding url

      h2. AC:

      * All findings of this type are resolved or suppressed, indicated by a Workflow Status of Resolved or Suppressed.  (Note:  this ticket will automatically close when the AC is met.)`
  }

  createSecurityHubFindingUrl(standardsControlArn = '') {
    if (!standardsControlArn) {
      return ''
    }

    const [
      ,
      partition,
      ,
      region,
      ,
      ,
      securityStandards,
      ,
      securityStandardsVersion,
      controlId
    ] = standardsControlArn.split(/[/:]+/)
    return `https://${region}.console.${partition}.amazon.com/securityhub/home?region=${region}#/standards/${securityStandards}-${securityStandardsVersion}/${controlId}`
  }
  getSeverityMappingToJiraPriority = (severity: string) => {
    switch (severity) {
      case 'INFORMATIONAL':
        return 'Lowest'
      case 'LOW':
        return 'Low'
      case 'MEDIUM':
        return 'Medium'
      case 'HIGH':
        return 'High'
      case 'CRITICAL':
        return 'Critical'
      default:
        throw new Error(`Invalid severity: ${severity}`)
    }
  }
  createLabels(
    finding: SecurityHubFinding,
    identifyingLabels: string[],
    config: LabelConfig[]
  ): string[] {
    const labels: string[] = []
    const fields = ['accountId', 'region', 'identify']
    const values = [...identifyingLabels, 'security-hub']

    config.forEach(
      ({labelField: field, labelDelimiter: delim, labelPrefix: prefix}) => {
        const delimiter = delim ?? ''
        const labelPrefix = prefix ?? ''

        if (fields.includes(field)) {
          const index = fields.indexOf(field)
          if (index >= 0) {
            labels.push(
              `${labelPrefix}${delimiter}${values[index]
                ?.trim()
                .replace(/ /g, '')}`
            )
          }
        } else {
          const value = (finding[field] ?? '')
            .toString()
            .trim()
            .replace(/ /g, '')
          labels.push(`${labelPrefix}${delimiter}${value}`)
        }
      }
    )

    return labels
  }
  async createJiraIssueFromFinding(
    finding: SecurityHubFinding,
    identifyingLabels: string[]
  ) {
    if (!finding.severity) {
      throw new Error(
        `Severity must be defined in Security Hub finding: ${finding.title}`
      )
    }
    const newIssueData: NewIssueData = {
      fields: {
        summary: `SecurityHub Finding - ${finding.title}`,
        description: this.createIssueBody(finding),
        issuetype: {name: 'Task'},
        labels: [
          'security-hub',
          finding.severity,
          finding.accountAlias,
          finding.ProductName?.trim().replace(/ /g, ''),
          ...identifyingLabels
        ],
        priority: {
          name: this.getSeverityMappingToJiraPriority(finding.severity)
        },
        ...this.customJiraFields
      }
    }
    if (this.jiraLabelsConfig) {
      try {
        const config = this.jiraLabelsConfig
        newIssueData.fields.labels = this.createLabels(
          finding,
          identifyingLabels,
          config
        )
      } catch (e) {
        console.log('Invalid labels config - going with default labels')
      }
    }
    let newIssueInfo
    try {
      newIssueInfo = await this.jira.createNewIssue(newIssueData)
      const issue_id = this.jiraLinkId
      if (issue_id) {
        const linkType = this.jiraLinkType
        const linkDirection = this.jiraLinkDirection
        await this.jira.linkIssues(
          newIssueInfo.key,
          issue_id,
          linkType,
          linkDirection
        )
      }
    } catch (e: unknown) {
      throw new Error(
        `Error creating Jira issue from finding: ${extractErrorMessage(e)}`
      )
    }
    return {
      action: 'created',
      webUrl: newIssueInfo.webUrl,
      summary: newIssueData.fields.summary
    }
  }

  async createJiraIssuesForNewFindings(
    jiraIssues: Issue[],
    shFindings: SecurityHubFinding[],
    identifyingLabels: string[]
  ) {
    const updatesForReturn: UpdateForReturn[] = []
    const existingJiraIssueTitles = jiraIssues.map(i => i.fields.summary)
    const uniqueSecurityHubFindings = [
      ...new Set(shFindings.map(finding => JSON.stringify(finding)))
    ].map(finding => JSON.parse(finding))

    for (let i = 0; i < uniqueSecurityHubFindings.length; i++) {
      const finding = uniqueSecurityHubFindings[i]
      if (
        !existingJiraIssueTitles.includes(
          `SecurityHub Finding - ${finding.title}`
        )
      ) {
        const update = await this.createJiraIssueFromFinding(
          finding,
          identifyingLabels
        )
        updatesForReturn.push(update)
      }
    }

    return updatesForReturn
  }
}
