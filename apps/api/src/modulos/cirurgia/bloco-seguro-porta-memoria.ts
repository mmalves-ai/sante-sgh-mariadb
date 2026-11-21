// Porta da cirurgia segura e do rastreio EM MEMÓRIA (M46, etapa 2): a sessão sintética de dev/ci (E2E) lê o agendamento
// da porta do centro cirúrgico em memória (M18) e grava o checklist, as confirmações, o rastreio e o código do painel
// SINTÉTICOS, com as mesmas recusas das gravações (o checklist aberto uma vez, a versão vista, a chave do pedido de outro
// registro, a sequência do rastreio relida, o código único no dia). Nada vai à cópia. Os domínios do bloco são os
// lidos na cópia pc (pré-operatório, sala de espera, sala cirúrgica, recuperação, outros; os cinco tipos de
// movimentação). Nenhum nome aqui é de pessoa real.
import type {
  AberturaChecklist,
  ChecklistDaCirurgia,
  CodigoDoPainel,
  ConfirmacaoChecklist,
  DominiosRastreio,
  MovimentoDoBloco,
  MovimentoNoBloco,
} from './tipos.js';
import { recusa } from '@sgh/nucleo';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { GravadorBlocoSeguro, PortaBlocoSeguro } from './bloco-seguro-porta.js';
import type { PortaCirurgia } from './porta.js';

export const DOMINIOS_RASTREIO_SINTETICOS: DominiosRastreio = {
  locais: [
    { id: 1, nome: 'PRE OPERATORIO', ativo: true },
    { id: 2, nome: 'SALA DE ESPERA', ativo: true },
    { id: 3, nome: 'SALA CIRURGICA', ativo: true },
    { id: 4, nome: 'RECUP. POS ANESTESICA', ativo: true },
    { id: 5, nome: 'OUTROS', ativo: true },
  ],
  tipos: [
    { id: 1, nome: 'ADMISSAO', ativo: true },
    { id: 2, nome: 'TRANSFERENCIA', ativo: true },
    { id: 3, nome: 'ALTA', ativo: true },
    { id: 4, nome: 'READMISSAO', ativo: true },
    { id: 5, nome: 'CANCELAMENTO DA ALTA', ativo: true },
  ],
};

type Mut<T> = { -readonly [K in keyof T]: T[K] };
interface Estado {
  checklists: (Mut<Omit<ChecklistDaCirurgia, 'confirmacoes'>> & {
    confirmacoes: (ChecklistDaCirurgia['confirmacoes'][number] & { chave: string | null })[];
  })[];
  movimentos: (MovimentoDoBloco & { chave: string | null })[];
  codigos: CodigoDoPainel[];
  seq: number;
}

export class PortaBlocoSeguroMemoria implements PortaBlocoSeguro {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(private readonly cirurgia: PortaCirurgia) {}

  private e(c: ContextoPortaM18): Estado {
    let s = this.porHospital.get(String(c.estabelecimento ?? 0));
    if (!s) {
      s = { checklists: [], movimentos: [], codigos: [], seq: 46_200 };
      this.porHospital.set(String(c.estabelecimento ?? 0), s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  executar(): never {
    throw new Error('O bloco seguro grava só no novo (sem receita do executor).');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorBlocoSeguro) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    // Transação em memória: a cópia do estado é a "transação"; a recusa no meio não deixa nada gravado. A marcação do
    // estado do M18 fica para depois do "commit" (a porta do centro cirúrgico em memória não tem transação).
    const copia: Estado = structuredClone(s);
    const depois: (() => Promise<void>)[] = [];
    const r = await fn(this.gravador(copia, c, depois));
    Object.assign(s, copia);
    for (const f of depois) await f();
    return r;
  }

  private gravador(s: Estado, c: ContextoPortaM18, depois: (() => Promise<void>)[]): GravadorBlocoSeguro {
    const prox = () => ++s.seq;
    const doChecklist = (id: number) => {
      const k = s.checklists.find((x) => x.id === id);
      if (!k) throw recusa('checklist-mudou', 'O checklist não existe.');
      return k;
    };
    const subir = (id: number, versaoVista: number, usuario: string) => {
      const k = doChecklist(id);
      if (k.versao !== versaoVista)
        throw recusa('checklist-mudou', 'O checklist mudou em outro aparelho: recarregue e confira.');
      k.versao += 1;
      void usuario;
      return k;
    };
    return {
      agendamentoNaTransacao: async (agendamento) => {
        const a = await this.cirurgia.agendamento(c, agendamento);
        const e = (await this.cirurgia.estadosDosAgendamentos(c, [agendamento])).get(agendamento);
        return { existe: a !== null && a !== undefined, estado: e?.estado ?? null };
      },
      checklist: async (agendamento) => {
        const k = s.checklists.find((x) => x.agendamento === agendamento);
        return k ? (structuredClone(k) as ChecklistDaCirurgia) : null;
      },
      confirmacaoPelaChave: async (chave, item) => {
        for (const k of s.checklists) {
          const ja = k.confirmacoes.find((y) => y.chave === `${chave}:${item}`);
          if (ja) return { id: ja.id, checklist: k.id };
        }
        return null;
      },
      movimentoPelaChave: async (chave) => {
        const ja = s.movimentos.find((x) => x.chave === chave);
        return ja ? { id: ja.id, agendamento: ja.agendamento, sequencia: ja.sequencia } : null;
      },
      abrirChecklist: async (a: Omit<AberturaChecklist, 'hospital'>) => {
        if (s.checklists.some((x) => x.agendamento === a.agendamento))
          throw recusa('checklist-mudou', 'O checklist foi aberto em outro aparelho: recarregue e confira.');
        const id = prox();
        s.checklists.push({
          id,
          agendamento: a.agendamento,
          sala: a.sala,
          dataHora: a.dataHora,
          reg: a.reg,
          paciente: a.paciente,
          cirurgia: null,
          registroProntuario: null,
          lista: a.lista,
          versao: 1,
          situacao: 'aberto',
          inducaoEm: null,
          inducaoPor: null,
          timeoutEm: null,
          timeoutPor: null,
          saidaEm: null,
          saidaPor: null,
          excecaoEm: null,
          excecaoPor: null,
          excecaoMotivo: null,
          confirmacoes: [],
        });
        return { id, versao: 1 };
      },
      confirmarItens: async (x: Omit<ConfirmacaoChecklist, 'hospital'>) => {
        const chave0 = x.chave ? `${x.chave}:${x.itens[0]?.item ?? ''}` : null;
        for (const k of s.checklists) {
          const ja = chave0 ? k.confirmacoes.find((y) => y.chave === chave0) : undefined;
          if (ja) {
            if (k.id !== x.checklist)
              throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outro checklist.');
            return { ids: [ja.id], versao: x.versaoVista, repetida: true };
          }
        }
        const k = subir(x.checklist, x.versaoVista, x.usuario);
        const ids = x.itens.map((i) => {
          const id = prox();
          k.confirmacoes.push({
            id,
            momento: x.momento,
            item: i.item,
            resposta: i.resposta,
            observacao: i.observacao,
            em: x.em.slice(0, 16),
            usuario: x.usuario,
            profissional: x.profissional,
            chave: x.chave ? `${x.chave}:${i.item}` : null,
          });
          return id;
        });
        return { ids, versao: k.versao, repetida: false };
      },
      concluirMomento: async (x) => {
        const k = subir(x.checklist, x.versaoVista, x.usuario);
        const em = x.em.slice(0, 16);
        if (x.momento === 'inducao') Object.assign(k, { inducaoEm: em, inducaoPor: x.usuario });
        if (x.momento === 'incisao') Object.assign(k, { timeoutEm: em, timeoutPor: x.usuario });
        if (x.momento === 'saida')
          Object.assign(k, { saidaEm: em, saidaPor: x.usuario, situacao: 'concluido' });
        return { versao: k.versao };
      },
      registrarExcecao: async (x) => {
        const k = subir(x.checklist, x.versaoVista, x.usuario);
        Object.assign(k, { excecaoEm: x.em.slice(0, 16), excecaoPor: x.usuario, excecaoMotivo: x.motivo });
        return { versao: k.versao };
      },
      movimentos: async (agendamento) =>
        structuredClone(s.movimentos.filter((m) => m.agendamento === agendamento)).sort(
          (a, b) => a.sequencia - b.sequencia,
        ),
      estadoDoAgendamento: async (agendamento) => {
        const e = (await this.cirurgia.estadosDosAgendamentos(c, [agendamento])).get(agendamento);
        return e && e.agendamento === agendamento ? { id: e.id, estado: e.estado } : null;
      },
      mover: async (m: Omit<MovimentoNoBloco, 'hospital'>) => {
        const ja = m.chave ? s.movimentos.find((x) => x.chave === m.chave) : undefined;
        if (ja) {
          if (ja.agendamento !== m.agendamento)
            throw recusa('chave-reutilizada', 'A chave do pedido já foi usada em outro paciente.');
          return { id: ja.id, sequencia: ja.sequencia, repetida: true, codigo: null };
        }
        const ultimo = Math.max(
          0,
          ...s.movimentos.filter((x) => x.agendamento === m.agendamento).map((x) => x.sequencia),
        );
        if (ultimo !== m.ultimoVisto)
          throw recusa('rastreio-mudou', 'O paciente foi movido em outro aparelho: recarregue e confira.');
        const id = prox();
        s.movimentos.push({
          id,
          agendamento: m.agendamento,
          sala: m.sala,
          dataHora: m.dataHora,
          reg: m.reg,
          paciente: m.paciente,
          sequencia: ultimo + 1,
          tipo: m.tipo,
          local: m.local,
          localAnterior: m.localAnterior,
          salaCirurgica: m.salaCirurgica,
          em: m.em.slice(0, 16),
          destino: m.destino,
          observacao: m.observacao,
          usuario: m.usuario,
          chave: m.chave,
        });
        let codigo: string | null = null;
        if (m.codigo) {
          const doDia = s.codigos.find((x) => x.agendamento === m.agendamento && x.dia === m.codigo!.dia);
          if (doDia) codigo = doDia.codigo;
          else {
            for (let t = 0; t < 8 && !codigo; t++) {
              const k = m.codigo.sortear();
              if (!s.codigos.some((x) => x.dia === m.codigo!.dia && x.codigo === k)) codigo = k;
            }
            if (!codigo) throw recusa('rastreio-mudou', 'Não foi possível sortear o código do painel.');
            s.codigos.push({
              agendamento: m.agendamento,
              dia: m.codigo.dia,
              codigo,
              validoAte: m.codigo.validoAte,
            });
          }
        }
        if (m.estadoAgendamento) {
          const alvo = m.estadoAgendamento;
          depois.push(() =>
            this.cirurgia.gravarSgh(c, null as never, (g) =>
              g.mudarEstado({ id: alvo.id, estado: alvo.estado, usuario: m.usuario }),
            ),
          );
        }
        return { id, sequencia: ultimo + 1, repetida: false, codigo };
      },
    };
  }

  async dominios(): Promise<DominiosRastreio> {
    return structuredClone(DOMINIOS_RASTREIO_SINTETICOS);
  }

  async checklist(c: ContextoPortaM18, agendamento: number) {
    const k = this.e(c).checklists.find((x) => x.agendamento === agendamento);
    return k ? (structuredClone(k) as ChecklistDaCirurgia) : null;
  }

  async checklists(c: ContextoPortaM18, agendamentos: readonly number[]) {
    const m = new Map<number, ChecklistDaCirurgia>();
    for (const k of this.e(c).checklists)
      if (agendamentos.includes(k.agendamento))
        m.set(k.agendamento, structuredClone(k) as ChecklistDaCirurgia);
    return m;
  }

  async movimentos(c: ContextoPortaM18, agendamento: number) {
    return structuredClone(this.e(c).movimentos.filter((m) => m.agendamento === agendamento)).sort(
      (a, b) => a.sequencia - b.sequencia,
    );
  }

  async movimentosDe(c: ContextoPortaM18, agendamentos: readonly number[]) {
    const m = new Map<number, MovimentoDoBloco[]>(agendamentos.map((a) => [a, []]));
    for (const x of [...this.e(c).movimentos].sort((a, b) => a.sequencia - b.sequencia))
      m.get(x.agendamento)?.push(structuredClone(x));
    return m;
  }

  async movidosDesde(c: ContextoPortaM18, desde: string) {
    return [
      ...new Set(
        this.e(c)
          .movimentos.filter((m) => m.em >= desde)
          .map((m) => m.agendamento),
      ),
    ];
  }

  async codigos(c: ContextoPortaM18, agora: string, agendamentos?: readonly number[]) {
    const m = new Map<number, CodigoDoPainel>();
    for (const x of this.e(c).codigos)
      if (x.validoAte >= agora && (!agendamentos || agendamentos.includes(x.agendamento)))
        m.set(x.agendamento, { ...x });
    return m;
  }
}
