// Estrutura de custos e estatísticas (M54, etapa 4; ficha, seção 7 "Centros de custo e rateio") — a tela
// `Controladoria > Custos hospitalares > Centros de custo e critérios de rateio` (`/custos/centros`):
//   GET  /api/custos/apoio                         classes, catálogo das estatísticas, domínios e as ações permitidas
//   GET  /api/custos/centros                       a estrutura (centros, pendências, contagem e sequência do rateio)
//   POST /api/custos/centros/:id                   classificar ou reclassificar um centro (pela versão lida)
//   GET  /api/custos/estatisticas?competencia      a matriz centro × estatística da competência, com a última coleta
//   POST /api/custos/estatisticas/coleta           coletar a competência das fontes do banco
//   POST /api/custos/estatisticas/lancamentos      lançar uma estatística à mão
// Ler: `custos.centro.ler`; classificar: `custos.centro.editar`; coletar e lançar: `custos.estatistica.registrar`. As
// gravações exigem a chave `custos` no estabelecimento (POL-3) e vão com a SGH_TRILHA na mesma transação (com a porta
// em memória, o registrador da API registra).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioCustos,
  type CentroCustoEstrutura,
  type ColetaEstatisticas,
  esquemaClassificarCentro,
  esquemaColetarEstatisticas,
  esquemaConsultaEstatisticas,
  esquemaLancarEstatistica,
  EVENTOS_AUDITAVEIS,
  type ListaEstruturaCustos,
  type MatrizEstatisticas,
  PERMISSOES_CUSTOS_CODIGOS as P,
  type ValorEstatistica,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import { PORTA_CUSTOS, type PortaCustos } from './porta.js';
import { ServicoCustos, type SessaoCustos } from './servico.js';

/** Chave de liberação dos custos hospitalares (ficha do M54, seção 12). */
export const CHAVE_LIBERACAO_CUSTOS = 'custos';

function invalido(erro: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ErroProblema {
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    erro.issues[0]?.message ?? 'Confira os campos.',
    {
      campos: [...new Set(erro.issues.map((i) => i.path.map(String).join('.')))],
    },
  );
}

/** Hoje no relógio do estabelecimento (a coleta recusa a competência futura). */
function hojeNoEstabelecimento(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

@Controller('custos')
export class CustosController {
  readonly servico: ServicoCustos;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(PORTA_CUSTOS) private readonly porta: PortaCustos,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoCustos(porta);
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  private sessao(s: SessaoCadastro): SessaoCustos {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      pode: (c) => s.pode(c),
      trilha: (evento, operacao, tabela, id) =>
        linhaTrilha(s, evento, 'custos.centro', operacao, { tabela, id: id === null ? null : String(id) }),
    };
  }

  /** Com a porta em memória, a trilha da gravação é a do registrador da API (no núcleo, vai na transação). */
  private async trilhaMemoria(s: SessaoCadastro, evento: string, id: number): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    await this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, `custos-${id}`).slice(0, 64),
      recurso: 'custos.centro',
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: String(id),
    });
  }

  @Get('apoio')
  @Permissao(P.centroLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosEstruturaLida.codigo)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioCustos> {
    const s = sessaoDe(req);
    const l = await this.liberacao.consultar(s, CHAVE_LIBERACAO_CUSTOS);
    return this.servico.apoio(
      this.sessao(s),
      { editar: P.centroEditar, registrar: P.estatisticaRegistrar },
      l.ligada,
    );
  }

  @Get('centros')
  @Permissao(P.centroLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosEstruturaLida.codigo)
  async centros(@Req() req: RequisicaoAutorizada): Promise<ListaEstruturaCustos> {
    return this.servico.estrutura(this.sessao(sessaoDe(req)));
  }

  @Post('centros/:id')
  @HttpCode(200)
  @Permissao(P.centroEditar)
  @AuditadoNoHandler('SGH_TRILHA na transação SGH_ da classificação do centro (antes e depois)')
  async classificar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ centro: CentroCustoEstrutura; mudou: boolean }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_CUSTOS);
    const n = idDaRota(id);
    const d = esquemaClassificarCentro.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.classificar(this.sessao(s), n, d.data);
    if (r.mudou) await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.custosCentroClassificado.codigo, n);
    return r;
  }

  @Get('estatisticas')
  @Permissao(P.centroLer)
  @Auditar(EVENTOS_AUDITAVEIS.custosEstatisticasLidas.codigo)
  async estatisticas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MatrizEstatisticas> {
    const c = esquemaConsultaEstatisticas.safeParse(q);
    if (!c.success) throw invalido(c.error);
    return this.servico.matriz(this.sessao(sessaoDe(req)), c.data.competencia);
  }

  @Post('estatisticas/coleta')
  @HttpCode(201)
  @Permissao(P.estatisticaRegistrar)
  @AuditadoNoHandler('SGH_TRILHA na transação SGH_ da coleta (só contagens por fonte)')
  async coletar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ColetaEstatisticas> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_CUSTOS);
    const d = esquemaColetarEstatisticas.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.coletar(this.sessao(s), d.data.competencia, hojeNoEstabelecimento());
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.custosEstatisticasColetadas.codigo, r.id);
    return r;
  }

  @Post('estatisticas/lancamentos')
  @HttpCode(201)
  @Permissao(P.estatisticaRegistrar)
  @AuditadoNoHandler('SGH_TRILHA na transação SGH_ do lançamento manual')
  async lancar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ valor: ValorEstatistica; substituidas: number }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_CUSTOS);
    const d = esquemaLancarEstatistica.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.lancar(this.sessao(s), d.data);
    await this.trilhaMemoria(s, EVENTOS_AUDITAVEIS.custosEstatisticaLancada.codigo, r.valor.id);
    return r;
  }
}
