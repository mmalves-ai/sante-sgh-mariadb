// Porta da prescrição em MEMÓRIA (M24): a sessão sintética de dev/ci (E2E) prescreve para os pacientes SINTÉTICOS do
// cadastro (1001 e 1003) com produtos, cadastros e regras de horário SINTÉTICOS (a regra das internações começa às
// 16:01, como a medida; o externo, no minuto da prescrição). O que se grava é o que o executor gravaria (os itens
// montados pelo domínio, os horários previstos e o evento da prova), guardado em memória por estabelecimento; nada vai
// à cópia. As recusas são as mesmas da receita (uma ativa por período, origem alterada, item já suspenso).
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import { type AlergiaLida, type DadosClinicosLidos, type AtendimentoDaPrescricao, type AtendimentoLido, type CabecalhoDocumentoLido, type ConsultaCadastroLida, type DecisaoLida, type FichaNovaLida, type FuturaGravadaLida, type GradeClasseLida, type GravacaoPrescricao, type HorarioPadraoLido, type InclusaoItem, type ItemGravacao, type ItemPrescricaoLido, type KitMedicamentoLido, type OpcaoDominio, type PrescricaoCabecalhoLida, type ProdutoLido, type ProtocoloLido, type ReconciliacaoGravadaLida, type RegraAlertaLida, type RegraHorarioLida, type SuspensaoItem, type SuspensaoPrescricao, loginDaOperacao } from './tipos-pep.js';
import { ROTULOS_TIPO_ITEM, type SecaoCadastroPrescricao, tipoDoPlano } from '@sgh/contratos';
import { frequencia as frequenciaDe } from '@sgh/dominio-pep';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { ContextoPrescricao, PortaPrescricao } from './prescricao-porta.js';

const M = 'SINTETICO';

/** Contexto da gravação em memória: o mesmo da operação do núcleo. */
type CtxMemoria = ContextoOperacao;

const PACIENTES: Readonly<Record<number, string>> = {
  1001: `JOSÉ DA SILVA ${M}`,
  1003: `CINTHYA GABRIELLA VIANNA ${M}`,
};

/** Grade sintética por número de doses (a forma medida da regra das internações). */
const GRADE_I: ReadonlyMap<number, readonly string[]> = new Map([
  [1, ['2200']],
  [2, ['2200', '1000']],
  [3, ['2200', '0600', '1400']],
  [4, ['1800', '0000', '0600', '1200']],
  [6, ['1800', '2200', '0200', '0600', '1000', '1400']],
  [8, ['1800', '2100', '0000', '0300', '0600', '0900', '1200', '1500']],
  [12, ['1800', '2000', '2200', '0000', '0200', '0400', '0600', '0800', '1000', '1200', '1400', '1600']],
  [24, Array.from({ length: 24 }, (_, i) => `${String((17 + i) % 24).padStart(2, '0')}00`)],
]);

const PRODUTOS: readonly ProdutoLido[] = [
  produto(501, `DIPIRONA ${M} 500 MG/ML`, 'ML', [{ id: 11, nome: 'DIPIRONA' }], ['EV', 'IM', 'VO']),
  produto(502, `CEFTRIAXONA ${M} 1 G`, 'G', [{ id: 12, nome: 'CEFTRIAXONA' }], ['EV', 'IM'], {
    antimicrobiano: true,
  }),
  produto(503, `MORFINA ${M} 10 MG/ML`, 'MG', [{ id: 13, nome: 'MORFINA' }], ['EV', 'SC'], {
    psicotropico: true,
    portaria: 'A1',
    potencialmentePerigoso: true,
    // Faixa de dose do cadastro (GEUNIPRESC) na unidade de prescrição, sintética.
    faixasDose: [{ unidade: 'MG', minima: 1, maxima: 10 }],
  }),
  produto(504, `CLORETO DE SÓDIO ${M} 0,9%`, 'ML', [{ id: 14, nome: 'CLORETO DE SÓDIO' }], ['EV']),
  produto(505, `INSULINA REGULAR ${M}`, 'UI', [{ id: 15, nome: 'INSULINA HUMANA' }], ['SC', 'EV'], {
    potencialmentePerigoso: true,
  }),
  produto(506, `AMOXICILINA ${M} 500 MG`, 'MG', [{ id: 16, nome: 'AMOXICILINA' }], ['VO'], {
    antimicrobiano: true,
  }),
  produto(507, `METAMIZOL ${M} 1 G`, 'G', [{ id: 11, nome: 'DIPIRONA' }], ['VO', 'EV']),
  produto(508, `GLICOSE ${M} 5%`, 'ML', [{ id: 17, nome: 'GLICOSE' }], ['EV']),
  produto(509, `FITOTERÁPICO ${M} NÃO PADRONIZADO`, 'MG', [], ['VO'], { padronizado: false }),
  produto(601, `SERINGA ${M} 10 ML`, 'UN', [], []),
  produto(602, `AGULHA ${M} 40X12`, 'UN', [], []),
];

function produto(
  id: number,
  nome: string,
  unidade: string,
  principios: { id: number; nome: string }[],
  vias: string[],
  extra: Partial<
    Pick<
      ProdutoLido,
      'antimicrobiano' | 'psicotropico' | 'portaria' | 'potencialmentePerigoso' | 'padronizado' | 'faixasDose'
    >
  > = {},
): ProdutoLido {
  return {
    produto: id,
    nome,
    unidade,
    padronizado: extra.padronizado ?? true,
    psicotropico: extra.psicotropico ?? false,
    portaria: extra.portaria ?? null,
    antimicrobiano: extra.antimicrobiano ?? false,
    principios,
    vias,
    potencialmentePerigoso: extra.potencialmentePerigoso ?? false,
    periodoMinimoHoras: null,
    faixasDose: extra.faixasDose ?? [],
  };
}

const DOMINIOS: Record<string, OpcaoDominio[]> = {
  vias: [
    { id: 'EV', nome: 'Endovenosa' },
    { id: 'IM', nome: 'Intramuscular' },
    { id: 'SC', nome: 'Subcutânea' },
    { id: 'VO', nome: 'Via oral' },
  ],
  unidades: [
    { id: 'MG', nome: 'mg' },
    { id: 'G', nome: 'g' },
    { id: 'ML', nome: 'mL' },
    { id: 'UI', nome: 'UI' },
    { id: 'UN', nome: 'unidade' },
  ],
  motivos: [
    { id: '1', nome: 'Dor' },
    { id: '2', nome: 'Febre' },
    { id: '3', nome: 'Náusea ou vômito' },
  ],
  dietas: [
    { id: '1', nome: `Dieta geral ${M}`, grupo: '3' },
    { id: '2', nome: `Dieta enteral padrão ${M}`, grupo: '4' },
    { id: '3', nome: `Dieta livre ${M}`, grupo: '2' },
    { id: '4', nome: `Jejum ${M}`, grupo: '1' },
  ],
  viasDieta: [
    { id: '1', nome: 'Oral' },
    { id: '2', nome: 'Sonda nasoenteral' },
  ],
  procedimentos: [
    { id: '1', nome: `Curativo ${M}` },
    { id: '2', nome: `Controle de sinais vitais ${M}` },
    { id: '3', nome: `Glicemia capilar ${M}` },
  ],
  caracteristicas: [{ id: '1', nome: 'Consistência' }],
  tiposInfusao: [
    { id: '1', nome: 'Contínua' },
    { id: '2', nome: 'Intermitente' },
  ],
  unidadesInfusao: [{ id: '1', nome: 'mL/h' }],
  viasAereas: [
    { id: '1', nome: 'Tubo orotraqueal' },
    { id: '2', nome: 'Máscara facial' },
  ],
  modos: [
    { id: '1', nome: 'Pressão controlada', grupo: '12' },
    { id: '2', nome: 'Volume controlado', grupo: '12' },
    { id: '3', nome: 'CPAP', grupo: '11' },
    { id: '4', nome: 'BIPAP', grupo: '11' },
  ],
  hemocomponentes: [
    { id: '99:CH', nome: 'Concentrado de hemácias' },
    { id: '99:CP', nome: 'Concentrado de plaquetas' },
    { id: '99:PLC', nome: 'Plasma fresco congelado' },
  ],
  unidadesResposta: [
    { id: '1', nome: 'cmH2O' },
    { id: '2', nome: '%' },
  ],
};

const RELATIVOS = [
  { id: 1, nome: 'Café da manhã', horario: '0700' },
  { id: 2, nome: 'Almoço', horario: '1145' },
  { id: 3, nome: 'Jantar', horario: '1800' },
];

const KITS: readonly KitMedicamentoLido[] = [
  {
    id: 1,
    produto: 502,
    doseDe: 0,
    doseAte: 0,
    unidade: 'G',
    via: 'EV',
    tipoAtendimento: null,
    itens: [
      { produto: 601, quantidade: 1, unidade: 'UN' },
      { produto: 602, quantidade: 1, unidade: 'UN' },
    ],
  },
];

function agoraLocal(): string {
  // Hora local de São Paulo (o banco do estabelecimento é local; o processo roda em UTC).
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 19);
}

function somarMin(iso: string, min: number): string {
  return new Date(new Date(`${iso.slice(0, 16)}:00Z`).getTime() + min * 60_000).toISOString().slice(0, 16);
}

/** CBO sintético do login (o mesmo cálculo da sessão sintética do M22) e a ocupação pelo nome do login. */
function cboDe(login: string): number | null {
  if (/SEMCBO/i.test(login)) return null;
  let h = 7000;
  for (const c of login) h = (h * 31 + c.charCodeAt(0)) % 9000;
  return 7000 + h;
}
function ocupacaoDe(login: string): string {
  if (/NUTRI/i.test(login)) return '223710';
  if (/RESIDENTE/i.test(login)) return '223115';
  if (/DENTISTA/i.test(login)) return '223268';
  if (/ENFERM/i.test(login)) return '223505';
  if (/FARMA/i.test(login)) return '223405';
  return '225125';
}

interface PrescricaoMemoria {
  cab: PrescricaoCabecalhoLida;
  itens: ItemPrescricaoLido[];
  doNovo: boolean;
  coassinaturaExigida: boolean;
  coassinada: boolean;
  eventos: {
    tipo: string;
    item: number | null;
    em: string;
    usuario: string;
    hashAnterior: string;
    comoSuporte: boolean;
  }[];
  decisoes: DecisaoLida[];
  hash: string;
}

export class PortaPrescricaoMemoria implements PortaPrescricao {
  readonly destino = 'memoria' as const;
  constructor(private readonly trilha: RegistradorTrilha | null = null) {}

  private readonly por = new Map<string, PrescricaoMemoria[]>();
  private readonly regrasSgh = new Map<string, RegraAlertaLida[]>();
  private readonly futurasSgh = new Map<
    string,
    (FuturaGravadaLida & { atendimento: number; paciente: number })[]
  >();
  private readonly reconSgh = new Map<string, (ReconciliacaoGravadaLida & { atendimento: number })[]>();
  private readonly fichasSgh = new Map<string, FichaNovaLida[]>();
  private readonly gradesSgh = new Map<string, GradeClasseLida[]>();
  private proximo = 880_000;

  private lista<T>(m: Map<string, T[]>, h: string): T[] {
    let l = m.get(h);
    if (!l) m.set(h, (l = []));
    return l;
  }

  /** As prescrições do estabelecimento; na primeira leitura, uma do outro sistema (período anterior) para o 1001. */
  private presc(h: string): PrescricaoMemoria[] {
    let l = this.por.get(h);
    if (!l) {
      l = [];
      this.por.set(h, l);
      const agora = agoraLocal();
      const hoje = agora.slice(0, 10);
      const ini = agora.slice(11, 16) >= '16:01' ? `${hoje}T16:01` : somarMin(`${hoje}T16:01`, -1440);
      const inicio = somarMin(ini, -1440);
      const fim = somarMin(inicio, 1439);
      const id = this.proximo++;
      const hs = (base: string, passos: number[]): HorarioPadraoLido[] =>
        passos.map((m) => ({
          id: this.proximo++,
          dataHora: `${somarMin(base, m)}:00`,
          situacao: 'p',
          acessoria: false,
        }));
      l.push({
        cab: {
          id,
          atendimento: 10011,
          htPaciente: 10010,
          htAtendimento: 100110,
          dataHora: `${somarMin(inicio, -30)}:00`,
          inicio: `${inicio}:00`,
          fim: `${fim}:00`,
          cbo: 7001,
          prescritor: `PROFISSIONAL ${M}`,
          suspensaoEm: null,
          suspensaoPor: null,
          suspensaoJustificativa: null,
          gravacao: `${somarMin(inicio, -30)}:00`,
          itens: 2,
        },
        itens: [
          {
            id: this.proximo++,
            prescricao: id,
            plano: 6,
            planoNome: 'Medicamento',
            numDoses: 4,
            frequencia: 11,
            frequenciaNome: '06/06',
            via: 'EV',
            observacaoEnfermagem: null,
            cboLancamento: 7001,
            incluidoEm: null,
            corrigidoEm: null,
            gravacao: null,
            detalhe: {
              tipo: 'medicamento',
              id: this.proximo++,
              produto: 501,
              produtoNome: PRODUTOS[0]!.nome,
              dose: 2,
              unidade: 'ML',
              agora: false,
              naoAjustar: false,
              motivosSeNecessario: [],
              justificativaNaoPadronizado: null,
              justificativaAlergia: null,
              principios: [11],
            },
            horarios: hs(inicio, [119, 479, 839, 1199]),
          },
          {
            id: this.proximo++,
            prescricao: id,
            plano: 13,
            planoNome: 'Cuidado ou procedimento',
            numDoses: 3,
            frequencia: 9,
            frequenciaNome: '08/08',
            via: null,
            observacaoEnfermagem: 'Registrar no balanço.',
            cboLancamento: 7001,
            incluidoEm: null,
            corrigidoEm: null,
            gravacao: null,
            detalhe: {
              tipo: 'procedimento',
              id: this.proximo++,
              procedimento: 2,
              procedimentoNome: DOMINIOS['procedimentos']![1]!.nome,
              faixas: [],
              agora: false,
              motivosSeNecessario: [],
            },
            horarios: hs(inicio, [359, 839, 1319]),
          },
        ],
        doNovo: false,
        coassinaturaExigida: false,
        coassinada: false,
        eventos: [],
        decisoes: [],
        hash: '',
      });
    }
    return l;
  }

  private achar(h: string, id: number): PrescricaoMemoria {
    const p = this.presc(h).find((x) => x.cab.id === id);
    if (!p)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Prescrição não encontrada',
        'A prescrição não existe.',
      );
    return p;
  }

  private async auditar(
    c: ContextoPrescricao,
    ctx: CtxMemoria,
    evento: string,
    id: number,
    paciente: number,
  ) {
    await this.trilha?.registrar({
      evento,
      rede: c.rede,
      hospital: c.hospital,
      usuario: loginDaOperacao(ctx),
      estacao: '',
      correlacao: (ctx.correlacao || evento).slice(0, 64),
      recurso: 'pep.prescricao',
      resultado: 'sucesso',
      tabelaAlvo: 'PRPRESC',
      idAlvo: String(id),
      paciente,
    });
  }

  private conferirCbo(cbo: number, login: string): void {
    if (cboDe(login) !== cbo)
      throw new ErroOperacao(
        409,
        'profissional-sem-cbo',
        'Operação recusada',
        'Só o profissional da sessão prescreve.',
      );
  }

  /** O item gravado como a leitura o devolveria (nomes do cadastro sintético, horários pendentes). */
  private lido(
    prescricao: number,
    it: ItemGravacao,
    cbo: number,
    incluidoEm: string | null,
  ): ItemPrescricaoLido {
    const d = it.detalhe;
    const tipo = tipoDoPlano(it.plano);
    const nomeProd = (p: number) => PRODUTOS.find((x) => x.produto === p)?.nome ?? `Produto ${p}`;
    const nomeDom = (k: string, id: string) => DOMINIOS[k]?.find((o) => o.id === id)?.nome ?? null;
    const id = this.proximo++;
    const horarios: HorarioPadraoLido[] = [];
    const principais = d.tipo === 'solucao' ? d.etapas.map((e) => ({ dataHora: e.inicio })) : it.horarios;
    for (const h of principais) {
      horarios.push({ id: this.proximo++, dataHora: h.dataHora, situacao: 'P', acessoria: false });
      if (d.tipo === 'medicamento')
        for (let k = 0; k < d.kit.length; k++)
          horarios.push({ id: this.proximo++, dataHora: h.dataHora, situacao: 'P', acessoria: true });
    }
    const base = {
      id,
      prescricao,
      plano: it.plano,
      planoNome: tipo ? ROTULOS_TIPO_ITEM[tipo] : `Tipo ${it.plano}`,
      numDoses: it.numDose,
      frequencia: it.frequencia,
      frequenciaNome: it.frequencia === null ? null : (frequenciaDe(it.frequencia)?.nome ?? null),
      via: it.via,
      observacaoEnfermagem: it.observacao,
      cboLancamento: cbo,
      incluidoEm,
      corrigidoEm: null,
      gravacao: `${agoraLocal()}`,
      horarios,
    };
    switch (d.tipo) {
      case 'medicamento':
        return {
          ...base,
          detalhe: {
            tipo: 'medicamento',
            id: this.proximo++,
            produto: d.produto,
            produtoNome: nomeProd(d.produto),
            dose: d.dose,
            unidade: d.unidade,
            agora: d.agora,
            naoAjustar: d.naoAjustar,
            motivosSeNecessario: [...d.seNecessario],
            justificativaNaoPadronizado: d.naoPadronizado?.justificativa ?? null,
            justificativaAlergia: d.justificativaAlergia,
            principios: PRODUTOS.find((x) => x.produto === d.produto)?.principios.map((x) => x.id) ?? [],
          },
        };
      case 'procedimento':
        return {
          ...base,
          detalhe: {
            tipo: 'procedimento',
            id: this.proximo++,
            procedimento: d.procedimento,
            procedimentoNome: nomeDom('procedimentos', String(d.procedimento)),
            faixas: d.faixas.map((f) => ({
              de: f.de,
              ate: f.ate,
              produto: f.produto,
              dose: f.dose,
              unidade: f.unidade,
            })),
            agora: d.agora,
            motivosSeNecessario: [...d.seNecessario],
          },
        };
      case 'dieta':
        return {
          ...base,
          detalhe: {
            tipo: 'dieta',
            id: this.proximo++,
            dieta: d.dieta,
            dietaNome: nomeDom('dietas', String(d.dieta)),
            quantidade: d.quantidade,
            viaDieta: d.viaDieta,
          },
        };
      case 'solucao':
        return {
          ...base,
          detalhe: {
            tipo: 'solucao',
            id: this.proximo++,
            volumeTotal: d.etapas.reduce((s, e) => s + e.volume, 0),
            componentes: d.componentes.map((x) => ({
              produto: x.produto,
              nome: nomeProd(x.produto),
              dose: x.dose,
              unidade: x.unidade,
              principal: x.principal,
            })),
          },
        };
      case 'vmi':
      case 'vni':
        return {
          ...base,
          detalhe: {
            tipo: 'ventilacao',
            id: this.proximo++,
            modo: d.modo,
            modoNome: nomeDom('modos', String(d.modo)),
          },
        };
      case 'hemoterapia':
        return {
          ...base,
          detalhe: {
            tipo: 'hemoterapia',
            id: this.proximo++,
            ato: d.ato,
            codigo: d.codigo,
            nome: nomeDom('hemocomponentes', `${d.ato}:${d.codigo}`),
            dose: d.dose,
            unidade: d.unidade,
          },
        };
    }
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────

  async prescritores(_c: ContextoPrescricao, login: string) {
    const cbo = cboDe(login);
    return cbo === null ? [] : [{ cbo, ocupacao: ocupacaoDe(login), nome: `PROFISSIONAL ${M}` }];
  }

  async atendimentos(_c: ContextoPrescricao, paciente: number): Promise<AtendimentoLido[]> {
    if (!PACIENTES[paciente]) return [];
    const hoje = agoraLocal().slice(0, 10);
    return [
      {
        id: paciente * 10 + 1,
        numero: 31337,
        tipo: 'internacao',
        aberto: true,
        entrada: `${hoje}T07:00:00.000`,
        unidade: `UNIDADE ${M}`,
        leito: '101A',
        altaMedica: null,
        saida: null,
      },
      {
        id: paciente * 10 + 2,
        numero: 31336,
        tipo: 'pronto_atendimento',
        aberto: true,
        entrada: `${hoje}T06:00:00.000`,
        unidade: `PRONTO ATENDIMENTO ${M}`,
        leito: null,
        altaMedica: null,
        saida: null,
      },
    ];
  }

  async atendimento(_c: ContextoPrescricao, id: number): Promise<AtendimentoDaPrescricao | null> {
    const paciente = Math.floor(id / 10);
    if (!PACIENTES[paciente] || (id % 10 !== 1 && id % 10 !== 2)) return null;
    const interno = id % 10 === 1;
    return {
      id,
      numero: interno ? 31337 : 31336,
      paciente,
      tipo: interno ? 'I' : 'E',
      aberto: true,
      bloco: interno ? 'B1' : null,
      unidade: 1,
      convenio: 1,
    };
  }

  async retratos(_c: ContextoPrescricao, atendimento: number, paciente: number) {
    if (!PACIENTES[paciente] || Math.floor(atendimento / 10) !== paciente) return null;
    return { htAtendimento: atendimento * 10, htPaciente: paciente * 10, doPaciente: true };
  }

  async regras() {
    const regras: RegraHorarioLida[] = [
      { id: 3, tipoAtendimento: 'E', horarioInicial: '0000', considerar: 3, padrao: true, grade: GRADE_I },
      { id: 4, tipoAtendimento: 'I', horarioInicial: '1601', considerar: 0, padrao: true, grade: GRADE_I },
    ];
    return { regras, porBloco: new Map([['B1', 4]]), porUnidade: new Map([[1, 4]]) };
  }

  async relativos() {
    return RELATIVOS.map((r) => ({ ...r }));
  }

  async horariosDieta() {
    return new Map([[1, ['0700', '1145', '1445', '1601', '1800', '2000']]]);
  }

  async dominios() {
    return DOMINIOS;
  }

  async produtos(_c: ContextoPrescricao, ids: readonly number[]) {
    return PRODUTOS.filter((p) => ids.includes(p.produto));
  }

  async itensParaIndice() {
    // Os materiais sintéticos (600+) não são prescritíveis.
    return PRODUTOS.filter((p) => p.produto < 600).map((p) => ({
      produto: p.produto,
      nome: p.nome,
      unidade: p.unidade,
      padronizado: p.padronizado,
      psicotropico: p.psicotropico,
      portaria: p.portaria,
      antimicrobiano: p.antimicrobiano,
      potencialmentePerigoso: p.potencialmentePerigoso,
      principios: p.principios.map((x) => ({ ...x })),
      faixasDose: p.faixasDose.map((f) => ({ ...f })),
    }));
  }

  async kits(_c: ContextoPrescricao, p: number) {
    return KITS.filter((k) => k.produto === p);
  }

  async cadastro(_c: ContextoPrescricao, secao: SecaoCadastroPrescricao, termo: string | undefined) {
    const t = (termo ?? '').trim().toUpperCase();
    const nomeDe = (id: number) => PRODUTOS.find((p) => p.produto === id)?.nome ?? String(id);
    const casa = (n: string) => t === '' || n.toUpperCase().includes(t);
    const linhas: ConsultaCadastroLida['linhas'] = (() => {
      switch (secao) {
        case 'kitsMedicamento':
          return KITS.map((k) => ({
            id: String(k.id),
            nome: nomeDe(k.produto),
            ativo: true,
            campos: {
              doseDe: k.doseDe,
              doseAte: k.doseAte,
              unidade: k.unidade,
              via: k.via,
              atendimento: 'A',
            },
            filhos: k.itens.map((i) => ({
              nome: nomeDe(i.produto),
              campos: { quantidade: i.quantidade, unidade: i.unidade },
            })),
          }));
        case 'kitsSolucao':
          return [
            {
              id: '1',
              nome: `SORO DE MANUTENÇÃO ${M}`,
              ativo: true,
              campos: {
                frequencia: 'Contínuo',
                via: 'Endovenosa',
                agora: false,
                velocidade: 83.333,
                infusao: 'Bomba',
              },
              filhos: [
                { nome: nomeDe(508), campos: { quantidade: 1000, unidade: 'ML', principal: true } },
                { nome: nomeDe(504), campos: { quantidade: 20, unidade: 'ML', principal: false } },
              ],
            },
          ];
        case 'receitasPadrao':
          return [
            {
              id: '1',
              nome: `ANALGESIA DOMICILIAR ${M}`,
              ativo: true,
              campos: { geral: true, vigenteDesde: '2026-01-05', vigenteAte: null },
              filhos: [],
            },
          ];
        case 'naoPadronizados':
          return [
            {
              id: '10',
              nome: `XAROPE MANIPULADO ${M}`,
              ativo: true,
              campos: { unidade: 'ML', plano: 'Medicamentos' },
              filhos: [
                { nome: 'Oral', campos: { tipo: 'via' } },
                { nome: 'DIPIRONA', campos: { tipo: 'principio' } },
              ],
            },
          ];
        case 'parametrosItem':
          return t.length < 2
            ? []
            : PRODUTOS.filter((p) => p.produto < 600).map((p) => ({
                id: String(p.produto),
                nome: p.nome,
                ativo: true,
                campos: {
                  altaVigilancia: p.potencialmentePerigoso,
                  consistirDose: 1,
                  informacaoComplementar: 1,
                  doseAcima24h: false,
                  periodoMinimoHoras: null,
                  acessoInvasivo: false,
                  permanenciaInvasivo: 0,
                  balancoHidrico: false,
                  ncm: null,
                  excecaoTipi: null,
                  genero: null,
                },
                filhos: [],
              }));
      }
    })();
    return { linhas: linhas.filter((l) => casa(l.nome)), truncada: false };
  }

  async protocolos(): Promise<ProtocoloLido[]> {
    return [
      {
        id: 1,
        nome: `PROTOCOLO DE ANALGESIA ${M}`,
        ativo: true,
        vigenciaInicio: null,
        vigenciaFim: null,
        idadeMin: null,
        idadeMax: null,
        pesoMin: null,
        pesoMax: null,
        sexo: null,
        especialidades: [],
        itens: 2,
      },
      {
        id: 2,
        nome: `PROTOCOLO PEDIATRICO ${M}`,
        ativo: true,
        vigenciaInicio: null,
        vigenciaFim: null,
        idadeMin: null,
        idadeMax: 12,
        pesoMin: null,
        pesoMax: 40,
        sexo: null,
        especialidades: [],
        itens: 0,
      },
      {
        id: 3,
        nome: `PROTOCOLO DE OUTRA ESPECIALIDADE ${M}`,
        ativo: true,
        vigenciaInicio: null,
        vigenciaFim: null,
        idadeMin: null,
        idadeMax: null,
        pesoMin: null,
        pesoMax: null,
        sexo: null,
        especialidades: [999],
        itens: 0,
      },
    ];
  }

  async especialidadesDoPrescritor(): Promise<number[]> {
    return [1];
  }

  async itensDoProtocolo(c: ContextoPrescricao, id: number) {
    if (id !== 1) return [];
    const origem = this.presc(c.hospital).find((p) => !p.doNovo);
    return origem ? origem.itens.map((i) => ({ ...i, horarios: [] })) : [];
  }

  async prescricoes(c: ContextoPrescricao, atendimento: number) {
    return this.presc(c.hospital)
      .filter((p) => p.cab.atendimento === atendimento)
      .map((p) => ({ ...p.cab, itens: p.itens.length }))
      .reverse();
  }

  async cabecalho(c: ContextoPrescricao, id: number) {
    const p = this.presc(c.hospital).find((x) => x.cab.id === id);
    return p ? { ...p.cab, itens: p.itens.length } : null;
  }

  async itens(c: ContextoPrescricao, id: number) {
    return (
      this.presc(c.hospital)
        .find((x) => x.cab.id === id)
        ?.itens.map((i) => ({ ...i })) ?? []
    );
  }

  async alergias(_c: ContextoPrescricao, paciente: number): Promise<AlergiaLida[]> {
    return paciente === 1003 ? [{ alergia: 1, nome: `Penicilinas ${M}`, principios: [16] }] : [];
  }

  /** Dados SINTÉTICOS: o 1001 com peso, altura e creatinina; o 1003 sem peso (o cálculo por kg pede o dado). */
  async dadosClinicos(_c: ContextoPrescricao, paciente: number): Promise<DadosClinicosLidos> {
    return paciente === 1001
      ? {
          pesoKg: 72,
          alturaCm: 170,
          dataPeso: '2026-10-01',
          sexo: 'M',
          nascimento: '1958-03-14',
          creatinina: 1.6,
          dataCreatinina: '2026-10-20',
        }
      : {
          pesoKg: null,
          alturaCm: null,
          dataPeso: null,
          sexo: 'F',
          nascimento: '1990-07-02',
          creatinina: null,
          dataCreatinina: null,
        };
  }

  async produtosAtivos(
    c: ContextoPrescricao,
    atendimento: number,
    inicio: string,
    fim: string,
    exceto: number | null,
  ) {
    return this.presc(c.hospital)
      .filter(
        (p) =>
          p.cab.atendimento === atendimento &&
          p.cab.suspensaoEm === null &&
          (p.cab.inicio ?? '') <= `${fim.slice(0, 16)}:59` &&
          (p.cab.fim ?? '') >= inicio.slice(0, 16),
      )
      .flatMap((p) =>
        p.itens
          .filter(
            (i) =>
              i.id !== exceto &&
              i.detalhe.tipo === 'medicamento' &&
              i.horarios.some((h) => h.situacao !== 'S'),
          )
          .map((i) => ({
            item: i.id,
            produto: i.detalhe.tipo === 'medicamento' ? (i.detalhe.produto ?? 0) : 0,
            plano: i.plano,
          })),
      );
  }

  async dietaDeOutro() {
    return null;
  }

  async parametrosPrescricao() {
    return {
      consistirDuplicidade: true,
      porMedicamento: true,
      porPrincipio: true,
      calcularVelocidade: false,
    };
  }

  async regrasAlerta(c: ContextoPrescricao) {
    return [...this.lista(this.regrasSgh, c.hospital)];
  }

  async interacoes() {
    return null;
  }

  async prova(c: ContextoPrescricao, id: number) {
    const p = this.presc(c.hospital).find((x) => x.cab.id === id);
    return {
      eventos: p?.eventos ?? [],
      coassinaturaExigida: p?.coassinaturaExigida ?? false,
      coassinada: p?.coassinada ?? false,
    };
  }

  async hashAtual(c: ContextoPrescricao, id: number) {
    return this.presc(c.hospital).find((x) => x.cab.id === id)?.hash ?? '';
  }

  async marcas(c: ContextoPrescricao, ids: readonly number[]) {
    const m = new Map<number, { feitaNoNovo: boolean; coassinaturaPendente: boolean }>();
    for (const p of this.presc(c.hospital))
      if (ids.includes(p.cab.id))
        m.set(p.cab.id, {
          feitaNoNovo: p.doNovo,
          coassinaturaPendente: p.coassinaturaExigida && !p.coassinada,
        });
    return m;
  }

  async decisoes(c: ContextoPrescricao, id: number) {
    return this.presc(c.hospital).find((x) => x.cab.id === id)?.decisoes ?? [];
  }

  async futuras(c: ContextoPrescricao, atendimento: number) {
    return this.lista(this.futurasSgh, c.hospital).filter((f) => f.atendimento === atendimento);
  }

  async reconciliacoes(c: ContextoPrescricao, atendimento: number) {
    return this.lista(this.reconSgh, c.hospital).filter((r) => r.atendimento === atendimento);
  }

  async fichas(c: ContextoPrescricao, paciente: number | null) {
    return this.lista(this.fichasSgh, c.hospital).filter((f) => paciente === null || f.paciente === paciente);
  }

  async fichasAntigas() {
    return [];
  }

  async planejamentosAntigos() {
    return [];
  }

  async grades(c: ContextoPrescricao) {
    return [...this.lista(this.gradesSgh, c.hospital)];
  }

  async vencemAte(c: ContextoPrescricao, agora: string, ate: string, unidade: number | null) {
    // As internações sintéticas são todas da unidade 1 (leito 101A).
    if (unidade !== null && unidade !== 1) return [];
    return this.presc(c.hospital)
      .filter(
        (p) =>
          p.cab.suspensaoEm === null &&
          (p.cab.fim ?? '') >= agora.slice(0, 16) &&
          (p.cab.fim ?? '') <= `${ate.slice(0, 16)}:59`,
      )
      .map((p) => {
        const atendimento = p.cab.atendimento ?? 0;
        const paciente = Math.floor(atendimento / 10);
        return {
          prescricao: p.cab.id,
          atendimento,
          fim: p.cab.fim,
          paciente,
          nome: PACIENTES[paciente] ?? null,
          nomeSocial: null,
          unidade: 1,
          unidadeNome: `UNIDADE ${M}`,
          leito: atendimento % 10 === 1 ? '101A' : null,
        };
      });
  }

  async cabecalhoDocumento(
    _c: ContextoPrescricao,
    retratos: { htPaciente: number; htAtendimento: number },
    cbo: number,
  ): Promise<CabecalhoDocumentoLido> {
    return {
      hospital: [
        ['id_tbhospit', 1],
        ['nome', `HOSPITAL ${M}`],
      ],
      paciente: [
        ['id_htpaciente', retratos.htPaciente],
        ['nome', PACIENTES[Math.floor(retratos.htPaciente / 10)] ?? M],
      ],
      atendimento: [
        ['id_htatendimento', retratos.htAtendimento],
        ['tipo_atendimento', 'Internação'],
      ],
      profissional: [
        ['id_tbcbopro', cbo],
        ['nome', `PROFISSIONAL ${M}`],
      ],
      tipoAssinatura: 'Prescrição Geral',
      situacao: 'Prescrito',
    };
  }

  async agora() {
    return agoraLocal();
  }

  async podeGravar() {
    return { pode: true, codigo: null, motivo: null };
  }

  // ── Gravações (as conferências da receita, na memória) ─────────────────────────────────────────

  async prescrever(
    c: ContextoPrescricao,
    op: 'pep.prescrever' | 'pep.copiarPrescricao' | 'pep.renovarPrescricao',
    e: GravacaoPrescricao,
    ctx: CtxMemoria,
  ) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    const l = this.presc(c.hospital);
    const ini = e.vigencia.inicio.slice(0, 16);
    const fim = e.vigencia.fim.slice(0, 16);
    if (
      l.some(
        (p) =>
          p.cab.atendimento === e.atendimento &&
          p.cab.suspensaoEm === null &&
          (p.cab.inicio ?? '').slice(0, 16) <= fim &&
          (p.cab.fim ?? '').slice(0, 16) >= ini,
      )
    )
      throw new ErroOperacao(
        409,
        op === 'pep.renovarPrescricao' ? 'periodo-ocupado' : 'outra-ativa-no-periodo',
        'Operação recusada',
        'Já existe prescrição ativa no período.',
      );
    if (e.origem) {
      const o = this.achar(c.hospital, e.origem.prescricao);
      if (o.cab.suspensaoEm !== null)
        throw new ErroOperacao(
          409,
          'origem-alterada',
          'Operação recusada',
          'A prescrição de origem foi suspensa.',
        );
      const ativos = new Set(
        o.itens
          .filter((i) => i.horarios.every((h) => h.situacao !== 'S') || i.horarios.length === 0)
          .map((i) => i.id),
      );
      if (e.origem.itens.some((x) => x.ativo && !ativos.has(x.item)))
        throw new ErroOperacao(409, 'origem-alterada', 'Operação recusada', 'Item da origem suspenso.');
    }
    const id = this.proximo++;
    const agora = agoraLocal();
    const itens = e.itens.map((it) => this.lido(id, it, e.cbo, null));
    const p: PrescricaoMemoria = {
      cab: {
        id,
        atendimento: e.atendimento,
        htPaciente: e.retratos.htPaciente,
        htAtendimento: e.retratos.htAtendimento,
        dataHora: e.dataHora,
        inicio: `${ini}:00`,
        fim: `${fim}:00`,
        cbo: e.cbo,
        prescritor: `PROFISSIONAL ${M}`,
        suspensaoEm: null,
        suspensaoPor: null,
        suspensaoJustificativa: null,
        gravacao: agora,
        itens: itens.length,
      },
      itens,
      doNovo: true,
      coassinaturaExigida: e.sgh.coassinaturaExigida,
      coassinada: false,
      eventos: [],
      decisoes: e.sgh.decisoes.map((d) => ({
        item: null,
        chave: d.chave,
        tipo: d.tipo,
        decisao: d.decisao,
        justificativa: d.justificativa,
        regra: d.regra,
        versao: d.versaoRegra,
      })),
      hash: '',
    };
    this.selar(p, 'prescrito', null, loginDaOperacao(ctx), e.sgh.comoSuporte);
    l.push(p);
    await this.auditar(c, ctx, 'pep.prescricao.assinada', id, e.paciente);
    return { prescricao: id, horarios: itens.reduce((s, i) => s + i.horarios.length, 0) };
  }

  private selar(
    p: PrescricaoMemoria,
    tipo: string,
    item: number | null,
    usuario: string,
    comoSuporte: boolean,
  ) {
    p.hash = JSON.stringify(p.itens.map((i) => [i.id, i.horarios.map((h) => h.situacao).join('')]))
      .length.toString(16)
      .padStart(64, '0');
    p.eventos.push({ tipo, item, em: agoraLocal(), usuario, hashAnterior: p.hash, comoSuporte });
  }

  private vigente(p: PrescricaoMemoria): void {
    const agora = agoraLocal().slice(0, 16);
    if (p.cab.suspensaoEm !== null || (p.cab.fim ?? '').slice(0, 16) < agora)
      throw new ErroOperacao(
        409,
        'prescricao-nao-vigente',
        'Operação recusada',
        'A prescrição não está vigente.',
      );
  }

  async incluirItem(c: ContextoPrescricao, e: InclusaoItem, ctx: CtxMemoria) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    const p = this.achar(c.hospital, e.prescricao);
    this.vigente(p);
    const it = this.lido(p.cab.id, e.item, e.cbo, agoraLocal());
    p.itens.push(it);
    this.selar(p, 'item-incluido', it.id, loginDaOperacao(ctx), e.sgh.comoSuporte);
    await this.auditar(c, ctx, 'pep.item.incluido', p.cab.id, e.paciente);
    return { item: it.id };
  }

  async suspenderItem(c: ContextoPrescricao, e: SuspensaoItem, ctx: CtxMemoria) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    const p = this.achar(c.hospital, e.prescricao);
    this.vigente(p);
    const i = p.itens.findIndex((x) => x.id === e.item);
    const it = p.itens[i];
    if (
      !it ||
      it.horarios.length === 0 ||
      it.horarios.filter((h) => !h.acessoria).every((h) => h.situacao === 'S')
    )
      throw new ErroOperacao(409, 'item-nao-ativo', 'Operação recusada', 'O item já está suspenso.');
    let n = 0;
    const horarios = it.horarios.map((h) =>
      h.situacao === 'P' || h.situacao === 'p' ? (n++, { ...h, situacao: 'S' }) : h,
    );
    p.itens[i] = { ...it, horarios, corrigidoEm: e.correcao ? agoraLocal() : null };
    if (e.correcao) p.itens.push(this.lido(p.cab.id, e.correcao, e.cbo, agoraLocal()));
    this.selar(p, e.correcao ? 'item-corrigido' : 'item-suspenso', it.id, loginDaOperacao(ctx), e.comoSuporte);
    await this.auditar(c, ctx, 'pep.item.suspenso', p.cab.id, e.paciente);
    return { horarios: n };
  }

  async suspenderPrescricao(c: ContextoPrescricao, e: SuspensaoPrescricao, ctx: CtxMemoria) {
    this.conferirCbo(e.cbo, loginDaOperacao(ctx));
    const p = this.achar(c.hospital, e.prescricao);
    if (p.cab.suspensaoEm !== null)
      throw new ErroOperacao(
        409,
        'prescricao-nao-vigente',
        'Operação recusada',
        'A prescrição já está suspensa.',
      );
    let n = 0;
    p.itens = p.itens.map((i) => ({
      ...i,
      horarios: i.horarios.map((h) =>
        h.situacao === 'P' || h.situacao === 'p' ? (n++, { ...h, situacao: 'S' }) : h,
      ),
    }));
    p.cab = {
      ...p.cab,
      suspensaoEm: agoraLocal(),
      suspensaoPor: loginDaOperacao(ctx),
      suspensaoJustificativa: e.justificativa,
    };
    this.selar(p, 'suspensa', null, loginDaOperacao(ctx), e.comoSuporte);
    await this.auditar(c, ctx, 'pep.prescricao.suspensa', p.cab.id, e.paciente);
    return { horarios: n };
  }

  // ── Só no novo ─────────────────────────────────────────────────────────────────────────────────

  async coassinar(c: ContextoPrescricao, prescricao: number, usuario: string) {
    const p = this.achar(c.hospital, prescricao);
    p.coassinada = true;
    p.eventos.push({
      tipo: 'coassinado',
      item: null,
      em: agoraLocal(),
      usuario,
      hashAnterior: p.hash,
      comoSuporte: false,
    });
  }

  async gravarRegra(c: ContextoPrescricao, autor: string, r: Parameters<PortaPrescricao['gravarRegra']>[2]) {
    const l = this.lista(this.regrasSgh, c.hospital);
    const versao = l.filter((x) => x.codigo === r.codigo).reduce((m, x) => Math.max(m, x.versao), 1) + 1;
    const id = this.proximo++;
    l.push({
      id,
      codigo: r.codigo,
      tipo: r.tipo,
      nivel: r.nivel,
      versao,
      vigenteDesde: r.vigenteDesde,
      ativa: r.ativa,
      descricao: r.descricao,
      autor,
      criadaEm: agoraLocal(),
    });
    return { id, versao };
  }

  async programarFutura(
    c: ContextoPrescricao,
    _u: string,
    f: Parameters<PortaPrescricao['programarFutura']>[2],
  ) {
    const id = this.proximo++;
    this.lista(this.futurasSgh, c.hospital).push({
      id,
      atendimento: f.atendimento,
      paciente: f.paciente,
      aPartirDe: f.aPartirDe,
      descricao: f.descricao,
      situacao: 'programada',
      prescricao: null,
      itemJson: f.itemJson,
    });
    return id;
  }

  async cancelarFutura(c: ContextoPrescricao, _u: string, paciente: number, id: number) {
    const l = this.lista(this.futurasSgh, c.hospital);
    const i = l.findIndex((f) => f.id === id && f.paciente === paciente);
    const f = l[i];
    if (!f)
      throw new ErroOperacao(
        404,
        'registro-inexistente',
        'Não encontrada',
        'A prescrição futura não foi encontrada para este paciente.',
      );
    if (f.situacao !== 'programada')
      throw new ErroOperacao(
        409,
        'futura-nao-programada',
        'Operação recusada',
        'A prescrição futura não está programada.',
      );
    l[i] = { ...f, situacao: 'cancelada' };
  }

  async registrarReconciliacao(
    c: ContextoPrescricao,
    u: string,
    r: Parameters<PortaPrescricao['registrarReconciliacao']>[2],
  ) {
    const lote = this.proximo++;
    this.lista(this.reconSgh, c.hospital).push({
      lote,
      atendimento: r.atendimento,
      momento: r.momento,
      em: agoraLocal(),
      usuario: u,
      linhas: r.linhas.map((x) => ({ ...x })),
    });
    return lote;
  }

  async registrarFicha(
    c: ContextoPrescricao,
    _u: string,
    f: Parameters<PortaPrescricao['registrarFicha']>[2],
  ) {
    const id = this.proximo++;
    this.lista(this.fichasSgh, c.hospital).push({
      id,
      paciente: f.paciente,
      item: f.item,
      produto: f.produto,
      produtoNome: PRODUTOS.find((p) => p.produto === f.produto)?.nome ?? null,
      indicacao: f.indicacao,
      sitio: f.sitio,
      tipo: f.tipo,
      culturaColhida: f.culturaColhida,
      diaTratamento: f.diaTratamento,
      em: agoraLocal(),
    });
    return id;
  }

  async gravarGrade(c: ContextoPrescricao, autor: string, g: Parameters<PortaPrescricao['gravarGrade']>[2]) {
    const id = this.proximo++;
    this.lista(this.gradesSgh, c.hospital).push({ id, ...g, horarios: [...g.horarios], autor });
    return id;
  }
}
