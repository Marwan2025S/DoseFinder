const crypto = require('crypto');
const bcrypt = require('bcrypt');
const UserModel = require('../models/user.model');
const AuthSessionModel = require('../models/auth_session.model');
const EmailService = require('../services/email.service');
const { generateToken, generateGuestAuthToken, verifyGuestAuthToken } = require('../middleware/auth.middleware');
const GoogleAuthService = require('../services/google-auth.service');
const { AUTH } = require('../config/constants');
const { getPasswordValidationMessage, isValidPassword, isValidEmail } = require('../utils/authValidation');
const { generateNumericOtp, getOtpExpiryDate, hashOtp, isExpiredUnixTimestamp, getCooldownRemainingSeconds } = require('../utils/otp');
const logger = require('../utils/logger');

const DUMMY_HASH = bcrypt.hashSync('dummy_password_for_timing', 10); // for anti-enumeration

const generateGuestUsername = () => {
    const suffix = crypto.randomBytes(4).toString('hex');
    return `guest_${suffix}`;
};

// Derives a clean username seed from a Google email/name (e.g. "Jane.Doe@gmail.com"
// -> "janedoe"). Falls back to "user" when nothing usable remains.
const slugifyUsernameSeed = (...candidates) => {
    for (const candidate of candidates) {
        const slug = String(candidate || '')
            .split('@')[0]
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 24);
        if (slug.length >= 3) {
            return slug;
        }
    }
    return 'user';
};

// Returns a unique username built from the seed, appending a short random suffix
// only when the preferred name is already taken.
const generateUniqueUsername = async (seed) => {
    let candidate = seed;
    if (!(await UserModel.findByUsername(candidate))) {
        return candidate;
    }

    // Try a handful of randomized variants before giving up to a longer suffix.
    for (let attempt = 0; attempt < 5; attempt += 1) {
        candidate = `${seed}_${crypto.randomBytes(2).toString('hex')}`;
        if (!(await UserModel.findByUsername(candidate))) {
            return candidate;
        }
    }

    return `${seed}_${crypto.randomBytes(4).toString('hex')}`;
};

const toPublicUser = (user) => ({
    id: user.id,
    username: user.username,
    displayName: user.display_name ?? user.displayName ?? user.username,
    email: user.email,
    role: user.role,
    accountStatus: user.account_status ?? user.accountStatus ?? 'active',
    emailVerified: Boolean(user.is_email_verified ?? user.emailVerified),
    verifiedDoctor: Boolean(user.verified_doctor ?? user.verifiedDoctor),
    hasPassword: Boolean(user.password_hash ?? user.hasPassword),
    hasGoogle: Boolean(user.google_sub ?? user.hasGoogle)
});

const sendVerificationOtpForUser = async (userId, email) => {
    const verificationOtp = generateNumericOtp();
    const verificationOtpHash = hashOtp(verificationOtp);
    const verificationExpiry = getOtpExpiryDate(AUTH.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES);

    await UserModel.setEmailVerificationOtp(userId, verificationOtpHash, verificationExpiry);

    try {
        const sendResult = await EmailService.sendVerificationEmail(email, verificationOtp);
        return Boolean(sendResult.sent);
    } catch (sendError) {
        logger.error('[AuthController] Failed to send verification email', {
            userId,
            email,
            message: sendError.message
        });
        return false;
    }
};

const sendPasswordResetOtpForUser = async (userId, email) => {
    const resetOtp = generateNumericOtp();
    const resetOtpHash = hashOtp(resetOtp);
    const resetExpiry = getOtpExpiryDate(AUTH.PASSWORD_RESET_OTP_TTL_MINUTES);

    await UserModel.setPasswordResetOtp(userId, resetOtpHash, resetExpiry);

    try {
        const sendResult = await EmailService.sendPasswordResetEmail(email, resetOtp);
        return Boolean(sendResult.sent);
    } catch (sendError) {
        logger.error('[AuthController] Failed to send password reset email', {
            userId,
            email,
            message: sendError.message
        });
        return false;
    }
};

const issueSessionToken = async ({ userId, role, req, deviceFingerprint, eventType, extraPayload = {} }) => {
    const sessionInfo = await AuthSessionModel.createAuthenticatedSession({
        userId,
        req,
        deviceFingerprint,
        eventType
    });
    const token = generateToken({
        ...extraPayload,
        userId,
        role,
        sid: sessionInfo.sessionId
    });

    return {
        token,
        ...sessionInfo
    };
};

const sendNewDeviceAlert = async ({ user, deviceSummary }) => {
    if (!user?.email || !user.is_email_verified) {
        return false;
    }

    try {
        const sendResult = await EmailService.sendNewDeviceLoginEmail(user.email, deviceSummary);
        return Boolean(sendResult.sent);
    } catch (sendError) {
        logger.error('[AuthController] Failed to send new-device login email', {
            userId: user.id,
            email: user.email,
            message: sendError.message
        });
        return false;
    }
};

const getLoginIdentifier = (body = {}) => {
    return [body.identifier, body.email, body.username]
        .map((value) => String(value || '').trim())
        .find(Boolean) || '';
};

const findUserByLoginIdentifier = async (identifier) => {
    if (isValidEmail(identifier)) {
        const userByEmail = await UserModel.findByEmail(identifier);
        if (userByEmail) {
            return userByEmail;
        }
    }

    return UserModel.findByUsername(identifier);
};

class AuthController {
    static async newGuest(req, res, next) {
        logger.info('[AuthController] newGuest request received');
        try {
            let guestUsername = generateGuestUsername();

            // Ensure uniqueness for generated guest usernames.
            while (await UserModel.findByUsername(guestUsername)) {
                guestUsername = generateGuestUsername();
            }

            const userId = await UserModel.createGuest(guestUsername);

            const sessionInfo = await issueSessionToken({
                userId,
                role: 'guest',
                req,
                deviceFingerprint: req.body?.deviceFingerprint,
                eventType: 'guest_created',
                extraPayload: { username: guestUsername }
            });
            const token = sessionInfo.token;
            const guestAuthToken = generateGuestAuthToken(guestUsername);

            logger.debug(`[AuthController] Guest account created with ID ${userId}`);
            res.status(201).json({
                success: true,
                message: 'Guest account created successfully',
                data: {
                    token,
                    guestUsername,
                    guestAuthToken,
                    user: { id: userId, username: guestUsername, displayName: guestUsername, role: 'guest' }
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async registerGuest(req, res, next) {
        logger.info('[AuthController] registerGuest request received');
        try {
            const { guestUsername, guestAuthToken, username, email, password, role = 'user' } = req.body;

            if (!guestUsername || !guestAuthToken || !username || !email || !password) {
                return res.status(400).json({ success: false, error: 'Validation Error', message: 'Missing required fields' });
            }

            if (!isValidPassword(password)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: getPasswordValidationMessage()
                });
            }

            // Verify guest
            const guest = await UserModel.findGuestByUsername(guestUsername);
            if (!guest) {
                logger.warn('[AuthController] Guest account not found or already registered', { guestUsername });
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Guest account not found or already registered' });
            }

            const isValidGuestAuth = verifyGuestAuthToken(guestUsername, guestAuthToken);
            if (!isValidGuestAuth) {
                return res.status(401).json({ success: false, error: 'Authentication Failed', message: 'Invalid guest authentication token' });
            }

            // Check if username/email taken
            const userByName = await UserModel.findByUsername(username);
            const userByEmail = await UserModel.findByEmail(email);
            if (userByName || userByEmail) {
                return res.status(409).json({ success: false, error: 'Conflict', message: 'Username or email already in use' });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const validRole = ['user', 'doctor'].includes(role) ? role : 'user';

            const upgraded = await UserModel.upgradeGuest(guest.id, username, email, passwordHash, validRole, username);

            if (!upgraded) {
                throw new Error('Failed to upgrade guest account');
            }

            const verificationEmailSent = await sendVerificationOtpForUser(guest.id, email);
            const sessionInfo = await issueSessionToken({
                userId: guest.id,
                role: validRole,
                req,
                deviceFingerprint: req.body?.deviceFingerprint,
                eventType: 'guest_registered'
            });
            const token = sessionInfo.token;

            logger.debug(`[AuthController] Guest ${guest.id} upgraded to user ${username}`);
            res.status(200).json({
                success: true,
                message: verificationEmailSent
                    ? 'Guest account registered successfully. Please verify your email using the OTP code sent to your email.'
                    : 'Guest account registered successfully. OTP email is pending; use resend verification if needed.',
                data: {
                    token,
                    verificationRequired: true,
                    verificationEmailSent,
                    user: toPublicUser({
                        id: guest.id,
                        username,
                        displayName: username,
                        email,
                        role: validRole,
                        emailVerified: false,
                        verifiedDoctor: validRole === 'doctor' ? false : null,
                        hasPassword: true
                    })
                }
            });

        } catch (error) {
            next(error);
        }
    }

    static async signup(req, res, next) {
        logger.info('[AuthController] signup request received');
        try {
            const { username, email, password, role = 'user' } = req.body;

            if (!username || !email || !password) {
                return res.status(400).json({ success: false, error: 'Validation Error', message: 'Missing required fields' });
            }

            if (!isValidPassword(password)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: getPasswordValidationMessage()
                });
            }

            // Check if username/email taken
            const userByName = await UserModel.findByUsername(username);
            const userByEmail = await UserModel.findByEmail(email);
            if (userByName || userByEmail) {
                return res.status(409).json({ success: false, error: 'Conflict', message: 'Username or email already in use' });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const validRole = ['user', 'doctor'].includes(role) ? role : 'user';

            const userId = await UserModel.createUser(username, email, passwordHash, validRole, username);
            const verificationEmailSent = await sendVerificationOtpForUser(userId, email);

            const sessionInfo = await issueSessionToken({
                userId,
                role: validRole,
                req,
                deviceFingerprint: req.body?.deviceFingerprint,
                eventType: 'signup_success'
            });
            const token = sessionInfo.token;

            logger.debug(`[AuthController] User created with ID ${userId} and role ${validRole}`);
            res.status(201).json({
                success: true,
                message: verificationEmailSent
                    ? 'User created successfully. Please verify your email using the OTP code sent to your email.'
                    : 'User created successfully. OTP email is pending; use resend verification if needed.',
                data: {
                    token,
                    verificationRequired: true,
                    verificationEmailSent,
                    user: toPublicUser({ id: userId, username, displayName: username, email, role: validRole, emailVerified: false, hasPassword: true })
                }
            });

        } catch (error) {
            next(error);
        }
    }

    static async login(req, res, next) {
        logger.info('[AuthController] login request received');
        try {
            const identifier = getLoginIdentifier(req.body);
            const { password } = req.body || {};

            if (!identifier || !password) {
                return res.status(400).json({ success: false, error: 'Validation Error', message: 'Email/username and password are required' });
            }

            const user = await findUserByLoginIdentifier(identifier);

            // Anti-enumeration: always spend a bcrypt compare and return one generic
            // error. A passwordless (Google-only) account is treated exactly like a
            // missing user, so password login never reveals that no password is set.
            if (!user || user.role === 'guest' || !user.password_hash) {
                await bcrypt.compare(password, DUMMY_HASH);
                logger.warn('[AuthController] Login failed - user not found, guest, or passwordless');
                return res.status(401).json({ success: false, error: 'Authentication Failed', message: 'Invalid email/username or password' });
            }

            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                logger.warn('[AuthController] Login failed - invalid password');
                return res.status(401).json({ success: false, error: 'Authentication Failed', message: 'Invalid email/username or password' });
            }

            if ((user.account_status || user.accountStatus) === 'suspended') {
                logger.warn('[AuthController] Login blocked - account suspended', { userId: user.id });
                return res.status(403).json({
                    success: false,
                    error: 'Account suspended',
                    message: 'This account has been suspended. Please contact support if you believe this is a mistake.'
                });
            }

            const sessionInfo = await issueSessionToken({
                userId: user.id,
                role: user.role,
                req,
                deviceFingerprint: req.body?.deviceFingerprint,
                eventType: 'login_success'
            });
            const token = sessionInfo.token;
            const newDeviceEmailSent = sessionInfo.newDeviceDetected
                ? await sendNewDeviceAlert({ user, deviceSummary: sessionInfo.device.summary })
                : false;

            logger.debug(`[AuthController] User ${user.id} logged in successfully`);
            res.status(200).json({
                success: true,
                message: 'Login successful',
                data: {
                    token,
                    verificationRequired: !user.is_email_verified,
                    newDeviceDetected: sessionInfo.newDeviceDetected,
                    newDeviceEmailSent,
                    user: toPublicUser(user)
                }
            });

        } catch (error) {
            next(error);
        }
    }

    static async googleAuth(req, res, next) {
        logger.info('[AuthController] googleAuth request received');
        try {
            const { credential, guestUsername, guestAuthToken } = req.body || {};

            if (!GoogleAuthService.isGoogleConfigured()) {
                return res.status(503).json({
                    success: false,
                    error: 'Service Unavailable',
                    message: 'Google sign-in is not available right now.'
                });
            }

            let profile;
            try {
                profile = await GoogleAuthService.verifyIdToken(credential);
            } catch (verifyError) {
                logger.warn('[AuthController] Google credential rejected', { code: verifyError.code });
                return res.status(401).json({
                    success: false,
                    error: 'Authentication Failed',
                    message: 'Could not verify your Google account. Please try again.'
                });
            }

            // Resolve the account: existing Google identity -> existing email (link)
            // -> brand-new account (upgrading the current guest when possible).
            let user = await UserModel.findByGoogleSub(profile.sub);
            let isNewUser = false;

            if (!user) {
                const existingByEmail = await UserModel.findByEmail(profile.email);

                if (existingByEmail && existingByEmail.role !== 'guest') {
                    await UserModel.linkGoogleSub(existingByEmail.id, profile.sub);
                    user = await UserModel.findById(existingByEmail.id);
                } else {
                    const username = await generateUniqueUsername(
                        slugifyUsernameSeed(profile.name, profile.email)
                    );

                    // Preserve the visitor's guest data (saved drugs, history) by
                    // upgrading their guest row in place when a valid guest token is sent.
                    let upgradedGuestId = null;
                    if (guestUsername && guestAuthToken && verifyGuestAuthToken(guestUsername, guestAuthToken)) {
                        const guest = await UserModel.findGuestByUsername(guestUsername);
                        if (guest) {
                            const upgraded = await UserModel.upgradeGuestWithGoogle(
                                guest.id, username, profile.email, profile.sub, profile.name || username
                            );
                            if (upgraded) {
                                upgradedGuestId = guest.id;
                            }
                        }
                    }

                    let newUserId = upgradedGuestId;
                    if (!newUserId) {
                        newUserId = await UserModel.createGoogleUser({
                            username,
                            email: profile.email,
                            googleSub: profile.sub,
                            displayName: profile.name || username
                        });
                    }

                    user = await UserModel.findById(newUserId);
                    isNewUser = true;
                }
            }

            if (!user) {
                throw new Error('Failed to resolve Google account');
            }

            if ((user.account_status || user.accountStatus) === 'suspended') {
                logger.warn('[AuthController] Google login blocked - account suspended', { userId: user.id });
                return res.status(403).json({
                    success: false,
                    error: 'Account suspended',
                    message: 'This account has been suspended. Please contact support if you believe this is a mistake.'
                });
            }

            const sessionInfo = await issueSessionToken({
                userId: user.id,
                role: user.role,
                req,
                deviceFingerprint: req.body?.deviceFingerprint,
                eventType: isNewUser ? 'signup_success' : 'login_success'
            });
            const newDeviceEmailSent = !isNewUser && sessionInfo.newDeviceDetected
                ? await sendNewDeviceAlert({ user, deviceSummary: sessionInfo.device.summary })
                : false;

            logger.debug(`[AuthController] Google sign-in for user ${user.id} (new=${isNewUser})`);
            return res.status(isNewUser ? 201 : 200).json({
                success: true,
                message: isNewUser ? 'Account created with Google successfully' : 'Signed in with Google successfully',
                data: {
                    token: sessionInfo.token,
                    isNewUser,
                    verificationRequired: false,
                    newDeviceDetected: !isNewUser && sessionInfo.newDeviceDetected,
                    newDeviceEmailSent,
                    user: toPublicUser(user)
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async me(req, res, next) {
        logger.info(`[AuthController] me request received for user ${req.user.id}`);
        try {
            // req.user is set by auth middleware
            const user = {
                ...toPublicUser(req.user),
                created_at: req.user.created_at
            };

            res.status(200).json({
                success: true,
                message: 'User retrieved successfully',
                data: { user }
            });
        } catch (error) {
            next(error);
        }
    }

    static async verifyEmail(req, res, next) {
        logger.info('[AuthController] verifyEmail request received');
        try {
            const { email, otp } = req.body || {};

            if (!email || !otp) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Email and OTP are required'
                });
            }

            const otpHash = hashOtp(String(otp));
            const user = await UserModel.findByEmailAndVerificationOtpHash(email, otpHash);

            if (!user) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid or expired OTP'
                });
            }

            if (isExpiredUnixTimestamp(user.email_verification_otp_expires_at_unix)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid or expired OTP'
                });
            }

            await UserModel.markEmailVerified(user.id);
            const verifiedUser = await UserModel.findById(user.id);

            return res.status(200).json({
                success: true,
                message: 'Email verified successfully',
                data: {
                    user: toPublicUser(verifiedUser ?? { ...user, is_email_verified: true })
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async resendVerificationEmail(req, res, next) {
        logger.info('[AuthController] resendVerificationEmail request received');
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Email is required'
                });
            }

            const user = await UserModel.findByEmail(email);
            if (!user || user.role === 'guest' || user.is_email_verified) {
                return res.status(200).json({
                    success: true,
                    message: 'If that account exists and is unverified, an OTP has been sent.'
                });
            }

            const lastSentUnix = await UserModel.getEmailVerificationOtpCreatedAtUnix(user.id);
            const retryAfter = getCooldownRemainingSeconds(lastSentUnix, AUTH.RESEND_OTP_COOLDOWN_SECONDS);
            if (retryAfter > 0) {
                return res.status(429).json({
                    success: false,
                    error: 'Too Many Requests',
                    message: `Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before requesting a new code.`,
                    retryAfter
                });
            }

            await sendVerificationOtpForUser(user.id, user.email);

            return res.status(200).json({
                success: true,
                message: 'If that account exists and is unverified, an OTP has been sent.'
            });
        } catch (error) {
            next(error);
        }
    }

    static async logout(req, res, next) {
        logger.info(`[AuthController] logout request received for user ${req.user?.id}`);
        try {
            if (req.authTokenSid && req.user?.id) {
                await AuthSessionModel.revokeSession(req.authTokenSid, req.user.id);
            }

            return res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });
        } catch (error) {
            next(error);
        }
    }

    static async requestPasswordReset(req, res, next) {
        logger.info('[AuthController] requestPasswordReset request received');
        try {
            const email = String(req.body?.email || '').trim();

            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Email is required'
                });
            }

            const user = await UserModel.findByEmail(email);
            if (!user || user.role === 'guest' || !user.email) {
                return res.status(404).json({
                    success: false,
                    error: 'Not Found',
                    message: 'No account found for that email address'
                });
            }

            const lastSentUnix = await UserModel.getPasswordResetOtpCreatedAtUnix(user.id);
            const retryAfter = getCooldownRemainingSeconds(lastSentUnix, AUTH.RESEND_OTP_COOLDOWN_SECONDS);
            if (retryAfter > 0) {
                return res.status(429).json({
                    success: false,
                    error: 'Too Many Requests',
                    message: `Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before requesting a new code.`,
                    retryAfter
                });
            }

            await sendPasswordResetOtpForUser(user.id, user.email);

            return res.status(200).json({
                success: true,
                message: 'A password reset code has been sent to your email.'
            });
        } catch (error) {
            next(error);
        }
    }

    static async resetPassword(req, res, next) {
        logger.info('[AuthController] resetPassword request received');
        try {
            const email = String(req.body?.email || '').trim();
            const otp = String(req.body?.otp || '').trim();
            const newPassword = String(req.body?.newPassword || '');

            if (!email || !otp || !newPassword) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Email, OTP, and new password are required'
                });
            }

            if (!isValidPassword(newPassword)) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: getPasswordValidationMessage()
                });
            }

            const otpHash = hashOtp(otp);
            const user = await UserModel.findByEmailAndPasswordResetOtpHash(email, otpHash);

            if (!user || user.role === 'guest') {
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid or expired OTP'
                });
            }

            if (isExpiredUnixTimestamp(user.password_reset_otp_expires_at_unix)) {
                await UserModel.clearPasswordResetOtp(user.id);
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    message: 'Invalid or expired OTP'
                });
            }

            const passwordHash = await bcrypt.hash(newPassword, 10);
            await UserModel.resetPasswordAndMarkEmailVerified(user.id, passwordHash);

            return res.status(200).json({
                success: true,
                message: 'Password reset successfully. Please log in with your new password.'
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = AuthController;
