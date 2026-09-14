const axios = require('axios');
const CONSTANTS = require('../config/constants');
const logger = require('../utils/logger');

const apiClient = axios.create({
    baseURL: CONSTANTS.DRUG_API.URL,
    timeout: 10000,
});

function parseStringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    if (typeof value !== 'string') return [];
    const raw = value.trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
        }
    } catch {
        // Fall through to comma splitting.
    }
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueObjects(items, keyName) {
    const seen = new Set();
    return items.reduce((result, item) => {
        const value = String(item?.[keyName] ?? '').trim();
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return result;
        seen.add(key);
        result.push(item);
        return result;
    }, []);
}

function stripInternalDrugMetadata(payload) {
    if (Array.isArray(payload)) {
        return payload.map(stripInternalDrugMetadata);
    }

    if (!payload || typeof payload !== 'object') {
        return payload;
    }

    return Object.fromEntries(
        Object.entries(payload)
            .filter(([key]) => key !== 'fda_ids' && key !== 'fda_payload_hashes')
            .map(([key, value]) => [key, stripInternalDrugMetadata(value)])
    );
}

function stripInternalMutationFields(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }

    const cleanPayload = { ...payload };
    delete cleanPayload.fda_ids;
    delete cleanPayload.fda_payload_hashes;
    return cleanPayload;
}

class DrugService {
    static buildRequestError(error, fallbackMessage) {
        const detail = error.response?.data?.detail;
        const message = typeof detail === 'string'
            ? detail
            : detail
                ? JSON.stringify(detail)
                : fallbackMessage;
        const requestError = new Error(message);
        requestError.status = error.response?.status || 500;
        requestError.data = error.response?.data;
        requestError.response = error.response;
        return requestError;
    }

    /**
     * Health check endpoint
     * @returns {Promise<Object>} Health status
     */
    static async healthCheck() {
        try {
            const response = await apiClient.get('/health');
            return response.data;
        } catch (error) {
            logger.error('[DrugService] Error checking health:', error.message);
            throw new Error('Failed to verify drug database health');
        }
    }

    /**
     * Get database statistics
     * @returns {Promise<Object>} Statistics data
     */
    static async getStatistics() {
        try {
            const response = await apiClient.get('/stats');
            return response.data;
        } catch (error) {
            logger.error('[DrugService] Error fetching stats:', error.message);
            throw new Error('Failed to fetch drug database statistics');
        }
    }

    /**
     * Search for drugs with optional URL parameters and Request Body filters
     * @param {Object} params - Query parameters for searching (e.g., q, page, per_page, dosage_form)
     * @param {Object} [filters] - Complex search filters sent in request body (e.g., arrays for routes/indications)
     * @returns {Promise<Object>} Paginated search results
     */
    static async searchDrugs(params, filters = null) {
        try {
            const config = { params };
            if (filters) {
                config.data = filters; // Axios lets you pass body data in GET via config
            }
            const response = await apiClient.get('/drugs/search', config);
            return stripInternalDrugMetadata(response.data);
        } catch (error) {
            logger.error('[DrugService] Error searching drugs:', error.message);
            throw new Error('Failed to fetch drugs from database');
        }
    }

    /**
     * Get detailed information for a specific drug
     * @param {number} drugId - The ID of the drug
     * @returns {Promise<Object|null>} Drug details or null if not found
     */
    static async getDrugById(drugId) {
        try {
            const response = await apiClient.get(`/drugs/${drugId}`);
            return stripInternalDrugMetadata(response.data);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            logger.error(`[DrugService] Error fetching drug ${drugId}:`, error.message);
            throw new Error(`Failed to fetch drug details for ID ${drugId}`);
        }
    }

    /**
     * Get all administration routes for a specific drug
     * @param {number} drugId - The ID of the drug
     * @returns {Promise<Array>} List of routes
     */
    static async getDrugRoutes(drugId) {
        try {
            const response = await apiClient.get(`/drugs/${drugId}`);
            const extension = Array.isArray(response.data?.drug_dms_extensions)
                ? response.data.drug_dms_extensions[0]
                : null;
            return uniqueObjects(parseStringArray(extension?.route).map((route) => ({
                route_name: route,
                normalized_route: route,
                raw_route: route,
            })), 'route_name');
        } catch (error) {
            logger.error(`[DrugService] Error fetching drug routes ${drugId}:`, error.message);
            throw new Error(`Failed to fetch routes for drug ID ${drugId}`);
        }
    }

    /**
     * Get all indications for a specific drug
     * @param {number} drugId - The ID of the drug
     * @returns {Promise<Array>} List of indications
     */
    static async getDrugIndications(drugId) {
        try {
            const response = await apiClient.get(`/drugs/${drugId}`);
            const dosing = Array.isArray(response.data?.dosing) ? response.data.dosing : [];
            return uniqueObjects(dosing.map((entry) => ({
                indication_name: entry.indication,
                normalized_indication: entry.indication,
                raw_indication: entry.indication,
            })), 'indication_name');
        } catch (error) {
            logger.error(`[DrugService] Error fetching drug indications ${drugId}:`, error.message);
            throw new Error(`Failed to fetch indications for drug ID ${drugId}`);
        }
    }

    /**
     * Get all interactions for a specific drug
     * @param {number} drugId - The ID of the drug
     * @returns {Promise<Array>} List of interactions
     */
    static async getDrugInteractions(drugId) {
        try {
            const response = await apiClient.get(`/drugs/${drugId}/interactions`);
            return response.data;
        } catch (error) {
            logger.error(`[DrugService] Error fetching drug interactions ${drugId}:`, error.message);
            throw new Error(`Failed to fetch interactions for drug ID ${drugId}`);
        }
    }

    /**
     * Create a new drug with optional sub-tables
     * @param {Object} drugData - The data of the drug to create
     * @returns {Promise<Object>} Created drug data
     */
    static async createDrug(drugData) {
        try {
            const response = await apiClient.post('/drugs', stripInternalMutationFields(drugData));
            return stripInternalDrugMetadata(response.data);
        } catch (error) {
            logger.error('[DrugService] Error creating drug:', error.response?.data || error.message);
            if (error.response) {
                throw DrugService.buildRequestError(error, 'Failed to create drug');
            }
            throw new Error('Failed to create drug');
        }
    }

    /**
     * Update an existing drug (partial updates allowed)
     * @param {number} drugId - The ID of the drug
     * @param {Object} drugData - The data to update
     * @returns {Promise<Object>} Updated drug data
     */
    static async updateDrug(drugId, drugData) {
        try {
            const response = await apiClient.put(`/drugs/${drugId}`, stripInternalMutationFields(drugData));
            return stripInternalDrugMetadata(response.data);
        } catch (error) {
            logger.error(`[DrugService] Error updating drug ${drugId}:`, error.response?.data || error.message);
            if (error.response) {
                throw DrugService.buildRequestError(error, `Failed to update drug ${drugId}`);
            }
            throw new Error(`Failed to update drug ${drugId}`);
        }
    }

    /**
     * Delete drug and all related records
     * @param {number} drugId - The ID of the drug
     * @returns {Promise<Object>} Success message
     */
    static async deleteDrug(drugId) {
        try {
            const response = await apiClient.delete(`/drugs/${drugId}`);
            return response.data;
        } catch (error) {
            logger.error(`[DrugService] Error deleting drug ${drugId}:`, error.response?.data || error.message);
            if (error.response) {
                throw DrugService.buildRequestError(error, `Failed to delete drug ${drugId}`);
            }
            throw new Error(`Failed to delete drug ${drugId}`);
        }
    }

    /**
     * List every stored version for a drug.
     * @param {number} drugId - The ID of the drug
     * @returns {Promise<Array>} Version rows
     */
    static async listDrugVersions(drugId) {
        try {
            const response = await apiClient.get(`/drugs/${drugId}/versions`);
            return response.data;
        } catch (error) {
            logger.error(`[DrugService] Error fetching versions for drug ${drugId}:`, error.response?.data || error.message);
            if (error.response) {
                throw DrugService.buildRequestError(error, `Failed to fetch versions for drug ${drugId}`);
            }
            const requestError = new Error(`Failed to fetch versions for drug ${drugId}`);
            requestError.status = 500;
            throw requestError;
        }
    }

    /**
     * Fetch a specific stored version for a drug.
     * @param {number} drugId - The ID of the drug
     * @param {number} versionNumber - The stored version number
     * @returns {Promise<Object>} Full version snapshot
     */
    static async getDrugVersion(drugId, versionNumber) {
        try {
            const response = await apiClient.get(`/drugs/${drugId}/versions/${versionNumber}`);
            return response.data;
        } catch (error) {
            logger.error(
                `[DrugService] Error fetching version ${versionNumber} for drug ${drugId}:`,
                error.response?.data || error.message
            );
            if (error.response) {
                throw DrugService.buildRequestError(
                    error,
                    `Failed to fetch version ${versionNumber} for drug ${drugId}`
                );
            }
            const requestError = new Error(`Failed to fetch version ${versionNumber} for drug ${drugId}`);
            requestError.status = 500;
            throw requestError;
        }
    }

    /**
     * Promote a stored version to become current.
     * @param {number} drugId - The ID of the drug
     * @param {number} versionNumber - The version number to promote
     * @returns {Promise<Object>} Promotion response
     */
    static async promoteDrugVersion(drugId, versionNumber) {
        try {
            const response = await apiClient.post(`/drugs/${drugId}/versions/${versionNumber}/promote`);
            return response.data;
        } catch (error) {
            logger.error(`[DrugService] Error promoting version ${versionNumber} for drug ${drugId}:`, error.message);
            if (error.response && error.response.status === 404) {
                const notFoundError = new Error(`Drug ${drugId} or version ${versionNumber} not found`);
                notFoundError.status = 404;
                throw notFoundError;
            }
            if (error.response && error.response.status === 400) {
                const validationError = new Error(error.response.data.detail || 'Validation Error');
                validationError.status = 400;
                throw validationError;
            }
            const requestError = new Error(`Failed to promote version ${versionNumber} for drug ${drugId}`);
            requestError.status = error.response?.status || 500;
            throw requestError;
        }
    }

    /**
     * Search drugs by name for the AI chatbot tool.
     * Returns a slim, model-friendly summary of each matching record.
     * @param {string} query - Search term (generic, brand, or Arabic trade name)
     * @param {number} limit - Max results (capped at 10)
     * @param {Object|null} user - Authenticated user (for future access-flag filtering)
     * @returns {Promise<Object>} { ok, results, total, query }
     */
    static async searchForChatbot(query, limit = 5, user = null) {
        const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 5), 10);
        const safeQuery = String(query || '').trim().substring(0, 100);

        if (!safeQuery) {
            return { ok: false, error: 'Query is required.' };
        }

        try {
            const response = await apiClient.get('/drugs/search', {
                params: { q: safeQuery, limit: safeLimit },
            });

            const results = (response.data?.results || []).map((drug) => {
                const forms = (drug.dosage_forms || [])
                    .map((f) => [f.form_name, f.strength_text].filter(Boolean).join(' '))
                    .filter(Boolean);
                const classes = (drug.classes || []).map((c) => c.class_name).filter(Boolean);

                return {
                    drug_id: drug.drug_id,
                    generic_name: drug.generic_name,
                    brand_names: drug.brand_names || null,
                    arabic_trade_name: drug.arabic_trade_name || null,
                    rx_status: drug.rx_status || null,
                    route: drug.route || null,
                    price: drug.price ?? null,
                    dosage_forms: forms.length ? forms : null,
                    classes: classes.length ? classes : null,
                    source: drug.source || null,
                };
            });

            return {
                ok: true,
                query: safeQuery,
                total: response.data?.total ?? results.length,
                results,
            };
        } catch (error) {
            logger.error('[DrugService.searchForChatbot] Error:', error.message);
            return { ok: false, error: 'Drug search failed. Please try again.' };
        }
    }
}


module.exports = DrugService;
