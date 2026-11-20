// Porta dos treinamentos em memória (M52.6): a sessão sintética de dev/ci e o E2E. Os registros vivem por
// estabelecimento, numa cópia por transação (o erro no meio desfaz tudo). Nada vai à cópia do banco. As regras de banco
// que importam ao teste também valem aqui: código de curso único, a versão na condição, a inscrição uma vez por turma,
// a versão do POP única por código, a troca de situação só da vigente, a ciência uma vez por versão e vínculo.
import {
  type CienciaPopPesLida,
  type CorrecaoPesLida,
  type ConclusaoPesLida,
  type CursoPesLido,
  ErroOperacao,
  type LinhaTrilha,
  type ParticipacaoPesLida,
  type ParticipantePesLido,
  type PopPesLido,
  type TurmaPesLida,
  type VinculoAtivoTreinamento,
  type VinculoResumoTreinamento,
} from '@sgh/legado';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import type { ContextoTreinamento, GravadorTreinamento, PortaTreinamento } from './porta-treinamento.js';

const recusa = (codigo: string, mensagem: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', mensagem);
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

type TurmaBase = Omit<TurmaPesLida, 'participantes' | 'concluintes'>;
interface Estado {
  seq: number;
  cursos: CursoPesLido[];
  turmas: TurmaBase[];
  participantes: ParticipantePesLido[];
  pops: PopPesLido[];
  ciencias: CienciaPopPesLida[];
  /** W0-06: a trilha do valor anterior e os retratos das inscrições retiradas. */
  correcoes: CorrecaoPesLida[];
  retratos: Record<string, unknown>[];
}
const novo = (): Estado => ({
  seq: 5260,
  cursos: [],
  turmas: [],
  participantes: [],
  pops: [],
  ciencias: [],
  correcoes: [],
  retratos: [],
});
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  cursos: s.cursos.map((x) => ({ ...x })),
  turmas: s.turmas.map((x) => ({ ...x })),
  participantes: s.participantes.map((x) => ({ ...x })),
  pops: s.pops.map((x) => ({ ...x })),
  ciencias: [...s.ciencias],
  correcoes: [...s.correcoes],
  retratos: [...s.retratos],
});

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const conclui = (p: ParticipantePesLido) =>
  p.presenca === 'presente' &&
  p.conclusao !== null &&
  (p.aproveitamento === 'aprovado' || p.aproveitamento === 'sem-avaliacao');

export class PortaTreinamentoMemoria implements PortaTreinamento {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético. */
  agoraFixo: string | null = null;

  /** A gestão de pessoas em memória, para o painel ler os vínculos ativos. */
  constructor(private readonly pessoas: PortaPessoas | null = null) {}

  private e(c: ContextoTreinamento): Estado {
    let s = this.estados.get(c.hospital);
    if (!s) this.estados.set(c.hospital, (s = novo()));
    return s;
  }

  private turmaCompleta(s: Estado, t: TurmaBase): TurmaPesLida {
    const ps = s.participantes.filter((p) => p.treinamento === t.id);
    return { ...t, participantes: ps.length, concluintes: ps.filter(conclui).length };
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw new ErroOperacao(
      409,
      'operacao-desconhecida',
      'Operação recusada',
      'Os treinamentos não usam o executor.',
    );
  }

  async gravarSgh<T>(
    c: ContextoTreinamento,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorTreinamento) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const id = () => ++s.seq;
    const { agora } = await this.relogio();
    const g: GravadorTreinamento = {
      curso: async (i) => s.cursos.find((x) => x.id === i) ?? null,
      turma: async (i) => {
        const t = s.turmas.find((x) => x.id === i);
        return t ? this.turmaCompleta(s, t) : null;
      },
      participantes: async (t) => s.participantes.filter((p) => p.treinamento === t),
      pop: async (i) => s.pops.find((x) => x.id === i) ?? null,
      versoesPop: async (codigo) =>
        s.pops.filter((x) => x.codigo === codigo).sort((a, b) => b.versao - a.versao),
      ciencias: async (f) =>
        s.ciencias.filter(
          (x) => (f.vinculo === undefined || x.vinculo === f.vinculo) && (!f.pops || f.pops.includes(x.pop)),
        ),
      incluirCurso: async (x) => {
        if (s.cursos.some((k) => k.codigo === x.codigo))
          throw recusa('codigo-repetido', 'Já existe um curso com este código.');
        const n = id();
        s.cursos.push({
          id: n,
          codigo: x.codigo,
          titulo: x.titulo,
          conteudo: x.conteudo,
          categoria: x.categoria,
          cargaMinimaMin: x.cargaMinimaMin,
          validadeMeses: x.validadeMeses,
          obrigatorio: x.obrigatorio,
          ativo: true,
          alvos: [...x.alvos],
          versao: 0,
        });
        return n;
      },
      alterarCurso: async (x) => {
        const k = s.cursos.find((y) => y.id === x.id);
        if (!k || k.versao !== x.versao) throw desatualizado();
        if (s.cursos.some((y) => y.id !== x.id && y.codigo === x.codigo))
          throw recusa('codigo-repetido', 'Já existe um curso com este código.');
        Object.assign(k, {
          codigo: x.codigo,
          titulo: x.titulo,
          conteudo: x.conteudo,
          categoria: x.categoria,
          cargaMinimaMin: x.cargaMinimaMin,
          validadeMeses: x.validadeMeses,
          obrigatorio: x.obrigatorio,
          alvos: [...x.alvos],
          ativo: x.ativo,
          versao: k.versao + 1,
        });
      },
      incluirTurma: async (x) => {
        const n = id();
        s.turmas.push({
          id: n,
          curso: x.curso,
          inicio: x.inicio,
          fim: x.fim,
          cargaMin: x.cargaMin,
          instrutor: x.instrutor,
          modalidade: x.modalidade,
          local: x.local,
          pop: x.pop,
          observacao: x.observacao,
          situacao: 'aberta',
          motivo: null,
          versao: 0,
        });
        return n;
      },
      situacaoTurma: async (x) => {
        const t = s.turmas.find((y) => y.id === x.id);
        if (!t || t.versao !== x.versao || t.situacao !== 'aberta') throw desatualizado();
        Object.assign(t, { situacao: x.situacao, motivo: x.motivo, versao: t.versao + 1 });
      },
      incluirParticipante: async (x) => {
        if (s.participantes.some((p) => p.treinamento === x.treinamento && p.vinculo === x.vinculo))
          throw recusa('ja-inscrito', 'O colaborador já está inscrito nesta turma.');
        const n = id();
        s.participantes.push({
          id: n,
          treinamento: x.treinamento,
          vinculo: x.vinculo,
          presenca: 'inscrito',
          aproveitamento: null,
          conclusao: null,
          validoAte: null,
          observacao: null,
          versao: 0,
        });
        return n;
      },
      registrarParticipacao: async (x) => {
        const p = s.participantes.find((y) => y.id === x.id);
        if (!p || p.versao !== x.versao) throw desatualizado();
        Object.assign(p, {
          presenca: x.presenca,
          aproveitamento: x.aproveitamento,
          conclusao: x.conclusao,
          validoAte: x.validoAte,
          observacao: x.observacao,
          versao: p.versao + 1,
        });
      },
      incluirPop: async (x) => {
        if (s.pops.some((p) => p.codigo === x.codigo && p.versao === x.versao))
          throw recusa('versao-repetida', 'Outra pessoa publicou esta versão do POP agora: abra de novo.');
        const n = id();
        s.pops.push({
          id: n,
          codigo: x.codigo,
          versao: x.versao,
          titulo: x.titulo,
          unidade: x.unidade,
          vigencia: x.vigencia,
          resumo: x.resumo,
          referencia: x.referencia,
          alteracoes: x.alteracoes,
          situacao: 'vigente',
          motivo: null,
          publicadoPor: x.por,
          publicadoEm: agora,
        });
        return n;
      },
      situacaoPop: async (x) => {
        const p = s.pops.find((y) => y.id === x.id);
        if (!p || p.situacao !== 'vigente') throw desatualizado();
        Object.assign(p, { situacao: x.situacao, motivo: x.motivo });
      },
      incluirCiencia: async (x) => {
        if (s.ciencias.some((y) => y.pop === x.pop && y.vinculo === x.vinculo))
          throw recusa('ja-ciente', 'A ciência nesta versão do POP já foi registrada.');
        const n = id();
        s.ciencias.push({
          id: n,
          pop: x.pop,
          vinculo: x.vinculo,
          origem: x.treinamento === null ? 'proprio' : 'treinamento',
          treinamento: x.treinamento,
          registradoPor: x.por,
          registradoEm: agora,
        });
        return n;
      },
      alterarTurma: async (x) => {
        const t = s.turmas.find((y) => y.id === x.id);
        if (!t || t.versao !== x.versao || t.situacao !== 'aberta') throw desatualizado();
        Object.assign(t, {
          inicio: x.inicio,
          fim: x.fim,
          cargaMin: x.cargaMin,
          instrutor: x.instrutor,
          modalidade: x.modalidade,
          local: x.local,
          pop: x.pop,
          observacao: x.observacao,
          versao: t.versao + 1,
        });
      },
      retirarInscricao: async (x) => {
        const i = s.participantes.findIndex((y) => y.id === x.id);
        const p = s.participantes[i];
        if (!p || p.versao !== x.versao) throw desatualizado();
        const ciencia = s.ciencias.some((y) => y.treinamento === p.treinamento && y.vinculo === p.vinculo);
        if (p.presenca !== 'inscrito' || p.aproveitamento !== null || ciencia) return false;
        s.retratos.push({ ...p, motivo: x.motivo, por: x.por });
        s.participantes.splice(i, 1);
        return true;
      },
      registrarCorrecao: async (x) => {
        s.correcoes.push({
          id: id(),
          tabela: x.tabela,
          registro: x.registro,
          operacao: x.operacao,
          antes: x.antes,
          depois: x.depois,
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

  /** W0-06, testes: os retratos das inscrições retiradas (o que iria à SGH_HIST_EXCLUSAO). */
  retratos(c: ContextoTreinamento): readonly Record<string, unknown>[] {
    return this.e(c).retratos;
  }
  async correcoes(c: ContextoTreinamento, tabela: string, registros: readonly number[]) {
    return this.e(c)
      .correcoes.filter((x) => x.tabela === tabela && registros.includes(x.registro))
      .sort((a, b) => b.id - a.id);
  }

  async relogio(): Promise<{ hoje: string; agora: string }> {
    const agora = this.agoraFixo ?? local(new Date());
    return { hoje: agora.slice(0, 10), agora };
  }
  async cursos(c: ContextoTreinamento) {
    return [...this.e(c).cursos].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }
  async curso(c: ContextoTreinamento, id: number) {
    return this.e(c).cursos.find((x) => x.id === id) ?? null;
  }
  async turmas(c: ContextoTreinamento, f: { situacao?: string; curso?: number; de?: string; ate?: string }) {
    const s = this.e(c);
    return s.turmas
      .filter(
        (t) =>
          (!f.situacao || t.situacao === f.situacao) &&
          (!f.curso || t.curso === f.curso) &&
          (!f.de || t.inicio >= f.de) &&
          (!f.ate || t.inicio <= f.ate),
      )
      .sort((a, b) => b.inicio.localeCompare(a.inicio) || b.id - a.id)
      .map((t) => this.turmaCompleta(s, t));
  }
  async turma(c: ContextoTreinamento, id: number) {
    const s = this.e(c);
    const t = s.turmas.find((x) => x.id === id);
    return t ? this.turmaCompleta(s, t) : null;
  }
  async participantes(c: ContextoTreinamento, turma: number) {
    return this.e(c).participantes.filter((p) => p.treinamento === turma);
  }
  async participacoes(c: ContextoTreinamento, vinculo: number): Promise<ParticipacaoPesLida[]> {
    const s = this.e(c);
    return s.participantes
      .filter((p) => p.vinculo === vinculo)
      .map((p) => {
        const t = s.turmas.find((x) => x.id === p.treinamento)!;
        return {
          ...p,
          curso: t.curso,
          inicio: t.inicio,
          fim: t.fim,
          cargaMin: t.cargaMin,
          instrutor: t.instrutor,
          turmaSituacao: t.situacao,
        };
      })
      .sort((a, b) => b.inicio.localeCompare(a.inicio));
  }
  async conclusoes(c: ContextoTreinamento, vinculos: readonly number[] | null): Promise<ConclusaoPesLida[]> {
    const s = this.e(c);
    return s.participantes
      .filter((p) => conclui(p) && (vinculos === null || vinculos.includes(p.vinculo)))
      .flatMap((p) => {
        const t = s.turmas.find((x) => x.id === p.treinamento);
        return t && t.situacao !== 'cancelada'
          ? [{ vinculo: p.vinculo, curso: t.curso, conclusao: p.conclusao!, validoAte: p.validoAte }]
          : [];
      });
  }
  async pops(c: ContextoTreinamento, f: { vigentes?: boolean; codigo?: string }) {
    return this.e(c)
      .pops.filter((p) => (!f.vigentes || p.situacao === 'vigente') && (!f.codigo || p.codigo === f.codigo))
      .sort((a, b) => a.codigo.localeCompare(b.codigo) || b.versao - a.versao);
  }
  async pop(c: ContextoTreinamento, id: number) {
    return this.e(c).pops.find((p) => p.id === id) ?? null;
  }
  async ciencias(c: ContextoTreinamento, f: { vinculo?: number; pops?: readonly number[] }) {
    return this.e(c).ciencias.filter(
      (x) => (f.vinculo === undefined || x.vinculo === f.vinculo) && (!f.pops || f.pops.includes(x.pop)),
    );
  }
  async ativos(c: ContextoTreinamento, unidade: number | null): Promise<VinculoAtivoTreinamento[]> {
    if (!this.pessoas) return [];
    const r: VinculoAtivoTreinamento[] = [];
    let depois: number | undefined;
    for (;;) {
      const p = await this.pessoas.listarVinculos(c, {
        estado: 'ativo',
        limite: 200,
        ...(unidade !== null ? { unidade } : {}),
        ...(depois !== undefined ? { depois } : {}),
      });
      for (const v of p.itens)
        r.push({
          id: v.id,
          nome: v.nome,
          matricula: v.matricula,
          cargo: v.cargo,
          funcao: v.funcao,
          unidade: v.unidade,
          admissao: v.admissao,
        });
      if (p.depois === null) break;
      depois = p.depois;
    }
    return r.sort((a, b) => a.nome.localeCompare(b.nome) || a.id - b.id);
  }
  async vinculos(c: ContextoTreinamento, ids: readonly number[]): Promise<VinculoResumoTreinamento[]> {
    if (!this.pessoas) return [];
    const r: VinculoResumoTreinamento[] = [];
    for (const id of new Set(ids)) {
      const v = await this.pessoas.vinculo(c, id);
      if (v && v.hospital === c.hospital)
        r.push({
          id: v.id,
          nome: v.nome,
          matricula: v.matricula,
          cargo: v.cargo,
          funcao: v.funcao,
          unidade: v.unidade,
          admissao: v.admissao,
          desligamento: v.desligamento,
        });
    }
    return r;
  }
}
