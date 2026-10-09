/**
 * App root. Route tree with the auth provider.
 *
 * Public pages (landing, login, register, password reset, accept invite) render
 * on their own. Every signed-in page renders inside <AppLayout>, which adds the
 * role-based collapsible sidebar (logo at the top, Sign out at the bottom).
 * After login users land on /profile; the old /home address redirects there.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth.js';
import { RequireRole } from './routes/Guard.js';
import LandingScreen from './features/auth/LandingScreen.js';
import LoginScreen from './features/auth/LoginScreen.js';
import RegisterScreen from './features/auth/RegisterScreen.js';
import { ForgotPasswordScreen, ResetPasswordScreen } from './features/auth/PasswordResetScreens.js';
import AcceptInviteScreen from './features/auth/AcceptInviteScreen.js';
import AdminAccountsScreen from './features/auth/AdminAccountsScreen.js';
import ProfileScreen from './features/auth/ProfileScreen.js';
import InventoryScreen from './features/inventory/InventoryScreen.js';
import AvailabilityScreen from './features/availability/AvailabilityScreen.js';
import MyBorrowsScreen from './features/borrow/MyBorrowsScreen.js';
import EquipmentBorrowScreen from './features/borrow/EquipmentBorrowScreen.js';
import BorrowQueueScreen from './features/borrow/BorrowQueueScreen.js';
import ActiveBorrowsScreen from './features/borrow/ActiveBorrowsScreen.js';
import MyBookingsScreen from './features/venue/MyBookingsScreen.js';
import VenueQueueScreen from './features/venue/VenueQueueScreen.js';
import EquipmentAlertsScreen from './features/venue/EquipmentAlertsScreen.js';
import VenueApprovalScreen from './features/venue/VenueApprovalScreen.js';
import CalendarScreen from './features/venue/CalendarScreen.js';
import ConflictDetectionScreen from './features/venue/ConflictDetectionScreen.js';
import UsageHistoryScreen from './features/history/UsageHistoryScreen.js';
import DashboardScreen from './features/dashboard/DashboardScreen.js';
import OfflineFallbackScreen from './features/offline/OfflineFallbackScreen.js';
import AppLayout from './components/AppLayout.js';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingScreen />} />

          <Route path="/login/student" element={<LoginScreen role="student" />} />
          <Route path="/login/external" element={<LoginScreen role="external" />} />
          <Route path="/login/coordinator" element={<LoginScreen role="coordinator" />} />
          <Route path="/login/admin" element={<LoginScreen role="admin" />} />

          <Route path="/register/student" element={<RegisterScreen role="student" />} />
          <Route path="/register/external" element={<RegisterScreen role="external" />} />

          <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />
          <Route path="/accept-invite" element={<AcceptInviteScreen />} />

          {/* ── Signed-in pages: shown inside the sidebar layout ── */}
          <Route element={<AppLayout />}>
          {/* The old home screen is replaced by the sidebar; anything that still
              points at /home (role redirects, bookmarks) lands on the profile. */}
          <Route path="/home" element={<Navigate to="/profile" replace />} />

          {/* Profile — all authenticated roles (first page after login) */}
          <Route path="/profile" element={<ProfileScreen />} />

          <Route
            path="/admin/accounts"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <AdminAccountsScreen />
              </RequireRole>
            }
          />

          <Route
            path="/dashboard"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <DashboardScreen />
              </RequireRole>
            }
          />

          <Route
            path="/inventory"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <InventoryScreen />
              </RequireRole>
            }
          />

          <Route path="/availability" element={<AvailabilityScreen />} />

          <Route
            path="/borrow/:typeId"
            element={
              <RequireRole roles={['STUDENT']}>
                <EquipmentBorrowScreen />
              </RequireRole>
            }
          />

          <Route path="/my-borrows" element={<MyBorrowsScreen />} />

          <Route
            path="/borrow-queue"
            element={
              <RequireRole roles={['COORDINATOR']}>
                <BorrowQueueScreen />
              </RequireRole>
            }
          />
          <Route
            path="/active-borrows"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <ActiveBorrowsScreen />
              </RequireRole>
            }
          />
          <Route
            path="/book-venue"
            element={
              <RequireRole roles={['STUDENT', 'EXTERNAL']}>
                <MyBookingsScreen />
              </RequireRole>
            }
          />
          <Route
            path="/venue-queue"
            element={
              <RequireRole roles={['COORDINATOR']}>
                <VenueQueueScreen />
              </RequireRole>
            }
          />
          <Route
            path="/equipment-alerts"
            element={
              <RequireRole roles={['COORDINATOR']}>
                <EquipmentAlertsScreen />
              </RequireRole>
            }
          />
          <Route
            path="/venue-approvals"
            element={
              <RequireRole roles={['SUPER_ADMIN']}>
                <VenueApprovalScreen />
              </RequireRole>
            }
          />

          <Route path="/calendar" element={<CalendarScreen />} />

          <Route
            path="/conflict-detection"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <ConflictDetectionScreen />
              </RequireRole>
            }
          />

          {/* Usage History — staff get full view + article lifecycle tab;
              students/externals see their own records only */}
          <Route path="/usage-history" element={<UsageHistoryScreen />} />

          <Route
            path="/offline-fallback"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <OfflineFallbackScreen />
              </RequireRole>
            }
          />

          </Route>

          {/* Catch-all → /home (→ profile when signed in, landing page when not) */}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
