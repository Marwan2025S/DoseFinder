import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DrugView from './DrugView';

const mocks = vi.hoisted(() => ({
    getDetails: vi.fn(),
    getMine: vi.fn(),
    createIssue: vi.fn(),
    isSaved: vi.fn(),
    saveItem: vi.fn(),
    removeItem: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock('../services/api', () => ({
    drugsApi: {
        getDetails: mocks.getDetails,
    },
    issuesApi: {
        getMine: mocks.getMine,
        create: mocks.createIssue,
    },
}));

vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({
        user: { role: 'guest', emailVerified: false },
        isAuthenticated: false,
    }),
}));

vi.mock('../hooks/useSavedItems', () => ({
    useSavedItems: () => ({
        isSaved: mocks.isSaved,
        saveItem: mocks.saveItem,
        removeItem: mocks.removeItem,
    }),
}));

vi.mock('../components/Toast', () => ({
    useToast: () => ({
        showToast: mocks.showToast,
    }),
}));

vi.mock('../components/SearchHeader', () => ({
    default: () => <header data-testid="search-header">DoseFinder</header>,
}));

vi.mock('../components/Footer', () => ({
    default: () => <footer data-testid="footer" />,
}));

vi.mock('../components/AIFillForm', () => ({
    default: () => <aside data-testid="ai-fill-form" />,
}));

vi.mock('../components/IssueStatusBadge', () => ({
    default: ({ status }) => <span>{status}</span>,
}));

const drugDetail = {
    id: 256691,
    drug_id: 256691,
    generic_name: 'Zozu Soft Cream',
    display_name: 'Zozu Soft Cream',
    brand_names: '',
    source: 'OpenFDA',
    updated_at: '2026-05-05T20:42:37.000Z',
    drug_dms_extensions: [],
    dosage_forms: [],
    administration: [],
    suggested_uses: [
        {
            id: 1,
            topic: 'indications_and_usage',
            text: 'Uses After cleaning the skin, apply proper amount of this product to the hip skin and gently massage until it is absorbed.',
        },
        {
            id: 2,
            topic: 'purpose',
            text: 'Purpose The texture of the soft cream is easy to absorb. With the massage technique, it moisturizes and protects the buttocks.',
        },
    ],
    dosing: [
        {
            id: 1,
            population: 'default',
            indication: 'dosing',
            sub_indication: 'dosage_and_administration',
            list_header: 'external_use',
            notes_text: 'Dosage and administration For external use only. Massage gently until absorbed.',
        },
    ],
    warnings: [
        {
            id: 1390441,
            warning_type: 'warnings',
            sub_warning_type: null,
            list_header: null,
            text: 'Warnings For external use only. Do not use on broken or irritated skin.',
        },
        {
            id: 1390442,
            warning_type: 'warnings',
            sub_warning_type: 'keep_out_of_reach_of_children',
            list_header: 'children_safety',
            text: 'Keep out of reach of children. If swallowed, get medical help or contact a Poison Control Center immediately.',
        },
    ],
};

function renderDrugView() {
    return render(
        <MemoryRouter initialEntries={['/drug/256691']}>
            <Routes>
                <Route path="/drug/:id" element={<DrugView />} />
            </Routes>
        </MemoryRouter>,
    );
}

function appearsBefore(first, second) {
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('DrugView detail data sections', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getDetails.mockResolvedValue(drugDetail);
        mocks.getMine.mockResolvedValue([]);
        mocks.isSaved.mockReturnValue(false);
    });

    afterEach(() => {
        cleanup();
    });

    it('renders label purpose, dosing, and warnings from the detail payload in order', async () => {
        renderDrugView();

        await waitFor(() => {
            expect(mocks.getDetails).toHaveBeenCalledWith(256691);
        });

        const usesHeading = await screen.findByRole('heading', { name: /Uses & Label Purpose/i });
        const dosingHeading = screen.getByRole('heading', { name: /Dosing & Administration/i });
        const warningsHeading = screen.getByRole('heading', { name: /Warnings/i });

        expect(screen.getByText(/Purpose The texture of the soft cream is easy to absorb/i)).toBeInTheDocument();
        expect(screen.getByText(/Dosage and administration For external use only/i)).toBeInTheDocument();
        expect(screen.getByText(/Warnings For external use only/i)).toBeInTheDocument();
        expect(screen.getByText(/If swallowed, get medical help/i)).toBeInTheDocument();
        expect(screen.getByText('Keep Out Of Reach Of Children')).toBeInTheDocument();
        expect(screen.getByText('Children Safety')).toBeInTheDocument();

        expect(appearsBefore(usesHeading, dosingHeading)).toBe(true);
        expect(appearsBefore(dosingHeading, warningsHeading)).toBe(true);
    });
});
