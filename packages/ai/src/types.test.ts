import { describe, expectTypeOf, it } from 'vitest';
import type { ChatRequest, ContentPart, LLMProvider } from './index';

describe('ai types', () => {
  it('T0.02 exports LLMProvider, ChatRequest and ContentPart types', () => {
    expectTypeOf<LLMProvider['id']>().toBeString();
    expectTypeOf<LLMProvider['capabilities']>().toEqualTypeOf<{
      vision: boolean;
      streaming: boolean;
      contextTokens: number;
    }>();
    expectTypeOf<LLMProvider['chat']>().returns.toEqualTypeOf<AsyncIterable<string>>();
    expectTypeOf<ChatRequest['messages'][number]['role']>().toEqualTypeOf<'user' | 'assistant'>();
    expectTypeOf<ContentPart['type']>().toEqualTypeOf<'text' | 'image'>();
    expectTypeOf<LLMProvider['status']>().returns.resolves.toHaveProperty('state');
  });
});
