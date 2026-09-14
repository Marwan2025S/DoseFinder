const express = require('express');
const rateLimit = require('express-rate-limit');
const ProfileController = require('../controllers/profile.controller');
const { verifyToken, requireVerifiedEmail } = require('../middleware/auth.middleware');
const { LIMITS } = require('../config/constants');

const router = express.Router();

const profileOtpLimiter = rateLimit({
    windowMs: LIMITS.AUTH_RATE_LIMIT.WINDOW_MS,
    max: LIMITS.AUTH_RATE_LIMIT.MAX,
    message: {
        success: false,
        error: 'Too Many Requests',
        message: 'Too many authentication attempts, please try again later.'
    }
});

router.use(verifyToken);

const allowRegisteredProfileAccess = (req, res, next) => {
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

    return next();
};

router.get('/search-history', ProfileController.getSearchHistory);
router.delete('/search-history/:historyId', ProfileController.removeSearchHistoryItem);
router.get('/', allowRegisteredProfileAccess, ProfileController.getProfile);
router.put('/', allowRegisteredProfileAccess, ProfileController.updateProfile);
router.post('/password/create', allowRegisteredProfileAccess, ProfileController.createPassword);
router.put('/password', allowRegisteredProfileAccess, ProfileController.changePassword);
router.post('/email/request', allowRegisteredProfileAccess, profileOtpLimiter, ProfileController.requestEmailChange);
router.post('/email/confirm', allowRegisteredProfileAccess, profileOtpLimiter, ProfileController.confirmEmailChange);
router.use(requireVerifiedEmail);
router.get('/saved-drugs', ProfileController.getSavedDrugs);
router.post('/saved-drugs', ProfileController.saveDrug);
router.delete('/saved-drugs', ProfileController.clearSavedDrugs);
router.delete('/saved-drugs/:drugId', ProfileController.removeSavedDrug);

module.exports = router;
