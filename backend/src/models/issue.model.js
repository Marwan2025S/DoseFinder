const { getPool } = require('../config/db');

const ISSUE_SELECT = `
    SELECT
        di.id,
        di.drug_id,
        di.drug_name_snapshot,
        di.reported_version_number,
        di.reporter_user_id,
        di.part_key,
        di.part_label,
        di.message,
        di.status,
        di.doctor_reply_message,
        di.resolved_by_user_id,
        di.resolved_version_number,
        di.created_at,
        di.updated_at,
        di.resolved_at,
        reporter.username AS reporter_username,
        reporter.email AS reporter_email,
        resolver.username AS resolved_by_username,
        resolver.email AS resolved_by_email
    FROM drug_issues di
    INNER JOIN users reporter ON reporter.id = di.reporter_user_id
    LEFT JOIN users resolver ON resolver.id = di.resolved_by_user_id
`;

class IssueModel {
    static async createIssue({
        drugId,
        drugNameSnapshot,
        reportedVersionNumber,
        reporterUserId,
        partKey,
        partLabel,
        message
    }) {
        const pool = getPool();
        const [result] = await pool.execute(
            `
                INSERT INTO drug_issues (
                    drug_id,
                    drug_name_snapshot,
                    reported_version_number,
                    reporter_user_id,
                    part_key,
                    part_label,
                    message
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [drugId, drugNameSnapshot, reportedVersionNumber, reporterUserId, partKey, partLabel, message]
        );

        return this.findById(result.insertId);
    }

    static async findById(issueId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `${ISSUE_SELECT} WHERE di.id = ? LIMIT 1`,
            [issueId]
        );
        return rows[0] || null;
    }

    static async listUserIssuesByDrug(userId, drugId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `${ISSUE_SELECT} WHERE di.reporter_user_id = ? AND di.drug_id = ? ORDER BY di.created_at DESC, di.id DESC`,
            [userId, drugId]
        );
        return rows;
    }

    static async listIssues({ status, q, page = 1, perPage = 20, includeHidden = false }) {
        const pool = getPool();
        const filters = [];
        const params = [];

        if (!includeHidden) {
            filters.push("COALESCE(adf.visibility, 'visible') <> 'hidden'");
        }

        if (status) {
            filters.push('di.status = ?');
            params.push(status);
        }

        if (q?.trim()) {
            const searchPattern = `%${q.trim()}%`;
            filters.push(
                `(
                    di.drug_name_snapshot LIKE ?
                    OR di.part_label LIKE ?
                    OR di.message LIKE ?
                    OR reporter.username LIKE ?
                )`
            );
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
        const flagJoin = 'LEFT JOIN admin_drug_flags adf ON adf.drug_id = di.drug_id';
        const activeDrugJoin = `
            INNER JOIN drug_versions dv
                ON dv.drug_id = di.drug_id
                AND dv.is_current = 1
                AND COALESCE(dv.is_deleted, 0) = 0
        `;
        const safePage = Number.isInteger(page) && page > 0 ? page : 1;
        const safePerPage = Number.isInteger(perPage) && perPage > 0 ? perPage : 20;
        const offset = (safePage - 1) * safePerPage;

        // Use query instead of execute to avoid prepared statement type inference issues with LIMIT/OFFSET.
        const [rows] = await pool.query(
            `${ISSUE_SELECT} ${flagJoin} ${activeDrugJoin} ${whereClause} ORDER BY FIELD(di.status, 'open', 'fixed', 'closed'), di.created_at DESC, di.id DESC LIMIT ? OFFSET ?`,
            [...params, safePerPage, offset]
        );

        const [countRows] = await pool.execute(
            `
                SELECT COUNT(*) AS total
                FROM drug_issues di
                INNER JOIN users reporter ON reporter.id = di.reporter_user_id
                ${flagJoin}
                ${activeDrugJoin}
                ${whereClause}
            `,
            params
        );

        return {
            issues: rows,
            total: Number(countRows[0]?.total || 0),
            page: safePage,
            perPage: safePerPage
        };
    }

    static async closeIssue(issueId, resolvedByUserId, replyMessage = null) {
        const pool = getPool();
        const [result] = await pool.execute(
            `
                UPDATE drug_issues
                SET
                    status = 'closed',
                    doctor_reply_message = ?,
                    resolved_by_user_id = ?,
                    resolved_at = NOW()
                WHERE id = ? AND status = 'open'
            `,
            [replyMessage, resolvedByUserId, issueId]
        );

        if (!result.affectedRows) {
            return null;
        }

        return this.findById(issueId);
    }

    static async fixIssue(issueId, resolvedByUserId, resolvedVersionNumber) {
        const pool = getPool();
        const [result] = await pool.execute(
            `
                UPDATE drug_issues
                SET
                    status = 'fixed',
                    resolved_by_user_id = ?,
                    resolved_version_number = ?,
                    resolved_at = NOW()
                WHERE id = ? AND status = 'open'
            `,
            [resolvedByUserId, resolvedVersionNumber, issueId]
        );

        if (!result.affectedRows) {
            return null;
        }

        return this.findById(issueId);
    }
}

module.exports = IssueModel;
