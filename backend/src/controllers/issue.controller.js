const { LIMITS } = require('../config/constants');
const DrugService = require('../services/drug.service');
const IssueModel = require('../models/issue.model');
const logger = require('../utils/logger');
const { requireDrugAccess } = require('../utils/drugAccess');
const {
    ISSUE_STATUS,
    ISSUE_PART_LABELS,
    ISSUE_MESSAGE_MAX_LENGTH,
    ISSUE_REPLY_MAX_LENGTH
} = require('../constants/issue.constants');

const parsePositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const allowedStatuses = new Set(Object.values(ISSUE_STATUS));

const trimToNull = (value) => {
    const str = String(value ?? '').trim();
    return str || null;
};

const parseBrandNames = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item || '').trim()).filter(Boolean);
        }
        return [String(parsed || '').trim()].filter(Boolean);
    } catch {
        return raw.split(',').map((item) => item.trim()).filter(Boolean);
    }
};

const buildUserSummary = (id, username, email = null) => {
    if (!id) return null;
    return {
        id,
        username: username || '',
        email: email || null
    };
};

const toIssuePayload = (issueRow) => ({
    id: issueRow.id,
    drugId: issueRow.drug_id,
    drugName: issueRow.drug_name_snapshot,
    reportedVersionNumber: issueRow.reported_version_number,
    partKey: issueRow.part_key,
    partLabel: issueRow.part_label,
    message: issueRow.message,
    status: issueRow.status,
    reporter: buildUserSummary(issueRow.reporter_user_id, issueRow.reporter_username, issueRow.reporter_email),
    doctorReplyMessage: issueRow.doctor_reply_message,
    resolvedBy: buildUserSummary(issueRow.resolved_by_user_id, issueRow.resolved_by_username, issueRow.resolved_by_email),
    resolvedVersionNumber: issueRow.resolved_version_number,
    createdAt: issueRow.created_at,
    updatedAt: issueRow.updated_at,
    resolvedAt: issueRow.resolved_at
});

const getDrugDisplayName = (drug) => {
    const brandNames = parseBrandNames(drug?.brand_names);
    return (
        drug?.generic_name ||
        drug?.display_name ||
        drug?.name ||
        brandNames[0] ||
        drug?.['Generic Name'] ||
        'Unknown Drug'
    );
};

const ensureReportingUser = (req, res) => {
    if (req.user?.role === 'user') {
        return true;
    }

    res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'Only verified user accounts can report issues.'
    });
    return false;
};

class IssueController {
    static async createIssue(req, res) {
        logger.info(`[IssueController] createIssue request received for user ${req.user?.id}`);

        if (!ensureReportingUser(req, res)) {
            return;
        }

        try {
            const drugId = parsePositiveInt(req.body?.drugId);
            const partKey = trimToNull(req.body?.partKey);
            const message = trimToNull(req.body?.message);

            if (!drugId || !partKey || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'drugId, partKey, and message are required.'
                });
            }

            if (!ISSUE_PART_LABELS[partKey]) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid issue part.'
                });
            }

            if (message.length > Math.min(ISSUE_MESSAGE_MAX_LENGTH, LIMITS.MESSAGE_MAX_LENGTH)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: `Issue message must not exceed ${ISSUE_MESSAGE_MAX_LENGTH} characters.`
                });
            }

            await requireDrugAccess(drugId, req.user);
            const drug = await DrugService.getDrugById(drugId);
            if (!drug) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Drug not found.'
                });
            }

            const issue = await IssueModel.createIssue({
                drugId,
                drugNameSnapshot: getDrugDisplayName(drug),
                reportedVersionNumber: parsePositiveInt(drug?.version_number) || 1,
                reporterUserId: req.user.id,
                partKey,
                partLabel: ISSUE_PART_LABELS[partKey],
                message
            });

            return res.status(201).json({
                success: true,
                message: 'Issue reported successfully.',
                data: toIssuePayload(issue)
            });
        } catch (error) {
            logger.error('[IssueController] Error creating issue:', error);
            const status = error.status || 500;
            return res.status(status).json({
                success: false,
                error: status === 404 ? 'Not Found' : 'Failed to create issue',
                message: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    static async listMyIssues(req, res) {
        logger.info(`[IssueController] listMyIssues request received for user ${req.user?.id}`);

        if (!ensureReportingUser(req, res)) {
            return;
        }

        try {
            const drugId = parsePositiveInt(req.query?.drugId);
            if (!drugId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId is required.'
                });
            }

            await requireDrugAccess(drugId, req.user);
            const issues = await IssueModel.listUserIssuesByDrug(req.user.id, drugId);
            return res.status(200).json({
                success: true,
                data: issues.map(toIssuePayload)
            });
        } catch (error) {
            logger.error('[IssueController] Error listing user issues:', error);
            const status = error.status || 500;
            return res.status(status).json({
                success: false,
                error: status === 404 ? 'Not Found' : 'Failed to list issues',
                message: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    static async listIssues(req, res) {
        logger.info(`[IssueController] listIssues request received for user ${req.user?.id}`);

        try {
            const rawStatus = trimToNull(req.query?.status) || ISSUE_STATUS.OPEN;
            const status = rawStatus === 'all' ? null : rawStatus;
            const page = parsePositiveInt(req.query?.page) || 1;
            const perPage = Math.min(parsePositiveInt(req.query?.per_page) || LIMITS.PAGINATION_DEFAULT_LIMIT, LIMITS.PAGINATION_MAX_LIMIT);

            if (status && !allowedStatuses.has(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid issue status filter.'
                });
            }

            const result = await IssueModel.listIssues({
                status,
                q: req.query?.q || '',
                page,
                perPage,
                includeHidden: req.user?.role === 'admin'
            });

            return res.status(200).json({
                success: true,
                data: {
                    issues: result.issues.map(toIssuePayload),
                    total: result.total,
                    page: result.page,
                    perPage: result.perPage
                }
            });
        } catch (error) {
            logger.error('[IssueController] Error listing issues:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to list issues',
                message: error.message
            });
        }
    }

    static async getIssueById(req, res) {
        logger.info(`[IssueController] getIssueById request received for user ${req.user?.id}`);

        try {
            const issueId = parsePositiveInt(req.params?.issueId);
            if (!issueId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid issueId is required.'
                });
            }

            const issue = await IssueModel.findById(issueId);
            if (!issue) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Issue not found.'
                });
            }

            await requireDrugAccess(issue.drug_id, req.user);
            const currentDrug = await DrugService.getDrugById(issue.drug_id).catch(() => null);

            return res.status(200).json({
                success: true,
                data: {
                    ...toIssuePayload(issue),
                    currentDrug: currentDrug
                        ? {
                            id: issue.drug_id,
                            name: getDrugDisplayName(currentDrug),
                            versionNumber: parsePositiveInt(currentDrug?.version_number) || null
                        }
                        : {
                            id: issue.drug_id,
                            name: issue.drug_name_snapshot,
                            versionNumber: null
                        }
                }
            });
        } catch (error) {
            logger.error('[IssueController] Error fetching issue detail:', error);
            const status = error.status || 500;
            return res.status(status).json({
                success: false,
                error: status === 404 ? 'Not Found' : 'Failed to fetch issue detail',
                message: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    static async closeIssue(req, res) {
        logger.info(`[IssueController] closeIssue request received for user ${req.user?.id}`);

        try {
            const issueId = parsePositiveInt(req.params?.issueId);
            const replyMessage = trimToNull(req.body?.replyMessage);

            if (!issueId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid issueId is required.'
                });
            }

            if (replyMessage && replyMessage.length > ISSUE_REPLY_MAX_LENGTH) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: `Reply message must not exceed ${ISSUE_REPLY_MAX_LENGTH} characters.`
                });
            }

            const issue = await IssueModel.findById(issueId);
            if (!issue) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Issue not found.'
                });
            }

            if (issue.status !== ISSUE_STATUS.OPEN) {
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'Only open issues can be closed.'
                });
            }

            await requireDrugAccess(issue.drug_id, req.user);
            const updatedIssue = await IssueModel.closeIssue(issueId, req.user.id, replyMessage);
            return res.status(200).json({
                success: true,
                message: replyMessage ? 'Issue replied to and closed successfully.' : 'Issue closed successfully.',
                data: toIssuePayload(updatedIssue)
            });
        } catch (error) {
            logger.error('[IssueController] Error closing issue:', error);
            const status = error.status || 500;
            return res.status(status).json({
                success: false,
                error: status === 404 ? 'Not Found' : 'Failed to close issue',
                message: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    static async fixIssue(req, res) {
        logger.info(`[IssueController] fixIssue request received for user ${req.user?.id}`);

        try {
            const issueId = parsePositiveInt(req.params?.issueId);
            const resolvedVersionNumber = parsePositiveInt(req.body?.resolvedVersionNumber);

            if (!issueId || !resolvedVersionNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid issueId and resolvedVersionNumber are required.'
                });
            }

            const issue = await IssueModel.findById(issueId);
            if (!issue) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Issue not found.'
                });
            }

            if (issue.status !== ISSUE_STATUS.OPEN) {
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'Only open issues can be marked as fixed.'
                });
            }

            await requireDrugAccess(issue.drug_id, req.user);
            await DrugService.getDrugVersion(issue.drug_id, resolvedVersionNumber);

            const updatedIssue = await IssueModel.fixIssue(issueId, req.user.id, resolvedVersionNumber);
            return res.status(200).json({
                success: true,
                message: `Issue fixed and linked to version ${resolvedVersionNumber}.`,
                data: toIssuePayload(updatedIssue)
            });
        } catch (error) {
            logger.error('[IssueController] Error fixing issue:', error);
            const status = error.status || (/not found/i.test(error.message) ? 404 : 500);
            return res.status(status).json({
                success: false,
                error: status === 404 ? 'Not Found' : 'Failed to fix issue',
                message: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }
}

module.exports = IssueController;
