import { Module } from '@nestjs/common';
import { ChromectlController } from './chromectl.controller';
import { ChromectlService } from './chromectl.service';
import { ChromiumLauncher } from './chromium.launcher';

@Module({
  controllers: [ChromectlController],
  providers: [ChromectlService, ChromiumLauncher],
  exports: [ChromectlService],
})
export class ChromectlModule {}
