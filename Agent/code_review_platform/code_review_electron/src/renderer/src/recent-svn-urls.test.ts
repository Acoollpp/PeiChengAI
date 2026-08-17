// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_RECENT_SVN_URLS,
  RECENT_SVN_URLS_STORAGE_KEY,
  readRecentSvnUrls,
  rememberRecentSvnUrl
} from './recent-svn-urls'

afterEach(() => {
  localStorage.clear()
})

describe('recent-svn-urls', () => {
  it('记录新地址时置顶保存并返回最新列表', () => {
    localStorage.setItem(RECENT_SVN_URLS_STORAGE_KEY, JSON.stringify(['svn://a', 'svn://b']))

    const next = rememberRecentSvnUrl('svn://c')

    expect(next).toEqual(['svn://c', 'svn://a', 'svn://b'])
    expect(readRecentSvnUrls()).toEqual(['svn://c', 'svn://a', 'svn://b'])
  })

  it('重复提交同一地址时去重并置顶，不产生重复项', () => {
    localStorage.setItem(RECENT_SVN_URLS_STORAGE_KEY, JSON.stringify(['svn://a', 'svn://b', 'svn://c']))

    const next = rememberRecentSvnUrl('svn://b')

    expect(next).toEqual(['svn://b', 'svn://a', 'svn://c'])
  })

  it('只保留最近 3 条地址', () => {
    localStorage.setItem(
      RECENT_SVN_URLS_STORAGE_KEY,
      JSON.stringify(['svn://a', 'svn://b', 'svn://c'])
    )

    const next = rememberRecentSvnUrl('svn://d')

    // 新地址置顶，依次保留次新的 a、b，最旧的 c 被淘汰。
    expect(next).toEqual(['svn://d', 'svn://a', 'svn://b'])
    expect(next).toHaveLength(MAX_RECENT_SVN_URLS)
  })

  it('空地址不写入也不丢失既有历史', () => {
    localStorage.setItem(RECENT_SVN_URLS_STORAGE_KEY, JSON.stringify(['svn://a']))

    expect(rememberRecentSvnUrl('')).toEqual(['svn://a'])
  })

  it('存储内容损坏时读取降级为空列表', () => {
    localStorage.setItem(RECENT_SVN_URLS_STORAGE_KEY, '{not-json')

    expect(readRecentSvnUrls()).toEqual([])
  })

  it('过滤非字符串元素并截断到最多 3 条', () => {
    localStorage.setItem(
      RECENT_SVN_URLS_STORAGE_KEY,
      JSON.stringify(['svn://a', 42, null, 'svn://b', 'svn://c', 'svn://d'])
    )

    expect(readRecentSvnUrls()).toEqual(['svn://a', 'svn://b', 'svn://c'])
  })
})
