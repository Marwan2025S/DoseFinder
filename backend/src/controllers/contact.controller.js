const EmailService = require('../services/email.service');
const logger = require('../utils/logger');
const { LIMITS } = require('../config/constants');

const submitContactForm = async (req, res) => {
    try {
        const { name, email, message } = req.body;

        const nameTrimmed = name?.trim() || '';
        const emailTrimmed = email?.trim() || '';
        const messageTrimmed = message?.trim() || '';

        if (!nameTrimmed || nameTrimmed.length > LIMITS.TITLE_MAX_LENGTH) {
            return res.status(400).json({
                success: false,
                message: 'Name is required and must be less than 200 characters.'
            });
        }

        if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
            return res.status(400).json({
                success: false,
                message: 'Valid email is required.'
            });
        }

        if (!messageTrimmed || messageTrimmed.length > LIMITS.MESSAGE_MAX_LENGTH) {
            return res.status(400).json({
                success: false,
                message: 'Message is required and must be less than 10000 characters.'
            });
        }

        const result = await EmailService.sendContactEmail({
            name: nameTrimmed,
            email: emailTrimmed,
            message: messageTrimmed
        });

        logger.info('[ContactController] Contact form submitted successfully', {
            name: nameTrimmed,
            email: emailTrimmed,
            sent: result.sent
        });

        res.json({
            success: true,
            message: result.sent 
                ? 'Your message has been sent successfully. We will get back to you soon.' 
                : 'Your message was received. However, email notifications are not configured.',
            sent: result.sent
        });
    } catch (error) {
        logger.error('[ContactController] Error submitting contact form:', {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'An error occurred while sending your message. Please try again later.'
        });
    }
};

module.exports = {
    submitContactForm
};
