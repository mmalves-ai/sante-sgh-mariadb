// Porta do SADT EM MEMÓRIA (M26): a sessão sintética de dev/ci (E2E) recebe, lança, digita, libera, retifica, coleta,
// rastreia, avisa o valor crítico, emite o laudo e abre o portal sobre exames SINTÉTICOS, sem tocar o banco. As
// gravações aplicam o mesmo Zod das receitas (a entrada do contrato, ENTRADAS_SADT) e as mesmas recusas (pedido suspenso, exame não
// recebido, resultado liberado, sem habilitação, laudo de imagem por não médico, restrição de sexo e repetição). Os
// pedidos do prontuário são os do prontuário em memória (M23: os mesmos IDs), e o resultado liberado aparece lá, com
// a ciência do valor crítico registrada no prontuário. Nenhum nome aqui é de pessoa real (marca "SINTETICO").
import { createHash } from 'node:crypto';
import {
  type AmostraDetalhe,
  type AvisoCritico,
  type ColetaGrupo,
  type EstadoAmostra,
  type EstadoOperacao,
  estadoDoExame,
  type ExameSadt,
  type ItemLiberacao,
  type LaudoPortal,
  NIVEIS_ESCALONAMENTO,
  type OrcamentoLido,
  podeLiberar,
  type RequisicaoLida,
  rotuloAto,
  rotuloEstadoAmostra,
  rotuloEstadoExame,
  SETORES_SADT,
  type SetorSadt,
  setorDoAto,
  type ValorConferencia,
  type ValorCriticoLido,
} from '@sgh/contratos';
import { type ContextoOperacao, ErroOperacao, recusa } from '@sgh/nucleo';
import type { LiberacaoGravacao } from '../exames/public-api.js';
import type { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import { ENTRADAS_SADT } from './operacoes.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import type {
  AcessoPortalLido,
  AtendimentoParaLancamento,
  AutocadastroPortalLido,
  ContextoSadt,
  FiltroExamesSetor,
  GravadorSghSadt,
  LaudoParaEmitir,
  LaudoPortalLido,
  LiberacaoVista,
  PortaSadt,
  ResultadoParaDigitacaoLido,
  VinculoDaSessao,
} from './porta.js';

/** A situação de cada operação por estabelecimento (dev/ci: tudo verde, salvo o que o teste desligar). */
export interface FonteEstadoOperacao {
  estado(operacao: string, hospital: string): EstadoOperacao | null;
}
/** O estabelecimento da sessão como chave do estado em memória. */
const hospitalDe = (c: ContextoSadt): string => c.hospital ?? String(c.estabelecimento ?? 0);
/** Quem grava (a memória mostra o usuário da sessão; sem ele, o processo). */
// O contexto leva o id do usuário; na memória, o id sintético (900000 + posição na lista) volta ao login sintético, que
// dá o vínculo profissional (vinculoSintetico).
const LOGINS_SINTETICOS = Object.keys(CONTAS_SINTETICAS);
const usuarioDe = (ctx: ContextoOperacao): string =>
  ctx.usuario === null ? 'SISTEMA' : (LOGINS_SINTETICOS[ctx.usuario - 900000] ?? String(ctx.usuario));

const M = 'SINTETICO';
const p2 = (n: number) => String(n).padStart(2, '0');
/** O relógio do estabelecimento (America/Sao_Paulo) como texto local 'AAAA-MM-DDTHH:MM:SS'. */
function agoraLocal(d = new Date()): string {
  const x = new Date(d.getTime() - 3 * 3_600_000);
  return x.toISOString().slice(0, 19);
}
const hojeLocal = () => agoraLocal().slice(0, 10);
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

interface ElementoM {
  readonly codigo: number;
  readonly nome: string;
  readonly unidade: string | null;
  readonly casas: number;
  readonly minimo: number | null;
  readonly maximo: number | null;
}
interface ExameCatalogoM {
  readonly id: number;
  readonly ato: number;
  readonly codigo: string;
  readonly nome: string;
  readonly recipiente: { codigo: number; nome: string } | null;
  readonly material: string | null;
  readonly elementos: readonly ElementoM[];
  readonly sexo?: 'F' | 'M';
  readonly ativo: boolean;
  /** Variáveis de fórmula do exame (métodos gráficos estruturados) e as grandezas do cadastro. */
  readonly variaveis?: readonly { codigo: number; identificacao: string; descricao: string }[];
  readonly grandezas?: readonly { codigo: number; nome: string; sigla: string }[];
}

/** O catálogo sintético: os mesmos IDs do prontuário em memória (M23) para os pedidos de lá. */
export const CATALOGO_SADT_SINTETICO: readonly ExameCatalogoM[] = [
  {
    id: 501,
    ato: 15,
    codigo: 'HMG',
    nome: `HEMOGRAMA COMPLETO ${M}`,
    recipiente: { codigo: 1, nome: 'TUBO ROXO (EDTA)' },
    material: 'SANGUE',
    ativo: true,
    elementos: [
      { codigo: 1, nome: 'HEMOGLOBINA', unidade: 'g/dL', casas: 1, minimo: 12, maximo: 17.5 },
      { codigo: 2, nome: 'LEUCÓCITOS', unidade: '/mm3', casas: 0, minimo: 4000, maximo: 11000 },
      { codigo: 3, nome: 'PLAQUETAS', unidade: '/mm3', casas: 0, minimo: 150000, maximo: 450000 },
    ],
  },
  {
    id: 502,
    ato: 15,
    codigo: 'K',
    nome: `POTÁSSIO ${M}`,
    recipiente: { codigo: 2, nome: 'TUBO AMARELO (SORO)' },
    material: 'SANGUE',
    ativo: true,
    elementos: [{ codigo: 0, nome: 'POTÁSSIO', unidade: 'mEq/L', casas: 1, minimo: 3.5, maximo: 5.1 }],
  },
  {
    id: 503,
    ato: 15,
    codigo: 'NA',
    nome: `SÓDIO ${M}`,
    recipiente: { codigo: 2, nome: 'TUBO AMARELO (SORO)' },
    material: 'SANGUE',
    ativo: true,
    elementos: [{ codigo: 0, nome: 'SÓDIO', unidade: 'mEq/L', casas: 0, minimo: 135, maximo: 145 }],
  },
  {
    id: 504,
    ato: 15,
    codigo: 'BHCG',
    nome: `BETA HCG ${M}`,
    recipiente: { codigo: 2, nome: 'TUBO AMARELO (SORO)' },
    material: 'SANGUE',
    ativo: true,
    sexo: 'F',
    elementos: [{ codigo: 0, nome: 'BETA HCG', unidade: 'mUI/mL', casas: 1, minimo: null, maximo: 5 }],
  },
  {
    id: 505,
    ato: 16,
    codigo: 'RXT',
    nome: `RAIO X DE TÓRAX ${M}`,
    recipiente: null,
    material: null,
    ativo: true,
    elementos: [],
  },
  {
    id: 507,
    ato: 24,
    codigo: 'USAT',
    nome: `ULTRASSONOGRAFIA DE ABDOME TOTAL ${M}`,
    recipiente: null,
    material: null,
    ativo: true,
    elementos: [],
  },
  {
    id: 508,
    ato: 90,
    codigo: 'ECG',
    nome: `ELETROCARDIOGRAMA ${M}`,
    recipiente: null,
    material: null,
    ativo: true,
    elementos: [],
    variaveis: [
      { codigo: 1, identificacao: 'FC', descricao: 'Frequência cardíaca (bpm)' },
      { codigo: 2, identificacao: 'PR', descricao: 'Intervalo PR (ms)' },
    ],
    grandezas: [
      { codigo: 1, nome: 'Frequência cardíaca', sigla: 'FC' },
      { codigo: 2, nome: 'Intervalo PR', sigla: 'PR' },
    ],
  },
  {
    id: 509,
    ato: 21,
    codigo: 'EDA',
    nome: `ENDOSCOPIA DIGESTIVA ALTA ${M}`,
    recipiente: null,
    material: null,
    ativo: true,
    elementos: [],
  },
];

/** O vínculo profissional sintético pelo login (o laboratório é de biomédico; o laudador e o médico, médicos). */
export function vinculoSintetico(login: string): VinculoDaSessao | null {
  const l = login.toUpperCase();
  if (/BIOMEDICO/.test(l))
    return { vinculo: 8101, conselho: 4101, nome: `BIOMÉDICA ${M}`, codigoCbo: '221205', ativo: true };
  if (/LAUDADOR|RADIOLOG/.test(l))
    return { vinculo: 8102, conselho: 52101, nome: `RADIOLOGISTA ${M}`, codigoCbo: '225320', ativo: true };
  if (/MEDICO/.test(l))
    return { vinculo: 8103, conselho: 52103, nome: `MÉDICO ${M}`, codigoCbo: '225125', ativo: true };
  if (/RECEPCAO|ATENDIMENTO/.test(l)) return null;
  return null;
}

interface ResultadoM {
  elemento: number;
  numerico: number | null;
  alfa: string | null;
  absoluta: number | null;
}
interface LiberacaoM {
  id: number;
  situacao: 1 | 2;
  em: string;
  visualizadaEm: string | null;
  ip: string | null;
}
interface ExameM {
  id: number;
  chave: ExameSadt['chave'];
  versao: string;
  paciente: number;
  atendimento: number;
  catalogo: ExameCatalogoM;
  pendSadt: 'T' | 'F' | 'S';
  digitado: boolean;
  liberado: boolean;
  emitido: boolean;
  urgente: boolean;
  solicitacao: 1 | 2;
  solicitante: string;
  pedidoEm: string;
  digitadoEm: string | null;
  digitadoPor: string | null;
  liberadoEm: string | null;
  liberadoPor: string | null;
  resultados: ResultadoM[];
  observacoes: string[];
  laudo: { texto: string; html: string; emissor: string } | null;
  /** Os valores das variáveis de fórmula gravadas (código → valor). */
  variaveis?: Record<number, number>;
  liberacoes: LiberacaoM[];
  versoes: { versao: number; em: string; motivo: string | null; viramAntes: number; conteudo: string }[];
  impressao: number | null;
  pepPedido: boolean;
}
interface AmostraM {
  id: number;
  codigo: string;
  paciente: number;
  atendimento: number;
  recipiente: number | null;
  estado: EstadoAmostra;
  pulseira: boolean;
  exames: number[];
  eventos: { estado: EstadoAmostra; em: string; por: string; motivo: string | null }[];
  atualizadaEm: string;
}
interface AvisoM {
  id: number;
  exame: number;
  liberacao: number;
  elemento: number;
  valor: string;
  origem: 'novo' | 'outroSistema';
  liberadoEm: string;
  emitidoEm: string;
  prazo: number;
  nivel: 0 | 1 | 2;
  comunicado: { canal: string; destinatario: string; por: string; em: string } | null;
}
interface ValorCriticoM {
  id: number;
  ato: number;
  exame: string;
  elemento: number;
  abaixoDe: number | null;
  acimaDe: number | null;
  prazoMinutos: number;
  aprovacao: string;
  ativo: boolean;
  atualizadoEm: string;
}
interface OrcamentoM {
  id: number;
  nome: string;
  paciente: number | null;
  convenio: number;
  ato: number;
  data: string;
  validade: string;
  itens: { exame: string; nome: string; valor: number }[];
  convertido: { atendimento: number; em: string } | null;
}
interface AcessoM {
  id: number;
  perfil: 'paciente' | 'medicoExterno';
  paciente: number | null;
  reg: number | null;
  protocolo: string | null;
  conselho: string | null;
  uf: string | null;
  numero: string | null;
  solicitante: number | null;
  nome: string | null;
  senhaResumo: string | null;
  segundoFator: string | null;
  /** W0-10: o e-mail trocado pelo portal do médico (a memória não guarda o do autocadastro). */
  email?: string;
  situacao: string;
  tentativas: number;
  bloqueadoAte: Date | null;
  criadoEm: string;
}
interface Estado {
  exames: Map<number, ExameM>;
  amostras: AmostraM[];
  avisos: AvisoM[];
  valores: ValorCriticoM[];
  orcamentos: OrcamentoM[];
  acessos: AcessoM[];
  laudos: {
    impressao: number;
    numero: string;
    codigo: string;
    exames: number[];
    em: string;
    por: string;
    vias: number;
  }[];
  contas: Map<number, { id: number; numero: number }>;
  solicitantes: { id: number; nome: string; registro: string; ativo: boolean }[];
  idem: Map<string, { hash: string; resultado: Record<string, number | string> }>;
  proximo: number;
}

const CONVENIOS = [
  { codigo: 1, nome: `PARTICULAR ${M}` },
  { codigo: 306, nome: `CONVÊNIO ${M}` },
];
const PRESTADORES = [
  { id: 9101, ato: 15, codigo: 1, nome: `LABORATÓRIO PRÓPRIO ${M}` },
  { id: 9102, ato: 16, codigo: 2, nome: `RADIOLOGIA PRÓPRIA ${M}` },
  { id: 9103, ato: 24, codigo: 3, nome: `ULTRASSONOGRAFIA PRÓPRIA ${M}` },
  { id: 9104, ato: 90, codigo: 4, nome: `MÉTODOS GRÁFICOS ${M}` },
  { id: 9105, ato: 21, codigo: 5, nome: `ENDOSCOPIA ${M}` },
];

export class PortaSadtMemoria implements PortaSadt {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(
    private readonly catalogo: FonteEstadoOperacao | null,
    prontuario: PortaDocumentosMemoria | (() => PortaDocumentosMemoria | null) | null = null,
  ) {
    this.prontuarioDe = typeof prontuario === 'function' ? prontuario : () => prontuario;
  }

  /** O prontuário em memória: direto (testes) ou lido na hora (o módulo do prontuário pode subir depois do SADT). */
  private readonly prontuarioDe: () => PortaDocumentosMemoria | null;
  private get prontuario(): PortaDocumentosMemoria | null {
    return this.prontuarioDe();
  }

  // ── Estado ───────────────────────────────────────────────────────────────────────────────────────

  private e(c: ContextoSadt): Estado {
    let s = this.estados.get(hospitalDe(c));
    if (!s) {
      s = this.semear();
      this.estados.set(hospitalDe(c), s);
    }
    this.sincronizarPedidos(hospitalDe(c), s);
    return s;
  }

  private semear(): Estado {
    const s: Estado = {
      exames: new Map(),
      amostras: [],
      avisos: [],
      valores: [],
      orcamentos: [],
      acessos: [],
      laudos: [],
      contas: new Map([[10011, { id: 77001, numero: 1 }]]),
      solicitantes: [
        { id: 6601, nome: `MÉDICA SOLICITANTE EXTERNA ${M}`, registro: '12345/SP', ativo: true },
        { id: 6602, nome: `MÉDICO SOLICITANTE EXTERNO ${M}`, registro: '54321/SP', ativo: true },
      ],
      idem: new Map(),
      proximo: 990_000,
    };
    const agora = agoraLocal();
    s.valores.push(
      {
        id: 1,
        ato: 15,
        exame: 'K',
        elemento: 0,
        abaixoDe: 2.5,
        acimaDe: 6.5,
        prazoMinutos: 30,
        aprovacao: 'Diretoria clínica, ata sintética 1/2026',
        ativo: true,
        atualizadoEm: agora,
      },
      {
        id: 2,
        ato: 15,
        exame: 'HMG',
        elemento: 1,
        abaixoDe: 7,
        acimaDe: null,
        prazoMinutos: 30,
        aprovacao: 'Diretoria clínica, ata sintética 1/2026',
        ativo: true,
        atualizadoEm: agora,
      },
    );
    // Um exame de imagem recebido a laudar e um de laboratório lançado no setor (paciente 1003, externo).
    const img = this.criarExame(s, {
      catalogo: 505,
      paciente: 1003,
      atendimento: 10031,
      atend: 'E',
      reg: 31338,
      urgente: false,
      solicitacao: 1,
    });
    img.pendSadt = 'F';
    // Um eletrocardiograma recebido a laudar (métodos gráficos, com as variáveis do laudo estruturado).
    this.criarExame(s, {
      catalogo: 508,
      paciente: 1003,
      atendimento: 10031,
      atend: 'E',
      reg: 31338,
      urgente: false,
      solicitacao: 1,
    }).pendSadt = 'F';
    this.criarExame(s, {
      catalogo: 503,
      paciente: 1003,
      atendimento: 10031,
      atend: 'E',
      reg: 31338,
      urgente: false,
      solicitacao: 1,
    }).pendSadt = 'F';
    // Um sódio já liberado do paciente externo (o portal do paciente e o do médico solicitante têm o que mostrar).
    const na = this.criarExame(s, {
      catalogo: 503,
      paciente: 1003,
      atendimento: 10031,
      atend: 'E',
      reg: 31338,
      urgente: false,
      solicitacao: 1,
    });
    Object.assign(na, {
      pendSadt: 'F',
      digitado: true,
      liberado: true,
      liberadoEm: agora,
      liberadoPor: 'SINT.BIOMEDICO',
      digitadoEm: agora,
      digitadoPor: 'SINT.BIOMEDICO',
      resultados: [{ elemento: 0, numerico: 140, alfa: null, absoluta: null }],
    });
    na.liberacoes.push({ id: s.proximo++, situacao: 1, em: agora, visualizadaEm: null, ip: null });
    s.contas.set(10031, { id: 77002, numero: 1 });
    // Um pedido do prontuário do laboratório a coletar e receber (paciente 1001, internado: a coleta lê a pulseira).
    const pedido = this.criarExame(s, {
      catalogo: 501,
      paciente: 1001,
      atendimento: 10011,
      atend: 'I',
      reg: 31337,
      urgente: true,
      solicitacao: 2,
    });
    pedido.pendSadt = 'T';
    s.orcamentos.push({
      id: s.proximo++,
      nome: `PACIENTE PARTICULAR ${M}`,
      paciente: null,
      convenio: 1,
      ato: 15,
      data: hojeLocal(),
      validade: somarDias(hojeLocal(), 30),
      itens: [
        { exame: 'HMG', nome: `HEMOGRAMA COMPLETO ${M}`, valor: 35 },
        { exame: 'K', nome: `POTÁSSIO ${M}`, valor: 18.5 },
        { exame: 'NA', nome: `SÓDIO ${M}`, valor: 18.5 },
      ],
      convertido: null,
    });
    return s;
  }

  /** Os pedidos do prontuário em memória viram os exames do setor (os mesmos IDs). */
  private sincronizarPedidos(hospital: string, s: Estado): void {
    for (const p of this.prontuario?.pedidosParaSadt(hospital) ?? []) {
      if (s.exames.has(p.id)) continue;
      const cat = CATALOGO_SADT_SINTETICO.find((x) => x.id === p.exame);
      if (!cat) continue;
      const at = this.prontuario?.atendimentoParaSadt(p.paciente);
      const e = this.criarExame(
        s,
        {
          catalogo: cat.id,
          paciente: p.paciente,
          atendimento: at?.id ?? p.paciente * 10 + 1,
          atend: at?.tipo === 'externo' ? 'E' : 'I',
          reg: at?.registro ?? 31337,
          urgente: p.urgente,
          solicitacao: 2,
        },
        p.id,
      );
      e.pendSadt = p.pendSadt === 'S' ? 'S' : p.pendSadt === 'F' ? 'F' : 'T';
      e.liberado = p.liberado;
      e.digitado = p.liberado;
      e.pedidoEm = (p.solicitadoEm ?? e.pedidoEm).slice(0, 19);
      e.chave = { ...e.chave, data: p.data ?? e.chave.data };
      e.pepPedido = true;
      if (p.liberado)
        e.liberacoes.push({ id: s.proximo++, situacao: 1, em: e.pedidoEm, visualizadaEm: null, ip: null });
    }
  }

  private criarExame(
    s: Estado,
    o: {
      catalogo: number;
      paciente: number;
      atendimento: number;
      atend: 'I' | 'E';
      reg: number;
      urgente: boolean;
      solicitacao: 1 | 2;
    },
    id = s.proximo++,
  ): ExameM {
    const cat = CATALOGO_SADT_SINTETICO.find((x) => x.id === o.catalogo)!;
    const agora = agoraLocal();
    const e: ExameM = {
      id,
      chave: {
        data: agora.slice(0, 10),
        reg: o.reg,
        conta: 1,
        atend: o.atend,
        ato: cat.ato,
        exame: cat.codigo,
        sequencia: 1,
      },
      versao: new Date().toISOString(),
      paciente: o.paciente,
      atendimento: o.atendimento,
      catalogo: cat,
      pendSadt: 'T',
      digitado: false,
      liberado: false,
      emitido: false,
      urgente: o.urgente,
      solicitacao: o.solicitacao,
      solicitante: `PROFISSIONAL ${M}`,
      pedidoEm: agora,
      digitadoEm: null,
      digitadoPor: null,
      liberadoEm: null,
      liberadoPor: null,
      resultados: [],
      observacoes: [],
      laudo: null,
      liberacoes: [],
      versoes: [],
      impressao: null,
      pepPedido: false,
    };
    s.exames.set(id, e);
    return e;
  }

  private pacienteDe(id: number) {
    const p = this.prontuario?.pacienteParaSadt(id) ?? PACIENTES_RESERVA[id] ?? null;
    if (!p)
      return { id, prontuario: 0, nome: `PACIENTE ${M}`, sexo: null, idadeAnos: null, nascimento: null };
    const [a, mm, d] = p.nascimento.split('-').map(Number) as [number, number, number];
    const hoje = new Date();
    let idade = hoje.getFullYear() - a;
    if (hoje.getMonth() + 1 < mm || (hoje.getMonth() + 1 === mm && hoje.getDate() < d)) idade--;
    return {
      id,
      prontuario: p.prontuario,
      nome: p.nome,
      sexo: p.sexo,
      idadeAnos: idade,
      nascimento: p.nascimento,
    };
  }

  private amostraDoExame(s: Estado, id: number): AmostraM | null {
    const lista = s.amostras.filter((a) => a.exames.includes(id));
    return lista[lista.length - 1] ?? null;
  }

  private exameSadt(s: Estado, e: ExameM): ExameSadt {
    const a = this.amostraDoExame(s, e.id);
    const visto = e.liberacoes.some((l) => l.visualizadaEm !== null);
    const estado = estadoDoExame({
      pendSadt: e.pendSadt,
      digitado: e.digitado,
      liberado: e.liberado,
      emitido: e.emitido || s.laudos.some((l) => l.exames.includes(e.id)),
      visualizado: visto,
      amostra: a?.estado ?? null,
    });
    return {
      id: e.id,
      chave: e.chave,
      versao: e.versao,
      paciente: this.pacienteDe(e.paciente),
      atendimento: {
        cabecalho: String(e.atendimento),
        reg: e.chave.reg,
        tipo: e.chave.atend,
        unidade: 1,
        leito: e.chave.atend === 'I' ? '101A' : null,
      },
      setor: setorDoAto(e.catalogo.ato) ?? 'laboratorio',
      ato: e.catalogo.ato,
      atoRotulo: rotuloAto(e.catalogo.ato),
      exame: { id: e.catalogo.id, codigo: e.catalogo.codigo, nome: e.catalogo.nome },
      estado,
      estadoRotulo: rotuloEstadoExame(estado),
      urgente: e.urgente,
      origem: e.solicitacao === 2 ? 'pedidoProntuario' : 'lancadoNoSetor',
      solicitante: e.solicitante,
      pedidoEm: e.pedidoEm,
      previsaoColeta: e.catalogo.ato === 15 ? e.pedidoEm : null,
      material: e.catalogo.material,
      recipiente: e.catalogo.recipiente,
      especialidade: e.catalogo.ato === 15 ? { codigo: 1, nome: 'BIOQUÍMICA E HEMATOLOGIA' } : null,
      amostra: a
        ? {
            id: a.id,
            codigo: a.codigo,
            estado: a.estado,
            rotulo: rotuloEstadoAmostra(a.estado),
            em: a.atualizadaEm,
          }
        : null,
      critico: s.avisos.some((x) => x.exame === e.id),
    };
  }

  private exameM(s: Estado, id: number): ExameM {
    const e = s.exames.get(id);
    if (!e)
      throw new ErroOperacao(404, 'exame-inexistente', 'Exame não encontrado', 'O exame não existe mais.');
    return e;
  }

  private faixa(s: Estado, e: ExameM, elemento: number): ValorCriticoM | undefined {
    return s.valores.find(
      (v) => v.ativo && v.ato === e.catalogo.ato && v.exame === e.catalogo.codigo && v.elemento === elemento,
    );
  }

  private valores(s: Estado, e: ExameM): ValorConferencia[] {
    if (e.laudo) return [];
    return e.resultados
      .filter((r) => r.numerico !== null || (r.alfa !== null && r.alfa !== ''))
      .map((r) => {
        const el = e.catalogo.elementos.find((x) => x.codigo === r.elemento);
        const f = this.faixa(s, e, r.elemento);
        const n = r.numerico;
        return {
          elemento: el?.nome ?? String(r.elemento),
          valor: r.alfa || String(n),
          numero: n,
          unidade: el?.unidade ?? null,
          referencia:
            el && (el.minimo !== null || el.maximo !== null)
              ? `${el.minimo ?? ''} a ${el.maximo ?? ''}`.trim()
              : null,
          foraDaFaixa:
            n === null || !el
              ? null
              : el.minimo !== null && n < el.minimo
                ? 'abaixo'
                : el.maximo !== null && n > el.maximo
                  ? 'acima'
                  : null,
          critico:
            n !== null &&
            !!f &&
            ((f.abaixoDe !== null && n < f.abaixoDe) || (f.acimaDe !== null && n > f.acimaDe)),
        };
      });
  }

  private conteudo(e: ExameM): string {
    return JSON.stringify({ resultados: e.resultados, laudo: e.laudo?.texto ?? null });
  }

  private publicarNoProntuario(c: ContextoSadt, s: Estado, e: ExameM): void {
    const prontuario = this.prontuario;
    if (!prontuario) return;
    prontuario.marcarPedidoSadt(hospitalDe(c), e.id, { pendSadt: e.pendSadt, liberado: e.liberado });
    if (!e.liberado) return;
    prontuario.publicarResultadoSadt(hospitalDe(c), {
      paciente: e.paciente,
      exame: e.id,
      nome: e.catalogo.nome,
      chave: e.chave,
      liberadoEm: `${e.liberadoEm ?? agoraLocal()}.000`,
      valores: e.resultados.map((r) => {
        const el = e.catalogo.elementos.find((x) => x.codigo === r.elemento);
        const f = this.faixa(s, e, r.elemento);
        return {
          elemento: el?.nome ?? String(r.elemento),
          numerico: r.numerico,
          alfa: r.alfa,
          unidade: el?.unidade ?? null,
          refIni: el?.minimo ?? null,
          refFin: el?.maximo ?? null,
          referencia:
            el && (el.minimo !== null || el.maximo !== null)
              ? `${el.minimo ?? ''} a ${el.maximo ?? ''}`
              : null,
          minAbe: f?.abaixoDe ?? null,
          maxAbe: f?.acimaDe ?? null,
        };
      }),
      texto: e.laudo?.texto ?? null,
    });
  }

  // ── Gravação ─────────────────────────────────────────────────────────────────────────────────────

  private estadoOp(op: string, hospital: string): EstadoOperacao | null {
    return this.catalogo?.estado(op, hospital) ?? 'verde';
  }

  async podeGravar(c: ContextoSadt, op: string): Promise<LiberacaoGravacao> {
    const e = this.estadoOp(op, hospitalDe(c));
    if (e === null || e === 'bloqueada')
      return {
        pode: false,
        codigo: 'operacao-bloqueada',
        motivo: 'A gravação está bloqueada neste estabelecimento (catálogo de operações).',
      };
    if (!ENTRADAS_SADT[op])
      return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(c: ContextoSadt, op: string, entradaBruta: unknown, ctx: ContextoOperacao) {
    const entrada = ENTRADAS_SADT[op];
    if (!entrada) throw recusa('operacao-desconhecida', 'Operação desconhecida no SADT.');
    const analise = entrada.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const hash = JSON.stringify(analise.data);
    const anterior = s.idem.get(chave);
    if (anterior) {
      if (anterior.hash !== hash)
        throw new ErroOperacao(
          422,
          'idempotencia-divergente',
          'Pedido repetido diferente',
          'A mesma chave de pedido veio com outro conteúdo.',
        );
      return { resultado: anterior.resultado, repetida: true, trilha: null };
    }
    const resultado = this.aplicar(c, s, op, analise.data as Record<string, any>, usuarioDe(ctx)); // eslint-disable-line @typescript-eslint/no-explicit-any
    s.idem.set(chave, { hash, resultado });
    return { resultado, repetida: false, trilha: null };
  }

  /**
   * sadt.receberSolicitacao no contrato novo (POST /api/sadt/exames-pedidos/receber) sem o banco do cliente: o exame
   * pelo id e pela versão da lista do setor, com as mesmas recusas do gravador (versão divergente, suspenso, já recebido).
   */
  receberNoSetor(
    c: ContextoSadt,
    exames: readonly { id: number; versao: string | null }[],
  ): { id: number; recebidos: number; mensagem: string } {
    const s = this.e(c);
    const r = this.aplicar(c, s, 'sadt.receberSolicitacao', { exames }, M);
    const n = new Set(exames.map((x) => x.id)).size;
    return {
      id: Number(r['exame']),
      recebidos: n,
      mensagem: n === 1 ? 'Pedido recebido no setor.' : `${n} pedidos recebidos no setor.`,
    };
  }

  private conferirVersao(e: ExameM, versao: string | null): void {
    // Como o gravador do banco: o carimbo inteiro, e o nulo não pula a conferência.
    if (versao !== e.versao)
      throw new ErroOperacao(
        409,
        'conflito-versao',
        'Exame alterado',
        'O exame foi alterado depois da leitura (no outro sistema ou em outra estação). Releia antes de gravar.',
      );
  }

  private tocar(e: ExameM): void {
    // O carimbo muda a cada gravação (a próxima leitura da tela pega o novo).
    const atual = Date.parse(e.versao);
    e.versao = new Date(Math.max(Date.now(), atual + 1000)).toISOString();
  }

  private aplicar(
    c: ContextoSadt,
    s: Estado,
    op: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x: Record<string, any>,
    login: string,
  ): Record<string, number | string> {
    const agora = agoraLocal();
    switch (op) {
      case 'sadt.receberSolicitacao': {
        for (const l of x['exames'] as { id: number; versao: string | null }[]) {
          const e = this.exameM(s, l.id);
          this.conferirVersao(e, l.versao);
          if (e.pendSadt === 'S') throw recusa('pedido-suspenso', 'O pedido foi suspenso no prontuário.');
          if (e.pendSadt === 'F') throw recusa('pedido-recebido', 'O pedido já foi recebido pelo setor.');
        }
        for (const l of x['exames'] as { id: number }[]) {
          const e = this.exameM(s, l.id);
          e.pendSadt = 'F';
          this.tocar(e);
          this.publicarNoProntuario(c, s, e);
        }
        return { exame: (x['exames'] as { id: number }[])[0]!.id };
      }
      case 'sadt.lancarExame': {
        const conta = s.contas.get(x['atendimento'] as number);
        if (!conta)
          throw recusa(
            'sem-conta-de-exames',
            'O atendimento ainda não tem a requisição de exames aberta: abra a requisição antes de lançar.',
          );
        const paciente = Math.floor((x['atendimento'] as number) / 10);
        const p = this.pacienteDe(paciente);
        const itens = x['itens'] as { exame: number; urgente: boolean }[];
        const cats = itens.map((i) => {
          const cat = CATALOGO_SADT_SINTETICO.find((y) => y.id === i.exame);
          if (!cat || !cat.ativo)
            throw recusa('exame-inativo', 'Exame inativo ou fora do cadastro de exames.', {
              campos: ['itens'],
            });
          return cat;
        });
        if (cats.some((y) => y.ato !== x['ato']))
          throw recusa('atos-diferentes', 'Lance os exames de um setor (ato) por vez.', {
            campos: ['itens'],
          });
        const alertas: string[] = [];
        for (const cat of cats) {
          if (cat.sexo && p.sexo && cat.sexo !== p.sexo)
            alertas.push(`${cat.nome}: exame incompatível com o sexo do paciente.`);
          const limite = Date.now() - (x['repeticaoMinimaHoras'] as number) * 3_600_000;
          const repetido = [...s.exames.values()].some(
            (y) =>
              y.paciente === paciente &&
              y.catalogo.id === cat.id &&
              Date.parse(`${y.pedidoEm}Z`) + 3 * 3_600_000 > limite,
          );
          if (repetido) alertas.push(`${cat.nome}: pedido repetido dentro do intervalo mínimo.`);
        }
        if (alertas.length && !x['confirmarAlertas'])
          throw recusa('restricao-do-exame', `${alertas.join(' ')} Confirme para lançar mesmo assim.`, {
            campos: ['itens'],
          });
        let primeiro = 0;
        for (let i = 0; i < cats.length; i++) {
          const e = this.criarExame(s, {
            catalogo: cats[i]!.id,
            paciente,
            atendimento: x['atendimento'] as number,
            atend: x['atend'] as 'I' | 'E',
            reg: REGS_SINTETICOS[x['atendimento'] as number] ?? 31338,
            urgente: itens[i]!.urgente,
            solicitacao: 1,
          });
          e.pendSadt = 'F';
          e.chave = { ...e.chave, sequencia: i + 1 };
          primeiro ||= e.id;
        }
        return { primeiro, exames: cats.length };
      }
      case 'sadt.registrarLaudo':
      case 'sadt.registrarResultado': {
        const e = this.exameM(s, x['exame'].id as number);
        this.conferirVersao(e, x['exame'].versao as string | null);
        if (e.pendSadt === 'S') throw recusa('pedido-suspenso', 'O pedido foi suspenso no prontuário.');
        if (e.pendSadt !== 'F')
          throw recusa('exame-nao-recebido', 'Receba o pedido no setor antes de digitar o resultado.');
        if (e.liberado)
          throw recusa('resultado-liberado', 'Resultado liberado não muda: use a retificação, com o motivo.');
        const laudo = x['laudo'] as { texto: string; html: string } | undefined;
        if (laudo) {
          const v = x['emissor']
            ? [...[vinculoSintetico(login)]].find((y) => y?.vinculo === x['emissor'])
            : null;
          if (!v || !/^225/.test(v.codigoCbo))
            throw recusa(
              'laudo-privativo-de-medico',
              'O laudo deste exame é privativo de médico (Lei 12.842/2013).',
              { campos: ['emissor'] },
            );
          e.laudo = { texto: laudo.texto, html: laudo.html, emissor: v.nome };
          e.resultados = [{ elemento: 0, numerico: 0, alfa: '', absoluta: 0 }];
        } else {
          for (const v of x['elementos'] as ResultadoM[]) {
            if (!e.catalogo.elementos.some((y) => y.codigo === v.elemento))
              throw recusa('elemento-inexistente', `O elemento ${v.elemento} não é do exame.`, {
                campos: ['elementos'],
              });
          }
          const novos = new Map(e.resultados.map((r) => [r.elemento, r]));
          for (const v of x['elementos'] as ResultadoM[]) novos.set(v.elemento, { ...v });
          e.resultados = [...novos.values()].sort((a, b) => a.elemento - b.elemento);
        }
        e.observacoes = [...(x['observacoes'] as string[])];
        for (const v of (x['variaveis'] ?? []) as { codigo: number; valor: number }[]) {
          if (!(e.catalogo.variaveis ?? []).some((y) => y.codigo === v.codigo))
            throw recusa('variavel-inexistente', `A variável ${v.codigo} não é do exame.`, {
              campos: ['variaveis'],
            });
          e.variaveis = { ...(e.variaveis ?? {}), [v.codigo]: v.valor };
        }
        const faltam = e.catalogo.elementos.filter(
          (el) => !e.resultados.some((r) => r.elemento === el.codigo),
        );
        e.digitado = laudo !== undefined || faltam.length === 0;
        e.digitadoEm = agora;
        e.digitadoPor = login;
        // O gatilho do outro sistema inclui a liberação para visualização na digitação (situação 1), uma só vigente.
        if (!e.liberacoes.some((l) => l.situacao === 1 && l.visualizadaEm === null))
          e.liberacoes.push({ id: s.proximo++, situacao: 1, em: agora, visualizadaEm: null, ip: null });
        this.tocar(e);
        return { exame: e.id, resultados: e.resultados.length, primeiro: e.id };
      }
      case 'sadt.liberarExame': {
        const l = (x['exames'] as { id: number; versao: string | null }[])[0]!;
        if ((x['exames'] as unknown[]).length !== 1)
          throw recusa('um-exame-por-vez', 'Libere um exame por vez.');
        const e = this.exameM(s, l.id);
        this.conferirVersao(e, l.versao);
        if (e.liberado) throw recusa('resultado-liberado', 'O resultado já foi liberado.');
        if (!e.digitado) throw recusa('resultado-incompleto', 'Digite todos os elementos antes de liberar.');
        const v = vinculoSintetico(login);
        const h = podeLiberar(
          e.catalogo.ato,
          v && v.vinculo === x['responsavel'] ? { cbo: v.codigoCbo, conselhoAtivo: v.ativo } : null,
        );
        if (!h.pode) throw recusa('sem-habilitacao', h.motivo ?? 'Sem habilitação para liberar.');
        const criticos = this.valores(s, e).filter((y) => y.critico);
        if (criticos.length && !x['confirmarCritico'])
          throw recusa('confirmar-critico', 'O resultado tem valor crítico: confirme para liberar.');
        e.liberado = true;
        e.liberadoEm = agora;
        e.liberadoPor = login;
        e.versoes.push({
          versao: e.versoes.length + 1,
          em: agora,
          motivo: null,
          viramAntes: 0,
          conteudo: this.conteudo(e),
        });
        this.avisar(s, e, 'novo', agora);
        this.tocar(e);
        this.publicarNoProntuario(c, s, e);
        return { exame: e.id };
      }
      case 'sadt.retificarResultado': {
        const e = this.exameM(s, x['exame'].id as number);
        this.conferirVersao(e, x['exame'].versao as string | null);
        if (!e.liberado)
          throw recusa(
            'resultado-nao-liberado',
            'Só o resultado liberado é retificado; antes de liberar, corrija na digitação.',
          );
        const v = vinculoSintetico(login);
        const h = podeLiberar(
          e.catalogo.ato,
          v && v.vinculo === x['responsavel'] ? { cbo: v.codigoCbo, conselhoAtivo: v.ativo } : null,
        );
        if (!h.pode) throw recusa('sem-habilitacao', h.motivo ?? 'Sem habilitação para retificar.');
        const vistos = e.liberacoes.filter((y) => y.visualizadaEm !== null).length;
        if (!e.versoes.length)
          e.versoes.push({
            versao: 1,
            em: e.liberadoEm ?? agora,
            motivo: null,
            viramAntes: 0,
            conteudo: this.conteudo(e),
          });
        const laudo = x['laudo'] as { texto: string; html: string } | undefined;
        if (laudo && e.laudo) e.laudo = { ...e.laudo, texto: laudo.texto, html: laudo.html };
        const novos = new Map(e.resultados.map((r) => [r.elemento, r]));
        for (const r of x['elementos'] as ResultadoM[]) novos.set(r.elemento, { ...r });
        e.resultados = [...novos.values()].sort((a, b) => a.elemento - b.elemento);
        for (const l of e.liberacoes) if (l.situacao === 1 && l.visualizadaEm === null) l.situacao = 2;
        e.liberacoes.push({ id: s.proximo++, situacao: 1, em: agora, visualizadaEm: null, ip: null });
        e.versoes.push({
          versao: e.versoes.length + 1,
          em: agora,
          motivo: x['motivo'] as string,
          viramAntes: vistos,
          conteudo: this.conteudo(e),
        });
        this.avisar(s, e, 'novo', agora);
        this.tocar(e);
        this.publicarNoProntuario(c, s, e);
        return { exame: e.id };
      }
      case 'sadt.emitirLaudo': {
        const ids = x['exames'] as number[];
        for (const id of ids)
          if (!this.exameM(s, id).liberado)
            throw recusa('resultado-nao-liberado', 'O laudo só é emitido depois da liberação.');
        const impressao = s.proximo++;
        s.laudos.push({
          impressao,
          numero: String(impressao),
          codigo: x['codigo'] as string,
          exames: ids,
          em: agora,
          por: login,
          vias: 1,
        });
        for (const id of ids) {
          const e = this.exameM(s, id);
          e.emitido = true;
          e.impressao = impressao;
          this.tocar(e);
        }
        return { impressao, exames: ids.length };
      }
      case 'sadt.criarOrcamento': {
        const id = s.proximo++;
        s.orcamentos.push({
          id,
          nome: x['nome'] as string,
          paciente: (x['paciente'] as number | undefined) ?? null,
          convenio: x['convenio'] as number,
          ato: x['ato'] as number,
          data: hojeLocal(),
          validade: somarDias(hojeLocal(), x['validadeDias'] as number),
          itens: (x['itens'] as { exame: string; valor: number }[]).map((i) => {
            const cat = CATALOGO_SADT_SINTETICO.find((y) => y.ato === x['ato'] && y.codigo === i.exame);
            if (!cat || !cat.ativo)
              throw recusa('exame-inativo', `O exame ${i.exame} está inativo.`, { campos: ['itens'] });
            return { exame: i.exame, nome: cat.nome, valor: i.valor };
          }),
          convertido: null,
        });
        return { itens: (x['itens'] as unknown[]).length, orcamento: id };
      }
      case 'sadt.registrarVisualizacaoPortal': {
        for (const e of s.exames.values()) {
          const l = e.liberacoes.find((y) => y.id === x['liberacao']);
          if (!l) continue;
          if (l.situacao !== 1)
            throw recusa('liberacao-substituida', 'Esta versão do laudo foi substituída.');
          if (l.visualizadaEm !== null)
            throw recusa('ja-visto', 'A visualização deste laudo já foi registrada.');
          l.visualizadaEm = agora;
          l.ip = x['ip'] as string;
          return { liberacao: l.id };
        }
        throw new ErroOperacao(
          404,
          'liberacao-inexistente',
          'Laudo não encontrado',
          'A liberação não existe.',
        );
      }
      case 'sadt.abrirRequisicao': {
        const a = x['atendimento'] as number;
        if (s.contas.has(a))
          throw recusa('requisicao-aberta', 'O atendimento já tem a requisição de exames aberta.');
        const conta = { id: s.proximo++, numero: 1 };
        s.contas.set(a, conta);
        return { conta: conta.id };
      }
      case 'cadastro.cadastrarSolicitante': {
        const registro = `${x['numero']}/${x['uf']}`;
        if (s.solicitantes.some((y) => y.registro === registro))
          throw recusa(
            'solicitante-duplicado',
            'Já existe médico solicitante com este conselho, UF e número.',
          );
        const id = s.proximo++;
        s.solicitantes.push({ id, nome: x['nome'] as string, registro, ativo: true });
        return { solicitante: id };
      }
      default:
        throw recusa('operacao-especificada', 'Esta gravação não existe na sessão sintética.');
    }
  }

  /** Os avisos dos elementos críticos da liberação (um por exame, elemento e liberação vigente). */
  private avisar(s: Estado, e: ExameM, origem: 'novo' | 'outroSistema', agora: string): number {
    let n = 0;
    for (const v of this.valores(s, e)) {
      if (!v.critico) continue;
      const r = e.resultados.find(
        (y) =>
          (e.catalogo.elementos.find((el) => el.codigo === y.elemento)?.nome ?? String(y.elemento)) ===
          v.elemento,
      );
      const el = r?.elemento ?? 0;
      const lib = e.liberacoes.filter((l) => l.situacao === 1).at(-1)?.id ?? 0;
      if (s.avisos.some((a) => a.exame === e.id && a.elemento === el && a.liberacao === lib)) continue;
      const f = this.faixa(s, e, el);
      s.avisos.push({
        id: s.proximo++,
        exame: e.id,
        liberacao: lib,
        elemento: el,
        valor: v.valor,
        origem,
        liberadoEm: agora,
        emitidoEm: agora,
        prazo: f?.prazoMinutos ?? 30,
        nivel: 0,
        comunicado: null,
      });
      n++;
    }
    return n;
  }

  async gravarSgh<T>(c: ContextoSadt, _trilha: unknown, fn: (g: GravadorSghSadt) => Promise<T>): Promise<T> {
    return fn(this.gravador(c));
  }

  private gravador(c: ContextoSadt): GravadorSghSadt {
    const s = this.e(c);
    const agora = () => agoraLocal();
    return {
      registrarColeta: async (a) => {
        for (const x of a.exames) {
          const ja = this.amostraDoExame(s, x.id);
          if (ja && ja.estado !== 'rejeitada' && ja.estado !== 'recoleta')
            throw recusa('amostra-coletada', 'O exame já tem amostra coletada.');
        }
        const id = s.proximo++;
        const codigo = a.codigo(id);
        s.amostras.push({
          id,
          codigo,
          paciente: a.paciente,
          atendimento: a.atendimento,
          recipiente: a.recipiente,
          estado: 'coletada',
          pulseira: a.pulseiraConferida,
          exames: a.exames.map((x) => x.id),
          eventos: [{ estado: 'coletada', em: agora(), por: a.usuario, motivo: null }],
          atualizadaEm: agora(),
        });
        return { id, codigo };
      },
      mudarEstadoAmostra: async (r) => {
        const a = s.amostras.find((x) => x.id === r.amostra);
        if (!a || a.estado !== r.de)
          throw recusa(
            'amostra-alterada',
            'A amostra mudou de estado depois da leitura (outra estação). Releia.',
          );
        a.estado = r.para;
        a.atualizadaEm = agora();
        a.eventos.push({
          estado: r.para,
          em: agora(),
          por: r.usuario,
          motivo: r.motivo ? (r.detalhe ? `${r.motivo}: ${r.detalhe}` : r.motivo) : r.detalhe,
        });
      },
      gravarValorCritico: async (f) => {
        const ja = s.valores.find((v) => v.ato === f.ato && v.exame === f.exame && v.elemento === f.elemento);
        if (ja) {
          Object.assign(ja, {
            abaixoDe: f.abaixoDe,
            acimaDe: f.acimaDe,
            prazoMinutos: f.prazoMinutos,
            aprovacao: f.aprovacao,
            ativo: f.ativo,
            atualizadoEm: agora(),
          });
          return ja.id;
        }
        const id = s.proximo++;
        s.valores.push({ id, ...f, atualizadoEm: agora() });
        return id;
      },
      avisarCriticos: async (a) => this.avisar(s, this.exameM(s, a.exameItem), 'novo', agora()),
      comunicarAviso: async (r) => {
        const a = s.avisos.find((x) => x.id === r.aviso);
        if (!a || a.comunicado) throw recusa('aviso-comunicado', 'O aviso não existe ou já foi comunicado.');
        a.comunicado = { canal: r.canal, destinatario: r.destinatario, por: r.usuario, em: agora() };
      },
      escalonarAviso: async (r) => {
        const a = s.avisos.find((x) => x.id === r.aviso);
        if (!a || a.nivel >= r.nivel) return false;
        a.nivel = r.nivel as 0 | 1 | 2;
        return true;
      },
      registrarLeitura: async () => undefined,
      marcarOrcamentoConvertido: async (r) => {
        const o = s.orcamentos.find((x) => x.id === r.orcamento);
        if (!o || o.convertido) throw recusa('orcamento-convertido', 'O orçamento já foi convertido.');
        o.convertido = { atendimento: r.atendimento, em: agora() };
      },
      reservarNumeroLaudo: async () => String(s.proximo++),
      registrarLaudoEmitido: async (r) => {
        const l = s.laudos.find((x) => x.codigo === r.codigo);
        if (l) {
          // A via seguinte é do mesmo laudo: o número dele e a via seguinte.
          l.vias += 1;
          return { id: s.proximo++, numero: l.numero };
        }
        const id = s.proximo++;
        s.laudos.push({
          impressao: id,
          numero: r.numero,
          codigo: r.codigo,
          exames: [...(r.idsExames ?? [])],
          em: agora(),
          por: r.usuario,
          vias: 1,
        });
        return { id, numero: r.numero };
      },
      criarProtocoloPortal: async (r) => {
        for (const a of s.acessos)
          if (a.perfil === 'paciente' && a.reg === r.reg && a.situacao === 'ativo') a.situacao = 'encerrado';
        const id = s.proximo++;
        s.acessos.push({
          id,
          perfil: 'paciente',
          paciente: r.paciente,
          reg: r.reg,
          protocolo: r.protocoloResumo,
          conselho: null,
          uf: null,
          numero: null,
          solicitante: null,
          nome: null,
          senhaResumo: null,
          segundoFator: null,
          situacao: 'ativo',
          tentativas: 0,
          bloqueadoAte: null,
          criadoEm: agora(),
        });
        return id;
      },
      registrarAutocadastro: async (r) => {
        if (s.acessos.some((a) => a.conselho === r.conselho && a.uf === r.uf && a.numero === r.numero))
          throw recusa('autocadastro-existente', 'Já existe cadastro para este conselho, UF e número.');
        const id = s.proximo++;
        s.acessos.push({
          id,
          perfil: 'medicoExterno',
          paciente: null,
          reg: null,
          protocolo: null,
          conselho: r.conselho,
          uf: r.uf,
          numero: r.numero,
          solicitante: null,
          nome: r.nome,
          senhaResumo: r.senhaResumo,
          segundoFator: r.segundoFator,
          situacao: 'pendente',
          tentativas: 0,
          bloqueadoAte: null,
          criadoEm: agora(),
        });
        return id;
      },
      decidirAutocadastro: async (r) => {
        const a = s.acessos.find((x) => x.id === r.id && x.perfil === 'medicoExterno');
        if (!a || a.situacao !== 'pendente')
          throw recusa('autocadastro-decidido', 'O autocadastro não está pendente.');
        if (r.aprovar) {
          // O mesmo que o gravador do banco: o solicitante tem o número e a UF declarados.
          const m = s.solicitantes.find((x) => x.id === r.solicitante);
          if (!m || m.registro !== `${Number(a.numero)}/${a.uf}`)
            throw recusa(
              'solicitante-divergente',
              'O médico solicitante escolhido não tem o número e a UF do conselho informados no autocadastro.',
            );
        }
        a.situacao = r.aprovar ? 'ativo' : 'recusado';
        a.solicitante = r.solicitante;
      },
      registrarTentativaPortal: async (r) => {
        const a = s.acessos.find((x) => x.id === r.id);
        if (!a) return;
        a.tentativas = r.tentativas;
        a.bloqueadoAte = r.bloqueadoAte;
      },
    };
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────

  async relogio(): Promise<{ hoje: string; agora: string }> {
    const a = agoraLocal();
    return { hoje: a.slice(0, 10), agora: a };
  }

  private lista(s: Estado, f: FiltroExamesSetor): ExameM[] {
    const atos = f.setor ? (SETORES_SADT.find((x) => x.codigo === f.setor)?.atos as readonly number[]) : null;
    const termo = (f.termo ?? '').trim().toUpperCase();
    return [...s.exames.values()].filter((e) => {
      if (e.chave.data < f.inicio || e.chave.data > f.fim) return false;
      if (atos && !atos.includes(e.catalogo.ato)) return false;
      if (f.ato && e.catalogo.ato !== f.ato) return false;
      if (f.urgentes && !e.urgente) return false;
      if (termo) {
        const p = this.pacienteDe(e.paciente);
        if (/^\d+$/.test(termo)) {
          if (String(p.prontuario) !== termo && String(e.chave.reg) !== termo) return false;
        } else if (!p.nome.toUpperCase().includes(termo)) return false;
      }
      return true;
    });
  }

  async examesDoSetor(c: ContextoSadt, f: FiltroExamesSetor) {
    const s = this.e(c);
    const todos = this.lista(s, f);
    const sit = f.situacao ?? 'todos';
    const filtro = (e: ExameM) =>
      e.pendSadt !== 'S' &&
      (sit === 'todos' ||
        (sit === 'aReceber' && e.pendSadt === 'T') ||
        (sit === 'recebidos' && e.pendSadt === 'F') ||
        (sit === 'aDigitar' && e.pendSadt === 'F' && !e.digitado && !e.liberado) ||
        (sit === 'aLiberar' && e.digitado && !e.liberado) ||
        (sit === 'liberados' && e.liberado) ||
        (sit === 'aEmitir' && e.liberado && !e.emitido));
    const itens = todos
      .filter(filtro)
      .sort((a, b) => Number(b.urgente) - Number(a.urgente) || a.id - b.id)
      .map((e) => this.exameSadt(s, e));
    const conta = (fn: (e: ExameM) => boolean) => todos.filter(fn).length;
    return {
      itens,
      cortada: false,
      contagens: {
        aReceber: conta((e) => e.pendSadt === 'T'),
        aDigitar: conta((e) => e.pendSadt === 'F' && !e.digitado && !e.liberado),
        aLiberar: conta((e) => e.digitado && !e.liberado),
        liberados: conta((e) => e.liberado),
        aEmitir: conta((e) => e.liberado && !e.emitido),
        suspensos: conta((e) => e.pendSadt === 'S'),
        todos: todos.length,
      },
    };
  }

  async exame(c: ContextoSadt, id: number) {
    const s = this.e(c);
    const e = s.exames.get(id);
    return e ? this.exameSadt(s, e) : null;
  }

  async examesPorId(c: ContextoSadt, ids: readonly number[]) {
    const s = this.e(c);
    return ids
      .map((id) => s.exames.get(id))
      .filter((e): e is ExameM => !!e)
      .map((e) => this.exameSadt(s, e));
  }

  async coleta(
    c: ContextoSadt,
    f: { inicio: string; fim: string; unidade?: number; deHora?: string; ateHora?: string },
  ) {
    const s = this.e(c);
    const pendentes = this.lista(s, { setor: 'laboratorio', inicio: f.inicio, fim: f.fim })
      .filter((e) => e.pendSadt === 'T')
      .map((e) => this.exameSadt(s, e));
    const porUnidade = new Map<number, number>();
    for (const e of pendentes)
      if (e.atendimento.unidade)
        porUnidade.set(e.atendimento.unidade, (porUnidade.get(e.atendimento.unidade) ?? 0) + 1);
    const hora = (x: string | null) => (x ? x.slice(11, 16) : null);
    const exames = pendentes.filter(
      (e) =>
        (!f.unidade || e.atendimento.unidade === f.unidade) &&
        (!f.deHora || (hora(e.previsaoColeta) ?? '') >= f.deHora) &&
        (!f.ateHora || (hora(e.previsaoColeta) ?? '99') <= f.ateHora),
    );
    const grupos = new Map<string, ColetaGrupo>();
    for (const e of exames) {
      const k = `${e.atendimento.cabecalho}|${e.recipiente?.codigo ?? 0}`;
      const coletado = !!e.amostra && e.amostra.estado !== 'rejeitada' && e.amostra.estado !== 'recoleta';
      const item = { id: e.id, codigo: e.exame.codigo, nome: e.exame.nome, coletado };
      const g = grupos.get(k);
      if (g) {
        (g.exames as ColetaGrupo['exames'][number][]).push(item);
        continue;
      }
      grupos.set(k, {
        paciente: e.paciente,
        atendimento: {
          cabecalho: e.atendimento.cabecalho,
          tipo: e.atendimento.tipo,
          leito: e.atendimento.leito,
          unidade: e.atendimento.unidade,
        },
        recipiente: e.recipiente,
        material: e.material,
        previsao: e.previsaoColeta,
        urgente: e.urgente,
        exames: [item],
        exigePulseira: e.atendimento.tipo === 'I',
      });
    }
    return {
      grupos: [...grupos.values()],
      cortada: false,
      unidades: [...porUnidade].sort((a, b) => a[0] - b[0]).map(([codigo, n]) => ({ codigo, exames: n })),
    };
  }

  async mapa(c: ContextoSadt, f: { setor: SetorSadt; inicio: string; fim: string }) {
    const r = await this.examesDoSetor(c, { ...f, situacao: 'aDigitar' });
    const b = new Map<
      string,
      { codigo: number | null; nome: string; urgentes: number; exames: ExameSadt[] }
    >();
    for (const e of r.itens) {
      const k = String(e.especialidade?.codigo ?? 0);
      const x = b.get(k) ?? {
        codigo: e.especialidade?.codigo ?? null,
        nome: e.especialidade?.nome ?? 'Sem bancada',
        urgentes: 0,
        exames: [],
      };
      x.exames.push(e);
      if (e.urgente) x.urgentes++;
      b.set(k, x);
    }
    return { bancadas: [...b.values()], cortada: false };
  }

  async digitacao(c: ContextoSadt, id: number): Promise<ResultadoParaDigitacaoLido | null> {
    const s = this.e(c);
    const e = s.exames.get(id);
    if (!e) return null;
    const ex = this.exameSadt(s, e);
    return {
      exame: ex,
      elementos: e.catalogo.elementos.map((el) => {
        const f = this.faixa(s, e, el.codigo);
        const r = e.resultados.find((x) => x.elemento === el.codigo);
        return {
          codigo: el.codigo,
          nome: el.nome,
          titulo: false,
          unidade: el.unidade,
          casas: el.casas,
          numerico: true,
          minimoAberto: null,
          maximoAberto: null,
          referencia: {
            texto: null,
            minimo: el.minimo,
            maximo: el.maximo,
            versao: 'atual',
            fonte: 'cadastro',
          },
          respostasPadrao: [],
          critico: f ? { abaixoDe: f.abaixoDe, acimaDe: f.acimaDe, prazoMinutos: f.prazoMinutos } : null,
          valor: r ? { numerico: r.numerico, alfa: r.alfa, absoluta: r.absoluta } : null,
        };
      }),
      variaveis: (e.catalogo.variaveis ?? []).map((v) => ({ ...v, valor: e.variaveis?.[v.codigo] ?? null })),
      observacoes: e.observacoes,
      modelos:
        e.catalogo.ato === 15
          ? []
          : [{ codigo: 1, nome: 'NORMAL', texto: `Exame sem alterações significativas. ${M}` }],
      laudo: e.laudo,
      alertaDataInvalida: false,
      bloqueado: e.liberado,
      grandezas: [...(e.catalogo.grandezas ?? [])],
    };
  }

  private item(s: Estado, e: ExameM): ItemLiberacao {
    const valores = this.valores(s, e);
    return {
      exame: this.exameSadt(s, e),
      valores,
      digitadoEm: e.digitadoEm?.slice(0, 10) ?? null,
      digitadoPor: e.digitadoPor,
      critico: valores.some((v) => v.critico),
      versoes: e.versoes.map((v) => ({
        versao: v.versao,
        em: v.em,
        motivo: v.motivo,
        viramAntes: v.viramAntes,
      })),
    };
  }

  async conferencia(c: ContextoSadt, id: number) {
    const s = this.e(c);
    const e = s.exames.get(id);
    return e ? this.item(s, e) : null;
  }

  async filaLiberacao(c: ContextoSadt, f: { setor?: SetorSadt; inicio: string; fim: string }) {
    const s = this.e(c);
    return {
      itens: this.lista(s, f)
        .filter((e) => e.digitado && !e.liberado)
        .map((e) => this.item(s, e)),
      cortada: false,
    };
  }

  async liberacaoVigente(c: ContextoSadt, id: number) {
    const e = this.e(c).exames.get(id);
    const l = e?.liberacoes.filter((x) => x.situacao === 1).at(-1);
    return l ? { id: l.id, em: l.em, visualizada: l.visualizadaEm !== null } : null;
  }

  async liberadosComCritico(): Promise<LiberacaoVista[]> {
    // Na memória, toda liberação é feita aqui (a receita avisa na mesma gravação).
    return [];
  }

  async avisos(
    c: ContextoSadt,
    o: { inicio: string; fim: string; pendentes?: boolean },
  ): Promise<AvisoCritico[]> {
    const s = this.e(c);
    const r: AvisoCritico[] = [];
    for (const a of s.avisos) {
      if (a.emitidoEm.slice(0, 10) < o.inicio || a.emitidoEm.slice(0, 10) > o.fim) continue;
      const e = s.exames.get(a.exame);
      if (!e) continue;
      const ciencia = this.prontuario?.cienciaParaSadt(hospitalDe(c), a.exame) ?? null;
      if (o.pendentes && ciencia) continue;
      const el = e.catalogo.elementos.find((x) => x.codigo === a.elemento);
      r.push({
        id: a.id,
        exame: a.exame,
        chave: [
          e.chave.data,
          e.chave.reg,
          e.chave.conta,
          e.chave.atend,
          e.chave.ato,
          e.chave.exame,
          e.chave.sequencia,
        ].join('|'),
        paciente: this.pacienteDe(e.paciente),
        atendimento: String(e.atendimento),
        elemento: el?.nome ?? String(a.elemento),
        valor: a.valor,
        origem: a.origem,
        liberadoEm: a.liberadoEm,
        emitidoEm: a.emitidoEm,
        segundosAteAviso: 0,
        prazoEm: new Date(Date.parse(`${a.emitidoEm}Z`) + a.prazo * 60_000).toISOString().slice(0, 19),
        nivel: a.nivel,
        nivelRotulo: NIVEIS_ESCALONAMENTO[a.nivel]?.rotulo ?? '',
        comunicado: a.comunicado,
        ciencia: ciencia ? { usuario: ciencia.usuario, em: ciencia.em.slice(0, 19) } : null,
        situacao: ciencia ? 'comCiencia' : a.nivel > 0 ? 'escalonado' : 'aguardandoCiencia',
      });
    }
    return r.sort((a, b) => b.emitidoEm.localeCompare(a.emitidoEm));
  }

  async valoresCriticos(c: ContextoSadt): Promise<ValorCriticoLido[]> {
    return this.e(c).valores.map((v) => {
      const cat = CATALOGO_SADT_SINTETICO.find((x) => x.ato === v.ato && x.codigo === v.exame);
      return {
        id: v.id,
        ato: v.ato,
        exame: v.exame,
        exameNome: cat?.nome ?? v.exame,
        elemento: v.elemento,
        elementoNome: cat?.elementos.find((x) => x.codigo === v.elemento)?.nome ?? String(v.elemento),
        abaixoDe: v.abaixoDe,
        acimaDe: v.acimaDe,
        prazoMinutos: v.prazoMinutos,
        aprovacao: v.aprovacao,
        ativo: v.ativo,
        atualizadoEm: v.atualizadoEm,
      };
    });
  }

  async elementos(_c: ContextoSadt, exame: string) {
    const cat = CATALOGO_SADT_SINTETICO.find((x) => x.codigo === exame && x.ato === 15);
    return (cat?.elementos ?? []).map((e) => ({ codigo: e.codigo, nome: e.nome, unidade: e.unidade }));
  }

  private amostraDetalhe(a: AmostraM, s: Estado): AmostraDetalhe {
    return {
      id: a.id,
      codigo: a.codigo,
      estado: a.estado,
      rotulo: rotuloEstadoAmostra(a.estado),
      paciente: this.pacienteDe(a.paciente),
      recipiente:
        CATALOGO_SADT_SINTETICO.find((x) => x.recipiente?.codigo === a.recipiente)?.recipiente?.nome ?? null,
      exames: a.exames
        .map((id) => s.exames.get(id))
        .filter((e): e is ExameM => !!e)
        .map((e) => ({ id: e.id, codigo: e.catalogo.codigo, nome: e.catalogo.nome })),
      pulseiraConferida: a.pulseira,
      eventos: a.eventos.map((x) => ({
        estado: x.estado,
        rotulo: rotuloEstadoAmostra(x.estado),
        em: x.em,
        por: x.por,
        motivo: x.motivo,
      })),
    };
  }

  async amostras(c: ContextoSadt, o: { data: string; estado?: EstadoAmostra }) {
    const s = this.e(c);
    const itens = s.amostras
      .filter((a) => a.atualizadaEm.slice(0, 10) === o.data && (!o.estado || a.estado === o.estado))
      .map((a) => this.amostraDetalhe(a, s));
    const rej = new Map<string, number>();
    for (const a of s.amostras)
      for (const ev of a.eventos)
        if ((ev.estado === 'rejeitada' || ev.estado === 'recoleta') && ev.em.slice(0, 10) === o.data) {
          const k = (ev.motivo ?? 'outro').split(':')[0]!;
          rej.set(k, (rej.get(k) ?? 0) + 1);
        }
    return {
      itens,
      cortada: false,
      rejeicoes: [...rej].map(([motivo, quantidade]) => ({ motivo, quantidade })),
    };
  }

  async amostraPorCodigo(c: ContextoSadt, codigo: string) {
    const s = this.e(c);
    const a = s.amostras.find((x) => x.codigo === codigo.trim().toUpperCase());
    return a ? this.amostraDetalhe(a, s) : null;
  }

  async amostraPorId(c: ContextoSadt, id: number) {
    const s = this.e(c);
    const a = s.amostras.find((x) => x.id === id);
    return a ? this.amostraDetalhe(a, s) : null;
  }

  async atendimentoDosExames(c: ContextoSadt, ids: readonly number[]) {
    const s = this.e(c);
    const es = ids.map((id) => s.exames.get(id)).filter((e): e is ExameM => !!e);
    const [x] = es;
    if (!x || es.length !== ids.length) return null;
    return {
      paciente: x.paciente,
      atendimento: x.atendimento,
      reg: x.chave.reg,
      atend: x.chave.atend,
      prontuario: this.pacienteDe(x.paciente).prontuario,
      mesmos: es.every((e) => e.atendimento === x.atendimento),
    };
  }

  async laudosDoExame(c: ContextoSadt, id: number) {
    return this.e(c)
      .laudos.filter((l) => l.exames.includes(id))
      .map((l) => ({
        numero: l.numero,
        codigo: l.codigo,
        emitidoEm: l.em,
        emitidoPor: l.por,
        segundasVias: l.vias - 1,
      }));
  }

  async impressaoDosExames(c: ContextoSadt, ids: readonly number[]) {
    const l = this.e(c).laudos.find(
      (x) => x.exames.length === ids.length && ids.every((i) => x.exames.includes(i)),
    );
    return l ? { impressao: l.impressao, numero: l.numero, codigo: l.codigo, vias: l.vias } : null;
  }

  async validarLaudo(c: ContextoSadt, codigo: string) {
    const l = this.e(c).laudos.find((x) => x.codigo === codigo.trim().toLowerCase());
    return l
      ? { valido: true, numero: l.numero, emitidoEm: l.em, exames: l.exames.length }
      : { valido: false, numero: null, emitidoEm: null, exames: 0 };
  }

  async laudoParaEmitir(c: ContextoSadt, ids: readonly number[]): Promise<LaudoParaEmitir | null> {
    const s = this.e(c);
    const es = ids.map((id) => s.exames.get(id)).filter((e): e is ExameM => !!e);
    const [x] = es;
    if (!x || es.length !== ids.length) return null;
    return {
      paciente: this.pacienteDe(x.paciente),
      atendimento: String(x.atendimento),
      convenio: CONVENIOS[1]!.nome,
      exames: es.map((e) => ({
        id: e.id,
        nome: e.catalogo.nome,
        setor: SETORES_SADT.find((y) => y.codigo === setorDoAto(e.catalogo.ato))?.rotulo ?? '',
        data: e.chave.data,
        liberadoEm: e.liberadoEm,
        liberadoPor: e.liberadoPor ?? '',
        valores: this.valores(s, e),
        texto: e.laudo ? [e.laudo.texto] : [],
        emissor: e.laudo?.emissor ?? '',
      })),
    };
  }

  async requisicoes(c: ContextoSadt, o: { data: string; termo?: string }) {
    const s = this.e(c);
    const itens: RequisicaoLida[] = [1001, 1003].map((p) => {
      const at = p * 10 + 1;
      const conta = s.contas.get(at);
      return {
        atendimento: String(at),
        reg: 31337 + (p === 1003 ? 1 : 0),
        paciente: this.pacienteDe(p),
        convenio: CONVENIOS[1]!,
        data: o.data,
        conta: conta
          ? { id: conta.id, numero: conta.numero, solicitante: `PROFISSIONAL ${M}`, guia: '' }
          : null,
        exames: [...s.exames.values()].filter((e) => e.atendimento === at).length,
      };
    });
    const t = (o.termo ?? '').toUpperCase();
    return { itens: t ? itens.filter((i) => i.paciente.nome.includes(t)) : itens, cortada: false };
  }

  async atendimento(c: ContextoSadt, atendimento: number): Promise<AtendimentoParaLancamento | null> {
    const s = this.e(c);
    const paciente = Math.floor(atendimento / 10);
    const p = this.pacienteDe(paciente);
    if (!p.prontuario) return null;
    const conta = s.contas.get(atendimento);
    return {
      atendimento,
      paciente: p,
      atend: ATENDS_SINTETICOS[atendimento] ?? 'E',
      reg: REGS_SINTETICOS[atendimento] ?? 31338,
      convenio: CONVENIOS[1]!,
      conta: conta ? { id: conta.id, numero: conta.numero } : null,
      retratos: { htAtendimento: atendimento * 10, htPaciente: paciente * 10 },
    };
  }

  async atendimentosPorNumero(c: ContextoSadt, reg: number) {
    const ids = reg === 31337 ? [10011] : reg === 31338 ? [10031] : [];
    const r: AtendimentoParaLancamento[] = [];
    for (const id of ids) {
      const a = await this.atendimento(c, id);
      if (a) r.push(a);
    }
    return r;
  }

  private orcamentoLido(o: OrcamentoM, hoje: string): OrcamentoLido {
    const total = Math.round(o.itens.reduce((s, i) => s + i.valor, 0) * 100) / 100;
    return {
      id: o.id,
      nome: o.nome,
      paciente: o.paciente,
      convenio: CONVENIOS.find((x) => x.codigo === o.convenio) ?? { codigo: o.convenio, nome: '' },
      ato: o.ato,
      atoRotulo: rotuloAto(o.ato),
      data: o.data,
      validade: o.validade,
      situacao: o.convertido ? 'convertido' : o.validade < hoje ? 'vencido' : 'aberto',
      itens: o.itens,
      total,
      convertidoEm: o.convertido,
    };
  }

  async orcamentos(c: ContextoSadt, o: { inicio: string; fim: string; hoje: string; termo?: string }) {
    const t = (o.termo ?? '').toUpperCase();
    return {
      itens: this.e(c)
        .orcamentos.filter((x) => x.data >= o.inicio && x.data <= o.fim && (!t || x.nome.includes(t)))
        .map((x) => this.orcamentoLido(x, o.hoje)),
      cortada: false,
    };
  }

  async orcamento(c: ContextoSadt, id: number, o: { hoje: string }) {
    const x = this.e(c).orcamentos.find((y) => y.id === id);
    return x ? { ...this.orcamentoLido(x, o.hoje), nomeRegistrado: x.nome } : null;
  }

  async apoio(_c: ContextoSadt, setor?: SetorSadt) {
    const atos = setor ? (SETORES_SADT.find((x) => x.codigo === setor)?.atos as readonly number[]) : null;
    return {
      prestadores: PRESTADORES.filter((p) => !atos || atos.includes(p.ato)),
      exames: CATALOGO_SADT_SINTETICO.filter((e) => e.ativo && (!atos || atos.includes(e.ato))).map((e) => ({
        id: e.id,
        ato: e.ato,
        codigo: e.codigo,
        nome: e.nome,
        material: e.material,
        recipiente: e.recipiente?.nome ?? null,
      })),
      kits: [{ codigo: 71, nome: `ROTINA DE INTERNAÇÃO ${M}` }],
      recipientes: [
        { codigo: 1, nome: 'TUBO ROXO (EDTA)' },
        { codigo: 2, nome: 'TUBO AMARELO (SORO)' },
      ],
      convenios: CONVENIOS,
    };
  }

  async vinculos(_c: ContextoSadt, login: string): Promise<VinculoDaSessao[]> {
    const v = vinculoSintetico(login);
    return v ? [v] : [];
  }

  /** Na memória, o médico sintético é o solicitante de todo exame. */
  async destinatarioDoCritico(): Promise<string | null> {
    return 'SINT.MEDICO';
  }

  async profissionais(_c: ContextoSadt, termo: string) {
    const t = termo.toUpperCase();
    return ['SINT.BIOMEDICO', 'SINT.LAUDADOR', 'SINT.MEDICO']
      .map((l) => vinculoSintetico(l)!)
      .filter((v) => !t || v.nome.includes(t) || String(v.conselho) === t)
      .map((v) => ({ id: v.vinculo, nome: v.nome, conselho: String(v.conselho), cbo: v.codigoCbo }));
  }

  async solicitantes(c: ContextoSadt, o: { termo?: string; numero?: number; uf?: string }) {
    const t = (o.termo ?? '').toUpperCase();
    return this.e(c).solicitantes.filter(
      (x) =>
        (!t || x.nome.includes(t)) &&
        (!o.numero || x.registro.startsWith(`${o.numero}/`)) &&
        (!o.uf || x.registro.endsWith(`/${o.uf}`)),
    );
  }

  async parametros() {
    return {
      campos: [
        { campo: 'DIAS', rotulo: 'Prazo de entrega (dias)', valor: '1' },
        { campo: 'RESLIB', rotulo: 'Exige liberação do resultado', valor: 'T' },
        { campo: 'CONTAGEM_SOMENTE_DIAS_UTEIS', rotulo: 'Prazo em dias úteis', valor: 'F' },
      ],
      ocultos: ['senha guardada', 'caminho de pasta da rede', 'porta da impressora da estação'],
    };
  }

  async indicadores(c: ContextoSadt, o: { inicio: string; fim: string; setor?: SetorSadt | undefined }) {
    const s = this.e(c);
    const es = this.lista(s, o).filter((e) => e.pendSadt !== 'S');
    const linhas = new Map<
      string,
      {
        setor: SetorSadt;
        prioridade: 'rotina' | 'urgente';
        exames: number;
        liberados: number;
        soma: number;
        comMarcas: number;
        spc: number;
        comColeta: number;
        scl: number;
        comColetaLiberacao: number;
      }
    >();
    const minutos = (de: string, ate: string) => (Date.parse(`${ate}Z`) - Date.parse(`${de}Z`)) / 60_000;
    for (const e of es) {
      const setor = setorDoAto(e.catalogo.ato) ?? 'laboratorio';
      const prioridade = e.urgente ? 'urgente' : 'rotina';
      const k = `${setor}|${prioridade}`;
      const x = linhas.get(k) ?? {
        setor,
        prioridade,
        exames: 0,
        liberados: 0,
        soma: 0,
        comMarcas: 0,
        spc: 0,
        comColeta: 0,
        scl: 0,
        comColetaLiberacao: 0,
      };
      x.exames++;
      if (e.liberado) {
        x.liberados++;
        if (e.liberadoEm) {
          x.comMarcas++;
          x.soma += Math.max(0, minutos(e.pedidoEm, e.liberadoEm));
        }
      }
      // A coleta do rastreio (o primeiro evento "coletada" da amostra do exame).
      const coletaEm = s.amostras
        .filter((a) => a.exames.includes(e.id))
        .flatMap((a) => a.eventos.filter((ev) => ev.estado === 'coletada').map((ev) => ev.em))
        .sort()[0];
      if (coletaEm && coletaEm >= e.pedidoEm) {
        x.comColeta++;
        x.spc += minutos(e.pedidoEm, coletaEm);
        if (e.liberado && e.liberadoEm && e.liberadoEm > coletaEm) {
          x.comColetaLiberacao++;
          x.scl += minutos(coletaEm, e.liberadoEm);
        }
      }
      linhas.set(k, x);
    }
    const porDia = new Map<string, number>();
    for (const e of es) porDia.set(e.chave.data, (porDia.get(e.chave.data) ?? 0) + 1);
    return {
      linhas: [...linhas.values()].map((x) => ({
        setor: x.setor,
        prioridade: x.prioridade,
        exames: x.exames,
        liberados: x.liberados,
        mediaMinutosPedidoLiberacao: x.comMarcas ? Math.round(x.soma / x.comMarcas) : null,
        comMarcas: x.comMarcas,
        semMarcas: x.liberados - x.comMarcas,
        mediaMinutosPedidoColeta: x.comColeta ? Math.round(x.spc / x.comColeta) : null,
        comColeta: x.comColeta,
        mediaMinutosColetaLiberacao: x.comColetaLiberacao ? Math.round(x.scl / x.comColetaLiberacao) : null,
        comColetaLiberacao: x.comColetaLiberacao,
      })),
      porDia: [...porDia].sort().map(([dia, exames]) => ({ dia, exames })),
      pendentesMais24h: es.filter(
        (e) => !e.liberado && Date.parse(`${e.pedidoEm}Z`) < Date.now() - 27 * 3_600_000,
      ).length,
      visualizadosPortal: {
        liberados: es.filter((e) => e.liberado).length,
        visualizados: es.filter((e) => e.liberacoes.some((l) => l.visualizadaEm)).length,
      },
    };
  }

  private laudoDoPortal(_s: Estado, e: ExameM, l: LiberacaoM, comPaciente: boolean): LaudoPortal {
    return {
      liberacao: l.id,
      exame: e.id,
      nome: e.catalogo.nome,
      setor: SETORES_SADT.find((y) => y.codigo === setorDoAto(e.catalogo.ato))?.rotulo ?? '',
      data: e.chave.data,
      liberadoEm: e.liberadoEm ?? l.em,
      visualizado: l.visualizadaEm !== null,
      paciente: comPaciente ? this.pacienteDe(e.paciente).nome : null,
    };
  }

  async laudosPortalDoPaciente(
    c: ContextoSadt,
    o: { paciente: number; reg: number | null; atos: readonly number[] },
  ) {
    const s = this.e(c);
    const laudos: LaudoPortal[] = [];
    for (const e of s.exames.values()) {
      if (e.paciente !== o.paciente || !e.liberado || !o.atos.includes(e.catalogo.ato)) continue;
      if (o.reg && e.chave.reg !== o.reg) continue;
      const l = e.liberacoes.filter((x) => x.situacao === 1).at(-1);
      if (l) laudos.push(this.laudoDoPortal(s, e, l, false));
    }
    return { laudos, cortada: false };
  }

  async laudosPortalDoMedico(c: ContextoSadt, o: { solicitante: number; atos: readonly number[] }) {
    const s = this.e(c);
    const laudos: LaudoPortal[] = [];
    // O solicitante externo sintético pediu os exames do paciente 1003 (lançados no setor).
    for (const e of s.exames.values()) {
      if (o.solicitante !== 6601 || e.paciente !== 1003 || !e.liberado || !o.atos.includes(e.catalogo.ato))
        continue;
      const l = e.liberacoes.filter((x) => x.situacao === 1).at(-1);
      if (l) laudos.push(this.laudoDoPortal(s, e, l, true));
    }
    return { laudos, cortada: false };
  }

  async laudoPortal(c: ContextoSadt, liberacao: number): Promise<LaudoPortalLido | null> {
    const s = this.e(c);
    for (const e of s.exames.values()) {
      const l = e.liberacoes.find((x) => x.id === liberacao && x.situacao === 1);
      if (!l || !e.liberado) continue;
      return {
        laudo: this.laudoDoPortal(s, e, l, true),
        ato: e.catalogo.ato,
        paciente: e.paciente,
        reg: e.chave.reg,
        solicitante: e.paciente === 1003 ? 6601 : null,
        valores: this.valores(s, e),
        texto: e.laudo ? [e.laudo.texto] : [],
      };
    }
    return null;
  }

  async pacienteDoAtendimento(_c: ContextoSadt, reg: number) {
    const paciente = reg === 31337 ? 1001 : reg === 31338 ? 1003 : null;
    if (!paciente) return null;
    const p = this.pacienteDe(paciente);
    return { paciente, nome: p.nome, nascimento: p.nascimento };
  }

  async nascimentoDoPaciente(_c: ContextoSadt, paciente: number) {
    const p = this.pacienteDe(paciente);
    return p.prontuario ? { nome: p.nome, nascimento: p.nascimento } : null;
  }

  private acessoLido(a: AcessoM): AcessoPortalLido {
    return {
      id: a.id,
      perfil: a.perfil,
      paciente: a.paciente,
      reg: a.reg,
      conselho: a.conselho,
      uf: a.uf,
      numero: a.numero,
      solicitante: a.solicitante,
      nome: a.nome,
      senhaResumo: a.senhaResumo,
      segundoFator: a.segundoFator,
      situacao: a.situacao,
      tentativas: a.tentativas,
      bloqueadoAte: a.bloqueadoAte,
    };
  }

  async acessoPorProtocolo(c: ContextoSadt, resumo: string) {
    const a = this.e(c).acessos.find((x) => x.protocolo === resumo);
    return a ? this.acessoLido(a) : null;
  }

  async acessoDoMedico(c: ContextoSadt, m: { conselho: string; uf: string; numero: string }) {
    const a = this.e(c).acessos.find(
      (x) => x.conselho === m.conselho && x.uf === m.uf && x.numero === m.numero,
    );
    return a ? this.acessoLido(a) : null;
  }

  async acessoPorId(c: ContextoSadt, id: number) {
    const a = this.e(c).acessos.find((x) => x.id === id);
    return a ? this.acessoLido(a) : null;
  }

  /** W0-10: a situação da conta mudada pelo portal do médico externo (bloqueio, desbloqueio, encerramento). */
  definirSituacaoAcesso(c: ContextoSadt, id: number, situacao: string): void {
    const a = this.e(c).acessos.find((x) => x.id === id);
    if (a) a.situacao = situacao;
  }

  /** W0-10: a senha (resumo) ou o e-mail novo da conta, trocados pelo portal do médico (a mesma memória do login). */
  definirCredencialAcesso(c: ContextoSadt, id: number, x: { senhaResumo?: string; email?: string }): void {
    const a = this.e(c).acessos.find((y) => y.id === id);
    if (!a) return;
    if (x.senhaResumo !== undefined) a.senhaResumo = x.senhaResumo;
    if (x.email !== undefined) a.email = x.email;
  }

  async autocadastros(c: ContextoSadt): Promise<AutocadastroPortalLido[]> {
    const s = this.e(c);
    return s.acessos
      .filter((a) => a.perfil === 'medicoExterno')
      .map((a) => ({
        id: a.id,
        nome: a.nome ?? '',
        conselho: a.conselho ?? '',
        uf: a.uf ?? '',
        numero: a.numero ?? '',
        situacao:
          a.situacao === 'pendente' ? 'pendente' : a.situacao === 'recusado' ? 'recusado' : 'aprovado',
        situacaoConta: a.situacao,
        pedidoEm: a.criadoEm,
        origem: 'novo',
        candidatos: s.solicitantes
          .filter((x) => x.registro === `${a.numero}/${a.uf}`)
          .map((x) => ({ id: x.id, nome: x.nome })),
      }));
  }

  async atosPublicados(): Promise<number[]> {
    return [8, 15, 16, 21, 24, 25, 90];
  }

  /** Testes e E2E: o resumo do protocolo (o código guardado só como resumo, como no banco). */
  static resumoProtocolo(codigo: string): string {
    return sha(codigo);
  }
}

/** O tipo dos atendimentos sintéticos (1001 internado; 1003 externo). */
const ATENDS_SINTETICOS: Readonly<Record<number, 'I' | 'E'>> = { 10011: 'I', 10031: 'E' };
const REGS_SINTETICOS: Readonly<Record<number, number>> = { 10011: 31337, 10031: 31338 };

/** Os pacientes sintéticos quando o prontuário em memória não está ligado (testes da API). */
const PACIENTES_RESERVA: Readonly<
  Record<number, { nome: string; nascimento: string; sexo: 'F' | 'M'; prontuario: number }>
> = {
  1001: { nome: `JOSÉ DA SILVA ${M}`, nascimento: '1958-03-12', sexo: 'M', prontuario: 501001 },
  1003: { nome: `CINTHYA GABRIELLA VIANNA ${M}`, nascimento: '1990-07-01', sexo: 'F', prontuario: 501003 },
};

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
