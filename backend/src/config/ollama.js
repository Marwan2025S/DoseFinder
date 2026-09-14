const { OLLAMA } = require('./constants');

const normalizeBaseUrl = (baseUrl) => baseUrl.replace(/\/+$/, '');
const isCloudModel = (model = '') => model.trim().toLowerCase().endsWith('-cloud');

const buildOllamaUrl = (endpoint) => {
    const baseUrl = OLLAMA.BASE_URL
        ? normalizeBaseUrl(OLLAMA.BASE_URL)
        : OLLAMA.API_KEY && isCloudModel(OLLAMA.DEFAULT_MODEL)
            ? 'https://ollama.com'
            : `http://${OLLAMA.HOST}:${OLLAMA.PORT}`;

    return `${baseUrl}${endpoint}`;
};

const OLLAMA_ENDPOINTS = {
    GENERATE: buildOllamaUrl('/api/generate'),
    CHAT: buildOllamaUrl('/api/chat'),
    TAGS: buildOllamaUrl('/api/tags'),
    SHOW: buildOllamaUrl('/api/show')
};

module.exports = {
    OLLAMA_ENDPOINTS,
    DEFAULT_BASE_URL: OLLAMA.BASE_URL
        ? normalizeBaseUrl(OLLAMA.BASE_URL)
        : OLLAMA.API_KEY && isCloudModel(OLLAMA.DEFAULT_MODEL)
            ? 'https://ollama.com'
            : `http://${OLLAMA.HOST}:${OLLAMA.PORT}`,
    DEFAULT_MODEL: OLLAMA.DEFAULT_MODEL,
    IS_CLOUD_MODEL: isCloudModel(OLLAMA.DEFAULT_MODEL),
    REQUEST_HEADERS: OLLAMA.API_KEY ? { Authorization: `Bearer ${OLLAMA.API_KEY}` } : {},
    TIMEOUT: OLLAMA.TIMEOUT_MS
};
