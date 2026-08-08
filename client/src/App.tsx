/**
 * App root. Route tree with the auth provider. 
 *
 * Navigation model (per the redesign): the landing page is a tile grid of the
 * four portals. Each tile opens its own login page. There is no role dropdown.
 *  - /login/student      enrollment + password + institute
 *  - /login/external     email + password  (+ New External)
 *  - /login/coordinator  email + password  (invite-only; no register link)
 *  - /login/admin        email + password  (seeded; no register link)
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'; 
import { AuthProvider } from './lib/auth.js';
import { RequireAuth, RequireRole } from './routes/Guard.js';
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
import BorrowQueueScreen from './features/borrow/BorrowQueueScreen.js';
import ActiveBorrowsScreen from './features/borrow/ActiveBorrowsScreen.js';
import MyBookingsScreen from './features/venue/MyBookingsScreen.js';
import VenueQueueScreen from './features/venue/VenueQueueScreen.js';
import EquipmentAlertsScreen from './features/venue/EquipmentAlertsScreen.js';
import VenueApprovalScreen from './features/venue/VenueApprovalScreen.js';
import CalendarScreen from './features/venue/CalendarScreen.js';
import ConflictDetectionScreen from './features/venue/ConflictDetectionScreen.js';
import HomeScreen from './features/auth/HomeScreen.js';
import UsageHistoryScreen from './features/history/UsageHistoryScreen.js';
import OfflineFallbackScreen from './features/offline/OfflineFallbackScreen.js';
import DashboardScreen from './features/dashboard/DashboardScreen.js';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Landing = the role picker */}
          <Route path="/" element={<LandingScreen />} />

          {/* Four role-specific logins */}
          <Route path="/login/student" element={<LoginScreen role="student" />} />
          <Route path="/login/external" element={<LoginScreen role="external" />} />
          <Route path="/login/coordinator" element={<LoginScreen role="coordinator" />} />
          <Route path="/login/admin" element={<LoginScreen role="admin" />} />

          {/* Registration (students & externals only) */}
          <Route path="/register/student" element={<RegisterScreen role="student" />} />
          <Route path="/register/external" element={<RegisterScreen role="external" />} />

          {/* Password + invite */}
          <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
          <Route path="/reset-password" element={<ResetPasswordScreen />} />
          <Route path="/accept-invite" element={<AcceptInviteScreen />} />

          {/* Signed-in landing (role-aware) */}
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/profile" element={<RequireAuth><ProfileScreen /></RequireAuth>} />

          {/* Super Admin (full) / Coordinator (read-only, AUTH-16) */}
          <Route
            path="/admin/accounts"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <AdminAccountsScreen />
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

          {/* Feature 9: Conflict Detection & Resolution — staff only */}
          <Route
            path="/conflict-detection"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <ConflictDetectionScreen />
              </RequireRole>
            }
          />

          <Route path="/usage-history" element={<UsageHistoryScreen />} />

          {/* Feature 11: Offline Fallback Entry — staff only */}
          <Route
            path="/offline-fallback"
            element={
              <RequireRole roles={['SUPER_ADMIN', 'COORDINATOR']}>
                <OfflineFallbackScreen />
              </RequireRole>
            }
          />

          {/* Feature 12: Admin Dashboard — SUPER_ADMIN only */}
          <Route
            path="/dashboard"
            element={
              <RequireRole roles={['SUPER_ADMIN']}>
                <DashboardScreen />
              </RequireRole>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
