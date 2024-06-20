import * as core from '@actions/core'
import {SecurityHubJiraSync} from '@enterprise-cmcs/macpro-security-hub-sync';

async function run(): Promise<void> {
  try {
    process.env.JIRA_HOST = core.getInput('jira-host')
    process.env.JIRA_USERNAME = core.getInput('jira-username')
    process.env.JIRA_TOKEN = core.getInput('jira-token')
    process.env.JIRA_PROJECT = core.getInput('jira-project-key')
    process.env.JIRA_CLOSED_STATUSES = core.getInput('jira-ignore-statuses')
    process.env.AUTO_CLOSE = core.getInput('auto-close')
    process.env.ASSIGNEE = core.getInput('assign-jira-ticket-to')
    process.env.JIRA_LINK_ID = core.getInput('jira-feature-issue')
    process.env.JIRA_LINK_TYPE = core.getInput('jira-link-type')

    let customJiraFields
    const customJiraFieldsInput = core.getInput('jira-custom-fields')
    if (customJiraFieldsInput) {
      try {
        customJiraFields = JSON.parse(customJiraFieldsInput)
      } catch (e: any) {
        throw new Error(
          `Error parsing JSON string for jira-custom-fields input: ${e.message}`
        )
      }
    }

    core.info('Syncing Security Hub and Jira')
    await new SecurityHubJiraSync({
      region: core.getInput('aws-region'),
      severities: core
        .getInput('aws-severities')
        .split(',')
        .map(severity => severity.trim()),
      epicKey: core.getInput('jira-epic-key'),
      customJiraFields
    }).sync()
  } catch (e: any) {
    core.setFailed(`Sync failed: ${e.message}`)
  }
}

run()
