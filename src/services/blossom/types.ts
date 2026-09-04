export interface BlossomServer {
  url: string;
  name?: string;
  /** Health status from periodic checks */
  healthy: boolean;
  /** Last successful health check timestamp */
  lastCheckAt: number | null;
  /** Average response latency in ms */
  avgLatencyMs: number | null;
  /** Whether this server is in the user's allowlist */
  trusted: boolean;
  /** Source: hardcoded fallback, kind:10063, or user-added */
  source: 'fallback' | 'user-list' | 'custom';
}

export interface BlossomUploadResult {
  sha256: string;
  size: number;
  type: string | null;
  url: string;
  server: string;
}

export type BlossomStoreResult = BlossomUploadResult;

export interface BlossomUploadOptions {
  /** MIME type of the blob */
  contentType?: string;
  /** Specific server URL to use; otherwise picks the healthiest */
  server?: string;
  /** Skip NIP-42 auth (only for public/anonymous servers) */
  noAuth?: boolean;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Timeout in ms (default 60s) */
  timeoutMs?: number;
}

export interface BlossomDownloadOptions {
  /** Preferred server URL */
  server?: string;
  /** Try multiple servers in order until one works */
  fallbackServers?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface BlossomHealthCheck {
  server: string;
  healthy: boolean;
  latencyMs: number | null;
  error?: string;
}
