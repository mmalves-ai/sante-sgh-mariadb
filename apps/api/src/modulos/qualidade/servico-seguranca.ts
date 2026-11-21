// Composição da etapa 2 do M48 sobre as regras puras: a análise e as ações lidas do banco viram os contratos da tela
// (o conteúdo da análise conferido pelo esquema), a vigilância de produto, o resumo da sugestão resolvida (SHA-256 da
// origem com o login: regra 1) e os indicadores do painel do plano de segurança (adesão às metas internacionais e aos
// protocolos gerenciados do M44, notificações, análises e ações), sempre com o numerador e o denominador.
import { createHash, createHmac, hkdfSync } from 'node:crypto';
import {
  type AcaoPlanoLida,
  type AnaliseLida,
  CLASSIFICACOES_OMS,
  type ConteudoAnalise,
  type ContagemPainel,
  type ConteudoGerenciado,
  type EficaciaAcao,
  esquemaConteudoAnalise,
  esquemaConteudoGerenciado,
  type FatorContribuinte,
  type IndicadorPainel,
  type QueixaTecnicaLida,
  type SituacaoAcao,
  type SituacaoAnalise,
  TIPOS_INCIDENTE,
} from '@sgh/contratos';
import {
  acaoAtrasada,
  contagensDoVocabulario,
  indicador,
  indicadoresDeAdesao,
  semeDaSugestaoResolvida,
} from '@sgh/dominio-qualidade';
import { adesaoDasMetas, conteudoCanonico, nomeDoTipo } from '@sgh/dominio-recepcao';
import type { AcaoPlanoRegistrada, AnaliseRegistrada, ContagemNotificacoes, ProtocoloDoPaciente, QueixaTecnicaRegistrada, VersaoProtocoloGerenciado } from './tipos.js';
import type { ContagensAdesaoLidas } from './porta.js';

/** Provedor do resumo da sugestão resolvida (null: sem a chave, as sugestões ficam desligadas com o motivo). */
export const RESUMO_SUGESTAO = Symbol('RESUMO_SUGESTAO');

/**
 * O resumo guardado da sugestão resolvida (nem a origem nem o login ficam legíveis no banco): HMAC-SHA256 com a chave
 * derivada (HKDF) da chave mestra da plataforma, fora do banco, para que o resumo não se recalcule só com o que o
 * banco guarda (logins e IDs dos últimos dias são poucos; um SHA-256 sem segredo se testaria por força bruta).
 */
export class ResumoSugestao {
  private readonly chave: Buffer;

  constructor(mestra: Buffer) {
    if (mestra.length !== 32) throw new Error('A chave do resumo da sugestão precisa ter 32 bytes.');
    this.chave = Buffer.from(
      hkdfSync('sha256', mestra, Buffer.alloc(0), 'sgh-qualidade-sugestao-resolvida', 32),
    );
  }

  resumo(hospital: string, login: string, origem: string): string {
    return createHmac('sha256', this.chave)
      .update(semeDaSugestaoResolvida(hospital, login, origem), 'utf8')
      .digest('hex');
  }
}

/** O motivo visível das sugestões desligadas por falta da chave (POL-3). */
export const MOTIVO_SUGESTAO_SEM_CHAVE =
  'As sugestões de notificação estão desligadas: a chave mestra da plataforma não está configurada.';

/**
 * A hora da notificação anônima feita a partir de uma sugestão vai pelo INÍCIO DO TURNO (07h, 13h e 19h; a madrugada
 * fica no turno das 19h do dia anterior): a hora exata do registro de origem, com o atendimento e a fonte, apontaria a
 * linha da checagem e quem a registrou (regra 1). O início do turno é anterior ao registro, então os prazos só
 * antecipam.
 */
export function inicioDoTurno(ocorridoEm: string): string {
  const dia = ocorridoEm.slice(0, 10);
  const h = Number(ocorridoEm.slice(11, 13));
  if (h >= 19) return `${dia}T19:00`;
  if (h >= 13) return `${dia}T13:00`;
  if (h >= 7) return `${dia}T07:00`;
  const ontem = new Date(Date.parse(`${dia}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${ontem}T19:00`;
}

/** O conteúdo gravado conferido pelo esquema (um conteúdo que não confere vira um 5 porquês vazio, sinalizado). */
export function conteudoDe(a: Pick<AnaliseRegistrada, 'conteudo' | 'metodo'>): ConteudoAnalise {
  try {
    const r = esquemaConteudoAnalise.safeParse(JSON.parse(a.conteudo));
    if (r.success) return r.data;
  } catch {
    // conteúdo ilegível: cai no padrão abaixo
  }
  return { metodo: 'cincoPorques', porques: ['(conteúdo ilegível: registre a análise de novo)'] };
}

export function analiseLida(a: AnaliseRegistrada): AnaliseLida {
  const conteudo = conteudoDe(a);
  return {
    id: a.id,
    notificacao: a.notificacao,
    metodo: conteudo.metodo,
    conteudo,
    causaRaiz: a.causaRaiz,
    fatores: a.fatores as FatorContribuinte[],
    licoes: a.licoes,
    semAcaoJustificativa: a.semAcaoJustificativa,
    situacao: a.situacao as SituacaoAnalise,
    versao: a.versao,
    registradaPor: a.registradaPor,
    registradaEm: a.registradaEm,
    atualizadaEm: a.atualizadaEm,
    concluidaEm: a.concluidaEm,
    concluidaPor: a.concluidaPor,
  };
}

export function acaoLida(a: AcaoPlanoRegistrada, hoje: string): AcaoPlanoLida {
  const situacao = a.situacao as SituacaoAcao;
  return {
    id: a.id,
    notificacao: a.notificacao,
    sequencia: a.sequencia,
    oQue: a.oQue,
    porQue: a.porQue,
    onde: a.onde,
    quando: a.quando,
    quem: a.quem,
    como: a.como,
    quanto: a.quanto,
    situacao,
    versao: a.versao,
    texto: a.texto,
    concluidaEm: a.concluidaEm,
    eficacia: a.eficacia as EficaciaAcao | null,
    eficaciaTexto: a.eficaciaTexto,
    eficaciaEm: a.eficaciaEm,
    eficaciaPor: a.eficaciaPor,
    criadaPor: a.criadaPor,
    criadaEm: a.criadaEm,
    atrasada: acaoAtrasada({ situacao, quando: a.quando }, hoje),
  };
}

export function queixaLida(q: QueixaTecnicaRegistrada): QueixaTecnicaLida {
  return { ...q } as QueixaTecnicaLida;
}

// ── Painel do plano de segurança ───────────────────────────────────────────────────────────────────────

const impressao = (c: ConteudoGerenciado) =>
  createHash('sha256')
    .update(conteudoCanonico(c as never))
    .digest('hex');

/** As definições publicadas íntegras (o conteúdo confere com a impressão gravada), pelo ID da versão. */
export function definicoesGerenciadas(
  versoes: readonly VersaoProtocoloGerenciado[],
): Map<number, ConteudoGerenciado> {
  const porId = new Map<number, ConteudoGerenciado>();
  for (const v of versoes) {
    const c = esquemaConteudoGerenciado.safeParse(v.conteudo);
    if (c.success && impressao(c.data) === v.impressao) porId.set(v.id, c.data);
  }
  return porId;
}

/** A adesão às metas dos protocolos gerenciados (M44) no período, meta a meta, com as parcelas. */
export function adesaoProtocolosGerenciados(
  versoes: readonly VersaoProtocoloGerenciado[],
  protocolos: readonly ProtocoloDoPaciente[],
): IndicadorPainel[] {
  const porId = definicoesGerenciadas(versoes);
  const linhas = adesaoDasMetas(
    protocolos
      .filter((p) => porId.has(p.gerenciado))
      .map((p) => ({
        tipo: p.tipo,
        conteudo: porId.get(p.gerenciado)!,
        eventos: p.eventos.map((e) => ({
          tipo: e.tipo,
          codigo: e.codigo,
          situacao: e.situacao,
          quando: e.quando,
          motivo: e.motivo,
          por: e.por,
          em: e.em,
        })),
      })),
  );
  return linhas.map((l) =>
    indicador(
      `protocolo-${l.tipo}-${l.meta}`,
      `${nomeDoTipo(l.tipo)}: ${l.titulo}`,
      l.cumpridas,
      l.registradas,
      'Protocolos gerenciados',
    ),
  );
}

export interface PainelSegurancaPaciente {
  readonly periodo: { readonly de: string; readonly ate: string };
  readonly notificacoes: {
    readonly total: number;
    readonly anonimas: number;
    readonly obitos: number;
    readonly neverEvents: number;
    readonly descartadas: number;
    readonly porTipo: ContagemPainel[];
    readonly porClassificacao: ContagemPainel[];
  };
  readonly analises: {
    readonly comPrazo: number;
    readonly concluidas: number;
    readonly vencidas: number;
    readonly noPrazo: IndicadorPainel;
  };
  readonly acoes: {
    readonly abertas: number;
    readonly atrasadas: number;
    readonly concluidas: number;
    readonly canceladas: number;
    readonly eficacia: IndicadorPainel;
  };
  readonly adesao: IndicadorPainel[];
  readonly protocolosGerenciados: IndicadorPainel[];
  readonly protocolosCortados: boolean;
  readonly historicoRiscos: readonly { ano: number; registros: number }[];
}

export function montarPainel(x: {
  readonly de: string;
  readonly ate: string;
  readonly notificacoes: readonly ContagemNotificacoes[];
  readonly analises: { comPrazo: number; concluidas: number; noPrazo: number; vencidas: number };
  readonly acoes: readonly {
    situacao: string;
    eficacia: string | null;
    vencida: boolean;
    quantidade: number;
  }[];
  readonly adesao: ContagensAdesaoLidas;
  readonly protocolos: IndicadorPainel[];
  readonly protocolosCortados: boolean;
  readonly historico: readonly { ano: number; registros: number }[];
}): PainelSegurancaPaciente {
  const validas = x.notificacoes.filter((n) => n.situacao !== 'descartada');
  const soma = (
    f: (n: ContagemNotificacoes) => boolean,
    ls: readonly ContagemNotificacoes[] = validas,
  ) => ls.filter(f).reduce((t, n) => t + n.quantidade, 0);
  const somaA = (f: (a: (typeof x.acoes)[number]) => boolean) =>
    x.acoes.filter(f).reduce((t, a) => t + a.quantidade, 0);
  const aberta = (s: string) => s === 'planejada' || s === 'emAndamento';
  return {
    periodo: { de: x.de, ate: x.ate },
    notificacoes: {
      total: soma(() => true),
      anonimas: soma((n) => n.anonima),
      obitos: soma((n) => n.dano === 'obito'),
      neverEvents: soma((n) => n.neverEvent),
      descartadas: soma((n) => n.situacao === 'descartada', x.notificacoes),
      porTipo: contagensDoVocabulario(
        TIPOS_INCIDENTE,
        validas.map((n) => ({ codigo: n.tipo, quantidade: n.quantidade })),
      ),
      porClassificacao: contagensDoVocabulario(
        CLASSIFICACOES_OMS,
        validas.map((n) => ({ codigo: n.classificacao, quantidade: n.quantidade })),
      ),
    },
    analises: {
      comPrazo: x.analises.comPrazo,
      concluidas: x.analises.concluidas,
      vencidas: x.analises.vencidas,
      noPrazo: indicador(
        'analise-no-prazo',
        'Análises concluídas no prazo',
        x.analises.noPrazo,
        x.analises.comPrazo,
        'Notificações de incidentes',
      ),
    },
    acoes: {
      abertas: somaA((a) => aberta(a.situacao)),
      atrasadas: somaA((a) => aberta(a.situacao) && a.vencida),
      concluidas: somaA((a) => a.situacao === 'concluida'),
      canceladas: somaA((a) => a.situacao === 'cancelada'),
      eficacia: indicador(
        'acao-eficaz',
        'Ações eficazes entre as verificadas',
        somaA((a) => a.eficacia === 'eficaz'),
        somaA((a) => a.eficacia !== null),
        'Plano de ação 5W2H',
      ),
    },
    adesao: indicadoresDeAdesao(x.adesao),
    protocolosGerenciados: x.protocolos,
    protocolosCortados: x.protocolosCortados,
    historicoRiscos: x.historico,
  };
}
