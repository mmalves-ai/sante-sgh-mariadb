// Porta de cargos e salários em memória (W0-06, parte 4): a sessão sintética de dev/ci e o E2E. Como no modelo do banco,
// o cargo (com as correções e os retratos de exclusão) é do cliente inteiro: a lista, o nome único e a recontagem das
// dependências valem para todos os estabelecimentos. Faixas, quadro de vagas e colaboradores (ocupação) são do
// estabelecimento. Tudo numa cópia por transação (o erro no meio desfaz tudo). As regras que importam ao teste também valem
// aqui: nome único, versão otimista, a versão encerra a anterior na véspera, a exclusão recontada (com vínculo: 409) e o
// retrato guardado. O CBO e os conselhos são sintéticos (códigos públicos da CBO). `ligarColaborador` simula o vínculo
// de trabalho de um colaborador no cargo.
import { ErroOperacao, recusa } from '@sgh/nucleo';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import type {
  AlvoDependenciaCargos,
  CargoRegistrado,
  ContextoCargos,
  CorrecaoRegistrada,
  DependenciaContada,
  FaixaSalarialRegistrada,
  GravadorCargos,
  OcupacaoCargo,
  PortaCargos,
  TabelaCargos,
  VagaQuadroRegistrada,
} from './porta-cargos.js';

const desatualizado = () =>
  new ErroOperacao(
    409,
    'desatualizado',
    'Operação recusada',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

/** CBO sintéticos (códigos públicos da Classificação Brasileira de Ocupações). */
export const CBO_SINTETICOS: readonly { codigo: string; descricao: string }[] = [
  { codigo: '223505', descricao: 'Enfermeiro' },
  { codigo: '322205', descricao: 'Técnico de enfermagem' },
  { codigo: '225125', descricao: 'Médico clínico' },
  { codigo: '515105', descricao: 'Agente comunitário de saúde' },
  { codigo: '411010', descricao: 'Assistente administrativo' },
  { codigo: '513205', descricao: 'Cozinheiro geral' },
];

export const CONSELHOS_SINTETICOS: readonly { codigo: string; rotulo: string }[] = [
  { codigo: 'COREN', rotulo: 'COREN · Conselho Regional de Enfermagem' },
  { codigo: 'CRM', rotulo: 'CRM · Conselho Regional de Medicina' },
  { codigo: 'CRF', rotulo: 'CRF · Conselho Regional de Farmácia' },
];

interface Colaborador {
  readonly vinculo: number;
  readonly cargo: number;
  readonly centroCusto: number;
  readonly desligado: boolean;
}

/** O que é do estabelecimento: faixas, quadro de vagas e a ocupação. */
interface Local {
  faixas: FaixaSalarialRegistrada[];
  vagas: VagaQuadroRegistrada[];
  colaboradores: Colaborador[];
}

/** O estado de um cliente: o cargo é da rede; o resto, por estabelecimento. */
interface Estado {
  seq: number;
  cargos: CargoRegistrado[];
  correcoes: CorrecaoRegistrada[];
  exclusoes: { tabela: TabelaCargos; id: number; linha: unknown; motivo: string; por: string }[];
  locais: Map<string, Local>;
}
const novo = (): Estado => ({ seq: 8100, cargos: [], correcoes: [], exclusoes: [], locais: new Map() });
const copiar = (s: Estado): Estado => ({
  seq: s.seq,
  cargos: s.cargos.map((x) => ({ ...x })),
  correcoes: [...s.correcoes],
  exclusoes: [...s.exclusoes],
  locais: new Map(
    [...s.locais].map(([k, l]) => [
      k,
      {
        faixas: l.faixas.map((x) => ({ ...x })),
        vagas: l.vagas.map((x) => ({ ...x })),
        colaboradores: [...l.colaboradores],
      },
    ]),
  ),
});

const chaveDe = (estabelecimento: number | null) => String(estabelecimento ?? 0);
const localDe = (s: Estado, estabelecimento: number | null): Local => {
  const k = chaveDe(estabelecimento);
  let l = s.locais.get(k);
  if (!l) {
    l = { faixas: [], vagas: [], colaboradores: [] };
    s.locais.set(k, l);
  }
  return l;
};
const todos = <K extends keyof Local>(s: Estado, k: K): Local[K][number][] =>
  [...s.locais.values()].flatMap((l) => l[k] as Local[K][number][]);

const p2 = (x: number) => String(x).padStart(2, '0');
const local = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const vespera = (dia: string): string => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function contar(
  s: Estado,
  estabelecimento: number | null,
  alvo: AlvoDependenciaCargos,
  id: number,
): DependenciaContada[] {
  const r: DependenciaContada[] = [];
  const somar = (grupo: string, tabela: string, coluna: string, quantidade: number) => {
    if (quantidade > 0) r.push({ grupo, tabela, coluna, quantidade });
  };
  if (alvo === 'cargo') {
    // O cargo é da rede: conta em todos os estabelecimentos do cliente.
    somar(
      'Colaboradores no cargo',
      'vinculo_trabalho',
      'cargo_id',
      todos(s, 'colaboradores').filter((c) => c.cargo === id).length,
    );
    somar(
      'Faixas da tabela salarial',
      'faixa_salarial',
      'cargo_id',
      todos(s, 'faixas').filter((f) => f.cargo === id).length,
    );
    somar(
      'Vagas do quadro',
      'quadro_vaga',
      'cargo_id',
      todos(s, 'vagas').filter((v) => v.cargo === id).length,
    );
  } else {
    const l = localDe(s, estabelecimento);
    const [linhas, nome, tabela] =
      alvo === 'salario-faixa'
        ? ([l.faixas, 'faixa', 'faixa_salarial'] as const)
        : ([l.vagas, 'vaga', 'quadro_vaga'] as const);
    const proprio = (linhas as readonly { id: number; anterior: number | null }[]).find((x) => x.id === id);
    somar(
      `Versão posterior da ${nome}`,
      tabela,
      'anterior_id',
      (linhas as readonly { anterior: number | null }[]).filter((x) => x.anterior === id).length,
    );
    somar(`Versão anterior da ${nome}`, tabela, 'id', proprio?.anterior ? 1 : 0);
  }
  return r;
}

export class PortaCargosMemoria implements PortaCargos {
  readonly destino = 'memoria' as const;
  /** Relógio fixo para os testes (AAAA-MM-DDTHH:MM); null: o relógio do processo. */
  agoraFixo: string | null = null;
  private readonly estados = new Map<string, Estado>();

  private porCliente(cliente: string): Estado {
    let s = this.estados.get(cliente);
    if (!s) {
      s = novo();
      this.estados.set(cliente, s);
    }
    return s;
  }

  private e(c: ContextoCargos): Estado {
    return this.porCliente(c.cliente);
  }

  private l(c: ContextoCargos): Local {
    return localDe(this.e(c), c.estabelecimento);
  }

  /** Simula o vínculo de trabalho de um colaborador no cargo (no estabelecimento do contexto). */
  ligarColaborador(c: Pick<ContextoCargos, 'cliente' | 'estabelecimento'>, x: Colaborador): void {
    localDe(this.porCliente(c.cliente), c.estabelecimento).colaboradores.push(x);
  }

  /** Os retratos guardados das exclusões (D-CRUD-SNAP) do cliente, para o teste. */
  exclusoes(cliente: string): Estado['exclusoes'] {
    return [...this.porCliente(cliente).exclusoes];
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
      'Cargos e salários não usam o executor.',
    );
  }

  async gravarSgh<T>(
    c: ContextoCargos,
    _trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorCargos) => Promise<T>,
  ): Promise<T> {
    const s = copiar(this.e(c));
    const loc = localDe(s, c.estabelecimento);
    const id = () => ++s.seq;
    const agora = this.agora();
    const tabelaDe = (t: TabelaCargos) =>
      (t === 'cargo' ? s.cargos : t === 'faixa_salarial' ? loc.faixas : loc.vagas) as {
        id: number;
        versao: number;
        ativo: boolean;
        motivoSituacao: string | null;
      }[];
    const nomeUnico = (nome: string, outro: number | null) => {
      if (s.cargos.some((x) => x.id !== outro && x.nome.toUpperCase() === nome.toUpperCase()))
        throw recusa('cargo-nome-em-uso', 'Já existe um cargo com este nome.', {
          campos: ['nome'],
        });
    };
    const g: GravadorCargos = {
      cargo: async (i) => s.cargos.find((x) => x.id === i) ?? null,
      faixa: async (i) => loc.faixas.find((x) => x.id === i) ?? null,
      vaga: async (i) => loc.vagas.find((x) => x.id === i) ?? null,
      incluirCargo: async (x) => {
        nomeUnico(x.nome, null);
        const n = id();
        s.cargos.push({
          id: n,
          nome: x.nome,
          cbo: x.cbo,
          descricao: x.descricao,
          requisitos: x.requisitos,
          conselho: x.conselho,
          ativo: true,
          motivoSituacao: null,
          versao: 0,
          criadoPor: x.por,
          criadoEm: agora,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
        return n;
      },
      alterarCargo: async (x) => {
        const r = s.cargos.find((y) => y.id === x.id && y.versao === x.versao);
        if (!r) throw desatualizado();
        nomeUnico(x.nome, x.id);
        Object.assign(r, {
          nome: x.nome,
          cbo: x.cbo,
          descricao: x.descricao,
          requisitos: x.requisitos,
          conselho: x.conselho,
          versao: r.versao + 1,
          alteradoPor: x.por,
          alteradoEm: agora,
        });
      },
      situacao: async (x) => {
        const r = tabelaDe(x.tabela).find(
          (y) => y.id === x.id && y.versao === x.versao && y.ativo !== x.ativo,
        );
        if (!r) throw desatualizado();
        Object.assign(r, { ativo: x.ativo, motivoSituacao: x.motivo, versao: r.versao + 1 });
      },
      excluir: async (x) => {
        const linhas = tabelaDe(x.tabela);
        const i = linhas.findIndex((y) => y.id === x.id && y.versao === x.versao);
        if (i < 0) throw desatualizado();
        const alvo: AlvoDependenciaCargos =
          x.tabela === 'cargo' ? 'cargo' : x.tabela === 'faixa_salarial' ? 'salario-faixa' : 'vaga';
        const v = contar(s, c.estabelecimento, alvo, x.id);
        if (v.length > 0)
          throw recusa(
            `${alvo}-com-vinculos`,
            `Há registros ligados: ${v.map((y) => `${y.grupo}: ${y.quantidade}`).join('; ')}.`,
          );
        s.exclusoes.push({
          tabela: x.tabela,
          id: x.id,
          linha: structuredClone(linhas[i]),
          motivo: x.motivo,
          por: x.por,
        });
        linhas.splice(i, 1);
      },
      incluirFaixa: async (x) => {
        if (
          loc.faixas.some(
            (f) => f.cargo === x.cargo && f.faixa === x.faixa && f.nivel === x.nivel && f.desde === x.desde,
          )
        )
          throw recusa(
            'faixa-ja-existe',
            'Já existe esta faixa e nível do cargo valendo a partir desta data.',
            {
              campos: ['faixa'],
            },
          );
        const n = id();
        loc.faixas.push({
          id: n,
          cargo: x.cargo,
          faixa: x.faixa,
          nivel: x.nivel,
          valor: x.valor,
          desde: x.desde,
          ate: null,
          anterior: null,
          motivo: null,
          ativo: true,
          motivoSituacao: null,
          versao: 0,
          criadoPor: x.por,
          criadoEm: agora,
        });
        return n;
      },
      versionarFaixa: async (x) => {
        const r = loc.faixas.find(
          (y) =>
            y.id === x.anterior.id &&
            y.versao === x.anterior.versao &&
            y.ate === null &&
            y.ativo &&
            y.desde < x.desde,
        );
        if (!r || loc.faixas.some((y) => y.anterior === r.id)) throw desatualizado();
        Object.assign(r, { ate: vespera(x.desde), versao: r.versao + 1 });
        const n = id();
        loc.faixas.push({
          ...r,
          id: n,
          valor: x.valor,
          desde: x.desde,
          ate: null,
          anterior: r.id,
          motivo: x.motivo,
          ativo: true,
          motivoSituacao: null,
          versao: 0,
          criadoPor: x.por,
          criadoEm: agora,
        });
        return n;
      },
      incluirVaga: async (x) => {
        if (
          loc.vagas.some((v) => v.cargo === x.cargo && v.centroCusto === x.centroCusto && v.desde === x.desde)
        )
          throw recusa(
            'vaga-ja-existe',
            'Já existe vaga deste cargo neste centro de custo valendo a partir desta data.',
            {
              campos: ['centroCusto'],
            },
          );
        const n = id();
        loc.vagas.push({
          id: n,
          cargo: x.cargo,
          centroCusto: x.centroCusto,
          quantidade: x.quantidade,
          desde: x.desde,
          ate: null,
          anterior: null,
          motivo: null,
          ativo: true,
          motivoSituacao: null,
          versao: 0,
          criadoPor: x.por,
          criadoEm: agora,
        });
        return n;
      },
      versionarVaga: async (x) => {
        const r = loc.vagas.find(
          (y) =>
            y.id === x.anterior.id &&
            y.versao === x.anterior.versao &&
            y.ate === null &&
            y.ativo &&
            y.desde < x.desde,
        );
        if (!r || loc.vagas.some((y) => y.anterior === r.id)) throw desatualizado();
        Object.assign(r, { ate: vespera(x.desde), versao: r.versao + 1 });
        const n = id();
        loc.vagas.push({
          ...r,
          id: n,
          quantidade: x.quantidade,
          desde: x.desde,
          ate: null,
          anterior: r.id,
          motivo: x.motivo,
          ativo: true,
          motivoSituacao: null,
          versao: 0,
          criadoPor: x.por,
          criadoEm: agora,
        });
        return n;
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
    this.estados.set(c.cliente, s);
    return r;
  }

  async hoje(): Promise<string> {
    return this.agora().slice(0, 10);
  }
  async cargos(c: ContextoCargos): Promise<CargoRegistrado[]> {
    return [...this.e(c).cargos].sort((a, b) => a.nome.localeCompare(b.nome));
  }
  async cargo(c: ContextoCargos, id: number): Promise<CargoRegistrado | null> {
    return this.e(c).cargos.find((x) => x.id === id) ?? null;
  }
  async faixas(c: ContextoCargos, cargo: number | null): Promise<FaixaSalarialRegistrada[]> {
    return this.l(c).faixas.filter((x) => cargo === null || x.cargo === cargo);
  }
  async faixa(c: ContextoCargos, id: number): Promise<FaixaSalarialRegistrada | null> {
    return this.l(c).faixas.find((x) => x.id === id) ?? null;
  }
  async vagas(c: ContextoCargos, cargo: number | null): Promise<VagaQuadroRegistrada[]> {
    return this.l(c).vagas.filter((x) => cargo === null || x.cargo === cargo);
  }
  async vaga(c: ContextoCargos, id: number): Promise<VagaQuadroRegistrada | null> {
    return this.l(c).vagas.find((x) => x.id === id) ?? null;
  }
  async ocupacao(c: ContextoCargos): Promise<OcupacaoCargo[]> {
    const m = new Map<string, OcupacaoCargo>();
    for (const x of this.l(c).colaboradores.filter((y) => !y.desligado)) {
      const k = `${x.cargo}:${x.centroCusto}`;
      const a = m.get(k);
      m.set(k, { cargo: x.cargo, centroCusto: x.centroCusto, ocupadas: (a?.ocupadas ?? 0) + 1 });
    }
    return [...m.values()];
  }
  async dependencias(
    c: ContextoCargos,
    alvo: AlvoDependenciaCargos,
    id: number,
  ): Promise<DependenciaContada[]> {
    return contar(this.e(c), c.estabelecimento, alvo, id);
  }
  async buscarCbo(_c: ContextoCargos, termo: string) {
    const t = termo.trim().toUpperCase();
    if (t.length < 2) return [];
    return CBO_SINTETICOS.filter((x) => x.codigo.startsWith(t) || x.descricao.toUpperCase().includes(t)).map(
      (x) => ({
        codigo: x.codigo,
        rotulo: `${x.codigo} · ${x.descricao}`,
      }),
    );
  }
  async cboPorCodigo(_c: ContextoCargos, codigos: readonly string[]) {
    return new Map(
      CBO_SINTETICOS.filter((x) => codigos.includes(x.codigo)).map((x) => [x.codigo, x.descricao]),
    );
  }
  async conselhos() {
    return [...CONSELHOS_SINTETICOS];
  }
  async correcoes(
    c: ContextoCargos,
    tabela: TabelaCargos,
    registros: readonly number[],
  ): Promise<CorrecaoRegistrada[]> {
    return this.e(c).correcoes.filter((x) => x.tabela === tabela && registros.includes(x.registro));
  }
}
