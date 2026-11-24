// Porta do atendimento externo EM MEMÓRIA (M20): a sessão sintética de dev/ci (E2E) lê e grava fichas, contas, fila do
// consultório, quadro e observação do PA SINTÉTICOS, sem banco. As gravações aplicam o mesmo Zod das receitas
// (o Zod da operação) e as mesmas recusas (paciente inativo ou unificado, convênio inativo, senha já atendida ou de
// outro dia, conta fechada/apresentada/emitida no procedimento extra, colisão de versão, atendimento encerrado, ato
// médico sem médico, exclusão com conta fechada ou procedimento extra). A senha é a da recepção em memória (M19): a
// abertura a liga e põe em A; o consultório chama (C), atende (A) e libera (L) no mesmo fluxo. O relógio é o do
// estabelecimento (America/Sao_Paulo). Nenhum nome aqui é de pessoa real (marca "SINTETICO").
import {
  type AtendimentoDetalhe,
  type AtendimentoResumo,
  avisoContaSemLancamento,
  caraterLido,
  desfecho as desfechoDe,
  HERANCAS,
  permiteLancar,
  rotuloConta,
  rotuloTipoAte,
  situacaoDaConta,
  tipoAtendimento,
  type TipoAtendimento,
} from '@sgh/contratos';
import { versaoHeranca } from '@sgh/dominio-atendimento';
import { ErroOperacao, recusa, type ResultadoOperacao } from '@sgh/nucleo';
import type { ContextoGravacao, LiberacaoOperacao, PacienteFicha } from '../cadastro/tipos.js';
import type { EstadoCatalogo } from '../cadastro/porta.js';
import { ENTRADAS_OPERACOES_ATENDIMENTO } from './operacoes.js';
import {
  type ApoioAtendimentoDados,
  type AtendimentoPa,
  type EscorePaRegistrado,
  type IndicadoresDados,
  type ItemFila,
  type LeitoObservacao,
  type MarcacaoParaAbertura,
  type PreviaCancelamentoDados,
  type SinaisRecentes,
  termoDoDia,
} from './tipos.js';
import { relogioDoEstabelecimento } from '../recepcao/porta-memoria.js';
import type { PortaRecepcaoMemoria } from '../recepcao/porta-memoria.js';
import type {
  ContextoAtendimento,
  DadosImpresso,
  GravadorSghAtendimento,
  PortaAtendimento,
  ProfissionalDaSessao,
} from './porta.js';

const M = 'SINTETICO';
const ENCAMINHA_FATURAMENTO_ALTERAR =
  'A conta deste atendimento já está fechada, apresentada ou emitida: a correção que vai à conta é feita pelo faturamento (reabertura da conta). Encaminhe ao faturamento.';
const ENCAMINHA_FATURAMENTO_EXTRA =
  'O estorno com a conta fechada, apresentada ou emitida é feito pelo faturamento (reabertura da conta ou estorno na conta): encaminhe ao faturamento.';
const totalDaFicha = (f: { valor: number; extras: { valor: number }[] }) =>
  Math.round((f.valor + f.extras.reduce((t, x) => t + x.valor, 0)) * 100) / 100;

interface ExtraM {
  procedimento: number;
  nome: string;
  quantidade: number;
  valor: number;
  crm: number;
  seq: number;
  /** Data de realização (o item da conta). */
  data?: string;
}
interface FichaM {
  reg: number;
  cab: string;
  data: string;
  hora: string;
  inclusao: string;
  tipo: TipoAtendimento;
  tipoAte: number;
  lab: boolean;
  paciente: number;
  prontuario: number;
  nome: string;
  nascimento: string | null;
  convenio: number;
  plano: string;
  matricula: string;
  validadeCarteira: string | null;
  guia: string;
  senhaConvenio: string;
  validadeSenha: string | null;
  vinculo: number;
  crm: number;
  medico: string;
  especialidade: number;
  unidade: number;
  cdc: number;
  procedimento: number;
  valor: number;
  carater: number;
  senha: number | null;
  local: number | null;
  marcacao: number | null;
  versao: string;
  conta: { fechada: string; emitida: string } | null;
  itensConta: number;
  extras: ExtraM[];
  responsavel: { nome: string; parentesco: number; telefone: string } | null;
  desfecho: { codigo: string; em: string } | null;
  fila: { situacao: string; local: number; chamadas: number } | null;
  etapas: { etapa: string; em: string }[];
  ativo: boolean;
  /** Saída pela outra ponta sem desfecho do novo (o outro sistema simulado: liberado do local ou alta). */
  saidaOutro?: 'liberado' | 'alta' | null;
  /** W1-05: atos clínicos ou de faturamento ligados à ficha (o mapa de dependências do legado, simulado). */
  atos?: { rotulo: string; quantidade: number; amostra: string[] }[];
  /** W1-05: campos da correção da ficha sem leitura própria na memória (CID, solicitante, observação). */
  correcoes?: Record<string, unknown>;
}
interface MarcacaoM {
  id: number;
  data: string;
  hora: string;
  paciente: number;
  convenio: number;
  crm: number;
  especialidade: number;
  unidade: number;
  cdc: number;
  procedimento: number;
  retorno: boolean;
  registro: number;
}
interface ObservacaoM {
  id: number;
  cab: string;
  reg: number;
  leito: number;
  entrada: string;
  saida: string | null;
  /** W0-07: a alocação anterior (transferência de leito) e o motivo. */
  anterior?: number | null;
  motivoTransferencia?: string | null;
}
interface Estado {
  fichas: FichaM[];
  observacoes: ObservacaoM[];
  /** W0-07 (M1): os escores do PA (só inclusão; o estorno marca, nunca apaga). */
  escoresPa: EscorePaRegistrado[];
  impressos: { reg: number; impresso: string; formato: string }[];
  naoIdentificados: {
    paciente: number;
    prontuario: number;
    caracteristicas: string;
    marcadoEm: string;
    identificadoEm: string | null;
    destino: number | null;
  }[];
  marcacoes: MarcacaoM[];
  seqReg: number;
  seqCab: number;
  seq: number;
  idem: Map<string, ResultadoOperacao>;
  excluidas: number[];
  /** A configuração da herança do atendimento anterior (as marcas T/F, como a linha única da rede). */
  heranca: Record<string, boolean>;
}

const CONVENIOS = [
  { codigo: 306, nome: `CONVENIO EMPRESARIAL ${M}`, ativo: true },
  { codigo: 320, nome: `PLANO DE SAUDE ${M}`, ativo: true },
  { codigo: 10, nome: `PARTICULAR ${M}`, ativo: true },
  { codigo: 99, nome: `CONVENIO SUSPENSO ${M}`, ativo: false },
];
const PROFISSIONAIS = [
  { id: 7101, crm: 52001, nome: `ANA MEDICA ${M}`, especialidades: [15, 33], ativo: true, cbo: '225125' },
  {
    id: 7102,
    crm: 52002,
    nome: `CARLOS CARDIOLOGISTA ${M}`,
    especialidades: [9],
    ativo: true,
    cbo: '225120',
  },
  { id: 7103, crm: 0, nome: `LABORATORIO ${M}`, especialidades: [0], ativo: true, cbo: '221205' },
];
const ESPECIALIDADES = [
  { codigo: 9, nome: 'CARDIOLOGIA' },
  { codigo: 15, nome: 'CLINICA MEDICA' },
  { codigo: 33, nome: 'PEDIATRIA' },
];
const PROCEDIMENTOS = [
  { codigo: 10101012, nome: 'CONSULTA EM CONSULTORIO', valor: 120 },
  { codigo: 10101039, nome: 'CONSULTA EM PRONTO SOCORRO', valor: 150 },
  { codigo: 20101104, nome: 'AVALIACAO CLINICA DIARIA', valor: 45 },
  { codigo: 40301630, nome: 'HEMOGRAMA COMPLETO', valor: 12.5 },
  { codigo: 40302040, nome: 'GLICOSE', valor: 6.3 },
];
const CIDS = [
  { id: 1, codigo: 'R509', nome: 'FEBRE NAO ESPECIFICADA' },
  { id: 2, codigo: 'I10', nome: 'HIPERTENSAO ESSENCIAL' },
  { id: 3, codigo: 'J069', nome: 'INFECCAO AGUDA DAS VIAS AEREAS SUPERIORES' },
  { id: 4, codigo: 'Z000', nome: 'EXAME MEDICO GERAL' },
];
const SOLICITANTES = [
  { id: 501, nome: `DR SOLICITANTE UM ${M}`, registro: '52100' },
  { id: 502, nome: `DRA SOLICITANTE DOIS ${M}`, registro: '52200' },
];
const LEITOS = [
  ...[1, 2, 3, 4].map((i) => ({ id: i, codigo: `00${i}`, local: 'SALA OBSERVACAO', tipo: 'Leito' })),
  ...[1, 2].map((i) => ({ id: 10 + i, codigo: `P0${i}`, local: 'PRONTO ATENDIMENTO', tipo: 'Poltrona' })),
];
const LOCAIS = [
  { id: 2, descricao: 'RECEPCAO DO AMBULATORIO', recepcao: 2 },
  { id: 3, descricao: 'CONSULTORIO 01', recepcao: 2 },
  { id: 12, descricao: 'CONSULTORIO 02', recepcao: 2 },
  { id: 13, descricao: 'OBSERVACAO', recepcao: 2 },
];
const MOTIVOS_EXCLUSAO = [
  { codigo: 2, nome: 'CONTA CRIADA ERRADA' },
  { codigo: 7, nome: 'DESISTENCIA DO PACIENTE' },
];

const somarMin = (iso: string, m: number) => {
  const d = new Date(`${iso}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + m);
  return d.toISOString().slice(0, 19);
};
const minutosEntre = (a: string, b: string) =>
  Math.max(0, Math.floor((Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 60_000));

export class PortaAtendimentoMemoria implements PortaAtendimento {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, Estado>();

  constructor(
    private readonly catalogo: EstadoCatalogo,
    private readonly deps: {
      readonly lerPacientes?: (c: ContextoAtendimento, ids: readonly number[]) => Promise<PacienteFicha[]>;
      readonly recepcao?: PortaRecepcaoMemoria | null;
      readonly agora?: () => Date;
    } = {},
  ) {}

  private relogioAtual() {
    return relogioDoEstabelecimento(this.deps.agora?.() ?? new Date());
  }

  private e(c: ContextoAtendimento): Estado {
    return this.porHospitalDe(c.hospital);
  }

  /** Os dados sintéticos do estabelecimento (pelo código da sessão), semeados na primeira leitura. */
  private porHospitalDe(hospital: string): Estado {
    let s = this.estados.get(hospital);
    if (!s) {
      s = this.semente();
      this.estados.set(hospital, s);
    }
    return s;
  }

  /** O dia sintético de partida: uma consulta com a conta já fechada, um PA em observação, uma requisição. */
  private semente(): Estado {
    const r = this.relogioAtual();
    const s: Estado = {
      fichas: [],
      observacoes: [],
      escoresPa: [],
      impressos: [],
      naoIdentificados: [],
      // Um agendamento SINTÉTICO do dia (consulta de clínica médica): a abertura o preenche. Como na cópia (0 de 1.931
      // marcações atendidas com o conselho do profissional), o agendamento não traz o profissional: a recepção escolhe.
      marcacoes: [
        {
          id: 880_001,
          data: r.hoje,
          hora: '08:00',
          paciente: 1007,
          convenio: 306,
          crm: 0,
          especialidade: 15,
          unidade: 1,
          cdc: 300600,
          procedimento: 10101012,
          retorno: false,
          registro: 0,
        },
      ],
      seqReg: 900_100,
      seqCab: 5_000,
      seq: 1,
      idem: new Map(),
      excluidas: [],
      heranca: Object.fromEntries(
        HERANCAS.map((h) => [
          h.chave,
          ['fonte_pagadora', 'profissional', 'carteira', 'plano', 'clinica', 'validade_carteira'].includes(
            h.chave,
          ),
        ]),
      ),
    };
    const base = (o: Partial<FichaM> & Pick<FichaM, 'tipo' | 'paciente' | 'nome' | 'prontuario'>): FichaM => {
      const reg = ++s.seqReg;
      const def = tipoAtendimento(o.tipo);
      return {
        reg,
        cab: String(++s.seqCab),
        data: r.hoje,
        hora: r.agora.slice(11, 16),
        inclusao: somarMin(r.agora, -90),
        tipoAte: def?.tipoAte ?? 4,
        lab: def?.laboratorio ?? false,
        nascimento: '1980-03-15',
        convenio: 306,
        plano: 'PLANO SINTETICO',
        matricula: '900000000001',
        validadeCarteira: '2030-12-31',
        guia: String(reg),
        senhaConvenio: '',
        validadeSenha: null,
        vinculo: 7101,
        crm: 52001,
        medico: `ANA MEDICA ${M}`,
        especialidade: 15,
        unidade: 1,
        cdc: 300600,
        procedimento: 10101012,
        valor: 120,
        carater: 2,
        senha: null,
        local: null,
        marcacao: null,
        versao: `${r.hoje} 07:00:00.0000`,
        conta: { fechada: 'N', emitida: 'F' },
        itensConta: 1,
        extras: [],
        responsavel: null,
        desfecho: null,
        fila: null,
        etapas: [],
        ativo: true,
        ...o,
      };
    };
    s.fichas.push(
      base({
        tipo: 'consulta',
        paciente: 1004,
        nome: `ANTÔNIO CONCEIÇÃO ${M}`,
        prontuario: 901004,
        conta: { fechada: 'S', emitida: 'F' },
        fila: { situacao: 'aguardando', local: 3, chamadas: 0 },
      }),
    );
    const pa = base({
      tipo: 'pa',
      paciente: 1005,
      nome: `MARIA APARECIDA ${M}`,
      prontuario: 901005,
      procedimento: 10101039,
      valor: 150,
      carater: 3,
      unidade: 3,
      cdc: 300400,
    });
    pa.etapas = [
      { etapa: 'abertura', em: somarMin(r.agora, -120) },
      { etapa: 'chamada', em: somarMin(r.agora, -100) },
      { etapa: 'atendimentoMedico', em: somarMin(r.agora, -95) },
      { etapa: 'observacao', em: somarMin(r.agora, -60) },
    ];
    s.fichas.push(pa);
    s.observacoes.push({
      id: ++s.seq,
      cab: pa.cab,
      reg: pa.reg,
      leito: 1,
      entrada: somarMin(r.agora, -60),
      saida: null,
    });
    // Um PA aberto e liberado do local pelo outro sistema simulado (sem desfecho no novo): fora das colunas do quadro.
    s.fichas.push(
      base({
        tipo: 'pa',
        paciente: 1002,
        nome: `JOSÉ DA SILVA ${M}`,
        prontuario: 901002,
        procedimento: 10101039,
        valor: 150,
        carater: 3,
        unidade: 3,
        cdc: 300400,
        saidaOutro: 'liberado',
      }),
    );
    s.fichas.push(
      base({
        tipo: 'requisicaoLab',
        paciente: 1003,
        nome: `CINTHYA GABRIELLA VIANNA ${M}`,
        prontuario: 901003,
        especialidade: 0,
        vinculo: 7103,
        crm: 0,
        medico: `LABORATORIO ${M}`,
        procedimento: 40301630,
        valor: 0,
        cdc: 300500,
        unidade: 2,
      }),
    );
    return s;
  }

  /** A sessão sintética não tem configuração de fichas: vale a ficha padrão. */
  async fichasConfiguradas(): Promise<null> {
    return null;
  }

  async podeGravar(_c: ContextoAtendimento, op: string): Promise<LiberacaoOperacao> {
    const estado = this.catalogo.estado(op, _c.hospital);
    if (estado === null || estado === 'bloqueada')
      return { pode: false, codigo: 'operacao-bloqueada', motivo: 'A operação está bloqueada.' };
    return { pode: true, codigo: null, motivo: null };
  }

  private ficha(s: Estado, reg: number): FichaM {
    const f = s.fichas.find((x) => x.reg === reg && x.ativo);
    if (!f)
      throw new ErroOperacao(
        404,
        'atendimento-inexistente',
        'Atendimento não encontrado',
        'O atendimento não existe mais.',
      );
    return f;
  }

  private carimbo(): string {
    const a = this.relogioAtual().agora;
    return `${a.slice(0, 10)} ${a.slice(11, 19)}.${String(Date.now() % 10_000).padStart(4, '0')}`;
  }

  async executar(c: ContextoAtendimento, op: string, entradaBruta: unknown, ctx: ContextoGravacao) {
    const s = this.e(c);
    const chave = `${op}:${ctx.chaveIdempotencia}`;
    const ja = s.idem.get(chave);
    if (ja) return { resultado: ja, repetida: true, trilha: null };
    const esquema = ENTRADAS_OPERACOES_ATENDIMENTO[op];
    if (!esquema)
      throw new ErroOperacao(
        400,
        'operacao-desconhecida',
        'Operação desconhecida',
        `A operação ${op} não existe.`,
      );
    const analise = esquema.safeParse(entradaBruta);
    if (!analise.success)
      throw new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', {
        campos: [...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)'))],
      });
    const resultado = await this.aplicar(
      c,
      s,
      op,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a entrada já validada pelo Zod da receita
      analise.data as Record<string, any>,
      ctx.login ?? String(ctx.usuario ?? ''),
    );
    s.idem.set(chave, resultado);
    return { resultado, repetida: false, trilha: null };
  }

  private async aplicar(
    c: ContextoAtendimento,
    s: Estado,
    op: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    e: Record<string, any>,
    login: string,
  ): Promise<ResultadoOperacao> {
    const r = this.relogioAtual();
    switch (op) {
      case 'atendimento.abrirAtendimento': {
        const def = tipoAtendimento(e['tipo']);
        if (!def) throw recusa('tipo-desconhecido', 'Tipo de atendimento desconhecido.');
        const [p] = (await this.deps.lerPacientes?.(c, [e['paciente']])) ?? [];
        if (!p)
          throw new ErroOperacao(
            404,
            'paciente-inexistente',
            'Paciente não encontrado',
            'O cadastro do paciente não existe mais.',
          );
        if (!p.ativo)
          throw recusa('paciente-inativo', 'O cadastro do paciente está inativo.', { campos: ['paciente'] });
        if (p.unificadoEm && p.unificadoEm !== p.id)
          throw recusa(
            'paciente-unificado',
            'Este cadastro foi unificado em outro: abra o atendimento no cadastro que ficou.',
            {
              campos: ['paciente'],
            },
          );
        const conv = CONVENIOS.find((x) => x.codigo === e['convenio']);
        if (!conv) throw recusa('convenio-inexistente', 'O convênio não existe.', { campos: ['convenio'] });
        if (!conv.ativo)
          throw recusa('convenio-inativo', 'O convênio não está ativo para atendimento.', {
            campos: ['convenio'],
          });
        const prof = PROFISSIONAIS.find((x) => x.id === e['profissional']);
        if (!prof)
          throw recusa('profissional-inexistente', 'O profissional não está mais no cadastro.', {
            campos: ['profissional'],
          });
        if (e['senha']) {
          const sen = this.deps.recepcao?.senhaParaAtendimento(c, e['senha']) ?? null;
          if (!sen) throw recusa('senha-inexistente', 'A senha não existe mais.', { campos: ['senha'] });
          if (sen.atendida || s.fichas.some((x) => x.ativo && x.senha === e['senha']))
            throw recusa('senha-ja-atendida', 'A senha já tem atendimento aberto.', { campos: ['senha'] });
          if (!sen.hoje) throw recusa('senha-de-outro-dia', 'A senha não é de hoje.', { campos: ['senha'] });
          if (!['G', 'C', 'S'].includes(sen.situacao))
            throw recusa('senha-concluida', 'A senha já foi concluída ou está em atendimento.', {
              campos: ['senha'],
            });
        }
        const marc = e['marcacao'] ? s.marcacoes.find((m) => m.id === e['marcacao']) : undefined;
        if (e['marcacao']) {
          if (!marc)
            throw recusa('marcacao-inexistente', 'O agendamento não existe mais.', { campos: ['marcacao'] });
          if (marc.data !== r.hoje)
            throw recusa('marcacao-de-outro-dia', 'O agendamento não é de hoje.', { campos: ['marcacao'] });
          if (marc.registro > 0)
            throw recusa('marcacao-ja-atendida', 'O agendamento já tem atendimento aberto.', {
              campos: ['marcacao'],
            });
          if (marc.paciente !== p.id)
            throw recusa('marcacao-de-outro-paciente', 'O agendamento é de outro paciente.', {
              campos: ['marcacao'],
            });
        }
        const procedimento = PROCEDIMENTOS.find((x) => x.codigo === e['procedimento']);
        const lab = def.laboratorio;
        const reg = ++s.seqReg;
        const f: FichaM = {
          reg,
          cab: String(++s.seqCab),
          data: r.hoje,
          hora: r.agora.slice(11, 16),
          inclusao: r.agora,
          tipo: def.codigo,
          tipoAte: def.tipoAte,
          lab,
          paciente: p.id,
          prontuario: p.prontuario,
          nome: p.nome,
          nascimento: p.nascimento,
          convenio: conv.codigo,
          plano: e['plano'] || conv.nome,
          matricula: e['matricula'] ?? '',
          validadeCarteira: e['validadeCarteira'] ?? null,
          guia: e['guia'] || String(reg),
          senhaConvenio: e['senhaConvenio'] ?? '',
          validadeSenha: e['validadeSenha'] ?? null,
          vinculo: prof.id,
          crm: prof.crm,
          medico: prof.nome,
          especialidade: lab ? 0 : e['especialidade'],
          unidade: e['unidade'],
          cdc: e['centroCusto'],
          procedimento: e['procedimento'],
          valor: lab ? 0 : Math.round((procedimento?.valor ?? 0) * (e['horarioEspecial'] ? 130 : 100)) / 100,
          carater: e['carater'] === 'urgencia' ? 3 : 2,
          senha: e['senha'] ?? null,
          local: e['local'] ?? null,
          marcacao: e['marcacao'] ?? null,
          versao: this.carimbo(),
          conta: conv.codigo > 1 ? { fechada: 'N', emitida: 'F' } : null,
          itensConta: conv.codigo > 1 && e['procedimento'] ? 1 : 0,
          extras: [],
          responsavel: e['responsavel']
            ? {
                nome: e['responsavel'].nome,
                parentesco: e['responsavel'].parentesco,
                telefone: e['responsavel'].telefone ?? '',
              }
            : null,
          desfecho: null,
          fila: e['senha'] ? null : { situacao: 'aguardando', local: e['local'] ?? 3, chamadas: 0 },
          etapas: def.codigo === 'pa' ? [{ etapa: 'abertura', em: r.agora }] : [],
          ativo: true,
        };
        if (e['senha']) this.deps.recepcao?.atenderSenha(c, e['senha'], e['local'], login);
        if (marc) marc.registro = reg;
        s.fichas.push(f);
        return { reg, cabecalho: f.cab, tipo: f.tipo, senha: f.senha ?? 0, marcacao: f.marcacao ?? 0 };
      }
      case 'atendimento.alterarSegurado': {
        const f = this.ficha(s, e['atendimento']);
        if (f.versao.slice(0, 19) !== String(e['versao']).slice(0, 19))
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Registro alterado no outro sistema',
            'O registro foi alterado no outro sistema desde a leitura. Releia e confira antes de salvar.',
            {
              colunas: ['DATA_HORA_ULTIMA_ATUALIZACAO'],
            },
          );
        if (e['matricula'] !== undefined) f.matricula = e['matricula'];
        if (e['validadeCarteira'] !== undefined) f.validadeCarteira = e['validadeCarteira'];
        if (e['guia'] !== undefined) f.guia = e['guia'] || String(f.reg);
        if (e['senhaConvenio'] !== undefined) f.senhaConvenio = e['senhaConvenio'];
        if (e['validadeSenha'] !== undefined) f.validadeSenha = e['validadeSenha'];
        if (e['plano'] !== undefined) f.plano = e['plano'];
        f.versao = this.carimbo();
        return { reg: f.reg, cabecalho: f.cab };
      }
      case 'atendimento.lancarProcedimentoExtra': {
        const f = this.ficha(s, e['atendimento']);
        if (f.lab)
          throw recusa(
            'requisicao-sem-extra',
            'A requisição de laboratório não recebe procedimento extra pela recepção.',
          );
        const situacao = situacaoDaConta(f.conta);
        const aviso = avisoContaSemLancamento(situacao);
        if (aviso)
          throw recusa(situacao === 'semConta' ? 'atendimento-sem-conta' : `conta-${situacao}`, aviso);
        const proc = PROCEDIMENTOS.find((x) => x.codigo === e['procedimento']);
        if (!proc)
          throw recusa(
            'procedimento-fora-da-tabela',
            'O procedimento não está na tabela do convênio do atendimento.',
            {
              campos: ['procedimento'],
            },
          );
        const seq = f.extras.length + 1;
        f.extras.push({
          procedimento: proc.codigo,
          nome: proc.nome,
          quantidade: e['quantidade'],
          valor: Math.round(proc.valor * e['quantidade'] * 100) / 100,
          crm: f.crm,
          seq,
        });
        f.itensConta++;
        return { reg: f.reg, seq, procedimento: proc.codigo, quantidade: e['quantidade'], conta: 1 };
      }
      case 'atendimento.conduzirNoConsultorio': {
        const f = this.ficha(s, e['atendimento']);
        if (f.desfecho) throw recusa('atendimento-encerrado', 'O atendimento já foi encerrado.');
        if (f.senha) {
          const sen = this.deps.recepcao?.senhaParaAtendimento(c, f.senha);
          if (sen && sen.situacao !== 'A' && sen.situacao !== 'C')
            throw recusa('situacao-mudou', 'A senha do atendimento não está em atendimento.');
          if (e['evento'] === 'atender' && sen?.situacao !== 'C')
            throw recusa('paciente-nao-chamado', 'Chame o paciente antes de iniciar o atendimento.');
          this.deps.recepcao?.eventoDoConsultorio(
            c,
            f.senha,
            e['evento'] === 'chamar' ? 'C' : 'A',
            e['local'],
            login,
          );
        } else {
          f.fila = {
            situacao: e['evento'] === 'chamar' ? 'chamado' : 'emAtendimento',
            local: e['local'],
            chamadas: (f.fila?.chamadas ?? 0) + (e['evento'] === 'chamar' ? 1 : 0),
          };
        }
        if (f.tipo === 'pa')
          f.etapas.push({ etapa: e['evento'] === 'chamar' ? 'chamada' : 'atendimentoMedico', em: r.agora });
        return { reg: f.reg, cabecalho: f.cab, senha: f.senha ?? 0, evento: e['evento'] };
      }
      case 'atendimento.encerrarAtendimento': {
        const f = this.ficha(s, e['atendimento']);
        const d = desfechoDe(e['desfecho']);
        if (!d) throw recusa('desfecho-desconhecido', 'Desfecho desconhecido.');
        if (d.atoMedico) {
          const p = await this.profissional(c, login);
          if (!p || p.vinculo !== e['profissional'])
            throw recusa(
              'profissional-sem-cbo',
              'Só o profissional com ocupação ativa no cadastro registra no prontuário.',
              {
                campos: ['cbo'],
              },
            );
          if (!p.codigoCbo.startsWith('225'))
            throw recusa(
              'categoria-nao-permitida',
              `Só médico pode registrar ${d.rotulo.toLowerCase()} (Lei 12.842/2013).`,
              {
                campos: ['cbo'],
              },
            );
        }
        if (f.desfecho) throw recusa('atendimento-encerrado', 'O atendimento já tem desfecho registrado.');
        if (f.senha) {
          const ult = this.deps.recepcao?.ultimoFluxo(c, f.senha);
          this.deps.recepcao?.eventoDoConsultorio(c, f.senha, 'L', e['local'] ?? ult?.local ?? 3, login);
        }
        f.desfecho = { codigo: d.codigo, em: r.agora };
        if (f.fila) f.fila = { ...f.fila, situacao: 'liberado' };
        if (f.tipo === 'pa')
          f.etapas.push({ etapa: 'decisao', em: r.agora }, { etapa: 'saida', em: r.agora });
        for (const o of s.observacoes) if (o.reg === f.reg && !o.saida) o.saida = r.agora;
        return { reg: f.reg, cabecalho: f.cab, senha: f.senha ?? 0, desfecho: d.codigo };
      }
      case 'atendimento.cancelarAtendimento': {
        const f = this.ficha(s, e['atendimento']);
        const previa = this.previaDe(f);
        if (!previa.pode)
          throw recusa('exclusao-recusada', previa.motivo ?? 'Exclusão recusada.', {
            ...(previa.dependentes ? { dependentes: previa.dependentes } : {}),
          });
        f.ativo = false;
        s.excluidas.push(f.reg);
        // D-EXC-AGE-20 (regra única de volta da marcação): a marcação volta a não atendida.
        const marc = f.marcacao ? s.marcacoes.find((m) => m.id === f.marcacao) : undefined;
        if (marc) marc.registro = 0;
        if (f.senha) this.deps.recepcao?.desfazerAtendimentoDaSenha(c, f.senha);
        return { reg: f.reg, cabecalho: f.cab, senha: f.senha ?? 0, motivo: e['motivo'] };
      }
      case 'atendimento.alterarAtendimento': {
        const f = this.ficha(s, e['atendimento']);
        if (f.versao.slice(0, 19) !== String(e['versao']).slice(0, 19))
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Registro alterado no outro sistema',
            'O registro foi alterado no outro sistema desde a leitura. Releia e confira antes de salvar.',
            { colunas: ['DATA_HORA_ULTIMA_ATUALIZACAO'] },
          );
        const prof =
          e['profissional'] !== undefined ? PROFISSIONAIS.find((p) => p.id === e['profissional']) : undefined;
        if (e['profissional'] !== undefined && (!prof || !prof.ativo))
          throw recusa('profissional-inativo', 'O profissional está inativo.', { campos: ['profissional'] });
        const conv =
          e['convenio'] !== undefined ? CONVENIOS.find((x) => x.codigo === e['convenio']) : undefined;
        if (e['convenio'] !== undefined && (!conv || !conv.ativo))
          throw recusa('convenio-inativo', 'O convênio está inativo.', { campos: ['convenio'] });
        const mudaConv = conv !== undefined && conv.codigo !== f.convenio;
        const mudaProc = e['procedimento'] !== undefined && e['procedimento'] !== f.procedimento;
        const mudaProf = prof !== undefined && prof.id !== f.vinculo;
        const mudaEsp = e['especialidade'] !== undefined && e['especialidade'] !== f.especialidade;
        const outros = ['cidPrincipal', 'cidSecundario', 'solicitante', 'observacao'].filter(
          (k) => e[k] !== undefined && e[k] !== f.correcoes?.[k],
        );
        const carater = e['carater'] !== undefined ? (e['carater'] === 'urgencia' ? 3 : 2) : f.carater;
        const mudaCar = carater !== f.carater;
        if (
          !mudaConv &&
          !mudaProc &&
          !mudaProf &&
          !mudaEsp &&
          !mudaCar &&
          !outros.length &&
          !e['responsavel']
        )
          throw recusa('nada-a-alterar', 'Os valores informados são os já gravados.');
        if (mudaConv && f.convenio <= 1 !== conv.codigo <= 1)
          throw recusa(
            'troca-de-conta',
            'A troca entre SUS e convênio muda a conta do atendimento: exclua a ficha (sem atos) e abra de novo.',
            { campos: ['convenio'] },
          );
        const situacao = f.conta && f.convenio > 1 ? situacaoDaConta(f.conta) : 'semConta';
        const vaiAConta = mudaConv || mudaProc || mudaProf || mudaEsp || outros.length > 0;
        if (vaiAConta && situacao !== 'aberta' && situacao !== 'semConta')
          throw recusa(`conta-${situacao}`, ENCAMINHA_FATURAMENTO_ALTERAR);
        if ((mudaConv || mudaProc) && f.extras.length > 0)
          throw recusa(
            'conta-com-itens',
            `A conta tem ${f.extras.length} item(ns) além do da ficha (procedimentos extras, exames): a reprecificação deles é do faturamento. Encaminhe ao faturamento.`,
            { campos: mudaConv ? ['convenio'] : ['procedimento'] },
          );
        const proc = mudaProc ? PROCEDIMENTOS.find((x) => x.codigo === e['procedimento']) : undefined;
        if (mudaProc && !proc)
          throw recusa(
            'procedimento-fora-da-tabela',
            'O procedimento não está na tabela do convênio do atendimento.',
            { campos: ['procedimento'] },
          );
        const totalAntes = totalDaFicha(f);
        if (conv) f.convenio = conv.codigo;
        if (proc) {
          f.procedimento = proc.codigo;
          f.valor = proc.valor;
        }
        if (prof) {
          f.vinculo = prof.id;
          f.crm = prof.crm;
          f.medico = prof.nome;
        }
        if (e['especialidade'] !== undefined) f.especialidade = e['especialidade'];
        f.carater = carater;
        if (e['responsavel']) f.responsavel = { ...e['responsavel'] };
        f.correcoes = { ...f.correcoes, ...Object.fromEntries(outros.map((k) => [k, e[k]])) };
        f.versao = this.carimbo();
        return {
          reg: f.reg,
          cabecalho: f.cab,
          convenio: f.convenio,
          valor: f.valor,
          totalAntes,
          totalDepois: totalDaFicha(f),
        };
      }
      case 'atendimento.estornarProcedimentoExtra':
      case 'atendimento.corrigirProcedimentoExtra': {
        const f = this.ficha(s, e['atendimento']);
        const x = f.extras.find((p) => p.seq === e['sequencia']);
        if (!x)
          throw recusa(
            'procedimento-inexistente',
            'O procedimento extra não existe mais neste atendimento.',
            {
              campos: ['sequencia'],
            },
          );
        const situacao = f.conta && f.convenio > 1 ? situacaoDaConta(f.conta) : 'semConta';
        if (situacao !== 'aberta' && situacao !== 'semConta')
          throw recusa(`conta-${situacao}`, ENCAMINHA_FATURAMENTO_EXTRA);
        if (op === 'atendimento.estornarProcedimentoExtra') {
          f.extras = f.extras.filter((p) => p !== x);
          f.itensConta = Math.max(1, f.itensConta - 1);
          return {
            reg: f.reg,
            seq: x.seq,
            procedimento: x.procedimento,
            quantidade: x.quantidade,
            valor: x.valor,
          };
        }
        if (e['data'] !== undefined && (e['data'] < f.data || e['data'] > r.hoje))
          throw recusa(
            'data-fora-do-atendimento',
            'A data de realização fica entre a data do atendimento e hoje.',
            {
              campos: ['data'],
            },
          );
        const quantidade = e['quantidade'] ?? x.quantidade;
        if (quantidade === x.quantidade && (e['data'] === undefined || e['data'] === x.data))
          throw recusa('nada-a-corrigir', 'A quantidade e a data são as já gravadas.');
        const antes = { quantidade: x.quantidade, valor: x.valor };
        const unitario = x.quantidade > 0 ? x.valor / x.quantidade : 0;
        x.valor = Math.round(unitario * quantidade * 100) / 100;
        x.quantidade = quantidade;
        if (e['data'] !== undefined) x.data = e['data'];
        return {
          reg: f.reg,
          seq: x.seq,
          procedimento: x.procedimento,
          quantidadeAntes: antes.quantidade,
          quantidade,
          valorAntes: antes.valor,
          valor: x.valor,
        };
      }
      case 'atendimento.alterarHeranca': {
        const atual = versaoHeranca(s.heranca);
        if (atual !== e['versao'])
          throw new ErroOperacao(
            409,
            'conflito-versao',
            'Configuração alterada por outra pessoa',
            'A configuração da herança mudou desde a leitura. Releia e confira antes de salvar.',
          );
        const mudadas = HERANCAS.filter((h) => {
          const v = e['marcas'][h.campo];
          return v !== undefined && v !== null && v !== (s.heranca[h.chave] === true);
        });
        if (mudadas.length === 0) throw recusa('nada-a-alterar', 'Nada a alterar.');
        for (const h of mudadas) s.heranca[h.chave] = e['marcas'][h.campo] === true;
        return { versao: versaoHeranca(s.heranca), campos: mudadas.map((h) => h.chave).join(',') };
      }
      default:
        throw new Error(`Operação ${op} sem gravação em memória no atendimento.`);
    }
  }

  private previaDe(f: FichaM): PreviaCancelamentoDados {
    const atos = f.atos ?? [];
    const total = atos.reduce((t, a) => t + a.quantidade, 0);
    const s = f.conta && f.convenio > 1 ? situacaoDaConta(f.conta) : 'semConta';
    const motivo =
      s === 'fechada' || s === 'apresentada' || s === 'emitida'
        ? 'A conta do atendimento não está aberta: o faturamento reabre a conta antes da exclusão.'
        : f.extras.length > 0
          ? 'O atendimento tem procedimento extra lançado: estorne os procedimentos antes da exclusão.'
          : f.desfecho
            ? 'O atendimento já foi encerrado: a exclusão é só do atendimento aberto por engano.'
            : atos.length > 0
              ? `O atendimento tem ${total} ${total === 1 ? 'registro dependente' : 'registros dependentes'}: ${atos.map((a) => `${a.rotulo} (${a.quantidade})`).join(', ')}. Anule o atendimento com o motivo (os registros ficam).`
              : null;
    return {
      pode: motivo === null,
      motivo,
      situacaoConta: s,
      itensConta: f.itensConta,
      procedimentosExtras: f.extras.length,
      senha: f.senha,
      desfecho: f.desfecho !== null,
      marcacao: f.marcacao !== null,
      ...(atos.length > 0
        ? { dependentes: atos.map((a) => ({ ...a, origem: 'logica' as const })), saida: 'anular' as const }
        : {}),
    };
  }

  /** Só o teste (W1-05): liga à ficha um ato clínico ou de faturamento (a exclusão física passa a ser recusada). */
  registrarAto(reg: number, rotulo: string, amostra: string): void {
    const f = [...this.estados.values()].flatMap((s) => s.fichas).find((x) => x.reg === reg && x.ativo);
    if (!f) throw new Error(`Ficha ${reg} inexistente na memória.`);
    f.atos = [...(f.atos ?? []), { rotulo, quantidade: 1, amostra: [amostra] }];
  }

  async gravarSgh<T>(
    c: ContextoAtendimento,
    _trilha: unknown,
    fn: (g: GravadorSghAtendimento) => Promise<T>,
  ): Promise<T> {
    const s = this.e(c);
    const r = this.relogioAtual();
    // W0-07: a "transação" em memória: falhou no meio (a transferência entre liberar e alocar, por exemplo), tudo
    // volta ao que era antes (as mesmas garantias do COMMIT/ROLLBACK da gravação SGH_).
    const antes = {
      observacoes: s.observacoes.map((o) => ({ ...o })),
      etapas: new Map(s.fichas.map((f) => [f, [...f.etapas]] as const)),
      impressos: [...s.impressos],
      naoIdentificados: s.naoIdentificados.map((x) => ({ ...x })),
      escoresPa: [...s.escoresPa],
      seq: s.seq,
    };
    try {
      return await this.gravarSghSemDesfazer(s, r, fn);
    } catch (err) {
      s.observacoes.splice(0, s.observacoes.length, ...antes.observacoes);
      for (const [f, e] of antes.etapas) f.etapas.splice(0, f.etapas.length, ...e);
      s.impressos.splice(0, s.impressos.length, ...antes.impressos);
      s.naoIdentificados.splice(0, s.naoIdentificados.length, ...antes.naoIdentificados);
      s.escoresPa.splice(0, s.escoresPa.length, ...antes.escoresPa);
      s.seq = antes.seq;
      throw err;
    }
  }

  private gravarSghSemDesfazer<T>(
    s: Estado,
    r: ReturnType<PortaAtendimentoMemoria['relogioAtual']>,
    fn: (g: GravadorSghAtendimento) => Promise<T>,
  ): Promise<T> {
    return fn({
      registrarEtapa: async (x) => {
        const f = this.ficha(s, x.reg);
        f.etapas.push({ etapa: x.etapa, em: r.agora });
        return ++s.seq;
      },
      alocarObservacao: async (x) => {
        if (s.observacoes.some((o) => !o.saida && o.leito === x.leito && o.reg !== x.reg))
          throw recusa('leito-ocupado', 'O leito ou a poltrona de observação já está ocupado.');
        if (s.observacoes.some((o) => !o.saida && o.reg === x.reg))
          throw recusa(
            'ja-em-observacao',
            'O paciente já está em observação: tire do leito antes de trocar.',
          );
        const id = ++s.seq;
        const anterior = x.anterior ? s.observacoes.find((o) => o.id === x.anterior) : null;
        s.observacoes.push({
          id,
          cab: x.cabecalho,
          reg: x.reg,
          leito: x.leito,
          // Na transferência, a entrada continua a da primeira alocação (a contagem das 24 horas é do paciente).
          entrada: anterior?.entrada ?? r.agora,
          saida: null,
          anterior: anterior?.id ?? null,
          motivoTransferencia: x.motivoTransferencia ?? null,
        });
        return id;
      },
      liberarObservacao: async (x) => {
        const o = s.observacoes.find((y) => y.cab === x.cabecalho && !y.saida);
        if (!o) throw recusa('fora-de-observacao', 'O paciente não está em observação.');
        const horas = Math.round((minutosEntre(o.entrada, r.agora) / 60) * 10) / 10;
        if (
          !x.transferencia &&
          horas >= x.limiteHoras &&
          !(x.justificativa && x.justificativa.trim().length >= 10)
        )
          throw recusa(
            'justificativa-obrigatoria',
            `A observação passou de ${x.limiteHoras} horas: registre a justificativa da permanência.`,
            {
              campos: ['justificativa'],
            },
          );
        o.saida = r.agora;
        return { horas, id: o.id };
      },
      registrarImpresso: async (x) => {
        s.impressos.push({ reg: x.reg, impresso: x.impresso, formato: x.formato });
        return ++s.seq;
      },
      marcarNaoIdentificado: async (x) => {
        if (s.naoIdentificados.some((y) => y.paciente === x.paciente))
          throw recusa('ja-marcado', 'O cadastro já está marcado como paciente não identificado.');
        s.naoIdentificados.push({
          paciente: x.paciente,
          prontuario: x.prontuario,
          caracteristicas: x.caracteristicas,
          marcadoEm: r.agora,
          identificadoEm: null,
          destino: null,
        });
      },
      identificarPaciente: async (x) => {
        const m = s.naoIdentificados.find((y) => y.paciente === x.paciente && !y.identificadoEm);
        if (!m) throw recusa('nao-marcado', 'O cadastro não está marcado como paciente não identificado.');
        m.identificadoEm = r.agora;
        m.destino = x.destino;
      },
      // W0-07 (M1): as mesmas recusas da gravação SGH_ (packages/legado, escore-pa.ts).
      registrarEscorePa: async (x) => {
        if ((x.origem === 'relancamento') !== (x.substitui !== null))
          throw recusa(
            'relancamento-invalido',
            'O relançamento aponta o escore estornado que ele substitui.',
          );
        if (x.substitui !== null) {
          const ant = s.escoresPa.find((y) => y.id === x.substitui && y.cabecalho === x.cabecalho);
          if (!ant) throw recusa('escore-desconhecido', 'O escore substituído não é deste atendimento.');
          if (!ant.estorno)
            throw recusa(
              'escore-nao-estornado',
              'Só se relança no lugar de um escore estornado (estorne antes).',
            );
          if (s.escoresPa.some((y) => y.substitui === ant.id))
            throw recusa('escore-ja-relancado', 'Este escore estornado já foi relançado.');
        }
        const id = ++s.seq;
        s.escoresPa.unshift({
          id,
          cabecalho: x.cabecalho,
          reg: x.reg,
          origem: x.origem,
          sinais: { ...x.sinais },
          news2: x.news2,
          news2Completo: x.news2Completo,
          qsofa: x.qsofa,
          qsofaCompleto: x.qsofaCompleto,
          sirs: x.sirs,
          sirsCompleto: x.sirsCompleto,
          nivel: x.nivel,
          sugereSepse: x.sugereSepse,
          limiarNews2: x.limiarNews2,
          limiarQsofa: x.limiarQsofa,
          substitui: x.substitui,
          motivo: x.motivo,
          aferidoEm: r.agora,
          usuario: x.usuario,
          estorno: null,
        });
        return id;
      },
      estornarEscorePa: async (x) => {
        const i = s.escoresPa.findIndex((y) => y.id === x.id && y.cabecalho === x.cabecalho);
        const e = s.escoresPa[i];
        if (!e) throw recusa('escore-desconhecido', 'O escore não é deste atendimento.');
        if (e.estorno) throw recusa('escore-ja-estornado', 'O escore já foi estornado.');
        // Objeto novo (a cópia de antes da "transação" guarda o antigo, sem o estorno).
        s.escoresPa[i] = { ...e, estorno: { motivo: x.motivo, usuario: x.usuario, em: r.agora } };
        return ++s.seq;
      },
    });
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────

  async relogio(): Promise<{ hoje: string; agora: string }> {
    return this.relogioAtual();
  }

  private senhaTexto(c: ContextoAtendimento, f: FichaM): { id: number; texto: string } | null {
    if (!f.senha) return null;
    const x = this.deps.recepcao?.senhaParaAtendimento(c, f.senha);
    return { id: f.senha, texto: x?.texto ?? String(f.senha) };
  }

  private resumo(c: ContextoAtendimento, f: FichaM): AtendimentoResumo {
    const d = f.desfecho ? desfechoDe(f.desfecho.codigo) : undefined;
    return {
      reg: f.reg,
      cabecalho: f.cab,
      data: f.data,
      hora: f.hora,
      tipo: f.tipo,
      tipoLegado: f.tipoAte,
      tipoRotulo: f.lab ? 'Requisição de laboratório' : rotuloTipoAte(f.tipoAte),
      requisicao: f.lab,
      paciente: { id: f.paciente, prontuario: f.prontuario, nome: f.nome },
      convenio: { codigo: f.convenio, nome: CONVENIOS.find((x) => x.codigo === f.convenio)?.nome ?? '' },
      profissional: { crm: f.crm, nome: f.medico },
      especialidade: {
        codigo: f.especialidade,
        nome: ESPECIALIDADES.find((x) => x.codigo === f.especialidade)?.nome ?? '',
      },
      unidade: f.unidade,
      carater: caraterLido(f.carater),
      senha: this.senhaTexto(c, f),
      desfecho: d && f.desfecho ? { codigo: d.codigo, rotulo: d.rotulo, em: f.desfecho.em } : null,
      abertoNoNovo: true,
    };
  }

  async atendimentosDoDia(
    c: ContextoAtendimento,
    f: { data: string; unidade?: number; requisicoes?: boolean; local?: number; termo?: string },
  ): Promise<{ itens: AtendimentoResumo[]; cortada: boolean; requisicoes: number }> {
    const s = this.e(c);
    const doDia = s.fichas.filter(
      (x) => x.ativo && x.data === f.data && (!f.unidade || x.unidade === f.unidade),
    );
    const termo = termoDoDia(f.termo);
    const confere = (x: FichaM): boolean => {
      if (f.local) {
        const ult = x.senha ? this.deps.recepcao?.ultimoFluxo(c, x.senha) : null;
        if (x.fila?.local !== f.local && x.local !== f.local && ult?.local !== f.local) return false;
      }
      if (!termo) return true;
      const sen = this.senhaTexto(c, x)?.texto.replace(/\s+/g, '') ?? '';
      if (termo.tipo === 'numero')
        return x.reg === termo.n || x.prontuario === termo.n || Number(sen.replace(/\D/g, '')) === termo.n;
      if (termo.tipo === 'senha') return sen === `${termo.letra}${String(termo.n).padStart(3, '0')}`;
      return x.nome.toUpperCase().includes(termo.t);
    };
    return {
      itens: doDia
        .filter((x) => (f.requisicoes || !x.lab) && confere(x))
        .sort((a, b) => b.reg - a.reg)
        .map((x) => this.resumo(c, x)),
      cortada: false,
      requisicoes: doDia.filter((x) => x.lab).length,
    };
  }

  /**
   * M50, etapa 4: a marcação sintética de uma teleconsulta da semente (o portal marcou; a teleconsulta abre a ficha a
   * partir dela, sem senha). Só na sessão sintética; a mesma marcação não entra duas vezes.
   */
  incluirMarcacaoSintetica(
    hospital: string,
    m: {
      id: number;
      data: string;
      hora: string;
      paciente: number;
      convenio: number;
      crm: number;
      especialidade: number;
      unidade: number;
      cdc: number;
      procedimento: number;
    },
  ): void {
    const s = this.porHospitalDe(hospital);
    if (s.marcacoes.some((x) => x.id === m.id)) return;
    s.marcacoes.push({
      ...m,
      hora: `${m.hora.slice(0, 2)}:${m.hora.slice(2, 4)}`,
      retorno: false,
      registro: 0,
    });
  }

  async marcacao(c: ContextoAtendimento, id: number): Promise<MarcacaoParaAbertura | null> {
    const s = this.e(c);
    const m = s.marcacoes.find((x) => x.id === id);
    if (!m) return null;
    const [p] = (await this.deps.lerPacientes?.(c, [m.paciente])) ?? [];
    return {
      id: m.id,
      data: m.data,
      hora: m.hora,
      hoje: m.data === this.relogioAtual().hoje,
      registro: m.registro,
      paciente: p ? { id: p.id, nome: p.nome, prontuario: p.prontuario, nascimento: p.nascimento } : null,
      convenio: m.convenio,
      crm: m.crm,
      especialidade: m.especialidade,
      unidade: m.unidade,
      centroCusto: m.cdc,
      procedimento: m.procedimento,
      retorno: m.retorno,
    };
  }

  async detalhe(c: ContextoAtendimento, reg: number): Promise<AtendimentoDetalhe | null> {
    const s = this.e(c);
    const f = s.fichas.find((x) => x.reg === reg && x.ativo);
    if (!f) return null;
    const r = this.relogioAtual();
    const situacao = f.conta && f.convenio > 1 ? situacaoDaConta(f.conta) : 'semConta';
    const o = [...s.observacoes].reverse().find((x) => x.reg === f.reg);
    const leito = o ? LEITOS.find((l) => l.id === o.leito) : undefined;
    const horas = o ? Math.round((minutosEntre(o.entrada, o.saida ?? r.agora) / 60) * 10) / 10 : 0;
    return {
      ...this.resumo(c, f),
      matricula: f.matricula,
      validadeCarteira: f.validadeCarteira,
      guia: f.guia,
      senhaConvenio: f.senhaConvenio,
      validadeSenha: f.validadeSenha,
      plano: f.plano,
      responsavel: f.responsavel,
      procedimento: {
        codigo: f.procedimento,
        nome: PROCEDIMENTOS.find((p) => p.codigo === f.procedimento)?.nome ?? '',
        valor: f.valor,
      },
      extras: f.extras.map((x) => ({ ...x, profissional: String(x.crm) })),
      conta: {
        situacao,
        rotulo: rotuloConta(situacao),
        permiteLancar: permiteLancar(situacao),
        itens: f.itensConta,
      },
      versao: f.versao,
      observacao: o
        ? {
            leito: leito?.codigo ?? '',
            local: leito?.local ?? '',
            entrada: o.entrada,
            saida: o.saida,
            horas,
            alerta: !o.saida && horas >= 20,
          }
        : null,
      etapas: f.etapas.map((x) => ({ etapa: x.etapa, rotulo: x.etapa, em: x.em })),
      ...corrigiveisDaMemoria(f.correcoes),
    };
  }

  async fila(
    c: ContextoAtendimento,
    o: { local: number; hoje: string; crm?: number },
  ): Promise<{ itens: ItemFila[]; cortada: boolean }> {
    const s = this.e(c);
    const loc = LOCAIS.find((l) => l.id === o.local);
    const itens: ItemFila[] = [];
    for (const f of s.fichas) {
      if (!f.ativo || f.lab || f.data !== o.hoje) continue;
      if (o.crm && f.crm !== o.crm) continue;
      const sen = f.senha ? this.deps.recepcao?.senhaParaAtendimento(c, f.senha) : null;
      const ult = f.senha ? this.deps.recepcao?.ultimoFluxo(c, f.senha) : null;
      const noLocal = f.senha ? ult?.local === o.local : f.fila?.local === o.local;
      const aguardando =
        !noLocal &&
        !!loc &&
        (f.senha
          ? ult?.acao === 'A' && LOCAIS.find((l) => l.id === ult.local)?.recepcao === loc.recepcao
          : f.fila?.situacao === 'aguardando');
      if (!noLocal && !aguardando) continue;
      itens.push({
        reg: f.reg,
        cabecalho: f.cab,
        idPaciente: f.paciente,
        paciente: f.nome,
        prontuario: f.prontuario,
        senha: sen?.texto ?? null,
        prioridade: (['0', '1', '2'].includes(sen?.prioridade ?? '') ? sen?.prioridade : '2') as
          '0' | '1' | '2',
        agendadoPara: f.marcacao ? '08:00' : null,
        chegada: sen?.emitidaEm ?? f.inclusao,
        letraNoLocal: noLocal && f.senha ? (ult?.acao ?? null) : null,
        situacaoNovo: f.senha ? null : (f.fila?.situacao ?? 'aguardando'),
        chamadas: f.senha ? (ult?.chamadas ?? 0) : (f.fila?.chamadas ?? 0),
        tipo: f.tipo,
        convenio: CONVENIOS.find((x) => x.codigo === f.convenio)?.nome ?? '',
        crm: f.crm,
        encerrado: f.desfecho !== null,
      });
    }
    return { itens, cortada: false };
  }

  async locais(): Promise<{ id: number; descricao: string; recepcao: number }[]> {
    return LOCAIS;
  }

  async paAbertos(c: ContextoAtendimento): Promise<{ itens: AtendimentoPa[]; cortada: boolean }> {
    const s = this.e(c);
    const itens = s.fichas
      .filter((f) => f.ativo && f.tipo === 'pa' && !f.desfecho)
      .map((f) => {
        const sen = f.senha ? this.deps.recepcao?.senhaParaAtendimento(c, f.senha) : null;
        const o = s.observacoes.find((x) => x.reg === f.reg && !x.saida);
        const leito = o ? LEITOS.find((l) => l.id === o.leito) : undefined;
        return {
          reg: f.reg,
          cabecalho: f.cab,
          paciente: f.nome,
          nascimento: f.nascimento,
          senha: sen?.texto ?? null,
          prioridade: (['0', '1', '2'].includes(sen?.prioridade ?? '') ? sen?.prioridade : '2') as
            '0' | '1' | '2',
          chegada: sen?.emitidaEm ?? f.etapas[0]?.em ?? f.inclusao,
          profissional: f.medico,
          marcas: [...f.etapas],
          leito: leito ? `${leito.local} ${leito.codigo}` : null,
          observacaoDesde: o?.entrada ?? null,
          comMarcas: f.etapas.length > 0,
          saida: f.saidaOutro ?? null,
          prontuario: f.prontuario,
        };
      });
    return { itens, cortada: false };
  }

  async observacao(c: ContextoAtendimento): Promise<{ leitos: LeitoObservacao[]; historico: number }> {
    const s = this.e(c);
    const r = this.relogioAtual();
    return {
      leitos: LEITOS.map((l) => {
        const o = s.observacoes.find((x) => x.leito === l.id && !x.saida);
        const f = o ? s.fichas.find((x) => x.reg === o.reg) : undefined;
        return {
          id: l.id,
          codigo: l.codigo,
          local: l.local,
          tipo: l.tipo,
          ativo: true,
          ocupacao:
            o && f
              ? {
                  reg: f.reg,
                  cabecalho: f.cab,
                  paciente: f.nome,
                  entrada: o.entrada,
                  minutos: minutosEntre(o.entrada, r.agora),
                }
              : null,
        };
      }),
      historico: s.observacoes.filter((x) => x.saida).length,
    };
  }

  async indicadores(
    c: ContextoAtendimento,
    o: { inicio: string; fim: string; unidade?: number },
  ): Promise<IndicadoresDados> {
    const s = this.e(c);
    const r = this.relogioAtual();
    const doPeriodo = s.fichas.filter(
      (f) => f.ativo && f.data >= o.inicio && f.data <= o.fim && (!o.unidade || f.unidade === o.unidade),
    );
    const grupos = new Map<string, IndicadoresDados['porTipo'][number]>();
    for (const f of doPeriodo) {
      const k = `${f.tipoAte}:${f.lab}:${f.especialidade === 0}:${f.carater}`;
      const g = grupos.get(k) ?? {
        tipoAte: f.tipoAte,
        laboratorio: f.lab,
        especialidadeZero: f.especialidade === 0,
        caracters: f.carater,
        total: 0,
      };
      grupos.set(k, { ...g, total: g.total + 1 });
    }
    const des = new Map<string, IndicadoresDados['desfechos'][number]>();
    for (const f of doPeriodo)
      if (f.desfecho) {
        const k = `${f.desfecho.codigo}:${f.tipoAte}`;
        const g = des.get(k) ?? { desfecho: f.desfecho.codigo, tipoAte: f.tipoAte, total: 0 };
        des.set(k, { ...g, total: g.total + 1 });
      }
    return {
      porTipo: [...grupos.values()],
      desfechos: [...des.values()],
      marcasPa: doPeriodo
        .filter((f) => f.tipo === 'pa')
        .flatMap((f) => f.etapas.map((x) => ({ cabecalho: f.cab, ...x }))),
      observacoes: s.observacoes
        .filter((x) => doPeriodo.some((f) => f.reg === x.reg))
        .map((x) => ({ cabecalho: x.cab, minutos: minutosEntre(x.entrada, x.saida ?? r.agora) })),
      paTotal: doPeriodo.filter((f) => f.tipo === 'pa').length,
      visitasPa: s.fichas
        .filter(
          (f) =>
            f.ativo &&
            f.tipo === 'pa' &&
            f.data >= menosDias(o.inicio, 3) &&
            f.data <= o.fim &&
            (!o.unidade || f.unidade === o.unidade),
        )
        .map((f) => ({ paciente: String(f.paciente), data: f.data, hora: f.hora })),
      internacoesPa: (() => {
        const d = doPeriodo.filter((f) => f.tipo === 'pa' && f.desfecho?.codigo === 'internacao').length;
        return { viaDesfecho: d, viaEncaminhamento: 0, total: d };
      })(),
    };
  }

  async apoio(c: ContextoAtendimento): Promise<ApoioAtendimentoDados> {
    const s = this.e(c);
    return {
      convenios: CONVENIOS,
      unidades: [
        { codigo: 1, nome: `AMBULATORIO ${M}` },
        { codigo: 2, nome: `LABORATORIO ${M}` },
        { codigo: 3, nome: `PRONTO ATENDIMENTO ${M}` },
      ],
      especialidades: ESPECIALIDADES,
      profissionais: PROFISSIONAIS.map((p) => ({ ...p })),
      centrosCusto: [
        { codigo: 300400, nome: `PRONTO ATENDIMENTO ${M}` },
        { codigo: 300500, nome: `LABORATORIO ${M}` },
        { codigo: 300600, nome: `AMBULATORIO ${M}` },
      ],
      motivosExclusao: MOTIVOS_EXCLUSAO,
      heranca: { ...s.heranca },
    };
  }

  async cid(_c: ContextoAtendimento, termo: string) {
    const t = termo.trim().toUpperCase();
    return t.length < 2
      ? []
      : CIDS.filter((x) => x.codigo.startsWith(t.replace('.', '')) || x.nome.includes(t));
  }

  async solicitantes(_c: ContextoAtendimento, termo: string) {
    const t = termo.trim().toUpperCase();
    return t.length < 2 ? [] : SOLICITANTES.filter((x) => x.nome.includes(t) || x.registro.startsWith(t));
  }

  async procedimentos(_c: ContextoAtendimento, _convenio: number, termo: string) {
    const t = termo.trim().toUpperCase();
    return t.length < 2
      ? []
      : PROCEDIMENTOS.filter((x) => String(x.codigo).startsWith(t) || x.nome.includes(t)).map(
          ({ codigo, nome }) => ({
            codigo,
            nome,
          }),
        );
  }

  async historico(c: ContextoAtendimento, paciente: number) {
    const s = this.e(c);
    const doPaciente = s.fichas.filter((f) => f.paciente === paciente).sort((a, b) => b.reg - a.reg);
    const a = doPaciente.find((f) => !f.lab) ?? null;
    return {
      heranca: { ...s.heranca },
      anterior: a
        ? {
            reg: a.reg,
            data: a.data,
            valores: {
              convenio: a.convenio,
              profissional: a.vinculo,
              centroCusto: a.cdc,
              unidade: a.unidade,
              matricula: a.matricula,
              guia: a.guia,
              plano: a.plano,
              clinica: 'M',
              especialidade: a.especialidade,
              empresa: '',
              validadeCarteira: a.validadeCarteira,
            },
          }
        : null,
      historico: doPaciente.map((f) => ({
        reg: f.reg,
        data: f.data,
        tipo: f.lab ? 'Requisição de laboratório' : rotuloTipoAte(f.tipoAte),
        convenio: CONVENIOS.find((x) => x.codigo === f.convenio)?.nome ?? '',
        profissional: f.medico,
      })),
    };
  }

  async previaCancelamento(c: ContextoAtendimento, reg: number): Promise<PreviaCancelamentoDados | null> {
    const f = this.e(c).fichas.find((x) => x.reg === reg && x.ativo);
    return f ? this.previaDe(f) : null;
  }

  async dadosImpresso(c: ContextoAtendimento, reg: number): Promise<DadosImpresso | null> {
    const s = this.e(c);
    const f = s.fichas.find((x) => x.reg === reg && x.ativo);
    if (!f) return null;
    const o = s.observacoes.find((x) => x.reg === f.reg && !x.saida);
    const leito = o ? LEITOS.find((l) => l.id === o.leito) : undefined;
    return {
      reg: f.reg,
      idPaciente: f.paciente,
      prontuario: f.prontuario,
      nome: f.nome,
      nascimento: f.nascimento,
      convenio: CONVENIOS.find((x) => x.codigo === f.convenio)?.nome ?? '',
      data: f.data,
      hora: f.hora,
      profissional: f.medico,
      especialidade: ESPECIALIDADES.find((x) => x.codigo === f.especialidade)?.nome ?? '',
      tipo: f.lab ? 'Requisição de laboratório' : rotuloTipoAte(f.tipoAte),
      leito: leito ? `${leito.local} ${leito.codigo}` : null,
      alergia: f.paciente === 1001,
      codigoConvenio: f.convenio,
      codigoEspecialidade: f.especialidade,
      unidade: f.unidade,
      clinica: 'M',
      retorno: false,
      pa: f.tipo === 'pa',
    };
  }

  async profissional(_c: ContextoAtendimento, login: string): Promise<ProfissionalDaSessao | null> {
    // M50, etapa 4: o médico convidado da teleinterconsulta é o CARLOS CARDIOLOGISTA (7102).
    if (login === 'SINT.CARDIO.TELE')
      return {
        vinculo: 7102,
        crm: 52002,
        nome: `CARLOS CARDIOLOGISTA ${M}`,
        codigoCbo: '225120',
        conselhoAtivo: true,
      };
    // O médico sintético da sessão é a ANA MEDICA (CBO 225125, conselho ativo); a recepção não tem vínculo clínico.
    if (!/MEDICO/i.test(login)) return null;
    return { vinculo: 7101, crm: 52001, nome: `ANA MEDICA ${M}`, codigoCbo: '225125', conselhoAtivo: true };
  }

  async escoresPa(c: ContextoAtendimento, cabecalhos: readonly string[]): Promise<EscorePaRegistrado[]> {
    const k = new Set(cabecalhos);
    return this.e(c).escoresPa.filter((x) => k.has(x.cabecalho));
  }

  /** Sem os sinais vitais do prontuário em memória: o alerta nasce só dos escores registrados no PA. */
  async sinaisPa(): Promise<Map<string, SinaisRecentes>> {
    return new Map();
  }

  async naoIdentificados(c: ContextoAtendimento) {
    return this.e(c).naoIdentificados.map((x) => ({
      paciente: x.paciente,
      prontuario: x.prontuario,
      caracteristicas: x.caracteristicas,
      marcadoEm: x.marcadoEm,
      identificadoEm: x.identificadoEm,
    }));
  }
}

/** AAAA-MM-DD menos n dias. */
function menosDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** W1-05: o CID, o solicitante e a observação gravados pela correção (a memória não tem outra leitura deles). */
function corrigiveisDaMemoria(c: Record<string, unknown> | undefined) {
  const cid = (k: string) => CIDS.find((x) => x.id === c?.[k]) ?? null;
  const obs = typeof c?.['observacao'] === 'string' ? c['observacao'].trim() : '';
  return {
    cidPrincipal: cid('cidPrincipal'),
    cidSecundario: cid('cidSecundario'),
    solicitante: SOLICITANTES.find((x) => x.id === c?.['solicitante']) ?? null,
    observacaoFicha: obs === '' ? null : obs,
  };
}
