// M59-F5 (ficha do M59, seções 4, 7, 8 regras 1, 9 e 10, e 13; cap-13 §13.2.1, §13.6): o serviço da certificação. As
// regras são as puras de @sgh/dominio-acesso; aqui ficam a leitura pela porta, a situação do estabelecimento (o
// desligamento do M58 e a contingência, a mesma das contas do banco), as medidas das concessões (as telas das fatias
// F1 a F4) e a montagem das respostas. Toda gravação vai pela porta, com a trilha de auditoria na mesma transação.
// Melhoria: a recusa de negócio da porta (ErroProblema, ou ErroOperacao do núcleo: conflito de versão, restrição) chega
// ao usuário com o código dela; só a falha de infraestrutura vira 503. O recurso sem tabela no banco do cliente é
// recusado por recurso (o backup não depende das tabelas dos ciclos).
import {
  type AbrirCicloPedido,
  type AvaliarItemPedido,
  type BackupVerificado,
  type CicloSbis,
  type CicloSbisDetalhe,
  type CodigoConcessao,
  type ConcluirCicloPedido,
  DIAS_MAXIMOS_PROVA_CADEIA,
  type EncerrarConcessaoPedido,
  EVENTOS_AUDITAVEIS,
  type IdentificacaoExportacao,
  type ItemCicloSbis,
  type PainelConcessoes,
  type PainelSbis,
  type Politica2fa,
  type ProvaCadeia,
  type RecusaSbis,
  REFERENCIA_SBIS_PADRAO,
  type RegistrarRestauracaoPedido,
  REQUISITOS_SBIS,
  TEXTO_RECUSA_SBIS,
  type Versao,
} from '@sgh/contratos';
import {
  aplicarAvaliacao,
  certificadoVigente,
  competenciaDe,
  concessoesVigentes,
  contagemRequisitos,
  diasDoPeriodo,
  fase5Pronta,
  montarPacote,
  painelConcessoes,
  parecerDosItens,
  provaDaCadeia,
  recusaAbrirCiclo,
  recusaAuditoriaFormal,
  recusaAvaliarItem,
  recusaCancelarCiclo,
  recusaConcluirCiclo,
  recusaCorrigirItem,
  recusaReabrirConcessao,
  recusaVerificarItem,
  resumirItens,
  rfc3339,
  situacaoBackup,
  type SituacaoEstabelecimento,
} from '@sgh/dominio-acesso';
import { ErroOperacao } from '@sgh/nucleo';
import { ErroProblema } from '../../../problema.filter.js';
import { type FontesMedidas, medirConcessoes, segundoFatorCriticos } from './medidas.js';
import type { CicloCertificacao, PortaSbis, RecursoSbis, TrilhaSbis } from './porta.js';

export const SERVICO_SBIS = Symbol('SERVICO_SBIS');

export interface AtorSbis {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string | null;
  readonly correlacao: string;
  /** A Idempotency-Key do pedido de gravação (rotas POST); ausente nas leituras. */
  readonly idempotencia?: string | null;
}

export interface DependenciasSbis {
  readonly porta: PortaSbis;
  readonly situacao: (c: { rede: string; hospital: string }) => Promise<SituacaoEstabelecimento>;
  readonly medidas?: (c: { rede: string; hospital: string }) => FontesMedidas;
  readonly politicas2fa?: (hospital: string) => Promise<Politica2fa[]>;
  readonly assinaturaConfigurada?: (hospital: string) => Promise<boolean>;
  readonly ambiente: string;
  readonly versao: () => Versao;
  readonly agora?: () => Date;
}

/** Dias da cadeia conferidos no painel (os últimos, até ontem e hoje). */
export const DIAS_CADEIA_PAINEL = 7;
/** Ciclos lidos no painel (os mais recentes; dois anos de autoavaliação mensal). */
export const CICLOS_PAINEL = 24;

/** O texto do usuário cortado de modo que a medida do momento caiba sempre nos 1000 caracteres (D-ENCERRA-F5). */
export function evidenciaComMedida(evidencia: string, medida: string): string {
  const sufixo = ` | Medida: ${medida}`.slice(0, 1000);
  return evidencia.trim().slice(0, 1000 - sufixo.length) + sufixo;
}

const recusa = (codigo: RecusaSbis): never => {
  throw new ErroProblema('recusa-de-negocio', 409, 'Ação recusada', TEXTO_RECUSA_SBIS[codigo], { codigo });
};
const indisponivel = (e?: unknown): never => {
  // A recusa de negócio da porta passa com o código dela (o filtro traduz a do núcleo em Problem Details).
  if (e instanceof ErroProblema || e instanceof ErroOperacao) throw e;
  throw new ErroProblema(
    'indisponivel',
    503,
    'Serviço indisponível',
    'O banco do estabelecimento não respondeu.',
  );
};
const naoEncontrado = (): never => {
  throw new ErroProblema('nao-encontrado', 404, 'Ciclo não encontrado');
};

export class ServicoSbis {
  constructor(private readonly d: DependenciasSbis) {}

  private agora() {
    return this.d.agora?.() ?? new Date();
  }

  /** Dia civil de hoje no estabelecimento (America/Sao_Paulo, -03:00 fixo). */
  hoje(): string {
    return rfc3339(this.agora()).slice(0, 10);
  }

  private trilha(a: AtorSbis, evento: string, operacao: string): TrilhaSbis {
    return {
      rede: a.rede,
      hospital: a.hospital,
      usuario: a.login,
      evento,
      recurso: 'auditoria.sbis',
      operacao,
      resultado: 'sucesso',
      estacao: a.estacao,
      correlacao: a.correlacao,
      chaveIdempotencia: a.idempotencia ?? null,
    };
  }

  private async pronto(h: string, ...recursos: RecursoSbis[]) {
    const falta = (
      await Promise.all(recursos.map((r) => this.d.porta.faltando(h, r))).catch(indisponivel)
    ).flat();
    if (falta.length)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Recurso ainda não instalado',
        'As tabelas deste recurso da certificação ainda não foram criadas no banco do cliente.',
        { codigo: 'tabelas-ausentes', campos: falta },
      );
  }

  private async situacao(a: AtorSbis): Promise<SituacaoEstabelecimento> {
    // Falha fechada: sem resposta, o estabelecimento conta como não desligado e em contingência.
    return this.d
      .situacao({ rede: a.rede, hospital: a.hospital })
      .catch(() => ({ desligado: false, contingenciaAtiva: true }));
  }

  // ── concessões ─────────────────────────────────────────────────────────────────────────────────

  async painelConcessoes(a: AtorSbis): Promise<PainelConcessoes> {
    await this.pronto(a.hospital, 'concessoes');
    const sit = await this.situacao(a);
    const [registros, medidas] = await Promise.all([
      this.d.porta.concessoes(a.hospital).catch(indisponivel),
      medirConcessoes(this.d.medidas?.({ rede: a.rede, hospital: a.hospital }) ?? {}, sit),
    ]);
    return painelConcessoes(a.hospital, registros, medidas, sit);
  }

  async encerrarConcessao(a: AtorSbis, codigo: CodigoConcessao, p: EncerrarConcessaoPedido) {
    const painel = await this.painelConcessoes(a);
    const c = painel.concessoes.find((x) => x.codigo === codigo);
    if (!c) return naoEncontrado();
    const r = c.situacao === 'encerrada' ? 'concessao-ja-encerrada' : (c.recusa as RecusaSbis | null);
    if (r) recusa(r);
    const ok = await this.d.porta
      .encerrar(
        a.hospital,
        { codigo, evidencia: evidenciaComMedida(p.evidencia, c.medida), por: a.login },
        this.trilha(a, EVENTOS_AUDITAVEIS.concessaoAlterada.codigo, 'encerrar'),
      )
      .catch(indisponivel);
    if (!ok) recusa('concessao-ja-encerrada');
    return { encerrada: true as const };
  }

  async reabrirConcessao(a: AtorSbis, codigo: CodigoConcessao, motivo: string) {
    await this.pronto(a.hospital, 'concessoes');
    const registro = (await this.d.porta.concessoes(a.hospital).catch(indisponivel)).find(
      (x) => x.codigo === codigo,
    );
    const r = recusaReabrirConcessao(registro ?? null);
    if (r) recusa(r);
    const ok = await this.d.porta
      .reabrir(
        a.hospital,
        { codigo, motivo: motivo.trim(), por: a.login },
        this.trilha(a, EVENTOS_AUDITAVEIS.concessaoAlterada.codigo, 'reabrir'),
      )
      .catch(indisponivel);
    if (!ok) recusa('concessao-ja-vigente');
    return { reaberta: true as const };
  }

  async preverConcessao(a: AtorSbis, codigo: CodigoConcessao, fimPrevisto: string | null) {
    await this.pronto(a.hospital, 'concessoes');
    await this.d.porta
      .prever(
        a.hospital,
        { codigo, fimPrevisto, por: a.login },
        this.trilha(a, EVENTOS_AUDITAVEIS.concessaoAlterada.codigo, 'prever'),
      )
      .catch(indisponivel);
    return { fimPrevisto };
  }

  // ── ciclos ─────────────────────────────────────────────────────────────────────────────────────

  private async ciclosComItens(h: string): Promise<{ ciclo: CicloCertificacao; itens: ItemCicloSbis[] }[]> {
    const ciclos = (await this.d.porta.ciclos(h).catch(indisponivel)).slice(0, CICLOS_PAINEL);
    return Promise.all(
      ciclos.map(async (ciclo) => ({
        ciclo,
        itens: await this.d.porta.itens(h, ciclo.id).catch(indisponivel),
      })),
    );
  }

  private resposta(ciclo: CicloCertificacao, itens: readonly ItemCicloSbis[]): CicloSbis {
    return { ...ciclo, resumo: resumirItens(itens) };
  }

  private async contextoAbertura(a: AtorSbis, todos: { ciclo: CicloCertificacao; itens: ItemCicloSbis[] }[]) {
    const [sit, registros] = await Promise.all([
      this.situacao(a),
      this.d.porta.concessoes(a.hospital).catch(indisponivel),
    ]);
    const preApta = todos.find(
      (x) =>
        x.ciclo.tipo === 'pre-auditoria' && x.ciclo.situacao === 'concluido' && x.ciclo.parecer === 'apto',
    );
    return {
      ciclos: todos.map((x) => x.ciclo),
      situacao: sit,
      concessoesVigentes: concessoesVigentes(registros).size,
      fase5Liberada: fase5Pronta(preApta?.itens ?? null),
      competencia: competenciaDe(this.hoje()),
      vigentes: concessoesVigentes(registros),
    };
  }

  async painel(a: AtorSbis): Promise<PainelSbis> {
    await this.pronto(a.hospital, 'ciclos', 'concessoes');
    const todos = await this.ciclosComItens(a.hospital);
    const ctx = await this.contextoAbertura(a, todos);
    const hoje = this.hoje();
    const dias = diasDoPeriodo(
      new Date(Date.parse(`${hoje}T00:00:00Z`) - (DIAS_CADEIA_PAINEL - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      hoje,
      DIAS_CADEIA_PAINEL,
    );
    const [cadeia, config, politicas, assinatura, restauracoes] = await Promise.all([
      this.d.porta.verificarDias(a.hospital, dias).catch(() => null),
      this.d.porta.configSeguranca(a.hospital).catch(() => null),
      this.d.politicas2fa?.(a.hospital).catch(() => null) ?? Promise.resolve(null),
      this.d.assinaturaConfigurada?.(a.hospital).catch(() => null) ?? Promise.resolve(null),
      this.d.porta.restauracoes(a.hospital).catch(() => []),
    ]);
    const backup = situacaoBackup(restauracoes, this.agora());
    const formal = recusaAuditoriaFormal(ctx);
    return {
      hospital: a.hospital,
      referencia: REFERENCIA_SBIS_PADRAO,
      desligado: ctx.situacao.desligado,
      auditoriaFormal: { pode: formal === null, motivo: formal ? TEXTO_RECUSA_SBIS[formal] : null },
      certificado: certificadoVigente(ctx.ciclos),
      requisitos: contagemRequisitos(),
      pacote: montarPacote({
        ambiente: this.d.ambiente,
        trilhaIntegra: cadeia ? provaDaCadeia(cadeia).integra : null,
        limiteTentativas: config?.limiteTentativas ?? null,
        inatividadeSegundos: config?.inatividadeSegundos ?? null,
        segundoFatorCriticos: politicas ? segundoFatorCriticos(politicas, hoje) : null,
        diariaEmDia: backup.diaria.emDia,
        mensalEmDia: backup.mensal.emDia,
        concessoesVigentes: ctx.concessoesVigentes,
        assinaturaConfigurada: assinatura,
      }),
      ciclos: todos.map((x) => this.resposta(x.ciclo, x.itens)),
    };
  }

  private async cicloAberto(a: AtorSbis, id: string) {
    await this.pronto(a.hospital, 'ciclos', 'concessoes');
    const ciclo = await this.d.porta.ciclo(a.hospital, id).catch(indisponivel);
    if (!ciclo) return naoEncontrado();
    const itens = await this.d.porta.itens(a.hospital, id).catch(indisponivel);
    return { ciclo, itens };
  }

  async ciclo(a: AtorSbis, id: string): Promise<CicloSbisDetalhe> {
    const { ciclo, itens } = await this.cicloAberto(a, id);
    return { ...this.resposta(ciclo, itens), itens };
  }

  async abrirCiclo(a: AtorSbis, p: AbrirCicloPedido): Promise<CicloSbisDetalhe> {
    await this.pronto(a.hospital, 'ciclos', 'concessoes');
    const ctx = await this.contextoAbertura(a, await this.ciclosComItens(a.hospital));
    const r = recusaAbrirCiclo(p, ctx);
    if (r) recusa(r);
    const aberto = await this.d.porta
      .abrir(
        a.hospital,
        {
          tipo: p.tipo,
          competencia: ctx.competencia,
          versao: p.versao.trim(),
          referencia: p.referencia?.trim() || REFERENCIA_SBIS_PADRAO,
          avaliador: p.tipo === 'autoavaliacao' ? null : (p.avaliador?.trim() ?? null),
          por: a.login,
          requisitos: REQUISITOS_SBIS.map((x) => x.codigo),
        },
        this.trilha(a, EVENTOS_AUDITAVEIS.sbisCicloAberto.codigo, 'abrir'),
      )
      .catch(indisponivel);
    if (!aberto) return recusa('ciclo-aberto-do-tipo');
    return this.ciclo(a, aberto.id);
  }

  async avaliar(a: AtorSbis, id: string, requisito: string, p: AvaliarItemPedido): Promise<ItemCicloSbis> {
    const { ciclo, itens } = await this.cicloAberto(a, id);
    const registros = await this.d.porta.concessoes(a.hospital).catch(indisponivel);
    const item = itens.find((i) => i.requisito === requisito);
    const r = recusaAvaliarItem(ciclo, requisito, p, concessoesVigentes(registros), item);
    if (r) recusa(r);
    if (!item) return recusa('requisito-desconhecido');
    const ok = await this.d.porta
      .avaliar(
        a.hospital,
        { idCiclo: id, requisito, por: a.login, pedido: p },
        this.trilha(a, EVENTOS_AUDITAVEIS.sbisItemAvaliado.codigo, 'avaliar'),
      )
      .catch(indisponivel);
    if (!ok) recusa('itens-mudaram');
    return aplicarAvaliacao(item, p, a.login, this.agora().toISOString());
  }

  async corrigir(a: AtorSbis, id: string, requisito: string, descricao: string) {
    const { ciclo, itens } = await this.cicloAberto(a, id);
    const item = itens.find((i) => i.requisito === requisito);
    if (!item) return recusa('requisito-desconhecido');
    const r = recusaCorrigirItem(ciclo, item);
    if (r) recusa(r);
    const ok = await this.d.porta
      .corrigir(
        a.hospital,
        { idCiclo: id, requisito, por: a.login, descricao: descricao.trim() },
        this.trilha(a, EVENTOS_AUDITAVEIS.sbisCorrecaoRegistrada.codigo, 'corrigir'),
      )
      .catch(indisponivel);
    if (!ok) recusa('correcao-nao-aberta');
    return { correcao: 'corrigida' as const };
  }

  async verificar(a: AtorSbis, id: string, requisito: string) {
    const { ciclo, itens } = await this.cicloAberto(a, id);
    const item = itens.find((i) => i.requisito === requisito);
    if (!item) return recusa('requisito-desconhecido');
    const r = recusaVerificarItem(ciclo, item, a.login);
    if (r) recusa(r);
    const ok = await this.d.porta
      .verificar(
        a.hospital,
        { idCiclo: id, requisito, por: a.login },
        this.trilha(a, EVENTOS_AUDITAVEIS.sbisCorrecaoRegistrada.codigo, 'verificar'),
      )
      .catch(indisponivel);
    if (!ok) recusa('correcao-nao-corrigida');
    return { correcao: 'verificada' as const };
  }

  async concluir(a: AtorSbis, id: string, p: Omit<ConcluirCicloPedido, 'senha'>): Promise<CicloSbisDetalhe> {
    const { ciclo, itens } = await this.cicloAberto(a, id);
    const r = recusaConcluirCiclo(ciclo, itens, p);
    if (r) recusa(r);
    const ok = await this.d.porta
      .concluir(
        a.hospital,
        {
          id,
          parecer: parecerDosItens(itens),
          parecerTexto: p.parecerTexto.trim(),
          certificado: p.certificado?.trim() ?? null,
          por: a.login,
        },
        this.trilha(a, EVENTOS_AUDITAVEIS.sbisCicloConcluido.codigo, 'concluir'),
      )
      .catch(indisponivel);
    if (!ok) recusa('itens-mudaram');
    return this.ciclo(a, id);
  }

  async cancelar(a: AtorSbis, id: string, motivo: string) {
    const { ciclo } = await this.cicloAberto(a, id);
    const r = recusaCancelarCiclo(ciclo);
    if (r) recusa(r);
    const ok = await this.d.porta
      .cancelar(
        a.hospital,
        { id, motivo: motivo.trim(), por: a.login },
        this.trilha(a, EVENTOS_AUDITAVEIS.sbisCicloConcluido.codigo, 'cancelar'),
      )
      .catch(indisponivel);
    if (!ok) recusa('ciclo-fechado');
    return { cancelado: true as const };
  }

  // ── backup verificado ──────────────────────────────────────────────────────────────────────────

  async backup(a: AtorSbis): Promise<BackupVerificado> {
    await this.pronto(a.hospital, 'backup');
    const restauracoes = await this.d.porta.restauracoes(a.hospital).catch(indisponivel);
    const s = situacaoBackup(restauracoes, this.agora());
    return { hospital: a.hospital, ...s, restauracoes, destino: this.d.porta.destino };
  }

  async registrarRestauracao(a: AtorSbis, p: RegistrarRestauracaoPedido) {
    await this.pronto(a.hospital, 'backup');
    if (Date.parse(p.fim) > this.agora().getTime() + 5 * 60_000)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'O fim da restauração está no futuro.',
      );
    return this.d.porta
      .registrarRestauracao(
        a.hospital,
        { por: a.login, pedido: p },
        this.trilha(a, EVENTOS_AUDITAVEIS.restauracaoRegistrada.codigo, 'registrar'),
      )
      .catch(indisponivel);
  }

  // ── exportação da trilha para a auditoria ──────────────────────────────────────────────────────

  /** A identificação do arquivo e a prova da cadeia do período (até 31 dias, dia a dia). */
  async identificacaoEProva(
    a: AtorSbis,
    inicio: string,
    fim: string,
  ): Promise<{ identificacao: IdentificacaoExportacao; prova: ProvaCadeia }> {
    const v = this.d.versao();
    const [est, cadeia] = await Promise.all([
      // Sem a identificação (CNES e CNPJ), o arquivo não serve à auditoria: falha como a da cadeia, nunca em branco.
      this.d.porta.identificacao(a.hospital).catch(indisponivel),
      this.d.porta
        .verificarDias(a.hospital, diasDoPeriodo(inicio, fim, DIAS_MAXIMOS_PROVA_CADEIA))
        .catch(indisponivel),
    ]);
    return {
      identificacao: {
        software: v.produto,
        versao: v.identificacao,
        ambiente: this.d.ambiente,
        estabelecimento: est.nome,
        cnes: est.cnes,
        cnpj: est.cnpj,
        inicio,
        fim,
        geradoEm: rfc3339(this.agora()),
        geradoPor: a.login,
      },
      prova: provaDaCadeia(cadeia),
    };
  }
}
