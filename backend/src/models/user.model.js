const { getPool } = require('../config/db');

const USER_SELECT = `
    SELECT
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.password_hash,
        u.google_sub,
        u.role,
        COALESCE(u.account_status, 'active') AS account_status,
        u.suspended_at,
        u.suspended_by_user_id,
        u.suspension_reason,
        u.is_email_verified,
        u.created_at,
        u.updated_at,
        COALESCE(d.verified_doctor, FALSE) AS verified_doctor
    FROM users u
    LEFT JOIN doctors d ON d.user_id = u.id
`;

class UserModel {
    static async createGuest(username) {
        const pool = getPool();
        const [result] = await pool.execute(
            `INSERT INTO users (username, display_name, role) VALUES (?, ?, 'guest')`,
            [username, username]
        );
        return result.insertId;
    }

    static async createUser(username, email, passwordHash, role = 'user', displayName = username) {
        const pool = getPool();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(
                `INSERT INTO users (username, display_name, email, password_hash, role, is_email_verified) VALUES (?, ?, ?, ?, ?, FALSE)`,
                [username, displayName, email, passwordHash, role]
            );

            if (role === 'doctor') {
                await connection.execute(
                    `INSERT INTO doctors (user_id, verified_doctor) VALUES (?, FALSE)`,
                    [result.insertId]
                );
            }

            await connection.commit();
            return result.insertId;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Creates a passwordless account authenticated via Google. Google guarantees a
    // verified email, so the account starts with is_email_verified = TRUE.
    static async createGoogleUser({ username, email, googleSub, displayName = username, role = 'user' }) {
        const pool = getPool();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(
                `INSERT INTO users (username, display_name, email, google_sub, role, is_email_verified) VALUES (?, ?, ?, ?, ?, TRUE)`,
                [username, displayName, email, googleSub, role]
            );

            if (role === 'doctor') {
                await connection.execute(
                    `INSERT INTO doctors (user_id, verified_doctor) VALUES (?, FALSE)`,
                    [result.insertId]
                );
            }

            await connection.commit();
            return result.insertId;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Links a Google identity onto an existing (password) account so the same person
    // can use either sign-in method.
    static async linkGoogleSub(userId, googleSub) {
        const pool = getPool();
        const [result] = await pool.execute(
            `UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL`,
            [googleSub, userId]
        );
        return result.affectedRows > 0;
    }

    // Promotes a browsing guest into a passwordless Google account in place, preserving
    // the guest's saved drugs and search history.
    static async upgradeGuestWithGoogle(userId, username, email, googleSub, displayName = username, role = 'user') {
        const pool = getPool();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(
                `UPDATE users SET username = ?, display_name = ?, email = ?, google_sub = ?, role = ?, is_email_verified = TRUE WHERE id = ? AND role = 'guest'`,
                [username, displayName, email, googleSub, role, userId]
            );

            if (result.affectedRows > 0 && role === 'doctor') {
                await connection.execute(
                    `INSERT INTO doctors (user_id, verified_doctor) VALUES (?, FALSE)`,
                    [userId]
                );
            }

            await connection.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async upgradeGuest(userId, username, email, passwordHash, role = 'user', displayName = username) {
        const pool = getPool();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(
                `UPDATE users SET username = ?, display_name = ?, email = ?, password_hash = ?, role = ? WHERE id = ? AND role = 'guest'`,
                [username, displayName, email, passwordHash, role, userId]
            );

            if (result.affectedRows > 0 && role === 'doctor') {
                await connection.execute(
                    `INSERT INTO doctors (user_id, verified_doctor) VALUES (?, FALSE)`,
                    [userId]
                );
            }

            await connection.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async findByUsername(username) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `${USER_SELECT} WHERE u.username = ?`,
            [username]
        );
        return rows[0] || null;
    }

    static async findByEmail(email) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `${USER_SELECT} WHERE u.email = ?`,
            [email]
        );
        return rows[0] || null;
    }

    static async findByGoogleSub(googleSub) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `${USER_SELECT} WHERE u.google_sub = ?`,
            [googleSub]
        );
        return rows[0] || null;
    }

    static async findGuestByUsername(username) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `${USER_SELECT} WHERE u.username = ? AND u.role = 'guest'`,
            [username]
        );
        return rows[0] || null;
    }

    static async findById(id) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `${USER_SELECT} WHERE u.id = ?`,
            [id]
        );
        return rows[0] || null;
    }

    static async findManyByIds(ids = []) {
        const uniqueIds = Array.from(new Set(
            ids
                .map((id) => Number.parseInt(id, 10))
                .filter((id) => Number.isInteger(id) && id > 0)
        ));

        if (!uniqueIds.length) {
            return [];
        }

        const pool = getPool();
        const placeholders = uniqueIds.map(() => '?').join(', ');
        const [rows] = await pool.execute(
            `${USER_SELECT} WHERE u.id IN (${placeholders})`,
            uniqueIds
        );
        return rows;
    }

    static async setEmailVerificationOtp(userId, otpHash, expiresAt) {
        const pool = getPool();
        await pool.execute(
            `DELETE FROM email_verifications WHERE user_id = ?`,
            [userId]
        );
        const [result] = await pool.execute(
            `
                INSERT INTO email_verifications (user_id, token_hash, expires_at)
                VALUES (?, ?, ?)
            `,
            [userId, otpHash, expiresAt]
        );

        await pool.execute(
            `UPDATE users SET is_email_verified = FALSE WHERE id = ?`,
            [userId]
        );

        return result.affectedRows > 0;
    }

    static async getEmailVerificationOtpCreatedAtUnix(userId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `SELECT UNIX_TIMESTAMP(created_at) AS created_at_unix
             FROM email_verifications WHERE user_id = ? LIMIT 1`,
            [userId]
        );
        return rows[0]?.created_at_unix ?? null;
    }

    static async findByEmailAndVerificationOtpHash(email, otpHash) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    u.is_email_verified,
                    COALESCE(d.verified_doctor, FALSE) AS verified_doctor,
                    ev.expires_at AS email_verification_otp_expires_at,
                    UNIX_TIMESTAMP(ev.expires_at) AS email_verification_otp_expires_at_unix
                FROM email_verifications ev
                INNER JOIN users u ON u.id = ev.user_id
                LEFT JOIN doctors d ON d.user_id = u.id
                WHERE u.email = ? AND ev.token_hash = ?
                LIMIT 1
            `,
            [email, otpHash]
        );
        return rows[0] || null;
    }

    static async markEmailVerified(userId) {
        const pool = getPool();
        const [result] = await pool.execute(
            `
                UPDATE users
                SET is_email_verified = TRUE
                WHERE id = ?
            `,
            [userId]
        );

        await pool.execute(
            `DELETE FROM email_verifications WHERE user_id = ?`,
            [userId]
        );

        return result.affectedRows > 0;
    }

    static async clearEmailVerificationOtp(userId, executor = null) {
        const db = executor ?? getPool();
        await db.execute(
            `DELETE FROM email_verifications WHERE user_id = ?`,
            [userId]
        );
        return true;
    }

    static async setPasswordResetOtp(userId, otpHash, expiresAt) {
        const pool = getPool();

        await this.clearPasswordResetOtp(userId);

        const [result] = await pool.execute(
            `
                INSERT INTO password_reset_otps (user_id, token_hash, expires_at)
                VALUES (?, ?, ?)
            `,
            [userId, otpHash, expiresAt]
        );

        return result.affectedRows > 0;
    }

    static async clearPasswordResetOtp(userId, executor = null) {
        const db = executor ?? getPool();
        await db.execute(
            `DELETE FROM password_reset_otps WHERE user_id = ?`,
            [userId]
        );
        return true;
    }

    static async getPasswordResetOtpCreatedAtUnix(userId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `SELECT UNIX_TIMESTAMP(created_at) AS created_at_unix
             FROM password_reset_otps WHERE user_id = ? LIMIT 1`,
            [userId]
        );
        return rows[0]?.created_at_unix ?? null;
    }

    static async findByEmailAndPasswordResetOtpHash(email, otpHash) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    u.is_email_verified,
                    COALESCE(d.verified_doctor, FALSE) AS verified_doctor,
                    pro.expires_at AS password_reset_otp_expires_at,
                    UNIX_TIMESTAMP(pro.expires_at) AS password_reset_otp_expires_at_unix
                FROM password_reset_otps pro
                INNER JOIN users u ON u.id = pro.user_id
                LEFT JOIN doctors d ON d.user_id = u.id
                WHERE u.email = ? AND pro.token_hash = ?
                LIMIT 1
            `,
            [email, otpHash]
        );
        return rows[0] || null;
    }

    static async setEmailChangeOtp(userId, newEmail, otpHash, expiresAt) {
        const pool = getPool();

        await this.clearEmailChangeOtp(userId);

        const [result] = await pool.execute(
            `
                INSERT INTO email_change_otps (user_id, new_email, token_hash, expires_at)
                VALUES (?, ?, ?, ?)
            `,
            [userId, newEmail, otpHash, expiresAt]
        );

        return result.affectedRows > 0;
    }

    static async clearEmailChangeOtp(userId, executor = null) {
        const db = executor ?? getPool();
        await db.execute(
            `DELETE FROM email_change_otps WHERE user_id = ?`,
            [userId]
        );
        return true;
    }

    static async findEmailChangeByUserIdAndOtpHash(userId, otpHash) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    u.is_email_verified,
                    COALESCE(d.verified_doctor, FALSE) AS verified_doctor,
                    eco.new_email,
                    eco.expires_at AS email_change_otp_expires_at,
                    UNIX_TIMESTAMP(eco.expires_at) AS email_change_otp_expires_at_unix
                FROM email_change_otps eco
                INNER JOIN users u ON u.id = eco.user_id
                LEFT JOIN doctors d ON d.user_id = u.id
                WHERE eco.user_id = ? AND eco.token_hash = ?
                LIMIT 1
            `,
            [userId, otpHash]
        );
        return rows[0] || null;
    }

    static async applyEmailChange(userId, newEmail) {
        const pool = getPool();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(
                `
                    UPDATE users
                    SET email = ?, is_email_verified = TRUE
                    WHERE id = ? AND role <> 'guest'
                `,
                [newEmail, userId]
            );

            await this.clearEmailChangeOtp(userId, connection);
            await this.clearPasswordResetOtp(userId, connection);
            await this.clearEmailVerificationOtp(userId, connection);

            await connection.commit();

            if (!result.affectedRows) {
                return null;
            }

            return this.findById(userId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async resetPasswordAndMarkEmailVerified(userId, passwordHash) {
        const pool = getPool();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.execute(
                `
                    UPDATE users
                    SET password_hash = ?, is_email_verified = TRUE
                    WHERE id = ?
                `,
                [passwordHash, userId]
            );

            await this.clearPasswordResetOtp(userId, connection);
            await this.clearEmailVerificationOtp(userId, connection);

            await connection.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async updateProfile(userId, username, displayName) {
        const pool = getPool();
        await pool.execute(
            `
                UPDATE users
                SET username = ?, display_name = ?
                WHERE id = ?
            `,
            [username, displayName, userId]
        );

        return this.findById(userId);
    }

    static async updatePassword(userId, passwordHash) {
        const pool = getPool();
        const [result] = await pool.execute(
            `
                UPDATE users
                SET password_hash = ?
                WHERE id = ?
            `,
            [passwordHash, userId]
        );

        return result.affectedRows > 0;
    }

    static async listDoctors(searchTerm = '') {
        const pool = getPool();
        const filters = [`u.role = 'doctor'`];
        const params = [];

        if (searchTerm?.trim()) {
            filters.push(`(u.username LIKE ? OR u.email LIKE ?)`);
            const searchPattern = `%${searchTerm.trim()}%`;
            params.push(searchPattern, searchPattern);
        }

        const [rows] = await pool.execute(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    u.is_email_verified,
                    u.created_at,
                    u.updated_at,
                    d.verified_doctor,
                    d.created_at AS doctor_created_at,
                    d.updated_at AS doctor_updated_at
                FROM users u
                INNER JOIN doctors d ON d.user_id = u.id
                WHERE ${filters.join(' AND ')}
                ORDER BY d.verified_doctor ASC, u.created_at DESC
            `,
            params
        );

        return rows;
    }

    static async findDoctorByUserId(userId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.email,
                    u.role,
                    u.is_email_verified,
                    u.created_at,
                    u.updated_at,
                    d.verified_doctor,
                    d.created_at AS doctor_created_at,
                    d.updated_at AS doctor_updated_at
                FROM users u
                INNER JOIN doctors d ON d.user_id = u.id
                WHERE u.id = ? AND u.role = 'doctor'
                LIMIT 1
            `,
            [userId]
        );

        return rows[0] || null;
    }

    static async setDoctorVerification(userId, verifiedDoctor) {
        const pool = getPool();
        const [result] = await pool.execute(
            `
                UPDATE doctors d
                INNER JOIN users u ON u.id = d.user_id
                SET d.verified_doctor = ?
                WHERE d.user_id = ? AND u.role = 'doctor'
            `,
            [verifiedDoctor, userId]
        );

        if (!result.affectedRows) {
            return this.findDoctorByUserId(userId);
        }

        return this.findDoctorByUserId(userId);
    }
}

module.exports = UserModel;
