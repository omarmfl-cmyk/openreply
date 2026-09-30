import { requireEnv } from '@/lib/env';

export function facebookEnabled() {
  return process.env.OPENREPLY_ENV === 'staging' && process.env.FACEBOOK_AUTOMATION_ENABLED === 'true';
}

export function requireFacebook() {
  if (!facebookEnabled()) throw new Error('Facebook automation is disabled outside isolated staging');
}

export const FACEBOOK_PERMISSIONS = [
  'business_management',
  'pages_show_list', 'pages_manage_metadata', 'pages_read_engagement',
  'pages_read_user_content', 'pages_manage_engagement', 'pages_messaging',
];

export function facebookVersion() {
  return process.env.FACEBOOK_PAGE_GRAPH_API_VERSION || 'v26.0';
}

export function facebookCallback() {
  return `${requireEnv('NEXTAUTH_URL').replace(/\/$/, '')}/api/facebook/callback`;
}
