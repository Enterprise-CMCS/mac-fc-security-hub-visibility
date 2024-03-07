"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityHub = void 0;
const client_iam_1 = require("@aws-sdk/client-iam");
const client_securityhub_1 = require("@aws-sdk/client-securityhub");
class SecurityHub {
    region;
    severityLabels;
    accountAlias = "";
    constructor({ region = "us-east-1", severities = ["HIGH", "CRITICAL"], } = {}) {
        this.region = region;
        this.severityLabels = severities.map((severity) => ({
            Comparison: "EQUALS",
            Value: severity,
        }));
        this.getAccountAlias().catch((error) => console.error(error));
    }
    async getAccountAlias() {
        const iamClient = new client_iam_1.IAMClient({ region: this.region });
        const response = await iamClient.send(new client_iam_1.ListAccountAliasesCommand({}));
        this.accountAlias = response.AccountAliases?.[0] || "";
    }
    async getAllActiveFindings() {
        try {
            const securityHubClient = new client_securityhub_1.SecurityHubClient({ region: this.region });
            const currentTime = new Date();
            // delay for filtering out ephemeral issues
            const delayForNewIssues = +(process.env.SECURITY_HUB_NEW_ISSUE_DELAY ?? "86400000"); // 24 * 60 * 60 * 1000
            const maxDatetime = new Date(currentTime.getTime() - delayForNewIssues);
            const filters = {
                RecordState: [{ Comparison: "EQUALS", Value: "ACTIVE" }],
                WorkflowStatus: [
                    { Comparison: "EQUALS", Value: "NEW" },
                    { Comparison: "EQUALS", Value: "NOTIFIED" },
                ],
                ProductName: [{ Comparison: "EQUALS", Value: "Security Hub" }],
                SeverityLabel: this.severityLabels,
                CreatedAt: [
                    {
                        Start: "1970-01-01T00:00:00Z",
                        End: maxDatetime.toISOString(),
                    },
                ],
            };
            // use an object to store unique findings by title
            const uniqueFindings = {};
            // use a variable to track pagination
            let nextToken = undefined;
            do {
                const response = await securityHubClient.send(new client_securityhub_1.GetFindingsCommand({
                    Filters: filters,
                    MaxResults: 100, // this is the maximum allowed per page
                    NextToken: nextToken,
                }));
                if (response && response.Findings) {
                    for (const finding of response.Findings) {
                        const findingForJira = this.awsSecurityFindingToSecurityHubFinding(finding);
                        if (findingForJira.title)
                            uniqueFindings[findingForJira.title] = findingForJira;
                    }
                }
                if (response && response.NextToken)
                    nextToken = response.NextToken;
                else
                    nextToken = undefined;
            } while (nextToken);
            return Object.values(uniqueFindings).map((finding) => {
                return {
                    accountAlias: this.accountAlias,
                    ...finding,
                };
            });
        }
        catch (e) {
            throw new Error(`Error getting Security Hub findings: ${e.message}`);
        }
    }
    awsSecurityFindingToSecurityHubFinding(finding) {
        if (!finding)
            return {};
        return {
            title: finding.Title,
            region: finding.Region,
            accountAlias: this.accountAlias,
            awsAccountId: finding.AwsAccountId,
            severity: finding.Severity && finding.Severity.Label
                ? finding.Severity.Label
                : "",
            description: finding.Description,
            standardsControlArn: finding.ProductFields && finding.ProductFields.StandardsControlArn
                ? finding.ProductFields.StandardsControlArn
                : "",
            remediation: finding.Remediation,
        };
    }
}
exports.SecurityHub = SecurityHub;
