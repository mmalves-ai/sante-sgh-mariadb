// "Funcionalidades por estabelecimento (feature flags)" (M08; POL-3; DP-4; regras 9, 9a e 10; ADR 0019):
//   GET  /api/administracao/liberacao                          recursos desligados (descrição, estado,
//                                                              pré-requisitos e o que falta) e chaves das
//                                                              operações do catálogo, no estabelecimento
//   POST /api/administracao/liberacao                          liga ou desliga a chave para o estabelecimento
//                                                              ('*'), uma lista de setores, grupos ou pessoas
//                                                              numa ação só (lote); reautenticação; trilha
//   POST /api/administracao/liberacao/lotes/:lote/reverter     reverte o lote (cada linha volta ao de antes)
//   PUT  /api/administracao/liberacao/prerequisitos            registra pré-requisito (situação, validade e a
//                                                              referência da evidência, sem segredo)
// Recurso com pré-requisito pendente ou vencido não liga (409 prerequisito-pendente, dizendo o que falta);
// desligar é sempre permitido (recolher). Em PRODUÇÃO, LIGAR qualquer chave (operação ou recurso, também
// pela reversão de um lote) exige a referência da autorização do dono (ESTADO.md › Autorizações), e a
// operação tem de estar `liberada` no catálogo. A decisão de gravar é tomada DENTRO da transação, sobre
// o estado relido com trava (chaves e pré-requisitos); o cache só serve a tela. Fora de dev/ci, ligar a chave
// de um setor da onda 2, 3 ou 4 também exige o critério do setor completo (M40 a M42; 409 criterio-onda2-incompleto,
// criterio-onda3-incompleto ou criterio-onda4-incompleto). Em todo ambiente, ligar a dispensação ou a entrega exige a prescrição eletrônica em uso
// nas unidades atendidas (M41, regra 1; 409 farmacia-sem-prescricao). Vale sem
// nova implantação:
// o executor lê as chaves a cada gravação; o cache é invalidado depois do commit.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Put, Req } from '@nestjs/common';
import {
  CHAVE_CLASSIFICACAO_EXTERNA,
  CHAVE_ENTRADA_UTF8,
  esquemaPedidoLiberacao,
  esquemaPedidoPrerequisito,
  esquemaReverterLote,
  EVENTOS_AUDITAVEIS,
  type FuncionalidadeDescrita,
  type PainelLiberacao,
  RECURSOS_DESLIGADOS,
  recursoDesligado,
  type ResultadoLiberacao,
} from '@sgh/contratos';
import {
  chaveLibera,
  chaveExigePrescricao,
  conferirLigarEmProducao,
  conferirPrerequisitosDeLigar,
  conferirRegrasDeLigar,
  faltasDoRecurso,
  planejarLote,
  type RecusaLigar,
  reverterLote,
} from '@sgh/dominio-config';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { CACHE_CONFIG, type CacheConfig, TTL_CONFIG_NOVO_S } from './cache-config.js';
import { CRITERIO_LIGAR_SETOR, type CriterioLigarSetor } from './criterio-ligar.js';
import {
  CATALOGO_OPERACOES,
  type CatalogoOperacoesLiberacao,
} from './catalogo-operacoes.js';
import {
  type ChaveLiberacao,
  destinoNoContrato,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  type PedidoLote,
  type PrerequisitoRecurso,
  type TrilhaConfig,
} from './configuracao-fonte.js';
import { falhaDaConfiguracao } from './falha-configuracao.js';
import { planoDaFonteUnicaDeCor } from './fonte-de-cor.js';

const MOTIVO = { pendente: 'pendente', vencido: 'vencido', 'sem-registro': 'não registrado' } as const;

@Controller('administracao/liberacao')
export class LiberacaoController {
  constructor(
    @Inject(FONTE_CONFIGURACAO) private readonly fonte: FonteConfiguracao,
    @Inject(CACHE_CONFIG) private readonly cache: CacheConfig,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    @Inject(CATALOGO_OPERACOES) private readonly catalogo: CatalogoOperacoesLiberacao,
    @Optional() @Inject(CRITERIO_LIGAR_SETOR) private readonly criterio: CriterioLigarSetor | null = null,
  ) {}

  private sessao(req: RequisicaoAutorizada) {
    const a = req.sgh;
    if (!a) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const hospital = a.sessao.estabelecimentoAtivo;
    if (!hospital) throw new ErroProblema('nao-autenticado', 401, 'Escolha o estabelecimento');
    return { a, hospital, rede: a.sessao.rede ?? '', login: a.sessao.usuario.login ?? a.sessao.usuario.id };
  }

  private trilha(req: RequisicaoAutorizada, evento: string, operacaoNome: string): TrilhaConfig {
    const { a, rede, hospital, login } = this.sessao(req);
    const chave = req.headers?.['idempotency-key'];
    return {
      rede,
      hospital,
      usuario: login,
      usuarioId: a.sessao.usuario.id,
      chaveIdempotencia: typeof chave === 'string' ? chave : null,
      evento,
      recurso: 'config.liberacao',
      operacao: operacaoNome,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: estacaoDaRequisicao(req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(req, 'liberacao').slice(0, 64),
    };
  }

  private async dados(rede: string, hospital: string) {
    return this.cache.lerOuCarregar(
      this.cache.chave(rede, hospital, 'liberacao'),
      TTL_CONFIG_NOVO_S,
      async () => ({
        chaves: await this.fonte.chaves(rede, hospital),
        prerequisitos: await this.fonte.prerequisitos(rede, hospital),
      }),
    );
  }

  private funcionalidade(
    tipo: 'recurso' | 'operacao',
    chave: string,
    titulo: string,
    descricao: string,
    marco: string | null,
    estadoCatalogo: string | null,
    todas: readonly ChaveLiberacao[],
    prereqs: readonly PrerequisitoRecurso[],
  ): FuncionalidadeDescrita {
    // Linha que herda (ligada nula, reversão de lote) não decide: fora do painel.
    const chaves = todas
      .filter((c) => c.chave === chave && c.tipo === tipo && c.ligada !== null)
      .map((c) => ({ ...c, ligada: c.ligada === true }));
    const rec = tipo === 'recurso' ? recursoDesligado(chave) : undefined;
    const declarados = rec?.prerequisitos ?? [];
    const registrados = prereqs.filter((p) => p.recurso === chave);
    const faltas = faltasDoRecurso(declarados, registrados, new Date());
    return {
      tipo,
      chave,
      titulo,
      descricao,
      marco,
      estadoCatalogo,
      ligadaNoEstabelecimento: chaveLibera(chaves, '\u0000', undefined, undefined),
      chaves: chaves.map((c) => ({
        escopo: c.escopo,
        valor: c.valor,
        ligada: c.ligada,
        lote: c.lote,
        alteradoPor: c.alteradoPor,
        alteradoEm: c.alteradoEm,
      })),
      prerequisitos: declarados.map((d) => {
        const r = registrados.find((x) => x.tipo === d.tipo);
        const f = faltas.find((x) => x.tipo === d.tipo);
        return {
          tipo: d.tipo,
          descricao: d.descricao,
          responsavel: d.responsavel,
          situacao: r?.situacao ?? 'pendente',
          validade: r?.validade ?? null,
          evidencia: r?.evidencia ?? null,
          falta: f !== undefined,
          motivo: f ? MOTIVO[f.motivo] : null,
        };
      }),
      podeLigar: faltas.length === 0,
      motivoBloqueio:
        faltas.length === 0
          ? null
          : `Falta: ${faltas.map((f) => `${f.descricao} (${MOTIVO[f.motivo]})`).join('; ')}.`,
    };
  }

  @Get()
  @Permissao('config.liberacao.ler')
  async painel(@Req() req: RequisicaoAutorizada): Promise<PainelLiberacao> {
    const { rede, hospital } = this.sessao(req);
    const { chaves, prerequisitos } = await this.dados(rede, hospital);
    // M41 (regra 1): a dispensação e a entrega mostram, antes de ligar, as unidades sem a prescrição em uso.
    const base = this.descreverTodas(hospital, chaves, prerequisitos);
    const daRegra1 = (f: FuncionalidadeDescrita) =>
      chaveExigePrescricao(f.chave) && !f.ligadaNoEstabelecimento;
    const avaliar = this.criterio?.regraFarmacia;
    const regra1 =
      avaliar && base.some(daRegra1)
        ? await avaliar({ rede, hospital }, 'recurso', 'suprimentos.dispensacao').catch(() => null)
        : null;
    // M58-F5 (regra 6): a entrada sem restrição mostra, antes de ligar, o que falta da conversão para UTF-8.
    const daUtf8 = (f: FuncionalidadeDescrita) =>
      f.chave === CHAVE_ENTRADA_UTF8 && !f.ligadaNoEstabelecimento;
    const avaliarUtf8 = this.criterio?.regraEntradaUtf8;
    const utf8 = base.some(daUtf8)
      ? avaliarUtf8
        ? await avaliarUtf8({ rede, hospital }).catch(() => null)
        : 'a conversão do banco para UTF-8 não pôde ser conferida agora.'
      : null;
    const funcionalidades = base.map((f) => {
      const extra = (regra1 && daRegra1(f) ? regra1 : null) ?? (utf8 && daUtf8(f) ? utf8 : null);
      return extra
        ? { ...f, podeLigar: false, motivoBloqueio: [f.motivoBloqueio, extra].filter(Boolean).join(' ') }
        : f;
    });
    return { estabelecimento: hospital, destino: destinoNoContrato(this.fonte.destino), funcionalidades };
  }

  private descreverTodas(
    hospital: string,
    chaves: readonly ChaveLiberacao[],
    prerequisitos: readonly PrerequisitoRecurso[],
  ): FuncionalidadeDescrita[] {
    return [
      ...RECURSOS_DESLIGADOS.map((r) =>
        this.funcionalidade('recurso', r.chave, r.titulo, r.descricao, r.marco, null, chaves, prerequisitos),
      ),
      ...this.catalogo.operacoes().map((o) =>
        this.funcionalidade(
          'operacao',
          o.nome,
          o.nome,
          o.descricao,
          null,
          this.catalogo.estado(o.nome, hospital),
          chaves,
          prerequisitos,
        ),
      ),
    ];
  }

  /**
   * As conferências ao ligar são as de @sgh/dominio-config (conferencias-ligar.ts), as mesmas do comando de terminal
   * `pnpm liberacao:ligar-tudo` (M61); aqui a recusa vira o problema HTTP.
   */
  private recusar(r: RecusaLigar | null): void {
    if (!r) return;
    throw new ErroProblema(r.problema, r.status, r.titulo, r.motivo, r.codigo ? { codigo: r.codigo } : {});
  }

  /** Em produção, ligar exige a autorização registrada do dono; a operação, ainda, `liberada` no catálogo. */
  private conferirLigarEmProducao(
    tipo: 'recurso' | 'operacao',
    chave: string,
    hospital: string,
    referenciaAutorizacao: string | undefined,
  ): void {
    this.recusar(
      conferirLigarEmProducao({
        ambiente: this.cfg.ambiente,
        tipo,
        estadoEfetivo: () => this.catalogo.estado(chave, hospital),
        referenciaAutorizacao,
      }),
    );
  }

  /**
   * M40 a M42 (regras 1 e 2): fora de dev/ci, a chave de um setor da onda 2, 3 ou 4 passa pelo critério do setor (409
   * `criterio-onda<n>-incompleto`); em todo ambiente, a farmácia (M41, regra 1; 409 `farmacia-sem-prescricao`) e a entrada
   * UTF-8 (M58-F5, regra 6; 409 `entrada-utf8-sem-conversao`). Sem o avaliador registrado, não liga (falha fechada).
   */
  private async conferirCriterioDoSetor(
    rede: string,
    tipo: 'recurso' | 'operacao',
    chave: string,
    hospital: string,
  ): Promise<void> {
    const c = { rede, hospital };
    const cr = this.criterio;
    this.recusar(
      await conferirRegrasDeLigar({
        ambiente: this.cfg.ambiente,
        tipo,
        chave,
        nomesOperacoes: () => this.catalogo.operacoes().map((o) => o.nome),
        avaliadores: {
          criterioSetor: cr?.avaliar ? (t, k) => cr.avaliar!(c, t, k) : null,
          regraFarmacia: cr?.regraFarmacia ? (t, k) => cr.regraFarmacia!(c, t, k) : null,
          regraEntradaUtf8: cr?.regraEntradaUtf8 ? () => cr.regraEntradaUtf8!(c) : null,
        },
      }),
    );
  }

  /** Pré-requisitos do recurso (sobre o estado relido na transação): ligar com falta é recusado (409). */
  private conferirPrerequisitos(chave: string, registrados: readonly PrerequisitoRecurso[]): void {
    this.recusar(conferirPrerequisitosDeLigar(chave, registrados, new Date()));
  }

  @Post()
  @HttpCode(200)
  @Permissao('config.liberacao.editar')
  @AuditadoNoHandler('liberacao_chave, liberacao_lote e trilha na mesma transação do Executor (aplicarLote)')
  async aplicar(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoLiberacao> {
    const p = esquemaPedidoLiberacao.safeParse(corpo);
    if (!p.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha a chave, o escopo, os valores e justifique (10 caracteres ou mais).',
      );
    await reautenticar(this.servico, this.resolvedor, req, p.data.senha);
    const { rede, hospital, login } = this.sessao(req);
    const pedido = p.data;
    if (pedido.tipo === 'recurso') {
      if (!recursoDesligado(pedido.chave))
        throw new ErroProblema('nao-encontrado', 404, 'Funcionalidade não encontrada');
    } else if (!this.catalogo.operacoes().some((o) => o.nome === pedido.chave)) {
      throw new ErroProblema('nao-encontrado', 404, 'Operação não está no catálogo');
    }
    if (pedido.ligar) {
      this.conferirLigarEmProducao(pedido.tipo, pedido.chave, hospital, pedido.referenciaAutorizacao);
      await this.conferirCriterioDoSetor(rede, pedido.tipo, pedido.chave, hospital);
    }
    // M44, regra 6: uma fonte de cor no PA (a externa recusada onde a própria está ligada; ligar a própria desliga
    // a externa nos mesmos escopos na MESMA transação, antes dela: se a própria falhar, a externa continua ligada).
    const trilha = this.trilha(req, EVENTOS_AUDITAVEIS.liberacaoAlterada.codigo, 'config.aplicarLiberacao');
    const principal: PedidoLote = {
      hospital,
      tipo: pedido.tipo,
      chave: pedido.chave,
      // Decidido na transação, sobre as chaves e os pré-requisitos relidos com trava.
      planejar: (estado) => {
        if (pedido.ligar && pedido.tipo === 'recurso')
          this.conferirPrerequisitos(pedido.chave, estado.prerequisitos);
        return planejarLote(estado.chaves, pedido.escopo, pedido.valores, pedido.ligar);
      },
      justificativa: pedido.justificativa,
      autor: login,
      referenciaAutorizacao: pedido.referenciaAutorizacao ?? null,
    };
    const planoExterna =
      pedido.tipo === 'recurso' && pedido.ligar
        ? planoDaFonteUnicaDeCor(await this.fonte.chaves(rede, hospital), pedido)
        : null;
    const falha = (e: unknown) => {
      throw falhaDaConfiguracao(
        e,
        'config.aplicarLiberacao',
        'A mudança não foi gravada (nem registrada). Tente de novo.',
      );
    };
    let externaDesligada = 0;
    let r: { lote: string; alteradas: number };
    if (planoExterna) {
      const [externa, propria] = await this.fonte
        .aplicarLotes(
          rede,
          [
            {
              hospital,
              tipo: 'recurso',
              chave: CHAVE_CLASSIFICACAO_EXTERNA,
              planejar: planoExterna,
              justificativa:
                `Regra 6 (uma fonte de cor): desligada ao ligar a classificação de risco própria. ${pedido.justificativa}`.slice(
                  0,
                  500,
                ),
              autor: login,
              referenciaAutorizacao: pedido.referenciaAutorizacao ?? null,
            },
            principal,
          ],
          trilha,
        )
        .catch(falha);
      externaDesligada = externa!.alteradas;
      r = propria!;
    } else r = await this.fonte.aplicarLote(rede, principal, trilha).catch(falha);
    if (r.alteradas + externaDesligada > 0)
      await this.cache.invalidar(rede, hospital, ['liberacao'], Date.now());
    return { ...r, destino: destinoNoContrato(this.fonte.destino) };
  }

  @Post('lotes/:lote/reverter')
  @HttpCode(200)
  @Permissao('config.liberacao.editar')
  @AuditadoNoHandler('liberacao_chave, liberacao_lote e trilha na mesma transação do Executor (aplicarLote)')
  async reverter(
    @Param('lote') lote: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoLiberacao> {
    const p = esquemaReverterLote.safeParse({ ...((corpo as object) ?? {}), lote });
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    await reautenticar(this.servico, this.resolvedor, req, p.data.senha);
    const { rede, hospital, login } = this.sessao(req);
    const linhas = await this.fonte.lote(rede, hospital, lote);
    if (linhas.length === 0) throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado');
    const primeira = linhas[0]!;
    const comoMudanca = (l: ChaveLiberacao) => ({
      escopo: l.escopo,
      valor: l.valor,
      ligada: l.ligada,
      antes: l.ligadaAntes,
    });
    // A reversão que volta a LIGAR passa pelas mesmas conferências de ligar (produção e pré-requisito).
    if (reverterLote(linhas.map(comoMudanca)).some((v) => v.ligada === true)) {
      this.conferirLigarEmProducao(primeira.tipo, primeira.chave, hospital, p.data.referenciaAutorizacao);
      await this.conferirCriterioDoSetor(rede, primeira.tipo, primeira.chave, hospital);
    }
    const r = await this.fonte
      .aplicarLote(
        rede,
        {
          hospital,
          tipo: primeira.tipo,
          chave: primeira.chave,
          planejar: (estado) => {
            // Estado relido com trava: as linhas ainda são deste lote (um lote posterior mexeu nelas: 409).
            const doLote = estado.chaves.filter((c) => c.lote === lote);
            if (doLote.length !== linhas.length)
              throw new ErroProblema(
                'recusa-de-negocio',
                409,
                'Lote já alterado',
                'Um lote posterior mudou estas chaves. Reverta primeiro o lote mais recente.',
                { codigo: 'lote-alterado' },
              );
            const volta = reverterLote(doLote.map(comoMudanca));
            if (primeira.tipo === 'recurso' && volta.some((v) => v.ligada === true))
              this.conferirPrerequisitos(primeira.chave, estado.prerequisitos);
            return volta;
          },
          justificativa: p.data.justificativa,
          autor: login,
          referenciaAutorizacao: p.data.referenciaAutorizacao ?? null,
        },
        this.trilha(req, EVENTOS_AUDITAVEIS.liberacaoRevertida.codigo, 'config.reverterLiberacao'),
      )
      .catch((e: unknown) => {
        throw falhaDaConfiguracao(
          e,
          'config.reverterLiberacao',
          'A reversão não foi gravada (nem registrada).',
        );
      });
    if (r.alteradas > 0) await this.cache.invalidar(rede, hospital, ['liberacao'], Date.now());
    return { ...r, destino: destinoNoContrato(this.fonte.destino) };
  }

  @Put('prerequisitos')
  @Permissao('config.liberacao.editar')
  @AuditadoNoHandler('recurso_prerequisito e trilha na mesma transação do Executor (gravarPrerequisito)')
  async prerequisito(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const p = esquemaPedidoPrerequisito.safeParse(corpo);
    if (!p.success) throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos');
    const rec = recursoDesligado(p.data.recurso);
    if (!rec?.prerequisitos.some((x) => x.tipo === p.data.tipo))
      throw new ErroProblema('nao-encontrado', 404, 'Pré-requisito não declarado para o recurso');
    await reautenticar(this.servico, this.resolvedor, req, p.data.senha);
    const { rede, hospital, login } = this.sessao(req);
    await this.fonte
      .gravarPrerequisito(
        rede,
        {
          hospital,
          recurso: rec.chave,
          tipo: p.data.tipo,
          situacao: p.data.situacao,
          validade: p.data.validade,
          // Dispensa: a linha de autorização do dono vai junto da evidência (o contrato exige as duas).
          evidencia:
            p.data.situacao === 'dispensado' && p.data.referenciaAutorizacao
              ? `autorização: ${p.data.referenciaAutorizacao}; ${p.data.evidencia ?? ''}`.slice(0, 200)
              : p.data.evidencia,
          autor: login,
        },
        this.trilha(req, EVENTOS_AUDITAVEIS.prerequisitoRegistrado.codigo, 'config.registrarPrerequisito'),
      )
      .catch((e: unknown) => {
        throw falhaDaConfiguracao(
          e,
          'config.registrarPrerequisito',
          'O pré-requisito não foi gravado (nem registrado).',
        );
      });
    await this.cache.invalidar(rede, hospital, ['liberacao'], Date.now());
    return { ok: true, destino: destinoNoContrato(this.fonte.destino) };
  }
}
