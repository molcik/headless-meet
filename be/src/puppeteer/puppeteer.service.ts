import { Injectable, Logger } from '@nestjs/common';
import * as child from 'child_process';


@Injectable()
export class PuppeteerService {

  private readonly logger = new Logger(PuppeteerService.name);

  async join(meetingId): Promise<string> {

    const regex = /^[a-zA-Z0-9-]+$/;
    if (!regex.test(meetingId)) throw new Error(`Meeting ID ${meetingId} can only contain letters, numbers and hyphens.`)

    const output = child.exec(`./src/puppeteer/launch.sh ${meetingId}`, (error, stdout, stderr) => {
      console.log(stdout);
      console.log(stderr);
      if (error !== null) {
          console.log(`exec error: ${error}`);
      }
    });

    return "Joining meeting..."

  }

  async end(): Promise<string> {
  
    const output = child.exec(`./src/puppeteer/end.sh`, (error, stdout, stderr) => {
      console.log(stdout);
      console.log(stderr);
      if (error !== null) {
          console.log(`exec error: ${error}`);
      }
    });

    return "Shuting down meeting..."

  }


}