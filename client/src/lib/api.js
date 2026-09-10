import axios from 'axios';
import { clearSession } from './session';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear all authentication data
      clearSession();
      window.location.href = '/login';
    }

    // Replace the generic "Validation failed" message with the actual
    // per-field reasons so any caller that reads err.response.data.message
    // (toasts, inline banners, etc.) shows something useful.
    const data = error.response?.data;
    if (data && data.errors && typeof data.errors === 'object') {
      const parts = Object.values(data.errors)
        .filter((msg) => msg != null)
        .map((msg) => String(msg));
      if (parts.length > 0) {
        data.message = parts.join(' • ');
      }
    }

    return Promise.reject(error);
  }
);

// Site API endpoints
export const siteApi = {
  getAll: (params) => api.get('/sites', { params }),
  getById: (id) => api.get(`/sites/${id}`),
  create: (data) => api.post('/sites', data),
  bulkCreate: (sites) => api.post('/sites/bulk', { sites }),
  update: (id, data) => api.put(`/sites/${id}`, data),
  delete: (id) => api.delete(`/sites/${id}`),
  getEmployees: (id) => api.get(`/sites/${id}/employees`),
  assignEmployees: (id, employeeIds) => api.post(`/sites/${id}/employees`, { employeeIds }),
  getAccessCodes: (id) => api.get(`/sites/${id}/access-codes`),
  addAccessCode: (id, data) => api.post(`/sites/${id}/access-codes`, data),
  updateAccessCode: (id, codeId, data) => api.put(`/sites/${id}/access-codes/${codeId}`, data),
  deleteAccessCode: (id, codeId) => api.delete(`/sites/${id}/access-codes/${codeId}`)
};

// Scheduler API endpoints
export const schedulerApi = {
  getSites: () => api.get('/scheduler/sites'),
  getSiteEmployees: (siteId) => api.get(`/scheduler/sites/${siteId}/employees`),
  getSiteShifts: (siteId, startDate, endDate) =>
    api.get(`/scheduler/sites/${siteId}/shifts`, { params: { startDate, endDate } })
};

// Shift API endpoints
export const shiftApi = {
  getById: (id) => api.get(`/scheduler/shifts/${id}`),
  create: (data) => api.post('/scheduler/shifts', data),
  createAdhoc: (data) => api.post('/scheduler/shifts/adhoc', data),
  update: (id, data) => api.put(`/scheduler/shifts/${id}`, data),
  delete: (id) => api.delete(`/scheduler/shifts/${id}`),
  getMyShifts: (startDate, endDate) => api.get('/shifts/my-shifts', { params: { startDate, endDate } }),
  getMyEmployee: () => api.get('/shifts/my-employee'),
  getAccessCodes: (shiftId) => api.get(`/shifts/${shiftId}/access-codes`),
  getDeleted: (siteId) => api.get('/scheduler/shifts/deleted', { params: { siteId } }),
  restore: (id) => api.put(`/scheduler/shifts/${id}/restore`),
  permanentDelete: (id) => api.delete(`/scheduler/shifts/${id}/permanent`)
};

// Weather API endpoints
export const weatherApi = {
  getForecast: (latitude, longitude) =>
    api.get('/weather/forecast', { params: { latitude, longitude } })
};

// Client API endpoints
export const clientApi = {
  getAll: (params) => api.get('/clients', { params }),
  getById: (id) => api.get(`/clients/${id}`),
  create: (data) => api.post('/clients', data),
  bulkCreate: (clients) => api.post('/clients/bulk', { clients }),
  update: (id, data) => api.put(`/clients/${id}`, data),
  delete: (id) => api.delete(`/clients/${id}`)
};

// Employee API endpoints
export const employeeApi = {
  getAll: (params) => api.get('/employees', { params }),
  getById: (id) => api.get(`/employees/${id}`),
  create: (data) => api.post('/employees', data),
  update: (id, data) => api.put(`/employees/${id}`, data),
  delete: (id) => api.delete(`/employees/${id}`),
  assignToSites: (id, siteIds) => api.post(`/employees/${id}/sites`, { siteIds })
};

// User/Auth API endpoints
export const userApi = {
  login: (credentials) => api.post('/auth/login', credentials),
  getMyShifts: (startDate, endDate) =>
    api.get('/shifts/my-shifts', { params: { startDate, endDate } }),
  changePassword: (data) => api.put('/users/me/password', data),
  getProfile: () => api.get('/users/me'),
  updateProfile: (data) => api.put('/users/me', data)
};

// Clock In/Out API endpoints
export const clockApi = {
  clockIn: (employeeId, siteId, latitude, longitude, photo, shiftId) => {
    const formData = new FormData();
    formData.append('employeeId', employeeId);
    formData.append('siteId', siteId);
    formData.append('latitude', latitude);
    formData.append('longitude', longitude);
    if (photo) formData.append('photo', photo);
    if (shiftId) formData.append('shiftId', shiftId);

    return api.post('/clock/in', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  clockOut: (employeeId, latitude, longitude, photo) => {
    const formData = new FormData();
    formData.append('employeeId', employeeId);
    formData.append('latitude', latitude);
    formData.append('longitude', longitude);
    if (photo) formData.append('photo', photo);

    return api.post('/clock/out', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getCurrentStatus: (employeeId) => api.get('/clock/status', { params: { employeeId } }),

  getMyHistory: (employeeId, params = {}) => api.get('/clock/history', {
    params: { employeeId, ...params }
  }),

  getRecords: (params = {}) => api.get('/clock/records', { params }),

  exportCSV: (params = {}) => api.get('/clock/export', {
    params,
    responseType: 'blob'
  })
};

// Leave API endpoints
export const leaveApi = {
  // Admin
  getAll: (params) => api.get('/leave', { params }),
  getStats: () => api.get('/leave/stats'),
  create: (data) => api.post('/leave', data),
  approve: (id, actionNote = '') => api.put(`/leave/${id}/approve`, { actionNote }),
  decline: (id, actionNote = '') => api.put(`/leave/${id}/decline`, { actionNote }),
  cancel: (id) => api.put(`/leave/${id}/cancel`),
  // Employee self-service
  getMy: (params) => api.get('/leave/my', { params }),
  submitMy: (data) => api.post('/leave/my', data),
  cancelMy: (id) => api.put(`/leave/my/${id}/cancel`),
};

// Dashboard API endpoints
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
  getAttendance: () => api.get('/dashboard/attendance'),
  getCoverage: (period = 'week') => api.get('/dashboard/coverage', { params: { period } }),
};

// Organisation settings (the caller's own organisation)
export const companyApi = {
  getMine: () => api.get('/companies/me'),
  updateMine: (data) => api.put('/companies/me', data),
  getStats: (id) => api.get(`/companies/${id}/stats`),
};

// Adhoc shift request API endpoints
export const adhocApi = {
  // Employee self-service
  getMy: (params) => api.get('/scheduler/adhoc/my', { params }),
  request: (data) => api.post('/scheduler/adhoc/my', data),
  withdraw: (id) => api.put(`/scheduler/adhoc/my/${id}/withdraw`),
  // Reviewer
  list: (params) => api.get('/scheduler/adhoc/requests', { params }),
  getStats: () => api.get('/scheduler/adhoc/stats'),
  approve: (id, note = '') => api.put(`/scheduler/adhoc/requests/${id}/approve`, { note }),
  reject: (id, note = '') => api.put(`/scheduler/adhoc/requests/${id}/reject`, { note }),
};

// Master (platform administration) API endpoints
export const masterApi = {
  getStats: () => api.get('/master/stats'),
  getModules: () => api.get('/master/modules'),
  listOrganisations: (params) => api.get('/master/organisations', { params }),
  getOrganisation: (id) => api.get(`/master/organisations/${id}`),
  createOrganisation: (data) => api.post('/master/organisations', data),
  updateOrganisation: (id, data) => api.put(`/master/organisations/${id}`, data),
  setModules: (id, modules) => api.put(`/master/organisations/${id}/modules`, { modules }),
  setStatus: (id, data) => api.put(`/master/organisations/${id}/status`, data),
  createAdmin: (id, data) => api.post(`/master/organisations/${id}/admins`, data),
  resendCredentials: (id, userId) =>
    api.post(`/master/organisations/${id}/admins/${userId}/resend`),
};

// Agent API endpoints
//
// The server owns the tool catalogue, so the client asks what it may run rather
// than hard-coding a list. Writes are always two calls: a draft, then a commit
// that echoes the integrity hash from the preview.
export const agentApi = {
  getTools: () => api.get('/agent/tools'),
  // Single round-trip: plan + execute/prepare in one call.
  // Returns { kind: 'reply'|'read'|'write', ... }
  chat: (message, history = []) => api.post('/agent/chat', { message, history }),
  // Transcribe audio via Groq Whisper. Returns { text, pipeline }.
  transcribe: (audioBlob) => {
    const form = new FormData();
    form.append('audio', audioBlob, 'audio.webm');
    return api.post('/agent/transcribe', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  // Neural TTS via Groq Orpheus. Returns raw audio ArrayBuffer.
  tts: (text) =>
    api.post('/agent/tts', { text }, { responseType: 'arraybuffer' }),
  execute: (tool, input = {}, channel = 'text') =>
    api.post('/agent/execute', { tool, input, channel }),
  prepare: (tool, input = {}, channel = 'text') =>
    api.post('/agent/drafts', { tool, input, channel }),
  commit: (draftId, integrityHash, channel = 'text') =>
    api.post(`/agent/drafts/${draftId}/commit`, { integrityHash, channel }),
  cancel: (draftId) => api.post(`/agent/drafts/${draftId}/cancel`),
};

// Geocoding API endpoints
export const geocodingApi = {
  search: (query, countryCode = 'au', limit = 5) =>
    api.get('/geocoding/search', { params: { q: query, countryCode, limit } }),
  reverse: (lat, lon) =>
    api.get('/geocoding/reverse', { params: { lat, lon } }),
};

export default api;
