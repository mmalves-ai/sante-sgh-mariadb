// W0-03, mercado M2 (critério 10): o serviço do TRR e da PCR — os alertas abertos da unidade (o escore com o gatilho de
// TRR das últimas 12 horas, sem estorno e sem acionamento), o acionamento lido com os tempos, a ficha de PCR (a versão
// vigente com as anteriores legíveis) e os indicadores do período com o numerador e o denominador impressos. O motor é
// @sgh/dominio-enfermagem (regras sem banco).
import {
  type AcionamentoTrrLido,
  type DadosPcr,
  type DesfechoTrr,
  esquemaDadosPcr,
  type FichaPcrLida,
  type IndicadoresTrrPcr,
} from '@sgh/contratos';
import { diferencaMinutos, indicadoresTrrPcr } from '@sgh/dominio-enfermagem';
import type { AcionamentoTrrRegistrado, VersaoPcrRegistrada } from './tipos-vinculados.js';

/** As unidades de UTI do parâmetro (códigos separados por vírgula). */
export function unidadesUti(v: unknown): Set<string> {
  const lista = String(v ?? 'UTI')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  return new Set(lista.length ? lista : ['UTI']);
}

export function acionamentoParaTela(
  a: AcionamentoTrrRegistrado,
  fichas: readonly FichaPcrLida[] = [],
): AcionamentoTrrLido {
  return {
    ...a,
    desfecho: (a.desfecho as DesfechoTrr | null) ?? null,
    minutosAteAcionar: a.alertaEm ? Math.max(0, diferencaMinutos(a.alertaEm, a.acionadoEm)) : null,
    minutosResposta: a.chegadaEm ? diferencaMinutos(a.acionadoEm, a.chegadaEm) : null,
    inativacao: a.inativacao ?? null,
    escoreEstornado: a.escoreEstornado === true,
    eventos: (a.eventos ?? []).map((v) => ({
      id: v.id,
      tipo: v.tipo,
      seq: v.seq,
      em: v.em,
      desfecho: (v.desfecho as DesfechoTrr | null) ?? null,
      usuario: v.usuario,
      motivo: v.motivo,
      inativacao: v.inativacao,
      vigente: v.vigente,
    })),
    ficha: fichas.find((f) => f.trr === a.id && f.inativacao === null)?.id ?? null,
  };
}

function dadosLidos(json: string): DadosPcr | null {
  try {
    const r = esquemaDadosPcr.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** As fichas vigentes (a última versão de cada cadeia), com as versões anteriores. */
export function fichasVigentes(versoes: readonly VersaoPcrRegistrada[]): FichaPcrLida[] {
  const porId = new Map(versoes.map((v) => [v.id, v]));
  const substituidas = new Set(versoes.flatMap((v) => (v.anterior === null ? [] : [v.anterior])));
  const r: FichaPcrLida[] = [];
  for (const v of versoes) {
    if (substituidas.has(v.id)) continue;
    const dados = dadosLidos(v.dados);
    if (!dados) continue;
    const anteriores: FichaPcrLida['versoes'][number][] = [];
    let a = v.anterior === null ? undefined : porId.get(v.anterior);
    while (a) {
      anteriores.push({
        id: a.id,
        versao: a.versao,
        criadoEm: a.criadoEm.slice(0, 16),
        situacao: a.situacao,
        autor: a.autor,
        motivo: a.motivo ?? null,
        dados: dadosLidos(a.dados),
      });
      a = a.anterior === null ? undefined : porId.get(a.anterior);
    }
    r.push({
      id: v.id,
      paciente: v.paciente,
      atendimento: v.atendimento,
      unidade: v.unidade,
      uti: v.uti,
      trr: v.trr,
      versao: v.versao,
      anterior: v.anterior,
      situacao: v.situacao,
      dados,
      autor: v.autor,
      criadoEm: v.criadoEm.slice(0, 16),
      motivo: v.motivo ?? null,
      inativacao: v.inativacao ?? null,
      versoes: anteriores,
    });
  }
  return r;
}

/** Os indicadores do período, com o numerador e o denominador impressos. */
export function indicadoresDoPeriodo(
  de: string,
  ate: string,
  acionamentos: readonly AcionamentoTrrRegistrado[],
  versoes: readonly VersaoPcrRegistrada[],
  censo: { porSetor: { setor: string; pacientesDia: number }[] },
  uti: Set<string>,
  metaMinutos: number,
): IndicadoresTrrPcr {
  const foraUti = censo.porSetor
    .filter((x) => !uti.has(x.setor.toUpperCase()))
    .reduce((a, x) => a + x.pacientesDia, 0);
  // Revisão W0-03: o inativado (lançado errado) sai do indicador; o alerta de escore estornado não conta no tempo "do
  // alerta ao acionamento" (o acionamento é fato real e segue no tempo de resposta).
  const validos = acionamentos
    .filter((a) => !a.inativacao)
    .map((a) => (a.escoreEstornado ? { ...a, alertaEm: null } : a));
  const fichas = fichasVigentes(versoes).filter((f) => f.inativacao === null);
  const i = indicadoresTrrPcr(validos, fichas, foraUti, metaMinutos);
  const fmt = (x: number | null, suf = '') => (x === null ? 'sem denominador' : `${x}${suf}`);
  return {
    de,
    ate,
    ...i,
    impressao:
      `PCR fora da UTI por 1.000 pacientes-dia: ${i.pcrForaUti.numerador} / ${i.pcrForaUti.denominador} × 1.000 = ` +
      `${fmt(i.pcrForaUti.por1000)}. Chegada do time em até ${metaMinutos} min: ${i.tempoResposta.noPrazo.numerador} / ` +
      `${i.tempoResposta.noPrazo.denominador} = ${fmt(i.tempoResposta.noPrazo.percentual, '%')} (mediana ` +
      `${i.tempoResposta.medianaMinutos ?? '—'} min). Do alerta ao acionamento: mediana ` +
      `${i.alertaAteAcionar.medianaMinutos ?? '—'} min em ${i.alertaAteAcionar.n} acionamento(s).`,
  };
}
