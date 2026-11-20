// Porta da agenda de sessões em memória (M50, etapa 6): a sessão sintética de dev/ci (E2E e testes da API), com duas
// agendas e quatro recursos SINTÉTICOS (uma cadeira que aceita tudo, uma pediátrica de 0 a 17 anos, uma de alta
// complexidade e uma sala de fisioterapia de curta duração) e os pacientes do cadastro sintético. As mesmas recusas do
// adaptador (recurso e paciente ocupados, versão, situação), sem banco; a trilha é a do registrador da API.
import type {
  LinhaTrilha,
  OcupacaoLida,
  RecursoSessaoLido,
  SessaoSghLida,
  SituacaoSessaoSgh,
} from '@sgh/legado';
import { recusa } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoSessoes, GravadorSessoes, PacienteSessao, PortaSessoes } from './porta.js';

/** Os pacientes do cadastro sintético (pela porta do cadastro em memória), para o nome e a idade. */
export type LerPacientesSinteticos = (
  c: ContextoSessoes,
  ids: readonly number[],
) => Promise<
  readonly {
    id: number;
    prontuario: number;
    nome: string;
    nomeSocial: string | null;
    nascimento: string | null;
  }[]
>;

const RECURSOS: readonly RecursoSessaoLido[] = [
  {
    recurso: 7001,
    identificacao: 'CADEIRA 01',
    agenda: 701,
    nomeAgenda: 'TERAPIA INFUSIONAL SINTETICA',
    unidade: 2,
    tipo: 1,
    prioridade: 1,
    complexidade: 0,
    duracao: 0,
    faixaInicial: 0,
    faixaFinal: 99,
    ativo: true,
  },
  {
    recurso: 7002,
    identificacao: 'CADEIRA PEDIATRICA',
    agenda: 701,
    nomeAgenda: 'TERAPIA INFUSIONAL SINTETICA',
    unidade: 2,
    tipo: 1,
    prioridade: 2,
    complexidade: 0,
    duracao: 0,
    faixaInicial: 0,
    faixaFinal: 17,
    ativo: true,
  },
  {
    recurso: 7003,
    identificacao: 'CADEIRA 03 ALTA',
    agenda: 701,
    nomeAgenda: 'TERAPIA INFUSIONAL SINTETICA',
    unidade: 2,
    tipo: 1,
    prioridade: 3,
    complexidade: 3,
    duracao: 0,
    faixaInicial: 0,
    faixaFinal: 99,
    ativo: true,
  },
  {
    recurso: 7004,
    identificacao: 'SALA 2',
    agenda: 702,
    nomeAgenda: 'FISIOTERAPIA SINTETICA',
    unidade: 2,
    tipo: 1,
    prioridade: 1,
    complexidade: 1,
    duracao: 1,
    faixaInicial: 0,
    faixaFinal: 99,
    ativo: true,
  },
];

const COMPLEXIDADES = [
  { codigo: 0, nome: 'Todas' },
  { codigo: 1, nome: 'Baixa complexidade' },
  { codigo: 2, nome: 'Média complexidade' },
  { codigo: 3, nome: 'Alta complexidade' },
];
const DURACOES = [
  { codigo: 0, nome: 'Todas' },
  { codigo: 1, nome: 'Curta duração' },
  { codigo: 2, nome: 'Média duração' },
  { codigo: 3, nome: 'Longa duração' },
];

const sobrepoe = (a: { inicio: string; fim: string }, b: { inicio: string; fim: string }) =>
  a.inicio < b.fim && b.inicio < a.fim;
const doisDigitos = (n: number) => String(n).padStart(2, '0');

function agoraLocal(relogio: () => Date = () => new Date()): { agora: string; hoje: string } {
  // O relógio civil do estabelecimento (UTC-3, sem horário de verão), como o banco do legado.
  const d = new Date(relogio().getTime() - 3 * 3_600_000);
  const hoje = `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
  return { agora: `${hoje}T${doisDigitos(d.getUTCHours())}:${doisDigitos(d.getUTCMinutes())}`, hoje };
}

export class PortaSessoesMemoria implements PortaSessoes {
  readonly destino = 'memoria' as const;
  private readonly sessoes = new Map<string, SessaoSghLida[]>();
  private seq = 9000;
  private seqSerie = 900;

  constructor(
    private readonly lerPacientes: LerPacientesSinteticos | null = null,
    /** O relógio (os testes fixam o dia). */
    private readonly agoraDe: () => Date = () => new Date(),
  ) {}

  private doHospital(c: ContextoSessoes): SessaoSghLida[] {
    let s = this.sessoes.get(c.hospital);
    if (!s) {
      s = [];
      this.sessoes.set(c.hospital, s);
    }
    return s;
  }

  async podeGravar() {
    return { pode: false, codigo: 'sem-operacao', motivo: 'A agenda de sessões não grava no outro sistema.' };
  }

  executar(): Promise<never> {
    return Promise.reject(
      new ErroProblema(
        'operacao-bloqueada',
        409,
        'Sem gravação no outro sistema',
        'A agenda de sessões grava só no novo.',
      ),
    );
  }

  async gravarSgh<T>(
    c: ContextoSessoes,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorSessoes) => Promise<T>,
  ): Promise<T> {
    const lista = this.doHospital(c);
    // A transação da memória: o que a função mudou só fica se ela terminar sem erro.
    const copia = lista.map((x) => ({ ...x }));
    const { agora } = agoraLocal(this.agoraDe);
    const g: GravadorSessoes = {
      agendarSerie: async (s) => {
        if (s.sessoes.length === 0) throw recusa('serie-vazia', 'A série precisa de ao menos uma sessão.');
        const ativas = copia.filter((x) => x.situacao === 'agendada' || x.situacao === 'realizada');
        for (const x of s.sessoes) {
          if (ativas.some((o) => o.recurso === s.recurso && sobrepoe(x, o)))
            throw recusa(
              'recurso-ocupado',
              `A sessão ${x.ordem} acabou de ser ocupada nesta cadeira ou sala.`,
            );
          if (ativas.some((o) => o.paciente === s.paciente && sobrepoe(x, o)))
            throw recusa(
              'paciente-ocupado',
              `O paciente já tem outra sessão no horário da sessão ${x.ordem}.`,
            );
        }
        const serie = ++this.seqSerie;
        const ids: number[] = [];
        for (const x of s.sessoes) {
          const id = ++this.seq;
          ids.push(id);
          copia.push({
            id,
            serie,
            ordem: x.ordem,
            total: s.sessoes.length,
            agenda: s.agenda,
            recurso: s.recurso,
            complexidade: s.complexidade,
            duracao: s.duracao,
            paciente: s.paciente,
            prontuario: s.prontuario,
            planoTipo: s.planoTipo,
            plano: s.plano,
            inicio: x.inicio,
            fim: x.fim,
            situacao: 'agendada',
            observacao: s.observacao,
            motivo: null,
            por: s.usuario,
            em: agora,
            alteradoPor: null,
            alteradoEm: null,
            versao: 1,
          });
        }
        return { serie, ids };
      },
      atualizar: async (a) => {
        const i = copia.findIndex((x) => x.id === a.id);
        const x = copia[i];
        if (!x || x.versao !== a.versao || x.situacao !== 'agendada')
          throw recusa('versao-desatualizada', 'A sessão foi alterada por outra pessoa: atualize a grade.');
        copia[i] = {
          ...x,
          situacao: a.situacao,
          motivo: a.motivo,
          alteradoPor: a.usuario,
          alteradoEm: agora,
          versao: x.versao + 1,
        };
      },
      cancelarRestantes: async (a) => {
        await g.atualizar({
          id: a.id,
          situacao: 'cancelada',
          motivo: a.motivo,
          versao: a.versao,
          usuario: a.usuario,
        });
        let n = 1;
        for (const [i, x] of copia.entries())
          if (x.serie === a.serie && x.ordem > a.ordem && x.situacao === 'agendada') {
            copia[i] = {
              ...x,
              situacao: 'cancelada' as SituacaoSessaoSgh,
              motivo: a.motivo,
              alteradoPor: a.usuario,
              alteradoEm: agora,
              versao: x.versao + 1,
            };
            n++;
          }
        return n;
      },
      registrarEvento: async () => undefined,
    };
    const r = await fn(g);
    lista.splice(0, lista.length, ...copia);
    return r;
  }

  async relogio() {
    return agoraLocal(this.agoraDe);
  }

  async recursos() {
    return RECURSOS.map((r) => ({ ...r }));
  }

  async dominios() {
    return { complexidades: COMPLEXIDADES, duracoes: DURACOES };
  }

  async periodo(c: ContextoSessoes, de: string, ate: string, recursos: readonly number[] | null) {
    const s = this.doHospital(c)
      .filter((x) => x.inicio >= de && x.inicio < ate && (!recursos?.length || recursos.includes(x.recurso)))
      .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.recurso - b.recurso);
    return { sessoes: s.slice(0, 500), cortada: s.length > 500 };
  }

  async doPaciente(c: ContextoSessoes, paciente: number, desde: string) {
    const s = this.doHospital(c)
      .filter((x) => x.paciente === paciente && x.inicio >= desde)
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
    return { sessoes: s.slice(0, 100), cortada: s.length > 100 };
  }

  async sessao(c: ContextoSessoes, id: number) {
    return this.doHospital(c).find((x) => x.id === id) ?? null;
  }

  async serie(c: ContextoSessoes, serie: number) {
    return this.doHospital(c)
      .filter((x) => x.serie === serie)
      .sort((a, b) => a.ordem - b.ordem);
  }

  async ocupacoes(
    c: ContextoSessoes,
    alvo: { readonly recurso: number } | { readonly paciente: number },
    horarios: readonly { readonly inicio: string; readonly fim: string }[],
  ): Promise<OcupacaoLida[]> {
    const ativas = this.doHospital(c).filter(
      (x) =>
        ('recurso' in alvo ? x.recurso === alvo.recurso : x.paciente === alvo.paciente) &&
        (x.situacao === 'agendada' || x.situacao === 'realizada'),
    );
    const vistas = new Map<number, OcupacaoLida>();
    for (const h of horarios) {
      const x = ativas.find((o) => o.inicio < h.fim && o.fim > h.inicio);
      if (x) vistas.set(x.id, { id: x.id, serie: x.serie, inicio: x.inicio, fim: x.fim });
    }
    return [...vistas.values()];
  }

  async paciente(c: ContextoSessoes, id: number): Promise<PacienteSessao | null> {
    const [p] = this.lerPacientes ? await this.lerPacientes(c, [id]) : [];
    return p
      ? {
          id: p.id,
          prontuario: p.prontuario || null,
          nome: p.nomeSocial ?? p.nome,
          nascimento: p.nascimento,
          ativo: true,
        }
      : null;
  }

  async nomes(c: ContextoSessoes, ids: readonly number[]) {
    const m = new Map<number, string>();
    if (!this.lerPacientes || ids.length === 0) return m;
    for (const p of await this.lerPacientes(c, [...new Set(ids)])) m.set(p.id, p.nomeSocial ?? p.nome);
    return m;
  }
}
