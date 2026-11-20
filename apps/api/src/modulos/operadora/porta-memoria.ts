// Porta da operadora em memória (M56): a sessão sintética de dev/ci (E2E). F0: catálogos da ANS SINTÉTICOS (códigos
// de procedimento na faixa 90.000.000, que nenhuma tabela oficial usa), com a mesma paginação por chave e o mesmo teto
// de página das leituras do legado. F1 (M56.2): operadora, produto, contrato, beneficiário e vias da carteirinha em
// memória, com as mesmas recusas do banco (chaves únicas e a versão) e a transação desfeita por inteiro quando a função
// falha; os domínios (motivos de baixa e de segunda via) são sintéticos; a trilha vai ao registrador da API. Nada vai
// à cópia.
import {
  type BeneficiarioOpeLido,
  type BeneficiarioSgh,
  type ClassificacaoAnsLida,
  type ContratoOpeLido,
  type ContratoSgh,
  type DominiosBeneficiarioLidos,
  type ElegibilidadeOpeLida,
  ErroOperacao,
  type FiltroBeneficiariosSgh,
  type FiltroContratosSgh,
  type GrupoSipLido,
  LIMITE_PAGINA_OPERADORA,
  LIMITE_PAGINA_SIP,
  type LinhaTrilha,
  type OperadoraOpeLida,
  type OperadoraSgh,
  type ProcedimentoSipLido,
  type ProdutoOpeLido,
  type ProdutoSgh,
  type ViaCarteirinhaLida,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type {
  ChaveSip,
  ContextoOperadora,
  FiltroClassificacao,
  FiltroSip,
  GravadorOperadora,
  PortaOperadora,
} from './porta.js';

const GRUPOS: readonly GrupoSipLido[] = [
  { id: 1, nome: 'Consultas médicas (sintético)' },
  { id: 2, nome: 'Outros atendimentos ambulatoriais (sintético)' },
  { id: 3, nome: 'Exames (sintético)' },
  { id: 4, nome: 'Terapias (sintético)' },
  { id: 5, nome: 'Internações (sintético)' },
];

/** 250 procedimentos sintéticos (passa de uma página), um terço com vigência encerrada. */
/** O nome vem da terminologia TUSS sintética; um em cada dez códigos não está nela (nome null). */
const PROCEDIMENTOS: readonly ProcedimentoSipLido[] = Array.from({ length: 250 }, (_, i) => ({
  procedimento: 90_000_001 + i,
  nome: i % 10 === 9 ? null : `Procedimento sintético ${90_000_001 + i}`,
  grupo: (i % GRUPOS.length) + 1,
  vigenciaInicial: i % 3 === 0 ? '2014-01-01' : '2009-01-01',
  vigenciaFinal: i % 3 === 0 ? '2020-12-31' : null,
}));

const CLASSIFICACOES: readonly ClassificacaoAnsLida[] = Array.from({ length: 12 }, (_, i) => ({
  codigo: i + 1,
  nome: `${i % 2 === 0 ? 'Exames' : 'Terapias'}: classificação sintética ${String(i + 1).padStart(2, '0')}`,
}));

/** Domínios sintéticos da sessão de dev/ci (motivos de baixa com o 99 protegido; motivos de segunda via). */
const DOMINIOS: DominiosBeneficiarioLidos = {
  motivosBaixa: [
    { codigo: 1, nome: 'A pedido do beneficiário (sintético)' },
    { codigo: 2, nome: 'Inadimplência (sintético)' },
    { codigo: 3, nome: 'Óbito (sintético)' },
    { codigo: 99, nome: 'Outros (sintético)' },
  ],
  motivosSegundaVia: [
    { codigo: 1, nome: 'Perda (sintético)' },
    { codigo: 2, nome: 'Roubo ou furto (sintético)' },
    { codigo: 3, nome: 'Dano (sintético)' },
  ],
  diasVencimento: [],
};

/** Na sessão sintética, os cadastros de paciente de ID 1 a 99.999 "existem" (regra 8: só o ID é guardado). */
const MAIOR_PACIENTE_SINTETICO = 99_999;

const depois = (p: ProcedimentoSipLido, a: ChaveSip): boolean =>
  p.procedimento > a.procedimento ||
  (p.procedimento === a.procedimento &&
    (p.grupo > a.grupo || (p.grupo === a.grupo && (p.vigenciaInicial ?? '') > a.vigenciaInicial)));

interface BeneficiarioMem extends Omit<BeneficiarioOpeLido, 'contratoNumero' | 'produtoNome'> {
  readonly nomeBusca: string;
  readonly hospital: string;
}
interface ContratoMem extends Omit<ContratoOpeLido, 'produtoNome' | 'beneficiariosAtivos'> {
  readonly contratanteBusca: string;
  readonly hospital: string;
}
interface Estado {
  operadoras: (OperadoraOpeLida & { hospital: string })[];
  produtos: (ProdutoOpeLido & { hospital: string })[];
  contratos: ContratoMem[];
  beneficiarios: BeneficiarioMem[];
  vias: (ViaCarteirinhaLida & { beneficiario: number; hospital: string })[];
  seq: Record<string, number>;
}

/** O objeto sem as chaves (cópia rasa). */
function sem<T extends object, K extends keyof T>(o: T, ...chaves: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !chaves.includes(k as K))) as Omit<T, K>;
}

const agora = () => new Date().toISOString().slice(0, 19);
const recusa = (codigo: string, detail: string, campo?: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detail, campo ? { campos: [campo] } : {});
const desatualizado = () =>
  recusa(
    'desatualizado',
    'O registro mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
  );

export class PortaOperadoraMemoria implements PortaOperadora {
  readonly destino = 'memoria' as const;
  private estado: Estado = {
    operadoras: [],
    produtos: [],
    contratos: [],
    beneficiarios: [],
    vias: [],
    seq: {},
  };

  constructor(private readonly trilha: RegistradorTrilha | null = null) {}

  async gruposSip(): Promise<GrupoSipLido[]> {
    return [...GRUPOS];
  }

  async procedimentosSip(_c: unknown, f: FiltroSip) {
    const lista = PROCEDIMENTOS.filter(
      (p) =>
        (f.grupo === undefined || p.grupo === f.grupo) &&
        (f.procedimento === undefined || p.procedimento === f.procedimento) &&
        (f.vigentesEm === undefined ||
          ((p.vigenciaInicial ?? '') <= f.vigentesEm &&
            (p.vigenciaFinal === null || p.vigenciaFinal >= f.vigentesEm))) &&
        (f.apos === undefined || depois(p, f.apos)),
    );
    const itens = lista.slice(0, LIMITE_PAGINA_SIP);
    const u = itens[itens.length - 1];
    const proxima =
      lista.length > LIMITE_PAGINA_SIP && u?.vigenciaInicial
        ? { procedimento: u.procedimento, grupo: u.grupo, vigenciaInicial: u.vigenciaInicial }
        : null;
    return { itens, proxima };
  }

  async classificacoesAns(_c: unknown, f: FiltroClassificacao) {
    const b = f.busca?.trim() ?? '';
    const porCodigo = /^\d{1,9}$/.test(b);
    const lista = CLASSIFICACOES.filter(
      (x) =>
        (f.apos === undefined || x.codigo > f.apos) &&
        (b === '' || (porCodigo ? x.codigo === Number(b) : x.nome.toLowerCase().includes(b.toLowerCase()))),
    );
    const itens = lista.slice(0, LIMITE_PAGINA_SIP);
    return {
      itens,
      proxima: lista.length > LIMITE_PAGINA_SIP ? (itens[itens.length - 1]?.codigo ?? null) : null,
    };
  }

  // ── F1: leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  private sem<T extends { hospital: string }>(x: T): Omit<T, 'hospital'> {
    return sem(x, 'hospital');
  }

  async operadoras(c: ContextoOperadora): Promise<OperadoraOpeLida[]> {
    return this.estado.operadoras
      .filter((o) => o.hospital === c.hospital)
      .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial) || a.id - b.id)
      .map((o) => this.sem(o));
  }

  async operadora(c: ContextoOperadora, id: number): Promise<OperadoraOpeLida | null> {
    const o = this.estado.operadoras.find((x) => x.hospital === c.hospital && x.id === id);
    return o ? this.sem(o) : null;
  }

  async produtos(c: ContextoOperadora, operadora?: number): Promise<ProdutoOpeLido[]> {
    return this.estado.produtos
      .filter((p) => p.hospital === c.hospital && (operadora === undefined || p.operadora === operadora))
      .sort((a, b) => a.nome.localeCompare(b.nome) || a.id - b.id)
      .map((p) => this.sem(p));
  }

  async produto(c: ContextoOperadora, id: number): Promise<ProdutoOpeLido | null> {
    const p = this.estado.produtos.find((x) => x.hospital === c.hospital && x.id === id);
    return p ? this.sem(p) : null;
  }

  private contratoLido(x: ContratoMem): ContratoOpeLido {
    return {
      ...sem(x, 'contratanteBusca', 'hospital'),
      produtoNome: this.estado.produtos.find((p) => p.id === x.produto)?.nome ?? '',
      beneficiariosAtivos: this.estado.beneficiarios.filter(
        (b) => b.contrato === x.id && b.situacao === 'ativo',
      ).length,
    };
  }

  async contratos(c: ContextoOperadora, f: FiltroContratosSgh) {
    const lista = this.estado.contratos
      .filter(
        (x) =>
          x.hospital === c.hospital &&
          x.operadora === f.operadora &&
          (f.produto === undefined || x.produto === f.produto) &&
          (!f.numero || x.numero.startsWith(f.numero)) &&
          (!f.nome || x.contratanteBusca.startsWith(f.nome)) &&
          (f.apos === undefined || x.id > f.apos),
      )
      .sort((a, b) => a.id - b.id);
    const itens = lista.slice(0, LIMITE_PAGINA_OPERADORA).map((x) => this.contratoLido(x));
    return {
      itens,
      proxima: lista.length > LIMITE_PAGINA_OPERADORA ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  async contrato(c: ContextoOperadora, id: number): Promise<ContratoOpeLido | null> {
    const x = this.estado.contratos.find((k) => k.hospital === c.hospital && k.id === id);
    return x ? this.contratoLido(x) : null;
  }

  private beneficiarioLido(b: BeneficiarioMem): BeneficiarioOpeLido {
    const ctr = this.estado.contratos.find((x) => x.id === b.contrato);
    return {
      ...sem(b, 'nomeBusca', 'hospital'),
      contratoNumero: ctr?.numero ?? '',
      produtoNome: this.estado.produtos.find((p) => p.id === ctr?.produto)?.nome ?? '',
    };
  }

  async beneficiarios(c: ContextoOperadora, f: FiltroBeneficiariosSgh) {
    const lista = this.estado.beneficiarios
      .filter(
        (b) =>
          b.hospital === c.hospital &&
          b.operadora === f.operadora &&
          (f.contrato === undefined || b.contrato === f.contrato) &&
          (f.titular === undefined || b.titular === f.titular) &&
          (!f.carteirinha || b.carteirinha === f.carteirinha) &&
          (!f.cpf || b.cpf === f.cpf) &&
          (!f.nome || b.nomeBusca.startsWith(f.nome)) &&
          (!f.situacao || b.situacao === f.situacao) &&
          (f.apos === undefined || b.id > f.apos),
      )
      .sort((a, b) => a.id - b.id);
    const itens = lista.slice(0, LIMITE_PAGINA_OPERADORA).map((b) => this.beneficiarioLido(b));
    return {
      itens,
      proxima: lista.length > LIMITE_PAGINA_OPERADORA ? (itens[itens.length - 1]?.id ?? null) : null,
    };
  }

  async beneficiario(c: ContextoOperadora, id: number): Promise<BeneficiarioOpeLido | null> {
    const b = this.estado.beneficiarios.find((x) => x.hospital === c.hospital && x.id === id);
    return b ? this.beneficiarioLido(b) : null;
  }

  async dependentes(c: ContextoOperadora, titular: number): Promise<BeneficiarioOpeLido[]> {
    return this.estado.beneficiarios
      .filter((b) => b.hospital === c.hospital && b.titular === titular)
      .sort((a, b) => a.id - b.id)
      .map((b) => this.beneficiarioLido(b));
  }

  async vias(c: ContextoOperadora, beneficiario: number): Promise<ViaCarteirinhaLida[]> {
    return this.estado.vias
      .filter((v) => v.hospital === c.hospital && v.beneficiario === beneficiario)
      .sort((a, b) => b.via - a.via)
      .map((v) => sem(v, 'beneficiario', 'hospital'));
  }

  async elegibilidade(c: ContextoOperadora, carteirinha: string): Promise<ElegibilidadeOpeLida | null> {
    const b = this.estado.beneficiarios.find(
      (x) => x.hospital === c.hospital && x.carteirinha === carteirinha,
    );
    if (!b) return null;
    const ctr = this.estado.contratos.find((x) => x.id === b.contrato)!;
    const p = this.estado.produtos.find((x) => x.id === ctr.produto)!;
    return {
      beneficiario: this.beneficiarioLido(b),
      contrato: { situacao: ctr.situacao, inicio: ctr.inicio, fim: ctr.fim },
      produto: this.sem(p),
    };
  }

  async contagensDoContrato(
    c: ContextoOperadora,
    x: { contrato: number; cpf: string | null; exceto: number | null },
  ) {
    const doContrato = this.estado.beneficiarios.filter(
      (b) =>
        b.hospital === c.hospital &&
        b.contrato === x.contrato &&
        b.situacao !== 'excluido' &&
        b.id !== x.exceto,
    );
    return {
      titularesAtivos: doContrato.filter((b) => b.vinculo === 1).length,
      cpfNoContrato: x.cpf ? doContrato.filter((b) => b.cpf === x.cpf).length : 0,
    };
  }

  async contagensDeUso(c: ContextoOperadora, x: { contrato: number | null; produto: number | null }) {
    return {
      beneficiariosVinculados:
        x.contrato === null
          ? 0
          : this.estado.beneficiarios.filter(
              (b) => b.hospital === c.hospital && b.contrato === x.contrato && b.situacao !== 'excluido',
            ).length,
      contratosEmUso:
        x.produto === null
          ? 0
          : this.estado.contratos.filter(
              (k) => k.hospital === c.hospital && k.produto === x.produto && k.situacao !== 'encerrado',
            ).length,
    };
  }

  async dominiosBeneficiario(): Promise<DominiosBeneficiarioLidos> {
    return DOMINIOS;
  }

  async pacienteExiste(_c: ContextoOperadora, id: number): Promise<boolean> {
    return id >= 1 && id <= MAIOR_PACIENTE_SINTETICO;
  }

  // ── F1: gravações (a transação inteira desfeita na falha) ─────────────────────────────────────────────────────

  private proximo(nome: string): number {
    const n = (this.estado.seq[nome] ?? 0) + 1;
    this.estado.seq[nome] = n;
    return n;
  }

  private gravador(h: string): GravadorOperadora {
    const s = this.estado;
    const unico = (ok: boolean, codigo: string, detail: string, campo: string) => {
      if (!ok) throw recusa(codigo, detail, campo);
    };
    const conferirOperadora = (d: OperadoraSgh, id: number | null) => {
      unico(
        !s.operadoras.some((o) => o.hospital === h && o.id !== id && o.registroAns === d.registroAns),
        'registro-ans-em-uso',
        'Já existe operadora com este registro na ANS.',
        'registroAns',
      );
      unico(
        !s.operadoras.some((o) => o.hospital === h && o.id !== id && o.cnpj === d.cnpj),
        'cnpj-em-uso',
        'Já existe operadora com este CNPJ.',
        'cnpj',
      );
    };
    const conferirProduto = (d: ProdutoSgh, id: number | null) =>
      unico(
        !s.produtos.some((p) => p.operadora === d.operadora && p.id !== id && p.codigo === d.codigo),
        'codigo-em-uso',
        'Já existe produto com este código na operadora.',
        'codigo',
      );
    const conferirContrato = (d: ContratoSgh, operadora: number, id: number | null) =>
      unico(
        !s.contratos.some((c) => c.operadora === operadora && c.id !== id && c.numero === d.numero),
        'numero-em-uso',
        'Já existe contrato com este número na operadora.',
        'numero',
      );
    const ben = (id: number, versao: number) => {
      const i = s.beneficiarios.findIndex((b) => b.hospital === h && b.id === id && b.versao === versao);
      if (i < 0) throw desatualizado();
      return i;
    };
    const paraBen = (d: BeneficiarioSgh) => ({ ...d });
    return {
      gravarOperadora: async ({ id, versao, dados }) => {
        conferirOperadora(dados, id);
        if (id === null) {
          const novo = this.proximo('operadora');
          s.operadoras.push({ ...dados, id: novo, versao: 0, alteradoEm: agora(), hospital: h });
          return { id: novo };
        }
        const i = s.operadoras.findIndex((o) => o.hospital === h && o.id === id && o.versao === versao);
        if (i < 0) throw desatualizado();
        s.operadoras[i] = {
          ...s.operadoras[i]!,
          ...dados,
          versao: s.operadoras[i]!.versao + 1,
          alteradoEm: agora(),
        };
        return { id };
      },
      gravarProduto: async ({ id, versao, dados }) => {
        conferirProduto(dados, id);
        if (id === null) {
          const novo = this.proximo('produto');
          s.produtos.push({ ...dados, id: novo, versao: 0, alteradoEm: agora(), hospital: h });
          return { id: novo };
        }
        const i = s.produtos.findIndex(
          (p) => p.hospital === h && p.id === id && p.versao === versao && p.operadora === dados.operadora,
        );
        if (i < 0) throw desatualizado();
        s.produtos[i] = {
          ...s.produtos[i]!,
          ...dados,
          versao: s.produtos[i]!.versao + 1,
          alteradoEm: agora(),
        };
        return { id };
      },
      gravarContrato: async ({ operadora, id, versao, dados }) => {
        conferirContrato(dados, operadora, id);
        if (id === null) {
          const novo = this.proximo('contrato');
          s.contratos.push({ ...dados, id: novo, operadora, versao: 0, alteradoEm: agora(), hospital: h });
          return { id: novo };
        }
        const i = s.contratos.findIndex(
          (c) => c.hospital === h && c.id === id && c.versao === versao && c.operadora === operadora,
        );
        if (i < 0) throw desatualizado();
        s.contratos[i] = {
          ...s.contratos[i]!,
          ...dados,
          versao: s.contratos[i]!.versao + 1,
          alteradoEm: agora(),
        };
        return { id };
      },
      proximaSequenciaCarteirinha: async () => this.proximo('carteirinha'),
      incluirBeneficiario: async ({ operadora, dados, carteirinha, validade, por }) => {
        unico(
          !s.beneficiarios.some((b) => b.carteirinha === carteirinha),
          'carteirinha-em-uso',
          'O número de carteirinha gerado já existe: tente de novo.',
          'carteirinha',
        );
        const id = this.proximo('beneficiario');
        s.beneficiarios.push({
          ...paraBen(dados),
          id,
          operadora,
          carteirinha,
          via: 1,
          situacao: 'ativo',
          exclusao: null,
          motivoBaixa: null,
          versao: 0,
          alteradoEm: agora(),
          hospital: h,
        });
        s.vias.push({
          beneficiario: id,
          via: 1,
          motivo: null,
          validade,
          emitidaPor: por,
          emitidaEm: agora(),
          hospital: h,
        });
        return { id };
      },
      alterarBeneficiario: async ({ id, versao, dados }) => {
        const i = ben(id, versao);
        const b = s.beneficiarios[i]!;
        if (b.contrato !== dados.contrato) throw desatualizado();
        s.beneficiarios[i] = { ...b, ...paraBen(dados), versao: b.versao + 1, alteradoEm: agora() };
        return { id };
      },
      baixarBeneficiario: async ({ id, versao, motivo, data }) => {
        const i = ben(id, versao);
        const b = s.beneficiarios[i]!;
        if (b.situacao === 'excluido') throw desatualizado();
        const baixa = {
          situacao: 'excluido' as const,
          motivoBaixa: motivo,
          exclusao: data,
          alteradoEm: agora(),
        };
        s.beneficiarios[i] = { ...b, ...baixa, versao: b.versao + 1 };
        let dependentes = 0;
        s.beneficiarios = s.beneficiarios.map((d) => {
          if (d.hospital !== h || d.titular !== id || d.situacao === 'excluido') return d;
          dependentes += 1;
          return { ...d, ...baixa, versao: d.versao + 1 };
        });
        return { id, dependentes };
      },
      reativarBeneficiario: async ({ id, versao }) => {
        const i = ben(id, versao);
        const b = s.beneficiarios[i]!;
        if (b.situacao !== 'excluido') throw desatualizado();
        s.beneficiarios[i] = {
          ...b,
          situacao: 'ativo',
          motivoBaixa: null,
          exclusao: null,
          versao: b.versao + 1,
          alteradoEm: agora(),
        };
        return { id };
      },
      emitirVia: async ({ id, versao, motivo, validade, por }) => {
        const i = ben(id, versao);
        const b = s.beneficiarios[i]!;
        if (b.situacao !== 'ativo') throw desatualizado();
        const via = b.via + 1;
        s.beneficiarios[i] = { ...b, via, versao: b.versao + 1, alteradoEm: agora() };
        s.vias.push({
          beneficiario: id,
          via,
          motivo,
          validade,
          emitidaPor: por,
          emitidaEm: agora(),
          hospital: h,
        });
        return { id, via };
      },
    };
  }

  async gravarSgh<T>(
    c: ContextoOperadora,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorOperadora) => Promise<T>,
  ): Promise<T> {
    const antes = structuredClone(this.estado);
    try {
      const r = await fn(this.gravador(c.hospital));
      const l = typeof trilha === 'function' ? trilha(r) : trilha;
      await this.trilha?.registrar({
        evento: l.evento,
        rede: l.rede,
        hospital: l.hospital,
        usuario: l.usuario,
        estacao: l.estacao ?? 'memoria',
        correlacao: l.correlacao ?? l.evento,
        recurso: l.recurso,
        resultado: 'sucesso',
        tabelaAlvo: l.tabelaAlvo ?? 'MEMORIA',
        ...(l.idAlvo ? { idAlvo: l.idAlvo } : {}),
        ...(l.chaveNaturalAlvo ? { chaveNaturalAlvo: l.chaveNaturalAlvo } : {}),
      });
      return r;
    } catch (e) {
      this.estado = antes;
      throw e;
    }
  }
}
