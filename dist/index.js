"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const macfc_security_hub_sync_1 = require("./macfc-security-hub-sync");
// Utility function to get input with fallback to environment variable
function getInputOrEnv(inputName, envName) {
    const inputValue = core.getInput(inputName);
    if (inputValue !== '') {
        process.env[envName] = inputValue;
        return;
    }
}
function validateAndFilterSeverities(inputSeverities) {
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
async function run() {
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
        getInputOrEnv('aws-severities', 'AWS_SEVERITIES');
        let customJiraFields;
        getInputOrEnv('jira-custom-fields', 'JIRA_CUSTOM_FIELDS');
        if (process.env.JIRA_CUSTOM_FIELDS) {
            try {
                customJiraFields = JSON.parse(process.env.JIRA_CUSTOM_FIELDS);
            }
            catch (e) {
                throw new Error(`Error parsing JSON string for jira-custom-fields input: ${e}`);
            }
        }
        core.info('Syncing Security Hub and Jira');
        await new macfc_security_hub_sync_1.SecurityHubJiraSync({
            region: process.env.AWS_REGION,
            severities: validateAndFilterSeverities(process.env.AWS_SEVERITIES),
            epicKey: process.env.JIRA_EPIC_KEY,
            customJiraFields
        }).sync();
    }
    catch (e) {
        core.setFailed(`Sync failed: ${e}`);
    }
}
run();
