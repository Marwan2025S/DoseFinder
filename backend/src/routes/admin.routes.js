const express = require('express');
const AdminController = require('../controllers/admin.controller');
const { verifyToken, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(verifyToken);
router.use(requireRole(['admin']));

router.get('/summary', AdminController.getSummary);

router.get('/users', AdminController.listUsers);
router.get('/users/:userId', AdminController.getUserById);
router.patch('/users/:userId/status', AdminController.updateUserStatus);
router.post('/users/:userId/resend-verification', AdminController.resendUserVerification);

router.get('/drugs', AdminController.listDrugs);
router.get('/drugs/:drugId', AdminController.getDrugById);
router.patch('/drugs/:drugId/flags', AdminController.updateDrugFlags);
router.get('/drugs/:drugId/versions', AdminController.listDrugVersions);
router.get('/drugs/:drugId/versions/:versionNumber', AdminController.getDrugVersion);
router.put('/drugs/:drugId/current-version', AdminController.promoteDrugVersion);

router.get('/doctors', AdminController.listDoctors);
router.get('/doctors/:userId', AdminController.getDoctorById);
router.patch('/doctors/:userId/verification', AdminController.updateDoctorVerification);

router.get('/audit', AdminController.listAuditEvents);

module.exports = router;
