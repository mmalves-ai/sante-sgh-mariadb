// O PIN da troca rápida sobre o banco do cliente (F2.2, lote 03-02), pelo @sgh/nucleo: as leituras somente leitura e as
// gravações (definir, retirar e a conferência) numa operação do Executor, com a trilha e a idempotência na mesma
// transação, na tabela pin_troca_rapida (pedido do lote, saida/03-02-pin.sql). Só o resumo Argon2id (PHC, feito pelo
// servidor) passa por aqui; o PIN em claro nunca. O estabelecimento vem do resolvedor da sessão (código → id no cliente).
// Melhoria: uma linha por PIN definido, com o encerramento (substituído ou retirado), o motivo e o resumo apagado ao
// encerrar; um só PIN vivo por usuário e estabelecimento garantido pelo banco (chave única sobre coluna gerada).
// Melhoria: a contagem de erros e o bloqueio são decididos na gravação, com a linha travada (FOR UPDATE), nunca pela
// leitura anterior; o teto vai de 1 a 10 e o banco recusa mais de 10 erros (CHECK).
// Melhoria: o usuário do PIN é conferido por id e login na mesma transação (conta excluída não recebe PIN), e toda
// conferência (certa ou errada) fica na trilha, não só o bloqueio.
// Chave de idempotência: as operações do PIN são disparadas pelo servidor (a tela de segurança e a troca rápida), não
// por pedido repetível; cada conferência conta como uma tentativa, por isso cada gravação tem uma chave própria.
import { randomUUID } from 'node:crypto';
import {
  definirOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  restricaoViolada,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type {
  ConferenciaPin,
  NovoPin,
  PinVivoLido,
  PortaPin,
  ResultadoConferenciaPin,
  SituacaoPinLida,
  TrilhaPin,
} from './porta-pin.js';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export type NucleoPin = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** Código do estabelecimento da sessão → cliente (o banco) e o id do estabelecimento (null: fora do cliente). */
export type ResolverEstabelecimentoPin = (
  rede: string,
  hospital: string,
) => { readonly cliente: string; readonly estabelecimento: number | null };

export const TABELA_PIN = 'pin_troca_rapida';
/** Teto do banco para os erros seguidos (CHECK). */
const TETO_ERROS = 10;
const RESUMO_ARGON2ID = /^\$argon2id\$/;

type Linha = Record<string, unknown>;
const instante = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** O PIN vivo do login no estabelecimento (conta não excluída). */
const SQL_VIVO = `SELECT p.id, p.usuario_id, p.resumo_pin, p.tentativas_invalidas, p.criado_em, p.bloqueado_em, p.versao
  FROM pin_troca_rapida p JOIN usuario u ON u.id = p.usuario_id
 WHERE p.estabelecimento_id = ? AND u.login = ? AND u.excluido_em IS NULL AND p.situacao = 'vivo'`;

function situacaoDe(r: Linha | null): SituacaoPinLida {
  return {
    definido: Boolean(r),
    bloqueado: Boolean(r?.['bloqueado_em']),
    falhas: Number(r?.['tentativas_invalidas'] ?? 0),
    criadoEm: instante(r?.['criado_em']),
    bloqueadoEm: instante(r?.['bloqueado_em']),
  };
}

const ENTRADA = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

interface Feito<T> {
  readonly resultado: T;
  readonly alvo: number | null;
  readonly diferenca: string | null;
}

export class PortaPinPropria implements PortaPin {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoPin,
    private readonly resolver: ResolverEstabelecimentoPin,
    executorPronto?: Executor,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private onde(rede: string, hospital: string): { cliente: string; estabelecimento: number } {
    const r = this.resolver(rede, hospital);
    if (!r.cliente || r.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'O estabelecimento da sessão não está no banco do cliente.');
    return { cliente: r.cliente, estabelecimento: r.estabelecimento };
  }

  private async ler<T>(
    rede: string,
    hospital: string,
    fn: (l: Leitor, est: number) => Promise<T>,
  ): Promise<T> {
    const o = this.onde(rede, hospital);
    return this.nucleo.lerSomente(
      { cliente: o.cliente, estabelecimento: o.estabelecimento, correlacao: 'acesso-pin' },
      (l) => fn(l, o.estabelecimento),
    );
  }

  async situacao(rede: string, hospital: string, login: string): Promise<SituacaoPinLida> {
    return this.ler(rede, hospital, async (l, est) => situacaoDe(await l.uma(SQL_VIVO, [est, login])));
  }

  async vivo(rede: string, hospital: string, login: string): Promise<PinVivoLido | null> {
    return this.ler(rede, hospital, async (l, est) => {
      const r = await l.uma(SQL_VIVO, [est, login]);
      return r?.['resumo_pin']
        ? { ...situacaoDe(r), id: String(r['id']), hashPhc: String(r['resumo_pin']) }
        : null;
    });
  }

  /** Uma gravação do PIN: operação do Executor com a trilha (evento, recurso e a diferença, sem o resumo). */
  private async gravar<T extends ResultadoOperacao>(
    rede: string,
    hospital: string,
    nome: string,
    t: TrilhaPin,
    entrada: Readonly<Record<string, string | number | boolean | null>>,
    fn: (tx: TxOperacao, est: number) => Promise<Feito<T>>,
  ): Promise<T> {
    const o = this.onde(rede, hospital);
    let feito: Feito<T> | null = null;
    const op = definirOperacao({
      nome,
      tabelas: [TABELA_PIN],
      entrada: ENTRADA,
      gravar: async (tx) => {
        feito = await fn(tx, o.estabelecimento);
        return feito.resultado;
      },
      alvo: () => ({ tabela: TABELA_PIN, id: feito?.alvo ?? null }),
      trilha: () => ({
        dados: {
          evento: t.evento,
          recurso: t.recurso,
          operacao: t.operacao,
          resultado: t.resultado,
          estacao: t.estacao,
          diferenca: feito?.diferenca ?? null,
        },
      }),
    });
    // Quem age (o login da trilha) por id; sem conta no cliente (processo do servidor), null.
    const ator = await this.nucleo.lerSomente(
      { cliente: o.cliente, estabelecimento: o.estabelecimento, correlacao: 'acesso-pin' },
      (l) => l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [t.usuario]),
    );
    const r = await this.executor.executar(op, o.cliente, entrada, {
      cliente: o.cliente,
      estabelecimento: o.estabelecimento,
      usuario: ator ? Number(ator['id']) : null,
      correlacao: (t.correlacao || 'acesso-pin').slice(0, 64),
      chaveIdempotencia: `pin:${randomUUID()}`,
    });
    return r.resultado as T;
  }

  /** Trava o PIN vivo do login (null: sem PIN). */
  private async travarVivo(tx: TxOperacao, est: number, login: string): Promise<Linha | null> {
    const [r] = await tx.consultarParaAtualizar(SQL_VIVO, [est, login], { teto: 1 });
    return r ?? null;
  }

  private encerrar(tx: TxOperacao, r: Linha, situacao: 'substituido' | 'retirado', motivo: string) {
    return tx.alterar(TABELA_PIN, Number(r['id']), Number(r['versao']), {
      situacao,
      resumo_pin: null,
      encerrado_em: this.agora(),
      motivo_encerramento: motivo.slice(0, 200) || situacao,
    });
  }

  async definir(
    rede: string,
    hospital: string,
    p: NovoPin,
    t: TrilhaPin,
  ): Promise<{ id: string; anterior: 'nenhum' | 'definido' | 'bloqueado' }> {
    if (!RESUMO_ARGON2ID.test(p.hashPhc)) throw recusa('pin-sem-cifra', 'O PIN só é guardado cifrado.');
    return this.gravar(
      rede,
      hospital,
      'acesso.pin.definir',
      t,
      { usuario: p.idUsuario, login: p.login },
      async (tx, est) => {
        const u = await tx.uma('SELECT id FROM usuario WHERE id = ? AND login = ? AND excluido_em IS NULL', [
          p.idUsuario,
          p.login,
        ]);
        if (!u) throw recusa('usuario-inexistente', 'A conta não existe neste cliente.');
        const atual = await this.travarVivo(tx, est, p.login);
        const anterior = !atual ? 'nenhum' : atual['bloqueado_em'] ? 'bloqueado' : 'definido';
        if (atual) await this.encerrar(tx, atual, 'substituido', p.motivo);
        let id: number;
        try {
          id = await tx.incluir(TABELA_PIN, {
            estabelecimento_id: est,
            usuario_id: p.idUsuario,
            algoritmo: 'argon2id',
            resumo_pin: p.hashPhc,
            situacao: 'vivo',
            tentativas_invalidas: 0,
          });
        } catch (e) {
          if (restricaoViolada(e)?.tipo === 'unica')
            throw recusa('pin-em-uso', 'Outro pedido definiu o PIN agora: tente de novo.');
          throw e;
        }
        return {
          resultado: { id: String(id), anterior },
          alvo: id,
          diferenca: `PIN: ${anterior} -> definido; motivo: ${p.motivo}`,
        };
      },
    );
  }

  async retirar(
    rede: string,
    hospital: string,
    p: { readonly login: string; readonly por: string; readonly motivo: string },
    t: TrilhaPin,
  ): Promise<{ id: string; anterior: 'definido' | 'bloqueado' }> {
    return this.gravar(rede, hospital, 'acesso.pin.retirar', t, { login: p.login }, async (tx, est) => {
      const atual = await this.travarVivo(tx, est, p.login);
      if (!atual) throw recusa('sem-pin', 'Este usuário não tem PIN de troca rápida.');
      const anterior = atual['bloqueado_em'] ? 'bloqueado' : 'definido';
      await this.encerrar(tx, atual, 'retirado', p.motivo);
      return {
        resultado: { id: String(atual['id']), anterior },
        alvo: Number(atual['id']),
        diferenca: `PIN: ${anterior} -> retirado; motivo: ${p.motivo}`,
      };
    });
  }

  async conferencia(
    rede: string,
    hospital: string,
    p: ConferenciaPin,
    t: TrilhaPin,
  ): Promise<ResultadoConferenciaPin> {
    const id = Number(p.id);
    if (!Number.isSafeInteger(id) || id <= 0) return { aceito: false, falhas: null, bloqueouAgora: false };
    const teto = Math.min(Math.max(Math.trunc(p.teto ?? 5), 1), TETO_ERROS);
    type Saida = { aceito: boolean; falhas: number | null; bloqueouAgora: boolean };
    const r = await this.gravar<Saida>(
      rede,
      hospital,
      'acesso.pin.conferencia',
      t,
      { pin: id, certo: p.certo, teto },
      async (tx, est) => {
        // Só o PIN vivo e livre do estabelecimento conta; o bloqueado ou encerrado não aceita nem soma.
        const [x] = await tx.consultarParaAtualizar(
          `SELECT p.id, p.tentativas_invalidas, p.versao FROM pin_troca_rapida p JOIN usuario u ON u.id = p.usuario_id
            WHERE p.id = ? AND p.estabelecimento_id = ? AND u.login = ? AND p.situacao = 'vivo' AND p.bloqueado_em IS NULL`,
          [id, est, p.login],
          { teto: 1 },
        );
        const falhasAntes = Number(x?.['tentativas_invalidas'] ?? 0);
        if (p.certo) {
          if (x && falhasAntes > 0)
            await tx.alterar(TABELA_PIN, id, Number(x['versao']), { tentativas_invalidas: 0 });
          return {
            resultado: { aceito: Boolean(x), falhas: x ? 0 : null, bloqueouAgora: false },
            alvo: x ? id : null,
            diferenca: null,
          };
        }
        if (!x || falhasAntes >= TETO_ERROS)
          return {
            resultado: { aceito: false, falhas: null, bloqueouAgora: false },
            alvo: null,
            diferenca: null,
          };
        const falhas = falhasAntes + 1;
        const bloqueouAgora = falhas >= teto;
        await tx.alterar(TABELA_PIN, id, Number(x['versao']), {
          tentativas_invalidas: falhas,
          ultima_tentativa_invalida_em: this.agora(),
          ...(bloqueouAgora ? { bloqueado_em: this.agora() } : {}),
        });
        return {
          resultado: { aceito: false, falhas, bloqueouAgora },
          alvo: id,
          diferenca: bloqueouAgora ? `PIN: definido -> bloqueado; motivo: ${falhas} erros seguidos` : null,
        };
      },
    );
    return {
      aceito: r.aceito === true,
      falhas: r.falhas === null ? null : Number(r.falhas),
      bloqueouAgora: r.bloqueouAgora === true,
    };
  }
}
