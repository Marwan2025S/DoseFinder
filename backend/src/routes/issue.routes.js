const express = require('express');
const IssueController = require('../controllers/issue.controller');
const { verifyToken, requireVerifiedEmail, requireApprovedDoctor } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(verifyToken);

router.post('/', requireVerifiedEmail, IssueController.createIssue);
router.get('/mine', requireVerifiedEmail, IssueController.listMyIssues);

router.get('/', requireVerifiedEmail, requireApprovedDoctor, IssueController.listIssues);
router.get('/:issueId', requireVerifiedEmail, requireApprovedDoctor, IssueController.getIssueById);
router.post('/:issueId/close', requireVerifiedEmail, requireApprovedDoctor, IssueController.closeIssue);
router.post('/:issueId/fix', requireVerifiedEmail, requireApprovedDoctor, IssueController.fixIssue);

module.exports = router;
