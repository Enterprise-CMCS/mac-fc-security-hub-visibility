import * as core from '@actions/core';
import { SecurityHubJiraSync } from './macfc-security-hub-sync';

// Utility function to get input with fallback to environment variable
function getInputOrEnv(inputName: string, envName: string) {
  const inputValue = core.getInput(inputName);
  if (inputValue !== '') {
    process.env[envName] = inputValue;
    return
  }
}

function validateAndFilterSeverities(inputSeverities: string | undefined): string[] | undefined{
  if (!inputSeverities) {
    return undefined; // Potentially update with default severities
  }
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
    getInputOrEnv('jira-base-uri', 'JIRA_BASE_URI');
    getInputOrEnv('jira-host', 'JIRA_HOST');
    getInputOrEnv('jira-username', 'JIRA_USERNAME');
    getInputOrEnv('jira-token', 'JIRA_TOKEN');
    getInputOrEnv('jira-project-key', 'JIRA_PROJECT');
    getInputOrEnv('jira-ignore-statuses', 'JIRA_CLOSED_STATUSES');
    getInputOrEnv('auto-close', 'AUTO_CLOSE');
    getInputOrEnv('assign-jira-ticket-to', 'ASSIGNEE');
    getInputOrEnv('aws-region', 'AWS_REGION');
    getInputOrEnv('aws-severities', 'AWS_SEVERITIES')

    let customJiraFields;
    getInputOrEnv('jira-custom-fields', 'JIRA_CUSTOM_FIELDS');
    if (process.env.JIRA_CUSTOM_FIELDS) {
      try {
        customJiraFields = JSON.parse(process.env.JIRA_CUSTOM_FIELDS);
      } catch (e: unknown) {
        throw new Error(
          `Error parsing JSON string for jira-custom-fields input: ${e}`
        );
      }
    }

    core.info('Syncing Security Hub and Jira');
    await new SecurityHubJiraSync({
      region: process.env.AWS_REGION,
      severities:  validateAndFilterSeverities(process.env.AWS_SEVERITIES),
      epicKey: process.env.JIRA_EPIC_KEY,
      customJiraFields
    }).sync();
  } catch (e: unknown) {
    core.setFailed(`Sync failed: ${e}`);
  }
}

run();
