// Administração › Auditoria e privacidade (M10, ficha seções 4, 7 e regra 12; cap-08 §8.12, §8.13):
//   GET  /api/administracao/auditoria/trilha              as duas trilhas em ordem cronológica (até 31 dias)
//   GET  /api/administracao/auditoria/trilha/exportar     CSV, XML ou HTML (só o papel Auditor)
//   GET  /api/administracao/auditoria/trilha/exportar-sbis  CSV ou XML para a auditoria SBIS (M59-F5): identificação do
//        software e do estabelecimento (nome, CNES, CNPJ) e a prova da cadeia de hash do período
//   GET  /api/administracao/auditoria/leituras-prontuario  quem viu o prontuário (trilha própria com paciente;
//        a rota /acessos-prontuario e a tela são do registro de acesso do M15: D-INTEG-1 da integração na fase0)
//   GET  /api/administracao/auditoria/exclusoes           exclusões e históricos (contagens) e conexões
//   GET  /api/administracao/auditoria/exclusoes/:chave    as linhas de um tipo (período, usuário, 500 por página)
//   GET  /api/administracao/auditoria/conexoes            conexões ao banco por módulo (período, usuário, 500)
//   GET  /api/administracao/privacidade/pedidos           pedidos do titular (SGH_AUD_PEDIDO_TITULAR)
//   POST /api/administracao/privacidade/pedidos           registrar
//   POST /api/administracao/privacidade/pedidos/:id       confirmar identidade, atender ou negar (com fundamento)
// Toda abertura da trilha é evento auditado; o período é obrigatório e vai até 31 dias (mais que isso, a cópia
// diária, que esta tela não consulta). A consulta pagina até 20 páginas de 500 (10.000 eventos): a página além
// disso é recusada com o pedido de refinar o filtro, e a última avisa que o período tem mais (cortado). A
// exportação leva o período inteiro até esse teto e diz no arquivo quando cortou; no CSV, valor que começa por
// = + - @ tab ou CR ganha um apóstrofo na frente (nenhuma fórmula roda na planilha do Auditor).
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  esquemaConsultaRegistros,
  esquemaConsultaTrilha,
  esquemaRegistrarPedido,
  esquemaTratarPedido,
  EVENTOS_AUDITAVEIS,
  type Exclusoes,
  FORMATOS_EXPORTACAO_TRILHA,
  type LinhaTrilha,
  type ListaPedidos,
  PAGINAS_MAXIMAS_TRILHA,
  type PaginaAcessosProntuario,
  type PaginaConexoes,
  type PaginaExclusoes,
  type PaginaTrilha,
  PERMISSOES_ACESSO,
  PERMISSOES_M10_CODIGOS,
  TETO_EXPORTACAO_TRILHA,
  TETO_PAGINA_TRILHA,
} from '@sgh/contratos';
import {
  conferirPeriodo,
  conferirTransicao,
  fimExclusivo,
  mensagemPeriodo,
  mensagemTransicao,
  pedidoAtrasado,
  PRAZO_DIAS,
  type TransicaoPedido,
} from '@sgh/dominio-acesso';
import { type LinhaTrilhaLida, type PedidoTitularLido, REGISTROS_AUDITORIA } from '@sgh/legado';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { analisar, ctxDe, problema, sessaoDe, trilhaDe } from './comum.js';
import { type Ctx, FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { exportarTrilhaSbis } from './sbis/exportacao.js';
import { SERVICO_SBIS, type ServicoSbis } from './sbis/servico.js';

const C = PERMISSOES_M10_CODIGOS;
/** A junção das duas trilhas pagina em memória até esta página (20 × 500 linhas de cada lado). */
const PAGINAS_MAXIMAS = PAGINAS_MAXIMAS_TRILHA;
const MENSAGEM_REFINAR =
  'A consulta mostra até 10.000 eventos (20 páginas de 500). Refine o filtro: usuário, evento ou período menor.';

/** Página pedida dentro do limite; além dele, 400 com o pedido de refinar o filtro. */
function paginaPermitida(pagina: number | undefined): number {
  const p = pagina ?? 1;
  if (p > PAGINAS_MAXIMAS)
    throw new ErroProblema('entrada-invalida', 400, 'Página além do limite', MENSAGEM_REFINAR, {
      codigo: 'pagina-alem-do-limite',
    });
  return p;
}

/** CSV injection (OWASP): valor que começa por fórmula ganha um apóstrofo na frente. */
export function celulaCsv(v: string): string {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${seguro.replace(/"/g, '""')}"`;
}

function linhaTela(x: LinhaTrilhaLida): LinhaTrilha {
  return { ...x };
}

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COLUNAS: readonly (keyof LinhaTrilha)[] = [
  'origem',
  'dataHora',
  'usuario',
  'acao',
  'opcao',
  'criticidade',
  'estacao',
  'alvo',
  'paciente',
  'resultado',
  'atorReal',
];

/** Aviso posto no arquivo quando o período passou do teto da exportação. */
export const avisoCorte = (teto: number) =>
  `Exportação cortada em ${teto.toLocaleString('pt-BR')} eventos (os mais recentes do período): refine o filtro para exportar o restante.`;

/** CSV (separador ;, aspas duplas, sem fórmula), XML e HTML do período exportado; o corte vai no arquivo. */
export function exportarTrilha(
  linhas: readonly LinhaTrilha[],
  formato: (typeof FORMATOS_EXPORTACAO_TRILHA)[number],
  corte: { cortado: boolean; teto: number } = { cortado: false, teto: TETO_EXPORTACAO_TRILHA },
): string {
  const valor = (l: LinhaTrilha, k: keyof LinhaTrilha) =>
    l[k] === null || l[k] === undefined ? '' : String(l[k]);
  const aviso = corte.cortado ? avisoCorte(corte.teto) : null;
  if (formato === 'csv')
    return [
      COLUNAS.join(';'),
      ...linhas.map((l) => COLUNAS.map((k) => celulaCsv(valor(l, k))).join(';')),
      ...(aviso ? [celulaCsv(`# ${aviso}`)] : []),
    ].join('\r\n');
  if (formato === 'xml')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<trilha cortada="${corte.cortado}" teto="${corte.teto}">\n${
      aviso ? `  <aviso>${escapar(aviso)}</aviso>\n` : ''
    }${linhas
      .map((l) => `  <evento>${COLUNAS.map((k) => `<${k}>${escapar(valor(l, k))}</${k}>`).join('')}</evento>`)
      .join('\n')}\n</trilha>\n`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Trilha de auditoria</title></head><body>${
    aviso ? `<p role="note">${escapar(aviso)}</p>` : ''
  }<table><thead><tr>${COLUNAS.map((k) => `<th scope="col">${k}</th>`).join('')}</tr></thead><tbody>${linhas
    .map((l) => `<tr>${COLUNAS.map((k) => `<td>${escapar(valor(l, k))}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></body></html>`;
}

@Controller('administracao')
export class AuditoriaController {
  constructor(
    @Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao,
    @Optional() @Inject(SERVICO_SBIS) private readonly sbis: ServicoSbis | null = null,
  ) {}

  private async periodo(c: Ctx, inicio?: string, fim?: string) {
    const hoje = await this.fonte.hoje(c).catch((e: unknown) => problema(e));
    const p = conferirPeriodo(inicio, fim, hoje);
    if (!p.ok)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', mensagemPeriodo(p.falha), {
        codigo: `periodo-${p.falha}`,
      });
    return p.periodo;
  }

  /** O prontuário digitado vira o ID do paciente (o filtro da trilha é pelo ID); nenhum, 404; repetido, 409. */
  private async pacienteDoFiltro(
    c: Ctx,
    f: { paciente?: number | undefined; prontuario?: number | undefined },
  ): Promise<number | undefined> {
    if (f.prontuario === undefined) return f.paciente;
    const ids = await this.fonte.pacientesDoProntuario(c, f.prontuario).catch((e: unknown) => problema(e));
    if (ids.length === 0)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Prontuário não encontrado',
        'Nenhum paciente com este prontuário.',
        {
          codigo: 'prontuario-inexistente',
        },
      );
    if (ids.length > 1)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Prontuário repetido',
        'Há mais de um cadastro com este prontuário: confira o cadastro do paciente.',
        { codigo: 'prontuario-repetido' },
      );
    return ids[0];
  }

  /**
   * As duas trilhas do período, mais recentes primeiro: a página pedida (`pagina`) ou, na exportação, todas as
   * linhas até o teto (`ate`). `cortado` diz que o período tem mais do que o mostrado no limite.
   */
  private async consultar(
    req: RequisicaoAutorizada,
    q: Record<string, string>,
    porPagina: number,
    exportar = false,
  ) {
    const f = analisar(esquemaConsultaTrilha, q);
    const c = ctxDe(req, 'auditoria-trilha');
    const periodo = await this.periodo(c, f.inicio, f.fim);
    const pagina = exportar ? 1 : paginaPermitida(f.pagina);
    const quantas = exportar ? TETO_EXPORTACAO_TRILHA : porPagina;
    const limite = exportar ? TETO_EXPORTACAO_TRILHA + 1 : pagina * porPagina + 1;
    const paciente = await this.pacienteDoFiltro(c, f);
    const filtro = {
      hospital: c.hospital,
      inicio: periodo.inicio,
      fimExclusivo: fimExclusivo(periodo.fim),
      limite,
      ...(f.usuario ? { usuario: f.usuario } : {}),
      ...(f.tipo !== undefined ? { tipo: f.tipo } : {}),
      ...(f.evento ? { evento: f.evento } : {}),
      ...(paciente !== undefined ? { paciente } : {}),
    };
    const origem = f.origem ?? 'todas';
    const inicio = performance.now();
    const [legado, novo] = await Promise.all([
      origem !== 'novo' && !f.evento ? this.fonte.trilhaLegado(c, filtro) : Promise.resolve([]),
      origem !== 'legado' && f.tipo === undefined ? this.fonte.trilhaPropria(c, filtro) : Promise.resolve([]),
    ]).catch((e: unknown) => problema(e));
    const todas = [...legado, ...novo].sort(
      (a, b) => b.dataHora.localeCompare(a.dataHora) || b.id.localeCompare(a.id),
    );
    const ini = (pagina - 1) * porPagina;
    const haMais = todas.length > ini + quantas;
    // Na última página permitida, "próxima" some e o corte é avisado (a página 21 seria recusada).
    const ultima = exportar || pagina >= PAGINAS_MAXIMAS;
    return {
      itens: todas.slice(ini, ini + quantas).map(linhaTela),
      pagina,
      porPagina,
      temMais: haMais && !ultima,
      cortado: haMais && ultima,
      periodo,
      tempoMs: Math.round(performance.now() - inicio),
      c,
    };
  }

  @Get('auditoria/trilha')
  @Permissao(PERMISSOES_ACESSO.trilhaLer)
  @Auditar(EVENTOS_AUDITAVEIS.trilhaConsultada.codigo)
  async trilha(@Req() req: RequisicaoAutorizada, @Query() q: Record<string, string>): Promise<PaginaTrilha> {
    const r = await this.consultar(req, q, TETO_PAGINA_TRILHA);
    const tipos = await this.fonte.tiposAcao(r.c).catch(() => []);
    return {
      itens: r.itens,
      pagina: r.pagina,
      porPagina: r.porPagina,
      temMais: r.temMais,
      cortado: r.cortado,
      periodo: r.periodo,
      tipos,
      tempoMs: r.tempoMs,
      destino: this.fonte.destino,
    };
  }

  @Get('auditoria/trilha/exportar')
  @Permissao(C.trilhaExportar)
  @Auditar(EVENTOS_AUDITAVEIS.trilhaExportada.codigo)
  @Header('Cache-Control', 'no-store')
  async exportar(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<string> {
    const formato = (q['formato'] ?? 'csv') as (typeof FORMATOS_EXPORTACAO_TRILHA)[number];
    if (!(FORMATOS_EXPORTACAO_TRILHA as readonly string[]).includes(formato))
      throw new ErroProblema('entrada-invalida', 400, 'Formato inválido', 'Escolha CSV, XML ou HTML.');
    const { formato: _f, ...resto } = q;
    void _f;
    const r = await this.consultar(req, resto, TETO_PAGINA_TRILHA, true);
    const tipo = formato === 'csv' ? 'text/csv' : formato === 'xml' ? 'application/xml' : 'text/html';
    res.header('content-type', `${tipo}; charset=utf-8`);
    res.header('x-trilha-cortada', r.cortado ? 'sim' : 'nao');
    res.header(
      'content-disposition',
      `attachment; filename="trilha-${r.periodo.inicio}-${r.periodo.fim}.${formato}"`,
    );
    return exportarTrilha(r.itens, formato, { cortado: r.cortado, teto: TETO_EXPORTACAO_TRILHA });
  }

  @Get('auditoria/trilha/exportar-sbis')
  @Permissao(C.trilhaExportar)
  @Auditar(EVENTOS_AUDITAVEIS.trilhaSbisExportada.codigo)
  @Header('Cache-Control', 'no-store')
  async exportarSbis(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<string> {
    if (!this.sbis) throw new ErroProblema('indisponivel', 503, 'Serviço indisponível');
    const formato = q['formato'] ?? 'csv';
    if (formato !== 'csv' && formato !== 'xml')
      throw new ErroProblema('entrada-invalida', 400, 'Formato inválido', 'Escolha CSV ou XML.');
    const { formato: _f, ...resto } = q;
    void _f;
    const r = await this.consultar(req, resto, TETO_PAGINA_TRILHA, true);
    const s = sessaoDe(req);
    const { identificacao, prova } = await this.sbis.identificacaoEProva(
      {
        rede: s.rede,
        hospital: s.hospital,
        login: s.login,
        estacao: estacaoDaRequisicao(req).slice(0, 80) || null,
        correlacao: correlacaoDaRequisicao(req, 'auditoria-trilha-sbis'),
      },
      r.periodo.inicio,
      r.periodo.fim,
    );
    res.header('content-type', `${formato === 'csv' ? 'text/csv' : 'application/xml'}; charset=utf-8`);
    res.header('x-trilha-cortada', r.cortado ? 'sim' : 'nao');
    res.header('x-cadeia-integra', prova.integra ? 'sim' : 'nao');
    res.header(
      'content-disposition',
      `attachment; filename="trilha-sbis-${r.periodo.inicio}-${r.periodo.fim}.${formato}"`,
    );
    return exportarTrilhaSbis(r.itens, formato, identificacao, prova, {
      cortado: r.cortado,
      teto: TETO_EXPORTACAO_TRILHA,
    });
  }

  @Get('auditoria/leituras-prontuario')
  @Permissao(C.acessoProntuarioLer)
  @Auditar(EVENTOS_AUDITAVEIS.acessoProntuarioConsultado.codigo)
  async acessos(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<PaginaAcessosProntuario> {
    const f = analisar(esquemaConsultaTrilha, q);
    const c = ctxDe(req, 'auditoria-acessos');
    const periodo = await this.periodo(c, f.inicio, f.fim);
    const pagina = paginaPermitida(f.pagina);
    const paciente = await this.pacienteDoFiltro(c, f);
    const linhas = await this.fonte
      .acessosProntuario(c, {
        hospital: c.hospital,
        inicio: periodo.inicio,
        fimExclusivo: fimExclusivo(periodo.fim),
        limite: pagina * TETO_PAGINA_TRILHA + 1,
        ...(f.usuario ? { usuario: f.usuario } : {}),
        ...(paciente !== undefined ? { paciente } : {}),
      })
      .catch((e: unknown) => problema(e));
    const ini = (pagina - 1) * TETO_PAGINA_TRILHA;
    const haMais = linhas.length > ini + TETO_PAGINA_TRILHA;
    return {
      itens: linhas.slice(ini, ini + TETO_PAGINA_TRILHA).map((x) => ({
        dataHora: x.dataHora,
        usuario: x.usuario ?? '',
        evento: x.acao,
        paciente: x.paciente,
        prontuario: x.prontuario,
        atendimento: x.atendimento,
        estacao: x.estacao,
        atorReal: x.atorReal,
      })),
      pagina,
      temMais: haMais && pagina < PAGINAS_MAXIMAS,
      cortado: haMais && pagina >= PAGINAS_MAXIMAS,
      periodo,
      destino: this.fonte.destino,
    };
  }

  @Get('auditoria/exclusoes')
  @Permissao(PERMISSOES_ACESSO.trilhaLer)
  @Auditar(EVENTOS_AUDITAVEIS.exclusoesConsultadas.codigo)
  async exclusoes(@Req() req: RequisicaoAutorizada, @Query() q: Record<string, string>): Promise<Exclusoes> {
    const c = ctxDe(req, 'auditoria-exclusoes');
    const periodo = await this.periodo(c, q['inicio'], q['fim']);
    const r = await this.fonte
      .exclusoes(c, periodo.inicio, fimExclusivo(periodo.fim))
      .catch((e: unknown) => problema(e));
    return { periodo, tipos: r.tipos, conexoes: r.conexoes, destino: this.fonte.destino };
  }

  @Get('auditoria/exclusoes/:chave')
  @Permissao(PERMISSOES_ACESSO.trilhaLer)
  @Auditar(EVENTOS_AUDITAVEIS.exclusoesConsultadas.codigo)
  async exclusoesDoTipo(
    @Param('chave') chave: string,
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<PaginaExclusoes> {
    const tipo = REGISTROS_AUDITORIA.find((x) => x.chave === chave);
    if (!tipo) throw new ErroProblema('nao-encontrado', 404, 'Tipo de registro não encontrado');
    const f = analisar(esquemaConsultaRegistros, q);
    const c = ctxDe(req, 'auditoria-exclusoes');
    const periodo = await this.periodo(c, f.inicio, f.fim);
    const pagina = paginaPermitida(f.pagina);
    const linhas = await this.fonte
      .registrosExclusao(c, tipo, {
        inicio: periodo.inicio,
        fimExclusivo: fimExclusivo(periodo.fim),
        pagina,
        porPagina: TETO_PAGINA_TRILHA,
        ...(f.usuario ? { usuario: f.usuario } : {}),
      })
      .catch((e: unknown) => problema(e));
    const haMais = linhas.length > TETO_PAGINA_TRILHA;
    return {
      chave: tipo.chave,
      rotulo: tipo.rotulo,
      comUsuario: tipo.usuario !== null,
      itens: linhas.slice(0, TETO_PAGINA_TRILHA),
      pagina,
      temMais: haMais && pagina < PAGINAS_MAXIMAS,
      cortado: haMais && pagina >= PAGINAS_MAXIMAS,
      periodo,
      destino: this.fonte.destino,
    };
  }

  @Get('auditoria/conexoes')
  @Permissao(PERMISSOES_ACESSO.trilhaLer)
  @Auditar(EVENTOS_AUDITAVEIS.exclusoesConsultadas.codigo)
  async conexoes(
    @Req() req: RequisicaoAutorizada,
    @Query() q: Record<string, string>,
  ): Promise<PaginaConexoes> {
    const f = analisar(esquemaConsultaRegistros, q);
    const c = ctxDe(req, 'auditoria-conexoes');
    const periodo = await this.periodo(c, f.inicio, f.fim);
    const pagina = paginaPermitida(f.pagina);
    const linhas = await this.fonte
      .conexoes(c, {
        inicio: periodo.inicio,
        fimExclusivo: fimExclusivo(periodo.fim),
        pagina,
        porPagina: TETO_PAGINA_TRILHA,
        ...(f.usuario ? { usuario: f.usuario } : {}),
      })
      .catch((e: unknown) => problema(e));
    const haMais = linhas.length > TETO_PAGINA_TRILHA;
    return {
      itens: linhas.slice(0, TETO_PAGINA_TRILHA),
      pagina,
      temMais: haMais && pagina < PAGINAS_MAXIMAS,
      cortado: haMais && pagina >= PAGINAS_MAXIMAS,
      periodo,
      destino: this.fonte.destino,
    };
  }

  // ── Pedidos do titular ─────────────────────────────────────────────────────────────────────────

  @Get('privacidade/pedidos')
  @Permissao(C.lgpdLer)
  @Auditar(EVENTOS_AUDITAVEIS.privacidadeConsultada.codigo)
  async pedidos(@Req() req: RequisicaoAutorizada): Promise<ListaPedidos> {
    const ps = await this.fonte.pedidos(ctxDe(req, 'privacidade')).catch((e: unknown) => problema(e));
    const agora = new Date();
    const itens = ps.map((p) => ({
      id: p.id,
      protocolo: p.protocolo,
      tipo: p.tipo as ListaPedidos['itens'][number]['tipo'],
      canal: p.canal as ListaPedidos['itens'][number]['canal'],
      situacao: p.situacao as ListaPedidos['itens'][number]['situacao'],
      idPaciente: p.idPaciente,
      prontuario: p.prontuario,
      abertoEm: p.abertoEm.toISOString(),
      prazo: p.prazo.toISOString(),
      atrasado: pedidoAtrasado({ situacao: p.situacao as 'aberto', abertoEm: p.abertoEm }, agora),
      identidadeVerificada: p.identidadeVerificada,
      fundamento: p.fundamento as ListaPedidos['itens'][number]['fundamento'],
      decididoPor: p.decididoPor,
      decididoEm: p.decididoEm?.toISOString() ?? null,
      registradoPor: p.registradoPor,
    }));
    return {
      itens,
      abertos: itens.filter((x) => x.situacao === 'aberto' || x.situacao === 'identidade-verificada').length,
      atrasados: itens.filter((x) => x.atrasado).length,
      destino: this.fonte.destino,
    };
  }

  @Post('privacidade/pedidos')
  @HttpCode(201)
  @Permissao(C.pedidoTitularTratar)
  @AuditadoNoHandler(
    'SGH_AUD_PEDIDO_TITULAR e SGH_TRILHA na mesma transação SGH_ (memória: registrador da API)',
  )
  async registrar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = analisar(esquemaRegistrarPedido, corpo);
    const s = sessaoDe(req);
    const r = await this.fonte
      .registrarPedido(
        ctxDe(req, 'privacidade'),
        {
          rede: s.rede,
          hospital: s.hospital,
          ...(p.prontuario !== undefined ? { prontuario: p.prontuario } : {}),
          ...(p.idPaciente !== undefined ? { idPaciente: p.idPaciente } : {}),
          tipo: p.tipo,
          canal: p.canal,
          descricao: p.descricao ?? null,
          por: s.login,
          prazoDias: PRAZO_DIAS,
        },
        trilhaDe(
          req,
          EVENTOS_AUDITAVEIS.pedidoTitularRegistrado.codigo,
          'auditoria.pedidoTitular',
          'auditoria.registrarPedido',
        ),
      )
      .catch((e: unknown) => problema(e));
    return { ...r, destino: this.fonte.destino };
  }

  @Post('privacidade/pedidos/:id')
  @HttpCode(200)
  @Permissao(C.pedidoTitularTratar)
  @AuditadoNoHandler(
    'SGH_AUD_PEDIDO_TITULAR e SGH_TRILHA na mesma transação SGH_ (memória: registrador da API)',
  )
  async tratar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    if (!/^\d{1,20}$/.test(id)) throw new ErroProblema('nao-encontrado', 404, 'Pedido não encontrado');
    const p = analisar(esquemaTratarPedido, corpo);
    const s = sessaoDe(req);
    const transicao: TransicaoPedido =
      p.acao === 'confirmar-identidade'
        ? { para: 'identidade-verificada' }
        : p.acao === 'atender'
          ? { para: 'atendido', ...(p.fundamento ? { fundamento: p.fundamento } : {}) }
          : ({ para: 'negado', fundamento: p.fundamento } as TransicaoPedido);
    const r = await this.fonte
      .tratarPedido(
        ctxDe(req, 'privacidade'),
        {
          id,
          acao: p.acao,
          fundamento: p.fundamento ?? null,
          resposta: p.resposta ?? null,
          por: s.login,
          conferir: (x: PedidoTitularLido) => {
            const rec = conferirTransicao(
              {
                situacao: x.situacao as 'aberto',
                tipo: x.tipo as 'acesso',
                abertoEm: x.abertoEm,
                identidadeVerificada: x.identidadeVerificada,
              },
              transicao,
            );
            return rec ? mensagemTransicao(rec) : null;
          },
        },
        trilhaDe(
          req,
          EVENTOS_AUDITAVEIS.pedidoTitularTratado.codigo,
          'auditoria.pedidoTitular',
          'auditoria.tratarPedido',
        ),
      )
      .catch((e: unknown) => problema(e));
    return { ...r, destino: this.fonte.destino };
  }
}
