import { Remediation, AwsSecurityFinding } from '@aws-sdk/client-securityhub';
import { SecurityHubJiraSyncConfig } from '../macfc-security-hub-sync';
export interface Resource {
    Type: string | undefined;
    /**
     * @public
     * <p>The canonical identifier for the given resource type.</p>
     */
    Id: string | undefined;
    /**
     * @public
     * <p>The canonical Amazon Web Services partition name that the Region is assigned to.</p>
     */
    Partition?: string;
    Region?: string;
    link?: string;
}
export interface SecurityHubFinding {
    id?: string;
    Ids?: string[];
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
    Type?: string;
    CompanyName?: string;
    ProviderName?: string;
    ProviderVersion?: string;
    consolidated?: boolean;
    CVE?: string;
    [key: string]: string | unknown;
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
    private querySecurityHubFindings;
    private buildActiveFindingsFilters;
    private buildSkipProductsFilter;
    private fetchPaginatedFindings;
    getAllActiveFindings(): Promise<SecurityHubFinding[]>;
    awsSecurityFindingToSecurityHubFinding(finding: AwsSecurityFinding): SecurityHubFinding;
}
