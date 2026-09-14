import { Navigate, useParams } from 'react-router-dom';
import AddDrug from './AddDrug';

export default function EditDrug() {
    const { id } = useParams();

    if (!id) {
        return <Navigate to="/medications" replace />;
    }

    return <AddDrug mode="edit" />;
}
