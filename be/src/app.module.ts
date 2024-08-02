import { Module } from '@nestjs/common';
import { PuppeteerModule } from './puppeteer/puppeteer.module';
import { ConfigModule } from '@nestjs/config'


@Module({
  imports: [PuppeteerModule, ConfigModule.forRoot({isGlobal: true})],
})

export class AppModule {}
