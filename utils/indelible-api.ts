import { useSettingsStore } from '~/stores/settings'

export interface IndelibleUser {
  id: number
  email: string
  first_name: string
  last_name: string
  permission: string
  department: string | null
  is_service_account: boolean
}

export interface IndelibleUpload {
  id: number
  uuid: string
  user_id: number
  filename: string
  original_filename: string
  file_size: number
  content_type: string
  visibility: string
  status: string
  estimated_cost: string | null
  autonomi_address: string | null
  created_at: string
  completed_at: string | null
}

export interface IndelibleUploadList {
  uploads: IndelibleUpload[]
  total: number
}

class IndelibleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'IndelibleApiError'
  }
}

function getConfig() {
  const settings = useSettingsStore()
  return {
    baseUrl: settings.indelibleUrl?.replace(/\/+$/, '') ?? '',
    apiKey: settings.indelibleApiKey ?? '',
  }
}

async function request<T>(method: string, path: string, body?: unknown, isFormData = false): Promise<T> {
  const { baseUrl, apiKey } = getConfig()
  if (!baseUrl || !apiKey) {
    throw new IndelibleApiError(0, 'Indelible not configured')
  }

  const url = `${baseUrl}${path}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
  }

  const opts: RequestInit = { method, headers }

  if (body !== undefined) {
    if (isFormData) {
      opts.body = body as FormData
      // Let browser set Content-Type with boundary for multipart
    } else {
      headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
  }

  const res = await fetch(url, opts)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = `HTTP ${res.status}`
    try {
      const json = JSON.parse(text)
      if (json.error) msg = json.error
    } catch {
      if (text) msg = text
    }
    throw new IndelibleApiError(res.status, msg)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return res.json()
  }
  return {} as T
}

export const indelibleApi = {
  /** Test connection and get current user info */
  me: () => request<IndelibleUser>('GET', '/api/v2/me'),

  /** List uploads */
  uploads: (limit = 50, offset = 0) =>
    request<IndelibleUploadList>('GET', `/api/v2/uploads?limit=${limit}&offset=${offset}`),

  /** Upload a file via multipart form data */
  upload: (formData: FormData) =>
    request<IndelibleUpload>('POST', '/api/v2/uploads', formData, true),

  /** Estimate upload cost by file size */
  quote: (fileSize: number) =>
    request<{ file_size: number; estimated_cost: string; note: string }>(
      'POST', '/api/v2/uploads/quote', { file_size: fileSize }),

  /** Get download URL for a completed upload */
  downloadUrl: (uuid: string) => {
    const { baseUrl, apiKey } = getConfig()
    return `${baseUrl}/api/v2/uploads/${uuid}/download?token=${encodeURIComponent(apiKey)}`
  },
}
