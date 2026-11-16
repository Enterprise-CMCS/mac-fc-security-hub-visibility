-- MACFin: Snyk Enterprise / AWS Security Hub overlap investigation
-- Saved 2026-11-03. Read-only: run each numbered SELECT separately in Snowsight.
-- Objects: BUS_CMCS.PUBLIC. MACFin FISMA ID:
--   81462f1adb1877009b3772840f961965
-- To analyze another team, replace that ID in every query below.
-- Use your authorized role/warehouse. No role or warehouse changes are executed.
-- These queries include all statuses/dates exposed by each view; no open-only filter.
-- Counts are role-dependent and reflect the view contents at execution time.
-- Shared CVEs alone are NOT confirmed duplicate findings: compare asset,
-- package/version, environment, status and scan context before deduplicating.

-- 1. Record execution context alongside results for later reporting.
SELECT CURRENT_TIMESTAMP() AS CHECKED_AT,
       CURRENT_ACCOUNT() AS ACCOUNT_NAME, CURRENT_ROLE() AS ROLE_NAME,
       CURRENT_WAREHOUSE() AS WAREHOUSE_NAME;

-- 2. Inspect source schemas if fields change.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BUS_CMCS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'PUBLIC'
  AND TABLE_NAME IN ('SEC_VW_SNYK_ALL_CURRENT', 'SEC_VW_AWS_SECURITYHUB_ALL',
                     'SEC_VW_OIT_AWS_SECURITYHUB_GOVCLOUD')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 3. MACFin source inventory. Distinct problem IDs are not distinct asset findings.
SELECT 'SNYK' AS SOURCE, COUNT(*) AS ROWS_N,
       COUNT(DISTINCT PROBLEM_ID) AS DISTINCT_PROBLEM_OR_FINDING_IDS
FROM BUS_CMCS.PUBLIC.SEC_VW_SNYK_ALL_CURRENT
WHERE FISMA_ID = '81462f1adb1877009b3772840f961965'
UNION ALL
SELECT 'AWS:' || COALESCE(PRODUCTNAME, 'NULL') || ':' || COALESCE(COMPANYNAME, 'NULL'),
       COUNT(*), COUNT(DISTINCT ID)
FROM BUS_CMCS.PUBLIC.SEC_VW_AWS_SECURITYHUB_ALL
WHERE FISMA_ID = '81462f1adb1877009b3772840f961965'
GROUP BY PRODUCTNAME, COMPANYNAME;

-- 4. Identify custom scanners and records with recognizable Snyk metadata.
SELECT GENERATORID, COUNT(*) AS ROWS_N, COUNT(DISTINCT ID) AS DISTINCT_IDS,
       MIN(TITLE) AS EXAMPLE_TITLE
FROM BUS_CMCS.PUBLIC.SEC_VW_AWS_SECURITYHUB_ALL
WHERE FISMA_ID = '81462f1adb1877009b3772840f961965'
  AND (PRODUCTNAME = 'Default'
       OR TO_JSON(PRODUCTFIELDS) ILIKE '%snyk%' OR TITLE ILIKE '%snyk%')
GROUP BY GENERATORID
ORDER BY ROWS_N DESC;

-- 5. Cross-source identifiers and broad CVE overlap.
-- CVEs are extracted from ALL AWS record content, including descriptions and
-- references. Thus these are shared CVE mentions, not confirmed duplicate counts.
-- Exact IDs may differ across ingestion paths even for the same underlying issue.
WITH s AS (
    SELECT * FROM BUS_CMCS.PUBLIC.SEC_VW_SNYK_ALL_CURRENT
    WHERE FISMA_ID = '81462f1adb1877009b3772840f961965'
), a AS (
    SELECT *, TO_JSON(OBJECT_CONSTRUCT_KEEP_NULL(*)) AS RAW
    FROM BUS_CMCS.PUBLIC.SEC_VW_AWS_SECURITYHUB_ALL
    WHERE FISMA_ID = '81462f1adb1877009b3772840f961965'
), sc AS (
    SELECT DISTINCT UPPER(f.VALUE::STRING) AS CVE
    FROM s, LATERAL FLATTEN(INPUT => s.CVE) f
), ac AS (
    SELECT DISTINCT a.ID, f.VALUE::STRING AS CVE
    FROM a, LATERAL FLATTEN(
        INPUT => REGEXP_SUBSTR_ALL(UPPER(a.RAW), 'CVE-[0-9]{4}-[0-9]+')) f
)
SELECT 'AWS rows mentioning Snyk anywhere' AS METRIC, COUNT(*) AS N
FROM a WHERE RAW ILIKE '%snyk%'
UNION ALL
SELECT 'Exact source ID matches', COUNT(*) FROM a
WHERE EXISTS (SELECT 1 FROM s WHERE s.ID = a.ID)
UNION ALL
SELECT 'AWS rows containing Snyk PROBLEM_ID', COUNT(*) FROM a
WHERE EXISTS (SELECT 1 FROM s WHERE LENGTH(s.PROBLEM_ID) > 5
              AND CONTAINS(a.RAW, s.PROBLEM_ID))
UNION ALL
SELECT 'Shared distinct CVE mentions (not confirmed duplicates)', COUNT(DISTINCT ac.CVE)
FROM ac JOIN sc ON ac.CVE = sc.CVE
UNION ALL
SELECT 'AWS IDs with shared CVE mentions', COUNT(DISTINCT ac.ID)
FROM ac JOIN sc ON ac.CVE = sc.CVE;

-- 6. Candidate detail samples: review resource/project/package context manually.
-- A CVE in an AWS description can be a reference to another vulnerability.
-- LIMIT 10 is a sample, not an exhaustive duplicate list.
WITH s AS (
    SELECT s.PROBLEM_ID, s.PROJECT_NAME, s.PACKAGE_NAME_AND_VERSION,
           f.VALUE::STRING AS CVE
    FROM BUS_CMCS.PUBLIC.SEC_VW_SNYK_ALL_CURRENT s,
         LATERAL FLATTEN(INPUT => s.CVE) f
    WHERE s.FISMA_ID = '81462f1adb1877009b3772840f961965'
), a AS (
    SELECT a.GENERATORID, a.ID, a.RESOURCE_ID, a.TITLE, f.VALUE::STRING AS CVE
    FROM BUS_CMCS.PUBLIC.SEC_VW_AWS_SECURITYHUB_ALL a,
         LATERAL FLATTEN(INPUT => REGEXP_SUBSTR_ALL(
             UPPER(a.ID || ' ' || a.TITLE || ' ' || a.DESCRIPTION),
             'CVE-[0-9]{4}-[0-9]+')) f
    WHERE a.FISMA_ID = '81462f1adb1877009b3772840f961965'
)
SELECT DISTINCT a.GENERATORID, a.CVE, a.TITLE, a.RESOURCE_ID,
       s.PROJECT_NAME, s.PACKAGE_NAME_AND_VERSION, s.PROBLEM_ID
FROM a JOIN s ON UPPER(s.CVE) = a.CVE
ORDER BY a.CVE
LIMIT 10;

-- 7. GovCloud view: total visibility, MACFin identity and Snyk mentions.
-- COALESCE makes empty-input COUNT_IF results display as zero rather than NULL.
-- Zero total rows means this role sees no rows; it does not prove AWS is empty.
WITH g AS (
    SELECT *, TO_JSON(OBJECT_CONSTRUCT_KEEP_NULL(*)) AS RAW
    FROM BUS_CMCS.PUBLIC.SEC_VW_OIT_AWS_SECURITYHUB_GOVCLOUD
)
SELECT COUNT(*) AS TOTAL_ROWS,
       COALESCE(COUNT_IF(FISMA_ID = '81462f1adb1877009b3772840f961965'), 0) AS MACFIN_ID_ROWS,
       COALESCE(COUNT_IF(UPPER(FISMA_ACRONYM) = 'MACFIN'), 0) AS MACFIN_ACRONYM_ROWS,
       COALESCE(COUNT_IF(FISMA_ID = '81462f1adb1877009b3772840f961965'
                        AND RAW ILIKE '%snyk%'), 0) AS MACFIN_SNYK_ROWS,
       COALESCE(COUNT_IF(RAW ILIKE '%snyk%'), 0) AS ALL_SNYK_MENTION_ROWS
FROM g;

-- Observed 2026-11-03 using TEAM_CMCS_ROLE / TEAM_CMCS_WH:
-- Snyk: 3,484 rows, 1,960 distinct PROBLEM_ID values.
-- Query 5: 0 Snyk mentions, 0 exact ID matches, 0 embedded problem-ID matches;
--          215 shared CVE mentions across 514 distinct AWS finding IDs.
-- Custom AWS scanner labels: jfrog-xray, KubeBench, Checkov.
-- GovCloud: 0 total visible rows.
-- Separate attempts to count CVE + service-name matches failed with Snowflake
-- internal error 370001:604124988. No service-level duplicate total was verified.
-- The core inventory/overlap/sample queries ran successfully in Chrome.
-- Context query, expanded schema list, and GovCloud zero-display COALESCE
-- are convenience additions in this saved file and have not been rerun live.
