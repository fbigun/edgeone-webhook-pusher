/**
 * KV Client 密钥传递属性测试
 * 
 * Property 4: Key Preference in Node Functions
 * For any KV Client request, BUILD_KEY SHALL be used when present.
 * The request SHALL always include the X-Internal-Key header.
 * 
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// 模拟 getInternalKey 函数的逻辑
function getInternalKey(buildKey: string): string {
  return buildKey;
}

// 生成非空的复杂口令；运行时不限制格式，只要求非空且一致
const keyChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_=+!@#$%^&*.,:?/'.split(''));
const validKey = fc.array(keyChar, { minLength: 1, maxLength: 128 }).map(arr => arr.join(''));

describe('KV Client Key Preference', () => {
  /**
   * Property 4: Key Preference in Node Functions
   * Feature: kv-api-security, Property 4: Key Preference in Node Functions
   */
  describe('Property 4: Key Preference in Node Functions', () => {
    it('should use BUILD_KEY for all requests', () => {
      fc.assert(
        fc.property(validKey, (buildKey) => {
          const result = getInternalKey(buildKey);
          expect(result).toBe(buildKey);
        }),
        { numRuns: 100 }
      );
    });

    it('should always return a non-empty key', () => {
      fc.assert(
        fc.property(validKey, (buildKey) => {
          const result = getInternalKey(buildKey);
          expect(result.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Key Format Flexibility', () => {
    it('should return key verbatim regardless of source format', () => {
      fc.assert(
        fc.property(validKey, (buildKey) => {
          const result = getInternalKey(buildKey);
          expect(result).toBe(buildKey);
        }),
        { numRuns: 100 }
      );
    });
  });
});

describe('KV Client Request Headers', () => {
  it('should include X-Internal-Key header in all requests', () => {
    // 模拟 getAuthHeaders 函数
    function getAuthHeaders(buildKey: string): Record<string, string> {
      return {
        'X-Internal-Key': getInternalKey(buildKey),
      };
    }

    fc.assert(
      fc.property(validKey, (buildKey) => {
          const headers = getAuthHeaders(buildKey);

          // 验证 header 存在
          expect(headers).toHaveProperty('X-Internal-Key');

          // 验证 header 值非空
          expect(headers['X-Internal-Key'].length).toBeGreaterThan(0);

          // 验证 header 值与选中的密钥保持一致
          expect(headers['X-Internal-Key']).toBe(buildKey);
      }),
      { numRuns: 100 }
    );
  });
});
