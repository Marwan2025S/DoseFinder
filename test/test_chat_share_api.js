/**
 * Manual integration test for public DoseGPT chat share snapshots.
 *
 * Prerequisites:
 * - Backend running and reachable at BASE_URL (default http://localhost:3000)
 * - MySQL reachable from the host (defaults match docker-compose/.env)
 * - SQL migration 106_chat_shares.sql applied
 *
 * Run:
 *   node test/test_chat_share_api.js
 */

const mysql = require('../backend/node_modules/mysql2/promise');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DB_HOST = process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 3307);
const DB_USER = process.env.TEST_DB_USER || process.env.DB_USER || 'dms_user';
const DB_PASSWORD = process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'dms_secure_password';
const DB_NAME = process.env.TEST_DB_NAME || process.env.DB_NAME || 'dms_db';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.blue}[CHAT SHARE TEST]${colors.reset} ${msg}`);
const logSuccess = (msg) => console.log(`  ${colors.green}✓${colors.reset} ${msg}`);
const logWarn = (msg) => console.log(`  ${colors.yellow}!${colors.reset} ${msg}`);

async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
}

async function createRegisteredAccount(prefix) {
    const timestamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const username = `${prefix}_${timestamp}`;
    const email = `${prefix}_${timestamp}@example.com`;

    const guestResponse = await apiRequest('/api/auth/new-guest', 'POST');
    if (!guestResponse.ok) {
        throw new Error(`Failed to create guest account: ${JSON.stringify(guestResponse.data)}`);
    }

    const guestUsername = guestResponse.data?.data?.guestUsername;
    const guestAuthToken = guestResponse.data?.data?.guestAuthToken;
    const registerResponse = await apiRequest('/api/auth/register-guest', 'POST', {
        guestUsername,
        guestAuthToken,
        username,
        email,
        password: 'Password123!',
        role: 'user',
    });

    if (!registerResponse.ok) {
        throw new Error(`Failed to register user: ${JSON.stringify(registerResponse.data)}`);
    }

    return {
        username,
        email,
        token: registerResponse.data?.data?.token,
        user: registerResponse.data?.data?.user,
    };
}

async function connectDb() {
    return mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
    });
}

async function insertMessage(connection, conversationId, role, content) {
    await connection.execute(
        `INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)`,
        [conversationId, role, content]
    );
}

function expect(condition, message) {
    if (!condition) throw new Error(message);
}

async function run() {
    log('Starting public chat share snapshot test...');
    let connection = null;

    try {
        connection = await connectDb();
        logSuccess(`Connected to MySQL at ${DB_HOST}:${DB_PORT}.`);

        const owner = await createRegisteredAccount('share_owner');
        const outsider = await createRegisteredAccount('share_outsider');
        logSuccess('Created owner and outsider accounts.');

        const createConversation = await apiRequest('/api/ai/new-chat', 'POST', {
            title: 'Share Snapshot Test',
        }, owner.token);
        expect(createConversation.ok, `Failed to create conversation: ${JSON.stringify(createConversation.data)}`);

        const conversationId = createConversation.data?.data?.conversation?.id;
        expect(conversationId, 'Conversation id was not returned.');
        logSuccess(`Created conversation #${conversationId}.`);

        await insertMessage(connection, conversationId, 'user', '[SYSTEM CONTEXT - should not be shared]\nHidden data');
        await insertMessage(connection, conversationId, 'user', 'What is the price of Aspirin?');
        await insertMessage(connection, conversationId, 'assistant', 'DoseFinder records list the requested Aspirin pricing details.');
        await insertMessage(connection, conversationId, 'system', 'Visible system notice');
        logSuccess('Inserted deterministic chat messages.');

        const outsiderShare = await apiRequest(`/api/ai/conversations/${conversationId}/share`, 'POST', null, outsider.token);
        expect(outsiderShare.status === 404, `Expected outsider share to return 404, got ${outsiderShare.status}.`);
        logSuccess('Another user cannot share the owner conversation.');

        const shareResponse = await apiRequest(`/api/ai/conversations/${conversationId}/share`, 'POST', null, owner.token);
        expect(shareResponse.ok, `Share request failed: ${JSON.stringify(shareResponse.data)}`);
        const share = shareResponse.data?.data?.share;
        expect(share?.token && share?.urlPath, 'Share token/path was not returned.');
        logSuccess(`Created share ${share.urlPath}.`);

        const publicRead = await apiRequest(`/api/ai/shared-chats/${share.token}`, 'GET');
        expect(publicRead.ok, `Public read failed: ${JSON.stringify(publicRead.data)}`);
        const sharedChat = publicRead.data?.data?.sharedChat;
        const sharedMessages = sharedChat?.messages ?? [];
        expect(sharedChat?.title === 'Share Snapshot Test', `Unexpected shared title: ${sharedChat?.title}`);
        expect(sharedMessages.length === 3, `Expected 3 visible messages, got ${sharedMessages.length}.`);
        expect(!sharedMessages.some((message) => message.content.startsWith('[SYSTEM CONTEXT')), 'Hidden system context was shared.');
        expect(sharedMessages.some((message) => message.content === 'Visible system notice'), 'Visible system notice was not copied.');
        logSuccess('Public read returns the immutable visible snapshot without auth.');

        const renameResponse = await apiRequest(`/api/ai/conversations/${conversationId}/title`, 'PUT', {
            title: 'Renamed After Share',
        }, owner.token);
        expect(renameResponse.ok, `Rename failed: ${JSON.stringify(renameResponse.data)}`);

        const deleteResponse = await apiRequest(`/api/ai/conversations/${conversationId}`, 'DELETE', null, owner.token);
        expect(deleteResponse.ok, `Delete failed: ${JSON.stringify(deleteResponse.data)}`);

        const afterDeleteRead = await apiRequest(`/api/ai/shared-chats/${share.token}`, 'GET');
        expect(afterDeleteRead.ok, `Public read after delete failed: ${JSON.stringify(afterDeleteRead.data)}`);
        expect(afterDeleteRead.data?.data?.sharedChat?.title === 'Share Snapshot Test', 'Shared snapshot title changed after original rename/delete.');
        expect((afterDeleteRead.data?.data?.sharedChat?.messages ?? []).length === 3, 'Shared messages changed after original delete.');
        logSuccess('Snapshot survives original conversation rename and delete.');

        const invalidRead = await apiRequest('/api/ai/shared-chats/not-a-real-token', 'GET');
        expect(invalidRead.status === 404, `Expected invalid token to return 404, got ${invalidRead.status}.`);
        logSuccess('Invalid share token returns 404.');

        log(`${colors.green}CHAT SHARE SNAPSHOT TEST PASSED.${colors.reset}`);
    } catch (error) {
        console.error(`${colors.red}CHAT SHARE SNAPSHOT TEST FAILED:${colors.reset}`, error.message);
        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end().catch(() => {});
        } else {
            logWarn('No MySQL connection was opened.');
        }
    }
}

run();
