const bcrypt = require('bcrypt');
const logger = require('../utils/logger');
const SavedDrugModel = require('../models/saved_drug.model');
const UserModel = require('../models/user.model');
const DrugService = require('../services/drug.service');
const EmailService = require('../services/email.service');
const { AUTH } = require('../config/constants');
const { getPasswordValidationMessage, isValidEmail, isValidPassword } = require('../utils/authValidation');
const { getDrugFlags, isDrugAccessibleForUser, requireDrugAccess } = require('../utils/drugAccess');
const { generateNumericOtp, getOtpExpiryDate, hashOtp, isExpiredUnixTimestamp, isSixDigitOtp } = require('../utils/otp');

const toSavedDrugPayload = (savedDrug, drugDetails) => ({
    ...drugDetails,
    id: drugDetails?.drug_id ?? drugDetails?.id ?? savedDrug.drug_id,
    drug_id: savedDrug.drug_id,
    saved_at: savedDrug.created_at
});

const toProfilePayload = (user) => ({
    id: user.id,
    username: user.username,
    displayName: user.display_name ?? user.displayName ?? user.username,
    email: user.email,
    role: user.role,
    accountStatus: user.account_status ?? user.accountStatus ?? 'active',
    emailVerified: Boolean(user.is_email_verified ?? user.emailVerified),
    verifiedDoctor: Boolean(user.verified_doctor ?? user.verifiedDoctor),
    hasPassword: Boolean(user.password_hash ?? user.hasPassword),
    hasGoogle: Boolean(user.google_sub ?? user.hasGoogle),
    created_at: user.created_at,
    updated_at: user.updated_at
});

const sendEmailChangeOtpForUser = async (userId, newEmail) => {
    const otp = generateNumericOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = getOtpExpiryDate(AUTH.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES);

    await UserModel.setEmailChangeOtp(userId, newEmail, otpHash, expiresAt);

    try {
        const sendResult = await EmailService.sendEmailChangeVerificationEmail(newEmail, otp);
        return Boolean(sendResult.sent);
    } catch (sendError) {
        logger.error('[ProfileController] Failed to send email-change OTP', {
            userId,
            newEmail,
            message: sendError.message
        });
        return false;
    }
};

class ProfileController {
    static async getProfile(req, res, next) {
        logger.info(`[ProfileController] getProfile request received for user ${req.user.id}`);
        try {
            res.status(200).json({
                success: true,
                data: toProfilePayload(req.user)
            });
        } catch (error) {
            next(error);
        }
    }

    static async updateProfile(req, res, next) {
        logger.info(`[ProfileController] updateProfile request received for user ${req.user.id}`);
        try {
            const username = String(req.body?.username || '').trim();
            const displayName = String(req.body?.displayName ?? req.body?.display_name ?? '').trim();

            if (!username) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Username is required'
                });
            }

            if (!displayName) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Display name is required'
                });
            }

            if (username.length > 255 || displayName.length > 255) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Username and display name must be 255 characters or fewer'
                });
            }

            const existingUser = await UserModel.findByUsername(username);
            if (existingUser && existingUser.id !== req.user.id) {
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'Username is already in use'
                });
            }

            const updatedUser = await UserModel.updateProfile(req.user.id, username, displayName);

            return res.status(200).json({
                success: true,
                message: 'Profile updated successfully',
                data: toProfilePayload(updatedUser)
            });
        } catch (error) {
            next(error);
        }
    }

    // Sets a first password for a passwordless (Google-only) account. Unlike
    // changePassword, no current password is required because there is none.
    static async createPassword(req, res, next) {
        logger.info(`[ProfileController] createPassword request received for user ${req.user.id}`);
        try {
            const newPassword = String(req.body?.newPassword || '');

            if (!newPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'New password is required'
                });
            }

            if (!isValidPassword(newPassword)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: getPasswordValidationMessage()
                });
            }

            const user = await UserModel.findById(req.user.id);
            if (!user || user.role === 'guest') {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Password setup is not available for this account'
                });
            }

            // Already has a password -> must use the change-password flow (which
            // verifies the current password) instead of silently overwriting it.
            if (user.password_hash) {
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'A password already exists for this account. Use change password instead.'
                });
            }

            const passwordHash = await bcrypt.hash(newPassword, 10);
            await UserModel.updatePassword(req.user.id, passwordHash);

            return res.status(200).json({
                success: true,
                message: 'Password created successfully. You can now log in with your email and password.'
            });
        } catch (error) {
            next(error);
        }
    }

    static async changePassword(req, res, next) {
        logger.info(`[ProfileController] changePassword request received for user ${req.user.id}`);
        try {
            const currentPassword = String(req.body?.currentPassword || '');
            const newPassword = String(req.body?.newPassword || '');

            if (!currentPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Current password and new password are required'
                });
            }

            if (!isValidPassword(newPassword)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: getPasswordValidationMessage()
                });
            }

            const user = await UserModel.findById(req.user.id);
            if (!user || user.role === 'guest' || !user.password_hash) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Password change is not available for this account'
                });
            }

            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
            if (!isCurrentPasswordValid) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication Failed',
                    message: 'Current password is incorrect'
                });
            }

            const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
            if (isSamePassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'New password must be different from your current password'
                });
            }

            const passwordHash = await bcrypt.hash(newPassword, 10);
            await UserModel.updatePassword(req.user.id, passwordHash);

            return res.status(200).json({
                success: true,
                message: 'Password updated successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    static async requestEmailChange(req, res, next) {
        logger.info(`[ProfileController] requestEmailChange request received for user ${req.user.id}`);
        try {
            const newEmail = String(req.body?.newEmail ?? '').trim().toLowerCase();
            const currentPassword = String(req.body?.currentPassword || '');

            if (!newEmail || !currentPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'New email and current password are required'
                });
            }

            if (newEmail.length > 255 || !isValidEmail(newEmail)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Enter a valid email address'
                });
            }

            const user = await UserModel.findById(req.user.id);
            if (!user || user.role === 'guest' || !user.password_hash) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Email change is not available for this account'
                });
            }

            if (String(user.email || '').trim().toLowerCase() === newEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'New email must be different from your current email'
                });
            }

            const existingUser = await UserModel.findByEmail(newEmail);
            if (existingUser && existingUser.id !== user.id) {
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'Email is already in use'
                });
            }

            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
            if (!isCurrentPasswordValid) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication Failed',
                    message: 'Current password is incorrect'
                });
            }

            const otpEmailSent = await sendEmailChangeOtpForUser(user.id, newEmail);

            return res.status(200).json({
                success: true,
                message: otpEmailSent
                    ? 'A verification code has been sent to your new email.'
                    : 'Email change code is pending; try again if you do not receive it.',
                data: {
                    pendingEmail: newEmail,
                    otpEmailSent
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async confirmEmailChange(req, res, next) {
        logger.info(`[ProfileController] confirmEmailChange request received for user ${req.user.id}`);
        try {
            const otp = String(req.body?.otp || '').trim();

            if (!isSixDigitOtp(otp)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Enter the 6-digit verification code'
                });
            }

            const otpHash = hashOtp(otp);
            const pendingEmailChange = await UserModel.findEmailChangeByUserIdAndOtpHash(req.user.id, otpHash);

            if (!pendingEmailChange || pendingEmailChange.role === 'guest') {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid or expired OTP'
                });
            }

            if (isExpiredUnixTimestamp(pendingEmailChange.email_change_otp_expires_at_unix)) {
                await UserModel.clearEmailChangeOtp(req.user.id);
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid or expired OTP'
                });
            }

            const previousEmail = pendingEmailChange.email;
            const newEmail = pendingEmailChange.new_email;
            const existingUser = await UserModel.findByEmail(newEmail);

            if (existingUser && existingUser.id !== req.user.id) {
                await UserModel.clearEmailChangeOtp(req.user.id);
                return res.status(409).json({
                    success: false,
                    error: 'Conflict',
                    message: 'Email is already in use'
                });
            }

            let updatedUser;
            try {
                updatedUser = await UserModel.applyEmailChange(req.user.id, newEmail);
            } catch (changeError) {
                if (changeError.code === 'ER_DUP_ENTRY') {
                    await UserModel.clearEmailChangeOtp(req.user.id);
                    return res.status(409).json({
                        success: false,
                        error: 'Conflict',
                        message: 'Email is already in use'
                    });
                }

                throw changeError;
            }

            if (!updatedUser) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Email change is not available for this account'
                });
            }

            if (previousEmail && String(previousEmail).trim().toLowerCase() !== String(newEmail).trim().toLowerCase()) {
                try {
                    await EmailService.sendEmailChangedNoticeEmail(previousEmail, newEmail);
                } catch (sendError) {
                    logger.error('[ProfileController] Failed to send email-change notice', {
                        userId: req.user.id,
                        previousEmail,
                        newEmail,
                        message: sendError.message
                    });
                }
            }

            return res.status(200).json({
                success: true,
                message: 'Email updated successfully',
                data: toProfilePayload(updatedUser)
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSearchHistory(req, res, next) {
        logger.info(`[ProfileController] getSearchHistory request received for user ${req.user.id}`);
        try {
            const SearchHistoryModel = require('../models/search_history.model');
            const rawLimit = Number(req.query.limit);
            const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 5;
            const history = await SearchHistoryModel.getHistory(req.user.id, limit);
            res.status(200).json({
                success: true,
                data: history
            });
        } catch (error) {
            next(error);
        }
    }

    static async removeSearchHistoryItem(req, res, next) {
        logger.info(`[ProfileController] removeSearchHistoryItem request received for user ${req.user.id}`);
        try {
            const historyId = Number(req.params.historyId);
            if (!Number.isInteger(historyId) || historyId <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid historyId is required'
                });
            }

            const SearchHistoryModel = require('../models/search_history.model');
            const removedCount = await SearchHistoryModel.removeHistoryItem(req.user.id, historyId);

            if (!removedCount) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Search history item not found'
                });
            }

            res.status(200).json({
                success: true,
                message: 'Search history item removed successfully',
                data: {
                    history_id: historyId,
                    removed_count: removedCount
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSavedDrugs(req, res, next) {
        logger.info(`[ProfileController] getSavedDrugs request received for user ${req.user.id}`);
        try {
            const savedDrugRows = await SavedDrugModel.getSavedDrugs(req.user.id);
            const savedDrugs = await Promise.all(
                savedDrugRows.map(async (savedDrug) => {
                    try {
                        const flags = await getDrugFlags(savedDrug.drug_id);
                        if (!isDrugAccessibleForUser(flags, req.user)) {
                            return null;
                        }

                        const drugDetails = await DrugService.getDrugById(savedDrug.drug_id);
                        if (!drugDetails) {
                            return null;
                        }
                        return toSavedDrugPayload(savedDrug, drugDetails || {});
                    } catch (error) {
                        logger.error('[ProfileController] Failed to enrich saved drug', {
                            userId: req.user.id,
                            drugId: savedDrug.drug_id,
                            message: error.message
                        });

                        return toSavedDrugPayload(savedDrug, {});
                    }
                })
            );

            res.status(200).json({
                success: true,
                data: savedDrugs.filter(Boolean)
            });
        } catch (error) {
            next(error);
        }
    }

    static async saveDrug(req, res, next) {
        logger.info(`[ProfileController] saveDrug request received for user ${req.user.id}`);
        try {
            const drugId = Number(req.body.drugId);
            if (!Number.isInteger(drugId) || drugId <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId is required'
                });
            }

            await requireDrugAccess(drugId, req.user);
            const drug = await DrugService.getDrugById(drugId);
            if (!drug) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Drug not found'
                });
            }

            const result = await SavedDrugModel.saveDrug(req.user.id, drugId);

            res.status(result.inserted ? 201 : 200).json({
                success: true,
                message: result.inserted ? 'Drug saved successfully' : 'Drug already saved',
                data: {
                    user_id: req.user.id,
                    drug_id: drugId,
                    drug: toSavedDrugPayload({ drug_id: drugId, created_at: new Date().toISOString() }, drug)
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async removeSavedDrug(req, res, next) {
        logger.info(`[ProfileController] removeSavedDrug request received for user ${req.user.id}`);
        try {
            const drugId = Number(req.params.drugId);
            if (!Number.isInteger(drugId) || drugId <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Valid drugId is required'
                });
            }

            const removed = await SavedDrugModel.removeSavedDrug(req.user.id, drugId);

            if (!removed) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'Saved drug not found'
                });
            }

            res.status(200).json({
                success: true,
                message: 'Saved drug removed successfully',
                data: {
                    user_id: req.user.id,
                    drug_id: drugId
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async clearSavedDrugs(req, res, next) {
        logger.info(`[ProfileController] clearSavedDrugs request received for user ${req.user.id}`);
        try {
            const removedCount = await SavedDrugModel.clearSavedDrugs(req.user.id);

            res.status(200).json({
                success: true,
                message: removedCount > 0 ? 'Saved drugs cleared successfully' : 'Saved drugs list is already empty',
                data: {
                    removedCount
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = ProfileController;
