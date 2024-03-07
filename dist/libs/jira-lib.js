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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Jira = void 0;
const dotenv = __importStar(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
dotenv.config();
class Jira {
    isDryRun;
    dryRunIssueCounter = 0;
    axiosInstance;
    jiraClosedStatuses;
    constructor() {
        Jira.checkEnvVars();
        // Interpret DRY_RUN environment variable flexibly
        this.isDryRun = process.env.DRY_RUN?.trim().toLowerCase() === 'true';
        this.axiosInstance = axios_1.default.create({
            baseURL: process.env.JIRA_BASE_URI,
            headers: {
                "Authorization": `Bearer ${process.env.JIRA_TOKEN}`,
                "Content-Type": "application/json",
            },
        });
        this.jiraClosedStatuses = process.env.JIRA_CLOSED_STATUSES
            ? process.env.JIRA_CLOSED_STATUSES.split(",").map((status) => status.trim())
            : ["Done"];
    }
    async getCurrentUser() {
        try {
            const response = await this.axiosInstance.get('/rest/api/2/myself');
            return response.data;
        }
        catch (error) {
            throw new Error(`Error fetching current user: ${error}`);
        }
    }
    async getIssueTransitions(issueId) {
        try {
            const response = await this.axiosInstance.get(`/rest/api/2/issue/${issueId}/transitions`);
            return response.data.transitions;
        }
        catch (error) {
            throw new Error(`Error fetching issue transitions: ${error}`);
        }
    }
    async transitionIssue(issueId, transitionData) {
        if (this.isDryRun) {
            console.log(`[Dry Run] Would transition issue ${issueId} with data:`, transitionData);
            return;
        }
        try {
            await this.axiosInstance.post(`/rest/api/2/issue/${issueId}/transitions`, transitionData);
            console.log(`Issue ${issueId} transitioned successfully.`);
        }
        catch (error) {
            throw new Error(`Error transitioning issue ${issueId}: ${error}`);
        }
    }
    async getPriorities() {
        try {
            const response = await this.axiosInstance.get('/rest/api/2/priority');
            return response.data;
        }
        catch (error) {
            throw new Error(`Error fetching priorities: ${error}`);
        }
    }
    async removeCurrentUserAsWatcher(issueId) {
        try {
            const currentUser = await this.getCurrentUser();
            console.log("Remove watcher: " + currentUser.name);
            if (this.isDryRun) {
                console.log(`[Dry Run] Would remove ${currentUser.name} from ${issueId} as watcher.`);
                return; // Skip the actual API call
            }
            await this.axiosInstance.delete(`/rest/api/2/issue/${issueId}/watchers`, {
                params: {
                    username: currentUser.name,
                },
            });
        }
        catch (error) {
            throw new Error(`Error creating issue or removing watcher: ${error}`);
        }
    }
    static checkEnvVars() {
        const requiredEnvVars = [
            "JIRA_HOST",
            "JIRA_USERNAME",
            "JIRA_TOKEN",
            "JIRA_PROJECT",
        ];
        const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
        if (missingEnvVars.length) {
            throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
        }
    }
    static formatLabelQuery(label) {
        return `labels = '${label}'`;
    }
    async getAllSecurityHubIssuesInJiraProject(identifyingLabels) {
        const labelQueries = [...identifyingLabels, "security-hub"].map((label) => Jira.formatLabelQuery(label));
        const projectQuery = `project = '${process.env.JIRA_PROJECT}'`;
        const statusQuery = `status not in ('${this.jiraClosedStatuses.join("','" // wrap each closed status in single quotes
        )}')`;
        const fullQuery = [...labelQueries, projectQuery, statusQuery].join(" AND ");
        // We  want to do everything possible to prevent matching tickets that we shouldn't
        if (!fullQuery.includes(Jira.formatLabelQuery("security-hub"))) {
            throw new Error("ERROR:  Your query does not include the 'security-hub' label, and is too broad.  Refusing to continue");
        }
        if (!fullQuery.match(Jira.formatLabelQuery("[0-9]{12}"))) {
            throw new Error("ERROR:  Your query does not include an AWS Account ID as a label, and is too broad.  Refusing to continue");
        }
        console.log(fullQuery);
        let totalIssuesReceived = 0;
        let allIssues = [];
        let startAt = 0;
        let total = 0;
        do {
            try {
                const response = await this.axiosInstance.post('/rest/api/2/search', {
                    jql: fullQuery,
                    startAt: startAt,
                    maxResults: 50,
                    fields: ["*all"]
                });
                const results = response.data;
                allIssues = allIssues.concat(results.issues);
                totalIssuesReceived += results.issues.length;
                startAt = totalIssuesReceived;
                total = results.total;
            }
            catch (error) {
                throw new Error(`Error getting Security Hub issues from Jira: ${error}`);
            }
        } while (totalIssuesReceived < total);
        return allIssues;
    }
    async getPriorityIdsInDescendingOrder() {
        try {
            const priorities = await this.getPriorities();
            // Get priority IDs in descending order
            const descendingPriorityIds = priorities.map((priority) => priority.id);
            return descendingPriorityIds;
        }
        catch (error) {
            throw new Error(`Error fetching priority IDs: ${error}`);
        }
    }
    async createNewIssue(issue) {
        try {
            const assignee = process.env.ASSIGNEE ?? "";
            if (assignee) {
                issue.fields.assignee = { name: assignee };
            }
            issue.fields.project = { key: process.env.JIRA_PROJECT };
            if (this.isDryRun) {
                console.log(`[Dry Run] Would create a new issue with the following details:`, issue);
                // Return a dry run issue object
                this.dryRunIssueCounter++;
                const dryRunIssue = {
                    id: `dryrun-id-${this.dryRunIssueCounter}`,
                    key: `DRYRUN-KEY-${this.dryRunIssueCounter}`,
                    fields: {
                        summary: issue.fields.summary || `Dry Run Summary ${this.dryRunIssueCounter}`,
                    },
                    webUrl: `${process.env.JIRA_BASE_URI}/browse/DRYRUN-KEY-${this.dryRunIssueCounter}`,
                };
                return dryRunIssue; // Return a dummy issue
            }
            const response = await this.axiosInstance.post('/rest/api/2/issue', issue);
            const newIssue = response.data;
            // Construct the webUrl for the new issue
            newIssue["webUrl"] = `${process.env.JIRA_BASE_URI}/browse/${newIssue.key}`;
            await this.removeCurrentUserAsWatcher(newIssue.key);
            return newIssue;
        }
        catch (error) {
            throw new Error(`Error creating Jira issue: ${error}`);
        }
    }
    async updateIssueTitleById(issueId, updatedIssue) {
        if (this.isDryRun) {
            console.log(`[Dry Run] Would update issue title for issue ${issueId} with:`, updatedIssue);
            return;
        }
        try {
            const response = await this.axiosInstance.put(`/rest/api/2/issue/${issueId}`, updatedIssue);
            console.log("Issue title updated successfully:", response.data);
        }
        catch (error) {
            throw new Error(`Error updating issue title: ${error}`);
        }
    }
    async addCommentToIssueById(issueId, comment) {
        if (this.isDryRun) {
            console.log(`[Dry Run] Would add comment to issue ${issueId}:`, comment);
            return;
        }
        try {
            await this.axiosInstance.post(`/rest/api/2/issue/${issueId}/comment`, { body: comment });
            await this.removeCurrentUserAsWatcher(issueId); // Commenting on the issue adds the user as a watcher, so we remove them
        }
        catch (error) {
            throw new Error(`Error adding comment to issue: ${error}`);
        }
    }
    async findPathToClosure(transitions, currentStatus) {
        const visited = new Set();
        const queue = [
            { path: [], status: currentStatus },
        ];
        while (queue.length > 0) {
            const { path, status } = queue.shift();
            visited.add(status);
            const possibleTransitions = transitions.filter((transition) => transition.from.name === status);
            for (const transition of possibleTransitions) {
                const newPath = [...path, transition.id];
                const newStatus = transition.to.name;
                if (newStatus.toLowerCase().includes("close") ||
                    newStatus.toLowerCase().includes("done")) {
                    return newPath; // Found a path to closure
                }
                if (!visited.has(newStatus)) {
                    queue.push({ path: newPath, status: newStatus });
                }
            }
        }
        return []; // No valid path to closure found
    }
    async completeWorkflow(issueId) {
        const opposedStatuses = ["canceled", "backout", "rejected"];
        try {
            do {
                const availableTransitions = await this.getIssueTransitions(issueId);
                const processedTransitions = [];
                console.log(availableTransitions);
                if (availableTransitions.length > 0) {
                    const targetTransitions = availableTransitions.transitions.filter((transition) => !opposedStatuses.includes(transition.name.toLowerCase()) &&
                        !processedTransitions.includes(transition.name.toLowerCase()));
                    const transitionId = targetTransitions[0].id;
                    processedTransitions.push(targetTransitions[0].name);
                    await this.transitionIssue(issueId, {
                        transition: { id: transitionId },
                    });
                    console.log(`Transitioned issue ${issueId} to the next step.`);
                }
                else {
                    break;
                }
            } while (true);
        }
        catch (error) {
            throw new Error(`Error completing the workflow: ${error}`);
        }
    }
    async closeIssue(issueId) {
        if (this.isDryRun) {
            console.log(`[Dry Run] Would close issue ${issueId}`);
            return;
        }
        if (!issueId)
            return;
        try {
            const transitions = await this.getIssueTransitions(issueId);
            const doneTransition = transitions.find((t) => t.name === "Done");
            if (!doneTransition) {
                this.completeWorkflow(issueId);
                return;
            }
            await this.transitionIssue(issueId, {
                transition: { id: doneTransition.id },
            });
        }
        catch (error) {
            throw new Error(`Error closing issue ${issueId}: ${error}`);
        }
    }
}
exports.Jira = Jira;
