const express = require('express');
const rateLimit = require('express-rate-limit');
const ContactController = require('../controllers/contact.controller');
const { LIMITS } = require('../config/constants');

const router = express.Router();

const contactLimiter = rateLimit({
    windowMs: LIMITS.AUTH_RATE_LIMIT.WINDOW_MS,
    max: 5,
    message: {
        success: false,
        error: 'Too Many Requests',
        message: 'Too many contact form submissions, please try again later.'
    }
});

router.post('/submit', contactLimiter, ContactController.submitContactForm);

module.exports = router;
