const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { AUTH } = require('../config/constants');
const UserModel = require('../models/user.model');
const AuthSessionModel = require('../models/auth_session.model');
const logger = require('../utils/logger');

const generateToken = (payload) => {
    return jwt.sign(payload, AUTH.JWT_SECRET, { expiresIn: AUTH.JWT_EXPIRES_IN });
};

const generateGuestAuthToken = (guestUsername) => {
    return crypto
        .createHmac('sha256', AUTH.JWT_SECRET)
        .update(guestUsername)
        .digest('hex');
};

const verifyGuestAuthToken = (guestUsername, token) => {
    if (!guestUsername || !token) return false;

    const expected = generateGuestAuthToken(guestUsername);
    if (token.length !== expected.length) return false;

    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
};

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication failed',
                message: 'No token provided'
            });
        }

        const token = authHeader.split(' ')[1];

        try {
            const decoded = jwt.verify(token, AUTH.JWT_SECRET);

            let authSession = null;
            if (decoded.sid) {
                authSession = await AuthSessionModel.findActiveSession(decoded.sid, decoded.userId);
                if (!authSession) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication failed',
                        message: 'Invalid or expired token'
                    });
                }
            }

            // Validate user still exists
            const user = await UserModel.findById(decoded.userId);
            if (!user) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication failed',
                    message: 'User no longer exists'
                });
            }

            if (user.role !== 'guest' && (user.account_status || user.accountStatus) === 'suspended') {
                return res.status(403).json({
                    success: false,
                    error: 'Account suspended',
                    message: 'This account has been suspended. Please contact support if you believe this is a mistake.'
                });
            }

            req.user = user;
            req.authSession = authSession;
            req.authTokenSid = decoded.sid || null;
            if (authSession) {
                AuthSessionModel.touchSession(authSession).catch((touchError) => {
                    logger.warn('[AuthMiddleware] Failed to touch auth session', {
                        sessionId: authSession.id,
                        message: touchError.message
                    });
                });
            }
            next();
        } catch (err) {
            return res.status(401).json({
                success: false,
                error: 'Authentication failed',
                message: 'Invalid or expired token'
            });
        }
    } catch (error) {
        next(error);
    }
};

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'Insufficient permissions'
            });
        }
        next();
    };
};

const requireVerifiedEmail = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication failed',
            message: 'Authentication is required'
        });
    }

    if (req.user.role === 'guest' || req.user.is_email_verified) {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email before continuing.'
    });
};

const requireVerifiedRegisteredAccount = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication failed',
            message: 'Authentication is required'
        });
    }

    if (req.user.role === 'guest') {
        return res.status(403).json({
            success: false,
            error: 'Access denied',
            message: 'Please create an account before continuing.'
        });
    }

    if (req.user.is_email_verified) {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email before continuing.'
    });
};

const requireAIChatAccess = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication failed',
            message: 'Authentication is required'
        });
    }

    if (req.user.role === 'guest' || req.user.is_email_verified || req.user.role === 'user') {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email before continuing.'
    });
};

const requireApprovedDoctor = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication failed',
            message: 'Authentication is required'
        });
    }

    if (req.user.role === 'admin') {
        return next();
    }

    if (req.user.role !== 'doctor') {
        return res.status(403).json({
            success: false,
            error: 'Access denied',
            message: 'Only approved doctors can perform this action.'
        });
    }

    if (req.user.verified_doctor ?? req.user.verifiedDoctor) {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: 'Doctor approval pending',
        message: 'Your doctor account is pending approval before you can perform this action.'
    });
};

module.exports = {
    generateToken,
    generateGuestAuthToken,
    verifyGuestAuthToken,
    verifyToken,
    requireRole,
    requireVerifiedEmail,
    requireVerifiedRegisteredAccount,
    requireAIChatAccess,
    requireApprovedDoctor
};
