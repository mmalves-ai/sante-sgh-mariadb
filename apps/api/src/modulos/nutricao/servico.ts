// Serviço da nutrição, do mapa de dietas e do serviço social (M45, etapa 5): monta as respostas das telas a partir da porta
// e das regras puras do domínio (o prazo da triagem, a terapia, o mapa no corte com o jejum agendado, o risco social).
// Sem SQL (fronteira Nx) e sem dado além do que a tela mostra.
import {
  type BaseLegalAcompanhante,
  type AlertaMapa,
  type FilaNutricao,
  type FilaSocial,
  type ItemFilaNutricao,
  type LinhaMapa,
  type MapaDietas,
  type OpcoesMapa,
  type Refeicao,
  type SituacaoTriagemNutricional,
  SITUACOES_TRIAGEM_NUTRICIONAL,
  type TerapiaNutricional,
  type TriagemNutricionalLida,
  categoriaPorOcupacao,
  type CorrecaoLida,
  type OrigemNpt,
  situacaoDaCorrecao,
} from '@sgh/contratos';
import {
  alertaMetaNaoAtingida,
  progressoDaTerapia,
  alertasDoMapa,
  avaliacaoSugerida,
  caracteristicasTexto,
  contagensDoMapa,
  cortesProprios,
  descricaoAgora,
  dietaNoInstante,
  examesComJejum,
  hashDoMapa,
  horasAteIniciar,
  idadeNoDia,
  indicadoresTriagem,
  instantesDaRefeicao,
  type ItemDietaDoMapa,
  janelaDoFechamento,
  linhaDoMapa,
  minutosEntre,
  ordenarFilaTriagem,
  type PrazosTriagem,
  refeicoesComCorte,
  situacaoTriagem,
  somarDias,
  somarHoras,
  volumesPorDia,
} from '@sgh/dominio-pep';
import type { AcompanhanteSghLido, LinhaRetratoSgh, TriagemSghLida } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { AcompanhanteComRefeicao } from '../portaria/public-api.js';
import type { ContextoNutricao, PortaNutricao } from './porta.js';

/** A leitura dos acompanhantes da portaria com direito à refeição (M50, etapa 5), por unidade. */
export type LeitorAcompanhantesPortaria = (
  c: ContextoNutricao,
  unidade: string,
) => Promise<readonly AcompanhanteComRefeicao[]>;

/** O fundamento da portaria na base legal da nutrição (o "autorizado pela equipe" não tem direito legal: fica fora). */
const BASE_DO_FUNDAMENTO: Readonly<
  Record<AcompanhanteComRefeicao['fundamento'], BaseLegalAcompanhante | null>
> = {
  idoso: 'idoso',
  crianca: 'crianca-adolescente',
  parto: 'parturiente',
  deficiencia: 'pessoa-deficiencia',
  autorizado: null,
};

/**
 * A refeição do acompanhante de cada internação, com uma fonte só para a pessoa: o acompanhante vigente registrado na
 * portaria (SGH_HOT_ACOMPANHANTE, com direito à refeição e direito legal) entra em todas as refeições do cadastro desde
 * o dia do registro; o registro da nutrição (SGH_HOT_DIETA_ACOMP), quando existe, prevalece, porque escolhe as refeições.
 */
export function acompanhantesDoMapa(
  daNutricao: ReadonlyMap<number, AcompanhanteSghLido>,
  daPortaria: readonly AcompanhanteComRefeicao[],
  codigosRefeicao: readonly number[],
): Map<number, AcompanhanteSghLido | AcompanhanteDaPortariaNoMapa> {
  const m = new Map<number, AcompanhanteSghLido | AcompanhanteDaPortariaNoMapa>(daNutricao);
  for (const a of daPortaria) {
    const base = BASE_DO_FUNDAMENTO[a.fundamento];
    if (base === null || m.has(a.internacao)) continue;
    m.set(a.internacao, {
      id: a.id,
      baseLegal: base,
      refeicoes: [...codigosRefeicao],
      inicio: a.desde.slice(0, 10),
      fim: null,
      origem: 'portaria',
    });
  }
  return m;
}

export interface AcompanhanteDaPortariaNoMapa {
  readonly id: number;
  readonly baseLegal: BaseLegalAcompanhante;
  readonly refeicoes: readonly number[];
  readonly inicio: string;
  readonly fim: null;
  readonly origem: 'portaria';
}

export interface ParametrosNutricao {
  readonly prazos: PrazosTriagem;
  readonly adequadaPct: number;
  readonly antecedenciaMin: number;
  readonly cortesProprios: string;
  readonly jejumCirurgiaHoras: number;
  readonly jejumExameHoras: number;
  readonly examesComJejum: string;
  readonly intensivas: readonly number[];
  /** Até quantas horas depois do horário de servir o retrato ainda fecha. */
  readonly fechamentoToleranciaHoras: number;
  /** W0-05: dias seguidos abaixo do adequado para o alerta (padrão 3) e de onde vem a NPT. */
  readonly alertaMetaDias: number;
  readonly nptOrigem: OrigemNpt;
}

/** Os prazos da triagem de cada unidade (o nível `unidade` do parâmetro é o bloco da internação). */
export type PrazosDaUnidade = (bloco: string) => Promise<PrazosTriagem>;

/** Teto dos internados do retrato que saíram da unidade lidos um a um para o alerta (o nome de agora). */
const TETO_SAIRAM_LIDOS = 50;

const nao404 = (titulo: string, detalhe: string) => new ErroProblema('nao-encontrado', 404, titulo, detalhe);

/** As correções lidas dos registros (a que inativa cada um e a versão que cada um substitui). */
export interface CorrecoesLidas {
  readonly inativa: ReadonlyMap<number, CorrecaoLida>;
  readonly substitui: ReadonlyMap<number, number>;
}
export const SEM_CORRECOES: CorrecoesLidas = { inativa: new Map(), substitui: new Map() };

/** A situação, a correção e a versão substituída de um registro (W0-05). */
export function comCorrecao(id: number, k: CorrecoesLidas) {
  const correcao = k.inativa.get(id) ?? null;
  const c = correcao
    ? {
        acao: correcao.acao,
        idNovo: correcao.idNovo,
        motivo: correcao.motivo,
        por: correcao.por,
        em: correcao.em,
      }
    : null;
  return { situacao: situacaoDaCorrecao(c), correcao: c, substitui: k.substitui.get(id) ?? null };
}

export function triagemLida(
  t: TriagemSghLida,
  prazoHoras: number,
  k: CorrecoesLidas = SEM_CORRECOES,
): TriagemNutricionalLida {
  return {
    ...comCorrecao(t.id, k),
    id: t.id,
    instrumento: t.instrumento,
    versao: t.versao,
    total: t.total,
    parcelas: { estado: t.estado, gravidade: t.gravidade, idade: t.idade },
    risco: t.risco,
    conduta: t.conduta,
    imc: t.imc,
    horasDesdeAdmissao: t.horasDesdeAdmissao,
    dentroDoPrazo: t.horasDesdeAdmissao <= prazoHoras,
    reavaliarEm: t.reavaliarEm,
    por: t.por,
    em: t.em,
  };
}

/** A internação do mapa e das telas como a chave do leito (bloco, acomodação e leito). */
const leitoDe = (i: { bloco: string; acomodacao: string; leito: string }) => ({
  bloco: i.bloco,
  acomodacao: i.acomodacao,
  leito: i.leito,
});

export interface MapaMontado {
  readonly mapa: MapaDietas;
  readonly retrato: LinhaRetratoSgh[];
  readonly hash: string;
  readonly refeicao: Refeicao;
}

export class ServicoNutricao {
  constructor(
    private readonly porta: PortaNutricao,
    /** Os acompanhantes da portaria (M50.5); sem ela (testes da nutrição isolada), só o registro da nutrição. */
    private readonly portaria: LeitorAcompanhantesPortaria | null = null,
  ) {}

  // ── Fila da nutrição (regra 10) ──────────────────────────────────────────────────────────────────

  async fila(
    c: ContextoNutricao,
    p: ParametrosNutricao,
    unidade: string | null,
    prazosDaUnidade?: PrazosDaUnidade,
  ): Promise<FilaNutricao> {
    const { agora, hoje } = await this.porta.relogio(c);
    const internados = await this.porta.internados(c, unidade);
    const regs = internados.itens.map((i) => i.reg);
    // Regra 11/10 por unidade: cada internado com os prazos do bloco dele (o parâmetro pode diferir por unidade).
    const prazosPor = new Map<string, PrazosTriagem>();
    for (const b of new Set(internados.itens.map((i) => i.bloco)))
      prazosPor.set(b, prazosDaUnidade ? await prazosDaUnidade(b) : p.prazos);
    const prazosDe = (bloco: string) => prazosPor.get(bloco) ?? p.prazos;
    const [triagens, comMeta] = await Promise.all([
      this.porta.triagens(c, regs),
      this.porta.comMeta(c, regs),
    ]);
    const porReg = new Map<number, TriagemSghLida[]>();
    for (const t of triagens) porReg.set(t.reg, [...(porReg.get(t.reg) ?? []), t]);
    const itens: ItemFilaNutricao[] = internados.itens.map((i) => {
      // W0-05: a triagem retificada ou estornada (inativa) não conta: vale a versão ativa mais recente.
      const ts = (porReg.get(i.reg) ?? []).filter((t) => !t.inativa);
      const ultima = ts[0] ?? null;
      const pz = prazosDe(i.bloco);
      return {
        internacao: i.reg,
        paciente: i.paciente,
        nome: i.nome,
        leito: leitoDe(i),
        unidade: i.bloco,
        admissao: i.admissao,
        horasDesdeAdmissao: Math.max(0, Math.floor(minutosEntre(i.admissao, agora) / 60)),
        prazoEm: somarHoras(i.admissao, pz.prazoHoras),
        preferencialEm: somarHoras(i.admissao, pz.preferencialHoras),
        situacao: situacaoTriagem({ admissao: i.admissao, agora, ultima, prazos: pz }),
        intensiva: i.tipoAcomodacaoAtual !== null && p.intensivas.includes(i.tipoAcomodacaoAtual),
        idade: idadeNoDia(i.nascimento, hoje),
        ultima: ultima ? triagemLida(ultima, pz.prazoHoras) : null,
        emTerapia: comMeta.has(i.reg),
      };
    });
    const contagens = Object.fromEntries(SITUACOES_TRIAGEM_NUTRICIONAL.map((s) => [s, 0])) as Record<
      SituacaoTriagemNutricional,
      number
    >;
    for (const x of itens) contagens[x.situacao] += 1;
    // Os indicadores dos internados agora que já passaram do prazo preferencial (as parcelas vão impressas na tela).
    // Por unidade (cada bloco com os prazos dele), somados: as parcelas vão impressas na tela.
    const indicadores = { admitidos: 0, triados24h: 0, triados48h: 0 };
    for (const [bloco, pz] of prazosPor) {
      const parcela = indicadoresTriagem(
        internados.itens
          .filter((i) => i.bloco === bloco && minutosEntre(i.admissao, agora) / 60 >= pz.preferencialHoras)
          .map((i) => {
            const ts = porReg.get(i.reg) ?? [];
            return { admissao: i.admissao, primeiraTriagemEm: ts[ts.length - 1]?.em ?? null };
          }),
        pz,
      );
      indicadores.admitidos += parcela.admitidos;
      indicadores.triados24h += parcela.triados24h;
      indicadores.triados48h += parcela.triados48h;
    }
    return {
      itens: ordenarFilaTriagem(itens),
      contagens,
      indicadores,
      cortada: internados.cortada,
      prazoHoras: p.prazos.prazoHoras,
      preferencialHoras: p.prazos.preferencialHoras,
      lidoEm: agora,
    };
  }

  /** A internação aberta (para triar, acompanhar, avaliar ou registrar o acompanhante); senão 404 ou 409. */
  async internacaoAberta(c: ContextoNutricao, reg: number) {
    const i = await this.porta.internacao(c, reg);
    if (!i) throw nao404('Internação não encontrada', 'A internação não existe neste estabelecimento.');
    if (!i.aberta)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Internação encerrada',
        'A internação não está aberta.',
        {
          codigo: 'internacao-com-alta',
        },
      );
    return i;
  }

  // ── Terapia nutricional (EMTN) ───────────────────────────────────────────────────────────────────

  async terapia(c: ContextoNutricao, reg: number, p: ParametrosNutricao): Promise<TerapiaNutricional> {
    const { agora } = await this.porta.relogio(c);
    const i = await this.porta.internacao(c, reg);
    if (!i) throw nao404('Internação não encontrada', 'A internação não existe neste estabelecimento.');
    const desde = `${somarDias(agora.slice(0, 10), -14)}T00:00`;
    const dietas = i.atendimento ? await this.porta.dietasEnterais(c, i.atendimento, desde) : [];
    const itens = dietas.map((d) => d.item);
    const [checagens, primeira, t, fichas, avaliacoes, balanco] = await Promise.all([
      itens.length ? this.porta.checagens(c, itens, `${somarDias(agora.slice(0, 10), -7)}T00:00`) : [],
      itens.length ? this.porta.primeiraAdministrada(c, itens) : null,
      this.porta.terapia(c, reg),
      this.porta.fichas(c, i.paciente),
      this.porta.avaliacoesNpt(c, reg),
      i.atendimento
        ? this.porta.balancoParenteral(c, i.atendimento, `${somarDias(agora.slice(0, 10), -7)}T00:00`)
        : [],
    ]);
    // W0-05: a situação de cada versão (substituída, encerrada, retificada, estornada), o progresso diário e acumulado
    // só com os acompanhamentos ativos (cada um com a meta da versão em que foi registrado) e o alerta.
    const [km, ka] = await Promise.all([
      this.porta.correcoes(
        c,
        'meta',
        t.metas.map((m) => m.id),
      ),
      this.porta.correcoes(
        c,
        'acompanhamento',
        t.acompanhamentos.map((a) => a.id),
      ),
    ]);
    const metas = t.metas.map((m) => {
      const x = comCorrecao(m.id, km);
      return {
        ...m,
        correcao: x.correcao,
        substitui: x.substitui,
        situacao:
          x.correcao === null
            ? ('vigente' as const)
            : x.correcao.acao === 'encerramento'
              ? ('encerrada' as const)
              : ('substituida' as const),
        avaliacaoNpt: avaliacoes.find((v) => v.meta === m.id) ?? null,
      };
    });
    const acompanhamentos = t.acompanhamentos.map((a) => ({
      ...a,
      ...comCorrecao(a.id, ka),
      motivo: a.motivo as TerapiaNutricional['acompanhamentos'][number]['motivo'],
    }));
    const metaDe = new Map(metas.map((m) => [m.id, m]));
    const progresso = progressoDaTerapia(
      acompanhamentos.flatMap((a) => {
        const m = metaDe.get(a.meta);
        return a.situacao === 'ativo' && m
          ? [
              {
                data: a.data,
                em: a.em,
                kcalAtingida: a.kcalAtingida,
                proteinaAtingidaG: a.proteinaAtingidaG,
                meta: m,
              },
            ]
          : [];
      }),
      p.adequadaPct,
    );
    return {
      internacao: i.reg,
      paciente: i.paciente,
      nome: i.nome,
      leito: leitoDe(i),
      admissao: i.admissao,
      dietas: dietas.map((d) => ({
        itemDieta: d.itemDieta,
        item: d.item,
        prescricao: d.prescricao,
        dieta: d.nomeDieta ?? 'Dieta',
        via: d.plano === 5 ? 'parenteral' : 'enteral',
        quantidadeMl: d.quantidade,
        velocidadeMlH: d.velocidade,
        vigenciaInicio: d.vigenciaInicio,
        vigenciaFim: d.vigenciaFim,
        prescritor: categoriaPorOcupacao(d.cboLancamento),
        suspensa: d.suspensa,
      })),
      metas,
      acompanhamentos,
      progresso,
      alerta: alertaMetaNaoAtingida(progresso, p.alertaMetaDias),
      balanco: balanco.slice(0, 7),
      nptOrigem: p.nptOrigem,
      checagens: volumesPorDia(checagens).slice(0, 7),
      horasAteIniciar: horasAteIniciar(i.admissao, primeira),
      fichas,
      metaAdequadaPct: p.adequadaPct,
      lidoEm: agora,
    };
  }

  // ── Mapa de dietas (regras 11 e 12) ──────────────────────────────────────────────────────────────

  async refeicoes(c: ContextoNutricao, p: ParametrosNutricao): Promise<Refeicao[]> {
    return refeicoesComCorte(
      await this.porta.refeicoes(c),
      p.antecedenciaMin,
      cortesProprios(p.cortesProprios),
    );
  }

  async opcoes(c: ContextoNutricao, p: ParametrosNutricao): Promise<OpcoesMapa> {
    const [{ agora, hoje }, unidades, refeicoes] = await Promise.all([
      this.porta.relogio(c),
      this.porta.unidades(c),
      this.refeicoes(c, p),
    ]);
    return { unidades, refeicoes, hoje, agora };
  }

  async mapa(
    c: ContextoNutricao,
    q: { unidade: string; refeicao: number; data: string },
    p: ParametrosNutricao,
  ): Promise<MapaMontado> {
    const refeicoes = await this.refeicoes(c, p);
    const refeicao = refeicoes.find((r) => r.codigo === q.refeicao);
    if (!refeicao)
      throw nao404('Refeição não encontrada', 'A refeição não está no cadastro de refeições com horário.');
    const [{ agora }, unidades] = await Promise.all([this.porta.relogio(c), this.porta.unidades(c)]);
    const u = unidades.find((x) => x.unidade === q.unidade);
    if (!u)
      throw nao404('Unidade não encontrada', 'A unidade de internação não existe neste estabelecimento.');
    const { servirEm, corteEm } = instantesDaRefeicao(q.data, refeicao);
    const janela = janelaDoFechamento(servirEm, corteEm, p.fechamentoToleranciaHoras);
    // Todo internado da unidade entra (o sem atendimento vinculado sai "sem dieta prescrita", para a copa ver).
    const lidos = await this.porta.internados(c, q.unidade);
    const internados = lidos.itens;
    const regs = internados.map((i) => i.reg);
    const atendimentos = internados.map((i) => i.atendimento).filter((x): x is number => x !== null);
    const [itens, alergias, cirurgias, exames, daNutricao, daPortaria, retrato] = await Promise.all([
      this.porta.itensDieta(c, atendimentos, servirEm),
      this.porta.alergiasAlimentares(
        c,
        internados.map((i) => i.paciente),
      ),
      this.porta.cirurgias(c, somarHoras(servirEm, -24), somarHoras(servirEm, p.jejumCirurgiaHoras)),
      this.porta.exames(
        c,
        internados.map((i) => i.pront),
        servirEm.slice(0, 10),
        somarHoras(servirEm, p.jejumExameHoras).slice(0, 10),
      ),
      this.porta.acompanhantesVigentes(c, regs),
      this.portaria ? this.portaria(c, q.unidade) : Promise.resolve([]),
      this.porta.retrato(c, q.unidade, q.refeicao, q.data),
    ]);
    const acompanhantes = acompanhantesDoMapa(
      daNutricao,
      daPortaria.filter((a) => regs.includes(a.internacao)),
      refeicoes.map((r) => r.codigo),
    );
    const porAtendimento = new Map<number, ItemDietaDoMapa[]>();
    const dietaDoItem = new Map<number, number | null>();
    for (const x of itens) {
      porAtendimento.set(x.atendimento, [...(porAtendimento.get(x.atendimento) ?? []), x]);
      dietaDoItem.set(x.itemDieta, x.dieta);
    }
    const regra = {
      horasCirurgia: p.jejumCirurgiaHoras,
      horasExame: p.jejumExameHoras,
      examesComJejum: examesComJejum(p.examesComJejum),
    };
    const ctxLinha = { servirEm, corteEm, agora, regraJejum: regra, refeicao: q.refeicao, data: q.data };
    const linhas: LinhaMapa[] = internados
      .map((i) => {
        const doInternado = i.atendimento === null ? [] : (porAtendimento.get(i.atendimento) ?? []);
        return linhaDoMapa(
          {
            internacao: i.reg,
            paciente: i.paciente,
            nome: i.nome,
            nascimento: i.nascimento,
            prontuario: i.pront,
            leito: leitoDe(i),
          },
          doInternado,
          {
            cirurgias: cirurgias
              .filter((x) => x.reg === i.reg || (x.pront !== null && x.pront === i.pront))
              .map((x) => ({
                inicio: x.inicio,
                duracaoMin: x.duracaoMin,
                descricao: `Cirurgia na sala ${x.sala} às ${x.inicio.slice(11, 16)}`,
              })),
            exames: exames
              .filter((x) => x.pront === i.pront)
              .map((x) => ({
                inicio: x.inicio,
                exame: x.exame,
                descricao: `Exame ${x.exame} às ${x.inicio.slice(11, 16)}`,
              })),
          },
          alergias.get(i.paciente) ?? [],
          acompanhantes.get(i.reg) ?? null,
          ctxLinha,
        );
      })
      .sort((a, b) =>
        `${a.leito.acomodacao}|${a.leito.leito}`.localeCompare(`${b.leito.acomodacao}|${b.leito.leito}`),
      );
    const agoraPor = new Map<
      number,
      { descricao: string; gravadaEm: string | null; itemDieta: number | null }
    >();
    for (const i of internados) {
      const doInternado = i.atendimento === null ? [] : (porAtendimento.get(i.atendimento) ?? []);
      const d = descricaoAgora(doInternado, servirEm, agora);
      agoraPor.set(i.reg, {
        ...d,
        itemDieta: dietaNoInstante(doInternado, servirEm, agora)?.itemDieta ?? null,
      });
    }
    // Quem estava no retrato e saiu da unidade: o nome de agora (alta ou transferência), lido um a um com teto.
    const naUnidade = new Set(regs);
    const nomes = new Map<number, string>();
    for (const x of (retrato?.linhas ?? [])
      .filter((y) => !naUnidade.has(y.reg))
      .slice(0, TETO_SAIRAM_LIDOS)) {
      const i = await this.porta.internacao(c, x.reg).catch(() => null);
      if (i) nomes.set(x.reg, i.nome);
    }
    const alertas: AlertaMapa[] = alertasDoMapa(
      linhas,
      agoraPor,
      retrato
        ? retrato.linhas.map((x) => ({
            internacao: x.reg,
            tipo: x.tipo,
            itemDieta: x.itemDieta,
            dieta: x.dieta,
            caracteristicas: x.caracteristicas,
            nome: nomes.get(x.reg) ?? null,
            leito: { bloco: q.unidade, acomodacao: x.acomodacao, leito: x.leito },
          }))
        : null,
    );
    const hash = await hashDoMapa(linhas);
    const linhaRetrato = (l: LinhaMapa): LinhaRetratoSgh => ({
      reg: l.internacao,
      pront: l.prontuario,
      acomodacao: l.leito.acomodacao,
      leito: l.leito.leito,
      itemDieta: l.itemDieta,
      item: l.item,
      dieta: l.itemDieta === null ? null : (dietaDoItem.get(l.itemDieta) ?? null),
      tipo: l.tipo,
      nomeDieta: l.dieta,
      caracteristicas: caracteristicasTexto(l),
      jejumOrigem: l.jejum?.origem ?? null,
      alergias: l.alergiasAlimentares.length ? l.alergiasAlimentares.join(', ').slice(0, 300) : null,
      acompanhante: l.acompanhante !== null,
      prescritoEm: l.prescritoEm,
    });
    return {
      refeicao,
      hash,
      retrato: linhas.map(linhaRetrato),
      mapa: {
        unidade: u.unidade,
        nomeUnidade: u.nome,
        data: q.data,
        refeicao,
        corteEm,
        passouDoCorte: agora > corteEm,
        fechamentoAte: janela.fechaEm,
        linhas,
        contagens: contagensDoMapa(linhas),
        acompanhantes: linhas.filter((l) => l.acompanhante !== null).length,
        retrato: retrato
          ? {
              id: retrato.id,
              em: retrato.em,
              por: retrato.por,
              corteEm: retrato.corteEm,
              itens: retrato.itens,
              jejuns: retrato.jejuns,
              hash: retrato.hash,
            }
          : null,
        alertas,
        cortada: lidos.cortada,
        lidoEm: agora,
      },
    };
  }

  // ── Serviço social ───────────────────────────────────────────────────────────────────────────────

  async filaSocial(c: ContextoNutricao): Promise<FilaSocial> {
    const { agora, hoje } = await this.porta.relogio(c);
    const internados = await this.porta.internados(c, null);
    const regs = internados.itens.map((i) => i.reg);
    const [ultimos, barreiras] = await Promise.all([
      this.porta.ultimosSociais(c, regs),
      this.porta.barreirasSociais(c, regs),
    ]);
    const itens = internados.itens.map((i) => {
      const idade = idadeNoDia(i.nascimento, hoje);
      const ultima = ultimos.get(i.reg) ?? null;
      const dias = Math.max(0, Math.floor(minutosEntre(i.admissao, agora) / 1440));
      return {
        internacao: i.reg,
        paciente: i.paciente,
        nome: i.nome,
        leito: leitoDe(i),
        admissao: i.admissao,
        idade,
        ultima,
        barreirasSociais: barreiras.get(i.reg) ?? 0,
        sugerida: avaliacaoSugerida({ idade, diasInternado: dias, ultima, hoje }),
      };
    });
    itens.sort(
      (a, b) =>
        Number(b.sugerida) - Number(a.sugerida) ||
        b.barreirasSociais - a.barreirasSociais ||
        a.admissao.localeCompare(b.admissao),
    );
    return { itens, cortada: internados.cortada, lidoEm: agora };
  }
}
