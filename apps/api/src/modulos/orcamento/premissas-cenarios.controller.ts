// Premissas e cenários do orçamento empresarial (C1-125; ficha 07-FIN linha 129), na tela `Financeiro > Orçamento
// empresarial` (aba Cenários e bloco Premissas e cenário da versão aberta):
//   GET  /api/financeiro/orcamento/cenarios                                  os cenários (ativos e inativos)
//   POST /api/financeiro/orcamento/cenarios                                  cadastrar o cenário
//   POST /api/financeiro/orcamento/cenarios/:id                              alterar o cenário (pela versão lida)
//   GET  /api/financeiro/orcamento/versoes/:id/premissas                     premissas, cenário e projeção da versão
//   POST /api/financeiro/orcamento/versoes/:id/premissas                     incluir a premissa
//   POST /api/financeiro/orcamento/versoes/:id/premissas/:premissa           alterar a premissa (pela versão lida)
//   POST /api/financeiro/orcamento/versoes/:id/premissas/:premissa/retirada  retirar a premissa (lógica)
//   POST /api/financeiro/orcamento/versoes/:id/cenario                       escolher o cenário da versão
// Ler: `financeiro.orcamento.ler`; gravar: `financeiro.orcamento.editar`. As gravações vão pelo Executor com a trilha
// de auditoria na mesma transação (com a porta em memória, o registrador da API registra).
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_ORCAMENTO_CODIGOS as P } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_ORCAMENTO, type PortaOrcamento } from './porta.js';
import {
  type CenarioOrcamentoVisao,
  type EventosPremissas,
  PORTA_PREMISSAS_ORCAMENTO,
  type PortaPremissasOrcamento,
  type PremissasDaVersao,
  ServicoPremissasOrcamento,
} from './premissas-cenarios.js';
import type { SessaoOrcamento } from './servico.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
const EVENTOS: EventosPremissas = {
  premissa: EVENTOS_AUDITAVEIS.orcamentoPremissaGravada.codigo,
  cenario: EVENTOS_AUDITAVEIS.orcamentoCenarioGravado.codigo,
};

@Controller('financeiro/orcamento')
export class PremissasCenariosOrcamentoController {
  readonly servico: ServicoPremissasOrcamento;

  constructor(
    @Inject(PORTA_ORCAMENTO) orcamento: PortaOrcamento,
    @Inject(PORTA_PREMISSAS_ORCAMENTO) private readonly porta: PortaPremissasOrcamento,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
  ) {
    this.servico = new ServicoPremissasOrcamento(orcamento, porta, P.editar);
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

  @Get('cenarios')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  async cenarios(@Req() req: RequisicaoAutorizada): Promise<{ cenarios: CenarioOrcamentoVisao[] }> {
    return { cenarios: await this.servico.cenarios(this.sessao(sessaoDe(req))) };
  }

  @Post('cenarios')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação do cadastro do cenário (código, tendência e ajuste)')
  async criarCenario(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const r = await this.servico.criarCenario(this.sessao(s), corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.cenario, r.id);
    return r;
  }

  @Post('cenarios/:id')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da alteração do cenário (pela versão lida)')
  async alterarCenario(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ versao: number }> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const r = await this.servico.alterarCenario(this.sessao(s), n, corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.cenario, n);
    return r;
  }

  @Get('versoes/:id/premissas')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  async premissas(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<PremissasDaVersao> {
    return this.servico.daVersao(this.sessao(sessaoDe(req)), idDaRota(id));
  }

  @Post('versoes/:id/premissas')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da inclusão da premissa (tipo e valor)')
  async incluirPremissa(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; sequencia: number }> {
    const s = sessaoDe(req);
    const r = await this.servico.incluirPremissa(this.sessao(s), idDaRota(id), corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.premissa, r.id);
    return r;
  }

  @Post('versoes/:id/premissas/:premissa')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da alteração da premissa (pela versão lida)')
  async alterarPremissa(
    @Param('id') id: string,
    @Param('premissa') premissa: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ versao: number }> {
    const s = sessaoDe(req);
    const p = idDaRota(premissa);
    const r = await this.servico.alterarPremissa(this.sessao(s), idDaRota(id), p, corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.premissa, p);
    return r;
  }

  @Post('versoes/:id/premissas/:premissa/retirada')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da retirada lógica da premissa')
  async retirarPremissa(
    @Param('id') id: string,
    @Param('premissa') premissa: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ retirada: true }> {
    const s = sessaoDe(req);
    const p = idDaRota(premissa);
    await this.servico.retirarPremissa(this.sessao(s), idDaRota(id), p, corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.premissa, p);
    return { retirada: true };
  }

  @Post('versoes/:id/cenario')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da escolha do cenário da versão')
  async escolherCenario(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ versao: number }> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const r = await this.servico.escolherCenario(this.sessao(s), n, corpo, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.cenario, n);
    return r;
  }
}
