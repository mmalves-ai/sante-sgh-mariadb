// Serviço da agenda de consultas (M17): monta as respostas das telas sobre a porta (própria ou memória) com as regras
// puras de @sgh/dominio-agenda — prévia da geração (planejarGrade), grade da semana, busca de vaga com cobertura e
// alternativas, próximo livre, painel do dia com risco de falta e candidatos, indicadores. Nenhum SQL aqui.
import { createHash } from 'node:crypto';
import {
  type AgendaResumo,
  type BuscaVagas,
  CANAIS_MARCACAO,
  type DetalheAgenda,
  type EscalaAgenda,
  type GerarGradeEntrada,
  type GradeSemana,
  type IndicadoresAgenda,
  type LigacaoAgenda,
  type LinhaEscalaResposta,
  type ListaAgendas,
  type MarcacaoDetalhe,
  type MarcadosComConvenio,
  type MarcacaoResumo,
  MOTIVOS_BLOQUEIO,
  MOTIVOS_CANCELAMENTO,
  type OpcoesAgenda,
  type PainelDia,
  type PreviaGrade,
  RESULTADOS_CONFIRMACAO,
} from '@sgh/contratos';
import {
  absenteismo,
  acoesDaMarcacao,
  alternativas,
  avaliarCobertura,
  candidatosAFalta,
  diasEntre,
  duracaoEmHoras,
  estadoDaMarcacao,
  estadoDoHorario,
  faixaAntecedencia,
  type FaixaEscala,
  formatarHora,
  funil,
  MAX_ACEITOS_NA_RESPOSTA,
  NOME_DO_DIA,
  nomeMascarado,
  ocupacao,
  partesDoNome,
  planejarGrade,
  recortarJanela,
  resumoDoDia,
  riscoDeFalta,
  rotuloSituacao,
  semanaDaData,
  somarDias,
  turnoDaHora,
  podeDesfazerEncaixe,
} from '@sgh/dominio-agenda';
import type { ComplementoMarcacao, VinculoAgenda } from './tipos.js';
import {
  type AgendaVista,
  canalDoCodigo,
  LeituraAgenda,
  type LinhaEscalaVista,
  linhaEscalaVista,
  type MarcacaoVista,
} from './visao.js';
import { ErroProblema } from '../../problema.filter.js';
import { agendaNoEscopo, restrito, unidadeDaAgenda } from './escopo.js';
import type { ContextoAgenda, PortaAgenda } from './porta.js';

/** Recusa do escopo (falha fechada, como no CRUD genérico e nas consultas do M14): nada da agenda sai. */
export const foraDoEscopo = () =>
  new ErroProblema(
    'sem-permissao',
    403,
    'Fora do seu escopo',
    'Seu acesso é restrito a outras unidades ou tipos de agenda.',
    { codigo: 'fora-do-escopo' },
  );

interface Lugares {
  readonly locais: readonly { codigo: number; nome: string }[];
  readonly unidades: readonly { codigo: number; nome: string }[];
}
const SEM_LUGARES: Lugares = { locais: [], unidades: [] };

export const JANELA_VAGAS_DIAS = 31;
export const HORIZONTE_PROXIMA_DIAS = 90;
export const JANELA_CANCELAMENTOS_DIAS = 31;
export const JANELA_INDICADORES_DIAS = 366;

const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/^(?:DRA?\.?|PROF\.?|DOUTORA?)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Ligação proposta pelo casamento do nome (a parte depois do hífen) com os profissionais (só quando é única). */
export function ligacaoDaAgenda(
  a: Pick<AgendaVista, 'id' | 'nome'> & Partial<Pick<AgendaVista, 'unidade'>>,
  revisadas: ReadonlyMap<number, VinculoAgenda>,
  profissionais: readonly { id: number; nome: string }[],
  especialidades: readonly { codigo: number; nome: string }[],
  lugares: Lugares = SEM_LUGARES,
): LigacaoAgenda {
  const r = revisadas.get(a.id);
  const { procedimento, profissional } = partesDoNome(a.nome);
  const esp = especialidades.find((e) => normal(e.nome) === normal(procedimento)) ?? null;
  const cod = unidadeDaAgenda({ unidade: a.unidade ?? null }, r);
  const unidade =
    cod === null
      ? null
      : (lugares.unidades.find((u) => u.codigo === cod) ?? { codigo: cod, nome: `Unidade ${cod}` });
  const local =
    r?.local !== null && r?.local !== undefined
      ? (lugares.locais.find((l) => l.codigo === r.local) ?? { codigo: r.local, nome: `Local ${r.local}` })
      : null;
  if (r?.situacao === 'revisada') {
    const p = profissionais.find((x) => x.id === r.profissional) ?? null;
    const e = especialidades.find((x) => x.codigo === r.especialidade) ?? null;
    return { profissional: p, especialidade: e, local, unidade, situacao: 'revisada' };
  }
  if (!profissional)
    return {
      profissional: null,
      especialidade: esp,
      local,
      unidade,
      situacao: esp ? 'proposta' : 'sem-ligacao',
    };
  const alvo = normal(profissional);
  const achados = profissionais.filter((p) => {
    const n = normal(p.nome);
    return alvo.length >= 4 && (n === alvo || n.startsWith(`${alvo} `) || alvo.startsWith(`${n} `));
  });
  const p = achados.length === 1 ? (achados[0] ?? null) : null;
  return {
    profissional: p,
    especialidade: esp,
    local,
    unidade,
    situacao: p || esp ? 'proposta' : 'sem-ligacao',
  };
}

export function resumoAgenda(a: AgendaVista, ligacao: LigacaoAgenda): AgendaResumo {
  const { procedimento, profissional } = partesDoNome(a.nome);
  return {
    id: a.id,
    nome: a.nome,
    crm: a.crm,
    procedimento,
    profissional,
    duracao: a.duracaoMinutos ? duracaoEmHoras(a.duracaoMinutos) : '',
    ativa: a.ativa,
    vigente: a.ativa && a.gradeInicio !== null,
    gradeInicio: a.gradeInicio,
    gradeFim: a.gradeFim,
    teleatendimento: a.teleatendimento,
    convenios: a.convenios,
    especialidades: a.especialidades,
    ligacao,
  };
}

export function linhaEscala(l: LinhaEscalaVista): LinhaEscalaResposta {
  const sem = !l.intervaloInicio || !l.intervaloFim;
  return {
    semana: l.semana,
    dia: NOME_DO_DIA[l.semana] ?? String(l.semana),
    duracao: l.duracaoMinutos ? duracaoEmHoras(l.duracaoMinutos) : '',
    inicio: formatarHora(l.horaInicio),
    fim: formatarHora(l.horaFim),
    intervaloInicio: sem ? null : formatarHora(l.intervaloInicio),
    intervaloFim: sem ? null : formatarHora(l.intervaloFim),
  };
}

/**
 * Origem dos dados como o contrato da tela ainda a nomeia ('memoria' = sessão sintética; o outro valor = banco do
 * cliente). Pedido de contrato registrado para o valor neutro.
 */
const destinoDaTela = (p: PortaAgenda): 'memoria' | 'legado' =>
  p.destino === 'memoria' ? 'memoria' : 'legado';

export class ServicoAgenda {
  private readonly leitura: LeituraAgenda;
  constructor(private readonly porta: PortaAgenda) {
    this.leitura = new LeituraAgenda(porta);
  }

  private async contexto(c: ContextoAgenda) {
    const [revisadas, profissionais, opcoes] = await Promise.all([
      this.porta.vinculos(c),
      this.porta.profissionais(c),
      this.porta.opcoes(c),
    ]);
    return {
      revisadas,
      profissionais,
      especialidades: opcoes.especialidades,
      lugares: { locais: opcoes.locais, unidades: opcoes.unidades },
    };
  }

  /** A agenda está no escopo da sessão (unidade pela agenda ou pela ligação revisada; tipo pela agenda)? */
  private noEscopo(c: ContextoAgenda, a: AgendaVista, ligacoes: ReadonlyMap<number, VinculoAgenda>): boolean {
    return agendaNoEscopo(c.escopo, { unidade: unidadeDaAgenda(a, ligacoes.get(a.id)), tipo: a.tipo });
  }

  /** IDs das agendas do escopo; null = sem restrição (nada a filtrar). */
  async agendasDoEscopo(c: ContextoAgenda): Promise<Set<number> | null> {
    if (!restrito(c.escopo)) return null;
    const [todas, ligacoes] = await Promise.all([this.leitura.agendas(c), this.porta.vinculos(c)]);
    return new Set(todas.filter((a) => this.noEscopo(c, a, ligacoes)).map((a) => a.id));
  }

  /** A agenda (404 se não existe; 403 se está fora do escopo da sessão). */
  async exigirAgenda(c: ContextoAgenda, id: number): Promise<AgendaVista> {
    const a = await this.leitura.agenda(c, id);
    if (!a) throw new ErroProblema('nao-encontrado', 404, 'Agenda não encontrada');
    if (restrito(c.escopo) && !this.noEscopo(c, a, await this.porta.vinculos(c))) throw foraDoEscopo();
    return a;
  }

  /** Recusa quem tem escopo restrito quando a agenda não está no escopo (null = agenda não resolvida). */
  async exigirAgendaDoEscopo(c: ContextoAgenda, agenda: number | null): Promise<void> {
    if (!restrito(c.escopo)) return;
    if (agenda === null) throw foraDoEscopo();
    await this.exigirAgenda(c, agenda);
  }

  /** A marcação, com a agenda dela conferida no escopo (404 se não existe). */
  async exigirMarcacao(c: ContextoAgenda, id: number) {
    const x = await this.leitura.marcacao(c, id);
    if (!x) throw new ErroProblema('nao-encontrado', 404, 'Marcação não encontrada');
    await this.exigirAgendaDoEscopo(c, x.marcacao.agenda);
    return x;
  }

  /**
   * Escopo das gravações pelo executor: a agenda, o destino ou a marcação da entrada (a geração é resolvida pela
   * porta). A agenda nova ainda não tem unidade nem categoria: só quem não tem escopo restrito a inclui.
   */
  async exigirEscopoDaEntrada(c: ContextoAgenda, op: string, entrada: unknown): Promise<void> {
    if (!restrito(c.escopo)) return;
    const e = (entrada ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
    if (op === 'agenda.incluirAgenda') {
      if (!agendaNoEscopo(c.escopo, { unidade: null, tipo: null })) throw foraDoEscopo();
      return;
    }
    const agenda = num(e['agenda']);
    if (agenda !== null) await this.exigirAgenda(c, agenda);
    const destino = num((e['destino'] as Record<string, unknown> | undefined)?.['agenda']);
    if (destino !== null) await this.exigirAgenda(c, destino);
    const marcacao = num(e['marcacao']);
    if (marcacao !== null) await this.exigirMarcacao(c, marcacao);
    const geracao = num(e['geracao']);
    if (geracao !== null) await this.exigirAgendaDoEscopo(c, await this.porta.agendaDaGeracao(c, geracao));
    if (agenda === null && destino === null && marcacao === null && geracao === null) throw foraDoEscopo();
  }

  async resumo(c: ContextoAgenda, a: AgendaVista): Promise<AgendaResumo> {
    const x = await this.contexto(c);
    return resumoAgenda(a, ligacaoDaAgenda(a, x.revisadas, x.profissionais, x.especialidades, x.lugares));
  }

  async listar(
    c: ContextoAgenda,
    f: {
      termo?: string | null;
      situacao?: string | null;
      especialidade?: number | null;
      unidade?: number | null;
      local?: number | null;
    },
  ): Promise<ListaAgendas> {
    const [todas, x] = await Promise.all([this.leitura.agendas(c), this.contexto(c)]);
    const termo = f.termo ? normal(f.termo) : '';
    const itens = todas
      .filter((a) => this.noEscopo(c, a, x.revisadas))
      .map((a) =>
        resumoAgenda(a, ligacaoDaAgenda(a, x.revisadas, x.profissionais, x.especialidades, x.lugares)),
      )
      .filter((a) => (termo ? normal(a.nome).includes(termo) : true))
      .filter((a) =>
        f.situacao === 'ativas'
          ? a.ativa
          : f.situacao === 'inativas'
            ? !a.ativa
            : f.situacao === 'vigentes'
              ? a.vigente
              : true,
      )
      .filter((a) => (f.especialidade ? a.ligacao.especialidade?.codigo === f.especialidade : true))
      .filter((a) => (f.unidade ? a.ligacao.unidade?.codigo === f.unidade : true))
      .filter((a) => (f.local ? a.ligacao.local?.codigo === f.local : true));
    return { itens, total: itens.length, destino: destinoDaTela(this.porta) };
  }

  async detalhe(c: ContextoAgenda, id: number): Promise<DetalheAgenda> {
    const a = await this.exigirAgenda(c, id);
    const [conv, esp, escala, resumo, profissionais] = await Promise.all([
      this.porta.conveniosDaAgenda(c, id),
      this.porta.especialidadesDaAgenda(c, id),
      this.leitura.escala(c, a),
      this.resumo(c, a),
      this.porta.profissionais(c),
    ]);
    return {
      agenda: resumo,
      versao: { duracaoMinutos: a.duracaoMinutos, ativa: a.ativa, teleatendimento: a.teleatendimento },
      convenios: conv.map((x) => ({ ...x, particular: x.codigo === 10 })),
      aceitaTodos: conv.length === 0,
      especialidades: esp,
      escala: escala.map(linhaEscala),
      profissionais: [...profissionais].sort((x, y) => x.nome.localeCompare(y.nome)),
      destino: destinoDaTela(this.porta),
    };
  }

  async opcoes(c: ContextoAgenda): Promise<OpcoesAgenda> {
    const [o, r] = await Promise.all([this.porta.opcoes(c), this.leitura.relogio(c)]);
    return {
      convenios: [...o.convenios],
      especialidades: [...o.especialidades],
      locais: [...o.locais],
      unidades: [...o.unidades],
      motivosCancelamento: MOTIVOS_CANCELAMENTO.map((m) => ({ ...m })),
      canais: CANAIS_MARCACAO.map((x) => ({ codigo: x.codigo, rotulo: x.rotulo, aConfirmar: x.aConfirmar })),
      motivosBloqueio: MOTIVOS_BLOQUEIO.map((m) => ({ ...m })),
      resultadosConfirmacao: RESULTADOS_CONFIRMACAO.map((x) => ({ codigo: x.codigo, rotulo: x.rotulo })),
      hoje: r.hoje,
      agora: formatarHora(r.hhmm),
    };
  }

  async escala(c: ContextoAgenda, id: number): Promise<EscalaAgenda> {
    const a = await this.exigirAgenda(c, id);
    const [linhas, geracoes, planejadas, resumo] = await Promise.all([
      this.leitura.escala(c, a),
      this.porta.geracoes(c, id),
      this.porta.escalasPlanejadas(c, id),
      this.resumo(c, a),
    ]);
    const duracaoAgenda = a.duracaoMinutos;
    return {
      agenda: resumo,
      escala: linhas.map(linhaEscala),
      planejadas: planejadas.map((p) => ({
        id: p.id,
        vigenteDesde: p.vigenteDesde,
        linhas: p.faixas.map((f) => linhaEscala(linhaEscalaVista(f, duracaoAgenda))),
        autor: p.autor,
        em: p.em,
      })),
      geracoes: geracoes.map((g) => ({
        id: g.id,
        inicio: g.inicio,
        fim: g.fim,
        em: g.em.replace('T', ' ').slice(0, 16),
        autor: g.autor,
        situacao: 'criacao' as const,
        duracao: g.duracaoMinutos ? duracaoEmHoras(g.duracaoMinutos) : null,
        dias: g.diasSemana.map((d) => NOME_DO_DIA[d] ?? ''),
        horarios: g.horarios,
        reversivel: g.revertidaEm === null,
        revertida: g.revertidaEm !== null,
      })),
      truncado: false,
    };
  }

  /** Faixas pedidas: as informadas, ou a escala planejada vigente no início, ou o modelo atual da agenda. */
  private async faixasPara(
    c: ContextoAgenda,
    a: AgendaVista,
    de: string,
    faixas: readonly FaixaEscala[] | null,
  ): Promise<FaixaEscala[]> {
    if (faixas && faixas.length > 0) return [...faixas];
    const planejadas = (await this.porta.escalasPlanejadas(c, a.id))
      .filter((p) => p.vigenteDesde <= de)
      .sort((x, y) => y.vigenteDesde.localeCompare(x.vigenteDesde));
    const linhas = planejadas[0]
      ? planejadas[0].faixas.map((f) => linhaEscalaVista(f))
      : await this.leitura.escala(c, a);
    return linhas.map((l) => ({
      semana: l.semana,
      inicio: l.horaInicio,
      fim: l.horaFim,
      intervaloInicio: l.intervaloInicio && l.intervaloFim ? l.intervaloInicio : null,
      intervaloFim: l.intervaloInicio && l.intervaloFim ? l.intervaloFim : null,
    }));
  }

  async previa(
    c: ContextoAgenda,
    p: {
      agenda: number;
      de: string;
      ate: string;
      duracaoMinutos: number | null;
      faixas: readonly FaixaEscala[] | null;
      incluirFeriados: boolean;
    },
  ): Promise<{ previa: PreviaGrade; entrada: GerarGradeEntrada }> {
    const a = await this.exigirAgenda(c, p.agenda);
    const [r, feriados, horarios, bloqueios] = await Promise.all([
      this.leitura.relogio(c),
      this.porta.feriados(c, p.de, p.ate),
      this.leitura.horarios(c, a.id, p.de, p.ate),
      this.porta.bloqueios(c, { agenda: a.id, ativos: true, de: p.de, ate: p.ate }),
    ]);
    const faixas = await this.faixasPara(c, a, p.de, p.faixas);
    if (faixas.length === 0)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Escala vazia',
        'A agenda não tem escala: informe as faixas de horário da semana.',
      );
    const duracao = p.duracaoMinutos ?? a.duracaoMinutos;
    if (!duracao)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Duração ausente',
        'A agenda não tem duração cadastrada: informe a duração.',
      );
    let plano;
    try {
      plano = planejarGrade(
        { de: p.de, ate: p.ate, duracaoMinutos: duracao, faixas, incluirFeriados: p.incluirFeriados },
        {
          relogio: r,
          agendaAtiva: a.ativa,
          feriados,
          bloqueios: bloqueios.map((b) => ({
            inicio: b.inicio,
            fim: b.fim,
            horaInicio: b.horaInicio,
            horaFim: b.horaFim,
          })),
          existentes: new Set(horarios.itens.map((h) => `${h.data} ${h.hora}`)),
        },
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'VetoGrade')
        throw new ErroProblema('recusa-de-negocio', 409, 'Geração recusada', e.message, {
          codigo: (e as Error & { codigo?: string }).codigo ?? 'veto',
        });
      throw e;
    }
    const entrada: GerarGradeEntrada = {
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
        agenda: await this.resumo(c, a),
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
        escala: plano.escala.map((l) =>
          linhaEscala({
            semana: l.semana,
            duracaoMinutos: duracao,
            horaInicio: l.horaInicio,
            horaFim: l.horaFim,
            intervaloInicio: l.intervaloInicio,
            intervaloFim: l.intervaloFim,
          }),
        ),
        alertas: [...plano.alertas],
        assinatura,
      },
    };
  }

  async gradeSemana(c: ContextoAgenda, id: number, inicio: string): Promise<GradeSemana> {
    const a = await this.exigirAgenda(c, id);
    const fim = somarDias(inicio, 6);
    const [r, h, resumo] = await Promise.all([
      this.leitura.relogio(c),
      this.leitura.horarios(c, a.id, inicio, fim),
      this.resumo(c, a),
    ]);
    const dias = Array.from({ length: 7 }, (_, i) => somarDias(inicio, i)).map((data) => ({
      data,
      dia: NOME_DO_DIA[semanaDaData(data)] ?? '',
      horarios: h.itens
        .filter((x) => x.data === data)
        .map((x) => ({
          hora: formatarHora(x.hora),
          estado: estadoDoHorario(x, r),
          situacao: x.situacao,
          rotuloSituacao: x.paciente
            ? rotuloSituacao(x.situacao)
            : x.situacao
              ? rotuloSituacao(x.situacao)
              : '',
          encaixe: x.tipo === 'E',
          paciente: nomeMascarado(x.paciente),
          marcacao: x.marcacao,
        })),
    }));
    const todos = h.itens;
    return {
      agenda: resumo,
      inicio,
      fim,
      dias,
      totais: {
        horarios: todos.length,
        vagos: todos.filter((x) => estadoDoHorario(x, r) === 'vago').length,
        ocupados: todos.filter((x) => x.paciente !== '').length,
        bloqueados: todos.filter((x) => x.livre === 'N' && x.paciente === '').length,
        encaixes: todos.filter((x) => x.tipo === 'E').length,
      },
    };
  }

  async buscarVagas(
    c: ContextoAgenda,
    f: {
      agenda: number | null;
      especialidade: number | null;
      profissional: string | null;
      convenio: number | null;
      turno: string | null;
      de: string | null;
      ate: string | null;
      unidade?: number | null;
      local?: number | null;
    },
  ): Promise<BuscaVagas> {
    const r = await this.leitura.relogio(c);
    const de = f.de && f.de > r.hoje ? f.de : r.hoje;
    const jan = recortarJanela(de, f.ate && f.ate >= de ? f.ate : somarDias(de, 13), JANELA_VAGAS_DIAS);
    const lista = await this.listar(c, { situacao: 'ativas' });
    let alvo = lista.itens;
    if (f.unidade) alvo = alvo.filter((a) => a.ligacao.unidade?.codigo === f.unidade);
    if (f.local) alvo = alvo.filter((a) => a.ligacao.local?.codigo === f.local);
    if (f.agenda) alvo = alvo.filter((a) => a.id === f.agenda);
    if (f.especialidade) {
      const esp = (await this.porta.opcoes(c)).especialidades.find((e) => e.codigo === f.especialidade);
      alvo = alvo.filter(
        (a) =>
          a.ligacao.especialidade?.codigo === f.especialidade ||
          (esp && normal(a.procedimento) === normal(esp.nome)),
      );
    }
    if (f.profissional) {
      const t = normal(f.profissional);
      alvo = alvo.filter(
        (a) =>
          normal(a.profissional ?? '').includes(t) || normal(a.ligacao.profissional?.nome ?? '').includes(t),
      );
    }
    const cobertura = await this.porta.cobertura(
      c,
      alvo.map((a) => a.id),
    );
    const recusas: BuscaVagas['recusasCobertura'] = [];
    if (f.convenio !== null) {
      const opcoes = await this.porta.opcoes(c);
      const todas = lista.itens.map((a) => ({
        nome: a.nome,
        aceitos: cobertura.get(a.id) ?? [],
        vigente: a.vigente,
      }));
      const aceitam = alvo.filter(
        (a) => avaliarCobertura(cobertura.get(a.id) ?? [], f.convenio as number).aceito,
      );
      for (const a of alvo.filter((x) => !aceitam.includes(x))) {
        const aceitos = cobertura.get(a.id) ?? [];
        recusas.push({
          agenda: a.id,
          nomeAgenda: a.nome,
          aceitos: aceitos.slice(0, MAX_ACEITOS_NA_RESPOSTA).map((cod) => ({
            codigo: cod,
            nome: opcoes.convenios.find((x) => x.codigo === cod)?.nome ?? String(cod),
          })),
          totalAceitos: aceitos.length,
          alternativas: alternativas(todas, a.nome, f.convenio),
        });
      }
      alvo = aceitam;
    }
    if (alvo.length === 0)
      return {
        vagas: [],
        proximas: [],
        de: jan.de,
        ate: jan.ate,
        recortada: jan.recortada,
        truncado: false,
        recusasCobertura: recusas,
      };
    const v = await this.leitura.vagas(c, { agendas: alvo.map((a) => a.id), de: jan.de, ate: jan.ate });
    const porId = new Map(alvo.map((a) => [a.id, a]));
    const vagas = v.itens
      .map((x) => {
        const a = porId.get(x.agenda);
        return {
          agenda: x.agenda,
          nomeAgenda: x.nomeAgenda,
          procedimento: a?.procedimento ?? '',
          profissional: a?.profissional ?? null,
          data: x.data,
          hora: formatarHora(x.hora),
          turno: turnoDaHora(x.hora),
          aceitaConvenio: true,
        };
      })
      .filter((x) => (f.turno ? x.turno === f.turno : true));
    const semVaga = alvo.filter((a) => !vagas.some((x) => x.agenda === a.id)).map((a) => a.id);
    const proximas = (
      await this.leitura.proximasVagas(c, semVaga, jan.ate, somarDias(r.hoje, HORIZONTE_PROXIMA_DIAS))
    ).map((x) => ({
      agenda: x.agenda,
      nomeAgenda: x.nomeAgenda,
      data: x.data,
      hora: formatarHora(x.hora),
    }));
    return {
      vagas,
      proximas,
      de: jan.de,
      ate: jan.ate,
      recortada: jan.recortada,
      truncado: v.truncado,
      recusasCobertura: recusas,
    };
  }

  resumoMarcacao(
    m: MarcacaoVista,
    ext: ComplementoMarcacao | undefined,
    r: { hoje: string; hhmm: string },
    mascarar: boolean,
  ): MarcacaoResumo {
    const sinais = { atendido: m.atendido, situacaoHorario: m.situacaoHorario, temSenha: m.temSenha };
    const acoes = acoesDaMarcacao(sinais, { data: m.data, hora: m.hora }, r);
    const canal = canalDoCodigo(ext?.canal ?? m.canal);
    return {
      id: m.id,
      agenda: m.agenda ?? 0,
      nomeAgenda: m.nomeAgenda,
      data: m.data,
      hora: formatarHora(m.hora),
      paciente: mascarar ? nomeMascarado(m.paciente) : m.paciente,
      idPaciente: m.idPaciente,
      prontuario: m.prontuario,
      convenio: m.convenio,
      nomeConvenio: m.nomeConvenio,
      retorno: m.retorno,
      encaixe: m.encaixe,
      estado: estadoDaMarcacao(sinais),
      rotuloSituacao: rotuloSituacao(m.situacaoHorario),
      canal: canal.rotulo,
      canalAConfirmar: canal.aConfirmar,
      marcadaEm: m.dataMarcacao,
      prioridadeLegal: m.prioridadeLegal ?? null,
      risco: riscoDeFalta(faixaAntecedencia(m.dataMarcacao, m.data)),
      acoes: {
        ...acoes,
        desfazerEncaixe: m.encaixe && podeDesfazerEncaixe({ temSenha: m.temSenha, atendido: m.atendido }),
      },
    };
  }

  /** Marcações futuras da agenda com o convênio (um ano à frente, teto da leitura), nome mascarado. */
  async marcadosComConvenio(c: ContextoAgenda, id: number, convenio: number): Promise<MarcadosComConvenio> {
    const a = await this.exigirAgenda(c, id);
    const r = await this.leitura.relogio(c);
    const l = await this.leitura.marcacoesDaJanela(c, a.id, r.hoje, somarDias(r.hoje, 366));
    const itens = l.itens.filter((m) => m.convenio === convenio);
    const ext = await this.porta.complementos(
      c,
      itens.map((m) => m.id),
    );
    return {
      agenda: id,
      convenio,
      itens: itens.map((m) => this.resumoMarcacao(m, ext.get(m.id), r, true)),
      truncado: l.truncado,
    };
  }

  async painelDia(
    c: ContextoAgenda,
    data: string,
    agenda: number | null,
    toleranciaMin: number,
  ): Promise<PainelDia> {
    const r = await this.leitura.relogio(c);
    let a: AgendaVista | null = null;
    let lista: MarcacaoVista[];
    if (agenda) {
      a = await this.exigirAgenda(c, agenda);
      lista = (await this.leitura.marcacoesDaJanela(c, a.id, data, data)).itens;
    } else {
      lista = (await this.leitura.marcacoesDoDia(c, data)).itens;
      const ids = await this.agendasDoEscopo(c);
      if (ids) lista = lista.filter((m) => m.agenda !== null && ids.has(m.agenda));
    }
    const ext = await this.porta.complementos(
      c,
      lista.map((m) => m.id),
    );
    const resumo = resumoDoDia(
      lista.map((m) => ({
        id: m.id,
        data: m.data,
        hora: m.hora,
        atendido: m.atendido,
        situacaoHorario: m.situacaoHorario,
        temSenha: m.temSenha,
        dataMarcacao: m.dataMarcacao,
      })),
    );
    const candidatos = candidatosAFalta(
      lista.map((m) => ({
        id: m.id,
        data: m.data,
        hora: m.hora,
        atendido: m.atendido,
        situacaoHorario: m.situacaoHorario,
        temSenha: m.temSenha,
        dataMarcacao: m.dataMarcacao,
      })),
      r,
      toleranciaMin,
    );
    return {
      agenda: a ? await this.resumo(c, a) : null,
      data,
      marcacoes: lista.map((m) => this.resumoMarcacao(m, ext.get(m.id), r, true)),
      resumo,
      candidatosAFalta: candidatos.map((m) => m.id),
      agora: formatarHora(r.hhmm),
    };
  }

  async detalheMarcacao(c: ContextoAgenda, id: number): Promise<MarcacaoDetalhe> {
    const x = await this.exigirMarcacao(c, id);
    const [r, ext, conf] = await Promise.all([
      this.leitura.relogio(c),
      this.porta.complementos(c, [id]),
      this.porta.confirmacoes(c, id),
    ]);
    const e = ext.get(id);
    return {
      ...this.resumoMarcacao(x.marcacao, e, r, false),
      telefone: x.contato.telefone,
      celular: x.contato.celular,
      observacao: x.contato.observacao,
      marcadaPor: x.marcacao.usuario,
      remarcadaDe: e?.remarcadaDe ?? null,
      confirmacoes: conf.map((k) => ({
        resultado: k.resultado,
        rotulo: RESULTADOS_CONFIRMACAO.find((y) => y.codigo === k.resultado)?.rotulo ?? k.resultado,
        em: k.em,
        por: k.por,
      })),
      temSenha: x.marcacao.temSenha,
    };
  }

  async marcacoesDoPaciente(c: ContextoAgenda, id: number) {
    const [r, l0, ids] = await Promise.all([
      this.leitura.relogio(c),
      this.leitura.marcacoesDoPaciente(c, id),
      this.agendasDoEscopo(c),
    ]);
    const doEscopo = (m: MarcacaoVista) => !ids || (m.agenda !== null && ids.has(m.agenda));
    const itens = l0.itens.filter(doEscopo);
    const nomesNoEscopo = ids
      ? new Set((await this.leitura.agendas(c)).filter((a) => ids.has(a.id)).map((a) => a.nome))
      : null;
    const ext = await this.porta.complementos(
      c,
      itens.map((m) => m.id),
    );
    return {
      paciente: id,
      marcacoes: itens.map((m) => this.resumoMarcacao(m, ext.get(m.id), r, false)),
      truncado: l0.truncado,
      // Toda marcação do banco próprio tem o paciente (ou o pré-cadastro): não há "possíveis" a conferir pelo nome.
      possiveis: [],
      preCadastros: l0.preCadastros
        .filter((p) => !nomesNoEscopo || nomesNoEscopo.has(p.nomeAgenda))
        .map((p) => ({ nomeAgenda: p.nomeAgenda, data: p.data })),
    };
  }

  async indicadores(c: ContextoAgenda, de: string, ate: string): Promise<IndicadoresAgenda> {
    // Os agregados somam todas as agendas do estabelecimento (funil, antecedência e canal não separam por agenda):
    // quem tem escopo restrito não os vê (falha fechada, D-ESC-17).
    if (restrito(c.escopo)) throw foraDoEscopo();
    const jan = recortarJanela(de, ate, JANELA_INDICADORES_DIAS);
    const x = await this.porta.indicadores(c, jan.de, jan.ate);
    const ordem = ['mesmo-dia', 'ate-7', 'de-8-a-30', 'mais-de-30', 'nao-informada'];
    const rot: Record<string, string> = {
      'mesmo-dia': 'No mesmo dia',
      'ate-7': '1 a 7 dias',
      'de-8-a-30': '8 a 30 dias',
      'mais-de-30': 'Mais de 30 dias',
      'nao-informada': 'Não informada',
    };
    const ant = [...absenteismo(x.porAntecedencia).linhas].sort(
      (a, b) => ordem.indexOf(a.chave) - ordem.indexOf(b.chave),
    );
    return {
      de: jan.de,
      ate: jan.ate,
      recortada: jan.recortada,
      funil: funil(x.funil),
      ocupacao: [...ocupacao(x.ocupacao, 'especialidade').linhas],
      absenteismoPorAntecedencia: ant.map((l) => ({ ...l, chave: rot[l.chave] ?? l.chave })),
      absenteismoPorEspecialidade: [...absenteismo(x.porAgenda, true).linhas],
      porCanal: x.porCanal.map((k) => ({ canal: canalDoCodigo(k.canal).rotulo, marcados: k.marcados })),
    };
  }

  /** Janela de cancelamentos: obrigatória e até 31 dias (sem índice por data: DP-7). */
  janelaCancelamentos(de: string | null, ate: string | null, hoje: string) {
    const fim = ate ?? hoje;
    const ini = de ?? somarDias(fim, -6);
    if (ini > fim)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início vem depois do fim.');
    if (diasEntre(ini, fim) + 1 > JANELA_CANCELAMENTOS_DIAS)
      return recortarJanela(ini, fim, JANELA_CANCELAMENTOS_DIAS);
    return { de: ini, ate: fim, recortada: false };
  }
}
