import { Injectable, Logger } from '@nestjs/common';
import * as child from 'child_process';

@Injectable()
export class ChromectlService {

  private readonly logger = new Logger(ChromectlService.name);

  async join(meetingId): Promise<string> {

    const regex = /^[a-zA-Z0-9-]+$/;
    if (!regex.test(meetingId)) throw new Error(`Meeting ID ${meetingId} can only contain letters, numbers and hyphens.`)

    const output = child.exec(`$(pwd)/src/chromectl/launch.sh ${meetingId}`, 
    // const output = child.exec(`pwd`, 
      (error, stdout, stderr) => {
      console.log(stdout);
      console.log(stderr);
      if (error !== null) {
          console.log(`exec error: ${error}`);
      }
    });

    return "Joining meeting..."

  }

  async end(): Promise<string> {
  
    const output = child.exec(`$(pwd)/src/chromectl/end.sh`, (error, stdout, stderr) => {
      console.log(stdout);
      console.log(stderr);
      if (error !== null) {
          console.log(`exec error: ${error}`);
      }
    });

    return "Shuting down meeting..."

  }


}