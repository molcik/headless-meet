import { Module } from '@nestjs/common';
import { ChromectlModule } from '../chromectl/chromectl.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [ChromectlModule],
  controllers: [McpController],
})
export class McpModule {}
