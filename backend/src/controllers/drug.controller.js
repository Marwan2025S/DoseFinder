const DrugService = require('../services/drug.service');
const AdminModel = require('../models/admin.model');
const SearchHistoryModel = require('../models/search_history.model');
const logger = require('../utils/logger');
const { attachDoctorsToDrugSearchResults } = require('../utils/drugDoctorMeta');
const {
    filterDrugSearchPayloadForUser,
    requireDrugAccess,
    shouldExposeDrugFlags,
    getDrugFlags
} = require('../utils/drugAccess');

const shouldIncludeDoctorMetadata = (value) => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());

const buildMutationPayload = (req) => {
    const payload = { ...(req.body || {}) };
    const actorId = Number(req.user?.id);

    delete payload.fda_ids;
    delete payload.fda_payload_hashes;

    // Doctor-authored changes should always be attributed to the authenticated doctor.
    if (req.user?.role === 'doctor' && Number.isInteger(actorId) && actorId > 0) {
        payload.doctor_id = actorId;
    }

    return payload;
};

class DrugController {
    /**
     * Create a new drug
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static async createDrug(req, res) {
        try {
            logger.info('[DrugController] Creating new drug');
            const data = await DrugService.createDrug(buildMutationPayload(req));
            res.status(201).json(data);
        } catch (error) {
            logger.error('[DrugController] Error creating drug:', {
                message: error.message,
                status: error.status || error.response?.status,
                data: error.data || error.response?.data
            });
            const status = error.status || error.response?.status || 500;
            res.status(status).json({
                error: 'Failed to create drug',
                details: error.message
            });
        }
    }

    /**
     * Search for drugs based on various filters
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static async searchDrugs(req, res) {
        try {
            logger.info(`[DrugController] Processing searchDrugs request`, req.query);
            const { include_doctor: includeDoctor, ...searchParams } = req.query;
            const data = await DrugService.searchDrugs(searchParams);
            const visibleData = await filterDrugSearchPayloadForUser(data, req.user);
            const responsePayload = shouldIncludeDoctorMetadata(includeDoctor)
                ? await attachDoctorsToDrugSearchResults(visibleData, DrugService.listDrugVersions, {
                    includeEmail: false,
                })
                : visibleData;

            if (req.user && req.query.q) {
                // Log the search history asynchronously
                SearchHistoryModel.logSearch(req.user.id, req.query.q).catch(err => {
                    logger.error('[DrugController] Background error logging search history', err);
                });
            }

            logger.info(`[DrugController] Search returned ${responsePayload.results?.length || 0} results`);
            res.json(responsePayload);
        } catch (error) {
            logger.error('[DrugController] Error in searchDrugs:', error);
            res.status(500).json({
                error: 'Failed to search drugs',
                details: error.message
            });
        }
    }

    /**
     * Get detailed information for a specific drug
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static async getDrugById(req, res) {
        try {
            const { drugId } = req.params;
            logger.info(`[DrugController] Fetching drug details for ID: ${drugId}`);
            const flags = await requireDrugAccess(drugId, req.user);

            const data = await DrugService.getDrugById(drugId);
            if (!data) {
                return res.status(404).json({
                    error: 'Failed to fetch drug details',
                    details: `Drug ${drugId} not found`
                });
            }
            res.json(shouldExposeDrugFlags(req.user) ? { ...data, adminFlags: flags } : data);
        } catch (error) {
            logger.error(`[DrugController] Error fetching drug ID ${req.params.drugId}:`, {
                message: error.message,
                status: error.status || error.response?.status,
                data: error.data || error.response?.data
            });
            // Handle 404 from upstream if applicable, or generic 500
            const status = error.status || (error.response?.status === 404 ? 404 : 500);
            res.status(status).json({
                error: 'Failed to fetch drug details',
                details: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    /**
     * Get all administration routes for a specific drug
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static async getDrugRoutes(req, res) {
        try {
            const { drugId } = req.params;
            logger.info(`[DrugController] Fetching routes for drug ID: ${drugId}`);

            await requireDrugAccess(drugId, req.user);
            const data = await DrugService.getDrugRoutes(drugId);
            res.json(data);
        } catch (error) {
            logger.error(`[DrugController] Error fetching routes for drug ID ${req.params.drugId}:`, error);
            const status = error.status || 500;
            res.status(status).json({
                error: 'Failed to fetch drug routes',
                details: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    /**
     * Get all indications for a specific drug
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static async getDrugIndications(req, res) {
        try {
            const { drugId } = req.params;
            logger.info(`[DrugController] Fetching indications for drug ID: ${drugId}`);

            await requireDrugAccess(drugId, req.user);
            const data = await DrugService.getDrugIndications(drugId);
            res.json(data);
        } catch (error) {
            logger.error(`[DrugController] Error fetching indications for drug ID ${req.params.drugId}:`, error);
            const status = error.status || 500;
            res.status(status).json({
                error: 'Failed to fetch drug indications',
                details: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    /**
     * Get interactions for a specific drug
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static async getDrugInteractions(req, res) {
        try {
            const { drugId } = req.params;
            logger.info(`[DrugController] Fetching interactions for drug ID: ${drugId}`);

            await requireDrugAccess(drugId, req.user);
            const data = await DrugService.getDrugInteractions(drugId);
            res.json(data);
        } catch (error) {
            logger.error(`[DrugController] Error fetching interactions for drug ID ${req.params.drugId}:`, error);
            const status = error.status || 500;
            res.status(status).json({
                error: 'Failed to fetch drug interactions',
                details: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    /**
     * Update a specific drug
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static async updateDrug(req, res) {
        try {
            const { drugId } = req.params;
            logger.info(`[DrugController] Updating drug ID: ${drugId}`);
            await requireDrugAccess(drugId, req.user);
            const data = await DrugService.updateDrug(drugId, buildMutationPayload(req));
            res.json(data);
        } catch (error) {
            logger.error(`[DrugController] Error updating drug ID ${req.params.drugId}:`, {
                message: error.message,
                status: error.status || error.response?.status,
                data: error.data || error.response?.data
            });
            const status = error.status || error.response?.status || 500;
            res.status(status).json({
                error: 'Failed to update drug',
                details: error.status === 404 ? (error.publicMessage || error.message) : error.message
            });
        }
    }

    static async updateDrugVisibility(req, res) {
        try {
            const drugId = Number(req.params.drugId);
            if (!Number.isInteger(drugId) || drugId <= 0) {
                return res.status(400).json({ success: false, message: 'Valid drugId is required' });
            }

            const visibility = String(req.body?.visibility || '').trim();
            if (visibility !== 'visible' && visibility !== 'hidden') {
                return res.status(400).json({ success: false, message: 'visibility must be "visible" or "hidden"' });
            }

            const reason = String(req.body?.reason || '').trim();
            if (!reason) {
                return res.status(400).json({ success: false, message: 'A reason is required' });
            }

            const currentFlags = await getDrugFlags(drugId);
            const reviewStatus = currentFlags?.reviewStatus || 'published';

            const flags = await AdminModel.setDrugFlags({
                drugId,
                visibility,
                reviewStatus,
                adminNotes: currentFlags?.adminNotes,
                actorUserId: req.user.id,
                reason,
            });

            res.status(200).json({ success: true, message: 'Visibility updated successfully.', data: flags });
        } catch (error) {
            logger.error(`[DrugController] Error updating visibility for drug ${req.params.drugId}:`, error);
            res.status(error.status || 500).json({ success: false, message: error.message });
        }
    }
}

module.exports = DrugController;
