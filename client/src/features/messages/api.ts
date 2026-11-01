/**
 * Messages API — chat with the Coordinator desk.
 * Students, externals and the Super Admin each have one chat with the
 * Coordinators; Coordinators see every chat in an inbox.
 */
import { api } from '../../lib/api.js';

export type ChatRole = 'STUDENT' | 'EXTERNAL' | 'COORDINATOR' | 'SUPER_ADMIN';

export interface ChatMessage {
  message_id: string;
  body: string;
  created_at: string;
  sender_id: string;
  sender_name: string;
  sender_role: ChatRole;
}

export interface ChatParty {
  conversation_id: string;
  last_message_at: string | null;
  created_at: string;
  party_id: string;
  party_name: string;
  party_role: 'STUDENT' | 'EXTERNAL' | 'SUPER_ADMIN';
  party_email: string;
  enrollment_no: string | null;
  department: string | null;
  institution_name: string | null;
  designation: string | null;
}
export interface InboxRow extends ChatParty {
  unread: number;
  last_body: string | null;
  last_sender_id: string | null;
  last_from_party: boolean | null;
}
export interface AdminContact { user_id: string; full_name: string; email: string; conversation_id: string | null }

/** Fired after anything that may change the sidebar's unread number. */
export const MESSAGES_CHANGED = 'bukc:messages-changed';
export const notifyMessagesChanged = () => window.dispatchEvent(new Event(MESSAGES_CHANGED));

export const getUnreadCount = () => api<{ count: number }>('/api/messages/unread-count');

// party (student / external / Super Admin)
export const getMyChat = () => api<{ conversationId: string | null; messages: ChatMessage[]; deskLastReadAt: string | null }>('/api/messages/mine');
export const sendMyMessage = (body: string) => api<{ message: { message_id: string; created_at: string } }>('/api/messages/mine', { method: 'POST', body: { body } });
export const markMyChatRead = () => api<{ ok: true }>('/api/messages/mine/read', { method: 'POST', body: {} });

// coordinator
export const getInbox = () => api<{ conversations: InboxRow[] }>('/api/messages/inbox');
export const getConversation = (id: string) => api<{ party: ChatParty; messages: ChatMessage[]; partyLastReadAt: string | null }>(`/api/messages/conversations/${id}`);
export const replyTo = (id: string, body: string) => api<{ message: { message_id: string; created_at: string } }>(`/api/messages/conversations/${id}`, { method: 'POST', body: { body } });
export const markConversationRead = (id: string) => api<{ ok: true }>(`/api/messages/conversations/${id}/read`, { method: 'POST', body: {} });
export const listAdminContacts = () => api<{ admins: AdminContact[] }>('/api/messages/admins');
export const openAdminChat = (adminId: string) => api<{ conversationId: string }>(`/api/messages/admins/${adminId}/open`, { method: 'POST', body: {} });
