import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { profileApi } from '../services/api';

const normalizeItem = (item) => {
  const id = Number(item?.drug_id ?? item?.id);
  if (!Number.isFinite(id)) return null;
  const extension = Array.isArray(item?.drug_dms_extensions) ? item.drug_dms_extensions[0] : null;
  const dosageForm = Array.isArray(item?.dosage_forms) && item.dosage_forms.length > 0
    ? item.dosage_forms[0]?.form_name
    : item?.dosage_form;
  const brandNames = String(item?.brand_names || '').trim();
  const genericName = String(item?.generic_name || item?.display_name || item?.name || 'Unknown Medication').trim();

  return {
    id,
    name: genericName,
    subtitle: String(
      item?.subtitle
      || (brandNames ? `Brands: ${brandNames}` : '')
    ),
    route: String(item?.route || `/drug/${id}`),
    category: String(item?.classes?.[0]?.class_name || item?.category || ''),
    rx: String(item?.rx || item?.rx_status || ''),
    price: Number.isFinite(Number(item?.price ?? extension?.price)) ? Number(item.price ?? extension?.price) : null,
    dosage_form: String(dosageForm || ''),
    has_fda: Boolean(item?.has_fda),
    savedAt: item?.saved_at || item?.savedAt || new Date().toISOString(),
  };
};

const sortSavedItems = (items) =>
  items.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

export function useSavedItems() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [savedItems, setSavedItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const canAccessSavedItems = isAuthenticated && (user?.role === 'guest' || user?.emailVerified);

  const ensureCanManageSavedItems = useCallback(() => {
    if (!isAuthenticated) {
      throw new Error('Please log in to save items.');
    }

    if (user?.role !== 'guest' && !user?.emailVerified) {
      throw new Error('Please verify your email before saving items.');
    }
  }, [isAuthenticated, user?.emailVerified, user?.role]);

  const refreshSavedItems = useCallback(async () => {
    if (!canAccessSavedItems) {
      setSavedItems([]);
      return [];
    }

    const response = await profileApi.getSavedDrugs();
    const items = sortSavedItems((response.data || []).map(normalizeItem).filter(Boolean));
    setSavedItems(items);
    return items;
  }, [canAccessSavedItems]);

  useEffect(() => {
    let active = true;

    if (authLoading) {
      return undefined;
    }

    if (!canAccessSavedItems) {
      setSavedItems([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    profileApi.getSavedDrugs()
      .then((response) => {
        if (!active) return;
        const items = sortSavedItems((response.data || []).map(normalizeItem).filter(Boolean));
        setSavedItems(items);
      })
      .catch(() => {
        if (active) {
          setSavedItems([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [authLoading, canAccessSavedItems, user?.id]);

  const savedIdSet = useMemo(
    () => new Set(savedItems.map((item) => item.id)),
    [savedItems],
  );

  const saveItem = useCallback(async (item) => {
    ensureCanManageSavedItems();
    const drugId = Number(item?.drug_id ?? item?.id ?? item);
    if (!Number.isFinite(drugId)) {
      throw new Error('Valid drugId is required');
    }

    const response = await profileApi.saveDrug(drugId);
    const normalized = normalizeItem(response.data?.drug || item || { id: drugId });

    if (normalized) {
      setSavedItems((prev) => sortSavedItems([normalized, ...prev.filter((entry) => entry.id !== normalized.id)]));
    } else {
      await refreshSavedItems();
    }

    return response;
  }, [ensureCanManageSavedItems, refreshSavedItems]);

  const removeItem = useCallback(async (itemId) => {
    ensureCanManageSavedItems();
    const id = Number(itemId);
    if (!Number.isFinite(id)) {
      throw new Error('Valid drugId is required');
    }

    await profileApi.removeSavedDrug(id);
    setSavedItems((prev) => prev.filter((entry) => entry.id !== id));
  }, [ensureCanManageSavedItems]);

  const clearItems = useCallback(async () => {
    ensureCanManageSavedItems();
    await profileApi.clearSavedDrugs();
    setSavedItems([]);
  }, [ensureCanManageSavedItems]);

  const isSaved = useCallback(
    (itemId) => savedIdSet.has(Number(itemId)),
    [savedIdSet],
  );

  return {
    savedItems,
    loading,
    savedIdSet,
    refreshSavedItems,
    saveItem,
    removeItem,
    clearItems,
    isSaved,
  };
}

