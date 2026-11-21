// Serviço do centro cirúrgico (M18): monta o mapa das salas, o detalhe do agendamento, os cancelados e as cirurgias
// realizadas a partir das leituras da porta (vocabulário do novo; nome do paciente mascarado no mapa e nas listas;
// o sentinela de profissional nunca aparece) e decide no servidor o que a tela só mostra: a sala permitida ao
// usuário, a sobreposição já gravada pelo outro sistema, o estado do agendamento e o casamento com o ato realizado.
import {
  type AgendamentoCirurgico,
  CARATERES_CIRURGIA,
  type CirurgiaRealizada,
  type DetalheAgendamento,
  type ListaCancelamentosCirurgia,
  type ListaHistoricoCirurgia,
  type ListaRealizadas,
  type MapaCirurgico,
  motivoCirurgia,
  MOTIVOS_CANCELAMENTO_CIRURGIA,
  type OpcoesCirurgia,
  RECURSOS_SALA,
  type SalaCirurgica,
  SITUACOES_PENDENCIA,
  TIPOS_PENDENCIA,
  type UsuariosDaSala,
} from '@sgh/contratos';
import { formatarHora, nomeMascarado, somarDias } from '@sgh/dominio-agenda';
import {
  type Casamento,
  casar,
  conflitosNaSala,
  dataImpossivel,
  diasDaJanela,
  equipeDaLinha,
  estadoEfetivo,
  estadoValido,
  FUNCOES_AGENDA,
  FUNCOES_REGISTRO,
  idsSobrepostos,
  montarMapa,
  type OcupacaoSala,
  ocupacaoDaSala,
  resumirCasamentos,
  ROTULOS_ESTADO,
  rotuloFuncao,
  somarMinutos,
  sobreposicoesNoMapa,
} from '@sgh/dominio-cirurgia';
import type { AgendamentoDaSala, FiltroRealizadas, PedidoCirurgia, SalaDoBloco } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import { type ContextoPortaM18, destinoDoContrato } from '../exames/public-api.js';
import type { PortaCirurgia } from './porta.js';

const ROTULO_RECURSO = new Map<string, string>(RECURSOS_SALA.map((r) => [r.coluna, r.rotulo]));
const hhmmDe = (inicio: string) => inicio.slice(11, 16);
const rotuloOperacao = (op: string) => (op === 'A' ? 'Inclusão' : op === 'R' ? 'Remarcação' : op);
const PEDIATRA = { funcao: 'pediatra', cod: '__SEM_COD__', id: 'ID_TBCBOPRO_PEDIATRA' };

export function salaResposta(s: SalaDoBloco): SalaCirurgica {
  return {
    codigo: s.codigo,
    nome: s.nome,
    centroCusto: s.centroCusto,
    usuarios: s.usuarios,
    permitida: s.permitida,
  };
}

interface Nomes {
  readonly procedimentos: Map<number, string>;
  readonly profissionais: Map<number, string>;
  readonly anestesias: Map<number, string>;
}

export class ServicoCirurgia {
  constructor(private readonly porta: PortaCirurgia) {}

  /** A sala existe e o login está entre os usuários permitidos dela (a mesma lista do outro sistema). */
  async exigirSalaPermitida(c: ContextoPortaM18, login: string, sala: number): Promise<SalaDoBloco> {
    const s = (await this.porta.salas(c, login)).find((x) => x.codigo === sala);
    if (!s)
      throw new ErroProblema('entrada-invalida', 400, 'Sala inexistente', 'A sala cirúrgica não existe.', {
        campos: ['sala'],
      });
    if (!s.permitida)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sala não permitida',
        'Você não está entre os usuários permitidos desta sala: peça à coordenação do bloco para incluí-lo.',
        { codigo: 'sala-nao-permitida' },
      );
    return s;
  }

  private async nomes(
    c: ContextoPortaM18,
    procs: readonly number[],
    profs: readonly number[],
  ): Promise<Nomes> {
    const [p, f, o] = await Promise.all([
      this.porta.nomesProcedimentos(c, procs),
      this.porta.nomesProfissionais(c, profs),
      this.porta.opcoes(c),
    ]);
    return {
      procedimentos: p,
      profissionais: f,
      anestesias: new Map(o.anestesias.map((a) => [a.codigo, a.nome])),
    };
  }

  private equipe(pares: Readonly<Record<string, number | null>>, n: Nomes, registro = false) {
    const lista = equipeDaLinha(pares, registro ? FUNCOES_REGISTRO : [...FUNCOES_AGENDA, PEDIATRA]);
    return lista.map((m) => ({
      funcao: m.funcao,
      rotulo: rotuloFuncao(m.funcao),
      id: m.id,
      nome: n.profissionais.get(m.id) ?? `Profissional ${m.id}`,
    }));
  }

  private agendamentoResposta(
    a: AgendamentoDaSala,
    e: PedidoCirurgia | undefined,
    n: Nomes,
    sobrepostos: Set<number>,
  ): AgendamentoCirurgico {
    const estado = estadoEfetivo(e && estadoValido(e.estado) ? e.estado : null, false);
    return {
      id: a.id,
      estadoId: e?.id ?? null,
      sala: a.sala,
      data: a.inicio.slice(0, 10),
      hora: hhmmDe(a.inicio),
      fim: a.inicio ? hhmmDe(somarMinutos(a.inicio, Math.max(a.duracaoMin, 1))) : '',
      duracaoMin: a.duracaoMin,
      intervaloMin: a.intervaloMin,
      paciente: nomeMascarado(a.paciente),
      prontuario: a.prontuario,
      reg: a.reg,
      atendimento: a.atendimento,
      convenio: a.convenio,
      procedimento: {
        codigo: a.procedimento,
        nome: n.procedimentos.get(a.procedimento) ?? `Procedimento ${a.procedimento}`,
      },
      especialidade: a.especialidade,
      anestesia: {
        codigo: a.anestesia,
        nome: n.anestesias.get(a.anestesia) ?? (a.anestesia ? `Anestesia ${a.anestesia}` : 'Não informada'),
      },
      equipe: this.equipe(a.pares, n),
      recursos: a.recursos.map((r) => ROTULO_RECURSO.get(r) ?? r),
      observacao: a.observacao,
      estado,
      estadoRotulo: ROTULOS_ESTADO[estado],
      sobreposto: sobrepostos.has(a.id),
      dataImpossivel: !a.inicio || dataImpossivel(a.inicio),
      excecao: e?.excecao ?? false,
      pendencias: e?.pendenciasAbertas ?? 0,
      realizada: null,
    };
  }

  private solicitacaoResposta(
    e: PedidoCirurgia,
    n: Nomes,
    paciente: string,
    completo = false,
    cirurgiao: { id: number; cod: number; nome: string } | null = null,
  ): AgendamentoCirurgico {
    const estado = estadoValido(e.estado) ? e.estado : 'solicitado';
    const medico =
      e.portal && e.cirurgiao !== null
        ? (n.profissionais.get(e.cirurgiao) ?? 'Médico externo')
        : 'Médico externo';
    return {
      pedidoPortal: e.portal
        ? {
            medico,
            paciente: completo ? e.portal.paciente : nomeMascarado(e.portal.paciente),
            nascimento: completo ? e.portal.nascimento : null,
            ...(completo ? { cirurgiao } : {}),
          }
        : null,
      id: null,
      estadoId: e.id,
      sala: e.sala,
      data: e.inicio.slice(0, 10),
      hora: hhmmDe(e.inicio),
      fim: hhmmDe(somarMinutos(e.inicio, Math.max(e.duracaoMin, 1))),
      duracaoMin: e.duracaoMin,
      intervaloMin: e.intervaloMin,
      paciente: nomeMascarado(paciente || e.portal?.paciente || ''),
      prontuario: e.prontuario,
      reg: e.reg,
      atendimento: 'I',
      convenio: e.convenio,
      procedimento: {
        codigo: e.procedimento,
        nome: n.procedimentos.get(e.procedimento) ?? `Procedimento ${e.procedimento}`,
      },
      especialidade: 0,
      anestesia: { codigo: e.anestesia ?? 0, nome: n.anestesias.get(e.anestesia ?? 0) ?? 'Não informada' },
      equipe:
        e.cirurgiao !== null
          ? [
              {
                funcao: 'cirurgiao',
                rotulo: 'Cirurgião',
                id: e.cirurgiao,
                nome: n.profissionais.get(e.cirurgiao) ?? `Profissional ${e.cirurgiao}`,
              },
            ]
          : [],
      recursos: [],
      observacao: e.observacao ?? '',
      estado,
      estadoRotulo: ROTULOS_ESTADO[estado],
      sobreposto: false,
      dataImpossivel: false,
      excecao: false,
      pendencias: e.pendenciasAbertas,
      realizada: null,
    };
  }

  private ocupacao(
    a: Pick<AgendamentoDaSala, 'id' | 'sala' | 'inicio' | 'duracaoMin' | 'intervaloMin'>,
  ): OcupacaoSala {
    return {
      id: a.id,
      sala: a.sala,
      inicio: a.inicio,
      duracaoMin: a.duracaoMin,
      intervaloMin: a.intervaloMin,
    };
  }

  async mapa(
    c: ContextoPortaM18,
    login: string,
    f: { inicio: string; dias: number; salas: readonly number[] | null; preparoMinimoMin: number },
  ): Promise<MapaCirurgico> {
    const dias = diasDaJanela(f.inicio, f.dias);
    const ate = dias.at(-1) ?? f.inicio;
    const [salas, ags, estados] = await Promise.all([
      this.porta.salas(c, login),
      this.porta.agendamentos(c, f.inicio, ate, f.salas),
      this.porta.estadosDoPeriodo(c, f.inicio, ate),
    ]);
    const salasMapa = salas.filter((s) => !f.salas || f.salas.includes(s.codigo));
    const porAg = new Map<number, PedidoCirurgia>();
    for (const e of estados)
      if (e.agendamento !== null && !porAg.has(e.agendamento)) porAg.set(e.agendamento, e);
    const solicitacoes = estados.filter(
      (e) => e.agendamento === null && (e.estado === 'solicitado' || e.estado === 'suspenso'),
    );
    const n = await this.nomes(
      c,
      [...ags.itens.map((a) => a.procedimento), ...solicitacoes.map((e) => e.procedimento)],
      [
        ...ags.itens.flatMap((a) =>
          Object.entries(a.pares)
            .filter(([k]) => k.startsWith('ID_'))
            .map(([, v]) => v ?? 0),
        ),
        ...solicitacoes.map((e) => e.cirurgiao ?? 0),
      ],
    );
    const pacientes = await this.porta.pacientes(
      c,
      solicitacoes.flatMap((e) => (e.idPaciente ? [e.idPaciente] : [])),
    );
    const validos = ags.itens.filter((a) => a.inicio && !dataImpossivel(a.inicio));
    const sobre = sobreposicoesNoMapa(
      validos.map((a) => this.ocupacao(a)),
      f.preparoMinimoMin,
    );
    const marcados = idsSobrepostos(sobre);
    return {
      de: f.inicio,
      ate,
      abertura: '07:00',
      fechamento: '21:00',
      salas: salasMapa.map(salaResposta),
      dias: dias.map((dia) => {
        const doDia = ags.itens.filter((a) => a.inicio.slice(0, 10) === dia);
        const m = montarMapa(
          dia,
          salasMapa.map((s) => s.codigo),
          doDia.map((a) => this.ocupacao(a)),
          f.preparoMinimoMin,
        );
        return {
          dia,
          salas: m.salas.map((s) => ({
            sala: s.sala,
            ocupacao: ocupacaoDaSala(s.blocos),
            agendamentos: doDia
              .filter((a) => a.sala === s.sala)
              .map((a) => this.agendamentoResposta(a, porAg.get(a.id), n, marcados)),
          })),
        };
      }),
      solicitacoes: solicitacoes.map((e) =>
        this.solicitacaoResposta(e, n, pacientes.find((p) => p.id === e.idPaciente)?.nome ?? ''),
      ),
      sobreposicoes: sobre.length,
      datasImpossiveis: ags.itens.filter((a) => !a.inicio || dataImpossivel(a.inicio)).length,
      preparoMinimoMin: f.preparoMinimoMin,
      destino: destinoDoContrato(this.porta.destino),
    };
  }

  async exigirAgendamento(c: ContextoPortaM18, id: number): Promise<AgendamentoDaSala> {
    const a = await this.porta.agendamento(c, id);
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Agendamento não encontrado',
        'O agendamento cirúrgico não existe mais (foi cancelado ou movido em outro terminal).',
      );
    return a;
  }

  async exigirEstado(c: ContextoPortaM18, id: number): Promise<PedidoCirurgia> {
    const e = await this.porta.estado(c, id);
    if (!e)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Registro não encontrado',
        'O registro do agendamento não existe.',
      );
    return e;
  }

  private async pendenciasResposta(c: ContextoPortaM18, idEstado: number | null) {
    if (idEstado === null) return [];
    return (await this.porta.pendencias(c, idEstado)).map((p) => ({
      id: p.id,
      tipo: p.tipo,
      rotulo: TIPOS_PENDENCIA.find((t) => t.codigo === p.tipo)?.rotulo ?? p.tipo,
      situacao: SITUACOES_PENDENCIA.find((s) => s.codigo === p.situacao)?.rotulo ?? p.situacao,
      observacao: p.observacao,
      atualizadoPor: p.atualizadoPor,
      atualizadoEm: p.atualizadoEm,
    }));
  }

  private motivo(e: PedidoCirurgia | undefined) {
    if (!e?.motivo) return null;
    return {
      codigo: e.motivo,
      texto: motivoCirurgia(e.motivo)?.texto ?? e.motivo,
      complemento: e.complemento,
      solicitante: e.solicitante,
    };
  }

  async detalhe(c: ContextoPortaM18, id: number, preparoMinimoMin: number): Promise<DetalheAgendamento> {
    const a = await this.exigirAgendamento(c, id);
    const dia = a.inicio.slice(0, 10);
    const [estados, doDia, adicionais, historico, paciente] = await Promise.all([
      this.porta.estadosDosAgendamentos(c, [id]),
      this.porta.agendamentos(c, somarDias(dia, -1), somarDias(dia, 1), [a.sala]),
      this.porta.adicionais(c, a.sala, a.inicio),
      this.porta.historico(c, a.sala, a.inicio),
      this.porta.pacientePorProntuario(c, a.prontuario),
    ]);
    const e = estados.get(id);
    const n = await this.nomes(
      c,
      [a.procedimento, ...adicionais],
      Object.entries(a.pares)
        .filter(([k]) => k.startsWith('ID_'))
        .map(([, v]) => v ?? 0),
    );
    const conflitos = dataImpossivel(a.inicio)
      ? []
      : conflitosNaSala(
          this.ocupacao(a),
          doDia.itens.map((x) => this.ocupacao(x)),
          preparoMinimoMin,
        );
    return {
      agendamento: this.agendamentoResposta(a, e, n, new Set(conflitos.length > 0 ? [a.id] : [])),
      pacienteNome: a.paciente,
      idPaciente: paciente?.id ?? null,
      pendencias: await this.pendenciasResposta(c, e?.id ?? null),
      historico: historico.map((h) => ({
        quando: h.quando,
        usuario: h.usuario,
        operacao: rotuloOperacao(h.operacao),
        salaAnterior: h.salaAnterior,
        inicioAnterior: h.inicioAnterior,
        sala: h.sala,
        inicio: h.inicio,
        justificativa: h.justificativa,
      })),
      motivo: this.motivo(e),
      conflitos: conflitos.map((x) => ({ id: x.com, inicio: x.inicio, duracaoMin: x.duracaoMin })),
      procedimentosAdicionais: adicionais.map((p) => ({
        codigo: p,
        nome: n.procedimentos.get(p) ?? `Procedimento ${p}`,
      })),
    };
  }

  async detalheSolicitacao(c: ContextoPortaM18, id: number): Promise<DetalheAgendamento> {
    const e = await this.exigirEstado(c, id);
    if (e.agendamento !== null) return this.detalhe(c, e.agendamento, 0);
    const [n, pacs, regs] = await Promise.all([
      this.nomes(c, [e.procedimento], e.cirurgiao ? [e.cirurgiao] : []),
      this.porta.pacientes(c, e.idPaciente ? [e.idPaciente] : []),
      e.portal && e.cirurgiao ? this.porta.profissionaisPorRegistro(c, [e.cirurgiao]) : Promise.resolve([]),
    ]);
    const nome = pacs[0]?.nome ?? '';
    const cir = regs.find((x) => x.id === e.cirurgiao);
    return {
      agendamento: this.solicitacaoResposta(
        e,
        n,
        nome,
        true,
        cir ? { id: cir.id, cod: cir.cod, nome: cir.nome } : null,
      ),
      pacienteNome: nome || e.portal?.paciente || '',
      idPaciente: e.idPaciente,
      pendencias: await this.pendenciasResposta(c, e.id),
      historico: [],
      motivo: this.motivo(e),
      conflitos: [],
      procedimentosAdicionais: [],
    };
  }

  /** Inclusões e remarcações da agenda no período (pelo momento da operação), com o nome mascarado. */
  async historicoDoPeriodo(c: ContextoPortaM18, de: string, ate: string): Promise<ListaHistoricoCirurgia> {
    const r = await this.porta.historicoDoPeriodo(c, de, ate);
    return {
      truncado: r.truncado,
      itens: r.itens.map((h) => ({
        quando: h.quando,
        usuario: h.usuario,
        operacao: rotuloOperacao(h.operacao),
        salaAnterior: h.salaAnterior,
        inicioAnterior: h.inicioAnterior,
        sala: h.sala,
        inicio: h.inicio,
        justificativa: h.justificativa,
        paciente: nomeMascarado(h.paciente),
        reg: h.reg,
      })),
    };
  }

  async cancelamentos(c: ContextoPortaM18, de: string, ate: string): Promise<ListaCancelamentosCirurgia> {
    const [r, estados] = await Promise.all([
      this.porta.cancelados(c, de, ate),
      this.porta.estadosDoPeriodo(c, de, ate),
    ]);
    const encerrados = estados.filter((e) => e.estado === 'cancelado' || e.estado === 'suspenso');
    return {
      truncado: r.truncado,
      itens: r.itens.map((x) => {
        const e = encerrados.find((s) => s.sala === x.sala && s.inicio === x.inicio);
        return {
          id: x.id,
          sala: x.sala,
          data: x.inicio.slice(0, 10),
          hora: hhmmDe(x.inicio),
          paciente: nomeMascarado(x.paciente),
          procedimento: x.procedimento,
          canceladoEm: e?.atualizadoEm ?? x.atualizadoEm,
          canceladoPor: x.usuario,
          motivo: e?.motivo
            ? `${e.estado === 'suspenso' ? 'Suspensa: ' : ''}${motivoCirurgia(e.motivo)?.texto ?? e.motivo}`
            : null,
        };
      }),
    };
  }

  async realizadas(c: ContextoPortaM18, f: FiltroRealizadas): Promise<ListaRealizadas> {
    const r = await this.porta.realizadas(c, f);
    const ids = r.itens.map((x) => x.id);
    const [lig, ext, ags, op] = await Promise.all([
      this.porta.ligacoes(c, ids),
      this.porta.registrosExt(c, ids),
      this.porta.agendamentosDosRegs(
        c,
        r.itens.map((x) => x.reg),
      ),
      this.porta.opcoes(c),
    ]);
    const n = await this.nomes(
      c,
      r.itens.flatMap((x) => x.procedimentos.map((p) => p.procedimento)),
      r.itens.flatMap((x) =>
        x.procedimentos.flatMap((p) =>
          Object.entries(p.pares)
            .filter(([k]) => k.startsWith('ID_'))
            .map(([, v]) => v ?? 0),
        ),
      ),
    );
    const anest = new Map(op.anestesias.map((a) => [a.codigo, a.nome]));
    const resumo = { registro: 0, revisao: 0, exato: 0, regEDia: 0, soReg: 0, ambiguo: 0, nenhum: 0 };
    const casamentos: Casamento[] = [];
    const itens: CirurgiaRealizada[] = r.itens.map((x) => {
      const l = lig.get(x.id);
      let ligacao: CirurgiaRealizada['ligacao'];
      if (l) {
        resumo[l.origem]++;
        ligacao = { tipo: l.origem, agendamento: l.agendamento, candidatos: [] };
      } else {
        const k = casar({ id: x.id, reg: x.reg, sala: x.sala, dia: x.data }, ags);
        casamentos.push(k);
        ligacao =
          k.tipo === 'exato'
            ? { tipo: 'exato', agendamento: k.agendamento, candidatos: [k.agendamento] }
            : { tipo: k.tipo, agendamento: null, candidatos: 'candidatos' in k ? [...k.candidatos] : [] };
      }
      const e = ext.get(x.id);
      return {
        id: x.id,
        reg: x.reg,
        data: x.data,
        sala: x.sala,
        porte: x.porte,
        potencialContaminacao: x.potencialContaminacao,
        tipoAnestesia: { codigo: x.tipoAnestesia, nome: anest.get(x.tipoAnestesia) ?? 'Não informada' },
        inicio: formatarHora(x.inicio),
        fim: formatarHora(x.fim),
        duracao: formatarHora(x.duracao),
        paciente: nomeMascarado(x.paciente),
        procedimentos: x.procedimentos.map((p) => ({
          procedimento: {
            codigo: p.procedimento,
            nome: n.procedimentos.get(p.procedimento) ?? `Procedimento ${p.procedimento}`,
          },
          especialidade: p.especialidade,
          tecnica: p.tecnica,
          equipe: this.equipe(p.pares, n, true),
        })),
        ligacao,
        extensao: e
          ? {
              entradaSala: e.entradaSala,
              incisao: e.incisao,
              saidaSala: e.saidaSala,
              asa: e.asa,
              observacao: e.observacao,
            }
          : null,
      };
    });
    const k = resumirCasamentos(casamentos);
    return { itens, truncado: r.truncado, resumo: { ...resumo, ...k } };
  }

  async opcoes(c: ContextoPortaM18, login: string, preparoMinimoMin: number): Promise<OpcoesCirurgia> {
    const [o, salas, profs, r] = await Promise.all([
      this.porta.opcoes(c),
      this.porta.salas(c, login),
      this.porta.profissionaisDoBloco(c),
      this.porta.relogio(c),
    ]);
    return {
      salas: salas.map(salaResposta),
      anestesias: o.anestesias,
      caracteres:
        o.caracteres.length > 0
          ? o.caracteres
          : CARATERES_CIRURGIA.map((x) => ({ codigo: x.codigo, nome: x.rotulo })),
      convenios: o.convenios,
      especialidades: o.especialidades,
      profissionais: profs,
      motivos: MOTIVOS_CANCELAMENTO_CIRURGIA.map((m) => ({
        codigo: m.codigo,
        texto: m.texto,
        solicitante: m.solicitante,
      })),
      pendencias: TIPOS_PENDENCIA.map((t) => ({ codigo: t.codigo, rotulo: t.rotulo })),
      recursos: RECURSOS_SALA.map((x) => ({ campo: x.campo, rotulo: x.rotulo })),
      preparoMinimoMin,
      hoje: r.hoje,
      agora: formatarHora(r.hhmm),
    };
  }

  async usuariosDaSala(c: ContextoPortaM18, login: string, sala: number): Promise<UsuariosDaSala> {
    const s = (await this.porta.salas(c, login)).find((x) => x.codigo === sala);
    if (!s)
      throw new ErroProblema('nao-encontrado', 404, 'Sala não encontrada', 'A sala cirúrgica não existe.');
    const u = await this.porta.usuariosDaSala(c, sala);
    return { sala: salaResposta(s), usuarios: u, total: u.length };
  }
}
