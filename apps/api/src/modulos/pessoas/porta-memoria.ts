// Porta da gestão de pessoas EM MEMÓRIA (M52.1; dev/ci com a sessão sintética; E2E): pessoas, profissionais,
// registros de conselho e usuários SINTÉTICOS (CPF de dígito calculado sobre base inventada), centros de custo e
// tipos de rescisão sintéticos, com as MESMAS regras das gravações do banco (versão, matrícula única, histórico só de
// inclusão) e do bloqueio do M10 (ninguém a si mesmo; o já bloqueado recusa). O bloqueio vale no login sintético (o
// estado do acesso que a sessão sintética lê). A transação em memória é tudo ou nada (o estado só troca no fim).
// Nada vai ao banco; nenhum dado real.
import { PARENTESCOS_DEPENDENTE } from '@sgh/contratos';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import { CONTAS_SINTETICAS, estadoAcessoSintetico, idUsuarioSintetico } from '../acesso/fonte-sintetica.js';
import type { GravacaoFeita, LiberacaoGravacao, TrilhaDaGravacao } from '../exames/public-api.js';
import type {
  CargoQuadroLido,
  CentroCustoPessoas,
  ContextoPessoas,
  GravadorPessoas,
  OpcaoCodigo,
  PortaPessoas,
  RegistroConselhoBase,
} from './porta.js';
import {
  chaveMemoria,
  type CorrecaoRegistrada,
  type DependenteColaborador,
  type HabilitacaoRegistro,
  type HistoricoVinculo,
  type PessoaPorCpf,
  type ProfissionalCadastro,
  type RegistroDoColaborador,
  type RetratoConselhoDia,
  type UnidadeDoRegistro,
  type UsuarioDaPessoa,
  type VinculoColaborador,
} from './tipos-pessoas.js';

/** Estado das operações por estabelecimento (o catálogo de operações liberadas; null: operação desconhecida). */
export interface CatalogoOperacoes {
  estado(operacao: string, estabelecimento: string): string | null;
}

function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
/** CPF sintético válido a partir de 9 dígitos inventados (o mesmo cálculo do E2E). */
export function cpfSintetico(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}

/** As pessoas sintéticas: a enfermeira com profissional, registro e login; o técnico só com profissional; a pessoa nova. */
export const PESSOAS_SINTETICAS_M52 = {
  comLogin: { cpf: cpfSintetico('900520001'), profissional: 952001, registro: 952101, login: 'SINT.COLAB' },
  soProfissional: { cpf: cpfSintetico('900520002'), profissional: 952002, registro: 952102 },
  nova: { cpf: cpfSintetico('900520003') },
  /** M52.2: a enfermeira e o médico da escala sintética (profissionais com registro, sem login). */
  escalaEnfermeira: { cpf: cpfSintetico('900520004'), profissional: 952003, registro: 952103 },
  escalaMedico: { cpf: cpfSintetico('900520005'), profissional: 952004, registro: 952104 },
  /** M52.4: a colaboradora do ponto com login próprio (sem profissional): dá a ciência do próprio espelho no E2E. */
  ponto: { cpf: cpfSintetico('900520006'), login: 'SINT.COLAB.PONTO' },
} as const;

const PROFISSIONAIS: readonly ProfissionalCadastro[] = [
  {
    id: 952001,
    nome: 'ENFERMEIRA SINTETICA UM',
    nomeSocial: null,
    situacao: 'ativo',
    registros: [
      {
        id: 952101,
        profissional: 952001,
        conselho: 'COREN',
        sigla: 'COREN',
        numero: 52001,
        uf: 'RS',
        cbo: '223505',
        cboDescricao: 'Enfermeiro',
        ativo: true,
      },
    ],
  },
  {
    id: 952002,
    nome: 'TECNICO SINTETICO DOIS',
    nomeSocial: null,
    situacao: 'ativo',
    registros: [
      {
        id: 952102,
        profissional: 952002,
        conselho: 'COREN',
        sigla: 'COREN',
        numero: 52002,
        uf: 'RS',
        cbo: '322205',
        cboDescricao: 'Técnico de enfermagem',
        ativo: true,
      },
    ],
  },
  {
    id: 952003,
    nome: 'ENFERMEIRA SINTETICA TRES',
    nomeSocial: null,
    situacao: 'ativo',
    registros: [
      {
        id: 952103,
        profissional: 952003,
        conselho: 'COREN',
        sigla: 'COREN',
        numero: 52003,
        uf: 'RS',
        cbo: '223505',
        cboDescricao: 'Enfermeiro',
        ativo: true,
      },
    ],
  },
  {
    id: 952004,
    nome: 'MEDICO SINTETICO QUATRO',
    nomeSocial: null,
    situacao: 'ativo',
    registros: [
      {
        id: 952104,
        profissional: 952004,
        conselho: 'CRM',
        sigla: 'CRM',
        numero: 52004,
        uf: 'RS',
        cbo: '225125',
        cboDescricao: 'Médico clínico',
        ativo: true,
      },
    ],
  },
];

const CENTROS: readonly CentroCustoPessoas[] = [
  { codigo: 9521, nome: 'Enfermagem da clínica médica (sintético)', ativo: true },
  { codigo: 9522, nome: 'Pronto atendimento (sintético)', ativo: true },
  { codigo: 9523, nome: 'Recursos humanos (sintético)', ativo: true },
  { codigo: 9529, nome: 'Centro de custo encerrado (sintético)', ativo: false },
];
const UNIDADES: readonly OpcaoCodigo[] = [{ codigo: 1, nome: 'Unidade sintética' }];
// Os mesmos tipos (e códigos) da porta sintética da folha (`porta-calculo-memoria.ts`), para que a rescisão (M53.5)
// sugira a modalidade do tipo escolhido no desligamento.
const RESCISOES: readonly OpcaoCodigo[] = [
  { codigo: 1, nome: 'Demissão sem justa causa' },
  { codigo: 2, nome: 'Demissão por justa causa' },
  { codigo: 3, nome: 'Demissão por término de contrato de trabalho' },
  { codigo: 4, nome: 'Falecimento' },
  { codigo: 5, nome: 'Pedido de demissão' },
  { codigo: 6, nome: 'Pedido de demissão contrato de experiência' },
  { codigo: 7, nome: 'Termino do contrato a termo' },
  { codigo: 8, nome: 'Aposentadoria por tempo de serviço, com rescisão contratual' },
];

interface EstadoHospital {
  seq: number;
  vinculos: Map<number, VinculoColaborador & { cpfHmac: string }>;
  historico: Map<number, HistoricoVinculo & { vinculo: number }>;
  dependentes: Map<
    number,
    DependenteColaborador & {
      vinculo: number;
      ate: string | null;
      motivoFim: string | null;
      anterior?: number | null;
    }
  >;
  correcoes: CorrecaoRegistrada[];
  habilitacoes: Map<number, HabilitacaoRegistro>;
  outbox: { tipo: string; chave: string; carga: Record<string, string | number> }[];
  retrato: RetratoConselhoDia | null;
  idem: Map<string, { hash: string; resultado: GravacaoFeita['resultado'] }>;
}

const novoEstado = (): EstadoHospital => ({
  seq: 0,
  vinculos: new Map(),
  historico: new Map(),
  dependentes: new Map(),
  correcoes: [],
  habilitacoes: new Map(),
  outbox: [],
  retrato: null,
  idem: new Map(),
});

const copia = (s: EstadoHospital): EstadoHospital => ({
  seq: s.seq,
  vinculos: new Map(s.vinculos),
  historico: new Map(s.historico),
  dependentes: new Map(s.dependentes),
  correcoes: [...s.correcoes],
  habilitacoes: new Map(s.habilitacoes),
  outbox: [...s.outbox],
  retrato: s.retrato,
  idem: s.idem,
});

const recusa = (codigo: string, detalhe: string, campos?: readonly string[]) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe, campos ? { campos } : {});
const desatualizado = () =>
  recusa('desatualizado', 'O cadastro mudou depois que você abriu (outra pessoa gravou). Abra de novo.');
const hojeLocal = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const agora = () => new Date().toISOString().slice(0, 19);

export class PortaPessoasMemoria implements PortaPessoas {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, EstadoHospital>();
  /** Testes: a data do relógio sintético (sem ela, a data de hoje). */
  hojeFixo: string | null = null;
  /**
   * O catálogo sintético da tabela 07 do eSocial (tipo de dependente) vigente no cliente: os códigos da tela. Como na
   * porta própria, o parentesco fora dele recusa 'catalogo-pendente'; testes reduzem o conjunto para simular o cliente
   * sem o código carregado.
   */
  tabelaTipoDependente: ReadonlySet<string> = new Set(Object.keys(PARENTESCOS_DEPENDENTE));
  /**
   * W0-06 (5d-3a): de onde vem o cargo do quadro de cargos. O módulo liga a porta de cargos em memória; sem
   * ela, nenhum cargo existe (a ligação responde 404 do cargo).
   */
  quadroDeCargos: ((hospital: string, id: number) => Promise<CargoQuadroLido | null>) | null = null;

  constructor(private readonly catalogo: CatalogoOperacoes | null = null) {}

  private e(c: ContextoPessoas): EstadoHospital {
    const k = chaveMemoria(c);
    let s = this.estados.get(k);
    if (!s) this.estados.set(k, (s = novoEstado()));
    return s;
  }

  /** M52.2: o HMAC do CPF do vínculo (a escala em memória confere a sobreposição na Rede por ele). */
  cpfHmacDoVinculo(hospital: string, id: number): string | null {
    return this.estados.get(hospital)?.vinculos.get(id)?.cpfHmac ?? null;
  }

  /** Testes: o que foi à outbox no estabelecimento. */
  eventos(hospital: string) {
    return [...(this.estados.get(hospital)?.outbox ?? [])];
  }

  /** Testes e o worker em memória: grava o retrato do dia. */
  gravarRetrato(estabelecimento: string, d: RetratoConselhoDia): void {
    let s = this.estados.get(estabelecimento);
    if (!s) this.estados.set(estabelecimento, (s = novoEstado()));
    s.retrato = d;
  }

  private bloqueado(login: string): boolean {
    return estadoAcessoSintetico().bloqueio.get(login) ?? CONTAS_SINTETICAS[login]?.bloqueado ?? false;
  }

  private usuario(login: string): UsuarioDaPessoa {
    return {
      id: idUsuarioSintetico(login),
      login,
      bloqueado: this.bloqueado(login),
      ativo: CONTAS_SINTETICAS[login]?.ativo ?? true,
      grupo: CONTAS_SINTETICAS[login]?.concessoes?.grupo ?? null,
    };
  }

  async podeGravar(c: ContextoPessoas, op: string): Promise<LiberacaoGravacao> {
    const e = this.catalogo?.estado(op, chaveMemoria(c)) ?? 'verde';
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento.',
      };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(
    c: ContextoPessoas,
    op: string,
    bruto: unknown,
    ctx: ContextoOperacao,
  ): Promise<GravacaoFeita> {
    if (op !== 'acesso.bloquearUsuario')
      throw recusa('operacao-desconhecida', 'Operação fora da gestão de pessoas.');
    const login = String((bruto as { login?: unknown })?.login ?? '');
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== login)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A chave já foi usada.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    if (ctx.usuario !== null && idUsuarioSintetico(login) === ctx.usuario)
      throw recusa('a-si-mesmo', 'Ninguém bloqueia nem desbloqueia a si mesmo.');
    if (!CONTAS_SINTETICAS[login]) throw recusa('usuario-inexistente', 'Usuário inexistente.');
    if (this.bloqueado(login)) throw recusa('ja-bloqueado', 'O usuário já está bloqueado.');
    estadoAcessoSintetico().bloqueio.set(login, true);
    const resultado = { idUsuario: idUsuarioSintetico(login) };
    s.idem.set(chave, { hash: login, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  async gravarSgh<T>(
    c: ContextoPessoas,
    _trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorPessoas) => Promise<T>,
  ): Promise<T> {
    const s = copia(this.e(c));
    const vinc = (id: number) => s.vinculos.get(id) ?? null;
    const g: GravadorPessoas = {
      vinculo: async (id) => vinc(id),
      vinculosPorCpf: async (h) => [...s.vinculos.values()].filter((v) => v.cpfHmac === h),
      vinculosAtivosDoUsuario: async (u) =>
        [...s.vinculos.values()]
          .filter((v) => v.usuario === u && v.desligamento === null)
          .map((v) => ({ id: v.id, pessoa: v.pessoa })),
      ultimaVigencia: async (v) =>
        [...s.historico.values()]
          .filter((h) => h.vinculo === v && h.tipo !== 'correcao')
          .map((h) => h.vigencia)
          .sort()
          .at(-1) ?? null,
      incluirVinculo: async (v) => {
        if (v.matricula && [...s.vinculos.values()].some((x) => x.matricula === v.matricula))
          throw recusa('matricula-em-uso', 'Já existe colaborador com esta matrícula neste estabelecimento.');
        const id = ++s.seq;
        const pessoa = v.pessoa ?? id;
        s.vinculos.set(id, {
          id,
          estabelecimento: c.estabelecimento,
          pessoa,
          cpfHmac: v.cpfHmac,
          cpfCifrado: v.cpfCifrado,
          nome: v.nome,
          profissional: v.profissional,
          usuario: v.usuario,
          tipo: v.tipo,
          matricula: v.matricula,
          cargo: v.cargo,
          funcao: v.funcao,
          cargaSemanal: v.cargaSemanal,
          centroCusto: v.centroCusto,
          unidade: v.unidade,
          setor: v.setor,
          admissao: v.admissao,
          desligamento: null,
          tipoRescisao: null,
          motivoDesligamento: null,
          desligadoPor: null,
          versao: 0,
          criadoPor: v.por,
          criadoEm: agora(),
        });
        await g.incluirHistorico({
          vinculo: id,
          tipo: 'admissao',
          vigencia: v.admissao,
          antes: null,
          depois: `${v.cargo} · ${v.cargaSemanal} h semanais · centro de custo ${v.centroCusto}`,
          motivo: null,
          por: v.por,
        });
        return { id, pessoa };
      },
      alterarVinculo: async (m) => {
        const v = vinc(m.id);
        if (!v || v.versao !== m.versao || v.desligamento !== null) throw desatualizado();
        s.vinculos.set(m.id, {
          ...v,
          cargo: m.cargo,
          funcao: m.funcao,
          cargaSemanal: m.cargaSemanal,
          centroCusto: m.centroCusto,
          unidade: m.unidade,
          setor: m.setor,
          versao: v.versao + 1,
        });
      },
      desligarVinculo: async (d) => {
        const v = vinc(d.id);
        if (!v || v.versao !== d.versao || v.desligamento !== null) throw desatualizado();
        s.vinculos.set(d.id, {
          ...v,
          desligamento: d.data,
          tipoRescisao: d.tipoRescisao,
          motivoDesligamento: d.motivo,
          desligadoPor: d.por,
          versao: v.versao + 1,
        });
        await g.incluirHistorico({
          vinculo: d.id,
          tipo: 'desligamento',
          vigencia: d.data,
          antes: 'ativo',
          depois: 'desligado',
          motivo: d.motivo,
          por: d.por,
        });
      },
      incluirHistorico: async (h) => {
        const id = ++s.seq;
        s.historico.set(id, {
          id,
          vinculo: h.vinculo,
          tipo: h.tipo,
          vigencia: h.vigencia,
          antes: h.antes,
          depois: h.depois,
          motivo: h.motivo,
          registradoPor: h.por,
          registradoEm: agora(),
        });
        return id;
      },
      incluirDependente: async (d) => {
        // As mesmas recusas da porta própria: vínculo deste estabelecimento, tipo no catálogo da tabela 07 e CPF único
        // entre os dependentes do colaborador (o colaborador é o CPF do titular: vários vínculos, os mesmos dependentes).
        const v = vinc(d.vinculo);
        if (!v) throw desatualizado();
        if (!this.tabelaTipoDependente.has(d.parentesco))
          throw recusa(
            'catalogo-pendente',
            `O tipo de dependente ${d.parentesco} não está na tabela 07 do eSocial carregada neste cliente.`,
            ['parentesco'],
          );
        if (
          d.cpfHmac &&
          [...s.dependentes.values()].some(
            (x) => x.cpfHmac === d.cpfHmac && vinc(x.vinculo)?.cpfHmac === v.cpfHmac,
          )
        )
          throw recusa('cpf-repetido', 'Este CPF já é de outro dependente deste colaborador.', ['cpf']);
        // A dependência vale da inclusão (nunca antes do nascimento).
        const hoje = this.hojeFixo ?? hojeLocal();
        const id = ++s.seq;
        s.dependentes.set(id, {
          id,
          vinculo: d.vinculo,
          nome: d.nome,
          nascimento: d.nascimento,
          parentesco: d.parentesco,
          cpfHmac: d.cpfHmac,
          cpfCifrado: d.cpfCifrado,
          dependenteIr: d.dependenteIr,
          dependenteSalarioFamilia: d.dependenteSalarioFamilia,
          desde: hoje < d.nascimento ? d.nascimento : hoje,
          ate: null,
          motivoFim: null,
        });
        return id;
      },
      cargoQuadro: async (id) => (this.quadroDeCargos ? this.quadroDeCargos(chaveMemoria(c), id) : null),
      ligarCargo: async (x) => {
        const v = vinc(x.id);
        if (!v || v.versao !== x.versao) throw desatualizado();
        s.vinculos.set(x.id, { ...v, idCargo: x.cargo, versao: v.versao + 1 });
      },
      corrigirVinculo: async (x) => {
        const v = vinc(x.id);
        if (!v || v.versao !== x.versao) throw desatualizado();
        if (x.matricula && [...s.vinculos.values()].some((o) => o.id !== x.id && o.matricula === x.matricula))
          throw recusa('matricula-em-uso', 'Já existe colaborador com esta matrícula neste estabelecimento.');
        s.vinculos.set(x.id, {
          ...v,
          nome: x.nome,
          matricula: x.matricula,
          tipo: x.tipo,
          admissao: x.admissao,
          versao: v.versao + 1,
        });
      },
      versionarDependente: async (d) => {
        const x = s.dependentes.get(d.anterior);
        if (!x || x.vinculo !== d.vinculo || x.ate !== null) throw desatualizado();
        const vespera = new Date(`${d.desde}T12:00:00Z`);
        vespera.setUTCDate(vespera.getUTCDate() - 1);
        s.dependentes.set(x.id, {
          ...x,
          ate: vespera.toISOString().slice(0, 10),
          motivoFim: `Alterado (nova versão): ${d.motivo}`.slice(0, 200),
        });
        const id = ++s.seq;
        s.dependentes.set(id, {
          id,
          vinculo: d.vinculo,
          nome: d.nome,
          nascimento: d.nascimento,
          parentesco: d.parentesco,
          cpfHmac: d.cpfHmac,
          cpfCifrado: d.cpfCifrado,
          dependenteIr: d.dependenteIr,
          dependenteSalarioFamilia: d.dependenteSalarioFamilia,
          desde: d.desde,
          ate: null,
          motivoFim: null,
          anterior: d.anterior,
        });
        return id;
      },
      registrarCorrecao: async (x) => {
        // Cópia profunda: o valor anterior não pode mudar com a gravação seguinte (armadilha da parte 2).
        s.correcoes.push({
          id: ++s.seq,
          tabela: 'vinculo_trabalho',
          registro: x.vinculo,
          operacao: x.operacao,
          antes: JSON.parse(JSON.stringify(x.antes)) as Record<string, unknown>,
          depois: JSON.parse(JSON.stringify(x.depois)) as Record<string, unknown>,
          motivo: x.motivo,
          por: x.por,
          em: agora().slice(0, 16),
        });
      },
      encerrarDependente: async (d) => {
        const x = s.dependentes.get(d.id);
        if (!x || x.vinculo !== d.vinculo || x.ate !== null) throw desatualizado();
        s.dependentes.set(d.id, { ...x, ate: d.ate, motivoFim: d.motivo });
      },
      gravarHabilitacao: async (h) => {
        const atual = s.habilitacoes.get(h.registro);
        s.habilitacoes.set(h.registro, {
          registro: h.registro,
          numero: h.numero,
          conselho: h.conselho,
          validade: h.validade,
          conferidoEm: h.conferidoEm,
          conferidoPor: h.por,
          observacao: h.observacao,
          versao: (atual?.versao ?? -1) + 1,
        });
        return { id: h.registro };
      },
      outbox: async (ev) => {
        s.outbox.push(ev);
        return String(s.outbox.length);
      },
    };
    const r = await fn(g);
    this.estados.set(chaveMemoria(c), s);
    return r;
  }

  async hoje(): Promise<string> {
    return this.hojeFixo ?? hojeLocal();
  }
  async centrosDeCusto(): Promise<CentroCustoPessoas[]> {
    return [...CENTROS];
  }
  async unidades(): Promise<OpcaoCodigo[]> {
    return [...UNIDADES];
  }
  async tiposRescisao(): Promise<OpcaoCodigo[]> {
    return [...RESCISOES];
  }

  /** C1-111: catálogos sintéticos da ficha da admissão (a porta em memória não exige a ficha). */
  async catalogosAdmissao() {
    return {
      sexos: [
        { codigo: 1, nome: 'Feminino' },
        { codigo: 2, nome: 'Masculino' },
      ],
      categorias: [{ codigo: 101, nome: '101 - Empregado geral' }],
      tiposVinculo: [{ codigo: 10101, nome: 'Empregatício: celetista (prazo indeterminado)' }],
    };
  }

  async pessoaPorCpf(_c: ContextoPessoas, cpf: number): Promise<PessoaPorCpf> {
    const d = String(cpf).padStart(11, '0');
    const P = PESSOAS_SINTETICAS_M52;
    const prof = (id: number) => {
      const p = PROFISSIONAIS.find((x) => x.id === id)!;
      return { id: p.id, nome: p.nome, registros: p.registros.length };
    };
    if (d === P.comLogin.cpf)
      return { profissionais: [prof(P.comLogin.profissional)], usuarios: [this.usuario(P.comLogin.login)] };
    if (d === P.soProfissional.cpf)
      return { profissionais: [prof(P.soProfissional.profissional)], usuarios: [] };
    if (d === P.escalaEnfermeira.cpf)
      return { profissionais: [prof(P.escalaEnfermeira.profissional)], usuarios: [] };
    if (d === P.escalaMedico.cpf) return { profissionais: [prof(P.escalaMedico.profissional)], usuarios: [] };
    if (d === P.ponto.cpf) return { profissionais: [], usuarios: [this.usuario(P.ponto.login)] };
    return { profissionais: [], usuarios: [] };
  }
  async usuariosDoProfissional(_c: ContextoPessoas, profissional: number): Promise<UsuarioDaPessoa[]> {
    return profissional === PESSOAS_SINTETICAS_M52.comLogin.profissional
      ? [this.usuario(PESSOAS_SINTETICAS_M52.comLogin.login)]
      : [];
  }
  async usuarioPorId(_c: ContextoPessoas, id: number): Promise<UsuarioDaPessoa | null> {
    const login = Object.keys(CONTAS_SINTETICAS).find((l) => idUsuarioSintetico(l) === id);
    return login ? this.usuario(login) : null;
  }
  async profissionais(_c: ContextoPessoas, ids: readonly number[]): Promise<ProfissionalCadastro[]> {
    return PROFISSIONAIS.filter((p) => ids.includes(p.id));
  }
  async vinculosPorCpf(c: ContextoPessoas, h: string): Promise<VinculoColaborador[]> {
    return [...this.e(c).vinculos.values()].filter((v) => v.cpfHmac === h);
  }
  async vinculo(c: ContextoPessoas, id: number): Promise<VinculoColaborador | null> {
    return this.e(c).vinculos.get(id) ?? null;
  }
  async vinculosDaPessoa(c: ContextoPessoas, pessoa: number): Promise<VinculoColaborador[]> {
    return [...this.e(c).vinculos.values()].filter((v) => v.pessoa === pessoa);
  }
  async listarVinculos(
    c: ContextoPessoas,
    f: Parameters<PortaPessoas['listarVinculos']>[1],
  ): Promise<{ itens: VinculoColaborador[]; depois: number | null }> {
    const termo = f.cpfHmac ? undefined : f.termo?.trim().toUpperCase();
    const setor = f.setor?.trim().toUpperCase();
    const todos = [...this.e(c).vinculos.values()]
      .filter(
        (v) =>
          (!f.cpfHmac || v.cpfHmac === f.cpfHmac) &&
          (f.centroCusto === undefined || v.centroCusto === f.centroCusto) &&
          (f.unidade === undefined || v.unidade === f.unidade) &&
          (!setor || (v.setor ?? '').toUpperCase().includes(setor)) &&
          (!f.tipo || v.tipo === f.tipo) &&
          (f.estado === 'todos' || (f.estado === 'ativo') === (v.desligamento === null)) &&
          (!termo || v.nome.toUpperCase().includes(termo) || v.matricula === f.termo?.trim()) &&
          (f.depois === undefined || v.id > f.depois),
      )
      .sort((a, b) => a.id - b.id);
    const itens = todos.slice(0, f.limite);
    return { itens, depois: todos.length > f.limite ? (itens.at(-1)?.id ?? null) : null };
  }
  async historico(c: ContextoPessoas, v: number): Promise<HistoricoVinculo[]> {
    return [...this.e(c).historico.values()]
      .filter((h) => h.vinculo === v)
      .sort((a, b) => b.vigencia.localeCompare(a.vigencia) || b.id - a.id);
  }
  async dependentes(c: ContextoPessoas, v: number): Promise<DependenteColaborador[]> {
    return [...this.e(c).dependentes.values()]
      .filter((d) => d.vinculo === v && d.ate === null)
      .map((d): DependenteColaborador => ({
        id: d.id,
        nome: d.nome,
        nascimento: d.nascimento,
        parentesco: d.parentesco,
        cpfHmac: d.cpfHmac,
        cpfCifrado: d.cpfCifrado,
        dependenteIr: d.dependenteIr,
        dependenteSalarioFamilia: d.dependenteSalarioFamilia,
        desde: d.desde ?? null,
      }));
  }
  async correcoes(c: ContextoPessoas, v: number): Promise<CorrecaoRegistrada[]> {
    return this.e(c)
      .correcoes.filter((x) => x.registro === v)
      .sort((a, b) => b.id - a.id);
  }
  async habilitacoes(c: ContextoPessoas, regs: readonly number[]): Promise<Map<number, HabilitacaoRegistro>> {
    const h = this.e(c).habilitacoes;
    return new Map(regs.filter((r) => h.has(r)).map((r) => [r, h.get(r)!]));
  }
  async registrosDosColaboradoresAtivos(c: ContextoPessoas): Promise<RegistroDoColaborador[]> {
    const ativos = [...this.e(c).vinculos.values()]
      .filter((v) => v.desligamento === null && v.profissional !== null)
      .sort((a, b) => a.id - b.id);
    const r: RegistroDoColaborador[] = [];
    for (const p of PROFISSIONAIS) {
      const v = ativos.find((x) => x.profissional === p.id);
      if (!v) continue;
      for (const g of p.registros)
        r.push({
          registro: g.id,
          profissional: p.id,
          conselho: g.conselho,
          numero: g.numero,
          ativo: g.ativo,
          vinculo: v.id,
          nome: v.nome,
        });
    }
    return r;
  }
  async registroConselho(_c: ContextoPessoas, registro: number): Promise<RegistroConselhoBase | null> {
    for (const p of PROFISSIONAIS)
      for (const g of p.registros)
        if (g.id === registro)
          return { registro: g.id, profissional: p.id, numero: g.numero, conselho: g.conselho };
    return null;
  }
  async unidadesDosRegistros(
    _c: ContextoPessoas,
    registros: readonly number[],
  ): Promise<Map<number, UnidadeDoRegistro[]>> {
    // O registro da enfermeira sintética atende na unidade sintética; o do técnico, em nenhuma.
    const r = new Map<number, UnidadeDoRegistro[]>();
    if (registros.includes(PESSOAS_SINTETICAS_M52.comLogin.registro))
      r.set(PESSOAS_SINTETICAS_M52.comLogin.registro, [
        { codigo: 1, nome: 'Unidade sintética', ativo: true },
      ]);
    return r;
  }
  async ultimoRetrato(c: ContextoPessoas): Promise<RetratoConselhoDia | null> {
    return this.e(c).retrato;
  }
  async cargoQuadro(c: ContextoPessoas, id: number): Promise<CargoQuadroLido | null> {
    return this.quadroDeCargos ? this.quadroDeCargos(chaveMemoria(c), id) : null;
  }
}
