// Apoio dos controladores da recepção (M19): a liberação da funcionalidade (chave recepcao.senha, POL-3: construída
// completa e DESLIGADA até o turno simulado; o administrador liga por estabelecimento, setor — a recepção — ou pessoa),
// a gravação pelo Executor (Idempotency-Key, trilha na mesma transação; na memória, pelo registrador da API), as
// gravações de configuração (com a trilha junto) e o estado de cada ação para a tela. O totem grava com o usuário
// técnico do dispositivo (perfil Painel/Totem), nunca com login de pessoa.
// Os erros da porta própria (ErroOperacao do núcleo) seguem ao filtro de problemas da API, que os traduz.
import {
  EVENTOS_AUDITAVEIS,
  type GravacaoRecepcao,
  recursoDesligado,
  type ResultadoRecepcao,
} from '@sgh/contratos';
import { recursoLigado } from '@sgh/dominio-config';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { TTL_CONFIG_NOVO_S } from '../config/public-api.js';
import { META_OPERACOES } from './operacoes.js';
import type { GravadorRecepcao, PortaRecepcao } from './porta.js';
import type {
  ContextoComGravacao,
  ContextoGravacao,
  ContextoRecepcao,
  DispositivoRecepcao,
  TrilhaGravacao,
} from './tipos.js';

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

/** O contexto da gravação pela sessão: o login, a correlação e a Idempotency-Key do pedido (obrigatória). */
export function contextoGravacao(s: SessaoCadastro, rotulo: string): ContextoGravacao {
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  return {
    login: s.login,
    correlacao: correlacaoDaRequisicao(s.req, rotulo).slice(0, 64),
    chaveIdempotencia: chave,
    estacao: estacaoDaRequisicao(s.req).slice(0, 80),
  };
}

/** Alvo da trilha de uma gravação de configuração (a tabela real do banco do cliente e o id). */
export interface AlvoGravacao {
  readonly tabela: string;
  readonly id?: string | number | null;
  readonly paciente?: number | null;
  readonly chave?: string | null;
}

/** A linha da trilha da gravação de configuração, pela sessão. */
export function trilhaDaSessao(
  s: SessaoCadastro,
  evento: string,
  recurso: string,
  alvo: AlvoGravacao,
): TrilhaGravacao {
  const id = alvo.id === null || alvo.id === undefined ? null : Number(alvo.id);
  return {
    evento,
    recurso,
    tabela: alvo.tabela,
    id: id !== null && Number.isSafeInteger(id) && id > 0 ? id : null,
    login: s.login,
    correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
    estacao: estacaoDaRequisicao(s.req).slice(0, 80),
    paciente: alvo.paciente ?? null,
  };
}

export const CHAVE_LIBERACAO_RECEPCAO = 'recepcao.senha';

const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: a gravação da recepção fica desligada.';
export const MOTIVO_DESLIGADO =
  'A recepção ainda não foi liberada para gravar neste estabelecimento, recepção ou pessoa: as telas ficam em consulta. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.';
const MOTIVO_PREREQUISITO =
  'A recepção tem pré-requisito pendente neste estabelecimento: o turno simulado com guichês nos dois sistemas, conferido pelo supervisor da recepção.';

/** Operações e a permissão de agir de cada uma (a tela esconde a ação sem as duas). */
export const OPERACOES_DA_RECEPCAO: Readonly<Record<string, string>> = {
  'recepcao.emitirSenha': 'recepcao.senha.emitir',
  'recepcao.chamarSenha': 'recepcao.senha.chamar',
  'recepcao.registrarEventoSenha': 'recepcao.senha.chamar',
  'recepcao.registrarChegada': 'recepcao.checkin.registrar',
  'recepcao.desfazerChegada': 'recepcao.checkin.registrar',
  'recepcao.abrirGuiche': 'recepcao.senha.chamar',
  'recepcao.fecharGuiche': 'recepcao.senha.chamar',
};

/** Permissão de cada evento da senha (o encaminhamento e os do local têm a sua). */
export function permissaoDoEvento(evento: string): string {
  if (evento === 'encaminhar') return 'recepcao.senha.encaminhar';
  if (['cancelarChamada', 'naoLocalizadoNoLocal', 'chamarNoLocal', 'liberarDoLocal'].includes(evento))
    return 'recepcao.fluxo.registrar';
  return 'recepcao.senha.chamar';
}

export class ApoioRecepcao {
  constructor(
    readonly porta: PortaRecepcao,
    private readonly trilha: RegistradorTrilha,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {}

  private async dadosLiberacao(rede: string, hospital: string) {
    const fonte = this.configuracao;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(rede, hospital),
      prerequisitos: await fonte.prerequisitos(rede, hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(this.cache.chave(rede, hospital, 'liberacao'), TTL_CONFIG_NOVO_S, carregar)
      : carregar();
  }

  /** A funcionalidade vale para a pessoa (ou o usuário técnico do totem) e o setor (a recepção)? */
  async liberacaoPara(
    rede: string,
    hospital: string,
    pessoa: string,
    setor: string | null,
  ): Promise<{ ligada: boolean; motivo: string | null }> {
    let dados: Awaited<ReturnType<ApoioRecepcao['dadosLiberacao']>>;
    try {
      dados = await this.dadosLiberacao(rede, hospital);
    } catch {
      return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    }
    if (!dados) return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    const chaves = dados.chaves
      .filter((c) => c.chave === CHAVE_LIBERACAO_RECEPCAO && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const declarados = recursoDesligado(CHAVE_LIBERACAO_RECEPCAO)?.prerequisitos ?? [];
    const registrados = dados.prerequisitos.filter((p) => p.recurso === CHAVE_LIBERACAO_RECEPCAO);
    const sujeito = { pessoa, ...(setor !== null ? { setor } : {}) };
    if (recursoLigado(chaves, declarados, registrados, sujeito, new Date()))
      return { ligada: true, motivo: null };
    const soPrerequisito = recursoLigado(chaves, [], [], sujeito, new Date());
    return { ligada: false, motivo: soPrerequisito ? MOTIVO_PREREQUISITO : MOTIVO_DESLIGADO };
  }

  liberacao(s: SessaoCadastro): Promise<{ ligada: boolean; motivo: string | null }> {
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    return this.liberacaoPara(
      s.rede,
      s.hospital,
      s.login,
      setor === null || setor === undefined ? null : String(setor),
    );
  }

  async exigirLiberacao(s: SessaoCadastro): Promise<void> {
    const l = await this.liberacao(s);
    if (!l.ligada)
      throw new ErroProblema('recurso-desligado', 403, 'Recepção em consulta', l.motivo ?? MOTIVO_DESLIGADO, {
        codigo: 'recurso-desligado',
      });
  }

  /** Estado da gravação para a tela: a liberação e cada operação (permissão + passo 0 do executor). */
  async gravacao(s: SessaoCadastro): Promise<GravacaoRecepcao> {
    const l = await this.liberacao(s);
    const operacoes: GravacaoRecepcao['operacoes'] = {};
    for (const [op, permissao] of Object.entries(OPERACOES_DA_RECEPCAO)) {
      if (!s.pode(permissao)) {
        operacoes[op] = { pode: false, motivo: 'Seu perfil não permite esta ação.' };
        continue;
      }
      if (!l.ligada) {
        operacoes[op] = { pode: false, motivo: l.motivo };
        continue;
      }
      const p = await this.porta.podeGravar(s.porta, op, s.login).catch(() => ({
        pode: false,
        codigo: 'indisponivel',
        motivo: 'O banco do estabelecimento está indisponível.',
      }));
      operacoes[op] = { pode: p.pode, motivo: p.motivo };
    }
    return { ligada: l.ligada, motivo: l.motivo, operacoes };
  }

  private async trilhaDaMemoria(
    c: ContextoRecepcao,
    usuario: string,
    op: string,
    estacao: string,
    correlacao: string,
    id: string,
  ): Promise<void> {
    if (this.porta.destino !== 'memoria') return;
    const receita = META_OPERACOES[op] ?? { evento: op, recurso: 'recepcao' };
    await this.trilha.registrar({
      evento: receita.evento,
      rede: c.rede,
      hospital: c.hospital,
      usuario,
      estacao: estacao.slice(0, 80),
      correlacao: correlacao.slice(0, 64),
      recurso: receita.recurso,
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo: id,
    });
  }

  /** Grava pelo executor (ou pela memória), com a liberação conferida e a trilha. */
  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    mensagem: string,
  ): Promise<ResultadoRecepcao> {
    await this.exigirLiberacao(s);
    const ctx = contextoGravacao(s, op);
    const r = await this.porta.executar(s.porta, op, entrada, ctx);
    if (!r.repetida)
      await this.trilhaDaMemoria(
        s.porta,
        s.login,
        op,
        estacaoDaRequisicao(s.req),
        correlacaoDaRequisicao(s.req, op),
        String(Object.values(r.resultado)[0] ?? ''),
      );
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem };
  }

  /**
   * Grava pelo dispositivo (totem): o usuário técnico do dispositivo vai às colunas de usuário (como o totem do outro
   * sistema); a liberação vale pela recepção do dispositivo e pelo usuário técnico.
   */
  async executarDoDispositivo(
    d: DispositivoRecepcao,
    rede: string,
    op: string,
    entrada: unknown,
    chaveIdempotencia: string,
    estacao: string,
  ): Promise<ResultadoRecepcao> {
    if (!d.usuarioTecnico)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Totem sem usuário técnico',
        'Cadastre o usuário técnico do totem.',
        {
          codigo: 'dispositivo-sem-usuario',
        },
      );
    const l = await this.liberacaoPara(
      rede,
      d.hospital,
      d.usuarioTecnico,
      d.recepcao === null ? null : String(d.recepcao),
    );
    if (!l.ligada)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Totem fora de serviço',
        'Procure a recepção para retirar a senha.',
        {
          codigo: 'recurso-desligado',
        },
      );
    const ctx: ContextoGravacao = {
      login: d.usuarioTecnico,
      correlacao: `totem-${d.id}`.slice(0, 64),
      chaveIdempotencia,
      estacao: estacao.slice(0, 80),
    };
    const c: ContextoRecepcao = { rede, hospital: d.hospital };
    const r = await this.porta.executar(c, op, entrada, ctx);
    if (!r.repetida)
      await this.trilhaDaMemoria(
        c,
        d.usuarioTecnico,
        op,
        estacao,
        ctx.correlacao,
        String(Object.values(r.resultado)[0] ?? ''),
      );
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem: 'Senha emitida.' };
  }

  /** Gravação de configuração, com a trilha na mesma transação. */
  async gravar<T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvoOuFn: AlvoGravacao | ((r: T) => AlvoGravacao),
    fn: (g: GravadorRecepcao) => Promise<T>,
  ): Promise<T> {
    const alvoDe = (r: T) => (typeof alvoOuFn === 'function' ? alvoOuFn(r) : alvoOuFn);
    const r = await this.porta.gravar(s.porta, (x: T) => trilhaDaSessao(s, evento, recurso, alvoDe(x)), fn);
    const alvo = alvoDe(r);
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
        idAlvo: alvo.id === null || alvo.id === undefined ? '' : String(alvo.id),
      });
    return r;
  }
}

export const EVENTOS_RECEPCAO = EVENTOS_AUDITAVEIS;

/** O que o apoio da classificação usa da porta (a da classificação de risco e a dos protocolos gerenciados). */
export interface PortaComGravacao<G> {
  readonly destino: 'propria' | 'memoria' | 'indisponivel';
  gravar<T>(
    c: ContextoComGravacao,
    trilha: TrilhaGravacao | ((r: T) => TrilhaGravacao),
    fn: (g: G) => Promise<T>,
  ): Promise<T>;
}

export interface ConfiguracaoApoioClassificacao {
  /** Chave da funcionalidade (recursos de liberação). */
  readonly chave: string;
  /** Nome da funcionalidade nas mensagens ("a classificação de risco"). */
  readonly nome: string;
  /** Operações da tela e a permissão de agir de cada uma. */
  readonly operacoes: Readonly<Record<string, string>>;
}

const maiuscula = (t: string) => t.slice(0, 1).toUpperCase() + t.slice(1);

/** Apoio das telas da classificação de risco: liberação pela chave da funcionalidade e gravação com a trilha. */
export class ApoioClassificacao<G> {
  constructor(
    readonly cfg: ConfiguracaoApoioClassificacao,
    readonly porta: PortaComGravacao<G>,
    private readonly trilha: RegistradorTrilha,
    private readonly configuracao: FonteConfiguracao | null,
    private readonly cache: CacheConfig | null,
  ) {}

  private get motivoDesligado(): string {
    return `${maiuscula(this.cfg.nome)} ainda não foi liberada para gravar neste estabelecimento ou setor: as telas ficam em consulta. A liberação é feita pelo administrador em Funcionalidades por estabelecimento.`;
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

  async liberacao(s: SessaoCadastro): Promise<{ ligada: boolean; motivo: string | null }> {
    const semConfiguracao = `A configuração das funcionalidades do estabelecimento não está disponível: ${this.cfg.nome} fica em consulta.`;
    let dados: Awaited<ReturnType<ApoioClassificacao<G>['dadosLiberacao']>>;
    try {
      dados = await this.dadosLiberacao(s);
    } catch {
      return { ligada: false, motivo: semConfiguracao };
    }
    if (!dados) return { ligada: false, motivo: semConfiguracao };
    const chaves = dados.chaves
      .filter((c) => c.chave === this.cfg.chave && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const declarados = recursoDesligado(this.cfg.chave)?.prerequisitos ?? [];
    const registrados = dados.prerequisitos.filter((p) => p.recurso === this.cfg.chave);
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const sujeito = {
      pessoa: s.login,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
    };
    if (recursoLigado(chaves, declarados, registrados, sujeito, new Date()))
      return { ligada: true, motivo: null };
    const soPrerequisito = recursoLigado(chaves, [], [], sujeito, new Date());
    return {
      ligada: false,
      motivo: soPrerequisito
        ? `${maiuscula(this.cfg.nome)} tem pré-requisito pendente neste estabelecimento: a conferência pelos chave-usuários.`
        : this.motivoDesligado,
    };
  }

  async exigirLiberacao(s: SessaoCadastro): Promise<void> {
    const l = await this.liberacao(s);
    if (!l.ligada)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Funcionalidade em consulta',
        l.motivo ?? this.motivoDesligado,
        {
          codigo: 'recurso-desligado',
        },
      );
  }

  /** Gravação com a liberação conferida e a trilha na mesma transação (na memória, pelo registrador da API). */
  async gravar<T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvoOuFn: AlvoGravacao | ((r: T) => AlvoGravacao),
    fn: (g: G) => Promise<T>,
  ): Promise<T> {
    await this.exigirLiberacao(s);
    const alvoDe = (r: T) => (typeof alvoOuFn === 'function' ? alvoOuFn(r) : alvoOuFn);
    // O contexto de gravação do pedido (Idempotency-Key obrigatória) vai à porta: cada gravação é uma operação do
    // Executor, com a trilha, o outbox e a idempotência na mesma transação.
    const gravacao = { ...contextoGravacao(s, evento), evento, recurso };
    const r = await this.porta.gravar(
      { ...s.porta, gravacao },
      (x: T) => trilhaDaSessao(s, evento, recurso, alvoDe(x)),
      fn,
    );
    if (this.porta.destino === 'memoria') {
      const alvo = alvoDe(r);
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
        idAlvo: alvo.id === null || alvo.id === undefined ? '' : String(alvo.id),
      });
    }
    return r;
  }
}
