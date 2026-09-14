const { getPool } = require('../config/db');

const DEFAULT_DRUG_FLAGS = {
    visibility: 'visible',
    reviewStatus: 'published',
    adminNotes: null,
    updatedByUserId: null,
    updatedAt: null,
    createdAt: null
};

const parsePositiveInt = (value, fallback = null) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPagination = ({ page, perPage, defaultPerPage = 25, maxPerPage = 100 } = {}) => {
    const safePage = parsePositiveInt(page, 1);
    const safePerPage = Math.min(parsePositiveInt(perPage, defaultPerPage), maxPerPage);
    return {
        page: safePage,
        perPage: safePerPage,
        offset: (safePage - 1) * safePerPage
    };
};

const trimToNull = (value) => {
    const text = String(value ?? '').trim();
    return text || null;
};

const toUserPayload = (row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    email: row.email,
    role: row.role,
    accountStatus: row.account_status || 'active',
    emailVerified: Boolean(row.is_email_verified),
    verifiedDoctor: Boolean(row.verified_doctor),
    suspendedAt: row.suspended_at,
    suspendedByUserId: row.suspended_by_user_id,
    suspendedByUsername: row.suspended_by_username,
    suspensionReason: row.suspension_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    doctorCreatedAt: row.doctor_created_at,
    doctorUpdatedAt: row.doctor_updated_at
});

const toDoctorPayload = (row) => ({
    ...toUserPayload(row),
    authoredVersionCount: Number(row.authored_version_count || 0),
    resolvedIssueCount: Number(row.resolved_issue_count || 0),
    openIssueCount: Number(row.open_issue_count || 0)
});

const toFlagPayload = (row = {}) => ({
    visibility: row.visibility || DEFAULT_DRUG_FLAGS.visibility,
    reviewStatus: row.review_status || row.reviewStatus || DEFAULT_DRUG_FLAGS.reviewStatus,
    adminNotes: row.admin_notes ?? row.adminNotes ?? DEFAULT_DRUG_FLAGS.adminNotes,
    updatedByUserId: row.updated_by_user_id ?? row.updatedByUserId ?? DEFAULT_DRUG_FLAGS.updatedByUserId,
    updatedAt: row.updated_at ?? row.updatedAt ?? DEFAULT_DRUG_FLAGS.updatedAt,
    createdAt: row.created_at ?? row.createdAt ?? DEFAULT_DRUG_FLAGS.createdAt
});

const toAuditPayload = (row) => {
    let metadata = null;
    if (row.metadata_json) {
        try {
            metadata = typeof row.metadata_json === 'string'
                ? JSON.parse(row.metadata_json)
                : row.metadata_json;
        } catch {
            metadata = row.metadata_json;
        }
    }

    return {
        id: row.id,
        actorUserId: row.actor_user_id,
        actorUsername: row.actor_username,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        reason: row.reason,
        metadata,
        createdAt: row.created_at
    };
};

class AdminModel {
    static getPagination(options = {}) {
        return buildPagination(options);
    }

    static toUserPayload(row) {
        return toUserPayload(row);
    }

    static toDoctorPayload(row) {
        return toDoctorPayload(row);
    }

    static toFlagPayload(row) {
        return toFlagPayload(row);
    }

    static async recordAuditEvent({ actorUserId, action, entityType, entityId, reason = null, metadata = null }, executor = null) {
        const db = executor ?? getPool();
        const safeReason = trimToNull(reason);
        const metadataJson = metadata === null || metadata === undefined ? null : JSON.stringify(metadata);

        await db.execute(
            `
                INSERT INTO admin_audit_events (
                    actor_user_id,
                    action,
                    entity_type,
                    entity_id,
                    reason,
                    metadata_json
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            [
                actorUserId || null,
                action,
                entityType,
                String(entityId),
                safeReason,
                metadataJson
            ]
        );
    }

    static async listUsers(filters = {}) {
        const { page, perPage, offset } = buildPagination({
            page: filters.page,
            perPage: filters.perPage
        });
        const where = [];
        const params = [];

        if (trimToNull(filters.q)) {
            const pattern = `%${filters.q.trim()}%`;
            where.push('(u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)');
            params.push(pattern, pattern, pattern);
        }

        if (['guest', 'user', 'doctor', 'admin'].includes(filters.role)) {
            where.push('u.role = ?');
            params.push(filters.role);
        }

        if (['active', 'suspended'].includes(filters.accountStatus)) {
            where.push('COALESCE(u.account_status, "active") = ?');
            params.push(filters.accountStatus);
        }

        if (['verified', 'unverified'].includes(filters.emailStatus)) {
            where.push('u.is_email_verified = ?');
            params.push(filters.emailStatus === 'verified');
        }

        if (trimToNull(filters.createdFrom)) {
            where.push('u.created_at >= ?');
            params.push(filters.createdFrom);
        }

        if (trimToNull(filters.createdTo)) {
            where.push('u.created_at <= ?');
            params.push(filters.createdTo);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const pool = getPool();
        const [rows] = await pool.query(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    COALESCE(u.account_status, 'active') AS account_status,
                    u.suspended_at,
                    u.suspended_by_user_id,
                    u.suspension_reason,
                    u.is_email_verified,
                    u.created_at,
                    u.updated_at,
                    d.verified_doctor,
                    d.created_at AS doctor_created_at,
                    d.updated_at AS doctor_updated_at,
                    suspended_by.username AS suspended_by_username
                FROM users u
                LEFT JOIN doctors d ON d.user_id = u.id
                LEFT JOIN users suspended_by ON suspended_by.id = u.suspended_by_user_id
                ${whereClause}
                ORDER BY u.created_at DESC, u.id DESC
                LIMIT ? OFFSET ?
            `,
            [...params, perPage, offset]
        );

        const [countRows] = await pool.execute(
            `
                SELECT COUNT(*) AS total
                FROM users u
                LEFT JOIN doctors d ON d.user_id = u.id
                ${whereClause}
            `,
            params
        );

        return {
            users: rows.map(toUserPayload),
            total: Number(countRows[0]?.total || 0),
            page,
            perPage
        };
    }

    static async getUserDetail(userId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    COALESCE(u.account_status, 'active') AS account_status,
                    u.suspended_at,
                    u.suspended_by_user_id,
                    u.suspension_reason,
                    u.is_email_verified,
                    u.created_at,
                    u.updated_at,
                    d.verified_doctor,
                    d.created_at AS doctor_created_at,
                    d.updated_at AS doctor_updated_at,
                    suspended_by.username AS suspended_by_username,
                    (
                        SELECT COUNT(*)
                        FROM saved_drugs sd
                        INNER JOIN drug_versions dv ON dv.drug_id = sd.drug_id
                            AND dv.is_current = 1
                            AND COALESCE(dv.is_deleted, 0) = 0
                        WHERE sd.user_id = u.id
                    ) AS saved_drug_count,
                    (SELECT COUNT(*) FROM drug_search_history sh WHERE sh.user_id = u.id) AS search_count,
                    (
                        SELECT COUNT(*)
                        FROM drug_issues di
                        INNER JOIN drug_versions dv ON dv.drug_id = di.drug_id
                            AND dv.is_current = 1
                            AND COALESCE(dv.is_deleted, 0) = 0
                        WHERE di.reporter_user_id = u.id
                    ) AS reported_issue_count,
                    (
                        SELECT COUNT(*)
                        FROM drug_issues di
                        INNER JOIN drug_versions dv ON dv.drug_id = di.drug_id
                            AND dv.is_current = 1
                            AND COALESCE(dv.is_deleted, 0) = 0
                        WHERE di.resolved_by_user_id = u.id
                    ) AS resolved_issue_count,
                    (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS conversation_count,
                    (
                        SELECT COUNT(*)
                        FROM auth_sessions s
                        WHERE s.user_id = u.id
                          AND s.revoked_at IS NULL
                          AND s.expires_at > CURRENT_TIMESTAMP
                    ) AS active_session_count,
                    (SELECT MAX(le.created_at) FROM login_events le WHERE le.user_id = u.id) AS last_login_at
                FROM users u
                LEFT JOIN doctors d ON d.user_id = u.id
                LEFT JOIN users suspended_by ON suspended_by.id = u.suspended_by_user_id
                WHERE u.id = ?
                LIMIT 1
            `,
            [userId]
        );

        const row = rows[0];
        if (!row) {
            return null;
        }

        return {
            ...toUserPayload(row),
            stats: {
                savedDrugCount: Number(row.saved_drug_count || 0),
                searchCount: Number(row.search_count || 0),
                reportedIssueCount: Number(row.reported_issue_count || 0),
                resolvedIssueCount: Number(row.resolved_issue_count || 0),
                conversationCount: Number(row.conversation_count || 0),
                activeSessionCount: Number(row.active_session_count || 0),
                lastLoginAt: row.last_login_at
            }
        };
    }

    static async countActiveAdmins() {
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT COUNT(*) AS total
                FROM users
                WHERE role = 'admin'
                  AND COALESCE(account_status, 'active') = 'active'
            `
        );
        return Number(rows[0]?.total || 0);
    }

    static async setUserAccountStatus({ userId, accountStatus, actorUserId, reason }) {
        const pool = getPool();
        const connection = await pool.getConnection();
        const safeReason = trimToNull(reason);

        try {
            await connection.beginTransaction();

            const [beforeRows] = await connection.execute(
                `
                    SELECT id, username, role, COALESCE(account_status, 'active') AS account_status
                    FROM users
                    WHERE id = ?
                    LIMIT 1
                `,
                [userId]
            );
            const before = beforeRows[0] || null;
            if (!before) {
                await connection.rollback();
                return null;
            }

            if (accountStatus === 'suspended') {
                await connection.execute(
                    `
                        UPDATE users
                        SET
                            account_status = 'suspended',
                            suspended_at = CURRENT_TIMESTAMP,
                            suspended_by_user_id = ?,
                            suspension_reason = ?
                        WHERE id = ?
                    `,
                    [actorUserId, safeReason, userId]
                );
            } else {
                await connection.execute(
                    `
                        UPDATE users
                        SET
                            account_status = 'active',
                            suspended_at = NULL,
                            suspended_by_user_id = NULL,
                            suspension_reason = NULL
                        WHERE id = ?
                    `,
                    [userId]
                );
            }

            await this.recordAuditEvent({
                actorUserId,
                action: accountStatus === 'suspended' ? 'user.suspend' : 'user.reactivate',
                entityType: 'user',
                entityId: userId,
                reason: safeReason,
                metadata: {
                    username: before.username,
                    role: before.role,
                    previousAccountStatus: before.account_status,
                    nextAccountStatus: accountStatus
                }
            }, connection);

            await connection.commit();
            return this.getUserDetail(userId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async listDoctors(filters = {}) {
        const { page, perPage, offset } = buildPagination({
            page: filters.page,
            perPage: filters.perPage
        });
        const where = ['u.role = "doctor"'];
        const params = [];

        if (trimToNull(filters.q)) {
            const pattern = `%${filters.q.trim()}%`;
            where.push('(u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?)');
            params.push(pattern, pattern, pattern);
        }

        if (filters.verificationStatus === 'approved') {
            where.push('d.verified_doctor = TRUE');
        } else if (filters.verificationStatus === 'pending') {
            where.push('d.verified_doctor = FALSE');
        }

        if (['active', 'suspended'].includes(filters.accountStatus)) {
            where.push('COALESCE(u.account_status, "active") = ?');
            params.push(filters.accountStatus);
        }

        const whereClause = `WHERE ${where.join(' AND ')}`;
        const pool = getPool();
        const [rows] = await pool.query(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    COALESCE(u.account_status, 'active') AS account_status,
                    u.suspended_at,
                    u.suspended_by_user_id,
                    u.suspension_reason,
                    u.is_email_verified,
                    u.created_at,
                    u.updated_at,
                    d.verified_doctor,
                    d.created_at AS doctor_created_at,
                    d.updated_at AS doctor_updated_at,
                    suspended_by.username AS suspended_by_username,
                    (
                        SELECT COUNT(*)
                        FROM drug_master dm
                        INNER JOIN drug_versions dv ON dv.version_id = dm.version_id
                        WHERE dm.doctor_id = u.id
                          AND COALESCE(dv.is_deleted, 0) = 0
                    ) AS authored_version_count,
                    (
                        SELECT COUNT(*)
                        FROM drug_issues di
                        INNER JOIN drug_versions dv ON dv.drug_id = di.drug_id
                            AND dv.is_current = 1
                            AND COALESCE(dv.is_deleted, 0) = 0
                        WHERE di.resolved_by_user_id = u.id
                    ) AS resolved_issue_count,
                    (
                        SELECT COUNT(*)
                        FROM drug_issues di
                        INNER JOIN drug_versions dv ON dv.drug_id = di.drug_id
                            AND dv.is_current = 1
                            AND COALESCE(dv.is_deleted, 0) = 0
                        WHERE di.status = 'open'
                    ) AS open_issue_count
                FROM users u
                INNER JOIN doctors d ON d.user_id = u.id
                LEFT JOIN users suspended_by ON suspended_by.id = u.suspended_by_user_id
                ${whereClause}
                ORDER BY d.verified_doctor ASC, u.created_at DESC, u.id DESC
                LIMIT ? OFFSET ?
            `,
            [...params, perPage, offset]
        );

        const [countRows] = await pool.execute(
            `
                SELECT COUNT(*) AS total
                FROM users u
                INNER JOIN doctors d ON d.user_id = u.id
                ${whereClause}
            `,
            params
        );

        return {
            doctors: rows.map(toDoctorPayload),
            total: Number(countRows[0]?.total || 0),
            page,
            perPage
        };
    }

    static async getDoctorDetail(userId) {
        const detail = await this.getUserDetail(userId);
        if (!detail || detail.role !== 'doctor') {
            return null;
        }

        const pool = getPool();
        const [activityRows] = await pool.execute(
            `
                SELECT
                    (
                        SELECT COUNT(*)
                        FROM drug_master dm
                        INNER JOIN drug_versions dv ON dv.version_id = dm.version_id
                        WHERE dm.doctor_id = ?
                          AND COALESCE(dv.is_deleted, 0) = 0
                    ) AS authored_version_count,
                    (
                        SELECT COUNT(*)
                        FROM drug_issues di
                        INNER JOIN drug_versions dv ON dv.drug_id = di.drug_id
                            AND dv.is_current = 1
                            AND COALESCE(dv.is_deleted, 0) = 0
                        WHERE di.resolved_by_user_id = ?
                    ) AS resolved_issue_count
            `,
            [userId, userId]
        );
        const [versionRows] = await pool.execute(
            `
                SELECT
                    dv.drug_id,
                    dv.version_number,
                    dv.updated_at,
                    dv.is_current,
                    dm.generic_name,
                    dm.brand_names
                FROM drug_master dm
                INNER JOIN drug_versions dv ON dv.version_id = dm.version_id
                WHERE dm.doctor_id = ?
                  AND COALESCE(dv.is_deleted, 0) = 0
                ORDER BY dv.updated_at DESC
                LIMIT 10
            `,
            [userId]
        );

        return {
            ...detail,
            activity: {
                authoredVersionCount: Number(activityRows[0]?.authored_version_count || 0),
                resolvedIssueCount: Number(activityRows[0]?.resolved_issue_count || 0),
                recentDrugVersions: versionRows
            }
        };
    }

    static async getDrugFlagsMap(drugIds = []) {
        const uniqueIds = Array.from(new Set(
            drugIds
                .map((id) => parsePositiveInt(id))
                .filter(Boolean)
        ));
        if (!uniqueIds.length) {
            return new Map();
        }

        const placeholders = uniqueIds.map(() => '?').join(', ');
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    drug_id,
                    visibility,
                    review_status,
                    admin_notes,
                    updated_by_user_id,
                    created_at,
                    updated_at
                FROM admin_drug_flags
                WHERE drug_id IN (${placeholders})
            `,
            uniqueIds
        );

        const flags = new Map(uniqueIds.map((drugId) => [drugId, { drugId, ...DEFAULT_DRUG_FLAGS }]));
        rows.forEach((row) => {
            flags.set(Number(row.drug_id), {
                drugId: Number(row.drug_id),
                ...toFlagPayload(row)
            });
        });
        return flags;
    }

    static async getDrugFlag(drugId) {
        const flags = await this.getDrugFlagsMap([drugId]);
        return flags.get(Number(drugId)) || { drugId, ...DEFAULT_DRUG_FLAGS };
    }

    static async setDrugFlags({ drugId, visibility, reviewStatus, adminNotes, actorUserId, reason }) {
        const pool = getPool();
        const connection = await pool.getConnection();
        const safeReason = trimToNull(reason);
        const normalizedVisibility = visibility === 'hidden' ? 'hidden' : 'visible';
        const normalizedReviewStatus = reviewStatus === 'needs_review' ? 'needs_review' : 'published';
        const safeNotes = trimToNull(adminNotes);

        try {
            await connection.beginTransaction();
            const before = await this.getDrugFlag(drugId);

            await connection.execute(
                `
                    INSERT INTO admin_drug_flags (
                        drug_id,
                        visibility,
                        review_status,
                        admin_notes,
                        updated_by_user_id
                    )
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        visibility = VALUES(visibility),
                        review_status = VALUES(review_status),
                        admin_notes = VALUES(admin_notes),
                        updated_by_user_id = VALUES(updated_by_user_id)
                `,
                [drugId, normalizedVisibility, normalizedReviewStatus, safeNotes, actorUserId]
            );

            await this.recordAuditEvent({
                actorUserId,
                action: 'drug.flags.update',
                entityType: 'drug',
                entityId: drugId,
                reason: safeReason,
                metadata: {
                    previousFlags: before,
                    nextFlags: {
                        visibility: normalizedVisibility,
                        reviewStatus: normalizedReviewStatus,
                        adminNotes: safeNotes
                    }
                }
            }, connection);

            await connection.commit();
            return this.getDrugFlag(drugId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async listDrugIssues(drugId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    di.id,
                    di.drug_id,
                    di.drug_name_snapshot,
                    di.reported_version_number,
                    di.part_label,
                    di.message,
                    di.status,
                    di.created_at,
                    di.updated_at,
                    di.resolved_at,
                    reporter.username AS reporter_username,
                    resolver.username AS resolved_by_username
                FROM drug_issues di
                INNER JOIN users reporter ON reporter.id = di.reporter_user_id
                LEFT JOIN users resolver ON resolver.id = di.resolved_by_user_id
                WHERE di.drug_id = ?
                ORDER BY FIELD(di.status, 'open', 'fixed', 'closed'), di.created_at DESC
                LIMIT 20
            `,
            [drugId]
        );
        return rows;
    }

    static async getSummary() {
        const pool = getPool();
        const [userRows] = await pool.execute(
            `
                SELECT role, COALESCE(account_status, 'active') AS account_status, COUNT(*) AS total
                FROM users
                GROUP BY role, COALESCE(account_status, 'active')
            `
        );
        const [doctorRows] = await pool.execute(
            `
                SELECT d.verified_doctor, COUNT(*) AS total
                FROM doctors d
                INNER JOIN users u ON u.id = d.user_id
                WHERE COALESCE(u.account_status, 'active') = 'active'
                GROUP BY d.verified_doctor
            `
        );
        const [issueRows] = await pool.execute(
            `
                SELECT di.status, COUNT(*) AS total
                FROM drug_issues di
                INNER JOIN drug_versions dv ON dv.drug_id = di.drug_id
                    AND dv.is_current = 1
                    AND COALESCE(dv.is_deleted, 0) = 0
                GROUP BY di.status
            `
        );
        const [flagRows] = await pool.execute(
            `
                SELECT
                    SUM(admin_drug_flags.visibility = 'hidden') AS hidden_drugs,
                    SUM(admin_drug_flags.review_status = 'needs_review') AS review_drugs
                FROM admin_drug_flags
                INNER JOIN drug_versions dv ON dv.drug_id = admin_drug_flags.drug_id
                    AND dv.is_current = 1
                    AND COALESCE(dv.is_deleted, 0) = 0
            `
        );
        const recentAudit = await this.listAuditEvents({ page: 1, perPage: 8 });

        return {
            users: userRows.reduce((result, row) => {
                result.total += Number(row.total || 0);
                result.byRole[row.role] = (result.byRole[row.role] || 0) + Number(row.total || 0);
                result.byStatus[row.account_status] = (result.byStatus[row.account_status] || 0) + Number(row.total || 0);
                return result;
            }, { total: 0, byRole: {}, byStatus: {} }),
            doctors: doctorRows.reduce((result, row) => {
                if (row.verified_doctor) {
                    result.approved += Number(row.total || 0);
                } else {
                    result.pending += Number(row.total || 0);
                }
                result.total += Number(row.total || 0);
                return result;
            }, { total: 0, approved: 0, pending: 0 }),
            issues: issueRows.reduce((result, row) => {
                result.total += Number(row.total || 0);
                result.byStatus[row.status] = Number(row.total || 0);
                return result;
            }, { total: 0, byStatus: {} }),
            drugs: {
                hidden: Number(flagRows[0]?.hidden_drugs || 0),
                needsReview: Number(flagRows[0]?.review_drugs || 0)
            },
            recentAudit: recentAudit.events
        };
    }

    static async listAuditEvents(filters = {}) {
        const { page, perPage, offset } = buildPagination({
            page: filters.page,
            perPage: filters.perPage,
            defaultPerPage: 25
        });
        const where = [];
        const params = [];

        if (parsePositiveInt(filters.actorUserId)) {
            where.push('aae.actor_user_id = ?');
            params.push(parsePositiveInt(filters.actorUserId));
        }
        if (trimToNull(filters.entityType)) {
            where.push('aae.entity_type = ?');
            params.push(filters.entityType.trim());
        }
        if (trimToNull(filters.entityId)) {
            where.push('aae.entity_id = ?');
            params.push(filters.entityId.trim());
        }
        if (trimToNull(filters.action)) {
            where.push('aae.action LIKE ?');
            params.push(`%${filters.action.trim()}%`);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const pool = getPool();
        const [rows] = await pool.query(
            `
                SELECT
                    aae.id,
                    aae.actor_user_id,
                    actor.username AS actor_username,
                    aae.action,
                    aae.entity_type,
                    aae.entity_id,
                    aae.reason,
                    aae.metadata_json,
                    aae.created_at
                FROM admin_audit_events aae
                LEFT JOIN users actor ON actor.id = aae.actor_user_id
                ${whereClause}
                ORDER BY aae.created_at DESC, aae.id DESC
                LIMIT ? OFFSET ?
            `,
            [...params, perPage, offset]
        );
        const [countRows] = await pool.execute(
            `
                SELECT COUNT(*) AS total
                FROM admin_audit_events aae
                ${whereClause}
            `,
            params
        );

        return {
            events: rows.map(toAuditPayload),
            total: Number(countRows[0]?.total || 0),
            page,
            perPage
        };
    }
}

module.exports = AdminModel;
