// W0-03, mercado M5 (critério 13): o serviço da contenção mecânica. Decide no servidor o que a tela só mostra — os
// horários da checagem aprazados pela ordem (gravados com ela), a situação (ativa, vencida, retirada, renovada), o estado
// de cada horário (pendente, atrasado pela tolerância, feito, cancelado pela retirada), o alerta da ordem vencida (na
// tela e na central, pela vigia) e o indicador do período com o numerador e o denominador impressos. O motor é
// @sgh/dominio-enfermagem (regras sem banco). Base: Resolução COFEN 427/2012.
import type {
  ChecagemContencaoNoTurno,
  ContencaoLida,
  IndicadorContencaoResposta,
  MembroContencao,
  MotivoContencao,
  OrdemContencaoEntrada,
  TipoContencao,
} from '@sgh/contratos';
import {
  ACHADOS_OBRIGATORIOS_CONTENCAO,
  checagensPorTurno,
  conferirOrdem,
  diferencaMinutos,
  fimDaOrdem,
  horariosDeChecagem,
  indicadorContencao,
  PARAMETROS_CONTENCAO_PADRAO,
  type ParametrosContencao,
  situacaoDaOrdem,
  somarMinutos,
} from '@sgh/dominio-enfermagem';
import type { ContextoNucleo } from '@sgh/nucleo';
import type { ContencaoRegistrada, Internado, OrdemContencao } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { PortaEscores } from './escores-porta.js';
import type { PortaEnfermagem } from './porta.js';

export const EVENTO_AVISO_CONTENCAO_VENCIDA = 'enfermagem.contencao.vencida';

/** Os parâmetros lidos (fora da faixa, o padrão de mercado). */
export function parametrosContencao(
  prazo: number,
  intervalo: number,
  tolerancia: unknown,
): ParametrosContencao {
  const tol = Number(tolerancia);
  return {
    prazoMaximoHoras:
      prazo >= 1 && prazo <= 24 ? Math.trunc(prazo) : PARAMETROS_CONTENCAO_PADRAO.prazoMaximoHoras,
    intervaloPadraoMinutos:
      intervalo >= 15 && intervalo <= 120
        ? Math.trunc(intervalo)
        : PARAMETROS_CONTENCAO_PADRAO.intervaloPadraoMinutos,
    toleranciaMinutos:
      tolerancia !== null && tolerancia !== undefined && tolerancia !== '' && tol >= 0 && tol <= 60
        ? Math.trunc(tol)
        : PARAMETROS_CONTENCAO_PADRAO.toleranciaMinutos,
  };
}

const ordemLida = (o: ContencaoRegistrada) => ({
  id: o.id,
  inicio: o.inicio,
  prazoHoras: o.prazoHoras,
  intervaloMinutos: o.intervaloMinutos,
  encerradaEm: o.encerramento?.em ?? null,
  encerramento: o.encerramento?.tipo ?? null,
  renovadaPor: o.renovadaPor,
  renovadaEm: o.renovadaEm ?? null,
});

/**
 * Revisão W0-03: o corte da ordem — a hora da retirada ou, na renovação (mesmo antes do fim do prazo), o início da
 * ordem nova. Os horários depois dele não checados ficam cancelados (são da nova) e não contam como previstos.
 */
const corteDa = (o: ContencaoRegistrada): string | null => {
  const cortes = [
    o.encerramento?.em.slice(0, 16) ?? null,
    o.renovadaPor !== null && o.renovadaEm ? o.renovadaEm.slice(0, 16) : null,
  ].filter((x): x is string => x !== null);
  return cortes.length ? cortes.sort()[0]! : null;
};

/** A ordem lida no formato da tela, com a situação e o estado de cada horário. */
export function contencaoParaTela(
  o: ContencaoRegistrada,
  agora: string,
  toleranciaMinutos: number,
  inicioDiurno = '0700',
): ContencaoLida {
  const t = contencaoParaTelaSemTurnos(o, agora, toleranciaMinutos);
  // W1-08: a checagem de perfusão e pele por turno da enfermagem (o aprazamento da ordem no turno).
  return { ...t, turnos: checagensPorTurno(t.horarios, inicioDiurno) };
}

function contencaoParaTelaSemTurnos(
  o: ContencaoRegistrada,
  agora: string,
  toleranciaMinutos: number,
): ContencaoLida {
  const ag = agora.slice(0, 16);
  const corte = corteDa(o);
  return {
    id: o.id,
    paciente: o.paciente,
    atendimento: o.atendimento,
    unidade: o.unidade,
    motivo: o.motivo as MotivoContencao,
    justificativa: o.justificativa,
    tipo: o.tipo as TipoContencao,
    membros: o.membros as MembroContencao[],
    prazoHoras: o.prazoHoras,
    intervaloMinutos: o.intervaloMinutos,
    inicio: o.inicio.slice(0, 16),
    fim: fimDaOrdem(o),
    anterior: o.anterior,
    renovadaPor: o.renovadaPor,
    renovadaEm: o.renovadaPor !== null ? (o.renovadaEm?.slice(0, 16) ?? null) : null,
    prescritor: o.prescritor,
    situacao: situacaoDaOrdem(ordemLida(o), ag),
    inativa: o.encerramento?.tipo === 'inativacao',
    encerramento: o.encerramento ? { ...o.encerramento, em: o.encerramento.em.slice(0, 16) } : null,
    horarios: o.horarios.map((h) => {
      if (h.checagem)
        return {
          previsto: h.previsto,
          estado: 'feita' as const,
          checagem: {
            ...h.checagem,
            feitaEm: h.checagem.feitaEm.slice(0, 16),
            noPrazo: diferencaMinutos(h.previsto, h.checagem.feitaEm.slice(0, 16)) <= toleranciaMinutos,
            adendos: (h.checagem.adendos ?? []).map((d) => ({ ...d, em: d.em.slice(0, 16) })),
          },
        };
      // A retirada cancela os horários depois dela; a inativação, todos os ainda não feitos; a renovação (mesmo antes
      // do fim do prazo), os depois do início da nova, que ficam com a nova (não contam como atrasados).
      const cancelada = o.encerramento?.tipo === 'inativacao' || (corte !== null && h.previsto > corte);
      return {
        previsto: h.previsto,
        estado: cancelada
          ? ('cancelada' as const)
          : diferencaMinutos(h.previsto, ag) > toleranciaMinutos
            ? ('atrasada' as const)
            : ('pendente' as const),
        checagem: null,
      };
    }),
  };
}

const recusa = (codigo: string, detalhe: string, campos?: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não registrado', detalhe, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });
const invalida = (codigo: string, detalhe: string, campos?: readonly string[]) =>
  new ErroProblema('entrada-invalida', 422, 'Registro incompleto', detalhe, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });

/** A ordem (ou a renovação) pronta para gravar: conferida contra os parâmetros e com os horários aprazados. */
export function prepararOrdem(
  e: OrdemContencaoEntrada,
  internado: Internado,
  agora: string,
  p: ParametrosContencao,
  prescritor: string,
  anterior: number | null,
): Omit<OrdemContencao, 'hospital'> {
  const c = conferirOrdem(e, p);
  if (!c.ok) throw invalida(c.codigo, c.mensagem, ['prazoHoras', 'intervaloMinutos']);
  const inicio = agora.slice(0, 16);
  return {
    paciente: internado.paciente,
    atendimento: internado.atendimento,
    unidade: internado.unidade || null,
    motivo: e.motivo,
    justificativa: e.justificativa,
    tipo: e.tipo,
    membros: e.membros,
    prazoHoras: e.prazoHoras,
    intervaloMinutos: e.intervaloMinutos,
    inicio,
    horarios: horariosDeChecagem({ inicio, prazoHoras: e.prazoHoras, intervaloMinutos: e.intervaloMinutos }),
    anterior,
    prescritor,
  };
}

/** A checagem só no horário aprazado, a partir da tolerância antes dele (não se checa o futuro). */
export function conferirChecagem(previsto: string, agora: string, toleranciaMinutos: number): void {
  if (previsto.slice(0, 16) > somarMinutos(agora.slice(0, 16), Math.max(toleranciaMinutos, 0)))
    throw recusa(
      'checagem-antecipada',
      'Este horário ainda não chegou: a checagem é registrada no horário aprazado.',
      ['previsto'],
    );
}

/** Os avisos da central das ordens vencidas: ao prescritor da ordem e aos logins configurados da unidade. */
export function avisosDeVencidas(
  ordens: readonly ContencaoRegistrada[],
  agora: string,
  loginsExtras: readonly string[] = [],
) {
  const r: {
    login: string;
    tipo: string;
    gravidade: 'grave';
    modulo: string;
    evento: string;
    titulo: string;
    link: string;
    objetoTabela: string;
    objetoChave: string;
  }[] = [];
  for (const o of ordens) {
    if (situacaoDaOrdem(ordemLida(o), agora.slice(0, 16)) !== 'vencida') continue;
    const titulo = `Contenção mecânica vencida desde ${fimDaOrdem(o).slice(11, 16)}: retirar ou renovar com nova avaliação`;
    for (const login of new Set([o.prescritor, ...loginsExtras].filter(Boolean)))
      r.push({
        login,
        tipo: 'contencao-vencida',
        gravidade: 'grave',
        modulo: 'enfermagem',
        evento: EVENTO_AVISO_CONTENCAO_VENCIDA,
        titulo: titulo.slice(0, 120),
        link: `/enfermagem/contencao?atendimento=${o.atendimento}`,
        objetoTabela: 'contencao_paciente',
        objetoChave: String(o.id),
      });
  }
  return r;
}

/** O indicador do período da unidade, com o numerador e o denominador impressos. */
export function indicadorDoPeriodo(
  unidade: string,
  de: string,
  ate: string,
  ordens: readonly ContencaoRegistrada[],
  censo: { pacientesDia: number; diasFechados: number },
  agora: string,
  toleranciaMinutos: number,
): IndicadorContencaoResposta {
  const fimPeriodo = `${ate}T23:59` < agora.slice(0, 16) ? `${ate}T23:59` : agora.slice(0, 16);
  const validas = ordens.filter((o) => o.encerramento?.tipo !== 'inativacao');
  const checagens = validas.flatMap((o) =>
    o.horarios.flatMap((h) => (h.checagem ? [{ previsto: h.previsto, feitaEm: h.checagem.feitaEm }] : [])),
  );
  // As previstas: os horários até o fim do período (ou agora) que não foram cancelados pela retirada nem pela
  // renovação (os depois do início da nova são da nova: não se contam duas vezes).
  const previstas = validas.reduce((a, o) => {
    const corte = corteDa(o);
    return (
      a +
      o.horarios.filter(
        (h) => h.previsto <= fimPeriodo && (h.checagem !== null || corte === null || h.previsto <= corte),
      ).length
    );
  }, 0);
  const i = indicadorContencao(
    ordens.map((o) => ({ ...ordemLida(o), renovaAnterior: o.anterior !== null })),
    checagens,
    previstas,
    censo.pacientesDia,
    fimPeriodo,
    toleranciaMinutos,
  );
  const fmt = (x: number | null, suf: string) => (x === null ? 'sem denominador' : `${x}${suf}`);
  return {
    unidade,
    de,
    ate,
    ...i,
    diasFechados: censo.diasFechados,
    impressao:
      `Contenções por 1.000 pacientes-dia: ${i.contencoes.numerador} / ${i.contencoes.denominador} × 1.000 = ` +
      `${fmt(i.contencoes.por1000, '')}. Checagens no prazo: ${i.checagensNoPrazo.numerador} / ` +
      `${i.checagensNoPrazo.denominador} = ${fmt(i.checagensNoPrazo.percentual, '%')}. Horas contidas: ${i.horasContidas}. ` +
      `Vencidas sem renovação nem retirada no prazo: ${i.vencidasSemRenovacao.numerador} / ` +
      `${i.vencidasSemRenovacao.denominador} = ${fmt(i.vencidasSemRenovacao.percentual, '%')} ` +
      `(${i.vencidasSemRenovacao.emAberto} ainda sem retirada).`,
  };
}

/**
 * A vigia da ordem vencida: a cada ciclo, por estabelecimento, as ordens abertas das últimas 48 horas que passaram do
 * prazo sem retirada nem renovação viram aviso na central (ao prescritor; o repetido não é gravado de novo), com a
 * linha da trilha na mesma transação. Sem núcleo (memória), roda só quando chamada (testes).
 */
/** Nenhum aviso novo no ciclo da vigia: desfaz a transação (sem a linha da trilha). */
class NadaNovo extends Error {
  override readonly name = 'NadaNovo';
}

export class VigiaContencao {
  private timer: ReturnType<typeof setInterval> | null = null;

  /** `alvos`: o cliente e cada estabelecimento vigiado (o contexto do núcleo, sem usuário: processo automático). */
  constructor(
    private readonly porta: PortaEscores,
    private readonly enfermagem: PortaEnfermagem,
    private readonly alvos: readonly ContextoNucleo[],
    private readonly intervaloMs = 60_000,
  ) {}

  async ciclo(alvo: ContextoNucleo): Promise<number> {
    const c: ContextoNucleo = { ...alvo, usuario: null, correlacao: `vigia-contencao-${Date.now()}` };
    const agora = (await this.enfermagem.relogio(c)).slice(0, 16);
    // Também as abertas mais antigas (a vencida e não retirada segue alertando).
    const ordens = await this.porta.contencoes(c, { desde: somarMinutos(agora, -48 * 60), abertas: true });
    const avisos = avisosDeVencidas(ordens, agora);
    if (avisos.length === 0) return 0;
    // O aviso já gravado não se grava de novo, e sem aviso novo a transação é desfeita sem trilha (a trilha é só
    // inclusão: uma linha por minuto da mesma vencida seria lixo permanente).
    try {
      return await this.gravar(c, avisos);
    } catch (x) {
      if (x instanceof NadaNovo) return 0;
      throw x;
    }
  }

  private gravar(c: ContextoNucleo, avisos: ReturnType<typeof avisosDeVencidas>): Promise<number> {
    return this.porta.gravarSgh(
      c,
      (n: number) => ({
        estabelecimento: c.estabelecimento,
        usuario: null,
        acao: 'inclusao',
        entidade: 'aviso_central',
        entidadeId: null,
        dadosDepois: { evento: 'enfermagem.contencao.vencidaAvisada', avisos: n },
        correlacao: c.correlacao,
      }),
      async (g) => {
        const k = await g.avisar(avisos);
        if (k === 0) throw new NadaNovo();
        return k;
      },
    );
  }

  iniciar(): void {
    if (this.timer || this.alvos.length === 0) return;
    this.timer = setInterval(() => {
      for (const a of this.alvos) void this.ciclo(a).catch(() => 0);
    }, this.intervaloMs);
    this.timer.unref?.();
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * W1-08: as checagens da contenção aprazadas no turno da worklist da enfermagem (perfusão e pele), de cada ordem em curso
 * ou encerrada que tem horário na janela, com o alerta da ordem vencida sem renovação. A inativada não entra; o horário
 * cancelado pela retirada ou pela renovação também não (é da ordem nova).
 */
export function contencoesNoTurno(
  ordens: readonly ContencaoRegistrada[],
  internados: readonly { readonly atendimento: number; readonly leito: string | null }[],
  janela: { readonly inicio: string; readonly fim: string },
  agora: string,
  toleranciaMinutos: number,
): ChecagemContencaoNoTurno[] {
  const leitos = new Map<number, string | null>(internados.map((i) => [i.atendimento, i.leito]));
  return ordens
    .filter((o) => o.encerramento?.tipo !== 'inativacao' && leitos.has(o.atendimento))
    .flatMap((o) => {
      const t = contencaoParaTelaSemTurnos(o, agora, toleranciaMinutos);
      return t.horarios
        .filter((h) => h.estado !== 'cancelada' && h.previsto >= janela.inicio && h.previsto < janela.fim)
        .map((h) => ({
          ordem: o.id,
          paciente: o.paciente,
          atendimento: o.atendimento,
          leito: leitos.get(o.atendimento) ?? null,
          previsto: h.previsto,
          estado: h.estado,
          achados: [...ACHADOS_OBRIGATORIOS_CONTENCAO],
          ordemVencida: t.situacao === 'vencida',
        }));
    })
    .sort((a, b) => (a.previsto < b.previsto ? -1 : a.previsto > b.previsto ? 1 : a.ordem - b.ordem));
}
