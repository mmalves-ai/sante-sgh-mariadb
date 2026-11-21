// Apoio comum das telas de gravação do M18 (agenda de exames e centro cirúrgico): a liberação da funcionalidade por
// chave (o administrador liga por estabelecimento, setor ou pessoa), o estado de cada ação para a tela (permissão +
// passo 0 do executor), a gravação pelo executor do @sgh/nucleo (Idempotency-Key; trilha, outbox e idempotência na
// mesma transação; na memória, pelo registrador da API), as gravações diretas da porta (`gravarSgh`, com a linha da
// trilha na mesma transação) e os parâmetros do estabelecimento resolvidos para a sessão.
// Melhoria: o contexto da porta é o ContextoNucleo (cliente, estabelecimento, usuário e correlação por id), sem
// rede/hospital em texto nem login do sistema de origem; a trilha da memória leva o nome da operação.
import {
  definicaoParametro,
  type GravacaoAgenda,
  recursoDesligado,
  type ResultadoAgenda,
} from '@sgh/contratos';
import { recursoLigado, resolverParametro, valorTipado } from '@sgh/dominio-config';
import type { ContextoNucleo, ContextoOperacao, LinhaTrilha, ResultadoOperacao } from '@sgh/nucleo';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  contextoOperacao,
  exigir,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
} from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { TTL_CONFIG_NOVO_S } from '../config/public-api.js';

/** Contexto da porta: cliente (o banco), estabelecimento, usuário e correlação da sessão. */
export type ContextoPortaM18 = ContextoNucleo;

/** Onde a porta lê e grava: o banco do cliente (MariaDB, pelo núcleo) ou a memória sintética de dev/ci. */
export type DestinoPorta = 'banco' | 'memoria';

/** Liberação da gravação (passo 0 do executor): pode gravar agora, com o código e o motivo. */
export interface LiberacaoGravacao {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

export interface GravacaoFeita {
  readonly resultado: ResultadoOperacao;
  readonly repetida: boolean;
  /** Id da linha da trilha (null na memória). */
  readonly trilha: number | null;
}

/** Linha da trilha de uma gravação direta da porta (o estabelecimento, o usuário e a correlação vêm do contexto). */
export type TrilhaDaGravacao = Omit<LinhaTrilha, 'ocorridoEm'> & { readonly ocorridoEm?: Date };

/** O que o apoio precisa da porta (as duas portas do M18 têm estes métodos). */
export interface PortaGravacaoM18<G> {
  readonly destino: DestinoPorta;
  podeGravar(c: ContextoPortaM18, operacao: string): Promise<LiberacaoGravacao>;
  executar(
    c: ContextoPortaM18,
    operacao: string,
    entrada: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita>;
  gravarSgh<T>(
    c: ContextoPortaM18,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: G) => Promise<T>,
  ): Promise<T>;
}

/** Valor de `destino` no contrato das telas (o enum do contrato ainda chama o banco de 'legado'; pedido da onda). */
export const destinoDoContrato = (d: DestinoPorta): 'legado' | 'memoria' => (d === 'memoria' ? 'memoria' : 'legado');

/** Alvo da linha da trilha de uma gravação direta da porta (tabela, id do registro e paciente). */
export interface AlvoSgh {
  readonly tabela: string;
  readonly id?: string | null;
  readonly paciente?: number | null;
  readonly chave?: string | null;
}

export interface ConfiguracaoApoio {
  /** Chave da funcionalidade (recursos de liberação do M08). */
  readonly chave: string;
  /** Nome da funcionalidade nas mensagens ("a agenda de exames"). */
  readonly nome: string;
  /** Operações da tela e a permissão de agir de cada uma. */
  readonly operacoes: Readonly<Record<string, string>>;
}

export class ApoioGravacao<G> {
  constructor(
    readonly cfg: ConfiguracaoApoio,
    readonly porta: PortaGravacaoM18<G>,
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

  /** A funcionalidade vale para esta sessão (pessoa e setor)? */
  async liberacao(s: SessaoCadastro): Promise<{ ligada: boolean; motivo: string | null }> {
    const semConfiguracao = `A configuração das funcionalidades do estabelecimento não está disponível: ${this.cfg.nome} fica em consulta.`;
    let dados: Awaited<ReturnType<ApoioGravacao<G>['dadosLiberacao']>>;
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

  /** Exige uma permissão a mais que a da operação (a negação vai à trilha; 403). */
  async exigirPermissao(s: SessaoCadastro, codigo: string): Promise<void> {
    await exigir(s, codigo, this.trilha);
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

  /** Estado da gravação para a tela: a liberação e cada operação (permissão + passo 0 do executor). */
  async gravacao(s: SessaoCadastro, extras: Readonly<Record<string, string>> = {}): Promise<GravacaoAgenda> {
    const l = await this.liberacao(s);
    const operacoes: GravacaoAgenda['operacoes'] = {};
    for (const [op, permissao] of Object.entries(this.cfg.operacoes)) {
      if (!s.pode(permissao)) {
        operacoes[op] = { pode: false, motivo: 'Seu perfil não permite esta ação.' };
        continue;
      }
      if (!l.ligada) {
        operacoes[op] = { pode: false, motivo: l.motivo };
        continue;
      }
      const p = await this.porta.podeGravar(s.porta, op).catch(() => ({
        pode: false,
        codigo: 'indisponivel',
        motivo: 'O banco do estabelecimento está indisponível.',
      }));
      operacoes[op] = { pode: p.pode, motivo: p.motivo };
    }
    // Ações diretas da porta (sem operação do executor): valem a permissão e a liberação.
    for (const [acao, permissao] of Object.entries(extras))
      operacoes[acao] = !s.pode(permissao)
        ? { pode: false, motivo: 'Seu perfil não permite esta ação.' }
        : { pode: l.ligada, motivo: l.ligada ? null : l.motivo };
    return { ligada: l.ligada, motivo: l.motivo, operacoes };
  }

  /** Grava pelo executor (ou pela memória), com a liberação conferida e a trilha. */
  async executar(
    s: SessaoCadastro,
    op: string,
    entrada: unknown,
    mensagem: string,
    // M25: a sincronização do tablet leva a chave de cada ato (Idempotency-Key do ato, não a do lote).
    extras: Pick<Partial<ContextoOperacao>, 'reautenticadoEm' | 'chaveIdempotencia'> = {},
  ): Promise<ResultadoAgenda> {
    // A permissão de agir da operação nesta funcionalidade (o mapa da tela vale também no servidor): a rota confere a
    // dela, e a funcionalidade a sua (ex.: o desfecho de uma ficha de pronto atendimento exige a do PA).
    const exigida = this.cfg.operacoes[op];
    if (exigida && !s.pode(exigida))
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
        codigo: 'sem-permissao',
      });
    await this.exigirLiberacao(s);
    // M20: a receita crítica (a exclusão do atendimento) leva a reautenticação recente ao executor.
    const ctx: ContextoOperacao = { ...contextoOperacao(s, op), ...extras };
    const r = await this.porta.executar(s.porta, op, entrada, ctx).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria' && !r.repetida)
      await this.registrarMemoria(s, op, this.cfg.chave, String(Object.values(r.resultado)[0] ?? ''));
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem };
  }

  private registrarMemoria(s: SessaoCadastro, evento: string, recurso: string, idAlvo: string) {
    return this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
      recurso,
      resultado: 'sucesso',
      tabelaAlvo: 'MEMORIA',
      idAlvo,
    });
  }

  /** Gravação direta da porta, com a linha da trilha na mesma transação. */
  async sgh<T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvoOuFn: AlvoSgh | ((r: T) => AlvoSgh),
    fn: (g: G) => Promise<T>,
  ): Promise<T> {
    await this.exigirLiberacao(s);
    const alvoDe = (r: T) => (typeof alvoOuFn === 'function' ? alvoOuFn(r) : alvoOuFn);
    const r = await this.porta
      .gravarSgh(
        s.porta,
        (x: T): TrilhaDaGravacao => linhaTrilha(s, evento, recurso, evento, alvoDe(x)),
        fn,
      )
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    if (this.porta.destino === 'memoria') await this.registrarMemoria(s, evento, recurso, alvoDe(r).id ?? '');
    return r;
  }

  /** Parâmetro do novo resolvido para a sessão; 0 se ausente. `unidade` troca o setor da sessão pela unidade pedida. */
  async parametro(s: SessaoCadastro, chave: string, unidade?: string | null): Promise<number> {
    const v = await this.parametroValor(s, chave, unidade);
    return typeof v === 'number' ? v : Number(v ?? 0) || 0;
  }

  /**
   * M29: o valor tipado do parâmetro (texto, booleano ou número) resolvido para a sessão; null se ausente. O nível
   * `unidade` é o setor da sessão, salvo quando `unidade` é passada (M45.5: o corte é o da unidade consultada, não o
   * de quem consulta; null resolve sem o nível da unidade).
   */
  async parametroValor(s: SessaoCadastro, chave: string, unidade?: string | null): Promise<unknown> {
    return (await this.resolvedorParametros(s))(chave, unidade);
  }

  /**
   * Os valores dos parâmetros lidos UMA vez e um resolvedor síncrono por chave e unidade (M45.5: a fila e o mapa
   * resolvem vários parâmetros por unidade sem reler a configuração a cada um).
   */
  async resolvedorParametros(
    s: SessaoCadastro,
  ): Promise<(chave: string, unidade?: string | null) => unknown> {
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const agora = new Date();
    return (chave, unidade) => {
      const def = definicaoParametro(chave);
      if (!def) return null;
      const setor = unidade !== undefined ? unidade : s.req.sgh?.sessao.unidadeAtiva;
      const v = valorTipado(
        def,
        resolverParametro(
          def,
          valores,
          {
            rede: s.rede,
            empresa: null,
            estabelecimento: s.hospital,
            unidade: setor === null || setor === undefined ? null : String(setor),
            perfis: [],
            usuario: s.login,
          },
          agora,
        ).valor,
      );
      return v ?? null;
    };
  }
}

const maiuscula = (t: string) => t.slice(0, 1).toUpperCase() + t.slice(1);

/** Porta indisponível (fora de dev/ci sem o núcleo): toda chamada responde 503, nada lido nem gravado. */
export function portaIndisponivel<P extends object>(metodos: ReadonlySet<string>): P {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  return new Proxy(
    {},
    {
      get: (_t, chave) => {
        if (chave === 'destino') return 'banco';
        if (chave === 'podeGravar')
          return async () => ({
            pode: false,
            codigo: 'indisponivel',
            motivo: 'O banco do estabelecimento não está configurado: nada é gravado.',
          });
        // Só os métodos da porta: o Nest procura ganchos (onModuleInit…) e `then` em todo provedor.
        return typeof chave === 'string' && metodos.has(chave) ? recusa : undefined;
      },
    },
  ) as P;
}
