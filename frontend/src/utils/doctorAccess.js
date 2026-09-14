export function isPendingDoctor(user) {
    return user?.role === 'doctor' && !user?.verifiedDoctor;
}

export function canManageDrugCatalog(user) {
    return user?.role === 'admin' || (user?.role === 'doctor' && user?.verifiedDoctor);
}

export function canManageIssues(user) {
    return user?.role === 'admin' || canManageDrugCatalog(user);
}
