import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { FinderPage } from './pages/FinderPage';
import { CoursePage } from './pages/CoursePage';
import { PlanPage } from './pages/PlanPage';
import { SharePage } from './pages/SharePage';
import { RoundPage } from './pages/RoundPage';
import { AuthProvider } from './state/AuthContext';
import { CourseCatalogProvider } from './state/CourseCatalogContext';

function RoutedApp() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<FinderPage />} />
        <Route path="/course/:courseId" element={<CoursePage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/share" element={<SharePage />} />
        <Route path="/round/:slug" element={<RoundPage />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <CourseCatalogProvider>
      <AuthProvider>
        <BrowserRouter basename="/app">
          <RoutedApp />
        </BrowserRouter>
      </AuthProvider>
    </CourseCatalogProvider>
  );
}

export default App;
