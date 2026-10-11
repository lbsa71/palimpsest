// Selected Pi protocol types only. Runtime model catalogue schemas are not consumed by this host.
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ModelThinkingLevel = 'off' | ThinkingLevel;
export type ModelInputModality = 'text' | 'image';
export type CacheRetention = 'none' | 'short' | 'long';
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;
export type ModelPromptCache = Partial<Record<'short' | 'long', number>>;
export interface ModelCostRates { input: number; output: number; cacheRead: number; cacheWrite: number; }
export interface ModelCostTier extends ModelCostRates { inputTokensAbove: number; }
export interface ModelCost extends ModelCostRates { tiers?: ModelCostTier[]; }
export interface ModelImageResizeOptions { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number; }
export interface ModelImageInputLimits { resize?: ModelImageResizeOptions; maxPerMessage?: number; maxPerRequest?: number; }
export interface ModelInputLimits { maxRequestBytes?: number; images?: ModelImageInputLimits; }
