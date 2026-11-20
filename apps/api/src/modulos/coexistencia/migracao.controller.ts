// Telas "Administração > Coexistência com o legado > Migração gradual dos usuários" (M37; ficha, seção 7) e o diálogo
// "Abrir chamado" da casca:
//   GET  /api/administracao/coexistencia/migracao/setores                     setores, público por papel, lotes
//   POST /api/administracao/coexistencia/migracao/setores/:codigo             situação, chave, condução, aceite, composição
//   GET  /api/administracao/coexistencia/migracao/pessoas?setor&termo&pagina  por pessoa (leitura vai à trilha)
//   GET  /api/administracao/coexistencia/migracao/treinamento                 trilhas, turmas, conclusões
//   GET  /api/administracao/coexistencia/migracao/treinamento/guias/:papel/:tarefa/:tipo  guia ou roteiro de vídeo
//   POST /api/administracao/coexistencia/migracao/treinamento/trilhas/:papel/:onda   publicar a versão
//   POST /api/administracao/coexistencia/migracao/treinamento/conclusoes      registrar a conclusão da turma
//   POST /api/administracao/coexistencia/migracao/treinamento/conclusoes/:id/estorno   estornar a conclusão (W0-09)
//   POST /api/administracao/coexistencia/migracao/treinamento/trilhas/:papel/:onda/versoes/:versao/retirada
//                                                                             retirar a versão: excluir ou inativar (W0-09)
//   POST /api/administracao/coexistencia/migracao/criterio/:setor/itens/:item/pendente  voltar o item a pendente (W0-09)
//   GET  /api/administracao/coexistencia/migracao/indicadores?dias            os cinco indicadores do cap-15 §15.3.4
//   POST /api/administracao/coexistencia/migracao/lotes                       aplicar o lote (reautenticação)
//   POST /api/administracao/coexistencia/migracao/lotes/:id/recolher          recolher o lote (reautenticação)
//   GET  /api/administracao/coexistencia/migracao/conducao/:setor             lista proposta e impacto por grupo
//   POST /api/administracao/coexistencia/migracao/conducao/:setor/retirar     retirar (acesso.revogarOpcoesGrupo)
//   POST /api/administracao/coexistencia/migracao/conducao/:setor/devolver    devolver (acesso.concederOpcoesGrupo)
//   GET  /api/administracao/coexistencia/migracao/chamados?severidade&situacao&sistema&setor&dias&pagina
//                                                                             chamados por severidade e prazo (50 por página)
//   POST /api/chamados                                                        abrir chamado (todos)
//   POST /api/administracao/coexistencia/migracao/chamados/:id/triar          triar (N1 e N2)
//   GET  /api/administracao/coexistencia/migracao/onda2                       critério por setor da onda 2 (M40)
//   PUT  /api/administracao/coexistencia/migracao/onda2/criterio/:setor       registrar itens do critério (M40)
//   GET  /api/administracao/coexistencia/migracao/onda2/acompanhamento?de&ate checagem, higienização e registros (M40)
//   GET  /api/administracao/coexistencia/migracao/onda3                       critério por setor da onda 3 (M41)
//   PUT  /api/administracao/coexistencia/migracao/onda3/criterio/:setor       registrar itens do critério (M41)
//   GET  /api/administracao/coexistencia/migracao/onda4                       critério por setor da onda 4 (M42)
//   PUT  /api/administracao/coexistencia/migracao/onda4/criterio/:setor       registrar itens do critério (M42)
import { resolve } from 'node:path';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { PERMISSOES_M37 as P } from '@sgh/contratos';
import { lerCodigos, lerEstabelecimentos, type MetricasExecutor } from '@sgh/legado';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { contextoOperacao } from '../administracao/comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from '../administracao/fonte.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  FONTE_HOMOLOGACAO,
  type FonteHomologacao,
  CAMINHO_CATALOGO_LIBERACAO,
  CRITERIO_LIGAR_SETOR,
  type CriterioLigarSetor,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  METRICAS_EXECUTOR,
} from '../config/public-api.js';
import { ServicoCicloCoex } from './aplicacao/ciclo.js';
import { ServicoMigracao } from './aplicacao/servico.js';
import { PORTA_COEXISTENCIA, type PortaCoexistencia } from './porta.js';

const BASE = 'administracao/coexistencia/migracao';

/** Opções do painel lidas do ambiente da API (app.module): o primeiro da DP-4, os estabelecimentos e os endereços. */
export const OPCOES_MIGRACAO = Symbol('OPCOES_MIGRACAO');
export interface OpcoesMigracao {
  readonly primeiro: { codigo: string; nome: string } | undefined;
  readonly hospitais: readonly string[];
  readonly grafana: string;
  readonly metodoMascaramento: string | null;
  /** A pasta dos guias e roteiros gerados por `pnpm treinamento:gerar` (servidos pela rota dos guias). */
  readonly raizTreinamento?: string;
  /** M42 (regra 8): a pasta do acompanhamento das respostas do faturamento e do fiscal. */
  readonly raizRespostas?: string;
}

export function opcoesMigracaoDoAmbiente(env: NodeJS.ProcessEnv): OpcoesMigracao {
  return {
    primeiro: primeiroEstabelecimento(env),
    hospitais: lerCodigos(env),
    grafana: env['GRAFANA_URL']?.trim() || env['VITE_GRAFANA_URL']?.trim() || 'http://127.0.0.1:3330',
    metodoMascaramento: env['TREINO_METODO_MASCARAMENTO']?.trim() || null,
    raizTreinamento: resolve(process.cwd(), env['SGH_TREINAMENTO'] ?? 'docs/prontidao/treinamento'),
    raizRespostas: resolve(process.cwd(), env['SGH_RESPOSTAS'] ?? 'respostas'),
  };
}

/** DP-4: o primeiro de ESTABELECIMENTOS vai primeiro (na Rede Santé, o ProntoCardio); sem configuração, o padrão. */
function primeiroEstabelecimento(env: NodeJS.ProcessEnv): { codigo: string; nome: string } | undefined {
  try {
    const e = lerEstabelecimentos(env)[0];
    if (e) return { codigo: e.codigo, nome: e.nome };
  } catch {
    const c = lerCodigos(env)[0];
    if (c) return { codigo: c, nome: c };
  }
  return undefined;
}

interface CorpoComSenha {
  readonly senha?: string;
}
const senhaDe = (b: unknown) =>
  typeof (b as CorpoComSenha)?.senha === 'string' ? (b as CorpoComSenha).senha : undefined;

@Controller()
export class MigracaoController implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly servico: ServicoMigracao;
  readonly ciclo: ServicoCicloCoex;
  private temporizador: NodeJS.Timeout | undefined;
  private readonly hospitais: readonly string[];

  constructor(
    @Inject(PORTA_COEXISTENCIA) private readonly porta: PortaCoexistencia,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    @Inject(CAMINHO_CATALOGO_LIBERACAO) caminhoCatalogo: string,
    @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(FONTE_ADMINISTRACAO) administracao: FonteAdministracao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfig: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(OPCOES_MIGRACAO) opcoes: OpcoesMigracao | null = null,
    @Optional() @Inject(METRICAS_EXECUTOR) metricas: MetricasExecutor | null = null,
    @Optional() @Inject(FONTE_HOMOLOGACAO) homologacao: FonteHomologacao | null = null,
    @Optional() @Inject(CRITERIO_LIGAR_SETOR) criterio: CriterioLigarSetor | null = null,
  ) {
    const o = opcoes ?? opcoesMigracaoDoAmbiente(process.env);
    this.hospitais = o.hospitais;
    this.ciclo = new ServicoCicloCoex(porta);
    this.servico = new ServicoMigracao({
      porta,
      trilha,
      administracao,
      fonteConfig,
      cache,
      caminhoCatalogo,
      ambiente: cfg.ambiente,
      grafana: o.grafana,
      metodoMascaramento: o.metodoMascaramento,
      primeiro: o.primeiro,
      raizTreinamento: o.raizTreinamento,
      raizRespostas: o.raizRespostas,
      metricas: metricas ?? undefined,
      homologacao: homologacao ?? undefined,
      criterio: criterio ?? undefined,
    });
    // M40: a tela "Chaves de liberação" confere o critério do setor da onda 2 por aqui (o mesmo do lote).
    if (criterio) criterio.avaliar = (c, tipo, chave) => this.servico.motivoLigarChaveOnda2(c, tipo, chave);
  }

  /**
   * Fora de dev/ci, o processo da API grava a cada 15 min o dia corrente das tarefas-chave e das parcelas
   * (SGH_CFG_COEX_USO_DIA); em dev/ci a cópia é compartilhada (a gravação é provada pela integração, com ROLLBACK).
   */
  onApplicationBootstrap(): void {
    if (this.porta.destino !== 'legado' || ['dev', 'ci'].includes(this.cfg.ambiente)) return;
    if ((process.env['COEX_USO_DIA'] ?? '').trim() === 'desligado') return;
    const rede = this.cfg.rede ?? '';
    const hospitais = this.hospitais;
    this.temporizador = setInterval(() => {
      for (const hospital of hospitais)
        void this.servico.gravarDiaCorrente({ rede, hospital }).catch(() => undefined);
    }, 900_000);
    this.temporizador.unref();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  // ── Setores ──────────────────────────────────────────────────────────────────────────────────────────

  @Get(`${BASE}/setores`)
  @Permissao(P.ler)
  setores(@Req() req: RequisicaoAutorizada) {
    return this.servico.painelSetores(sessaoDe(req));
  }

  @Post(`${BASE}/setores/:codigo`)
  @HttpCode(200)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler('SGH_CFG_COEX_SETOR e SGH_TRILHA na mesma transação SGH_')
  editarSetor(@Param('codigo') codigo: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.editarSetor(sessaoDe(req), codigo, b);
  }

  // ── Pessoas ──────────────────────────────────────────────────────────────────────────────────────────

  @Get(`${BASE}/pessoas`)
  @Permissao(P.pessoasLer)
  @AuditadoNoHandler('leitura da lista por pessoa registrada na trilha (coexistencia.pessoas.consultadas)')
  pessoas(
    @Req() req: RequisicaoAutorizada,
    @Query('setor') setor?: string,
    @Query('termo') termo?: string,
    @Query('pagina') pagina?: string,
  ) {
    return this.servico.pessoasPorSetor(sessaoDe(req), {
      ...(setor ? { setor } : {}),
      ...(termo ? { termo } : {}),
      ...(pagina ? { pagina } : {}),
    });
  }

  // ── Treinamento ──────────────────────────────────────────────────────────────────────────────────────

  @Get(`${BASE}/treinamento`)
  @Permissao(P.treinoLer)
  treino(@Req() req: RequisicaoAutorizada) {
    return this.servico.treino(sessaoDe(req));
  }

  @Get(`${BASE}/treinamento/guias/:papel/:tarefa/:tipo`)
  @Permissao(P.treinoLer)
  guia(
    @Req() req: RequisicaoAutorizada,
    @Param('papel') papel: string,
    @Param('tarefa') tarefa: string,
    @Param('tipo') tipo: string,
  ) {
    return this.servico.guia(sessaoDe(req), papel, tarefa, tipo);
  }

  @Post(`${BASE}/treinamento/trilhas/:papel/:onda`)
  @HttpCode(200)
  @Permissao(P.treinoRegistrar)
  @AuditadoNoHandler('SGH_CFG_COEX_TRILHA e SGH_TRILHA na mesma transação SGH_')
  publicar(
    @Param('papel') papel: string,
    @Param('onda') onda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.servico.publicarTrilha(sessaoDe(req), papel, onda, b);
  }

  @Post(`${BASE}/treinamento/conclusoes`)
  @HttpCode(200)
  @Permissao(P.treinoRegistrar)
  @AuditadoNoHandler('SGH_CFG_COEX_TREINO e SGH_TRILHA na mesma transação SGH_')
  concluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.registrarConclusao(sessaoDe(req), b);
  }

  // ── W0-09: o ciclo de vida (fato novo com motivo; evento e trilha na mesma transação SGH_) ──────────────

  @Post(`${BASE}/treinamento/conclusoes/:id/estorno`)
  @HttpCode(200)
  @Permissao(P.treinoRegistrar)
  @AuditadoNoHandler('SGH_CFG_COEX_TREINO_ESTORNO, SGH_CRUD_EVENTO e SGH_TRILHA na mesma transação SGH_')
  estornar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.ciclo.estornarConclusao(sessaoDe(req), id, b);
  }

  @Post(`${BASE}/treinamento/trilhas/:papel/:onda/versoes/:versao/retirada`)
  @HttpCode(200)
  @Permissao(P.treinoRegistrar)
  @AuditadoNoHandler(
    'SGH_CFG_COEX_TRILHA, SGH_HIST_EXCLUSAO, SGH_CRUD_EVENTO e SGH_TRILHA na mesma transação SGH_',
  )
  retirarVersao(
    @Param('papel') papel: string,
    @Param('onda') onda: string,
    @Param('versao') versao: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.ciclo.retirarVersaoTrilha(sessaoDe(req), papel, onda, versao, b);
  }

  @Post(`${BASE}/criterio/:setor/itens/:item/pendente`)
  @HttpCode(200)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler('SGH_CFG_COEX_LIGAR, SGH_CRUD_EVENTO e SGH_TRILHA na mesma transação SGH_')
  voltarCriterioPendente(
    @Param('setor') setor: string,
    @Param('item') item: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.ciclo.voltarItemCriterioPendente(sessaoDe(req), setor, item, b);
  }

  // ── Indicadores ──────────────────────────────────────────────────────────────────────────────────────

  @Get(`${BASE}/indicadores`)
  @Permissao(P.ler)
  indicadores(@Req() req: RequisicaoAutorizada, @Query('dias') dias?: string) {
    return this.servico.indicadores(sessaoDe(req), Number(dias) || 14);
  }

  // ── Onda 1 (M39): a lista para ligar o setor (regra 1) e os indicadores de disputa ──────────────────────

  @Get(`${BASE}/onda1`)
  @Permissao(P.ler)
  onda1(@Req() req: RequisicaoAutorizada) {
    return this.servico.painelOnda1(sessaoDe(req));
  }

  @Put(`${BASE}/onda1/ligar/:setor`)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler('SGH_CFG_COEX_LIGAR e SGH_TRILHA na mesma transação SGH_')
  gravarItensLigar(@Param('setor') setor: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.gravarItensLigar(sessaoDe(req), setor, b);
  }

  // ── Onda 2 (M40): o critério de liberação por setor (regra 1) e o acompanhamento (campo 4) ──────────────

  @Get(`${BASE}/onda2`)
  @Permissao(P.ler)
  onda2(@Req() req: RequisicaoAutorizada) {
    return this.servico.painelOnda2(sessaoDe(req));
  }

  @Get(`${BASE}/onda2/acompanhamento`)
  @Permissao(P.ler)
  acompanhamentoOnda2(
    @Req() req: RequisicaoAutorizada,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.servico.acompanhamentoOnda2(
      sessaoDe(req),
      de === undefined && ate === undefined ? undefined : { de, ate },
    );
  }

  @Put(`${BASE}/onda2/criterio/:setor`)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler('SGH_CFG_COEX_LIGAR e SGH_TRILHA na mesma transação SGH_')
  gravarItensOnda2(@Param('setor') setor: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.gravarItensOnda2(sessaoDe(req), setor, b);
  }

  // ── Onda 3 (M41): o critério de liberação por setor com as condições da onda (regra 1 da farmácia) ─────────

  @Get(`${BASE}/onda3`)
  @Permissao(P.ler)
  onda3(@Req() req: RequisicaoAutorizada) {
    return this.servico.painelOnda3(sessaoDe(req));
  }

  @Put(`${BASE}/onda3/criterio/:setor`)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler('SGH_CFG_COEX_LIGAR e SGH_TRILHA na mesma transação SGH_')
  gravarItensOnda3(@Param('setor') setor: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.gravarItensOnda3(sessaoDe(req), setor, b);
  }

  // ── Onda 4 (M42): o critério de liberação por setor com as condições da onda (início na abertura) ─────────

  @Get(`${BASE}/onda4`)
  @Permissao(P.ler)
  onda4(@Req() req: RequisicaoAutorizada) {
    return this.servico.painelOnda4(sessaoDe(req));
  }

  @Put(`${BASE}/onda4/criterio/:setor`)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler('SGH_CFG_COEX_LIGAR e SGH_TRILHA na mesma transação SGH_')
  gravarItensOnda4(@Param('setor') setor: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.gravarItensOnda4(sessaoDe(req), setor, b);
  }

  // ── Lote ─────────────────────────────────────────────────────────────────────────────────────────────

  @Post(`${BASE}/lotes`)
  @HttpCode(200)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler(
    'SGH_CFG_LIBERACAO, SGH_CFG_COEX_LOTE e SGH_TRILHA na mesma transação SGH_; com a condução, o executor (TBPERUSU e SGH_CFG_COEX_CONDUCAO)',
  )
  async aplicarLote(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, senhaDe(b));
    // Setor com a condução ligada: o lote retira as opções dos grupos pela operação do protocolo (executor).
    return this.servico.aplicarLote(sessaoDe(req), b, () =>
      Promise.resolve(contextoOperacao(req, 'coexistencia-lote', reautenticadoEm)),
    );
  }

  @Post(`${BASE}/lotes/:id/recolher`)
  @HttpCode(200)
  @Permissao(P.setorEditar)
  @AuditadoNoHandler('SGH_CFG_LIBERACAO, SGH_CFG_COEX_LOTE e SGH_TRILHA na mesma transação SGH_')
  async recolherLote(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const reautenticadoEm = await reautenticar(this.sessoes, this.resolvedor, req, senhaDe(b));
    return this.servico.recolherLote(sessaoDe(req), id, b, () =>
      Promise.resolve(contextoOperacao(req, 'coexistencia-lote', reautenticadoEm)),
    );
  }

  // ── Condução opcional ────────────────────────────────────────────────────────────────────────────────

  @Get(`${BASE}/conducao/:setor`)
  // D-CONDLER-37: a lista da condução é do gestor de acessos (quem retira e devolve); a área técnica do painel é do
  // perfil técnico (o comitê vê no setor se a condução está ligada).
  @Permissao(P.opcaoRevogar)
  conducao(@Param('setor') setor: string, @Req() req: RequisicaoAutorizada) {
    return this.servico.conducao(sessaoDe(req), setor);
  }

  @Post(`${BASE}/conducao/:setor/retirar`)
  @HttpCode(200)
  @Permissao(P.opcaoRevogar)
  @AuditadoNoHandler(
    'executor: TBPERUSU, SGH_CFG_COEX_CONDUCAO, TBCABTRILHA (tipo 25) e SGH_TRILHA na mesma transação',
  )
  retirar(@Param('setor') setor: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.retirar(sessaoDe(req), setor, b, async () =>
      contextoOperacao(
        req,
        'coexistencia-conducao',
        await reautenticar(this.sessoes, this.resolvedor, req, senhaDe(b)),
      ),
    );
  }

  @Post(`${BASE}/conducao/:setor/devolver`)
  @HttpCode(200)
  @Permissao(P.opcaoConceder)
  @AuditadoNoHandler(
    'executor: TBPERUSU, SGH_CFG_COEX_CONDUCAO, TBCABTRILHA (tipo 25) e SGH_TRILHA na mesma transação',
  )
  devolver(@Param('setor') setor: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.devolver(sessaoDe(req), setor, b, async () =>
      contextoOperacao(
        req,
        'coexistencia-conducao',
        await reautenticar(this.sessoes, this.resolvedor, req, senhaDe(b)),
      ),
    );
  }

  // ── Chamados ─────────────────────────────────────────────────────────────────────────────────────────

  @Get(`${BASE}/chamados`)
  @Permissao(P.chamadoLer)
  chamados(@Req() req: RequisicaoAutorizada, @Query() consulta: Record<string, string>) {
    return this.servico.chamados(sessaoDe(req), consulta);
  }

  @Post('chamados')
  @HttpCode(201)
  @Permissao(P.chamadoAbrir)
  @AuditadoNoHandler('SGH_CFG_CHAMADO, SGH_OUTBOX (aviso) e SGH_TRILHA na mesma transação SGH_')
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const bruto = req.headers['traceparent'];
    const tp = (Array.isArray(bruto) ? bruto[0] : bruto) ?? '';
    const traceId = /^[0-9a-f]{2}-([0-9a-f]{32})-/.exec(tp)?.[1] ?? null;
    const id = Number(req.sgh?.sessao.usuario.id);
    return this.servico.abrirChamado(sessaoDe(req), b, {
      traceId,
      idUsuario: Number.isSafeInteger(id) ? id : null,
    });
  }

  @Post(`${BASE}/chamados/:id/triar`)
  @HttpCode(200)
  @Permissao(P.chamadoTriar)
  @AuditadoNoHandler('SGH_CFG_CHAMADO e SGH_TRILHA na mesma transação SGH_')
  triar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.servico.triarChamado(sessaoDe(req), id, b);
  }
}
