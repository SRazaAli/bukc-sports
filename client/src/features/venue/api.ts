import { api } from '../../lib/api.js';

export interface Venue { venue_id: number; name: string; capacity: number; is_indoor: boolean; is_active: boolean; sport_category_name: string | null }

export interface SessionInput {
  sessionNo: number; requestedStartAt: string; requestedEndAt: string;
  teamName: string; participantDetails?: string;
}
export interface SessionRequest {
  request_session_id: string; session_no: number; requested_start_at: string;
  requested_end_at: string; team_name: string; participant_details: string | null;
}

export interface MyBooking {
  booking_id: string; status: string; purpose: string; rejection_reason: string | null;
  submitted_at: string; venue_name: string;
  sessionCount: number; firstStart: string | null; lastEnd: string | null;
}
export interface QueueBooking {
  booking_id: string; origin: string; purpose: string; estimated_participants: number;
  submitted_at: string; venue_id: number; venue_name: string;
  requester_id?: string; requester_name: string | null; requester_email: string | null;
  sessionCount: number; firstStart: string | null; lastEnd: string | null;
}
export interface AdminQueueBooking extends QueueBooking { feasibility_note: string | null; forwarded_at: string }
export interface BookingDetail {
  booking_id: string; origin: string; status: string; purpose: string; estimated_participants: number;
  feasibility_note: string | null; rejection_reason: string | null; venue_name: string;
  sessions: SessionRequest[];
}
export interface CalendarSession {
  session_id: string; venue_id: number; venue_name: string; starts_at: string; ends_at: string;
  status: string; session_no: number; booking_id: string; origin: string; total_sessions: number;
}

// Feature 9: advisory session view — approved sessions with booking context.
// Used by ConflictDetectionScreen to show what slots are currently held.
export interface ApprovedSession {
  session_id: string;
  session_no: number;
  status: string;
  venue_id: number;
  venue_name: string;
  booking_id: string;
  origin: string;
  purpose: string;
  internal_client_ref: string | null;
  requester_name: string | null;
  requester_email: string | null;
  starts_at: string;
  ends_at: string;
}

export const listVenues = () => api<{ venues: Venue[] }>('/api/venue/venues');
export const createVenue = (input: { name: string; sportCategoryId?: number; capacity: number; isIndoor: boolean }) =>
  api<{ venue: { venue_id: number; name: string } }>('/api/venue/venues', { method: 'POST', body: input });

// VENUE-06/35/36: submit one or more sessions (max 30) as one package.
export const submitBooking = (input: {
  venueId: number; purpose: string; estimatedParticipants: number; sessions: SessionInput[];
}) => api<{ booking: { bookingId: string } }>('/api/venue/bookings', { method: 'POST', body: input });

// VENUE-28/29: Coordinator initiates a recurring academic event, same shape, no requester.
export const initiateAcademicEvent = (input: {
  venueId: number; purpose: string; estimatedParticipants: number; sessions: SessionInput[];
}) => api<{ booking: { bookingId: string } }>('/api/venue/academic-events', { method: 'POST', body: input });

export const listMyBookings = () => api<{ bookings: MyBooking[] }>('/api/venue/bookings/mine');
export const getBooking = (id: string) => api<BookingDetail>(`/api/venue/bookings/${id}`);

export const listQueue = () => api<{ queue: QueueBooking[] }>('/api/venue/queue');
export const forwardBooking = (id: string, note?: string) =>
  api<{ message: string }>(`/api/venue/bookings/${id}/forward`, { method: 'POST', body: { note } });

export const rejectBooking = (id: string, reason: string) =>
  api<{ message: string }>(`/api/venue/bookings/${id}/reject`, { method: 'POST', body: { reason } });

export const listAdminQueue = () => api<{ queue: AdminQueueBooking[] }>('/api/venue/admin-queue');
export const approveBooking = (id: string) => api<{ message: string }>(`/api/venue/bookings/${id}/approve`, { method: 'POST', body: {} });
export const returnForReeval = (id: string, note: string) =>
  api<{ message: string }>(`/api/venue/bookings/${id}/return`, { method: 'POST', body: { note } });

export const listCalendar = (params?: { venueId?: number; from?: string; to?: string }) => {
  const q = new URLSearchParams();
  if (params?.venueId) q.set('venueId', String(params.venueId));
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  const qs = q.toString();
  return api<{ sessions: CalendarSession[] }>(`/api/venue/calendar${qs ? `?${qs}` : ''}`);
};

// ── equipment allocation (VENUE-13/15/16/17, EQUIP-AVAIL-11..21) ──
export interface AllocationLine {
  allocation_request_id: string; request_session_id: string; session_no: number;
  equipment_type_id: number; equipment_type_name: string; quantity: number;
  is_self_managed: boolean; needs_shortfall_confirmation: boolean;
}
export interface AllocationInput { requestSessionId: string; equipmentTypeId: number; quantity: number }
export interface AllocationAlert {
  allocation_id: string; equipment_type_id: number; equipment_type_name: string;
  quantity: number; session_id: string; venue_name: string; availableUnits: number;
}

export const planAllocation = (bookingId: string, allocations: AllocationInput[]) =>
  api<{ shortfalls: Array<{ equipmentTypeId: number; requested: number; available: number }>; message: string }>(
    `/api/venue/bookings/${bookingId}/equipment`, { method: 'POST', body: { allocations } });
export const getAllocationPlan = (bookingId: string) =>
  api<{ allocations: AllocationLine[] }>(`/api/venue/bookings/${bookingId}/equipment`);
export const confirmShortfall = (bookingId: string, confirm: boolean) =>
  api<{ status: string; message: string }>(`/api/venue/bookings/${bookingId}/shortfall-confirm`, { method: 'POST', body: { confirm } });

export const listAllocationAlerts = () => api<{ alerts: AllocationAlert[] }>('/api/venue/event-equipment/alerts');
export const performSwap = (allocationId: string, input: { outgoingArticleId: string; incomingArticleId: string; reason?: string }) =>
  api<{ message: string }>(`/api/venue/event-equipment/${allocationId}/swap`, { method: 'POST', body: input });

// ── Feature 9: Conflict Detection & Resolution ──

// Advisory query: returns all currently SCHEDULED/IN_PROGRESS sessions
// (i.e. sessions that are actively holding a slot). Filter by venue + dates.
export const queryConflicts = (params?: { venueId?: number; from?: string; to?: string }) => {
  const q = new URLSearchParams();
  if (params?.venueId) q.set('venueId', String(params.venueId));
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  const qs = q.toString();
  return api<{ sessions: ApprovedSession[] }>(`/api/venue/conflicts${qs ? `?${qs}` : ''}`);
};

// List all approved sessions (same shape as conflicts but via /sessions route).
export const listApprovedSessions = (params?: { venueId?: number; from?: string; to?: string }) => {
  const q = new URLSearchParams();
  if (params?.venueId) q.set('venueId', String(params.venueId));
  if (params?.from) q.set('from', params.from);
  if (params?.to) q.set('to', params.to);
  const qs = q.toString();
  return api<{ sessions: ApprovedSession[] }>(`/api/venue/sessions${qs ? `?${qs}` : ''}`);
};

// Resolution actions (Coordinator + Super Admin — Role-Based Access Table).
export const cancelSession = (sessionId: string, reason: string) =>
  api<{ message: string }>(`/api/venue/sessions/${sessionId}/cancel`, { method: 'POST', body: { reason } });

// CONF-13: soft resolution — marks NEEDS_RESCHEDULING, releases the slot.
export const markSessionNeedsRescheduling = (sessionId: string, reason: string) =>
  api<{ message: string }>(`/api/venue/sessions/${sessionId}/reschedule`, { method: 'POST', body: { reason } });
