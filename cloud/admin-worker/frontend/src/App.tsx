import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { UsersPage } from './pages/UsersPage';
import { EnrollmentsPage } from './pages/EnrollmentsPage';
import { ProvisionsPage } from './pages/ProvisionsPage';
import { ProvisionWizardPage } from './pages/ProvisionWizardPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="enrollments" element={<EnrollmentsPage />} />
        <Route path="provisions" element={<ProvisionsPage />} />
        <Route path="provision" element={<ProvisionWizardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
