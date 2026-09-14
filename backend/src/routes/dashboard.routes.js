const express = require('express');
const DashboardController = require('../controllers/dashboard.controller');
const { verifyToken, requireVerifiedEmail, requireApprovedDoctor } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(verifyToken);

router.get('/doctor', requireVerifiedEmail, requireApprovedDoctor, DashboardController.getDoctorDashboard);

module.exports = router;
