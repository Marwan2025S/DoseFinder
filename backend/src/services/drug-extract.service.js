const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const OllamaService = require('./ollama.service');
const logger = require('../utils/logger');

const MAX_PROMPT_TEXT_LENGTH = 8000;
const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;

const SUPPORTED_UPLOAD_TYPES = Object.freeze({
    pdf: {
        extensions: ['.pdf'],
        mimeTypes: ['application/pdf'],
        label: 'PDF',
    },
    docx: {
        extensions: ['.docx'],
        mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        label: 'DOCX',
    },
});

function buildExtractionPrompt(sourceText) {
    return `You are a pharmaceutical data extraction expert. Extract drug information from the following text and return ONLY a valid JSON object with NO markdown, NO explanation, NO preamble.

The JSON must follow this unified DoseFinder schema. Use empty arrays for missing sections and null for missing scalar values:

{
  "generic_name": "string",
  "brand_names": "comma-separated brand/trade names or empty string",
  "url": null,
  "rx_status": "Rx, OTC, Rx, OTC, Pending FDA Approval, or null",
  "source": "DMS",
  "drug_dms_extensions": [{
    "ham": 0 or 1,
    "price": number or null,
    "notes": "string or null",
    "route": "[\\"ORAL\\",\\"TOPICAL\\"]",
    "arabic_route": "[\\"بالفم\\"]",
    "arabic_trade_name": "string or null"
  }],
  "classes": [{"class_name": "string"}],
  "dosage_forms": [{"population": "adult/pediatric/geriatric/general", "form_name": "string", "strength_text": "string or null"}],
  "dosing": [{"population": "adult/pediatric/geriatric/general", "indication": "string", "sub_indication": "string or null", "list_header": "string or null", "notes_text": "string"}],
  "adverse_effects": [{"severity_band": "string", "body_system": "string", "list_header": "string or null", "effect_text": "string"}],
  "warnings": [{"warning_type": "string", "sub_warning_type": "string or null", "list_header": "string or null", "text": "string"}],
  "interactions": [{"severity_level": "string or null", "interacting_drug": "string", "description": "string or null"}],
  "pregnancy": [{"topic": "string", "sub_topic": "string or null", "list_header": "string or null", "text": "string"}],
  "pharmacology": [{"topic": "string", "sub_topic": "string or null", "list_header": "string or null", "text": "string"}],
  "administration": [{"topic": "string", "sub_topic": "string or null", "list_header": "string or null", "text": "string"}],
  "suggested_dosing": [{"population": "string", "indication": "string", "sub_indication": "string or null", "list_header": "string or null", "notes_text": "string"}],
  "suggested_uses": [{"topic": "string", "text": "string"}],
  "nutrition": [{"topic": "string", "text": "string"}],
  "fda_products": [],
  "fda_submissions": [],
  "fda_extensions": []
}

IMPORTANT RULES:
- Return ONLY the JSON object, nothing else
- If information is not found in the text, use null or empty arrays []
- Extract ALL dosing, warnings, adverse effects, interactions, routes, strengths, and user-visible FDA product/submission/marketing data you can find
- Do not invent FDA application numbers, NDCs, or dates
- Be thorough and accurate

TEXT TO EXTRACT FROM:
---
${sourceText.substring(0, MAX_PROMPT_TEXT_LENGTH)}
---`;
}

class DrugExtractionError extends Error {
    constructor(message, status = 400, options = {}) {
        super(message);
        this.name = 'DrugExtractionError';
        this.status = status;
        this.raw = options.raw;
        this.cause = options.cause;
    }
}

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function firstText(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) return text;
    }
    return '';
}

function normalizeArrayJson(values) {
    return JSON.stringify(asArray(values).map((value) => String(value ?? '').trim()).filter(Boolean));
}

function normalizeExtractedPayload(payload) {
    const normalized = isObject(payload) ? payload : {};
    const schemaKeys = [
        'classes',
        'dosage_forms',
        'dosing',
        'adverse_effects',
        'warnings',
        'interactions',
        'pregnancy',
        'pharmacology',
        'administration',
        'suggested_dosing',
        'suggested_uses',
        'nutrition',
        'subcategory_listing',
        'drug_dms_extensions',
        'fda_products',
        'fda_submissions',
        'fda_extensions',
    ];
    if (
        Object.prototype.hasOwnProperty.call(normalized, 'generic_name')
        || Object.prototype.hasOwnProperty.call(normalized, 'dosage_forms')
        || Object.prototype.hasOwnProperty.call(normalized, 'drug_dms_extensions')
    ) {
        const result = {
            generic_name: typeof normalized.generic_name === 'string' ? normalized.generic_name : '',
            brand_names: typeof normalized.brand_names === 'string' ? normalized.brand_names : '',
            url: normalized.url ?? null,
            rx_status: normalized.rx_status ?? null,
            source: typeof normalized.source === 'string' && normalized.source.trim() ? normalized.source : 'DMS',
        };
        schemaKeys.forEach((key) => {
            result[key] = Array.isArray(normalized[key]) ? normalized[key] : [];
        });
        if (result.drug_dms_extensions.length === 0) {
            result.drug_dms_extensions = [{
                ham: 0,
                price: null,
                notes: null,
                route: '[]',
                arabic_route: '[]',
                arabic_trade_name: null,
            }];
        }
        return result;
    }

    // Backward-compatible fallback for older local models that still answer with
    // the pre-versioned extraction schema. Convert it here so every client sees
    // the canonical versioned payload.
    const legacyDrug = isObject(normalized.drug) ? normalized.drug : {};
    const legacyStrengths = asArray(normalized.strengths);
    const defaultForm = firstText(legacyDrug.dosage_form, legacyDrug.form, 'tablet').toLowerCase();
    const strengthTexts = legacyStrengths.map((item) => firstText(item?.raw_strength, item?.strength_text)).filter(Boolean);
    const dosageForms = strengthTexts.length > 0
        ? strengthTexts.map((strength) => ({
            population: 'default',
            form_name: defaultForm,
            strength_text: strength,
        }))
        : [];
    const warnings = [];
    if (legacyDrug.raw_contraindication) {
        warnings.push({
            warning_type: 'Contraindication',
            sub_warning_type: firstText(legacyDrug.contraindication_primary_category) || null,
            list_header: null,
            text: String(legacyDrug.raw_contraindication),
        });
    }
    firstText(legacyDrug.contraindications_list)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((text) => {
            warnings.push({
                warning_type: 'Contraindication',
                sub_warning_type: null,
                list_header: null,
                text,
            });
        });

    return {
        generic_name: firstText(legacyDrug.generic_name, legacyDrug['Generic Name']),
        brand_names: firstText(legacyDrug.brand_names, legacyDrug['Trade Name']),
        url: null,
        rx_status: firstText(legacyDrug.rx_status) || null,
        source: 'DMS',
        drug_dms_extensions: [{
            ham: firstText(legacyDrug.ham).toUpperCase() === 'YES' ? 1 : 0,
            price: Number.isFinite(Number(legacyDrug.price)) ? Number(legacyDrug.price) : null,
            notes: firstText(legacyDrug.note_raw) || null,
            route: normalizeArrayJson(asArray(normalized.routes).map((item) => firstText(item?.normalized_route, item?.raw_route, item?.route_name))),
            arabic_route: normalizeArrayJson(asArray(normalized.arabic_routes).map((item) => firstText(item?.normalized_route, item?.raw_route, item?.route_name))),
            arabic_trade_name: firstText(legacyDrug.arabic_trade_name, legacyDrug['Arabic Trade Name']) || null,
        }],
        classes: [],
        dosage_forms: dosageForms,
        dosing: [
            ...asArray(normalized.default_doses).map((dose, index) => ({
                population: 'default',
                indication: firstText(asArray(normalized.indications)[index]?.normalized_indication, 'dosing'),
                sub_indication: null,
                list_header: null,
                notes_text: firstText(dose?.raw_default_dose, dose?.normalized_dose, dose?.text),
            })).filter((entry) => entry.notes_text),
            ...asArray(normalized.maximum_doses).map((dose) => ({
                population: 'default',
                indication: 'maximum_dose',
                sub_indication: null,
                list_header: null,
                notes_text: firstText(dose?.raw_maximum_dose, dose?.normalized_dose, dose?.text),
            })).filter((entry) => entry.notes_text),
        ],
        adverse_effects: asArray(normalized.adverse_reactions).map((item) => ({
            severity_band: item?.is_severe ? 'Major' : 'Frequency Not Defined',
            body_system: 'general',
            list_header: null,
            effect_text: firstText(item?.reaction_normalized, item?.raw_adverse_reactions, item?.effect_text),
        })).filter((entry) => entry.effect_text),
        warnings,
        interactions: asArray(normalized.interactions).map((item) => ({
            severity_level: firstText(item?.qualifier) || null,
            interacting_drug: firstText(item?.interactant_canonical, item?.raw_drug_interactions),
            description: firstText(item?.directive, item?.description) || null,
        })).filter((entry) => entry.interacting_drug),
        pregnancy: [],
        pharmacology: [],
        administration: [],
        suggested_dosing: [],
        suggested_uses: [],
        nutrition: [],
        subcategory_listing: [],
        fda_products: [],
        fda_submissions: [],
        fda_extensions: [],
    };
}

function normalizeText(text) {
    return String(text ?? '')
        .replace(/\u0000/g, ' ')
        .replace(/\r/g, '\n')
        .trim();
}

function getFileExtension(file) {
    return path.extname(file?.originalname || '').toLowerCase();
}

function resolveUploadType(file) {
    const extension = getFileExtension(file);
    const mimeType = String(file?.mimetype || '').toLowerCase();

    return Object.values(SUPPORTED_UPLOAD_TYPES).find((type) =>
        type.extensions.includes(extension) || type.mimeTypes.includes(mimeType)
    ) || null;
}

async function extractTextFromPdf(buffer) {
    let parser;
    try {
        parser = new PDFParse({ data: buffer });
        const parsed = await parser.getText();
        const text = normalizeText(parsed?.text);

        if (!text) {
            throw new DrugExtractionError(
                'No extractable text was found in this PDF. It may be scanned or image-based, which is not supported in v1.',
                422
            );
        }

        return text;
    } catch (error) {
        if (error instanceof DrugExtractionError) {
            throw error;
        }

        logger.error('[DrugExtract] PDF parsing failed:', error.message);
        throw new DrugExtractionError('Unable to read the uploaded PDF file.', 422, { cause: error });
    } finally {
        if (parser) {
            await parser.destroy().catch(() => null);
        }
    }
}

async function extractTextFromDocx(buffer) {
    try {
        const result = await mammoth.extractRawText({ buffer });
        const text = normalizeText(result?.value);

        if (!text) {
            throw new DrugExtractionError('No readable text was found in this DOCX file.', 422);
        }

        return text;
    } catch (error) {
        if (error instanceof DrugExtractionError) {
            throw error;
        }

        logger.error('[DrugExtract] DOCX parsing failed:', error.message);
        throw new DrugExtractionError('Unable to read the uploaded DOCX file.', 422, { cause: error });
    }
}

class DrugExtractService {
    static MAX_UPLOAD_FILE_SIZE = MAX_UPLOAD_FILE_SIZE;

    static isSupportedUpload(file) {
        return Boolean(resolveUploadType(file));
    }

    static buildUnsupportedFileMessage() {
        return 'Only PDF and DOCX files are supported for extraction.';
    }

    static async extractFromText(text) {
        const normalizedText = normalizeText(text);
        if (!normalizedText) {
            throw new DrugExtractionError(
                'No text provided. Send field "text" with the drug paper content.',
                400
            );
        }

        logger.info('[DrugExtract] Starting extraction, text length:', normalizedText.length);

        const prompt = buildExtractionPrompt(normalizedText);
        const ollamaRes = await OllamaService.generate(prompt);
        const raw = String(ollamaRes?.response ?? '');
        const clean = raw.replace(/```json|```/gi, '').trim();

        try {
            return normalizeExtractedPayload(JSON.parse(clean));
        } catch (parseError) {
            logger.error('[DrugExtract] JSON parse failed:', parseError.message);
            logger.error('[DrugExtract] Raw response:', raw.substring(0, 500));
            throw new DrugExtractionError(
                'AI could not produce valid JSON. Try with clearer drug text.',
                422,
                { raw: raw.substring(0, 500), cause: parseError }
            );
        }
    }

    static async extractFromFile(file) {
        if (!file) {
            throw new DrugExtractionError('No file uploaded. Use the "file" field in multipart/form-data.', 400);
        }

        const uploadType = resolveUploadType(file);
        if (!uploadType) {
            throw new DrugExtractionError(this.buildUnsupportedFileMessage(), 400);
        }

        let extractedText;
        if (uploadType.label === 'PDF') {
            extractedText = await extractTextFromPdf(file.buffer);
        } else {
            extractedText = await extractTextFromDocx(file.buffer);
        }

        return this.extractFromText(extractedText);
    }
}

module.exports = {
    DrugExtractService,
    DrugExtractionError,
};
