// Consulta somente leitura de tabela (M14; ficha, seções 4, 7 e 8, regras 5 e 15): uma API para as consultas
// declaradas no lote.
//   GET  /api/consultas[?item=<id>]                         índice (só as que a pessoa lê)
//   GET  /api/consultas/:modulo/:recurso                     descrição (colunas, filtros, máscara, permitidas)
//   GET  /api/consultas/:modulo/:recurso/linhas?f.<c>&de.<c>&ate.<c>&apos&porPagina   página e contagem
//   GET  /api/consultas/:modulo/:recurso/registro/:codigo    registro (dado de pessoa sem máscara: evento auditado)
//   GET  /api/consultas/justificativas                       justificativas de exportação ativas (correção do M14:
//                                                            quem exporta não precisa ler o domínio de auditoria)
//   POST /api/consultas/:modulo/:recurso/exportar            CSV (permissão exportar; justificativa com dado de
//                                                            pessoa ou conteúdo clínico; trilha antes da resposta)
// A rota exige `config.consulta.ler` (todos os perfis de pessoa); cada handler confere a permissão da CONSULTA
// (`<modulo>.consulta.ler|exportar`; clínica: `pep.consultaClinica.*`), com a negação na trilha. Nada é gravado:
// transação somente leitura e o executor não tem operação de consulta (regra 5). Nenhum nome de tabela nem de coluna
// do banco sai na resposta. A consulta só existe quando a tabela do modelo próprio a atende (tabelas.gerado.ts).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  CONSULTAS_DECLARADAS,
  type ConsultaDescrita,
  type ConsultaPublica,
  consultaPublica,
  esquemaPedidoExportacaoConsulta,
  esquemaPedidoPaginaConsulta,
  EVENTOS_AUDITAVEIS,
  type IndiceConsultas,
  type PaginaConsulta,
  permissaoDaConsulta,
  type RegistroConsulta,
  rotaDaConsulta,
  TETO_PAGINA_CONSULTA,
  type ValorCampo,
} from '@sgh/contratos';
import {
  codificarCursor,
  codigoDoRegistro,
  decodificarCursor,
  ErroFiltroConsulta,
  filtroAtendeTabelaGrande,
  gerarCsvConsulta,
  lerFiltros,
  mascarar,
  valoresDoCodigo,
} from '@sgh/dominio-config';
import { filtroDeEscopo, pode } from '@sgh/dominio-acesso';
import { ErroTempoEsgotado } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { colunasDescritas, type DeclaracaoConsulta, ErroConsulta, ErroEscopo } from './declaracao.js';
import { type CtxConsulta, FONTE_CONSULTAS, type FonteConsultas, tabelaDaConsulta } from './fonte.js';

interface RespostaCsv {
  header(nome: string, valor: string): RespostaCsv;
}

/** Erro da leitura → Problem Details em português (sem nome de tabela). */
export function problemaDaConsulta(e: unknown): ErroProblema {
  if (e instanceof ErroProblema) return e;
  // Correção do M14: escopo restrito sem coluna na consulta (falha fechado, como no CRUD genérico).
  if (e instanceof ErroEscopo)
    return new ErroProblema(
      'sem-permissao',
      403,
      'Fora do seu escopo',
      'Seu acesso é restrito e esta consulta não separa os dados por esse escopo.',
    );
  if (e instanceof ErroFiltroConsulta)
    return new ErroProblema('entrada-invalida', 400, 'Filtro inválido', e.message, { campos: [...e.campos] });
  if (e instanceof ErroConsulta) {
    if (e.codigo === 'sem-filtro')
      return new ErroProblema('recusa-de-negocio', 422, 'Filtre a consulta', e.message, { codigo: e.codigo });
    if (e.codigo === 'exportacao-grande')
      return new ErroProblema('recusa-de-negocio', 409, 'Exportação grande demais', e.message, {
        codigo: e.codigo,
      });
    if (e.codigo === 'sem-chave')
      return new ErroProblema('recusa-de-negocio', 409, 'Registro sem chave', e.message, {
        codigo: e.codigo,
      });
    return new ErroProblema('entrada-invalida', 400, 'Pedido inválido', e.message, { codigo: e.codigo });
  }
  if (e instanceof ErroTempoEsgotado)
    return new ErroProblema(
      'indisponivel',
      503,
      'Consulta cancelada pelo limite de tempo',
      'A consulta passou do tempo limite e foi cancelada: filtre mais (período ou código).',
      { codigo: 'tempo-esgotado' },
    );
  throw e;
}

@Controller('consultas')
export class ConsultasController {
  constructor(
    @Inject(FONTE_CONSULTAS) private readonly fonte: FonteConsultas,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
  ) {}

  private sessao(req: RequisicaoAutorizada) {
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const hospital = a.sessao.estabelecimentoAtivo;
    if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
    return { a, hospital, rede: a.sessao.rede ?? '', login: a.sessao.usuario.login ?? a.sessao.usuario.id };
  }

  /** Contexto da leitura (sem o escopo): o estabelecimento e o usuário da sessão por id, quando conhecidos. */
  private base(req: RequisicaoAutorizada): CtxConsulta {
    const s = sessaoDe(req);
    return {
      rede: s.rede,
      hospital: s.hospital,
      estabelecimento: s.porta.estabelecimento,
      usuario: s.porta.usuario,
      correlacao: s.porta.correlacao,
    };
  }

  /** Contexto da leitura com o escopo do M06 da sessão para a permissão desta consulta. */
  private ctx(req: RequisicaoAutorizada, d: DeclaracaoConsulta): CtxConsulta {
    return {
      ...this.base(req),
      escopo: filtroDeEscopo(permissaoDaConsulta(d.publico, 'ler'), req.sgh?.sessao.escopos),
    };
  }

  /** A parte pública da consulta (404 quando não existe ou quando nenhuma tabela do modelo a atende). */
  private publica(modulo: string, recurso: string): ConsultaPublica {
    const p =
      /^[a-z]+$/.test(modulo) && /^[a-z][A-Za-z0-9]{1,60}$/.test(recurso)
        ? consultaPublica(modulo, recurso)
        : undefined;
    if (!p || !tabelaDaConsulta(p)) throw new ErroProblema('nao-encontrado', 404, 'Consulta não encontrada');
    return p;
  }

  /** A permissão primeiro (a negação vai à trilha); depois, a declaração física lida do banco. */
  private async consulta(
    req: RequisicaoAutorizada,
    modulo: string,
    recurso: string,
    acao: 'ler' | 'exportar',
  ): Promise<DeclaracaoConsulta> {
    const p = this.publica(modulo, recurso);
    await this.exigir(req, p, acao);
    let d: DeclaracaoConsulta | null;
    try {
      d = await this.fonte.declaracao(this.base(req), p);
    } catch (e) {
      throw problemaDaConsulta(e);
    }
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Consulta não encontrada');
    return d;
  }

  private podeConsultar(req: RequisicaoAutorizada, p: ConsultaPublica, acao: 'ler' | 'exportar'): boolean {
    return pode(this.sessao(req).a.ability, permissaoDaConsulta(p, acao));
  }

  private async exigir(req: RequisicaoAutorizada, p: ConsultaPublica, acao: 'ler' | 'exportar'): Promise<void> {
    if (this.podeConsultar(req, p, acao)) return;
    const { hospital, rede, login } = this.sessao(req);
    await this.trilha
      .registrar({
        evento: EVENTOS_AUDITAVEIS.permissaoNegada.codigo,
        rede,
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'negada'),
        recurso: permissaoDaConsulta(p, acao).slice(0, 80),
        resultado: 'falha',
      })
      .catch(() => undefined);
    throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta consulta.');
  }

  private descrever(req: RequisicaoAutorizada, d: DeclaracaoConsulta): ConsultaDescrita {
    return {
      modulo: d.publico.modulo,
      recurso: d.publico.recurso,
      rotulo: d.publico.rotulo,
      item: d.publico.item,
      fase: d.publico.fase,
      classe: d.publico.classe,
      grande: d.publico.grande,
      rota: rotaDaConsulta(d.publico),
      colunas: colunasDescritas(d),
      exigeFiltro: d.publico.grande,
      permitidas: (['ler', 'exportar'] as const).filter((a) => this.podeConsultar(req, d.publico, a)),
      exportarExigeJustificativa: d.publico.classe !== 'comum',
    };
  }

  /** Evento da leitura auditada (dado de pessoa ou clínico); sem trilha, sem dado. */
  private async auditar(
    req: RequisicaoAutorizada,
    d: DeclaracaoConsulta,
    evento: string,
    idAlvo: string,
    chaveNatural: string,
  ): Promise<void> {
    const { rede, hospital, login } = this.sessao(req);
    try {
      await this.trilha.registrar({
        evento,
        rede,
        hospital,
        usuario: login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'consulta'),
        recurso: `${d.publico.modulo}.${d.publico.recurso}`.slice(0, 80),
        resultado: 'sucesso',
        idAlvo: idAlvo.slice(0, 120),
        chaveNaturalAlvo: chaveNatural.slice(0, 200),
      });
    } catch {
      throw new ErroProblema(
        'trilha-indisponivel',
        503,
        'Trilha de auditoria indisponível',
        'A leitura não foi feita porque não pôde ser registrada.',
      );
    }
  }

  private mascarados(d: DeclaracaoConsulta, linhas: readonly Record<string, ValorCampo>[]) {
    const campos = d.colunas.filter((c) => c.mascarada).map((c) => c.campo);
    if (campos.length === 0) return [...linhas];
    return linhas.map((l) => ({
      ...l,
      ...Object.fromEntries(campos.map((c) => [c, mascarar(l[c] ?? null)])),
    }));
  }

  @Get()
  @Permissao('config.consulta.ler')
  indice(@Query('item') item: string | undefined, @Req() req: RequisicaoAutorizada): IndiceConsultas {
    return {
      consultas: CONSULTAS_DECLARADAS.filter(
        (p) => tabelaDaConsulta(p) !== null && (!item || p.item === item) && this.podeConsultar(req, p, 'ler'),
      ).map((p) => ({
        modulo: p.modulo,
        recurso: p.recurso,
        rotulo: p.rotulo,
        item: p.item,
        fase: p.fase,
        classe: p.classe,
        grande: p.grande,
        rota: rotaDaConsulta(p),
      })),
    };
  }

  /** Correção do M14: as justificativas de exportação ativas, para quem exporta qualquer consulta. */
  @Get('justificativas')
  @Permissao('config.consulta.ler')
  async justificativasExportacao(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ justificativas: { codigo: number; descricao: string }[] }> {
    try {
      return { justificativas: [...(await this.fonte.justificativas(this.base(req)))] };
    } catch (e) {
      throw problemaDaConsulta(e);
    }
  }

  @Get(':modulo/:recurso')
  @Permissao('config.consulta.ler')
  async descricao(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConsultaDescrita> {
    const d = await this.consulta(req, m, r, 'ler');
    return this.descrever(req, d);
  }

  @Get(':modulo/:recurso/linhas')
  @Permissao('config.consulta.ler')
  @AuditadoNoHandler(
    'consulta clínica: o evento da lista vai à trilha antes da resposta (sem trilha, sem dado)',
  )
  async linhas(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaConsulta> {
    const d = await this.consulta(req, m, r, 'ler');
    const p = esquemaPedidoPaginaConsulta.safeParse(q);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Consulta inválida');
    this.sessao(req);
    try {
      const filtros = lerFiltros(p.data, colunasDescritas(d));
      if (d.publico.grande && !filtroAtendeTabelaGrande(filtros))
        throw new ErroConsulta(
          'sem-filtro',
          'Esta tabela é grande: informe um período ou um código indexado antes de consultar.',
        );
      const porPagina = Math.min(p.data.porPagina ?? 50, TETO_PAGINA_CONSULTA);
      const apos = p.data.apos ? decodificarCursor(p.data.apos, d.chave.length || 1) : null;
      const c = this.ctx(req, d);
      const [pagina, contagem] = await Promise.all([
        this.fonte.pagina(c, d, filtros, apos, porPagina),
        this.fonte.contar(c, d, filtros),
      ]);
      if (d.publico.classe === 'clinica')
        await this.auditar(
          req,
          d,
          EVENTOS_AUDITAVEIS.registrosListados.codigo,
          String(pagina.linhas.length),
          `consulta:${d.publico.recurso};filtros:${filtros.length}`,
        );
      return {
        itens: this.mascarados(d, pagina.linhas),
        proxima: pagina.proxima ? codificarCursor(pagina.proxima) : null,
        contagem,
        porPagina,
      };
    } catch (e) {
      throw problemaDaConsulta(e);
    }
  }

  @Get(':modulo/:recurso/registro/:codigo')
  @Permissao('config.consulta.ler')
  @AuditadoNoHandler('dado de pessoa ou clínico: o evento de abertura vai à trilha antes da resposta')
  async registro(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RegistroConsulta> {
    const d = await this.consulta(req, m, r, 'ler');
    if (codigo.length > 200) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
    this.sessao(req);
    try {
      const chave = valoresDoCodigo(codigo, d.chave.length || 1);
      const valores = await this.fonte.registro(this.ctx(req, d), d, chave);
      if (!valores) throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado');
      if (d.publico.classe === 'clinica')
        await this.auditar(
          req,
          d,
          EVENTOS_AUDITAVEIS.registroLido.codigo,
          codigo,
          `consulta:${d.publico.recurso}`,
        );
      else if (d.publico.classe === 'pessoal')
        await this.auditar(
          req,
          d,
          EVENTOS_AUDITAVEIS.consultaRegistroAberto.codigo,
          codigo,
          `consulta:${d.publico.recurso}`,
        );
      return { chave: codigoDoRegistro(chave), valores };
    } catch (e) {
      throw problemaDaConsulta(e);
    }
  }

  @Post(':modulo/:recurso/exportar')
  @HttpCode(200)
  @Permissao('config.consulta.ler')
  @AuditadoNoHandler('trilha própria registrada antes de a resposta sair (sem trilha, sem dado)')
  async exportar(
    @Param('modulo') m: string,
    @Param('recurso') r: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaCsv,
  ): Promise<string> {
    // Permissão de exportar ANTES de qualquer leitura (a negação vai à trilha).
    const d = await this.consulta(req, m, r, 'exportar');
    const p = esquemaPedidoExportacaoConsulta.safeParse(corpo ?? {});
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    try {
      const exige = d.publico.classe !== 'comum';
      if (exige) {
        const validas = new Set((await this.fonte.justificativas(this.base(req))).map((j) => j.codigo));
        if (p.data.justificativa === undefined || !validas.has(p.data.justificativa))
          throw new ErroProblema(
            'entrada-invalida',
            400,
            'Justificativa obrigatória',
            'Escolha a justificativa da exportação.',
            {
              codigo:
                p.data.justificativa === undefined
                  ? 'justificativa-obrigatoria'
                  : 'justificativa-inexistente',
            },
          );
      }
      const filtros = lerFiltros(
        Object.fromEntries(Object.entries(p.data.filtros).map(([k, v]) => [k, v])),
        colunasDescritas(d),
      );
      if (d.publico.grande && !filtroAtendeTabelaGrande(filtros))
        throw new ErroConsulta('sem-filtro', 'Esta tabela é grande: filtre antes de exportar.');
      const linhas = await this.fonte.exportar(this.ctx(req, d), d, filtros);
      await this.auditar(
        req,
        d,
        EVENTOS_AUDITAVEIS.consultaExportada.codigo,
        String(linhas.length),
        `${exige ? `justificativa:${String(p.data.justificativa)};` : ''}filtros:${filtros.length};linhas:${linhas.length}`,
      );
      res.header('content-type', 'text/csv; charset=utf-8');
      res.header('content-disposition', `attachment; filename="${d.publico.recurso}.csv"`);
      return `\uFEFF${gerarCsvConsulta(colunasDescritas(d), this.mascarados(d, linhas))}`;
    } catch (e) {
      throw problemaDaConsulta(e);
    }
  }
}
