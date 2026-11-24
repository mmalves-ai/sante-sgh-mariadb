// Porta do cadastro EM MEMÓRIA (M11): a sessão sintética de dev/ci (E2E) lê e grava pacientes, profissionais,
// solicitantes, pessoas e especialidades SINTÉTICOS, sem tocar a cópia. As linhas guardam os nomes de coluna do
// legado para a leitura passar pelo MESMO decodificador (pacienteDaLinha) e pela mesma versão do controle
// otimista (versaoDaLinhaPaciente) do núcleo; as gravações aplicam o mesmo Zod dos contratos e as mesmas
// recusas da receita (CPF existente, CEP inexistente, colisão, sem alteração, cadastro inativo). Nenhum nome
// aqui é de pessoa real (marca "SINTETICO").
import {
  type AlterarPacienteEntrada,
  type CampoBusca,
  chavesDeBusca,
  type ChaveBusca,
  type EntidadeBusca,
  esquemaAlterarPaciente,
  esquemaCadastrarPaciente,
  esquemaCadastrarSolicitante,
  esquemaUnificarPaciente,
  esquemaDesfazerUnificacao,
  type DesfazerUnificacaoEntrada,
  type EstadoOperacao,
  type UnificarPacienteEntrada,
} from '@sgh/contratos';
import { erroConflitoVersao, erroEntradaInvalida, type Linha, recusa } from '@sgh/nucleo';
import { lerVersaoColunas, versaoDasColunas } from './memoria-versao.js';
import type {
  ConsentimentoPaciente,
  ContextoGravacao,
  LiberacaoOperacao,
  OpcaoDominio,
  PacienteFicha,
  ParFila,
  VersaoCadastro,
} from './tipos.js';
import type { ContextoPorta, EstadoCatalogo, PortaCadastro } from './porta.js';
import { type OperacaoProfissionalTela, ProfissionaisMemoria } from './profissionais-memoria.js';

// ---- Linha sintética da memória (dev/ci) ----
// A memória guarda cada paciente como uma linha de colunas curtas (a mesma forma desde o M11) e a decodifica aqui para
// a ficha. Só a memória conhece estas colunas; a porta própria lê o modelo do banco.

/** Campo da ficha → coluna da linha sintética. */
const COLUNA_DO_CAMPO_PACIENTE: Readonly<Record<string, string>> = {
  nome: 'NOME',
  nascimento: 'NASC',
  sexo: 'SEXO',
  nomeMae: 'MAE',
  naturalidade: 'NAT',
  ufNaturalidade: 'NATUF',
  cpf: 'CPF',
  identidade: 'IDENT',
  estadoCivil: 'ECIV',
  cep: 'CEP',
  logradouro: 'ENDERECO',
  numero: 'NUMERO',
  complemento: 'COMPL',
  bairro: 'BAIRRO',
  telefone: 'FONE',
  celular: 'CELULAR',
  email: 'EMAIL',
  contatoNome: 'CONTATO',
  contatoTelefone: 'FCONT',
};
const CAMPO_DA_COLUNA: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(COLUNA_DO_CAMPO_PACIENTE).map(([c, k]) => [k, c])),
  CARIMBO: 'versao',
  ATIVO: 'situacao',
};
/** Colunas da versão opaca (o carimbo é obrigatório; documentos saem para quem não os vê). */
const COLUNAS_VERSAO_PACIENTE = ['CARIMBO', ...Object.values(COLUNA_DO_CAMPO_PACIENTE), 'ATIVO'] as const;
const COLUNAS_DOCUMENTO_VERSAO: readonly string[] = ['CPF', 'IDENT'];

function versaoDaLinhaPaciente(l: Linha): string {
  return versaoDasColunas(COLUNAS_VERSAO_PACIENTE, l);
}
function lerVersaoPaciente(versao: string): Record<string, string | null> | null {
  return lerVersaoColunas(versao, COLUNAS_VERSAO_PACIENTE, { todas: false, obrigatoria: 'CARIMBO' });
}

const textoOuNulo = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};
const inteiroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const dataOuNula = (v: unknown): string | null => {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return null;
  const p = (n: number, t = 2) => String(n).padStart(t, '0');
  return `${p(v.getFullYear(), 4)}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
};
const instanteOuNulo = (v: unknown): string | null => {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return null;
  const p = (n: number, t = 2) => String(n).padStart(t, '0');
  return `${dataOuNula(v)}T${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}.${p(v.getMilliseconds(), 3)}`;
};

function pacienteDaLinha(l: Linha): PacienteFicha {
  const id = inteiroOuNulo(l['ID']) ?? 0;
  const unif = inteiroOuNulo(l['UNIFICADO_EM']);
  const cpf = inteiroOuNulo(l['CPF']);
  const cep = inteiroOuNulo(l['CEP']);
  const cns = textoOuNulo(l['CNS'])?.replace(/\D+/g, '') ?? '';
  const sexo = textoOuNulo(l['SEXO']);
  return {
    id,
    prontuario: inteiroOuNulo(l['PRONT']) ?? 0,
    prontuarioAnterior: inteiroOuNulo(l['PRONT_ANTERIOR']),
    nome: textoOuNulo(l['NOME']) ?? '',
    nomeSocial: textoOuNulo(l['APELIDO']),
    nascimento: dataOuNula(l['NASC']),
    sexo: sexo === 'F' || sexo === 'M' ? sexo : null,
    mae: textoOuNulo(l['MAE']),
    maeDesconhecida: l['MAE_DESCONHECIDA'] === true,
    pai: textoOuNulo(l['PAI']),
    cpf: cpf === null || cpf <= 0 ? null : String(cpf).padStart(11, '0'),
    cns: cns === '' ? null : cns,
    identidade: textoOuNulo(l['IDENT']),
    estadoCivil: inteiroOuNulo(l['ECIV']),
    naturalidade: textoOuNulo(l['NAT']),
    ufNaturalidade: textoOuNulo(l['NATUF']),
    nacionalidade: textoOuNulo(l['NAC']),
    nacionalidadeCodigo: inteiroOuNulo(l['NACIONALIDADE']),
    cep: cep === null || cep <= 0 ? null : String(cep).padStart(8, '0'),
    logradouro: textoOuNulo(l['ENDERECO']),
    numero: inteiroOuNulo(l['NUMERO']),
    complemento: textoOuNulo(l['COMPL']),
    bairro: textoOuNulo(l['BAIRRO']),
    cidade: textoOuNulo(l['CIDADE']),
    uf: textoOuNulo(l['UF']),
    telefone: textoOuNulo(l['FONE']),
    celular: textoOuNulo(l['CELULAR']),
    email: textoOuNulo(l['EMAIL']),
    contatoNome: textoOuNulo(l['CONTATO']),
    contatoTelefone: textoOuNulo(l['FCONT']),
    racaCor: inteiroOuNulo(l['COR']),
    religiao: inteiroOuNulo(l['RELIG']),
    responsavelLegal: textoOuNulo(l['RESPONSAVEL']),
    ativo: l['ATIVO'] !== false,
    unificadoEm: unif !== null && unif !== id ? unif : null,
    obito: dataOuNula(l['OBITO']),
    cadastradoEm: dataOuNula(l['CADASTRO']),
    alteradoEm: dataOuNula(l['ALTERACAO']),
    alergia: textoOuNulo(l['ALERGIA']),
    medicamentos: textoOuNulo(l['MEDICAMENTOS']),
    carimbo: instanteOuNulo(l['CARIMBO']),
    versao: versaoDaLinhaPaciente(l),
  };
}

const M = 'SINTETICO';
const data = (iso: string) =>
  new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** CEPs sintéticos (logradouro, bairro, cidade, UF, IBGE, tipo de logradouro). */
const CEPS: Readonly<Record<string, Linha>> = {
  '30130000': {
    LOGRA: 'AVENIDA SINTETICA',
    BAIRRO: 'CENTRO',
    CIDADE: 'BELO HORIZONTE',
    UF: 'MG',
    ID_TBMUIBGE: 3106200,
    TPLGR: 8,
  },
  '20040000': {
    LOGRA: 'RUA DO TESTE',
    BAIRRO: 'CENTRO',
    CIDADE: 'RIO DE JANEIRO',
    UF: 'RJ',
    ID_TBMUIBGE: 3304557,
    TPLGR: 81,
  },
  '01001000': {
    LOGRA: 'PRACA DA AMOSTRA',
    BAIRRO: 'SE',
    CIDADE: 'SAO PAULO',
    UF: 'SP',
    ID_TBMUIBGE: 3550308,
    TPLGR: 65,
  },
};

const ESTADOS_CIVIS: OpcaoDominio[] = [
  { codigo: 1, rotulo: 'SOLTEIRO(A)' },
  { codigo: 2, rotulo: 'CASADO(A)' },
  { codigo: 3, rotulo: 'VIUVO(A)' },
];

interface PacienteBase {
  id: number;
  nome: string;
  nasc: string;
  sexo: 'F' | 'M';
  mae?: string;
  cpf?: number;
  fone?: string;
  celular?: string;
  cep?: string;
  apelido?: string;
  ativo?: boolean;
  unificado?: number;
  cor?: number;
  relig?: number;
  eciv?: number;
  alergia?: string;
}

/** Pacientes sintéticos: homônimos (mesmo nome e nascimento), CPF repetido, nome acentuado, grafia parecida. */
const PACIENTES: readonly PacienteBase[] = [
  {
    id: 1001,
    nome: `JOSÉ DA SILVA ${M}`,
    nasc: '1980-03-15',
    sexo: 'M',
    mae: `MARIA DA SILVA ${M}`,
    cpf: 90000000175,
    celular: '31987650001',
    cep: '30130000',
    cor: 1,
    relig: 1,
    eciv: 2,
    alergia: 'DIPIRONA (TEXTO DO LEGADO)',
  },
  {
    id: 1002,
    nome: `JOSÉ DA SILVA ${M}`,
    nasc: '1980-03-15',
    sexo: 'M',
    mae: `MARIA DA SILVA ${M}`,
    fone: '3133330002',
    cep: '30130000',
  },
  {
    id: 1003,
    nome: `CINTHYA GABRIELLA VIANNA ${M}`,
    nasc: '1992-07-01',
    sexo: 'F',
    mae: `ANA VIANNA ${M}`,
    cpf: 90000000256,
    celular: '21987650003',
    cep: '20040000',
    apelido: `GABI ${M}`,
  },
  {
    id: 1004,
    nome: `ANTÔNIO CONCEIÇÃO ${M}`,
    nasc: '1955-12-24',
    sexo: 'M',
    mae: `JOANA CONCEIÇÃO ${M}`,
    cpf: 12345678909,
    fone: '1133330004',
    cep: '01001000',
  },
  {
    id: 1005,
    nome: `MARIA APARECIDA ${M}`,
    nasc: '1970-01-20',
    sexo: 'F',
    mae: `TEREZA ${M}`,
    cpf: 12345678909,
    cep: '01001000',
  },
  {
    id: 1006,
    nome: `PEDRO ANTIGO ${M}`,
    nasc: '1990-05-05',
    sexo: 'M',
    ativo: false,
    unificado: 1004,
    cep: '01001000',
  },
  {
    id: 1007,
    nome: `LETÍCIA ROCHA ${M}`,
    nasc: '2001-09-09',
    sexo: 'F',
    mae: `ROSA ROCHA ${M}`,
    celular: '21987650007',
    cep: '20040000',
  },
];

function linhaDoPaciente(p: PacienteBase): Linha {
  return {
    ID: p.id,
    PRONT: p.id - 1000 + 500,
    PRONT_ANTERIOR: null,
    NOME: p.nome,
    APELIDO: p.apelido ?? '',
    NASC: data(p.nasc),
    SEXO: p.sexo,
    MAE: p.mae ?? '',
    MAE_DESCONHECIDA: false,
    PAI: '',
    CPF: p.cpf ?? null,
    CNS: null,
    IDENT: '',
    ECIV: p.eciv ?? null,
    NAT: 'CIDADE SINTETICA',
    NATUF: 'MG',
    NAC: 'BRASIL',
    NACIONALIDADE: 10,
    CEP: Number(p.cep ?? '30130000'),
    ENDERECO: String(CEPS[p.cep ?? '30130000']?.['LOGRA'] ?? ''),
    NUMERO: 100,
    COMPL: '',
    BAIRRO: String(CEPS[p.cep ?? '30130000']?.['BAIRRO'] ?? ''),
    CIDADE: String(CEPS[p.cep ?? '30130000']?.['CIDADE'] ?? ''),
    UF: String(CEPS[p.cep ?? '30130000']?.['UF'] ?? ''),
    FONE: p.fone ?? '',
    CELULAR: p.celular ?? '',
    EMAIL: '',
    CONTATO: '',
    FCONT: '',
    COR: p.cor ?? null,
    RELIG: p.relig ?? null,
    RESPONSAVEL: '',
    ATIVO: p.ativo ?? true,
    UNIFICADO_EM: p.unificado ?? p.id,
    OBITO: null,
    CADASTRO: data('2026-01-10'),
    ALTERACAO: data('2026-01-10'),
    ALERGIA: p.alergia ?? '',
    MEDICAMENTOS: '',
    CARIMBO: new Date(2026, 0, 10, 9, 0, 0),
    USUARIO: 'SINT.RECEPCAO',
  };
}

const SOLICITANTES = [
  {
    id: 1,
    nome: `DR SOLICITANTE UM ${M}`,
    conselho: 'CRM',
    numero: 70001,
    uf: 'MG',
    cbo: '225125',
    ativo: true,
    codigosConvenio: 2,
  },
  {
    id: 2,
    nome: `DR SOLICITANTE UM ${M} REPETIDO`,
    conselho: 'CRM',
    numero: 70001,
    uf: 'MG',
    cbo: '225125',
    ativo: true,
    codigosConvenio: 0,
  },
  {
    id: 3,
    nome: `DRA SEM CBO ${M}`,
    conselho: 'CRM',
    numero: 70003,
    uf: 'RJ',
    cbo: null,
    ativo: true,
    codigosConvenio: 1,
  },
] as const;

interface Estado {
  pacientes: Map<number, Linha>;
  historico: Map<number, VersaoCadastro[]>;
  indice: Map<string, { entidade: EntidadeBusca; id: number; chave: ChaveBusca }[]>;
  fila: Map<number, ParFila & { justificativa?: string }>;
  consentimentos: Map<number, ConsentimentoPaciente & { idPaciente: number }>;
  gerador: number;
  geradorHt: number;
  geradorFila: number;
  geradorCons: number;
  /** Revisão do M39: os solicitantes incluídos pela tela (sintéticos, além dos fixos). */
  /** D-PROF-39: o corpo clínico sintético (lido e gravado pelas regras das receitas). */
  profissionais: ProfissionaisMemoria;
  solicitantes: {
    id: number;
    nome: string;
    conselho: string;
    numero: number;
    uf: string;
    cbo: null;
    ativo: true;
    codigosConvenio: number;
  }[];
}

/** Revisão do M39: o cadastro de conselhos sintético (sigla → ID), como conselho profissional. */
const CONSELHOS: Readonly<Record<string, number>> = { CRM: 1, COREN: 2, CRO: 3, CRF: 4, CREFITO: 6 };

/** Campos do retrato da linha do tempo (pelo nome do campo da ficha) → coluna da linha sintética. */
const COLUNAS_RETRATO: Readonly<Record<string, string>> = {
  nome: 'NOME',
  nomeSocial: 'APELIDO',
  nascimento: 'NASC',
  sexo: 'SEXO',
  nomeMae: 'MAE',
  cpf: 'CPF',
  identidade: 'IDENT',
  estadoCivil: 'ECIV',
  naturalidade: 'NAT',
  cep: 'CEP',
  logradouro: 'ENDERECO',
  numero: 'NUMERO',
  complemento: 'COMPL',
  bairro: 'BAIRRO',
  email: 'EMAIL',
  racaCor: 'COR',
  religiao: 'RELIG',
};

function retrato(l: Linha, id: number, usuario: string): VersaoCadastro {
  const valores: Record<string, unknown> = {};
  for (const [h, r] of Object.entries(COLUNAS_RETRATO)) valores[h] = l[r] ?? null;
  const fones: { tipo: number; numero: string }[] = [];
  if (String(l['FONE'] ?? '').trim()) fones.push({ tipo: 1, numero: String(l['FONE']) });
  if (String(l['CELULAR'] ?? '').trim()) fones.push({ tipo: 3, numero: String(l['CELULAR']) });
  if (String(l['FCONT'] ?? '').trim()) fones.push({ tipo: 5, numero: String(l['FCONT']) });
  const agora = new Date();
  const p = (n: number, t = 2) => String(n).padStart(t, '0');
  return {
    id,
    em: `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}T${p(agora.getHours())}:${p(agora.getMinutes())}:${p(agora.getSeconds())}.000`,
    usuario,
    valores,
    telefones: fones,
  };
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export class PortaCadastroMemoria implements PortaCadastro {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();
  constructor(private readonly catalogo: EstadoCatalogo | null = null) {}

  estado(operacao: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(operacao, hospital) ?? 'verde';
  }

  /** Sem verDocumento, a versão opaca não leva CPF nem identidade (o carimbo segue detectando a colisão). */
  versaoParaTela(versao: string, verDocumento: boolean): string {
    if (verDocumento) return versao;
    const v = lerVersaoPaciente(versao);
    if (!v) return versao;
    return JSON.stringify(
      Object.fromEntries(Object.entries(v).filter(([c]) => !COLUNAS_DOCUMENTO_VERSAO.includes(c))),
    );
  }

  /** Sessão sintética (dev/ci): a regra do executor nesses ambientes (só o estado do catálogo decide). */
  async podeGravar(c: ContextoPorta, operacao: string): Promise<LiberacaoOperacao> {
    const e = this.estado(operacao, c.hospital);
    return e === null || e === 'bloqueada'
      ? {
          pode: false,
          codigo: 'operacao-bloqueada',
          motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
        }
      : { pode: true, codigo: null, motivo: null };
  }

  async lerCep(_c: ContextoPorta, cep: string) {
    const x = CEPS[cep];
    return x
      ? {
          cep,
          logradouro: txt(x['LOGRA']) || null,
          bairro: txt(x['BAIRRO']) || null,
          cidade: txt(x['CIDADE']) || null,
          uf: txt(x['UF']) || null,
        }
      : null;
  }

  async solicitantesPorRegistro(
    c: ContextoPorta,
    r: { numero: number; conselho?: string | null; uf?: string | null },
  ) {
    return {
      itens: this.solicitantesDe(c)
        .filter(
          (s) =>
            s.numero === r.numero &&
            (!r.conselho || s.conselho === r.conselho.toUpperCase()) &&
            (!r.uf || s.uf === r.uf.toUpperCase()),
        )
        .map((s) => ({ ...s })),
      truncado: false,
    };
  }

  /** X-01: o profissional ligado ao login (papel Operador de sistema) do estabelecimento, para a ficha do usuário. */
  profissionalDoLogin(c: ContextoPorta, login: string): { id: number; nome: string } | null {
    return this.e(c).profissionais.profissionalDoLogin(login);
  }

  private e(c: ContextoPorta): Estado {
    return this.porHospitalDe(c.hospital);
  }

  /** Os dados sintéticos do estabelecimento (pelo código da sessão), criados na primeira leitura. */
  private porHospitalDe(hospital: string): Estado {
    let s = this.porHospital.get(hospital);
    if (!s) {
      s = {
        pacientes: new Map(),
        historico: new Map(),
        indice: new Map(),
        fila: new Map(),
        consentimentos: new Map(),
        gerador: 2000,
        geradorHt: 1,
        geradorFila: 1,
        geradorCons: 1,
        solicitantes: [],
        profissionais: new ProfissionaisMemoria(),
      };
      for (const p of PACIENTES) {
        const l = linhaDoPaciente(p);
        s.pacientes.set(p.id, l);
        s.historico.set(p.id, [retrato(l, s.geradorHt++, 'SINT.RECEPCAO')]);
        this.indexar(s, 'paciente', p.id, l);
      }
      for (const p of s.profissionais.lidos())
        this.indexarChaves(s, 'profissional', p.id, chavesDeBusca({ nome: p.nome }));
      for (const x of SOLICITANTES)
        this.indexarChaves(s, 'solicitante', x.id, chavesDeBusca({ nome: x.nome }));
      this.porHospital.set(hospital, s);
    }
    return s;
  }

  private indexarChaves(s: Estado, entidade: EntidadeBusca, id: number, chaves: readonly ChaveBusca[]): void {
    for (const [k, lista] of s.indice)
      s.indice.set(
        k,
        lista.filter((x) => !(x.entidade === entidade && x.id === id)),
      );
    for (const ch of chaves) {
      const k = `${entidade}:${ch.palavra}`;
      s.indice.set(k, [...(s.indice.get(k) ?? []), { entidade, id, chave: ch }]);
    }
  }

  private indexar(s: Estado, entidade: EntidadeBusca, id: number, l: Linha): void {
    this.indexarChaves(
      s,
      entidade,
      id,
      chavesDeBusca({
        nome: txt(l['NOME']),
        social: txt(l['APELIDO']) || null,
        mae: txt(l['MAE']) || null,
        telefones: [txt(l['FONE']), txt(l['CELULAR']), txt(l['FCONT'])],
      }),
    );
  }

  private todasChaves(s: Estado): { entidade: EntidadeBusca; id: number; chave: ChaveBusca }[] {
    return [...s.indice.values()].flat();
  }

  async buscarDireto(
    c: ContextoPorta,
    criterio: Parameters<PortaCadastro['buscarDireto']>[1],
    inativos: boolean,
  ) {
    const r = [...this.e(c).pacientes.values()]
      .filter((l) => inativos || l['ATIVO'] !== false)
      .filter((l) => {
        switch (criterio.tipo) {
          case 'cpf':
            return l['CPF'] !== null && Number(l['CPF']) === criterio.cpf;
          case 'prontuario':
            return Number(l['PRONT']) === criterio.prontuario;
          case 'cns':
            return txt(l['CNS']) === criterio.cns;
          case 'nascimento':
            return pacienteDaLinha(l).nascimento === criterio.data;
        }
      })
      .map(pacienteDaLinha);
    return { pacientes: r.slice(0, 50), truncado: r.length > 50 };
  }

  async idsPorPalavra(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavra: string,
  ) {
    const prefixo = palavra.length >= 4;
    const ids = new Set(
      this.todasChaves(this.e(c))
        .filter(
          (x) =>
            x.entidade === entidade &&
            campos.includes(x.chave.campo) &&
            (prefixo ? x.chave.palavra.startsWith(palavra) : x.chave.palavra === palavra),
        )
        .map((x) => x.id),
    );
    return { ids, truncado: false };
  }

  async idsPorPalavras(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    palavras: readonly string[],
    teto: number,
  ) {
    const longas = palavras.filter((p) => p.length > 1);
    if (longas.length === 0) return { ids: [], truncado: false };
    const conjuntos = await Promise.all(longas.map((p) => this.idsPorPalavra(c, entidade, campos, p)));
    const ids = [...conjuntos[0]!.ids].filter((x) => conjuntos.every((s) => s.ids.has(x)));
    return { ids: ids.slice(0, teto), truncado: ids.length > teto };
  }

  async idsPorFonetica(
    c: ContextoPorta,
    entidade: EntidadeBusca,
    campos: readonly CampoBusca[],
    fonetica: string,
  ) {
    const ids = new Set(
      this.todasChaves(this.e(c))
        .filter(
          (x) => x.entidade === entidade && campos.includes(x.chave.campo) && x.chave.fonetica === fonetica,
        )
        .map((x) => x.id),
    );
    return { ids, truncado: false };
  }

  async indiceTemLinhas(c: ContextoPorta, entidade: EntidadeBusca) {
    return this.todasChaves(this.e(c)).some((x) => x.entidade === entidade);
  }

  async lerPacientes(c: ContextoPorta, ids: readonly number[]) {
    const s = this.e(c);
    return ids.flatMap((id) => {
      const l = s.pacientes.get(id);
      return l ? [pacienteDaLinha(l)] : [];
    });
  }

  async extrasDaFicha(_c: ContextoPorta, p: Parameters<PortaCadastro['extrasDaFicha']>[1]) {
    return {
      carteirinhas: p.id === 1001 ? [{ convenio: 10, nome: `CONVENIO ${M}` }] : [],
      estadoCivil: ESTADOS_CIVIS.find((x) => x.codigo === p.estadoCivil)?.rotulo ?? null,
      racaCor: p.racaCor === null ? null : `COR ${p.racaCor} (${M})`,
      religiao: p.religiao === null ? null : `RELIGIAO ${p.religiao} (${M})`,
    };
  }

  async historico(c: ContextoPorta, id: number, pagina: number, porPagina: number) {
    const todas = [...(this.e(c).historico.get(id) ?? [])].reverse();
    const i = (pagina - 1) * porPagina;
    return {
      versoes: todas.slice(i, i + porPagina),
      total: todas.length,
      anterior: todas[i + porPagina] ?? null,
    };
  }

  async unificacoes(c: ContextoPorta, id: number) {
    const l = this.e(c).pacientes.get(id);
    const u = l ? Number(l['UNIFICADO_EM']) : id;
    // Na memória, a unificação é identificada pelo prontuário absorvido (um absorvido só tem uma unificação viva).
    if (l && u !== id) return [{ id, absorvido: id, sobrevivente: u, em: '2025-06-01T10:00:00.000' }];
    return [...this.e(c).pacientes.values()]
      .filter((x) => Number(x['UNIFICADO_EM']) === id && Number(x['ID']) !== id)
      .map((x) => ({
        id: Number(x['ID']),
        absorvido: Number(x['ID']),
        sobrevivente: id,
        em: '2025-06-01T10:00:00.000',
      }));
  }

  async homonimos(c: ContextoPorta, ids: readonly number[]) {
    const r = new Set<number>();
    for (const p of this.e(c).fila.values())
      if (p.situacao === 'outra_pessoa' && (ids.includes(p.a) || ids.includes(p.b))) {
        r.add(p.a);
        r.add(p.b);
      }
    return r;
  }

  async candidatosPorCpf(c: ContextoPorta, cpf: number) {
    return [...this.e(c).pacientes.values()]
      .filter((l) => Number(l['CPF']) === cpf)
      .slice(0, 5)
      .map(pacienteDaLinha);
  }

  async cepExiste(_c: ContextoPorta, cep: string) {
    return cep in CEPS;
  }

  async cadastrar(c: ContextoPorta, bruta: Parameters<PortaCadastro['cadastrar']>[1], ctx: ContextoGravacao) {
    const r = esquemaCadastrarPaciente.safeParse(bruta);
    if (!r.success) throw erroEntradaInvalida([...new Set(r.error.issues.map((i) => i.path.join('.')))]);
    const e = r.data;
    const s = this.e(c);
    if (e.cpf && [...s.pacientes.values()].some((l) => Number(l['CPF']) === Number(e.cpf)))
      throw recusa(
        'cpf-existente',
        'Já existe paciente com este CPF. Abra o cadastro existente; o sistema não unifica cadastros.',
        {
          campos: ['cpf'],
        },
      );
    const cep = CEPS[e.cep];
    if (!cep)
      throw recusa('cep-inexistente', 'CEP não encontrado no cadastro de CEPs. Confira o CEP.', {
        campos: ['cep'],
      });
    const id = ++s.gerador;
    const l: Linha = {
      ...linhaDoPaciente({ id, nome: e.nome, nasc: e.nascimento, sexo: e.sexo, cep: e.cep }),
      PRONT: id,
      MAE: e.nomeMae ?? '',
      CPF: Number(e.cpf),
      NAT: e.naturalidade,
      NATUF: e.ufNaturalidade ?? null,
      ENDERECO: e.logradouro ?? txt(cep['LOGRA']),
      BAIRRO: e.bairro ?? txt(cep['BAIRRO']),
      NUMERO: e.numero ?? null,
      COMPL: e.complemento ?? '',
      FONE: e.telefone ?? '',
      CELULAR: e.celular ?? '',
      EMAIL: e.email ?? '',
      CONTATO: e.contatoNome ?? '',
      FCONT: e.contatoTelefone ?? '',
      COR: null,
      RELIG: null,
      ECIV: null,
      ALERGIA: '',
      CARIMBO: new Date(),
      USUARIO: ctx.login,
    };
    s.pacientes.set(id, l);
    s.historico.set(id, [retrato(l, s.geradorHt++, ctx.login)]);
    this.indexar(s, 'paciente', id, l);
    return { resultado: { idPaciente: id, prontuario: Number(l['PRONT']) }, trilha: null };
  }

  async alterar(c: ContextoPorta, bruta: AlterarPacienteEntrada, ctx: ContextoGravacao) {
    const r = esquemaAlterarPaciente.safeParse(bruta);
    if (!r.success) throw erroEntradaInvalida([...new Set(r.error.issues.map((i) => i.path.join('.')))]);
    const e = r.data;
    const s = this.e(c);
    const atual = s.pacientes.get(e.idPaciente);
    if (!atual) throw recusa('registro-inexistente', 'O registro não existe mais.');
    const lida = lerVersaoPaciente(e.versao);
    if (!lida)
      throw recusa('versao-invalida', 'A versão lida pela tela é inválida. Releia o cadastro.', {
        campos: ['versao'],
      });
    const agora = lerVersaoPaciente(versaoDaLinhaPaciente(atual)) ?? {};
    const mudou = Object.keys(lida)
      .filter((k) => (lida[k] ?? null) !== (agora[k] ?? null))
      .sort();
    if (mudou.length > 0) throw erroConflitoVersao([...new Set(mudou.map((c) => CAMPO_DA_COLUNA[c] ?? c))]);
    if (atual['ATIVO'] === false)
      throw recusa(
        'cadastro-inativo',
        'Cadastro inativo (absorvido numa unificação): altere o cadastro que ficou ativo.',
      );
    const a = e.alteracoes;
    if (
      a.cpf !== undefined &&
      a.cpf !== null &&
      [...s.pacientes.values()].some((l) => Number(l['CPF']) === Number(a.cpf) && l['ID'] !== e.idPaciente)
    )
      throw recusa(
        'cpf-existente',
        'Já existe outro paciente com este CPF. O sistema não unifica cadastros.',
        { campos: ['cpf'] },
      );
    const novo: Linha = { ...atual };
    for (const [campo, v] of Object.entries(a)) {
      if (v === undefined) continue;
      const col = COLUNA_DO_CAMPO_PACIENTE[campo];
      if (!col) continue;
      novo[col] = campo === 'nascimento' ? data(String(v)) : campo === 'cpf' ? Number(v) : (v ?? null);
    }
    if (a.cep !== undefined) {
      const cep = CEPS[a.cep];
      if (!cep)
        throw recusa('cep-inexistente', 'CEP não encontrado no cadastro de CEPs. Confira o CEP.', {
          campos: ['cep'],
        });
      novo['CEP'] = Number(a.cep);
      novo['ENDERECO'] = a.logradouro ?? txt(cep['LOGRA']);
      novo['BAIRRO'] = a.bairro ?? txt(cep['BAIRRO']);
      novo['CIDADE'] = txt(cep['CIDADE']);
      novo['UF'] = txt(cep['UF']);
    }
    const iguais = Object.keys(novo).every((k) => {
      const x = novo[k];
      const y = atual[k];
      return x instanceof Date && y instanceof Date ? x.getTime() === y.getTime() : txt(x) === txt(y);
    });
    if (iguais) throw recusa('sem-alteracao', 'Nenhum campo mudou em relação ao cadastro.');
    novo['USUARIO'] = ctx.login;
    novo['CARIMBO'] = new Date(Math.max(Date.now(), (atual['CARIMBO'] as Date).getTime() + 1));
    s.pacientes.set(e.idPaciente, novo);
    s.historico.set(e.idPaciente, [
      ...(s.historico.get(e.idPaciente) ?? []),
      retrato(novo, s.geradorHt++, ctx.login),
    ]);
    this.indexar(s, 'paciente', e.idPaciente, novo);
    return { resultado: { idPaciente: e.idPaciente }, trilha: null };
  }

  /**
   * M57.2: a unificação com as mesmas regras da receita (cadastro.unificarPaciente): o que fica ativo e não absorvido
   * (e_ricadpac1), o absorvido ainda não unificado; o absorvido (e os que ele tinha absorvido) passa a apontar o que
   * fica, inativo, como faz o gatilho; os pares abertos da fila com o absorvido viram "Unificado".
   */
  async unificar(c: ContextoPorta, bruta: UnificarPacienteEntrada, ctx: ContextoGravacao) {
    const r = esquemaUnificarPaciente.safeParse(bruta);
    if (!r.success) throw erroEntradaInvalida([...new Set(r.error.issues.map((i) => i.path.join('.')))]);
    const e = r.data;
    const s = this.e(c);
    const a = s.pacientes.get(e.idAbsorvido);
    const f = s.pacientes.get(e.idSobrevivente);
    if (!a) throw recusa('registro-inexistente', 'O prontuário absorvido não existe mais.');
    if (!f) throw recusa('registro-inexistente', 'O prontuário que fica não existe mais.');
    const livre = (l: Linha) => l['ATIVO'] !== false && Number(l['UNIFICADO_EM']) === Number(l['ID']);
    if (!livre(f))
      throw recusa(
        'cadastro-inativo',
        'Prontuário de destino inativo (já absorvido numa unificação): escolha o prontuário que ficou ativo.',
      );
    if (!livre(a))
      throw recusa(
        'ja-unificado',
        'Este prontuário já foi unificado em outro (está inativo). Releia a fila de duplicidades.',
      );
    const agora = new Date();
    for (const [id, l] of s.pacientes)
      if (id === e.idAbsorvido || Number(l['UNIFICADO_EM']) === e.idAbsorvido)
        s.pacientes.set(id, {
          ...l,
          ATIVO: false,
          UNIFICADO_EM: e.idSobrevivente,
          CARIMBO: agora,
        });
    for (const [id, p] of s.fila)
      if (p.situacao === 'aberto' && (p.a === e.idAbsorvido || p.b === e.idAbsorvido))
        s.fila.set(id, {
          ...p,
          situacao: 'unificado_no_legado',
          decididoPor: ctx.login,
          decididoEm: agora.toISOString(),
          ...(e.justificativa ? { justificativa: e.justificativa } : {}),
        });
    return { resultado: { idAbsorvido: e.idAbsorvido, idSobrevivente: e.idSobrevivente }, trilha: null };
  }

  /**
   * F3.1: desfaz a unificação (na memória, o id da unificação é o do absorvido): o absorvido volta a ativo e os pares
   * da fila que a unificação decidiu voltam a abertos. Mesma regra de motivo do domínio.
   */
  async desfazerUnificacao(c: ContextoPorta, bruta: DesfazerUnificacaoEntrada) {
    const r = esquemaDesfazerUnificacao.safeParse(bruta);
    if (!r.success) throw erroEntradaInvalida([...new Set(r.error.issues.map((i) => i.path.join('.')))]);
    const s = this.e(c);
    const id = r.data.idUnificacao;
    const a = s.pacientes.get(id);
    const sobrevivente = a ? Number(a['UNIFICADO_EM']) : id;
    if (!a || sobrevivente === id)
      throw recusa('registro-inexistente', 'A unificação não existe ou já foi desfeita.');
    s.pacientes.set(id, { ...a, ATIVO: true, UNIFICADO_EM: id, CARIMBO: new Date() });
    for (const [n, p] of s.fila)
      if (
        p.situacao === 'unificado_no_legado' &&
        ((p.a === id && p.b === sobrevivente) || (p.b === id && p.a === sobrevivente))
      ) {
        const reaberto: ParFila & { justificativa?: string } = {
          id: p.id,
          a: p.a,
          b: p.b,
          escore: p.escore,
          criterios: p.criterios,
          situacao: 'aberto',
          decididoPor: null,
          decididoEm: null,
        };
        s.fila.set(n, reaberto);
      }
    return { resultado: { idAbsorvido: id, idSobrevivente: sobrevivente }, trilha: null };
  }

  /** E2E: alteração "por fora" (outra estação gravou antes), para o aviso de colisão. */
  alterarPorFora(hospital: string, id: number, colunas: Readonly<Record<string, unknown>>): boolean {
    const s = this.porHospitalDe(hospital);
    const l = s.pacientes.get(id);
    if (!l) return false;
    s.pacientes.set(id, { ...l, ...colunas, CARIMBO: new Date() });
    return true;
  }

  async gruposCandidatos(c: ContextoPorta) {
    const s = this.e(c);
    const porCpf = new Map<number, number[]>();
    const porNome = new Map<string, number[]>();
    for (const l of s.pacientes.values()) {
      const cpf = Number(l['CPF']);
      if (cpf > 0) porCpf.set(cpf, [...(porCpf.get(cpf) ?? []), Number(l['ID'])]);
      const k = `${txt(l['NOME'])}|${pacienteDaLinha(l).nascimento}`;
      porNome.set(k, [...(porNome.get(k) ?? []), Number(l['ID'])]);
    }
    return {
      cpf: [...porCpf.values()].filter((x) => x.length > 1),
      fonetica: [...porNome.values()].filter((x) => x.length > 1),
    };
  }

  async lerFila(c: ContextoPorta, situacao: ParFila['situacao'], pagina: number, porPagina: number) {
    const todos = [...this.e(c).fila.values()]
      .filter((p) => p.situacao === situacao)
      .sort(
        (x, y) =>
          Number(y.criterios.includes('cpf')) - Number(x.criterios.includes('cpf')) ||
          y.escore - x.escore ||
          x.a - y.a,
      );
    const i = (pagina - 1) * porPagina;
    return { itens: todos.slice(i, i + porPagina), total: todos.length };
  }

  async lerPar(c: ContextoPorta, id: number) {
    return this.e(c).fila.get(id) ?? null;
  }

  async gravarPares(
    c: ContextoPorta,
    pares: Parameters<PortaCadastro['gravarPares']>[1],
    inativos: readonly number[],
  ) {
    const s = this.e(c);
    let n = 0;
    for (const p of pares) {
      const [x, y] = p.a.id < p.b.id ? [p.a, p.b] : [p.b, p.a];
      if ([...s.fila.values()].some((f) => f.a === x.id && f.b === y.id)) continue;
      const id = s.geradorFila++;
      s.fila.set(id, {
        id,
        a: x.id,
        b: y.id,
        escore: Math.min(100, p.escore),
        criterios: [...p.criterios],
        situacao: 'aberto',
        decididoPor: null,
        decididoEm: null,
      });
      n++;
    }
    for (const f of s.fila.values())
      if (f.situacao === 'aberto' && (inativos.includes(f.a) || inativos.includes(f.b)))
        s.fila.set(f.id, { ...f, situacao: 'unificado_no_legado' });
    return n;
  }

  async decidirOutraPessoa(c: ContextoPorta, id: number, usuario: string, justificativa: string) {
    const s = this.e(c);
    const f = s.fila.get(id);
    if (!f) throw recusa('par-inexistente', 'O par não está mais na fila.');
    if (f.situacao !== 'aberto')
      throw recusa('par-decidido', 'O par já foi decidido por outra pessoa. Releia a fila.');
    s.fila.set(id, {
      ...f,
      situacao: 'outra_pessoa',
      decididoPor: usuario,
      decididoEm: new Date().toISOString(),
      justificativa,
    });
    return { a: f.a, b: f.b };
  }

  async opcoesConsentimento() {
    return {
      situacoes: [
        { codigo: 3, rotulo: 'Consentimento Autorizado' },
        { codigo: 4, rotulo: 'Não autorizado' },
      ],
      signatarios: [
        { codigo: 1, rotulo: 'Paciente' },
        { codigo: 2, rotulo: 'Representante Legal' },
      ],
      revogacoes: [{ codigo: 2, rotulo: 'Termo de revogação para acesso aos dados pessoais' }],
    };
  }

  async consentimentos(c: ContextoPorta, id: number) {
    return [...this.e(c).consentimentos.values()].filter((x) => x.idPaciente === id).reverse();
  }

  async registrarConsentimento(c: ContextoPorta, r: Parameters<PortaCadastro['registrarConsentimento']>[1]) {
    const s = this.e(c);
    if (![3, 4].includes(r.situacao))
      throw recusa('situacao-invalida', 'Situação do termo desconhecida.', { campos: ['situacao'] });
    if (![1, 2].includes(r.signatario))
      throw recusa('signatario-invalido', 'Signatário desconhecido.', { campos: ['signatario'] });
    const id = s.geradorCons++;
    s.consentimentos.set(id, {
      id,
      idPaciente: r.idPaciente,
      finalidade: r.finalidade,
      versao: r.versao,
      situacao: r.situacao,
      signatario: r.signatario,
      registradoEm: new Date().toISOString(),
      registradoPor: r.usuario,
      revogadoEm: null,
      revogacao: null,
    });
    return id;
  }

  async revogarConsentimento(c: ContextoPorta, r: Parameters<PortaCadastro['revogarConsentimento']>[1]) {
    const s = this.e(c);
    const x = s.consentimentos.get(r.id);
    if (!x || x.idPaciente !== r.idPaciente || x.revogadoEm)
      throw recusa('consentimento-revogado', 'O consentimento não existe ou já foi revogado.');
    if (r.motivo !== 2)
      throw recusa('motivo-invalido', 'Tipo de revogação desconhecido.', { campos: ['motivo'] });
    s.consentimentos.set(r.id, { ...x, revogadoEm: new Date().toISOString(), revogacao: r.motivo });
  }

  async listarProfissionais(c: ContextoPorta, ids?: readonly number[]) {
    return this.e(c).profissionais.lidos(ids);
  }

  async fichaProfissional(c: ContextoPorta, id: number) {
    return this.e(c).profissionais.ficha(id);
  }

  async dadosProfissional(c: ContextoPorta, id: number) {
    return this.e(c).profissionais.dados(id);
  }

  async opcoesProfissional(c: ContextoPorta) {
    return this.e(c).profissionais.opcoes();
  }

  /** D-PROF-39: as regras das receitas do profissional; reindexa o nome como o `sgh` da operação. */
  async gravarProfissional(
    c: ContextoPorta,
    op: OperacaoProfissionalTela,
    entrada: unknown,
    ctx?: { login: string },
  ) {
    const s = this.e(c);
    const r = s.profissionais.gravar(op, entrada, ctx?.login);
    if (r.profissional) {
      const nome = String(r.profissional.linha['NOME']);
      const social = String(r.profissional.linha['APELIDO'] ?? '').trim() || null;
      this.indexarChaves(s, 'profissional', r.profissional.id, chavesDeBusca({ nome, social }));
    } else if (r.resultado['profissional'] !== undefined)
      this.indexarChaves(s, 'profissional', r.resultado['profissional'], []);
    return { resultado: r.resultado, trilha: null };
  }

  /** D-PROF-39: os logins que podem ser ligados, o login de cada registro, o histórico e os vínculos. */
  async loginsProfissional(c: ContextoPorta) {
    return this.e(c).profissionais.logins();
  }

  async loginsDosRegistros(c: ContextoPorta, id: number) {
    return this.e(c).profissionais.loginsPorRegistro(id);
  }

  async eventosProfissional(c: ContextoPorta, id: number) {
    return this.e(c).profissionais.historico(id);
  }

  async vinculosProfissional(c: ContextoPorta, id: number, registro?: number) {
    return this.e(c).profissionais.vinculos(id, registro);
  }

  async historicoProfissional(c: ContextoPorta, id: number) {
    const [p] = this.e(c).profissionais.lidos([id]);
    const v: VersaoCadastro = {
      id: 1,
      em: '2026-01-10T09:00:00.000',
      usuario: 'SINT.ADMIN',
      valores: { nome: p?.nome ?? null, uf: 'MG' },
      telefones: [{ tipo: 1, numero: '3133330004' }],
    };
    return { versoes: p ? [v] : [], total: p ? 1 : 0, anterior: null, nome: p?.nome ?? null };
  }

  async listarSolicitantes(c: ContextoPorta, ids?: readonly number[]) {
    return {
      itens: this.solicitantesDe(c)
        .filter((s) => !ids || ids.includes(s.id))
        .map((s) => ({ ...s })),
      truncado: false,
    };
  }

  /** Os solicitantes fixos e os incluídos pela tela neste estabelecimento. */
  private solicitantesDe(c: ContextoPorta) {
    return [...SOLICITANTES, ...this.e(c).solicitantes];
  }

  async conselhoPorSigla(_c: ContextoPorta, sigla: string): Promise<number | null> {
    return CONSELHOS[sigla.toUpperCase()] ?? null;
  }

  /** As regras da receita `cadastro.cadastrarSolicitante` (deduplicação por conselho + UF + número). */
  async cadastrarSolicitante(c: ContextoPorta, bruta: Parameters<PortaCadastro['cadastrarSolicitante']>[1]) {
    const r = esquemaCadastrarSolicitante.safeParse(bruta);
    if (!r.success) throw erroEntradaInvalida([...new Set(r.error.issues.map((i) => i.path.join('.')))]);
    const e = r.data;
    const sigla = Object.entries(CONSELHOS).find(([, id]) => id === e.conselho)?.[0];
    if (!sigla) throw recusa('conselho-inexistente', 'Conselho não encontrado.', { campos: ['conselho'] });
    if (
      this.solicitantesDe(c).some(
        (x) => x.conselho === sigla && x.uf === e.uf && x.numero === e.numero && x.ativo,
      )
    )
      throw recusa('solicitante-duplicado', 'O médico já está no cadastro de solicitantes.', {
        campos: ['numero'],
      });
    const s = this.e(c);
    const id = 1000 + s.solicitantes.length + 1;
    s.solicitantes.push({
      id,
      nome: e.nome,
      conselho: sigla,
      numero: e.numero,
      uf: e.uf,
      cbo: null,
      ativo: true,
      codigosConvenio: 0,
    });
    this.indexarChaves(s, 'solicitante', id, chavesDeBusca({ nome: e.nome }));
    return { resultado: { solicitante: id }, trilha: null };
  }

  async chavesRepetidasSolicitante() {
    return new Set(['CRM|MG|70001']);
  }

  async buscarPessoas(_c: ContextoPorta, documento: string) {
    const d = documento.replace(/\D+/g, '');
    if (d === '90000000175')
      return [{ id: 1, tipo: 'F' as const, documento: d, profissionais: 0, pacientes: 1 }];
    if (d === '11222333000181')
      return [{ id: 2, tipo: 'J' as const, documento: d, profissionais: 1, pacientes: 0 }];
    return [];
  }

  async siglasDosConselhos() {
    return [
      { conselho: 2, sigla: 'ENF', nome: 'Enfermeiro' },
      { conselho: 2, sigla: 'TEC', nome: 'Técnico de Enfermagem' },
      { conselho: 5, sigla: 'P', nome: 'Registro Provisório' },
    ];
  }

  async procedimentosDaEspecialidade(
    _c: ContextoPorta,
    especialidade: number,
    pagina: number,
    porPagina: number,
  ) {
    const todos = Array.from({ length: 60 }, (_, i) => ({
      procedimento: 10_000_000 + especialidade * 1000 + i,
      descricao: `PROCEDIMENTO ${i + 1} ${M}`,
    }));
    const i = (pagina - 1) * porPagina;
    return { itens: todos.slice(i, i + porPagina), total: todos.length };
  }
}
