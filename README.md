# Security Hub Visibility

## A GitHub action that syncs Security Hub findings with Jira issues

1. gets all current findings from Security Hub, filtered by the `Severity` of the findings (default is `CRITICAL,HIGH,MEDIUM`)

2. creates Jira issues for findings that don’t already have one. To avoid creating duplicate issues, the search criteria use the custom label configuration as well as default configuration for three identifying search labels: region, AWS account ID, and "security-hub."

3. closes existing Jira issues in the target project if their underlying findings are longer active

Please see `action.yml` for required and optional inputs, and `test.yml` for an example of how to use this action.

This action is backed by the `macpro-security-hub-sync` NPM package. See https://github.com/Enterprise-CMCS/macpro-security-hub-sync for details.
