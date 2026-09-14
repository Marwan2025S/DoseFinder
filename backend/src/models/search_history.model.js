const { getPool } = require('../config/db');
const logger = require('../utils/logger');

class SearchHistoryModel {
    /**
     * Log a new search term for a user
     * @param {number} userId - The ID of the user
     * @param {string} searchTerm - The term they searched for
     * @returns {number} The ID of the inserted record
     */
    static async logSearch(userId, searchTerm) {
        try {
            const normalizedTerm = String(searchTerm || '').trim();
            if (!normalizedTerm) {
                return null;
            }

            const pool = getPool();
            const [result] = await pool.execute(
                'INSERT INTO drug_search_history (user_id, search_term) VALUES (?, ?)',
                [userId, normalizedTerm]
            );
            return result.insertId;
        } catch (error) {
            logger.error('[SearchHistoryModel] Error logging search:', error);
            throw error;
        }
    }

    /**
     * Get search history for a user
     * @param {number} userId - The ID of the user
     * @param {number} limit - Max number of results (default 5)
     * @returns {Array} List of search history objects
     */
    static async getHistory(userId, limit = 5) {
        try {
            const pool = getPool();
            const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 5;
            const [rows] = await pool.execute(
                `SELECT h.id, h.search_term, h.created_at
                FROM drug_search_history AS h
                INNER JOIN (
                    SELECT MAX(id) AS latest_id
                    FROM drug_search_history
                    WHERE user_id = ?
                    GROUP BY search_term
                ) AS latest ON latest.latest_id = h.id
                WHERE h.user_id = ?
                ORDER BY h.id DESC
                LIMIT ${safeLimit}`,
                [userId, userId]
            );
            return rows;
        } catch (error) {
            logger.error('[SearchHistoryModel] Error fetching search history:', error);
            throw error;
        }
    }

    /**
     * Remove a search history item by displayed history id.
     * Since history list is deduplicated by search_term, this deletes all rows
     * for the resolved term so it does not reappear from older entries.
     * @param {number} userId
     * @param {number} historyId
     * @returns {number} affected rows
     */
    static async removeHistoryItem(userId, historyId) {
        try {
            const pool = getPool();

            const [targetRows] = await pool.execute(
                'SELECT search_term FROM drug_search_history WHERE user_id = ? AND id = ? LIMIT 1',
                [userId, historyId]
            );

            if (!targetRows.length) {
                return 0;
            }

            const term = targetRows[0].search_term;
            const [result] = await pool.execute(
                'DELETE FROM drug_search_history WHERE user_id = ? AND search_term = ?',
                [userId, term]
            );

            return result.affectedRows || 0;
        } catch (error) {
            logger.error('[SearchHistoryModel] Error removing search history item:', error);
            throw error;
        }
    }
}

module.exports = SearchHistoryModel;
