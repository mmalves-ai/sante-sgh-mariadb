// Sondas da implantação azul/verde (cap-14 §14.10.1): a porta do que a sonda lê do banco do cliente.
// - Própria: `SELECT 1` pelo núcleo (saúde) e os códigos dos estabelecimentos ativos do cliente (valida o hospital
//   pedido), só leitura, sem trilha.
// - Memória: só em dev/ci sem núcleo (fontesSinteticas), com os estabelecimentos dados.
// - Indisponível: fora disso, o banco "não responde" e nenhum estabelecimento vale (falha fechada: a sonda não fica
//   verde).
// Lote 02-07 (ADR 0003, itens 5 e 9): veio da porta antiga da virada gradual (apagada); a sonda é da implantação.
// Melhoria: o hospital é validado contra o cadastro do banco do cliente (antes, contra a lista do ambiente).
import type { Leitor } from '@sgh/nucleo';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';

export const PORTA_SONDA = Symbol('PORTA_SONDA');

export interface PortaSonda {
  /** O banco do cliente responde a um `SELECT 1`. Falha vira `false` (a sonda não sobe erro). */
  bancoResponde(): Promise<boolean>;
  /** Códigos dos estabelecimentos ativos do cliente, em ordem. */
  estabelecimentos(): Promise<readonly string[]>;
}

/** O mínimo do NucleoProprio que a sonda usa. */
export interface NucleoSonda {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

export class PortaSondaPropria implements PortaSonda {
  constructor(
    private readonly nucleo: NucleoSonda,
    private readonly cliente: string,
  ) {}

  async bancoResponde(): Promise<boolean> {
    try {
      const r = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'sonda-saude' }, (l) =>
        l.uma<{ ok: number }>('SELECT 1 AS ok'),
      );
      return Number(r?.ok) === 1;
    } catch {
      return false;
    }
  }

  async estabelecimentos(): Promise<readonly string[]> {
    // Dado da rede inteira (sem filtro de estabelecimento): a sonda escolhe o hospital entre todos os do cliente.
    const linhas = await this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'sonda-estabelecimentos' }, (l) =>
      l.consultar<{ codigo: string }>(
        'SELECT codigo FROM estabelecimento WHERE ativo AND excluido_em IS NULL ORDER BY codigo',
        [],
      ),
    );
    return linhas.map((x) => String(x.codigo));
  }
}

export class PortaSondaMemoria implements PortaSonda {
  constructor(private readonly hospitais: readonly string[]) {}
  async bancoResponde(): Promise<boolean> {
    return true;
  }
  async estabelecimentos(): Promise<readonly string[]> {
    return [...this.hospitais];
  }
}

export const portaSondaIndisponivel: PortaSonda = {
  bancoResponde: async () => false,
  estabelecimentos: async () => [],
};

/** A porta da sonda pela regra do módulo: própria com núcleo e cliente; memória só em dev/ci; senão indisponível. */
export function portaDaSonda(ctx: ContextoModulo, hospitaisSinteticos: readonly string[] = []): PortaSonda {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaSondaPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaSondaMemoria(hospitaisSinteticos);
  return portaSondaIndisponivel;
}

/** Provedores da sonda para o `modulo.ts` da implantação. */
export function provedoresSonda(ctx: ContextoModulo, porta?: PortaSonda) {
  return [{ provide: PORTA_SONDA, useValue: porta ?? portaDaSonda(ctx) }];
}
