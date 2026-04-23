import { useMemo } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PlanTray } from './components/PlanTray';
import { FinderPage } from './pages/FinderPage';
import { CoursePage } from './pages/CoursePage';
import { PlanPage } from './pages/PlanPage';
import { SharePage } from './pages/SharePage';
import { toYmd } from './lib/time';
import { PlanProvider } from './state/PlanContext';
import { AuthProvider } from './state/AuthContext';
import { CourseCatalogProvider, useCourseCatalog } from './state/CourseCatalogContext';

function RoutedApp() {
  const { courses } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<FinderPage />} />
          <Route path="/course/:courseId" element={<CoursePage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/share" element={<SharePage />} />
        </Route>
      </Routes>
      <PlanTray coursesById={coursesById} />
    </>
  );
}

function App() {
  return (
    <CourseCatalogProvider>
      <AuthProvider>
        <PlanProvider initialDate={toYmd(new Date())}>
          <BrowserRouter basename="/app">
            <RoutedApp />
          </BrowserRouter>
        </PlanProvider>
      </AuthProvider>
    </CourseCatalogProvider>
  );
}

export default App;
