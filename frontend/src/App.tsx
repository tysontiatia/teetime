import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FinderPage } from './pages/FinderPage';
import { CoursePage } from './pages/CoursePage';
import { PlanPage } from './pages/PlanPage';
import { SharePage } from './pages/SharePage';
import { RoundPage } from './pages/RoundPage';
import { AccountPage } from './pages/AccountPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AuthProvider } from './state/AuthContext';
import { CourseCatalogProvider } from './state/CourseCatalogContext';

function RoutedApp() {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.key}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<FinderPage />} />
          <Route path="/course/:courseId" element={<CoursePage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/share" element={<SharePage />} />
          <Route path="/round/:slug" element={<RoundPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <CourseCatalogProvider>
        <AuthProvider>
          <BrowserRouter basename="/app">
            <RoutedApp />
          </BrowserRouter>
        </AuthProvider>
      </CourseCatalogProvider>
    </ErrorBoundary>
  );
}

export default App;
