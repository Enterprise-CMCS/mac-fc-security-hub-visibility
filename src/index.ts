import * as core from '@actions/core';
import { SecurityHubJiraSync } from './macfc-security-hub-sync';

// Utility function to get input with fallback to environment variable
function getInputOrEnv(inputName: string, envName: string) {
  const inputValue = core.getInput(inputName);
  if (inputValue !== '') {
    return inputValue;
  }
  const envValue = process.env[envName];
  if (envValue !== undefined && envValue !== '') {
    return envValue;
  }
  return undefined; // Neither GHA input nor env variable is set
}

function validateAndFilterSeverities(inputSeverities: string): string[] {
  const allowedSeverities = ["INFORMATIONAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

  const inputSeveritiesArray = inputSeverities.split(',')
    .map(severity => severity.trim().toUpperCase())
    .filter(severity => severity); 

  // Check each severity in the array against the allowed severities
  inputSeveritiesArray.forEach(severity => {
    if (!allowedSeverities.includes(severity)) {
      throw new Error(`Invalid severity level detected: '${severity}'. Allowed severities are: ${allowedSeverities.join(', ')}.`);
    }
  });

  return inputSeveritiesArray;
}

async function run(): Promise<void> {
  try {
    const jiraBaseUri = getInputOrEnv('jira-base-uri', 'JIRA_BASE_URI');
    const jiraHost = getInputOrEnv('jira-host', 'JIRA_HOST');
    const jiraUsername = getInputOrEnv('jira-username', 'JIRA_USERNAME');
    const jiraToken = getInputOrEnv('jira-token', 'JIRA_TOKEN');
    const jiraProject = getInputOrEnv('jira-project-key', 'JIRA_PROJECT');
    const jiraClosedStatuses = getInputOrEnv('jira-ignore-statuses', 'JIRA_CLOSED_STATUSES');
    const autoClose = getInputOrEnv('auto-close', 'AUTO_CLOSE');
    const assignee = getInputOrEnv('assign-jira-ticket-to', 'ASSIGNEE');
    const awsRegion = getInputOrEnv('aws-region', 'AWS_REGION');

    let customJiraFields;
    const customJiraFieldsInput = getInputOrEnv('jira-custom-fields', 'JIRA_CUSTOM_FIELDS');
    if (customJiraFieldsInput) {
      try {
        customJiraFields = JSON.parse(customJiraFieldsInput);
      } catch (e: any) {
        throw new Error(
          `Error parsing JSON string for jira-custom-fields input: ${e.message}`
        );
      }
    }

    core.info('Syncing Security Hub and Jira');
    await new SecurityHubJiraSync({
      region: awsRegion,
      severities:  validateAndFilterSeverities(getInputOrEnv('aws-severities', 'AWS_SEVERITIES') || ''),
      epicKey: getInputOrEnv('jira-epic-key', 'JIRA_EPIC_KEY'),
      customJiraFields
    }).sync();
  } catch (e: any) {
    core.setFailed(`Sync failed: ${e.message}`);
  }
}

run();