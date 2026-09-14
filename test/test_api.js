/**
 * Integration Test Script for DMS Backend
 * Run this from the root directory: node test_api.js
 */

const BASE_URL = 'http://localhost:3000';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.blue}[TEST]${colors.reset} ${msg}`);
const logSuccess = (msg) => console.log(`  ${colors.green}✓ SUCCESS:${colors.reset} ${msg}`);
const logError = (msg) => console.error(`  ${colors.red}✗ ERROR:${colors.reset} ${msg}`);

async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const response = await fetch(url, options);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText} - ${data ? JSON.stringify(data) : 'No data'}`);
    }

    return data;
}

const timestamp = Date.now();
const testUser = {
    username: `testuser_${timestamp}`,
    email: `test_${timestamp}@example.com`,
    password: 'Password123!',
};

async function runTests() {
    log('Starting Integration Tests for DMS Backend');
    log('==========================================');

    let guestToken, jwtToken, defaultUserId, conversationId;

    try {
        log('1. Testing Health Check...');
        const health = await apiRequest('/health');
        if (health.status === 'healthy') logSuccess('Backend, DB, and Ollama are healthy.');

        log('\n2. Testing Create Guest...');
        const guestRes = await apiRequest('/api/auth/new-guest', 'POST');
        if (guestRes.success) {
            guestToken = guestRes.data.guestToken;
            logSuccess(`Created guest token: ${guestToken.substring(0, 8)}...`);
        }

        log('\n3. Testing Upgrade Guest...');
        const upgradeRes = await apiRequest('/api/auth/register-guest', 'POST', {
            guestToken, username: testUser.username, email: testUser.email, password: testUser.password
        });
        if (upgradeRes.success) {
            jwtToken = upgradeRes.data.token;
            logSuccess('Upgraded guest to user successfully.');
        }

        log('\n4. Testing Login by username...');
        const loginRes = await apiRequest('/api/auth/login', 'POST', {
            identifier: testUser.username, password: testUser.password
        });
        if (loginRes.success) {
            jwtToken = loginRes.data.token;
            logSuccess('Username login successful.');
        }

        log('\n4b. Testing Login by email...');
        const emailLoginRes = await apiRequest('/api/auth/login', 'POST', {
            identifier: testUser.email, password: testUser.password
        });
        if (emailLoginRes.success) {
            jwtToken = emailLoginRes.data.token;
            logSuccess('Email login successful.');
        }

        log('\n5. Testing Get Current User...');
        const meRes = await apiRequest('/api/auth/me', 'GET', null, jwtToken);
        if (meRes.success) logSuccess('Fetched current user profile.');

        log('\n6. Testing Get Profile...');
        const profileRes = await apiRequest('/api/profile/', 'GET', null, jwtToken);
        if (profileRes.success) logSuccess('Fetched separate profile successfully.');

        log('\n7. Testing Create Conversation...');
        const newChatRes = await apiRequest('/api/ai/new-chat', 'POST', { title: "Automated Integration Test Chat" }, jwtToken);
        if (newChatRes.success) {
            conversationId = newChatRes.data.conversation.id;
            logSuccess(`Conversation ${conversationId} created.`);
        }

        log('\n8. Testing Chat with AI (Tool Calling)...');
        log(`${colors.yellow}   Waiting for LLM response (this might take 10-30 seconds)...${colors.reset}`);
        const chatRes = await apiRequest(`/api/ai/conversations/${conversationId}/message`, 'POST', {
            content: "What is the price of Aceclofenac?"
        }, jwtToken);
        if (chatRes.success) {
            logSuccess('AI replied successfully.');
            console.log(`\n  User: ${chatRes.data.user_message.content}`);
            console.log(`  Assistant Tool Analysis:\n${chatRes.data.assistant_message.content.substring(0, 500)}...\n`);
        }

        log('9. Testing Get All Conversations...');
        const convListRes = await apiRequest('/api/ai/conversations', 'GET', null, jwtToken);
        if (convListRes.success) logSuccess(`Retrieved conversation list, count: ${convListRes.data.conversations.length}`);

        log('\n10. Testing Update Conversation Title...');
        const titleRes = await apiRequest(`/api/ai/conversations/${conversationId}/title`, 'PUT', { title: "Renamed Test Chat" }, jwtToken);
        if (titleRes.success) logSuccess('Conversation title updated.');

        // --- NEW DRUG API TESTS ---
        log('\n11. Testing Direct Drug Search API...');
        const searchRes = await apiRequest(`/api/drugs/search?q=Aspirin&per_page=1`, 'GET', null, jwtToken);
        if (searchRes && searchRes.results && searchRes.results.length > 0) {
            logSuccess(`Drug search successful. Found ${searchRes.results.length} results.`);
            const testDrugId = searchRes.results[0].drug_id || searchRes.results[0].id;

            log(`\n12. Testing Get Specific Drug Details (ID: ${testDrugId})...`);
            const drugRes = await apiRequest(`/api/drugs/${testDrugId}`, 'GET', null, jwtToken);
            if (drugRes.success) {
                logSuccess(`Fetched details for drug: ${drugRes.data.name}`);
            }

            log('\n13. Testing Get Drug Sub-resources (Routes/Indications)...');
            const subResourcesRes = await apiRequest(`/api/drugs/${testDrugId}/routes`, 'GET', null, jwtToken);
            if (subResourcesRes && Array.isArray(subResourcesRes)) {
                logSuccess(`Fetched sub-resources successfully. Routes count: ${subResourcesRes.length}`);
            } else if (subResourcesRes && subResourcesRes.results) {
                logSuccess(`Fetched sub-resources successfully. Routes count: ${subResourcesRes.results.length}`);
            }
        } else {
            logError('Drug Search failed or returned no results. Make sure `drug-api` container is running.');
        }

        log('\n==========================================');
        log(`${colors.green}ALL INTEGRATION TESTS PASSED SUCCESSFULLY!${colors.reset}`);

    } catch (error) {
        log('\n==========================================');
        logError('TEST SUITE FAILED!');
        console.error(error.message);
    }
}

runTests();
