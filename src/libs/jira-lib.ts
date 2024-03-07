import * as dotenv from "dotenv";
import axios, { AxiosInstance } from "axios";

dotenv.config();

export interface Issue {
  [name: string]: any;
}

export class Jira {
  private isDryRun: boolean;
  private dryRunIssueCounter: number = 0;
  private axiosInstance: AxiosInstance;
  jiraClosedStatuses: string[];

  constructor() {
    Jira.checkEnvVars();

    // Interpret DRY_RUN environment variable flexibly
    this.isDryRun = process.env.DRY_RUN?.trim().toLowerCase() === 'true';

    this.axiosInstance = axios.create({
      baseURL: process.env.JIRA_BASE_URI,
      headers: {
        "Authorization": `Bearer ${process.env.JIRA_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    this.jiraClosedStatuses = process.env.JIRA_CLOSED_STATUSES
      ? process.env.JIRA_CLOSED_STATUSES.split(",").map((status) =>
          status.trim()
        )
      : ["Done"];
  }
  async getCurrentUser() {
    try {
      const response = await this.axiosInstance.get('/rest/api/2/myself');
      return response.data;
    } catch (error) {
      throw new Error(`Error fetching current user: ${error}`);
    }
  }
  async getIssueTransitions(issueId: string) {
    try {
      const response = await this.axiosInstance.get(`/rest/api/2/issue/${issueId}/transitions`);  
      return response.data.transitions;
    } catch (error) {
      throw new Error(`Error fetching issue transitions: ${error}`);
    }
  }
  async transitionIssue(issueId: string, transitionData: any) {
    if (this.isDryRun) {
      console.log(`[Dry Run] Would transition issue ${issueId} with data:`, transitionData);
      return;
    }

    try {
      await this.axiosInstance.post(`/rest/api/2/issue/${issueId}/transitions`, transitionData);
      console.log(`Issue ${issueId} transitioned successfully.`);
    } catch (error) {
      throw new Error(`Error transitioning issue ${issueId}: ${error}`);
    }
  }
  async getPriorities() {
    try {
      const response = await this.axiosInstance.get('/rest/api/2/priority');
      return response.data;
    } catch (error) {
      throw new Error(`Error fetching priorities: ${error}`);
    }
  }
  async removeCurrentUserAsWatcher(issueId: string) {
    try {
      const currentUser = await this.getCurrentUser();
      console.log("Remove watcher: " + currentUser.name)

      if (this.isDryRun) {
        console.log(`[Dry Run] Would remove ${currentUser.name} from ${issueId} as watcher.`);
        return; // Skip the actual API call
      }

      await this.axiosInstance.delete(`/rest/api/2/issue/${issueId}/watchers`, {
        params: {
          username: currentUser.name,
        },
      });
    } catch (error) {
      throw new Error(`Error creating issue or removing watcher: ${error}`);
    }
  }

  private static checkEnvVars(): void {
    const requiredEnvVars = [
      "JIRA_HOST",
      "JIRA_USERNAME",
      "JIRA_TOKEN",
      "JIRA_PROJECT",
    ];
    const missingEnvVars = requiredEnvVars.filter(
      (envVar) => !process.env[envVar]
    );

    if (missingEnvVars.length) {
      throw new Error(
        `Missing required environment variables: ${missingEnvVars.join(", ")}`
      );
    }
  }

  private static formatLabelQuery(label: string): string {
    return `labels = '${label}'`;
  }

  async getAllSecurityHubIssuesInJiraProject(
    identifyingLabels: string[]
  ): Promise<Issue[]> {
    const labelQueries = [...identifyingLabels, "security-hub"].map((label) =>
      Jira.formatLabelQuery(label)
    );
    const projectQuery = `project = '${process.env.JIRA_PROJECT}'`;
    const statusQuery = `status not in ('${this.jiraClosedStatuses.join(
      "','" // wrap each closed status in single quotes
    )}')`;
    const fullQuery = [...labelQueries, projectQuery, statusQuery].join(
      " AND "
    );
    // We  want to do everything possible to prevent matching tickets that we shouldn't
    if (!fullQuery.includes(Jira.formatLabelQuery("security-hub"))) {
      throw new Error(
        "ERROR:  Your query does not include the 'security-hub' label, and is too broad.  Refusing to continue"
      );
    }
    if (!fullQuery.match(Jira.formatLabelQuery("[0-9]{12}"))) {
      throw new Error(
        "ERROR:  Your query does not include an AWS Account ID as a label, and is too broad.  Refusing to continue"
      );
    }
    console.log(fullQuery);

    let totalIssuesReceived = 0;
    let allIssues: Issue[] = [];
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
      } catch (error: unknown) {
        if (error instanceof AggregateError) {
          console.error("we got an aggregate error");
          const errors = error.errors;

          for (const error of errors) {
            console.log(error.message);
          }
        }
        else {
          throw new Error(`Error getting Security Hub issues from Jira: ${error}`);
        }
      }
    } while (totalIssuesReceived < total);
  
    return allIssues;
  }
  async getPriorityIdsInDescendingOrder(): Promise<string[]> {
    try {
      const priorities = await this.getPriorities();

      // Get priority IDs in descending order
      const descendingPriorityIds = priorities.map(
        (priority: { id: any }) => priority.id
      );

      return descendingPriorityIds;
    } catch (error) {
      throw new Error(`Error fetching priority IDs: ${error}`);
    }
  }
  async createNewIssue(issue: Issue): Promise<Issue> {
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
        const dryRunIssue: Issue = {
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
    } catch (error) {
      throw new Error(`Error creating Jira issue: ${error}`);
    }
  }
  async updateIssueTitleById(issueId: string, updatedIssue: Partial<Issue>) {
    if (this.isDryRun) {
      console.log(`[Dry Run] Would update issue title for issue ${issueId} with:`, updatedIssue);
      return;
    }

    try {
      const response = await this.axiosInstance.put(`/rest/api/2/issue/${issueId}`, updatedIssue);
      console.log("Issue title updated successfully:", response.data);
    } catch (error) {
      throw new Error(`Error updating issue title: ${error}`);
    }
  }
  async addCommentToIssueById(issueId: string, comment: string) {
    if (this.isDryRun) {
      console.log(`[Dry Run] Would add comment to issue ${issueId}:`, comment);
      return;
    }

    try {
      await this.axiosInstance.post(`/rest/api/2/issue/${issueId}/comment`, { body: comment });
      await this.removeCurrentUserAsWatcher(issueId); // Commenting on the issue adds the user as a watcher, so we remove them

  
    } catch (error) {
      throw new Error(`Error adding comment to issue: ${error}`);
    }
  }
  async findPathToClosure(transitions: any, currentStatus: string) {
    const visited = new Set();
    const queue: { path: string[]; status: string }[] = [
      { path: [], status: currentStatus },
    ];

    while (queue.length > 0) {
      const { path, status } = queue.shift()!;
      visited.add(status);

      const possibleTransitions = transitions.filter(
        (transition: { from: { name: string } }) =>
          transition.from.name === status
      );

      for (const transition of possibleTransitions) {
        const newPath = [...path, transition.id];
        const newStatus = transition.to.name;

        if (
          newStatus.toLowerCase().includes("close") ||
          newStatus.toLowerCase().includes("done")
        ) {
          return newPath; // Found a path to closure
        }

        if (!visited.has(newStatus)) {
          queue.push({ path: newPath, status: newStatus });
        }
      }
    }

    return []; // No valid path to closure found
  }

  async completeWorkflow(issueId: string) {
    const opposedStatuses = ["canceled", "backout", "rejected"];
    try {
      do {
        const availableTransitions = await this.getIssueTransitions(issueId);
        const processedTransitions: string[] = [];
        console.log(availableTransitions);
        if (availableTransitions.length > 0) {
          const targetTransitions = availableTransitions.transitions.filter(
            (transition: { name: string }) =>
              !opposedStatuses.includes(transition.name.toLowerCase()) &&
              !processedTransitions.includes(transition.name.toLowerCase())
          );
          const transitionId = targetTransitions[0].id;
          processedTransitions.push(targetTransitions[0].name);
          await this.transitionIssue(issueId, {
            transition: { id: transitionId },
          });
          console.log(`Transitioned issue ${issueId} to the next step.`);
        } else {
          break;
        }
      } while (true);
    } catch (error) {
      throw new Error(`Error completing the workflow: ${error}`);
    }
  }

  async closeIssue(issueId: string) {
    if (this.isDryRun) {
      console.log(`[Dry Run] Would close issue ${issueId}`);
      return;
    }

    if (!issueId) return;
    try {
      const transitions = await this.getIssueTransitions(issueId);
      const doneTransition = transitions.find(
        (t: { name: string }) => t.name === "Done"
      );

      if (!doneTransition) {
        this.completeWorkflow(issueId);
        return;
      }

      await this.transitionIssue(issueId, {
        transition: { id: doneTransition.id },
      });
    } catch (error) {
      throw new Error(`Error closing issue ${issueId}: ${error}`);
    }
  }
}
