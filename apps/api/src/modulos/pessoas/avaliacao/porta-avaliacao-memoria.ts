// Porta da avaliação de desempenho em memória (W0-06, parte 5): a sessão sintética de dev/ci e o E2E. Os registros
// vivem por estabelecimento, numa cópia por transação (o erro no meio desfaz tudo). Nada vai à cópia do banco. As regras
// do banco que importam ao teste também valem aqui: nome único, versão otimista, a finalizada nunca muda (a correção é
// linha nova com ID_ANTERIOR), uma correção por versão, a exclusão física recontada com o mapa (com vínculo: 409) e o
// retrato guardado. Os vínculos em experiência saem da porta de pessoas (CLT, ativos); o cargo do vínculo e os cursos
// do PDI se ligam por `ligarCargo` e `ligarCurso` (simulam SGH_PES_VINCULO.ID_CARGO e SGH_PES_CURSO/turma). Na sessão
// sintética, `treinamento` liga a porta dos treinamentos em memória: o PDI lê o título do curso e a conclusão numa turma
// (aprovado ou sem avaliação), como o SELECT da gravação SGH_ (achado no E2E da parte 5d-3-3).
import {
  type AvaliacaoLida,
  type CicloAvaliacaoLido,
  type CompetenciaAvalLida,
  type CompetenciaCargoLida,
  type CorrecaoPesLida,
  ErroOperacao,
  type LinhaTrilha,
  type NotaAvaliacaoLida,
  type PdiLido,
  recusa,
  type VinculoExperienciaLido,
  type VinculoPessoasContado,
} from '@sgh/legado';
import type { PortaPessoas } from '../porta.js';
import type { PortaTreinamento } from '../treinamento/porta-treinamento.js';
import type {
  AlvoDependenciaAvaliacao,
  ContextoAvaliacao,
  GravadorAvaliacao,
  PortaAvaliacao,
} from './porta-avaliacao.js';

const desatualizado = (o = 'O registro') =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    `${o} mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.`,
  );

interface Item {
  avaliacao: number;
  competencia: number;
  nota: number | null;
  comentario: string | null;
}
interface Curso {
  readonly id: number;
  readonly titulo: string;
  /** Conclusão (aprovado ou sem avaliação) por vínculo. */
  readonly conclusoes: Readonly<Record<number, string>>;
}
type Avaliacao = Omit<AvaliacaoLida, 'substituida' | 'colaborador'>;
type Pdi = Omit<PdiLido, 'competenciaNome' | 'cursoTitulo' | 'cursoConcluidoEm'>;

interface Estado {
  seq: number;
  competencias: CompetenciaAvalLida[];
  ligacoes: { id: number; cargo: number; competencia: number }[];
  ciclos: CicloAvaliacaoLido[];
  avaliacoes: Avaliacao[];
  itens: Item[];
  pdi: Pdi[];
  correcoes: CorrecaoPesLida[];
  exclusoes: { tabela: string; id: number; linha: unknown; motivo: string; por: string }[];
}
const novo = (): Estado => ({
  seq: 8600,
  competencias: [],
  ligacoes: [],
  ciclos: [],
  avaliacoes: [],
  itens: [],
  pdi: [],
  correcoes: [],
  exclusoes: [],
});
const copiar = (s: Estado): Estado => structuredClone(s);

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

function contar(s: Estado, alvo: AlvoDependenciaAvaliacao, id: number): VinculoPessoasContado[] {
  const r: VinculoPessoasContado[] = [];
  const somar = (grupo: string, tabela: string, coluna: string, quantidade: number) => {
    if (quantidade > 0) r.push({ grupo, tabela, coluna, quantidade });
  };
  if (alvo === 'competencia') {
    somar(
      'Cargos com a competência',
      'SGH_PES_CARGO_COMPETENCIA',
      'ID_COMPETENCIA',
      s.ligacoes.filter((x) => x.competencia === id).length,
    );
    somar(
      'Notas de avaliação',
      'SGH_PES_AVAL_ITEM',
      'ID_COMPETENCIA',
      s.itens.filter((x) => x.competencia === id).length,
    );
    somar('Ações do PDI', 'SGH_PES_PDI', 'ID_COMPETENCIA', s.pdi.filter((x) => x.competencia === id).length);
  } else if (alvo === 'ciclo-avaliacao') {
    somar(
      'Avaliações do ciclo',
      'SGH_PES_AVALIACAO',
      'ID_CICLO',
      s.avaliacoes.filter((x) => x.ciclo === id).length,
    );
  } else {
    somar(
      'Versão posterior da avaliação',
      'SGH_PES_AVALIACAO',
      'ID_ANTERIOR',
      s.avaliacoes.filter((x) => x.anterior === id).length,
    );
    somar('Ações do PDI', 'SGH_PES_PDI', 'ID_AVALIACAO', s.pdi.filter((x) => x.avaliacao === id).length);
  }
  return r;
}

export class PortaAvaliacaoMemoria implements PortaAvaliacao {
  readonly destino = 'memoria' as const;
  /** Relógio fixo para os testes (AAAA-MM-DDTHH:MM); null: o relógio do processo. */
  agoraFixo: string | null = null;
  private readonly estados = new Map<string, Estado>();
  private readonly cargosDosVinculos = new Map<string, number>();
  private readonly cursos = new Map<string, Curso[]>();

  /** Os cursos e as conclusões do treinamento em memória (ligado no app.module da sessão sintética). */
  treinamento: Pick<PortaTreinamento, 'cursos' | 'conclusoes'> | null = null;

  constructor(private readonly pessoas: PortaPessoas | null = null) {}

  private e(c: ContextoAvaliacao): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = novo();
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  /** Simula o cargo do vínculo (SGH_PES_VINCULO.ID_CARGO). */
  ligarCargo(hospital: string, vinculo: number, cargo: number): void {
    this.cargosDosVinculos.set(`${hospital}:${vinculo}`, cargo);
  }

  /** Simula o curso do treinamento e as conclusões por vínculo (o PDI mostra a conclusão do curso). */
  ligarCurso(hospital: string, curso: Curso): void {
    this.cursos.set(hospital, [...(this.cursos.get(hospital) ?? []).filter((x) => x.id !== curso.id), curso]);
  }

  /** Os retratos guardados das exclusões físicas (D-CRUD-SNAP), para o teste. */
  exclusoes(hospital: string): Estado['exclusoes'] {
    return [...this.e({ rede: '', hospital }).exclusoes];
  }

  private agora(): string {
    return this.agoraFixo ?? local(new Date());
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<never> {
    throw new ErroOperacao(
      409,
      'recusa-de-negocio',
      'Operação recusada',
      'A avaliação de desempenho não usa o executor.',
    );
  }

  async gravarSgh<T>(
    c: ContextoAvaliacao,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorAvaliacao) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const id = () => ++s.seq;
    const agora = this.agora();
    const retratar = (tabela: string, i: number, linha: unknown, motivo: string, por: string) =>
      s.exclusoes.push({ tabela, id: i, linha: structuredClone(linha), motivo, por });
    const competencia = (i: number, versao: number) => {
      const x = s.competencias.find((k) => k.id === i);
      if (!x || x.versao !== versao) throw desatualizado('A competência');
      return x as { -readonly [K in keyof CompetenciaAvalLida]: CompetenciaAvalLida[K] };
    };
    const ciclo = (i: number, versao: number) => {
      const x = s.ciclos.find((k) => k.id === i);
      if (!x || x.versao !== versao) throw desatualizado('O ciclo');
      return x as { -readonly [K in keyof CicloAvaliacaoLido]: CicloAvaliacaoLido[K] };
    };
    type Mut<T> = { -readonly [K in keyof T]: T[K] };
    const avaliacao = (i: number, versao: number | null, situacoes: readonly string[]) => {
      const x = s.avaliacoes.find((k) => k.id === i);
      if (!x || (versao !== null && x.versao !== versao) || !situacoes.includes(x.situacao))
        throw desatualizado('A avaliação');
      return x as Mut<Avaliacao>;
    };
    const pdi = (i: number, versao: number) => {
      const x = s.pdi.find((k) => k.id === i);
      if (!x || x.versao !== versao) throw desatualizado('A ação do PDI');
      return x as Mut<Pdi>;
    };
    const nomeUnico = <X extends { id: number; nome: string }>(
      xs: readonly X[],
      nome: string,
      outro: number | null,
      codigo: string,
      msg: string,
    ) => {
      if (xs.some((x) => x.id !== outro && x.nome.toUpperCase() === nome.toUpperCase()))
        throw recusa(codigo, msg, { campos: ['nome'] });
    };
    const g: GravadorAvaliacao = {
      incluirCompetencia: async (x) => {
        nomeUnico(
          s.competencias,
          x.nome,
          null,
          'competencia-nome-em-uso',
          'Já existe uma competência com este nome neste estabelecimento.',
        );
        const n = id();
        s.competencias.push({
          id: n,
          nome: x.nome,
          descricao: x.descricao,
          ativo: true,
          motivoSituacao: null,
          versao: 0,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
        return n;
      },
      alterarCompetencia: async (x) => {
        const k = competencia(x.id, x.versao);
        nomeUnico(
          s.competencias,
          x.nome,
          x.id,
          'competencia-nome-em-uso',
          'Já existe uma competência com este nome neste estabelecimento.',
        );
        Object.assign(k, {
          nome: x.nome,
          descricao: x.descricao,
          versao: k.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
      },
      situacaoCompetencia: async (x) => {
        const k = competencia(x.id, x.versao);
        Object.assign(k, {
          ativo: x.ativo,
          motivoSituacao: x.motivo,
          versao: k.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
      },
      excluirCompetencia: async (x) => {
        const k = competencia(x.id, x.versao);
        if (contar(s, 'competencia', x.id).length > 0)
          throw recusa('competencia-com-vinculos', 'A competência está em uso: inative-a com o motivo.');
        retratar('SGH_PES_COMPETENCIA', x.id, k, x.motivo, x.por);
        s.competencias = s.competencias.filter((y) => y.id !== x.id);
      },
      ligarCompetenciaCargo: async (x) => {
        if (!s.competencias.some((k) => k.id === x.competencia && k.ativo))
          throw recusa(
            'competencia-inativa',
            'A competência está inativa ou não existe. Reative antes de ligar ao cargo.',
            { campos: ['competencia'] },
          );
        if (s.ligacoes.some((l) => l.cargo === x.cargo && l.competencia === x.competencia))
          throw recusa('competencia-ja-no-cargo', 'A competência já está no cargo.', {
            campos: ['competencia'],
          });
        const n = id();
        s.ligacoes.push({ id: n, cargo: x.cargo, competencia: x.competencia });
        return n;
      },
      desligarCompetenciaCargo: async (x) => {
        const l = s.ligacoes.find((y) => y.cargo === x.cargo && y.competencia === x.competencia);
        if (!l) throw desatualizado('A competência do cargo');
        retratar('SGH_PES_CARGO_COMPETENCIA', l.id, l, x.motivo, x.por);
        s.ligacoes = s.ligacoes.filter((y) => y !== l);
      },
      incluirCiclo: async (x) => {
        nomeUnico(
          s.ciclos,
          x.nome,
          null,
          'ciclo-nome-em-uso',
          'Já existe um ciclo de avaliação com este nome neste estabelecimento.',
        );
        const n = id();
        s.ciclos.push({
          id: n,
          nome: x.nome,
          tipo: x.tipo,
          inicio: x.inicio,
          fim: x.fim,
          prazo: x.prazo,
          notaMax: x.notaMax,
          situacao: 'aberto',
          motivoSituacao: null,
          versao: 0,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
        return n;
      },
      alterarCiclo: async (x) => {
        const k = ciclo(x.id, x.versao);
        if (k.situacao !== 'aberto') throw desatualizado('O ciclo');
        nomeUnico(
          s.ciclos,
          x.nome,
          x.id,
          'ciclo-nome-em-uso',
          'Já existe um ciclo de avaliação com este nome neste estabelecimento.',
        );
        const ids = new Set(s.avaliacoes.filter((a) => a.ciclo === x.id).map((a) => a.id));
        const acima = s.itens.filter((i) => ids.has(i.avaliacao) && (i.nota ?? 0) > x.notaMax).length;
        if (acima > 0)
          throw recusa(
            'escala-com-notas',
            `Há ${acima} nota(s) acima do novo máximo. Corrija as notas antes de reduzir a escala.`,
            { campos: ['notaMax'] },
          );
        Object.assign(k, {
          nome: x.nome,
          tipo: x.tipo,
          inicio: x.inicio,
          fim: x.fim,
          prazo: x.prazo,
          notaMax: x.notaMax,
          versao: k.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
      },
      situacaoCiclo: async (x) => {
        const k = ciclo(x.id, x.versao);
        if (k.situacao === x.situacao) throw desatualizado('O ciclo');
        Object.assign(k, {
          situacao: x.situacao,
          motivoSituacao: x.motivo,
          versao: k.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
      },
      excluirCiclo: async (x) => {
        const k = ciclo(x.id, x.versao);
        if (contar(s, 'ciclo-avaliacao', x.id).length > 0)
          throw recusa('ciclo-com-vinculos', 'O ciclo tem avaliações e não pode ser excluído.');
        retratar('SGH_PES_AVAL_CICLO', x.id, k, x.motivo, x.por);
        s.ciclos = s.ciclos.filter((y) => y.id !== x.id);
      },
      incluirAvaliacao: async (x) => {
        if (x.competencias.length === 0)
          throw recusa(
            'avaliacao-sem-competencias',
            'O cargo do colaborador não tem competências. Ligue as competências ao cargo antes de avaliar.',
          );
        if (!s.ciclos.some((k) => k.id === x.ciclo && k.situacao === 'aberto'))
          throw recusa('ciclo-fechado', 'O ciclo não está aberto: não recebe avaliação nova.');
        const n = id();
        s.avaliacoes.push({
          id: n,
          ciclo: x.ciclo,
          vinculo: x.vinculo,
          cargo: x.cargo,
          marco: x.marco,
          avaliador: x.avaliador,
          numero: 1,
          anterior: null,
          motivoCorrecao: null,
          situacao: 'rascunho',
          parecer: null,
          finalizadaPor: null,
          finalizadaEm: null,
          cienciaPor: null,
          cienciaEm: null,
          cienciaModo: null,
          cienciaObs: null,
          versao: 0,
          criadoPor: x.por,
          criadoEm: agora,
        });
        for (const k of x.competencias)
          s.itens.push({ avaliacao: n, competencia: k, nota: null, comentario: null });
        return n;
      },
      lancarNotas: async (x) => {
        const a = avaliacao(x.id, x.versao, ['rascunho']);
        Object.assign(a, { parecer: x.parecer, versao: a.versao + 1 });
        for (const y of x.notas) {
          const i = s.itens.find((k) => k.avaliacao === x.id && k.competencia === y.competencia);
          if (!i)
            throw recusa(
              'competencia-fora-da-avaliacao',
              'A competência informada não está nesta avaliação.',
              {
                campos: ['notas'],
              },
            );
          i.nota = y.nota;
          i.comentario = y.comentario;
        }
      },
      finalizarAvaliacao: async (x) => {
        const a = avaliacao(x.id, x.versao, ['rascunho']);
        const itens = s.itens.filter((i) => i.avaliacao === x.id);
        const vazias = itens.filter((i) => i.nota === null).length;
        if (itens.length === 0 || vazias > 0)
          throw recusa(
            'avaliacao-incompleta',
            `Faltam notas em ${vazias} competência(s). Lance todas as notas antes de finalizar.`,
            { campos: ['notas'] },
          );
        Object.assign(a, {
          situacao: 'finalizada',
          finalizadaPor: x.por,
          finalizadaEm: agora,
          versao: a.versao + 2,
        });
      },
      ciencia: async (x) => {
        const a = avaliacao(x.id, x.versao, ['finalizada']);
        if (s.avaliacoes.some((k) => k.anterior === x.id)) throw desatualizado('A avaliação');
        Object.assign(a, {
          situacao: 'ciente',
          cienciaPor: x.por,
          cienciaEm: agora,
          cienciaModo: x.modo,
          cienciaObs: x.observacao,
          versao: a.versao + 1,
        });
      },
      corrigirAvaliacao: async (x) => {
        const a = avaliacao(x.anterior, x.versao, ['finalizada', 'ciente']);
        if (s.avaliacoes.some((k) => k.anterior === x.anterior)) throw desatualizado('A avaliação');
        const n = id();
        s.avaliacoes.push({
          ...a,
          id: n,
          avaliador: x.avaliador,
          numero: a.numero + 1,
          anterior: a.id,
          motivoCorrecao: x.motivo,
          situacao: 'rascunho',
          finalizadaPor: null,
          finalizadaEm: null,
          cienciaPor: null,
          cienciaEm: null,
          cienciaModo: null,
          cienciaObs: null,
          versao: 0,
          criadoPor: x.por,
          criadoEm: agora,
        });
        for (const i of s.itens.filter((k) => k.avaliacao === a.id)) s.itens.push({ ...i, avaliacao: n });
        return n;
      },
      excluirAvaliacao: async (x) => {
        const a = avaliacao(x.id, x.versao, ['rascunho']);
        if (contar(s, 'avaliacao-rascunho', x.id).length > 0)
          throw recusa(
            'avaliacao-com-vinculos',
            'A avaliação tem registros ligados e não pode ser excluída.',
          );
        for (const i of s.itens.filter((k) => k.avaliacao === x.id))
          retratar('SGH_PES_AVAL_ITEM', x.id, i, x.motivo, x.por);
        retratar('SGH_PES_AVALIACAO', x.id, a, x.motivo, x.por);
        s.itens = s.itens.filter((k) => k.avaliacao !== x.id);
        s.avaliacoes = s.avaliacoes.filter((k) => k.id !== x.id);
      },
      incluirPdi: async (x) => {
        const n = id();
        s.pdi.push({
          id: n,
          vinculo: x.vinculo,
          avaliacao: x.avaliacao,
          competencia: x.competencia,
          curso: x.curso,
          acao: x.acao,
          prazo: x.prazo,
          situacao: 'aberta',
          concluidaEm: null,
          motivoSituacao: null,
          versao: 0,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
        return n;
      },
      alterarPdi: async (x) => {
        const p = pdi(x.id, x.versao);
        if (p.situacao !== 'aberta') throw desatualizado('A ação do PDI');
        Object.assign(p, {
          avaliacao: x.avaliacao,
          competencia: x.competencia,
          curso: x.curso,
          acao: x.acao,
          prazo: x.prazo,
          versao: p.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
      },
      situacaoPdi: async (x) => {
        const p = pdi(x.id, x.versao);
        if (p.situacao === x.situacao) throw desatualizado('A ação do PDI');
        Object.assign(p, {
          situacao: x.situacao,
          concluidaEm: x.situacao === 'concluida' ? x.concluidaEm : null,
          motivoSituacao: x.motivo,
          versao: p.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
      },
      registrarCorrecao: async (x) => {
        s.correcoes.unshift({
          id: id(),
          tabela: x.tabela,
          registro: x.registro,
          operacao: x.operacao,
          antes: JSON.parse(JSON.stringify(x.antes)) as Record<string, unknown>,
          depois: JSON.parse(JSON.stringify(x.depois)) as Record<string, unknown>,
          motivo: x.motivo,
          por: x.por,
          em: agora,
        });
      },
    };
    const r = await fn(g);
    this.estados.set(c.hospital, s);
    return r;
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────────

  async hoje(): Promise<string> {
    return this.agora().slice(0, 10);
  }
  async competencias(c: ContextoAvaliacao): Promise<CompetenciaAvalLida[]> {
    return structuredClone(this.e(c).competencias).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  async competencia(c: ContextoAvaliacao, id: number): Promise<CompetenciaAvalLida | null> {
    return structuredClone(this.e(c).competencias.find((x) => x.id === id) ?? null);
  }
  async competenciasDoCargo(c: ContextoAvaliacao, cargo: number | null): Promise<CompetenciaCargoLida[]> {
    const s = this.e(c);
    return s.ligacoes
      .filter((l) => cargo === null || l.cargo === cargo)
      .map((l) => {
        const k = s.competencias.find((x) => x.id === l.competencia);
        return {
          id: l.id,
          cargo: l.cargo,
          competencia: l.competencia,
          nome: k?.nome ?? '',
          ativa: k?.ativo ?? false,
        };
      })
      .sort((a, b) => a.cargo - b.cargo || a.nome.localeCompare(b.nome));
  }
  async ciclos(c: ContextoAvaliacao): Promise<CicloAvaliacaoLido[]> {
    return structuredClone(this.e(c).ciclos).sort((a, b) => b.inicio.localeCompare(a.inicio) || b.id - a.id);
  }
  async ciclo(c: ContextoAvaliacao, id: number): Promise<CicloAvaliacaoLido | null> {
    return structuredClone(this.e(c).ciclos.find((x) => x.id === id) ?? null);
  }
  private async lida(c: ContextoAvaliacao, a: Avaliacao): Promise<AvaliacaoLida> {
    const v = this.pessoas ? await this.pessoas.vinculo(c, a.vinculo) : null;
    return {
      ...structuredClone(a),
      colaborador: v?.nome ?? `Vínculo ${a.vinculo}`,
      substituida: this.e(c).avaliacoes.some((k) => k.anterior === a.id),
    };
  }
  async avaliacoes(
    c: ContextoAvaliacao,
    f: { readonly ciclo: number } | { readonly vinculo: number },
  ): Promise<AvaliacaoLida[]> {
    const xs = this.e(c).avaliacoes.filter((a) =>
      'ciclo' in f ? a.ciclo === f.ciclo : a.vinculo === f.vinculo,
    );
    return Promise.all(xs.sort((a, b) => b.id - a.id).map((a) => this.lida(c, a)));
  }
  async avaliacao(c: ContextoAvaliacao, id: number): Promise<AvaliacaoLida | null> {
    const a = this.e(c).avaliacoes.find((x) => x.id === id);
    return a ? this.lida(c, a) : null;
  }
  async notas(c: ContextoAvaliacao, avaliacao: number): Promise<NotaAvaliacaoLida[]> {
    const s = this.e(c);
    return s.itens
      .filter((i) => i.avaliacao === avaliacao)
      .map((i) => ({
        competencia: i.competencia,
        nome: s.competencias.find((k) => k.id === i.competencia)?.nome ?? '',
        nota: i.nota,
        comentario: i.comentario,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }
  async cargoDoVinculo(c: ContextoAvaliacao, vinculo: number): Promise<number | null> {
    const simulado = this.cargosDosVinculos.get(`${c.hospital}:${vinculo}`);
    if (simulado !== undefined) return simulado;
    // O cargo ligado na ficha do colaborador (a porta de pessoas em memória guarda o ID_CARGO do vínculo).
    return (await this.pessoas?.vinculo(c, vinculo))?.idCargo ?? null;
  }
  async vinculosEmExperiencia(c: ContextoAvaliacao, desde: string): Promise<VinculoExperienciaLido[]> {
    if (!this.pessoas) return [];
    const { itens } = await this.pessoas.listarVinculos(c, { estado: 'ativo', tipo: 'clt', limite: 2000 });
    return itens
      .filter((v) => v.hospital === c.hospital && v.admissao >= desde)
      .sort((a, b) => a.admissao.localeCompare(b.admissao) || a.nome.localeCompare(b.nome))
      .map((v) => ({
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        cargo: this.cargosDosVinculos.get(`${c.hospital}:${v.id}`) ?? v.idCargo ?? null,
        admissao: v.admissao,
        centroCusto: v.centroCusto,
        setor: v.setor,
      }));
  }
  /** Os cursos simulados (`ligarCurso`) e os do treinamento em memória, com a última conclusão por vínculo. */
  private async cursosDe(c: ContextoAvaliacao): Promise<Curso[]> {
    const simulados = this.cursos.get(c.hospital) ?? [];
    if (!this.treinamento) return simulados;
    const [cursos, conclusoes] = await Promise.all([
      this.treinamento.cursos(c),
      this.treinamento.conclusoes(c, null),
    ]);
    const doTreinamento = cursos
      .filter((k) => !simulados.some((x) => x.id === k.id))
      .map((k) => {
        const por: Record<number, string> = {};
        for (const x of conclusoes) {
          const dia = x.conclusao.slice(0, 10);
          if (x.curso === k.id && (por[x.vinculo] ?? '') < dia) por[x.vinculo] = dia;
        }
        return { id: k.id, titulo: k.titulo, conclusoes: por };
      });
    return [...simulados, ...doTreinamento];
  }
  private pdiLido(c: ContextoAvaliacao, p: Pdi, cursos: readonly Curso[]): PdiLido {
    const curso = cursos.find((k) => k.id === p.curso);
    return {
      ...structuredClone(p),
      competenciaNome: this.e(c).competencias.find((k) => k.id === p.competencia)?.nome ?? null,
      cursoTitulo: curso?.titulo ?? null,
      cursoConcluidoEm: curso?.conclusoes[p.vinculo] ?? null,
    };
  }
  async pdiDoColaborador(c: ContextoAvaliacao, vinculo: number): Promise<PdiLido[]> {
    const cursos = await this.cursosDe(c);
    return this.e(c)
      .pdi.filter((p) => p.vinculo === vinculo)
      .sort((a, b) => a.prazo.localeCompare(b.prazo) || a.id - b.id)
      .map((p) => this.pdiLido(c, p, cursos));
  }
  async pdi(c: ContextoAvaliacao, id: number): Promise<PdiLido | null> {
    const p = this.e(c).pdi.find((x) => x.id === id);
    return p ? this.pdiLido(c, p, await this.cursosDe(c)) : null;
  }
  async dependencias(
    c: ContextoAvaliacao,
    alvo: AlvoDependenciaAvaliacao,
    id: number,
  ): Promise<VinculoPessoasContado[]> {
    return contar(this.e(c), alvo, id);
  }
  async correcoes(
    c: ContextoAvaliacao,
    tabela: string,
    registros: readonly number[],
  ): Promise<CorrecaoPesLida[]> {
    return this.e(c).correcoes.filter((x) => x.tabela === tabela && registros.includes(x.registro));
  }
}
