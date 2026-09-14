const logger = require('../utils/logger');
const { DrugExtractService, DrugExtractionError } = require('../services/drug-extract.service');

function handleExtractionError(err, res) {
    if (err instanceof DrugExtractionError) {
        const payload = {
            success: false,
            error: err.message,
        };

        if (err.raw) {
            payload.raw = err.raw;
        }

        return res.status(err.status).json(payload);
    }

    logger.error('[DrugExtract] Error:', err.message);
    return res.status(500).json({
        success: false,
        error: err.message
    });
}

class DrugExtractController {

    static async extractFromText(req, res) {
        try {
            const extracted = await DrugExtractService.extractFromText(req.body.text);
            return res.status(200).json({
                success: true,
                data: extracted
            });
        } catch (err) {
            return handleExtractionError(err, res);
        }
    }

    static async extractFromFile(req, res) {
        try {
            const extracted = await DrugExtractService.extractFromFile(req.file);
            return res.status(200).json({
                success: true,
                data: extracted
            });
        } catch (err) {
            return handleExtractionError(err, res);
        }
    }

    static async addDrug(req, res) {
        return res.status(410).json({
            success: false,
            error: 'Legacy endpoint retired',
            message: 'Use POST /api/drugs with the unified drug schema payload.'
        });
    }
}

module.exports = DrugExtractController;
