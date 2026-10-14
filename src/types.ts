export interface TranslationRecord {
  contextTranslation: string | null
  createdAt: string
  pageTitle: string
  pageUrl: string
  sentence: string
  text: string
  translation: string
  translations: string[]
}

export interface TranslatePayload {
  text?: unknown
  sentence?: unknown
  pageTitle?: unknown
  pageUrl?: unknown
}

export type RuntimeMessage =
  | {type: "translate-selection"; payload: TranslatePayload}
  | {type: "translate-preview"; payload: {text?: unknown}}
  | {type: "get-transcription"; payload: {text?: unknown}}
  | {type: "get-speech-audio"; payload: {text?: unknown}}
  | {type: "get-records"}
  | {type: "clear-records"}

export interface TranslateResponse {
  ok: boolean
  translation?: string
  translations?: string[]
  contextTranslation?: string | null
  transcription?: string | null
  sourceLanguage?: "en"
  saved?: boolean
  warning?: string | null
  error?: string
}

export interface RecordsResponse {
  ok: boolean
  records?: TranslationRecord[]
  error?: string
}

export interface SpeechAudioChunk {
  audio: string
  end: number
  mimeType: string
  start: number
}

export interface SpeechAudioResponse {
  ok: boolean
  chunks?: SpeechAudioChunk[]
  error?: string
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false
  return ["translate-selection", "translate-preview", "get-transcription", "get-speech-audio", "get-records", "clear-records"]
    .includes(String(value.type))
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
