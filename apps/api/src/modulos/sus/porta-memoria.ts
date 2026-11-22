// Porta do faturamento SUS em memória (M51, etapas 1 a 3): a sessão sintética de dev/ci (E2E). A massa é SINTÉTICA (nenhum
// dado de pessoa): em qualquer competência pedida, seis atendimentos inventados (convênio, particular, internação, um
// sem equivalente SIGTAP, um com item sem equivalente e um do SUS, que fica fora) e um catálogo SIGTAP sintético. As
// gravações seguem as mesmas regras das tabelas do faturamento SUS (uma competência por instrumento, versão, críticas mantidas,
// reabertas e corrigidas sem apagar); cada transação é desfeita se a função falhar.
import {
  type EstadoSusAih,
  estadoAihVazio,
  gravacaoAihMemoria,
  leituraAihMemoria,
  type BaseMemoriaAih,
} from './porta-aih-memoria.js';
import type {
  AtendimentoBpaLido,
  AtendimentoLido,
  ContextoSus,
  DadosBpaLidos,
  DadosCihaLidos,
  GravacaoSus,
  LeituraSus,
  PortaSus,
} from './porta.js';
import {
  type ApacRegistro,
  type ArquivoSus,
  type CompetenciaSusRegistro,
  type ContaBpa,
  type ContaCiha,
  type CriticaSus,
  type EquivalenciaSus,
  ErroSus,
  type ItemBpa,
  type ItemContaSigtap,
  type LinhaApac,
  type LinhaBpa,
  type LinhaTrilhaSus,
  type ProcedimentoHospital,
  type SolicitanteApacCadastro,
} from './tipos.js';

interface CriticaMemoria extends CriticaSus {
  readonly competencia: number;
  readonly convenio: number | null;
  readonly chave: string;
}

interface EstadoSus {
  seq: number;
  competencias: CompetenciaSusRegistro[];
  criticas: CriticaMemoria[];
  arquivos: (ArquivoSus & { competenciaId: number })[];
  registros: { arquivo: number; conta: number; sequencia: number }[];
  equivalencias: EquivalenciaSus[];
  linhasBpa: (LinhaBpa & { arquivo: number })[];
  apacs: ApacRegistro[];
  linhasApac: (LinhaApac & { arquivo: number })[];
  /** Etapa 4: a faixa, as AIHs, as linhas e o retorno do gestor. */
  aih: EstadoSusAih;
}

const agora = () => new Date().toISOString().slice(0, 23);

/** Catálogo SIGTAP sintético (códigos de forma válida; nomes inventados). */
export const SIGTAP_SINTETICO = [
  { id: 9001, codigo: '0301010072', nome: 'PROCEDIMENTO SINTETICO DE CONSULTA', registro: '02' },
  { id: 9002, codigo: '0202010295', nome: 'PROCEDIMENTO SINTETICO DE EXAME', registro: '01' },
  { id: 9003, codigo: '0406010811', nome: 'PROCEDIMENTO SINTETICO DE INTERNACAO', registro: '03' },
  { id: 9004, codigo: '0211020036', nome: 'PROCEDIMENTO SINTETICO DE ELETROCARDIOGRAFIA', registro: '02' },
  // Etapa 3: o principal da APAC (hemodiálise sintética, grupo 03.05: exige o laudo de nefrologia) e um secundário.
  { id: 9005, codigo: '0305010107', nome: 'PROCEDIMENTO SINTETICO DE HEMODIALISE', registro: '06' },
  {
    id: 9006,
    codigo: '0305010166',
    nome: 'PROCEDIMENTO SINTETICO DE ACOMPANHAMENTO DA APAC',
    registro: '07',
  },
] as const;

/** O procedimento do hospital sem equivalente SIGTAP na massa sintética (o E2E registra a equivalência dele). */
export const PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO = 7001;

/**
 * Cadastro sintético de procedimentos do hospital (o id do item faturável, o código na tabela do convênio, o nome e a
 * tabela). O 7101 tem o MESMO código do 7001 em outra tabela: a equivalência de um não vale para o outro.
 */
export const PROCEDIMENTOS_HOSPITAL_SINTETICOS: readonly ProcedimentoHospital[] = [
  { id: 6001, codigo: 10101012, nome: 'CONSULTA SINTETICA EM CONSULTORIO', tabela: '1 TABELA SINTETICA A' },
  { id: 6002, codigo: 40301010, nome: 'EXAME SINTETICO DE LABORATORIO', tabela: '1 TABELA SINTETICA A' },
  { id: 6003, codigo: 31001010, nome: 'INTERNACAO SINTETICA CLINICA', tabela: '1 TABELA SINTETICA A' },
  { id: 7001, codigo: 40801012, nome: 'ELETROCARDIOGRAMA SINTETICO', tabela: '1 TABELA SINTETICA A' },
  { id: 7002, codigo: 40801020, nome: 'TESTE ERGOMETRICO SINTETICO', tabela: '1 TABELA SINTETICA A' },
  { id: 7101, codigo: 40801012, nome: 'ELETROCARDIOGRAMA SINTETICO', tabela: '2 TABELA SINTETICA B' },
  { id: 7003, codigo: 40805010, nome: 'MAPA SINTETICO DE 24 HORAS', tabela: '1 TABELA SINTETICA A' },
];

/** O procedimento do hospital sem equivalente na produção SUS sintética (o E2E do BPA registra a equivalência dele). */
export const PROCEDIMENTO_BPA_SEM_EQUIVALENTE_SINTETICO = 7003;

/** CNS provisório sintético (começa em 7; soma ponderada de 15 a 1 múltipla de 11): gerado, nunca de pessoa. */
export function cnsSintetico(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let t = 0;
    for (let i = 0; i < 15; i++) t += Number(corpo[i]) * (15 - i);
    if (t % 11 === 0) return corpo;
  }
  throw new Error('sem CNS sintético');
}

/**
 * A produção ambulatorial do SUS sintética da competência (etapa 2): quatro fichas do convênio 1 — consulta com CNS (vai
 * ao BPA-I), exame só consolidado (BPA-C), consulta de paciente sem CNS (vai ao BPA-C, D-BPAI-51) e um MAPA sem
 * equivalente SIGTAP (crítica bloqueante até a equivalência do hospital). O executante tem CNS e CBO sintéticos.
 */
export function producaoSusSintetica(inicio: string): AtendimentoBpaLido[] {
  const dia = (d: number) => `${inicio.slice(0, 8)}${String(d).padStart(2, '0')}`;
  const executante = { cbo: '225125', cns: cnsSintetico(990), cpf: null };
  const ficha = (
    n: number,
    itens: { sigtap: number | null; procedimento: number; quantidade?: number }[],
    comCns = true,
  ): AtendimentoBpaLido => {
    const base = paciente(n);
    const c: ContaBpa = {
      conta: 810_000 + n,
      registro: 710_000 + n,
      atendimento: 610_000 + n,
      convenio: 1,
      data: dia(10 + n),
      cidPrincipal: 'I10',
      pacienteId: 600_000 + n,
      paciente: {
        mae: `MAE SINTETICA ${n}`,
        cns: comCns ? cnsSintetico(n) : '0',
        cpf: cpfSintetico(`2000000${n}`),
        sexo: base.sexo,
        nascimento: base.nascimento,
        municipio: base.municipio,
        nome: base.nome,
        raca: 99,
        cep: base.cep,
        logradouro: base.logradouro,
        numero: base.numero,
        complemento: null,
        bairro: 'CENTRO',
      },
    };
    const lidos: ItemBpa[] = itens.map((x, k) => ({
      conta: c.conta,
      item: 510_000 + n * 10 + k,
      sigtap: x.sigtap,
      quantidade: x.quantidade ?? 1,
      procedimento: x.procedimento,
      executante,
    }));
    return { conta: c, contas: [c.conta], itens: lidos };
  };
  return [
    ficha(21, [{ sigtap: 9001, procedimento: 6001 }]),
    ficha(22, [{ sigtap: 9002, procedimento: 6002, quantidade: 2 }]),
    ficha(23, [{ sigtap: 9001, procedimento: 6001 }], false),
    ficha(24, [{ sigtap: null, procedimento: PROCEDIMENTO_BPA_SEM_EQUIVALENTE_SINTETICO }]),
    // Etapa 3: as sessões de hemodiálise e o acompanhamento (registro só de APAC: vão à APAC do paciente, não ao BPA).
    ficha(25, [
      { sigtap: 9005, procedimento: 6005, quantidade: 12 },
      { sigtap: 9006, procedimento: 6006 },
    ]),
  ];
}

/** O registro da ficha da hemodiálise sintética (o E2E da APAC faz o laudo nela). */
export const REGISTRO_APAC_SINTETICO = 710_025;

/** O médico solicitante SUS sintético: a chave é um CPF gerado pelo algoritmo, nunca de pessoa. */
export const SOLICITANTES_APAC_SINTETICOS: readonly SolicitanteApacCadastro[] = [
  {
    chave: cpfSintetico('999000017'),
    nome: 'MEDICO SOLICITANTE SINTETICO DA APAC',
    crm: 520017,
    cns: cnsSintetico(993),
  },
];

/** Os domínios sintéticos do laudo de nefrologia (o que o cadastro de domínios do SUS traz). */
export const DOMINIOS_APAC_SINTETICOS = {
  caracteristicaTratamento: [
    { id: 1, nome: 'TRATAMENTO SINTETICO A' },
    { id: 2, nome: 'TRATAMENTO SINTETICO B' },
  ],
  contraindicacaoTransplante: [
    { id: 1, nome: 'SEM CONTRAINDICACAO (SINTETICO)' },
    { id: 2, nome: 'COM CONTRAINDICACAO (SINTETICO)' },
  ],
  situacaoTransplante: [
    { id: 1, nome: 'NAO INSCRITO (SINTETICO)' },
    { id: 2, nome: 'INSCRITO (SINTETICO)' },
  ],
  acessoVascular: [
    { id: 1, nome: 'FISTULA SINTETICA' },
    { id: 2, nome: 'CATETER SINTETICO' },
  ],
};

const normal = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

function paciente(n: number): ContaCiha['paciente'] {
  return {
    cns: '0',
    // CPF sintético válido (base 1000000NN; o dígito é calculado).
    cpf: cpfSintetico(`10000000${n}`),
    sexo: n % 2 ? 'F' : 'M',
    nascimento: '1975-04-12',
    municipio: 330390,
    nome: `PACIENTE SINTETICO ${n}`,
    logradouro: 'RUA SINTETICA',
    numero: String(10 * n),
    complemento: null,
    uf: 'RJ',
    cep: '25600000',
    prontuario: 900_000 + n,
    declaracaoObito: null,
  };
}

function cpfSintetico(base9: string): string {
  const dv = (b: string) => {
    let s = 0;
    for (let i = 0; i < b.length; i++) s += Number(b[i]) * (b.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  return `${base9}${d1}${dv(`${base9}${d1}`)}`;
}

/** Os seis atendimentos sintéticos da competência (datas dentro do intervalo pedido). */
export function atendimentosSinteticos(inicio: string): AtendimentoLido[] {
  const dia = (d: number) => `${inicio.slice(0, 8)}${String(d).padStart(2, '0')}`;
  const conta = (
    n: number,
    convenio: number,
    modalidade: 'internacao' | 'ambulatorial',
    itens: { sigtap: number | null; procedimento: number; quantidade?: number }[],
  ): AtendimentoLido => {
    const c: ContaCiha = {
      conta: 800_000 + n,
      modalidade,
      registro: 700_000 + n,
      atendimento: 600_000 + n,
      convenio,
      entrada: dia(modalidade === 'internacao' ? 3 : 5 + n),
      saida: dia(modalidade === 'internacao' ? 8 : 5 + n),
      cidPrincipal: 'I10',
      cidSecundario: null,
      paciente: paciente(n),
      motivoAlta: modalidade === 'internacao' ? 12 : null,
      beneficiario: convenio === 20 ? `CARTEIRA-SINT-${n}` : null,
      guiaTiss: convenio === 20 ? `GUIA-SINT-${n}` : null,
      operadora: convenio === 20 ? { regAns: 123456, cnpj: null } : { regAns: null, cnpj: null },
    };
    const lidos: ItemContaSigtap[] = itens.map((x, k) => ({
      conta: c.conta,
      item: 500_000 + n * 10 + k,
      sigtap: x.sigtap,
      quantidade: x.quantidade ?? 1,
      procedimento: x.procedimento,
    }));
    return { conta: c, contas: [c.conta], itens: lidos };
  };
  return [
    conta(1, 20, 'ambulatorial', [{ sigtap: 9001, procedimento: 6001 }]),
    conta(2, 10, 'ambulatorial', [{ sigtap: 9002, procedimento: 6002, quantidade: 2 }]),
    conta(3, 20, 'internacao', [
      { sigtap: 9003, procedimento: 6003 },
      { sigtap: 9001, procedimento: 6001 },
    ]),
    conta(4, 20, 'ambulatorial', [{ sigtap: null, procedimento: PROCEDIMENTO_SEM_EQUIVALENTE_SINTETICO }]),
    conta(5, 10, 'ambulatorial', [
      { sigtap: 9001, procedimento: 6001 },
      { sigtap: null, procedimento: 7002 },
    ]),
    conta(6, 1, 'ambulatorial', [{ sigtap: 9001, procedimento: 6001 }]),
  ];
}

/** Cadastro geral sintético de médicos solicitantes (nomes inventados). */
export const SOLICITANTES_SINTETICOS = [
  { id: 1, conselho: 520001, nome: 'MEDICO SOLICITANTE SINTETICO A', uf: 'RJ', cbo: '225125', ativo: true },
  { id: 2, conselho: 520002, nome: 'MEDICA SOLICITANTE SINTETICA B', uf: 'RJ', cbo: '225120', ativo: true },
] as const;

const atributos = {
  idadeMinima: 0,
  idadeMaxima: 9999,
  sexo: null,
  quantidadeMaxima: null,
  permanencia: null,
  complexidade: 'MC',
};

function erroVersao(): never {
  throw new ErroSus('versao-alterada', 'A competência mudou desde que a tela foi aberta.');
}

export class PortaSusMemoria implements PortaSus {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, EstadoSus>();
  /** A trilha registrada pelas gravações (confirmadas); o controlador liga o registrador da API. */
  readonly trilhas: LinhaTrilhaSus[] = [];
  aoRegistrarTrilha: ((l: LinhaTrilhaSus) => Promise<void>) | null = null;

  private estado(h: string): EstadoSus {
    let e = this.estados.get(h);
    if (!e) {
      e = {
        seq: 0,
        competencias: [],
        criticas: [],
        arquivos: [],
        registros: [],
        equivalencias: [],
        linhasBpa: [],
        apacs: [],
        linhasApac: [],
        aih: estadoAihVazio(),
      };
      this.estados.set(h, e);
    }
    return e;
  }

  /** A base da parte da AIH: o estado, a sequência, o arquivo (como o da CIHA, sem registros) e a linha do BPA. */
  private baseAih(s: EstadoSus): BaseMemoriaAih {
    return {
      aih: () => s.aih,
      proximo: () => ++s.seq,
      inserirArquivo: (a) => this.gravacao(s).gravarArquivo(a, []),
      linhaBpa: (competencia, p) => {
        const arquivos = s.arquivos
          .filter(
            (a) => a.instrumento === 'bpa' && a.competencia === competencia && a.situacao !== 'substituido',
          )
          .map((a) => a.id);
        const x = s.linhasBpa
          .filter(
            (l) =>
              arquivos.includes(l.arquivo) &&
              l.tipo === p.tipo &&
              l.folha === p.folha &&
              l.sequencia === p.sequencia,
          )
          .sort((a, b) => b.arquivo - a.arquivo)[0];
        return x ? { linha: x.id, arquivo: x.arquivo, procedimento: x.procedimento } : null;
      },
    };
  }

  private leitura(s: EstadoSus): LeituraSus {
    return {
      ...leituraAihMemoria(this.baseAih(s)),
      competencias: async (i) =>
        s.competencias
          .filter((c) => !i || c.instrumento === i)
          .sort(
            (a, b) =>
              b.competencia.localeCompare(a.competencia) || a.instrumento.localeCompare(b.instrumento),
          ),
      competencia: async (i, c) =>
        s.competencias.find((x) => x.instrumento === i && x.competencia === c) ?? null,
      criticas: async (comp, f) => {
        const doEscopo = s.criticas.filter(
          (x) =>
            x.competencia === comp &&
            (f.convenios === null || x.convenio === null || f.convenios.includes(x.convenio)),
        );
        const lista = doEscopo
          .filter(
            (x) =>
              x.situacao === (f.situacao ?? 'aberta') &&
              (!f.regra || x.regra === f.regra) &&
              (!f.gravidade || x.gravidade === f.gravidade),
          )
          .sort(
            (a, b) => b.gravidade.localeCompare(a.gravidade) || a.regra.localeCompare(b.regra) || a.id - b.id,
          );
        const porRegra: Record<string, number> = {};
        for (const x of doEscopo)
          if (x.situacao === 'aberta') porRegra[x.regra] = (porRegra[x.regra] ?? 0) + 1;
        const ini = f.pagina * f.porPagina;
        return { itens: lista.slice(ini, ini + f.porPagina), total: lista.length, porRegra };
      },
      critica: async (id) => s.criticas.find((x) => x.id === id) ?? null,
      arquivos: async (i, c) =>
        s.arquivos
          .filter((a) => a.instrumento === i && (!c || a.competencia === c))
          .sort((a, b) => b.id - a.id),
      arquivo: async (id) => s.arquivos.find((a) => a.id === id) ?? null,
      equivalencias: async () =>
        s.equivalencias.filter((x) => x.ativa).sort((a, b) => a.procedimento - b.procedimento),
      paginaEquivalencias: async (f) => {
        const termo = normal((f.termo ?? '').trim());
        const nomeada = s.equivalencias.map((x) => {
          const p = PROCEDIMENTOS_HOSPITAL_SINTETICOS.find((y) => y.id === x.procedimento);
          const g = SIGTAP_SINTETICO.find((y) => y.id === x.sigtap);
          return {
            ...x,
            procedimentoNome: p?.nome ?? null,
            tabela: p?.tabela ?? null,
            sigtapNome: g?.nome ?? null,
          };
        });
        const lista = nomeada
          .filter(
            (x) =>
              (f.inativas || x.ativa) &&
              (!f.procedimento || x.procedimento === f.procedimento) &&
              (!termo ||
                String(x.codigoProcedimento) === termo ||
                x.codigo.startsWith(termo) ||
                normal(x.procedimentoNome ?? '').includes(termo) ||
                normal(x.sigtapNome ?? '').includes(termo)),
          )
          .sort((a, b) => (a.procedimentoNome ?? '').localeCompare(b.procedimentoNome ?? '') || a.id - b.id);
        const ini = f.pagina * f.porPagina;
        return { itens: lista.slice(ini, ini + f.porPagina), total: lista.length };
      },
      sigtapPorCodigo: async (codigo) => {
        const p = SIGTAP_SINTETICO.find((x) => x.codigo === codigo);
        return p ? { id: p.id, codigo: p.codigo, nome: p.nome } : null;
      },
      buscarSigtap: async (termo) => {
        const t = normal(termo.trim());
        return SIGTAP_SINTETICO.filter((x) => x.codigo.startsWith(t) || normal(x.nome).includes(t)).map(
          (x) => ({
            id: x.id,
            codigo: x.codigo,
            nome: x.nome,
            vigente: true,
          }),
        );
      },
      buscarProcedimentosHospital: async (termo) => {
        const t = normal(termo.trim());
        return PROCEDIMENTOS_HOSPITAL_SINTETICOS.filter(
          (x) => String(x.codigo) === t || normal(x.nome).includes(t),
        );
      },
      procedimentosHospital: async (ids) =>
        PROCEDIMENTOS_HOSPITAL_SINTETICOS.filter((x) => ids.includes(x.id)),
      dadosCiha: async (intervalo, sus): Promise<DadosCihaLidos> => {
        const atendimentos = atendimentosSinteticos(intervalo.inicio).filter(
          (a) => !sus.includes(a.conta.convenio),
        );
        return {
          atendimentos,
          procedimentos: SIGTAP_SINTETICO.map((p) => ({
            id: p.id,
            codigo: p.codigo,
            competenciaInicial: 200801,
            competenciaFinal: 0,
            ...atributos,
          })),
          historico: [],
          registros: SIGTAP_SINTETICO.map((p) => ({
            id: p.id,
            registro: p.registro,
            competenciaInicial: 200801,
            competenciaFinal: 0,
          })),
          cids: new Set(['I10']),
          cnesCadastrados: [9_999_991],
        };
      },
      dadosBpa: async (intervalo, sus): Promise<DadosBpaLidos> => ({
        atendimentos: producaoSusSintetica(intervalo.inicio).filter((a) => sus.includes(a.conta.convenio)),
        procedimentos: SIGTAP_SINTETICO.map((p) => ({
          id: p.id,
          codigo: p.codigo,
          competenciaInicial: 200801,
          competenciaFinal: 0,
          ...atributos,
        })),
        historico: [],
        // A consulta sintética (9001) aceita o BPA-I e o BPA-C (registros 01 e 02); o exame (9002), só o consolidado.
        registros: [
          ...SIGTAP_SINTETICO.map((p) => ({
            id: p.id,
            registro: p.registro,
            competenciaInicial: 200801,
            competenciaFinal: 0,
          })),
          { id: 9001, registro: '01', competenciaInicial: 200801, competenciaFinal: 0 },
        ],
        // A consulta sintética exige o CBO de médico (o executante sintético é 225125) e aceita o CID da massa.
        compatibilidades: {
          cids: [{ id: 9001, codigo: 'I10', competenciaInicial: 200801, competenciaFinal: 0 }],
          cbos: [{ id: 9001, codigo: '225125', competenciaInicial: 200801, competenciaFinal: 0 }],
          habilitacoes: [],
          leitos: [],
        },
        cids: new Set(['I10']),
        cnesCadastrados: [9_999_991],
      }),
      linhasBpa: async (f) => {
        const todas = s.linhasBpa.filter((x) => x.arquivo === f.arquivo);
        const lista = todas.filter(
          (x) =>
            (!f.tipo || x.tipo === f.tipo) && (!f.procedimento || x.procedimento.startsWith(f.procedimento)),
        );
        const porTipo: Record<string, { linhas: number; quantidade: number }> = {};
        for (const x of todas) {
          const t = porTipo[x.tipo] ?? { linhas: 0, quantidade: 0 };
          porTipo[x.tipo] = { linhas: t.linhas + 1, quantidade: t.quantidade + x.quantidade };
        }
        const ini = f.pagina * f.porPagina;
        return {
          itens: lista.slice(ini, ini + f.porPagina).map((x): LinhaBpa => ({
            id: x.id,
            tipo: x.tipo,
            folha: x.folha,
            sequencia: x.sequencia,
            procedimento: x.procedimento,
            cbo: x.cbo,
            idade: x.idade,
            quantidade: x.quantidade,
            data: x.data,
            conta: x.conta,
            atendimento: x.atendimento,
          })),
          total: lista.length,
          porTipo,
        };
      },
      buscarSolicitantes: async (termo) => {
        const t = normal(termo.trim());
        return SOLICITANTES_SINTETICOS.filter(
          (x) => String(x.conselho).startsWith(t) || normal(x.nome).includes(t),
        );
      },
      parametrosCadastro: async () => ({ competenciaAmbulatorio: null, versao: 'SINTETICO', orgao: null }),
      apac: async (id) => s.apacs.find((x) => x.id === id) ?? null,
      paginaApacs: async (f) => {
        const lista = s.apacs
          .filter(
            (x) =>
              (!f.situacao || x.situacao === f.situacao) &&
              (!f.numero || (x.numero ?? '').startsWith(f.numero)) &&
              (!f.prontuario || x.prontuario === f.prontuario) &&
              (!f.competencia ||
                ((x.situacao === 'autorizada' || x.situacao === 'encerrada') &&
                  (x.competenciaInicial ?? '999999') <= f.competencia &&
                  (x.ultimaCompetencia ?? '') >= f.competencia)),
          )
          .sort((a, b) => b.id - a.id);
        const porSituacao: Record<string, number> = {};
        for (const x of s.apacs) porSituacao[x.situacao] = (porSituacao[x.situacao] ?? 0) + 1;
        const ini = f.pagina * f.porPagina;
        return { itens: lista.slice(ini, ini + f.porPagina), total: lista.length, porSituacao };
      },
      apacsDaCompetencia: async (c) =>
        s.apacs.filter(
          (x) =>
            (x.situacao === 'autorizada' || x.situacao === 'encerrada') &&
            (x.competenciaInicial ?? '999999') <= c &&
            (x.ultimaCompetencia ?? '') >= c,
        ),
      atendimentoLaudoApac: async (registro) => {
        const a = producaoSusSintetica('2025-09-01').find((x) => x.conta.registro === registro);
        if (!a) return null;
        return {
          registro,
          atendimento: a.conta.atendimento,
          pacienteId: a.conta.pacienteId,
          prontuario: 500_000 + (registro % 1000),
          data: '2025-09-15',
          convenio: a.conta.convenio,
          cns: a.conta.paciente.cns,
          cidPrincipal: a.conta.cidPrincipal,
        };
      },
      dominiosApac: async () => DOMINIOS_APAC_SINTETICOS,
      buscarSolicitantesApac: async (termo) => {
        const t = normal(termo.trim());
        return SOLICITANTES_APAC_SINTETICOS.filter(
          (x) => String(x.crm ?? '').startsWith(t) || normal(x.nome).includes(t),
        );
      },
      solicitantesApacPorChave: async (chaves) =>
        SOLICITANTES_APAC_SINTETICOS.filter((x) => chaves.includes(x.chave)),
      nomesSigtap: async (ids) =>
        new Map(SIGTAP_SINTETICO.filter((p) => ids.includes(p.id)).map((p) => [p.id, p.nome])),
      linhasApac: async (f) => {
        const todas = s.linhasApac
          .filter((x) => x.arquivo === f.arquivo)
          .sort((a, b) => a.numero.localeCompare(b.numero) || a.id - b.id);
        const ini = f.pagina * f.porPagina;
        return {
          itens: todas.slice(ini, ini + f.porPagina).map((x): LinhaApac => ({
            id: x.id,
            apac: x.apac,
            numero: x.numero,
            tipoNoArquivo: x.tipoNoArquivo,
            procedimento: x.procedimento,
            principal: x.principal,
            cbo: x.cbo,
            quantidade: x.quantidade,
            conta: x.conta,
          })),
          total: todas.length,
          apacs: new Set(todas.map((x) => x.apac)).size,
          quantidade: todas.reduce((n, x) => n + x.quantidade, 0),
        };
      },
    };
  }

  private gravacao(s: EstadoSus): GravacaoSus {
    const comp = (id: number, versao: number, situacao: 'aberta' | 'fechada'): CompetenciaSusRegistro => {
      const c = s.competencias.find((x) => x.id === id);
      if (!c || c.versao !== versao || c.situacao !== situacao) erroVersao();
      return c;
    };
    const trocar = (c: CompetenciaSusRegistro, m: Partial<CompetenciaSusRegistro>) => {
      s.competencias = s.competencias.map((x) => (x.id === c.id ? { ...x, ...m, versao: x.versao + 1 } : x));
    };
    return {
      ...this.leitura(s),
      ...gravacaoAihMemoria(this.baseAih(s)),
      abrir: async (p) => {
        if (s.competencias.some((x) => x.instrumento === p.instrumento && x.competencia === p.competencia))
          throw new ErroSus('competencia-ja-aberta', 'Esta competência já está aberta para o instrumento.');
        const c: CompetenciaSusRegistro = {
          id: ++s.seq,
          instrumento: p.instrumento,
          competencia: p.competencia,
          situacao: 'aberta',
          cnes: null,
          registros: 0,
          bloqueantes: 0,
          avisos: 0,
          criticadaEm: null,
          abertaPor: p.por,
          abertaEm: agora(),
          fechadaPor: null,
          fechadaEm: null,
          reabertaPor: null,
          reabertaEm: null,
          versao: 1,
        };
        s.competencias.push(c);
        return c;
      },
      fechar: async (c, por) =>
        trocar(comp(c.id, c.versao, 'aberta'), { situacao: 'fechada', fechadaPor: por, fechadaEm: agora() }),
      reabrir: async (c, por) =>
        trocar(comp(c.id, c.versao, 'fechada'), {
          situacao: 'aberta',
          fechadaPor: null,
          fechadaEm: null,
          reabertaPor: por,
          reabertaEm: agora(),
        }),
      gravarCriticas: async (c, criticas, contagens) => {
        const atual = comp(c.id, c.versao, 'aberta');
        const vistas = new Set<string>();
        let novas = 0;
        let mantidas = 0;
        let reabertas = 0;
        let bloqueantes = 0;
        let avisos = 0;
        for (const x of criticas) {
          if (vistas.has(x.chave)) continue;
          vistas.add(x.chave);
          const ex = s.criticas.find((y) => y.competencia === c.id && y.chave === x.chave);
          if (x.gravidade === 'bloqueante') bloqueantes += 1;
          else if (ex?.situacao !== 'justificada') avisos += 1;
          if (ex) {
            if (ex.situacao === 'corrigida') {
              s.criticas = s.criticas.map((y) =>
                y.id === ex.id ? { ...y, situacao: 'aberta', versao: y.versao + 1 } : y,
              );
              reabertas += 1;
            } else mantidas += 1;
            continue;
          }
          s.criticas.push({
            id: ++s.seq,
            competencia: c.id,
            chave: x.chave,
            regra: x.regra,
            gravidade: x.gravidade,
            situacao: 'aberta',
            conta: x.conta,
            convenio: x.convenio,
            atendimento: x.atendimento,
            item: x.item,
            detalhe: x.detalhe,
            justificativa: null,
            versao: 1,
          });
          novas += 1;
        }
        let corrigidas = 0;
        s.criticas = s.criticas.map((y) => {
          if (y.competencia !== c.id || vistas.has(y.chave) || y.situacao === 'corrigida') return y;
          corrigidas += 1;
          return { ...y, situacao: 'corrigida', versao: y.versao + 1 };
        });
        trocar(atual, {
          criticadaEm: agora(),
          registros: contagens.registros,
          bloqueantes,
          avisos,
          cnes: contagens.cnes,
        });
        return { novas, mantidas, reabertas, corrigidas, bloqueantes, avisos };
      },
      justificar: async (c, justificativa) => {
        const x = s.criticas.find((y) => y.id === c.id);
        if (!x || x.versao !== c.versao || x.situacao !== 'aberta' || x.gravidade !== 'aviso')
          throw new ErroSus(
            'critica-nao-justificavel',
            'Só o aviso aberto, na versão que a tela leu, pode ser justificado.',
          );
        s.criticas = s.criticas.map((y) =>
          y.id === c.id ? { ...y, situacao: 'justificada', justificativa, versao: y.versao + 1 } : y,
        );
        s.competencias = s.competencias.map((y) =>
          y.id === x.competencia ? { ...y, avisos: Math.max(0, y.avisos - 1) } : y,
        );
      },
      proximoArquivo: async () => ++s.seq,
      gravarArquivo: async (a, registros) => {
        let substituidos = 0;
        s.arquivos = s.arquivos.map((x) => {
          if (x.competenciaId !== a.competencia.id || (x.situacao !== 'gerado' && x.situacao !== 'conferido'))
            return x;
          substituidos += 1;
          return { ...x, situacao: 'substituido' };
        });
        s.arquivos.push({
          id: a.id,
          competenciaId: a.competencia.id,
          instrumento: a.competencia.instrumento,
          competencia: a.competencia.competencia,
          leiaute: a.leiaute,
          versaoLeiaute: a.versaoLeiaute,
          conferidoOficial: a.conferidoOficial,
          nome: a.nome,
          linhas: a.linhas,
          registros: a.registros,
          procedimentos: a.procedimentos,
          semMovimento: a.semMovimento,
          hash: a.hash,
          bytes: a.bytes,
          chaveObjeto: a.chaveObjeto,
          versaoObjeto: a.versaoObjeto,
          situacao: 'gerado',
          geradoPor: a.por,
          geradoEm: agora(),
        });
        registros.forEach((r, k) => s.registros.push({ arquivo: a.id, conta: r.conta, sequencia: k + 1 }));
        return { substituidos };
      },
      incluirApac: async (a) => {
        const linha: ApacRegistro = {
          id: ++s.seq,
          situacao: 'solicitada',
          paciente: a.paciente,
          prontuario: a.prontuario,
          registro: a.registro,
          atendimento: a.atendimento,
          sigtap: a.sigtap,
          procedimento: a.procedimento,
          cidPrincipal: a.cidPrincipal,
          cidSecundario: a.cidSecundario,
          cidAssociado: a.cidAssociado,
          solicitante: a.solicitante,
          dataSolicitacao: a.dataSolicitacao,
          justificativa: a.justificativa,
          laudoEspecifico: a.nefrologia ? 'nefrologia' : 'nenhum',
          nefrologia: a.nefrologia,
          numero: null,
          tipo: null,
          autorizador: null,
          dataAutorizacao: null,
          competenciaInicial: null,
          competenciaFinal: null,
          ultimaCompetencia: null,
          motivoSaida: null,
          dataEncerramento: null,
          justificativaSituacao: null,
          registradaPor: a.por,
          registradaEm: agora(),
          alteradaPor: null,
          alteradaEm: null,
          versao: 1,
        };
        s.apacs.push(linha);
        return linha;
      },
      mudarApac: async (p) => {
        const antes = s.apacs.find((x) => x.id === p.id);
        if (!antes) throw new ErroSus('nao-encontrado', 'APAC não encontrada.');
        if (antes.versao !== p.versao)
          throw new ErroSus('apac-alterada', 'A APAC mudou desde que você abriu a tela. Recarregue.');
        const m = p.mudanca;
        if (
          m.acao === 'autorizar' &&
          s.apacs.some((x) => x.id !== p.id && x.numero !== null && x.numero === m.numero)
        )
          throw new ErroSus(
            'apac-numero-duplicado',
            'Este número de APAC já está registrado neste estabelecimento.',
          );
        let campos: Partial<ApacRegistro>;
        switch (m.acao) {
          case 'autorizar':
            campos = {
              situacao: 'autorizada',
              numero: m.numero,
              tipo: m.tipo,
              autorizador: m.autorizador,
              dataAutorizacao: m.dataAutorizacao,
              competenciaInicial: m.competenciaInicial,
              competenciaFinal: m.competenciaFinal,
              ultimaCompetencia: m.competenciaInicial,
            };
            break;
          case 'negar':
          case 'cancelar':
            campos = {
              situacao: m.acao === 'negar' ? 'negada' : 'cancelada',
              justificativaSituacao: m.justificativa,
            };
            break;
          case 'continuar':
            campos = { ultimaCompetencia: m.ultimaCompetencia };
            break;
          case 'corrigir':
            campos = {
              cidPrincipal: m.cidPrincipal,
              cidSecundario: m.cidSecundario,
              cidAssociado: m.cidAssociado,
              solicitante: m.solicitante,
              dataSolicitacao: m.dataSolicitacao,
              justificativa: m.justificativa,
              laudoEspecifico: m.nefrologia ? 'nefrologia' : 'nenhum',
              nefrologia: m.nefrologia,
            };
            break;
          case 'encerrar':
            campos = {
              situacao: 'encerrada',
              motivoSaida: m.motivo,
              dataEncerramento: m.dataEncerramento,
              ultimaCompetencia: m.ultimaCompetencia,
            };
            break;
        }
        const depois: ApacRegistro = {
          ...antes,
          ...campos,
          alteradaPor: p.por,
          alteradaEm: agora(),
          versao: antes.versao + 1,
        };
        s.apacs = s.apacs.map((x) => (x.id === p.id ? depois : x));
        return { antes, depois };
      },
      gravarArquivoApac: async (a, linhas) => {
        let substituidos = 0;
        s.arquivos = s.arquivos.map((x) => {
          if (x.competenciaId !== a.competencia.id || (x.situacao !== 'gerado' && x.situacao !== 'conferido'))
            return x;
          substituidos += 1;
          return { ...x, situacao: 'substituido' };
        });
        s.arquivos.push({
          id: a.id,
          competenciaId: a.competencia.id,
          instrumento: a.competencia.instrumento,
          competencia: a.competencia.competencia,
          leiaute: a.leiaute,
          versaoLeiaute: a.versaoLeiaute,
          conferidoOficial: a.conferidoOficial,
          nome: a.nome,
          linhas: a.linhas,
          registros: a.registros,
          procedimentos: a.procedimentos,
          semMovimento: a.semMovimento,
          hash: a.hash,
          bytes: a.bytes,
          chaveObjeto: a.chaveObjeto,
          versaoObjeto: a.versaoObjeto,
          situacao: 'gerado',
          geradoPor: a.por,
          geradoEm: agora(),
        });
        for (const l of linhas)
          s.linhasApac.push({
            id: ++s.seq,
            arquivo: a.id,
            apac: l.apac,
            numero: s.apacs.find((x) => x.id === l.apac)?.numero ?? '',
            tipoNoArquivo: l.tipoNoArquivo,
            procedimento: l.procedimento,
            principal: l.principal,
            cbo: l.cbo,
            quantidade: l.quantidade,
            conta: l.conta,
          });
        return { substituidos };
      },
      gravarArquivoBpa: async (a, linhas) => {
        let substituidos = 0;
        s.arquivos = s.arquivos.map((x) => {
          if (x.competenciaId !== a.competencia.id || (x.situacao !== 'gerado' && x.situacao !== 'conferido'))
            return x;
          substituidos += 1;
          return { ...x, situacao: 'substituido' };
        });
        s.arquivos.push({
          id: a.id,
          competenciaId: a.competencia.id,
          instrumento: a.competencia.instrumento,
          competencia: a.competencia.competencia,
          leiaute: a.leiaute,
          versaoLeiaute: a.versaoLeiaute,
          conferidoOficial: a.conferidoOficial,
          nome: a.nome,
          linhas: a.linhas,
          registros: a.registros,
          procedimentos: a.procedimentos,
          semMovimento: a.semMovimento,
          hash: a.hash,
          bytes: a.bytes,
          chaveObjeto: a.chaveObjeto,
          versaoObjeto: a.versaoObjeto,
          situacao: 'gerado',
          geradoPor: a.por,
          geradoEm: agora(),
        });
        for (const l of linhas)
          s.linhasBpa.push({
            id: ++s.seq,
            arquivo: a.id,
            tipo: l.tipo,
            folha: l.folha,
            sequencia: l.sequencia,
            procedimento: l.procedimento,
            cbo: l.cbo,
            idade: l.idade,
            quantidade: l.quantidade,
            data: l.data,
            conta: l.conta,
            atendimento: l.atendimento,
          });
        return { substituidos };
      },
      registrarEquivalencia: async (p) => {
        const antes = s.equivalencias.find((x) => x.procedimento === p.procedimento) ?? null;
        if (antes && antes.versao !== p.versao)
          throw new ErroSus(
            'equivalencia-alterada',
            'A equivalência deste procedimento mudou desde que você abriu a tela. Recarregue.',
          );
        if (antes && antes.ativa && antes.sigtap === p.sigtap) return { antes, depois: antes, mudou: false };
        const depois: EquivalenciaSus = {
          id: antes?.id ?? ++s.seq,
          procedimento: p.procedimento,
          codigoProcedimento: p.codigoProcedimento,
          sigtap: p.sigtap,
          codigo: p.codigo,
          ativa: true,
          registradaPor: p.por,
          registradaEm: agora(),
          versao: (antes?.versao ?? 0) + 1,
        };
        s.equivalencias = [...s.equivalencias.filter((x) => x.procedimento !== p.procedimento), depois];
        return { antes, depois, mudou: true };
      },
      desativarEquivalencia: async (p) => {
        const antes = s.equivalencias.find((x) => x.procedimento === p.procedimento && x.ativa);
        if (!antes) throw new ErroSus('nao-encontrado', 'Não há equivalência ativa para este procedimento.');
        if (antes.versao !== p.versao)
          throw new ErroSus(
            'equivalencia-alterada',
            'A equivalência mudou desde que você abriu a tela. Recarregue.',
          );
        const depois: EquivalenciaSus = { ...antes, ativa: false, versao: antes.versao + 1 };
        s.equivalencias = s.equivalencias.map((x) => (x.id === antes.id ? depois : x));
        return { antes, depois };
      },
      trilha: async (linha) => {
        this.trilhas.push(linha);
      },
    };
  }

  async ler<T>(c: ContextoSus, fn: (l: LeituraSus) => Promise<T>): Promise<T> {
    return fn(this.leitura(this.estado(c.hospital)));
  }

  async gravar<T>(c: ContextoSus, fn: (g: GravacaoSus) => Promise<T>): Promise<T> {
    const s = this.estado(c.hospital);
    const copia = structuredClone(s);
    const trilhas = this.trilhas.length;
    try {
      const r = await fn(this.gravacao(s));
      if (this.aoRegistrarTrilha)
        for (const l of this.trilhas.slice(trilhas)) await this.aoRegistrarTrilha(l);
      return r;
    } catch (erro) {
      Object.assign(s, copia);
      this.trilhas.length = trilhas;
      throw erro;
    }
  }

  /** Para os testes: o que foi gravado no estabelecimento. */
  estadoDe(hospital: string): Readonly<EstadoSus> {
    return this.estado(hospital);
  }
}
