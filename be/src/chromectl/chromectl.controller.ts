import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { ChromectlService } from './chromectl.service';
import { InvalidMeetingError } from './meeting-code';

@Controller('/api')
export class ChromectlController {
  constructor(private readonly chromectlService: ChromectlService) {}

  // The web UI always switches the camera, as it did before the MCP server.
  @Get('join/:meetingId')
  async join(@Param('meetingId') meetingId: string) {
    try {
      await this.chromectlService.join({
        meeting: meetingId,
        force: true,
        startedBy: null,
        source: 'web',
      });
    } catch (error) {
      if (error instanceof InvalidMeetingError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return 'Joining meeting...';
  }

  @Get('end')
  async end() {
    await this.chromectlService.leave({});
    return 'Shuting down meeting...';
  }
}
