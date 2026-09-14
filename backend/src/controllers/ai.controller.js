const crypto = require('crypto');
const ChatModel = require('../models/chat.model');
const OllamaService = require('../services/ollama.service');
const { LIMITS } = require('../config/constants');
const { encodeMessageSources, decodeMessageSources, stripMessageSources } = require('../utils/chat-sources');
const logger = require('../utils/logger');

class AIController {
    static hiddenContextPrefix = '[SYSTEM CONTEXT';
    static shareTokenPattern = /^[A-Za-z0-9_-]{32,}$/;
    static strictGroundingSystemMessage = [
        'You are DoseGPT, a helpful drug-information assistant inside DoseFinder.',
        'For greetings, small talk, or meta questions about yourself, respond warmly and naturally — do NOT call any tools.',
        'Use searchDrugs for ANY question related to drugs or medications:',
        '  - A drug name (generic or brand) → search the name.',
        '  - A medical condition → search by drug class name: "antihypertensive" for hypertension, "antidiabetic" for diabetes, "antibiotic" for infection, "analgesic" for pain, "statin" for cholesterol, "ACE inhibitor" for heart failure.',
        '  - A symptom or side effect → search the symptom.',
        '  - A drug class (e.g. "beta blocker", "ACE inhibitor") → search the class name.',
        'The search engine covers ALL drug fields: name, indications, adverse effects, warnings, drug classes, pharmacology, and more.',
        'Call searchDrugs silently — do not say "Let me look up" or "I will search". Just call the tool and answer from the returned results.',
        'If searchDrugs returns results, give a clear, structured answer: drug names, what they treat, price (if available), route, dosage forms, and Rx status.',
        'If the question is about drugs that treat a condition, list the returned drugs and explain briefly what each one is used for.',
        'If searchDrugs returns no results, retry with the drug class name (e.g. "antihypertensive" instead of "hypertension"). If still empty, say DoseFinder did not find a match and invite the user to search by a specific drug name.',
        'Never invent drug facts. Only report what is in the searchDrugs results.',
        'IMPORTANT: If the returned drugs are clearly unrelated to what the user asked (e.g. the user asked about blood pressure but results are antiseptics or disinfectants), do NOT suggest indirect or speculative medical connections. Instead say: "DoseFinder did not find drugs specifically used to treat [condition]. Try searching by a specific drug name such as lisinopril or amlodipine."',
        'Never show raw JSON, tool call names, or error messages to the user.',
        'For questions completely outside drug information, politely explain you specialise in drug data and invite a drug-related question.',
    ].join(' ');

    static buildSystemFailureMessage() {
        return 'I could not complete the AI response this time, but your message was saved. Please try again.';
    }

    static generateShareToken() {
        return crypto.randomBytes(32).toString('base64url');
    }

    static hashShareToken(token) {
        return crypto.createHash('sha256').update(String(token)).digest('hex');
    }

    static buildGroundedOllamaMessages(messages = []) {
        const sanitizedMessages = Array.isArray(messages)
            ? messages.filter((message) => message && typeof message.content === 'string' && typeof message.role === 'string')
            : [];

        return [
            {
                role: 'system',
                content: AIController.strictGroundingSystemMessage
            },
            ...sanitizedMessages
        ];
    }

    static normalizeMessageContent(content) {
        if (typeof content !== 'string') return '';
        return content.trim();
    }

    static validateMessageContent(content) {
        const normalizedContent = AIController.normalizeMessageContent(content);

        if (!normalizedContent) {
            const error = new Error('Message content is required');
            error.status = 400;
            throw error;
        }

        if (normalizedContent.length > LIMITS.MESSAGE_MAX_LENGTH) {
            const error = new Error(`Message exceeds maximum length of ${LIMITS.MESSAGE_MAX_LENGTH} characters`);
            error.status = 400;
            throw error;
        }

        return normalizedContent;
    }

    static validateAssistantMessageContent(content) {
        const normalizedContent = AIController.normalizeMessageContent(content);

        if (!normalizedContent) {
            throw new Error('AI model returned an empty response.');
        }

        return normalizedContent;
    }

    static trimChatContextMessages(messages = []) {
        if (messages.length <= LIMITS.CHAT_CONTEXT_MAX_MESSAGES) {
            return messages;
        }

        const firstMessage = messages[0];
        const shouldPreserveHiddenContext = typeof firstMessage?.content === 'string'
            && firstMessage.content.startsWith(AIController.hiddenContextPrefix);

        if (!shouldPreserveHiddenContext) {
            return messages.slice(-LIMITS.CHAT_CONTEXT_MAX_MESSAGES);
        }

        return [
            firstMessage,
            ...messages.slice(-(LIMITS.CHAT_CONTEXT_MAX_MESSAGES - 1))
        ];
    }

    static normalizeTemporaryMessages(messages) {
        if (!Array.isArray(messages) || messages.length === 0) {
            const error = new Error('Temporary chat messages are required');
            error.status = 400;
            throw error;
        }

        const normalizedMessages = messages.map((message) => {
            const role = typeof message?.role === 'string' ? message.role.trim() : '';
            const content = AIController.validateMessageContent(message?.content);

            if (!['user', 'assistant', 'system'].includes(role)) {
                const error = new Error(`Unsupported chat role: ${role || 'unknown'}`);
                error.status = 400;
                throw error;
            }

            return { role, content };
        });

        const trimmedMessages = AIController.trimChatContextMessages(normalizedMessages);
        const lastMessage = trimmedMessages[trimmedMessages.length - 1];

        if (lastMessage?.role !== 'user') {
            const error = new Error('Temporary chat must end with a user message');
            error.status = 400;
            throw error;
        }

        return trimmedMessages;
    }

    static shouldIncludeMessageInAIContext(message) {
        if (!message) return false;

        // Keep persisted failure notices in chat history, but do not feed them
        // back to the model as system instructions on later turns.
        if (message.role === 'system' && message.content === AIController.buildSystemFailureMessage()) {
            return false;
        }

        return true;
    }

    static async shareConversation(req, res, next) {
        logger.info(`[AIController] shareConversation request received for user ${req.user.id}`);
        try {
            const conversationId = parseInt(req.params.conversationId, 10);
            if (!Number.isInteger(conversationId) || conversationId <= 0) {
                return res.status(400).json({ success: false, error: 'Validation Error', message: 'Invalid conversation id' });
            }

            let token = null;
            let share = null;

            for (let attempt = 0; attempt < 3; attempt += 1) {
                token = AIController.generateShareToken();
                const tokenHash = AIController.hashShareToken(token);

                try {
                    share = await ChatModel.createConversationShareSnapshot({
                        userId: req.user.id,
                        conversationId,
                        tokenHash,
                        hiddenContextPrefix: AIController.hiddenContextPrefix
                    });
                    break;
                } catch (error) {
                    if (error?.code === 'ER_DUP_ENTRY' && attempt < 2) {
                        continue;
                    }
                    throw error;
                }
            }

            if (!share) {
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Conversation not found' });
            }

            const urlPath = `/chat/share/${token}`;
            logger.debug(`[AIController] Created chat share ${share.id} from conversation ${conversationId}`);
            return res.status(201).json({
                success: true,
                message: 'Chat share created successfully',
                data: {
                    share: {
                        id: share.id,
                        title: share.title,
                        token,
                        urlPath,
                        messageCount: share.messageCount
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async getSharedChat(req, res, next) {
        logger.info('[AIController] getSharedChat request received');
        try {
            const token = typeof req.params.token === 'string' ? req.params.token.trim() : '';
            if (!AIController.shareTokenPattern.test(token)) {
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Shared chat not found' });
            }

            const sharedChat = await ChatModel.getSharedChatByTokenHash(
                AIController.hashShareToken(token)
            );

            if (!sharedChat) {
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Shared chat not found' });
            }

            return res.status(200).json({
                success: true,
                data: {
                    sharedChat: {
                        id: sharedChat.id,
                        title: sharedChat.title,
                        created_at: sharedChat.created_at,
                        messages: sharedChat.messages.map((message) => {
                            const { content, sources } = decodeMessageSources(message.content);
                            return {
                                id: message.id,
                                role: message.role,
                                content,
                                sources,
                                created_at: message.original_created_at || message.created_at
                            };
                        })
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async newChat(req, res, next) {
        logger.info(`[AIController] newChat request received from user ${req.user.id}`);
        try {
            const { title = 'New Conversation' } = req.body;
            const titleValue = title.substring(0, LIMITS.TITLE_MAX_LENGTH);

            const conversationId = await ChatModel.createConversation(req.user.id, titleValue);

            logger.debug(`[AIController] Created new conversation ${conversationId} for user ${req.user.id}`);
            res.status(201).json({
                success: true,
                message: 'Conversation created successfully',
                data: {
                    conversation: {
                        id: conversationId,
                        title: titleValue,
                        user_id: req.user.id
                    }
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async getConversations(req, res, next) {
        logger.info(`[AIController] getConversations request received for user ${req.user.id}`);
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || LIMITS.PAGINATION_DEFAULT_LIMIT, LIMITS.PAGINATION_MAX_LIMIT);
            const offset = (page - 1) * limit;
            const rawSearchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            const searchQuery = rawSearchQuery.substring(0, LIMITS.CHAT_SEARCH_MAX_LENGTH);

            const conversations = searchQuery
                ? await ChatModel.searchConversationsByUserId(req.user.id, searchQuery, limit, offset)
                : await ChatModel.getConversationsByUserId(req.user.id, limit, offset);

            res.status(200).json({
                success: true,
                data: {
                    conversations,
                    pagination: { page, limit },
                    search: searchQuery || null
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async getMessages(req, res, next) {
        logger.info(`[AIController] getMessages request received for user ${req.user.id}`);
        try {
            const conversationId = parseInt(req.params.conversationId);

            // Check ownership
            const conversation = await ChatModel.getConversationByIdAndUserId(conversationId, req.user.id);
            if (!conversation) {
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Conversation not found' });
            }

            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || LIMITS.PAGINATION_DEFAULT_LIMIT, LIMITS.PAGINATION_MAX_LIMIT);
            const offset = (page - 1) * limit;

            const messages = (await ChatModel.getMessagesByConversationId(conversationId, limit, offset))
                .map((message) => {
                    const { content, sources } = decodeMessageSources(message.content);
                    return { ...message, content, sources };
                });

            res.status(200).json({
                success: true,
                data: {
                    conversationId,
                    messages,
                    pagination: { page, limit }
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async sendMessage(req, res, next) {
        logger.info(`[AIController] sendMessage request received for user ${req.user.id}`);
        try {
            const conversationId = parseInt(req.params.conversationId);
            const content = AIController.validateMessageContent(req.body?.content);

            // Check ownership
            const conversation = await ChatModel.getConversationByIdAndUserId(conversationId, req.user.id);
            if (!conversation) {
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Conversation not found' });
            }

            // Save user message
            const userMessageId = await ChatModel.addMessage(conversationId, 'user', content);

            // Fetch history for context
            // In a real app we might limit context window size. Let's fetch the last few messages for context.
            const history = await ChatModel.getMessagesByConversationId(conversationId, 20, 0);

            // Map history for Ollama (sources markers are a storage detail — keep them
            // out of the model context)
            const ollamaMessages = history
                .filter((msg) => AIController.shouldIncludeMessageInAIContext(msg))
                .map(msg => ({
                    role: msg.role,
                    content: stripMessageSources(msg.content)
                }));

            // If history didn't include the current message due to timing or order, add it
            // Ensure Ollama format correctly
            // Send to Ollama
            try {
                const response = await OllamaService.chat(
                    AIController.buildGroundedOllamaMessages(ollamaMessages),
                    undefined,
                    true,
                    0,
                    {},
                    req.user
                );

                if (!response || !response.message) {
                    throw new Error('Invalid response from AI model');
                }

                const assistantMessageContent = AIController.validateAssistantMessageContent(response.message.content);
                const assistantSources = Array.isArray(response.sources) ? response.sources : [];

                // Save assistant message (sources ride along inside the stored content)
                const assistantMessageId = await ChatModel.addMessage(
                    conversationId,
                    'assistant',
                    encodeMessageSources(assistantMessageContent, assistantSources)
                );

                logger.debug(`[AIController] Responded with assistant message ${assistantMessageId} to conversation ${conversationId}`);
                return res.status(200).json({
                    success: true,
                    data: {
                        user_message: { id: userMessageId, role: 'user', content },
                        assistant_message: {
                            id: assistantMessageId,
                            role: 'assistant',
                            content: assistantMessageContent,
                            sources: assistantSources
                        }
                    }
                });
            } catch (aiError) {
                const fallbackSystemMessage = AIController.buildSystemFailureMessage();
                let fallbackSystemMessageId = null;

                logger.error(
                    `[AIController] AI response failed for conversation ${conversationId}, saving fallback system message: ${aiError.message}`
                );

                try {
                    fallbackSystemMessageId = await ChatModel.addMessage(
                        conversationId,
                        'system',
                        fallbackSystemMessage
                    );
                } catch (saveError) {
                    logger.error(
                        `[AIController] Failed to save fallback system message for conversation ${conversationId}: ${saveError.message}`
                    );
                }

                return res.status(200).json({
                    success: true,
                    message: 'Your message was saved, but the AI response failed.',
                    data: {
                        ai_failed: true,
                        user_message: { id: userMessageId, role: 'user', content },
                        assistant_message: {
                            id: fallbackSystemMessageId,
                            role: 'system',
                            content: fallbackSystemMessage,
                            failed: true
                        }
                    }
                });
            }
        } catch (error) {
            next(error);
        }
    }

    static async sendTemporaryMessage(req, res, next) {
        logger.info(`[AIController] sendTemporaryMessage request received for user ${req.user.id}`);
        try {
            const ollamaMessages = AIController.normalizeTemporaryMessages(req.body?.messages);

            try {
                const response = await OllamaService.chat(
                    AIController.buildGroundedOllamaMessages(ollamaMessages),
                    undefined,
                    true,
                    0,
                    {},
                    req.user
                );

                if (!response || !response.message) {
                    throw new Error('Invalid response from AI model');
                }

                const assistantMessageContent = AIController.validateAssistantMessageContent(response.message.content);

                return res.status(200).json({
                    success: true,
                    message: 'Temporary chat response generated successfully',
                    data: {
                        temporary: true,
                        assistant_message: {
                            role: 'assistant',
                            content: assistantMessageContent,
                            sources: Array.isArray(response.sources) ? response.sources : []
                        }
                    }
                });
            } catch (aiError) {
                const fallbackSystemMessage = AIController.buildSystemFailureMessage();

                logger.error(
                    `[AIController] Temporary AI response failed for user ${req.user.id}: ${aiError.message}`
                );

                return res.status(200).json({
                    success: true,
                    message: 'The temporary chat request was processed, but the AI response failed.',
                    data: {
                        temporary: true,
                        ai_failed: true,
                        assistant_message: {
                            role: 'system',
                            content: fallbackSystemMessage,
                            failed: true
                        }
                    }
                });
            }
        } catch (error) {
            next(error);
        }
    }

    static async updateTitle(req, res, next) {
        logger.info(`[AIController] updateTitle request received for user ${req.user.id}`);
        try {
            const conversationId = parseInt(req.params.conversationId);
            const { title } = req.body;

            if (!title) {
                return res.status(400).json({ success: false, error: 'Validation Error', message: 'Title is required' });
            }

            const titleValue = title.substring(0, LIMITS.TITLE_MAX_LENGTH);

            const updated = await ChatModel.updateConversationTitle(conversationId, req.user.id, titleValue);

            if (!updated) {
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Conversation not found' });
            }

            res.status(200).json({
                success: true,
                message: 'Title updated successfully',
                data: {
                    conversationId,
                    title: titleValue
                }
            });
        } catch (error) {
            next(error);
        }
    }

    static async deleteConversation(req, res, next) {
        logger.info(`[AIController] deleteConversation request received for user ${req.user.id}`);
        try {
            const conversationId = parseInt(req.params.conversationId);

            const deleted = await ChatModel.deleteConversation(conversationId, req.user.id);

            if (!deleted) {
                return res.status(404).json({ success: false, error: 'Not Found', message: 'Conversation not found' });
            }

            logger.debug(`[AIController] Deleted conversation ${conversationId}`);
            res.status(200).json({
                success: true,
                message: 'Conversation deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = AIController;
