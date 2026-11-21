// Orçamento empresarial (M54, etapa 7; ficha, seção 7 "Orçamento empresarial") — a tela `Financeiro > Orçamento
// empresarial` (`/financeiro/orcamento`):
//   GET  /api/financeiro/orcamento/apoio                      naturezas, centros, itens gerenciais, parâmetros e ações
//   GET  /api/financeiro/orcamento/versoes?ano                as versões (mais novas primeiro), com os totais
//   POST /api/financeiro/orcamento/versoes                    criar a versão (vazia, cópia ou do realizado anterior)
//   GET  /api/financeiro/orcamento/versoes/:id                a versão com as linhas e o que a pessoa pode fazer
//   POST /api/financeiro/orcamento/versoes/:id/linhas         gravar os valores do rascunho (pela versão lida)
//   POST /api/financeiro/orcamento/versoes/:id/aprovacao      aprovar (outra pessoa; a vigente anterior é substituída)
//   POST /api/financeiro/orcamento/versoes/:id/descarte       descartar o rascunho, com o motivo
//   GET  /api/financeiro/orcamento/versoes/:id/comparativo    orçado × realizado (mesAte, visao linha|centro|item)
// Ler: `financeiro.orcamento.ler`; criar, gravar e descartar: `financeiro.orcamento.editar`; aprovar:
// `financeiro.orcamento.aprovar`. As gravações exigem a chave `orcamento` no estabelecimento (POL-3) e vão pelo Executor
// com a trilha de auditoria na mesma transação (com a porta em memória, o registrador da API registra).
// Melhoria: a gravação usa a Idempotency-Key da requisição (sem ela, uma chave nova por pedido).
import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioOrcamento,
  type ComparativoOrcamento,
  esquemaAprovarOrcamento,
  esquemaConsultaComparativo,
  esquemaConsultaOrcamentos,
  esquemaCriarVersaoOrcamento,
  esquemaDescartarOrcamento,
  esquemaGravarLinhas,
  EVENTOS_AUDITAVEIS,
  type OrcamentoDetalhe,
  type OrcamentoVersao,
  PERMISSOES_ORCAMENTO_CODIGOS as P,
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
import { PORTA_ORCAMENTO, type PortaOrcamento } from './porta.js';
import { type EventosOrcamento, ServicoOrcamento, type SessaoOrcamento } from './servico.js';

/** Chave de liberação do orçamento empresarial (ficha do M54, seção 12). */
export const CHAVE_LIBERACAO_ORCAMENTO = 'orcamento';

const CODIGOS = { editar: P.editar, aprovar: P.aprovar } as const;
const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
const EVENTOS: EventosOrcamento = {
  criado: EVENTOS_AUDITAVEIS.orcamentoCriado.codigo,
  linhas: EVENTOS_AUDITAVEIS.orcamentoLinhasGravadas.codigo,
  aprovado: EVENTOS_AUDITAVEIS.orcamentoAprovado.codigo,
  descartado: EVENTOS_AUDITAVEIS.orcamentoDescartado.codigo,
};

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

@Controller('financeiro/orcamento')
export class OrcamentoController {
  readonly servico: ServicoOrcamento;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(PORTA_ORCAMENTO) private readonly porta: PortaOrcamento,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoOrcamento(porta);
    this.liberacao = new LiberacaoPep(configuracao, cache);
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

  private async ligada(s: SessaoCadastro): Promise<boolean> {
    return (await this.liberacao.consultar(s, CHAVE_LIBERACAO_ORCAMENTO)).ligada;
  }

  @Get('apoio')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioOrcamento> {
    const s = sessaoDe(req);
    return this.servico.apoio(this.sessao(s), CODIGOS, await this.ligada(s));
  }

  @Get('versoes')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  async versoes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ versoes: OrcamentoVersao[] }> {
    const c = esquemaConsultaOrcamentos.safeParse(q);
    if (!c.success) throw invalido(c.error);
    return { versoes: await this.servico.versoes(this.sessao(sessaoDe(req)), c.data.ano ?? null) };
  }

  @Post('versoes')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação da criação da versão (ano, base e contagem de linhas)')
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; numero: number; linhas: number; descartadas: number; consumoDeFora: number }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_ORCAMENTO);
    const d = esquemaCriarVersaoOrcamento.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.criar(this.sessao(s), d.data, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.criado, r.id);
    return r;
  }

  @Get('versoes/:id')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoLido.codigo)
  async detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<OrcamentoDetalhe> {
    const s = sessaoDe(req);
    return this.servico.detalhe(this.sessao(s), idDaRota(id), CODIGOS, await this.ligada(s));
  }

  @Post('versoes/:id/linhas')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação dos valores gravados (contagens e total antes e depois)')
  async gravarLinhas(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_ORCAMENTO);
    const n = idDaRota(id);
    const d = esquemaGravarLinhas.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.gravarLinhas(this.sessao(s), n, d.data, EVENTOS);
    if (r.mudou) await this.trilhaMemoria(s, EVENTOS.linhas, n);
    return r;
  }

  @Post('versoes/:id/aprovacao')
  @HttpCode(200)
  @Permissao(P.aprovar)
  @AuditadoNoHandler('Trilha na transação da aprovação (a substituída na mesma transação)')
  async aprovar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ substituida: number | null }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_ORCAMENTO);
    const n = idDaRota(id);
    const d = esquemaAprovarOrcamento.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    const r = await this.servico.aprovar(this.sessao(s), n, d.data, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.aprovado, n);
    return r;
  }

  @Post('versoes/:id/descarte')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('Trilha na transação do descarte, com o motivo')
  async descartar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ descartada: true }> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_ORCAMENTO);
    const n = idDaRota(id);
    const d = esquemaDescartarOrcamento.safeParse(corpo);
    if (!d.success) throw invalido(d.error);
    await this.servico.descartar(this.sessao(s), n, d.data, EVENTOS);
    await this.trilhaMemoria(s, EVENTOS.descartado, n);
    return { descartada: true };
  }

  @Get('versoes/:id/comparativo')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.orcamentoComparativoLido.codigo)
  async comparativo(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ComparativoOrcamento> {
    const c = esquemaConsultaComparativo.safeParse(q);
    if (!c.success) throw invalido(c.error);
    return this.servico.comparativo(this.sessao(sessaoDe(req)), idDaRota(id), c.data);
  }
}
