const { AUTH } = require('../config/constants');

const isValidPassword = (password = '') => {
    return AUTH.PASSWORD_POLICY.REGEX.test(password) && password.length >= AUTH.PASSWORD_POLICY.MIN_LENGTH;
};

const getPasswordValidationMessage = () => {
    return `Password must be at least ${AUTH.PASSWORD_POLICY.MIN_LENGTH} characters and include uppercase, lowercase, number, and special character.`;
};

const isValidEmail = (email = '') => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
};

module.exports = {
    isValidPassword,
    getPasswordValidationMessage,
    isValidEmail
};
