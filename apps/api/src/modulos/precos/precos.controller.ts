// Tabelas de preço (ficha do M12, seção 7):
//   GET  /api/precos/tabelas?tipo=honorarios|diarias|matmed                cabeçalhos, modelo, convênios que usam
//   GET  /api/precos/honorarios/:tab/itens?busca&pagina&porPagina&data     itens com a vigência na data
//   GET  /api/precos/honorarios/:tab/itens/:cod/vigencias                  vigências do item com a autoria
//   POST /api/precos/honorarios/:tab/reajuste/proposta                     proposta (nada é gravado)
//   POST /api/precos/honorarios/:tab/reajuste                              preco.reajustar (crítica; partes de 200)
//   GET  /api/precos/reajustes?tabela                                      lotes gravados pelo novo
//   POST /api/precos/reajustes/:lote/desfazer                              preco.desfazerReajuste (crítica)
//   GET  /api/precos/diarias/:tab/itens · /api/precos/matmed/:tab/itens · /api/precos/matmed/edicoes
//   GET  /api/precos/diarias/:tab/itens/:ope/vigencias · /api/precos/matmed/:tab/itens/:cod/vigencias
//   GET  /api/precos/consulta?convenio&tipo&conta&item&data                valor vigente com a explicação
//   GET  /api/precos/saneamento                                            datas inválidas nas regras (regra 9)
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaJustificativa,
  EVENTOS_AUDITAVEIS,
  type PaginaDiarias,
  type PaginaHonorarios,
  type PaginaMatmed,
  type PropostaReajusteResposta,
  type ResultadoGravacaoPreco,
  type Saneamento,
  TETO_PAGINA_PRECOS,
  TETO_ITENS_PROPOSTA,
  type ValorVigente,
  type VigenciasValor,
  type VigenciasItem,
} from '@sgh/contratos';
import { relatorioSaneamento } from '@sgh/dominio-preco';
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
import { destinoDoContrato } from '../exames/public-api.js';
import {
  contextoOperacao,
  ctxDe,
  dataDe,
  escopoConvenio,
  exigirNoEscopo,
  inteiro,
  inteiroOuNulo,
  paginaDe,
  problemaDoPreco,
  sessaoDe,
} from './base.js';
import { FONTE_PRECOS, type FontePrecos } from './fonte.js';
import type { PedidoProposta, ServicoPrecos } from './servico.js';
import { SERVICO_PRECOS } from './simbolos.js';

const esquemaPedido = z
  .object({
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    codigos: z.array(z.number().int().min(1)).max(TETO_ITENS_PROPOSTA).nullable().optional(),
    percentual: z.number().finite().nullable().optional(),
    valores: z
      .array(z.object({ codigo: z.number().int().min(1), ch: z.number().finite() }).strict())
      .max(TETO_ITENS_PROPOSTA)
      .nullable()
      .optional(),
  })
  .strict();
const esquemaAplicar = esquemaPedido
  .extend({
    justificativa: esquemaJustificativa,
    senha: z.string(),
    confirmacoes: z
      .object({ tabelaCompartilhada: z.boolean().optional(), percentualTabela: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
const esquemaDesfazer = z.object({ justificativa: esquemaJustificativa, senha: z.string() }).strict();

function pedidoDe(p: z.infer<typeof esquemaPedido>): PedidoProposta {
  return {
    data: p.data ?? null,
    codigos: p.codigos ?? null,
    percentual: p.percentual ?? null,
    valores: p.valores ?? null,
  };
}

@Controller('precos')
export class PrecosController {
  constructor(
    @Inject(SERVICO_PRECOS) private readonly servico: ServicoPrecos,
    @Inject(FONTE_PRECOS) private readonly fonte: FontePrecos,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  @Get('tabelas')
  @Permissao('preco.tabela.ler')
  async tabelas(@Query('tipo') tipo: string, @Req() req: RequisicaoAutorizada) {
    const t = tipo === 'diarias' || tipo === 'matmed' ? tipo : 'honorarios';
    return { tabelas: await this.servico.tabelas(ctxDe(req, 'tabelas'), t, escopoConvenio(req)) };
  }

  @Get('honorarios/:tab/itens')
  @Permissao('preco.tabela.ler')
  async honorarios(
    @Param('tab') tab: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaHonorarios> {
    const p = paginaDe(q, TETO_PAGINA_PRECOS);
    return this.servico.honorarios(ctxDe(req, 'honorarios'), inteiro(tab, 'tabela', [0, 32767]), {
      busca: (q['busca'] ?? '').slice(0, 60),
      ...p,
      data: dataDe(q['data']),
    });
  }

  @Get('honorarios/:tab/itens/:cod/vigencias')
  @Permissao('preco.tabela.ler')
  async vigencias(
    @Param('tab') tab: string,
    @Param('cod') cod: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VigenciasItem> {
    const r = await this.servico.vigencias(
      ctxDe(req, 'vigencias'),
      inteiro(tab, 'tabela', [0, 32767]),
      inteiro(cod, 'item'),
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return r;
  }

  @Get('diarias/:tab/itens/:ope/vigencias')
  @Permissao('preco.tabela.ler')
  async vigenciasDiaria(
    @Param('tab') tab: string,
    @Param('ope') ope: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VigenciasValor> {
    const r = await this.servico.vigenciasValor(
      ctxDe(req, 'vigencias'),
      'diaria',
      inteiro(tab, 'tabela', [0, 32767]),
      inteiro(ope, 'item'),
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return r;
  }

  @Get('matmed/:tab/itens/:cod/vigencias')
  @Permissao('preco.tabela.ler')
  async vigenciasMatmed(
    @Param('tab') tab: string,
    @Param('cod') cod: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VigenciasValor> {
    const r = await this.servico.vigenciasValor(
      ctxDe(req, 'vigencias'),
      'matmed',
      inteiro(tab, 'tabela', [0, 32767]),
      inteiro(cod, 'item'),
    );
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return r;
  }

  @Post('honorarios/:tab/reajuste/proposta')
  @HttpCode(200)
  @Permissao('preco.reajuste.aplicar')
  @AuditadoNoHandler('proposta: só leitura, nada muda (a gravação é o POST /reajuste, pelo executor)')
  async proposta(
    @Param('tab') tab: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PropostaReajusteResposta> {
    const p = esquemaPedido.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe o percentual ou os valores.',
      );
    return this.servico.proposta(
      ctxDe(req, 'proposta'),
      inteiro(tab, 'tabela', [0, 32767]),
      pedidoDe(p.data),
    );
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

  private async trilhaMemoria(req: RequisicaoAutorizada, evento: string, id: string): Promise<void> {
    if (this.fonte.destino !== 'memoria') return;
    const { rede, hospital, login } = sessaoDe(req);
    await this.trilha.registrar({
      evento,
      rede,
      hospital,
      usuario: login,
      estacao: estacaoDaRequisicao(req),
      correlacao: ctxDe(req, 'preco').traceId,
      recurso: 'preco.reajuste',
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: id,
    });
  }

  @Post('honorarios/:tab/reajuste')
  @HttpCode(200)
  @Permissao('preco.reajuste.aplicar')
  @AuditadoNoHandler('executor: trilha e autoria em cada parte (memória: registrador da API)')
  async aplicar(
    @Param('tab') tab: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacaoPreco> {
    const p = esquemaAplicar.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe o percentual ou os valores e justifique.',
      );
    this.semGravacao();
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const ctxOp = contextoOperacao(req, 'reajuste', em);
    try {
      const r = await this.servico.aplicarReajuste(
        ctxDe(req, 'reajuste'),
        ctxOp,
        inteiro(tab, 'tabela', [0, 32767]),
        pedidoDe(p.data),
        p.data.confirmacoes ?? {},
        p.data.justificativa,
        'reajuste',
        null,
      );
      await this.trilhaMemoria(req, EVENTOS_AUDITAVEIS.precoReajustado.codigo, r.lote);
      return {
        operacao: 'preco.reajustar',
        destino: destinoDoContrato(this.fonte.destino),
        lote: r.lote,
        linhas: r.linhas,
        partes: r.partes,
        mensagem: `Reajuste gravado: ${r.linhas} item(ns) com vigência em ${r.proposta.data}, em ${r.partes} transação(ões). Lote ${r.lote}.`,
      };
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Get('reajustes')
  @Permissao('preco.tabela.ler')
  async lotes(@Query('tabela') tab: string | undefined, @Req() req: RequisicaoAutorizada) {
    const l = await this.fonte.lotes(ctxDe(req, 'lotes'), inteiroOuNulo(tab, 'tabela'));
    return { lotes: l ?? [] };
  }

  @Post('reajustes/:lote/desfazer')
  @HttpCode(200)
  @Permissao('preco.reajuste.desfazer')
  @AuditadoNoHandler('executor: trilha e autoria em cada parte (memória: registrador da API)')
  async desfazer(
    @Param('lote') lote: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravacaoPreco> {
    if (!/^[A-Za-z0-9-]{8,40}$/.test(lote))
      throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado');
    const p = esquemaDesfazer.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Justifique o desfazer.');
    this.semGravacao();
    const em = await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const ctxOp = contextoOperacao(req, 'desfazer', em);
    try {
      const r = await this.servico.desfazerLote(ctxDe(req, 'desfazer'), ctxOp, lote, p.data.justificativa);
      await this.trilhaMemoria(req, EVENTOS_AUDITAVEIS.precoReajusteDesfeito.codigo, lote);
      return {
        operacao: 'preco.desfazerReajuste',
        destino: destinoDoContrato(this.fonte.destino),
        lote,
        linhas: r.linhas,
        partes: r.partes,
        mensagem: `Reajuste desfeito: ${r.linhas} vigência(s) removida(s); a anterior volta a valer.`,
      };
    } catch (e) {
      throw problemaDoPreco(e);
    }
  }

  @Get('diarias/:tab/itens')
  @Permissao('preco.tabela.ler')
  async diarias(
    @Param('tab') tab: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaDiarias> {
    const ctx = ctxDe(req, 'diarias');
    const p = paginaDe(q, TETO_PAGINA_PRECOS);
    const data = dataDe(q['data']) ?? (await this.fonte.hoje(ctx));
    const r = await this.fonte.itensDiaria(ctx, inteiro(tab, 'tabela', [0, 32767]), {
      busca: (q['busca'] ?? '').slice(0, 60),
      ...p,
      data,
    });
    return { itens: r.itens, total: r.total, ...p, dataBase: data, truncada: false };
  }

  @Get('matmed/edicoes')
  @Permissao('preco.tabela.ler')
  async edicoes(@Req() req: RequisicaoAutorizada) {
    const e = await this.fonte.edicoes(ctxDe(req, 'edicoes'));
    return { edicoes: e.slice(0, 50), total: e.length };
  }

  @Get('matmed/:tab/itens')
  @Permissao('preco.tabela.ler')
  async matmed(
    @Param('tab') tab: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaMatmed> {
    const ctx = ctxDe(req, 'matmed');
    const p = paginaDe(q, TETO_PAGINA_PRECOS);
    const data = dataDe(q['data']) ?? (await this.fonte.hoje(ctx));
    const r = await this.fonte.itensMatmed(ctx, inteiro(tab, 'tabela', [0, 32767]), {
      busca: (q['busca'] ?? '').slice(0, 60),
      ...p,
      data,
    });
    return { itens: r.itens, total: r.total, ...p, dataBase: data, truncada: false };
  }

  @Get('consulta')
  @Permissao('preco.tabela.ler')
  async consulta(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ValorVigente> {
    const tipo = q['tipo'] === 'diaria' || q['tipo'] === 'matmed' ? q['tipo'] : 'honorario';
    const convenio = inteiro(q['convenio'], 'convênio', [0, 32767]);
    // Fora do escopo da sessão: o mesmo 404 do inexistente.
    exigirNoEscopo(req, convenio);
    const r = await this.servico.valorVigente(ctxDe(req, 'consulta'), {
      convenio,
      tipo,
      conta: q['conta'] === 'internacao' ? 'internacao' : 'externa',
      item: inteiro(q['item'], 'item'),
      data: dataDe(q['data']),
    });
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Convênio não encontrado');
    return r;
  }

  @Get('saneamento')
  @Permissao('preco.tabela.ler')
  async saneamento(@Req() req: RequisicaoAutorizada): Promise<Saneamento> {
    const r = relatorioSaneamento(await this.fonte.saneamento(ctxDe(req, 'saneamento')));
    return { porOrigem: { ...r.porOrigem }, achados: r.achados.map((a) => ({ ...a })) };
  }
}
