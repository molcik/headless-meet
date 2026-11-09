import { Module } from '@nestjs/common';
import { ChromectlModule } from './chromectl/chromectl.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [ChromectlModule, McpModule],
})
export class AppModule {}
