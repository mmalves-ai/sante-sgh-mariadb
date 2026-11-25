// Orçamento estatístico e indicadores orçamentários por setor (C1-129; ficha 07-FIN linha 131), na tela `Financeiro >
// Orçamento empresarial`, aba "Estatísticas e indicadores":
//   GET  /api/financeiro/orcamento/indicadores-estatisticos           grupos, dados estatísticos e indicadores
//   POST /api/financeiro/orcamento/indicadores-estatisticos           cadastrar o indicador
//   POST /api/financeiro/orcamento/indicadores-estatisticos/:id       alterar o indicador (pela versão lida)
//   GET  /api/financeiro/orcamento/versoes/:id/estatisticas?ate=      grade indicador × setor × mês e o painel
//   GET  /api/financeiro/orcamento/versoes/:id/estatisticas/projecao  projeção e realizado de uma linha nova
//   POST /api/financeiro/orcamento/versoes/:id/estatisticas           gravar a linha (indicador × setor, os meses)
// Ler: `financeiro.orcamento.ler`; gravar: `financeiro.orcamento.editar`. As gravações vão pelo Executor com a trilha
// de auditoria na mesma transação (com a porta em memória, o registrador da API registra).
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ORCAMENTO_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  type CatalogoIndicadores,
  type EventosEstatisticas,
  type GradeEstatistica,
  PORTA_ESTATISTICAS_ORCAMENTO,
  type PortaEstatisticasOrcamento,
  type ProjecaoDaLinha,
  type ResultadoLinhaEstatistica,
  ServicoEstatisticasOrcamento,
} from './estatisticas-orcamento.js';
import { PORTA_ORCAMENTO, type PortaOrcamento } from './porta.js';
import type { SessaoOrcamento } from './servico.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
const EVENTOS: EventosEstatisticas = {
  indicador: EVENTOS_AUDITAVEIS.orcamentoIndicadorGravado.codigo,
  estatistica: EVENTOS_AUDITAVEIS.orcamentoEstatisticaGravada.codigo,
};

@Controller('financeiro/orcamento')
export class EstatisticasOrcamentoController {
  readonly servico: ServicoEstatisticasOrcamento;

  constructor(
    @Inject(PORTA_ORCAMENTO) orcamento: PortaOrcamento,
    @Inject(PORTA_ESTATISTICAS_ORCAMENTO) private readonly porta: PortaEstatisticasOrcamento,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
  ) {
    this.servico = new ServicoEstatisticasOrcamento(orcamento, porta, P.editar);
  }

  private sessao(s: SessaoCadastro): SessaoOrcamento {
    const bruto = s.req.headers['idempotency-key'];
    const chave = Array.isArray(bruto) ? bruto[0] : bruto;
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      porta: s.porta,
      chaveIdempotencia:
        typeof chave === 'string' && IDEMPOTENCIA.test(chave) ? chave : `orcamento-${randomUUID()}`,
      pode: (c) => s.pode(c),
      trilha: (evento, operacao, tabela, id, chave = null) =>
        linhaTrilha(s, evento, 'financeiro.orcamento', operacao, {
          tabela,
          id: id === null ? null : String(id),
          chave: chave === null ? null : chave.slice(0, 120),
        }),
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
      correlacao: correlacaoDaRequisicao(s.req, `orcamento-${id}`).slice(0, 64),
      recurso: 'financeiro.orcamento',
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: String(id),
    });
  }

  @Get('indicadores-estatisticos')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  catalogo(@Req() req: RequisicaoAutorizada): Promise<CatalogoIndicadores> {
    return this.servico.catalogo(this.sessao(sessaoDe(req)));
  }

  @Post('indicadores-estatisticos')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação do cadastro do indicador orçamentário (código, visão e projeção)')
  async criarIndicador(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const r = await this.servico.criarIndicador(this.sessao(s), corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.indicador, r.id);
    return r;
  }

  @Post('indicadores-estatisticos/:id')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da alteração do indicador orçamentário (pela versão lida)')
  async alterarIndicador(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ versao: number }> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const r = await this.servico.alterarIndicador(this.sessao(s), n, corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.indicador, n);
    return r;
  }

  @Get('versoes/:id/estatisticas')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  grade(
    @Param('id') id: string,
    @Query('ate') ate: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<GradeEstatistica> {
    return this.servico.grade(this.sessao(sessaoDe(req)), idDaRota(id), ate);
  }

  @Get('versoes/:id/estatisticas/projecao')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  projecao(
    @Param('id') id: string,
    @Query('indicador') indicador: string,
    @Query('centro') centro: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProjecaoDaLinha> {
    return this.servico.projecao(
      this.sessao(sessaoDe(req)),
      idDaRota(id),
      idDaRota(indicador),
      idDaRota(centro),
    );
  }

  @Post('versoes/:id/estatisticas')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da gravação das quantidades orçadas do indicador no setor')
  async gravarLinha(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLinhaEstatistica> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const r = await this.servico.gravarLinha(this.sessao(s), n, corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.estatistica, n);
    return r;
  }
}
