// M58-F4, regra 9: o motor de ações em dois tempos, preservado (services/acoes.js da versão 0.23.0). A primeira
// chamada devolve a proposta com o efeito exato e NÃO altera nada; a segunda, em /acoes/confirmar, aplica. A
// proposta vale 15 minutos e uma vez só; a confirmação relê o estado e recusa (409) se ele mudou. Confirmações da
// mesma ação sobre os mesmos parâmetros entram numa fila (uma por vez); a ação refaz o compare-and-swap dentro da
// transação. Teto de 500 propostas vivas. Cada proposta fica presa ao escopo em que nasceu (rede:estabelecimento):
// consultada, confirmada ou contada por outro escopo, ela não existe (a configuração e a trava de escrita são
// por estabelecimento; achado da revisão do M58.4). Relógio e gerador de identificador injetáveis (testes).
import { randomBytes } from 'node:crypto';
import { CODIGOS_ERRO_FACHADA as E, LIMITES_FACHADA } from '@sgh/contratos';
import { erroFachada } from './erros.js';

/** O que a ação devolve ao preparar a proposta (sem escrever nada). */
export interface PropostaPreparada<P = unknown, S = unknown> {
  readonly params: P;
  readonly estadoAntes: S;
  readonly corpo: Readonly<Record<string, unknown>>;
  /** Aplica a escrita (só na confirmação; recebe o estado da proposta para o compare-and-swap). */
  readonly executar: (estadoNaProposta: S) => Promise<Readonly<Record<string, unknown>>>;
}

interface PropostaViva {
  readonly id: string;
  /** rede:estabelecimento em que a proposta nasceu ('' quando o chamador não separa escopo). */
  readonly escopo: string;
  readonly acao: string;
  readonly params: unknown;
  readonly estadoAntes: unknown;
  readonly executar: (estado: unknown) => Promise<Readonly<Record<string, unknown>>>;
  readonly lerEstado: () => Promise<unknown>;
  readonly expiraEm: number;
}

export interface OpcoesMotor {
  readonly agora?: () => number;
  readonly novoId?: () => string;
  readonly validadeMs?: number;
  readonly maxPropostas?: number;
}

/** Igualdade estrutural estável (a API original compara por JSON.stringify; aqui com as chaves ordenadas). */
export function mesmoEstado(a: unknown, b: unknown): boolean {
  return estavel(a) === estavel(b);
}
function estavel(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([p], [q]) => (p < q ? -1 : 1)))
      : x,
  );
}

export class MotorAcoesFachada {
  private readonly propostas = new Map<string, PropostaViva>();
  private readonly emAndamento = new Map<string, Promise<unknown>>();
  private readonly agora: () => number;
  private readonly novoId: () => string;
  readonly validadeMs: number;
  readonly maxPropostas: number;

  constructor(o: OpcoesMotor = {}) {
    this.agora = o.agora ?? (() => Date.now());
    this.novoId = o.novoId ?? (() => `prop_${randomBytes(9).toString('hex')}`);
    this.validadeMs = o.validadeMs ?? LIMITES_FACHADA.validadePropostaMs;
    this.maxPropostas = o.maxPropostas ?? LIMITES_FACHADA.maxPropostas;
  }

  private limpar(agora = this.agora()) {
    for (const [id, p] of this.propostas) if (p.expiraEm <= agora) this.propostas.delete(id);
  }

  /** A proposta viva deste escopo (a de outro escopo é tratada como inexistente). */
  private viva(propostaId: string, escopo: string): PropostaViva | undefined {
    const p = this.propostas.get(propostaId);
    return p && p.escopo === escopo ? p : undefined;
  }

  /** Quantas propostas estão vivas no escopo (diagnóstico de /acoes/status e do painel). */
  pendentes(escopo = ''): number {
    this.limpar();
    let n = 0;
    for (const p of this.propostas.values()) if (p.escopo === escopo) n++;
    return n;
  }

  /** A proposta é desta fachada e deste escopo (as de outra origem não casam: repasse). */
  conhece(propostaId: string, escopo = ''): boolean {
    this.limpar();
    return this.viva(propostaId, escopo) !== undefined;
  }

  /** Registra a proposta no escopo e devolve o corpo do primeiro tempo. */
  propor<P, S>(acao: string, p: PropostaPreparada<P, S>, lerEstado: () => Promise<S>, escopo = '') {
    const agora = this.agora();
    this.limpar(agora);
    if (this.propostas.size >= this.maxPropostas)
      throw erroFachada(
        429,
        'Há propostas demais aguardando confirmação. Confirme ou aguarde a expiração das existentes.',
        E.erroInterno,
      );
    const id = this.novoId();
    const expiraEm = agora + this.validadeMs;
    this.propostas.set(id, {
      id,
      escopo,
      acao,
      params: p.params,
      estadoAntes: p.estadoAntes,
      executar: p.executar as PropostaViva['executar'],
      lerEstado,
      expiraEm,
    });
    return {
      propostaId: id,
      acao,
      aplicada: false,
      expiraEm: new Date(expiraEm).toISOString(),
      validadeMinutos: Math.round(this.validadeMs / 60000),
      ...p.corpo,
      comoConfirmar: {
        metodo: 'POST',
        rota: '/acoes/confirmar',
        corpo: { propostaId: id },
        aviso: 'Nada foi alterado ainda. A alteração só acontece nesta segunda chamada.',
      },
    };
  }

  /** O segundo tempo: na fila da ação sobre os mesmos parâmetros, relê o estado e aplica. */
  async confirmar(propostaId: string, escopo = ''): Promise<Readonly<Record<string, unknown>>> {
    this.limpar();
    const p = this.viva(propostaId, escopo);
    if (!p) return this.aplicar(propostaId, escopo);
    const chave = `${escopo}:${p.acao}:${estavel(p.params)}`;
    const anterior = this.emAndamento.get(chave) ?? Promise.resolve();
    const minha = anterior.catch(() => undefined).then(() => this.aplicar(propostaId, escopo));
    const marca = minha.catch(() => undefined);
    this.emAndamento.set(chave, marca);
    try {
      return await minha;
    } finally {
      if (this.emAndamento.get(chave) === marca) this.emAndamento.delete(chave);
    }
  }

  private async aplicar(propostaId: string, escopo: string): Promise<Readonly<Record<string, unknown>>> {
    this.limpar();
    const p = this.viva(propostaId, escopo);
    if (!p)
      throw erroFachada(
        404,
        'Proposta não encontrada, já confirmada ou expirada (validade de 15 minutos). ' +
          'Refaça a proposta para ver o estado atual antes de decidir de novo.',
        E.propostaNaoEncontrada,
      );
    const estadoAgora = await p.lerEstado();
    if (!mesmoEstado(p.estadoAntes, estadoAgora)) {
      this.propostas.delete(propostaId);
      throw erroFachada(
        409,
        'O estado mudou depois que esta proposta foi gerada — outra pessoa ou processo alterou ' +
          'a mesma configuração. A proposta foi descartada sem executar. Refaça para ver o estado atual.',
        E.propostaDesatualizada,
        { estadoNaProposta: p.estadoAntes, estadoAgora },
      );
    }
    // Uso único: sai do mapa antes de executar (uma falha na escrita não deixa a proposta reutilizável).
    this.propostas.delete(propostaId);
    const resultado = await p.executar(p.estadoAntes);
    return {
      propostaId,
      acao: p.acao,
      aplicada: true,
      aplicadaEm: new Date(this.agora()).toISOString(),
      ...resultado,
    };
  }

  /** Só para os testes. */
  limparTudo() {
    this.propostas.clear();
  }
}
