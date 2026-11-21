// Porta da manutenção EM MEMÓRIA (M55, etapa 1): a sessão sintética de dev/ci (E2E) e os testes da API têm setores,
// unidades, recursos de agenda, um fornecedor, equipamentos, uma cobertura e planos SINTÉTICOS, e gravam com as mesmas
// regras da gravação (código único, versão vista, a mudança só sobre a situação lida, a execução que sobe a versão do
// plano, o aviso uma vez por destinatário e objeto). Uma falha no meio desfaz tudo (como o ROLLBACK). Nada vai à cópia;
// nenhum nome é de pessoa real.
import {
  type AlertaEquipamento,
  CODIGOS_TIPO_RECURSO_AGENDA,
  type ConclusaoDeCurso,
  type CursoDoModelo,
  type EventoCicloVida,
  SITUACOES_OS_ABERTAS,
  type SituacaoAlertaEquipamento,
  type TipoRecursoAgenda,
} from '@sgh/contratos';
import {
  type AcaoDeCampo,
  type CamposAlertaParaGravar,
  type EquipamentoDoParque,
  recusaAlerta,
  recusaCicloVida,
  type AvisoDaCentral,
  type CoberturaManutencao,
  type EquipamentoManutencao,
  type EquipamentoParaGravar,
  type EventoOrdem,
  type ExecucaoDoPlano,
  type VersaoDoPlano,
  type VersaoDaCobertura,
  type FiltroEquipamentos,
  type FiltroOrdens,
  numeroDaOs,
  type OcorrenciasDoPeriodo,
  type OrdemServico,
  type PlanoManutencao,
  type RecursoDeAgenda,
  type SetorManutencao,
} from './tipos.js';
import { recusa } from '@sgh/nucleo';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { CursoDoCatalogo, FiltroPeriodoPorta, GravadorManutencao, PortaManutencao } from './porta.js';

/** A chave do estado em memória: o estabelecimento da sessão (pelo código, quando a sessão o traz). */
type ChaveMemoria = Partial<Pick<ContextoPortaM18, 'estabelecimento'>> & { readonly hospital?: string };

export const SETORES_SINTETICOS_MANUTENCAO: readonly SetorManutencao[] = [
  { codigo: 101, nome: 'Pronto-socorro (sintético)', sigla: 'PS', unidade: 1, ativo: true },
  { codigo: 102, nome: 'Centro cirúrgico (sintético)', sigla: 'CC', unidade: 1, ativo: true },
  { codigo: 103, nome: 'Laboratório (sintético)', sigla: 'LAB', unidade: 1, ativo: true },
  { codigo: 104, nome: 'UTI adulto (sintético)', sigla: 'UTI', unidade: 2, ativo: true },
  { codigo: 105, nome: 'Manutenção e engenharia clínica (sintético)', sigla: 'MAN', unidade: 1, ativo: true },
  { codigo: 199, nome: 'Setor desativado (sintético)', sigla: null, unidade: null, ativo: false },
];
export const UNIDADES_SINTETICAS_MANUTENCAO = [
  { codigo: 1, nome: 'Unidade central (sintética)' },
  { codigo: 2, nome: 'Unidade de terapia (sintética)' },
] as const;
export const RECURSOS_SINTETICOS_MANUTENCAO: readonly RecursoDeAgenda[] = [
  {
    tipo: 'agendaConsulta',
    id: 55,
    nome: 'Consultório de cardiologia (sintético)',
    ativo: true,
    centroCusto: null,
  },
  { tipo: 'agendaExame', id: 60, nome: 'Ecocardiograma (sintético)', ativo: true, centroCusto: null },
  { tipo: 'salaCirurgica', id: 3, nome: 'Sala 3 (sintética)', ativo: true, centroCusto: 102 },
];
export const FORNECEDORES_SINTETICOS_MANUTENCAO = [
  { codigo: 7001, nome: 'Engenharia Clínica Sintética' },
  { codigo: 7002, nome: 'Climatização Sintética' },
] as const;
/** Logins sintéticos com cada setor no cadastro de centros de custo (os avisados do equipamento crítico parado). */
export const LOGINS_DO_SETOR_SINTETICOS: Readonly<Record<number, readonly string[]>> = {
  102: ['SINT.MANUTENCAO.SETOR', 'SINT.PATRIMONIO.SETOR'],
  104: ['SINT.ENFERMEIRO'],
};

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };

/** W0-08, parte 9 (M3): o catálogo sintético do treinamento (o da memória do pessoas começa vazio) e as conclusões. */
export const CURSOS_SINTETICOS_MANUTENCAO: readonly CursoDoCatalogo[] = [
  { id: 701, codigo: 'OPMX', titulo: 'Operação do monitor MX-1', validadeMeses: 24, ativo: true },
  {
    id: 702,
    codigo: 'SEGEL',
    titulo: 'Segurança elétrica em equipamentos médicos',
    validadeMeses: 0,
    ativo: true,
  },
  { id: 703, codigo: 'ANTIGO', titulo: 'Curso antigo inativado', validadeMeses: 12, ativo: false },
];
export const CONCLUSOES_SINTETICAS_MANUTENCAO: readonly ConclusaoDeCurso[] = [
  {
    vinculo: 801,
    nome: 'Ana Operadora Sintética',
    matricula: 'S801',
    curso: 701,
    conclusao: '2026-01-10',
    validoAte: '2099-01-10',
  },
  {
    vinculo: 801,
    nome: 'Ana Operadora Sintética',
    matricula: 'S801',
    curso: 702,
    conclusao: '2026-01-11',
    validoAte: null,
  },
  {
    vinculo: 802,
    nome: 'Bruno Técnico Sintético',
    matricula: 'S802',
    curso: 701,
    conclusao: '2026-02-01',
    validoAte: '2099-02-01',
  },
  {
    vinculo: 803,
    nome: 'Carla Enfermeira Sintética',
    matricula: 'S803',
    curso: 701,
    conclusao: '2018-03-01',
    validoAte: '2020-03-01',
  },
  {
    vinculo: 803,
    nome: 'Carla Enfermeira Sintética',
    matricula: 'S803',
    curso: 702,
    conclusao: '2018-03-02',
    validoAte: null,
  },
];

interface Estado {
  equipamentos: (EquipamentoParaGravar & { id: number; versao: number; desativadoEm: string | null })[];
  coberturas: Mutavel<CoberturaManutencao>[];
  versoesCobertura: (VersaoDaCobertura & { cobertura: number })[];
  os: OrdemServico[];
  eventos: (EventoOrdem & { os: number })[];
  planos: Mutavel<Omit<PlanoManutencao, 'ultimaExecucao' | 'ultimoResultado'>>[];
  execucoes: ExecucaoDoPlano[];
  versoesPlano: (VersaoDoPlano & { plano: number })[];
  avisos: (Omit<AvisoDaCentral, 'rede' | 'hospital'> & { id: number })[];
  /** W0-08, parte 8 (M2): os alertas, as OS de ação de campo e a queixa técnica aberta de cada OS. */
  alertas: Mutavel<Omit<AlertaEquipamento, 'acoes'>>[];
  acoesAlerta: { alerta: number; equipamento: number; os: number; por: string; em: string }[];
  queixasOs: { os: number; queixa: number; alerta: string | null }[];
  /** W0-08, parte 9 (M3): os cursos exigidos por modelo e os eventos do ciclo de vida. */
  cursosModelo: CursoDoModelo[];
  eventosCiclo: EventoCicloVida[];
  seq: number;
}

const p2 = (n: number) => String(n).padStart(2, '0');
function agoraLocal(): { hoje: string; agora: string } {
  const d = new Date();
  const agora = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return { hoje: agora.slice(0, 10), agora };
}
const mesmo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const login = (x: string) => x.trim().toUpperCase().slice(0, 31);
const desatualizado = (o: string) =>
  recusa(
    'desatualizado',
    `${o} mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.`,
  );

function semente(): Estado {
  const base = {
    fabricante: null,
    modelo: null,
    numeroSerie: null,
    registroAnvisa: null,
    unidade: 1,
    localizacao: null,
    bemPatrimonial: null,
    garantiaAte: null,
    motivo: null,
    usuario: 'SINT.ADMIN',
    versao: 1,
    desativadoEm: null,
  };
  return {
    equipamentos: [
      {
        ...base,
        id: 9001,
        codigo: 'EQ-CC-001',
        nome: 'Monitor multiparamétrico (sintético)',
        tipo: 'medico',
        criticidade: 'critica',
        classeRisco: 'III',
        fabricante: 'Fabricante Sintético',
        modelo: 'MX-1',
        numeroSerie: 'SN-0001',
        centroCusto: 102,
        recurso: { tipo: 'salaCirurgica', id: 3 },
        instalacao: '2024-03-01',
        situacao: 'ativo',
      },
      {
        ...base,
        id: 9002,
        codigo: 'EQ-CAR-001',
        nome: 'Eletrocardiógrafo (sintético)',
        tipo: 'medico',
        criticidade: 'critica',
        classeRisco: 'II',
        centroCusto: 101,
        recurso: { tipo: 'agendaConsulta', id: 55 },
        instalacao: '2023-06-10',
        situacao: 'ativo',
      },
      {
        ...base,
        id: 9003,
        codigo: 'EQ-UTI-001',
        nome: 'Bomba de infusão (sintética)',
        tipo: 'medico',
        criticidade: 'alta',
        classeRisco: 'II',
        unidade: 2,
        centroCusto: 104,
        recurso: null,
        instalacao: '2025-01-15',
        situacao: 'ativo',
      },
      {
        ...base,
        id: 9004,
        codigo: 'AR-LAB-001',
        nome: 'Ar-condicionado do laboratório (sintético)',
        tipo: 'infraestrutura',
        criticidade: 'media',
        classeRisco: null,
        centroCusto: 103,
        recurso: null,
        instalacao: null,
        situacao: 'ativo',
      },
    ],
    coberturas: [
      {
        id: 9101,
        versao: 1,
        fornecedor: 7001,
        numero: 'CT-2026-01',
        cobertura: 'integral',
        inicio: '2026-01-01',
        fim: '2026-12-31',
        slaHoras: 8,
        valorMensalCent: 450_000,
        contrato: null,
        ativa: true,
        equipamentos: [9001, 9002],
        encerradaEm: null,
        motivoEncerramento: null,
      },
    ],
    versoesCobertura: [],
    os: [],
    eventos: [],
    planos: [
      {
        id: 9201,
        versao: 1,
        equipamento: 9001,
        atividade: 'calibracao',
        periodicidade: { quantidade: 12, unidade: 'meses' },
        dataBase: '2025-10-01',
        antecedenciaDias: null,
        procedimento: 'Calibração anual com o analisador de sinais vitais.',
        executor: 'contrato',
        cobertura: 9101,
        ativo: true,
        modelo: null,
      },
      {
        id: 9202,
        versao: 1,
        equipamento: 9003,
        atividade: 'preventiva',
        periodicidade: { quantidade: 6, unidade: 'meses' },
        dataBase: '2026-11-05',
        antecedenciaDias: null,
        procedimento: null,
        executor: 'interno',
        cobertura: null,
        ativo: true,
        modelo: null,
      },
    ],
    execucoes: [],
    versoesPlano: [],
    avisos: [],
    alertas: [],
    acoesAlerta: [],
    queixasOs: [],
    cursosModelo: [],
    eventosCiclo: [],
    seq: 55_100,
  };
}

export class PortaManutencaoMemoria implements PortaManutencao {
  readonly destino = 'memoria' as const;
  private readonly porHospital = new Map<string, Estado>();

  constructor(private readonly relogioFn: () => { hoje: string; agora: string } = agoraLocal) {}

  /** Os avisos gravados (testes). */
  avisos(c: ChaveMemoria): readonly (AvisoDaCentral & { id: number })[] {
    return this.e(c).avisos;
  }

  private e(c: ChaveMemoria): Estado {
    const chave = c.hospital ?? String(c.estabelecimento ?? '');
    let s = this.porHospital.get(chave);
    if (!s) {
      s = semente();
      this.porHospital.set(chave, s);
    }
    return s;
  }

  private equipamentoLido(s: Estado, id: number): EquipamentoManutencao | null {
    const e = s.equipamentos.find((x) => x.id === id);
    if (!e) return null;
    const doEq = s.os.filter((o) => o.equipamento === id);
    return {
      id: e.id,
      versao: e.versao,
      codigo: e.codigo,
      nome: e.nome,
      tipo: e.tipo,
      criticidade: e.criticidade,
      classeRisco: e.tipo === 'medico' ? e.classeRisco : null,
      fabricante: e.fabricante,
      modelo: e.modelo,
      numeroSerie: e.numeroSerie,
      registroAnvisa: e.registroAnvisa,
      unidade: e.unidade,
      centroCusto: e.centroCusto,
      localizacao: e.localizacao,
      recurso: e.recurso,
      bemPatrimonial: e.bemPatrimonial,
      instalacao: e.instalacao,
      garantiaAte: e.garantiaAte,
      situacao: e.situacao,
      desativadoEm: e.desativadoEm,
      motivo: e.motivo,
      parado: doEq.some((o) => o.paradaInicio !== null && o.paradaFim === null && o.situacao !== 'cancelada'),
      osAbertas: doEq.filter((o) => SITUACOES_OS_ABERTAS.includes(o.situacao)).length,
    };
  }

  private alertaLido(s: Estado, id: number): AlertaEquipamento | null {
    const a = s.alertas.find((x) => x.id === id);
    return a ? { ...a, acoes: s.acoesAlerta.filter((q) => q.alerta === id).length } : null;
  }

  private acoesDoAlertaLidas(s: Estado, alerta: number): AcaoDeCampo[] {
    return s.acoesAlerta
      .filter((q) => q.alerta === alerta)
      .map((q) => {
        const o = s.os.find((x) => x.id === q.os);
        return {
          equipamento: q.equipamento,
          os: { id: q.os, numero: o?.numero ?? '', situacao: o?.situacao ?? '' },
          queixa: s.queixasOs.find((k) => k.os === q.os)?.queixa ?? null,
          por: q.por,
          em: q.em,
        };
      });
  }

  /** Como a leitura do banco: com fabricante e fora os desativados, mais os que já têm OS do alerta. */
  private parqueDoAlertaLido(s: Estado, alerta: number): EquipamentoDoParque[] {
    const comOs = new Set(s.acoesAlerta.filter((q) => q.alerta === alerta).map((q) => q.equipamento));
    return s.equipamentos
      .filter((e) => (e.fabricante !== null && e.situacao !== 'desativado') || comOs.has(e.id))
      .sort((a, b) => a.codigo.localeCompare(b.codigo))
      .map((e) => ({
        id: e.id,
        codigo: e.codigo,
        nome: e.nome,
        fabricante: e.fabricante,
        modelo: e.modelo,
        numeroSerie: e.numeroSerie,
        centroCusto: e.centroCusto,
        situacao: e.situacao,
      }));
  }

  private plano(s: Estado, id: number): PlanoManutencao | null {
    const p = s.planos.find((x) => x.id === id);
    if (!p) return null;
    const ult = s.execucoes
      .filter((x) => x.plano === id)
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)[0];
    return { ...p, ultimaExecucao: ult?.data ?? null, ultimoResultado: ult?.resultado ?? null };
  }

  async podeGravar() {
    return { pode: false, codigo: 'sem-operacao', motivo: 'A manutenção não usa operação do executor.' };
  }

  async executar(): Promise<never> {
    throw new Error('A manutenção não usa operação do executor.');
  }

  async gravarSgh<T>(
    c: ContextoPortaM18,
    _trilha: unknown,
    fn: (g: GravadorManutencao) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const antes = structuredClone(s);
    try {
      return await fn(this.gravador(s));
    } catch (x) {
      Object.assign(s, antes);
      throw x;
    }
  }

  private gravador(s: Estado): GravadorManutencao {
    const novo = () => ++s.seq;
    const evento = (
      os: number,
      ator: string,
      de: OrdemServico['situacao'] | null,
      para: OrdemServico['situacao'],
      nota: string | null,
    ) => s.eventos.push({ id: novo(), os, em: this.relogioFn().agora, ator: login(ator), de, para, nota });
    const codigoLivre = (codigo: string, id: number | null) => {
      if (s.equipamentos.some((x) => x.codigo === codigo && x.id !== id))
        throw recusa('codigo-repetido', 'Já há equipamento com este código neste estabelecimento.', {
          campos: ['codigo'],
        });
    };
    const retratarCobertura = (
      c: Mutavel<CoberturaManutencao>,
      operacao: 'alteracao' | 'encerramento',
      motivo: string,
      usuario: string,
    ) =>
      s.versoesCobertura.push({
        cobertura: c.id,
        versao: c.versao,
        operacao,
        inicio: c.inicio,
        fim: c.fim,
        slaHoras: c.slaHoras,
        valorMensalCent: c.valorMensalCent,
        equipamentos: [...c.equipamentos],
        motivo,
        por: login(usuario),
        em: this.relogioFn().agora,
      });
    const numeroLivre = (numero: string, id: number | null) => {
      if (s.alertas.some((a) => mesmo(a.numero, numero) && a.id !== id))
        throw recusaAlerta('numero-repetido');
    };
    const alertaPelaVersao = (id: number, versao: number) => {
      const a = s.alertas.find((x) => x.id === id);
      if (!a || a.versao !== versao) throw recusaAlerta('desatualizado');
      return a;
    };
    const camposAlerta = (x: CamposAlertaParaGravar) => ({
      numero: x.numero,
      tipo: x.tipo,
      titulo: x.titulo,
      fabricante: x.fabricante,
      modelo: x.modelo,
      serieInicio: x.serieInicio,
      serieFim: x.serieFim,
      registroAnvisa: x.registroAnvisa,
      publicadoEm: x.publicadoEm,
      descricao: x.descricao,
      acao: x.acao,
    });
    const g: GravadorManutencao = {
      relogio: async () => this.relogioFn(),
      setores: async () => SETORES_SINTETICOS_MANUTENCAO.map((x) => ({ ...x })),
      equipamento: async (id) => this.equipamentoLido(s, id),
      equipamentoPorCodigo: async (codigo) => {
        const e = s.equipamentos.find((x) => x.codigo === codigo.trim().toUpperCase());
        return e ? this.equipamentoLido(s, e.id) : null;
      },
      os: async (id) => {
        const o = s.os.find((x) => x.id === id);
        return o ? { ...o } : null;
      },
      osAbertasDoEquipamento: async (eq) =>
        s.os
          .filter((o) => o.equipamento === eq && SITUACOES_OS_ABERTAS.includes(o.situacao))
          .map((o) => o.id),
      plano: async (id) => this.plano(s, id),
      cobertura: async (id) => {
        const x = s.coberturas.find((c) => c.id === id);
        return x ? { ...x } : null;
      },
      recurso: async (tipo, id) =>
        RECURSOS_SINTETICOS_MANUTENCAO.find((r) => r.tipo === tipo && r.id === id) ?? null,
      fornecedorExiste: async (codigo) => FORNECEDORES_SINTETICOS_MANUTENCAO.some((f) => f.codigo === codigo),
      loginsDoSetor: async (centro) => [...(LOGINS_DO_SETOR_SINTETICOS[centro] ?? [])],
      equipamentosDoRecurso: async (r) =>
        s.equipamentos.filter((e) => e.recurso?.tipo === r.tipo && e.recurso.id === r.id).map((e) => e.id),
      incluirEquipamento: async (x) => {
        codigoLivre(x.codigo, null);
        const id = novo();
        s.equipamentos.push({
          ...x,
          id,
          versao: 1,
          desativadoEm: x.situacao === 'desativado' ? this.relogioFn().hoje : null,
        });
        return { id, versao: 1 };
      },
      alterarEquipamento: async (x) => {
        const e = s.equipamentos.find((y) => y.id === x.id);
        if (!e || e.versao !== x.versaoVista) throw desatualizado('O equipamento');
        codigoLivre(x.codigo, x.id);
        const desativadoEm = x.situacao === 'desativado' ? (e.desativadoEm ?? this.relogioFn().hoje) : null;
        const motivo = x.situacao === 'desativado' ? x.motivo : e.motivo;
        Object.assign(e, { ...x, versao: e.versao + 1, desativadoEm, motivo });
        return { id: e.id, versao: e.versao };
      },
      abrirOs: async (x) => {
        const id = novo();
        const numero = numeroDaOs(x.registro, id);
        s.os.push({
          id,
          versao: 1,
          numero,
          natureza: x.natureza,
          equipamento: x.equipamento,
          centroCusto: x.centroCusto,
          local: x.local,
          descricao: x.descricao,
          contato: x.contato,
          prioridadeSugerida: x.prioridadeSugerida,
          prioridade: x.prioridade,
          situacao: 'aberta',
          solicitante: login(x.solicitante),
          tecnico: null,
          executor: 'interno',
          cobertura: null,
          plano: x.plano,
          registro: x.registro,
          assumidaEm: null,
          concluidaEm: null,
          encerradaEm: null,
          canceladaEm: null,
          motivoCancelamento: null,
          paradaInicio: x.parado && x.equipamento !== null ? x.registro : null,
          paradaFim: null,
          causa: null,
          solucao: null,
          inicioReparo: null,
          fimReparo: null,
          custoPecasCent: 0,
          custoMaoDeObraCent: 0,
          custoTerceirosCent: 0,
          laudo: null,
        });
        evento(id, x.solicitante, null, 'aberta', x.nota);
        return { id, numero, versao: 1 };
      },
      mudarOs: async (x) => {
        const o = s.os.find((y) => y.id === x.id);
        if (!o || o.versao !== x.versaoVista || o.situacao !== x.de)
          throw desatualizado('A ordem de serviço');
        const c = x.campos;
        Object.assign(o, {
          situacao: x.para,
          versao: o.versao + 1,
          ...(c.prioridade !== undefined ? { prioridade: c.prioridade } : {}),
          ...(c.tecnico !== undefined ? { tecnico: c.tecnico === null ? null : login(c.tecnico) } : {}),
          ...(c.executor !== undefined ? { executor: c.executor } : {}),
          ...(c.cobertura !== undefined ? { cobertura: c.cobertura } : {}),
          ...(c.assumidaEm !== undefined ? { assumidaEm: c.assumidaEm } : {}),
          ...(c.concluidaEm !== undefined ? { concluidaEm: c.concluidaEm } : {}),
          ...(c.encerradaEm !== undefined ? { encerradaEm: c.encerradaEm } : {}),
          ...(c.canceladaEm !== undefined ? { canceladaEm: c.canceladaEm } : {}),
          ...(c.motivoCancelamento !== undefined ? { motivoCancelamento: c.motivoCancelamento } : {}),
          ...(c.paradaFim !== undefined ? { paradaFim: c.paradaFim } : {}),
          ...(c.causa !== undefined ? { causa: c.causa } : {}),
          ...(c.solucao !== undefined ? { solucao: c.solucao } : {}),
          ...(c.inicioReparo !== undefined ? { inicioReparo: c.inicioReparo } : {}),
          ...(c.fimReparo !== undefined ? { fimReparo: c.fimReparo } : {}),
          ...(c.custoPecasCent !== undefined ? { custoPecasCent: Math.round(c.custoPecasCent) } : {}),
          ...(c.custoMaoDeObraCent !== undefined
            ? { custoMaoDeObraCent: Math.round(c.custoMaoDeObraCent) }
            : {}),
          ...(c.custoTerceirosCent !== undefined
            ? { custoTerceirosCent: Math.round(c.custoTerceirosCent) }
            : {}),
          ...(c.laudo !== undefined ? { laudo: c.laudo } : {}),
        });
        evento(o.id, x.usuario, x.de, x.para, x.nota);
        return { id: o.id, versao: o.versao };
      },
      corrigirOs: async (x) => {
        const o = s.os.find((y) => y.id === x.id);
        if (
          !o ||
          o.versao !== x.versaoVista ||
          o.situacao !== 'aberta' ||
          o.tecnico !== null ||
          o.assumidaEm !== null
        )
          throw desatualizado('A ordem de serviço');
        Object.assign(o, {
          versao: o.versao + 1,
          equipamento: x.equipamento,
          centroCusto: x.centroCusto,
          local: x.local,
          descricao: x.descricao,
          prioridadeSugerida: x.prioridadeSugerida,
          prioridade: x.prioridadeSugerida,
        });
        evento(o.id, x.usuario, 'aberta', 'aberta', x.nota);
        return { id: o.id, versao: o.versao };
      },
      incluirPlano: async (x) => {
        const id = novo();
        s.planos.push({
          id,
          versao: 1,
          equipamento: x.equipamento,
          atividade: x.atividade,
          periodicidade: { ...x.periodicidade },
          dataBase: x.dataBase,
          antecedenciaDias: x.antecedenciaDias,
          procedimento: x.procedimento,
          executor: x.executor,
          cobertura: x.executor === 'contrato' ? x.cobertura : null,
          ativo: true,
          modelo: x.modelo ? { ...x.modelo } : null,
        });
        return { id, versao: 1 };
      },
      ativarPlano: async (x) => {
        const p = s.planos.find((y) => y.id === x.id);
        if (!p || p.versao !== x.versaoVista) throw desatualizado('O plano de manutenção');
        p.ativo = x.ativo;
        p.versao += 1;
        return { id: p.id, versao: p.versao };
      },
      alterarPlano: async (x) => {
        const p = s.planos.find((y) => y.id === x.id);
        if (!p || p.versao !== x.versaoVista || !p.ativo) throw desatualizado('O plano de manutenção');
        s.versoesPlano.push({
          plano: p.id,
          versao: p.versao,
          periodicidade: { ...p.periodicidade },
          dataBase: p.dataBase,
          antecedenciaDias: p.antecedenciaDias,
          procedimento: p.procedimento,
          executor: p.executor,
          cobertura: p.cobertura,
          motivo: x.motivo,
          por: login(x.usuario),
          em: this.relogioFn().agora,
        });
        p.periodicidade = { ...x.periodicidade };
        p.dataBase = x.dataBase;
        p.antecedenciaDias = x.antecedenciaDias;
        p.procedimento = x.procedimento;
        p.executor = x.executor;
        p.cobertura = x.executor === 'contrato' ? x.cobertura : null;
        p.versao += 1;
        return { id: p.id, versao: p.versao };
      },
      registrarExecucao: async (x) => {
        const p = s.planos.find((y) => y.id === x.plano);
        if (!p || p.versao !== x.versaoVista || !p.ativo) throw desatualizado('O plano de manutenção');
        p.versao += 1;
        const id = novo();
        s.execucoes.push({
          id,
          plano: x.plano,
          data: x.data,
          resultado: x.resultado,
          laudo: x.laudo,
          certificadoPadrao: x.certificadoPadrao,
          observacao: x.observacao,
          osCorretiva: x.osCorretiva,
          por: login(x.usuario),
          em: this.relogioFn().agora,
        });
        return { id, versaoPlano: p.versao };
      },
      incluirCobertura: async (x) => {
        if (s.coberturas.some((c) => c.fornecedor === x.fornecedor && c.numero === x.numero))
          throw recusa(
            'contrato-repetido',
            'Este fornecedor já tem contrato de manutenção com este número.',
            {
              campos: ['numero'],
            },
          );
        const id = novo();
        s.coberturas.push({
          id,
          versao: 1,
          fornecedor: x.fornecedor,
          numero: x.numero,
          cobertura: x.cobertura,
          inicio: x.inicio,
          fim: x.fim,
          slaHoras: x.slaHoras,
          valorMensalCent: x.valorMensalCent,
          contrato: x.contrato,
          ativa: true,
          equipamentos: [...new Set(x.equipamentos)],
          encerradaEm: null,
          motivoEncerramento: null,
        });
        return { id, versao: 1 };
      },
      planosAtivosDoContrato: async (cob, eqs) =>
        s.planos.filter((p) => p.ativo && p.cobertura === cob && (!eqs || eqs.includes(p.equipamento)))
          .length,
      alterarCobertura: async (x) => {
        const c = s.coberturas.find((y) => y.id === x.id);
        if (!c || c.versao !== x.versaoVista || !c.ativa) throw desatualizado('O contrato de manutenção');
        retratarCobertura(c, 'alteracao', x.motivo, x.usuario);
        const antes = [...c.equipamentos];
        const depois = [...new Set(x.equipamentos)];
        c.inicio = x.inicio;
        c.fim = x.fim;
        c.slaHoras = x.slaHoras;
        c.valorMensalCent = x.valorMensalCent;
        c.equipamentos = [...depois].sort((a, b) => a - b);
        c.versao += 1;
        return {
          id: c.id,
          versao: c.versao,
          retirados: antes.filter((q) => !depois.includes(q)),
          incluidos: depois.filter((q) => !antes.includes(q)),
        };
      },
      encerrarCobertura: async (x) => {
        const c = s.coberturas.find((y) => y.id === x.id);
        if (!c || c.versao !== x.versaoVista || !c.ativa) throw desatualizado('O contrato de manutenção');
        retratarCobertura(c, 'encerramento', x.motivo, x.usuario);
        c.ativa = false;
        c.encerradaEm = x.data;
        c.motivoEncerramento = x.motivo;
        c.versao += 1;
        return { id: c.id, versao: c.versao };
      },
      excluirCobertura: async (x) => {
        const c = s.coberturas.find((y) => y.id === x.id);
        if (!c || c.versao !== x.versaoVista) throw desatualizado('O contrato de manutenção');
        const grupos = [
          {
            rotulo: 'Ordens de serviço da manutenção',
            ids: s.os.filter((o) => o.cobertura === c.id).map((o) => o.id),
            origem: 'fk' as const,
          },
          {
            rotulo: 'Planos de manutenção',
            ids: s.planos.filter((p) => p.cobertura === c.id).map((p) => p.id),
            origem: 'fk' as const,
          },
          {
            rotulo: 'Versões anteriores de planos de manutenção',
            ids: s.versoesPlano.filter((v) => v.cobertura === c.id).map((v) => v.plano),
            origem: 'logica' as const,
          },
        ].filter((g) => g.ids.length > 0);
        if (grupos.length > 0) {
          const total = grupos.reduce((t, g) => t + g.ids.length, 0);
          throw recusa(
            'com-dependentes',
            `O contrato de manutenção tem ${total} ${total === 1 ? 'registro dependente' : 'registros dependentes'}: ${grupos
              .map((g) => `${g.ids.length} ${g.ids.length === 1 ? 'registro' : 'registros'} em ${g.rotulo}`)
              .join('; ')}. Encerre o contrato com motivo em vez de excluir.`,
            {
              dependentes: grupos.map((g) => ({
                rotulo: g.rotulo,
                quantidade: g.ids.length,
                amostra: g.ids.slice(0, 5).map(String),
                origem: g.origem,
              })),
              podeInativar: true,
            },
          );
        }
        s.coberturas = s.coberturas.filter((y) => y.id !== c.id);
        s.versoesCobertura = s.versoesCobertura.filter((v) => v.cobertura !== c.id);
        return { id: c.id, versao: c.versao };
      },
      avisar: async (a) => {
        if (
          s.avisos.some(
            (x) => mesmo(x.login, a.login) && x.evento === a.evento && x.objetoChave === a.objetoChave,
          )
        )
          return null;
        const id = novo();
        s.avisos.push({ ...a, id });
        return id;
      },
      incluirAlerta: async (x) => {
        const r = x.conferir();
        if (r) throw recusaAlerta(r);
        numeroLivre(x.numero, null);
        const id = novo();
        s.alertas.push({
          id,
          ...camposAlerta(x),
          origem: 'manual',
          situacao: 'aberto',
          encerradoEm: null,
          encerradoPor: null,
          motivo: null,
          versao: 1,
          criadoPor: login(x.usuario),
          criadoEm: this.relogioFn().agora,
        });
        return { id, versao: 1 };
      },
      alterarAlerta: async (x) => {
        const antes = this.alertaLido(s, x.id);
        if (!antes) throw recusaAlerta('desatualizado');
        const r = x.conferir(antes);
        if (r) throw recusaAlerta(r);
        const a = alertaPelaVersao(x.id, x.versaoVista);
        if (a.situacao !== 'aberto') throw recusaAlerta('desatualizado');
        numeroLivre(x.numero, x.id);
        Object.assign(a, camposAlerta(x), { versao: a.versao + 1 });
        return { id: a.id, versao: a.versao, antes };
      },
      encerrarAlerta: async (x) => {
        const atual = s.alertas.find((y) => y.id === x.id);
        if (!atual) throw recusaAlerta('desatualizado');
        if (atual.situacao === 'encerrado') throw recusaAlerta('alerta-encerrado');
        const a = alertaPelaVersao(x.id, x.versaoVista);
        Object.assign(a, {
          situacao: 'encerrado' as SituacaoAlertaEquipamento,
          encerradoEm: this.relogioFn().agora,
          encerradoPor: login(x.usuario),
          motivo: x.motivo.slice(0, 500),
          versao: a.versao + 1,
        });
        return { id: a.id, versao: a.versao };
      },
      excluirAlerta: async (x) => {
        const a = alertaPelaVersao(x.id, x.versaoVista);
        const grupos = [
          {
            rotulo: 'OS de ação de campo do alerta',
            ids: s.acoesAlerta.filter((q) => q.alerta === a.id).map((q) => q.os),
            origem: 'fk' as const,
          },
          {
            rotulo: 'Queixas técnicas da vigilância de produto',
            ids: s.queixasOs
              .filter((k) => k.alerta !== null && mesmo(k.alerta, a.numero))
              .map((k) => k.queixa),
            origem: 'logica' as const,
          },
        ].filter((q) => q.ids.length > 0);
        if (grupos.length > 0) {
          const total = grupos.reduce((t, q) => t + q.ids.length, 0);
          throw recusa(
            'com-dependentes',
            `O alerta tem ${total} ${total === 1 ? 'registro dependente' : 'registros dependentes'}: ${grupos
              .map((q) => `${q.ids.length} ${q.ids.length === 1 ? 'registro' : 'registros'} em ${q.rotulo}`)
              .join('; ')}. Encerre o alerta com motivo em vez de excluir.`,
            {
              dependentes: grupos.map((q) => ({
                rotulo: q.rotulo,
                quantidade: q.ids.length,
                amostra: q.ids.slice(0, 5).map(String),
                origem: q.origem,
              })),
              podeInativar: true,
            },
          );
        }
        s.alertas = s.alertas.filter((y) => y.id !== a.id);
        return { id: a.id, versao: a.versao };
      },
      gerarAcaoDeCampo: async (x) => {
        const alerta = this.alertaLido(s, x.id);
        if (!alerta) throw recusaAlerta('desatualizado');
        const p = x.planejar(alerta, this.parqueDoAlertaLido(s, x.id), this.acoesDoAlertaLidas(s, x.id));
        if (!p.ok) throw recusaAlerta(p.motivo);
        const geradas: { equipamento: number; os: number; numero: string }[] = [];
        for (const q of p.equipamentos) {
          const os = await g.abrirOs({
            natureza: 'inspecao',
            equipamento: q.equipamento,
            centroCusto: q.centroCusto,
            local: null,
            descricao: q.descricao,
            contato: null,
            prioridadeSugerida: x.prioridade,
            prioridade: x.prioridade,
            solicitante: x.usuario,
            registro: x.registro,
            parado: false,
            plano: null,
            nota: `Ação de campo do alerta ${alerta.numero}.`,
          });
          s.acoesAlerta.push({
            alerta: x.id,
            equipamento: q.equipamento,
            os: os.id,
            por: login(x.usuario),
            em: this.relogioFn().agora,
          });
          geradas.push({ equipamento: q.equipamento, os: os.id, numero: os.numero });
        }
        const a = alertaPelaVersao(x.id, x.versaoVista);
        a.versao += 1;
        return { versao: a.versao, geradas };
      },
      abrirQueixaDaOs: async (x) => {
        const o = s.os.find((y) => y.id === x.os);
        if (!o) throw recusa('desatualizado', 'A OS não foi encontrada.');
        if (o.equipamento === null) throw recusaAlerta('os-sem-equipamento');
        if (s.queixasOs.some((k) => k.os === x.os)) throw recusaAlerta('queixa-ja-aberta');
        const acao = s.acoesAlerta.find((q) => q.os === x.os);
        const numero = acao ? (s.alertas.find((a) => a.id === acao.alerta)?.numero ?? null) : null;
        const queixa = novo();
        s.queixasOs.push({ os: x.os, queixa, alerta: numero });
        return { id: queixa, versao: 1, os: x.os };
      },
      cursoDoModelo: async (id) => this.cursoDoModeloLido(s, id),
      vincularCursoModelo: async (x) => {
        const c = CURSOS_SINTETICOS_MANUTENCAO.find((y) => y.id === x.curso);
        if (!c?.ativo) throw recusaCicloVida('curso-inativo');
        if (
          s.cursosModelo.some(
            (y) => y.fabricante === x.fabricante && y.modelo === x.modelo && y.curso === x.curso,
          )
        )
          throw recusaCicloVida('vinculo-repetido');
        const id = novo();
        s.cursosModelo.push({
          id,
          fabricante: x.fabricante.slice(0, 60),
          modelo: x.modelo.slice(0, 60),
          curso: x.curso,
          cursoCodigo: c.codigo,
          cursoTitulo: c.titulo,
          cursoAtivo: c.ativo,
          validadeMeses: c.validadeMeses,
          criadoPor: login(x.usuario),
          criadoEm: this.relogioFn().agora,
        });
        return { id };
      },
      desvincularCursoModelo: async (x) => {
        if (!s.cursosModelo.some((y) => y.id === x.id)) throw recusaCicloVida('desatualizado');
        s.cursosModelo = s.cursosModelo.filter((y) => y.id !== x.id);
        return { id: x.id };
      },
      eventosCiclo: async (eq) => this.eventosCicloLidos(s, eq),
      registrarEventoCiclo: async (x) => {
        const eq = s.equipamentos.find((y) => y.id === x.equipamento);
        if (!eq) throw recusaCicloVida('desatualizado');
        if (x.tipo === 'descarte' && (!x.documento || !x.destino))
          throw recusaCicloVida('descarte-incompleto');
        const { hoje, agora } = this.relogioFn();
        const r = x.conferir(this.eventosCicloLidos(s, x.equipamento), hoje);
        if (r) throw recusaCicloVida(r);
        const id = novo();
        s.eventosCiclo.push({
          id,
          equipamento: x.equipamento,
          tipo: x.tipo,
          data: x.data,
          motivo: x.motivo.slice(0, 500),
          documento: x.documento?.slice(0, 60) ?? null,
          destino: x.tipo === 'descarte' ? x.destino : null,
          valorContabilCent: null,
          valorObtidoCent: x.valorObtidoCent,
          autorizadoPor: x.autorizadoPor.slice(0, 70),
          por: login(x.usuario),
          em: agora,
        });
        if (x.tipo === 'desativacao' && eq.situacao !== 'desativado')
          Object.assign(eq, {
            situacao: 'desativado',
            desativadoEm: x.data,
            motivo: x.motivo.slice(0, 400),
            versao: eq.versao + 1,
          });
        return { id, valorContabilCent: null };
      },
    };
    return g;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async relogio() {
    return this.relogioFn();
  }

  async setores() {
    return SETORES_SINTETICOS_MANUTENCAO.map((x) => ({ ...x }));
  }

  async unidades() {
    return UNIDADES_SINTETICAS_MANUTENCAO.map((x) => ({ ...x }));
  }

  async recursos(_c: ContextoPortaM18, tipo: TipoRecursoAgenda) {
    if (!CODIGOS_TIPO_RECURSO_AGENDA.includes(tipo)) return [];
    return RECURSOS_SINTETICOS_MANUTENCAO.filter((r) => r.tipo === tipo).map((r) => ({ ...r }));
  }

  async recurso(_c: ContextoPortaM18, tipo: TipoRecursoAgenda, id: number) {
    return RECURSOS_SINTETICOS_MANUTENCAO.find((r) => r.tipo === tipo && r.id === id) ?? null;
  }

  async nomesDosUsuarios(_c: ContextoPortaM18, logins: readonly string[]) {
    return [...new Set(logins.map(login))].filter(Boolean).map((l) => ({ login: l, nome: `Usuário ${l}` }));
  }

  async fornecedores(_c: ContextoPortaM18, termo: string) {
    const t = termo.trim().toUpperCase();
    return FORNECEDORES_SINTETICOS_MANUTENCAO.filter(
      (f) => !t || String(f.codigo) === t || f.nome.toUpperCase().includes(t),
    ).map((f) => ({ ...f }));
  }

  async nomesDosFornecedores(_c: ContextoPortaM18, codigos: readonly number[]) {
    return FORNECEDORES_SINTETICOS_MANUTENCAO.filter((f) => codigos.includes(f.codigo)).map((f) => ({
      ...f,
    }));
  }

  async equipamentos(c: ContextoPortaM18, f: FiltroEquipamentos) {
    const s = this.e(c);
    const termo = f.termo?.trim().toUpperCase();
    const limite = Math.max(1, f.limite ?? 50);
    const todos = s.equipamentos
      .filter(
        (e) =>
          (!termo ||
            e.codigo.toUpperCase().includes(termo) ||
            e.nome.toUpperCase().includes(termo) ||
            (e.numeroSerie ?? '').toUpperCase().includes(termo)) &&
          (f.centroCusto == null || e.centroCusto === f.centroCusto) &&
          (!f.tipo || e.tipo === f.tipo) &&
          (!f.criticidade || e.criticidade === f.criticidade) &&
          (!f.situacao || e.situacao === f.situacao) &&
          (!f.ids || f.ids.includes(e.id)) &&
          (f.antesDe == null || e.id < f.antesDe),
      )
      .sort((a, b) => b.id - a.id);
    const itens = todos.slice(0, limite).flatMap((e) => this.equipamentoLido(s, e.id) ?? []);
    return { itens, proxima: todos.length > limite ? (itens.at(-1)?.id ?? null) : null };
  }

  async equipamento(c: ContextoPortaM18, id: number) {
    return this.equipamentoLido(this.e(c), id);
  }

  async equipamentoPorCodigo(c: ContextoPortaM18, codigo: string) {
    const s = this.e(c);
    const e = s.equipamentos.find((x) => x.codigo === codigo.trim().toUpperCase());
    return e ? this.equipamentoLido(s, e.id) : null;
  }

  async ordens(c: ContextoPortaM18, f: FiltroOrdens) {
    const limite = Math.max(1, f.limite ?? 50);
    const todas = this.e(c)
      .os.filter(
        (o) =>
          (f.centroCusto == null || o.centroCusto === f.centroCusto) &&
          (f.equipamento == null || o.equipamento === f.equipamento) &&
          (!f.situacoes || f.situacoes.length === 0 || f.situacoes.includes(o.situacao)) &&
          (!f.natureza || o.natureza === f.natureza) &&
          (!f.prioridade || o.prioridade === f.prioridade) &&
          (!f.solicitante || mesmo(o.solicitante, f.solicitante)) &&
          (!f.restricao ||
            mesmo(o.solicitante, f.restricao.login) ||
            f.restricao.centros.includes(o.centroCusto)) &&
          (f.antesDe == null || o.id < f.antesDe),
      )
      .sort((a, b) => b.id - a.id);
    const itens = todas.slice(0, limite).map((o) => ({ ...o }));
    return { itens, proxima: todas.length > limite ? (itens.at(-1)?.id ?? null) : null };
  }

  async os(c: ContextoPortaM18, id: number) {
    const o = this.e(c).os.find((x) => x.id === id);
    return o ? { ...o } : null;
  }

  async alertas(c: ContextoPortaM18, f: { situacao?: SituacaoAlertaEquipamento | null } = {}) {
    const s = this.e(c);
    return s.alertas
      .filter((a) => !f.situacao || a.situacao === f.situacao)
      .sort((a, b) => (a.situacao === b.situacao ? b.id - a.id : a.situacao === 'aberto' ? -1 : 1))
      .map((a) => this.alertaLido(s, a.id) as AlertaEquipamento);
  }

  async alerta(c: ContextoPortaM18, id: number) {
    return this.alertaLido(this.e(c), id);
  }

  async acoesDoAlerta(c: ContextoPortaM18, alerta: number) {
    return this.acoesDoAlertaLidas(this.e(c), alerta);
  }

  async parqueDoAlerta(c: ContextoPortaM18, alerta: number) {
    return this.parqueDoAlertaLido(this.e(c), alerta);
  }

  async vinculosTecnovigDaOs(c: ContextoPortaM18, os: number) {
    const s = this.e(c);
    const acao = s.acoesAlerta.find((q) => q.os === os);
    const a = acao ? s.alertas.find((x) => x.id === acao.alerta) : undefined;
    return {
      queixa: s.queixasOs.find((k) => k.os === os)?.queixa ?? null,
      alerta: a ? { id: a.id, numero: a.numero } : null,
    };
  }

  private cursoDoModeloLido(s: Estado, id: number): CursoDoModelo | null {
    const x = s.cursosModelo.find((y) => y.id === id);
    return x ? { ...x } : null;
  }

  private eventosCicloLidos(s: Estado, equipamento: number): EventoCicloVida[] {
    return s.eventosCiclo
      .filter((x) => x.equipamento === equipamento)
      .sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id)
      .map((x) => ({ ...x }));
  }

  async cursosDosModelos(c: ContextoPortaM18, chave?: { fabricante: string; modelo: string }) {
    return this.e(c)
      .cursosModelo.filter((x) => !chave || (x.fabricante === chave.fabricante && x.modelo === chave.modelo))
      .sort(
        (a, b) =>
          a.fabricante.localeCompare(b.fabricante) ||
          a.modelo.localeCompare(b.modelo) ||
          a.cursoTitulo.localeCompare(b.cursoTitulo),
      )
      .map((x) => ({ ...x }));
  }

  async catalogoCursos() {
    return CURSOS_SINTETICOS_MANUTENCAO.map((x) => ({ ...x }));
  }

  async conclusoesDosCursos(_c: ContextoPortaM18, cursos: readonly number[]) {
    return CONCLUSOES_SINTETICAS_MANUTENCAO.filter((x) => cursos.includes(x.curso)).map((x) => ({ ...x }));
  }

  async eventosCiclo(c: ContextoPortaM18, equipamento: number) {
    return this.eventosCicloLidos(this.e(c), equipamento);
  }

  async baseObsolescencia(c: ContextoPortaM18, equipamento: number, desde: string) {
    const os = this.e(c).os.filter(
      (o) => o.equipamento === equipamento && o.situacao !== 'cancelada' && o.registro.slice(0, 10) >= desde,
    );
    return {
      custoCent: os.reduce((t, o) => t + o.custoPecasCent + o.custoMaoDeObraCent + o.custoTerceirosCent, 0),
      corretivas: os.filter((o) => o.natureza === 'corretiva').length,
    };
  }

  async eventos(c: ContextoPortaM18, os: number) {
    return this.e(c)
      .eventos.filter((x) => x.os === os)
      .map((x) => ({ id: x.id, em: x.em, ator: x.ator, de: x.de, para: x.para, nota: x.nota }));
  }

  async planos(c: ContextoPortaM18, f: { equipamento?: number | null; soAtivos?: boolean } = {}) {
    const s = this.e(c);
    return s.planos
      .filter(
        (p) =>
          (f.equipamento == null || p.equipamento === f.equipamento) && (f.soAtivos === false || p.ativo),
      )
      .flatMap((p) => this.plano(s, p.id) ?? []);
  }

  async execucoes(c: ContextoPortaM18, plano: number) {
    return this.e(c)
      .execucoes.filter((x) => x.plano === plano)
      .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)
      .map((x) => ({ ...x }));
  }

  async planoPorId(c: ContextoPortaM18, id: number) {
    return this.plano(this.e(c), id);
  }

  async versoesPlano(c: ContextoPortaM18, plano: number) {
    return this.e(c)
      .versoesPlano.filter((x) => x.plano === plano)
      .sort((a, b) => b.versao - a.versao)
      .map((x) => ({
        versao: x.versao,
        periodicidade: { ...x.periodicidade },
        dataBase: x.dataBase,
        antecedenciaDias: x.antecedenciaDias,
        procedimento: x.procedimento,
        executor: x.executor,
        cobertura: x.cobertura,
        motivo: x.motivo,
        por: x.por,
        em: x.em,
      }));
  }

  async coberturas(
    c: ContextoPortaM18,
    f: { equipamento?: number | null; ids?: readonly number[] | null } = {},
  ) {
    return this.e(c)
      .coberturas.filter(
        (x) =>
          (f.equipamento == null || x.equipamentos.includes(f.equipamento)) &&
          (!f.ids || f.ids.includes(x.id)),
      )
      .sort((a, b) => b.fim.localeCompare(a.fim) || b.id - a.id)
      .map((x) => ({ ...x }));
  }

  async versoesCobertura(c: ContextoPortaM18, cobertura: number): Promise<VersaoDaCobertura[]> {
    return this.e(c)
      .versoesCobertura.filter((x) => x.cobertura === cobertura)
      .sort((a, b) => b.versao - a.versao)
      .map((x) => ({
        versao: x.versao,
        operacao: x.operacao,
        inicio: x.inicio,
        fim: x.fim,
        slaHoras: x.slaHoras,
        valorMensalCent: x.valorMensalCent,
        equipamentos: [...x.equipamentos],
        motivo: x.motivo,
        por: x.por,
        em: x.em,
      }));
  }

  async ocorrencias(c: ContextoPortaM18, f: FiltroPeriodoPorta): Promise<OcorrenciasDoPeriodo> {
    const s = this.e(c);
    const eqs = s.equipamentos.filter(
      (e) =>
        (f.equipamento == null || e.id === f.equipamento) &&
        (f.centroCusto == null || e.centroCusto === f.centroCusto) &&
        (!f.criticidade || e.criticidade === f.criticidade),
    );
    const ids = new Set(eqs.map((e) => e.id));
    const fimExclusivo = `${f.fim}T23:59`;
    const validas = s.os.filter(
      (o) => o.situacao !== 'cancelada' && o.equipamento !== null && ids.has(o.equipamento),
    );
    return {
      equipamentos: eqs.map((e) => ({
        id: e.id,
        codigo: e.codigo,
        nome: e.nome,
        instalacao: e.instalacao,
        desativacao: e.desativadoEm,
      })),
      paradas: validas
        .filter(
          (o) =>
            o.paradaInicio !== null &&
            o.paradaInicio <= fimExclusivo &&
            (o.paradaFim === null || o.paradaFim >= `${f.inicio}T00:00`),
        )
        .map((o) => ({ equipamento: o.equipamento ?? 0, inicio: o.paradaInicio ?? '', fim: o.paradaFim })),
      corretivas: validas
        .filter(
          (o) =>
            o.natureza === 'corretiva' && o.registro >= `${f.inicio}T00:00` && o.registro <= fimExclusivo,
        )
        .map((o) => ({
          equipamento: o.equipamento ?? 0,
          registro: o.registro,
          causa: o.causa,
          inicioReparo: o.inicioReparo,
          fimReparo: o.fimReparo,
        })),
    };
  }
}
