import { Controller, Get, Param } from '@nestjs/common';
import { ChromectlService } from './chromectl.service';

@Controller('/api')
export class ChromectlController {


  constructor(
    private readonly bashService: ChromectlService
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
