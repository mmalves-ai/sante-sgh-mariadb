import { Injectable } from '@nestjs/common';
import type { Versao } from '@sgh/contratos';
import { dadosDoBuild, montarVersao } from './versao.js';

@Injectable()
export class VersaoService {
  private readonly dados = dadosDoBuild();

  atual(produto: string): Versao {
    return montarVersao(produto, this.dados);
  }
}
