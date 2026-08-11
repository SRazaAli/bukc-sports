/**
 * App root — updated to include all missing screens:
 * - /history          UsageHistoryScreen (all roles)
 * - /conflicts        ConflictDetectionScreen (Super Admin)
 * - /admin/accounts   AdminAccountsScreen with 3 tabs (pending + all users + invite)
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth.js';
import { RequireAuth, RequireRole } from './routes/Guard.js';

// Pre-auth (AuthShell)
import LandingScreen from './features/auth/LandingScreen.js';
import LoginScreen from './features/auth/LoginScreen.js';
import RegisterScreen from './features/auth/RegisterScreen.js';
import { ForgotPasswordScreen, ResetPasswordScreen } from './features/auth/AuthScreens.js';
import AcceptInviteScreen from './features/auth/AuthScreens.js';

// Dashboard
import HomeScreen from './features/auth/HomeScreen.js';

// Auth admin
import AdminAccountsScreen from './features/auth/AdminAccountsScreen.js';

// Equipment
import InventoryScreen from './features/inventory/InventoryScreen.js';
import AvailabilityScreen from './features/availability/AvailabilityScreen.js';
import MyBorrowsScreen from './features/borrow/MyBorrowsScreen.js';
import BorrowQueueScreen from './features/borrow/BorrowQueueScreen.js';
import ActiveBorrowsScreen from './features/borrow/ActiveBorrowsScreen.js';

// Venue
import MyBookingsScreen from './features/venue/MyBookingsScreen.js';
import VenueQueueScreen from './features/venue/VenueQueueScreen.js';
import EquipmentAlertsScreen from './features/venue/EquipmentAlertsScreen.js';
import VenueApprovalScreen from './features/venue/VenueApprovalScreen.js';
import CalendarScreen from './features/venue/CalendarScreen.js';

// Records
import UsageHistoryScreen from './features/history/UsageHistoryScreen.js';
import ConflictDetectionScreen from './features/venue/ConflictDetectionScreen.js';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ── Landing ── */}
          <Route path="/" element={<LandingScreen />} />

          {/* ── Role logins ── */}
          <Route path="/login/student"     element={<LoginScreen role="student" />} />
          <Route path="/login/external"    element={<LoginScreen role="external" />} />
          <Route path="/login/coordinator" element={<LoginScreen role="coordinator" />} />
          <Route path="/login/admin"       element={<LoginScreen role="admin" />} />

          {/* ── Registration ── */}
          <Route path="/register/student"  element={<RegisterScreen role="student" />} />
          <Route path="/register/external" element={<RegisterScreen role="external" />} />

          {/* ── Password + invite ── */}
          <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
          <Route path="/reset-password"  element={<ResetPasswordScreen />} />
          <Route path="/accept-invite"   element={<AcceptInviteScreen />} />

          {/* ── Dashboard ── */}
          <Route path="/home" element={<RequireAuth><HomeScreen /></RequireAuth>} />

          {/* ── All authenticated roles ── */}
          <Route path="/availability" element={<RequireAuth><AvailabilityScreen /></RequireAuth>} />
          <Route path="/calendar"     element={<RequireAuth><CalendarScreen /></RequireAuth>} />
          <Route path="/history"      element={<RequireAuth><UsageHistoryScreen /></RequireAuth>} />

          {/* ── Student only ── */}
          <Route path="/my-borrows"
            element={<RequireRole roles={['STUDENT']}><MyBorrowsScreen /></RequireRole>} />

          {/* ── Student + External ── */}
          <Route path="/book-venue"
            element={<RequireRole roles={['STUDENT','EXTERNAL']}><MyBookingsScreen /></RequireRole>} />
          <Route path="/my-bookings"
            element={<RequireRole roles={['STUDENT','EXTERNAL']}><MyBookingsScreen /></RequireRole>} />

          {/* ── Coordinator ── */}
          <Route path="/borrow-queue"
            element={<RequireRole roles={['COORDINATOR']}><BorrowQueueScreen /></RequireRole>} />
          <Route path="/venue-queue"
            element={<RequireRole roles={['COORDINATOR']}><VenueQueueScreen /></RequireRole>} />
          <Route path="/equipment-alerts"
            element={<RequireRole roles={['COORDINATOR']}><EquipmentAlertsScreen /></RequireRole>} />

          {/* ── Coordinator + Admin ── */}
          <Route path="/active-borrows"
            element={<RequireRole roles={['SUPER_ADMIN','COORDINATOR']}><ActiveBorrowsScreen /></RequireRole>} />
          <Route path="/inventory"
            element={<RequireRole roles={['SUPER_ADMIN','COORDINATOR']}><InventoryScreen /></RequireRole>} />

          {/* ── Super Admin ── */}
          <Route path="/admin/accounts"
            element={<RequireRole roles={['SUPER_ADMIN']}><AdminAccountsScreen /></RequireRole>} />
          <Route path="/venue-approvals"
            element={<RequireRole roles={['SUPER_ADMIN']}><VenueApprovalScreen /></RequireRole>} />
          <Route path="/conflicts"
            element={<RequireRole roles={['SUPER_ADMIN']}><ConflictDetectionScreen /></RequireRole>} />

          {/* ── Catch-all ── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
