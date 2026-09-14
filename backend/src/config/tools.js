/**
 * Ollama Tool Definitions
 *
 * DoseGPT uses a single searchDrugs tool that queries the DoseFinder drug API.
 * The model only needs to supply a search term — no SQL generation required.
 */

const DRUG_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'searchDrugs',
            description: [
                'Full-text search of the DoseFinder drug database.',
                'Searches across ALL drug content: generic name, brand names, Arabic trade name, drug classes, indications (what it treats), adverse effects, warnings, pharmacology, and administration.',
                'Use this tool for ANY drug-related question: a specific drug name, a medical condition, a symptom, a drug class, a side effect, or any clinical term.',
                'For condition-based questions, search by DRUG CLASS NAME for best results.',
                'Examples: for hypertension → query "antihypertensive" or "ACE inhibitor"; for diabetes → query "antidiabetic" or "metformin"; for infection → query "antibiotic"; for pain → query "analgesic"; for cholesterol → query "statin".',
                'Returns matching drug records including generic_name, brand_names, rx_status, price, route, dosage_forms, and classes.',
                'If the first search returns no results, retry with the drug class name or a known drug name for the condition.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Any drug-related search term: a drug name, medical condition, symptom, drug class, or clinical keyword.',
                    },
                    limit: {
                        type: 'integer',
                        description: 'Maximum number of results to return. Defaults to 5.',
                    },
                },
                required: ['query'],
            },
        },
    },
];

module.exports = {
    DRUG_TOOLS,
};
