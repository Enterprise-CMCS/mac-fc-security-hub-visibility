import {extractErrorMessage} from 'index'
import {Jira, SecurityHub, SecurityHubFinding} from './libs'
import {Issue, NewIssueData, CustomFields, JiraConfig} from './libs/jira-lib'
import {STSClient, GetCallerIdentityCommand} from '@aws-sdk/client-sts'
import {AwsSecurityFinding, Resource} from '@aws-sdk/client-securityhub'

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
export interface SecurityHubJiraSyncConfig {
  region: string
  severities: string[]
  customJiraFields?: CustomFields
  newIssueDelay: string
}

export class SecurityHubJiraSync {
  private readonly jira: Jira
  private readonly securityHub: SecurityHub
  private readonly customJiraFields
  private readonly region
  private readonly severities
  private readonly autoClose: boolean
  private readonly jiraBaseURI: string
  private jiraLinkId?: string
  private jiraLinkType?: string
  private jiraLinkDirection?: string
  private jiraLabelsConfig?: LabelConfig[]
  private jiraAddLabels?: string[]
  private jiraConsolidateTickets?: boolean
  private testFindings: AwsSecurityFinding[] = []
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
    this.jiraLinkId = jiraConfig.jiraLinkId
    this.jiraLinkType = jiraConfig.jiraLinkType
    this.jiraLinkDirection = jiraConfig.jiraLinkDirection
    this.jiraAddLabels = jiraConfig.jiraAddLabels
      ?.split(',')
      .map(label => label.trim())
    if (jiraConfig.jiraLabelsConfig) {
      this.jiraLabelsConfig = JSON.parse(jiraConfig.jiraLabelsConfig)
    }
    if (securityHubConfig.consolidateTickets) {
      this.jiraConsolidateTickets = securityHubConfig.consolidateTickets
    }
    if (jiraConfig.testFindingsData) {
      this.testFindings = JSON.parse(jiraConfig.testFindingsData)
      console.log('parsed', this.testFindings)
    }
  }
  consolidateTickets(arr: SecurityHubFinding[]) {
    const seen: GeneralObj = {} // Store unique titles
    const finalList: SecurityHubFinding[] = []
    arr.forEach(finding => {
      const title = finding.title ?? ''
      if (seen[title] >= 0) {
        const i = seen[title]
        finalList[i] = {
          ...finalList[i],
          Resources: [
            ...(finalList[i].Resources ?? []),
            ...(finding.Resources ?? [])
          ]
        }
      } else {
        const i = finalList.push(finding)
        seen[title] = i - 1
      }
    })
    return finalList
  }
  areSameLists(A: Resource[], B: Resource[]) {
    if (A.length == B.length) {
      let isSimilar = true
      for (let i = 0; i < A.length; i = i + 1) {
        let same = false
        for (let j = 0; j < B.length && !same; j = j + 1) {
          const a = A[i].Id ?? ''
          const b = B[j].Id ?? ''
          same = (a && b && a.includes(b)) as unknown as boolean
        }
        isSimilar = isSimilar && same
      }
      return isSimilar
    }
    return false
  }
  isAlreadyInNew(finding: SecurityHubFinding, List: SecurityHubFinding[]) {
    const filtered = List.filter(
      f => finding.title && f.title?.includes(finding.title)
    )
    if (!filtered.length) {
      return false
    }
    let exists: boolean = false
    filtered.forEach(f => {
      exists = (exists ||
        this.areSameLists(
          finding.Resources ?? [],
          f.Resources ?? []
        )) as unknown as boolean
    })
    return exists
  }
  isNewFinding(finding: SecurityHubFinding, issues: Issue[]) {
    const matchingIssues = issues.filter(
      i => finding.title && i.fields.description?.includes(finding.title)
    )
    if (!matchingIssues.length) {
      return false
    }
    return (
      matchingIssues.filter(i =>
        finding.Resources?.every(
          r => r.Id && i.fields.description?.includes(r.Id)
        )
      ).length == 0
    )
  }
  async sync() {
    const updatesForReturn: UpdateForReturn[] = []
    // Step 0. Gather and set some information that will be used throughout this function
    const accountId = await this.getAWSAccountID()
    const identifyingLabels: string[] = [accountId, this.region]

    // Step 1. Get all open Security Hub issues from Jira
    const jiraIssues =
      await this.jira.getAllSecurityHubIssuesInJiraProject(identifyingLabels)

    // Step 2. Get all current findings from Security Hub
    console.log(
      'Getting active Security Hub Findings with severities: ' + this.severities
    )
    const shFindingsObj = this.testFindings.length
      ? this.testFindings.map((finding: AwsSecurityFinding) =>
          this.securityHub.awsSecurityFindingToSecurityHubFinding(finding)
        )
      : await this.securityHub.getAllActiveFindings()
    const shFindings = Object.values(shFindingsObj).map(finding => {
      if (
        finding.ProductName?.toLowerCase().includes('default') &&
        finding.CompanyName?.toLowerCase().includes('tenable')
      ) {
        return {
          ...finding,
          ProductName: finding.CompanyName
        }
      }
      return finding
    })
    // Step 3. Close existing Jira issues if their finding is no longer active/current
    const previousFindings: SecurityHubFinding[] = []
    const newFindings: SecurityHubFinding[] = []
    const existingTitles = new Set<string>()

    jiraIssues.forEach(issue => {
      const issueDesc = issue.fields.description ?? ''

      // Find all matching Security Hub findings by title
      const matchingFindings = shFindings.filter(
        f => f.title && issueDesc.includes(f.title)
      )

      if (matchingFindings.length >= 1) {
        // Consolidate multiple findings
        let consolidatedFinding: SecurityHubFinding | undefined = undefined

        matchingFindings.forEach(finding => {
          const shouldConsolidate = (finding.Resources ?? []).every(
            resource =>
              resource.Id && issue.fields.description?.includes(resource.Id)
          )

          if (shouldConsolidate) {
            if (!consolidatedFinding) {
              consolidatedFinding = {...finding}
            } else {
              consolidatedFinding.Resources = [
                ...(consolidatedFinding.Resources ?? []),
                ...(finding.Resources ?? [])
              ]
            }
          } else {
            if (
              this.isNewFinding(finding, jiraIssues) &&
              !this.isAlreadyInNew(finding, newFindings)
            ) {
              newFindings.push(finding)
            }
          }
        })

        if (consolidatedFinding) {
          previousFindings.push(consolidatedFinding)
          existingTitles.add(
            (consolidatedFinding as unknown as SecurityHubFinding).title ?? ''
          )
        }
      }
    })

    // Add new findings not found in previousFindings
    shFindings.forEach(finding => {
      if (
        finding.title &&
        !existingTitles.has(finding.title) &&
        !this.isAlreadyInNew(finding, newFindings)
      ) {
        newFindings.push(finding)
      }
    })

    console.log('previous findings', previousFindings)
    updatesForReturn.push(
      ...(await this.closeIssuesForResolvedFindings(
        jiraIssues,
        previousFindings
      ))
    )
    console.log('new Findings', newFindings)
    let consolidationCandidates: SecurityHubFinding[] = newFindings
    if (this.jiraConsolidateTickets) {
      consolidationCandidates = this.consolidateTickets(consolidationCandidates)
      console.log('consolidated findings', consolidationCandidates)
    }
    const consolidatedFindings = [...consolidationCandidates]
    // Step 4. Create Jira issue for current findings that do not already have a Jira issue
    updatesForReturn.push(
      ...(await this.createJiraIssuesForNewFindings(
        jiraIssues,
        consolidatedFindings,
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
  shouldCloseTicket(ticket: Issue, findings: SecurityHubFinding[]) {
    const matchingTitles = findings.filter(finding => {
      if (finding.title) {
        return ticket.fields.description?.includes(finding.title)
      }
      return false
    })
    if (matchingTitles.length == 0) {
      return true
    }
    return (
      matchingTitles.filter(finding => {
        const resources = finding.Resources ?? []
        let bool: boolean = true
        resources.forEach(resource => {
          const id = resource.Id ?? ''
          if (id) {
            bool = (bool &&
              ticket.fields.description &&
              ticket.fields.description?.includes(id)) as unknown as boolean
          }
        })
        return bool && resources.length
      }).length == 0
    )
  }
  async closeIssuesForResolvedFindings(
    jiraIssues: Issue[],
    shFindings: SecurityHubFinding[]
  ) {
    const updatesForReturn: UpdateForReturn[] = []
    try {
      const makeComment = () =>
        `As of ${new Date(
          Date.now()
        ).toDateString()}, this Security Hub finding has been marked resolved`
      // close all security-hub labeled Jira issues that do not have an active finding
      if (this.autoClose) {
        for (let i = 0; i < jiraIssues.length; i++) {
          if (this.shouldCloseTicket(jiraIssues[i], shFindings)) {
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
            this.shouldCloseTicket(jiraIssues[i], shFindings) &&
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
        `Error closing Jira issue for resolved finding: ${extractErrorMessage(e)}`
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
      Table += `${Id?.padEnd(maxLength + 2)}| ${(Partition ?? '').padEnd(11)} | ${(Region ?? '').padEnd(9)} | ${Type ?? ''} \n`
    })

    Table += `------------------------------------------------------------------------------------------------`
    return Table
  }

  makeProductFieldSection(finding: SecurityHubFinding) {
    return `
    h2. Product Fields:
    Type                     |    ${finding.Type ?? 'N/A'}
    Product Name:            |    ${finding.ProductName ?? 'N/A'}
    Provider Name:           |    ${finding.ProviderName ?? 'N/A'}
    Provider Version:        |    ${finding.ProviderVersion ?? 'N/A'}
    Company Name:            |    ${finding.CompanyName ?? 'N/A'}
    CVE:                     |    ${finding.CVE ?? 'N/A'}
    --------------------------------------------------------
    `
  }
  createSecurityHubFindingUrlThroughFilters(findingId: string): string {
    let region: string

    // Function to validate AWS region format
    function isAwsRegion(region: string): boolean {
      const pattern = /^[a-z]{2}-[a-z]+-\d+$/
      return pattern.test(region)
    }

    // Function to validate URL format
    function isValidUrl(url: string): boolean {
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    }

    // Extract region from findingId
    if (findingId.startsWith('arn:')) {
      // Extract region from the ARN format
      const arnParts = findingId.split(':')
      region = arnParts[3]
    } else {
      // Extract region from non-ARN format (e.g., "us-west-2/finding-id")
      const parts = findingId.split('/')
      region = parts[0]
    }

    // Validate the extracted region
    if (!isAwsRegion(region)) {
      console.error(`Invalid AWS region: ${region}`)
      region = 'us-east-1' // Fallback to default region
    }

    // Encode the findingId and operator for URL
    const idPart = encodeURIComponent('Id=')
    const operator = encodeURIComponent('\\operator\\:EQUALS\\:')
    const searchParam = `${idPart}${operator}${encodeURIComponent(findingId)}`

    // Construct the URL
    const baseUrl = `https://${region}.console.aws.amazon.com/securityhub/home?region=${region}`
    const url = `${baseUrl}#/findings?search=${searchParam}`

    // Validate the constructed URL
    if (!isValidUrl(url)) {
      console.error(`Invalid URL constructed: ${url}`)
      return ''
    }

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

      ${
        remediationText || remediationUrl
          ? `
      h2. Remediation:

      ${remediationUrl}
      ${remediationText}
        `
          : ''
      }

      h2. AWS Account:
      ${awsAccountId} (${accountAlias})

      h2. Severity:
      ${severity}

      ${this.makeProductFieldSection(finding)}
      h2. SecurityHubFindingUrl:
      ${standardsControlArn ? this.createSecurityHubFindingUrl(standardsControlArn) : this.createSecurityHubFindingUrlThroughFilters(id)}

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
              `${labelPrefix}${delimiter}${values[index]?.trim().replace(/ /g, '')}`
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
        summary: `SecurityHub Finding - ${finding.title}`
          .substring(0, 255)
          .replaceAll('\n', ''),
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
    if (this.jiraAddLabels) {
      const prevLabels = newIssueData.fields.labels ?? []
      newIssueData.fields.labels = [...prevLabels, ...this.jiraAddLabels]
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
  shouldCreateIssue(finding: SecurityHubFinding, jiraIssues: Issue[]) {
    const potentialDuplicates = jiraIssues.filter(issue => {
      if (!finding.title) {
        return false
      }
      const title = finding.title
      return issue.fields.description?.includes(title)
    })
    console.log('Potential Duplicates: ', potentialDuplicates.length)
    if (potentialDuplicates.length == 0) {
      return true
    }

    const final = potentialDuplicates.filter(issue => {
      const duplicate = finding.Resources?.reduce(
        (should: boolean, resource: Resource): boolean => {
          const id = resource.Id ?? ''
          if (!id) {
            return false
          }
          return should && issue.fields.description?.includes(id) == true
        },
        true
      )
      return !duplicate
    })

    return final.length >= 1
  }
  async createJiraIssuesForNewFindings(
    jiraIssues: Issue[],
    shFindings: SecurityHubFinding[],
    identifyingLabels: string[]
  ) {
    const updatesForReturn: UpdateForReturn[] = []
    const uniqueSecurityHubFindings = [
      ...new Set(shFindings.map(finding => JSON.stringify(finding)))
    ].map(finding => JSON.parse(finding))

    for (let i = 0; i < uniqueSecurityHubFindings.length; i++) {
      const finding = uniqueSecurityHubFindings[i]
      if (this.shouldCreateIssue(finding, jiraIssues)) {
        try {
          const update = await this.createJiraIssueFromFinding(
            finding,
            identifyingLabels
          )
          updatesForReturn.push(update)
        } catch (e) {
          console.log('Moving forward with next findings', e)
        }
      }
    }

    return updatesForReturn
  }
}
