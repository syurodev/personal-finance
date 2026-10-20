import { Controller, Delete, Get, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { getEnv } from '../config/env.js';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { runAsUser } from '../db/run-as-user.js';
import { InvalidAccessTokenError, McpAuthService } from './mcp-auth.service.js';
import { createMcpServer } from './mcp-server.factory.js';

function sendUnauthorized(res: Response): void {
  const metadataUrl = `${getEnv().BASE_URL}/.well-known/oauth-protected-resource/mcp`;
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`)
    .json({ error: 'invalid_token', error_description: 'Missing or invalid access token' });
}

function sendMethodNotAllowed(res: Response): void {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
}

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpAuth: McpAuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post()
  async handle(@Req() req: Request & { auth?: AuthInfo }, @Res() res: Response): Promise<void> {
    let authInfo: AuthInfo;
    try {
      authInfo = await this.mcpAuth.verify(req.headers.authorization);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        this.logger.warn(`Rejected bearer token: ${error.message}`);
        return sendUnauthorized(res);
      }
      throw error;
    }
    req.auth = authInfo;
    const rpcMethod = (req.body as { method?: unknown } | undefined)?.method;
    this.logger.log(`rpc=${typeof rpcMethod === 'string' ? rpcMethod : 'batch/unknown'} client=${authInfo.clientId}`);
    const actor = {
      userId: authInfo.extra?.userId as string,
      clientId: authInfo.clientId || null,
      scopes: authInfo.scopes,
    };

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void server.close();
    });

    try {
      await server.connect(transport);
      await runAsUser(this.db, actor, () => transport.handleRequest(req, res, req.body));
    } catch (error) {
      this.logger.error(error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  }

  // Stateless: không có SSE stream độc lập, không có session để xoá.
  @Get()
  get(@Res() res: Response): void {
    sendMethodNotAllowed(res);
  }

  @Delete()
  remove(@Res() res: Response): void {
    sendMethodNotAllowed(res);
  }
}
