import { Module, Logger } from '@nestjs/common';
import { ChromectlController } from './chromectl.controller';
import { ChromectlService } from './chromectl.service';

@Module({
  controllers: [ChromectlController],
  providers: [ChromectlService],
  exports: [ChromectlService]
})

export class ChromectlModule {}
