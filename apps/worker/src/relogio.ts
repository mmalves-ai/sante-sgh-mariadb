import { Injectable } from '@nestjs/common';

@Injectable()
export class Relogio {
  agora(): Date {
    return new Date();
  }
}
