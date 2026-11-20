// Porta da nutrição, do mapa de dietas e do serviço social na sessão sintética (M45, etapa 5; dev e ci, E2E @M45.5):
// cinco internados SINTÉTICOS em duas unidades (enfermaria e terapia intensiva) admitidos em horas relativas ao relógio
// (a triagem a fazer, em atenção e vencida), as prescrições de dieta (oral com características, livre, enteral com as
// checagens de volume), uma alergia alimentar, a cirurgia agendada todos os dias às 13:30 de um deles (o jejum do bloco)
// e os vínculos profissionais pelo nome do login (NUTRI, SOCIAL, ENFERM, MEDICO, FARMA). As gravações ficam em memória,
// com as mesmas recusas do banco (um retrato por unidade, refeição e dia; uma refeição de acompanhante vigente). Nenhum
// dado real.
import type { LiberacaoConsultada } from '@sgh/legado';
import type {
  AlteracaoHotSghLida,
  CorrecaoSghLida,
  AcompanhamentoSghLido,
  AcompanhanteSghLido,
  BarreiraLida,
  ChecagemDietaLida,
  CirurgiaDaJanelaLida,
  DietaEnteralSghLida,
  InternadoNutricaoLido,
  ItemDietaMapaLido,
  MetaTerapiaSghLida,
  RegistroSocialSghLido,
  RetratoMapaLido,
  TriagemSghLida,
} from '@sgh/legado';
import { ErroOperacao } from '@sgh/legado';
import type {
  AvaliacaoNptLida,
  RegistroCorrigivel,
  RiscoSocial,
  TipoRegistroSocial,
  VolumeBalanco,
} from '@sgh/contratos';
import type { ContextoNutricao, GravadorNutricao, PortaNutricao, VinculoDoLogin } from './porta.js';

const p2 = (n: number) => String(n).padStart(2, '0');
/** "AAAA-MM-DDTHH:MM" de um Date (componentes locais do processo; a sessão sintética roda no fuso da máquina). */
function local(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
const somarHoras = (iso: string, h: number) => {
  const d = new Date(`${iso}:00`);
  d.setTime(d.getTime() + h * 3_600_000);
  return local(d);
};
const somarDias = (dia: string, n: number) => somarHoras(`${dia}T12:00`, n * 24).slice(0, 10);
const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);

interface Sintetico {
  readonly internado: Omit<InternadoNutricaoLido, 'admissao'> & { readonly horasAtras: number };
  readonly dieta: {
    readonly plano: number;
    readonly dieta: number;
    readonly nome: string;
    readonly quantidade: string | null;
    readonly caracteristicas: { nome: string; resposta: string | null }[];
  };
  readonly alergias: string[];
}

const SINTETICOS: readonly Sintetico[] = [
  {
    internado: {
      reg: 950_001,
      pront: 70_001,
      paciente: 99_501,
      atendimento: 960_001,
      nome: 'MARIA SINTETICA DA SILVA',
      nascimento: '1948-03-07',
      bloco: '2A',
      acomodacao: '201',
      leito: 'A',
      tipoAcomodacaoAtual: 1,
      horasAtras: 50,
    },
    dieta: {
      plano: 3,
      dieta: 1,
      nome: 'DIETA ORAL',
      quantidade: null,
      caracteristicas: [
        { nome: 'Branda', resposta: null },
        { nome: 'Hipossódica', resposta: null },
      ],
    },
    alergias: ['Leite'],
  },
  {
    internado: {
      reg: 950_002,
      pront: 70_002,
      paciente: 99_502,
      atendimento: 960_002,
      nome: 'JOAO SINTETICO PEREIRA',
      nascimento: '1980-05-10',
      bloco: '2A',
      acomodacao: '201',
      leito: 'B',
      tipoAcomodacaoAtual: 1,
      horasAtras: 30,
    },
    dieta: { plano: 3, dieta: 1, nome: 'DIETA ORAL', quantidade: null, caracteristicas: [] },
    alergias: [],
  },
  {
    internado: {
      reg: 950_003,
      pront: 70_003,
      paciente: 99_503,
      atendimento: 960_003,
      nome: 'ANA SINTETICA COSTA',
      nascimento: '1990-11-20',
      bloco: '2A',
      acomodacao: '202',
      leito: 'A',
      tipoAcomodacaoAtual: 2,
      horasAtras: 6,
    },
    dieta: { plano: 2, dieta: 5, nome: 'DIETA LIVRE', quantidade: null, caracteristicas: [] },
    alergias: [],
  },
  {
    internado: {
      reg: 950_004,
      pront: 70_004,
      paciente: 99_504,
      atendimento: 960_004,
      nome: 'PEDRO SINTETICO ALVES',
      nascimento: '1955-01-15',
      bloco: 'UTI',
      acomodacao: '01',
      leito: 'A',
      tipoAcomodacaoAtual: 3,
      horasAtras: 72,
    },
    dieta: { plano: 4, dieta: 2, nome: 'DIETA ENTERAL', quantidade: '1200 ML', caracteristicas: [] },
    alergias: [],
  },
  {
    internado: {
      reg: 950_005,
      pront: 70_005,
      paciente: 99_505,
      atendimento: 960_005,
      nome: 'LUCIA SINTETICA ROCHA',
      nascimento: '2015-06-01',
      bloco: '2A',
      acomodacao: '203',
      leito: 'A',
      tipoAcomodacaoAtual: 13,
      horasAtras: 100,
    },
    dieta: {
      plano: 3,
      dieta: 1,
      nome: 'DIETA ORAL',
      quantidade: null,
      caracteristicas: [{ nome: 'Pastosa', resposta: null }],
    },
    alergias: ['Amendoim'],
  },
];

/** A cirurgia sintética: o internado 950.002 tem cirurgia agendada todos os dias às 13:30, 90 minutos, sala 2. */
const REG_CIRURGIA = 950_002;

function vinculosSinteticos(login: string): VinculoDoLogin[] {
  const l = login.toUpperCase();
  const cbo = /NUTRI/.test(l)
    ? '223710'
    : /SOCIAL/.test(l)
      ? '251605'
      : /ENFERM/.test(l)
        ? '223505'
        : /FARMA/.test(l)
          ? '223405'
          : /MEDICO/.test(l)
            ? '225125'
            : null;
  return cbo ? [{ vinculo: 7_450, cbo, ativo: true }] : [];
}

export class PortaNutricaoMemoria implements PortaNutricao {
  readonly destino = 'memoria' as const;
  private seq = 1;
  private readonly inicio: string;
  readonly triagensGravadas: (TriagemSghLida & { hospital: string })[] = [];
  readonly metasGravadas: (MetaTerapiaSghLida & { hospital: string; reg: number })[] = [];
  readonly acompanhamentosGravados: (AcompanhamentoSghLido & { hospital: string; reg: number })[] = [];
  readonly retratos: (RetratoMapaLido & {
    hospital: string;
    unidade: string;
    refeicao: number;
    data: string;
  })[] = [];
  readonly acompanhantesGravados: (AcompanhanteSghLido & { hospital: string })[] = [];
  readonly sociaisGravados: (RegistroSocialSghLido & { hospital: string })[] = [];
  readonly barreirasGravadas: (BarreiraLida & { hospital: string })[] = [];
  // W0-05: as correções, as avaliações da NPT e o log das alterações do acompanhante.
  readonly correcoesGravadas: (CorrecaoSghLida & { hospital: string })[] = [];
  readonly avaliacoesNptGravadas: (AvaliacaoNptLida & { hospital: string; reg: number })[] = [];
  readonly alteracoesGravadas: (AlteracaoHotSghLida & { hospital: string })[] = [];
  /** Testes: o balanço sintético da parenteral por atendimento (o 960005 tem NPT lançada ontem e anteontem). */
  readonly balancos = new Map<number, VolumeBalanco[]>();
  /** Testes: as internações que saíram da unidade (alta ou transferência) e as sem atendimento vinculado. */
  readonly sairam = new Set<number>();
  readonly semAtendimento = new Set<number>();

  constructor(private readonly relogioFixo: (() => Date) | null = null) {
    this.inicio = local(this.agoraDate());
  }

  private agoraDate(): Date {
    return this.relogioFixo ? this.relogioFixo() : new Date();
  }

  private agora(): string {
    return local(this.agoraDate());
  }

  private internadosBase(): InternadoNutricaoLido[] {
    return SINTETICOS.filter((x) => !this.sairam.has(x.internado.reg)).map((x) => {
      const { horasAtras, ...i } = x.internado;
      return {
        ...i,
        atendimento: this.semAtendimento.has(i.reg) ? null : i.atendimento,
        admissao: somarHoras(this.inicio, -horasAtras),
      };
    });
  }

  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<never> {
    throw new Error('A nutrição e o serviço social não gravam pelo executor: só SGH_.');
  }

  async gravarSgh<T>(
    c: ContextoNutricao,
    _trilha: unknown,
    fn: (g: GravadorNutricao) => Promise<T>,
  ): Promise<T> {
    const h = c.hospital;
    const agora = this.agora();
    // A transação em memória: o que a função grava só entra no estado se ela terminar sem erro.
    const pendentes: (() => void)[] = [];
    const id = () => this.seq++;
    const r = await fn({
      triar: async (t) => {
        const x = id();
        pendentes.push(() =>
          this.triagensGravadas.unshift({
            hospital: h,
            id: x,
            reg: t.reg,
            instrumento: t.instrumento,
            versao: t.versao,
            total: t.total,
            estado: t.estado,
            gravidade: t.gravidade,
            idade: t.idade,
            risco: t.risco,
            conduta: t.conduta,
            imc: t.imc,
            horasDesdeAdmissao: t.horasDesdeAdmissao,
            reavaliarEm: t.reavaliarEm,
            por: t.usuario,
            em: agora,
            inativa: false,
          }),
        );
        return x;
      },
      registrarMeta: async (m) => {
        const x = id();
        pendentes.push(() =>
          this.metasGravadas.unshift({
            hospital: h,
            reg: m.reg,
            id: x,
            via: m.via,
            itemDieta: m.itemDieta,
            pesoKg: m.pesoKg,
            kcalPorKg: m.kcalPorKg,
            proteinaGPorKg: m.proteinaGPorKg,
            metaKcal: m.metaKcal,
            metaProteinaG: m.metaProteinaG,
            densidadeKcalMl: m.densidadeKcalMl,
            proteinaGL: m.proteinaGL,
            metaVolumeMl: m.metaVolumeMl,
            por: m.usuario,
            em: agora,
            origemTerapia: m.origemTerapia ?? (m.itemDieta === null ? 'informada' : 'prescrita'),
            observacao: m.observacao,
          }),
        );
        return x;
      },
      registrarAcompanhamento: async (a) => {
        const meta = this.metasGravadas.find((m) => m.id === a.meta && m.hospital === h);
        if (!meta || meta.reg !== a.reg)
          throw recusa('meta-de-outra-internacao', 'A meta de terapia nutricional não é desta internação.');
        const x = id();
        pendentes.push(() =>
          this.acompanhamentosGravados.unshift({
            hospital: h,
            reg: a.reg,
            id: x,
            meta: a.meta,
            data: a.data,
            volumePrescritoMl: a.volumePrescritoMl,
            volumeInfundidoMl: a.volumeInfundidoMl,
            origemVolume: a.origemVolume,
            kcalAtingida: a.kcalAtingida,
            proteinaAtingidaG: a.proteinaAtingidaG,
            pctKcal: a.pctKcal,
            pctProteina: a.pctProteina,
            motivo: a.motivo,
            observacao: a.observacao,
            por: a.usuario,
            em: agora,
          }),
        );
        return x;
      },
      fecharMapa: async (m) => {
        if (
          this.retratos.some(
            (r) =>
              r.hospital === h && r.unidade === m.unidade && r.refeicao === m.refeicao && r.data === m.data,
          )
        )
          throw recusa('mapa-ja-fechado', 'O mapa desta refeição já foi fechado: o retrato não é regravado.');
        const x = id();
        pendentes.push(() =>
          this.retratos.push({
            hospital: h,
            unidade: m.unidade,
            refeicao: m.refeicao,
            data: m.data,
            id: x,
            corteEm: m.corteEm,
            itens: m.linhas.length,
            jejuns: m.linhas.filter((l) => l.tipo === 'jejum').length,
            hash: m.hash,
            por: m.usuario,
            em: agora,
            linhas: m.linhas.map((l) => ({
              reg: l.reg,
              acomodacao: l.acomodacao,
              leito: l.leito,
              tipo: l.tipo,
              itemDieta: l.itemDieta,
              dieta: l.nomeDieta,
              caracteristicas: l.caracteristicas,
              jejumOrigem: l.jejumOrigem,
            })),
          }),
        );
        return x;
      },
      registrarAcompanhante: async (a) => {
        if (
          this.acompanhantesGravados.some(
            (x) => x.hospital === h && x.reg === a.reg && x.situacao === 'ativa',
          )
        )
          throw recusa(
            'acompanhante-vigente',
            'A internação já tem a refeição do acompanhante vigente: encerre a atual antes de registrar outra.',
          );
        const x = id();
        pendentes.push(() =>
          this.acompanhantesGravados.unshift({
            hospital: h,
            id: x,
            reg: a.reg,
            baseLegal: a.baseLegal,
            refeicoes: [...new Set(a.refeicoes)].sort((p, q) => p - q),
            inicio: a.inicio,
            fim: a.fim,
            observacao: a.observacao,
            situacao: 'ativa',
            por: a.usuario,
            em: agora,
            dieta: null,
          }),
        );
        return x;
      },
      encerrarAcompanhante: async (a) => {
        const i = this.acompanhantesGravados.findIndex((x) => x.id === a.id && x.hospital === h);
        const atual = this.acompanhantesGravados[i];
        if (!atual || atual.situacao !== 'ativa')
          throw recusa('acompanhante-desatualizado', 'A refeição do acompanhante já foi encerrada.');
        pendentes.push(() => {
          this.acompanhantesGravados[i] = { ...atual, situacao: 'encerrada' };
        });
        return 1;
      },
      registrarSocial: async (a) => {
        const barreira = a.barreira ? id() : null;
        const x = id();
        pendentes.push(() => {
          if (a.barreira && barreira !== null)
            this.barreirasGravadas.push({
              hospital: h,
              id: barreira,
              reg: a.reg,
              tipo: 'social',
              descricao: a.barreira.descricao,
              responsavel: a.barreira.responsavel,
              prazo: a.barreira.prazo,
              situacao: 'aberta',
              criadaPor: a.usuario,
              criadaEm: agora,
              resolvidaEm: null,
            });
          this.sociaisGravados.unshift({
            hospital: h,
            id: x,
            reg: a.reg,
            tipo: a.tipo,
            redeApoio: a.redeApoio,
            vulnerabilidades: [...new Set(a.vulnerabilidades)],
            risco: a.risco,
            encaminhamentos: [...new Set(a.encaminhamentos)],
            parecer: a.parecer,
            orientacoes: a.orientacoes,
            barreira,
            por: a.usuario,
            em: agora,
            adendoDe: null,
            motivoAdendo: null,
          });
        });
        return { id: x, barreira };
      },
      registrarEvento: async () => undefined,
      corrigir: async (k) => {
        const existe =
          k.registro === 'triagem'
            ? this.triagensGravadas.find((x) => x.hospital === h && x.id === k.id)
            : k.registro === 'meta'
              ? this.metasGravadas.find((x) => x.hospital === h && x.id === k.id)
              : k.registro === 'acompanhamento'
                ? this.acompanhamentosGravados.find((x) => x.hospital === h && x.id === k.id)
                : this.sociaisGravados.find((x) => x.hospital === h && x.id === k.id);
        if (!existe || existe.reg !== k.reg)
          throw recusa('registro-de-outra-internacao', 'O registro não existe ou não é desta internação.');
        if (
          this.correcoesGravadas.some(
            (x) => x.hospital === h && x.registro === k.registro && x.idRegistro === k.id,
          )
        )
          throw recusa(
            'registro-ja-corrigido',
            'O registro já foi retificado, estornado ou encerrado (inativo).',
          );
        const x = id();
        pendentes.push(() =>
          this.correcoesGravadas.push({
            hospital: h,
            registro: k.registro,
            idRegistro: k.id,
            acao: k.acao,
            idNovo: k.idNovo,
            motivo: k.motivo,
            por: k.usuario,
            em: agora,
          }),
        );
        return x;
      },
      avaliarNpt: async (a) => {
        const m = this.metasGravadas.find((x) => x.hospital === h && x.id === a.meta);
        if (!m || m.reg !== a.reg || m.via !== 'parenteral')
          throw recusa('meta-nao-parenteral', 'A meta não é uma terapia parenteral desta internação.');
        if (this.avaliacoesNptGravadas.some((x) => x.hospital === h && x.meta === a.meta))
          throw recusa(
            'avaliacao-registrada',
            'A avaliação farmacêutica desta formulação já foi registrada e não se edita.',
          );
        const x = id();
        pendentes.push(() =>
          this.avaliacoesNptGravadas.unshift({
            hospital: h,
            reg: a.reg,
            id: x,
            meta: a.meta,
            parecer: a.parecer,
            acesso: a.acesso,
            osmolaridade: a.osmolaridade,
            estabilidade: a.estabilidade,
            compatibilidade: a.compatibilidade,
            observacao: a.observacao,
            por: a.usuario,
            em: agora,
          }),
        );
        return x;
      },
      adendoSocial: async (a) => {
        const o = this.sociaisGravados.find((x) => x.hospital === h && x.id === a.de);
        if (!o || o.reg !== a.reg)
          throw recusa('registro-de-outra-internacao', 'O registro social não existe.');
        if (
          this.correcoesGravadas.some(
            (x) => x.hospital === h && x.registro === 'social' && x.idRegistro === a.de,
          )
        )
          throw recusa('registro-ja-corrigido', 'O registro foi estornado (inativo).');
        const x = id();
        pendentes.push(() =>
          this.sociaisGravados.unshift({
            ...o,
            id: x,
            tipo: 'adendo',
            vulnerabilidades: [],
            encaminhamentos: [],
            parecer: a.texto,
            orientacoes: null,
            barreira: null,
            por: a.usuario,
            em: agora,
            adendoDe: a.de,
            motivoAdendo: a.motivo,
          }),
        );
        return x;
      },
      alterarAcompanhante: async (a) => {
        const i = this.acompanhantesGravados.findIndex((x) => x.id === a.id && x.hospital === h);
        const atual = this.acompanhantesGravados[i];
        if (!atual || atual.situacao !== 'ativa' || (a.fim !== null && a.fim < atual.inicio))
          throw recusa(
            'acompanhante-desatualizado',
            'A refeição do acompanhante foi encerrada (ou o fim ficou antes do início).',
          );
        pendentes.push(() => {
          this.acompanhantesGravados[i] = {
            ...atual,
            dieta: a.dieta,
            refeicoes: [...new Set(a.refeicoes)].sort((p, q) => p - q),
            fim: a.fim,
            observacao: a.observacao,
          };
        });
        return {
          dieta: atual.dieta,
          refeicoes: [...atual.refeicoes].sort((p, q) => p - q),
          fim: atual.fim,
          observacao: atual.observacao,
        };
      },
      registrarAlteracao: async (a) => {
        const x = id();
        pendentes.push(() =>
          this.alteracoesGravadas.unshift({
            hospital: h,
            id: x,
            idRegistro: a.id,
            evento: a.evento,
            antes: a.antes,
            depois: a.depois,
            motivo: a.motivo,
            por: a.usuario,
            em: agora,
          }),
        );
        return x;
      },
    });
    for (const f of pendentes) f();
    return r;
  }

  async relogio(): Promise<{ agora: string; hoje: string }> {
    const agora = this.agora();
    return { agora, hoje: agora.slice(0, 10) };
  }

  async vinculos(_c: ContextoNutricao, login: string): Promise<VinculoDoLogin[]> {
    return vinculosSinteticos(login);
  }

  /** A conta compartilhada sintética (o login com COMPARTILHAD no nome) tem 150 cadastros; as demais, um. */
  async cadastrosDoLogin(_c: ContextoNutricao, login: string): Promise<number> {
    return /COMPARTILHAD/i.test(login) ? 150 : 1;
  }

  async internados(_c: ContextoNutricao, unidade: string | null) {
    const itens = this.internadosBase().filter((i) => unidade === null || i.bloco === unidade);
    return { itens, cortada: false };
  }

  async internacao(_c: ContextoNutricao, reg: number) {
    const i = this.internadosBase().find((x) => x.reg === reg);
    return i ? { ...i, aberta: true } : null;
  }

  async triagens(c: ContextoNutricao, regs: readonly number[]): Promise<TriagemSghLida[]> {
    const inativa = (id: number) =>
      this.correcoesGravadas.some(
        (k) => k.hospital === c.hospital && k.registro === 'triagem' && k.idRegistro === id,
      );
    return this.triagensGravadas
      .filter((t) => t.hospital === c.hospital && regs.includes(t.reg))
      .map((t) => ({ ...t, inativa: inativa(t.id) }));
  }

  async comMeta(c: ContextoNutricao, regs: readonly number[]): Promise<Set<number>> {
    return new Set(
      this.metasGravadas
        .filter(
          (m) =>
            m.hospital === c.hospital &&
            regs.includes(m.reg) &&
            !this.correcoesGravadas.some(
              (k) => k.registro === 'meta' && k.idRegistro === m.id && k.acao === 'encerramento',
            ),
        )
        .map((m) => m.reg),
    );
  }

  private vigencia() {
    const hoje = this.inicio.slice(0, 10);
    return {
      gravadaEm: `${somarDias(hoje, -2)}T08:00`,
      vigenciaInicio: `${somarDias(hoje, -2)}T00:00`,
      vigenciaFim: `${somarDias(hoje, 3)}T23:59`,
    };
  }

  async dietasEnterais(_c: ContextoNutricao, atendimento: number): Promise<DietaEnteralSghLida[]> {
    const x = SINTETICOS.find((s) => s.internado.atendimento === atendimento);
    if (!x || (x.dieta.plano !== 4 && x.dieta.plano !== 5)) return [];
    const v = this.vigencia();
    return [
      {
        itemDieta: 970_000 + (atendimento % 1000),
        item: 980_000 + (atendimento % 1000),
        prescricao: 990_000 + (atendimento % 1000),
        plano: x.dieta.plano,
        dieta: x.dieta.dieta,
        nomeDieta: x.dieta.nome,
        quantidade: 1200,
        velocidade: 50,
        vigenciaInicio: v.vigenciaInicio,
        vigenciaFim: v.vigenciaFim,
        suspensa: false,
        cboLancamento: '223710',
      },
    ];
  }

  async checagens(
    _c: ContextoNutricao,
    itens: readonly number[],
    desde: string,
  ): Promise<ChecagemDietaLida[]> {
    const r: ChecagemDietaLida[] = [];
    const hoje = this.agora().slice(0, 10);
    for (const item of itens) {
      if (item < 980_000) continue;
      for (const d of [-2, -1, 0]) {
        const dia = somarDias(hoje, d);
        for (const h of ['06:00', '12:00', '18:00', '00:00']) {
          const previsto = `${dia}T${h}`;
          if (previsto < desde.slice(0, 16)) continue;
          // Ontem e anteontem administradas com 250 mL; hoje, previstas.
          const administrada = d < 0;
          r.push({
            item,
            previsto,
            situacao: administrada ? 'A' : 'P',
            quantidade: administrada ? 250 : null,
            situacaoEm: administrada ? previsto : null,
          });
        }
      }
    }
    return r;
  }

  async primeiraAdministrada(_c: ContextoNutricao, itens: readonly number[]): Promise<string | null> {
    return itens.some((i) => i >= 980_000) ? `${somarDias(this.agora().slice(0, 10), -2)}T06:00` : null;
  }

  async terapia(c: ContextoNutricao, reg: number) {
    return {
      metas: this.metasGravadas.filter((m) => m.hospital === c.hospital && m.reg === reg),
      acompanhamentos: this.acompanhamentosGravados.filter((a) => a.hospital === c.hospital && a.reg === reg),
    };
  }

  async meta(c: ContextoNutricao, id: number) {
    const m = this.metasGravadas.find((x) => x.id === id && x.hospital === c.hospital);
    return m ?? null;
  }

  async fichas(): Promise<{ quantidade: number; ultima: string | null }> {
    return { quantidade: 0, ultima: null };
  }

  async sociais(c: ContextoNutricao, reg: number): Promise<RegistroSocialSghLido[]> {
    return this.sociaisGravados.filter((x) => x.hospital === c.hospital && x.reg === reg);
  }

  async ultimosSociais(c: ContextoNutricao, regs: readonly number[]) {
    const m = new Map<number, { risco: RiscoSocial; tipo: TipoRegistroSocial; em: string }>();
    for (const x of this.sociaisGravados)
      if (
        x.hospital === c.hospital &&
        regs.includes(x.reg) &&
        !m.has(x.reg) &&
        x.tipo !== 'adendo' &&
        !this.correcoesGravadas.some((k) => k.registro === 'social' && k.idRegistro === x.id)
      )
        m.set(x.reg, { risco: x.risco, tipo: x.tipo as TipoRegistroSocial, em: x.em });
    return m;
  }

  async barreirasSociais(c: ContextoNutricao, regs: readonly number[]) {
    const m = new Map<number, number>();
    for (const b of this.barreirasGravadas)
      if (b.hospital === c.hospital && regs.includes(b.reg) && b.tipo === 'social' && b.situacao === 'aberta')
        m.set(b.reg, (m.get(b.reg) ?? 0) + 1);
    return m;
  }

  async barreiras(c: ContextoNutricao, regs: readonly number[]): Promise<BarreiraLida[]> {
    return this.barreirasGravadas.filter((b) => b.hospital === c.hospital && regs.includes(b.reg));
  }

  async unidades() {
    const base = this.internadosBase();
    return [
      { unidade: '2A', nome: 'ENFERMARIA 2º ANDAR', internados: base.filter((i) => i.bloco === '2A').length },
      { unidade: 'UTI', nome: 'TERAPIA INTENSIVA', internados: base.filter((i) => i.bloco === 'UTI').length },
    ];
  }

  async refeicoes() {
    return [
      { codigo: 1, nome: 'Café da manhã', horario: '0700' },
      { codigo: 2, nome: 'Almoço', horario: '1145' },
      { codigo: 3, nome: 'Lanche da tarde', horario: '1445' },
      { codigo: 5, nome: 'Jantar', horario: '1800' },
      { codigo: 6, nome: 'Ceia', horario: '2000' },
    ];
  }

  async itensDieta(_c: ContextoNutricao, atendimentos: readonly number[]): Promise<ItemDietaMapaLido[]> {
    const v = this.vigencia();
    return SINTETICOS.filter(
      (x) => x.internado.atendimento !== null && atendimentos.includes(x.internado.atendimento),
    ).map((x) => {
      const a = x.internado.atendimento as number;
      return {
        atendimento: a,
        item: 980_000 + (a % 1000),
        itemDieta: 970_000 + (a % 1000),
        prescricao: 990_000 + (a % 1000),
        plano: x.dieta.plano,
        dieta: x.dieta.dieta,
        nomeDieta: x.dieta.nome,
        quantidade: x.dieta.quantidade,
        gravadaEm: v.gravadaEm,
        vigenciaInicio: v.vigenciaInicio,
        vigenciaFim: v.vigenciaFim,
        suspensaEm: null,
        caracteristicas: x.dieta.caracteristicas,
      };
    });
  }

  async alergiasAlimentares(_c: ContextoNutricao, pacientes: readonly number[]) {
    const m = new Map<number, string[]>();
    for (const x of SINTETICOS)
      if (pacientes.includes(x.internado.paciente) && x.alergias.length)
        m.set(x.internado.paciente, x.alergias);
    return m;
  }

  async cirurgias(_c: ContextoNutricao, de: string, ate: string): Promise<CirurgiaDaJanelaLida[]> {
    const r: CirurgiaDaJanelaLida[] = [];
    for (let dia = de.slice(0, 10); dia <= ate.slice(0, 10); dia = somarDias(dia, 1)) {
      const inicio = `${dia}T13:30`;
      if (inicio >= de.slice(0, 16) && inicio <= ate.slice(0, 16))
        r.push({
          agendamento: 1_000 + r.length,
          reg: REG_CIRURGIA,
          pront: 70_002,
          sala: 2,
          inicio,
          duracaoMin: 90,
        });
    }
    return r;
  }

  async exames() {
    return [];
  }

  async acompanhantesVigentes(c: ContextoNutricao, regs: readonly number[]) {
    const m = new Map<number, AcompanhanteSghLido>();
    for (const a of this.acompanhantesGravados)
      if (a.hospital === c.hospital && regs.includes(a.reg) && a.situacao === 'ativa') m.set(a.reg, a);
    return m;
  }

  // ── W0-05 ──

  async correcoes(c: ContextoNutricao, registro: RegistroCorrigivel, ids: readonly number[]) {
    const inativa = new Map<number, CorrecaoSghLida>();
    const substitui = new Map<number, number>();
    for (const k of this.correcoesGravadas) {
      if (k.hospital !== c.hospital || k.registro !== registro) continue;
      if (ids.includes(k.idRegistro)) inativa.set(k.idRegistro, k);
      if (k.idNovo !== null && ids.includes(k.idNovo)) substitui.set(k.idNovo, k.idRegistro);
    }
    return { inativa, substitui };
  }

  async internacaoDoRegistro(c: ContextoNutricao, registro: RegistroCorrigivel, id: number) {
    const lista: readonly { hospital: string; id: number; reg: number }[] =
      registro === 'triagem'
        ? this.triagensGravadas
        : registro === 'meta'
          ? this.metasGravadas
          : registro === 'acompanhamento'
            ? this.acompanhamentosGravados
            : this.sociaisGravados;
    return lista.find((x) => x.hospital === c.hospital && x.id === id)?.reg ?? null;
  }

  async avaliacoesNpt(c: ContextoNutricao, reg: number): Promise<AvaliacaoNptLida[]> {
    return this.avaliacoesNptGravadas.filter((x) => x.hospital === c.hospital && x.reg === reg);
  }

  async balancoParenteral(
    _c: ContextoNutricao,
    atendimento: number,
    desde: string,
  ): Promise<VolumeBalanco[]> {
    const proprio = this.balancos.get(atendimento);
    const hoje = this.agora().slice(0, 10);
    const base =
      proprio ??
      (atendimento === 960_005
        ? [
            { data: somarDias(hoje, -1), lancamentos: 2, volumeMl: 1400 },
            { data: somarDias(hoje, -2), lancamentos: 1, volumeMl: 1000 },
          ]
        : []);
    return base.filter((v) => v.data >= desde.slice(0, 10));
  }

  async alteracoesAcompanhante(c: ContextoNutricao, ids: readonly number[]) {
    return this.alteracoesGravadas.filter((x) => x.hospital === c.hospital && ids.includes(x.idRegistro));
  }

  async acompanhantes(c: ContextoNutricao, reg: number) {
    return this.acompanhantesGravados.filter((a) => a.hospital === c.hospital && a.reg === reg);
  }

  async acompanhante(c: ContextoNutricao, id: number) {
    return this.acompanhantesGravados.find((a) => a.hospital === c.hospital && a.id === id) ?? null;
  }

  async retrato(c: ContextoNutricao, unidade: string, refeicao: number, data: string) {
    return (
      this.retratos.find(
        (r) =>
          r.hospital === c.hospital && r.unidade === unidade && r.refeicao === refeicao && r.data === data,
      ) ?? null
    );
  }
}
