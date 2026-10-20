import { protectedResourceMetadata } from './protected-resource.js';

describe('protectedResourceMetadata', () => {
  it('points the MCP resource at the better-auth issuer', () => {
    expect(protectedResourceMetadata('https://fin.example.com')).toEqual({
      resource: 'https://fin.example.com/mcp',
      authorization_servers: ['https://fin.example.com/api/auth'],
      scopes_supported: ['offline_access', 'finance:read', 'finance:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Personal Finance',
    });
  });
});
