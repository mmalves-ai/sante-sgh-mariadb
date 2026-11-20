// Serviço da agenda de exames (M18): monta as respostas das telas a partir das leituras da porta (vocabulário do novo,
// nome do paciente mascarado nas listas) e decide no servidor o que a tela só mostra: o escopo da unidade, a
// cobertura do convênio e do exame, a prévia da grade (motor da agenda) e a impressão que a gravação confere.
import { createHash } from 'node:crypto';
import {
  type AgendaExameResumo,
  type BuscaVagasExame,
  CANAIS_MARCACAO,
  type DetalheAgendaExame,
  type GradeExame,
  type GerarGradeExameEntrada,
  type ListaAgendasExame,
  type ListaCancelamentosExame,
  type ListaMarcacoesExame,
  type MarcacaoExameDetalhe,
  type MarcacaoExameResumo,
  MOTIVOS_CANCELAMENTO,
  type OpcoesExame,
  type PreviaGradeExame,
  type ResiduoExameResposta,
} from '@sgh/contratos';
import {
  avaliarCoberturaExame,
  CATEGORIAS_EXAME,
  duracaoMinutos,
  estadoDoHorarioExame,
  type FaixaEscala,
  formatarHora,
  NOME_DO_DIA,
  nomeMascarado,
  planejarGrade,
  rotuloCategoria,
  rotuloTipoHorario,
  ROTULOS_ESTADO_EXAME,
  somarDias,
  TIPOS_HORARIO_EXAME,
} from '@sgh/dominio-agenda';
import { type AgendaExameLida, foraDoPadraoGradeExame, type MarcacaoExameLida } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPortaM18 } from './apoio-gravacao.js';
import type { PortaExame } from './porta.js';

/** Escopo da sessão na agenda de exames: as unidades aceitas (null = sem restrição). */
export interface ContextoExame extends ContextoPortaM18 {
  readonly unidades?: readonly string[] | null;
}

const MAX_DIAS_CONSULTA = 31;
const MAX_DIAS_RESIDUO = 92;

export function exigirJanela(
  de: string | null,
  ate: string | null,
  maxDias = MAX_DIAS_CONSULTA,
  hoje?: string,
) {
  const d = de ?? hoje;
  const a = ate ?? (d ? somarDias(d, 6) : null);
  if (!d || !a)
    throw new ErroProblema('entrada-invalida', 400, 'Período obrigatório', 'Informe o início e o fim.');
  if (a < d)
    throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O fim vem antes do início.');
  if (somarDias(d, maxDias - 1) < a)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Período longo',
      `Consulte até ${maxDias} dias por vez: divida o período.`,
    );
  return { de: d, ate: a };
}

const unidadeNoEscopo = (c: ContextoExame, unidade: number) =>
  !c.unidades || unidade <= 0 || c.unidades.includes(String(unidade));

export class ServicoExame {
  constructor(private readonly porta: PortaExame) {}

  resumo(a: AgendaExameLida, exames: number): AgendaExameResumo {
    return {
      id: a.id,
      nome: a.nome,
      crm: a.crm,
      exame: a.exame,
      exameRotulo: rotuloTipoHorario(a.exame),
      categoria: { codigo: a.categoria, rotulo: rotuloCategoria(a.categoria) },
      duracao: formatarHora(a.duracao),
      ativa: a.ativa === 'S',
      unidade: a.unidade,
      gradeInicio: a.inicio,
      gradeFim: a.fim,
      convenios: a.convenios,
      exames,
    };
  }

  async exigirAgenda(c: ContextoExame, id: number): Promise<AgendaExameLida> {
    const a = await this.porta.agenda(c, id);
    if (!a || !unidadeNoEscopo(c, a.unidade))
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Agenda não encontrada',
        'A agenda de exames não existe.',
      );
    return a;
  }

  /** Confere a agenda (existe e está no escopo da unidade) de uma entrada de gravação. */
  async exigirAgendaDaEntrada(c: ContextoExame, agenda: number): Promise<AgendaExameLida> {
    return this.exigirAgenda(c, agenda);
  }

  private async contagemExames(c: ContextoExame): Promise<Map<number, number>> {
    const m = new Map<number, Set<number>>();
    for (const l of await this.porta.cobertura(c, null)) {
      const s = m.get(l.agenda) ?? new Set<number>();
      s.add(l.exame);
      m.set(l.agenda, s);
    }
    return new Map([...m].map(([k, v]) => [k, v.size]));
  }

  async listar(
    c: ContextoExame,
    f: { termo: string | null; situacao: string | null; categoria: number | null },
  ): Promise<ListaAgendasExame> {
    const [ags, exames] = await Promise.all([this.porta.agendas(c), this.contagemExames(c)]);
    const termo = f.termo?.toUpperCase() ?? null;
    const itens = ags
      .filter((a) => unidadeNoEscopo(c, a.unidade))
      .filter((a) => !termo || a.nome.toUpperCase().includes(termo))
      .filter((a) => !f.situacao || (f.situacao === 'ativas') === (a.ativa === 'S'))
      .filter((a) => f.categoria === null || a.categoria === f.categoria)
      .map((a) => this.resumo(a, exames.get(a.id) ?? 0));
    return { itens, total: itens.length, destino: this.porta.destino };
  }

  async detalhe(c: ContextoExame, id: number): Promise<DetalheAgendaExame> {
    const a = await this.exigirAgenda(c, id);
    const [convenios, cobertura, escala, geracoes] = await Promise.all([
      this.porta.convenios(c, id),
      this.porta.cobertura(c, id),
      this.porta.escala(c, a.nome, a.crm),
      this.porta.geracoes(c, a.nome, a.crm),
    ]);
    return {
      agenda: this.resumo(a, new Set(cobertura.map((x) => x.exame)).size),
      convenios,
      cobertura: cobertura.map((x) => ({
        id: x.id,
        exame: x.exame,
        exameNome: x.exameNome,
        convenio: x.convenio,
        convenioNome: x.convenioNome,
      })),
      escala: escala.map((l) => ({
        semana: l.semana,
        dia: NOME_DO_DIA[l.semana] ?? String(l.semana),
        duracao: formatarHora(l.duracao),
        inicio: formatarHora(l.horaInicio),
        fim: formatarHora(l.horaFim),
        exame: rotuloTipoHorario(l.exame),
      })),
      geracoes: geracoes.slice(0, 50).map((g) => ({
        inicio: g.inicio,
        fim: g.fim,
        criadaEm: g.em,
        hora: formatarHora(g.hora),
        situacao: g.status === 'C' ? 'Gerada' : g.status === 'E' ? 'Excluída' : g.status || 'Gerada',
        dias: [...g.semanas].flatMap((x, i) => (x === 'T' ? [i + 1] : [])),
      })),
      observacao: null,
    };
  }

  async grade(c: ContextoExame, id: number, de: string, ate: string): Promise<GradeExame> {
    const a = await this.exigirAgenda(c, id);
    const [h, exames] = await Promise.all([
      this.porta.horarios(c, a.nome, a.crm, de, ate),
      this.porta.cobertura(c, id),
    ]);
    let cs = 0;
    let os = 0;
    const horarios = h.itens.map((x) => {
      const estado = estadoDoHorarioExame({ ...x, temMarcacao: x.marcacao !== null });
      if (estado === 'residuo-confirmado-sem-paciente') cs++;
      if (estado === 'marcacao-incompleta') os++;
      return {
        agenda: a.id,
        agendaNome: a.nome,
        data: x.data,
        hora: formatarHora(x.hora),
        exame: rotuloTipoHorario(x.exame),
        estado,
        estadoRotulo: ROTULOS_ESTADO_EXAME[estado],
        paciente: x.paciente ? nomeMascarado(x.paciente) : null,
        marcacao: x.marcacao,
        convenio: x.convenio && x.convenio > 0 ? x.convenio : null,
      };
    });
    return {
      agenda: this.resumo(a, new Set(exames.map((x) => x.exame)).size),
      de,
      ate,
      horarios,
      truncado: h.truncado,
      residuo: { confirmadosSemPaciente: cs, ocupadosSemMarcacao: os, total: cs + os },
    };
  }

  /** Vagas pela agenda, pela categoria, pelo convênio aceito e pelo exame coberto (cobertura do novo). */
  async buscarVagas(
    c: ContextoExame,
    f: {
      agenda: number | null;
      categoria: number | null;
      convenio: number | null;
      exame: number | null;
      de: string;
      ate: string;
    },
  ): Promise<BuscaVagasExame> {
    const ags = (await this.porta.agendas(c)).filter(
      (a) =>
        a.ativa === 'S' &&
        unidadeNoEscopo(c, a.unidade) &&
        (f.agenda === null || a.id === f.agenda) &&
        (f.categoria === null || a.categoria === f.categoria),
    );
    const cob = await this.porta.cobertura(c, null);
    const aceitas: AgendaExameLida[] = [];
    for (const a of ags) {
      if (f.convenio !== null && a.convenios > 0) {
        const lista = await this.porta.convenios(c, a.id);
        if (!lista.some((x) => x.codigo === f.convenio)) continue;
      }
      const linhas = cob.filter((x) => x.agenda === a.id);
      if (f.exame !== null && !avaliarCoberturaExame(linhas, f.exame, f.convenio ?? 0).ok) continue;
      aceitas.push(a);
    }
    const porId = new Map(aceitas.map((a) => [a.id, a]));
    const vaga = (v: {
      agenda: number;
      nomeAgenda: string;
      categoria: number;
      data: string;
      hora: string;
      exame: string;
    }) => ({
      agenda: v.agenda,
      agendaNome: v.nomeAgenda,
      categoria: rotuloCategoria(porId.get(v.agenda)?.categoria ?? v.categoria),
      data: v.data,
      hora: formatarHora(v.hora),
      exame: rotuloTipoHorario(v.exame),
    });
    if (aceitas.length === 0) return { itens: [], truncado: false, proximas: [], de: f.de, ate: f.ate };
    const ids = aceitas.map((a) => a.id);
    const r = await this.porta.vagas(c, { agendas: ids, de: f.de, ate: f.ate });
    let proximas: BuscaVagasExame['proximas'] = [];
    if (r.itens.length === 0) {
      const depois = await this.porta.vagas(c, {
        agendas: ids,
        de: somarDias(f.ate, 1),
        ate: somarDias(f.ate, 90),
        limite: 10,
      });
      proximas = depois.itens.map(vaga);
    }
    return { itens: r.itens.map(vaga), truncado: r.truncado, proximas, de: f.de, ate: f.ate };
  }

  private resumoMarcacao(
    m: MarcacaoExameLida,
    ext: Map<number, { idExame: number | null; exameNome: string | null; canal: string }>,
  ): MarcacaoExameResumo {
    const estado = m.temHorario
      ? estadoDoHorarioExame({
          data: m.data,
          hora: m.hora,
          exame: m.exameHorario,
          paciente: m.pacienteHorario,
          livre: 'N',
          situacao: m.situacaoHorario,
          tipo: 'N',
          temMarcacao: true,
        })
      : 'outro';
    const e = ext.get(m.id);
    return {
      id: m.id,
      agenda: m.agenda,
      agendaNome: m.nomeAgenda,
      data: m.data,
      hora: formatarHora(m.hora),
      paciente: nomeMascarado(m.paciente),
      prontuario: m.prontuario,
      idPaciente: m.idPaciente,
      convenio: m.convenio,
      situacao: m.situacaoHorario,
      estado,
      estadoRotulo: ROTULOS_ESTADO_EXAME[estado],
      categoria: rotuloCategoria(m.tpAge || m.categoriaAgenda),
      exameEscolhido: e?.idExame ? { id: e.idExame, nome: e.exameNome ?? `Exame ${e.idExame}` } : null,
      canal: e?.canal ?? null,
      atendido: m.atendido === 'T',
      vinculo: m.prontuario > 0 ? 'prontuario' : 'sem-vinculo',
    };
  }

  async marcacoesDoDia(c: ContextoExame, data: string, agenda: number | null): Promise<ListaMarcacoesExame> {
    const a = agenda === null ? null : await this.exigirAgenda(c, agenda);
    const r = await this.porta.marcacoesDoDia(c, data, a ? { nome: a.nome, crm: a.crm } : null);
    const ags = a ? [a] : await this.porta.agendas(c);
    const noEscopo = new Set(ags.filter((x) => unidadeNoEscopo(c, x.unidade)).map((x) => x.id));
    const itens = r.itens.filter((m) => (m.agenda === null ? !c.unidades : noEscopo.has(m.agenda)));
    const ext = await this.porta.extensoes(
      c,
      itens.map((m) => m.id),
    );
    return { itens: itens.map((m) => this.resumoMarcacao(m, ext)), truncado: r.truncado };
  }

  async marcacoesDoPaciente(c: ContextoExame, id: number): Promise<ListaMarcacoesExame> {
    const r = await this.porta.marcacoesDoPaciente(c, id);
    // O mesmo escopo de unidade das marcações do dia: só as das agendas que a pessoa pode ver.
    let itens = r.itens;
    if (c.unidades) {
      const noEscopo = new Set(
        (await this.porta.agendas(c)).filter((x) => unidadeNoEscopo(c, x.unidade)).map((x) => x.id),
      );
      itens = itens.filter((m) => m.agenda !== null && noEscopo.has(m.agenda));
    }
    const ext = await this.porta.extensoes(
      c,
      itens.map((m) => m.id),
    );
    return { itens: itens.map((m) => this.resumoMarcacao(m, ext)), truncado: r.truncado };
  }

  async detalheMarcacao(c: ContextoExame, id: number): Promise<MarcacaoExameDetalhe> {
    const r = await this.porta.marcacao(c, id);
    if (!r)
      throw new ErroProblema('nao-encontrado', 404, 'Marcação não encontrada', 'A marcação não existe mais.');
    if (r.marcacao.agenda !== null) await this.exigirAgenda(c, r.marcacao.agenda);
    else if (c.unidades)
      throw new ErroProblema('nao-encontrado', 404, 'Marcação não encontrada', 'A marcação não existe mais.');
    const ext = await this.porta.extensoes(c, [id]);
    const e = ext.get(id);
    return {
      ...this.resumoMarcacao(r.marcacao, ext),
      pacienteNome: r.marcacao.paciente,
      telefone: r.contato.telefone,
      celular: r.contato.celular,
      email: r.contato.email,
      observacao: r.contato.observacao,
      solicitante: e?.solicitante ?? null,
      retorno: e?.retorno ?? false,
      marcadaPor: r.marcacao.usuario,
      marcadaEm: r.marcacao.marcadaEm,
      temSenha: r.marcacao.temSenha,
    };
  }

  async cancelamentos(
    c: ContextoExame,
    f: { de: string; ate: string; agenda: number | null; pagina: number; porPagina: number },
  ): Promise<ListaCancelamentosExame> {
    let nomes: string[] | null = null;
    if (f.agenda !== null) nomes = [(await this.exigirAgenda(c, f.agenda)).nome];
    else if (c.unidades)
      nomes = (await this.porta.agendas(c)).filter((a) => unidadeNoEscopo(c, a.unidade)).map((a) => a.nome);
    const r = await this.porta.cancelamentos(c, {
      de: f.de,
      ate: f.ate,
      agendas: nomes,
      pagina: f.pagina,
      porPagina: f.porPagina,
    });
    return {
      itens: r.itens.map((x) => ({
        agendaNome: x.nomeAgenda,
        data: x.data,
        hora: formatarHora(x.hora),
        paciente: nomeMascarado(x.paciente),
        motivo: x.motivo,
        codigoMotivo: null,
        canceladoEm: `${x.canceladoEm}${x.horaCancelamento ? ` ${formatarHora(x.horaCancelamento)}` : ''}`,
        canceladoPor: x.canceladoPor,
        marcadoPor: x.marcadoPor,
        convenio: x.convenio,
      })),
      total: r.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  }

  async residuo(c: ContextoExame, de: string, ate: string): Promise<ResiduoExameResposta> {
    const j = exigirJanela(de, ate, MAX_DIAS_RESIDUO);
    const r = await this.porta.residuo(c, j.de, j.ate);
    const cs = r.porAgenda.reduce((s, x) => s + x.confirmadosSemPaciente, 0);
    const os = r.porAgenda.reduce((s, x) => s + x.ocupadosSemMarcacao, 0);
    return {
      de: j.de,
      ate: j.ate,
      confirmadosSemPaciente: cs,
      ocupadosSemMarcacao: os,
      total: cs + os,
      porAgenda: r.porAgenda.map((x) => ({
        agenda: x.agenda,
        agendaNome: x.nomeAgenda,
        confirmadosSemPaciente: x.confirmadosSemPaciente,
        ocupadosSemMarcacao: x.ocupadosSemMarcacao,
      })),
      horarios: r.horarios.map((x) => ({
        agendaNome: x.nomeAgenda,
        data: x.data,
        hora: formatarHora(x.hora),
        tipo: x.tipo === 'confirmado-sem-paciente' ? 'Confirmado sem paciente' : 'Ocupado sem a marcação',
      })),
      truncado: r.truncado,
    };
  }

  async opcoes(c: ContextoExame): Promise<OpcoesExame> {
    const [o, r] = await Promise.all([this.porta.opcoes(c), this.porta.relogio(c)]);
    return {
      convenios: o.convenios,
      exames: o.exames,
      categorias: CATEGORIAS_EXAME.map((x) => ({ codigo: x.codigo, rotulo: x.rotulo })),
      tipos: TIPOS_HORARIO_EXAME.map((x) => ({ codigo: x.codigo, rotulo: x.rotulo })),
      motivosCancelamento: MOTIVOS_CANCELAMENTO.filter((m) => m.codigo !== 'ENCAIXE-DESFEITO').map((m) => ({
        codigo: m.codigo,
        texto: m.texto.replace(/da consulta|à consulta/g, 'ao exame'),
        solicitante: m.solicitante,
      })),
      canais: CANAIS_MARCACAO.map((x) => ({ codigo: x.codigo, rotulo: x.rotulo, aConfirmar: x.aConfirmar })),
      hoje: r.hoje,
      agora: formatarHora(r.hhmm),
    };
  }

  /** Prévia da geração (motor da agenda) sobre os horários existentes e os feriados; nada é gravado. */
  async previa(
    c: ContextoExame,
    p: {
      agenda: number;
      de: string;
      ate: string;
      duracaoMinutos: number | null;
      faixas: readonly FaixaEscala[] | null;
      incluirFeriados: boolean;
    },
  ): Promise<{ previa: PreviaGradeExame; entrada: GerarGradeExameEntrada }> {
    const a = await this.exigirAgenda(c, p.agenda);
    const [r, feriados, horarios, escala, cob] = await Promise.all([
      this.porta.relogio(c),
      this.porta.feriados(c, p.de, p.ate),
      this.porta.horarios(c, a.nome, a.crm, p.de, p.ate),
      this.porta.escala(c, a.nome, a.crm),
      this.porta.cobertura(c, a.id),
    ]);
    const faixas: FaixaEscala[] =
      p.faixas && p.faixas.length > 0
        ? [...p.faixas]
        : escala.map((l) => ({
            semana: l.semana,
            inicio: l.horaInicio,
            fim: l.horaFim,
            intervaloInicio: null,
            intervaloFim: null,
          }));
    if (faixas.length === 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Escala vazia',
        'A agenda não tem escala: informe as faixas de horário da semana.',
      );
    const duracao = p.duracaoMinutos ?? duracaoMinutos(a.duracao);
    if (!duracao)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Duração ausente',
        'A agenda não tem duração: informe a duração.',
      );
    let plano;
    try {
      plano = planejarGrade(
        { de: p.de, ate: p.ate, duracaoMinutos: duracao, faixas, incluirFeriados: p.incluirFeriados },
        {
          relogio: r,
          agendaAtiva: a.ativa === 'S',
          feriados,
          bloqueios: [],
          existentes: new Set(horarios.itens.map((h) => `${h.data} ${h.hora}`)),
          // Sábado e domingo: a escala dos exames nunca teve (SICTRAGE só de 2 a 6; <5 de 1.673 gerações com sábado).
        },
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'VetoGrade')
        throw new ErroProblema('recusa-de-negocio', 409, 'Geração recusada', e.message, {
          codigo: (e as Error & { codigo?: string }).codigo ?? 'veto',
        });
      throw e;
    }
    const fora = foraDoPadraoGradeExame({ duracao: plano.duracao, escala: plano.escala });
    if (fora)
      throw new ErroProblema('recusa-de-negocio', 409, 'Horário fora do padrão da escala', fora, {
        codigo: 'fora-do-padrao',
      });
    const entrada: GerarGradeExameEntrada = {
      agenda: a.id,
      de: p.de,
      ate: p.ate,
      duracao: plano.duracao,
      horarios: [...plano.horarios],
      escala: [...plano.escala],
      semanas: [...plano.semanas],
    };
    const assinatura = createHash('sha256').update(JSON.stringify(entrada)).digest('hex').slice(0, 32);
    return {
      entrada,
      previa: {
        agenda: this.resumo(a, new Set(cob.map((x) => x.exame)).size),
        de: p.de,
        ate: p.ate,
        duracao: formatarHora(plano.duracao),
        horarios: plano.horarios.length,
        porDia: plano.porDia.map((d) => ({
          data: d.data,
          dia: NOME_DO_DIA[d.semana] ?? '',
          horarios: d.horarios.map(formatarHora),
        })),
        pulados: {
          feriados: [...plano.pulados.feriados],
          bloqueados: plano.pulados.bloqueados,
          existentes: plano.pulados.existentes,
          cortadosHoje: plano.pulados.cortadosHoje.length,
        },
        escala: plano.escala.map((l) => ({
          semana: l.semana,
          dia: NOME_DO_DIA[l.semana] ?? '',
          duracao: formatarHora(l.duracao),
          inicio: formatarHora(l.horaInicio),
          fim: formatarHora(l.horaFim),
          intervaloInicio: l.intervaloInicio === '0000' ? null : formatarHora(l.intervaloInicio),
          intervaloFim: l.intervaloFim === '0000' ? null : formatarHora(l.intervaloFim),
        })),
        alertas: [...plano.alertas],
        assinatura,
      },
    };
  }
}
