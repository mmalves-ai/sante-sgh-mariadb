// Porta do SESMT em memória (M52.5): a sessão sintética de dev/ci e o E2E. Os domínios são os rótulos dos domínios do
// eSocial (públicos), com poucas linhas; os registros vivem por estabelecimento, numa cópia por transação (o erro no meio
// desfaz tudo). Nada vai à cópia do banco. As regras de banco que importam ao teste também valem aqui: só inclusão no
// ocupacional e nas vacinas, versão no acidente, o marco da sorologia uma vez, a assinatura só da entrega pendente.
import { conferirLeituraRepetida } from '@sgh/dominio-pessoas';
import { ErroOperacao, type LinhaTrilha, recusa } from '@sgh/nucleo';
import type { GravacaoFeita } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import {
  type AcidenteTrabalho,
  type ContextoSesmt,
  type CorrecaoSesmt,
  DADOS_CAT_VAZIOS,
  type DominiosSesmt,
  type DoseVacinaColaborador,
  type GravadorSesmt,
  type LinhaRiscoFuncao,
  type PortaSesmt,
  type RegistroOcupacional,
  type RegistroProtecao,
  type TipoProtecao,
  type ResumoSesmt,
  type SorologiaAcidente,
  type VinculoAtivoSesmt,
} from './porta-sesmt.js';

/** A memória separa os registros pelo código do estabelecimento da sessão (ou pelo id, sem ele). */
const hospitalDe = (c: ContextoSesmt): string =>
  (c as ContextoSesmt & { readonly hospital?: string }).hospital ?? String(c.estabelecimento ?? '');

const desatualizado = () =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

interface Estado {
  seq: number;
  ocupacional: RegistroOcupacional[];
  vacinas: DoseVacinaColaborador[];
  acidentes: AcidenteTrabalho[];
  sorologias: SorologiaAcidente[];
  riscos: (LinhaRiscoFuncao & { hospital: string })[];
  epis: RegistroProtecao[];
  correcoes: CorrecaoSesmt[];
}
const novo = (): Estado => ({
  seq: 5200,
  ocupacional: [],
  vacinas: [],
  acidentes: [],
  sorologias: [],
  riscos: [],
  epis: [],
  correcoes: [],
});
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  ocupacional: [...s.ocupacional],
  vacinas: [...s.vacinas],
  acidentes: s.acidentes.map((a) => ({ ...a })),
  sorologias: s.sorologias.map((x) => ({ ...x })),
  riscos: s.riscos.map((r) => ({ ...r })),
  epis: s.epis.map((x) => ({ ...x })),
  correcoes: [...s.correcoes],
});

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

/** Domínios do eSocial (rótulos públicos; poucas linhas de cada) para a sessão sintética. */
export const DOMINIOS_SESMT_SINTETICOS: DominiosSesmt = {
  tiposAso: [
    { codigo: 0, rotulo: 'Admissional' },
    { codigo: 1, rotulo: 'Periódico, conforme planejamento do PCMSO' },
    { codigo: 2, rotulo: 'De retorno ao trabalho' },
    { codigo: 3, rotulo: 'De mudança de função' },
    { codigo: 4, rotulo: 'De monitoração pontual' },
    { codigo: 8, rotulo: 'Demissional' },
  ],
  conclusoesAso: [
    { codigo: 1, rotulo: 'Apto' },
    { codigo: 2, rotulo: 'Inapto' },
  ],
  tiposCat: [
    { codigo: 1, rotulo: 'Inicial' },
    { codigo: 2, rotulo: 'Reabertura' },
    { codigo: 3, rotulo: 'Comunicação de Óbito' },
  ],
  iniciativasCat: [
    { codigo: 1, rotulo: 'Iniciativa do Registrador' },
    { codigo: 2, rotulo: 'Ordem judicial' },
    { codigo: 3, rotulo: 'Determinação de órgão fiscalizador' },
  ],
  partesCorpo: [
    { codigo: 753030000, rotulo: 'Mão (exceto punho ou dedos)' },
    { codigo: 753050000, rotulo: 'Dedo' },
  ],
  naturezas: [
    { codigo: 702005000, rotulo: 'Escoriação, abrasão (ferimento superficial)' },
    { codigo: 702010000, rotulo: 'Corte, laceração, ferida contusa, punctura (ferida aberta)' },
  ],
  agentes: [{ codigo: 302010000, rotulo: 'Agulha, seringa, perfurocortante' }],
  situacoes: [{ codigo: 200004300, rotulo: 'Impacto de pessoa contra objeto parado' }],
  gruposRisco: [
    { codigo: 'F', rotulo: 'Físico' },
    { codigo: 'Q', rotulo: 'Químico' },
    { codigo: 'B', rotulo: 'Biológico' },
    { codigo: 'E', rotulo: 'Ergonômicos' },
    { codigo: 'M', rotulo: 'Mecânico/Acidentes' },
  ],
  eficaciasEpc: [
    { codigo: 0, rotulo: 'Não informado' },
    { codigo: 1, rotulo: 'Não utilizado' },
    { codigo: 2, rotulo: 'Eficaz' },
    { codigo: 3, rotulo: 'Não Eficaz' },
  ],
  vacinasCadastro: [
    { codigo: 4, rotulo: 'Anti-sarampo' },
    { codigo: 6, rotulo: 'Dupla adulto' },
    { codigo: 7, rotulo: 'Outras' },
    { codigo: 8, rotulo: 'Hepatite B' },
  ],
  dosesVacinaCadastro: [
    { codigo: 1, rotulo: '1ª dose' },
    { codigo: 2, rotulo: '2ª dose' },
    { codigo: 3, rotulo: '3ª dose' },
  ],
};

const FATORES_SINTETICOS: readonly { codigo: string; rotulo: string }[] = [
  { codigo: '01.01.001', rotulo: 'Ruído contínuo ou intermitente' },
  { codigo: '02.01.001', rotulo: 'Antineoplásicos (quimioterápicos)' },
  { codigo: '03.01.001', rotulo: 'Agentes biológicos infecciosos e infectocontagiosos' },
  { codigo: '01.02.001', rotulo: 'Radiações ionizantes' },
];

export class PortaSesmtMemoria implements PortaSesmt {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** Testes: o relógio sintético. */
  agoraFixo: string | null = null;
  /** Testes (D-VAC-525): os códigos do domínio de vacinas e de doses que cada inclusão gravaria. */
  readonly codigosVacinaGravados: { vacina: string; codigo: number | null; dose: number | null }[] = [];

  /** A gestão de pessoas em memória, para o painel ler os vínculos ativos. */
  constructor(private readonly pessoas: PortaPessoas | null = null) {}

  private e(c: ContextoSesmt): Estado {
    let s = this.estados.get(hospitalDe(c));
    if (!s) this.estados.set(hospitalDe(c), (s = novo()));
    return s;
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }
  async executar(): Promise<GravacaoFeita> {
    throw new ErroOperacao(409, 'operacao-desconhecida', 'Operação recusada', 'O SESMT não usa o executor.');
  }

  async gravarSgh<T>(
    c: ContextoSesmt,
    _trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorSesmt) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const id = () => ++s.seq;
    const agora = await this.relogio();
    const g: GravadorSesmt = {
      ocupacional: async (v) => s.ocupacional.filter((x) => x.vinculo === v),
      vacinas: async (v) => s.vacinas.filter((x) => x.vinculo === v),
      acidente: async (i) => s.acidentes.find((a) => a.id === i) ?? null,
      sorologias: async (a) => s.sorologias.filter((x) => x.acidente === a),
      registroEpi: async (i, tipo = 'epi') => s.epis.find((x) => x.id === i && x.tipo === tipo) ?? null,
      incluirAso: async (a) => {
        const n = id();
        s.ocupacional.push({
          id: n,
          vinculo: a.vinculo,
          registro: 'aso',
          aso: null,
          tipo: a.tipo,
          data: a.data,
          exame: null,
          resultadoExame: null,
          conclusao: a.conclusao,
          restricoes: a.restricoes,
          medico: a.medico,
          medicoConselho: a.medicoConselho,
          proximo: a.proximo,
          observacao: a.observacao,
          retifica: a.retifica,
          motivoRetificacao: a.motivoRetificacao,
          criadoPor: a.por,
          criadoEm: agora.agora,
        });
        return n;
      },
      incluirExame: async (x) => {
        const n = id();
        s.ocupacional.push({
          id: n,
          vinculo: x.vinculo,
          registro: 'exame',
          aso: x.aso,
          tipo: null,
          data: x.data,
          exame: x.exame,
          resultadoExame: x.resultado,
          conclusao: null,
          restricoes: null,
          medico: null,
          medicoConselho: null,
          proximo: null,
          observacao: null,
          retifica: null,
          motivoRetificacao: null,
          criadoPor: x.por,
          criadoEm: agora.agora,
        });
        return n;
      },
      incluirVacina: async (v) => {
        const n = id();
        this.codigosVacinaGravados.push({
          vacina: v.vacina,
          codigo: v.codigoVacina,
          dose: v.codigoDose,
        });
        s.vacinas.push({
          id: n,
          vinculo: v.vinculo,
          registro: v.registro,
          vacina: v.vacina,
          dose: v.dose,
          data: v.data,
          lote: v.lote,
          validadeLote: v.validadeLote,
          antiHbs: v.antiHbs,
          observacao: v.observacao,
          retifica: v.retifica,
          motivoRetificacao: v.motivoRetificacao,
          criadoPor: v.por,
        });
        return n;
      },
      incluirAcidente: async (a) => {
        const n = id();
        s.acidentes.push({
          id: n,
          vinculo: a.vinculo,
          ocorridoEm: a.ocorridoEm,
          tipo: a.tipo,
          unidade: a.unidade,
          local: a.local,
          descricao: a.descricao,
          biologico: a.biologico,
          perfurocortante: a.perfurocortante,
          exposicao: a.exposicao,
          material: a.material,
          fonte: a.fonte,
          fonteTeste: a.fonteTeste,
          parteCorpo: a.parteCorpo,
          natureza: a.natureza,
          agente: a.agente,
          situacao: a.situacao,
          afastamento: a.afastamento,
          obito: a.obito,
          profilaxia: a.profilaxia,
          profilaxiaEm: a.profilaxiaEm,
          profilaxiaObs: a.profilaxiaObs,
          catPrazo: a.catPrazo,
          tipoCat: null,
          iniciativaCat: null,
          catNumero: null,
          catEmitidaEm: null,
          catEmitidaPor: null,
          estado: 'aberto',
          encerradoEm: null,
          encerradoPor: null,
          motivoEncerramento: null,
          versao: 0,
          criadoPor: a.por,
          cat: DADOS_CAT_VAZIOS,
          anuladoEm: null,
          anuladoPor: null,
        });
        return n;
      },
      incluirSorologia: async (x) => {
        if (s.sorologias.some((y) => y.acidente === x.acidente && y.marco === x.marco)) throw desatualizado();
        const n = id();
        s.sorologias.push({ id: n, ...x, realizada: null, resultado: null, observacao: null });
        return n;
      },
      atualizarProfilaxia: async (x) => {
        const a = s.acidentes.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao || a.estado !== 'aberto') throw desatualizado();
        Object.assign(a, {
          profilaxia: x.profilaxia,
          profilaxiaEm: x.profilaxiaEm,
          profilaxiaObs: x.observacao,
          versao: a.versao + 1,
        });
      },
      registrarSorologia: async (x) => {
        const y = s.sorologias.find(
          (z) => z.acidente === x.acidente && z.marco === x.marco && z.resultado === null,
        );
        if (!y) throw desatualizado();
        Object.assign(y, { realizada: x.realizada, resultado: x.resultado, observacao: x.observacao });
        return y.id;
      },
      emitirCat: async (x) => {
        const a = s.acidentes.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao) throw desatualizado();
        Object.assign(a, {
          tipoCat: x.tipoCat,
          iniciativaCat: x.iniciativa,
          catNumero: x.numero,
          catEmitidaEm: x.emitidaEm,
          catEmitidaPor: x.por,
          versao: a.versao + 1,
        });
      },
      encerrarAcidente: async (x) => {
        const a = s.acidentes.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao || a.estado !== 'aberto') throw desatualizado();
        Object.assign(a, {
          estado: 'encerrado',
          encerradoEm: agora.agora,
          encerradoPor: x.por,
          motivoEncerramento: x.motivo,
          versao: a.versao + 1,
        });
      },
      incluirLinhaRisco: async (x) => {
        const n = id();
        s.riscos.push({
          id: n,
          hospital: hospitalDe(c),
          unidade: x.unidade,
          setor: x.setor,
          funcao: x.funcao,
          funcaoChave: x.funcaoChave,
          tipo: x.tipo,
          fatorRisco: x.fatorRisco,
          grupoRisco: x.grupoRisco,
          epc: x.epc,
          epi: x.epi,
          descricao: x.descricao,
          inicio: x.inicio,
          fim: null,
          motivoFim: null,
        });
        return n;
      },
      encerrarLinhaRisco: async (x) => {
        const r = s.riscos.find((y) => y.id === x.id && y.fim === null);
        if (!r) throw desatualizado();
        Object.assign(r, { fim: x.fim, motivoFim: x.motivo });
      },
      incluirRegistroEpi: async (x) => {
        // A mesma garantia da chave única do banco (leitura ativa por vínculo, dosímetro e início do período).
        if (x.tipo === 'dosimetria') {
          const r = conferirLeituraRepetida(
            s.epis
              .filter((y) => y.vinculo === x.vinculo)
              .map((y) => ({
                tipo: y.tipo,
                dosimetro: y.dosimetro,
                periodoInicio: y.periodoInicio,
                cancelada: y.canceladoEm !== null,
              })),
            { dosimetro: x.dosimetro ?? '', periodoInicio: x.periodoInicio ?? '' },
          );
          if (r) throw recusa(r.codigo, r.mensagem);
        }
        const n = id();
        s.epis.push({
          id: n,
          vinculo: x.vinculo,
          tipo: x.tipo,
          data: x.data,
          epi: x.epi,
          caNumero: x.caNumero,
          caValidade: x.caValidade,
          quantidade: x.quantidade,
          assinatura: x.tipo === 'epi' ? 'pendente' : null,
          assinadaEm: null,
          periodoInicio: x.periodoInicio,
          doseMsv: x.doseMsv,
          dosimetro: x.dosimetro,
          agente: x.agente,
          duracaoMin: x.duracaoMin,
          observacao: x.observacao,
          criadoPor: x.por,
          canceladoEm: null,
          canceladoPor: null,
          motivoCancelamento: null,
        });
        return n;
      },
      assinarEntregaEpi: async (x) => {
        const r = s.epis.find(
          (y) => y.id === x.id && y.tipo === 'epi' && y.assinatura === 'pendente' && y.canceladoEm === null,
        );
        if (!r) throw desatualizado();
        Object.assign(r, { assinatura: 'assinada', assinadaEm: agora.agora });
      },
      // W0-06 (1063): as mesmas condições do UPDATE do banco (versão lida; nunca no anulado nem no já cancelado).
      retificarAcidente: async (x) => {
        const a = s.acidentes.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao || a.anuladoEm !== null) throw desatualizado();
        Object.assign(a, {
          ocorridoEm: x.ocorridoEm,
          tipo: x.tipo,
          local: x.local,
          descricao: x.descricao,
          parteCorpo: x.parteCorpo,
          natureza: x.natureza,
          agente: x.agente,
          situacao: x.situacao,
          afastamento: x.afastamento,
          obito: x.obito,
          catPrazo: x.catPrazo,
          cat: { ...x.cat },
          versao: a.versao + 1,
        });
      },
      anularAcidente: async (x) => {
        const a = s.acidentes.find((y) => y.id === x.id);
        if (!a || a.versao !== x.versao || a.anuladoEm !== null) throw desatualizado();
        Object.assign(a, {
          estado: 'encerrado',
          encerradoEm: a.encerradoEm ?? agora.agora,
          encerradoPor: a.encerradoPor ?? x.por,
          motivoEncerramento: x.motivo,
          anuladoEm: agora.agora,
          anuladoPor: x.por,
          versao: a.versao + 1,
        });
      },
      cancelarEntregaEpi: async (x) => {
        const r = s.epis.find((y) => y.id === x.id && y.tipo === x.tipo && y.canceladoEm === null);
        if (!r) throw desatualizado();
        Object.assign(r, { canceladoEm: agora.agora, canceladoPor: x.por, motivoCancelamento: x.motivo });
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
          em: agora.agora,
        });
      },
    };
    const r = await fn(g);
    this.estados.set(hospitalDe(c), s);
    return r;
  }

  async correcoes(c: ContextoSesmt, tabela: string, registros: readonly number[]): Promise<CorrecaoSesmt[]> {
    return this.e(c).correcoes.filter((x) => x.tabela === tabela && registros.includes(x.registro));
  }

  async relogio(): Promise<{ hoje: string; agora: string }> {
    const agora = this.agoraFixo ?? local(new Date());
    return { hoje: agora.slice(0, 10), agora };
  }
  async dominios(): Promise<DominiosSesmt> {
    return DOMINIOS_SESMT_SINTETICOS;
  }
  async fatoresRisco(_c: ContextoSesmt, termo: string) {
    const t = termo.trim().toUpperCase();
    return FATORES_SINTETICOS.filter(
      (f) => f.codigo.startsWith(termo.trim()) || f.rotulo.toUpperCase().includes(t),
    );
  }
  async fatoresPorCodigo(_c: ContextoSesmt, codigos: readonly string[]) {
    return new Map(
      FATORES_SINTETICOS.filter((f) => codigos.includes(f.codigo)).map((f) => [f.codigo, f.rotulo]),
    );
  }
  async ocupacional(c: ContextoSesmt, v: number) {
    return this.e(c)
      .ocupacional.filter((x) => x.vinculo === v)
      .sort((a, b) => (a.data === b.data ? b.id - a.id : a.data < b.data ? 1 : -1));
  }
  async vacinas(c: ContextoSesmt, v: number) {
    return this.e(c).vacinas.filter((x) => x.vinculo === v);
  }
  async acidente(c: ContextoSesmt, id: number) {
    return this.e(c).acidentes.find((a) => a.id === id) ?? null;
  }
  async listarAcidentes(c: ContextoSesmt, f: Parameters<PortaSesmt['listarAcidentes']>[1]) {
    const todos = this.e(c)
      .acidentes.filter(
        (a) =>
          (f.estado === 'todos' || a.estado === f.estado) &&
          (f.vinculo === undefined || a.vinculo === f.vinculo) &&
          (f.depois === undefined || a.id < f.depois),
      )
      .sort((a, b) => b.id - a.id);
    const itens = todos.slice(0, f.limite);
    return { itens, depois: todos.length > f.limite ? (itens.at(-1)?.id ?? null) : null };
  }
  async sorologias(c: ContextoSesmt, acidentes: readonly number[]) {
    return this.e(c).sorologias.filter((x) => acidentes.includes(x.acidente));
  }
  async mapaRiscos(c: ContextoSesmt, f: Parameters<PortaSesmt['mapaRiscos']>[1]) {
    return this.e(c).riscos.filter(
      (r) =>
        (!f.funcaoChave || r.funcaoChave === f.funcaoChave) &&
        (f.unidade === undefined || r.unidade === null || r.unidade === f.unidade) &&
        (!f.vigentes || r.fim === null),
    );
  }
  async registrosEpi(c: ContextoSesmt, v: number) {
    return this.e(c).epis.filter((x) => x.vinculo === v);
  }
  async registroEpi(c: ContextoSesmt, id: number, tipo: TipoProtecao = 'epi') {
    return this.e(c).epis.find((x) => x.id === id && x.tipo === tipo) ?? null;
  }
  async resumo(c: ContextoSesmt, ano: number): Promise<ResumoSesmt> {
    const vinculos: VinculoAtivoSesmt[] = [];
    if (this.pessoas) {
      let depois: number | undefined;
      for (;;) {
        const r = await this.pessoas.listarVinculos(c, {
          estado: 'ativo',
          limite: 200,
          ...(depois !== undefined ? { depois } : {}),
        });
        for (const v of r.itens)
          vinculos.push({
            id: v.id,
            nome: v.nome,
            matricula: v.matricula,
            cargo: v.cargo,
            funcao: v.funcao,
            unidade: v.unidade,
            setor: v.setor,
            admissao: v.admissao,
          });
        if (r.depois === null) break;
        depois = r.depois;
      }
    }
    const ativos = new Set(vinculos.map((v) => v.id));
    const s = this.e(c);
    const acidentes = s.acidentes.filter(
      (a) => ativos.has(a.vinculo) && a.anuladoEm === null && (a.estado === 'aberto' || a.catNumero === null),
    );
    return {
      vinculos: vinculos.sort((a, b) => a.nome.localeCompare(b.nome) || a.id - b.id),
      asos: s.ocupacional.filter((x) => x.registro === 'aso' && ativos.has(x.vinculo)),
      vacinas: s.vacinas.filter(
        (x) => ativos.has(x.vinculo) && (x.vacina === 'hepatite-b' || x.vacina === 'dupla-adulto'),
      ),
      epis: s.epis.filter(
        (x) =>
          ativos.has(x.vinculo) &&
          x.canceladoEm === null &&
          ((x.tipo === 'epi' && x.assinatura === 'pendente') ||
            (x.tipo === 'dosimetria' && x.data.startsWith(String(ano)))),
      ),
      acidentes,
      sorologias: s.sorologias.filter((x) => acidentes.some((a) => a.id === x.acidente)),
    };
  }
}
