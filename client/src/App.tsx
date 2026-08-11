/**
 * App root. Route tree with the auth provider.
 *
 * Auth screens (no AppShell — use AuthShell for the split-panel layout):
 *  /                      Landing tile grid
 *  /login/student         enrollment + password + institute
 *  /login/external        email + password  (+ Create account)
 *  /login/coordinator     email + password  (invite-only; no register)
 *  /login/admin           email + password  (seeded; no register)
 *  /register/student
 *  /register/external
 *  /forgot-password
 *  /reset-password
 *  /accept-invite
 *
 * Authenticated routes (inside AppShell sidebar layout):
 *  /home                  Role-aware dashboard
 *  /availability          Equipment availability (all roles)
 *  /my-borrows            Student borrow requests
 *  /borrow-queue          Coordinator borrow queue
 *  /active-borrows        Coordinator + Admin active borrows
 *  /inventory             Coordinator + Admin inventory
 *  /book-venue            Student + External venue booking
 *  /my-bookings           Student + External booking history
 *  /venue-queue           Coordinator venue queue
 *  /equipment-alerts      Coordinator equipment alerts
 *  /venue-approvals       Super Admin venue approvals
 *  /calendar              All roles — read-only calendar
 *  /history               All roles — usage history (placeholder)
 *  /admin/accounts        Super Admin account management
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth.js';
import { RequireAuth, RequireRole } from './routes/Guard.js';

// Pre-auth screens (AuthShell layout, no sidebar)
import LandingScreen from './features/auth/LandingScreen.js';
import LoginScreen from './features/auth/LoginScreen.js';
import RegisterScreen from './features/auth/RegisterScreen.js';
import {
  ForgotPasswordScreen,
  ResetPasswordScreen,
} from './features/auth/AuthScreens.js';
import AcceptInviteScreen from './features/auth/AuthScreens.js';

// Dashboard
import HomeScreen from './features/auth/HomeScreen.js';

// Authenticated feature screens (AppShell layout)
import AdminAccountsScreen from './features/auth/AdminAccountsScreen.js';
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ── Landing ── */}
          <Route path="/" element={<LandingScreen />} />

          {/* ── Role-specific logins ── */}
          <Route path="/login/student"     element={<LoginScreen role="student" />} />
          <Route path="/login/external"    element={<LoginScreen role="external" />} />
          <Route path="/login/coordinator" element={<LoginScreen role="coordinator" />} />
          <Route path="/login/admin"       element={<LoginScreen role="admin" />} />

          {/* ── Registration (Student + External only) ── */}
          <Route path="/register/student"  element={<RegisterScreen role="student" />} />
          <Route path="/register/external" element={<RegisterScreen role="external" />} />

          {/* ── Password reset + invite ── */}
          <Route path="/forgot-password"   element={<ForgotPasswordScreen />} />
          <Route path="/reset-password"    element={<ResetPasswordScreen />} />
          <Route path="/accept-invite"     element={<AcceptInviteScreen />} />

          {/* ── Dashboard (all authenticated roles) ── */}
          <Route path="/home" element={<RequireAuth><HomeScreen /></RequireAuth>} />

          {/* ── All authenticated roles ── */}
          <Route path="/availability" element={<RequireAuth><AvailabilityScreen /></RequireAuth>} />
          <Route path="/calendar"     element={<RequireAuth><CalendarScreen /></RequireAuth>} />
          <Route path="/history"      element={<RequireAuth><Navigate to="/home" replace /></RequireAuth>} />

          {/* ── Student only ── */}
          <Route path="/my-borrows"
            element={<RequireRole roles={['STUDENT']}><MyBorrowsScreen /></RequireRole>} />

          {/* ── Student + External ── */}
          <Route path="/book-venue"
            element={<RequireRole roles={['STUDENT','EXTERNAL']}><Navigate to="/home" replace /></RequireRole>} />
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

          {/* ── Catch-all ── */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
