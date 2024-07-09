import { Remediation, AwsSecurityFinding, Resource } from "@aws-sdk/client-securityhub";
import { SecurityHubJiraSyncConfig } from "../macfc-security-hub-sync";
export interface SecurityHubFinding {
    title?: string;
    region?: string;
    accountAlias?: string;
    awsAccountId?: string;
    severity?: string;
    description?: string;
    standardsControlArn?: string;
    remediation?: Remediation;
    ProductName?: string;
    Resources?: Resource[];
}
export declare class SecurityHub {
    private readonly region;
    private readonly severityLabels;
    private readonly newIssueDelay;
    private accountAlias;
    private includeAllProducts?;
    private skipProducts?;
    constructor(securityHubJiraSyncConfig: SecurityHubJiraSyncConfig);
    private getAccountAlias;
    getAllActiveFindings(): Promise<{
        title?: string;
        region?: string;
        accountAlias: string;
        awsAccountId?: string;
        severity?: string;
        description?: string;
        standardsControlArn?: string;
        remediation?: Remediation;
        ProductName?: string;
        Resources?: Resource[];
    }[]>;
    awsSecurityFindingToSecurityHubFinding(finding: AwsSecurityFinding): SecurityHubFinding;
}
