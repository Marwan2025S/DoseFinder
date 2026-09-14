const nodemailer = require('nodemailer');
const { EMAIL, AUTH } = require('../config/constants');
const logger = require('../utils/logger');

const hasPlaceholderValue = (value = '') => {
    return /^<?YOUR_(GMAIL|MAILTRAP|MAILERSEND|SMTP)_[A-Z_]+>?$/i.test(String(value).trim());
};

const isSmtpConfigured = () => {
    return Boolean(
        EMAIL.SMTP_HOST &&
        EMAIL.FROM &&
        EMAIL.SMTP_USER &&
        EMAIL.SMTP_PASS &&
        !hasPlaceholderValue(EMAIL.FROM) &&
        !hasPlaceholderValue(EMAIL.SMTP_USER) &&
        !hasPlaceholderValue(EMAIL.SMTP_PASS)
    );
};

let cachedTransporter = null;

const getTransporter = () => {
    if (!isSmtpConfigured()) {
        return null;
    }

    if (!cachedTransporter) {
        const isGmailHost = /gmail\.com$/i.test(String(EMAIL.SMTP_HOST).trim());
        cachedTransporter = nodemailer.createTransport({
            host: EMAIL.SMTP_HOST,
            port: EMAIL.SMTP_PORT,
            secure: EMAIL.SMTP_SECURE,
            ...(isGmailHost ? { service: 'gmail' } : {}),
            auth: {
                user: EMAIL.SMTP_USER,
                pass: EMAIL.SMTP_PASS
            }
        });
    }

    return cachedTransporter;
};

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isPublicVerifyUrl = (value = '') => /^https?:\/\//i.test(String(value).trim()) && !/\/api\/?/i.test(String(value).trim());

const buildVerificationEmail = ({ otpCode, minutesToExpire }) => {
    const safeOtp = escapeHtml(otpCode);
    const safeMinutes = escapeHtml(String(minutesToExpire));
    const verifyUrl = isPublicVerifyUrl(EMAIL.VERIFY_BASE_URL) ? EMAIL.VERIFY_BASE_URL.trim() : '';
    const safeVerifyUrl = verifyUrl ? escapeHtml(verifyUrl) : '';

    const textLines = [
        'DoseFinder email verification',
        '',
        `Your verification code is: ${otpCode}`,
        `This code expires in ${minutesToExpire} minutes.`,
        '',
        'Enter the code in the Verify Email screen to finish setting up your account.'
    ];

    if (verifyUrl) {
        textLines.push(`Open verification page: ${verifyUrl}`);
    }

    textLines.push('', 'If you did not request this email, you can safely ignore it.');

    const html = `
        <div style="margin:0; padding:32px 16px; background:#f3f7fb; font-family:Arial, Helvetica, sans-serif; color:#10233f;">
            <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e6f2; border-radius:24px; overflow:hidden; box-shadow:0 18px 50px rgba(15, 35, 63, 0.08);">
                <div style="padding:28px 32px; background:linear-gradient(135deg, #0f4c81 0%, #1d7fc1 100%); color:#ffffff;">
                    <div style="font-size:13px; letter-spacing:1.5px; text-transform:uppercase; opacity:0.86;">DoseFinder</div>
                    <h1 style="margin:12px 0 8px; font-size:30px; line-height:1.2;">Verify your email address</h1>
                    <p style="margin:0; font-size:15px; line-height:1.7; color:rgba(255,255,255,0.9);">
                        Use the one-time code below to activate your account and continue securely.
                    </p>
                </div>
                <div style="padding:32px;">
                    <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#28415f;">
                        Enter this code in the verification screen:
                    </p>
                    <div style="margin:0 0 22px; padding:20px 24px; border:1px dashed #8fb9db; border-radius:18px; background:#f7fbff; text-align:center;">
                        <div style="font-size:34px; line-height:1; font-weight:700; letter-spacing:10px; color:#0f4c81;">${safeOtp}</div>
                    </div>
                    <div style="margin:0 0 24px; padding:16px 18px; border-radius:16px; background:#eef6fd; color:#35506d; font-size:14px; line-height:1.7;">
                        This code expires in <strong>${safeMinutes} minutes</strong>. If the code stops working, request a new one from the app.
                    </div>
                    ${verifyUrl ? `
                        <div style="margin:0 0 24px;">
                            <a href="${safeVerifyUrl}" style="display:inline-block; padding:14px 22px; border-radius:999px; background:#0f4c81; color:#ffffff; text-decoration:none; font-weight:700;">
                                Open verification page
                            </a>
                        </div>
                    ` : ''}
                    <p style="margin:0; font-size:14px; line-height:1.8; color:#5a718c;">
                        If you did not create a DoseFinder account, you can safely ignore this email.
                    </p>
                </div>
            </div>
        </div>
    `;

    return {
        text: textLines.join('\n'),
        html
    };
};

const buildPasswordResetEmail = ({ otpCode, minutesToExpire }) => {
    const safeOtp = escapeHtml(otpCode);
    const safeMinutes = escapeHtml(String(minutesToExpire));

    const text = [
        'DoseFinder password reset',
        '',
        `Your password reset code is: ${otpCode}`,
        `This code expires in ${minutesToExpire} minutes.`,
        '',
        'Enter this code in the Forgot Password screen, then choose a new password.',
        '',
        'If you did not request a password reset, you can safely ignore this email.'
    ].join('\n');

    const html = `
        <div style="margin:0; padding:32px 16px; background:#f3f7fb; font-family:Arial, Helvetica, sans-serif; color:#10233f;">
            <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e6f2; border-radius:24px; overflow:hidden; box-shadow:0 18px 50px rgba(15, 35, 63, 0.08);">
                <div style="padding:28px 32px; background:linear-gradient(135deg, #0f4c81 0%, #1d7fc1 100%); color:#ffffff;">
                    <div style="font-size:13px; letter-spacing:1.5px; text-transform:uppercase; opacity:0.86;">DoseFinder</div>
                    <h1 style="margin:12px 0 8px; font-size:30px; line-height:1.2;">Reset your password</h1>
                    <p style="margin:0; font-size:15px; line-height:1.7; color:rgba(255,255,255,0.9);">
                        Use the one-time code below to confirm the reset request and choose a new password.
                    </p>
                </div>
                <div style="padding:32px;">
                    <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#28415f;">
                        Enter this code in the forgot-password screen:
                    </p>
                    <div style="margin:0 0 22px; padding:20px 24px; border:1px dashed #8fb9db; border-radius:18px; background:#f7fbff; text-align:center;">
                        <div style="font-size:34px; line-height:1; font-weight:700; letter-spacing:10px; color:#0f4c81;">${safeOtp}</div>
                    </div>
                    <div style="margin:0 0 24px; padding:16px 18px; border-radius:16px; background:#eef6fd; color:#35506d; font-size:14px; line-height:1.7;">
                        This code expires in <strong>${safeMinutes} minutes</strong>. Once you reset your password, this code can no longer be used.
                    </div>
                    <p style="margin:0; font-size:14px; line-height:1.8; color:#5a718c;">
                        If you did not request a password reset, you can safely ignore this email.
                    </p>
                </div>
            </div>
        </div>
    `;

    return { text, html };
};

const buildEmailChangeOtpEmail = ({ otpCode, minutesToExpire }) => {
    const safeOtp = escapeHtml(otpCode);
    const safeMinutes = escapeHtml(String(minutesToExpire));

    const text = [
        'DoseFinder email change',
        '',
        `Your email change code is: ${otpCode}`,
        `This code expires in ${minutesToExpire} minutes.`,
        '',
        'Enter this code in Profile & Settings to confirm your new email address.',
        '',
        'If you did not request an email change, you can safely ignore this email.'
    ].join('\n');

    const html = `
        <div style="margin:0; padding:32px 16px; background:#f3f7fb; font-family:Arial, Helvetica, sans-serif; color:#10233f;">
            <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e6f2; border-radius:24px; overflow:hidden; box-shadow:0 18px 50px rgba(15, 35, 63, 0.08);">
                <div style="padding:28px 32px; background:linear-gradient(135deg, #0f4c81 0%, #1d7fc1 100%); color:#ffffff;">
                    <div style="font-size:13px; letter-spacing:1.5px; text-transform:uppercase; opacity:0.86;">DoseFinder</div>
                    <h1 style="margin:12px 0 8px; font-size:30px; line-height:1.2;">Confirm your new email</h1>
                    <p style="margin:0; font-size:15px; line-height:1.7; color:rgba(255,255,255,0.9);">
                        Use this one-time code to finish changing the email address on your account.
                    </p>
                </div>
                <div style="padding:32px;">
                    <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#28415f;">
                        Enter this code in Profile & Settings:
                    </p>
                    <div style="margin:0 0 22px; padding:20px 24px; border:1px dashed #8fb9db; border-radius:18px; background:#f7fbff; text-align:center;">
                        <div style="font-size:34px; line-height:1; font-weight:700; letter-spacing:10px; color:#0f4c81;">${safeOtp}</div>
                    </div>
                    <div style="margin:0 0 24px; padding:16px 18px; border-radius:16px; background:#eef6fd; color:#35506d; font-size:14px; line-height:1.7;">
                        This code expires in <strong>${safeMinutes} minutes</strong>. Your current email stays active until this code is confirmed.
                    </div>
                    <p style="margin:0; font-size:14px; line-height:1.8; color:#5a718c;">
                        If you did not request this email change, you can safely ignore this message.
                    </p>
                </div>
            </div>
        </div>
    `;

    return { text, html };
};

const buildEmailChangedNoticeEmail = ({ newEmail, changedAt = new Date() }) => {
    const when = new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
    }).format(new Date(changedAt));
    const safeNewEmail = escapeHtml(newEmail);
    const safeWhen = escapeHtml(`${when} UTC`);

    const text = [
        'DoseFinder email changed',
        '',
        `The email address on your DoseFinder account was changed to ${newEmail}.`,
        `Time: ${when} UTC`,
        '',
        'If this was you, no action is needed. If you do not recognize this change, reset your password.'
    ].join('\n');

    const html = `
        <div style="margin:0; padding:32px 16px; background:#f3f7fb; font-family:Arial, Helvetica, sans-serif; color:#10233f;">
            <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e6f2; border-radius:24px; overflow:hidden; box-shadow:0 18px 50px rgba(15, 35, 63, 0.08);">
                <div style="padding:28px 32px; background:linear-gradient(135deg, #0f4c81 0%, #1d7fc1 100%); color:#ffffff;">
                    <div style="font-size:13px; letter-spacing:1.5px; text-transform:uppercase; opacity:0.86;">DoseFinder</div>
                    <h1 style="margin:12px 0 8px; font-size:30px; line-height:1.2;">Email address changed</h1>
                    <p style="margin:0; font-size:15px; line-height:1.7; color:rgba(255,255,255,0.9);">
                        We changed the email address on your DoseFinder account.
                    </p>
                </div>
                <div style="padding:32px;">
                    <div style="margin:0 0 24px; padding:18px 20px; border-radius:16px; background:#f7fbff; border:1px solid #d9e6f2; color:#28415f; font-size:15px; line-height:1.8;">
                        <div><strong>New email:</strong> ${safeNewEmail}</div>
                        <div><strong>Time:</strong> ${safeWhen}</div>
                    </div>
                    <p style="margin:0; font-size:14px; line-height:1.8; color:#5a718c;">
                        If this was you, no action is needed. If you do not recognize this change, reset your password.
                    </p>
                </div>
            </div>
        </div>
    `;

    return { text, html };
};

const buildNewDeviceLoginEmail = ({ deviceSummary = {}, loginAt = new Date() }) => {
    const browser = [deviceSummary.browserName, deviceSummary.browserVersion].filter(Boolean).join(' ') || 'Unknown browser';
    const os = [deviceSummary.osName, deviceSummary.osVersion].filter(Boolean).join(' ') || 'Unknown OS';
    const screen = deviceSummary.screenResolution || 'Unknown screen';
    const timezone = deviceSummary.timezone || 'Unknown timezone';
    const language = deviceSummary.language || 'Unknown language';
    const when = new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
    }).format(new Date(loginAt));

    const text = [
        'New DoseFinder device login',
        '',
        `Browser: ${browser}`,
        `OS: ${os}`,
        `Screen: ${screen}`,
        `Timezone: ${timezone}`,
        `Language: ${language}`,
        `Time: ${when} UTC`,
        '',
        'If this was you, no action is needed. If you do not recognize this login, reset your password.'
    ].join('\n');

    const safeBrowser = escapeHtml(browser);
    const safeOs = escapeHtml(os);
    const safeScreen = escapeHtml(screen);
    const safeTimezone = escapeHtml(timezone);
    const safeLanguage = escapeHtml(language);
    const safeWhen = escapeHtml(`${when} UTC`);

    const html = `
        <div style="margin:0; padding:32px 16px; background:#f3f7fb; font-family:Arial, Helvetica, sans-serif; color:#10233f;">
            <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e6f2; border-radius:24px; overflow:hidden; box-shadow:0 18px 50px rgba(15, 35, 63, 0.08);">
                <div style="padding:28px 32px; background:linear-gradient(135deg, #0f4c81 0%, #1d7fc1 100%); color:#ffffff;">
                    <div style="font-size:13px; letter-spacing:1.5px; text-transform:uppercase; opacity:0.86;">DoseFinder</div>
                    <h1 style="margin:12px 0 8px; font-size:30px; line-height:1.2;">New device login</h1>
                    <p style="margin:0; font-size:15px; line-height:1.7; color:rgba(255,255,255,0.9);">
                        We noticed a successful login from a device we have not seen before.
                    </p>
                </div>
                <div style="padding:32px;">
                    <div style="margin:0 0 24px; padding:18px 20px; border-radius:16px; background:#f7fbff; border:1px solid #d9e6f2; color:#28415f; font-size:15px; line-height:1.8;">
                        <div><strong>Browser:</strong> ${safeBrowser}</div>
                        <div><strong>OS:</strong> ${safeOs}</div>
                        <div><strong>Screen:</strong> ${safeScreen}</div>
                        <div><strong>Timezone:</strong> ${safeTimezone}</div>
                        <div><strong>Language:</strong> ${safeLanguage}</div>
                        <div><strong>Time:</strong> ${safeWhen}</div>
                    </div>
                    <p style="margin:0; font-size:14px; line-height:1.8; color:#5a718c;">
                        If this was you, no action is needed. If you do not recognize this login, reset your password.
                    </p>
                </div>
            </div>
        </div>
    `;

    return { text, html };
};

const buildContactEmail = ({ name, email, message }) => {
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

    const text = [
        'New Contact Form Submission',
        '',
        `Name: ${name}`,
        `Email: ${email}`,
        '',
        'Message:',
        message
    ].join('\n');

    const html = `
        <div style="margin:0; padding:32px 16px; background:#f3f7fb; font-family:Arial, Helvetica, sans-serif; color:#10233f;">
            <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e6f2; border-radius:24px; overflow:hidden; box-shadow:0 18px 50px rgba(15, 35, 63, 0.08);">
                <div style="padding:28px 32px; background:linear-gradient(135deg, #0f4c81 0%, #1d7fc1 100%); color:#ffffff;">
                    <div style="font-size:13px; letter-spacing:1.5px; text-transform:uppercase; opacity:0.86;">DoseFinder</div>
                    <h1 style="margin:12px 0 8px; font-size:30px; line-height:1.2;">New Contact Form Submission</h1>
                    <p style="margin:0; font-size:15px; line-height:1.7; color:rgba(255,255,255,0.9);">
                        Someone has reached out through the contact form on your website.
                    </p>
                </div>
                <div style="padding:32px;">
                    <div style="margin:0 0 24px; padding:18px 20px; border-radius:16px; background:#f7fbff; border:1px solid #d9e6f2; color:#28415f; font-size:15px; line-height:1.8;">
                        <div style="margin-bottom:12px;"><strong>Name:</strong> ${safeName}</div>
                        <div><strong>Email:</strong> ${safeEmail}</div>
                    </div>
                    <p style="margin:0 0 18px; font-size:16px; line-height:1.7; color:#28415f;">
                        <strong>Message:</strong>
                    </p>
                    <div style="margin:0 0 24px; padding:20px; border-radius:12px; background:#f0f4f8; border-left:4px solid #0f4c81; color:#35506d; font-size:15px; line-height:1.7;">
                        ${safeMessage}
                    </div>
                    <p style="margin:0; font-size:14px; line-height:1.8; color:#5a718c;">
                        Reply to this message by responding directly to ${safeEmail}.
                    </p>
                </div>
            </div>
        </div>
    `;

    return { text, html };
};

class EmailService {
    static async sendContactEmail({ name, email, message }) {
        const transporter = getTransporter();

        if (!transporter) {
            logger.warn('[EmailService] SMTP is not configured. Contact form email was not sent.', {
                name,
                email
            });
            return { sent: false };
        }

        const emailBody = buildContactEmail({
            name,
            email,
            message
        });

        await transporter.sendMail({
            from: EMAIL.FROM,
            to: EMAIL.CONTACT,
            replyTo: email,
            subject: `Contact Form: ${name}`,
            text: emailBody.text,
            html: emailBody.html
        });

        return { sent: true };
    }

    static async sendVerificationEmail(toEmail, otpCode) {
        const transporter = getTransporter();

        if (!transporter) {
            logger.warn('[EmailService] SMTP is not configured. Verification email was not sent.', {
                toEmail,
                otpPreview: String(otpCode).slice(0, 2) + '****'
            });
            return { sent: false };
        }

        const emailBody = buildVerificationEmail({
            otpCode,
            minutesToExpire: AUTH.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES
        });

        await transporter.sendMail({
            from: EMAIL.FROM,
            to: toEmail,
            subject: 'Verify your DoseFinder account',
            text: emailBody.text,
            html: emailBody.html
        });

        return { sent: true };
    }

    static async sendPasswordResetEmail(toEmail, otpCode) {
        const transporter = getTransporter();

        if (!transporter) {
            logger.warn('[EmailService] SMTP is not configured. Password reset email was not sent.', {
                toEmail,
                otpPreview: String(otpCode).slice(0, 2) + '****'
            });
            return { sent: false };
        }

        const emailBody = buildPasswordResetEmail({
            otpCode,
            minutesToExpire: AUTH.PASSWORD_RESET_OTP_TTL_MINUTES
        });

        await transporter.sendMail({
            from: EMAIL.FROM,
            to: toEmail,
            subject: 'Reset your DoseFinder password',
            text: emailBody.text,
            html: emailBody.html
        });

        return { sent: true };
    }

    static async sendEmailChangeVerificationEmail(toEmail, otpCode) {
        const transporter = getTransporter();

        if (!transporter) {
            logger.warn('[EmailService] SMTP is not configured. Email-change verification email was not sent.', {
                toEmail,
                otpPreview: String(otpCode).slice(0, 2) + '****'
            });
            return { sent: false };
        }

        const emailBody = buildEmailChangeOtpEmail({
            otpCode,
            minutesToExpire: AUTH.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES
        });

        await transporter.sendMail({
            from: EMAIL.FROM,
            to: toEmail,
            subject: 'Confirm your DoseFinder email change',
            text: emailBody.text,
            html: emailBody.html
        });

        return { sent: true };
    }

    static async sendEmailChangedNoticeEmail(toEmail, newEmail) {
        const transporter = getTransporter();

        if (!transporter) {
            logger.warn('[EmailService] SMTP is not configured. Email-change notice was not sent.', {
                toEmail,
                newEmail
            });
            return { sent: false };
        }

        const emailBody = buildEmailChangedNoticeEmail({
            newEmail,
            changedAt: new Date()
        });

        await transporter.sendMail({
            from: EMAIL.FROM,
            to: toEmail,
            subject: 'Your DoseFinder email address was changed',
            text: emailBody.text,
            html: emailBody.html
        });

        return { sent: true };
    }

    static async sendNewDeviceLoginEmail(toEmail, deviceSummary) {
        const transporter = getTransporter();

        if (!transporter) {
            logger.warn('[EmailService] SMTP is not configured. New-device login email was not sent.', {
                toEmail
            });
            return { sent: false };
        }

        const emailBody = buildNewDeviceLoginEmail({
            deviceSummary,
            loginAt: new Date()
        });

        await transporter.sendMail({
            from: EMAIL.FROM,
            to: toEmail,
            subject: 'New DoseFinder device login',
            text: emailBody.text,
            html: emailBody.html
        });

        return { sent: true };
    }
}

module.exports = EmailService;
