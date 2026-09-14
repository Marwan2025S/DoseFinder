const express = require('express');
const rateLimit = require('express-rate-limit');
const AuthController = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth.middleware');
const { LIMITS } = require('../config/constants');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: LIMITS.AUTH_RATE_LIMIT.WINDOW_MS,
    max: LIMITS.AUTH_RATE_LIMIT.MAX,
    message: {
        success: false,
        error: 'Too Many Requests',
        message: 'Too many authentication attempts, please try again later.'
    }
});

router.post('/new-guest', AuthController.newGuest);
router.post('/register-guest', authLimiter, AuthController.registerGuest);
router.post('/signup', authLimiter, AuthController.signup);
router.post('/login', authLimiter, AuthController.login);
router.post('/google', authLimiter, AuthController.googleAuth);
router.post('/verify-email', authLimiter, AuthController.verifyEmail);
router.post('/resend-verification', authLimiter, AuthController.resendVerificationEmail);
router.post('/forgot-password/request', authLimiter, AuthController.requestPasswordReset);
router.post('/forgot-password/reset', authLimiter, AuthController.resetPassword);
router.post('/logout', verifyToken, AuthController.logout);
router.get('/me', verifyToken, AuthController.me);

module.exports = router;
