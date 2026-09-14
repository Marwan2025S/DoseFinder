const { getPool } = require('../config/db');
const logger = require('../utils/logger');

class SavedDrugModel {
    static async saveDrug(userId, drugId) {
        try {
            const pool = getPool();
            const [result] = await pool.execute(
                'INSERT INTO saved_drugs (user_id, drug_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = created_at',
                [userId, drugId]
            );

            // insertId is 0 for duplicate rows in this upsert pattern.
            return {
                inserted: result.insertId > 0,
                insertId: result.insertId || null
            };
        } catch (error) {
            logger.error('[SavedDrugModel] Error saving drug:', error);
            throw error;
        }
    }

    static async getSavedDrugs(userId) {
        try {
            const pool = getPool();
            const [rows] = await pool.execute(
                `
                    SELECT sd.id, sd.user_id, sd.drug_id, sd.created_at
                    FROM saved_drugs sd
                    INNER JOIN drug_versions dv
                        ON dv.drug_id = sd.drug_id
                        AND dv.is_current = 1
                        AND COALESCE(dv.is_deleted, 0) = 0
                    WHERE sd.user_id = ?
                    ORDER BY sd.created_at DESC
                `,
                [userId]
            );
            return rows;
        } catch (error) {
            logger.error('[SavedDrugModel] Error fetching saved drugs:', error);
            throw error;
        }
    }

    static async removeSavedDrug(userId, drugId) {
        try {
            const pool = getPool();
            const [result] = await pool.execute(
                'DELETE FROM saved_drugs WHERE user_id = ? AND drug_id = ?',
                [userId, drugId]
            );
            return result.affectedRows > 0;
        } catch (error) {
            logger.error('[SavedDrugModel] Error removing saved drug:', error);
            throw error;
        }
    }

    static async clearSavedDrugs(userId) {
        try {
            const pool = getPool();
            const [result] = await pool.execute(
                'DELETE FROM saved_drugs WHERE user_id = ?',
                [userId]
            );
            return result.affectedRows;
        } catch (error) {
            logger.error('[SavedDrugModel] Error clearing saved drugs:', error);
            throw error;
        }
    }
}

module.exports = SavedDrugModel;
