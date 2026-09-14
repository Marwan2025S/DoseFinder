const DrugService = require('../services/drug.service');
const EmailService = require('../services/email.service');
const logger = require('../utils/logger');
const UserModel = require('../models/user.model');
const AdminModel = require('../models/admin.model');
const { AUTH } = require('../config/constants');
const { generateNumericOtp, getOtpExpiryDate, hashOtp } = require('../utils/otp');
const {
    attachDoctorsToDrugSearchResults,
    attachDoctorsToVersions,
    collectDoctorLookup,
    normalizeVersionDoctorId,
    parsePositiveInt,
    toVersionDoctorPayload,
} = require('../utils/drugDoctorMeta');

const trimToNull = (value) => {
    const text = String(value ?? '').trim();
    return text || null;
};

const parsePagination = (query = {}, defaultPerPage = 25) => ({
    page: parsePositiveInt(query.page) || 1,
    perPage: Math.min(parsePositiveInt(query.per_page ?? query.perPage) || defaultPerPage, 100)
});

const isValidStatus = (value, allowed) => allowed.includes(String(value || '').trim());

const sendVerificationOtpForUser = async (userId, email) => {
    const verificationOtp = generateNumericOtp();
    const verificationOtpHash = hashOtp(verificationOtp);
    const verificationExpiry = getOtpExpiryDate(AUTH.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES);

    await UserModel.setEmailVerificationOtp(userId, verificationOtpHash, verificationExpiry);

    try {
        const sendResult = await EmailService.sendVerificationEmail(email, verificationOtp);
        return Boolean(sendResult.sent);
    } catch (sendError) {
        logger.error('[AdminController] Failed to send verification email', {
            userId,
            email,
            message: sendError.message
        });
        return false;
    }
};

const filterDrugResultsByFlags = (payload, flagsByDrugId, filters) => {
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const visibility = trimToNull(filters.visibility);
    const reviewStatus = trimToNull(filters.reviewStatus);

    if (!visibility && !reviewStatus) {
        return results;
    }

    return results.filter((drug) => {
        const flags = flagsByDrugId.get(Number(drug.drug_id)) || AdminModel.toFlagPayload();
        if (visibility && visibility !== 'all' && flags.visibility !== visibility) {
            return false;
        }
        if (reviewStatus && reviewStatus !== 'all' && flags.reviewStatus !== reviewStatus) {
            return false;
        }
        return true;
    });
};

class AdminController {
    static async getSummary(req, res) {
        try {
            const [summary, drugStats] = await Promise.all([
                AdminModel.getSummary(),
                DrugService.getStatistics().catch((error) => {
                    logger.warn('[AdminController] Failed to enrich summary with drug stats', {
                        message: error.message
                    });
                    return null;
                })
            ]);

            res.status(200).json({
                success: true,
                data: {
                    ...summary,
                    drugs: {
                        ...summary.drugs,
                        total: Number(drugStats?.total_drugs || 0),
                        totalVersions: Number(drugStats?.total_versions || 0)
                    }
                }
            });
        } catch (error) {
            logger.error('[AdminController] Error loading summary:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to load admin summary',
                message: error.message
            });
        }
    }

    static async listUsers(req, res) {
        try {
            const pagination = parsePagination(req.query);
            const payload = await AdminModel.listUsers({
                q: req.query.q,
                role: req.query.role,
                accountStatus: req.query.account_status ?? req.query.accountStatus,
                emailStatus: req.query.email_status ?? req.query.emailStatus,
                createdFrom: req.query.created_from ?? req.query.createdFrom,
                createdTo: req.query.created_to ?? req.query.createdTo,
                ...pagination
            });

            res.status(200).json({ success: true, data: payload });
        } catch (error) {
            logger.error('[AdminController] Error listing users:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to list users',
                message: error.message
            });
        }
    }

    static async getUserById(req, res) {
        try {
            const userId = parsePositiveInt(req.params.userId);
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid userId is required'
                });
            }

            const user = await AdminModel.getUserDetail(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'User not found'
                });
            }

            return res.status(200).json({ success: true, data: user });
        } catch (error) {
            logger.error('[AdminController] Error loading user:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to load user',
                message: error.message
            });
        }
    }

    static async updateUserStatus(req, res) {
        try {
            const userId = parsePositiveInt(req.params.userId);
            const accountStatus = String(req.body?.accountStatus ?? req.body?.account_status ?? '').trim();
            const reason = trimToNull(req.body?.reason);

            if (!userId || !isValidStatus(accountStatus, ['active', 'suspended'])) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid userId and accountStatus are required'
                });
            }

            if (accountStatus === 'suspended' && !reason) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'A suspension reason is required'
                });
            }

            if (userId === Number(req.user.id) && accountStatus === 'suspended') {
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'Admins cannot suspend their own account'
                });
            }

            const target = await UserModel.findById(userId);
            if (!target) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'User not found'
                });
            }

            if (target.role === 'guest') {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Guest accounts cannot be suspended from the admin console'
                });
            }

            if (target.role === 'admin' && accountStatus === 'suspended') {
                const activeAdminCount = await AdminModel.countActiveAdmins();
                if (activeAdminCount <= 1) {
                    return res.status(409).json({
                        success: false,
                        error: 'Conflict',
                        message: 'Cannot suspend the last active admin account'
                    });
                }
            }

            const updatedUser = await AdminModel.setUserAccountStatus({
                userId,
                accountStatus,
                actorUserId: req.user.id,
                reason
            });

            return res.status(200).json({
                success: true,
                message: accountStatus === 'suspended' ? 'User suspended successfully.' : 'User reactivated successfully.',
                data: updatedUser
            });
        } catch (error) {
            logger.error('[AdminController] Error updating user status:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update user status',
                message: error.message
            });
        }
    }

    static async resendUserVerification(req, res) {
        try {
            const userId = parsePositiveInt(req.params.userId);
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid userId is required'
                });
            }

            const user = await UserModel.findById(userId);
            if (!user || user.role === 'guest' || !user.email) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Registered user not found'
                });
            }

            if (user.is_email_verified) {
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'This user already has a verified email address'
                });
            }

            const sent = await sendVerificationOtpForUser(user.id, user.email);
            await AdminModel.recordAuditEvent({
                actorUserId: req.user.id,
                action: 'user.verification.resend',
                entityType: 'user',
                entityId: user.id,
                reason: trimToNull(req.body?.reason),
                metadata: {
                    email: user.email,
                    sent
                }
            });

            return res.status(200).json({
                success: true,
                message: sent ? 'Verification email sent.' : 'Verification OTP was created, but email delivery is pending.',
                data: { sent }
            });
        } catch (error) {
            logger.error('[AdminController] Error resending verification:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to resend verification',
                message: error.message
            });
        }
    }

    static async listDrugs(req, res) {
        try {
            const pagination = parsePagination(req.query);
            const payload = await DrugService.searchDrugs({
                q: req.query.q || undefined,
                sort_by: req.query.sort_by || 'updated_at',
                sort_order: req.query.sort_order || 'desc',
                page: pagination.page,
                per_page: pagination.perPage
            });

            const enrichedPayload = await attachDoctorsToDrugSearchResults(payload, DrugService.listDrugVersions, {
                includeEmail: true,
            });
            const drugIds = (enrichedPayload.results || []).map((drug) => drug.drug_id);
            const flagsByDrugId = await AdminModel.getDrugFlagsMap(drugIds);
            const resultsWithFlags = (enrichedPayload.results || []).map((drug) => ({
                ...drug,
                adminFlags: flagsByDrugId.get(Number(drug.drug_id)) || {
                    drugId: drug.drug_id,
                    ...AdminModel.toFlagPayload()
                }
            }));
            const filteredResults = filterDrugResultsByFlags(
                { ...enrichedPayload, results: resultsWithFlags },
                flagsByDrugId,
                {
                    visibility: req.query.visibility,
                    reviewStatus: req.query.review_status ?? req.query.reviewStatus
                }
            );

            res.status(200).json({
                success: true,
                data: {
                    ...enrichedPayload,
                    results: filteredResults,
                }
            });
        } catch (error) {
            logger.error('[AdminController] Error listing drugs:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to list drugs',
                message: error.message
            });
        }
    }

    static async getDrugById(req, res) {
        try {
            const drugId = parsePositiveInt(req.params.drugId);
            if (!drugId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId is required'
                });
            }

            const drug = await DrugService.getDrugById(drugId);
            if (!drug) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Drug not found'
                });
            }

            const [flags, versions, relatedIssues] = await Promise.all([
                AdminModel.getDrugFlag(drugId),
                DrugService.listDrugVersions(drugId).then((list) => attachDoctorsToVersions(Array.isArray(list) ? list : [], {
                    includeEmail: true,
                })),
                AdminModel.listDrugIssues(drugId)
            ]);

            res.status(200).json({
                success: true,
                data: {
                    drug,
                    flags,
                    versions,
                    relatedIssues
                }
            });
        } catch (error) {
            logger.error('[AdminController] Error loading drug:', error);
            const status = error.status || (/not found/i.test(error.message) ? 404 : 500);
            res.status(status).json({
                success: false,
                error: 'Failed to load drug',
                message: error.message
            });
        }
    }

    static async updateDrugFlags(req, res) {
        try {
            const drugId = parsePositiveInt(req.params.drugId);
            const visibility = String(req.body?.visibility || '').trim();
            const reviewStatus = String(req.body?.reviewStatus ?? req.body?.review_status ?? '').trim();
            const reason = trimToNull(req.body?.reason);

            if (!drugId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId is required'
                });
            }
            if (!isValidStatus(visibility, ['visible', 'hidden']) || !isValidStatus(reviewStatus, ['published', 'needs_review'])) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid visibility and reviewStatus are required'
                });
            }
            if (!reason) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'A reason is required for drug flag changes'
                });
            }

            const drug = await DrugService.getDrugById(drugId);
            if (!drug) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Drug not found'
                });
            }

            const flags = await AdminModel.setDrugFlags({
                drugId,
                visibility,
                reviewStatus,
                adminNotes: req.body?.adminNotes ?? req.body?.admin_notes,
                actorUserId: req.user.id,
                reason
            });

            res.status(200).json({
                success: true,
                message: 'Drug flags updated successfully.',
                data: flags
            });
        } catch (error) {
            logger.error('[AdminController] Error updating drug flags:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update drug flags',
                message: error.message
            });
        }
    }

    static async listDrugVersions(req, res) {
        try {
            const drugId = parsePositiveInt(req.params.drugId);
            if (!drugId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId is required'
                });
            }

            const versions = await DrugService.listDrugVersions(drugId);
            const enrichedVersions = await attachDoctorsToVersions(Array.isArray(versions) ? versions : [], {
                includeEmail: true,
            });

            res.status(200).json({
                success: true,
                data: {
                    drugId,
                    versions: enrichedVersions
                }
            });
        } catch (error) {
            logger.error('[AdminController] Error listing drug versions:', error);
            const status = error.status || (/not found/i.test(error.message) ? 404 : 500);
            res.status(status).json({
                success: false,
                error: 'Failed to list drug versions',
                message: error.message
            });
        }
    }

    static async getDrugVersion(req, res) {
        try {
            const drugId = parsePositiveInt(req.params.drugId);
            const versionNumber = parsePositiveInt(req.params.versionNumber);

            if (!drugId || !versionNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId and versionNumber are required'
                });
            }

            const version = await DrugService.getDrugVersion(drugId, versionNumber);
            const doctorId = normalizeVersionDoctorId(version);
            const doctorLookup = await collectDoctorLookup([doctorId]);

            res.status(200).json({
                success: true,
                data: {
                    drugId,
                    versionNumber,
                    doctorId,
                    doctor: toVersionDoctorPayload(doctorLookup.get(doctorId), doctorId, {
                        includeEmail: true,
                    }),
                    version,
                }
            });
        } catch (error) {
            logger.error('[AdminController] Error fetching drug version:', error);
            const status = error.status || (/not found/i.test(error.message) ? 404 : 500);
            res.status(status).json({
                success: false,
                error: 'Failed to fetch drug version',
                message: error.message
            });
        }
    }

    static async promoteDrugVersion(req, res) {
        try {
            const drugId = parsePositiveInt(req.params.drugId);
            const versionNumber = parsePositiveInt(req.body?.versionNumber);

            if (!drugId || !versionNumber) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId and versionNumber are required'
                });
            }

            const promotion = await DrugService.promoteDrugVersion(drugId, versionNumber);
            await AdminModel.recordAuditEvent({
                actorUserId: req.user.id,
                action: 'drug.version.promote',
                entityType: 'drug',
                entityId: drugId,
                reason: trimToNull(req.body?.reason),
                metadata: {
                    versionNumber,
                    promotion
                }
            });

            res.status(200).json({
                success: true,
                message: `Version ${versionNumber} is now current for drug ${drugId}.`,
                data: promotion
            });
        } catch (error) {
            logger.error('[AdminController] Error promoting drug version:', error);
            const status = error.status || (/not found/i.test(error.message) ? 404 : /validation/i.test(error.message) ? 400 : 500);
            res.status(status).json({
                success: false,
                error: 'Failed to promote drug version',
                message: error.message
            });
        }
    }

    static async listDoctors(req, res) {
        try {
            const pagination = parsePagination(req.query);
            const payload = await AdminModel.listDoctors({
                q: req.query.q,
                verificationStatus: req.query.verification_status ?? req.query.verificationStatus,
                accountStatus: req.query.account_status ?? req.query.accountStatus,
                ...pagination
            });

            res.status(200).json({
                success: true,
                data: payload
            });
        } catch (error) {
            logger.error('[AdminController] Error listing doctors:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to list doctors',
                message: error.message
            });
        }
    }

    static async getDoctorById(req, res) {
        try {
            const userId = parsePositiveInt(req.params.userId);
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid userId is required'
                });
            }

            const doctor = await AdminModel.getDoctorDetail(userId);
            if (!doctor) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Doctor account not found'
                });
            }

            return res.status(200).json({ success: true, data: doctor });
        } catch (error) {
            logger.error('[AdminController] Error loading doctor:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to load doctor',
                message: error.message
            });
        }
    }

    static async updateDoctorVerification(req, res) {
        try {
            const userId = parsePositiveInt(req.params.userId);
            const verifiedDoctor = Boolean(req.body?.verifiedDoctor);
            const reason = trimToNull(req.body?.reason);

            if (!userId || typeof req.body?.verifiedDoctor !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid userId and verifiedDoctor are required'
                });
            }
            if (!reason) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'A reason is required for doctor verification changes'
                });
            }

            const before = await UserModel.findDoctorByUserId(userId);
            const doctor = await UserModel.setDoctorVerification(userId, verifiedDoctor);
            if (!doctor) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Doctor account not found'
                });
            }

            await AdminModel.recordAuditEvent({
                actorUserId: req.user.id,
                action: verifiedDoctor ? 'doctor.approve' : 'doctor.revoke',
                entityType: 'doctor',
                entityId: userId,
                reason,
                metadata: {
                    previousVerifiedDoctor: Boolean(before?.verified_doctor),
                    nextVerifiedDoctor: verifiedDoctor,
                    username: doctor.username
                }
            });

            res.status(200).json({
                success: true,
                message: verifiedDoctor ? 'Doctor verified successfully.' : 'Doctor verification revoked successfully.',
                data: AdminModel.toDoctorPayload(doctor)
            });
        } catch (error) {
            logger.error('[AdminController] Error updating doctor verification:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update doctor verification',
                message: error.message
            });
        }
    }

    static async listAuditEvents(req, res) {
        try {
            const pagination = parsePagination(req.query);
            const payload = await AdminModel.listAuditEvents({
                actorUserId: req.query.actor_user_id ?? req.query.actorUserId,
                entityType: req.query.entity_type ?? req.query.entityType,
                entityId: req.query.entity_id ?? req.query.entityId,
                action: req.query.action,
                ...pagination
            });

            res.status(200).json({ success: true, data: payload });
        } catch (error) {
            logger.error('[AdminController] Error listing audit events:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to list audit events',
                message: error.message
            });
        }
    }
}

module.exports = AdminController;
