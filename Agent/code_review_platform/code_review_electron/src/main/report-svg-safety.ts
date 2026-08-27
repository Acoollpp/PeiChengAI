import { SaxesParser } from 'saxes'

const BLOCKED_SVG_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'audio',
  'embed',
  'foreignobject',
  'iframe',
  'object',
  'script',
  'set',
  'style',
  'video'
])
const UNSAFE_SVG_VALUE_PATTERN = /(?:url\s*\(|@import|expression\s*\()/i

export const SAFE_SVG_PLACEHOLDER = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="72" viewBox="0 0 720 72"><rect width="720" height="72" fill="#f3f4f6"/><text x="24" y="44" fill="#4b5563" font-size="20">代码图片无法安全展示，已省略</text></svg>'
)

export type SvgValidationFailureCode =
  | 'INVALID_UTF8'
  | 'FORBIDDEN_XML_DECLARATION'
  | 'INVALID_XML'
  | 'ROOT_NOT_SVG'
  | 'UNSAFE_SVG_PROCESSING_INSTRUCTION'
  | 'UNSAFE_SVG_CONTENT'

type SvgValidationResult =
  | { valid: true }
  | { valid: false; reasonCode: SvgValidationFailureCode }

export type PreparedSvgForPublishing =
  | { outcome: 'ORIGINAL'; content: Buffer }
  | { outcome: 'NORMALIZED'; content: Buffer }
  | { outcome: 'PLACEHOLDER'; content: Buffer; reasonCode: SvgValidationFailureCode }

export const validateSafeSvg = (content: Buffer): SvgValidationResult => {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return { valid: false, reasonCode: 'INVALID_UTF8' }
  }
  const normalized = source.replace(/^\uFEFF/, '').trimStart()
  if (/<!DOCTYPE|<!ENTITY/i.test(normalized)) {
    return { valid: false, reasonCode: 'FORBIDDEN_XML_DECLARATION' }
  }

  let failureCode: SvgValidationFailureCode | undefined
  const reject = (reasonCode: SvgValidationFailureCode): void => {
    failureCode ??= reasonCode
  }
  let sawRoot = false
  const parser = new SaxesParser({ xmlns: true, position: false })
  parser.on('processinginstruction', () => {
    reject('UNSAFE_SVG_PROCESSING_INSTRUCTION')
  })
  parser.on('doctype', () => {
    reject('FORBIDDEN_XML_DECLARATION')
  })
  parser.on('opentag', (tag) => {
    if (!sawRoot) {
      sawRoot = true
      if (tag.local.toLowerCase() !== 'svg') {
        reject('ROOT_NOT_SVG')
      }
    }
    if (BLOCKED_SVG_ELEMENTS.has(tag.local.toLowerCase())) {
      reject('UNSAFE_SVG_CONTENT')
    }
    for (const attribute of Object.values(tag.attributes)) {
      const attributeName = attribute.local.toLowerCase()
      const value = attribute.value.trim()
      if (
        attributeName.startsWith('on') ||
        attributeName === 'base' ||
        attributeName === 'style' ||
        ((attributeName === 'href' || attributeName === 'src') && value && !value.startsWith('#')) ||
        UNSAFE_SVG_VALUE_PATTERN.test(value) ||
        value.includes('\\') ||
        value.includes('/*') ||
        value.includes('*/')
      ) {
        reject('UNSAFE_SVG_CONTENT')
      }
    }
  })

  try {
    parser.write(normalized).close()
  } catch {
    return { valid: false, reasonCode: 'INVALID_XML' }
  }
  if (failureCode) {
    return { valid: false, reasonCode: failureCode }
  }
  return sawRoot ? { valid: true } : { valid: false, reasonCode: 'ROOT_NOT_SVG' }
}

const findXmlTagEnd = (source: string, startOffset: number): number => {
  let quote: '"' | "'" | undefined
  for (let index = startOffset + 1; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) {
        quote = undefined
      }
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

const removeEmptyStyleElements = (content: Buffer): Buffer | undefined => {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return undefined
  }

  let cursor = 0
  let searchOffset = 0
  let normalized = ''
  let changed = false
  while (searchOffset < source.length) {
    const tagStart = source.indexOf('<', searchOffset)
    if (tagStart === -1) {
      break
    }
    if (source.startsWith('<![CDATA[', tagStart)) {
      const cdataEnd = source.indexOf(']]>', tagStart + 9)
      searchOffset = cdataEnd === -1 ? source.length : cdataEnd + 3
      continue
    }
    if (source.startsWith('<!--', tagStart)) {
      const commentEnd = source.indexOf('-->', tagStart + 4)
      searchOffset = commentEnd === -1 ? source.length : commentEnd + 3
      continue
    }
    if (source.startsWith('<?', tagStart)) {
      const instructionEnd = source.indexOf('?>', tagStart + 2)
      searchOffset = instructionEnd === -1 ? source.length : instructionEnd + 2
      continue
    }
    const tagEnd = findXmlTagEnd(source, tagStart)
    if (tagEnd === -1) {
      break
    }
    const tag = source.slice(tagStart, tagEnd + 1)
    if (/^<style\s*\/\s*>$/i.test(tag)) {
      normalized += source.slice(cursor, tagStart)
      cursor = tagEnd + 1
      changed = true
    } else if (/^<style\s*>$/i.test(tag)) {
      const contentStart = tagEnd + 1
      let closingStart = contentStart
      while (/\s/.test(source[closingStart] ?? '')) {
        closingStart += 1
      }
      const closingTag = /^<\/style\s*>/i.exec(source.slice(closingStart))
      if (closingTag) {
        normalized += source.slice(cursor, tagStart)
        cursor = closingStart + closingTag[0].length
        changed = true
        searchOffset = cursor
        continue
      }
    }
    searchOffset = tagEnd + 1
  }
  return changed ? Buffer.from(`${normalized}${source.slice(cursor)}`, 'utf8') : undefined
}

export const prepareSvgForPublishing = (content: Buffer): PreparedSvgForPublishing => {
  const originalValidation = validateSafeSvg(content)
  if (originalValidation.valid) {
    return { outcome: 'ORIGINAL', content }
  }

  if (originalValidation.reasonCode === 'UNSAFE_SVG_CONTENT') {
    const normalized = removeEmptyStyleElements(content)
    if (normalized && validateSafeSvg(normalized).valid) {
      return { outcome: 'NORMALIZED', content: normalized }
    }
  }

  return {
    outcome: 'PLACEHOLDER',
    content: SAFE_SVG_PLACEHOLDER,
    reasonCode: originalValidation.reasonCode
  }
}
