import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ChromectlService, QueueTimeoutError } from './chromectl.service';
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
      throw toBusyOrSame(error);
    }
    return 'Joining meeting...';
  }

  @Get('end')
  async end() {
    try {
      await this.chromectlService.leave({});
    } catch (error) {
      throw toBusyOrSame(error);
    }
    return 'Shuting down meeting...';
  }
}

function toBusyOrSame(error: unknown): unknown {
  return error instanceof QueueTimeoutError
    ? new ServiceUnavailableException(error.message)
    : error;
}
