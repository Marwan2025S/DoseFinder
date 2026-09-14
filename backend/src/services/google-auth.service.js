const { OAuth2Client } = require('google-auth-library');
const { GOOGLE } = require('../config/constants');
const logger = require('../utils/logger');

// A single client instance is reused so google-auth-library can cache Google's
// public signing certificates between verifications.
let client = null;

const getClient = () => {
    if (!client) {
        client = new OAuth2Client(GOOGLE.CLIENT_ID);
    }
    return client;
};

const isGoogleConfigured = () => Boolean(GOOGLE.CLIENT_ID);

/**
 * Verifies a Google ID token (the `credential` returned by Google Identity Services)
 * and returns the trusted identity claims. Throws if the token is missing, invalid,
 * issued for a different client, expired, or carries an unverified email.
 */
const verifyIdToken = async (credential) => {
    if (!isGoogleConfigured()) {
        const error = new Error('Google sign-in is not configured');
        error.code = 'GOOGLE_NOT_CONFIGURED';
        throw error;
    }

    if (!credential || typeof credential !== 'string') {
        const error = new Error('Missing Google credential');
        error.code = 'GOOGLE_INVALID_TOKEN';
        throw error;
    }

    let ticket;
    try {
        ticket = await getClient().verifyIdToken({
            idToken: credential,
            audience: GOOGLE.CLIENT_ID
        });
    } catch (verifyError) {
        logger.warn('[GoogleAuthService] ID token verification failed', { message: verifyError.message });
        const error = new Error('Invalid Google credential');
        error.code = 'GOOGLE_INVALID_TOKEN';
        throw error;
    }

    const payload = ticket.getPayload() || {};
    const { sub, email, email_verified: emailVerified, name, picture } = payload;

    if (!sub || !email || emailVerified !== true) {
        const error = new Error('Google account email is not verified');
        error.code = 'GOOGLE_UNVERIFIED_EMAIL';
        throw error;
    }

    return {
        sub: String(sub),
        email: String(email).trim().toLowerCase(),
        name: name ? String(name).trim() : '',
        picture: picture ? String(picture) : ''
    };
};

module.exports = {
    isGoogleConfigured,
    verifyIdToken
};
