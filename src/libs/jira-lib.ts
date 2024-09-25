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
  transitionMap: Array<{status: string; transition: string}>
  dryRun: boolean
  jiraLinkId?: string
  jiraLinkType?: string
  jiraLinkDirection?: string
  includeAllProducts: boolean
  skipProducts?: string
  jiraLabelsConfig?: string
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
  description?: string
  issuetype?: IssueType
  labels?: (string | undefined)[] // Assuming labels can be strings or objects
  priority?: PriorityField
  project?: {key: string}
  assignee?: {name: string}
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
        .map(err => extractErrorMessage(err))
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
    this.isDryRun = jiraConfig.dryRun
    if (jiraConfig.jiraLabelsConfig) {
      this.jiraLabelsConfig = JSON.parse(jiraConfig.jiraLabelsConfig)
    }

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
      const response = await this.axiosInstance.get('/rest/api/2/myself')
      return response.data
    } catch (error: unknown) {
      throw new Error(`Error fetching current user: ${handleAxiosError(error)}`)
    }
  }
  async getIssue(issueId: string) {
    try {
      const response = await this.axiosInstance.get(
        `/rest/api/2/issue/${issueId}`
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
        `/rest/api/2/issue/${issueId}/transitions`
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
        `/rest/api/2/issue/${issueId}/transitions`,
        {
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
    transitionName: string
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
        `/rest/api/2/issue/${issueId}/transitions`,
        {
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
        const splitted = user.accountId.split(':')
        console.log(splitted)
        params.value = splitted.length > 1 ? splitted[1] : splitted[0]
        params.key = 'accountId'
      }
      const res = await this.axiosInstance.post(
        `/rest/api/2/issue/${issueId}/watchers`,
        {
          [params.key]: params.value
        }
      )
      console.log('Added ' + watcher + 'as watcher ot issue: ' + issueId)
    } catch (error: unknown) {
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
      await this.axiosInstance.delete(`/rest/api/2/issue/${issueId}/watchers`, {
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
        finalLabelQuery = `(${finalLabelQuery}) OR (${searchQuery})`
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

    let totalIssuesReceived = 0
    let allIssues: Issue[] = []
    let startAt = 0
    let total = 0

    do {
      try {
        const response = await this.axiosInstance.post('/rest/api/2/search', {
          jql: fullQuery,
          startAt: startAt,
          maxResults: 50,
          fields: ['*all']
        })
        const results = response.data
        allIssues = allIssues.concat(results.issues)
        totalIssuesReceived += results.issues.length
        startAt = totalIssuesReceived
        total = results.total
      } catch (error: unknown) {
        throw new Error(
          `Error getting Security Hub issues from Jira: ${handleAxiosError(error)}`
        )
      }
    } while (totalIssuesReceived < total)

    return allIssues
  }
  async createNewIssue(issue: NewIssueData): Promise<Issue> {
    let response
    try {
      if (this.jiraAssignee) {
        issue.fields.assignee = {name: this.jiraAssignee}
      }
      issue.fields.project = {key: this.jiraProject}

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

      response = await this.axiosInstance.post('/rest/api/2/issue', issue)
      const newIssue = response.data
      // Construct the webUrl for the new issue
      newIssue['webUrl'] = `${this.jiraBaseURI}/browse/${newIssue.key}`
      await this.removeCurrentUserAsWatcher(newIssue.key)
      if (this.jiraWatchers) {
        await Promise.all(
          this.jiraWatchers.map((watcher: string) =>
            this.addUserAsWatcher(
              newIssue.key,
              watcher,
              this.jiraBaseURI.includes('atlassian') == false
            )
          )
        )
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
        '/rest/api/2/issueLink',
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
        `/rest/api/2/issue/${issueId}`,
        updatedIssue
      )
      console.log('Issue title updated successfully:', response.data)
    } catch (error: unknown) {
      throw new Error(`Error updating issue title: ${handleAxiosError(error)}`)
    }
  }
  async addCommentToIssueById(issueId: string, comment: string) {
    if (this.isDryRun) {
      console.log(`[Dry Run] Would add comment to issue ${issueId}:`, comment)
      return
    }

    try {
      await this.axiosInstance.post(`/rest/api/2/issue/${issueId}/comment`, {
        body: comment
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
            transition.name
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
