import { Controller, Get, Param } from '@nestjs/common';
import { PuppeteerService } from './puppeteer.service';

@Controller('/')
export class PuppeteerController {


  constructor(
    private readonly bashService: PuppeteerService
  ) {}

    @Get('join/:meetingId')
    async join(@Param('meetingId') meetingId: string) {
      return this.bashService.join(meetingId)
    }

    @Get('end')
    async end() {
      console.log("end")
      return this.bashService.end()
    }

}
