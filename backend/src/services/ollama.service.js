const axios = require('axios');
const {
    OLLAMA_ENDPOINTS,
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    REQUEST_HEADERS,
    TIMEOUT
} = require('../config/ollama');
const { DRUG_TOOLS } = require('../config/tools');
const DrugSqlToolService = require('./drug-sql-tool.service');
const DrugService = require('./drug.service');
const { collectSourceCandidates, buildMentionedSources } = require('../utils/chat-sources');
const logger = require('../utils/logger');

const MAX_TOOL_ROUNDS = 4;
const MAX_SQL_ERROR_REPAIRS = 1;
const MAX_EMPTY_RESULT_REPAIRS = 1;
const MAX_TOOL_PREAMBLE_RETRIES = 1;

// Positive-match pattern for drug/medical intent.
// Tools are only injected when the user's last message contains drug-related vocabulary.
// Everything else (greetings, small talk, meta questions) is handled conversationally.
const DRUG_INTENT_PATTERN = /\b(?:drug|drugs|medication|medications?|medicine|medicines|pharmaceutical|tablet|tablets|capsule|capsules|syrup|injection|injectable|inhaler|suppository|patch|drops|dose|dosage|dosing|mg|mcg|ml|g\b|gram|milligram|microgram|side\s*effect|adverse|contraindication|indication|interaction|overdose|prescription|pharmacist|pharmacy|generic|brand|active\s*ingredient|composition|formula|price|cost|how\s+much|available|availability|stock|substitute|alternative|equivalent|compare|comparison|paracetamol|ibuprofen|aspirin|amoxicillin|metformin|atorvastatin|omeprazole|insulin|warfarin|lisinopril|amlodipine|metoprolol|gabapentin|azithromycin|ciprofloxacin|prednisone|hydrochlorothiazide|what\s+is\s+\w+\s+(?:used|for)|treat|treatment|cure|diagnos|symptom|disease|condition|pain|fever|infection|antibiotic|antiviral|antifungal|analgesic|anti.?inflammatory|antihypertensive|antidiabetic|antidepressant|anxiety|hypertension|diabetes|cholesterol|cardiac|heart|liver|kidney|blood\s*pressure|blood\s*sugar)\b/i;
const EMPTY_RESPONSE_RECOVERY_PROMPT = [
    'Your previous assistant response was empty.',
    'Answer the user now in plain text using only the DoseFinder tool outputs and conversation context already provided.',
    'If the tool output has no matching rows or contains an error, say you could not find a matching DoseFinder record and suggest checking the drug name or asking a more specific question.',
    'Do not call tools again for this recovery response.',
].join(' ');
const TOOL_PREAMBLE_RETRY_PROMPT = [
    'Your previous response did not answer the user.',
    'If drug information is needed, call the searchDrugs tool now with the drug name.',
    'Then answer the user directly from the returned results.',
].join(' ');
const TOOL_PREAMBLE_FALLBACK = 'I could not find enough information on that drug in DoseFinder. Please check the spelling or try a different name.';

// Matches verbose "let me look up..." preambles that delay the actual answer.
const INCOMPLETE_TOOL_PREAMBLE_PATTERN = /\b(?:let me|i(?:'ll| will)|first,?\s*i(?:'ll| will)|i need to|i(?:'m| am) going to)\b[\s\S]{0,180}\b(?:look up|check|search|query|inspect)\b[\s\S]{0,180}\b(?:dosefinder|database|schema|data|records?|sql)\b/i;

// Detects when the model accidentally outputs a raw tool-call JSON object as text
// (e.g. {"name": "searchDrugs", "parameters": {...}}) instead of invoking the tool.
const RAW_TOOL_CALL_PATTERN = /^\s*\{[^}]*"name"\s*:\s*"[a-zA-Z_]+"\s*,[^}]*"parameters"\s*:/s;

class OllamaService {
    static async generate(prompt, model = DEFAULT_MODEL) {
        try {
            this._assertModelConfiguration(model);
            const response = await axios.post(
                OLLAMA_ENDPOINTS.GENERATE,
                {
                    model,
                    prompt,
                    stream: false
                },
                {
                    timeout: TIMEOUT,
                    headers: REQUEST_HEADERS
                }
            );
            return response.data;
        } catch (error) {
            this._handleError(error);
        }
    }

    static _isConversationalMessage(messages) {
        const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
        if (!lastUserMessage || typeof lastUserMessage.content !== 'string') return false;
        // Skip tools when the message contains no drug/medical vocabulary.
        return !DRUG_INTENT_PATTERN.test(lastUserMessage.content);
    }

    static async chat(messages, model = DEFAULT_MODEL, useTools = true, toolRound = 0, repairState = {}, user = null, sourceCandidates = []) {
        // Declared outside the try so the catch block's tool-support fallback can read it.
        let effectiveUseTools = useTools;
        try {
            this._assertModelConfiguration(model);

            // Skip tool injection for clearly conversational messages — small models call
            // tools even for greetings, producing unhelpful drug-lookup fallback replies.
            effectiveUseTools = useTools && toolRound === 0
                ? !this._isConversationalMessage(messages)
                : useTools;

            const payload = {
                model,
                messages,
                stream: false,
            };

            if (effectiveUseTools) {
                payload.tools = DRUG_TOOLS;
            }

            const response = await axios.post(
                OLLAMA_ENDPOINTS.CHAT,
                payload,
                {
                    timeout: TIMEOUT,
                    headers: REQUEST_HEADERS
                }
            );

            // Check if the model decided to call tools
            if (response.data.message && Array.isArray(response.data.message.tool_calls) && response.data.message.tool_calls.length > 0) {
                if (toolRound >= MAX_TOOL_ROUNDS) {
                    throw new Error(`Tool call limit exceeded after ${MAX_TOOL_ROUNDS} rounds.`);
                }

                const nextRepairState = this._normalizeRepairState(repairState);
                let firstSqlToolFailure = null;
                const toolResults = [];

                // Execute each tool sequentially and collect results
                for (const toolCall of response.data.message.tool_calls) {
                    const functionName = toolCall.function.name;
                    const functionArgs = toolCall.function.arguments;

                    let result;
                    try {
                        result = await this._executeTool(functionName, functionArgs, user);
                    } catch (err) {
                        result = this._createToolErrorResult(err);
                    }

                    if (functionName === 'queryDrugSql' && this._isSqlToolFailure(result) && !firstSqlToolFailure) {
                        firstSqlToolFailure = result;
                    }

                    // Remember which drugs the tools returned so the final answer
                    // can cite them as sources.
                    collectSourceCandidates(functionName, result, sourceCandidates);

                    toolResults.push({ name: functionName, result });
                }

                // Build a clean follow-up conversation that avoids tool-role messages.
                // Small models (llama3.2) get confused by tool-call history and output
                // JSON garbage instead of a plain-text answer. Injecting results as a
                // user context message forces a clean text response.
                const toolResultsText = toolResults
                    .map(({ name, result }) => `[${name} result: ${JSON.stringify(result)}]`)
                    .join('\n');

                const repairPrompt = this._buildSqlRepairPrompt(firstSqlToolFailure, nextRepairState);
                const followUpContent = repairPrompt
                    ? `${toolResultsText}\n\n${repairPrompt.content}`
                    : `${toolResultsText}\n\nAnswer the user's question in plain text using only the data above. Do not output JSON or tool calls.`;

                // Rebuild conversation without assistant tool_calls / tool role messages
                // so the model sees: system + chat history + results context + reply instruction.
                const cleanConversation = [
                    ...messages,
                    { role: 'user', content: followUpContent }
                ];

                return await this.chat(
                    cleanConversation,
                    model,
                    repairPrompt ? repairPrompt.useTools : false,
                    toolRound + 1,
                    nextRepairState,
                    user,
                    sourceCandidates
                );
            }

            const assistantContent = typeof response.data?.message?.content === 'string'
                ? response.data.message.content.trim()
                : '';

            if (!assistantContent) {
                if (effectiveUseTools) {
                    logger.warn('[Ollama] Model returned an empty response. Retrying once without tools for a plain-text recovery answer.');
                    return await this.chat(
                        [
                            ...messages,
                            {
                                role: 'user',
                                content: EMPTY_RESPONSE_RECOVERY_PROMPT,
                            },
                        ],
                        model,
                        false,
                        toolRound,
                        repairState,
                        user,
                        sourceCandidates
                    );
                }

                throw new Error('AI model returned an empty response.');
            }

            // Detect the model outputting a raw tool-call JSON object as text content.
            // This happens with small models that confuse tool definitions with tool calls.
            // Retry once with an explicit nudge; on second occurrence return the fallback.
            if (effectiveUseTools && RAW_TOOL_CALL_PATTERN.test(assistantContent)) {
                const nextRepairState = this._normalizeRepairState(repairState);
                if (nextRepairState.toolPreambleRetries < MAX_TOOL_PREAMBLE_RETRIES) {
                    nextRepairState.toolPreambleRetries += 1;
                    logger.warn('[Ollama] Model output raw tool-call JSON as text. Retrying with explicit call instruction.');
                    return await this.chat(
                        [...messages, { role: 'user', content: TOOL_PREAMBLE_RETRY_PROMPT }],
                        model,
                        true,
                        toolRound,
                        nextRepairState,
                        user,
                        sourceCandidates
                    );
                }
                response.data.message.content = TOOL_PREAMBLE_FALLBACK;
                response.data.sources = [];
                return response.data;
            }

            if (effectiveUseTools && this._isIncompleteToolPreamble(assistantContent)) {
                const nextRepairState = this._normalizeRepairState(repairState);

                if (nextRepairState.toolPreambleRetries < MAX_TOOL_PREAMBLE_RETRIES) {
                    nextRepairState.toolPreambleRetries += 1;
                    logger.warn('[Ollama] Model returned a lookup preamble without tool calls. Retrying once with explicit tool-use instructions.');
                    return await this.chat(
                        [
                            ...messages,
                            {
                                role: 'user',
                                content: TOOL_PREAMBLE_RETRY_PROMPT,
                            },
                        ],
                        model,
                        true,
                        toolRound,
                        nextRepairState,
                        user,
                        sourceCandidates
                    );
                }

                logger.warn('[Ollama] Model repeated a lookup preamble without tool calls. Returning a plain fallback answer.');
                response.data.message.content = TOOL_PREAMBLE_FALLBACK;
                response.data.sources = [];
                return response.data;
            }

            response.data.message.content = assistantContent;
            // Cite only the retrieved drugs the answer actually mentions.
            response.data.sources = buildMentionedSources(sourceCandidates, assistantContent);
            return response.data;
        } catch (error) {
            // Auto-fallback if the model doesn't support tools
            if (effectiveUseTools && error.response && error.response.data && error.response.data.error && error.response.data.error.includes('does not support tools')) {
                logger.warn(`[Ollama] Model ${model} does not support tools. Retrying without tools.`);
                return await this.chat(messages, model, false, toolRound, repairState, user, sourceCandidates);
            }
            this._handleError(error);
        }
    }

    static async _executeTool(name, args, user = null) {
        const normalizedArgs = this._normalizeToolArgs(args);
        logger.info(`[Ollama] Executing tool: ${name} with args:`, normalizedArgs);
        switch (name) {
            case 'searchDrugs':
                return await DrugService.searchForChatbot(normalizedArgs.query, normalizedArgs.limit, user);
            // Legacy SQL tools kept for compatibility
            case 'getDrugSqlSchema':
                return DrugSqlToolService.getSchema();
            case 'queryDrugSql':
                return await DrugSqlToolService.query(normalizedArgs.sql, normalizedArgs.limit, user);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    static _normalizeRepairState(repairState = {}) {
        return {
            sqlErrorRepairs: Number.isInteger(repairState.sqlErrorRepairs) ? repairState.sqlErrorRepairs : 0,
            emptyResultRepairs: Number.isInteger(repairState.emptyResultRepairs) ? repairState.emptyResultRepairs : 0,
            toolPreambleRetries: Number.isInteger(repairState.toolPreambleRetries) ? repairState.toolPreambleRetries : 0,
        };
    }

    static _isIncompleteToolPreamble(content) {
        if (typeof content !== 'string') return false;
        if (!INCOMPLETE_TOOL_PREAMBLE_PATTERN.test(content)) return false;

        return !/\b(?:dosefinder records? (?:show|include|returned)|i found|found \d+|matching records?|could not find enough|no matching|according to dosefinder)\b/i.test(content);
    }

    static _isSqlToolFailure(result) {
        return result
            && result.ok === false
            && result.error
            && typeof result.error.category === 'string';
    }

    static _createToolErrorResult(error) {
        return {
            ok: false,
            error: {
                category: 'sql_execution_error',
                message: error?.message || 'The tool could not run.',
            },
            warnings: [],
            repair_guidance: [
                'Use getDrugSqlSchema to inspect the allowlisted schema and then retry with a safe read-only SELECT query.',
            ],
        };
    }

    static _buildSqlRepairPrompt(toolResult, repairState) {
        if (!toolResult) return null;

        const category = toolResult.error?.category || 'sql_execution_error';
        const message = toolResult.error?.message || 'The SQL tool could not run the query.';
        const guidance = Array.isArray(toolResult.repair_guidance)
            ? toolResult.repair_guidance.join(' ')
            : '';
        const isDrugNameLookup = Boolean(toolResult.query_profile?.has_drug_name_filter);

        if (category === 'empty_result' && isDrugNameLookup && repairState.emptyResultRepairs < MAX_EMPTY_RESULT_REPAIRS) {
            repairState.emptyResultRepairs += 1;
            return {
                useTools: true,
                content: [
                    'The SQL query returned no rows for a drug-name lookup.',
                    'Retry once with a broader search across generic_name, brand_names, and arabic_trade_name while keeping drug_versions.is_current = 1 and COALESCE(drug_versions.is_deleted, 0) = 0.',
                    'Remove overly strict filters such as exact price, route, form, or interaction wording unless they are essential.',
                    'Do not show SQL or raw tool errors to the user.',
                    guidance,
                ].join(' '),
            };
        }

        if (category !== 'empty_result' && repairState.sqlErrorRepairs < MAX_SQL_ERROR_REPAIRS) {
            repairState.sqlErrorRepairs += 1;
            return {
                useTools: true,
                content: [
                    `The SQL tool returned ${category}: ${message}`,
                    'Repair the SQL once using the schema guide and tool feedback, then call queryDrugSql again.',
                    'Keep the query read-only, focused, current-record filtered, and limited to allowlisted drug knowledge tables.',
                    'Do not show SQL or raw tool errors to the user.',
                    guidance,
                ].join(' '),
            };
        }

        return {
            useTools: false,
            content: [
                'The DoseFinder SQL tool still could not return enough reliable rows after the allowed repair attempt.',
                'Answer the user in plain text that DoseFinder could not find enough matching data for the request.',
                'Ask them to check the drug name or provide a more specific medication, route, form, or comparison target.',
                'Do not mention SQL, tool calls, error categories, or raw tool errors.',
            ].join(' '),
        };
    }

    static _normalizeToolArgs(args) {
        if (!args) return {};
        if (typeof args === 'object') return args;
        if (typeof args !== 'string') return {};

        try {
            const parsed = JSON.parse(args);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    static async getTags() {
        try {
            const response = await axios.get(OLLAMA_ENDPOINTS.TAGS, {
                timeout: TIMEOUT,
                headers: REQUEST_HEADERS
            });
            return response.data;
        } catch (error) {
            this._handleError(error);
        }
    }

    static async showModel(model = DEFAULT_MODEL) {
        try {
            this._assertModelConfiguration(model);
            const response = await axios.post(
                OLLAMA_ENDPOINTS.SHOW,
                { name: model },
                {
                    timeout: TIMEOUT,
                    headers: REQUEST_HEADERS
                }
            );
            return response.data;
        } catch (error) {
            this._handleError(error);
        }
    }

    static _assertModelConfiguration(model = DEFAULT_MODEL) {
        const isCloudModel = model.trim().toLowerCase().endsWith('-cloud');

        if (isCloudModel && DEFAULT_BASE_URL.startsWith('http://') && !REQUEST_HEADERS.Authorization) {
            throw this._createError(
                `OLLAMA_MODEL '${model}' is a cloud model, but the backend is targeting the local Ollama instance at ${DEFAULT_BASE_URL} without authentication. Either switch to a local model such as 'llama3.2', sign the Ollama instance in, or set OLLAMA_API_KEY and optionally OLLAMA_BASE_URL=https://ollama.com.`,
                503
            );
        }
    }

    static _createError(message, status = 502) {
        const error = new Error(message);
        error.status = status;
        return error;
    }

    static _handleError(error) {
        if (error.code === 'ECONNREFUSED' || error.message.includes('connect ECONNREFUSED')) {
            throw this._createError('Connection refused: Unable to reach Ollama service. Is it running?', 503);
        }
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            throw this._createError(`Request to Ollama timed out after ${TIMEOUT}ms.`, 504);
        }
        if (error.response && [401, 403].includes(error.response.status)) {
            throw this._createError(
                `Ollama authorization failed while calling ${DEFAULT_BASE_URL}. If you are using a cloud model, set OLLAMA_API_KEY and optionally OLLAMA_BASE_URL=https://ollama.com, or sign the local Ollama instance in before using '${DEFAULT_MODEL}'.`,
                503
            );
        }
        if (error.response && error.response.data && error.response.data.error) {
            throw this._createError(`Ollama Error: ${error.response.data.error}`);
        }
        throw this._createError(`Ollama communication error: ${error.message}`);
    }
}

module.exports = OllamaService;
