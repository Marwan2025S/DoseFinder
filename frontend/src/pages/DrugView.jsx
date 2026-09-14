import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import SearchHeader from '../components/SearchHeader';
import Footer from '../components/Footer';
import IssueStatusBadge from '../components/IssueStatusBadge';
import { useToast } from '../components/Toast';
import { useSavedItems } from '../hooks/useSavedItems';
import { useAuth } from '../contexts/AuthContext';
import { ISSUE_PART_OPTIONS, formatIssueDate } from '../constants/issues';
import { drugsApi, issuesApi } from '../services/api';
import { getDosageFormIcon } from '../utils/getDosageFormIcon';
import renderFdaText from '../utils/renderFdaText';
import { canManageDrugCatalog, isPendingDoctor } from '../utils/doctorAccess';
import '../styles/drug-view.css';

import AIFillForm from '../components/AIFillForm';

/* ──────────────── helpers ──────────────── */

/** Title-case a string: "HELLO WORLD" → "Hello World" */
const titleCase = (s) =>
    s
        ? s
            .toLowerCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
        : '';

const asArray = (value) => (Array.isArray(value) ? value : []);

const uniqueNonEmpty = (items) => {
    const seen = new Set();
    return items
        .map((item) => String(item ?? '').trim())
        .filter((item) => {
            if (!item) return false;
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

const parseStringArray = (value) => {
    if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    if (typeof value !== 'string') return [];
    const raw = value.trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
    } catch { /* ignore */ }
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
};

const firstExtension = (drug) => asArray(drug?.drug_dms_extensions)[0] ?? {};

const severityClass = (value) => {
    const s = String(value ?? '').toLowerCase();
    if (!s) return 'dv-neutral';
    if (s.includes('contra')) return 'dv-contra';
    if (s.includes('serious') || s.includes('major') || s.includes('severe') || s.includes('high')) return 'dv-serious';
    if (s.includes('monitor') || s.includes('moderate') || s.includes('medium')) return 'dv-monitor';
    return 'dv-neutral';
};

const formatDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatVersionLabel = (value) => {
    const version = Number(value);
    return Number.isFinite(version) && version > 0 ? `v${version}` : '—';
};

const POPULATION_ORDER = ['adult', 'pediatric', 'geriatric', 'pregnancy', 'lactation', 'general'];

const normalizePopulationKey = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return 'general';
    return raw.toLowerCase().replace(/[\s-]+/g, '_');
};

const populationLabel = (key) => {
    const labels = {
        adult: 'Adult',
        pediatric: 'Pediatric',
        geriatric: 'Geriatric',
        pregnancy: 'Pregnancy',
        lactation: 'Lactation',
        general: 'General',
    };
    return labels[key] || titleCase(key);
};

const topicLabel = (value, fallback = 'General') => {
    const raw = String(value ?? '').trim();
    if (!raw || normalizePopulationKey(raw) === 'general') return fallback;
    return raw
        .split('/')
        .map((part) => titleCase(part || fallback))
        .join(' / ');
};

const populationSort = (a, b) => {
    const indexA = POPULATION_ORDER.indexOf(a);
    const indexB = POPULATION_ORDER.indexOf(b);
    const weightA = indexA === -1 ? POPULATION_ORDER.length : indexA;
    const weightB = indexB === -1 ? POPULATION_ORDER.length : indexB;
    if (weightA !== weightB) return weightA - weightB;
    return a.localeCompare(b);
};

const sortGeneralFirst = (a, b) => {
    const aa = String(a ?? '').trim().toLowerCase();
    const bb = String(b ?? '').trim().toLowerCase();
    const aGeneral = !aa || aa === 'general';
    const bGeneral = !bb || bb === 'general';
    if (aGeneral !== bGeneral) return aGeneral ? -1 : 1;
    return aa.localeCompare(bb);
};

export default function DrugView() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { isSaved, saveItem, removeItem } = useSavedItems();
    const { user } = useAuth();

    const [drug, setDrug] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activePopulationTab, setActivePopulationTab] = useState('');
    const [userIssues, setUserIssues] = useState([]);
    const [userIssuesLoading, setUserIssuesLoading] = useState(false);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportPartKey, setReportPartKey] = useState(ISSUE_PART_OPTIONS[0].key);
    const [reportMessage, setReportMessage] = useState('');
    const [reportSubmitting, setReportSubmitting] = useState(false);
    const [visibilityModalOpen, setVisibilityModalOpen] = useState(false);
    const [visibilityReason, setVisibilityReason] = useState('');
    const [visibilitySubmitting, setVisibilitySubmitting] = useState(false);

    const drugId = Number(id) || 1;

    /* ── fetch all data in one call (getDetails returns embedded sub-tables) ── */
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        drugsApi.getDetails(drugId)
            .then((data) => {
                if (cancelled) return;
                if (data) setDrug(data);
                else setError('Drug not found');
            })
            .catch((err) => {
                if (!cancelled) setError(err.message || 'Failed to load drug');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [drugId]);

    /* ── derived values ── */
    const saved = isSaved(drugId);
    const extension = firstExtension(drug);
    const drugName = drug?.generic_name || drug?.display_name || drug?.name || 'Unknown Drug';

    useEffect(() => {
        if (drug) document.title = `${drugName} - DoseFinder`;
        return () => { document.title = 'DoseFinder'; };
    }, [drug, drugName]);
    const brandNames = drug?.brand_names || '';
    const genericName = drug?.generic_name || '';
    const needsReview = drug?.adminFlags?.reviewStatus === 'needs_review';
    const isHidden = drug?.adminFlags?.visibility === 'hidden';
    const canManageVisibility = canManageDrugCatalog(user);
    const canReportIssue = user?.role === 'user' && user?.emailVerified;
    const showEditDrugButton = user?.role === 'doctor' || user?.role === 'admin';
    const canEditDrug = canManageDrugCatalog(user);
    const editDrugTitle = canEditDrug
        ? 'Edit drug'
        : isPendingDoctor(user)
            ? 'Doctor approval pending'
            : 'Only approved doctors can edit drugs';

    const dosageForms = asArray(drug?.dosage_forms);
    const dosageFormLabel = drug?.dosage_form || dosageForms[0]?.form_name || '';
    const dosageStrengths = uniqueNonEmpty(dosageForms.map((item) => item?.strength_text));
    const strengthDisplay = dosageStrengths.length > 0 ? dosageStrengths.join(' | ') : null;

    const routesList = uniqueNonEmpty(
        parseStringArray(extension?.route ?? drug?.route),
    );
    const warningsList = asArray(drug?.warnings)
        .map((item) => ({
            id: item?.id,
            title: titleCase(item?.warning_type || 'General warning'),
            text: String(item?.text ?? '').trim(),
            subType: String(item?.sub_warning_type ?? '').trim(),
            listHeader: String(item?.list_header ?? '').trim(),
        }))
        .filter((item) => item.text);

    const interactionsList = asArray(drug?.interactions)
        .map((item) => ({
            id: item?.id ?? `${item?.drug_name ?? item?.interacting_drug ?? ''}_${item?.severity_level ?? ''}`,
            name: item?.drug_name || item?.interacting_drug || '',
            severity: item?.severity_level || item?.qualifier || '',
            description: String(item?.description ?? '').trim(),
        }))
        .filter((item) => String(item.name ?? '').trim());

    const sideEffectsData = useMemo(() => {
        const adverseEffects = asArray(drug?.adverse_effects);

        const commonEffects = [];
        const percentageBandMap = new Map();

        const bandSortWeight = (band) => {
            const value = String(band ?? '').trim().toLowerCase();
            if (value.includes('>')) return 3;
            if (value.includes('-') || value.includes('to')) return 2;
            if (value.includes('<')) return 1;
            return 0;
        };
        const bandSortNumber = (band) => {
            const match = String(band ?? '').match(/(\d+(\.\d+)?)/);
            return match ? Number(match[1]) : -1;
        };

        adverseEffects.forEach((effect) => {
            const text = String(effect?.effect_text ?? effect?.reaction_name ?? effect?.reaction_normalized ?? '').trim();
            if (!text) return;

            const severityBandRaw = String(effect?.severity_band ?? effect?.severity ?? '').trim();
            const bodySystemRaw = String(effect?.body_system ?? '').trim();
            const listHeaderRaw = String(effect?.list_header ?? '').trim();
            const isPercentageBand = /%/.test(severityBandRaw) || /%/.test(text);

            if (!isPercentageBand) {
                commonEffects.push(text);
                return;
            }

            const severityBand = severityBandRaw || 'Percentage';
            const bodySystem = !bodySystemRaw || normalizePopulationKey(bodySystemRaw) === 'general'
                ? 'General'
                : titleCase(bodySystemRaw);
            const listHeader = !listHeaderRaw || normalizePopulationKey(listHeaderRaw) === 'general'
                ? ''
                : titleCase(listHeaderRaw);

            if (!percentageBandMap.has(severityBand)) percentageBandMap.set(severityBand, new Map());
            const bodySystemsMap = percentageBandMap.get(severityBand);
            if (!bodySystemsMap.has(bodySystem)) bodySystemsMap.set(bodySystem, new Map());
            const headersMap = bodySystemsMap.get(bodySystem);
            if (!headersMap.has(listHeader)) headersMap.set(listHeader, []);
            headersMap.get(listHeader).push(text);
        });

        const percentageBands = Array.from(percentageBandMap.entries())
            .map(([severityBand, bodySystemsMap]) => ({
                severityBand,
                bodySystems: Array.from(bodySystemsMap.entries())
                    .sort(([a], [b]) => sortGeneralFirst(a, b))
                    .map(([bodySystem, headersMap]) => ({
                        bodySystem,
                        headers: Array.from(headersMap.entries())
                            .sort(([a], [b]) => sortGeneralFirst(a, b))
                            .map(([listHeader, items]) => ({
                                listHeader,
                                items: uniqueNonEmpty(items),
                            })),
                    })),
            }))
            .sort((a, b) => {
                const weightDiff = bandSortWeight(b.severityBand) - bandSortWeight(a.severityBand);
                if (weightDiff !== 0) return weightDiff;
                const numberDiff = bandSortNumber(b.severityBand) - bandSortNumber(a.severityBand);
                if (numberDiff !== 0) return numberDiff;
                return a.severityBand.localeCompare(b.severityBand);
            });

        return {
            commonEffects: uniqueNonEmpty(commonEffects),
            percentageBands,
        };
    }, [drug]);

    const uniqueCommonEffects = sideEffectsData.commonEffects;
    const percentageEffectBands = sideEffectsData.percentageBands;

    const arabicRoutes = parseStringArray(extension?.arabic_route ?? drug?.arabic_route);
    const classesList = uniqueNonEmpty(asArray(drug?.classes).map((item) => item?.class_name));
    const fdaProducts = asArray(drug?.fda_products);
    const fdaSubmissions = asArray(drug?.fda_submissions);
    const fdaExtensions = asArray(drug?.fda_extensions);
    const fdaProductLabels = uniqueNonEmpty(fdaProducts.flatMap((item) => [
        item?.product_ndc ? `NDC ${item.product_ndc}` : '',
        item?.application_number ? `Application ${item.application_number}` : '',
    ]));
    const fdaSubmissionLabels = uniqueNonEmpty(fdaSubmissions.map((item) => [
        item?.application_number,
        `${item?.submission_type || ''}${item?.submission_number || ''}`.trim(),
        item?.submission_status,
        item?.submission_status_date,
    ].filter(Boolean).join(' ')));
    const fdaDocuments = fdaSubmissions.flatMap((submission) => {
        const raw = submission?.application_docs_json;
        if (!raw) return [];
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return Array.isArray(parsed)
                ? parsed.filter((item) => item && typeof item === 'object' && (item.url || item.type || item.date))
                : [];
        } catch {
            return [];
        }
    });
    const hasFdaData = fdaExtensions.length > 0
        || fdaProductLabels.length > 0
        || fdaSubmissionLabels.length > 0
        || fdaDocuments.length > 0;

    const usageGroups = useMemo(() => {
        const grouped = new Map();
        asArray(drug?.administration).forEach((entry) => {
            const text = String(entry?.text ?? '').trim();
            if (!text) return;
            const topicRaw = String(entry?.topic ?? '').trim();
            const subTopicRaw = String(entry?.sub_topic ?? '').trim();
            const listHeaderRaw = String(entry?.list_header ?? '').trim();

            const topic = topicRaw && normalizePopulationKey(topicRaw) !== 'general' ? titleCase(topicRaw) : '';
            const subTopic = subTopicRaw && normalizePopulationKey(subTopicRaw) !== 'general' ? titleCase(subTopicRaw) : '';
            const listHeader = listHeaderRaw && normalizePopulationKey(listHeaderRaw) !== 'general' ? titleCase(listHeaderRaw) : '';

            if (!grouped.has(topic)) grouped.set(topic, new Map());
            const subGroups = grouped.get(topic);
            if (!subGroups.has(subTopic)) subGroups.set(subTopic, new Map());
            const headerGroups = subGroups.get(subTopic);
            if (!headerGroups.has(listHeader)) headerGroups.set(listHeader, []);
            headerGroups.get(listHeader).push(text);
        });

        return Array.from(grouped.entries())
            .sort(([a], [b]) => sortGeneralFirst(a, b))
            .map(([topic, subGroups]) => ({
                topic,
                sections: Array.from(subGroups.entries())
                    .sort(([a], [b]) => sortGeneralFirst(a, b))
                    .map(([subTopic, headerGroups]) => ({
                        subTopic,
                        headers: Array.from(headerGroups.entries())
                            .sort(([a], [b]) => sortGeneralFirst(a, b))
                            .map(([listHeader, items]) => ({
                                listHeader,
                                items: uniqueNonEmpty(items),
                            })),
                    })),
            }));
    }, [drug]);

    const suggestedUseGroups = useMemo(() => {
        const grouped = new Map();
        asArray(drug?.suggested_uses).forEach((entry) => {
            const text = String(entry?.text ?? '').trim();
            if (!text) return;
            const topic = topicLabel(entry?.topic, 'Uses');
            if (!grouped.has(topic)) grouped.set(topic, []);
            grouped.get(topic).push(text);
        });

        return Array.from(grouped.entries())
            .sort(([a], [b]) => sortGeneralFirst(a, b))
            .map(([topic, items]) => ({
                topic,
                items: uniqueNonEmpty(items),
            }))
            .filter((group) => group.items.length > 0);
    }, [drug]);

    const dosingGroups = useMemo(() => {
        const grouped = new Map();
        asArray(drug?.dosing).forEach((dose) => {
            const text = String(dose?.notes_text ?? dose?.text ?? '').trim();
            if (!text) return;
            const populationKey = normalizePopulationKey(dose?.population);
            const population = populationKey === 'default' || populationKey === 'general'
                ? ''
                : populationLabel(populationKey);
            const indication = topicLabel(dose?.indication, 'Dosing');
            const subIndicationRaw = String(dose?.sub_indication ?? '').trim();
            const subIndication = subIndicationRaw && normalizePopulationKey(subIndicationRaw) !== 'general'
                ? topicLabel(subIndicationRaw)
                : '';
            const listHeaderRaw = String(dose?.list_header ?? '').trim();
            const listHeader = listHeaderRaw && normalizePopulationKey(listHeaderRaw) !== 'general'
                ? topicLabel(listHeaderRaw)
                : '';
            const key = `${populationKey}::${indication}::${subIndication}::${listHeader}`;
            if (!grouped.has(key)) grouped.set(key, { populationKey, population, indication, subIndication, listHeader, items: [] });
            grouped.get(key).items.push(text);
        });

        return Array.from(grouped.values())
            .sort((a, b) => (
                populationSort(a.populationKey, b.populationKey)
                || sortGeneralFirst(a.indication, b.indication)
                || sortGeneralFirst(a.subIndication, b.subIndication)
                || sortGeneralFirst(a.listHeader, b.listHeader)
            ))
            .map((group) => ({
                ...group,
                items: uniqueNonEmpty(group.items),
            }))
            .filter((group) => group.items.length > 0);
    }, [drug]);

    const suggestedDosingGroups = useMemo(() => {
        const grouped = new Map();
        asArray(drug?.suggested_dosing).forEach((dose) => {
            const text = String(dose?.notes_text ?? dose?.text ?? '').trim();
            if (!text) return;
            const populationKey = normalizePopulationKey(dose?.population);
            const population = populationLabel(populationKey);
            const indication = topicLabel(dose?.indication, 'Suggested Dosing');
            const subIndicationRaw = String(dose?.sub_indication ?? '').trim();
            const subIndication = subIndicationRaw && normalizePopulationKey(subIndicationRaw) !== 'general'
                ? topicLabel(subIndicationRaw)
                : '';
            const listHeaderRaw = String(dose?.list_header ?? '').trim();
            const listHeader = listHeaderRaw && normalizePopulationKey(listHeaderRaw) !== 'general'
                ? topicLabel(listHeaderRaw)
                : '';
            const key = `${populationKey}::${indication}::${subIndication}::${listHeader}`;
            if (!grouped.has(key)) grouped.set(key, { populationKey, population, indication, subIndication, listHeader, items: [] });
            grouped.get(key).items.push(text);
        });

        return Array.from(grouped.values())
            .sort((a, b) => (
                populationSort(a.populationKey, b.populationKey)
                || sortGeneralFirst(a.indication, b.indication)
                || sortGeneralFirst(a.subIndication, b.subIndication)
            ))
            .map((group) => ({
                ...group,
                items: uniqueNonEmpty(group.items),
            }))
            .filter((group) => group.items.length > 0);
    }, [drug]);

    const nutritionGroups = useMemo(() => {
        const grouped = new Map();
        asArray(drug?.nutrition).forEach((entry) => {
            const text = String(entry?.text ?? '').trim();
            if (!text) return;
            const topic = topicLabel(entry?.topic, 'Nutrition');
            if (!grouped.has(topic)) grouped.set(topic, []);
            grouped.get(topic).push(text);
        });

        return Array.from(grouped.entries())
            .sort(([a], [b]) => sortGeneralFirst(a, b))
            .map(([topic, items]) => ({
                topic,
                items: uniqueNonEmpty(items),
            }))
            .filter((group) => group.items.length > 0);
    }, [drug]);

    const warningGroups = useMemo(() => {
        const groupedWarnings = new Map();
        warningsList.forEach((warning) => {
            const type = warning.title || 'General Warning';
            const subType = warning.subType || '';
            const listHeader = warning.listHeader || '';
            if (!groupedWarnings.has(type)) groupedWarnings.set(type, new Map());
            const subGroups = groupedWarnings.get(type);
            if (!subGroups.has(subType)) subGroups.set(subType, new Map());
            const headerGroups = subGroups.get(subType);
            if (!headerGroups.has(listHeader)) headerGroups.set(listHeader, []);
            headerGroups.get(listHeader).push(warning.text);
        });

        return Array.from(groupedWarnings.entries()).map(([type, subGroups]) => ({
            title: type,
            sections: Array.from(subGroups.entries())
                .sort(([a], [b]) => sortGeneralFirst(a, b))
                .map(([subTitle, headerGroups]) => ({
                    subTitle: subTitle && normalizePopulationKey(subTitle) !== 'general' ? titleCase(subTitle) : '',
                    headers: Array.from(headerGroups.entries())
                        .sort(([a], [b]) => sortGeneralFirst(a, b))
                        .map(([listHeader, items]) => ({
                            listHeader: listHeader && normalizePopulationKey(listHeader) !== 'general' ? titleCase(listHeader) : '',
                            items: uniqueNonEmpty(items),
                        }))
                        .filter((headerGroup) => headerGroup.items.length > 0),
                })),
        }));
    }, [warningsList]);

    const populationTabs = useMemo(() => {
        const tabs = new Map();

        const ensureTab = (rawPopulation) => {
            const key = normalizePopulationKey(rawPopulation);
            if (!tabs.has(key)) {
                tabs.set(key, {
                    key,
                    label: populationLabel(key),
                    formsMap: new Map(),
                    dosingMap: new Map(),
                    pregnancyMap: new Map(),
                });
            }
            return tabs.get(key);
        };

        dosageForms.forEach((form) => {
            const formName = String(form?.form_name ?? '').trim();
            const strengthText = String(form?.strength_text ?? '').trim();
            if (!formName && !strengthText) return;
            const tab = ensureTab(form?.population);
            const normalizedFormName = titleCase(formName || 'Form');
            if (!tab.formsMap.has(normalizedFormName)) tab.formsMap.set(normalizedFormName, []);
            if (strengthText) tab.formsMap.get(normalizedFormName).push(strengthText);
        });

        asArray(drug?.dosing).forEach((dose) => {
            const text = String(dose?.notes_text ?? dose?.text ?? '').trim();
            if (!text) return;
            const tab = ensureTab(dose?.population);
            const titleRaw = String(dose?.indication ?? '').trim();
            const title = titleRaw && normalizePopulationKey(titleRaw) !== 'general' ? titleCase(titleRaw) : '';
            const subTitleRaw = String(dose?.sub_indication ?? '').trim();
            const subTitle = subTitleRaw && normalizePopulationKey(subTitleRaw) !== 'general' ? titleCase(subTitleRaw) : '';
            const listHeaderRaw = String(dose?.list_header ?? '').trim();
            const listHeader = listHeaderRaw && normalizePopulationKey(listHeaderRaw) !== 'general' ? titleCase(listHeaderRaw) : '';

            if (!tab.dosingMap.has(title)) tab.dosingMap.set(title, new Map());
            const subGroups = tab.dosingMap.get(title);
            if (!subGroups.has(subTitle)) subGroups.set(subTitle, new Map());
            const headerGroups = subGroups.get(subTitle);
            if (!headerGroups.has(listHeader)) headerGroups.set(listHeader, []);
            headerGroups.get(listHeader).push(text);
        });

        asArray(drug?.pregnancy).forEach((entry) => {
            const text = String(entry?.text ?? '').trim();
            if (!text) return;
            const tab = ensureTab('pregnancy');
            const topicRaw = String(entry?.topic ?? '').trim();
            const topicKey = normalizePopulationKey(topicRaw);
            const title = !topicRaw || topicKey === 'general' ? 'Pregnancy' : titleCase(topicRaw);
            const subTitleRaw = String(entry?.sub_topic ?? '').trim();
            const subTitle = subTitleRaw && normalizePopulationKey(subTitleRaw) !== 'general' ? titleCase(subTitleRaw) : '';
            const listHeaderRaw = String(entry?.list_header ?? '').trim();
            const listHeader = listHeaderRaw && normalizePopulationKey(listHeaderRaw) !== 'general' ? titleCase(listHeaderRaw) : '';
            if (!tab.pregnancyMap.has(title)) tab.pregnancyMap.set(title, new Map());
            const subGroups = tab.pregnancyMap.get(title);
            if (!subGroups.has(subTitle)) subGroups.set(subTitle, new Map());
            const headerGroups = subGroups.get(subTitle);
            if (!headerGroups.has(listHeader)) headerGroups.set(listHeader, []);
            headerGroups.get(listHeader).push(text);
        });

        return Array.from(tabs.values())
            .map((tab) => {
                const forms = Array.from(tab.formsMap.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([formName, strengths]) => ({
                        formName,
                        strengths: uniqueNonEmpty(strengths),
                    }));
                const dosingSections = Array.from(tab.dosingMap.entries())
                    .sort(([a], [b]) => sortGeneralFirst(a, b))
                    .map(([title, subGroups]) => ({
                        title,
                        sections: Array.from(subGroups.entries())
                            .sort(([a], [b]) => sortGeneralFirst(a, b))
                            .map(([subTitle, headerGroups]) => ({
                                subTitle,
                                headers: Array.from(headerGroups.entries())
                                    .sort(([a], [b]) => sortGeneralFirst(a, b))
                                    .map(([header, items]) => ({
                                        header,
                                        items: uniqueNonEmpty(items),
                                    })),
                            })),
                    }));
                const pregnancyGroups = Array.from(tab.pregnancyMap.entries())
                    .map(([title, subGroups]) => ({
                        title,
                        sections: Array.from(subGroups.entries())
                            .sort(([a], [b]) => sortGeneralFirst(a, b))
                            .map(([subTitle, headerGroups]) => ({
                                subTitle,
                                headers: Array.from(headerGroups.entries())
                                    .sort(([a], [b]) => sortGeneralFirst(a, b))
                                    .map(([header, items]) => ({
                                        header,
                                        items: uniqueNonEmpty(items),
                                    })),
                            })),
                    }))
                    .sort((a, b) => {
                        const order = ['pregnancy', 'lactation'];
                        const ai = order.indexOf(a.title.toLowerCase());
                        const bi = order.indexOf(b.title.toLowerCase());
                        const wa = ai === -1 ? order.length : ai;
                        const wb = bi === -1 ? order.length : bi;
                        if (wa !== wb) return wa - wb;
                        return a.title.localeCompare(b.title);
                    });
                return {
                    key: tab.key,
                    label: tab.label,
                    forms,
                    dosingSections,
                    pregnancyGroups,
                };
            })
            .filter((tab) => tab.forms.length > 0 || tab.dosingSections.length > 0 || tab.pregnancyGroups.length > 0)
            .sort((a, b) => populationSort(a.key, b.key));
    }, [dosageForms, drug]);

    const pharmacologyGroups = useMemo(() => {
        const grouped = new Map();
        asArray(drug?.pharmacology).forEach((entry) => {
            const text = String(entry?.text ?? '').trim();
            if (!text) return;
            const topicRaw = String(entry?.topic ?? '').trim();
            const topic = topicRaw && normalizePopulationKey(topicRaw) !== 'general' ? titleCase(topicRaw) : '';
            const subTitleRaw = String(entry?.sub_topic ?? '').trim();
            const subTitle = subTitleRaw && normalizePopulationKey(subTitleRaw) !== 'general' ? titleCase(subTitleRaw) : '';
            const listHeaderRaw = String(entry?.list_header ?? '').trim();
            const listHeader = listHeaderRaw && normalizePopulationKey(listHeaderRaw) !== 'general' ? titleCase(listHeaderRaw) : '';
            if (!grouped.has(topic)) grouped.set(topic, new Map());
            const sections = grouped.get(topic);
            if (!sections.has(subTitle)) sections.set(subTitle, new Map());
            const headerGroups = sections.get(subTitle);
            if (!headerGroups.has(listHeader)) headerGroups.set(listHeader, []);
            headerGroups.get(listHeader).push(text);
        });

        return Array.from(grouped.entries())
            .sort(([a], [b]) => sortGeneralFirst(a, b))
            .map(([topic, sections]) => ({
                topic,
                sections: Array.from(sections.entries())
                    .sort(([a], [b]) => sortGeneralFirst(a, b))
                    .map(([subTitle, headerGroups]) => ({
                        subTitle,
                        headers: Array.from(headerGroups.entries())
                            .sort(([a], [b]) => sortGeneralFirst(a, b))
                            .map(([header, items]) => ({
                                header,
                                items: uniqueNonEmpty(items),
                            })),
                    })),
            }));
    }, [drug]);

    useEffect(() => {
        if (populationTabs.length === 0) {
            if (activePopulationTab) setActivePopulationTab('');
            return;
        }
        const tabExists = populationTabs.some((tab) => tab.key === activePopulationTab);
        if (!tabExists) setActivePopulationTab(populationTabs[0].key);
    }, [populationTabs, activePopulationTab]);

    const activePopulationData = populationTabs.find((tab) => tab.key === activePopulationTab) || null;

    const pregnancyEntries = uniqueNonEmpty(asArray(drug?.pregnancy).map((item) => item?.text));
    const updatedDate = formatDate(drug?.updated_at);

    useEffect(() => {
        let cancelled = false;

        if (!canReportIssue) {
            setUserIssues([]);
            setUserIssuesLoading(false);
            return undefined;
        }

        setUserIssuesLoading(true);
        issuesApi.getMine(drugId)
            .then((issues) => {
                if (!cancelled) {
                    setUserIssues(Array.isArray(issues) ? issues : []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setUserIssues([]);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setUserIssuesLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [canReportIssue, drugId]);

    const resetIssueForm = () => {
        setReportPartKey(ISSUE_PART_OPTIONS[0].key);
        setReportMessage('');
    };

    const closeIssueModal = () => {
        if (reportSubmitting) return;
        setReportModalOpen(false);
        resetIssueForm();
    };

    const handleSave = async () => {
        try {
            if (!saved) {
                await saveItem({
                    id: drugId,
                    generic_name: genericName,
                    brand_names: brandNames,
                    route: `/drug/${drugId}`,
                    classes: drug?.classes || [],
                    rx: drug?.rx_status || drug?.rx || '',
                    price: drug?.price ?? extension?.price,
                    dosage_form: dosageFormLabel,
                    ham: drug?.ham,
                    has_fda: hasFdaData,
                });
                showToast('Saved to your list');
            } else {
                await removeItem(drugId);
                showToast('Removed from saved items');
            }
        } catch (error) {
            showToast(error.message || 'Failed to update saved items');
        }
    };

    const handleShare = () => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(window.location.href)
                .then(() => showToast('Link copied to clipboard'));
        } else {
            showToast('Link copied');
        }
    };

    const handleSubmitIssue = async (event) => {
        event.preventDefault();

        if (!canReportIssue) {
            showToast('Verify your user account before reporting issues.');
            return;
        }

        if (!reportMessage.trim()) {
            showToast('Write a short message describing the issue.');
            return;
        }

        setReportSubmitting(true);
        try {
            const createdIssue = await issuesApi.create({
                drugId,
                partKey: reportPartKey,
                message: reportMessage.trim(),
            });

            setUserIssues((prev) => [createdIssue, ...prev]);
            showToast('Issue reported successfully.');
            setReportModalOpen(false);
            resetIssueForm();

            issuesApi.getMine(drugId)
                .then((issues) => setUserIssues(Array.isArray(issues) ? issues : []))
                .catch(() => {
                    // Keep the optimistic list when refresh fails.
                });
        } catch (error) {
            showToast(error.message || 'Failed to report issue');
        } finally {
            setReportSubmitting(false);
        }
    };

    const handleVisibilityToggle = async (event) => {
        event.preventDefault();
        if (!visibilityReason.trim()) {
            showToast('A reason is required to change visibility.');
            return;
        }
        setVisibilitySubmitting(true);
        try {
            const nextVisibility = isHidden ? 'visible' : 'hidden';
            const updatedFlags = await drugsApi.updateVisibility(drugId, { visibility: nextVisibility, reason: visibilityReason.trim() });
            setDrug((prev) => ({ ...prev, adminFlags: { ...(prev?.adminFlags ?? {}), ...updatedFlags } }));
            showToast(`Drug marked as ${nextVisibility}.`);
            setVisibilityModalOpen(false);
            setVisibilityReason('');
        } catch (error) {
            showToast(error.message || 'Failed to update visibility');
        } finally {
            setVisibilitySubmitting(false);
        }
    };

    /* ── loading / error states ── */
    if (loading) {
        return (
            <div className="drug-view-page">
                <SearchHeader />
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                    <div className="auth-btn__spinner" style={{ width: 32, height: 32, borderWidth: 3 }}></div>
                </div>
                <Footer />
            </div>
        );
    }

    if (error || !drug) {
        return (
            <div className="drug-view-page">
                <SearchHeader />
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', gap: 16 }}>
                    <h2>{error || 'Drug not found'}</h2>
                    <Link to="/search-results" className="sr-btn-view-primary">Back to Search</Link>
                </div>
                <Footer />
            </div>
        );
    }

    /* ─────────────────────── RENDER ─────────────────────── */
    return (
        <div className="drug-view-page">
            <SearchHeader />

            <div className="dv-breadcrumb-bar">
                <div className="dv-container">
                    <span className="dv-bc-item">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                    </span>
                    <span className="dv-sep">/</span>
                    <Link to="/search-results" className="dv-bc-link">Search</Link>
                    <span className="dv-sep">/</span>
                    <span className="dv-bc-current">{drugName}</span>
                </div>
            </div>

            <div className="dv-page-wrap">
                <div className="dv-container dv-main-grid">

                    {/* ═══════════ LEFT COLUMN ═══════════ */}
                    <div className="dv-left-col">

                        {/* ── Drug Header ── */}
                        <div className="dv-card">
                            <div className="dv-drug-title-row">
                                <div className="dv-drug-name-block">
                                    <h1 className="dv-drug-name">{drugName}</h1>
                                    {brandNames && <p className="dv-generic-name">Brands: {brandNames}</p>}
                                    <div className="dv-drug-tags">
                                        {dosageFormLabel && <span className="dv-tag dv-t-blue">{titleCase(dosageFormLabel)}</span>}
                                        {strengthDisplay && <span className="dv-tag dv-t-blue">{strengthDisplay}</span>}
                                        {(drug.ham === 'YES' || drug.ham === 1 || drug.ham === '1') && <span className="dv-tag dv-t-warn">HAM</span>}
                                        {hasFdaData && <span className="dv-tag dv-t-blue">FDA</span>}
                                        {needsReview && <span className="dv-tag dv-t-warn">Needs review</span>}
                                        {isHidden && canManageVisibility && <span className="dv-tag dv-t-muted">Deleted</span>}
                                    </div>
                                </div>
                                <div className="dv-drug-action-btns">
                                    {showEditDrugButton && (
                                        <button
                                            className="dv-btn-outline dv-edit-btn"
                                            type="button"
                                            title={editDrugTitle}
                                            disabled={!canEditDrug}
                                            onClick={() => {
                                                if (canEditDrug) navigate(`/edit-drug/${drugId}`);
                                            }}
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
                                            </svg>
                                            Edit
                                        </button>
                                    )}
                                    <button className="dv-btn-outline" onClick={handleSave} style={{ color: saved ? '#13b6ec' : '', borderColor: saved ? '#13b6ec' : '' }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill={saved ? '#13b6ec' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                                        {saved ? 'Saved' : 'Save'}
                                    </button>
                                    <button className="dv-btn-outline" onClick={handleShare}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                                        Share
                                    </button>
                                    {canManageVisibility && (
                                        <button
                                            className="dv-btn-outline"
                                            type="button"
                                            onClick={() => setVisibilityModalOpen(true)}
                                        >
                                            {isHidden ? (
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                                    <path d="M3 3v5h5" />
                                                </svg>
                                            ) : (
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                    <line x1="10" y1="11" x2="10" y2="17" />
                                                    <line x1="14" y1="11" x2="14" y2="17" />
                                                </svg>
                                            )}
                                            {isHidden ? 'Restore' : 'Delete'}
                                        </button>
                                    )}
                                    {canReportIssue && (
                                        <button
                                            className="dv-btn-outline dv-report-btn"
                                            type="button"
                                            onClick={() => setReportModalOpen(true)}
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                            </svg>
                                            Report Issue
                                        </button>
                                    )}
                                    <button
                                        className="btn-ai dv-ask-dosegpt-btn"
                                        onClick={() => navigate('/chatbot', { state: { drugId, drugData: drug } })}
                                        aria-label="Ask DoseGPT in chatbot"
                                    >
                                        <svg className="ai-gem" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                            <path
                                                fillRule="evenodd"
                                                clipRule="evenodd"
                                                d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5z"
                                            />
                                        </svg>
                                        <span>Ask DoseGPT</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* ── Routes of Administration ── */}
                        {(routesList.length > 0 || drug?.source || drug?.rx_status) && (
                            <div className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Medication Information</h2>
                                </div>

                                <div className="dv-med-info-grid">
                                    {dosageFormLabel && (
                                        <div>
                                            <p className="dv-info-label">Dosage Form</p>
                                            <p className="dv-info-value">{titleCase(dosageFormLabel)}</p>
                                        </div>
                                    )}
                                    {drug?.source && (
                                        <div>
                                            <p className="dv-info-label">Data Source</p>
                                            <p className="dv-info-value">{drug.source}</p>
                                        </div>
                                    )}
                                    {(drug?.rx_status || drug?.rx) && (
                                        <div>
                                            <p className="dv-info-label">Rx Status</p>
                                            <p className="dv-info-value">{drug.rx_status || drug.rx}</p>
                                        </div>
                                    )}
                                    {updatedDate && (
                                        <div>
                                            <p className="dv-info-label">Updated</p>
                                            <p className="dv-info-value">{updatedDate}</p>
                                        </div>
                                    )}
                                </div>

                                {routesList.length > 0 && (
                                    <ul className="dv-dot-list">
                                        {routesList.map((route, i) => (
                                            <li key={`${route}_${i}`}>{titleCase(route)}</li>
                                        ))}
                                    </ul>
                                )}
                                {arabicRoutes.length > 0 && (
                                    <div className="dv-arabic-routes" style={{ marginTop: 8, color: '#64748b', fontSize: '0.9rem' }}>
                                        {arabicRoutes.map((ar, i) => (
                                            <span key={i} style={{ marginInlineEnd: 8 }}>{ar.normalized_route || ar.raw_route || ar.route_name}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {suggestedUseGroups.length > 0 && (
                            <div id="dv-section-uses" className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z" /><path d="M8 7h6M8 11h8M8 15h5" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Uses & Label Purpose</h2>
                                </div>
                                <div className="dv-detail-groups">
                                    {suggestedUseGroups.map((group, index) => (
                                        <div key={`${group.topic}_${index}`} className="dv-detail-box">
                                            <p className="dv-detail-title">{group.topic}</p>
                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                {group.items.map((item, itemIndex) => (
                                                    <li key={`${item}_${itemIndex}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {dosingGroups.length > 0 && (
                            <div id="dv-section-dosing" className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11h6M9 15h3M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Dosing & Administration</h2>
                                </div>
                                <div className="dv-detail-groups">
                                    {dosingGroups.map((group, index) => (
                                        <div key={`${group.population}_${group.indication}_${index}`} className="dv-detail-box">
                                            <p className="dv-detail-title">{group.indication}</p>
                                            {[group.population, group.subIndication, group.listHeader].filter(Boolean).length > 0 && (
                                                <p className="dv-detail-subtitle">
                                                    {[group.population, group.subIndication, group.listHeader].filter(Boolean).join(' / ')}
                                                </p>
                                            )}
                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                {group.items.map((item, itemIndex) => (
                                                    <li key={`${item}_${itemIndex}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Warnings ── */}
                        {warningGroups.length > 0 && (
                            <div id="dv-section-warnings" className="dv-card dv-card-danger-soft">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-warn">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m10.29 3.86-8.6 14.9A1 1 0 0 0 2.57 20h18.86a1 1 0 0 0 .88-1.24L13.71 3.86a1 1 0 0 0-1.74 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Warnings</h2>
                                </div>
                                <div className="dv-warning-groups">
                                    {warningGroups.map((warning, i) => (
                                        <div key={`${warning.title}_${i}`} className="dv-warning-box">
                                            <p className="dv-warning-title">{warning.title}</p>
                                            {warning.sections.map((section, index) => (
                                                <div key={`${section.subTitle}_${index}`} className="dv-warning-subgroup">
                                                    {section.subTitle && <p className="dv-warning-subtitle">{section.subTitle}</p>}
                                                    {section.headers.map((headerGroup, headerIndex) => (
                                                        <div key={`${headerGroup.listHeader}_${headerIndex}`} className="dv-pop-header-group">
                                                            {headerGroup.listHeader && <p className="dv-pop-list-header">{headerGroup.listHeader}</p>}
                                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                                {headerGroup.items.map((item, itemIndex) => (
                                                                    <li key={`${item}_${itemIndex}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ÄÄ Usage Instructions ÄÄ */}
                        {usageGroups.length > 0 && (
                            <div id="dv-section-usage" className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Usage Instructions</h2>
                                </div>
                                <div className="dv-warning-groups">
                                    {usageGroups.map((group, i) => (
                                        <div key={`${group.topic}_${i}`} className="dv-warning-box">
                                            {group.topic && <p className="dv-warning-title">{group.topic}</p>}
                                            {group.sections.map((section, sectionIndex) => (
                                                <div key={`${section.subTopic}_${sectionIndex}`} className="dv-warning-subgroup">
                                                    {section.subTopic && <p className="dv-warning-subtitle">{section.subTopic}</p>}
                                                    {section.headers.map((headerGroup, headerIndex) => (
                                                        <div key={`${headerGroup.listHeader}_${headerIndex}`} className="dv-pop-header-group">
                                                            {headerGroup.listHeader && <p className="dv-pop-list-header">{headerGroup.listHeader}</p>}
                                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                                {headerGroup.items.map((item, idx) => (
                                                                    <li key={`${item}_${idx}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Population Forms & Dosing */}
                        {populationTabs.length > 0 && (
                            <div id="dv-section-population" className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11h6M9 15h3M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Population Forms & Dosing</h2>
                                </div>

                                <div className="dv-pop-tabs" role="tablist" aria-label="Population tabs">
                                    {populationTabs.map((tab) => (
                                        <button
                                            key={tab.key}
                                            type="button"
                                            className={`dv-pop-tab ${activePopulationTab === tab.key ? 'active' : ''}`}
                                            onClick={() => setActivePopulationTab(tab.key)}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {activePopulationData && (
                                    <div className="dv-pop-content">
                                        {activePopulationData.forms.length > 0 && (
                                            <div className="dv-pop-block">
                                                <p className="dv-qf-label">Forms</p>
                                                <div className="dv-pop-forms-grid">
                                                    {activePopulationData.forms.map((form, formIndex) => (
                                                        <div key={`${form.formName}_${formIndex}`} className="dv-pop-form-chip">
                                                            <span className="dv-pop-form-name">{form.formName}</span>
                                                            {form.strengths.map((strength, strengthIndex) => (
                                                                <span key={`${strength}_${strengthIndex}`} className="dv-pop-form-strength">{strength}</span>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {activePopulationData.dosingSections.length > 0 && (
                                            <div className="dv-pop-block">
                                                <p className="dv-qf-label">Dosing</p>
                                                <div className="dv-pop-dosing-grid">
                                                    {activePopulationData.dosingSections.map((section, index) => (
                                                        <div key={`${section.title}_${index}`} className="dv-pop-dosing-box">
                                                            {section.title && <p className="dv-pop-title">{section.title}</p>}
                                                            {section.sections.map((subSection, subIndex) => (
                                                                <div key={`${subSection.subTitle}_${subIndex}`} className="dv-pop-subgroup">
                                                                    {subSection.subTitle && <p className="dv-pop-subtitle">{subSection.subTitle}</p>}
                                                                    {subSection.headers.map((headerGroup, headerIndex) => (
                                                                        <div key={`${headerGroup.header}_${headerIndex}`} className="dv-pop-header-group">
                                                                            {headerGroup.header && <p className="dv-pop-list-header">{headerGroup.header}</p>}
                                                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                                                {headerGroup.items.map((item, idx) => (
                                                                                    <li key={`${item}_${idx}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                                                ))}
                                                                            </ul>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {activePopulationData.pregnancyGroups.length > 0 && (
                                            <div className="dv-pop-block">
                                                <p className="dv-qf-label">Pregnancy & Lactation</p>
                                                <div className="dv-pop-dosing-grid">
                                                    {activePopulationData.pregnancyGroups.map((group, index) => (
                                                        <div key={`${group.title}_${index}`} className="dv-pop-dosing-box">
                                                            <p className="dv-pop-title">{group.title}</p>
                                                            {group.sections.map((section, subIndex) => (
                                                                <div key={`${section.subTitle}_${subIndex}`} className="dv-pop-subgroup">
                                                                    {section.subTitle && <p className="dv-pop-subtitle">{section.subTitle}</p>}
                                                                    {section.headers.map((headerGroup, headerIndex) => (
                                                                        <div key={`${headerGroup.header}_${headerIndex}`} className="dv-pop-header-group">
                                                                            {headerGroup.header && <p className="dv-pop-list-header">{headerGroup.header}</p>}
                                                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                                                {headerGroup.items.map((item, idx) => (
                                                                                    <li key={`${item}_${idx}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                                                ))}
                                                                            </ul>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {suggestedDosingGroups.length > 0 && (
                            <div className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Suggested Dosing</h2>
                                </div>
                                <div className="dv-detail-groups">
                                    {suggestedDosingGroups.map((group, index) => (
                                        <div key={`${group.population}_${group.indication}_${index}`} className="dv-detail-box">
                                            <p className="dv-detail-title">{group.indication}</p>
                                            <p className="dv-detail-subtitle">
                                                {[group.population, group.subIndication, group.listHeader].filter(Boolean).join(' / ')}
                                            </p>
                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                {group.items.map((item, itemIndex) => (
                                                    <li key={`${item}_${itemIndex}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Drug Interactions ── */}
                        {interactionsList.length > 0 && (
                            <div id="dv-section-interactions" className="dv-card dv-card-warn-bg">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-warn">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m10.29 3.86-8.6 14.9A1 1 0 0 0 2.57 20h18.86a1 1 0 0 0 .88-1.24L13.71 3.86a1 1 0 0 0-1.74 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Drug Interactions</h2>
                                </div>
                                <div className="dv-interactions-wrap">
                                    {interactionsList.map((inter, i) => (
                                        <details className="dv-interaction-row" key={inter.id ?? i}>
                                            <summary className="dv-interaction-summary">
                                                <div className="dv-interaction-main">
                                                    <span className="dv-idrug">{titleCase(inter.name)}</span>
                                                </div>
                                                <div className="dv-interaction-meta">
                                                    {inter.severity && (
                                                        <span className={`dv-sev ${severityClass(inter.severity)}`}>
                                                            {titleCase(inter.severity)}
                                                        </span>
                                                    )}
                                                    <span className="dv-interaction-expand" aria-hidden="true">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="m6 9 6 6 6-6" />
                                                        </svg>
                                                    </span>
                                                </div>
                                            </summary>
                                            {inter.description && <div className="dv-interaction-desc fda-text">{renderFdaText(inter.description)}</div>}
                                        </details>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Adverse Reactions ── */}
                        {(uniqueCommonEffects.length > 0 || percentageEffectBands.length > 0) && (
                            <div id="dv-section-side-effects" className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="10" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Side Effects</h2>
                                </div>
                                <div className="dv-side-effects-cols">
                                    {uniqueCommonEffects.length > 0 && (
                                        <div className="dv-warning-box">
                                            <h3 className="dv-se-col-title">Common</h3>
                                            <ul className="dv-se-list">
                                                {uniqueCommonEffects.map((effect, i) => (
                                                    <li key={`${effect}_${i}`}><div className="fda-text">{renderFdaText(effect)}</div></li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {percentageEffectBands.length > 0 && (
                                        <div className="dv-warning-box">
                                            <h3 className="dv-se-col-title">Frequency Bands</h3>
                                            <div className="dv-side-band-groups">
                                                {percentageEffectBands.map((bandGroup, bandIndex) => (
                                                    <div key={`${bandGroup.severityBand}_${bandIndex}`} className="dv-side-band-group">
                                                        <p className="dv-se-band-title">{bandGroup.severityBand}</p>
                                                        {bandGroup.bodySystems.map((bodyGroup, bodyIndex) => (
                                                            <div key={`${bodyGroup.bodySystem}_${bodyIndex}`} className="dv-warning-subgroup">
                                                                {bodyGroup.bodySystem && <p className="dv-se-body-title">{bodyGroup.bodySystem}</p>}
                                                                {bodyGroup.headers.map((headerGroup, headerIndex) => (
                                                                    <div key={`${headerGroup.listHeader}_${headerIndex}`} className="dv-pop-header-group">
                                                                        {headerGroup.listHeader && <p className="dv-pop-list-header">{headerGroup.listHeader}</p>}
                                                                        <ul className="dv-dot-list dv-dot-list-compact">
                                                                            {headerGroup.items.map((item, itemIndex) => (
                                                                                <li key={`${item}_${itemIndex}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                                            ))}
                                                                        </ul>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ÄÄ Pregnancy & Pharmacology ÄÄ */}
                        {(pregnancyEntries.length > 0 || pharmacologyGroups.length > 0) && (
                            <div className="dv-side-effects-cols">
                                {pregnancyEntries.length > 0 && !populationTabs.some((tab) => tab.key === 'pregnancy') && (
                                    <div className="dv-card">
                                        <div className="dv-section-header">
                                            <div className="dv-section-icon dv-si-blue">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20" /></svg>
                                            </div>
                                            <h2 className="dv-section-title">Pregnancy & Lactation</h2>
                                        </div>
                                        <ul className="dv-dot-list">
                                            {pregnancyEntries.map((item, i) => (
                                                <li key={`${item}_${i}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {pharmacologyGroups.length > 0 && (
                                    <div id="dv-section-pharmacology" className="dv-card">
                                        <div className="dv-section-header">
                                            <div className="dv-section-icon dv-si-blue">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3h6v4H9zM5 9h14v12H5z" /></svg>
                                            </div>
                                            <h2 className="dv-section-title">Pharmacology</h2>
                                        </div>
                                        <div className="dv-warning-groups">
                                            {pharmacologyGroups.map((group, i) => (
                                                <div key={`${group.topic}_${i}`} className="dv-warning-box">
                                                    {group.topic && <p className="dv-warning-title">{group.topic}</p>}
                                                    {group.sections.map((section, sectionIndex) => (
                                                        <div key={`${section.subTitle}_${sectionIndex}`} className="dv-warning-subgroup">
                                                            {section.subTitle && <p className="dv-warning-subtitle">{section.subTitle}</p>}
                                                            {section.headers.map((headerGroup, headerIndex) => (
                                                                <div key={`${headerGroup.header}_${headerIndex}`} className="dv-pop-header-group">
                                                                    {headerGroup.header && <p className="dv-pop-list-header">{headerGroup.header}</p>}
                                                                    <ul className="dv-dot-list dv-dot-list-compact">
                                                                        {headerGroup.items.map((item, itemIndex) => (
                                                                            <li key={`${item}_${itemIndex}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {nutritionGroups.length > 0 && (
                            <div id="dv-section-nutrition" className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 2v20M5 7c0 3 2 5 6 5M19 7c0 3-2 5-6 5" /><path d="M5 7c0-2 2-4 6-4M19 7c0-2-2-4-6-4" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">Nutrition</h2>
                                </div>
                                <div className="dv-detail-groups">
                                    {nutritionGroups.map((group, index) => (
                                        <div key={`${group.topic}_${index}`} className="dv-detail-box">
                                            <p className="dv-detail-title">{group.topic}</p>
                                            <ul className="dv-dot-list dv-dot-list-compact">
                                                {group.items.map((item, itemIndex) => (
                                                    <li key={`${item}_${itemIndex}`}><div className="fda-text">{renderFdaText(item)}</div></li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {hasFdaData && (
                            <div className="dv-card">
                                <div className="dv-section-header">
                                    <div className="dv-section-icon dv-si-blue">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></svg>
                                    </div>
                                    <h2 className="dv-section-title">FDA Data</h2>
                                </div>

                                {fdaExtensions.length > 0 && (
                                    <div className="dv-warning-groups">
                                        {fdaExtensions.slice(0, 3).map((item, index) => {
                                            const LONG_FIELDS = [
                                                ['Active Ingredient',   item?.active_ingredient],
                                                ['Inactive Ingredient', item?.inactive_ingredient],
                                                ['Dosage / Strength',   item?.dosage_forms_and_strengths],
                                            ];
                                            const SHORT_FIELDS = [
                                                ['Manufacturer',        item?.manufacturer_name],
                                                ['Marketing Category',  item?.marketing_category],
                                                ['Marketing Status',    item?.marketing_status],
                                                ['Review Priority',     item?.review_priority],
                                            ];
                                            const allFields = [
                                                ...LONG_FIELDS.map(([k, v]) => ({ key: k, value: v, long: true })),
                                                ...SHORT_FIELDS.map(([k, v]) => ({ key: k, value: v, long: false })),
                                            ].filter(({ value }) => value != null && String(value).trim() !== '');
                                            if (!allFields.length) return null;
                                            return (
                                                <div key={`fda_ext_${index}`} className="dv-warning-box">
                                                    {allFields.map(({ key, value, long }) => (
                                                        <div key={key} className="fda-field">
                                                            <div className="fda-field-label">{key}</div>
                                                            <div className="fda-field-value">
                                                                {long ? renderFdaText(String(value)) : String(value)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {(fdaProductLabels.length > 0 || fdaSubmissionLabels.length > 0) && (
                                    <div className="dv-info-grid" style={{ marginTop: 12 }}>
                                        {fdaProductLabels.length > 0 && (
                                            <div className="dv-info-item">
                                                <p className="dv-info-label">Products</p>
                                                <p className="dv-info-value">{fdaProductLabels.slice(0, 5).join(' | ')}</p>
                                            </div>
                                        )}
                                        {fdaSubmissionLabels.length > 0 && (
                                            <div className="dv-info-item">
                                                <p className="dv-info-label">Submissions</p>
                                                <p className="dv-info-value">{fdaSubmissionLabels.slice(0, 5).join(' | ')}</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {fdaDocuments.length > 0 && (
                                    <div style={{ marginTop: 12 }}>
                                        <p className="dv-qf-label" style={{ marginBottom: 4 }}>FDA Documents</p>
                                        <ul className="dv-dot-list dv-dot-list-compact">
                                            {fdaDocuments.slice(0, 6).map((doc, index) => (
                                                <li key={`fda_doc_${doc.id || index}`}>
                                                    {doc.url ? (
                                                        <a href={doc.url} target="_blank" rel="noreferrer">{doc.type || 'Document'} {doc.date || ''}</a>
                                                    ) : (
                                                        `${doc.type || 'Document'} ${doc.date || ''}`
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Footer Disclaimer ── */}
                        <div className="dv-disclaimer-bar">
                            <strong>DISCLAIMER: THIS IS NOT MEDICAL ADVICE.</strong><br />
                            The information provided on DoseFinder is for educational purposes only and is not intended to substitute for professional medical advice, diagnosis, or treatment.
                        </div>

                    </div>{/* /left-col */}

                    {/* ═══════════ RIGHT COLUMN ═══════════ */}
                    <div className="dv-right-col">

                        {/* ── Quick Facts ── */}
                        <div className="dv-card dv-sidebar-card">
                            <div className="dv-sb-header">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                                Quick Facts
                            </div>

                            {(drug.price ?? extension?.price) != null && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">PRICE</p>
                                    <p className="dv-qf-price">${drug.price ?? extension.price}</p>
                                </div>
                            )}

                            {dosageFormLabel && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">DOSAGE FORM</p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                        <img src={getDosageFormIcon(dosageFormLabel)} alt={dosageFormLabel} style={{ width: 28, height: 28, objectFit: 'contain', opacity: 0.8 }} />
                                        <p className="dv-info-value" style={{ margin: 0 }}>{titleCase(dosageFormLabel)}</p>
                                    </div>
                                </div>
                            )}

                            {strengthDisplay && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">STRENGTH</p>
                                    <p className="dv-info-value">{strengthDisplay}</p>
                                </div>
                            )}

                            {(drug?.rx_status || drug?.rx) && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">RX STATUS</p>
                                    <p className="dv-info-value">{drug.rx_status || drug.rx}</p>
                                </div>
                            )}

                            {drug?.source && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">SOURCE</p>
                                    <p className="dv-info-value">{drug.source}</p>
                                </div>
                            )}

                            {updatedDate && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">UPDATED</p>
                                    <p className="dv-info-value">{updatedDate}</p>
                                </div>
                            )}

                            {drug.code && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">CODE</p>
                                    <p className="dv-info-value" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{drug.code}</p>
                                </div>
                            )}

                            {drug.ham && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">HIGH ALERT MEDICATION</p>
                                    <p className="dv-info-value">{drug.ham === 'YES' || drug.ham === 1 || drug.ham === '1' ? 'Yes' : 'No'}</p>
                                </div>
                            )}

                            {classesList.length > 0 && (
                                <div className="dv-qf-block">
                                    <p className="dv-qf-label">CLASSES</p>
                                    <p className="dv-info-value">{classesList.slice(0, 4).join(' | ')}</p>
                                </div>
                            )}
                        </div>

                        {/* ── Arabic Info ── */}
                        {(drug.arabic_trade_name || extension?.arabic_trade_name) && (
                            <div className="dv-card dv-sidebar-card">
                                <div className="dv-sb-header">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 0 1 6.412 9m6.088 9h7M11 21l5-10 5 10" /></svg>
                                    Arabic Name
                                </div>
                                <p className="dv-info-value" style={{ direction: 'rtl', textAlign: 'right', fontSize: '1.05rem' }}>
                                    {drug.arabic_trade_name || extension.arabic_trade_name}
                                </p>
                            </div>
                        )}

                        {/* ── Notes ── */}
                        <div className="dv-card dv-sidebar-card dv-notes-card">
                            <div className="dv-sb-header">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                Notes
                            </div>
                            {(drug.note_raw || drug.notes || extension?.notes) ? (
                                <div className="dv-notes-text fda-text">{renderFdaText(drug.note_raw || drug.notes || extension.notes)}</div>
                            ) : (
                                <p className="dv-notes-text">Can't find what you're looking for? Consult with a pharmacist online.</p>
                            )}
                        </div>

                        {canReportIssue && (
                            <div className="dv-card dv-sidebar-card dv-user-issues-card">
                                <div className="dv-sb-header">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                    </svg>
                                    Your Reported Issues
                                </div>

                                {userIssuesLoading ? (
                                    <div className="dv-issues-empty">
                                        <div className="auth-btn__spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></div>
                                    </div>
                                ) : userIssues.length === 0 ? (
                                    <div className="dv-issues-empty">
                                        <p className="dv-issues-empty__text">You have not reported an issue for this drug yet.</p>
                                    </div>
                                ) : (
                                    <div className="dv-user-issues-list">
                                        {userIssues.map((issue) => (
                                            <article key={issue.id} className="dv-user-issue">
                                                <div className="dv-user-issue__top">
                                                    <strong className="dv-user-issue__part">{issue.partLabel}</strong>
                                                    <IssueStatusBadge status={issue.status} />
                                                </div>
                                                <p className="dv-user-issue__message">{issue.message}</p>
                                                <div className="dv-user-issue__meta">
                                                    <span>{formatIssueDate(issue.createdAt)}</span>
                                                    {issue.resolvedVersionNumber ? (
                                                        <span>Linked {formatVersionLabel(issue.resolvedVersionNumber)}</span>
                                                    ) : null}
                                                </div>
                                                {issue.doctorReplyMessage ? (
                                                    <div className="dv-user-issue__reply">
                                                        <span className="dv-qf-label">Doctor Reply</span>
                                                        <p className="dv-user-issue__reply-text">{issue.doctorReplyMessage}</p>
                                                    </div>
                                                ) : null}
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="dv-card dv-sidebar-card">
                            <AIFillForm defaultDrugName={drugName} defaultDrugData={drug} />
                        </div>

                    </div>{/* /right-col */}
                </div>
            </div>

            {reportModalOpen && (
                <div className="dv-report-backdrop" role="presentation" onClick={(event) => {
                    if (event.target === event.currentTarget) {
                        closeIssueModal();
                    }
                }}>
                    <div className="dv-report-modal" role="dialog" aria-modal="true" aria-labelledby="reportIssueTitle">
                        <div className="dv-report-modal__header">
                            <div>
                                <h2 id="reportIssueTitle" className="dv-report-modal__title">Report an issue</h2>
                                <p className="dv-report-modal__subtitle">Tell the doctor what looks wrong in this drug record.</p>
                            </div>
                            <button type="button" className="dv-report-modal__close" onClick={closeIssueModal} aria-label="Close report issue modal">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>

                        <form className="dv-report-form" onSubmit={handleSubmitIssue}>
                            <div className="dv-report-field">
                                <label className="dv-report-field__label" htmlFor="issuePart">Part</label>
                                <select
                                    id="issuePart"
                                    className="dv-report-field__input"
                                    value={reportPartKey}
                                    onChange={(event) => setReportPartKey(event.target.value)}
                                    disabled={reportSubmitting}
                                >
                                    {ISSUE_PART_OPTIONS.map((option) => (
                                        <option key={option.key} value={option.key}>{option.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="dv-report-field">
                                <label className="dv-report-field__label" htmlFor="issueMessage">Message</label>
                                <textarea
                                    id="issueMessage"
                                    className="dv-report-field__textarea"
                                    rows={5}
                                    value={reportMessage}
                                    onChange={(event) => setReportMessage(event.target.value)}
                                    placeholder="Example: The dosage form is written wrong."
                                    maxLength={1000}
                                    disabled={reportSubmitting}
                                />
                            </div>

                            <div className="dv-report-actions">
                                <button type="button" className="dv-btn-outline" onClick={closeIssueModal} disabled={reportSubmitting}>
                                    Cancel
                                </button>
                                <button type="submit" className="app-btn app-btn--primary" disabled={reportSubmitting}>
                                    {reportSubmitting ? 'Submitting...' : 'Confirm Report'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {visibilityModalOpen && (
                <div className="dv-report-backdrop" role="presentation" onClick={(event) => {
                    if (event.target === event.currentTarget && !visibilitySubmitting) {
                        setVisibilityModalOpen(false);
                        setVisibilityReason('');
                    }
                }}>
                    <div className="dv-report-modal" role="dialog" aria-modal="true" aria-labelledby="visibilityModalTitle">
                        <div className="dv-report-modal__header">
                            <div>
                                <h2 id="visibilityModalTitle" className="dv-report-modal__title">{isHidden ? 'Restore drug' : 'Delete drug'}</h2>
                                <p className="dv-report-modal__subtitle">
                                    {isHidden
                                        ? 'This drug will become visible to all users again.'
                                        : 'This drug will be removed from view for all non-admin users.'}
                                </p>
                            </div>
                            <button type="button" className="dv-report-modal__close" onClick={() => { setVisibilityModalOpen(false); setVisibilityReason(''); }} aria-label="Close" disabled={visibilitySubmitting}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                </svg>
                            </button>
                        </div>
                        <form className="dv-report-form" onSubmit={handleVisibilityToggle}>
                            <div className="dv-report-field">
                                <label className="dv-report-field__label" htmlFor="visibilityReason">Reason</label>
                                <textarea
                                    id="visibilityReason"
                                    className="dv-report-field__textarea"
                                    rows={4}
                                    value={visibilityReason}
                                    onChange={(event) => setVisibilityReason(event.target.value)}
                                    placeholder="Briefly explain why you are changing the visibility."
                                    maxLength={500}
                                    disabled={visibilitySubmitting}
                                />
                            </div>
                            <div className="dv-report-actions">
                                <button type="button" className="dv-btn-outline" onClick={() => { setVisibilityModalOpen(false); setVisibilityReason(''); }} disabled={visibilitySubmitting}>
                                    Cancel
                                </button>
                                <button type="submit" className="app-btn app-btn--primary" disabled={visibilitySubmitting}>
                                    {visibilitySubmitting ? 'Saving...' : (isHidden ? 'Restore' : 'Delete')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <Footer />
        </div>
    );
}
