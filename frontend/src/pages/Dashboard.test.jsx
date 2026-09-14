import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';

const mocks = vi.hoisted(() => ({
    getDoctorSummary: vi.fn(),
    authUser: {
        current: { role: 'doctor', verifiedDoctor: true },
    },
}));

vi.mock('../services/api', () => ({
    dashboardApi: {
        getDoctorSummary: mocks.getDoctorSummary,
    },
}));

vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({
        user: mocks.authUser.current,
    }),
}));

vi.mock('../components/AppLayout', () => ({
    default: ({ children }) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock('../components/IssueStatusBadge', () => ({
    default: ({ status }) => <span>{status}</span>,
}));

const dashboardSummary = {
    metrics: {
        openIssues: 2,
        needsReviewDrugs: 1,
        visibleDrugs: 128,
        updatedThisWeek: 9,
    },
    openIssues: [
        {
            id: 17,
            drugId: 42,
            drugName: 'Acetaminophen',
            reportedVersionNumber: 1,
            partLabel: 'Warnings',
            message: 'Warning text appears incomplete.',
            status: 'open',
            reporter: { username: 'patient_one' },
            createdAt: '2026-05-10T09:00:00.000Z',
        },
    ],
    needsReviewDrugs: [
        {
            id: 42,
            drug_id: 42,
            generic_name: 'Acetaminophen',
            brand_names: 'Tylenol',
            version_number: 3,
            is_current: 1,
            updated_at: '2026-05-10T10:00:00.000Z',
            adminFlags: { reviewStatus: 'needs_review', visibility: 'visible' },
        },
    ],
    recentDrugs: [
        {
            id: 84,
            drug_id: 84,
            generic_name: 'Ibuprofen',
            brand_names: 'Advil',
            version_number: 2,
            is_current: 1,
            updated_at: '2026-05-09T10:00:00.000Z',
            adminFlags: { reviewStatus: 'published', visibility: 'visible' },
        },
    ],
    generatedAt: '2026-05-10T12:00:00.000Z',
};

function renderDashboard() {
    return render(
        <MemoryRouter>
            <Dashboard />
        </MemoryRouter>,
    );
}

describe('Dashboard triage view', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authUser.current = { role: 'doctor', verifiedDoctor: true };
        mocks.getDoctorSummary.mockResolvedValue(dashboardSummary);
    });

    afterEach(() => {
        cleanup();
    });

    it('renders dashboard metrics and triage queues for approved doctors', async () => {
        renderDashboard();

        await waitFor(() => {
            expect(mocks.getDoctorSummary).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByText('Open issues')).toBeInTheDocument();
        expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
        expect(screen.getByText('Visible drugs')).toBeInTheDocument();
        expect(screen.getByText('Updated this week')).toBeInTheDocument();
        expect(screen.getByText('128')).toBeInTheDocument();
        expect(screen.getAllByText('Acetaminophen').length).toBeGreaterThan(0);
        expect(screen.getByText('Warning text appears incomplete.')).toBeInTheDocument();
        expect(screen.getByText('Ibuprofen')).toBeInTheDocument();
        expect(
            screen.getAllByRole('link', { name: /acetaminophen/i })
                .some((link) => link.getAttribute('href') === '/issues/17')
        ).toBe(true);
    });

    it('does not call the approved dashboard API for pending doctors', () => {
        mocks.authUser.current = { role: 'doctor', verifiedDoctor: false };

        renderDashboard();

        expect(mocks.getDoctorSummary).not.toHaveBeenCalled();
        expect(screen.getByText('Doctor approval pending')).toBeInTheDocument();
        expect(screen.getByText(/Your triage queue will appear/i)).toBeInTheDocument();
    });

    it('shows a loading state while the dashboard request is pending', () => {
        mocks.getDoctorSummary.mockReturnValue(new Promise(() => {}));

        renderDashboard();

        expect(screen.getByText('Loading doctor dashboard...')).toBeInTheDocument();
    });

    it('renders empty states when no triage items are returned', async () => {
        mocks.getDoctorSummary.mockResolvedValue({
            metrics: {
                openIssues: 0,
                needsReviewDrugs: 0,
                visibleDrugs: 12,
                updatedThisWeek: 0,
            },
            openIssues: [],
            needsReviewDrugs: [],
            recentDrugs: [],
            generatedAt: '2026-05-10T12:00:00.000Z',
        });

        renderDashboard();

        expect(await screen.findByText('No open issues')).toBeInTheDocument();
        expect(screen.getByText('Review queue clear')).toBeInTheDocument();
        expect(screen.getByText('No recent medication changes')).toBeInTheDocument();
    });
});
