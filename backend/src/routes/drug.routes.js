const express = require('express');
const multer = require('multer');
const router = express.Router();
const DrugController = require('../controllers/drug.controller');
const { verifyToken, requireVerifiedEmail, requireApprovedDoctor } = require('../middleware/auth.middleware');
const DrugExtractController = require('../controllers/drug.extract.controller');
const { DrugExtractService } = require('../services/drug-extract.service');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: DrugExtractService.MAX_UPLOAD_FILE_SIZE,
    },
    fileFilter: (req, file, cb) => {
        if (DrugExtractService.isSupportedUpload(file)) {
            cb(null, true);
            return;
        }

        const error = new Error(DrugExtractService.buildUnsupportedFileMessage());
        error.status = 400;
        cb(error);
    },
});

function handleExtractUpload(req, res, next) {
    upload.single('file')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }

        if (error instanceof multer.MulterError) {
            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    success: false,
                    error: 'Uploaded file is too large. The maximum supported size is 10 MB.'
                });
            }

            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        return res.status(error.status || 400).json({
            success: false,
            error: error.message || 'Failed to process uploaded file.'
        });
    });
}

// Protect all drug routes - only authenticated users can access the database directly
router.use(verifyToken);

// Search endpoint (Supports query parameters: q, dosage_form, min_price, max_price, page, per_page)
router.get('/search', DrugController.searchDrugs);
// Get specific drug details
router.get('/:drugId', DrugController.getDrugById);
// Get drug sub-resources
router.get('/:drugId/routes', DrugController.getDrugRoutes);
router.get('/:drugId/indications', DrugController.getDrugIndications);
router.get('/:drugId/interactions', DrugController.getDrugInteractions);
router.use(requireVerifiedEmail);
router.use(requireApprovedDoctor);
// Create a new drug record
router.post('/', DrugController.createDrug);
// Update specific drug details
router.put('/:drugId', DrugController.updateDrug);
// Update drug visibility (doctors and admins)
router.patch('/:drugId/visibility', DrugController.updateDrugVisibility);
router.post('/extract', DrugExtractController.extractFromText);
router.post('/extract-file', handleExtractUpload, DrugExtractController.extractFromFile);
router.post('/add', DrugExtractController.addDrug);

module.exports = router;
