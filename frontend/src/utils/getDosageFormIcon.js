import BottleIcon from '../../icons/BottleIcon.svg';
import CapsuleIcon from '../../icons/CapsuleIcon.svg';
import DropIcon from '../../icons/DropIcon.svg';
import FirstAidIcon from '../../icons/FirstAidIcon.svg';
import LungIcon from '../../icons/LungIcon.svg';
import StickingPlasterIcon from '../../icons/StickingPlasterIcon.svg';

const TOPICAL_FORMS = new Set([
    'OINTMENT', 'CREAM', 'GEL', 'LOTION', 'SCALP LOTION', 'OIL',
    'SHAMPOO', 'SKIN ADHESIVE', 'PATCH', 'VAGINAL CREAM',
]);

const SUPPOSITORY_FORMS = new Set([
    'SUPPOSITORY', 'ENEMA',
]);

const LIQUID_FORMS = new Set([
    'SYRUP', 'SUSPENSION', 'SOLUTION', 'ORAL SOLUTION', 'ORAL DROP',
    'EYE DROP', 'EAR DROP', 'NASAL DROP', 'NASAL SPRAY', 'SPRAY',
    'GARGLE', 'MOUTH WASH', 'ORAL GEL', 'DROP',
]);

const SOLID_FORMS = new Set([
    'TABLET', 'CHEWABLE TABLET', 'EFFERVESCENT TABLET', 'DISPERSIBLE TABLET',
    'SUBLINGUAL TABLET', 'CAPSULE', 'LOZENGES', 'POWDER', 'GRANULES',
    'EFFERVESCENT GRANULES', 'SACHET',
]);

const INJECTION_FORMS = new Set([
    'INJECTION', 'VIAL', 'AMPOULE',
]);

const INHALER_FORMS = new Set([
    'INHALER',
]);

/**
 * Returns the correct SVG icon path for a given dosage form string.
 * Falls back to StickingPlasterIcon for unknown forms.
 *
 * @param {string} dosageForm - e.g. "TABLET", "Tablet", "injection"
 * @returns {string} SVG icon import (URL/path)
 */
export function getDosageFormIcon(dosageForm) {
    if (!dosageForm) return StickingPlasterIcon;
    const form = dosageForm.toUpperCase().trim();

    if (INJECTION_FORMS.has(form)) return BottleIcon;
    if (SOLID_FORMS.has(form)) return CapsuleIcon;
    if (LIQUID_FORMS.has(form)) return DropIcon;
    if (SUPPOSITORY_FORMS.has(form)) return FirstAidIcon;
    if (INHALER_FORMS.has(form)) return LungIcon;
    if (TOPICAL_FORMS.has(form)) return StickingPlasterIcon;

    return StickingPlasterIcon;
}
