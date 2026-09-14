const { getPool } = require('../config/db');
const { SOURCES_MARKER } = require('../utils/chat-sources');

class ChatModel {
    static async createConversation(userId, title = 'New Conversation') {
        const pool = getPool();
        const [result] = await pool.execute(
            `INSERT INTO conversations (user_id, title) VALUES (?, ?)`,
            [userId, title]
        );
        return result.insertId;
    }

    static async getConversationsByUserId(userId, limit, offset) {
        const pool = getPool();
        const [rows] = await pool.query(
            `SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
            [userId, limit, offset]
        );
        return rows;
    }

    static async searchConversationsByUserId(userId, searchTerm, limit, offset) {
        const pool = getPool();
        const likeValue = `%${searchTerm}%`;
        const [rows] = await pool.query(
            `SELECT
                c.*,
                CASE WHEN c.title LIKE ? THEN TRUE ELSE FALSE END AS matched_in_title,
                (
                    SELECT LEFT(
                        REPLACE(REPLACE(SUBSTRING_INDEX(m.content, ?, 1), '\r', ' '), '\n', ' '),
                        140
                    )
                    FROM messages m
                    WHERE m.conversation_id = c.id
                      AND m.role <> 'system'
                      AND m.content LIKE ?
                    ORDER BY m.id DESC
                    LIMIT 1
                ) AS matched_message_preview
            FROM conversations c
            WHERE c.user_id = ?
              AND (
                  c.title LIKE ?
                  OR EXISTS (
                      SELECT 1
                      FROM messages m
                      WHERE m.conversation_id = c.id
                        AND m.role <> 'system'
                        AND m.content LIKE ?
                  )
              )
            ORDER BY
                CASE WHEN c.title LIKE ? THEN 0 ELSE 1 END,
                c.updated_at DESC
            LIMIT ? OFFSET ?`,
            [likeValue, SOURCES_MARKER, likeValue, userId, likeValue, likeValue, likeValue, limit, offset]
        );
        return rows;
    }

    static async getConversationByIdAndUserId(conversationId, userId) {
        const pool = getPool();
        const [rows] = await pool.execute(
            `SELECT * FROM conversations WHERE id = ? AND user_id = ?`,
            [conversationId, userId]
        );
        return rows[0] || null;
    }

    static async updateConversationTitle(conversationId, userId, title) {
        const pool = getPool();
        const [result] = await pool.execute(
            `UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?`,
            [title, conversationId, userId]
        );
        return result.affectedRows > 0;
    }

    static async deleteConversation(conversationId, userId) {
        const pool = getPool();
        const [result] = await pool.execute(
            `DELETE FROM conversations WHERE id = ? AND user_id = ?`,
            [conversationId, userId]
        );
        return result.affectedRows > 0;
    }

    static async addMessage(conversationId, role, content) {
        const pool = getPool();
        const [result] = await pool.execute(
            `INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)`,
            [conversationId, role, content]
        );

        // Update conversation updated_at
        await pool.execute(
            `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [conversationId]
        );

        return result.insertId;
    }

    static async getMessagesByConversationId(conversationId, limit, offset) {
        const pool = getPool();
        // Use query instead of execute to avoid prepared statement type inference issues with LIMIT/OFFSET
        const [rows] = await pool.query(
            `SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ? OFFSET ?`,
            [conversationId, limit, offset]
        );
        return rows;
    }

    static async createConversationShareSnapshot({ userId, conversationId, tokenHash, hiddenContextPrefix = '[SYSTEM CONTEXT' }) {
        const pool = getPool();
        const connection = await pool.getConnection();
        const hiddenContextLike = `${hiddenContextPrefix}%`;

        try {
            await connection.beginTransaction();

            const [conversationRows] = await connection.execute(
                `SELECT id, title FROM conversations WHERE id = ? AND user_id = ?`,
                [conversationId, userId]
            );
            const conversation = conversationRows[0] || null;

            if (!conversation) {
                await connection.rollback();
                return null;
            }

            const [shareResult] = await connection.execute(
                `INSERT INTO chat_shares (owner_user_id, source_conversation_id, title, token_hash)
                 VALUES (?, ?, ?, ?)`,
                [userId, conversationId, conversation.title, tokenHash]
            );
            const shareId = shareResult.insertId;

            const [messages] = await connection.execute(
                `SELECT role, content, created_at
                 FROM messages
                 WHERE conversation_id = ?
                   AND content NOT LIKE ?
                 ORDER BY id ASC`,
                [conversationId, hiddenContextLike]
            );

            for (let index = 0; index < messages.length; index += 1) {
                const message = messages[index];
                await connection.execute(
                    `INSERT INTO chat_share_messages
                        (share_id, message_order, role, content, original_created_at)
                     VALUES (?, ?, ?, ?, ?)`,
                    [shareId, index + 1, message.role, message.content, message.created_at]
                );
            }

            await connection.commit();

            return {
                id: shareId,
                title: conversation.title,
                messageCount: messages.length
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async getSharedChatByTokenHash(tokenHash) {
        const pool = getPool();
        const [shareRows] = await pool.execute(
            `SELECT
                id,
                owner_user_id,
                source_conversation_id,
                title,
                created_at
             FROM chat_shares
             WHERE token_hash = ?
             LIMIT 1`,
            [tokenHash]
        );
        const share = shareRows[0] || null;

        if (!share) return null;

        const [messages] = await pool.execute(
            `SELECT
                id,
                message_order,
                role,
                content,
                original_created_at,
                created_at
             FROM chat_share_messages
             WHERE share_id = ?
             ORDER BY message_order ASC`,
            [share.id]
        );

        return {
            ...share,
            messages
        };
    }
}

module.exports = ChatModel;
