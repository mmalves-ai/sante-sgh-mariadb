// Férias do autosserviço (M53.4, etapa F3; ficha do M53, item `Autoatendimento do colaborador (holerite, férias)`;
// `pessoas.autoatendimento.ler`, só o próprio; regra 21 do M52):
//   GET /api/pessoas/meu/ferias[?vinculo=]   períodos aquisitivos, saldo e frações programadas e calculadas do próprio vínculo
// O vínculo é o do login (outro vínculo é recusado, como no holerite); a leitura é auditada. Sem valores: o recibo com a
// memória fica no holerite e na tela do DP. Desligada a folha, só a frase de onde consultar.
import { Controller, Get, Inject, Optional, Query, Req } from '@nestjs/common';
import { esquemaFiltroMinhasFerias, EVENTOS_AUDITAVEIS, type MinhasFerias } from '@sgh/contratos';
import { escopoProprio } from '@sgh/dominio-pessoas';
import { Auditar, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from '../folha/porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from '../folha/porta-folha.js';
import { ServicoFeriasFolha } from '../folha/servico-ferias.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import { vinculosDoLogin } from './servico-meu-espaco.js';

@Controller('pessoas/meu/ferias')
export class MinhasFeriasController {
  readonly ferias: ServicoFeriasFolha;

  constructor(
    @Inject(PORTA_CALCULO_FOLHA) porta: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(PORTA_PESSOAS) readonly pessoas: PortaPessoas,
    @Inject(PORTA_PONTO) readonly ponto: PortaPonto,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.ferias = new ServicoFeriasFolha(porta, folha, rubricas, pessoas, trilha, configuracao, cache);
  }

  @Get()
  @Permissao('pessoas.autoatendimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.pessoasMinhasFeriasLidas.codigo)
  async minhas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<MinhasFerias> {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroMinhasFerias, q);
    const vs = await vinculosDoLogin(this.pessoas, this.ponto, s);
    const escopo = escopoProprio(
      vs.map((v) => ({ id: v.id, ativo: v.desligamento === null })),
      f.vinculo ?? null,
    );
    if (escopo.recusa)
      throw new ErroProblema('sem-permissao', 403, 'Só o próprio', escopo.recusa.mensagem, {
        codigo: escopo.recusa.codigo,
      });
    return this.ferias.minhas(s, escopo.vinculo);
  }
}
