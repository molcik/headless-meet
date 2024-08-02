import { Module } from '@nestjs/common';
import { ChromectlModule } from './chromectl/chromectl.module';

@Module({
  imports: [ChromectlModule],
})

export class AppModule {}
