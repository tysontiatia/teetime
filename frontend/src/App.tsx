import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AdminGuard } from './components/AdminGuard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StayFinder } from './stay/StayFinder';
import { StayCourse } from './stay/StayCourse';
import { StaySection } from './stay/StaySection';
import { PlanPage } from './pages/PlanPage';
import { SharePage } from './pages/SharePage';
import { RoundPage } from './pages/RoundPage';
import { AccountPage } from './pages/AccountPage';
import { FeedPage } from './pages/FeedPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AdminCoursesListPage } from './pages/admin/AdminCoursesListPage';
import { AdminCourseEditPage } from './pages/admin/AdminCourseEditPage';
import { AdminCoursesImportPage } from './pages/admin/AdminCoursesImportPage';
import { AdminCoursesDiscoverPage } from './pages/admin/AdminCoursesDiscoverPage';
import { AdminCourseQaPage } from './pages/admin/AdminCourseQaPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AuthProvider } from './state/AuthContext';
import { CourseCatalogProvider } from './state/CourseCatalogContext';
import { PostHogTracker } from './components/PostHogTracker';

function RoutedApp() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<StayFinder />} />
        <Route path="/search" element={<StayFinder />} />
        <Route path="/course/:courseId" element={<StayCourse />} />
        <Route path="/favorites" element={<StaySection title="Favorites">Courses you save show up here.</StaySection>} />
        <Route path="/pricing" element={<StaySection title="Pricing">Tee-Time is free. You book and pay the course directly.</StaySection>} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/share" element={<SharePage />} />
        <Route path="/round/:slug" element={<RoundPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route element={<AdminGuard />}>
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/courses" element={<AdminCoursesListPage />} />
          <Route path="/admin/courses/import" element={<AdminCoursesImportPage />} />
          <Route path="/admin/courses/discover" element={<AdminCoursesDiscoverPage />} />
          <Route path="/admin/courses/qa" element={<AdminCourseQaPage />} />
          <Route path="/admin/courses/qa/:slug" element={<AdminCourseQaPage />} />
          <Route path="/admin/courses/:slug" element={<AdminCourseEditPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <CourseCatalogProvider>
        <AuthProvider>
          {/* Route changes must commit with the address bar. startTransition was
              leaving a course page on screen after the URL had already become /app. */}
          <BrowserRouter basename="/app" unstable_useTransitions={false}>
            <PostHogTracker />
            <RoutedApp />
          </BrowserRouter>
        </AuthProvider>
      </CourseCatalogProvider>
    </ErrorBoundary>
  );
}

export default App;
