const express = require('express');
const AIController = require('../controllers/ai.controller');
const { verifyToken, requireAIChatAccess } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/shared-chats/:token', AIController.getSharedChat);

router.use(verifyToken);
router.use(requireAIChatAccess);

router.post('/new-chat', AIController.newChat);
router.post('/temporary-message', AIController.sendTemporaryMessage);
router.get('/conversations', AIController.getConversations);
router.get('/conversations/:conversationId/messages', AIController.getMessages);
router.post('/conversations/:conversationId/message', AIController.sendMessage);
router.post('/conversations/:conversationId/share', AIController.shareConversation);
router.put('/conversations/:conversationId/title', AIController.updateTitle);
router.delete('/conversations/:conversationId', AIController.deleteConversation);

module.exports = router;
