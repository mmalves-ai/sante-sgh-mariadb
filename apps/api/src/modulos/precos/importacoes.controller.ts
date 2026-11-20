// Importação versionada de tabela de preço (ficha do M12, seção 5 e 7; cap-06a §6.2, carga em três passos):
//   GET  /api/precos/importacoes                          cargas do estabelecimento (SGH_CAT_CARGA)
//   POST /api/precos/importacoes                          prepara, valida e compara um arquivo (nada no legado)
//   GET  /api/precos/importacoes/:id?pagina&comparacao     detalhe com as linhas da área de preparação
//   POST /api/precos/importacoes/:id/aprovar              publica os itens alterados como preco.reajustar em
//                                                         modo "por arquivo" (crítica; supervisor do faturamento)
//   POST /api/precos/importacoes/:id/rejeitar             rejeita (nada no legado)
// Itens novos e removidos aparecem na comparação e não são publicados (o novo nunca grava TBTABTHM;
// a inclusão de item ainda não está disponível).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CargaDetalhe,
  esquemaJustificativa,
  EVENTOS_AUDITAVEIS,
  type ResultadoGravacaoPreco,
  textoCp1252,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { contextoOperacao, ctxDe, inteiro, paginaDe, problemaDoPreco, sessaoDe } from './base.js';
import { FONTE_PRECOS, type FontePrecos } from './fonte.js';
import type { ServicoPrecos } from './servico.js';
import { SERVICO_PRECOS } from './simbolos.js';

export const CATALOGO_HONORARIOS = 'preco.honorarios';

const esquemaNova = z
  .object({
    tabela: z.number().int().min(0).max(32767),
    arquivo: textoCp1252(120).pipe(z.string().min(1)),
    conteudo: z.string().min(1).max(2_000_000),
  })
  .strict();
const esquemaAprovar = z
  .object({
    justificativa: esquemaJustificativa,
    senha: z.string(),
    versao: z.number().int().min(1),
    confirmacoes: z
      .object({ tabelaCompartilhada: z.boolean().optional(), percentualTabela: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
const esquemaRejeitar = z.object({ motivo: esquemaJustificativa, versao: z.number().int().min(1) }).strict();

/** Os 5 componentes de TBVLRTHM a partir do JSON da linha (ausente = 0). */
function componentesDe(v: Readonly<Record<string, number>> | null) {
  if (!v) return null;
  const n = (k: string) => (typeof v[k] === 'number' ? v[k] : 0);
  return { ch: n('ch'), co: n('co'), filme: n('filme'), anes: n('anes'), outros: n('outros') };
}

@Controller('precos/importacoes')
export class ImportacoesController {
  constructor(
    @Inject(SERVICO_PRECOS) private readonly servico: ServicoPrecos,
    @Inject(FONTE_PRECOS) private readonly fonte: FontePrecos,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private linhaTrilha(req: RequisicaoAutorizada, operacaoNome: string, chave: string) {
    const { rede, hospital, login } = sessaoDe(req);
    return {
      rede,
      hospital,
      usuario: login,
      evento: EVENTOS_AUDITAVEIS.precoImportacaoGravada.codigo,
      recurso: 'preco.importacao',
      operacao: operacaoNome,
      chaveNaturalAlvo: chave,
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: ctxDe(req, 'importacao').traceId,
    };
  }

  private async trilhaMemoria(req: RequisicaoAutorizada, id: string): Promise<void> {
    if (this.fonte.destino !== 'memoria') return;
    const t = this.linhaTrilha(req, 'preco.importacao', id);
    await this.trilha.registrar({
      evento: t.evento,
      rede: t.rede,
      hospital: t.hospital,
      usuario: t.usuario,
      estacao: t.estacao,
      correlacao: t.correlacao,
      recurso: t.recurso,
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: id,
    });
  }

  private semGravacao(): void {
    if (!this.fonte.gravacao.permitida)
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Gravação desligada nesta fonte',
        this.fonte.gravacao.motivo ?? undefined,
        {
          codigo: 'gravacao-desligada',
        },
      );
  }

  @Get()
  @Permissao('preco.importacao.ler')
  async lista(@Req() req: RequisicaoAutorizada) {
    const r = await this.fonte.cargas(ctxDe(req, 'importacoes'), CATALOGO_HONORARIOS);
    return {
      cargas: (r ?? []).map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'versao'))),
      versoes: Object.fromEntries((r ?? []).map((c) => [c.id, c.versao])),
    };
  }

  @Post()
  @HttpCode(201)
  @Permissao('preco.importacao.criar')
  @AuditadoNoHandler(
    'transação SGH_: SGH_CAT_CARGA, SGH_CAT_CARGA_LINHA e SGH_TRILHA juntas (memória: registrador da API)',
  )
  async criar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = esquemaNova.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha a tabela e o arquivo.');
    this.semGravacao();
    const ctx = ctxDe(req, 'importacao');
    const { hospital, login } = sessaoDe(req);
    const prep = await this.servico.prepararImportacao(ctx, p.data.tabela, p.data.arquivo, p.data.conteudo);
    try {
      const r = await this.fonte.gravarCarga(
        ctx,
        {
          hospital,
          catalogo: CATALOGO_HONORARIOS,
          tabela: p.data.tabela,
          arquivo: p.data.arquivo,
          sha256: prep.sha256,
          bytes: prep.bytes,
          situacao: prep.situacao,
          responsavel: login,
          motivo: prep.motivo,
          totais: prep.totais,
          linhas: prep.linhas,
        },
        this.linhaTrilha(req, 'preco.importacao.preparar', `TAB:${p.data.tabela}`),
      );
      await this.trilhaMemoria(req, String(r.id));
      return {
        id: r.id,
        situacao: prep.situacao,
        totais: prep.totais,
        motivo: prep.motivo,
        destino: this.fonte.destino,
      };
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Get(':id')
  @Permissao('preco.importacao.ler')
  async detalhe(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CargaDetalhe & { versao: number }> {
    const ctx = ctxDe(req, 'importacao');
    const c = await this.fonte.carga(ctx, inteiro(id, 'importação'));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Importação não encontrada');
    const p = paginaDe(q);
    const cmp = ['novo', 'removido', 'alterado', 'igual'].includes(q['comparacao'] ?? '')
      ? (q['comparacao'] ?? null)
      : null;
    const l = await this.fonte.linhasDaCarga(ctx, c.id, p.pagina, p.porPagina, cmp);
    const { versao, ...carga } = c;
    return {
      carga,
      versao,
      linhas: l.itens.map((x) => ({
        linha: x.linha >= 1_000_000 ? null : x.linha,
        codigo: x.codigo,
        nome: x.nome,
        resultado: x.resultado,
        comparacao: x.comparacao,
        antes: componentesDe(x.anteriores),
        // No removido, o arquivo não traz o item: "depois" fica vazio (o vigente está em "antes").
        depois: x.comparacao === 'removido' ? null : x.valores ? { ...x.valores } : null,
        motivo: x.motivo,
      })),
      total: l.total,
      ...p,
    };
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  @Permissao('preco.importacao.aprovar')
  @AuditadoNoHandler('executor (preco.reajustar por arquivo) e transação SGH_ da carga, com as trilhas')
  async aprovar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacaoPreco> {
    const p = esquemaAprovar.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Justifique a aprovação.');
    this.semGravacao();
    const ctx = ctxDe(req, 'importacao');
    const c = await this.fonte.carga(ctx, inteiro(id, 'importação'));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Importação não encontrada');
    if (c.situacao !== 'comparada' || c.tabela === null)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Importação não aprovável',
        'Só a importação comparada, sem erros, é aprovada.',
        {
          codigo: 'situacao-invalida',
        },
      );
    if (c.versao !== p.data.versao)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'Importação alterada',
        'A importação mudou desde a leitura. Releia.',
      );
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const ctxOp = contextoOperacao(req, 'importacao-aprovar', em);
    const { login } = sessaoDe(req);
    const linhas = await this.fonte.linhasDaCarga(ctx, c.id, 0, 20000, 'alterado');
    const arquivo = new Map(
      linhas.itens
        .filter((l) => l.codigo !== null && l.valores && typeof l.valores['ch'] === 'number')
        .map((l) => [l.codigo as number, { ...l.valores, ch: l.valores?.['ch'] as number }]),
    );
    if (arquivo.size === 0)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Nada a publicar',
        'Nenhum item existente muda de valor.',
        { codigo: 'sem-efeito' },
      );
    try {
      const r = await this.servico.aplicarReajuste(
        ctx,
        ctxOp,
        c.tabela,
        { data: null, codigos: null, percentual: null, valores: null, arquivo },
        p.data.confirmacoes ?? {},
        p.data.justificativa,
        'importacao',
        c.id,
      );
      await this.fonte.mudarSituacaoCarga(
        ctx,
        {
          hospital: ctx.hospital,
          id: c.id,
          versao: c.versao,
          de: ['comparada'],
          para: 'publicada',
          aprovador: login,
          lote: r.lote,
          motivo: null,
        },
        this.linhaTrilha(req, 'preco.importacao.aprovar', `CARGA:${c.id};LOTE:${r.lote}`),
      );
      await this.trilhaMemoria(req, String(c.id));
      return {
        operacao: 'preco.reajustar',
        destino: this.fonte.destino,
        lote: r.lote,
        linhas: r.linhas,
        partes: r.partes,
        mensagem: `Importação publicada: ${r.linhas} item(ns) com vigência nova (lote ${r.lote}).`,
      };
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Post(':id/rejeitar')
  @HttpCode(200)
  @Permissao('preco.importacao.aprovar')
  @AuditadoNoHandler('transação SGH_ da carga, com a SGH_TRILHA (memória: registrador da API)')
  async rejeitar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = esquemaRejeitar.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Diga o motivo.');
    this.semGravacao();
    const ctx = ctxDe(req, 'importacao');
    const { login } = sessaoDe(req);
    const c = await this.fonte.carga(ctx, inteiro(id, 'importação'));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Importação não encontrada');
    try {
      await this.fonte.mudarSituacaoCarga(
        ctx,
        {
          hospital: ctx.hospital,
          id: c.id,
          versao: p.data.versao,
          de: ['preparada', 'validada', 'comparada'],
          para: 'rejeitada',
          aprovador: login,
          lote: null,
          motivo: p.data.motivo,
        },
        this.linhaTrilha(req, 'preco.importacao.rejeitar', `CARGA:${c.id}`),
      );
      await this.trilhaMemoria(req, String(c.id));
      return { id: c.id, situacao: 'rejeitada' };
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }
}
