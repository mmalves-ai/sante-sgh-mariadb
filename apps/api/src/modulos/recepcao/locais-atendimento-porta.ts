// 02-REC linha 33 (C2-005): porta do cadastro dos locais de atendimento de cada recepção e dos encaminhamentos
// permitidos entre locais. Nada é apagado: o local sai de uso desativado (com motivo), e o destino retirado da lista
// fica marcado como excluído (regras em @sgh/dominio-recepcao, locais-atendimento.ts).
//   - `propria`: o banco do cliente (locais-atendimento-propria.ts), com a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras do domínio;
//   - sem nenhuma das duas, o controlador responde 503 (falha fechada).
import type {
  AlterarLocalAtendimento,
  DestinosEncaminhamento,
  IncluirLocalAtendimento,
  LocaisDaRecepcao,
  LocalDaEstrutura,
  SituacaoEstrutura,
} from '@sgh/contratos';
import { bloqueioDesativarLocal, recusasDoLocal, recusasDosDestinos } from '@sgh/dominio-recepcao';
import { type AutorEstrutura, exigirSemRecusa, naoEncontrado, versaoAntiga } from './estrutura-porta.js';
import type { PortaRecepcao } from './porta.js';
import type { ContextoRecepcao } from './tipos.js';

export const PORTA_LOCAIS_ATENDIMENTO = Symbol('PORTA_LOCAIS_ATENDIMENTO');

export interface PortaLocaisAtendimento {
  readonly destino: 'propria' | 'memoria';
  ler(c: ContextoRecepcao): Promise<LocaisDaRecepcao>;
  incluir(c: ContextoRecepcao, a: AutorEstrutura, ponto: number, l: IncluirLocalAtendimento): Promise<number>;
  alterar(c: ContextoRecepcao, a: AutorEstrutura, id: number, l: AlterarLocalAtendimento): Promise<void>;
  /** Troca a lista inteira de destinos do local; sobe a versão do local. */
  destinos(c: ContextoRecepcao, a: AutorEstrutura, id: number, d: DestinosEncaminhamento): Promise<void>;
  /** Desativa (com motivo) ou reativa; nunca apaga. */
  situacao(c: ContextoRecepcao, a: AutorEstrutura, id: number, s: SituacaoEstrutura): Promise<void>;
}

type LocalMem = { -readonly [K in keyof LocalDaEstrutura]: LocalDaEstrutura[K] };

/** Locais sintéticos em memória, semeados das recepções sintéticas da porta da recepção. */
export class LocaisAtendimentoMemoria implements PortaLocaisAtendimento {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, LocalMem[]>();
  private sequencia = 7000;

  constructor(private readonly recepcao: Pick<PortaRecepcao, 'recepcoes' | 'guichesEmUso'>) {}

  private async pontos(c: ContextoRecepcao) {
    return (await this.recepcao.recepcoes(c)).map((r) => ({
      id: r.id,
      codigo: `REC-${r.id}`,
      descricao: r.descricao,
      ativo: true,
    }));
  }

  private async locais(c: ContextoRecepcao): Promise<LocalMem[]> {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = (await this.recepcao.recepcoes(c)).flatMap((r) =>
        r.locais.map((l) => ({
          id: l.id,
          pontoId: r.id,
          codigo: `L${l.cod}`,
          descricao: l.descricao,
          permiteEncaminhamento: l.encaminha.length > 0,
          baseTempoEspera: false,
          reavaliacaoMedica: false,
          canalAudio: null,
          ativo: l.ativo,
          versao: 1,
          destinos: [...l.encaminha],
        })),
      );
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  async ler(c: ContextoRecepcao): Promise<LocaisDaRecepcao> {
    return { pontos: await this.pontos(c), locais: (await this.locais(c)).map((l) => ({ ...l })) };
  }

  private existentes(todos: readonly LocalMem[]) {
    return todos.map((x) => ({ id: x.id, codigo: x.codigo, descricao: x.descricao, ponto: x.pontoId }));
  }

  private async local(c: ContextoRecepcao, id: number): Promise<LocalMem> {
    const l = (await this.locais(c)).find((x) => x.id === id);
    if (!l) throw naoEncontrado('O local de atendimento');
    return l;
  }

  async incluir(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    ponto: number,
    l: IncluirLocalAtendimento,
  ): Promise<number> {
    const p = (await this.pontos(c)).find((x) => x.id === ponto);
    if (!p) throw naoEncontrado('A recepção');
    const todos = await this.locais(c);
    exigirSemRecusa(recusasDoLocal(l, p, this.existentes(todos)));
    const id = ++this.sequencia;
    todos.push({ id, pontoId: ponto, ...l, ativo: true, versao: 1, destinos: [] });
    return id;
  }

  async alterar(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    id: number,
    l: AlterarLocalAtendimento,
  ): Promise<void> {
    const atual = await this.local(c, id);
    if (atual.versao !== l.versao) throw versaoAntiga();
    const todos = await this.locais(c);
    exigirSemRecusa(recusasDoLocal(l, { id: atual.pontoId, ativo: true }, this.existentes(todos), id));
    if (!l.permiteEncaminhamento && atual.destinos.length > 0)
      exigirSemRecusa(recusasDosDestinos({ id, permiteEncaminhamento: false }, atual.destinos, todos));
    Object.assign(atual, {
      codigo: l.codigo,
      descricao: l.descricao,
      permiteEncaminhamento: l.permiteEncaminhamento,
      baseTempoEspera: l.baseTempoEspera,
      reavaliacaoMedica: l.reavaliacaoMedica,
      canalAudio: l.canalAudio,
      versao: atual.versao + 1,
    });
  }

  async destinos(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    id: number,
    d: DestinosEncaminhamento,
  ): Promise<void> {
    const atual = await this.local(c, id);
    if (atual.versao !== d.versao) throw versaoAntiga();
    exigirSemRecusa(recusasDosDestinos(atual, d.destinos, await this.locais(c), atual.destinos));
    atual.destinos = [...d.destinos];
    atual.versao += 1;
  }

  async situacao(c: ContextoRecepcao, _a: AutorEstrutura, id: number, s: SituacaoEstrutura): Promise<void> {
    const atual = await this.local(c, id);
    if (atual.versao !== s.versao) throw versaoAntiga();
    if (!s.ativo) {
      const abertos = (await this.recepcao.guichesEmUso(c)).filter((x) => x.local === id).length;
      exigirSemRecusa([bloqueioDesativarLocal({ guichesAbertos: abertos, senhasEmAberto: 0 })]);
    }
    atual.ativo = s.ativo;
    atual.versao += 1;
  }
}
