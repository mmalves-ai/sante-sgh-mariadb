// M36: GET /api/config/homologacao — painel da homologação sobre a cópia (rodadas, conferências, triggers vistos,
// impressões do schema e a situação do pentest), lido pelas três telas de "Administração > Coexistência com o legado".
// Permissão config.coexistencia.ler; nenhuma ação: a conferência é registrada por PR (docs/operacoes/conferencias/).
import { Controller, Get, Inject } from '@nestjs/common';
import type { PainelHomologacao } from '@sgh/contratos';
import { Permissao } from '../../autorizacao/decoradores.js';
import { FONTE_HOMOLOGACAO, type FonteHomologacao } from './homologacao.js';

@Controller('config')
export class HomologacaoController {
  constructor(@Inject(FONTE_HOMOLOGACAO) private readonly fonte: FonteHomologacao) {}

  @Get('homologacao')
  @Permissao('config.coexistencia.ler')
  homologacao(): { painel: PainelHomologacao | null } {
    return { painel: this.fonte.painel() };
  }
}
