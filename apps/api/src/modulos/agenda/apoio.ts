// Apoio dos controladores da agenda (M17): a liberação da funcionalidade (chave agenda.consulta: construída completa
// e DESLIGADA até a conferência; o administrador liga por estabelecimento, setor ou pessoa), a gravação pela porta
// (Idempotency-Key; na porta própria, o Executor do núcleo grava a trilha na mesma transação; na memória, o
// registrador da API) e o estado de cada ação para a tela.
// Melhoria: o contexto da gravação (login, correlação e chave) é montado aqui, sem depender do formato de outro módulo.
import { randomUUID } from 'node:crypto';
import {
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  recursoDesligado,
  type ResultadoAgenda,
} from '@sgh/contratos';
import { recursoLigado } from '@sgh/dominio-config';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { TTL_CONFIG_NOVO_S } from '../config/public-api.js';
import { escopoDaRequisicao } from './escopo.js';
import { operacaoAgenda } from './operacoes.js';
import type { ContextoAgenda, ContextoGravacao, GravadorAgenda, PortaAgenda } from './porta.js';
import { ServicoAgenda } from './servico.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

/** Contexto da porta com o escopo da sessão (unidade e tipo de agenda) para as decisões do servidor. */
export const ctxAgenda = (s: SessaoCadastro): ContextoAgenda => ({
  rede: s.rede,
  hospital: s.hospital,
  escopo: escopoDaRequisicao(s.req),
});

/**
 * Contexto da gravação: login da sessão, correlação e a Idempotency-Key do pedido. Sem a chave, as operações da
 * agenda recusam (400); as gravações de apoio sem chave ganham uma nova (não são repetíveis pela tela).
 */
export function contextoGravacao(s: SessaoCadastro, rotulo: string, exigirChave: boolean): ContextoGravacao {
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  const valida = typeof chave === 'string' && IDEMPOTENCIA.test(chave);
  if (!valida && exigirChave)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  return {
    ...ctxAgenda(s),
    login: s.login,
    correlacao: correlacaoDaRequisicao(s.req, rotulo).slice(0, 64),
    chaveIdempotencia: valida ? `${chave}:${rotulo}`.slice(0, 80) : `agenda-${randomUUID()}`,
    ...(s.req.ip ? { enderecoIp: String(s.req.ip) } : {}),
  };
}

export const CHAVE_LIBERACAO_AGENDA = 'agenda.consulta';

/** Alvo do evento de uma gravação de apoio (tabela do produto, id do registro e paciente). */
export interface AlvoGravacao {
  readonly tabela: string;
  readonly id?: string | null;
  readonly paciente?: number | null;
  readonly chave?: string | null;
}

const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: a gravação da agenda fica desligada.';
export const MOTIVO_DESLIGADO =
  'A agenda de consultas ainda não foi liberada para gravar neste estabelecimento ou setor: as telas ficam em consulta. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.';
const MOTIVO_PREREQUISITO =
  'A agenda de consultas tem pré-requisito pendente neste estabelecimento: a conferência pelos chave-usuários do call center e da recepção.';

/** Operações e a permissão de agir de cada uma (a tela esconde a ação sem as duas). */
export const OPERACOES_DA_AGENDA: Readonly<Record<string, string>> = {
  'agenda.gerarGrade': 'agenda.grade.gerar',
  'agenda.reverterGrade': 'agenda.grade.reverter',
  'agenda.agendarConsulta': 'agenda.marcacao.agendar',
  'agenda.encaixar': 'agenda.encaixe.criar',
  'agenda.desfazerEncaixe': 'agenda.encaixe.criar',
  'agenda.cancelarConsulta': 'agenda.marcacao.cancelar',
  'agenda.remarcarConsulta': 'agenda.marcacao.remarcar',
  'agenda.confirmarConsulta': 'agenda.marcacao.confirmar',
  'agenda.registrarFalta': 'agenda.falta.registrar',
  'agenda.bloquearHorarios': 'agenda.bloqueio.criar',
  'agenda.definirCobertura': 'agenda.cobertura.editar',
  'agenda.definirEspecialidade': 'agenda.cobertura.editar',
  'agenda.incluirAgenda': 'agenda.agenda.editar',
  'agenda.alterarAgenda': 'agenda.agenda.editar',
  'agenda.agendarSemProntuario': 'agenda.marcacao.agendar',
};

export class ApoioAgenda {
  private readonly servico: ServicoAgenda;
  constructor(
    readonly porta: PortaAgenda,
    private readonly trilha: RegistradorTrilha,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {
    this.servico = new ServicoAgenda(porta);
  }

  private async dadosLiberacao(s: SessaoCadastro) {
    const fonte = this.configuracao;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(s.rede, s.hospital),
      prerequisitos: await fonte.prerequisitos(s.rede, s.hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'liberacao'),
          TTL_CONFIG_NOVO_S,
          carregar,
        )
      : carregar();
  }

  /** A funcionalidade vale para esta sessão (pessoa e setor)? */
  async liberacao(s: SessaoCadastro): Promise<{ ligada: boolean; motivo: string | null }> {
    let dados: Awaited<ReturnType<ApoioAgenda['dadosLiberacao']>>;
    try {
      dados = await this.dadosLiberacao(s);
    } catch {
      return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    }
    if (!dados) return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    const chaves = dados.chaves
      .filter((c) => c.chave === CHAVE_LIBERACAO_AGENDA && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const declarados = recursoDesligado(CHAVE_LIBERACAO_AGENDA)?.prerequisitos ?? [];
    const registrados = dados.prerequisitos.filter((p) => p.recurso === CHAVE_LIBERACAO_AGENDA);
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const sujeito = {
      pessoa: s.login,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
    };
    if (recursoLigado(chaves, declarados, registrados, sujeito, new Date()))
      return { ligada: true, motivo: null };
    const soPrerequisito = recursoLigado(chaves, [], [], sujeito, new Date());
    return { ligada: false, motivo: soPrerequisito ? MOTIVO_PREREQUISITO : MOTIVO_DESLIGADO };
  }

  async exigirLiberacao(s: SessaoCadastro): Promise<void> {
    const l = await this.liberacao(s);
    if (!l.ligada)
      throw new ErroProblema('recurso-desligado', 403, 'Agenda em consulta', l.motivo ?? MOTIVO_DESLIGADO, {
        codigo: 'recurso-desligado',
      });
  }

  /** Estado da gravação para a tela: a liberação e cada operação (permissão + passo 0 do executor). */
  async gravacao(s: SessaoCadastro): Promise<GravacaoAgenda> {
    const l = await this.liberacao(s);
    const operacoes: GravacaoAgenda['operacoes'] = {};
    for (const [op, permissao] of Object.entries(OPERACOES_DA_AGENDA)) {
      if (!s.pode(permissao)) {
        operacoes[op] = { pode: false, motivo: 'Seu perfil não permite esta ação.' };
        continue;
      }
      if (!l.ligada) {
        operacoes[op] = { pode: false, motivo: l.motivo };
        continue;
      }
      const p = await this.porta.podeGravar(ctxAgenda(s), op, s.login).catch(() => ({
        pode: false,
        codigo: 'indisponivel',
        motivo: 'O banco do estabelecimento está indisponível.',
      }));
      operacoes[op] = { pode: p.pode, motivo: p.motivo };
    }
    return { ligada: l.ligada, motivo: l.motivo, operacoes };
  }

  /** Grava pela porta (Executor do núcleo ou memória), com a liberação e o escopo conferidos. */
  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    mensagem: string,
  ): Promise<ResultadoAgenda> {
    await this.exigirLiberacao(s);
    await this.servico.exigirEscopoDaEntrada(ctxAgenda(s), op, entrada);
    const definicao = operacaoAgenda(op);
    const r = await this.porta.executar(contextoGravacao(s, op, true), op, entrada);
    if (this.porta.destino === 'memoria' && !r.repetida)
      await this.trilha.registrar({
        evento: definicao.evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, op).slice(0, 64),
        recurso: definicao.recurso,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: String(Object.values(r.resultado)[0] ?? ''),
      });
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem };
  }

  /** Gravação de apoio (escala planejada, bloqueio de período, fila, confirmação, vínculos), com a trilha. */
  async gravar<T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvoOuFn: AlvoGravacao | ((r: T) => AlvoGravacao),
    fn: (g: GravadorAgenda) => Promise<T>,
  ): Promise<T> {
    await this.exigirLiberacao(s);
    const r = await this.porta.gravar(contextoGravacao(s, evento, false), fn);
    const alvo = typeof alvoOuFn === 'function' ? alvoOuFn(r) : alvoOuFn;
    if (this.porta.destino === 'memoria')
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: alvo.id ?? '',
      });
    return r;
  }
}

export const EVENTOS_AGENDA = EVENTOS_AUDITAVEIS;
