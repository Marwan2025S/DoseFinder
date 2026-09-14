import { useEffect, useState } from 'react';
import { drugsApi } from '../services/api';
import '../styles/ai-fill-form.css';

const DATA_ONLY_UNAVAILABLE = 'Not available in current DoseFinder data.';

const QUERY_TYPES = [
    { value: 'indications', label: 'Indications & Uses' },
    { value: 'sideEffects', label: 'Side Effects' },
    { value: 'dosage', label: 'Dosage Guidelines' },
    { value: 'interactions', label: 'Drug Interactions' },
    { value: 'alternatives', label: 'Alternatives' },
    { value: 'comparison', label: 'Drug Comparison' },
];

const FORM_FIELDS = {
    indications: [
        { id: 'drugName', label: 'Drug Name', placeholder: 'e.g. Ibuprofen 400mg', required: true },
        { id: 'patientAge', label: 'Patient Age', placeholder: 'e.g. Adult / 8 years old', required: false },
        { id: 'condition', label: 'Condition', placeholder: 'e.g. arthritis', required: false },
    ],
    sideEffects: [
        { id: 'drugName', label: 'Drug Name', placeholder: 'e.g. Amoxicillin 500mg', required: true },
        { id: 'patientAge', label: 'Patient Age', placeholder: 'e.g. Adult / child', required: false },
        { id: 'comorbidity', label: 'Known Conditions', placeholder: 'e.g. renal impairment', required: false },
    ],
    dosage: [
        { id: 'drugName', label: 'Drug Name', placeholder: 'e.g. Paracetamol 500mg', required: true },
        { id: 'patientAge', label: 'Patient Age', placeholder: 'e.g. 6 years old / 70kg', required: true },
        { id: 'condition', label: 'Condition', placeholder: 'e.g. fever, pain relief', required: false },
    ],
    interactions: [
        { id: 'drugA', label: 'First Drug', placeholder: 'e.g. Ibuprofen', required: true },
        { id: 'drugB', label: 'Second Drug', placeholder: 'e.g. Warfarin', required: true },
        { id: 'drugC', label: 'Third Drug', placeholder: 'e.g. Aspirin (optional)', required: false },
    ],
    alternatives: [
        { id: 'drugName', label: 'Drug Name', placeholder: 'e.g. Amoxicillin 500mg', required: true },
        { id: 'reason', label: 'Reason', placeholder: 'e.g. allergy / unavailable', required: false },
        { id: 'condition', label: 'Condition', placeholder: 'e.g. strep throat', required: false },
    ],
    comparison: [
        { id: 'drugA', label: 'Drug A', placeholder: 'e.g. Ibuprofen', required: true },
        { id: 'drugB', label: 'Drug B', placeholder: 'e.g. Naproxen', required: true },
        { id: 'focus', label: 'Focus On', placeholder: 'e.g. efficacy, safety, cost', required: false },
    ],
};

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
    return normalizeText(value).toLowerCase();
}

function uniqueNonEmpty(values) {
    const seen = new Set();
    return values
        .map((value) => normalizeText(String(value ?? '')))
        .filter((value) => {
            if (!value) return false;
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const normalized = normalizeText(String(value ?? ''));
        if (normalized) return normalized;
    }
    return '';
}

function parseStringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeText(item)).filter(Boolean);
    }
    const raw = normalizeText(value);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => normalizeText(item)).filter(Boolean);
        }
        return [normalizeText(parsed)].filter(Boolean);
    } catch {
        return raw.split(',').map((item) => normalizeText(item)).filter(Boolean);
    }
}

function getDrugDisplayName(drug, fallback = '') {
    const brandNames = Array.isArray(drug?.brand_names_list)
        ? drug.brand_names_list
        : parseStringArray(drug?.brand_names);
    return firstNonEmpty(drug?.generic_name, drug?.display_name, drug?.name, brandNames[0], fallback);
}

function getFirstDosageForm(drug) {
    const forms = asArray(drug?.dosage_forms);
    return firstNonEmpty(forms[0]?.form_name, drug?.dosage_form, drug?.form);
}

function extractMaximumDose(text) {
    const value = normalizeText(text);
    if (!value) return '';
    const match = value.match(/(?:maximum|max(?:imum)? daily dose)[:\s-]*([^.;\n]+)/i);
    return match?.[1] ? `Maximum dose: ${match[1].trim()}` : '';
}

function joinOrFallback(values, fallback = DATA_ONLY_UNAVAILABLE, limit = 4) {
    const items = uniqueNonEmpty(values).slice(0, limit);
    return items.length > 0 ? items.join('; ') : fallback;
}

function titleCase(value) {
    const input = normalizeText(value);
    if (!input) return '';
    return input
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDrugId(drug) {
    const value = drug?.drug_id ?? drug?.id ?? null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function buildDrugAliases(drug = {}) {
    const brandNames = Array.isArray(drug?.brand_names_list)
        ? drug.brand_names_list
        : parseStringArray(drug?.brand_names);

    return uniqueNonEmpty([
        drug?.generic_name,
        drug?.display_name,
        drug?.name,
        ...brandNames,
    ]);
}

function scoreDrugMatch(query, drug) {
    const needle = normalizeKey(query);
    if (!needle) return 0;

    let score = 0;
    for (const alias of buildDrugAliases(drug)) {
        const candidate = alias.toLowerCase();
        if (candidate === needle) score = Math.max(score, 100);
        else if (candidate.startsWith(needle) || needle.startsWith(candidate)) score = Math.max(score, 85);
        else if (candidate.includes(needle) || needle.includes(candidate)) score = Math.max(score, 70);
    }

    if (normalizeKey(drug?.generic_name) === needle) score += 3;
    return score;
}

function pickBestDrugMatch(query, results) {
    return asArray(results)
        .map((drug) => ({ drug, score: scoreDrugMatch(query, drug) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.drug ?? asArray(results)[0] ?? null;
}

function hasPreferredDrugMatch(query, preferredDrugData) {
    const needle = normalizeKey(query);
    if (!needle || !preferredDrugData) return false;
    return buildDrugAliases(preferredDrugData).some((alias) => alias.toLowerCase() === needle);
}

async function resolveDrugRecord(query, preferredDrugData = null) {
    const normalizedQuery = normalizeText(query);

    if (!normalizedQuery && preferredDrugData) {
        return preferredDrugData;
    }

    if (hasPreferredDrugMatch(normalizedQuery, preferredDrugData)) {
        return preferredDrugData;
    }

    if (!normalizedQuery) {
        throw new Error('Drug name is required.');
    }

    const searchResponse = await drugsApi.search({ q: normalizedQuery, per_page: 10 });
    const bestMatch = pickBestDrugMatch(normalizedQuery, searchResponse?.results);

    if (!bestMatch) {
        throw new Error(`No DoseFinder record found for "${normalizedQuery}".`);
    }

    const bestMatchId = getDrugId(bestMatch);
    if (preferredDrugData && bestMatchId && bestMatchId === getDrugId(preferredDrugData)) {
        return preferredDrugData;
    }

    if (!bestMatchId) {
        throw new Error(`DoseFinder returned a drug match for "${normalizedQuery}" without a valid ID.`);
    }

    return drugsApi.getDetails(bestMatchId);
}

function pluckTexts(entries, keys) {
    return uniqueNonEmpty(
        asArray(entries).flatMap((entry) =>
            keys
                .map((key) => normalizeText(entry?.[key]))
                .filter(Boolean)
        )
    );
}

function collectIndications(drug) {
    return uniqueNonEmpty([
        ...pluckTexts(drug?.suggested_uses, ['suggested_use', 'use_text', 'text', 'indication', 'name']),
        ...pluckTexts(drug?.dosing, ['indication', 'sub_indication']),
    ]);
}

function collectContraindications(drug) {
    const listText = normalizeText(drug?.contraindications_list);
    const splitList = listText
        ? listText.split(/\r?\n|;|,/).map((item) => item.trim()).filter(Boolean)
        : [];

    const warningContra = asArray(drug?.warnings)
        .map((warning) => {
            const title = firstNonEmpty(warning?.warning_type, warning?.sub_warning_type);
            const text = normalizeText(warning?.text);
            if (!/contra/i.test(`${title} ${text}`)) return '';
            return title ? `${titleCase(title)}: ${text}` : text;
        })
        .filter(Boolean);

    return uniqueNonEmpty([
        normalizeText(drug?.raw_contraindication),
        ...splitList,
        ...warningContra,
    ]);
}

function collectWarningTexts(drug) {
    return uniqueNonEmpty(
        asArray(drug?.warnings).map((warning) => {
            const label = firstNonEmpty(warning?.warning_type, warning?.sub_warning_type);
            const text = normalizeText(warning?.text);
            if (!text) return '';
            return label ? `${titleCase(label)}: ${text}` : text;
        })
    );
}

function collectSeriousWarningTexts(drug) {
    return uniqueNonEmpty(
        asArray(drug?.warnings)
            .filter((warning) => /boxed|black|serious|major|severe|contra/i.test(
                `${warning?.warning_type ?? ''} ${warning?.sub_warning_type ?? ''} ${warning?.text ?? ''}`
            ))
            .map((warning) => {
                const label = firstNonEmpty(warning?.warning_type, warning?.sub_warning_type);
                const text = normalizeText(warning?.text);
                return label ? `${titleCase(label)}: ${text}` : text;
            })
    );
}

function collectAdverseEffectTexts(drug) {
    return uniqueNonEmpty(pluckTexts(drug?.adverse_effects, ['effect_text', 'reaction_name', 'reaction_normalized', 'raw_adverse_reactions']));
}

function collectAdministrationNotes(drug) {
    return uniqueNonEmpty([
        ...pluckTexts(drug?.administration, ['text']),
        ...pluckTexts(drug?.nutrition, ['text']),
        normalizeText(drug?.note_raw),
    ]);
}

function collectPharmacologyNotes(drug) {
    return uniqueNonEmpty(pluckTexts(drug?.pharmacology, ['text']));
}

function collectDefaultDoseTexts(drug) {
    return uniqueNonEmpty([
        ...pluckTexts(drug?.dosing, ['notes_text', 'text']),
        ...pluckTexts(drug?.suggested_dosing, ['notes_text', 'text', 'suggested_dose']),
    ]);
}

function collectMaximumDoseTexts(drug) {
    return uniqueNonEmpty(collectDefaultDoseTexts(drug).map(extractMaximumDose));
}

function inferPopulation(patientAge) {
    const value = normalizeKey(patientAge);
    if (!value) return '';
    if (/pregnan/.test(value)) return 'pregnancy';
    if (/lactat|breastfeed/.test(value)) return 'lactation';
    if (/elder|geriat|senior|old/.test(value)) return 'geriatric';
    if (/child|pediatric|paediatric|infant|newborn|neonate|toddler|year/.test(value)) return 'pediatric';
    if (/adult/.test(value)) return 'adult';
    return '';
}

function scoreDoseEntry(entry, populationKey, conditionKey) {
    let score = 0;
    const entryPopulation = normalizeKey(entry?.population);
    const indicationText = normalizeKey(`${entry?.indication ?? ''} ${entry?.sub_indication ?? ''} ${entry?.notes_text ?? ''} ${entry?.text ?? ''}`);

    if (populationKey) {
        if (entryPopulation === populationKey) score += 5;
        else if (!entryPopulation || entryPopulation === 'general') score += 2;
    }

    if (conditionKey) {
        if (indicationText.includes(conditionKey)) score += 4;
        else if (conditionKey.split(/\s+/).some((token) => token.length > 2 && indicationText.includes(token))) score += 2;
    }

    return score;
}

function pickDoseEntry(drug, patientAge, condition) {
    const entries = asArray(drug?.dosing).filter((entry) => normalizeText(entry?.notes_text ?? entry?.text));
    if (entries.length === 0) return null;

    const populationKey = inferPopulation(patientAge);
    const conditionKey = normalizeKey(condition);

    return entries
        .map((entry) => ({ entry, score: scoreDoseEntry(entry, populationKey, conditionKey) }))
        .sort((a, b) => b.score - a.score)[0]?.entry ?? entries[0];
}

function getDoseEntryText(entry) {
    return firstNonEmpty(entry?.notes_text, entry?.text);
}

function extractFrequencyText(text) {
    const source = normalizeText(text);
    if (!source) return DATA_ONLY_UNAVAILABLE;

    const patterns = [
        /once daily/i,
        /twice daily/i,
        /three times daily/i,
        /four times daily/i,
        /every\s+\d+(?:\s*-\s*\d+)?\s*(?:hours?|days?|weeks?)/i,
        /\bq\d+h\b/i,
        /\b(?:daily|weekly|monthly|bid|tid|qid|prn)\b/i,
    ];

    const match = patterns.map((pattern) => source.match(pattern)?.[0]).find(Boolean);
    return match || DATA_ONLY_UNAVAILABLE;
}

function normalizeInteractionSeverity(value) {
    const normalized = normalizeKey(value);
    if (!normalized) return 'Listed';
    if (normalized.includes('contra')) return 'Contraindicated';
    if (normalized.includes('major') || normalized.includes('serious') || normalized.includes('severe') || normalized.includes('high')) return 'Major';
    if (normalized.includes('moderate') || normalized.includes('monitor')) return 'Moderate';
    if (normalized.includes('minor') || normalized.includes('low')) return 'Minor';
    return 'Listed';
}

function interactionSeverityRank(value) {
    const normalized = normalizeInteractionSeverity(value);
    const ranks = {
        Listed: 1,
        Minor: 2,
        Moderate: 3,
        Major: 4,
        Contraindicated: 5,
    };
    return ranks[normalized] ?? 0;
}

function matchInteractionEntry(entry, targetDrug) {
    const interactionName = normalizeKey(
        firstNonEmpty(entry?.drug_name, entry?.interacting_drug, entry?.interactant_canonical, entry?.raw_drug_interactions, entry?.name)
    );
    if (!interactionName) return false;

    return buildDrugAliases(targetDrug).some((alias) => {
        const candidate = alias.toLowerCase();
        return interactionName === candidate || interactionName.includes(candidate) || candidate.includes(interactionName);
    });
}

function describeInteractionPair(drugA, drugB) {
    const pairEntries = [
        ...asArray(drugA?.interactions).filter((entry) => matchInteractionEntry(entry, drugB)),
        ...asArray(drugB?.interactions).filter((entry) => matchInteractionEntry(entry, drugA)),
    ];

    if (pairEntries.length === 0) return null;

    const bestEntry = pairEntries.sort(
        (left, right) => interactionSeverityRank(right?.severity_level ?? right?.qualifier) - interactionSeverityRank(left?.severity_level ?? left?.qualifier)
    )[0];

    return {
        pairLabel: `${getDrugDisplayName(drugA, 'Drug A')} + ${getDrugDisplayName(drugB, 'Drug B')}`,
        severity: normalizeInteractionSeverity(bestEntry?.severity_level ?? bestEntry?.qualifier),
        description: firstNonEmpty(bestEntry?.description, bestEntry?.text),
    };
}

function countWarnings(drug) {
    return asArray(drug?.warnings).filter((item) => normalizeText(item?.text)).length;
}

function countAdverseEffects(drug) {
    return collectAdverseEffectTexts(drug).length;
}

function buildMechanismSummary(drug) {
    return joinOrFallback(collectPharmacologyNotes(drug), DATA_ONLY_UNAVAILABLE, 1);
}

function buildIndicationsResult(drug) {
    const suggestedUses = pluckTexts(drug?.suggested_uses, ['suggested_use', 'use_text', 'text', 'indication', 'name']);

    return {
        primaryIndications: joinOrFallback(collectIndications(drug)),
        offLabelUses: joinOrFallback(suggestedUses),
        contraindications: joinOrFallback(collectContraindications(drug)),
        clinicalNote: firstNonEmpty(
            normalizeText(drug?.note_raw),
            collectAdministrationNotes(drug)[0],
            collectWarningTexts(drug)[0],
            DATA_ONLY_UNAVAILABLE
        ),
    };
}

function buildSideEffectsResult(drug) {
    const warnings = collectWarningTexts(drug);
    const seriousWarnings = collectSeriousWarningTexts(drug);
    const adverseEffects = collectAdverseEffectTexts(drug);
    const monitoringNote = warnings.find((entry) => /monitor|check|follow/i.test(entry));

    return {
        commonSideEffects: joinOrFallback(adverseEffects),
        seriousSideEffects: joinOrFallback(seriousWarnings.length > 0 ? seriousWarnings : warnings),
        monitoringRequired: firstNonEmpty(monitoringNote, warnings[0], DATA_ONLY_UNAVAILABLE),
        patientAdvice: firstNonEmpty(collectAdministrationNotes(drug)[0], normalizeText(drug?.note_raw), DATA_ONLY_UNAVAILABLE),
    };
}

function buildDosageResult(drug, fields) {
    const selectedDose = pickDoseEntry(drug, fields.patientAge, fields.condition);
    const selectedDoseText = getDoseEntryText(selectedDose);
    const defaultDoseText = collectDefaultDoseTexts(drug)[0];
    const maximumDoseText = collectMaximumDoseTexts(drug)[0];
    const specialInstruction = collectAdministrationNotes(drug)[0];
    const populationLabel = titleCase(selectedDose?.population || '');

    return {
        recommendedDose: firstNonEmpty(selectedDoseText, defaultDoseText, DATA_ONLY_UNAVAILABLE),
        frequency: extractFrequencyText(firstNonEmpty(selectedDoseText, defaultDoseText)),
        maxDailyDose: firstNonEmpty(maximumDoseText, DATA_ONLY_UNAVAILABLE),
        specialInstructions: firstNonEmpty(specialInstruction, DATA_ONLY_UNAVAILABLE),
        adjustmentNote: populationLabel
            ? `Matched ${populationLabel} dosing content from DoseFinder.`
            : DATA_ONLY_UNAVAILABLE,
    };
}

async function buildInteractionsResult(fields, preferredDrugData) {
    const drugA = await resolveDrugRecord(fields.drugA, preferredDrugData);
    const drugB = await resolveDrugRecord(fields.drugB, preferredDrugData);
    const pairSummaries = [];

    const mainPair = describeInteractionPair(drugA, drugB);
    if (mainPair) pairSummaries.push(mainPair);

    if (normalizeText(fields.drugC)) {
        const drugC = await resolveDrugRecord(fields.drugC, preferredDrugData);
        const pairAC = describeInteractionPair(drugA, drugC);
        const pairBC = describeInteractionPair(drugB, drugC);
        if (pairAC) pairSummaries.push(pairAC);
        if (pairBC) pairSummaries.push(pairBC);
    }

    const strongest = pairSummaries.sort((left, right) => interactionSeverityRank(right.severity) - interactionSeverityRank(left.severity))[0];

    return {
        interactionSeverity: strongest?.severity ?? 'None',
        mechanism: joinOrFallback(pairSummaries.map((entry) => entry.description), 'No interaction mechanism text was found in current DoseFinder data.'),
        clinicalEffect: pairSummaries.length > 0
            ? pairSummaries.map((entry) => `${entry.pairLabel}: ${entry.severity}`).join(' | ')
            : 'No interaction entry was found in current DoseFinder data for the selected pairings.',
        recommendation: pairSummaries.length > 0
            ? 'Review the listed DoseFinder interaction entries before combining these drugs.'
            : 'No interaction entry was found in current DoseFinder data for the selected pairings.',
    };
}

async function buildAlternativesResult(fields, preferredDrugData) {
    const primaryDrug = await resolveDrugRecord(fields.drugName, preferredDrugData);
    const candidateCondition = firstNonEmpty(fields.condition, collectIndications(primaryDrug)[0]);

    if (!candidateCondition) {
        return {
            firstAlternative: DATA_ONLY_UNAVAILABLE,
            secondAlternative: DATA_ONLY_UNAVAILABLE,
            thirdAlternative: DATA_ONLY_UNAVAILABLE,
            switchingNote: 'DoseFinder needs a matching indication before it can search for internal alternative records.',
        };
    }

    const searchArgs = {
        indication: candidateCondition,
        dosage_form: getFirstDosageForm(primaryDrug) || undefined,
        per_page: 12,
    };

    const searchResponse = await drugsApi.search(searchArgs);
    let candidates = asArray(searchResponse?.results).filter((drug) => getDrugId(drug) !== getDrugId(primaryDrug));

    if (candidates.length === 0) {
        const fallbackSearch = await drugsApi.search({ indication: candidateCondition, per_page: 12 });
        candidates = asArray(fallbackSearch?.results).filter((drug) => getDrugId(drug) !== getDrugId(primaryDrug));
    }

    const names = uniqueNonEmpty(
        candidates.map((drug) => getDrugDisplayName(drug))
    );

    return {
        firstAlternative: names[0] || DATA_ONLY_UNAVAILABLE,
        secondAlternative: names[1] || DATA_ONLY_UNAVAILABLE,
        thirdAlternative: names[2] || DATA_ONLY_UNAVAILABLE,
        switchingNote: names.length > 0
            ? `Candidates are other DoseFinder records matching indication "${candidateCondition}". This is not a therapeutic equivalence ranking.`
            : `No matching alternatives were found in current DoseFinder data for indication "${candidateCondition}".`,
    };
}

async function buildComparisonResult(fields, preferredDrugData) {
    const drugA = await resolveDrugRecord(fields.drugA, preferredDrugData);
    const drugB = await resolveDrugRecord(fields.drugB, preferredDrugData);
    const nameA = getDrugDisplayName(drugA, 'Drug A');
    const nameB = getDrugDisplayName(drugB, 'Drug B');

    const indicationsA = collectIndications(drugA);
    const indicationsB = collectIndications(drugB);
    const sharedIndications = indicationsA.filter((indication) => indicationsB.some((item) => item.toLowerCase() === indication.toLowerCase()));

    const adverseCountA = countAdverseEffects(drugA);
    const adverseCountB = countAdverseEffects(drugB);
    const warningCountA = countWarnings(drugA);
    const warningCountB = countWarnings(drugB);
    const focus = normalizeKey(fields.focus);

    let preferredFor = 'DoseFinder does not contain a preferred-option ranking for this comparison.';
    if (focus.includes('cost') && drugA?.price != null && drugB?.price != null) {
        preferredFor = Number(drugA.price) <= Number(drugB.price)
            ? `${nameA} has the lower recorded DoseFinder price.`
            : `${nameB} has the lower recorded DoseFinder price.`;
    } else if (focus.includes('safety') && warningCountA !== warningCountB) {
        preferredFor = warningCountA < warningCountB
            ? `${nameA} has fewer warning entries in DoseFinder, but DoseFinder does not rank overall safety.`
            : `${nameB} has fewer warning entries in DoseFinder, but DoseFinder does not rank overall safety.`;
    } else if (focus.includes('efficacy') && indicationsA.length !== indicationsB.length) {
        preferredFor = indicationsA.length > indicationsB.length
            ? `${nameA} lists more indications in DoseFinder, but DoseFinder does not rank comparative efficacy.`
            : `${nameB} lists more indications in DoseFinder, but DoseFinder does not rank comparative efficacy.`;
    }

    return {
        mechanism: `${nameA}: ${buildMechanismSummary(drugA)} | ${nameB}: ${buildMechanismSummary(drugB)}`,
        efficacy: sharedIndications.length > 0
            ? `Shared listed indications: ${joinOrFallback(sharedIndications, DATA_ONLY_UNAVAILABLE)}`
            : `${nameA} lists ${indicationsA.length} indications; ${nameB} lists ${indicationsB.length}.`,
        sideEffectProfile: `${nameA}: ${adverseCountA} adverse effects, ${warningCountA} warnings | ${nameB}: ${adverseCountB} adverse effects, ${warningCountB} warnings`,
        dosing: `${nameA}: ${firstNonEmpty(collectDefaultDoseTexts(drugA)[0], DATA_ONLY_UNAVAILABLE)} | ${nameB}: ${firstNonEmpty(collectDefaultDoseTexts(drugB)[0], DATA_ONLY_UNAVAILABLE)}`,
        costProfile: drugA?.price != null && drugB?.price != null
            ? `${nameA}: $${drugA.price} | ${nameB}: $${drugB.price}`
            : 'Price data is missing for one or both DoseFinder records.',
        preferredFor,
    };
}

async function buildResultFromDoseFinder(queryType, fields, preferredDrugData) {
    switch (queryType) {
        case 'indications': {
            const drug = await resolveDrugRecord(fields.drugName, preferredDrugData);
            return buildIndicationsResult(drug);
        }
        case 'sideEffects': {
            const drug = await resolveDrugRecord(fields.drugName, preferredDrugData);
            return buildSideEffectsResult(drug);
        }
        case 'dosage': {
            const drug = await resolveDrugRecord(fields.drugName, preferredDrugData);
            return buildDosageResult(drug, fields);
        }
        case 'interactions':
            return buildInteractionsResult(fields, preferredDrugData);
        case 'alternatives':
            return buildAlternativesResult(fields, preferredDrugData);
        case 'comparison':
            return buildComparisonResult(fields, preferredDrugData);
        default:
            throw new Error('Unsupported query type.');
    }
}

function ResultCard({ result }) {
    const labels = {
        primaryIndications: 'Primary Indications',
        offLabelUses: 'Suggested Uses',
        contraindications: 'Contraindications',
        clinicalNote: 'Clinical Note',
        commonSideEffects: 'Common Side Effects',
        seriousSideEffects: 'Serious Side Effects',
        monitoringRequired: 'Monitoring Required',
        patientAdvice: 'Patient Advice',
        recommendedDose: 'Recommended Dose',
        frequency: 'Frequency',
        maxDailyDose: 'Max Daily Dose',
        specialInstructions: 'Special Instructions',
        adjustmentNote: 'Adjustment Note',
        interactionSeverity: 'Severity',
        mechanism: 'Record Summary',
        clinicalEffect: 'Clinical Effect',
        recommendation: 'Recommendation',
        firstAlternative: '1st Alternative',
        secondAlternative: '2nd Alternative',
        thirdAlternative: '3rd Alternative',
        switchingNote: 'Selection Note',
        efficacy: 'Efficacy Snapshot',
        sideEffectProfile: 'Side Effect Profile',
        dosing: 'Dosing Snapshot',
        costProfile: 'Cost Profile',
        preferredFor: 'Preferred For',
    };

    const severityColor = {
        None: '#22c55e',
        Minor: '#84cc16',
        Moderate: '#f59e0b',
        Major: '#ef4444',
        Contraindicated: '#7c3aed',
        Listed: '#f59e0b',
    };

    return (
        <div className="aif-result-card">
            <div className="aif-result-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#13b6ec" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                DoseFinder Data Results
                <span className="aif-disclaimer-badge">Internal data only</span>
            </div>
            <div className="aif-result-grid">
                {Object.entries(result).map(([key, value]) => {
                    if (!value) return null;
                    const isSeverity = key === 'interactionSeverity';

                    return (
                        <div key={key} className="aif-result-row">
                            <p className="aif-result-label">{labels[key] ?? key}</p>
                            <p
                                className="aif-result-value"
                                style={isSeverity ? { color: severityColor[value] ?? '#f59e0b', fontWeight: 600 } : {}}
                            >
                                {value}
                            </p>
                        </div>
                    );
                })}
            </div>
            <p className="aif-result-footer">
                Uses only current DoseFinder records. If a field is missing here, it was not found in your data.
            </p>
        </div>
    );
}

export default function AIFillForm({
    defaultDrugName = '',
    defaultDrugData = null,
    className = '',
}) {
    const [queryType, setQueryType] = useState('indications');
    const [fields, setFields] = useState({ drugName: defaultDrugName });
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setFields((prev) => {
            const nextFields = FORM_FIELDS[queryType] ?? [];
            const hasDrugNameField = nextFields.some((field) => field.id === 'drugName');
            if (!hasDrugNameField) return prev;
            if (normalizeText(prev.drugName)) return prev;
            return { ...prev, drugName: defaultDrugName };
        });
    }, [queryType, defaultDrugName]);

    const currentFields = FORM_FIELDS[queryType] ?? [];

    const handleQueryTypeChange = (value) => {
        setQueryType(value);
        setResult(null);
        setError('');

        const nextFields = FORM_FIELDS[value] ?? [];
        const hasDrugNameField = nextFields.some((field) => field.id === 'drugName');
        setFields({ drugName: hasDrugNameField ? defaultDrugName : '' });
    };

    const handleFieldChange = (id, value) => {
        setFields((prev) => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async () => {
        setError('');
        setResult(null);

        const missing = currentFields.filter((field) => field.required && !normalizeText(fields[field.id]));
        if (missing.length > 0) {
            setError(`Please fill in: ${missing.map((field) => field.label).join(', ')}`);
            return;
        }

        setLoading(true);
        try {
            const nextResult = await buildResultFromDoseFinder(queryType, fields, defaultDrugData);
            setResult(nextResult);
        } catch (err) {
            setError(`DoseFinder data lookup failed: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleReset = () => {
        setFields({ drugName: defaultDrugName });
        setResult(null);
        setError('');
    };

    return (
        <div className={`aif-wrap ${className}`}>
            <div className="aif-header">
                <div className="aif-header-icon">
                    <svg width="16" height="16" viewBox="0 0 40 40" fill="none">
                        <rect x="0" y="0" width="16" height="16" fill="white" />
                        <rect x="20" y="0" width="20" height="8" fill="white" />
                        <rect x="20" y="12" width="20" height="8" fill="white" />
                        <rect x="0" y="20" width="16" height="8" fill="white" />
                        <rect x="0" y="32" width="16" height="8" fill="white" />
                        <rect x="20" y="24" width="20" height="16" fill="white" />
                    </svg>
                </div>
                <div>
                    <p className="aif-header-title">DoseFinder Data Assistant</p>
                    <p className="aif-header-sub">Summaries are built only from the drug records stored in DoseFinder.</p>
                </div>
            </div>

            <div className="aif-tabs">
                {QUERY_TYPES.map((item) => (
                    <button
                        key={item.value}
                        className={`aif-tab ${queryType === item.value ? 'active' : ''}`}
                        onClick={() => handleQueryTypeChange(item.value)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <div className="aif-fields">
                {currentFields.map((field) => (
                    <div key={field.id} className="aif-field-group">
                        <label className="aif-label">
                            {field.label}
                            {field.required && <span className="aif-required">*</span>}
                        </label>
                        <input
                            className="aif-input"
                            type="text"
                            placeholder={field.placeholder}
                            value={fields[field.id] ?? ''}
                            onChange={(event) => handleFieldChange(field.id, event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') handleSubmit();
                            }}
                        />
                    </div>
                ))}
            </div>

            {error && <p className="aif-error">{error}</p>}

            <div className="aif-actions">
                <button className="aif-btn-primary" onClick={handleSubmit} disabled={loading}>
                    {loading ? (
                        <>
                            <span className="aif-spinner" />
                            Checking data...
                        </>
                    ) : (
                        <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                            Search Data
                        </>
                    )}
                </button>
                {(result || error) && (
                    <button className="aif-btn-ghost" onClick={handleReset}>
                        Clear
                    </button>
                )}
            </div>

            {result && <ResultCard result={result} />}
        </div>
    );
}
