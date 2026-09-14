const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function tempTest() {
    try {
        console.log('1. Registering temp user...');
        const guestRes = await fetch(`${BASE_URL}/api/auth/new-guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const { data: { guestUsername, guestAuthToken } } = await guestRes.json();

        const timestamp = Date.now();
        const registerRes = await fetch(`${BASE_URL}/api/auth/register-guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guestUsername,
                guestAuthToken,
                username: `temp_${timestamp}`,
                email: `temp_${timestamp}@test.com`,
                password: 'Password123!'
            })
        });
        const { data: { token } } = await registerRes.json();

        console.log('2. Testing Drug API Search...');
        const searchRes = await fetch(`${BASE_URL}/api/drugs/search?q=Aspirin&per_page=1`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const searchData = await searchRes.json();
        console.log('Search Response Status:', searchRes.status);
        console.log('Search Response Body:', JSON.stringify(searchData, null, 2));

    } catch (e) {
        console.error('Test script crashed:', e);
    }
}
tempTest();
