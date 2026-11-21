// Porta da etapa 2 do portal EM MEMÓRIA (M50): a sessão sintética de dev/ci (E2E) e os testes da API. As mesmas recusas
// do banco (versão desatualizada, o conferido que não muda, a marcação já paga, a confirmação repetida que não paga duas
// vezes, a segunda resposta da pesquisa) e o mesmo caixa do portal (um pagamento por confirmação). Nada vai à cópia.
import { ErroPortal, type RegistroTrilhaPortal } from '../tipos.js';
import {
  type ConciliacaoPortal,
  type ConfigAgendaOnline,
  conferirConciliacaoPortal,
  MINUTOS_RESERVA_CONFERENCIA,
  OPERADOR_CAIXA_PORTAL,
  type PagamentoPortal,
  type PagamentoTesourariaPortal,
  type PesquisaPortal,
  type PreCheckinOnline,
} from './tipos.js';
import type {
  ContextoAgendaOnline,
  GravadorAgendaOnline,
  PortaAgendaOnline,
  TrilhaAgendaOnline,
} from './porta.js';

/** O pré-check-in guardado, com o instante da reserva da conferência (a leitura confere se ainda vale). */
type PreGuardado = PreCheckinOnline & { reservadoEm?: number };

interface Estado {
  configs: ConfigAgendaOnline[];
  precheckins: PreGuardado[];
  pagamentos: PagamentoPortal[];
  pesquisas: (PesquisaPortal & { paciente: number; conta: number })[];
  /** Os pagamentos gravados no caixa do portal (M30), um por confirmação aprovada. */
  caixa: { id: number; transacao: string; valor: number; forma: string }[];
  /** W0-10: os atos da tesouraria (só inclusão). */
  conciliacoes: ConciliacaoPortal[];
  seq: number;
}

/** O pagamento com quem o cobrou (o caixa do portal) e os atos da tesouraria. */
function tesourariaDe(s: Estado, id: number): PagamentoTesourariaPortal | null {
  const p = s.pagamentos.find((k) => k.id === id);
  if (!p) return null;
  return structuredClone({
    pagamento: p,
    cobradoPor: p.pagamentoCaixa ? OPERADOR_CAIXA_PORTAL : null,
    atos: s.conciliacoes.filter((a) => a.pagamento === id),
  });
}

const versaoVelha = () =>
  new ErroPortal('versao-desatualizada', 'O registro foi alterado por outra pessoa; recarregue.');
const carimbo = (d: Date) => d.toISOString().slice(0, 23);

export class PortaAgendaOnlineMemoria implements PortaAgendaOnline {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** As linhas de trilha das gravações (para os testes). */
  readonly trilhas: RegistroTrilhaPortal[] = [];

  constructor(
    private readonly agora: () => Date = () => new Date(),
    /** Configurações de partida da sessão sintética (as agendas sintéticas liberadas no portal). */
    private readonly semente: (hospital: string) => ConfigAgendaOnline[] = () => [],
  ) {}

  private e(c: ContextoAgendaOnline): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = {
        configs: this.semente(c.hospital),
        precheckins: [],
        pagamentos: [],
        pesquisas: [],
        caixa: [],
        conciliacoes: [],
        seq: 700,
      };
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  /** Para os testes: os pagamentos gravados no caixa do portal. */
  caixaDoPortal(hospital: string): readonly { id: number; transacao: string; valor: number }[] {
    return this.estados.get(hospital)?.caixa ?? [];
  }

  async gravar<T>(
    c: ContextoAgendaOnline,
    fn: (g: GravadorAgendaOnline) => Promise<T>,
    trilha: TrilhaAgendaOnline<T>,
  ): Promise<T> {
    // Transação: o estado é copiado e só volta se a função terminar sem erro.
    const copia = structuredClone(this.e(c));
    const r = await fn(this.gravador(copia));
    const linha = typeof trilha === 'function' ? trilha(r) : trilha;
    if (linha) this.trilhas.push(linha);
    this.estados.set(c.hospital, copia);
    return r;
  }

  /** A reserva da conferência ainda vale? */
  private reservaVale(k: PreGuardado): boolean {
    return (
      k.situacao === 'enviado' &&
      k.reservadoPor !== null &&
      (k.reservadoEm ?? 0) >= this.agora().getTime() - MINUTOS_RESERVA_CONFERENCIA * 60_000
    );
  }

  private visto(k: PreGuardado): PreCheckinOnline {
    const x: PreGuardado = structuredClone(k);
    delete x.reservadoEm;
    return { ...x, reservadoPor: this.reservaVale(k) ? k.reservadoPor : null };
  }

  private gravador(s: Estado): GravadorAgendaOnline {
    const agora = () => this.agora();
    const reservaVale = (k: PreGuardado) => this.reservaVale(k);
    return {
      async gravarConfig(x) {
        const i = s.configs.findIndex((k) => k.tipo === x.tipo && k.agenda === x.agenda);
        const base: ConfigAgendaOnline = {
          id: i >= 0 ? (s.configs[i] as ConfigAgendaOnline).id : ++s.seq,
          tipo: x.tipo,
          agenda: x.agenda,
          nomeAgenda: x.nomeAgenda,
          crm: x.crm,
          ativa: x.ativa,
          convenios: [...new Set(x.convenios)].sort((a, b) => a - b),
          servicos: [...new Set(x.servicos)].sort((a, b) => a - b),
          antecedenciaHoras: x.antecedenciaHoras,
          horizonteDias: x.horizonteDias,
          cancelaAteHoras: x.cancelaAteHoras,
          precheckin: x.precheckin,
          valorParticular: x.valorParticular,
          teleconsulta: x.teleconsulta === true,
          alteradoPor: x.por,
          alteradoEm: carimbo(agora()),
          versao: 1,
        };
        if (x.versao === null) {
          if (i >= 0) throw versaoVelha();
          s.configs.push(base);
          return { id: base.id, versao: 1 };
        }
        const atual = s.configs[i];
        if (!atual || atual.versao !== x.versao) throw versaoVelha();
        s.configs[i] = { ...base, versao: atual.versao + 1 };
        return { id: base.id, versao: atual.versao + 1 };
      },
      async enviarPreCheckin(p) {
        const i = s.precheckins.findIndex((k) => k.tipo === p.tipo && k.marcacao === p.marcacao);
        const atual = s.precheckins[i];
        if (atual?.situacao === 'conferido')
          throw new ErroPortal('situacao', 'O pré-check-in desta marcação já foi conferido pela recepção.');
        if (atual && reservaVale(atual))
          throw new ErroPortal(
            'situacao',
            'A recepção está conferindo o seu pré-check-in agora: aguarde alguns minutos para mudar.',
          );
        const novo: PreGuardado = {
          id: atual?.id ?? ++s.seq,
          tipo: p.tipo,
          marcacao: p.marcacao,
          nomeAgenda: p.nomeAgenda,
          crm: p.crm,
          data: p.data,
          hora: p.hora,
          paciente: p.paciente,
          conta: p.conta,
          dados: structuredClone(p.dados),
          documentos: p.documentos.map((d) => ({ ...d })),
          carteirinha: p.carteirinha,
          carteirinhaValidade: p.carteirinhaValidade,
          termos: p.termos,
          situacao: 'enviado',
          motivoRecusa: null,
          enviadoEm: carimbo(agora()),
          conferidoPor: null,
          conferidoEm: null,
          reservadoPor: null,
          camposGravados: [],
          versao: (atual?.versao ?? 0) + 1,
        };
        if (atual) s.precheckins[i] = novo;
        else s.precheckins.push(novo);
        return { id: novo.id, versao: novo.versao };
      },
      async decidirPreCheckin(id, versao, d) {
        const i = s.precheckins.findIndex((k) => k.id === id);
        const atual = s.precheckins[i];
        if (!atual || atual.versao !== versao || atual.situacao !== 'enviado') throw versaoVelha();
        if (reservaVale(atual) && atual.reservadoPor !== d.por) throw versaoVelha();
        s.precheckins[i] = {
          ...atual,
          reservadoPor: null,
          reservadoEm: 0,
          situacao: d.conferido ? 'conferido' : 'recusado',
          motivoRecusa: d.conferido ? null : d.motivo,
          camposGravados: d.conferido ? [...d.campos] : [],
          conferidoPor: d.por,
          conferidoEm: carimbo(agora()),
          versao: atual.versao + 1,
        };
      },
      async reservarConferencia(id, versao, por) {
        const i = s.precheckins.findIndex((k) => k.id === id);
        const atual = s.precheckins[i];
        if (!atual || atual.versao !== versao || atual.situacao !== 'enviado' || reservaVale(atual))
          throw versaoVelha();
        s.precheckins[i] = {
          ...atual,
          reservadoPor: por,
          reservadoEm: agora().getTime(),
          versao: atual.versao + 1,
        };
        return { versao: atual.versao + 1 };
      },
      async liberarConferencia(id, versao) {
        const i = s.precheckins.findIndex((k) => k.id === id);
        const atual = s.precheckins[i];
        if (!atual || atual.versao !== versao || atual.situacao !== 'enviado') return;
        s.precheckins[i] = { ...atual, reservadoPor: null, reservadoEm: 0, versao: atual.versao + 1 };
      },
      async cancelarPreCheckin(tipo, marcacao) {
        let n = 0;
        s.precheckins = s.precheckins.map((k) => {
          if (k.tipo !== tipo || k.marcacao !== marcacao || !['enviado', 'recusado'].includes(k.situacao))
            return k;
          n++;
          return { ...k, situacao: 'cancelado', versao: k.versao + 1 };
        });
        return n;
      },
      async iniciarPagamento(p) {
        const t = agora().getTime();
        for (const x of s.pagamentos.filter((k) => k.tipo === p.tipo && k.marcacao === p.marcacao)) {
          if (x.situacao !== 'pendente' && x.situacao !== 'confirmado') continue;
          if (x.situacao === 'confirmado') throw new ErroPortal('situacao', 'Esta marcação já está paga.');
          if (x.situacao === 'pendente' && new Date(x.expiraEm).getTime() > t)
            throw new ErroPortal('situacao', 'Já existe um pagamento em andamento para esta marcação.');
          if (x.situacao === 'pendente') Object.assign(x, { situacao: 'expirado', versao: x.versao + 1 });
        }
        if (s.pagamentos.some((k) => k.transacao === p.transacao))
          throw new ErroPortal('situacao', 'Transação do gateway repetida.');
        const id = ++s.seq;
        s.pagamentos.push({
          id,
          conta: p.conta,
          paciente: p.paciente,
          tipo: p.tipo,
          marcacao: p.marcacao,
          valor: p.valor,
          forma: p.forma,
          conector: p.conector,
          transacao: p.transacao,
          situacao: 'pendente',
          expiraEm: p.expiraEm,
          pagamentoCaixa: null,
          criadoEm: carimbo(agora()),
          confirmadoEm: null,
          confirmadoPor: null,
          pixCopiaECola: p.pixCopiaECola,
          enderecoCartao: p.enderecoCartao,
          versao: 1,
        });
        return { id };
      },
      async confirmarPagamento(x) {
        const i = s.pagamentos.findIndex((k) => k.transacao === x.transacao);
        const atual = s.pagamentos[i];
        if (!atual) throw new ErroPortal('nao-encontrado', 'Pagamento não encontrado.');
        const tardia = atual.situacao === 'expirado' && x.resultado === 'aprovado';
        if (atual.situacao !== 'pendente' && !tardia) return { mudou: false, pagamento: atual };
        let novo: PagamentoPortal;
        if (x.resultado === 'aprovado') {
          const daMarcacao = (k: PagamentoPortal) =>
            k.id !== atual.id && k.tipo === atual.tipo && k.marcacao === atual.marcacao;
          const paga = s.pagamentos.some((k) => daMarcacao(k) && k.situacao === 'confirmado');
          if (!paga && tardia)
            for (const k of s.pagamentos)
              if (daMarcacao(k) && k.situacao === 'pendente')
                Object.assign(k, { situacao: 'expirado', versao: k.versao + 1 });
          const fat = ++s.seq;
          s.caixa.push({ id: fat, transacao: x.transacao, valor: atual.valor, forma: atual.forma });
          novo = {
            ...atual,
            situacao: paga ? 'duplicado' : 'confirmado',
            pagamentoCaixa: fat,
            confirmadoEm: carimbo(agora()),
            confirmadoPor: x.por,
            versao: atual.versao + 1,
          };
        } else
          novo = {
            ...atual,
            situacao: x.resultado === 'recusado' ? 'recusado' : 'expirado',
            confirmadoPor: x.por,
            versao: atual.versao + 1,
          };
        s.pagamentos[i] = novo;
        return { mudou: true, pagamento: novo };
      },
      async registrarConciliacao(n) {
        const t = tesourariaDe(s, n.pagamento);
        if (!t) throw new ErroPortal('nao-encontrado', 'Pagamento não encontrado.');
        const r = conferirConciliacaoPortal(t, n);
        if (r) throw new ErroPortal('situacao', r.mensagem);
        const ato: ConciliacaoPortal = {
          id: ++s.seq,
          pagamento: n.pagamento,
          acao: n.acao,
          valor: n.valor,
          referencia: n.referencia?.trim() || null,
          motivo: n.motivo?.trim() || null,
          usuario: n.usuario.slice(0, 31),
          em: carimbo(agora()),
        };
        s.conciliacoes.push(ato);
        return structuredClone(ato);
      },
      async responderPesquisa(r) {
        if (s.pesquisas.some((k) => k.tipo === r.tipo && k.marcacao === r.marcacao))
          throw new ErroPortal('situacao', 'A pesquisa deste atendimento já foi respondida.');
        const id = ++s.seq;
        s.pesquisas.unshift({
          id,
          tipo: r.tipo,
          marcacao: r.marcacao,
          nomeAgenda: r.nomeAgenda,
          dataAtendimento: r.dataAtendimento,
          nota: r.nota,
          comentario: r.comentario,
          respondidaEm: carimbo(agora()),
          paciente: r.paciente,
          conta: r.conta,
        });
        return { id };
      },
    };
  }

  async configs(c: ContextoAgendaOnline) {
    return structuredClone(this.e(c).configs);
  }
  async config(c: ContextoAgendaOnline, tipo: 'consulta' | 'exame', agenda: number) {
    const x = this.e(c).configs.find((k) => k.tipo === tipo && k.agenda === agenda);
    return x ? structuredClone(x) : null;
  }
  async preCheckinDaMarcacao(c: ContextoAgendaOnline, tipo: 'consulta' | 'exame', marcacao: number) {
    const x = this.e(c).precheckins.find((k) => k.tipo === tipo && k.marcacao === marcacao);
    return x ? this.visto(x) : null;
  }
  async preCheckinPorId(c: ContextoAgendaOnline, id: number) {
    const x = this.e(c).precheckins.find((k) => k.id === id);
    return x ? this.visto(x) : null;
  }
  async preCheckinsDoPaciente(c: ContextoAgendaOnline, paciente: number) {
    return this.e(c)
      .precheckins.filter((k) => k.paciente === paciente)
      .slice(-100)
      .reverse()
      .map((k) => this.visto(k));
  }
  async filaPreCheckin(
    c: ContextoAgendaOnline,
    f: {
      situacao: string;
      de: string;
      ate: string;
      depoisDe?: number | null;
      pacientes?: readonly number[] | null;
    },
  ) {
    const todos = this.e(c)
      .precheckins.filter(
        (k) =>
          k.situacao === f.situacao &&
          k.data >= f.de &&
          k.data <= f.ate &&
          k.id > (f.depoisDe ?? 0) &&
          (!f.pacientes || f.pacientes.includes(k.paciente)),
      )
      .sort((a, b) => a.id - b.id);
    return { itens: todos.slice(0, 50).map((k) => this.visto(k)), haMais: todos.length > 50 };
  }
  async pagamentoPorTransacao(c: ContextoAgendaOnline, transacao: string) {
    const x = this.e(c).pagamentos.find((k) => k.transacao === transacao);
    return x ? structuredClone(x) : null;
  }
  async pagamentoPorId(c: ContextoAgendaOnline, id: number) {
    const x = this.e(c).pagamentos.find((k) => k.id === id);
    return x ? structuredClone(x) : null;
  }
  async pagamentosDoPaciente(c: ContextoAgendaOnline, paciente: number) {
    return structuredClone(
      this.e(c)
        .pagamentos.filter((k) => k.paciente === paciente)
        .sort((a, b) => b.id - a.id)
        .slice(0, 100),
    );
  }
  async tesouraria(c: ContextoAgendaOnline, de: string, ate: string) {
    const s = this.e(c);
    return s.pagamentos
      .filter(
        (k) =>
          (k.situacao === 'confirmado' || k.situacao === 'duplicado') &&
          (k.confirmadoEm ?? '').slice(0, 10) >= de &&
          (k.confirmadoEm ?? '').slice(0, 10) <= ate,
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, 500)
      .map((k) => tesourariaDe(s, k.id) as PagamentoTesourariaPortal);
  }
  async pagamentoTesouraria(c: ContextoAgendaOnline, id: number) {
    return tesourariaDe(this.e(c), id);
  }
  async pesquisasDoPaciente(c: ContextoAgendaOnline, paciente: number) {
    return structuredClone(
      this.e(c)
        .pesquisas.filter((k) => k.paciente === paciente)
        .slice(0, 100),
    );
  }
}

/**
 * A semente da sessão sintética (D-SEMENTE-50): a agenda sintética 902 (cardiologia, particular e uma operadora) já
 * liberada no portal, com o pré-check-in e o valor do particular; as outras ficam para a tela de configuração.
 */
export function sementeAgendaOnline(): ConfigAgendaOnline[] {
  return [
    {
      id: 1,
      tipo: 'consulta',
      agenda: 902,
      nomeAgenda: 'CARDIOLOGIA - DRA SINTETICO B',
      crm: 0,
      ativa: true,
      convenios: [],
      servicos: [],
      antecedenciaHoras: 2,
      horizonteDias: 21,
      cancelaAteHoras: 2,
      precheckin: true,
      valorParticular: 150,
      // M50, etapa 4 (D-SEMENTE-50.4): a agenda sintética também oferece a teleconsulta.
      teleconsulta: true,
      alteradoPor: 'COORDENACAO.SINTETICO',
      alteradoEm: null,
      versao: 1,
    },
  ];
}
