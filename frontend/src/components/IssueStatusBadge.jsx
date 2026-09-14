import { getIssueStatusClassName, getIssueStatusLabel } from '../constants/issues';

export default function IssueStatusBadge({ status }) {
    return (
        <span className={`issue-status ${getIssueStatusClassName(status)}`}>
            {getIssueStatusLabel(status)}
        </span>
    );
}
