// Serviço da enfermagem beira-leito (M25): monta o que as telas leem (linha do tempo do turno com o estado de cada
// horário, horários do paciente no tablet, histórico, proposta de aprazamento, pendências da passagem de plantão) e a
// entrada da receita da checagem a partir do que a pessoa fez (regras 3 a 7 e 12 pelo @sgh/dominio-enfermagem). Nada de
// SQL aqui (a porta lê e grava).
import {
  type AvaliacaoNoveCertos,
  type ChecarHorario,
  type HorarioEnfermagem,
  type LinhaDoTempoTurno,
  MOTIVOS_NAO_ADMINISTRACAO,
  type PacienteDaUnidade,
  type PendenciasSugeridas,
  type PropostaAprazamento,
  type SituacaoChecagem,
  type Turno,
} from '@sgh/contratos';
import {
  avaliarNoveCertos,
  conferirDesfecho,
  conferirPulseira,
  doseDaGlicemia,
  estadosNoTurno,
  exigeDuplaChecagem,
  justificativaDoDesfecho,
  lerCodigoDose,
  pendenciasHerdadas,
  proporAprazamento,
  somarMinutos,
  toleranciaDaClasse,
  turnoDoDia,
  turnoDoInstante,
} from '@sgh/dominio-enfermagem';
import { regraDaUnidade } from '@sgh/dominio-pep';
import type { ChecagemGravacao, HorarioLidoEnf, InternadoLido } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoEnfermagem, PortaEnfermagem } from './porta.js';

export interface ParametrosEnfermagem {
  readonly toleranciaMinutos: number;
  readonly toleranciaTempoCriticoMinutos: number;
  readonly pulseiraObrigatoria: boolean;
  readonly doseObrigatoria: boolean;
  readonly loteValidade: readonly string[];
  readonly duplaChecagem: boolean;
  readonly cacheHoras: number;
  readonly inicioTurnoDiurno: string;
  readonly intervaloSinaisHoras: number;
  readonly alterarVelocidade: boolean;
}

/** O horário lido como a tela mostra (com o estado no turno e o paciente). */
export function horarioDaTela(
  h: HorarioLidoEnf,
  i: InternadoLido | undefined,
  estado: HorarioEnfermagem['estado'],
  atrasoMinutos: number | null,
): HorarioEnfermagem {
  return {
    id: h.id,
    item: h.item,
    prescricao: h.prescricao,
    atendimento: h.atendimento,
    numero: i?.numero ?? null,
    paciente: i?.paciente ?? 0,
    pacienteNome: i?.nome ?? '',
    leito: i?.leito ?? null,
    unidade: i?.unidade ?? null,
    previsto: h.previsto,
    situacao: h.situacao,
    estado,
    tipo: h.tipo,
    descricao: h.descricao,
    dose: h.dose,
    unidadeDose: h.unidadeDose,
    via: h.via,
    produto: h.produto,
    seNecessario: h.seNecessario,
    altaVigilancia: h.altaVigilancia,
    duplaChecagem: h.duplaMarcada,
    hemocomponente: h.hemocomponente,
    infusao: h.infusao ? { velocidadeMlH: h.infusao.velocidadeMlH, ajustavel: h.infusao.ajustavel } : null,
    faixasGlicemia: h.faixasGlicemia,
    checadoEm: h.checadoEm,
    atrasoMinutos,
    observacaoMedica: h.observacaoMedica,
  };
}

const paciente = (i: InternadoLido): PacienteDaUnidade => ({
  paciente: i.paciente,
  atendimento: i.atendimento,
  numero: i.numero,
  nome: i.nome,
  leito: i.leito,
  alergia: i.alergia,
});

export class ServicoEnfermagem {
  constructor(private readonly porta: PortaEnfermagem) {}

  /** A janela do turno pedido (ou o do relógio do banco). */
  async turno(c: ContextoEnfermagem, p: ParametrosEnfermagem, o: { data?: string; turno?: Turno }) {
    const agora = (await this.porta.relogio(c)).slice(0, 16);
    const janela =
      o.data && o.turno
        ? turnoDoDia(o.data, o.turno, p.inicioTurnoDiurno)
        : turnoDoInstante(agora, p.inicioTurnoDiurno);
    return { agora, janela };
  }

  /** A linha do tempo do turno da unidade (worklist): os horários com o estado, os pacientes e os sinais devidos. */
  async linhaDoTempo(
    c: ContextoEnfermagem,
    unidade: string,
    p: ParametrosEnfermagem,
    o: { data?: string; turno?: Turno },
  ): Promise<LinhaDoTempoTurno> {
    const { agora, janela } = await this.turno(c, p, o);
    const internados = await this.porta.internados(c, unidade);
    const porAtendimento = new Map(internados.map((i) => [i.atendimento, i]));
    // A janela vai do fim do turno anterior (as omitidas dele) ao fim deste.
    const inicio = somarMinutos(janela.inicio, -720);
    const lidos = internados.length
      ? await this.porta.horarios(c, {
          atendimentos: internados.map((i) => i.atendimento),
          inicio,
          fim: janela.fim,
          teto: 2_000,
        })
      : { itens: [], cortada: false };
    // As faixas da escala de glicemia não aparecem como dose própria: a checagem do cuidado as marca.
    const visiveis = lidos.itens.filter((h) => h.faixa === null);
    // Do turno anterior, só o que ficou sem checagem (a omitida que vai para a passagem de plantão).
    const doTurno = visiveis.filter((h) => h.previsto >= janela.inicio || h.situacao === 'P');
    const { itens, resumo } = estadosNoTurno(doTurno, {
      agora,
      turno: janela,
      tolerancia: p.toleranciaMinutos,
      toleranciaTempoCritico: p.toleranciaTempoCriticoMinutos,
    });
    const ultimos = await this.porta
      .ultimosSinais(
        c,
        internados.map((i) => i.paciente),
      )
      .catch(() => new Map());
    const devidos = internados
      .map((i) => ({ paciente: i.paciente, ultimo: (ultimos.get(i.paciente) as string | undefined) ?? null }))
      .filter((x) => !x.ultimo || somarMinutos(x.ultimo, p.intervaloSinaisHoras * 60) < agora);
    const conflitos = await this.porta.conflitos(c, { abertos: true }).catch(() => []);
    const ats = new Set(internados.map((i) => i.atendimento));
    return {
      unidade,
      turno: janela,
      agora,
      toleranciaMinutos: p.toleranciaMinutos,
      horarios: itens.map((h) =>
        horarioDaTela(h, porAtendimento.get(h.atendimento), h.estado, h.atrasoMinutos),
      ),
      cortada: lidos.cortada,
      resumo,
      pacientes: internados.map(paciente),
      sinaisDevidos: devidos,
      conflitosAbertos: conflitos.filter(
        (k) => internados.some((i) => i.paciente === k.paciente) || ats.size === 0,
      ).length,
    };
  }

  /** Os horários do paciente nas 12 horas em torno do relógio (o tablet à beira do leito). */
  async horariosDoPaciente(c: ContextoEnfermagem, atendimento: number, p: ParametrosEnfermagem, horas = 12) {
    const i = await this.porta.internado(c, atendimento);
    if (!i)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Paciente não encontrado',
        'O paciente não está internado.',
      );
    const agora = (await this.porta.relogio(c)).slice(0, 16);
    const janela = turnoDoInstante(agora, p.inicioTurnoDiurno);
    const metade = Math.round((horas * 60) / 2);
    const r = await this.porta.horarios(c, {
      atendimentos: [atendimento],
      inicio: somarMinutos(agora, -metade),
      fim: somarMinutos(agora, metade),
      teto: 300,
    });
    const { itens } = estadosNoTurno(
      r.itens.filter((h) => h.faixa === null),
      {
        agora,
        turno: janela,
        tolerancia: p.toleranciaMinutos,
        toleranciaTempoCritico: p.toleranciaTempoCriticoMinutos,
      },
    );
    return {
      paciente: paciente(i),
      agora,
      horarios: itens.map((h) => horarioDaTela(h, i, h.estado, h.atrasoMinutos)),
      cortada: r.cortada,
    };
  }

  /** O horário com o estado (para a tela de checagem e a releitura antes de gravar). */
  async horarioComEstado(c: ContextoEnfermagem, id: number, p: ParametrosEnfermagem) {
    const h = await this.porta.horario(c, id);
    if (!h) throw new ErroProblema('nao-encontrado', 404, 'Horário não encontrado', 'O horário não existe.');
    const i = (await this.porta.internado(c, h.atendimento)) ?? undefined;
    const agora = (await this.porta.relogio(c)).slice(0, 16);
    const janela = turnoDoInstante(agora, p.inicioTurnoDiurno);
    const [x] = estadosNoTurno([h], {
      agora,
      turno: janela,
      tolerancia: p.toleranciaMinutos,
      toleranciaTempoCritico: p.toleranciaTempoCriticoMinutos,
    }).itens;
    return {
      lido: h,
      internado: i,
      agora,
      tela: horarioDaTela(h, i, x?.estado ?? 'outro', x?.atrasoMinutos ?? null),
    };
  }

  /**
   * A entrada da receita a partir da checagem da pessoa (regras 4 a 7 e 12): pulseira, motivo, nove certos, dupla
   * checagem, glicemia com a faixa. Recusa (422/409) com o código; devolve os avisos conferidos.
   */
  montarChecagem(a: {
    readonly h: HorarioLidoEnf;
    readonly internado: InternadoLido;
    readonly faixas: readonly { id: number; situacao: string; faixa: number }[];
    readonly entrada: ChecarHorario;
    readonly cbo: number;
    readonly agora: string;
    readonly p: ParametrosEnfermagem;
    readonly doseObrigatoria: boolean;
    readonly conferente: {
      readonly login: string;
      readonly conferiu: boolean;
      readonly podeConferir: boolean;
    } | null;
    readonly login: string;
  }): { gravacao: ChecagemGravacao; avisos: string[] } {
    const { h, entrada: e, p } = a;
    const pulseira = conferirPulseira({
      obrigatoria: p.pulseiraObrigatoria,
      leitura: e.pulseira.lida
        ? { lida: true, codigo: e.pulseira.codigo }
        : { lida: false, motivo: e.pulseira.motivo },
      paciente: a.internado.paciente,
      atendimento: a.internado.numero,
    });
    if (!pulseira.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Pulseira', pulseira.mensagem, {
        codigo: pulseira.codigo,
      });
    const desfecho = conferirDesfecho({
      desfecho: e.desfecho,
      motivo: e.motivo,
      observacao: e.observacao,
      seNecessario: h.seNecessario,
    });
    if (desfecho)
      throw new ErroProblema('entrada-invalida', 422, 'Checagem incompleta', desfecho, {
        codigo: 'motivo-obrigatorio',
        campos: [e.desfecho === 'naoAdministrado' ? 'motivo' : 'observacao'],
      });
    // A leitura da dose: o código lido (GS1 ou de barras) ou os campos informados.
    const lida = e.dose?.codigo ? lerCodigoDose(e.dose.codigo) : null;
    const gtin =
      e.dose?.gtin ??
      lida?.gtin ??
      (lida?.barras && /^\d{8,14}$/.test(lida.barras) ? lida.barras.padStart(14, '0') : null);
    const validade = e.dose?.validade ?? lida?.validade ?? null;
    const lote = e.dose?.lote ?? lida?.lote ?? null;
    const temDose = ['medicamento', 'material', 'solucao', 'hemoterapia'].includes(h.tipo);
    const classe =
      h.tipo === 'hemoterapia' ? 'hemocomponente' : h.tipo === 'solucao' ? 'solucao' : 'medicamento';
    const quantidade = e.desfecho === 'naoAdministrado' || !temDose ? 0 : (e.quantidade ?? h.dose ?? 0);
    const tol = toleranciaDaClasse({
      geral: p.toleranciaMinutos,
      tempoCritico: p.toleranciaTempoCriticoMinutos,
      altaVigilancia: h.altaVigilancia,
      antimicrobiano: h.antimicrobiano,
    });
    const nove: AvaliacaoNoveCertos = avaliarNoveCertos({
      desfecho: e.desfecho,
      suspenso: h.situacao === 'S' || h.situacao === 'C',
      pacienteErrado: false,
      previsto: h.previsto,
      agora: (e.horaReal ?? a.agora).slice(0, 16),
      toleranciaMinutos: tol,
      dosePrescrita: temDose ? h.dose : null,
      quantidade: temDose ? quantidade : null,
      unidade: h.unidadeDose,
      gtin,
      barrasDoItem: h.barras,
      validade,
      lote,
      hoje: a.agora.slice(0, 10),
      doseObrigatoria: a.doseObrigatoria,
      loteValidadeObrigatorio: temDose && p.loteValidade.includes(classe),
      temDose,
    });
    if (nove.bloqueios.length > 0)
      throw new ErroProblema('recusa-de-negocio', 409, 'Nove certos', nove.bloqueios.join(' '), {
        codigo: 'nove-certos',
        bloqueios: nove.bloqueios,
      });
    if (e.desfecho === 'administrado' && nove.avisos.length > 0 && !e.avisosConferidos)
      throw new ErroProblema('recusa-de-negocio', 409, 'Confira antes de gravar', nove.avisos.join(' '), {
        codigo: 'avisos-a-conferir',
        avisos: nove.avisos,
      });
    // Regra 7: a dupla checagem do item de alta vigilância e do hemocomponente.
    const exigida =
      e.desfecho === 'administrado' &&
      exigeDuplaChecagem({
        altaVigilancia: h.altaVigilancia,
        duplaMarcada: h.duplaMarcada,
        hemocomponente: h.hemocomponente,
        parametroLigado: p.duplaChecagem,
      });
    if (exigida) {
      const k = a.conferente;
      const motivo = !k
        ? 'Item de alta vigilância ou hemocomponente: a dupla checagem exige o segundo profissional.'
        : k.login.trim().toUpperCase() === a.login.trim().toUpperCase()
          ? 'O segundo profissional tem de ser outra pessoa, com o login próprio.'
          : !k.conferiu
            ? 'A senha do segundo profissional não conferiu.'
            : !k.podeConferir
              ? 'O segundo profissional não tem a permissão de conferir a administração.'
              : null;
      if (motivo)
        throw new ErroProblema('recusa-de-negocio', 409, 'Dupla checagem', motivo, {
          codigo: 'dupla-checagem',
        });
    }
    // Regra 12: a glicemia medida e a faixa da escala (a indicada é administrada com a dose; as outras, não).
    const marcacoes: ChecagemGravacao['marcacoes'][number][] = [
      {
        horario: h.id,
        item: h.item,
        situacaoLida: e.situacaoLida,
        situacao: e.desfecho === 'administrado' ? 'A' : 'N',
        quantidade,
        justificativa: justificativaDoDesfecho({
          desfecho: e.desfecho,
          motivo: e.motivo,
          observacao: e.observacao,
        }),
        papel: 'principal',
      },
    ];
    if (h.tipo === 'glicemia' && h.faixa === null && e.desfecho === 'administrado') {
      if (e.glicemia === null)
        throw new ErroProblema(
          'entrada-invalida',
          422,
          'Glicemia',
          'Informe o valor da glicemia medida (mg/dL).',
          {
            campos: ['glicemia'],
          },
        );
      const indicada = doseDaGlicemia(e.glicemia, h.faixasGlicemia).faixa;
      a.faixas.forEach((f) => {
        if (f.situacao !== 'P') return;
        const fx = h.faixasGlicemia.find((x) => x.id === f.faixa) ?? null;
        const aplica = indicada !== null && fx !== null && fx.de === indicada.de && fx.ate === indicada.ate;
        marcacoes.push({
          horario: f.id,
          item: h.item,
          situacaoLida: 'P',
          situacao: aplica ? 'A' : 'N',
          quantidade: aplica ? (fx?.dose ?? 0) : 0,
          justificativa: null,
          papel: 'faixa',
        });
      });
    }
    const gravacao: ChecagemGravacao = {
      prescricao: h.prescricao,
      atendimento: h.atendimento,
      paciente: a.internado.paciente,
      cbo: a.cbo,
      marcacoes,
      sgh: {
        horaReal: `${(e.horaReal ?? a.agora).slice(0, 16)}:00`,
        pulseiraLida: pulseira.lida,
        motivoSemPulseira: pulseira.motivo,
        gtin,
        lote,
        validade,
        conferente: exigida ? (a.conferente?.login.trim().toUpperCase() ?? null) : null,
        dispositivo: e.dispositivo,
        origemOffline: e.origemOffline,
        avisos: nove.avisos.slice(0, 10).map((x) => x.slice(0, 200)),
        motivo: e.motivo,
        observacao: e.observacao,
      },
      glicemia: h.tipo === 'glicemia' && e.desfecho === 'administrado' ? e.glicemia : null,
    };
    return { gravacao, avisos: [...nove.avisos] };
  }

  /** Regra 2: a proposta de aprazamento dos horários a checar da unidade nas próximas 24 h. */
  async propostas(c: ContextoEnfermagem, unidade: string): Promise<PropostaAprazamento[]> {
    const agora = (await this.porta.relogio(c)).slice(0, 16);
    const internados = await this.porta.internados(c, unidade);
    if (internados.length === 0) return [];
    const por = new Map(internados.map((i) => [i.atendimento, i]));
    const { itens } = await this.porta.horarios(c, {
      atendimentos: internados.map((i) => i.atendimento),
      inicio: somarMinutos(agora, -60),
      fim: somarMinutos(agora, 24 * 60),
      teto: 2_000,
    });
    const aPrazar = itens.filter((h) => h.situacao === 'P' && h.faixa === null);
    const { regras, porBloco } = await this.porta.regrasHorario(c);
    const regra = regraDaUnidade(regras, porBloco, unidade, 'I');
    const grade = regras.find((r) => r.id === regra?.id)?.grade ?? new Map<number, readonly string[]>();
    const registrados = await this.porta
      .aprazamentos(
        c,
        aPrazar.map((h) => h.id),
      )
      .catch(() => new Map());
    const porItem = new Map<number, HorarioLidoEnf[]>();
    for (const h of aPrazar) porItem.set(h.item, [...(porItem.get(h.item) ?? []), h]);
    const r: PropostaAprazamento[] = [];
    for (const hs of porItem.values()) {
      const n = hs[0]?.numDoses ?? hs.length;
      const props = proporAprazamento({
        horarios: hs.map((h, k) => ({ id: h.id, previsto: h.previsto, ordem: k + 1 })),
        grade: [...(grade.get(n ?? 0) ?? [])],
        agora,
        primeiraAgora: false,
      });
      for (const pr of props) {
        const h = hs.find((x) => x.id === pr.horario);
        if (!h) continue;
        const i = por.get(h.atendimento);
        const reg = registrados.get(h.id) as
          { acao: string; confirmado: string | null; usuario: string } | undefined;
        r.push({
          horario: h.id,
          item: h.item,
          paciente: i?.paciente ?? 0,
          pacienteNome: i?.nome ?? '',
          leito: i?.leito ?? null,
          descricao: h.descricao,
          previsto: h.previsto,
          proposto: pr.proposto,
          motivoProposta: pr.motivo,
          registrado: reg ? { acao: reg.acao, confirmado: reg.confirmado, por: reg.usuario } : null,
        });
      }
    }
    return r.sort((a, b) => a.previsto.localeCompare(b.previsto) || a.horario - b.horario);
  }

  /** Regra 14: as pendências herdadas que a passagem de plantão sugere (do turno que termina). */
  async pendencias(
    c: ContextoEnfermagem,
    unidade: string,
    p: ParametrosEnfermagem,
    o: { data?: string; turno?: Turno },
  ) {
    const l = await this.linhaDoTempo(c, unidade, p, o);
    const herdadas = pendenciasHerdadas(l.horarios);
    const conflitos = await this.porta.conflitos(c, { abertos: true }).catch(() => []);
    const r: PendenciasSugeridas = {
      unidade,
      pacientes: l.pacientes.map((pc) => ({
        paciente: pc.paciente,
        atendimento: pc.atendimento,
        nome: pc.nome,
        leito: pc.leito,
        pendencias: [
          ...(herdadas.get(pc.paciente) ?? []),
          ...conflitos
            .filter((k) => k.paciente === pc.paciente)
            .map((k) => ({
              tipo: 'conflito' as const,
              descricao: `Conflito de sincronização do horário ${k.horario}`,
              horario: k.horario,
            })),
        ],
      })),
    };
    return { linha: l, sugestoes: r };
  }
}

/** O rótulo do motivo para mensagens. */
export function rotuloMotivo(m: string | null): string | null {
  return m && m in MOTIVOS_NAO_ADMINISTRACAO
    ? MOTIVOS_NAO_ADMINISTRACAO[m as keyof typeof MOTIVOS_NAO_ADMINISTRACAO]
    : null;
}

export const SITUACOES_TELA: Readonly<Record<string, SituacaoChecagem>> = { A: 'A', N: 'N' };
