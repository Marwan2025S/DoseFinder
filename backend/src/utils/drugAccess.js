const AdminModel = require('../models/admin.model');
const { getPool } = require('../config/db');

const parsePositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getDrugId = (drug) => parsePositiveInt(drug?.drug_id ?? drug?.id ?? drug?.drugId);

const isApprovedDoctor = (user) => (
    user?.role === 'doctor' && Boolean(user.verified_doctor ?? user.verifiedDoctor)
);

const canInspectAllDrugFlags = (user) => user?.role === 'admin';

const canInspectReviewDrug = (user) => canInspectAllDrugFlags(user) || isApprovedDoctor(user);

const isDrugAccessibleForUser = (flags = {}, user = null) => {
    if (canInspectAllDrugFlags(user)) {
        return true;
    }

    if (flags.visibility === 'hidden') {
        return false;
    }

    if (flags.reviewStatus === 'needs_review' && !canInspectReviewDrug(user)) {
        return false;
    }

    return true;
};

const shouldExposeDrugFlags = (user) => canInspectAllDrugFlags(user) || isApprovedDoctor(user);

const createDrugNotFoundError = (drugId) => {
    const error = new Error(`Drug ${drugId} not found`);
    error.status = 404;
    error.publicMessage = 'Drug not found';
    return error;
};

const getDrugFlags = async (drugId) => AdminModel.getDrugFlag(drugId);

const getActiveDrugIdSet = async (drugIds = []) => {
    const uniqueIds = Array.from(new Set(
        drugIds
            .map((id) => parsePositiveInt(id))
            .filter(Boolean)
    ));
    if (!uniqueIds.length) {
        return new Set();
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const pool = getPool();
    const [rows] = await pool.execute(
        `
            SELECT DISTINCT drug_id
            FROM drug_versions
            WHERE drug_id IN (${placeholders})
              AND is_current = 1
              AND COALESCE(is_deleted, 0) = 0
        `,
        uniqueIds
    );
    return new Set(rows.map((row) => Number(row.drug_id)));
};

const isActiveDrugRecord = async (drugId) => {
    const activeDrugIds = await getActiveDrugIdSet([drugId]);
    return activeDrugIds.has(Number(drugId));
};

const requireDrugAccess = async (drugId, user) => {
    if (!(await isActiveDrugRecord(drugId))) {
        throw createDrugNotFoundError(drugId);
    }

    const flags = await getDrugFlags(drugId);
    if (!isDrugAccessibleForUser(flags, user)) {
        throw createDrugNotFoundError(drugId);
    }

    return flags;
};

const enrichDrugResultsWithAccessFlags = async (results = [], user = null) => {
    const drugIds = results.map(getDrugId).filter(Boolean);
    const [flagsByDrugId, activeDrugIds] = await Promise.all([
        AdminModel.getDrugFlagsMap(drugIds),
        getActiveDrugIdSet(drugIds),
    ]);
    const exposeFlags = shouldExposeDrugFlags(user);

    return results.reduce((accessibleResults, drug) => {
        const drugId = getDrugId(drug);
        const flags = flagsByDrugId.get(Number(drugId)) || AdminModel.toFlagPayload();

        if (!activeDrugIds.has(Number(drugId))) {
            return accessibleResults;
        }

        if (!isDrugAccessibleForUser(flags, user)) {
            return accessibleResults;
        }

        accessibleResults.push(exposeFlags ? { ...drug, adminFlags: flags } : drug);
        return accessibleResults;
    }, []);
};

const filterDrugSearchPayloadForUser = async (payload = {}, user = null) => {
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (!results.length) {
        return payload;
    }

    const accessibleResults = await enrichDrugResultsWithAccessFlags(results, user);
    const removedCount = results.length - accessibleResults.length;

    return {
        ...payload,
        results: accessibleResults,
        total: Number.isFinite(Number(payload?.total))
            ? Math.max(0, Number(payload.total) - removedCount)
            : payload?.total
    };
};

module.exports = {
    canInspectAllDrugFlags,
    canInspectReviewDrug,
    createDrugNotFoundError,
    enrichDrugResultsWithAccessFlags,
    filterDrugSearchPayloadForUser,
    getActiveDrugIdSet,
    getDrugFlags,
    getDrugId,
    isActiveDrugRecord,
    isDrugAccessibleForUser,
    requireDrugAccess,
    shouldExposeDrugFlags
};
