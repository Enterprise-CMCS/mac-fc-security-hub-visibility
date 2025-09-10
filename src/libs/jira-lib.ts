import * as dotenv from 'dotenv'
import axios, {AxiosError, AxiosInstance} from 'axios'
import {extractErrorMessage} from '../index'
import {LabelConfig} from 'macfc-security-hub-sync'

dotenv.config()

export interface JiraConfig {
  jiraBaseURI: string
  jiraUsername: string
  jiraToken: string
  jiraProjectKey: string
  jiraIgnoreStatuses: string
  jiraAssignee?: string
  jiraWatchers?: string
  jiraAddLabels?: string
  testFindingsData?: string
  transitionMap: Array<{status: string; transition: string}>
  dryRunTestData: boolean
  jiraLinkId?: string
  jiraLinkType?: string
  jiraLinkDirection?: string
  includeAllProducts: boolean
  skipProducts?: string
  jiraLabelsConfig?: string
  dueDateCritical?: string
  dueDateHigh?: string
  dueDateModerate?: string
  dueDateLow?: string
  jiraDueDateField?: string // Add the new field for due date configuration
}

export type CustomFields = {
  [key: string]: string
}

interface IssueType {
  name: string
}

interface PriorityField {
  name?: string
  id?: string
}

interface IssueFields {
  summary: string
  description?: string | any // Can be string or ADF object
  issuetype?: IssueType
  labels?: (string | undefined)[] // Assuming labels can be strings or objects
  priority?: PriorityField
  project?: {key: string}
  assignee?: {name: string}
  duedate?: string // Add the due date field
  [key: string]: any // Allow indexing by string for custom fields like due date
  
  // Optional getter function for description text
  descriptionText?: string
}


export interface NewIssueData {
  fields: IssueFields
}

export interface Issue {
  id: string
  key: string
  fields: IssueFields
  webUrl: string
}
interface Transition {
  id: string
  name: string
  fields?: {
    [fieldName: string]: any
  }

}
export interface ADFNode {
  type: string
  text?: string
  version?: number
  attrs?: {
    [key: string]: any
  }
  content?: ADFNode[]
}

function adfToText(node: any): string {
  if (!node) return "";

  // Handle array of nodes
  if (Array.isArray(node)) {
    return node.map(adfToText).join("");
  }

  switch (node.type) {
    case "doc":
      return adfToText(node.content);

    case "paragraph":
      return adfToText(node.content) + "\n";

    case "text":
      return node.text || "";

    case "bulletList":
      return node.content.map((item: any) => "• " + adfToText(item)).join("\n") + "\n";

    case "listItem":
      return adfToText(node.content);

    case "embedCard":
      return (node.attrs && node.attrs.url ? node.attrs.url : "") + "\n";

    default:
      return node.content ? adfToText(node.content) : "";
  }
}

export function getDescriptionText(issue: Issue): string {
  if (!issue.fields.description) return "";
  
  // If description is already a string, return it
  if (typeof issue.fields.description === 'string') {
    return issue.fields.description;
  }
  
  // If description is ADF format, convert it to text
  return adfToText(issue.fields.description);
}

function enhanceIssueWithDescriptionText(issue: Issue): Issue {
  Object.defineProperty(issue.fields, 'descriptionText', {
    get: function() {
      return getDescriptionText(issue);
    },
    enumerable: false,
    configurable: true
  });
  return issue;
}

function enhanceIssuesWithDescriptionText(issues: Issue[]): Issue[] {
  return issues.map(enhanceIssueWithDescriptionText);
}

function textToAdf(text: string): any {
  if (!text) {
    return {
      type: "doc",
      version: 1,
      content: []
    };
  }

  // Split text into paragraphs
  const paragraphs = text.split('\n').filter(line => line.trim() !== '');
  
  const content = paragraphs.map(paragraph => ({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: paragraph
      }
    ]
  }));

  return {
    type: "doc",
    version: 1,
    content: content
  };
}

function handleAxiosError(error: unknown): string {
  // Check if the error is an instance of AxiosError
  if (error instanceof AxiosError) {
    let errorDetails = JSON.stringify(error.toJSON(), null, 2)
    // Mask the token in the error details
    errorDetails = errorDetails.replace(
      /"Authorization": "Bearer [^"]+"/,
      `"Authorization": "Bearer <REDACTED_TOKEN>"`
    )
    console.log(errorDetails)
    // Check if the cause of the AxiosError is an AggregateError
    if (error.cause instanceof AggregateError && error.cause.errors) {
      // Map each error in the AggregateError to its message and join them
      const errMsgs = error.cause.errors
        .map((err: any) => extractErrorMessage(err)) // Add explicit type 'any' to err
        .join(', ')
      return `Errors from Axios request: ${errMsgs}`
    }
    // For non-aggregate AxiosError, extract the single error message
    let errorMessage = `Error from Axios request: ${extractErrorMessage(error)}`
    // Include response data in the error message if available
    if (error.response && error.response.data) {
      errorMessage += `\nResponse data: ${JSON.stringify(error.response.data)}`
    }
    return errorMessage
  }
  // Fallback for non-Axios errors
  return `${extractErrorMessage(error)}`
}

export class Jira {
  private jiraBaseURI: string
  private jiraProject: string
  private axiosInstance: AxiosInstance
  private transitionMap: Array<{status: string; transition: string}> = []
  private jiraAssignee?: string
  private jiraIgnoreStatusesList: string[]
  private isDryRun: boolean
  private dryRunIssueCounter: number = 0
  private jiraLabelsConfig?: LabelConfig[]
  private jiraWatchers?: string[]
  private dueDateCritical: number
  private dueDateHigh: number
  private dueDateModerate: number
  private dueDateLow: number
  private jiraDueDateField: string // Store the configured due date field ID
  private cisaFeedCache: Array<{cveID: string; dueDate: string}> | undefined // Cache for CISA feed
  constructor(jiraConfig: JiraConfig) {
    this.jiraBaseURI = jiraConfig.jiraBaseURI
    this.jiraProject = jiraConfig.jiraProjectKey
    this.jiraAssignee = jiraConfig.jiraAssignee
    this.transitionMap = jiraConfig.transitionMap
    this.jiraIgnoreStatusesList = jiraConfig.jiraIgnoreStatuses
      .split(',')
      .map(status => status.trim())
    this.jiraWatchers = jiraConfig.jiraWatchers
      ?.split(',')
      .map(watcher => watcher.trim())
    this.isDryRun = jiraConfig.dryRunTestData
    if (jiraConfig.jiraLabelsConfig) {
      this.jiraLabelsConfig = JSON.parse(jiraConfig.jiraLabelsConfig)
    }

    // Parse due date inputs, providing defaults
    this.dueDateCritical = parseInt(jiraConfig.dueDateCritical || '15', 10)
    this.dueDateHigh = parseInt(jiraConfig.dueDateHigh || '30', 10)
    this.dueDateModerate = parseInt(jiraConfig.dueDateModerate || '90', 10) // Default for Moderate and Unknown
    this.dueDateLow = parseInt(jiraConfig.dueDateLow || '365', 10)

    // Ensure parsed values are numbers, fallback to defaults if NaN
    this.dueDateCritical = isNaN(this.dueDateCritical)
      ? 15
      : this.dueDateCritical
    this.dueDateHigh = isNaN(this.dueDateHigh) ? 30 : this.dueDateHigh
    this.dueDateModerate = isNaN(this.dueDateModerate)
      ? 90
      : this.dueDateModerate
    this.dueDateLow = isNaN(this.dueDateLow) ? 365 : this.dueDateLow

    // Initialize the due date field, defaulting to ''
    this.jiraDueDateField = jiraConfig.jiraDueDateField || ''

    this.axiosInstance = axios.create({
      baseURL: jiraConfig.jiraBaseURI,
      headers: {
        Authorization: jiraConfig.jiraBaseURI.includes('atlassian')
          ? 'Basic ' +
            Buffer.from(
              `${jiraConfig.jiraUsername}:${jiraConfig.jiraToken}`
            ).toString('base64')
          : `Bearer ${jiraConfig.jiraToken}`,
        'Content-Type': 'application/json'
      }
    })
  }

  async getCurrentUser() {
    try {
      const response = await this.axiosInstance.get('/rest/api/3/myself')
      return response.data
    } catch (error: unknown) {
      throw new Error(`Error fetching current user: ${handleAxiosError(error)}`)
    }
  }
  async getIssue(issueId: string) {
    try {
      const response = await this.axiosInstance.get(
        `/rest/api/3/issue/${issueId}`
      )
      return response.data
    } catch (error: unknown) {
      throw new Error(
        `Error fetching issue details for issue ${issueId}: ${handleAxiosError(error)}`
      )
    }
  }
  async getCurrentStatus(issueId: string) {
    try {
      return (await this.getIssue(issueId)).fields.status.name.toUpperCase()
    } catch (error: unknown) {
      throw new Error(
        `Error fetching current status for issue ${issueId}: ${handleAxiosError(error)}`
      )
    }
  }
  async getIssueTransitions(issueId: string): Promise<Transition[]> {
    try {
      const response = await this.axiosInstance.get(
        `/rest/api/3/issue/${issueId}/transitions?expand=transitions.fields`
      )
      const transitions: Transition[] = response.data.transitions

      if (!transitions.every(t => 'id' in t && 'name' in t)) {
        throw new Error(
          'One or more transitions are missing required properties (id, name)'
        )
      }

      return transitions as Transition[]
    } catch (error: unknown) {
      throw new Error(
        `Error fetching issue transitions: ${handleAxiosError(error)}`
      )
    }
  }
  async transitionIssueByName(issueId: string, transitionName: string) {
    if (this.isDryRun) {
      console.log(
        `[Dry Run] Would transition issue ${issueId} with transition:`,
        transitionName
      )
      return
    }

    try {
      // Fetch available transitions for the issue
      const availableTransitions = await this.getIssueTransitions(issueId)

      // Find the transition ID corresponding to the provided transition name
      console.log('available', availableTransitions)
      const transition = availableTransitions.find(
        t =>
          t.name.toLocaleUpperCase() === transitionName ||
          t.name.toLowerCase() === transitionName.toLocaleLowerCase()
      )

      if (!transition) {
        throw new Error(
          `Transition '${transitionName}' not found for issue ${issueId}`
        )
      }

      // Transition the issue using the found transition ID
      await this.axiosInstance.post(
        `/rest/api/3/issue/${issueId}/transitions`,
        transition.fields?.resolution 
          ? {
              transition: {id: transition.id},
              fields: {
                resolution: {name: "Done"}
              }
            }
          : {
              transition: {id: transition.id}
            }
      )
      console.log(
        `Issue ${issueId} transitioned successfully to '${transitionName}'.`
      )
    } catch (error: unknown) {
      throw new Error(
        `Error transitioning issue ${issueId} to '${transitionName}': ${handleAxiosError(error)}`
      )
    }
  }
  async transitionIssueById(
    issueId: string,
    transitionId: string,
    transitionName: string,
    transition?: Transition
  ) {
    if (this.isDryRun) {
      console.log(
        `[Dry Run] Would transition issue ${issueId} with transition:`,
        transitionName
      )
      return
    }

    try {
      // Transition the issue using the found transition ID
      await this.axiosInstance.post(
        `/rest/api/3/issue/${issueId}/transitions`,
        transition?.fields?.resolution 
          ? {
              transition: {id: transitionId},
              fields: {
                resolution: {name: "Done"}
              }
            }
          : {
              transition: {id: transitionId}
            }
      )
      console.log(
        `Issue ${issueId} transitioned successfully to '${transitionName}'.`
      )
    } catch (error: unknown) {
      throw new Error(
        `Error transitioning issue ${issueId} to '${transitionName}': ${handleAxiosError(error)}`
      )
    }
  }
  async addUserAsWatcher(
    issueId: string,
    watcher: string,
    isEnterprise = true
  ) {
    try {
      const params = {
        key: '',
        value: watcher
      }
      if (isEnterprise) {
        params.key = 'username'
      } else {
        const response = await this.axiosInstance.get(
          `/rest/api/3/user/search?query=${encodeURIComponent(watcher)}`
        )
        if (!response.data.length) {
          console.log('Invalid wacther id ' + watcher)
          return
        }
        const user = response.data[0]
        params.value = user.accountId
        params.key = 'accountId'
      }
      const res = await this.axiosInstance.post(
        `/rest/api/3/issue/${issueId}/watchers`,
        params.value
      )
      console.log('Added ' + watcher + 'as watcher ot issue: ' + issueId)
    } catch (error: any) {
      console.error(
        'Error adding watchers:',
        error.response ? error.response.data : error.message
      )
      throw new Error(`Error adding watcher: ${handleAxiosError(error)}`)
    }
  }
  async removeCurrentUserAsWatcher(issueId: string) {
    try {
      const currentUser = await this.getCurrentUser()
      console.log(
        `Remove watcher ${currentUser.name ?? currentUser.displayName} from ${issueId}`
      )

      if (this.isDryRun) {
        console.log(
          `[Dry Run] Would remove ${currentUser.name} from ${issueId} as watcher.`
        )
        return // Skip the actual API call
      }
      const params = {
        key: '',
        value: ''
      }
      if (currentUser.name) {
        params.key = 'username'
        params.value = currentUser.name
      } else {
        params.key = 'accountId'
        params.value = currentUser.accountId
      }
      await this.axiosInstance.delete(`/rest/api/3/issue/${issueId}/watchers`, {
        params: {
          [params.key]: params.value
        }
      })
    } catch (error: unknown) {
      throw new Error(
        `Error creating issue or removing watcher: ${handleAxiosError(error)}`
      )
    }
  }

  private static formatLabelQuery(label: string): string {
    return `labels = '${label}'`
  }
  public static createSearchLabels(
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
        }
      }
    )

    return labels
  }
  createSearchLabels(
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
        }
      }
    )

    return labels
  }
  async getAllSecurityHubIssuesInJiraProject(
    identifyingLabels: string[]
  ): Promise<Issue[]> {
    const labelQueries = [...identifyingLabels, 'security-hub']
      .map(label => Jira.formatLabelQuery(label))
      .join(' AND ')
    let finalLabelQuery = labelQueries
    if (this.jiraLabelsConfig) {
      const config = this.jiraLabelsConfig
      const configLabels = this.createSearchLabels(identifyingLabels, config)
      const searchQuery = configLabels
        .map(label => Jira.formatLabelQuery(label))
        .join(' AND ')
      if (searchQuery) {
        finalLabelQuery = `((${finalLabelQuery}) OR (${searchQuery}))`
      }
    }
    const projectQuery = `project = '${this.jiraProject}'`
    const statusQuery = `status not in ('${this.jiraIgnoreStatusesList.join(
      "','" // wrap each closed status in single quotes
    )}')`
    const fullQuery = [finalLabelQuery, projectQuery, statusQuery].join(' AND ')
    // We  want to do everything possible to prevent matching tickets that we shouldn't
    if (!fullQuery.includes(Jira.formatLabelQuery('security-hub'))) {
      throw new Error(
        "ERROR:  Your query does not include the 'security-hub' label, and is too broad.  Refusing to continue"
      )
    }
    if (!fullQuery.match(Jira.formatLabelQuery('[0-9]{12}'))) {
      throw new Error(
        'ERROR:  Your query does not include an AWS Account ID as a label, and is too broad.  Refusing to continue'
      )
    }
    console.log(fullQuery)

    let allIssues: Issue[] = []
    let nextPageToken: string | null = null

    do {
      try {
        const requestBody: any = {
          jql: fullQuery,
          maxResults: 50,
          fields: ['*all'],
          expand: ""
        }
        
        if (nextPageToken) {
          requestBody.nextPageToken = nextPageToken
        }

        const response = await this.axiosInstance.post('/rest/api/3/search/jql', requestBody)
        const results = response.data;
        const enhancedIssues = enhanceIssuesWithDescriptionText(results.issues);
        allIssues = allIssues.concat(enhancedIssues)
        nextPageToken = results.nextPageToken || null
      } catch (error: unknown) {
        throw new Error(
          `Error getting Security Hub issues from Jira: ${handleAxiosError(error)}`
        )
      }
    } while (nextPageToken)

    return allIssues
  }
  /**
   * Fetches the CISA Known Exploited Vulnerabilities feed and returns the CISA date for a given CVE ID, if found.
   * Implements caching to avoid repeated API calls within a session.
   */
  private async getCisaDueDate(cveId: string): Promise<string | undefined> {
    try {
      // Check if the feed is already cached
      if (!this.cisaFeedCache) {
        console.log('Fetching CISA feed...')
        const response = await axios.get(
          'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
        )
        this.cisaFeedCache = response.data.vulnerabilities as Array<{
          cveID: string
          dueDate: string
        }>
        console.log('CISA feed cached.')
      } else {
        console.log('Using cached CISA feed.')
      }

      const match = this.cisaFeedCache.find(
        (entry) => entry.cveID.toUpperCase() === cveId.toUpperCase()
      )
      if (match) {
        // dueDate is in YYYY-MM-DD format
        return match.dueDate
      }
    } catch (error) {
      console.warn(`Failed to fetch or process CISA feed for ${cveId}:`, error)
    }
    return undefined
  }

  async createNewIssue(issue: NewIssueData): Promise<Issue> {
    let response
    try {
      // Attempt to pull due date from CISA feed if a CVE ID label is present
      const cveLabel = issue.fields.labels?.find(label =>
        /^CVE-\d{4}-\d{4,}$/i.test(String(label))
      )
      let dueDateString: string | undefined
      if (cveLabel) {
        dueDateString = await this.getCisaDueDate(String(cveLabel))
      }
      if (dueDateString) {
        // Use the CISA date if found
        issue.fields.duedate = dueDateString
        if (this.jiraDueDateField) {
          issue.fields[this.jiraDueDateField] = dueDateString
        }
      } else {
        // Fallback to severity-based default due date
        const severity = issue.fields.labels?.find(label =>
          ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(
            String(label).toUpperCase()
          )
        )
        let dueDays: number
        switch (severity?.toUpperCase()) {
          case 'CRITICAL':
            dueDays = this.dueDateCritical
            break
          case 'HIGH':
            dueDays = this.dueDateHigh
            break
          case 'LOW':
            dueDays = this.dueDateLow
            break
          case 'MEDIUM':
          default:
            dueDays = this.dueDateModerate
            break
        }
        const fallbackDate = new Date()
        fallbackDate.setDate(fallbackDate.getDate() + dueDays)
        dueDateString = fallbackDate.toISOString().split('T')[0]
        issue.fields.duedate = dueDateString
        if (this.jiraDueDateField) {
          issue.fields[this.jiraDueDateField] = dueDateString
        }
      }

      if (this.jiraAssignee) {
        issue.fields.assignee = {name: this.jiraAssignee}
      }
      issue.fields.project = {key: this.jiraProject}

      // Convert description to ADF format if it's a string
      if (issue.fields.description && typeof issue.fields.description === 'string') {
          issue.fields.description = textToAdf(issue.fields.description)
      }

      if (this.isDryRun) {
        console.log(
          `[Dry Run] Would create a new issue with the following details:`,
          issue
        )

        // Return a dry run issue object
        this.dryRunIssueCounter++
        const dryRunIssue: Issue = {
          id: `dryrun-id-${this.dryRunIssueCounter}`,
          key: `DRYRUN-KEY-${this.dryRunIssueCounter}`,
          fields: {
            description: 'Dry Run Description',
            issuetype: {name: 'Dry Run Issue'},
            summary:
              issue.fields.summary ||
              `Dry Run Summary ${this.dryRunIssueCounter}`,
            labels: []
          },
          webUrl: `${this.jiraBaseURI}/browse/DRYRUN-KEY-${this.dryRunIssueCounter}`
        }

        return dryRunIssue // Return a dummy issue
      }

      response = await this.axiosInstance.post('/rest/api/3/issue', issue)
      const newIssue = response.data
      // Construct the webUrl for the new issue
      newIssue['webUrl'] = `${this.jiraBaseURI}/browse/${newIssue.key}`
      await this.removeCurrentUserAsWatcher(newIssue.key)
      if (this.jiraWatchers && this.jiraWatchers.length >= 1) {
        try {
          await Promise.all(
            this.jiraWatchers.map(
              (watcher: string) =>
                watcher &&
                this.addUserAsWatcher(
                  newIssue.key,
                  watcher,
                  this.jiraBaseURI.includes('atlassian') == false
                )
            )
          )
        } catch (error: unknown) {
          console.log('Error: could not add watchers', this.jiraWatchers)
          return newIssue
        }
      }
      return newIssue
    } catch (error: unknown) {
      throw new Error(`Error creating Jira issue: ${handleAxiosError(error)}`)
    }
  }
  async linkIssues(
    newIssueKey: string,
    issueID: string,
    linkType = 'Relates',
    linkDirection = 'inward'
  ) {
    if (this.isDryRun) {
      console.log(
        `[Dry Run] Would link issues ${newIssueKey} with ${issueID} using type ${linkType} and direction ${linkDirection}`
      )
      return
    }

    const linkData = {
      type: {name: linkType},
      inwardIssue: {key: newIssueKey},
      outwardIssue: {key: issueID}
    }

    if (linkDirection === 'outward') {
      const temp = linkData.inwardIssue.key
      linkData.inwardIssue.key = linkData.outwardIssue.key
      linkData.outwardIssue.key = temp
    }

    try {
      const response = await this.axiosInstance.post(
        '/rest/api/3/issueLink',
        linkData
      )
      console.log(
        `Successfully linked issue ${newIssueKey} with ${issueID}:`,
        response.data
      )
    } catch (error: unknown) {
      console.error('Error linking issues:', error)
      throw new Error(`Error linking issues: ${error}`)
    }
  }
  async updateIssueTitleById(issueId: string, updatedIssue: Partial<Issue>) {
    if (this.isDryRun) {
      console.log(
        `[Dry Run] Would update issue title for issue ${issueId} with:`,
        updatedIssue
      )
      return
    }

    try {
      const response = await this.axiosInstance.put(
        `/rest/api/3/issue/${issueId}`,
        updatedIssue
      )
      console.log('Issue title updated successfully:', response.data)
    } catch (error: unknown) {
      throw new Error(`Error updating issue title: ${handleAxiosError(error)}`)
    }
  }
  async addCommentToIssueById(issueId: string, comment: string | ADFNode) {
    if (this.isDryRun) {
      console.log(`[Dry Run] Would add comment to issue ${issueId}:`, comment)
      return
    }

    try {
      let commentBody: any;
      
      // Handle different comment formats
      if (typeof comment === 'string') {
        // Convert string to ADF format
        commentBody = textToAdf(comment);
      } else if (typeof comment === 'object' && 
                 comment.type === 'doc' && 
                 comment.version === 1) {
        // Already in ADF format
        commentBody = comment;
      } else {
        // Unknown format, try to convert to string first, then to ADF
        const stringComment = String(comment);
        commentBody = textToAdf(stringComment);
      }

      await this.axiosInstance.post(`/rest/api/3/issue/${issueId}/comment`, {
        body: commentBody
      })
      await this.removeCurrentUserAsWatcher(issueId) // Commenting on the issue adds the user as a watcher, so we remove them
    } catch (error: unknown) {
      throw new Error(
        `Error adding comment to issue: ${handleAxiosError(error)}`
      )
    }
  }
  getNextTransition(currentStatus: string): string | undefined {
    // First, try to find a specific transition for the current status
    let nextTransition = this.transitionMap.find(
      rule => rule.status === currentStatus
    )?.transition

    // If not found, look for a wildcard transition
    if (!nextTransition) {
      nextTransition = this.transitionMap.find(
        rule => rule.status === '*'
      )?.transition
    }

    return nextTransition
  }

  async applyWildcardTransition(issueId: string): Promise<boolean> {
    const wildcardTransition = this.transitionMap.find(
      rule => rule.status === '*'
    )?.transition

    if (wildcardTransition) {
      console.log(
        `Applying wildcard transition '${wildcardTransition}' to issue ${issueId}`
      )
      await this.transitionIssueByName(issueId, wildcardTransition)
      return true // Indicate that a wildcard transition was applied
    }

    return false // No wildcard transition found
  }

  async closeIssueUsingTransitionMap(issueId: string) {
    if (this.isDryRun) {
      console.log(`[Dry Run] Would apply transition map to issue ${issueId}`)
      return
    }

    // Attempt to apply a wildcard transition first
    const wildcardApplied = await this.applyWildcardTransition(issueId)
    if (wildcardApplied) {
      console.log(
        `Wildcard transition applied to issue ${issueId}. Closing process completed.`
      )
      return // Exit the method as the wildcard transition takes precedence
    }

    console.log(
      `Attempting to close ${issueId}: Applying transition map to issue`
    )
    try {
      for (let i = 0; i <= this.transitionMap.length; i++) {
        const currentStatus = await this.getCurrentStatus(issueId)
        const nextTransition = this.transitionMap.find(
          rule => rule.status === currentStatus
        )?.transition

        if (!nextTransition) {
          console.log(
            `No further transitions defined for current status: ${currentStatus}. Issue ${issueId} considered at desired state.`
          )
          return // No mapped transition for current status, considered as terminal state
        }

        // Apply the transition directly from the map
        await this.transitionIssueByName(issueId, nextTransition)
      }
      throw new Error(`Overran transition map for issue ${issueId}.`)
    } catch (error: unknown) {
      throw new Error(
        `Error applying transition map to issue ${issueId}: ${extractErrorMessage(error)}`
      )
    }
  }
  async completeWorkflow(issueKey: string) {
    const opposedStatuses = [
      'canceled',
      'backout',
      'rejected',
      'cancel',
      'reject',
      'block',
      'blocked'
    ]
    const doneStatuses = [
      'done',
      'closed',
      'close',
      'complete',
      'completed',
      'deploy',
      'deployed'
    ]
    try {
      const issue = await this.getIssue(issueKey)
      const processedTransitions: string[] = []
      do {
        const availableTransitions: Transition[] =
          await this.getIssueTransitions(issueKey)
        if (availableTransitions.length > 0) {
          const targetTransitions = availableTransitions.filter(
            (transition: {name: string}) =>
              !opposedStatuses.includes(transition.name.toLowerCase()) &&
              !processedTransitions.includes(transition.name.toLowerCase())
          )
          const lastStatus =
            processedTransitions[
              processedTransitions?.length - 1
            ]?.toLowerCase()
          if (targetTransitions.length <= 0) {
            if (!processedTransitions.length) {
              throw new Error('Unsupported workflow; no transition available')
            }
            if (!doneStatuses.includes(lastStatus)) {
              throw new Error(
                'Unsupported Workflow: does not contain any of ' +
                  doneStatuses.join(',') +
                  'statuses'
              )
            }
            break
          } else if (doneStatuses.includes(lastStatus)) {
            return
          }
          const transition = targetTransitions[0]
          processedTransitions.push(targetTransitions[0].name?.toLowerCase())
          await this.transitionIssueById(
            issueKey,
            transition.id,
            transition.name,
            transition
          )
          console.log(
            `Transitioned issue ${issueKey} to the next stage: ${targetTransitions[0].name}`
          )
        } else {
          break
        }
      } while (true)
    } catch (e) {
      console.log('Error completing the workflow ', e)
    }
  }

  async closeIssue(issueKey: string) {
    if (!issueKey) return
    try {
      const transitions = await this.getIssueTransitions(issueKey)
      const doneTransition = transitions.find(
        (t: {name: string}) => t.name === 'Done'
      )

      if (!doneTransition) {
        try {
          if (this.transitionMap.length) {
            await this.closeIssueUsingTransitionMap(issueKey)
          } else {
            try {
              await this.completeWorkflow(issueKey)
            } catch (e) {
              console.log(
                'The built-in autoclose failed, specify the transition map. Please see README for "jira-transition-map".'
              )
            }
          }
        } catch (e) {
          try {
            await this.completeWorkflow(issueKey)
          } catch (e) {
            console.log(
              'The built-in complete workflow failed, please specify the transition map'
            )
          }
        }
        return
      }

      await this.transitionIssueByName(issueKey, doneTransition.name)
    } catch (e: any) {
      throw new Error(`Error closing issue ${issueKey}: ${e.message}`)
    }
  }
}
