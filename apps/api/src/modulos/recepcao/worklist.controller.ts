// Fila da recepção na página inicial (M27; ficha, seções 4 e 7; regra 5):
//   GET /api/recepcao/worklist?recepcao   as senhas na fila pela prioridade legal, as chegadas do dia e as guias
//                                         aguardando autorização (auditado: lista com nomes de pacientes)
//   GET /api/recepcao/worklist/eventos    canal de eventos (text/event-stream): a senha emitida ou chamada aqui ou na
//                                         outra ponta (o vigia de 1 a 2 s do M19); só diz "mudou", a tela relê
// A chave `inicio.worklistRecepcao` (liberação das funcionalidades): desligada, 403 `recurso-desligado`. Só leitura: chamar,
// registrar a chegada e abrir o atendimento são as telas do M19 e do M20.
import { Controller, Get, Inject, Optional, Query, Req, Res } from '@nestjs/common';
import { CHAVES_INICIO, EVENTOS_AUDITAVEIS, PERMISSOES_INICIO, type WorklistRecepcao } from '@sgh/contratos';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  AVISOS_ATENDIMENTO,
  type AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from '../atendimento/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import { PORTA_AGENDA, type PortaAgenda } from '../agenda/public-api.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { inteiroOuNulo } from '../exames/public-api.js';
import { LiberacaoPep } from '../pep/public-api.js';
import { type PortaGuias, ServicoWorklistRecepcao } from './aplicacao/worklist-recepcao.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';

export const PORTA_GUIAS = Symbol('PORTA_GUIAS');

@Controller('recepcao/worklist')
export class WorklistRecepcaoController {
  readonly servico: ServicoWorklistRecepcao;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(PORTA_RECEPCAO) recepcao: PortaRecepcao,
    @Inject(PORTA_GUIAS) guias: PortaGuias,
    @Optional() @Inject(PORTA_AGENDA) agenda: PortaAgenda | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(AVISOS_ATENDIMENTO) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
  ) {
    this.servico = new ServicoWorklistRecepcao(recepcao, agenda, guias);
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  @Get('eventos')
  @Permissao(PERMISSOES_INICIO.worklistRecepcaoLer)
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      PERMISSOES_INICIO.worklistRecepcaoLer,
      this.resolvedor,
      this.batidaMs,
    );
  }

  @Get()
  @Permissao(PERMISSOES_INICIO.worklistRecepcaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.inicioWorklistRecepcaoLida.codigo)
  async fila(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<WorklistRecepcao> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.recepcao);
    const r = await this.servico
      .fila(s.porta, { recepcao: inteiroOuNulo(q['recepcao']) })
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    req.sghAlvo = {
      tabelaAlvo: 'TBSENHAATEND',
      chaveNaturalAlvo: `worklist-recepcao;senhas:${r.senhas.length};guias:${r.guias.length}`,
    };
    return r;
  }
}
