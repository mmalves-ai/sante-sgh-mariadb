// "Meu espaço" (M52.6; ficha do M52, seção 7; `Gestão de pessoas > Autoatendimento do colaborador`;
// `pessoas.autoatendimento.ler`, só o próprio; regra 21):
//   GET  /api/pessoas/meu[?vinculo=]          o próprio espaço (o vínculo do login; outro vínculo é recusado)
//   POST /api/pessoas/meu/pops/:id/ciencia    a ciência da versão vigente do POP (`pessoas.pop.ciencia`)
// A leitura é auditada (dado pessoal do próprio colaborador); a ciência vai com a trilha na transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaCienciaPop,
  esquemaMeuEspaco,
  EVENTOS_AUDITAVEIS,
  type MeuEspaco,
  type ResultadoF6,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_ESCALA, type PortaEscala } from '../escala/porta-escala.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_SESMT, type PortaSesmt } from '../sesmt/porta-sesmt.js';
import { PORTA_TREINAMENTO, type PortaTreinamento } from '../treinamento/porta-treinamento.js';
import { ServicoTreinamento } from '../treinamento/servico-treinamento.js';
import { ServicoMeuEspaco } from './servico-meu-espaco.js';

@Controller('pessoas/meu')
export class MeuEspacoController {
  readonly servico: ServicoMeuEspaco;
  readonly treinamento: ServicoTreinamento;

  constructor(
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(PORTA_PONTO) ponto: PortaPonto,
    @Inject(PORTA_ESCALA) escala: PortaEscala,
    @Inject(PORTA_SESMT) sesmt: PortaSesmt,
    @Inject(PORTA_TREINAMENTO) treinamento: PortaTreinamento,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.treinamento = new ServicoTreinamento(treinamento, pessoas, trilha, configuracao, cache);
    this.servico = new ServicoMeuEspaco(
      pessoas,
      ponto,
      escala,
      sesmt,
      this.treinamento,
      trilha,
      configuracao,
      cache,
    );
  }

  @Get()
  @Permissao('pessoas.autoatendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.pessoasAutoatendimentoLido.codigo)
  meu(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<MeuEspaco> {
    const f = corpo(esquemaMeuEspaco, q);
    return this.servico.meuEspaco(sessaoDe(req), f.vinculo ?? null);
  }

  @Post('pops/:id/ciencia')
  @HttpCode(200)
  @Permissao('pessoas.pop.ciencia')
  @AuditadoNoHandler('SGH_PES_POP_CIENCIA com a SGH_TRILHA na mesma transação')
  async ciencia(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoF6> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCienciaPop, { ...(b as object), pop: idDaRota(id) });
    const proprios = (await this.servico.vinculosDoLogin(s)).map((v) => v.id);
    return this.treinamento.ciencia(s, e, proprios);
  }
}
