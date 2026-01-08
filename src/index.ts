import * as core from '@actions/core'
import {
  SecurityHubJiraSync,
  SecurityHubJiraSyncConfig
} from './macfc-security-hub-sync'
import {JiraConfig, CustomFields, Jira} from './libs/jira-lib'

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'An unknown error occurred'
}

// Utility function to get input with fallback to environment variable, can return undefined
function getInputOrEnv(inputName: string, envName: string): string | undefined {
  const inputValue = core.getInput(inputName) || process.env[envName]
  return inputValue
}

// Utility function to get input with fallback to environment variable and default value
function getDefaultInputOrEnv(
  inputName: string,
  envName: string,
  defaultValue: string
): string {
  return getInputOrEnv(inputName, envName) || defaultValue
}

// Utility function to get input with fallback to environment variable and throws an error if it is not set
function getRequiredInputOrEnv(inputName: string, envName: string): string {
  const inputValue = core.getInput(inputName) || process.env[envName]

  if (!inputValue) {
    throw new Error(
      `Input for '${inputName}' or environment variable '${envName}' is required but not set.`
    )
  }
  return inputValue
}

// Utility function to get input with fallback to environment variable and converts to boolean
function getInputOrEnvAndConvertToBool(
  inputName: string,
  envName: string,
  defaultValue: boolean = false
): boolean {
  const inputValue =
    core.getInput(inputName) || process.env[envName] || defaultValue.toString()
  return inputValue.trim().toLowerCase() === 'true'
}

function validateAndFilterSeverities(inputSeverities: string): string[] {
  const allowedSeverities = [
    'INFORMATIONAL',
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  ]

  const inputSeveritiesArray = inputSeverities
    .split(',')
    .map(severity => severity.trim().toUpperCase())
    .filter(severity => severity)

  // Check each severity in the array against the allowed severities
  inputSeveritiesArray.forEach(severity => {
    if (!allowedSeverities.includes(severity)) {
      throw new Error(
        `Invalid severity level detected: '${severity}'. Allowed severities are: ${allowedSeverities.join(', ')}.`
      )
    }
  })

  return inputSeveritiesArray
}

function parseAndValidateTransitionMap(
  transitionMapStr: string | undefined
): Array<{status: string; transition: string}> {
  if (!transitionMapStr) {
    return [] // Defaults to wildcard status and transition of 'DONE' if no map is provided
  }

  const transitionMap = transitionMapStr.split(';').map(ruleStr => {
    const [status, transition] = ruleStr
      .split(':')
      .map(part => part.trim().toUpperCase())
    if (!status || !transition) {
      throw new Error(
        `Invalid transition rule format: '${ruleStr}'. Expected format is 'Status:Transition'.`
      )
    }

    return {status, transition}
  })

  // Check for the presence of a wildcard transition and validate its uniqueness
  const hasWildcard = transitionMap.some(rule => rule.status === '*')
  if (hasWildcard && transitionMap.length > 1) {
    throw new Error(
      `Invalid transition map: When using a wildcard transition ('*'), it must be the only transition in the map.`
    )
  }

  return transitionMap
}

async function run(): Promise<void> {
  try {
    const transitionMapStr = getDefaultInputOrEnv(
      'jira-transition-map',
      'JIRA_TRANSITION_MAP',
      ''
    )

    let customJiraFields: CustomFields | undefined
    const customJiraFieldsStr = getInputOrEnv(
      'jira-custom-fields',
      'JIRA_CUSTOM_FIELDS'
    )
    if (customJiraFieldsStr) {
      try {
        customJiraFields = JSON.parse(customJiraFieldsStr) as CustomFields
      } catch (e: unknown) {
        throw new Error(
          `Error parsing JSON string for jira-custom-fields input: ${extractErrorMessage(e)}`
        )
      }
    }
    const transitionMap = parseAndValidateTransitionMap(transitionMapStr)

    const jiraConfig: JiraConfig = {
      jiraBaseURI: getDefaultInputOrEnv(
        'jira-base-uri',
        'JIRA_BASE_URI',
        'https://jiraent.cms.gov'
      ),
      jiraUsername: getRequiredInputOrEnv('jira-username', 'JIRA_USERNAME'),
      jiraToken: getRequiredInputOrEnv('jira-token', 'JIRA_TOKEN'),
      jiraProjectKey: getRequiredInputOrEnv('jira-project-key', 'JIRA_PROJECT'),
      jiraIgnoreStatuses: getDefaultInputOrEnv(
        'jira-ignore-statuses',
        'JIRA_IGNORE_STATUSES',
        'Done, Closed, Resolved'
      ),
      jiraWatchers: getDefaultInputOrEnv('jira-watchers', 'JIRA_WATCHERS', ''),
      jiraAddLabels: getDefaultInputOrEnv(
        'jira-add-labels',
        'JIRA_ADD_LABELS',
        ''
      ),
      testFindingsData: getDefaultInputOrEnv(
        'test-findings-data',
        'TEST_FINDINGS_DATA',
        ''
      ),
      jiraAssignee: getInputOrEnv('jira-assignee', 'JIRA_ASSIGNEE'),
      transitionMap: transitionMap,
      dryRunTestData: getInputOrEnvAndConvertToBool(
        'dry-run-test-data',
        'DRY_RUN_TEST_DATA',
        false
      ),
      jiraLinkIdOnCreation: getInputOrEnv('jira-link-id-on-creation', 'JIRA_LINK_ID'),
      jiraLinkTypeOnCreation: getDefaultInputOrEnv(
        'jira-link-type-on-creation',
        'JIRA_LINK_TYPE',
        'Relates'
      ),
      jiraLinkDirectionOnCreation: getDefaultInputOrEnv(
        'jira-link-direction-on-creation',
        'JIRA_LINK_DIRECTION',
        'inward'
      ),
      includeAllProducts: getInputOrEnvAndConvertToBool(
        'include-all-products',
        'INCLUDE_ALL_PRODUCTS',
        false
      ),
      skipProducts: getInputOrEnv('skip-products', 'SKIP_PRODUCTS'),
      jiraLabelsConfig: getInputOrEnv(
        'jira-labels-config',
        'JIRA_LABELS_CONFIG'
      ),
      dueDateCritical: getDefaultInputOrEnv(
        'due-date-critical',
        'DUE_DATE_CRITICAL',
        '15'
      ),
      dueDateHigh: getDefaultInputOrEnv(
        'due-date-high',
        'DUE_DATE_HIGH',
        '30'
      ),
      dueDateModerate: getDefaultInputOrEnv(
        'due-date-moderate',
        'DUE_DATE_MODERATE',
        '90'
      ),
      dueDateLow: getDefaultInputOrEnv(
        'due-date-low',
        'DUE_DATE_LOW',
        '365'
      ),
      jiraDueDateField: getDefaultInputOrEnv( // Add the new input reading
        'jira-duedate-field',
        'JIRA_DUEDATE_FIELD',
        ''
      ),
      jiraApiVersion: getDefaultInputOrEnv(
        'jira-api-version',
        'JIRA_API_VERSION',
        '3'
      )
    }

    const severitiesStr = getDefaultInputOrEnv(
      'aws-severities',
      'AWS_SEVERITIES',
      'CRITICAL,HIGH,MEDIUM'
    ) //

    const securityHubConfig: SecurityHubJiraSyncConfig = {
      region: getDefaultInputOrEnv('aws-region', 'AWS_REGION', 'us-east-1'),
      severities: validateAndFilterSeverities(severitiesStr),
      newIssueDelay: getDefaultInputOrEnv(
        'security-hub-new-issue-delay',
        'SECURITY_HUB_NEW_ISSUE_DELAY',
        '86400000'
      ), //
      customJiraFields: customJiraFields,
      includeAllProducts: getInputOrEnvAndConvertToBool(
        'include-all-products',
        'INCLUDE_ALL_PRODUCTS',
        false
      ),
      skipProducts: getInputOrEnv('skip-products', 'SKIP_PRODUCTS'),
      consolidateTickets: getInputOrEnvAndConvertToBool(
        'jira-consolidate-tickets',
        'JIRA_CONSOLIDATE_TICKETS'
      )
    }

    const autoClose = getInputOrEnvAndConvertToBool(
      'auto-close',
      'AUTO_CLOSE',
      true
    )

    core.info('Syncing Security Hub and Jira')
    const secHub = new SecurityHubJiraSync(
      jiraConfig,
      securityHubConfig,
      autoClose
    )
    const syncResult = await secHub.sync()
    const resultUpdates = syncResult.updatesForReturn; // Extract the updates array

    // Construct the JQL
    const jqlQuery = `issueKey in ( ${resultUpdates
      .map(({webUrl: url}) => {
        const regex = /\/browse\/([A-Z]+-\d+)/
        const match = url.match(regex)
        return match ? match[1] : '' // Returns the issue key or an empty string
      })
      .filter(url => url)
      .join(',')} )`

    // Jira base URL and the search endpoint
    const jiraBaseUrl = jiraConfig.jiraBaseURI
    const jqlEncoded = encodeURIComponent(jqlQuery)

    // Complete Jira URL
    const jiraUrl = `${jiraBaseUrl}/issues/?jql=${jqlEncoded}`
    core.setOutput('jql', jiraUrl)
    core.setOutput(
      'updates',
      resultUpdates
        .filter(update => update.action == 'created')
        .map(({webUrl}) => {
          return webUrl
        })
        .join(',')
    )
    core.setOutput('total', resultUpdates.length)
    core.setOutput(
      'created',
      resultUpdates.filter(update => update.action == 'created').length
    )
    core.setOutput(
      'closed',
      resultUpdates.filter(update => update.action == 'closed').length
    )
    
    // Set the new error count outputs
    core.setOutput('create-issue-errors', syncResult.createIssueErrors);
    core.setOutput('link-issue-errors', syncResult.linkIssueErrors);

    // Fail the job if there are any create issue errors or link issue errors
    if (syncResult.createIssueErrors > 0 || syncResult.linkIssueErrors > 0) {
      throw new Error(`Job failed due to errors: ${syncResult.createIssueErrors} create issue errors, ${syncResult.linkIssueErrors} link issue errors`);
    }

    // log into console also
    core.info(
      `Jira URL: ${jiraUrl} \n` +
        `Total Issues: ${resultUpdates.length} \n` +
        `Created Issues: ${resultUpdates.filter(
          update => update.action == 'created'
        ).length} \n` +
        `Closed Issues: ${resultUpdates.filter(
          update => update.action == 'closed'
        ).length}`
    )
  } catch (error: unknown) {
    core.setFailed(`Sync failed: ${extractErrorMessage(error)}`)
  }
}

run()
