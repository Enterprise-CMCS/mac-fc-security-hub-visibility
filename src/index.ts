import * as core from '@actions/core'
import {
  SecurityHubJiraSync,
  SecurityHubJiraSyncConfig
} from './macfc-security-hub-sync'
import {JiraConfig, CustomFields} from './libs/jira-lib'

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
        `Invalid severity level detected: '${severity}'. Allowed severities are: ${allowedSeverities.join(
          ', '
        )}.`
      )
    }
  })

  return inputSeveritiesArray
}

function parseAndValidateTransitionMap(
  transitionMapStr: string | undefined
): Array<{status: string; transition: string}> {
  if (!transitionMapStr) {
    return [{status: '*', transition: 'DONE'}] // Defaults to wildcard status and transition of 'DONE' if no map is provided
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
      '*: DONE'
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
          `Error parsing JSON string for jira-custom-fields input: ${extractErrorMessage(
            e
          )}`
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
      jiraAssignee: getInputOrEnv('jira-assignee', 'JIRA_ASSIGNEE'),
      transitionMap: transitionMap,
      dryRun: getInputOrEnvAndConvertToBool('dry-run', 'DRY_RUN', false),
      jiraLinkId: getInputOrEnv('jira-link-id', 'JIRA_LINK_ID'),
      jiraLinkType: getDefaultInputOrEnv(
        'jira-link-type',
        'JIRA_LINK_TYPE',
        'Relates'
      ),
      jiraLinkDirection: getDefaultInputOrEnv(
        'jira-link-direction',
        'JIRA_LINK_DIRECTION',
        'inward'
      ),
      includeAllProducts: getInputOrEnvAndConvertToBool(
        'include-all-products',
        'INCLUDE_ALL_PRODUCTS',
        false
      ),
      skipProducts: getInputOrEnv('skip-products', 'SKIP_PRODUCTS'),
      jiraLabelsConfig: getInputOrEnv('jira-labels-config', 'JIRA_LABELS_CONFIG')
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
      skipProducts: getInputOrEnv('skip-products', 'SKIP_PRODUCTS')
    }

    const autoClose = getInputOrEnvAndConvertToBool(
      'auto-close',
      'AUTO_CLOSE',
      true
    )

    core.info('Syncing Security Hub and Jira')
    await new SecurityHubJiraSync(
      jiraConfig,
      securityHubConfig,
      autoClose
    ).sync()
  } catch (error: unknown) {
    core.setFailed(`Sync failed: ${extractErrorMessage(error)}`)
  }
}

run()
