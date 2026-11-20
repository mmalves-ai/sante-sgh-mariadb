// W0-05 (programa CRUD completo, 18/11/2026): o ciclo de vida do protocolo e do ciclo de quimioterapia (matriz de
// governança: "Tabelas de domínio, parâmetros, regras e formulários" e "Prescrição"). Puras:
//   - a versão publicada é imutável; a versão revogada não é oferecida a ciclos novos e os ciclos dela continuam com ela;
//   - o protocolo inativo (pelo código, todas as versões) também não é oferecido; reativar devolve a oferta (a versão
//     revogada continua revogada); nunca há exclusão, porque ciclos o referenciam;
//   - o ciclo validado não se edita (409): suspende-se ou cancela-se como fato novo; o ajuste (data, redução) é só do
//     ciclo prescrito e ativo; retomar é só do suspenso; o cancelado é final;
//   - desfazer a ligação ciclo–prescrição é só do ciclo prescrito (antes da validação) e só da prescrição ligada.
import type { AndamentoCiclo, EventoOnco } from '@sgh/contratos';
import { minutosEntreCivis, recusar } from './comum.js';

export interface OfertaProtocolo {
  readonly revogada: boolean;
  readonly inativo: boolean;
  /** Oferecida a ciclos novos: a versão vigente, não revogada, com o protocolo ativo. */
  readonly ofertavel: boolean;
}

/**
 * A oferta da versão a ciclos novos, pelos eventos: a revogação da versão (pelo ID) e o último evento de inativação ou
 * reativação do código (o mais recente vale).
 */
export function ofertaDoProtocolo(
  versao: { readonly id: number; readonly codigo: string; readonly vigente: boolean },
  eventos: readonly {
    readonly evento: EventoOnco;
    readonly codigoProtocolo: string;
    readonly protocolo: number | null;
    readonly em: string;
    readonly id: number;
  }[],
): OfertaProtocolo {
  const revogada = eventos.some((e) => e.evento === 'versao-revogada' && e.protocolo === versao.id);
  const ultimo = eventos
    .filter(
      (e) =>
        e.codigoProtocolo === versao.codigo &&
        (e.evento === 'protocolo-inativado' || e.evento === 'protocolo-reativado'),
    )
    .sort((a, b) => b.em.localeCompare(a.em) || b.id - a.id)[0];
  const inativo = ultimo?.evento === 'protocolo-inativado';
  return { revogada, inativo, ofertavel: versao.vigente && !revogada && !inativo };
}

/** Ciclo novo só em versão oferecida: a revogada e a do protocolo inativo recusam (409). */
export function exigirOfertavel(o: OfertaProtocolo): void {
  if (o.revogada)
    recusar(
      'versao-revogada',
      'Esta versão do protocolo foi revogada: não é oferecida a ciclos novos (os ciclos já registrados continuam com ela).',
    );
  if (o.inativo)
    recusar(
      'protocolo-inativo',
      'O protocolo está inativo: reative-o ou escolha outro protocolo para o ciclo novo.',
    );
}

/** O ajuste do ciclo (data, redução): só do prescrito e ativo; o validado não se edita. */
export function exigirCicloEditavel(c: {
  readonly situacao: string;
  readonly andamento: AndamentoCiclo;
}): void {
  if (c.situacao === 'validado')
    recusar(
      'ciclo-ja-validado',
      'O ciclo já foi validado pelo farmacêutico e não se edita: suspenda ou cancele com o motivo (fato novo).',
    );
  if (c.andamento !== 'ativo') recusar('ciclo-interrompido', `O ciclo está ${c.andamento}: não se ajusta.`);
}

/**
 * O ajuste do ciclo (nova data ou nova redução) com as mesmas regras da inclusão:
 *   - com prescrição ligada, mudar a data ou a redução recusa: a prescrição foi emitida para a data e as doses atuais
 *     (desfaz-se a ligação antes e liga-se a prescrição nova depois);
 *   - a data nova não fica antes da do ciclo anterior do mesmo tratamento nem depois da do seguinte;
 *   - dentro do intervalo do protocolo, pede a justificativa clínica.
 * `doCurso`: os outros ciclos do mesmo tratamento (sem o ajustado).
 */
export function conferirAjusteCiclo(
  c: {
    readonly numero: number;
    readonly dataPrevista: string;
    readonly reducaoPct: number;
    readonly prescricoes: readonly number[];
  },
  novo: {
    readonly dataPrevista: string;
    readonly reducaoPct: number;
    readonly justificativaIntervalo: string | null;
  },
  doCurso: readonly { readonly numero: number; readonly dataPrevista: string }[],
  intervaloDias: number,
): { diasDesdeAnterior: number | null } {
  if (c.prescricoes.length > 0 && (novo.dataPrevista !== c.dataPrevista || novo.reducaoPct !== c.reducaoPct))
    recusar(
      'ciclo-com-prescricao',
      'O ciclo tem prescrição ligada, emitida para a data e as doses atuais: desfaça a ligação antes de mudar a data ou a redução e ligue a prescrição nova depois.',
    );
  const seguinte = doCurso.find((x) => x.numero === c.numero + 1);
  if (seguinte && novo.dataPrevista > seguinte.dataPrevista)
    recusar('data-depois-do-seguinte', 'A data prevista passa da do ciclo seguinte do mesmo tratamento.');
  const anterior = doCurso.find((x) => x.numero === c.numero - 1);
  if (!anterior) return { diasDesdeAnterior: null };
  const dias = Math.round(minutosEntreCivis(anterior.dataPrevista, novo.dataPrevista) / 1440);
  if (dias < 0) recusar('data-antes-do-anterior', 'A data prevista é anterior à do ciclo anterior.');
  if (dias < intervaloDias && !novo.justificativaIntervalo)
    recusar(
      'intervalo-curto',
      `O ciclo anterior foi há ${dias} dia(s) e o protocolo pede ${intervaloDias}: informe a justificativa clínica.`,
    );
  return { diasDesdeAnterior: dias };
}

/** De onde a ação parte e para onde vai (o UPDATE confere o estado de partida). */
export function transicaoDoCiclo(
  acao: 'suspender' | 'retomar' | 'cancelar',
  atual: AndamentoCiclo,
): { de: AndamentoCiclo[]; para: AndamentoCiclo } {
  const t = {
    suspender: { de: ['ativo'] as AndamentoCiclo[], para: 'suspenso' as const },
    retomar: { de: ['suspenso'] as AndamentoCiclo[], para: 'ativo' as const },
    cancelar: { de: ['ativo', 'suspenso'] as AndamentoCiclo[], para: 'cancelado' as const },
  }[acao];
  if (!t.de.includes(atual))
    recusar(
      'ciclo-interrompido',
      atual === 'cancelado'
        ? 'O ciclo foi cancelado: o cancelamento é final.'
        : acao === 'retomar'
          ? 'O ciclo não está suspenso.'
          : 'O ciclo já está suspenso: retome-o ou cancele-o.',
    );
  return t;
}

/** Desfazer a ligação: só da prescrição ligada e do ciclo ainda não validado. */
export function exigirLigacaoDesfazivel(
  c: { readonly situacao: string; readonly prescricoes: readonly number[] },
  prescricao: number,
): void {
  if (!c.prescricoes.includes(prescricao))
    recusar('prescricao-fora-do-ciclo', 'A prescrição não está ligada a este ciclo.');
  if (c.situacao === 'validado')
    recusar(
      'ciclo-ja-validado',
      'O ciclo já foi validado com esta prescrição: a ligação não se desfaz (suspenda ou cancele o ciclo com o motivo).',
    );
}
