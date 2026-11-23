// Manutenção e engenharia clínica (M55, etapa 1; ficha, seção 7: "Abrir e acompanhar OS" e "Equipamentos e
// preventiva"; regras 1 a 3):
//   GET  /api/manutencao/apoio                       setores, unidades, os setores da pessoa, SLA, o que ela pode e a liberação
//   GET  /api/manutencao/os                          página de OS (quem só abre vê as que abriu e as dos seus setores)
//   GET  /api/manutencao/os/:id                      detalhe com os dois prazos, o histórico, as ações e o alerta
//   GET  /api/manutencao/os/:id/documento            a OS em PDF/A (Gotenberg), relida
//   POST /api/manutencao/os                          abrir (corretiva ou predial; pelo equipamento ou pelo código do QR)
//   POST /api/manutencao/os/:id/{assumir,andamento,concluir,encerrar,cancelamento}
//   GET  /api/manutencao/equipamentos                página de equipamentos (com os planos vencidos)
//   GET  /api/manutencao/equipamentos/busca?termo=   o combo da abertura (quem abre a OS)
//   GET  /api/manutencao/equipamentos/codigo/:codigo o equipamento pelo QR da etiqueta
//   GET  /api/manutencao/equipamentos/pgts/documento  o PGTS (RDC 509) do cadastro em PDF/A (W0-08, M3)
//   GET  /api/manutencao/equipamentos/:id            ficha, com o recurso de agenda, as coberturas e os planos
//   GET  /api/manutencao/equipamentos/:id/laudo/:execucao  o laudo da execução do plano em PDF/A, relido
//   POST /api/manutencao/equipamentos                cadastrar;  POST /api/manutencao/equipamentos/:id  alterar
//   GET  /api/manutencao/bens?termo=                 bens do patrimônio para ligar ao equipamento (conferido ao gravar)
//   GET  /api/manutencao/recursos?tipo=              recursos de agenda (agenda de consultas, de exames, sala cirúrgica)
//   GET  /api/manutencao/fornecedores?termo=         fornecedores (contrato de manutenção)
//   GET  /api/manutencao/plano/painel                o painel (vencidas, a vencer, em dia)
//   GET  /api/manutencao/plano/:id/execucoes         as execuções do plano
//   POST /api/manutencao/plano                       planejar;  POST /api/manutencao/plano/:id/ativo  ativar ou desativar
//   PUT  /api/manutencao/plano/:id                   W0-08: alterar pela versão lida, com motivo (409 em versão velha)
//   GET  /api/manutencao/plano/:id                   W0-08: o plano como está, com as versões anteriores
//   GET  /api/manutencao/plano/:id/versoes           W0-08: as versões anteriores do plano, com o motivo
//   POST /api/manutencao/plano/:id/execucao          registrar a execução (reprovada: a corretiva e a parada juntas)
//   GET  /api/manutencao/coberturas                  contratos de manutenção;  POST /api/manutencao/coberturas
//   GET  /api/manutencao/coberturas/:id              W0-08: o contrato com as versões anteriores
//   PUT  /api/manutencao/coberturas/:id              W0-08: alterar pela versão lida (vigência, SLA, valor, equipamentos)
//   POST /api/manutencao/coberturas/:id/encerramento W0-08: encerrar com motivo e data
//   POST /api/manutencao/coberturas/:id/exclusao     W0-08: excluir o registrado por engano (409 com os vínculos)
//   GET  /api/manutencao/indicadores?inicio&fim      disponibilidade, MTBF e MTTR com as parcelas
// As gravações exigem a chave `manutencao` no estabelecimento (POL-3) e vão só para tabelas da manutenção com a trilha de auditoria na mesma
// transação; a consulta segue com a chave desligada (D-LIB-551). O equipamento crítico parado avisa o setor (central
// de avisos, na mesma transação) e só PROPÕE o bloqueio da agenda pela operação que já existe (D-BLOQ-55).
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AlertaEquipamento,
  type AlertaEquipamentoDetalhe,
  type ApoioManutencao,
  type CursoDoModelo,
  esquemaAlterarAlertaEquipamento,
  esquemaDesvincularCursoModelo,
  esquemaRegistrarEventoCiclo,
  esquemaVincularCursoModelo,
  type EventoCicloVida,
  type IndiceObsolescencia,
  type OperadoresDoModelo,
  esquemaEncerrarAlertaEquipamento,
  esquemaExcluirAlertaEquipamento,
  esquemaGerarAcaoDeCampo,
  esquemaQueixaDaOs,
  esquemaRegistrarAlertaEquipamento,
  type ResultadoAcaoDeCampo,
  type SituacaoAlertaEquipamento,
  type BemDoEquipamento,
  CHAVE_LIBERACAO_MANUTENCAO,
  chaveParametroSla,
  CODIGOS_PRIORIDADE_OS,
  CODIGOS_TIPO_RECURSO_AGENDA,
  type ContratoManutencao,
  type ContratoManutencaoDetalhe,
  type EquipamentoDetalhe,
  type EquipamentoPeloCodigo,
  type EquipamentoResumo,
  esquemaAbrirOs,
  esquemaAlterarEquipamento,
  esquemaAndamentoOs,
  esquemaAssumirOs,
  esquemaCadastrarEquipamento,
  esquemaCancelarOs,
  esquemaCodigoEquipamento,
  esquemaConcluirOs,
  esquemaCoberturaContrato,
  esquemaAlterarContratoManutencao,
  esquemaEncerrarContratoManutencao,
  esquemaExcluirContratoManutencao,
  esquemaAlterarPlano,
  esquemaCorrigirOs,
  esquemaEncerrarOs,
  esquemaFiltroEquipamentos,
  esquemaFiltroOs,
  esquemaPeriodoIndicadores,
  esquemaPlanejarManutencao,
  esquemaRegistrarExecucao,
  esquemaInstalarModeloPlano,
  esquemaRelatorioPmoc,
  CODIGOS_MODELO_PLANO,
  MODELOS_PLANO_INFRA,
  type CodigoModeloPlano,
  type ModeloPlanoInfra,
  responsavelPmocDe,
  type AtividadePlano,
  EVENTOS_AUDITAVEIS,
  type ExecucaoPlano,
  type VersaoPlano,
  type PlanoDetalhe,
  type IndicadoresManutencao,
  type ItemPlanoPainel,
  type OsDetalhe,
  type OsNoLeito,
  type OsResumo,
  type PaginaManutencao,
  type PainelPlano,
  PERMISSOES_MANUTENCAO_CODIGOS as P,
  type PrioridadeOs,
  type ResultadoManutencao,
  SLA_PADRAO,
  type SlaPrioridade,
  TIPOS_EVENTO_CICLO,
  type TipoRecursoAgenda,
  lerIdBanco,
} from '@sgh/contratos';
import {
  alertaDeParada,
  type AcaoOs,
  conferirAcionamento,
  operadoresDoModelo,
  planejarAbertura,
  planejarAcao,
  planejarCorrecao,
  planejarExecucao,
  type QuemAge,
} from '@sgh/dominio-manutencao';
import {
  type CoberturaManutencao,
  type EquipamentoManutencao,
  type EquipamentoParaGravar,
  type OrdemServico,
  type PlanoManutencao,
  recusaCicloVida,
  type SetorManutencao,
} from './tipos.js';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { INTEGRACAO_OS_LEITO, type IntegracaoOsLeito } from '../adt/os-leito.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { PORTA_PATRIMONIO, type PortaPatrimonio } from '../patrimonio/public-api.js';
import { chaveDoModelo, conferirEvento, inicioDaJanela, montarIndice, montarPgts } from './ciclo-vida.js';
import { htmlLaudoExecucao, htmlOrdemServico, htmlPgts, htmlPmoc } from './documentos.js';
import { conferirInstalacaoModelo, conferirPeriodoPmoc, montarPmoc } from './pmoc.js';
import {
  type CursoDoCatalogo,
  type GravadorManutencao,
  PORTA_MANUTENCAO,
  type PortaManutencao,
} from './porta.js';
import {
  afetados,
  conferirAlteracaoDoAlerta,
  conferirFaixaDoAlerta,
  planejarAcaoDoAlerta,
} from './tecnovigilancia.js';
import {
  centavos,
  detalheEquipamento,
  detalheOs,
  indicadores,
  type Nomes,
  osParaAcao,
  painelDoPlano,
  peloCodigo,
  resumoCobertura,
  resumoEquipamento,
  resumoOs,
  vencidosPorEquipamento,
} from './servico.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'manutencao';
/** O PGTS lê o parque inteiro, em páginas, até este teto de equipamentos. */
const TETO_PGTS = 2000;

interface Parametros {
  readonly sla: Readonly<Record<PrioridadeOs, SlaPrioridade>>;
  readonly antecedenciaDias: number;
  readonly aceiteHoras: number;
}

function recusada(codigo: string, mensagem: string, campos?: readonly string[]): ErroProblema {
  return new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });
}
const naoEncontrado = (o: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado`, `${o} não existe neste estabelecimento.`);

/** Query string → objeto do esquema: números, booleanos e listas separadas por vírgula. */
export function deQuery(
  q: Record<string, unknown>,
  tipos: { numeros?: readonly string[]; booleanos?: readonly string[]; listas?: readonly string[] },
): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v0] of Object.entries(q)) {
    const v = Array.isArray(v0) ? v0.join(',') : v0;
    if (v === undefined || v === '') continue;
    if (tipos.numeros?.includes(k)) r[k] = /^-?\d+$/.test(String(v)) ? Number(v) : v;
    else if (tipos.booleanos?.includes(k))
      r[k] = v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v;
    else if (tipos.listas?.includes(k))
      r[k] = String(v)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    else r[k] = v;
  }
  return r;
}

const ehTipoRecurso = (t: unknown): t is TipoRecursoAgenda =>
  typeof t === 'string' && (CODIGOS_TIPO_RECURSO_AGENDA as readonly string[]).includes(t);

/** Os setores do cadastro da pessoa (escopo `centrosCusto` da sessão); vazio: sem restrição (cap-08 §8.4). */
function meusSetores(s: SessaoCadastro): number[] {
  return (s.req.sgh?.sessao.escopos?.centrosCusto ?? []).map(Number).filter((n) => Number.isInteger(n));
}

const quemAge = (s: SessaoCadastro): QuemAge => ({
  login: s.login,
  podeAtender: s.pode(P.osAtender),
  podeEncerrar: s.pode(P.osEncerrar),
});

/** Conversor HTML → PDF/A (Gotenberg); sem ele (testes), as rotas dos documentos devolvem o HTML. */
export const GERADOR_PDF_MANUTENCAO = Symbol('GERADOR_PDF_MANUTENCAO');
type GeradorPdf = (html: string, titulo: string) => Promise<Buffer>;
type Resposta = { header(n: string, v: string): unknown; send(b: unknown): unknown };

@Controller('manutencao')
export class ManutencaoController {
  private readonly apoio: ApoioGravacao<GravadorManutencao>;

  constructor(
    @Inject(PORTA_MANUTENCAO) private readonly porta: PortaManutencao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(GERADOR_PDF_MANUTENCAO) private readonly pdf: GeradorPdf | null = null,
    @Optional() @Inject(PORTA_PATRIMONIO) private readonly patrimonio: PortaPatrimonio | null = null,
    // W0-07 (M4): a OS num leito propõe e encerra o bloqueio (parâmetro adt.osBloqueiaLeito; sem ela, nada muda).
    @Optional() @Inject(INTEGRACAO_OS_LEITO) private readonly osLeito: IntegracaoOsLeito | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_MANUTENCAO, nome: 'a manutenção', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private async parametros(s: SessaoCadastro): Promise<Parametros> {
    const r = await this.apoio.resolvedorParametros(s);
    const n = (chave: string, padrao: number) => {
      const v = Number(r(chave) ?? padrao);
      return Number.isFinite(v) && v >= 0 ? v : padrao;
    };
    const sla = Object.fromEntries(
      CODIGOS_PRIORIDADE_OS.map((p) => [
        p,
        {
          atendimentoHoras: n(chaveParametroSla(p, 'atendimento'), SLA_PADRAO[p].atendimentoHoras),
          solucaoHoras: n(chaveParametroSla(p, 'solucao'), SLA_PADRAO[p].solucaoHoras),
        },
      ]),
    ) as Record<PrioridadeOs, SlaPrioridade>;
    return {
      sla,
      antecedenciaDias: n('manutencao.planoAntecedenciaDias', 15),
      aceiteHoras: n('manutencao.aceiteAutomaticoHoras', 72),
    };
  }

  /** Os nomes (setor, unidade, usuários e fornecedores) para montar as respostas. */
  private async nomes(
    s: SessaoCadastro,
    x: { logins?: readonly (string | null)[]; fornecedores?: readonly number[]; unidades?: boolean } = {},
  ): Promise<Nomes> {
    const logins = [
      ...new Set((x.logins ?? []).filter((l): l is string => !!l).map((l) => l.trim().toUpperCase())),
    ];
    const lotes: string[][] = [];
    for (let i = 0; i < logins.length; i += 200) lotes.push(logins.slice(i, i + 200));
    const fornecedores = [...new Set(x.fornecedores ?? [])].slice(0, 200);
    const [setores, unidades, usuarios, nomesForn] = await Promise.all([
      this.porta.setores(s.porta),
      x.unidades ? this.porta.unidades(s.porta) : Promise.resolve([]),
      Promise.all(lotes.map((l) => this.porta.nomesDosUsuarios(s.porta, l))),
      fornecedores.length ? this.porta.nomesDosFornecedores(s.porta, fornecedores) : Promise.resolve([]),
    ]);
    return {
      setores: new Map(setores.map((y) => [y.codigo, y])),
      unidades: new Map(unidades.map((u) => [u.codigo, u.nome])),
      usuarios: new Map(usuarios.flat().map((u) => [u.login.trim().toUpperCase(), u.nome])),
      fornecedores: new Map(nomesForn.map((f) => [f.codigo, f.nome])),
    };
  }

  private async mapaEquipamentos(s: SessaoCadastro, ids: readonly (number | null)[]) {
    const unicos = [...new Set(ids.filter((i): i is number => i !== null))];
    if (unicos.length === 0) return new Map<number, EquipamentoManutencao>();
    const r = await this.porta.equipamentos(s.porta, { ids: unicos, limite: unicos.length });
    return new Map(r.itens.map((e) => [e.id, e]));
  }

  /** Confere o OS lida contra a versão que a tela viu (antes de decidir). */
  private static conferirVersao(o: OrdemServico | null, versao: number): OrdemServico {
    if (!o) throw naoEncontrado('Ordem de serviço');
    if (o.versao !== versao)
      throw recusada(
        'desatualizado',
        'A ordem de serviço mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
      );
    return o;
  }

  /** Avisa o setor do equipamento crítico parado (e o setor da sala, se outro) na central de avisos. */
  private static async avisarParada(
    g: GravadorManutencao,
    eq: EquipamentoManutencao,
    os: { id: number; numero: string },
  ): Promise<{ alerta: ReturnType<typeof alertaDeParada>; avisados: number }> {
    const alerta = alertaDeParada(eq);
    if (!alerta) return { alerta, avisados: 0 };
    const setores = new Set([alerta.centroCusto]);
    if (alerta.recurso) {
      const r = await g.recurso(alerta.recurso.tipo, alerta.recurso.id);
      if (r?.centroCusto) setores.add(r.centroCusto);
    }
    const logins = new Set<string>();
    for (const c of setores) for (const l of await g.loginsDoSetor(c)) logins.add(l.trim().toUpperCase());
    let avisados = 0;
    for (const login of logins) {
      const id = await g.avisar({
        login,
        tipo: 'manutencao-parada',
        gravidade: 'grave',
        modulo: 'manutencao',
        evento: 'manutencao.equipamento.parado',
        titulo: `Equipamento crítico parado: ${eq.nome} (${eq.codigo}), OS ${os.numero}`,
        link: `/manutencao/os?os=${os.id}`,
        objetoTabela: 'ordem_servico_manutencao',
        objetoChave: String(os.id),
      });
      if (id !== null) avisados += 1;
    }
    return { alerta, avisados };
  }

  // ── Apoio ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('apoio')
  @Permissao(P.osAbrir)
  @Auditar(E.manutencaoOsLidas.codigo)
  async apoioDaTela(@Req() req: RequisicaoAutorizada): Promise<ApoioManutencao> {
    const s = sessaoDe(req);
    const [relogio, setores, unidades, parametros, liberacao] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.setores(s.porta),
      this.porta.unidades(s.porta),
      this.parametros(s),
      this.apoio.liberacao(s),
    ]);
    return {
      ...relogio,
      setores: setores.map((x) => ({ codigo: x.codigo, nome: x.nome, ativo: x.ativo })),
      unidades: unidades.map((u) => ({ codigo: u.codigo, nome: u.nome })),
      meusSetores: meusSetores(s),
      ...parametros,
      pode: {
        abrir: s.pode(P.osAbrir),
        atender: s.pode(P.osAtender),
        encerrar: s.pode(P.osEncerrar),
        ler: s.pode(P.equipamentoLer),
        editar: s.pode(P.equipamentoEditar),
        planejar: s.pode(P.preventivaPlanejar),
      },
      gravacao: liberacao,
    };
  }

  // ── Ordens de serviço ─────────────────────────────────────────────────────────────────────────────────────────────

  @Get('os')
  @Permissao(P.osAbrir)
  @Auditar(E.manutencaoOsLidas.codigo)
  async listarOs(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaManutencao<OsResumo>> {
    const s = sessaoDe(req);
    const f = corpo(
      esquemaFiltroOs,
      deQuery(q, {
        numeros: ['centroCusto', 'equipamento', 'antesDe', 'limite'],
        booleanos: ['minhas'],
        listas: ['situacoes'],
      }),
    );
    const todas = s.pode(P.osAtender) || s.pode(P.osEncerrar);
    const [pagina, parametros, relogio] = await Promise.all([
      this.porta.ordens(s.porta, {
        ...f,
        solicitante: f.minhas ? s.login : null,
        restricao: todas ? null : { login: s.login, centros: meusSetores(s) },
      }),
      this.parametros(s),
      this.porta.relogio(s.porta),
    ]);
    const [nomes, equipamentos] = await Promise.all([
      this.nomes(s, { logins: pagina.itens.flatMap((o) => [o.solicitante, o.tecnico]) }),
      this.mapaEquipamentos(
        s,
        pagina.itens.map((o) => o.equipamento),
      ),
    ]);
    return {
      itens: pagina.itens.map((o) => resumoOs(o, nomes, equipamentos, parametros.sla, relogio.agora)),
      proxima: pagina.proxima,
    };
  }

  /** A OS que a pessoa pode ver: quem atende vê todas; quem só abre, as que abriu e as dos seus setores. */
  private async osVisivel(s: SessaoCadastro, id: number): Promise<OrdemServico> {
    const o = await this.porta.os(s.porta, id);
    if (!o) throw naoEncontrado('Ordem de serviço');
    const todas = s.pode(P.osAtender) || s.pode(P.osEncerrar);
    const minha = o.solicitante.trim().toUpperCase() === s.login.trim().toUpperCase();
    if (!todas && !minha && !meusSetores(s).includes(o.centroCusto)) throw naoEncontrado('Ordem de serviço');
    return o;
  }

  @Get('os/:id')
  @Permissao(P.osAbrir)
  @Auditar(E.manutencaoOsLidas.codigo)
  async detalharOs(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<OsDetalhe> {
    return this.montarDetalheOs(sessaoDe(req), idDaRota(id));
  }

  /** A OS em PDF/A, relida (ficha, seção 10, "Documento: OS e laudo em PDF/A"). */
  @Get('os/:id/documento')
  @Permissao(P.osAbrir)
  @Auditar(E.manutencaoOsLidas.codigo)
  async documentoOs(@Param('id') id: string, @Req() req: RequisicaoAutorizada, @Res() res: Resposta) {
    const s = sessaoDe(req);
    const o = await this.montarDetalheOs(s, idDaRota(id));
    const html = htmlOrdemServico({ os: o, ...this.emissao(s) });
    return this.enviarDocumento(res, html, `Ordem de serviço ${o.numero}`, `os-${o.numero}`);
  }

  /** O laudo da execução do plano do equipamento, em PDF/A, relido (ficha, seção 10). */
  @Get('equipamentos/:id/laudo/:execucao')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async laudoExecucao(
    @Param('id') id: string,
    @Param('execucao') execucao: string,
    @Req() req: RequisicaoAutorizada,
    @Res() res: Resposta,
  ) {
    const s = sessaoDe(req);
    const equipamento = await this.montarDetalheEquipamento(s, idDaRota(id));
    const idExec = idDaRota(execucao);
    const planos = await this.porta.planos(s.porta, { equipamento: equipamento.id, soAtivos: false });
    for (const p of planos) {
      const lida = (await this.porta.execucoes(s.porta, p.id)).find((x) => x.id === idExec);
      if (!lida) continue;
      const nomes = await this.nomes(s, { logins: [lida.por] });
      const corretiva =
        lida.osCorretiva === null ? null : ((await this.porta.os(s.porta, lida.osCorretiva))?.numero ?? null);
      const html = htmlLaudoExecucao({
        equipamento,
        plano: {
          id: p.id,
          atividade: p.atividade,
          periodicidade: p.periodicidade,
          procedimento: p.procedimento,
        },
        execucao: {
          id: lida.id,
          data: lida.data,
          resultado: lida.resultado,
          laudo: lida.laudo,
          certificadoPadrao: lida.certificadoPadrao,
          observacao: lida.observacao,
          osCorretiva: lida.osCorretiva,
          por: nomes.usuarios.get(lida.por.toUpperCase()) ?? lida.por,
        },
        corretiva,
        ...this.emissao(s),
      });
      return this.enviarDocumento(
        res,
        html,
        `Laudo ${lida.id} ${equipamento.codigo}`,
        `laudo-${equipamento.codigo}-${lida.id}`,
      );
    }
    throw naoEncontrado('Execução do plano');
  }

  private emissao(s: SessaoCadastro): { estabelecimento: string; emitidoEm: string; emitidoPor: string } {
    return { estabelecimento: s.hospital, emitidoEm: new Date().toISOString(), emitidoPor: s.login };
  }

  /** Sem o conversor (testes), o HTML do documento; com ele, o PDF/A (503 se não responder). */
  private async enviarDocumento(res: Resposta, html: string, titulo: string, arquivo: string) {
    if (!this.pdf) {
      res.header('content-type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    const pdf = await this.pdf(html, titulo).catch(() => null);
    if (!pdf)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Gerador de PDF indisponível',
        'O conversor de PDF/A não respondeu.',
      );
    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `attachment; filename="${arquivo}.pdf"`);
    return res.send(pdf);
  }

  private async montarDetalheOs(s: SessaoCadastro, idOs: number): Promise<OsDetalhe> {
    const o = await this.osVisivel(s, idOs);
    const [eventos, parametros, relogio, equipamento, coberturas, tecnovig] = await Promise.all([
      this.porta.eventos(s.porta, o.id),
      this.parametros(s),
      this.porta.relogio(s.porta),
      o.equipamento === null ? Promise.resolve(null) : this.porta.equipamento(s.porta, o.equipamento),
      o.cobertura === null ? Promise.resolve([]) : this.porta.coberturas(s.porta, { ids: [o.cobertura] }),
      this.porta.vinculosTecnovigDaOs(s.porta, o.id),
    ]);
    const recurso = equipamento?.recurso
      ? await this.porta.recurso(s.porta, equipamento.recurso.tipo, equipamento.recurso.id)
      : null;
    const nomes = await this.nomes(s, {
      logins: [o.solicitante, o.tecnico, ...eventos.map((e) => e.ator)],
      fornecedores: coberturas.map((c) => c.fornecedor),
    });
    return {
      ...detalheOs(o, nomes, {
        equipamento,
        recurso,
        cobertura: coberturas[0] ?? null,
        eventos,
        sla: parametros.sla,
        agora: relogio.agora,
        quem: quemAge(s),
        horasAceite: parametros.aceiteHoras,
      }),
      tecnovigilancia: {
        ...tecnovig,
        podeAbrirQueixa: o.equipamento !== null && tecnovig.queixa === null && s.pode(P.equipamentoEditar),
      },
    };
  }

  @Post('os')
  @HttpCode(201)
  @Permissao(P.osAbrir)
  @AuditadoNoHandler(
    'ordem_servico_manutencao, ordem_servico_manutencao_evento e o aviso da central com a trilha de auditoria na mesma transação',
  )
  async abrirOs(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAbrirOs, b);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoOsAberta.codigo,
      RECURSO,
      (y: { id: number }) => ({ tabela: 'ordem_servico_manutencao', id: String(y.id), paciente: null }),
      async (g) => {
        const [relogio, setores] = await Promise.all([g.relogio(), g.setores()]);
        const eq =
          e.equipamento !== null
            ? await g.equipamento(e.equipamento)
            : e.codigoEquipamento !== null
              ? await g.equipamentoPorCodigo(e.codigoEquipamento)
              : null;
        if ((e.equipamento !== null || e.codigoEquipamento !== null) && !eq)
          throw recusada('equipamento-inexistente', 'Equipamento não encontrado neste estabelecimento.', [
            e.equipamento !== null ? 'equipamento' : 'codigoEquipamento',
          ]);
        const plano = planejarAbertura({
          natureza: e.natureza,
          centroCusto: e.centroCusto,
          centrosDoUsuario: meusSetores(s),
          centrosAtivos: setores.filter((x: SetorManutencao) => x.ativo).map((x) => x.codigo),
          equipamento: eq,
          equipamentoParado: e.equipamentoParado,
          abertasDoEquipamento: eq ? await g.osAbertasDoEquipamento(eq.id) : [],
        });
        if (!plano.ok) throw recusada(plano.recusa, plano.mensagem, ['centroCusto']);
        const os = await g.abrirOs({
          natureza: e.natureza,
          equipamento: eq?.id ?? null,
          centroCusto: e.centroCusto,
          local: e.local,
          descricao: e.descricao,
          contato: e.contato,
          prioridadeSugerida: e.prioridadeSugerida,
          prioridade: e.prioridadeSugerida,
          solicitante: s.login,
          registro: relogio.agora,
          parado: plano.registraParada,
          plano: null,
          nota: null,
        });
        const aviso =
          plano.alerta && eq
            ? await ManutencaoController.avisarParada(g, eq, os)
            : { alerta: null, avisados: 0 };
        return { ...os, plano, eq, aviso };
      },
    );
    const alerta = r.aviso.alerta;
    const nomes = alerta ? await this.nomes(s) : null;
    const recurso =
      alerta?.recurso && nomes
        ? await this.porta.recurso(s.porta, alerta.recurso.tipo, alerta.recurso.id)
        : null;
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      numero: r.numero,
      possiveisDuplicadas: r.plano.ok ? r.plano.possiveisDuplicadas : [],
      leito: await this.leitoDaOs(s, 'aoAbrir', { numero: r.numero, local: e.local }),
      alerta:
        alerta && nomes
          ? {
              setor: {
                codigo: String(alerta.centroCusto),
                nome: nomes.setores.get(alerta.centroCusto)?.nome ?? '',
              },
              recurso: alerta.recurso
                ? { ...alerta.recurso, nome: recurso?.nome ?? `Recurso ${alerta.recurso.id}` }
                : null,
              operacaoBloqueio: alerta.operacaoBloqueio,
              avisados: r.aviso.avisados,
            }
          : null,
      mensagem: alerta
        ? `Ordem de serviço ${r.numero} aberta. Equipamento crítico parado: o setor foi avisado.`
        : `Ordem de serviço ${r.numero} aberta.`,
    };
  }

  /** Uma ação do ciclo da OS: relê e trava a OS, confere a versão e a regra pura, grava a mudança e o evento. */
  private async agir(
    s: SessaoCadastro,
    evento: string,
    id: number,
    versao: number,
    acao: AcaoOs,
    montar: (
      o: OrdemServico,
      g: GravadorManutencao,
      agora: string,
    ) => Promise<{
      para?: OrdemServico['situacao'];
      voltaAoUso?: string | null;
      campos: Parameters<GravadorManutencao['mudarOs']>[0]['campos'];
      nota: string | null;
    }>,
  ): Promise<ResultadoManutencao> {
    const parametros = await this.parametros(s);
    const r = await this.apoio.sgh(
      s,
      evento,
      RECURSO,
      { tabela: 'ordem_servico_manutencao', id: String(id), paciente: null },
      async (g) => {
        const o = ManutencaoController.conferirVersao(await g.os(id), versao);
        const { agora } = await g.relogio();
        const m = await montar(o, g, agora);
        const plano = planejarAcao({
          os: osParaAcao(o),
          acao,
          quem: quemAge(s),
          agora,
          horasAceite: parametros.aceiteHoras,
          ...(m.para ? { para: m.para } : {}),
          ...(m.voltaAoUso !== undefined ? { voltaAoUso: m.voltaAoUso } : {}),
        });
        if (!plano.ok) throw recusada(plano.recusa, plano.mensagem);
        const y = await g.mudarOs({
          id,
          versaoVista: versao,
          de: o.situacao,
          para: plano.para,
          campos: m.campos,
          usuario: s.login,
          nota: m.nota,
        });
        return { ...y, numero: o.numero, para: plano.para };
      },
    );
    return { ok: true, id: r.id, versao: r.versao, numero: r.numero, mensagem: MENSAGEM_DA_SITUACAO[r.para] };
  }

  @Post('os/:id/assumir')
  @HttpCode(200)
  @Permissao(P.osAtender)
  @AuditadoNoHandler(
    'ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async assumir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAssumirOs, { ...(b as object), os: idDaRota(id) });
    return this.agir(s, E.manutencaoOsAtendida.codigo, e.os, e.versao, 'assumir', async (o, g, agora) => {
      if (e.executor === 'contrato') {
        if (o.equipamento === null)
          throw recusada('fora-do-contrato', 'O contrato de manutenção cobre equipamentos.', ['cobertura']);
        const c = e.cobertura === null ? null : await g.cobertura(e.cobertura);
        if (!c || !c.ativa)
          throw recusada('fora-do-contrato', 'Contrato de manutenção não encontrado.', ['cobertura']);
        const ok = conferirAcionamento(c, o.equipamento, o.natureza, agora.slice(0, 10));
        if (!ok.ok) throw recusada(ok.recusa, ok.mensagem, ['cobertura']);
      }
      return {
        campos: {
          prioridade: e.prioridade,
          tecnico: s.login,
          executor: e.executor,
          cobertura: e.executor === 'contrato' ? e.cobertura : null,
          assumidaEm: agora,
        },
        nota: e.nota,
      };
    });
  }

  @Post('os/:id/andamento')
  @HttpCode(200)
  @Permissao(P.osAtender)
  @AuditadoNoHandler(
    'ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async andamento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAndamentoOs, { ...(b as object), os: idDaRota(id) });
    return this.agir(s, E.manutencaoOsAtendida.codigo, e.os, e.versao, 'andamento', async () => ({
      para: e.situacao,
      campos: {},
      nota: e.nota,
    }));
  }

  @Post('os/:id/concluir')
  @HttpCode(200)
  @Permissao(P.osEncerrar)
  @AuditadoNoHandler(
    'ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async concluir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaConcluirOs, { ...(b as object), os: idDaRota(id) });
    return this.agir(s, E.manutencaoOsConcluida.codigo, e.os, e.versao, 'concluir', async (o, _g, agora) => {
      if (e.inicioReparo < o.registro)
        throw recusada('reparo-antes-da-abertura', 'O reparo começa antes da abertura da ordem de serviço.', [
          'inicioReparo',
        ]);
      if (e.fimReparo > agora)
        throw recusada('reparo-no-futuro', 'O fim do reparo está no futuro.', ['fimReparo']);
      const paradaAberta = o.paradaInicio !== null && o.paradaFim === null;
      if (
        paradaAberta &&
        e.voltaAoUso !== null &&
        (e.voltaAoUso < (o.paradaInicio ?? '') || e.voltaAoUso > agora)
      )
        throw recusada('volta-ao-uso-fora', 'A volta ao uso fica entre a parada e agora.', ['voltaAoUso']);
      return {
        voltaAoUso: e.voltaAoUso,
        campos: {
          concluidaEm: agora,
          causa: e.causa,
          solucao: e.solucao,
          inicioReparo: e.inicioReparo,
          fimReparo: e.fimReparo,
          custoPecasCent: centavos(e.custoPecas),
          custoMaoDeObraCent: centavos(e.custoMaoDeObra),
          custoTerceirosCent: centavos(e.custoTerceiros),
          laudo: e.laudo,
          ...(paradaAberta && e.voltaAoUso !== null ? { paradaFim: e.voltaAoUso } : {}),
        },
        nota: null,
      };
    });
  }

  @Post('os/:id/encerrar')
  @HttpCode(200)
  @Permissao(P.osAbrir)
  @AuditadoNoHandler(
    'ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async encerrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarOs, { ...(b as object), os: idDaRota(id) });
    const r = await this.agir(
      s,
      E.manutencaoOsEncerrada.codigo,
      e.os,
      e.versao,
      e.aceite ? 'encerrar' : 'reabrir',
      async (_o, _g, agora) => ({
        campos: e.aceite ? { encerradaEm: agora } : { concluidaEm: null },
        nota: e.nota,
      }),
    );
    if (!e.aceite || !this.osLeito) return r;
    const o = await this.porta.os(s.porta, e.os).catch(() => null);
    const leito = o ? await this.leitoDaOs(s, 'aoEncerrar', { numero: o.numero, local: o.local }) : null;
    return leito ? { ...r, leito } : r;
  }

  /** W0-07 (M4): o desfecho da integração com o leito; a falha dela nunca desfaz a OS gravada (só registra). */
  private async leitoDaOs(
    s: SessaoCadastro,
    quando: 'aoAbrir' | 'aoEncerrar' | 'aoCancelar',
    os: { numero: string | null; local: string | null },
  ): Promise<OsNoLeito | null> {
    // Sem local, o encerramento e o cancelamento ainda procuram o bloqueio pelo número (o local pode ter mudado).
    if (!this.osLeito || !os.numero || (quando === 'aoAbrir' && !os.local)) return null;
    return this.osLeito[quando](s, os).catch(() => null);
  }

  @Post('os/:id/cancelamento')
  @HttpCode(200)
  @Permissao(P.osAbrir)
  @AuditadoNoHandler(
    'ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarOs, { ...(b as object), os: idDaRota(id) });
    const r = await this.agir(
      s,
      E.manutencaoOsCancelada.codigo,
      e.os,
      e.versao,
      'cancelar',
      async (o, _g, agora) => ({
        campos: {
          canceladaEm: agora,
          motivoCancelamento: e.motivo,
          ...(o.paradaInicio !== null && o.paradaFim === null ? { paradaFim: agora } : {}),
        },
        nota: e.motivo,
      }),
    );
    // W0-07 (M4): a OS cancelada não deixa o bloqueio do leito órfão (o vínculo "OS <número>" é só por código).
    if (!this.osLeito) return r;
    const o = await this.porta.os(s.porta, e.os).catch(() => null);
    const leito = o ? await this.leitoDaOs(s, 'aoCancelar', { numero: o.numero, local: o.local }) : null;
    return leito ? { ...r, leito } : r;
  }

  /**
   * W0-08: corrige a abertura (descrição, prioridade sugerida, setor, equipamento e local) enquanto ninguém assumiu a
   * OS. Depois de assumida, 409 `os-assumida` (só anotação e transição). O histórico guarda o motivo e o valor anterior.
   */
  @Post('os/:id/correcao')
  @HttpCode(200)
  @Permissao(P.osAbrir)
  @AuditadoNoHandler(
    'ordem_servico_manutencao e ordem_servico_manutencao_evento com a trilha de auditoria na mesma transação',
  )
  async corrigir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCorrigirOs, { ...(b as object), os: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoOsCorrigida.codigo,
      RECURSO,
      { tabela: 'ordem_servico_manutencao', id: String(e.os), paciente: null },
      async (g) => {
        const o = ManutencaoController.conferirVersao(await g.os(e.os), e.versao);
        const setores = await g.setores();
        const eq =
          e.equipamento !== null && e.equipamento !== o.equipamento
            ? await g.equipamento(e.equipamento)
            : null;
        if (e.equipamento !== null && e.equipamento !== o.equipamento && !eq)
          throw recusada('equipamento-inexistente', 'Equipamento não encontrado neste estabelecimento.', [
            'equipamento',
          ]);
        const plano = planejarCorrecao({
          os: { ...o, temParada: o.paradaInicio !== null },
          novo: {
            equipamento: e.equipamento,
            centroCusto: e.centroCusto,
            local: e.local,
            descricao: e.descricao,
            prioridadeSugerida: e.prioridadeSugerida,
          },
          quem: quemAge(s),
          centrosDoUsuario: meusSetores(s),
          centrosAtivos: setores.filter((x: SetorManutencao) => x.ativo).map((x) => x.codigo),
          equipamentoNovo: eq,
        });
        if (!plano.ok) throw recusada(plano.recusa, plano.mensagem);
        const antes = plano.mudancas.map((m) => `${m.campo}: ${m.antes ?? '(vazio)'}`).join('; ');
        const y = await g.corrigirOs({
          id: e.os,
          versaoVista: e.versao,
          equipamento: e.equipamento,
          centroCusto: e.centroCusto,
          local: e.local,
          descricao: e.descricao,
          prioridadeSugerida: e.prioridadeSugerida,
          usuario: s.login,
          nota: `Correção da abertura: ${e.motivo} (antes: ${antes})`,
        });
        return { ...y, numero: o.numero };
      },
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      numero: r.numero,
      mensagem: `Ordem de serviço ${r.numero} corrigida.`,
    };
  }

  // ── Equipamentos ──────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('equipamentos')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async listarEquipamentos(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PaginaManutencao<EquipamentoResumo>> {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroEquipamentos, deQuery(q, { numeros: ['centroCusto', 'antesDe', 'limite'] }));
    const [pagina, planos, parametros, relogio] = await Promise.all([
      this.porta.equipamentos(s.porta, f),
      this.porta.planos(s.porta),
      this.parametros(s),
      this.porta.relogio(s.porta),
    ]);
    const nomes = await this.nomes(s, { unidades: true });
    const vencidos = vencidosPorEquipamento(planos, relogio.hoje, parametros.antecedenciaDias);
    return {
      itens: pagina.itens.map((e) => resumoEquipamento(e, nomes, vencidos.get(e.id) ?? 0)),
      proxima: pagina.proxima,
    };
  }

  @Get('equipamentos/busca')
  @Permissao(P.osAbrir)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async buscarEquipamentos(
    @Query('termo') termo: string | undefined,
    @Query('centroCusto') centro: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EquipamentoPeloCodigo[]> {
    const s = sessaoDe(req);
    const centroCusto = centro ? lerIdBanco(centro) : null;
    const r = await this.porta.equipamentos(s.porta, {
      termo: (termo ?? '').slice(0, 80),
      centroCusto,
      limite: 50,
    });
    const nomes = await this.nomes(s);
    return r.itens.filter((e) => e.situacao !== 'desativado').map((e) => peloCodigo(e, nomes));
  }

  @Get('equipamentos/codigo/:codigo')
  @Permissao(P.osAbrir)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async equipamentoPeloCodigo(
    @Param('codigo') codigo: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EquipamentoPeloCodigo> {
    const s = sessaoDe(req);
    const c = esquemaCodigoEquipamento.safeParse(codigo);
    if (!c.success) throw naoEncontrado('Equipamento');
    const e = await this.porta.equipamentoPorCodigo(s.porta, c.data);
    if (!e) throw naoEncontrado('Equipamento');
    return peloCodigo(e, await this.nomes(s));
  }

  @Get('equipamentos/:id')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async detalharEquipamento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EquipamentoDetalhe & { planos: readonly ItemPlanoPainel[] }> {
    return this.montarDetalheEquipamento(sessaoDe(req), idDaRota(id));
  }

  private async montarDetalheEquipamento(
    s: SessaoCadastro,
    idEq: number,
  ): Promise<EquipamentoDetalhe & { planos: readonly ItemPlanoPainel[] }> {
    const e = await this.porta.equipamento(s.porta, idEq);
    if (!e) throw naoEncontrado('Equipamento');
    const [planos, coberturas, parametros, relogio, recurso] = await Promise.all([
      this.porta.planos(s.porta, { equipamento: e.id }),
      this.porta.coberturas(s.porta, { equipamento: e.id }),
      this.parametros(s),
      this.porta.relogio(s.porta),
      e.recurso ? this.porta.recurso(s.porta, e.recurso.tipo, e.recurso.id) : Promise.resolve(null),
    ]);
    const nomes = await this.nomes(s, { unidades: true, fornecedores: coberturas.map((c) => c.fornecedor) });
    const painel = painelDoPlano(planos, new Map([[e.id, e]]), relogio.hoje, parametros.antecedenciaDias);
    return {
      ...detalheEquipamento(e, nomes, {
        planosVencidos: painel.resumo.vencida,
        recurso,
        coberturas,
        hoje: relogio.hoje,
      }),
      bem: e.bemPatrimonial === null ? null : await this.bemDoPatrimonio(s, e.bemPatrimonial),
      planos: painel.itens,
    };
  }

  /** O bem do patrimônio pelo ID (nulo: não achado, baixado ou o patrimônio fora do ar). */
  private async bemDoPatrimonio(s: SessaoCadastro, id: number): Promise<BemDoEquipamento | null> {
    if (!this.patrimonio || this.patrimonio.destino === 'indisponivel') return null;
    const b = await this.patrimonio.bem(s.porta, id).catch(() => null);
    return b && b.situacao !== 'baixado' ? { id: b.id, plaqueta: b.plaqueta, descricao: b.descricao } : null;
  }

  /** Confere o bem patrimonial escolhido (existe no patrimônio e não foi baixado); o mesmo de antes não se confere. */
  private async conferirBem(s: SessaoCadastro, bem: number | null, anterior: number | null): Promise<void> {
    if (bem === null || bem === anterior) return;
    if (!(await this.bemDoPatrimonio(s, bem)))
      throw recusada(
        'bem-inexistente',
        'O bem patrimonial escolhido não existe no patrimônio ou já foi baixado.',
        ['bemPatrimonial'],
      );
  }

  /** Bens do patrimônio pela plaqueta ou descrição, para ligar ao equipamento (até 20, sem os baixados). */
  @Get('bens')
  @Permissao(P.equipamentoEditar)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async buscarBens(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<BemDoEquipamento[]> {
    const s = sessaoDe(req);
    const busca = (termo ?? '').trim().slice(0, 60);
    if (!this.patrimonio || this.patrimonio.destino === 'indisponivel' || busca.length < 2) return [];
    const r = await this.patrimonio.bens(s.porta, { busca, pagina: 1, tamanho: 20 });
    return r.bens
      .filter((b) => b.situacao !== 'baixado')
      .map((b) => ({ id: b.id, plaqueta: b.plaqueta, descricao: b.descricao }));
  }

  /** Confere o setor, a unidade e o recurso de agenda do equipamento (dentro da transação). */
  private static async conferirEquipamento(
    g: GravadorManutencao,
    e: { centroCusto: number; recurso: { tipo: TipoRecursoAgenda; id: number } | null },
    centroAnterior: number | null,
  ): Promise<void> {
    const setor = (await g.setores()).find((x) => x.codigo === e.centroCusto);
    if (!setor || (!setor.ativo && setor.codigo !== centroAnterior))
      throw recusada('setor-inativo', 'Escolha um setor ativo do estabelecimento.', ['centroCusto']);
    if (e.recurso && !(await g.recurso(e.recurso.tipo, e.recurso.id)))
      throw recusada('recurso-inexistente', 'O recurso de agenda escolhido não existe.', ['recurso']);
  }

  @Post('equipamentos')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler('equipamento_saude com a trilha de auditoria na mesma transação')
  async cadastrarEquipamento(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCadastrarEquipamento, b);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoEquipamentoCadastrado.codigo,
      RECURSO,
      (y: { id: number }) => ({
        tabela: 'equipamento_saude',
        id: String(y.id),
        paciente: null,
        chave: e.codigo,
      }),
      async (g) => {
        await ManutencaoController.conferirEquipamento(g, e, null);
        await this.conferirBem(s, e.bemPatrimonial, null);
        const x: EquipamentoParaGravar = { ...e, motivo: null, usuario: s.login };
        return g.incluirEquipamento(x);
      },
    );
    return { ok: true, ...r, mensagem: `Equipamento ${e.codigo} cadastrado.` };
  }

  @Post('equipamentos/:id')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler('equipamento_saude com a trilha de auditoria na mesma transação')
  async alterarEquipamento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarEquipamento, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoEquipamentoAlterado.codigo,
      RECURSO,
      { tabela: 'equipamento_saude', id: String(e.id), paciente: null, chave: e.codigo },
      async (g) => {
        const antes = await g.equipamento(e.id);
        if (!antes) throw naoEncontrado('Equipamento');
        await ManutencaoController.conferirEquipamento(g, e, antes.centroCusto);
        await this.conferirBem(s, e.bemPatrimonial, antes.bemPatrimonial);
        // W0-08 (M3): o equipamento descartado não volta ao parque (o ciclo de vida está encerrado).
        if (e.situacao !== 'desativado' && (await g.eventosCiclo(e.id)).some((x) => x.tipo === 'descarte'))
          throw recusaCicloVida('equipamento-descartado');
        const { versao, ...campos } = e;
        return g.alterarEquipamento({ ...campos, versaoVista: versao, usuario: s.login });
      },
    );
    return {
      ok: true,
      ...r,
      mensagem:
        e.situacao === 'desativado'
          ? `Equipamento ${e.codigo} desativado.`
          : `Equipamento ${e.codigo} alterado.`,
    };
  }

  @Get('recursos')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async recursos(@Query('tipo') tipo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    if (!ehTipoRecurso(tipo))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Tipo inválido',
        'Escolha o tipo de recurso de agenda.',
        {
          campos: ['tipo'],
        },
      );
    return (await this.porta.recursos(s.porta, tipo)).map((r) => ({
      id: r.id,
      nome: r.nome,
      ativo: r.ativo,
    }));
  }

  @Get('fornecedores')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async fornecedores(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.porta.fornecedores(s.porta, (termo ?? '').slice(0, 60));
  }

  // ── Plano de manutenção ───────────────────────────────────────────────────────────────────────────────────────────

  @Get('plano/painel')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async painel(@Req() req: RequisicaoAutorizada): Promise<PainelPlano> {
    const s = sessaoDe(req);
    const [planos, parametros, relogio] = await Promise.all([
      this.porta.planos(s.porta),
      this.parametros(s),
      this.porta.relogio(s.porta),
    ]);
    const equipamentos = await this.mapaEquipamentos(
      s,
      planos.map((p) => p.equipamento),
    );
    return painelDoPlano(planos, equipamentos, relogio.hoje, parametros.antecedenciaDias);
  }

  @Get('plano/:id/execucoes')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async execucoes(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ExecucaoPlano[]> {
    const s = sessaoDe(req);
    const lidas = await this.porta.execucoes(s.porta, idDaRota(id));
    const nomes = await this.nomes(s, { logins: lidas.map((x) => x.por) });
    return lidas.map((x) => ({
      id: x.id,
      data: x.data,
      resultado: x.resultado,
      laudo: x.laudo,
      certificadoPadrao: x.certificadoPadrao,
      observacao: x.observacao,
      osCorretiva: x.osCorretiva,
      por: nomes.usuarios.get(x.por.toUpperCase()) ?? x.por,
    }));
  }

  @Post('plano')
  @HttpCode(201)
  @Permissao(P.preventivaPlanejar)
  @AuditadoNoHandler('plano_preventivo com a trilha de auditoria na mesma transação')
  async planejar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPlanejarManutencao, b);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoPlanoGravado.codigo,
      RECURSO,
      (y: { id: number }) => ({ tabela: 'plano_preventivo', id: String(y.id), paciente: null }),
      async (g) => {
        await conferirPlanoNovo(g, e);
        return g.incluirPlano({ ...e, usuario: s.login });
      },
    );
    return { ok: true, ...r, mensagem: 'Plano de manutenção gravado.' };
  }

  /** W0-08 (M4): os modelos prontos de plano da infraestrutura (PMOC do ar, reservatório, gerador, gases). */
  @Get('plano/modelos')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  modelosDePlano(): ({ codigo: CodigoModeloPlano } & ModeloPlanoInfra)[] {
    return CODIGOS_MODELO_PLANO.map((codigo) => ({ codigo, ...MODELOS_PLANO_INFRA[codigo] }));
  }

  /**
   * W0-08 (M4): instala o modelo pronto no equipamento como um plano comum (atividade, periodicidade e roteiro do modelo,
   * com o código e a versão dele), que se altera pela versão lida e tem as execuções imutáveis. O mesmo modelo ativo
   * duas vezes no mesmo equipamento: 409 `modelo-instalado`.
   */
  @Post('plano/modelo')
  @HttpCode(201)
  @Permissao(P.preventivaPlanejar)
  @AuditadoNoHandler('plano_preventivo com a trilha de auditoria na mesma transação')
  async instalarModelo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaInstalarModeloPlano, b);
    const m = MODELOS_PLANO_INFRA[e.modelo];
    const ok = conferirInstalacaoModelo(
      await this.porta.planos(s.porta, { equipamento: e.equipamento, soAtivos: true }),
      e.modelo,
    );
    if (!ok.ok) throw recusada(ok.recusa, ok.mensagem, ['modelo']);
    const plano = {
      equipamento: e.equipamento,
      atividade: m.atividade,
      periodicidade: { ...m.periodicidade },
      dataBase: e.dataBase,
      antecedenciaDias: null,
      procedimento: m.procedimento,
      executor: e.executor,
      cobertura: e.executor === 'contrato' ? e.cobertura : null,
    };
    const r = await this.apoio.sgh(
      s,
      E.manutencaoPlanoGravado.codigo,
      RECURSO,
      (y: { id: number }) => ({ tabela: 'plano_preventivo', id: String(y.id), paciente: null }),
      async (g) => {
        await conferirPlanoNovo(g, plano);
        return g.incluirPlano({
          ...plano,
          modelo: { codigo: e.modelo, versao: m.versao },
          usuario: s.login,
        });
      },
    );
    return { ok: true, ...r, mensagem: `Modelo "${m.nome}" instalado como plano de manutenção.` };
  }

  /**
   * W0-08 (M4): o relatório do PMOC do período em PDF/A (planos do modelo "pmocAr", execuções do período, contas com as
   * parcelas e a assinatura do responsável técnico). Sem o responsável técnico no parâmetro: 409
   * `pmoc-sem-responsavel` (cadastro do dono). Relido do banco, nunca o que a tela mostrou.
   */
  @Get('plano/pmoc/relatorio')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoPmocGerado.codigo)
  async relatorioPmoc(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
    @Res() res: Resposta,
  ) {
    const s = sessaoDe(req);
    const f = corpo(esquemaRelatorioPmoc, deQuery(q, { numeros: [] }));
    const periodo = conferirPeriodoPmoc(f.de, f.ate);
    if (!periodo.ok) throw recusada(periodo.recusa, periodo.mensagem, ['ate']);
    const [r, parametros, relogio, todos] = await Promise.all([
      this.apoio.resolvedorParametros(s),
      this.parametros(s),
      this.porta.relogio(s.porta),
      this.porta.planos(s.porta, { soAtivos: false }),
    ]);
    const responsavel = responsavelPmocDe(r('manutencao.pmocResponsavelTecnico') as string | null);
    if (!responsavel)
      throw recusada(
        'pmoc-sem-responsavel',
        'Cadastre o responsável técnico do PMOC (nome; registro profissional; ART) nos parâmetros da manutenção antes de emitir o relatório.',
        [],
      );
    const planos = todos.filter((p) => p.modelo?.codigo === 'pmocAr');
    const [equipamentos, nomes, execucoes] = await Promise.all([
      this.mapaEquipamentos(
        s,
        planos.map((p) => p.equipamento),
      ),
      this.nomes(s),
      Promise.all(planos.map(async (p) => [p.id, await this.porta.execucoes(s.porta, p.id)] as const)),
    ]);
    const doPmoc = new Map(
      [...equipamentos.values()].map((e) => [
        e.id,
        {
          id: e.id,
          codigo: e.codigo,
          nome: e.nome,
          local: [nomes.setores.get(e.centroCusto)?.nome ?? String(e.centroCusto), e.localizacao]
            .filter(Boolean)
            .join(' · '),
          fabricante: e.fabricante,
          modelo: e.modelo,
          numeroSerie: e.numeroSerie,
        },
      ]),
    );
    const html = htmlPmoc(
      montarPmoc({
        de: f.de,
        ate: f.ate,
        hoje: relogio.hoje,
        antecedenciaPadrao: parametros.antecedenciaDias,
        responsavel,
        planos,
        equipamentos: doPmoc,
        execucoes: new Map(execucoes),
        emissao: this.emissao(s),
      }),
    );
    return this.enviarDocumento(res, html, 'Relatório do PMOC', `pmoc-${f.de}-${f.ate}`);
  }

  @Post('plano/:id/ativo')
  @HttpCode(200)
  @Permissao(P.preventivaPlanejar)
  @AuditadoNoHandler('plano_preventivo com a trilha de auditoria na mesma transação')
  async ativar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(z.object({ versao: z.number().int().min(0), ativo: z.boolean() }).strict(), b);
    const n = idDaRota(id);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoPlanoGravado.codigo,
      RECURSO,
      { tabela: 'plano_preventivo', id: String(n), paciente: null },
      (g) => g.ativarPlano({ id: n, versaoVista: e.versao, ativo: e.ativo, usuario: s.login }),
    );
    return { ok: true, ...r, mensagem: e.ativo ? 'Plano reativado.' : 'Plano desativado.' };
  }

  @Get('plano/:id')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async detalhePlano(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<PlanoDetalhe> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const [p, versoes] = await Promise.all([this.porta.planoPorId(s.porta, n), this.versoesPlano(id, req)]);
    if (!p) throw naoEncontrado('Plano de manutenção');
    return {
      id: p.id,
      versao: p.versao,
      equipamento: p.equipamento,
      atividade: p.atividade,
      periodicidade: p.periodicidade,
      dataBase: p.dataBase,
      antecedenciaDias: p.antecedenciaDias,
      procedimento: p.procedimento,
      executor: p.executor,
      cobertura: p.cobertura,
      ativo: p.ativo,
      modelo: modeloDoPlano(p),
      versoes,
    };
  }

  @Get('plano/:id/versoes')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async versoesPlano(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<VersaoPlano[]> {
    const s = sessaoDe(req);
    const lidas = await this.porta.versoesPlano(s.porta, idDaRota(id));
    const nomes = await this.nomes(s, { logins: lidas.map((x) => x.por) });
    return lidas.map((x) => ({ ...x, por: nomes.usuarios.get(x.por.toUpperCase()) ?? x.por }));
  }

  /**
   * W0-08: alterar o plano pela versão lida (o plano equivale a uma regra: a alteração gera versão; a anterior fica
   * guardada com o motivo e as execuções registradas não mudam). Versão velha ou plano desativado: 409.
   */
  @Put('plano/:id')
  @HttpCode(200)
  @Permissao(P.preventivaPlanejar)
  @AuditadoNoHandler('plano_preventivo e a versão na trilha com a trilha de auditoria na mesma transação')
  async alterarPlano(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarPlano, { ...(b as object), plano: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoPlanoAlterado.codigo,
      RECURSO,
      { tabela: 'plano_preventivo', id: String(e.plano), paciente: null },
      async (g) => {
        const plano = await g.plano(e.plano);
        if (!plano) throw naoEncontrado('Plano de manutenção');
        if (plano.versao !== e.versao)
          throw recusada(
            'desatualizado',
            'O plano de manutenção mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        if (!plano.ativo)
          throw recusada('plano-desativado', 'O plano está desativado: reative-o antes de alterar.');
        if (e.executor === 'contrato') {
          const c = e.cobertura === null ? null : await g.cobertura(e.cobertura);
          if (!c || !c.ativa)
            throw recusada('fora-do-contrato', 'Contrato de manutenção não encontrado.', ['cobertura']);
          const ok = conferirAcionamento(c, plano.equipamento, plano.atividade, e.dataBase);
          if (!ok.ok) throw recusada(ok.recusa, ok.mensagem, ['cobertura']);
        }
        return g.alterarPlano({
          id: plano.id,
          versaoVista: e.versao,
          periodicidade: e.periodicidade,
          dataBase: e.dataBase,
          antecedenciaDias: e.antecedenciaDias,
          procedimento: e.procedimento,
          executor: e.executor,
          cobertura: e.executor === 'contrato' ? e.cobertura : null,
          motivo: e.motivo,
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      ...r,
      mensagem: 'Plano de manutenção alterado (a versão anterior ficou no histórico).',
    };
  }

  @Post('plano/:id/execucao')
  @HttpCode(201)
  @Permissao(P.preventivaPlanejar)
  @AuditadoNoHandler(
    'execucao_preventiva (e, reprovada, ordem_servico_manutencao com a parada e o aviso) com a trilha de auditoria na mesma transação',
  )
  async executar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarExecucao, { ...(b as object), plano: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoPlanoExecutado.codigo,
      RECURSO,
      (y: { id: number }) => ({ tabela: 'execucao_preventiva', id: String(y.id), paciente: null }),
      async (g) => {
        const plano = await g.plano(e.plano);
        if (!plano || !plano.ativo) throw naoEncontrado('Plano de manutenção');
        if (plano.versao !== e.versao)
          throw recusada(
            'desatualizado',
            'O plano de manutenção mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
          );
        const [eq, relogio] = await Promise.all([g.equipamento(plano.equipamento), g.relogio()]);
        if (!eq) throw naoEncontrado('Equipamento');
        const decisao = planejarExecucao({
          atividade: plano.atividade,
          data: e.data,
          hoje: relogio.hoje,
          resultado: e.resultado,
          laudo: e.laudo,
          ultimaExecucao: plano.ultimaExecucao,
          equipamentoDesativado: eq.situacao === 'desativado',
        });
        if (!decisao.ok) throw recusada(decisao.recusa, decisao.mensagem, ['laudo']);
        let corretiva: { id: number; numero: string } | null = null;
        if (decisao.abrirCorretiva) {
          corretiva = await g.abrirOs({
            natureza: 'corretiva',
            equipamento: eq.id,
            centroCusto: eq.centroCusto,
            local: null,
            descricao: `Reprovado no plano de manutenção (${plano.atividade}): ${e.observacao ?? ''}`.slice(
              0,
              2000,
            ),
            contato: null,
            prioridadeSugerida: eq.criticidade === 'critica' ? 'emergencia' : 'alta',
            prioridade: eq.criticidade === 'critica' ? 'emergencia' : 'alta',
            solicitante: s.login,
            registro: relogio.agora,
            parado: decisao.registrarParada,
            plano: plano.id,
            nota: 'Aberta pela execução reprovada do plano de manutenção.',
          });
          if (decisao.registrarParada) await ManutencaoController.avisarParada(g, eq, corretiva);
        }
        const x = await g.registrarExecucao({
          plano: plano.id,
          versaoVista: plano.versao,
          data: e.data,
          resultado: e.resultado,
          laudo: e.laudo,
          certificadoPadrao: e.certificadoPadrao,
          observacao: e.observacao,
          osCorretiva: corretiva?.id ?? null,
          usuario: s.login,
        });
        return { id: x.id, versao: x.versaoPlano, corretiva };
      },
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      numero: r.corretiva?.numero ?? null,
      mensagem: r.corretiva
        ? `Execução registrada. Reprovada: a ordem de serviço ${r.corretiva.numero} foi aberta e o equipamento ficou parado.`
        : 'Execução registrada.',
    };
  }

  // ── Contratos de manutenção ───────────────────────────────────────────────────────────────────────────────────────

  @Get('coberturas')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async coberturas(
    @Query('equipamento') equipamento: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContratoManutencao[]> {
    const s = sessaoDe(req);
    const eq = equipamento ? lerIdBanco(equipamento) : null;
    const [lidas, relogio] = await Promise.all([
      this.porta.coberturas(s.porta, { equipamento: eq }),
      this.porta.relogio(s.porta),
    ]);
    const nomes = await this.nomes(s, { fornecedores: lidas.map((c) => c.fornecedor) });
    return lidas.map((c) => contratoDaLista(c, nomes, relogio.hoje));
  }

  @Get('coberturas/:id')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async detalheCobertura(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContratoManutencaoDetalhe> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const [[c], versoes, relogio] = await Promise.all([
      this.porta.coberturas(s.porta, { ids: [n] }),
      this.porta.versoesCobertura(s.porta, n),
      this.porta.relogio(s.porta),
    ]);
    if (!c) throw naoEncontrado('Contrato de manutenção');
    const nomes = await this.nomes(s, { fornecedores: [c.fornecedor], logins: versoes.map((v) => v.por) });
    return {
      ...contratoDaLista(c, nomes, relogio.hoje),
      versoes: versoes.map((v) => ({
        versao: v.versao,
        operacao: v.operacao,
        inicio: v.inicio,
        fim: v.fim,
        slaHoras: v.slaHoras,
        valorMensal: v.valorMensalCent === null ? null : v.valorMensalCent / 100,
        equipamentos: v.equipamentos,
        motivo: v.motivo,
        por: nomes.usuarios.get(v.por.toUpperCase()) ?? v.por,
        em: v.em,
      })),
    };
  }

  /**
   * W0-08: alterar o contrato pela versão lida (vigência, SLA, valor mensal e equipamentos; a versão anterior fica com
   * o motivo). Recusa 409: versão velha, contrato encerrado, ou equipamento retirado que um plano ativo ainda aciona
   * por este contrato (altere o executor do plano antes).
   */
  @Put('coberturas/:id')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'contrato_servico_terceirizado, contrato_servico_terceirizado_item e a versão na trilha com a trilha de auditoria na mesma transação',
  )
  async alterarCobertura(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarContratoManutencao, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoCoberturaAlterada.codigo,
      RECURSO,
      { tabela: 'contrato_servico_terceirizado', id: String(e.id), paciente: null },
      async (g) => {
        const c = await g.cobertura(e.id);
        if (!c) throw naoEncontrado('Contrato de manutenção');
        if (c.versao !== e.versao) throw contratoDesatualizado();
        if (!c.ativa)
          throw recusada(
            'contrato-encerrado',
            'O contrato de manutenção está encerrado: não se altera mais.',
          );
        for (const q of e.equipamentos)
          if (!c.equipamentos.includes(q) && !(await g.equipamento(q)))
            throw recusada(
              'equipamento-inexistente',
              'Um dos equipamentos não existe neste estabelecimento.',
              ['equipamentos'],
            );
        const retirados = c.equipamentos.filter((q) => !e.equipamentos.includes(q));
        const planos = await g.planosAtivosDoContrato(c.id, retirados);
        if (planos > 0)
          throw recusada(
            'equipamento-com-plano',
            `${planos} ${planos === 1 ? 'plano ativo aciona' : 'planos ativos acionam'} este contrato num equipamento retirado: altere o executor do plano antes de tirar o equipamento do contrato.`,
            ['equipamentos'],
          );
        return g.alterarCobertura({
          id: c.id,
          versaoVista: e.versao,
          inicio: e.inicio,
          fim: e.fim,
          slaHoras: e.slaHoras,
          valorMensalCent: e.valorMensal === null ? null : centavos(e.valorMensal),
          equipamentos: e.equipamentos,
          motivo: e.motivo,
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem: 'Contrato de manutenção alterado (a versão anterior ficou no histórico).',
    };
  }

  /** W0-08: encerrar o contrato com motivo e data (dentro da vigência); recusa enquanto um plano ativo o acionar. */
  @Post('coberturas/:id/encerramento')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'contrato_servico_terceirizado e a versão na trilha com a trilha de auditoria na mesma transação',
  )
  async encerrarCobertura(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarContratoManutencao, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoCoberturaEncerrada.codigo,
      RECURSO,
      { tabela: 'contrato_servico_terceirizado', id: String(e.id), paciente: null },
      async (g) => {
        const c = await g.cobertura(e.id);
        if (!c) throw naoEncontrado('Contrato de manutenção');
        if (c.versao !== e.versao) throw contratoDesatualizado();
        if (!c.ativa) throw recusada('contrato-encerrado', 'O contrato de manutenção já está encerrado.');
        if (e.data < c.inicio || e.data > c.fim)
          throw recusada(
            'data-fora-da-vigencia',
            `A data do encerramento fica entre o início (${c.inicio}) e o fim (${c.fim}) da vigência.`,
            ['data'],
          );
        const planos = await g.planosAtivosDoContrato(c.id);
        if (planos > 0)
          throw recusada(
            'contrato-com-planos',
            `${planos} ${planos === 1 ? 'plano ativo aciona' : 'planos ativos acionam'} este contrato: altere o executor desses planos antes de encerrar.`,
          );
        return g.encerrarCobertura({
          id: c.id,
          versaoVista: e.versao,
          data: e.data,
          motivo: e.motivo,
          usuario: s.login,
        });
      },
    );
    return { ok: true, ...r, mensagem: 'Contrato de manutenção encerrado.' };
  }

  /**
   * W0-08: excluir o contrato registrado por engano (física, com o retrato da linha). Com OS, plano ou versão de plano
   * ligados, 409 `com-dependentes` com quantos e quais, oferecendo o encerramento.
   */
  @Post('coberturas/:id/exclusao')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'contrato_servico_terceirizado* (retrato na trilha de auditoria) com a trilha de auditoria na mesma transação',
  )
  async excluirCobertura(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaExcluirContratoManutencao, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoCoberturaExcluida.codigo,
      RECURSO,
      { tabela: 'contrato_servico_terceirizado', id: String(e.id), paciente: null },
      async (g) => {
        const c = await g.cobertura(e.id);
        if (!c) throw naoEncontrado('Contrato de manutenção');
        if (c.versao !== e.versao) throw contratoDesatualizado();
        return g.excluirCobertura({ id: c.id, versaoVista: e.versao, motivo: e.motivo, usuario: s.login });
      },
    );
    return { ok: true, ...r, mensagem: 'Contrato de manutenção excluído.' };
  }

  @Post('coberturas')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'contrato_servico_terceirizado e contrato_servico_terceirizado_item com a trilha de auditoria na mesma transação',
  )
  async gravarCobertura(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCoberturaContrato, b);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoCoberturaGravada.codigo,
      RECURSO,
      (y: { id: number }) => ({
        tabela: 'contrato_servico_terceirizado',
        id: String(y.id),
        paciente: null,
        chave: e.numero,
      }),
      async (g) => {
        if (!(await g.fornecedorExiste(e.fornecedor)))
          throw recusada('fornecedor-inexistente', 'Fornecedor não encontrado.', ['fornecedor']);
        for (const id of e.equipamentos)
          if (!(await g.equipamento(id)))
            throw recusada(
              'equipamento-inexistente',
              'Um dos equipamentos não existe neste estabelecimento.',
              ['equipamentos'],
            );
        return g.incluirCobertura({
          fornecedor: e.fornecedor,
          numero: e.numero,
          cobertura: e.cobertura,
          inicio: e.inicio,
          fim: e.fim,
          slaHoras: e.slaHoras,
          valorMensalCent: e.valorMensal === null ? null : centavos(e.valorMensal),
          contrato: e.contrato,
          equipamentos: e.equipamentos,
          usuario: s.login,
        });
      },
    );
    return { ok: true, ...r, mensagem: `Contrato de manutenção ${e.numero} registrado.` };
  }

  // ── Tecnovigilância e recall (W0-08, parte 8; mercado M2) ─────────────────────────────────────────────────────────

  @Get('alertas')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async alertas(
    @Query('situacao') situacao: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AlertaEquipamento[]> {
    const f: SituacaoAlertaEquipamento | null =
      situacao === 'aberto' || situacao === 'encerrado' ? situacao : null;
    return this.porta.alertas(sessaoDe(req).porta, { situacao: f });
  }

  @Get('alertas/:id')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async detalheAlerta(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AlertaEquipamentoDetalhe> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    const [a, parque, acoes, r] = await Promise.all([
      this.porta.alerta(s.porta, n),
      this.porta.parqueDoAlerta(s.porta, n),
      this.porta.acoesDoAlerta(s.porta, n),
      this.apoio.resolvedorParametros(s),
    ]);
    if (!a) throw naoEncontrado('Alerta de tecnovigilância');
    const importacao = String(r('manutencao.alertasAnvisaImportacao') ?? 'nao').toLowerCase();
    return {
      ...a,
      afetados: afetados(a, parque, acoes),
      importacaoAnvisa: importacao === 'sim' || importacao === 'true',
    };
  }

  /** Os equipamentos do parque diante do alerta: afetados pela faixa de série e os sem série, a conferir. */
  @Get('alertas/:id/afetados')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async afetadosDoAlerta(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return (await this.detalheAlerta(id, req)).afetados;
  }

  /** Registrar o alerta ou recall à mão (a importação da Anvisa é parâmetro desligado: não há credencial). */
  @Post('alertas')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler('alerta_sanitario com a trilha de auditoria na mesma transação')
  async registrarAlerta(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAlertaEquipamento, b);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoAlertaRegistrado.codigo,
      RECURSO,
      (y: { id: number }) => ({
        tabela: 'alerta_sanitario',
        id: String(y.id),
        paciente: null,
        chave: e.numero,
      }),
      (g) => g.incluirAlerta({ ...e, usuario: s.login, conferir: conferirFaixaDoAlerta(e) }),
    );
    return { ok: true, ...r, mensagem: `Alerta ${e.numero} registrado.` };
  }

  /** Alterar pela versão lida, com motivo; o critério (fabricante, modelo, faixa) trava depois da primeira OS. */
  @Put('alertas/:id')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler('alerta_sanitario com a trilha de auditoria na mesma transação')
  async alterarAlerta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarAlertaEquipamento, { ...(b as object), id: idDaRota(id) });
    const { id: alvo, versao, ...campos } = e;
    const r = await this.apoio.sgh(
      s,
      E.manutencaoAlertaAlterado.codigo,
      RECURSO,
      { tabela: 'alerta_sanitario', id: String(alvo), paciente: null },
      (g) =>
        g.alterarAlerta({
          ...campos,
          id: alvo,
          versaoVista: versao,
          usuario: s.login,
          conferir: conferirAlteracaoDoAlerta(versao, campos),
        }),
    );
    return { ok: true, id: r.id, versao: r.versao, mensagem: 'Alerta alterado.' };
  }

  @Post('alertas/:id/encerramento')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler('alerta_sanitario com a trilha de auditoria na mesma transação')
  async encerrarAlerta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarAlertaEquipamento, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoAlertaEncerrado.codigo,
      RECURSO,
      { tabela: 'alerta_sanitario', id: String(e.id), paciente: null },
      (g) => g.encerrarAlerta({ id: e.id, versaoVista: e.versao, motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true, ...r, mensagem: 'Alerta encerrado.' };
  }

  /**
   * Excluir o alerta registrado por engano (física, com o retrato da linha). Com OS de ação de campo ou queixa ligadas,
   * 409 `com-dependentes` com quantos e quais, oferecendo o encerramento. O motivo vai no corpo do DELETE.
   */
  @Delete('alertas/:id')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'alerta_sanitario (retrato na trilha de auditoria) com a trilha de auditoria na mesma transação',
  )
  async excluirAlerta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaExcluirAlertaEquipamento, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoAlertaExcluido.codigo,
      RECURSO,
      { tabela: 'alerta_sanitario', id: String(e.id), paciente: null },
      (g) => g.excluirAlerta({ id: e.id, versaoVista: e.versao, motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true, ...r, mensagem: 'Alerta excluído.' };
  }

  /** Uma OS de inspeção (ação de campo) por equipamento afetado ainda sem OS, pela versão vista do alerta. */
  @Post('alertas/:id/acao-de-campo')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'ordem_servico_manutencao, ordem_servico_manutencao_evento e alerta_sanitario_equipamento com a trilha de auditoria na mesma transação',
  )
  async acaoDeCampo(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAcaoDeCampo> {
    const s = sessaoDe(req);
    const e = corpo(esquemaGerarAcaoDeCampo, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoAlertaAcaoDeCampo.codigo,
      RECURSO,
      { tabela: 'alerta_sanitario', id: String(e.id), paciente: null },
      async (g) =>
        g.gerarAcaoDeCampo({
          id: e.id,
          versaoVista: e.versao,
          prioridade: e.prioridade,
          usuario: s.login,
          registro: (await g.relogio()).agora.slice(0, 16),
          planejar: planejarAcaoDoAlerta(e.versao, e.equipamentos),
        }),
    );
    const n = r.geradas.length;
    return {
      ok: true,
      id: e.id,
      versao: r.versao,
      geradas: r.geradas,
      mensagem: `${n} ${n === 1 ? 'OS de ação de campo gerada' : 'OS de ação de campo geradas'}: ${r.geradas
        .map((x) => x.numero)
        .join(', ')}.`,
    };
  }

  /**
   * A queixa técnica da OS, aberta na vigilância de produto da qualidade (RDC 67/2009: quem identifica o desvio do
   * equipamento notifica a gerência de risco). Uma por OS; a OS precisa de equipamento.
   */
  @Post('os/:id/queixa-tecnica')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'queixa_tecnica_produto e vínculo da queixa com a trilha de auditoria na mesma transação',
  )
  async queixaTecnica(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaQueixaDaOs, { ...(b as object), os: idDaRota(id) });
    await this.osVisivel(s, e.os);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoOsQueixaTecnica.codigo,
      RECURSO,
      { tabela: 'ordem_servico_manutencao', id: String(e.os), paciente: null },
      async (g) =>
        g.abrirQueixaDaOs({ ...e, usuario: s.login, agora: (await g.relogio()).agora.slice(0, 16) }),
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem: 'Queixa técnica aberta na vigilância de produto da qualidade.',
    };
  }

  // ── Treinamento dos operadores e ciclo de vida (W0-08, parte 9; mercado M3; RDC 509/2021) ──────────────────────────

  /** Os cursos exigidos por modelo (fabricante + modelo comparados sem acento nem caixa; sem os dois: todos). */
  @Get('modelos/cursos')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async cursosDosModelos(
    @Query('fabricante') fabricante: string | undefined,
    @Query('modelo') modelo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<CursoDoModelo[]> {
    const s = sessaoDe(req);
    const chave = chaveDoModelo(fabricante?.slice(0, 60), modelo?.slice(0, 60));
    if (!chave && (fabricante || modelo)) return [];
    return this.porta.cursosDosModelos(s.porta, chave ?? undefined);
  }

  /** O catálogo do treinamento (pessoas, f6), só leitura, para o combo do curso exigido. */
  @Get('modelos/cursos/catalogo')
  @Permissao(P.equipamentoEditar)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async catalogoCursos(@Req() req: RequisicaoAutorizada): Promise<CursoDoCatalogo[]> {
    return this.porta.catalogoCursos(sessaoDe(req).porta);
  }

  @Post('modelos/cursos')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler('modelo_equipamento_curso com a trilha de auditoria na mesma transação')
  async vincularCursoModelo(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaVincularCursoModelo, b);
    const chave = chaveDoModelo(e.fabricante, e.modelo);
    if (!chave)
      throw recusada('modelo-invalido', 'Informe o fabricante e o modelo.', ['fabricante', 'modelo']);
    const r = await this.apoio.sgh(
      s,
      E.manutencaoCursoModeloVinculado.codigo,
      RECURSO,
      (y: { id: number }) => ({
        tabela: 'modelo_equipamento_curso',
        id: String(y.id),
        paciente: null,
        chave: `${chave.fabricante} ${chave.modelo}`.slice(0, 60),
      }),
      (g) => g.vincularCursoModelo({ ...chave, curso: e.curso, usuario: s.login }),
    );
    return { ok: true, id: r.id, versao: 1, mensagem: 'Curso exigido para operar o modelo.' };
  }

  /** Deixar de exigir o curso: exclusão física com o retrato e o motivo (nada depende do vínculo). */
  @Delete('modelos/cursos/:id')
  @HttpCode(200)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler(
    'modelo_equipamento_curso (retrato na trilha de auditoria) com a trilha de auditoria na mesma transação',
  )
  async desvincularCursoModelo(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDesvincularCursoModelo, { ...(b as object), id: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoCursoModeloExcluido.codigo,
      RECURSO,
      { tabela: 'modelo_equipamento_curso', id: String(e.id), paciente: null },
      async (g) => {
        if (!(await g.cursoDoModelo(e.id))) throw naoEncontrado('Curso exigido do modelo');
        return g.desvincularCursoModelo({ ...e, usuario: s.login });
      },
    );
    return { ok: true, id: r.id, versao: 1, mensagem: 'O curso deixou de ser exigido para o modelo.' };
  }

  /** Quem está apto a operar o equipamento (todos os cursos exigidos do modelo, dentro da validade) e os pendentes. */
  @Get('equipamentos/:id/operadores')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async operadoresDoEquipamento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<OperadoresDoModelo> {
    const s = sessaoDe(req);
    const e = await this.porta.equipamento(s.porta, idDaRota(id));
    if (!e) throw naoEncontrado('Equipamento');
    const chave = chaveDoModelo(e.fabricante, e.modelo);
    if (!chave) return { cursos: [], aptos: [], pendentes: [] };
    const [cursos, relogio] = await Promise.all([
      this.porta.cursosDosModelos(s.porta, chave),
      this.porta.relogio(s.porta),
    ]);
    const exigidos = cursos.filter((c) => c.cursoAtivo).map((c) => c.curso);
    const conclusoes = exigidos.length ? await this.porta.conclusoesDosCursos(s.porta, exigidos) : [];
    return operadoresDoModelo(cursos, conclusoes, relogio.hoje);
  }

  /** O índice de obsolescência (idade, custo e falhas na janela de 12 meses), com as parcelas. */
  @Get('equipamentos/:id/obsolescencia')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async obsolescencia(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndiceObsolescencia> {
    return this.montarObsolescencia(sessaoDe(req), idDaRota(id));
  }

  private async montarObsolescencia(s: SessaoCadastro, idEq: number): Promise<IndiceObsolescencia> {
    const e = await this.porta.equipamento(s.porta, idEq);
    if (!e) throw naoEncontrado('Equipamento');
    const [relogio, r] = await Promise.all([this.porta.relogio(s.porta), this.apoio.resolvedorParametros(s)]);
    return (await this.obsolescenciaDe(s, e, relogio.hoje, r)).indice;
  }

  /** O índice e os eventos do ciclo de vida do equipamento já lido (a ficha e o PGTS). */
  private async obsolescenciaDe(
    s: SessaoCadastro,
    e: EquipamentoManutencao,
    hoje: string,
    r: (chave: string) => unknown,
  ): Promise<{ indice: IndiceObsolescencia; eventos: EventoCicloVida[] }> {
    const relogio = { hoje };
    const [eventos, base, bem] = await Promise.all([
      this.porta.eventosCiclo(s.porta, e.id),
      this.porta.baseObsolescencia(s.porta, e.id, inicioDaJanela(relogio.hoje)),
      e.bemPatrimonial === null || !this.patrimonio || this.patrimonio.destino === 'indisponivel'
        ? Promise.resolve(null)
        : this.patrimonio.bem(s.porta, e.bemPatrimonial).catch(() => null),
    ]);
    const padrao = Number(r('manutencao.vidaUtilPadraoMeses') ?? 120);
    const indice = montarIndice({
      hoje: relogio.hoje,
      eventos,
      instalacao: e.instalacao,
      bem: bem && bem.situacao !== 'baixado' ? bem : null,
      vidaUtilPadraoMeses: Number.isFinite(padrao) && padrao > 0 ? padrao : 120,
      base,
    });
    return { indice, eventos: [...eventos] };
  }

  /**
   * O plano de gerenciamento das tecnologias em saúde (RDC 509/2021) gerado do cadastro, em PDF/A: o inventário por
   * tipo, criticidade e classe de risco, o treinamento por modelo com os aptos, o índice de cada equipamento com as
   * parcelas, os eventos do ciclo de vida e os planos. Relido do banco, nunca o que a tela mostrou.
   */
  @Get('equipamentos/pgts/documento')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoPgtsGerado.codigo)
  async documentoPgts(@Req() req: RequisicaoAutorizada, @Res() res: Resposta) {
    const s = sessaoDe(req);
    const equipamentos: EquipamentoManutencao[] = [];
    for (let antesDe: number | null = null; ;) {
      const pg = await this.porta.equipamentos(s.porta, { antesDe, limite: TETO_PGTS });
      equipamentos.push(...pg.itens);
      if (pg.proxima === null || equipamentos.length >= TETO_PGTS) break;
      antesDe = pg.proxima;
    }
    const [relogio, r, nomes, planos, cursos] = await Promise.all([
      this.porta.relogio(s.porta),
      this.apoio.resolvedorParametros(s),
      this.nomes(s),
      this.porta.planos(s.porta, { soAtivos: false }),
      this.porta.cursosDosModelos(s.porta),
    ]);
    // O índice e os eventos de cada equipamento, de 8 em 8 (cada um lê as OS da janela e o bem ligado).
    const ciclo = new Map<number, { indice: IndiceObsolescencia; eventos: EventoCicloVida[] }>();
    for (let i = 0; i < equipamentos.length; i += 8)
      for (const [id, v] of await Promise.all(
        equipamentos
          .slice(i, i + 8)
          .map(async (e) => [e.id, await this.obsolescenciaDe(s, e, relogio.hoje, r)] as const),
      ))
        ciclo.set(id, v);
    const exigidos = [...new Set(cursos.filter((c) => c.cursoAtivo).map((c) => c.curso))];
    const conclusoes = exigidos.length ? await this.porta.conclusoesDosCursos(s.porta, exigidos) : [];
    const html = htmlPgts(
      montarPgts({
        hoje: relogio.hoje,
        equipamentos,
        ciclo,
        setor: (cc) => nomes.setores.get(cc)?.nome ?? String(cc),
        cursos,
        conclusoes,
        planos,
        emissao: this.emissao(s),
      }),
    );
    return this.enviarDocumento(res, html, 'Plano de gerenciamento das tecnologias em saúde', 'pgts');
  }

  /** Os eventos do ciclo de vida (incorporação, desativação e descarte), na ordem da data. */
  @Get('equipamentos/:id/eventos')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoEquipamentosLidos.codigo)
  async eventosDoEquipamento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EventoCicloVida[]> {
    const s = sessaoDe(req);
    const n = idDaRota(id);
    if (!(await this.porta.equipamento(s.porta, n))) throw naoEncontrado('Equipamento');
    return this.porta.eventosCiclo(s.porta, n);
  }

  /** Registrar um evento do ciclo de vida (fato novo, nunca editado; a desativação marca o equipamento). */
  @Post('equipamentos/:id/eventos')
  @HttpCode(201)
  @Permissao(P.equipamentoEditar)
  @AuditadoNoHandler('evento_ciclo_equipamento com a trilha de auditoria na mesma transação')
  async registrarEventoCiclo(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManutencao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarEventoCiclo, { ...(b as object), equipamento: idDaRota(id) });
    const r = await this.apoio.sgh(
      s,
      E.manutencaoEquipamentoEvento.codigo,
      RECURSO,
      (y: { id: number }) => ({
        tabela: 'evento_ciclo_equipamento',
        id: String(y.id),
        paciente: null,
        chave: `${e.equipamento} ${e.tipo}`,
      }),
      (g) => g.registrarEventoCiclo({ ...e, usuario: s.login, conferir: conferirEvento(e) }),
    );
    return {
      ok: true,
      id: r.id,
      versao: 1,
      mensagem: `Evento do ciclo de vida registrado: ${TIPOS_EVENTO_CICLO[e.tipo]}.`,
    };
  }

  // ── Indicadores ───────────────────────────────────────────────────────────────────────────────────────────────────

  @Get('indicadores')
  @Permissao(P.equipamentoLer)
  @Auditar(E.manutencaoIndicadoresLidos.codigo)
  async indicadores(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresManutencao> {
    const s = sessaoDe(req);
    const f = corpo(esquemaPeriodoIndicadores, deQuery(q, { numeros: ['equipamento', 'centroCusto'] }));
    const [o, relogio] = await Promise.all([this.porta.ocorrencias(s.porta, f), this.porta.relogio(s.porta)]);
    return indicadores(o, f, relogio.agora);
  }
}

/** O equipamento e o contrato do plano novo (à mão ou do modelo pronto), relidos na transação. */
async function conferirPlanoNovo(
  g: GravadorManutencao,
  e: {
    equipamento: number;
    atividade: AtividadePlano;
    dataBase: string;
    executor: 'interno' | 'contrato';
    cobertura: number | null;
  },
): Promise<void> {
  const eq = await g.equipamento(e.equipamento);
  if (!eq) throw recusada('equipamento-inexistente', 'Equipamento não encontrado.', ['equipamento']);
  if (eq.situacao === 'desativado')
    throw recusada('equipamento-desativado', 'O equipamento está desativado.', ['equipamento']);
  if (e.executor === 'contrato') {
    const c = e.cobertura === null ? null : await g.cobertura(e.cobertura);
    if (!c || !c.ativa)
      throw recusada('fora-do-contrato', 'Contrato de manutenção não encontrado.', ['cobertura']);
    const ok = conferirAcionamento(c, eq.id, e.atividade, e.dataBase);
    if (!ok.ok) throw recusada(ok.recusa, ok.mensagem, ['cobertura']);
  }
}

/** O modelo pronto de onde o plano veio, com o código conferido contra o vocabulário (código estranho: null). */
function modeloDoPlano(p: PlanoManutencao): { codigo: CodigoModeloPlano; versao: number } | null {
  const c = p.modelo?.codigo;
  return p.modelo && c && c in MODELOS_PLANO_INFRA
    ? { codigo: c as CodigoModeloPlano, versao: p.modelo.versao }
    : null;
}

const contratoDesatualizado = () =>
  recusada(
    'desatualizado',
    'O contrato de manutenção mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

/** O contrato na lista: o resumo, a versão e o encerramento (W0-08). */
function contratoDaLista(
  c: CoberturaManutencao,
  nomes: Parameters<typeof resumoCobertura>[1],
  hoje: string,
): ContratoManutencao {
  return {
    ...resumoCobertura(c, nomes, hoje),
    versao: c.versao,
    equipamentos: c.equipamentos,
    valorMensal: c.valorMensalCent === null ? null : c.valorMensalCent / 100,
    ativa: c.ativa,
    encerradaEm: c.encerradaEm,
    motivoEncerramento: c.motivoEncerramento,
  };
}

const MENSAGEM_DA_SITUACAO: Readonly<Record<OrdemServico['situacao'], string>> = {
  aberta: 'Ordem de serviço aberta.',
  emAtendimento: 'Ordem de serviço em atendimento.',
  aguardandoPeca: 'Ordem de serviço aguardando peça.',
  aguardandoTerceiro: 'Ordem de serviço aguardando fornecedor.',
  concluida: 'Ordem de serviço concluída: aguarda o aceite de quem abriu.',
  encerrada: 'Ordem de serviço encerrada.',
  cancelada: 'Ordem de serviço cancelada.',
};
