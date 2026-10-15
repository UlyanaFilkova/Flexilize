export interface TranslationRecord {
  contextTranslation: string | null
  createdAt: string
  pageTitle: string
  pageUrl: string
  sentence: string
  sourceLanguage: string
  text: string
  transcription: string | null
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
  | {type: "translate-preview"; payload: {sentence?: unknown; text?: unknown}}
  | {type: "detect-language"; payload: {sentence?: unknown; text?: unknown}}
  | {type: "get-transcription"; payload: {language?: unknown; text?: unknown}}
  | {type: "get-speech-audio"; payload: {language?: unknown; text?: unknown}}
  | {type: "get-records"}
  | {type: "delete-record"; payload: {createdAt?: unknown; sentence?: unknown; text?: unknown}}
  | {type: "restore-record"; payload: {index?: unknown; record?: unknown}}
  | {type: "clear-and-save-record"; payload: {record?: unknown}}
  | {type: "clear-records"}

export interface TranslateResponse {
  ok: boolean
  translation?: string
  translations?: string[]
  contextTranslation?: string | null
  transcription?: string | null
  sourceLanguage?: string
  saved?: boolean
  storageLimitReached?: boolean
  pendingRecord?: TranslationRecord
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
  return ["translate-selection", "translate-preview", "detect-language", "get-transcription", "get-speech-audio", "get-records", "delete-record", "restore-record", "clear-and-save-record", "clear-records"]
    .includes(String(value.type))
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
