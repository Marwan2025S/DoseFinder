const { getPool } = require('../config/db');

const DEFAULT_DRUG_FLAGS = {
    visibility: 'visible',
    reviewStatus: 'published',
    adminNotes: null,
    updatedByUserId: null,
    updatedAt: null,
    createdAt: null
};

const PREVIEW_LIMIT = 5;

const ACTIVE_VISIBLE_DRUG_FILTER = `
    dv.is_current = 1
    AND COALESCE(dv.is_deleted, 0) = 0
    AND COALESCE(adf.visibility, 'visible') <> 'hidden'
`;

const DRUG_SELECT = `
    SELECT
        dv.version_id,
        dv.drug_id,
        dv.version_number,
        dv.updated_at,
        dv.is_current,
        dm.generic_name,
        dm.brand_names,
        dm.source,
        dm.doctor_id,
        adf.visibility,
        adf.review_status,
        adf.admin_notes,
        adf.updated_by_user_id,
        adf.created_at AS flag_created_at,
        adf.updated_at AS flag_updated_at,
        doctor.username AS doctor_username
    FROM drug_versions dv
    INNER JOIN drug_master dm ON dm.version_id = dv.version_id
    LEFT JOIN admin_drug_flags adf ON adf.drug_id = dv.drug_id
    LEFT JOIN users doctor ON doctor.id = dm.doctor_id
`;

const buildUserSummary = (id, username) => {
    if (!id) return null;
    return {
        id,
        username: username || ''
    };
};

const toFlagPayload = (row = {}) => ({
    visibility: row.visibility || DEFAULT_DRUG_FLAGS.visibility,
    reviewStatus: row.review_status || DEFAULT_DRUG_FLAGS.reviewStatus,
    adminNotes: row.admin_notes ?? DEFAULT_DRUG_FLAGS.adminNotes,
    updatedByUserId: row.updated_by_user_id ?? DEFAULT_DRUG_FLAGS.updatedByUserId,
    updatedAt: row.flag_updated_at ?? DEFAULT_DRUG_FLAGS.updatedAt,
    createdAt: row.flag_created_at ?? DEFAULT_DRUG_FLAGS.createdAt
});

const toDrugPayload = (row) => {
    const doctor = buildUserSummary(row.doctor_id, row.doctor_username);

    return {
        id: row.drug_id,
        drug_id: row.drug_id,
        version_id: row.version_id,
        version_number: row.version_number,
        updated_at: row.updated_at,
        is_current: row.is_current,
        generic_name: row.generic_name,
        brand_names: row.brand_names,
        source: row.source,
        doctor_id: row.doctor_id,
        assignedDoctor: doctor,
        assigned_doctor: doctor,
        latestVersionDoctor: doctor,
        adminFlags: toFlagPayload(row)
    };
};

const toIssuePayload = (row) => ({
    id: row.id,
    drugId: row.drug_id,
    drugName: row.drug_name_snapshot,
    reportedVersionNumber: row.reported_version_number,
    currentVersionNumber: row.current_version_number,
    partKey: row.part_key,
    partLabel: row.part_label,
    message: row.message,
    status: row.status,
    reporter: buildUserSummary(row.reporter_user_id, row.reporter_username),
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

class DashboardModel {
    static async getDoctorSummary() {
        const pool = getPool();

        const [
            drugMetricRows,
            issueMetricRows,
            openIssueRows,
            needsReviewRows,
            recentDrugRows
        ] = await Promise.all([
            pool.execute(
                `
                    SELECT
                        COUNT(*) AS visible_drugs,
                        SUM(CASE WHEN COALESCE(adf.review_status, 'published') = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_drugs,
                        SUM(CASE WHEN dv.updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS updated_this_week
                    FROM drug_versions dv
                    INNER JOIN drug_master dm ON dm.version_id = dv.version_id
                    LEFT JOIN admin_drug_flags adf ON adf.drug_id = dv.drug_id
                    WHERE ${ACTIVE_VISIBLE_DRUG_FILTER}
                `
            ),
            pool.execute(
                `
                    SELECT COUNT(*) AS open_issues
                    FROM drug_issues di
                    INNER JOIN drug_versions dv
                        ON dv.drug_id = di.drug_id
                        AND dv.is_current = 1
                        AND COALESCE(dv.is_deleted, 0) = 0
                    LEFT JOIN admin_drug_flags adf ON adf.drug_id = di.drug_id
                    WHERE di.status = 'open'
                      AND COALESCE(adf.visibility, 'visible') <> 'hidden'
                `
            ),
            pool.query(
                `
                    SELECT
                        di.id,
                        di.drug_id,
                        di.drug_name_snapshot,
                        di.reported_version_number,
                        dv.version_number AS current_version_number,
                        di.reporter_user_id,
                        di.part_key,
                        di.part_label,
                        di.message,
                        di.status,
                        di.created_at,
                        di.updated_at,
                        reporter.username AS reporter_username
                    FROM drug_issues di
                    INNER JOIN users reporter ON reporter.id = di.reporter_user_id
                    INNER JOIN drug_versions dv
                        ON dv.drug_id = di.drug_id
                        AND dv.is_current = 1
                        AND COALESCE(dv.is_deleted, 0) = 0
                    LEFT JOIN admin_drug_flags adf ON adf.drug_id = di.drug_id
                    WHERE di.status = 'open'
                      AND COALESCE(adf.visibility, 'visible') <> 'hidden'
                    ORDER BY di.created_at DESC, di.id DESC
                    LIMIT ${PREVIEW_LIMIT}
                `
            ),
            pool.query(
                `
                    ${DRUG_SELECT}
                    WHERE ${ACTIVE_VISIBLE_DRUG_FILTER}
                      AND COALESCE(adf.review_status, 'published') = 'needs_review'
                    ORDER BY adf.updated_at DESC, dv.updated_at DESC, dv.drug_id DESC
                    LIMIT ${PREVIEW_LIMIT}
                `
            ),
            pool.query(
                `
                    ${DRUG_SELECT}
                    WHERE ${ACTIVE_VISIBLE_DRUG_FILTER}
                    ORDER BY dv.updated_at DESC, dv.drug_id DESC
                    LIMIT ${PREVIEW_LIMIT}
                `
            )
        ]);

        const drugMetrics = drugMetricRows[0][0] || {};
        const issueMetrics = issueMetricRows[0][0] || {};

        return {
            metrics: {
                openIssues: Number(issueMetrics.open_issues || 0),
                needsReviewDrugs: Number(drugMetrics.needs_review_drugs || 0),
                visibleDrugs: Number(drugMetrics.visible_drugs || 0),
                updatedThisWeek: Number(drugMetrics.updated_this_week || 0)
            },
            openIssues: openIssueRows[0].map(toIssuePayload),
            needsReviewDrugs: needsReviewRows[0].map(toDrugPayload),
            recentDrugs: recentDrugRows[0].map(toDrugPayload),
            generatedAt: new Date().toISOString()
        };
    }
}

module.exports = DashboardModel;
