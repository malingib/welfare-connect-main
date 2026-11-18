/// <reference lib="deno.window" />

export interface ParsedReference {
  memberNumber: string | null
  caseNumber: string | null
  phoneNumber: string | null
  format: 'member_only' | 'case_only' | 'member_and_case' | 'phone_and_member' | 'unknown'
  raw: string
}

/**
 * Parses M-Pesa BillRefNumber into structured components.
 * 
 * Supported formats:
 * - "45" or "M045" → member only
 * - "C045" → case only
 * - "45#C045" or "M045#C045" → member AND case (anyone can pay for any member's case)
 * - "079970#M299" or "079970#299" → phone AND member (legacy format)
 * - "#C045" → case only (hash prefix)
 * - "893#" → member only (hash suffix)
 */
export function parseBillReference(raw: string): ParsedReference {
  const trimmed = raw.trim()
  
  if (!trimmed) {
    return { memberNumber: null, caseNumber: null, phoneNumber: null, format: 'unknown', raw }
  }
  
  // Handle edge cases with leading/trailing hash
  if (trimmed.startsWith('#') && !trimmed.includes('#', 1)) {
    const afterHash = trimmed.substring(1).trim()
    const upper = afterHash.toUpperCase()
    if (/^C\d+$/i.test(upper)) {
      return { memberNumber: null, caseNumber: upper, phoneNumber: null, format: 'case_only', raw }
    }
    const num = upper.replace(/^M/i, '')
    if (/^\d+$/.test(num)) {
      return { memberNumber: num, caseNumber: null, phoneNumber: null, format: 'member_only', raw }
    }
  }
  
  if (trimmed.endsWith('#') && trimmed.indexOf('#') === trimmed.length - 1) {
    const beforeHash = trimmed.substring(0, trimmed.length - 1).trim()
    const num = beforeHash.replace(/^M/i, '')
    if (/^\d+$/.test(num)) {
      return { memberNumber: num, caseNumber: null, phoneNumber: null, format: 'member_only', raw }
    }
  }
  
  // No hash separator - single value
  if (!trimmed.includes('#')) {
    const upper = trimmed.toUpperCase()
    if (/^C\d+$/i.test(upper)) {
      return { memberNumber: null, caseNumber: upper, phoneNumber: null, format: 'case_only', raw }
    }
    const num = upper.replace(/^M/i, '')
    if (/^\d+$/.test(num)) {
      return { memberNumber: num, caseNumber: null, phoneNumber: null, format: 'member_only', raw }
    }
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length >= 9 && digits.length <= 13) {
      return { memberNumber: null, caseNumber: null, phoneNumber: trimmed, format: 'unknown', raw }
    }
    return { memberNumber: null, caseNumber: null, phoneNumber: null, format: 'unknown', raw }
  }
  
  // Has hash separator - compound reference
  const parts = trimmed.split('#').map(p => p.trim()).filter(Boolean)
  
  if (parts.length === 2) {
    const [left, right] = parts
    const leftUpper = left.toUpperCase()
    const rightUpper = right.toUpperCase()
    
    const isCase = (s: string) => /^C\d+$/i.test(s)
    const isMemberNum = (s: string) => {
      const stripped = s.replace(/^M/i, '')
      return /^\d+$/.test(stripped)
    }
    const isPhone = (s: string) => {
      const digits = s.replace(/\D/g, '')
      return digits.length >= 9 && digits.length <= 13
    }
    const extractMemberNum = (s: string) => s.replace(/^M/i, '')
    
    // Pattern: Member#Case (e.g., M004#C001 or 45#C045)
    if (isMemberNum(leftUpper) && isCase(rightUpper)) {
      return {
        memberNumber: extractMemberNum(leftUpper),
        caseNumber: rightUpper,
        phoneNumber: null,
        format: 'member_and_case',
        raw
      }
    }
    
    // Pattern: Case#Member (e.g., C001#M004) - reverse order
    if (isCase(leftUpper) && isMemberNum(rightUpper)) {
      return {
        memberNumber: extractMemberNum(rightUpper),
        caseNumber: leftUpper,
        phoneNumber: null,
        format: 'member_and_case',
        raw
      }
    }
    
    // Pattern: Phone#Member (e.g., 079970#M299)
    if (isPhone(left) && isMemberNum(rightUpper)) {
      return {
        memberNumber: extractMemberNum(rightUpper),
        caseNumber: null,
        phoneNumber: left,
        format: 'phone_and_member',
        raw
      }
    }
    
    // Pattern: Member#Phone (e.g., M299#079970) - reverse order
    if (isMemberNum(leftUpper) && isPhone(right)) {
      return {
        memberNumber: extractMemberNum(leftUpper),
        caseNumber: null,
        phoneNumber: right,
        format: 'phone_and_member',
        raw
      }
    }
  }
  
  return { memberNumber: null, caseNumber: null, phoneNumber: null, format: 'unknown', raw }
}

/**
 * Validates reference format and extracts digits properly
 * Enhanced algorithm to handle various edge cases
 */
export function validateAndNormalizeReference(raw: string): { isValid: boolean; normalized: string; error?: string } {
  if (!raw || typeof raw !== 'string') {
    return { isValid: false, normalized: '', error: 'Reference cannot be empty' }
  }
  
  const trimmed = raw.trim()
  
  if (!trimmed) {
    return { isValid: false, normalized: '', error: 'Reference cannot be empty or whitespace' }
  }
  
  // Basic format validation
  const validFormats = [
    /^[0-9]+$/,                    // Simple number
    /^M[0-9]+$/,                   // M followed by number
    /^C[0-9]+$/i,                  // C followed by number (case insensitive)
    /^[0-9]+#[0-9]+$/,             // Number#Number
    /^M[0-9]+#[0-9]+$/,            // MNumber#Number
    /^[0-9]+#C[0-9]+$/i,          // Number#CNumber
    /^M[0-9]+#C[0-9]+$/i,         // MNumber#CNumber
    /^C[0-9]+#[0-9]+$/i,          // CNumber#Number
    /^C[0-9]+#M[0-9]+$/i,         // CNumber#MNumber
    /^[0-9]+#M[0-9]+$/,           // Number#MNumber
    /^[0-9]+#[0-9]+#C[0-9]+$/i,   // Number#Number#CNumber (extended format)
    /^[0-9]{9,13}$/,              // Phone number (9-13 digits)
    /^#[0-9]+$/,                  // #Number
    /^#[0-9]+#C[0-9]+$/i,         // #Number#CNumber
    /^[0-9]+#$/,                  // Number#
  ]
  
  const isValidFormat = validFormats.some(regex => regex.test(trimmed))
  
  if (!isValidFormat) {
    return { 
      isValid: false, 
      normalized: '', 
      error: 'Invalid reference format. Supported formats: 45, M045, C045, 45#C045, 079970#M299, etc.' 
    }
  }
  
  // Normalize by removing extra whitespace and standardizing format
  const normalized = trimmed
    .replace(/\s+/g, '') // Remove all whitespace
    .toUpperCase()      // Convert to uppercase for consistency
  
  return { isValid: true, normalized }
}

/**
 * Enhanced reference parser with validation
 */
export function parseAndValidateBillReference(raw: string): ParsedReference & { isValid: boolean; error?: string } {
  const validation = validateAndNormalizeReference(raw)
  
  if (!validation.isValid) {
    return {
      memberNumber: null,
      caseNumber: null,
      phoneNumber: null,
      format: 'unknown',
      raw,
      isValid: false,
      error: validation.error
    }
  }
  
  const parsed = parseBillReference(validation.normalized)
  return {
    ...parsed,
    isValid: true
  }
}
