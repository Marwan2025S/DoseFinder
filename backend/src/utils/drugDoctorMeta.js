const UserModel = require('../models/user.model');

const SYSTEM_DOCTOR = Object.freeze({
    id: null,
    username: 'System',
    email: null,
});

const normalizeDoctorPayloadOptions = (options = {}) => ({
    includeEmail: Boolean(options.includeEmail),
});

const parsePositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const toVersionDoctorPayload = (doctor, doctorId = null, options = {}) => {
    const { includeEmail } = normalizeDoctorPayloadOptions(options);

    if (!doctor) {
        const payload = {
            ...SYSTEM_DOCTOR,
            id: parsePositiveInt(doctorId),
        };

        if (!includeEmail) {
            delete payload.email;
        }

        return payload;
    }

    const payload = {
        id: doctor.id,
        username: doctor.username,
        email: doctor.email || null,
    };

    if (!includeEmail) {
        delete payload.email;
    }

    return payload;
};

const collectDoctorLookup = async (doctorIds) => {
    const doctors = await UserModel.findManyByIds(doctorIds);
    return new Map(doctors.map((doctor) => [doctor.id, doctor]));
};

const normalizeVersionDoctorId = (version) => parsePositiveInt(version?.doctor_id ?? version?.doctorId) || 0;

const attachDoctorToVersion = (version, doctorLookup, options = {}) => {
    const doctorId = normalizeVersionDoctorId(version);
    return {
        ...version,
        doctorId,
        doctor: toVersionDoctorPayload(doctorLookup.get(doctorId), doctorId, options),
    };
};

const attachDoctorsToVersions = async (versions = [], options = {}) => {
    const doctorLookup = await collectDoctorLookup(versions.map(normalizeVersionDoctorId));
    return versions.map((version) => attachDoctorToVersion(version, doctorLookup, options));
};

const pickLatestVersion = (versions = []) => versions.reduce((latest, candidate) => {
    if (!latest) {
        return candidate;
    }

    const candidateNumber = Number(candidate?.version_number || 0);
    const latestNumber = Number(latest?.version_number || 0);
    return candidateNumber > latestNumber ? candidate : latest;
}, null);

const attachDoctorsToDrugSearchResults = async (drugServicePayload, listDrugVersions, options = {}) => {
    const baseResults = Array.isArray(drugServicePayload?.results) ? drugServicePayload.results : [];
    if (!baseResults.length) {
        return drugServicePayload;
    }

    const versionsByDrugEntries = await Promise.all(
        baseResults.map(async (drug) => [drug.drug_id, await listDrugVersions(drug.drug_id)])
    );
    const versionsByDrug = new Map(versionsByDrugEntries);
    const latestVersions = Array.from(versionsByDrug.values())
        .map((versions) => pickLatestVersion(versions))
        .filter(Boolean);
    const doctorLookup = await collectDoctorLookup(latestVersions.map(normalizeVersionDoctorId));

    return {
        ...drugServicePayload,
        results: baseResults.map((drug) => {
            const latestVersion = pickLatestVersion(versionsByDrug.get(drug.drug_id) || []);
            const latestDoctorId = latestVersion ? normalizeVersionDoctorId(latestVersion) : 0;
            return {
                ...drug,
                latestVersionNumber: latestVersion?.version_number ?? drug.version_number ?? 1,
                latestVersionDoctorId: latestDoctorId,
                latestVersionDoctor: toVersionDoctorPayload(doctorLookup.get(latestDoctorId), latestDoctorId, options),
            };
        }),
    };
};

module.exports = {
    attachDoctorsToDrugSearchResults,
    attachDoctorsToVersions,
    collectDoctorLookup,
    normalizeVersionDoctorId,
    parsePositiveInt,
    pickLatestVersion,
    toVersionDoctorPayload,
};
