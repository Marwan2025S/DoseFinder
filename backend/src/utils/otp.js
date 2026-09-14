const crypto = require('crypto');

const generateNumericOtp = () => {
    return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
};

const hashOtp = (otp) => {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
};

const getOtpExpiryDate = (ttlMinutes) => {
    return new Date(Date.now() + Number(ttlMinutes) * 60 * 1000);
};

const isExpiredUnixTimestamp = (unixSeconds) => {
    const normalizedValue = Number(unixSeconds);
    return !Number.isFinite(normalizedValue) || normalizedValue * 1000 < Date.now();
};

// Returns how many seconds remain before another OTP may be sent, given when the
// last one was issued. Returns 0 when no prior code exists (null/invalid input)
// or the cooldown has already elapsed.
const getCooldownRemainingSeconds = (lastSentUnixSeconds, cooldownSeconds) => {
    const lastSent = Number(lastSentUnixSeconds);
    if (!Number.isFinite(lastSent)) {
        return 0;
    }
    const elapsed = Date.now() / 1000 - lastSent;
    return Math.max(0, Math.ceil(Number(cooldownSeconds) - elapsed));
};

const isSixDigitOtp = (otp) => {
    return /^\d{6}$/.test(String(otp || '').trim());
};

module.exports = {
    generateNumericOtp,
    hashOtp,
    getOtpExpiryDate,
    isExpiredUnixTimestamp,
    getCooldownRemainingSeconds,
    isSixDigitOtp
};
