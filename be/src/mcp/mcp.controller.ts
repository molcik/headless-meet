import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import './webcrypto.polyfill';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { ChromectlService } from '../chromectl/chromectl.service';
import { GUIDE_PATH } from '../paths';
import { buildMcpServer } from './mcp.tools';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly chromectlService: ChromectlService) {}

  // Stateless Streamable HTTP: one server and one transport per request,
  // so request IDs of different clients never collide.
  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const server = buildMcpServer(this.chromectlService);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(`MCP request failed: ${error?.message ?? error}`);
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
      }
    }
  }

  @Get()
  @HttpCode(405)
  get() {
    return jsonRpcError(-32000, 'Method not allowed.');
  }

  @Delete()
  @HttpCode(405)
  delete() {
    return jsonRpcError(-32000, 'Method not allowed.');
  }

  // Read at each request: a missing guide never stops the backend.
  @Get('guide')
  async guide(@Res() res: Response) {
    try {
      const guide = await readFile(GUIDE_PATH, 'utf8');
      res.type('text/plain; charset=utf-8').send(guide);
    } catch (error) {
      this.logger.error(`Cannot read the guide: ${error?.message ?? error}`);
      res
        .status(500)
        .type('text/plain; charset=utf-8')
        .send('Guide not found.');
    }
  }
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
