// Catálogos oficiais e importadores (ficha do M13, seções 4, 5 e 7):
//   GET  /api/catalogos/painel                          painel de cargas (responsável, última carga, edição no banco)
//   GET  /api/catalogos/cargas?catalogo=                cargas do estabelecimento
//   POST /api/catalogos/cargas                          envia o arquivo: prepara, valida e compara (nada no banco do
//                                                       estabelecimento; a área de preparação SGH_ e a trilha juntas)
//   GET  /api/catalogos/cargas/:id?pagina&comparacao&resultado  detalhe com as linhas e a decisão de publicar
//   POST /api/catalogos/cargas/:id/aprovar              aprova (crítica: justificativa e a senha de novo); a
//                                                       publicação em lotes é do worker, na janela fora do pico
//   POST /api/catalogos/cargas/:id/rejeitar             rejeita a comparada (motivo)
//   POST /api/catalogos/cargas/:id/cancelar             cancela a aprovada entre lotes (motivo)
//   GET  /api/catalogos/consulta/:entidade?busca&pagina&porPagina&competencia  consulta paginada no servidor
//   GET  /api/catalogos/leiautes/posicoes?busca&pagina&porPagina  posições do leiaute de CEP (catalogo.leiaute.ler)
//   GET  /api/catalogos/sigtap/:procedimento/historico  histórico de competências SIGTAP
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CargaCatalogo,
  definicaoCatalogo,
  esquemaAprovarCargaCatalogo,
  esquemaMotivoCargaCatalogo,
  esquemaNovaCargaCatalogo,
  EVENTOS_AUDITAVEIS,
  type DetalheCargaCatalogo,
  entidadeConsultaCatalogo,
  PERMISSAO_CONSULTA_CATALOGO,
  permissaoAprovadorCatalogo,
  permissaoConsultaCatalogo,
} from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { type CargaCatalogoLida, ErroCargaSgh } from '@sgh/legado';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type { CtxCatalogos, Trilha } from './fonte.js';
import { SERVICO_CATALOGOS, type ServicoCatalogos } from './servico.js';

const INTEIRO = /^\d{1,9}$/;
const CODIGO_SIGTAP = /^\d{10}$/;
const ENTIDADE = /^[a-z][A-Za-z0-9]{1,40}$/;
const COMPETENCIA = /^\d{4}(0[1-9]|1[0-2])$/;
const AREA: Readonly<Record<string, string>> = {
  faturamento: 'do faturamento',
  administracao: 'da administração',
  fiscal: 'fiscal',
  farmacia: 'da farmácia',
};

function sessaoDe(req: RequisicaoAutorizada) {
  const a = req.sgh;
  if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
  const hospital = a.sessao.estabelecimentoAtivo;
  if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
  return { rede: a.sessao.rede ?? '', hospital, login: a.sessao.usuario.login ?? a.sessao.usuario.id };
}

function ctxDe(req: RequisicaoAutorizada, origem: string): CtxCatalogos {
  const s = sessaoDe(req);
  return { rede: s.rede, hospital: s.hospital, traceId: correlacaoDaRequisicao(req, origem).slice(0, 64) };
}

function inteiro(v: unknown, nome: string, max = 2147483647): number {
  const s = typeof v === 'string' ? v.trim() : String(v ?? '');
  if (!INTEIRO.test(s) || Number(s) > max)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', `Valor inválido: ${nome}.`);
  return Number(s);
}

function pagina(q: Record<string, string | undefined>, teto = 500) {
  return {
    pagina: q['pagina'] ? inteiro(q['pagina'], 'pagina', 100_000) : 0,
    porPagina: q['porPagina'] ? Math.max(1, inteiro(q['porPagina'], 'porPagina', teto)) : 50,
  };
}

/** A carga sem os campos internos (versão de controle e estabelecimento): a resposta pública. */
function semInternos(c: CargaCatalogoLida): CargaCatalogo {
  return {
    id: c.id,
    catalogo: c.catalogo,
    arquivo: c.arquivo,
    sha256: c.sha256,
    bytes: c.bytes,
    situacao: c.situacao,
    edicao: c.edicao,
    responsavel: c.responsavel,
    aprovador: c.aprovador,
    criadaEm: c.criadaEm,
    totais: c.totais,
    lotes: c.lotes,
    motivo: c.motivo,
    arquivoGuardado: c.arquivoGuardado,
  };
}

function problema(e: unknown): ErroProblema {
  if (e instanceof ErroProblema) return e;
  if (e instanceof ErroCargaSgh)
    return new ErroProblema('recusa-de-negocio', 409, 'Carga', e.message, { codigo: e.codigo });
  const codigo = (e as { codigo?: unknown }).codigo;
  if (e instanceof Error && typeof codigo === 'string')
    return new ErroProblema(
      codigo === 'conflito-concorrente' ? 'conflito-de-versao' : 'recusa-de-negocio',
      409,
      'Carga',
      e.message,
      {
        codigo,
        ...(codigo === 'conflito-concorrente' ? { alteradoPor: 'desconhecido', campos: [] } : {}),
      },
    );
  throw e;
}

@Controller('catalogos')
export class CatalogosController {
  constructor(
    @Inject(SERVICO_CATALOGOS) private readonly servico: ServicoCatalogos,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
  ) {}

  private trilha(req: RequisicaoAutorizada, evento: string, operacao: string, chave: string): Trilha {
    const { rede, hospital, login } = sessaoDe(req);
    return {
      rede,
      hospital,
      usuario: login,
      evento,
      recurso: 'catalogo.carga',
      operacao,
      chaveNaturalAlvo: chave.slice(0, 120),
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'catalogo').slice(0, 64),
    };
  }

  private semGravacao(): void {
    const g = this.servico.fonte.gravacao;
    if (!g.permitida)
      throw new ErroProblema(
        'operacao-bloqueada',
        409,
        'Gravação desligada nesta fonte',
        g.motivo ?? undefined,
        { codigo: 'gravacao-desligada' },
      );
  }

  @Get('painel')
  @Permissao('catalogo.carga.ler')
  async painel(@Req() req: RequisicaoAutorizada) {
    return this.servico.painel(ctxDe(req, 'catalogos-painel'));
  }

  @Get('cargas')
  @Permissao('catalogo.carga.ler')
  async cargas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const cat = q['catalogo'] && definicaoCatalogo(q['catalogo']) ? q['catalogo'] : null;
    const r = (await this.servico.fonte.cargas(ctxDe(req, 'catalogos-cargas'), cat)) ?? [];
    return { cargas: r.map(semInternos) };
  }

  @Post('cargas')
  @HttpCode(201)
  @Permissao('catalogo.carga.criar')
  @AuditadoNoHandler(
    'transação SGH_: SGH_CAT_CARGA, SGH_CAT_CARGA_LINHA e SGH_TRILHA juntas (memória: registrador da API)',
  )
  async criar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = esquemaNovaCargaCatalogo.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha o catálogo e envie o arquivo oficial (até 16 MB por arquivo).',
      );
    this.semGravacao();
    const ctx = ctxDe(req, 'catalogo-carga');
    const { login } = sessaoDe(req);
    try {
      return await this.servico.preparar(
        ctx,
        login,
        p.data,
        this.trilha(
          req,
          EVENTOS_AUDITAVEIS.catalogoCargaPreparada.codigo,
          'catalogo.carga.preparar',
          `CATALOGO:${p.data.catalogo}`,
        ),
      );
    } catch (e) {
      throw problema(e);
    }
  }

  @Get('cargas/:id')
  @Permissao('catalogo.carga.ler')
  async detalhe(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DetalheCargaCatalogo> {
    const ctx = ctxDe(req, 'catalogo-carga');
    const c = await this.servico.fonte.carga(ctx, inteiro(id, 'carga'));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Carga não encontrada');
    const pg = pagina(q);
    const comparacao = ['novo', 'removido', 'alterado', 'igual'].includes(q['comparacao'] ?? '')
      ? (q['comparacao'] ?? null)
      : null;
    const resultado = ['valida', 'erro'].includes(q['resultado'] ?? '') ? (q['resultado'] ?? null) : null;
    const l = await this.servico.fonte.linhas(ctx, c.id, { ...pg, comparacao, resultado });
    const d = await this.servico.decisao(ctx, c);
    return {
      carga: semInternos(c),
      versao: c.versao,
      linhas: l.itens.map((x) => ({
        linha: x.linha % 1_000_000,
        entidade: x.entidade,
        chave: x.chave,
        resultado: x.resultado,
        comparacao: x.comparacao,
        antes: x.antes,
        depois: x.depois,
        motivo: x.motivo,
      })),
      total: l.total,
      ...pg,
      publicacao: { pode: d.pode, motivo: d.motivo },
    };
  }

  @Post('cargas/:id/aprovar')
  @HttpCode(200)
  @Permissao('catalogo.carga.publicar')
  @AuditadoNoHandler(
    'transação SGH_ da carga, com a SGH_TRILHA; cada lote publicado pelo executor com a trilha dele',
  )
  async aprovar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = esquemaAprovarCargaCatalogo.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Justifique a aprovação e informe a senha.',
      );
    this.semGravacao();
    const ctx = ctxDe(req, 'catalogo-aprovar');
    const c = await this.servico.fonte.carga(ctx, inteiro(id, 'carga'));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Carga não encontrada');
    if (c.versao !== p.data.versao)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'Carga alterada',
        'A carga mudou desde a leitura. Releia.',
        { alteradoPor: 'desconhecido', campos: [] },
      );
    const d = await this.servico.decisao(ctx, c);
    if (!d.pode)
      throw new ErroProblema('recusa-de-negocio', 409, 'Publicação recusada', d.motivo ?? undefined, {
        codigo: d.codigo ?? 'recusada',
      });
    // Aprovação pela área do catálogo (ficha, seção 5): além de catalogo.carga.publicar, a permissão da área.
    const def = definicaoCatalogo(c.catalogo);
    const a = req.sgh;
    if (def && a && !pode(a.ability, permissaoAprovadorCatalogo(def.aprovador)))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Aprovação de outra área',
        `A carga de ${def.titulo} é aprovada pela área ${AREA[def.aprovador] ?? def.aprovador}.`,
      );
    await reautenticar(this.sessoes, this.resolvedor, req, p.data.senha);
    const { login } = sessaoDe(req);
    try {
      await this.servico.fonte.mudarSituacao(
        ctx,
        {
          hospital: ctx.hospital,
          id: c.id,
          versao: c.versao,
          de: ['comparada'],
          para: 'aprovada',
          aprovador: login,
          motivo: p.data.justificativa,
        },
        this.trilha(
          req,
          EVENTOS_AUDITAVEIS.catalogoCargaAprovada.codigo,
          'catalogo.carga.aprovar',
          `CARGA:${c.id}`,
        ),
      );
      const publicada = this.servico.fonte.publicarAgora
        ? await this.servico.fonte.publicarAgora(ctx, c.id, login)
        : null;
      return {
        id: c.id,
        situacao: publicada ? 'publicada' : 'aprovada',
        lotes: c.lotes.total,
        mensagem: publicada
          ? `Carga publicada: ${publicada.incluidas} item(ns) incluído(s) e ${publicada.alteradas} alterado(s) em ${publicada.lotes} lote(s).`
          : d.codigo === 'fora-da-janela'
            ? `Carga aprovada: ${c.lotes.total} lote(s) aguardando a janela de publicação (${this.servico.janela.inicio} às ${this.servico.janela.fim}).`
            : `Carga aprovada: ${c.lotes.total} lote(s) em publicação (lotes curtos, retomada pelo último lote confirmado).`,
      };
    } catch (e) {
      throw problema(e);
    }
  }

  private async encerrar(
    id: string,
    corpo: unknown,
    req: RequisicaoAutorizada,
    para: 'rejeitada' | 'cancelada',
  ) {
    const p = esquemaMotivoCargaCatalogo.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Diga o motivo.');
    this.semGravacao();
    const ctx = ctxDe(req, `catalogo-${para}`);
    const c = await this.servico.fonte.carga(ctx, inteiro(id, 'carga'));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Carga não encontrada');
    const { login } = sessaoDe(req);
    try {
      await this.servico.fonte.mudarSituacao(
        ctx,
        {
          hospital: ctx.hospital,
          id: c.id,
          versao: p.data.versao,
          de:
            para === 'rejeitada'
              ? ['preparada', 'validada', 'comparada']
              : ['aprovada', 'publicando', 'falhou'],
          para,
          aprovador: login,
          motivo: p.data.motivo,
        },
        this.trilha(
          req,
          EVENTOS_AUDITAVEIS.catalogoCargaRejeitada.codigo,
          `catalogo.carga.${para === 'rejeitada' ? 'rejeitar' : 'cancelar'}`,
          `CARGA:${c.id}`,
        ),
      );
      return { id: c.id, situacao: para };
    } catch (e) {
      throw problema(e);
    }
  }

  @Post('cargas/:id/rejeitar')
  @HttpCode(200)
  @Permissao('catalogo.carga.rejeitar')
  @AuditadoNoHandler('transação SGH_ da carga, com a SGH_TRILHA (memória: registrador da API)')
  rejeitar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.encerrar(id, corpo, req, 'rejeitada');
  }

  @Post('cargas/:id/cancelar')
  @HttpCode(200)
  @Permissao('catalogo.carga.rejeitar')
  @AuditadoNoHandler('transação SGH_ da carga, com a SGH_TRILHA (memória: registrador da API)')
  cancelar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    return this.encerrar(id, corpo, req, 'cancelada');
  }

  private async consultarEntidade(entidade: string, q: Record<string, string>, req: RequisicaoAutorizada) {
    const busca = (q['busca'] ?? '').slice(0, 60);
    const competencia = q['competencia'] ? q['competencia'].trim() : '';
    if (competencia && !COMPETENCIA.test(competencia))
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Competência no formato AAAAMM.');
    const pg = pagina(q, ['cep', 'cepSus', 'formaEnvioTuss', 'valorSigtap'].includes(entidade) ? 50 : 500);
    const r = await this.servico.fonte.consultar(ctxDe(req, 'catalogo-consulta'), entidade, {
      busca: busca || null,
      competencia: competencia || null,
      ...pg,
    });
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Tabela não encontrada');
    return { entidade, ...r, ...pg };
  }

  @Get('consulta/:entidade')
  @Permissao('catalogo.item.ler')
  async consulta(
    @Param('entidade') entidade: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (!ENTIDADE.test(entidade))
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Tabela inválida.');
    // Só as entidades do contrato (nunca um nome herdado de Object, como "constructor").
    if (!entidadeConsultaCatalogo(entidade))
      throw new ErroProblema('nao-encontrado', 404, 'Tabela não encontrada');
    const permissao = permissaoConsultaCatalogo(entidade);
    const a = req.sgh;
    if (permissao !== PERMISSAO_CONSULTA_CATALOGO && a && !pode(a.ability, permissao))
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão para esta tabela');
    return this.consultarEntidade(entidade, q, req);
  }

  /** Posições do leiaute de CEP: a tela de leiautes pede catalogo.leiaute.ler (não catalogo.item.ler). */
  @Get('leiautes/posicoes')
  @Permissao('catalogo.leiaute.ler')
  async posicoesLeiaute(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    return this.consultarEntidade('leiautePosicao', q, req);
  }

  @Get('sigtap/:procedimento/historico')
  @Permissao('catalogo.item.ler')
  async historico(@Param('procedimento') procedimento: string, @Req() req: RequisicaoAutorizada) {
    if (!CODIGO_SIGTAP.test(procedimento))
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Código SIGTAP de 10 dígitos.');
    const r = await this.servico.fonte.historico(ctxDe(req, 'catalogo-sigtap'), procedimento);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Procedimento não encontrado');
    return r;
  }
}
