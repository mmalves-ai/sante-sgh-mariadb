// Porta do prontuário de uso diário em MEMÓRIA (M23): a sessão sintética de dev/ci (E2E) sobre os pacientes
// SINTÉTICOS do cadastro (1001 e 1003) e os atendimentos deles (paciente × 10 + 1, internação aberta; + 2, externo
// encerrado), com catálogo de exames, kits, resultados (um potássio crítico), modelos de impressão e alergias
// sintéticos. As gravações conferem a entrada pelos MESMOS esquemas das receitas do executor e guardam o que o
// adaptador gravaria, por estabelecimento; nada vai à cópia. Marca "SINTETICO".
import { statusDaRecusaObito, validarCancelamentoObito } from '@sgh/dominio-pep';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import {
  type CompletudePainelLida,
  type EpisodioLido,
  type RecortePainel,
  type SupervisaoLida,
  type AlergiaDoProntuarioLida,
  type AnexoLido,
  type AtendimentoPepLido,
  type CabecalhoDocumentoLido,
  type CienciaLida,
  type ContextoGravacaoPep,
  type DocumentoHistoricoLido,
  type DocumentoResumoLido,
  type DocumentoProprioLido,
  ErroProntuario,
  esquemaAnexo,
  esquemaEmissaoDocumento,
  esquemaExameExterno,
  esquemaFinalizacaoSumario,
  esquemaGravacaoAlergia,
  esquemaInativacaoAlergia,
  esquemaPedidoExames,
  esquemaSuspensaoDocumento,
  type EventoLido,
  type ExameCatalogoLido,
  type FichaImpressao,
  type FluxoLido,
  type PedidoLido,
  type ProblemaLido,
  type ProblemaNovo,
  type ResultadoLido,
  type SumarioLido,
  type TcleLido,
  loginDaOperacao,
} from './tipos-pep.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { ContextoDocs, PortaDocumentos, ProfissionalPep } from './documentos-porta.js';
import { cboDe, type PortaRegistroMemoria, type RegistroOuvido } from './registro-porta-memoria.js';

const M = 'SINTETICO';

const PACIENTES: Readonly<
  Record<number, { nome: string; nascimento: string; sexo: 'F' | 'M'; prontuario: number }>
> = {
  1001: { nome: `JOSÉ DA SILVA ${M}`, nascimento: '1958-03-12', sexo: 'M', prontuario: 501001 },
  1003: { nome: `CINTHYA GABRIELLA VIANNA ${M}`, nascimento: '1990-07-01', sexo: 'F', prontuario: 501003 },
};

/**
 * M57.2: paciente SINTÉTICO só do cadastro (sem atendimento aqui, fora do painel): o cadastro 1 da massa do MPI da
 * Rede em memória (o par do 101 no segundo estabelecimento), para o aviso "atendimentos em outro estabelecimento" no
 * cabeçalho do prontuário (E2E @M57.2).
 */
const PACIENTES_SO_CADASTRO: Readonly<
  Record<number, { nome: string; nascimento: string; sexo: 'F' | 'M'; prontuario: number }>
> = {
  1: { nome: 'ANA SINTETICA PRIMEIRA', nascimento: '1980-05-17', sexo: 'F', prontuario: 50_001 },
};

/** Ocupação sintética pelo login: enfermagem, psicologia; os demais, medicina (o "SEMCBO" não tem). */
function ocupacaoDe(login: string): string | null {
  if (/SEMCBO/i.test(login)) return null;
  if (/ENFERM/i.test(login)) return '223505';
  if (/PSICOLOG/i.test(login)) return '251510';
  if (/FISIO/i.test(login)) return '223605';
  return '225125';
}

function agoraLocal(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 19);
}
function horasAtras(h: number): string {
  return new Date(Date.now() - 3 * 3_600_000 - h * 3_600_000).toISOString().slice(0, 19);
}

const EXAMES: readonly ExameCatalogoLido[] = [
  {
    id: 501,
    ato: 15,
    codigo: 'HMG',
    nome: `HEMOGRAMA COMPLETO ${M}`,
    ativo: true,
    sexo: null,
    idadeMinima: null,
    idadeMaxima: null,
    material: 1,
  },
  {
    id: 502,
    ato: 15,
    codigo: 'K',
    nome: `POTÁSSIO ${M}`,
    ativo: true,
    sexo: null,
    idadeMinima: null,
    idadeMaxima: null,
    material: 1,
  },
  {
    id: 503,
    ato: 15,
    codigo: 'NA',
    nome: `SÓDIO ${M}`,
    ativo: true,
    sexo: null,
    idadeMinima: null,
    idadeMaxima: null,
    material: 1,
  },
  {
    id: 504,
    ato: 15,
    codigo: 'BHCG',
    nome: `BETA HCG ${M}`,
    ativo: true,
    sexo: 'F',
    idadeMinima: 10,
    idadeMaxima: 60,
    material: 1,
  },
  {
    id: 505,
    ato: 16,
    codigo: 'RXT',
    nome: `RAIO X DE TÓRAX ${M}`,
    ativo: true,
    sexo: null,
    idadeMinima: null,
    idadeMaxima: null,
    material: null,
  },
  {
    id: 506,
    ato: 15,
    codigo: 'VHS',
    nome: `VHS (INATIVO) ${M}`,
    ativo: false,
    sexo: null,
    idadeMinima: null,
    idadeMaxima: null,
    material: 1,
  },
];

const KITS = [{ id: 71, nome: `ROTINA DE INTERNAÇÃO ${M}`, exames: [501, 502, 503] }];

const FICHAS: readonly FichaImpressao[] = [
  { codigo: 11, nome: 'ATESTADO MÉDICO', tipo: 1, componentes: [{ nome: 'Rch0', modelo: null }] },
  {
    codigo: 12,
    nome: 'DECLARAÇÃO DE COMPARECIMENTO',
    tipo: 1,
    componentes: [{ nome: 'Rch0', modelo: null }],
  },
  { codigo: 13, nome: 'Resumo de Alta Hospitalar', tipo: 1, componentes: [{ nome: 'Rch0', modelo: null }] },
];

const AGENTES = [
  { id: 1, nome: `DIPIRONA ${M}`, tipo: 'Medicamento' },
  { id: 2, nome: `PENICILINA ${M}`, tipo: 'Medicamento' },
  { id: 3, nome: `CAMARÃO ${M}`, tipo: 'Alimento' },
  { id: 4, nome: `LÁTEX ${M}`, tipo: 'Outro' },
];
const PRINCIPIOS = [
  { id: 1, nome: `METAMIZOL ${M}` },
  { id: 2, nome: `BENZILPENICILINA ${M}` },
];

/** Campos do dado completo da alergia que a memória não guarda (preenchidos vazios na leitura). */
type CampoAlergiaCompleta =
  | 'descricaoLivre'
  | 'tipoRegistro'
  | 'reacao'
  | 'gravidade'
  | 'certeza'
  | 'origemInformacao'
  | 'inativadaEm'
  | 'motivoInativacao'
  | 'estabelecimentoId';

interface Estado {
  alergias: (Omit<AlergiaDoProntuarioLida, CampoAlergiaCompleta> &
    Partial<Pick<AlergiaDoProntuarioLida, CampoAlergiaCompleta>> & { paciente: number })[];
  documentos: (DocumentoProprioLido & { eventos: { tipo: string; em: string }[] })[];
  legados: (DocumentoHistoricoLido & {
    familia: 'receita' | 'atestado' | 'externo';
    tpPadrao: number | null;
  })[];
  pedidos: (PedidoLido & { paciente: number })[];
  resultados: (ResultadoLido & { paciente: number })[];
  ciencias: (CienciaLida & { paciente: number })[];
  problemas: (ProblemaLido & { paciente: number })[];
  tcles: (TcleLido & { paciente: number })[];
  sumarios: (SumarioLido & { atendimento: number })[];
  transferencias: {
    id: number;
    atendimento: number;
    destino: string;
    em: string;
    documento: number | null;
  }[];
  obitos: {
    id: number;
    paciente: number;
    em: string;
    numero: string | null;
    documento: number | null;
    atendimento: number;
    /** Emissor (login): só ele cancela a declaração. */
    emissor: string;
    /** A cancelada fica (registro nunca apagado), com data e motivo. */
    situacao: 'rascunho' | 'emitida' | 'cancelada';
    canceladaEm: string | null;
    motivoCancelamento: string | null;
  }[];
  anexos: (AnexoLido & { pdf: Buffer })[];
  fila: FluxoLido[];
  supervisoes: SupervisaoLida[];
  proximo: number;
}

function semear(): Estado {
  const e: Estado = {
    alergias: [],
    documentos: [],
    supervisoes: [],
    legados: [],
    pedidos: [],
    resultados: [],
    ciencias: [],
    problemas: [],
    tcles: [],
    sumarios: [],
    transferencias: [],
    obitos: [],
    anexos: [],
    fila: [],
    proximo: 880_000,
  };
  // Paciente 1001: alergia ativa (registro do outro sistema), potássio crítico liberado e um pedido de hemograma.
  e.alergias.push({
    id: 1,
    paciente: 1001,
    agenteId: 2,
    agente: `PENICILINA ${M}`,
    tipo: 'Medicamento',
    observacao: null,
    ativa: true,
    registro: 10011,
    registradaEm: `${horasAtras(48)}.000`,
    profissional: `PROFISSIONAL ${M}`,
    principios: [`BENZILPENICILINA ${M}`],
  });
  e.resultados.push({
    paciente: 1001,
    exame: 7001,
    nome: `POTÁSSIO ${M}`,
    chave: {
      data: horasAtras(6).slice(0, 10),
      reg: 31337,
      conta: 1,
      atend: 'I',
      ato: 15,
      exame: 'K',
      sequencia: 1,
    },
    liberadoEm: `${horasAtras(5)}.000`,
    valores: [
      {
        elemento: 'POTASSIO',
        numerico: 6.9,
        alfa: null,
        unidade: 'mEq/L',
        refIni: 3.5,
        refFin: 5.1,
        referencia: '3,5 a 5,1',
        minAbe: 2.5,
        maxAbe: 6.5,
      },
    ],
    texto: null,
  });
  e.resultados.push({
    paciente: 1001,
    exame: 7000,
    nome: `POTÁSSIO ${M}`,
    chave: {
      data: horasAtras(30).slice(0, 10),
      reg: 31337,
      conta: 1,
      atend: 'I',
      ato: 15,
      exame: 'K',
      sequencia: 1,
    },
    liberadoEm: `${horasAtras(29)}.000`,
    valores: [
      {
        elemento: 'POTASSIO',
        numerico: 5.4,
        alfa: null,
        unidade: 'mEq/L',
        refIni: 3.5,
        refFin: 5.1,
        referencia: '3,5 a 5,1',
        minAbe: 2.5,
        maxAbe: 6.5,
      },
    ],
    texto: null,
  });
  e.pedidos.push({
    paciente: 1001,
    id: 6001,
    agrupamento: 6000,
    exame: 501,
    nome: `HEMOGRAMA COMPLETO ${M}`,
    ato: 15,
    data: horasAtras(30).slice(0, 10),
    solicitadoEm: `${horasAtras(30)}.000`,
    urgente: false,
    pendSadt: 'F',
    liberado: true,
    profissional: `PROFISSIONAL ${M}`,
    indicacao: null,
  });
  return e;
}

export class PortaDocumentosMemoria implements PortaDocumentos {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();
  /** CBO sintético → ocupação (lembrada a cada profissional lido): a categoria do autor na linha do tempo. */
  private readonly ocupacaoPorCbo = new Map<number, string>();

  constructor(
    private readonly trilha: RegistradorTrilha | null = null,
    private readonly registros: PortaRegistroMemoria | null = null,
  ) {
    // O pedido e a resposta do parecer viajam com o registro clínico (M22): a fila recebe aqui.
    if (registros) registros.ouvinte = (h, r) => this.aoRegistrar(h, r);
  }

  // ── M49, etapa 2: a ponte com a assinatura ICP em memória (os mesmos documentos da sessão sintética) ──────────

  /** Os documentos do novo do estabelecimento (a fila de assinatura ICP do autor lê daqui). */
  documentosParaIcp(hospital: string): readonly DocumentoProprioLido[] {
    return this.est(hospital).documentos;
  }

  /** A assinatura ICP concluída: o evento "assinado" com o nível ICP-Brasil (sai também das pendências do M23). */
  marcarAssinadoIcp(hospital: string, documento: number): void {
    const d = this.est(hospital).documentos.find((x) => x.id === documento);
    if (!d) return;
    const em = new Date().toISOString();
    Object.assign(d, {
      assinadoEm: d.assinadoEm ?? em,
      nivel: 'icp-brasil',
      eventos: [...d.eventos, { tipo: 'assinado', em }],
    });
  }

  // ── M26: a ponte com o SADT em memória (os mesmos pedidos, resultados e ciências da sessão sintética) ───────────

  /** Os pedidos do prontuário (o SADT em memória recebe, digita e libera sobre os mesmos IDs). */
  pedidosParaSadt(hospital: string): readonly (PedidoLido & { paciente: number })[] {
    return this.est(hospital).pedidos;
  }

  /** O paciente sintético (nome, nascimento, sexo e prontuário) e o atendimento vigente dele. */
  pacienteParaSadt(
    id: number,
  ): { nome: string; nascimento: string; sexo: 'F' | 'M'; prontuario: number } | null {
    return PACIENTES[id] ?? null;
  }

  atendimentoParaSadt(paciente: number): AtendimentoPepLido | null {
    return this.atendimentosDe(paciente)[0] ?? null;
  }

  /** A marca do pedido mudou no SADT (recebido, liberado). */
  marcarPedidoSadt(hospital: string, id: number, m: { pendSadt?: string; liberado?: boolean }): void {
    const e = this.est(hospital);
    const i = e.pedidos.findIndex((x) => x.id === id);
    const p = e.pedidos[i];
    if (!p) return;
    e.pedidos[i] = {
      ...p,
      ...(m.pendSadt ? { pendSadt: m.pendSadt } : {}),
      ...(m.liberado !== undefined ? { liberado: m.liberado } : {}),
    };
  }

  /** O resultado liberado no SADT aparece no prontuário (troca a versão anterior do mesmo exame). */
  publicarResultadoSadt(hospital: string, r: ResultadoLido & { paciente: number }): void {
    const e = this.est(hospital);
    e.resultados = [r, ...e.resultados.filter((x) => x.exame !== r.exame)];
  }

  /** A ciência registrada no prontuário para o exame (o painel do valor crítico mostra). */
  cienciaParaSadt(hospital: string, exame: number): { usuario: string; em: string } | null {
    const c = this.est(hospital).ciencias.find((x) => x.exame === exame);
    return c ? { usuario: c.usuario, em: c.em } : null;
  }

  private est(h: string): Estado {
    let e = this.estados.get(h);
    if (!e) this.estados.set(h, (e = semear()));
    return e;
  }

  private regs(h: string): RegistroOuvido[] {
    return this.registros?.registrosDe(h) ?? [];
  }

  private aoRegistrar(h: string, r: RegistroOuvido): void {
    const e = this.est(h);
    const ocupacao = r.login ? ocupacaoDe(r.login) : null;
    if (ocupacao) this.ocupacaoPorCbo.set(r.cbo, ocupacao);
    if (r.supervisao)
      e.supervisoes.push({
        id: e.proximo++,
        registro: r.id,
        paciente: r.paciente,
        atendimento: r.atendimento,
        residente: r.login ?? 'SINTETICO',
        preceptor: r.supervisao.preceptor,
        situacao: 'pendente',
        em: `${agoraLocal()}.000`,
      });
    const f = r.fluxo;
    if (!f) return;
    if (f.tipo === 'pedido') {
      e.fila.push({
        id: e.proximo++,
        tipo: 'parecer',
        paciente: r.paciente,
        atendimento: r.atendimento,
        pedido: r.id,
        resposta: null,
        especialidade: f.especialidade,
        categoria: f.categoria,
        prioridade: f.prioridade,
        prazo: f.prazo,
        situacao: 'solicitado',
        origem: 'novo',
        solicitante: r.login ?? 'SINTETICO',
        aceitoPor: null,
        criadoEm: new Date().toISOString(),
      });
    } else {
      const i = e.fila.findIndex(
        (x) =>
          x.id === f.parecer &&
          x.paciente === r.paciente &&
          (x.situacao === 'solicitado' || x.situacao === 'aceito'),
      );
      const x = e.fila[i];
      if (x) e.fila[i] = { ...x, situacao: 'respondido', resposta: r.id };
    }
  }

  private async auditar(
    c: { rede: string; hospital: string },
    usuario: string,
    evento: string,
    alvo: { tabela: string; id: number; paciente?: number },
  ): Promise<void> {
    await this.trilha?.registrar({
      evento,
      rede: c.rede,
      hospital: c.hospital,
      usuario,
      estacao: 'sessao-sintetica',
      correlacao: evento.slice(0, 64),
      recurso: 'pep.documentos',
      resultado: 'sucesso',
      tabelaAlvo: alvo.tabela,
      idAlvo: String(alvo.id),
      ...(alvo.paciente ? { paciente: alvo.paciente } : {}),
    });
  }

  private novoDocumento(
    h: string,
    d: Omit<DocumentoProprioLido, 'id' | 'criadoEm' | 'assinadoEm' | 'suspenso' | 'nivel'> & {
      nivel?: string;
    },
  ): number {
    const e = this.est(h);
    const id = e.proximo++;
    e.documentos.push({
      ...d,
      id,
      nivel: d.nivel ?? 'sem-assinatura',
      criadoEm: `${agoraLocal()}.000`,
      assinadoEm: null,
      suspenso: false,
      eventos: [{ tipo: 'emitido', em: new Date().toISOString() }],
    });
    return id;
  }

  private conferirCbo(cbo: number, login: string): void {
    if (cboDe(login) !== cbo)
      throw new ErroOperacao(
        403,
        'profissional-sem-cbo',
        'Operação recusada',
        'Só o profissional da sessão registra.',
      );
  }

  private conferirMedico(login: string): void {
    if (!(ocupacaoDe(login) ?? '').startsWith('225'))
      throw new ErroOperacao(
        422,
        'categoria-nao-permitida',
        'Operação recusada',
        'Este documento é emitido só por médico com registro ativo no conselho.',
      );
  }

  // ── Leituras ───────────────────────────────────────────────────────────────────────────────────

  async agora(): Promise<string> {
    return agoraLocal();
  }

  async ocupacaoDoCbo(_c: ContextoDocs, cbo: number): Promise<string | null> {
    return this.ocupacaoPorCbo.get(cbo) ?? null;
  }

  async profissional(_c: ContextoDocs, login: string): Promise<ProfissionalPep | null> {
    const cbo = cboDe(login);
    const codigo = ocupacaoDe(login);
    if (cbo === null || codigo === null) return null;
    this.ocupacaoPorCbo.set(cbo, codigo);
    return {
      idUsuario: 1,
      idProfissional: 1,
      nome: `PROFISSIONAL ${M}`,
      cbo,
      cbos: [cbo],
      especialidades: [codigo.startsWith('225') ? 1 : 2],
      permiteRetroativo: true,
      ocupacoes: [{ cbo, codigo, conselhoAtivo: true }],
    };
  }

  private atendimentosDe(paciente: number): AtendimentoPepLido[] {
    if (!PACIENTES[paciente]) return [];
    return [
      {
        id: paciente * 10 + 1,
        registro: 31337,
        tipo: 'internacao',
        entrada: `${horasAtras(30)}.000`,
        alta: null,
        unidade: `UNIDADE ${M}`,
        leito: '101A',
        convenio: `CONVÊNIO ${M}`,
        medico: `PROFISSIONAL ${M}`,
      },
      {
        id: paciente * 10 + 2,
        registro: 31336,
        tipo: 'externo',
        entrada: '2026-05-05T10:00:00.000',
        alta: '2026-05-05T12:00:00.000',
        unidade: `PRONTO ATENDIMENTO ${M}`,
        leito: null,
        convenio: `CONVÊNIO ${M}`,
        medico: `PROFISSIONAL ${M}`,
      },
    ];
  }

  async painel(c: ContextoDocs, f: { unidade: number | null; busca: string | null } & RecortePainel) {
    const termo = f.busca?.toUpperCase() ?? null;
    // "Meus": registrou no episódio ou aceitou parecer dele; "equipe": o responsável sintético é da especialidade 1.
    const meus = f.meus;
    const doProfissional = (p: number) =>
      !meus ||
      this.regs(c.hospital).some((r) => r.paciente === p && meus.cbos.includes(r.cbo)) ||
      this.est(c.hospital).fila.some((x) => x.paciente === p && x.aceitoPor === meus.login);
    const daEquipe = () => !f.equipe || f.equipe.especialidades.includes(1);
    const linhas = Object.entries(PACIENTES)
      .map(([id, p]) => {
        const a = this.atendimentosDe(Number(id))[0]!;
        return {
          paciente: Number(id),
          nome: p.nome,
          nomeSocial: null,
          nascimento: p.nascimento,
          sexo: p.sexo,
          prontuario: p.prontuario,
          atendimento: a.id,
          registro: a.registro,
          tipo: a.tipo,
          entrada: a.entrada,
          unidade: a.unidade,
          idUnidade: 1,
          leito: a.leito,
          convenio: a.convenio,
          medico: a.medico,
          alergiasAtivas: this.est(c.hospital).alergias.filter((x) => x.paciente === Number(id) && x.ativa)
            .length,
        };
      })
      .filter((l) => f.unidade === null || l.idUnidade === f.unidade)
      .filter((l) => !termo || l.nome.includes(termo) || String(l.prontuario) === termo)
      .filter((l) => doProfissional(l.paciente) && daEquipe());
    return { linhas, limitado: false };
  }

  async episodio(_c: ContextoDocs, atendimento: number): Promise<EpisodioLido> {
    // A internação aberta sintética (paciente × 10 + 1): o CID principal e uma cirurgia; os exames liberados.
    if (atendimento % 10 !== 1) return { motivoInternacao: null, procedimentos: [], exames: [] };
    return {
      motivoInternacao: 'I20 - Angina pectoris',
      procedimentos: ['Cirurgia (K40)'],
      exames: ['HEMOGRAMA SINTETICO'],
    };
  }

  async completudePainel(
    c: ContextoDocs,
    pacientes: readonly number[],
    atendimentos: readonly number[],
    desde: Date,
  ): Promise<CompletudePainelLida> {
    const ats = new Set(atendimentos);
    const evolucoes = new Map<number, string>();
    for (const r of this.regs(c.hospital)) {
      if (!ats.has(r.atendimento) || r.suspenso) continue;
      const ocupacao = this.ocupacaoPorCbo.get(r.cbo) ?? '225125';
      if (!ocupacao.startsWith('225')) continue;
      const em = `${r.dataHoraClinica}:00.000`;
      if ((evolucoes.get(r.atendimento) ?? '') < em) evolucoes.set(r.atendimento, em);
    }
    const e = this.est(c.hospital);
    const ultimo = (xs: readonly (string | null)[]) =>
      xs
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null;
    const porPaciente = <T>(f: (p: number) => T | null) =>
      pacientes.flatMap((p) => {
        const x = f(p);
        return x === null ? [] : [x];
      });
    const valores: CompletudePainelLida['valores'][number][] = [];
    for (const p of pacientes)
      for (const r of await this.resultados(c, p))
        if (!r.liberadoEm || new Date(`${r.liberadoEm.slice(0, 19)}Z`) >= desde)
          for (const v of r.valores)
            if (v.numerico !== null)
              valores.push({
                paciente: p,
                exame: r.exame,
                elemento: v.elemento,
                numerico: v.numerico,
                minAbe: v.minAbe,
                maxAbe: v.maxAbe,
                liberadoEm: r.liberadoEm,
              });
    return {
      evolucoesMedicas: [...evolucoes].map(([atendimento, em]) => ({ atendimento, em })),
      alergiasInformadas: porPaciente((p) => {
        const em = ultimo(e.alergias.filter((a) => a.paciente === p).map((a) => a.registradaEm ?? null));
        return em ? { paciente: p, em } : null;
      }),
      negas: porPaciente((p) => {
        const em = ultimo(
          e.documentos
            .filter((d) => d.paciente === p && d.tipo === 'alergia' && d.origemTabela !== 'alergia_paciente')
            .map((d) => d.criadoEm),
        );
        return em ? { paciente: p, em } : null;
      }),
      valores,
      ciencias: (await Promise.all(pacientes.map((p) => this.ciencias(c, p)))).flatMap((cs, i) =>
        cs.map((x) => ({ paciente: pacientes[i]!, exame: x.exame })),
      ),
      pareceres: e.fila
        .filter(
          (f) => pacientes.includes(f.paciente) && (f.situacao === 'solicitado' || f.situacao === 'aceito'),
        )
        .map((f) => ({ paciente: f.paciente, situacao: f.situacao, prazo: f.prazo })),
    };
  }

  async unidades() {
    return [{ id: 1, nome: `UNIDADE ${M}` }];
  }

  async preferenciasPainel() {
    return { unidade: null, campos: [] };
  }

  async paciente(_c: ContextoDocs, id: number) {
    const p = PACIENTES[id] ?? PACIENTES_SO_CADASTRO[id];
    return p
      ? {
          id,
          nome: p.nome,
          nomeSocial: null,
          nascimento: p.nascimento,
          sexo: p.sexo,
          prontuario: p.prontuario,
          obito: null,
        }
      : null;
  }

  async nomes(_c: ContextoDocs, ids: readonly number[]) {
    const de = (i: number) => PACIENTES[i] ?? PACIENTES_SO_CADASTRO[i];
    return new Map(ids.filter((i) => de(i)).map((i) => [i, de(i)!.nome]));
  }

  async atendimentos(_c: ContextoDocs, paciente: number) {
    return this.atendimentosDe(paciente);
  }

  async retratos(_c: ContextoDocs, atendimento: number, paciente: number) {
    if (!PACIENTES[paciente] || Math.floor(atendimento / 10) !== paciente) return null;
    return { htAtendimento: atendimento * 10, htPaciente: paciente * 10, doPaciente: true };
  }

  async eventos(
    c: ContextoDocs,
    paciente: number,
    periodo: { de: string; ate: string },
    tipos: ReadonlySet<string>,
    limite: number,
  ): Promise<EventoLido[]> {
    const e = this.est(c.hospital);
    const r: EventoLido[] = [];
    const quer = (t: string) => tipos.has(t);
    const cboTexto = (cbo: number | null, login?: string | null) =>
      login ? ocupacaoDe(login) : cbo !== null ? (this.ocupacaoPorCbo.get(cbo) ?? '225125') : null;
    if (quer('atendimento'))
      for (const a of this.atendimentosDe(paciente))
        r.push({
          chave: `atendimento:${a.id}`,
          tipo: 'atendimento',
          quando: a.entrada ?? '',
          titulo: a.tipo === 'internacao' ? `Internação ${a.registro}` : `Atendimento ${a.registro}`,
          detalhe: a.unidade,
          profissional: a.medico,
          cbo: null,
          suspenso: false,
          situacao: a.alta ? 'Encerrado' : 'Aberto',
          documento: null,
        });
    for (const g of this.regs(c.hospital).filter((x) => x.paciente === paciente)) {
      const parecer = ['MED09', 'MED10', 'MED11'].includes(g.modelo);
      const tipo = parecer ? 'parecer' : 'registro';
      if (!quer(tipo)) continue;
      r.push({
        chave: `registro:${g.id}`,
        tipo,
        quando: g.dataHoraClinica,
        titulo: g.nomeModelo,
        detalhe: null,
        profissional: `PROFISSIONAL ${M}`,
        cbo: cboTexto(g.cbo, g.login),
        suspenso: g.suspenso,
        situacao: g.suspenso ? 'Suspenso' : null,
        documento: { tipo: 'registro', id: g.id },
      });
    }
    for (const d of e.legados.filter((x) => x.paciente === paciente)) {
      const tipo = d.familia === 'externo' ? 'exame-externo' : d.familia;
      if (!quer(tipo)) continue;
      r.push({
        chave: `${tipo}:${d.id}`,
        tipo,
        quando: d.emitidoEm ?? '',
        titulo: d.titulo,
        detalhe: null,
        profissional: d.profissional,
        cbo: d.cbo,
        suspenso: d.suspensoEm !== null,
        situacao: d.suspensoEm ? 'Suspenso' : null,
        documento: { tipo, id: d.id },
      });
    }
    if (quer('exame-pedido'))
      for (const p of e.pedidos.filter((x) => x.paciente === paciente))
        r.push({
          chave: `exame-pedido:${p.id}`,
          tipo: 'exame-pedido',
          quando: p.solicitadoEm ?? '',
          titulo: p.nome,
          detalhe: p.urgente ? 'Urgente' : null,
          profissional: p.profissional,
          cbo: '225125',
          suspenso: false,
          situacao: p.liberado ? 'Liberado' : 'Solicitado',
          documento: { tipo: 'pedido-exame', id: p.agrupamento ?? p.id },
        });
    if (quer('exame-resultado'))
      for (const x of e.resultados.filter((y) => y.paciente === paciente))
        r.push({
          chave: `exame-resultado:${x.exame}`,
          tipo: 'exame-resultado',
          quando: x.liberadoEm ?? '',
          titulo: x.nome,
          detalhe: 'Resultado liberado',
          profissional: null,
          cbo: null,
          suspenso: false,
          situacao: null,
          documento: null,
        });
    if (quer('alergia'))
      for (const a of e.alergias.filter((x) => x.paciente === paciente))
        r.push({
          chave: `alergia:${a.id}`,
          tipo: 'alergia',
          quando: a.registradaEm ?? '',
          titulo: `Alergia: ${a.agente}`,
          detalhe: a.ativa ? null : 'Retirada da lista ativa',
          profissional: a.profissional,
          cbo: '225125',
          suspenso: false,
          situacao: a.ativa ? 'Ativa' : 'Inativa',
          documento: null,
        });
    if (quer('anexo'))
      for (const a of e.anexos.filter((x) => x.paciente === paciente))
        r.push({
          chave: `anexo:${a.id}`,
          tipo: 'anexo',
          quando: a.em ?? '',
          titulo: a.nome ?? 'Documento anexado',
          detalhe: a.tipo,
          profissional: a.profissional,
          cbo: '225125',
          suspenso: a.suspenso,
          situacao: null,
          documento: { tipo: 'anexo', id: a.id },
        });
    if (quer('tcle'))
      for (const x of e.tcles.filter((y) => y.paciente === paciente))
        r.push({
          chave: `tcle:${x.id}`,
          tipo: 'tcle',
          quando: x.em,
          titulo: `Termo de consentimento: ${x.procedimento}`,
          detalhe: null,
          profissional: x.usuario,
          cbo: null,
          suspenso: x.situacao === 'revogado',
          situacao: x.situacao,
          documento: x.documento ? { tipo: 'tcle', id: x.documento } : null,
        });
    // Uma cirurgia sintética do paciente 1001 (o mapa cirúrgico chega no M21).
    if (quer('cirurgia') && paciente === 1001)
      r.push({
        chave: 'cirurgia:1',
        tipo: 'cirurgia',
        quando: `${horasAtras(20)}.000`,
        titulo: 'Cirurgia do atendimento 31337',
        detalhe: 'K40',
        profissional: null,
        cbo: null,
        suspenso: false,
        situacao: null,
        documento: null,
      });
    const ate = `${periodo.ate}T23:59:59`;
    return r
      .filter((x) => x.quando.slice(0, 10) >= periodo.de && x.quando <= ate)
      .sort((a, b) => b.quando.localeCompare(a.quando))
      .slice(0, limite);
  }

  private legado(c: ContextoDocs, familia: 'receita' | 'atestado' | 'externo', id: number) {
    return this.est(c.hospital).legados.find((x) => x.familia === familia && x.id === id) ?? null;
  }

  async lerReceita(c: ContextoDocs, id: number) {
    return this.legado(c, 'receita', id);
  }
  async lerAtestado(c: ContextoDocs, id: number) {
    return this.legado(c, 'atestado', id);
  }
  async lerExameExterno(c: ContextoDocs, id: number) {
    const d = this.legado(c, 'externo', id);
    return d ? { ...d, elementos: [] } : null;
  }
  async documentoDaTrilha() {
    return null;
  }

  async documentos(
    c: ContextoDocs,
    paciente: number,
    familia: 'receita' | 'atestado',
  ): Promise<DocumentoResumoLido[]> {
    return this.est(c.hospital)
      .legados.filter((x) => x.familia === familia && x.paciente === paciente)
      .map((d) => ({
        id: d.id,
        familia,
        titulo: d.titulo,
        em: d.emitidoEm,
        profissional: d.profissional,
        atendimento: d.atendimento,
        suspenso: d.suspensoEm !== null,
        corrige: d.corrige,
        tpPadrao: d.tpPadrao,
      }))
      .reverse();
  }

  async fichas() {
    return [...FICHAS];
  }
  async modelosEmUso() {
    return FICHAS.map((f) => ({ nome: f.nome, usos: 10 }));
  }

  async cabecalhoDocumento(
    _c: ContextoDocs,
    retratos: { readonly htPaciente: number; readonly htAtendimento: number },
    cbo: number,
    situacao: number,
    tipoAto: number,
  ): Promise<CabecalhoDocumentoLido> {
    const paciente = Math.floor(retratos.htPaciente / 10);
    return {
      hospital: [['nome', `HOSPITAL ${M}`]],
      paciente: [
        ['id', paciente],
        ['nome', PACIENTES[paciente]?.nome ?? M],
      ],
      atendimento: [['id', Math.floor(retratos.htAtendimento / 10)]],
      profissional: [
        ['id_tbcbopro', cbo],
        ['nome', `PROFISSIONAL ${M}`],
      ],
      tipoAssinatura: String(tipoAto),
      situacao: String(situacao),
    };
  }

  async alergias(
    c: ContextoDocs,
    paciente: number,
  ): Promise<(AlergiaDoProntuarioLida & { paciente: number })[]> {
    // O dado completo (como a porta própria): o que a memória não guarda vai vazio; a origem é o hospital da sessão.
    return this.est(c.hospital)
      .alergias.filter((a) => a.paciente === paciente)
      .map((a) => ({
        descricaoLivre: null,
        tipoRegistro: 'alergia' as const,
        reacao: null,
        gravidade: null,
        certeza: null,
        origemInformacao: null,
        inativadaEm: null,
        motivoInativacao: null,
        estabelecimentoId: Number(c.hospital) || 0,
        ...a,
      }));
  }
  async catalogoAlergias() {
    return { agentes: AGENTES, principios: PRINCIPIOS };
  }
  async registrosParaAlergia(c: ContextoDocs, atendimento: number, cbos: readonly number[]) {
    return this.regs(c.hospital)
      .filter((r) => r.atendimento === atendimento && cbos.includes(r.cbo) && !r.suspenso)
      .map((r) => ({ registro: r.id, modelo: r.nomeModelo, dataHora: r.dataHoraClinica }))
      .reverse();
  }
  async versaoAlergias(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital)
      .alergias.filter((a) => a.paciente === paciente && a.ativa)
      .map((a) => a.id)
      .sort((x, y) => x - y)
      .join(',');
  }
  async catalogoExames(_c: ContextoDocs, termo: string | null) {
    const t = termo?.toUpperCase() ?? null;
    return EXAMES.filter((x) => !t || x.nome.includes(t) || x.codigo === t);
  }
  async examesPorId(_c: ContextoDocs, ids: readonly number[]) {
    return EXAMES.filter((x) => ids.includes(x.id));
  }
  async kits() {
    return KITS;
  }
  async pedidos(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital).pedidos.filter((p) => p.paciente === paciente);
  }
  async resultados(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital).resultados.filter((r) => r.paciente === paciente);
  }
  async examesExternos(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital)
      .legados.filter((d) => d.familia === 'externo' && d.paciente === paciente && !d.suspensoEm)
      .map((d) => ({ id: d.id, nome: d.titulo, em: d.emitidoEm, elementos: [] }));
  }
  async anexos(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital)
      .anexos.filter((a) => a.paciente === paciente)
      .map((a) => ({
        id: a.id,
        paciente: a.paciente,
        nome: a.nome,
        extensao: a.extensao,
        tipo: a.tipo,
        em: a.em,
        profissional: a.profissional,
        suspenso: a.suspenso,
        bytes: a.bytes,
      }));
  }
  async arquivoAnexo(c: ContextoDocs, id: number) {
    const a = this.est(c.hospital).anexos.find((x) => x.id === id);
    return a ? { paciente: a.paciente, pdf: a.pdf } : null;
  }
  async tiposTermo() {
    return [
      { id: 1, nome: `CIRÚRGICO ${M}` },
      { id: 2, nome: `ANESTÉSICO ${M}` },
    ];
  }
  async tiposAnexo() {
    return [
      { id: 1, nome: `EXAME EXTERNO ${M}` },
      { id: 2, nome: `DOCUMENTO PESSOAL ${M}` },
    ];
  }
  async tcleHerdado() {
    return null;
  }
  async tempos() {
    return [];
  }
  async historicoPareceres() {
    return { pedidos: 0, respostas: 0, encaminhamentos: 0 };
  }
  async especialidades() {
    return [
      { id: 1, nome: `CLÍNICA MÉDICA ${M}` },
      { id: 2, nome: `CARDIOLOGIA ${M}` },
    ];
  }
  async especialidadesDoCbo() {
    return [1];
  }
  async documentosSgh(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital).documentos.filter((d) => d.paciente === paciente);
  }
  async documentoSgh(c: ContextoDocs, id: number) {
    return this.est(c.hospital).documentos.find((d) => d.id === id) ?? null;
  }
  async documentoSghDaOrigem(c: ContextoDocs, tabela: string, id: number) {
    return (
      this.est(c.hospital).documentos.find((d) => d.origemTabela === tabela && d.origemId === id) ?? null
    );
  }
  async coassinaturas(c: ContextoDocs, preceptor: string) {
    return this.est(c.hospital).supervisoes.filter(
      (x) => x.preceptor === preceptor && x.situacao === 'pendente',
    );
  }
  async supervisao(c: ContextoDocs, id: number) {
    return this.est(c.hospital).supervisoes.find((x) => x.id === id) ?? null;
  }
  async coassinarNoNovo(
    c: ContextoGravacaoPep,
    x: { id: number; decisao: 'coassinado' | 'recusado'; motivo?: string | null },
  ) {
    const e = this.est(c.hospital);
    const i = e.supervisoes.findIndex((y) => y.id === x.id);
    const s = e.supervisoes[i];
    if (!s) throw new ErroProntuario('nao-encontrado', 'Pedido de coassinatura não encontrado.', 404);
    if (s.preceptor !== c.usuarioLogin)
      throw new ErroProntuario('sem-permissao', 'Só o preceptor indicado coassina este registro.', 403);
    if (s.situacao !== 'pendente')
      throw new ErroProntuario('coassinatura-encerrada', 'O registro já foi coassinado ou recusado.');
    e.supervisoes[i] = { ...s, situacao: x.decisao };
    await this.auditar(
      c,
      c.usuarioLogin,
      x.decisao === 'coassinado' ? 'pep.evolucao.coassinada' : 'pep.evolucao.coassinaturaRecusada',
      { tabela: 'SGH_PEP_SUPERVISAO', id: s.id, paciente: s.paciente },
    );
    return { registro: s.registro, paciente: s.paciente };
  }
  async pendencias(c: ContextoDocs, login: string) {
    return this.est(c.hospital).documentos.filter((d) => d.usuario === login && !d.assinadoEm && !d.suspenso);
  }
  async registrosSemAssinatura() {
    return [];
  }
  async problemas(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital).problemas.filter((p) => p.paciente === paciente);
  }
  async tcles(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital).tcles.filter((t) => t.paciente === paciente);
  }
  async sumarios(c: ContextoDocs, atendimento: number) {
    return this.est(c.hospital).sumarios.filter((s) => s.atendimento === atendimento);
  }
  async transferencias(c: ContextoDocs, atendimento: number) {
    return this.est(c.hospital).transferencias.filter((t) => t.atendimento === atendimento);
  }
  async obito(c: ContextoDocs, paciente: number) {
    const o = this.est(c.hospital).obitos.find((x) => x.paciente === paciente && x.situacao !== 'cancelada');
    return o
      ? {
          id: o.id,
          paciente: o.paciente,
          em: o.em,
          numero: o.numero,
          documento: o.documento,
          atendimento: o.atendimento,
        }
      : null;
  }
  async ciencias(c: ContextoDocs, paciente: number) {
    return this.est(c.hospital).ciencias.filter((x) => x.paciente === paciente);
  }
  async fila(
    c: ContextoDocs,
    f: { especialidade?: number; categoria?: string; situacao?: string; paciente?: number },
  ) {
    return this.est(c.hospital).fila.filter(
      (x) =>
        (f.especialidade === undefined || x.especialidade === f.especialidade) &&
        (f.categoria === undefined || x.categoria === f.categoria) &&
        (f.situacao === undefined || x.situacao === f.situacao) &&
        (f.paciente === undefined || x.paciente === f.paciente),
    );
  }
  async fluxo(c: ContextoDocs, id: number) {
    return this.est(c.hospital).fila.find((x) => x.id === id) ?? null;
  }
  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  // ── Gravações pelo executor (os mesmos esquemas das receitas) ──────────────────────────────────

  async executar(c: ContextoDocs, operacao: string, entrada: unknown, ctx: ContextoOperacao) {
    const login = loginDaOperacao(ctx);
    const e = this.est(c.hospital);
    const invalida = (campos: readonly PropertyKey[][]) =>
      new ErroOperacao(400, 'entrada-invalida', 'Entrada inválida', 'Confira os campos indicados.', {
        campos: campos.map((p) => p.map(String).join('.')),
      });
    const parse = <T>(esq: {
      safeParse(
        x: unknown,
      ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } };
    }) => {
      const r = esq.safeParse(entrada);
      if (!r.success) throw invalida(r.error.issues.map((i) => i.path));
      return r.data;
    };
    const agora = `${agoraLocal()}.000`;
    switch (operacao) {
      case 'pep.registrarAlergia': {
        const x = parse(esquemaGravacaoAlergia);
        this.conferirCbo(x.cbo, login);
        if ((await this.versaoAlergias(c, x.paciente)) !== x.versao)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'A lista mudou',
            'A lista de alergias mudou desde a leitura.',
          );
        if (x.nega) {
          const ultimaNega = e.documentos
            .filter(
              (d) =>
                d.paciente === x.paciente && d.tipo === 'alergia' && d.origemTabela !== 'alergia_paciente',
            )
            .map((d) => d.criadoEm ?? '')
            .sort()
            .at(-1);
          const ultimaAlergia = e.alergias
            .filter((a) => a.paciente === x.paciente)
            .map((a) => a.registradaEm ?? '')
            .sort()
            .at(-1);
          if (ultimaNega && (!ultimaAlergia || ultimaAlergia <= ultimaNega))
            throw new ErroOperacao(
              409,
              'nega-repetida',
              'Já registrado',
              'O paciente já está registrado como "nega alergias".',
            );
          const documento = this.novoDocumento(c.hospital, {
            tipo: 'alergia',
            origemTabela: 'SGH_PEP_ALERGIA_NEGA',
            origemId: e.proximo++,
            paciente: x.paciente,
            atendimento: x.atendimento,
            usuario: login,
            hash: x.hashConteudo,
            comoSuporte: x.comoSuporte === true,
          });
          await this.auditar(c, login, 'pep.alergia.registrada', {
            tabela: 'registro_assistencial',
            id: x.registro,
            paciente: x.paciente,
          });
          return { alergia: 0, documento, trilha: null };
        }
        const ag = AGENTES.find((a) => a.id === x.agente);
        if (!ag) throw invalida([['agente']]);
        if (e.alergias.some((a) => a.paciente === x.paciente && a.ativa && a.agenteId === x.agente))
          throw new ErroOperacao(
            422,
            'duplicada',
            'Alergia já registrada',
            'O agente já está na lista ativa.',
          );
        const id = e.proximo++;
        e.alergias.push({
          id,
          paciente: x.paciente,
          agenteId: ag.id,
          agente: ag.nome,
          tipo: ag.tipo,
          observacao: x.observacao ?? null,
          ativa: true,
          registro: x.registro,
          registradaEm: agora,
          profissional: `PROFISSIONAL ${M}`,
          principios: PRINCIPIOS.filter((p) => x.principios.includes(p.id)).map((p) => p.nome),
        });
        const documento = this.novoDocumento(c.hospital, {
          tipo: 'alergia',
          origemTabela: 'alergia_paciente',
          origemId: id,
          paciente: x.paciente,
          atendimento: x.atendimento,
          usuario: login,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        await this.auditar(c, login, 'pep.alergia.registrada', {
          tabela: 'alergia_paciente',
          id,
          paciente: x.paciente,
        });
        return { alergia: id, documento, trilha: null };
      }
      case 'pep.inativarAlergia': {
        const x = parse(esquemaInativacaoAlergia);
        const a = e.alergias.find((y) => y.id === x.alergia && y.paciente === x.paciente);
        if (!a)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Alergia não encontrada',
            'A alergia não é deste paciente.',
          );
        if (!a.ativa || (await this.versaoAlergias(c, x.paciente)) !== x.versao)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'A lista mudou',
            'A lista de alergias mudou desde a leitura.',
          );
        const i = e.alergias.indexOf(a);
        e.alergias[i] = { ...a, ativa: false };
        await this.auditar(c, login, 'pep.alergia.inativada', {
          tabela: 'alergia_paciente',
          id: a.id,
          paciente: x.paciente,
        });
        return { alergia: a.id, trilha: null };
      }
      case 'pep.emitirDocumento': {
        const x = parse(esquemaEmissaoDocumento);
        this.conferirCbo(x.cbo, login);
        if (x.familia === 'atestado' && x.tipo === 'atestado') this.conferirMedico(login);
        if (x.familia === 'atestado' && x.cid && !x.autorizacaoCid)
          throw new ErroOperacao(
            422,
            'cid-sem-autorizacao',
            'Operação recusada',
            'O CID exige a autorização do paciente.',
          );
        const origem = e.proximo++;
        const titulo =
          x.familia === 'receita'
            ? x.tipo === 'receita-controlada'
              ? 'Receita de controle especial'
              : x.tipo === 'receita-antimicrobiano'
                ? 'Receita de antimicrobiano'
                : 'Receita simples'
            : x.modeloNome;
        e.legados.push({
          familia: x.familia,
          tpPadrao: x.familia === 'receita' ? x.tpPadrao : null,
          tipo: x.tipo,
          id: origem,
          titulo,
          emitidoEm: `${x.dataHoraClinica}:00.000`,
          profissional: `PROFISSIONAL ${M}`,
          cbo: ocupacaoDe(login),
          paciente: x.paciente,
          atendimento: x.atendimento,
          suspensoEm: null,
          justificativaSuspensao: null,
          rtf: x.familia === 'receita' ? x.rtf : null,
          xml: x.familia === 'atestado' ? x.conteudoXml : null,
          retratos: x.retratos,
          modelo: x.familia === 'atestado' ? x.modeloNome : null,
          corrige: x.familia === 'atestado' ? (x.corrige ?? null) : null,
        });
        const documento = this.novoDocumento(c.hospital, {
          tipo: x.tipo,
          origemTabela: x.familia === 'receita' ? 'receita_medica' : 'documento_emitido',
          origemId: origem,
          paciente: x.paciente,
          atendimento: x.atendimento,
          usuario: login,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        await this.auditar(
          c,
          login,
          x.familia === 'receita' ? 'pep.receita.emitida' : 'pep.atestado.emitido',
          {
            tabela: x.familia === 'receita' ? 'receita_medica' : 'documento_emitido',
            id: origem,
            paciente: x.paciente,
          },
        );
        return { origem, documentoTrilha: origem + 1, documento, trilha: null };
      }
      case 'pep.suspenderDocumento': {
        const x = parse(esquemaSuspensaoDocumento);
        this.conferirCbo(x.cbo, login);
        const d = e.legados.find(
          (y) => y.familia === x.familia && y.id === x.origem && y.paciente === x.paciente,
        );
        if (!d)
          throw new ErroOperacao(
            404,
            'registro-inexistente',
            'Documento não encontrado',
            'O documento não é deste paciente.',
          );
        if (d.suspensoEm)
          throw new ErroOperacao(422, 'ja-suspenso', 'Já suspenso', 'O documento já foi suspenso.');
        Object.assign(d, { suspensoEm: agora, justificativaSuspensao: x.justificativa });
        const doc = e.documentos.find(
          (y) =>
            y.origemTabela === (x.familia === 'receita' ? 'receita_medica' : 'documento_emitido') &&
            y.origemId === x.origem,
        );
        if (doc)
          Object.assign(doc, {
            suspenso: true,
            eventos: [...doc.eventos, { tipo: 'suspenso', em: new Date().toISOString() }],
          });
        await this.auditar(c, login, 'pep.documento.suspenso', {
          tabela: x.familia === 'receita' ? 'receita_medica' : 'documento_emitido',
          id: x.origem,
          paciente: x.paciente,
        });
        return { origem: x.origem, trilha: null };
      }
      case 'pep.finalizarSumarioAlta': {
        const x = parse(esquemaFinalizacaoSumario);
        this.conferirCbo(x.cbo, login);
        this.conferirMedico(login);
        const doAtendimento = e.sumarios.filter((s) => s.atendimento === x.atendimento);
        if (doAtendimento.some((s) => s.situacao === 'finalizado'))
          throw new ErroOperacao(
            409,
            'sumario-finalizado',
            'Já finalizado',
            'O sumário de alta deste atendimento já foi finalizado.',
          );
        if (x.versao !== Math.max(0, ...doAtendimento.map((s) => s.versao)) + 1)
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Gravado por outra pessoa',
            'O sumário foi salvo por outra pessoa enquanto você editava. Releia e finalize de novo.',
          );
        const origem = e.proximo++;
        e.legados.push({
          familia: 'atestado',
          tpPadrao: null,
          tipo: 'sumario-alta',
          id: origem,
          titulo: x.modeloNome,
          emitidoEm: `${x.dataHoraClinica}:00.000`,
          profissional: `PROFISSIONAL ${M}`,
          cbo: ocupacaoDe(login),
          paciente: x.paciente,
          atendimento: x.atendimento,
          suspensoEm: null,
          justificativaSuspensao: null,
          rtf: null,
          xml: x.conteudoXml,
          retratos: x.retratos,
          modelo: x.modeloNome,
          corrige: null,
        });
        const documento = this.novoDocumento(c.hospital, {
          tipo: 'sumario-alta',
          origemTabela: 'documento_emitido',
          origemId: origem,
          paciente: x.paciente,
          atendimento: x.atendimento,
          usuario: login,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        e.sumarios.push({
          atendimento: x.atendimento,
          versao: x.versao,
          situacao: 'finalizado',
          conteudo: x.sumario,
          documento,
          usuario: login,
          em: new Date().toISOString(),
        });
        await this.auditar(c, login, 'pep.sumarioAlta.finalizado', {
          tabela: 'documento_emitido',
          id: origem,
          paciente: x.paciente,
        });
        return { origem, documento, trilha: null };
      }
      case 'pep.anexarDocumento': {
        const x = parse(esquemaAnexo);
        this.conferirCbo(x.cbo, login);
        const pdf = Buffer.from(x.conteudo, 'base64');
        if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-')
          throw new ErroOperacao(422, 'arquivo-invalido', 'Arquivo inválido', 'O arquivo não é um PDF.');
        const id = e.proximo++;
        e.anexos.push({
          id,
          paciente: x.paciente,
          nome: x.nome,
          extensao: 'pdf',
          tipo: x.tipoAnexo
            ? ((await this.tiposAnexo()).find((t) => t.id === x.tipoAnexo)?.nome ?? null)
            : null,
          em: agora,
          profissional: `PROFISSIONAL ${M}`,
          suspenso: false,
          bytes: pdf.length,
          pdf,
        });
        const documento = this.novoDocumento(c.hospital, {
          tipo: 'anexo',
          origemTabela: 'anexo_prontuario',
          origemId: id,
          paciente: x.paciente,
          atendimento: x.atendimento,
          usuario: login,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        await this.auditar(c, login, 'pep.anexo.incluido', {
          tabela: 'anexo_prontuario',
          id,
          paciente: x.paciente,
        });
        return { anexo: id, origem: id, documento, trilha: null };
      }
      case 'pep.lancarExameExterno': {
        const x = parse(esquemaExameExterno);
        this.conferirCbo(x.cbo, login);
        if (x.realizadoEm > x.dataHoraClinica)
          throw new ErroOperacao(
            422,
            'horario-futuro',
            'Horário no futuro',
            'O exame não pode ter sido feito no futuro.',
          );
        const origem = e.proximo++;
        e.legados.push({
          familia: 'externo',
          tpPadrao: null,
          tipo: 'exame-externo',
          id: origem,
          titulo: x.nomeExame,
          emitidoEm: `${x.realizadoEm}:00.000`,
          profissional: `PROFISSIONAL ${M}`,
          cbo: ocupacaoDe(login),
          paciente: x.paciente,
          atendimento: x.atendimento,
          suspensoEm: null,
          justificativaSuspensao: null,
          rtf: x.rtf,
          xml: null,
          retratos: x.retratos,
          modelo: null,
          corrige: null,
        });
        const documento = this.novoDocumento(c.hospital, {
          tipo: 'exame-externo',
          origemTabela: 'exame_lancado_prontuario',
          origemId: origem,
          paciente: x.paciente,
          atendimento: x.atendimento,
          usuario: login,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        await this.auditar(c, login, 'pep.exame.externoLancado', {
          tabela: 'exame_lancado_prontuario',
          id: origem,
          paciente: x.paciente,
        });
        return { origem, documento, trilha: null };
      }
      case 'pep.solicitarExame': {
        const x = parse(esquemaPedidoExames);
        this.conferirCbo(x.cbo, login);
        const inativo = x.itens.find((i) => !EXAMES.find((y) => y.id === i.exame)?.ativo);
        if (inativo)
          throw new ErroOperacao(422, 'exame-inativo', 'Exame inativo', 'Há exame inativo no pedido.');
        const agrupamento = e.proximo++;
        let primeiro = 0;
        for (const it of x.itens) {
          const ex = EXAMES.find((y) => y.id === it.exame)!;
          const id = e.proximo++;
          primeiro ||= id;
          e.pedidos.push({
            paciente: x.paciente,
            id,
            agrupamento,
            exame: ex.id,
            nome: ex.nome,
            ato: ex.ato,
            data: x.dataHoraClinica.slice(0, 10),
            solicitadoEm: `${x.dataHoraClinica}:00.000`,
            urgente: it.urgente,
            pendSadt: 'T',
            liberado: false,
            profissional: `PROFISSIONAL ${M}`,
            indicacao: it.indicacao ?? null,
          });
        }
        const documento = this.novoDocumento(c.hospital, {
          tipo: 'pedido-exame',
          origemTabela: 'requisicao_exame',
          origemId: agrupamento,
          paciente: x.paciente,
          atendimento: x.atendimento,
          usuario: login,
          hash: x.hashConteudo,
          comoSuporte: x.comoSuporte === true,
        });
        await this.auditar(c, login, 'pep.exame.solicitado', {
          tabela: 'exame_item',
          id: primeiro,
          paciente: x.paciente,
        });
        return {
          agrupamento,
          primeiro,
          exames: x.itens.length,
          documentoTrilha: agrupamento,
          documento,
          trilha: null,
        };
      }
      default:
        throw new ErroOperacao(
          403,
          'operacao-nao-liberada',
          'Operação não liberada',
          'Operação desconhecida.',
        );
    }
  }

  // ── Gravações só do novo ───────────────────────────────────────────────────────────────────────

  async gravarProblema(c: ContextoGravacaoPep, p: ProblemaNovo) {
    const e = this.est(c.hospital);
    if (p.anterior !== null && e.problemas.some((x) => x.anterior === p.anterior))
      throw new ErroProntuario('conflito-versao', 'O problema mudou desde a leitura.');
    const id = e.proximo++;
    e.problemas.push({
      id,
      paciente: p.paciente,
      anterior: p.anterior,
      descricao: p.descricao,
      cid: p.cid,
      tipo: p.tipo,
      inicio: p.inicio,
      fim: p.fim,
      situacao: p.situacao,
      usuario: c.usuarioLogin,
      em: new Date().toISOString(),
    });
    await this.auditar(c, c.usuarioLogin, 'pep.problema.gravado', {
      tabela: 'SGH_PEP_PROBLEMA',
      id,
      paciente: p.paciente,
    });
    return id;
  }

  async registrarCiencia(
    c: ContextoGravacaoPep,
    x: {
      paciente: number;
      exame: number;
      chave: string;
      resultado: number | null;
      elemento: string | null;
      conduta: string;
      escalonadoPara: string | null;
    },
  ) {
    const e = this.est(c.hospital);
    if (e.ciencias.some((y) => y.exame === x.exame && y.paciente === x.paciente))
      throw new ErroProntuario('ja-ciente', 'A ciência deste resultado já foi registrada.');
    const id = e.proximo++;
    e.ciencias.push({
      paciente: x.paciente,
      exame: x.exame,
      usuario: c.usuarioLogin,
      em: new Date().toISOString(),
      conduta: x.conduta,
      elemento: x.elemento,
    });
    await this.auditar(c, c.usuarioLogin, 'pep.resultado.ciente', {
      tabela: 'SGH_PEP_RESULT_CIENCIA',
      id,
      paciente: x.paciente,
    });
    return id;
  }

  async aceitarParecer(c: ContextoGravacaoPep, parecer: number) {
    const e = this.est(c.hospital);
    const i = e.fila.findIndex((x) => x.id === parecer);
    const f = e.fila[i];
    if (!f) throw new ErroProntuario('registro-inexistente', 'Parecer não encontrado.', 404);
    if (f.situacao !== 'solicitado')
      throw new ErroProntuario('situacao-invalida', 'O parecer não está aguardando aceite.');
    e.fila[i] = { ...f, situacao: 'aceito', aceitoPor: c.usuarioLogin };
    await this.auditar(c, c.usuarioLogin, 'pep.parecer.aceito', {
      tabela: 'SGH_PEP_FLUXO',
      id: parecer,
      paciente: f.paciente,
    });
    return { paciente: f.paciente };
  }

  async cancelarParecer(c: ContextoGravacaoPep, parecer: number, motivo: string) {
    const e = this.est(c.hospital);
    const i = e.fila.findIndex((x) => x.id === parecer);
    const f = e.fila[i];
    if (!f) throw new ErroProntuario('registro-inexistente', 'Parecer não encontrado.', 404);
    if (f.situacao === 'respondido' || f.situacao === 'cancelado')
      throw new ErroProntuario('situacao-invalida', 'O parecer já foi encerrado.');
    e.fila[i] = { ...f, situacao: 'cancelado' };
    void motivo; // o motivo vai à trilha da gravação real (SGH_PEP_FLUXO); na memória, só a situação
    await this.auditar(c, c.usuarioLogin, 'pep.parecer.cancelado', {
      tabela: 'SGH_PEP_FLUXO',
      id: parecer,
      paciente: f.paciente,
    });
  }

  async emitirTcle(
    c: ContextoGravacaoPep,
    t: {
      paciente: number;
      atendimento: number;
      tipo: number | null;
      procedimento: string;
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
    },
  ) {
    const e = this.est(c.hospital);
    const id = e.proximo++;
    const documento = this.novoDocumento(c.hospital, {
      tipo: 'tcle',
      origemTabela: 'SGH_PEP_TCLE',
      origemId: id,
      paciente: t.paciente,
      atendimento: t.atendimento,
      usuario: c.usuarioLogin,
      hash: t.hashConteudo,
      comoSuporte: t.comoSuporte === true,
    });
    e.tcles.push({
      id,
      paciente: t.paciente,
      anterior: null,
      atendimento: t.atendimento,
      tipo: t.tipo,
      procedimento: t.procedimento,
      situacao: 'pendente',
      motivo: null,
      documento,
      usuario: c.usuarioLogin,
      em: `${agoraLocal()}.000`,
    });
    await this.auditar(c, c.usuarioLogin, 'pep.tcle.gravado', {
      tabela: 'SGH_PEP_TCLE',
      id,
      paciente: t.paciente,
    });
    return { id, documento };
  }

  async mudarSituacaoTcle(
    c: ContextoGravacaoPep,
    m: { paciente: number; versao: number; situacao: 'assinado' | 'revogado'; motivo: string | null },
  ) {
    const e = this.est(c.hospital);
    const t = e.tcles.find((x) => x.id === m.versao && x.paciente === m.paciente);
    if (!t) throw new ErroProntuario('registro-inexistente', 'Termo não encontrado.', 404);
    if (e.tcles.some((x) => x.anterior === t.id))
      throw new ErroProntuario('conflito-versao', 'O termo mudou desde a leitura.');
    if (t.situacao === 'revogado') throw new ErroProntuario('situacao-invalida', 'O termo já foi revogado.');
    const id = e.proximo++;
    e.tcles.push({
      ...t,
      id,
      anterior: t.id,
      situacao: m.situacao,
      motivo: m.motivo,
      usuario: c.usuarioLogin,
      em: `${agoraLocal()}.000`,
    });
    await this.auditar(c, c.usuarioLogin, 'pep.tcle.gravado', {
      tabela: 'SGH_PEP_TCLE',
      id,
      paciente: m.paciente,
    });
    return id;
  }

  async salvarRascunhoSumario(
    c: ContextoGravacaoPep,
    s: { paciente: number; atendimento: number; versao: number; conteudo: string; hashConteudo: string },
  ) {
    const e = this.est(c.hospital);
    if (e.sumarios.some((x) => x.atendimento === s.atendimento && x.versao >= s.versao))
      throw new ErroProntuario('conflito-versao', 'Outra versão do sumário foi salva.');
    e.sumarios.push({
      atendimento: s.atendimento,
      versao: s.versao,
      situacao: 'rascunho',
      conteudo: s.conteudo,
      documento: null,
      usuario: c.usuarioLogin,
      em: new Date().toISOString(),
    });
    await this.auditar(c, c.usuarioLogin, 'pep.sumarioAlta.salvo', {
      tabela: 'SGH_PEP_SUMARIO_ALTA',
      id: s.versao,
      paciente: s.paciente,
    });
    return s.versao;
  }

  async registrarTransferencia(
    c: ContextoGravacaoPep,
    t: {
      paciente: number;
      atendimento: number;
      destino: string;
      motivo: string;
      conteudo: string;
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
    },
  ) {
    const e = this.est(c.hospital);
    const id = e.proximo++;
    const documento = this.novoDocumento(c.hospital, {
      tipo: 'rel-transferencia',
      origemTabela: 'SGH_PEP_REL_TRANSF',
      origemId: id,
      paciente: t.paciente,
      atendimento: t.atendimento,
      usuario: c.usuarioLogin,
      hash: t.hashConteudo,
      comoSuporte: t.comoSuporte === true,
    });
    e.transferencias.push({
      id,
      atendimento: t.atendimento,
      destino: t.destino,
      em: new Date().toISOString(),
      documento,
    });
    await this.auditar(c, c.usuarioLogin, 'pep.transferencia.registrada', {
      tabela: 'SGH_PEP_REL_TRANSF',
      id,
      paciente: t.paciente,
    });
    return { id, documento };
  }

  async registrarObito(
    c: ContextoGravacaoPep,
    o: {
      paciente: number;
      atendimento: number;
      dataHora: Date;
      numero: string | null;
      causas: string;
      cbo: number | null;
      hashConteudo: string;
      comoSuporte?: boolean;
    },
  ) {
    const e = this.est(c.hospital);
    if (e.obitos.some((x) => x.paciente === o.paciente && x.situacao !== 'cancelada'))
      throw new ErroProntuario('ja-registrado', 'O óbito do paciente já foi registrado.');
    const id = e.proximo++;
    const documento = this.novoDocumento(c.hospital, {
      tipo: 'declaracao-obito',
      origemTabela: 'SGH_PEP_OBITO',
      origemId: id,
      paciente: o.paciente,
      atendimento: o.atendimento,
      usuario: c.usuarioLogin,
      hash: o.hashConteudo,
      comoSuporte: o.comoSuporte === true,
    });
    e.obitos.push({
      id,
      paciente: o.paciente,
      em: o.dataHora.toISOString(),
      numero: o.numero,
      documento,
      atendimento: o.atendimento,
      emissor: c.usuarioLogin,
      situacao: o.numero ? 'emitida' : 'rascunho',
      canceladaEm: null,
      motivoCancelamento: null,
    });
    await this.auditar(c, c.usuarioLogin, 'pep.obito.registrado', {
      tabela: 'declaracao_obito',
      id,
      paciente: o.paciente,
    });
    return { id, documento };
  }

  /** Como na porta própria: a declaração fica, cancelada com data e motivo; o documento sai de vigência com evento. */
  async cancelarObito(c: ContextoGravacaoPep, o: { paciente: number; motivo: string; cbo: number | null }) {
    const e = this.est(c.hospital);
    const x = e.obitos.find((d) => d.paciente === o.paciente && d.situacao !== 'cancelada');
    if (!x)
      throw new ErroProntuario(
        'registro-inexistente',
        'O paciente não tem declaração de óbito vigente.',
        404,
      );
    const v = validarCancelamentoObito(x.situacao, o.motivo, x.emissor === c.usuarioLogin);
    if (!v.ok) throw new ErroProntuario(v.codigo, v.mensagem, statusDaRecusaObito(v.codigo));
    const agora = new Date().toISOString();
    x.situacao = 'cancelada';
    x.canceladaEm = agora;
    x.motivoCancelamento = (v as { motivo: string }).motivo;
    const i = e.documentos.findIndex((d) => d.id === x.documento);
    if (i >= 0) {
      const d = e.documentos[i]!;
      e.documentos[i] = { ...d, suspenso: true, eventos: [...d.eventos, { tipo: 'cancelado', em: agora }] };
    }
    await this.auditar(c, c.usuarioLogin, 'pep.obito.cancelado', {
      tabela: 'declaracao_obito',
      id: x.id,
      paciente: o.paciente,
    });
    return { id: x.id, documento: x.documento };
  }

  async assinar(
    c: ContextoGravacaoPep,
    itens: readonly { documento: number; hash: string }[],
    comoSuporte?: boolean,
  ) {
    const e = this.est(c.hospital);
    const assinados: number[] = [];
    const recusados: { documento: number; motivo: string }[] = [];
    for (const it of itens) {
      const d = e.documentos.find((x) => x.id === it.documento);
      if (!d || d.usuario !== c.usuarioLogin)
        recusados.push({
          documento: it.documento,
          motivo: 'Documento não encontrado entre as suas pendências.',
        });
      else if (d.assinadoEm) recusados.push({ documento: it.documento, motivo: 'Já assinado.' });
      else if (d.hash !== it.hash)
        recusados.push({ documento: it.documento, motivo: 'O conteúdo mudou desde a prévia.' });
      else {
        Object.assign(d, {
          assinadoEm: new Date().toISOString(),
          nivel: comoSuporte ? 'avancada-sessao-suporte' : 'avancada-sessao',
          eventos: [...d.eventos, { tipo: 'assinado', em: new Date().toISOString() }],
        });
        assinados.push(d.id);
      }
    }
    if (assinados.length)
      await this.auditar(c, c.usuarioLogin, 'documento.documento.assinado', {
        tabela: 'SGH_PEP_DOCUMENTO',
        id: assinados[0]!,
      });
    return { assinados, recusados };
  }

  async documentoDoRegistroClinico(
    c: ContextoGravacaoPep,
    r: { registro: number; paciente: number; atendimento: number | null; hash: string },
  ) {
    const existente = await this.documentoSghDaOrigem(c, 'registro_assistencial', r.registro);
    if (existente) return existente.id;
    return this.novoDocumento(c.hospital, {
      tipo: 'registro-clinico',
      origemTabela: 'registro_assistencial',
      origemId: r.registro,
      paciente: r.paciente,
      atendimento: r.atendimento,
      usuario: c.usuarioLogin,
      hash: r.hash,
      comoSuporte: false,
    });
  }

  async registrarEventoDocumento(
    c: ContextoGravacaoPep,
    ev: {
      documento: number;
      tipo: 'visualizado' | 'impresso' | 'segunda-via' | 'exportado';
      justificativa?: string | null;
    },
  ) {
    const d = this.est(c.hospital).documentos.find((x) => x.id === ev.documento);
    if (d) d.eventos.push({ tipo: ev.tipo, em: new Date().toISOString() });
  }

  async trazerPedidosAnteriores() {
    return 0;
  }
}
