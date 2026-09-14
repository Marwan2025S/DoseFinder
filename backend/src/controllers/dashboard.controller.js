const DashboardModel = require('../models/dashboard.model');
const logger = require('../utils/logger');

class DashboardController {
    static async getDoctorDashboard(req, res) {
        try {
            const data = await DashboardModel.getDoctorSummary();
            return res.status(200).json({
                success: true,
                data
            });
        } catch (error) {
            logger.error('[DashboardController] Error loading doctor dashboard:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to load doctor dashboard',
                message: error.message
            });
        }
    }
}

module.exports = DashboardController;
