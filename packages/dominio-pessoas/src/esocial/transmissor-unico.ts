// Regra 1 da ficha do M53 (cap-07 §7.1.5): um só transmissor de eSocial por empregador, e os eventos de autônomo do
// repasse (recibos de pagamento a autônomo, cadeia do repasse do M33) entram na conciliação do mesmo empregador. O
// empregador no eSocial é a raiz do CNPJ: duas empresas do cadastro com a mesma raiz são um empregador só e não podem
// ter transmissores diferentes na mesma competência. Regras puras.
import {
  CATALOGO_EVENTOS_ESOCIAL,
  type ConciliacaoEsocial,
  type LinhaConciliacaoEsocial,
  type PendenciasLegadoEsocial,
  type SituacaoLinhaConciliacao,
  type TransmissorEsocial,
} from '@sgh/contratos';
import { raizCnpj } from './comum.js';

/** A vigência do transmissor de uma empresa (início AAAA-MM). */
export interface VigenciaTransmissor {
  readonly empresa: number;
  readonly inicio: string;
  readonly transmissor: TransmissorEsocial;
}

/** O transmissor da empresa na competência (a vigência mais recente que já começou); null sem parâmetros. */
export function transmissorNaCompetencia(
  vigencias: readonly VigenciaTransmissor[],
  empresa: number,
  competencia: string,
): TransmissorEsocial | null {
  const v = vigencias
    .filter((x) => x.empresa === empresa && x.inicio <= competencia)
    .sort((a, b) => b.inicio.localeCompare(a.inicio))[0];
  return v?.transmissor ?? null;
}

/** As empresas do cadastro com a mesma raiz de CNPJ (o mesmo empregador), sem a própria. */
export function empresasDaMesmaRaiz(cnpjs: ReadonlyMap<number, string | null>, empresa: number): number[] {
  const propria = cnpjs.get(empresa);
  if (!propria) return [];
  const raiz = raizCnpj(propria);
  return [...cnpjs.entries()]
    .filter(([e, c]) => e !== empresa && c && raizCnpj(c) === raiz)
    .map(([e]) => e)
    .sort((a, b) => a - b);
}

export type DecisaoTransmissor =
  | { readonly ok: true; readonly transmissor: TransmissorEsocial }
  | { readonly ok: false; readonly motivo: 'sem-transmissor' | 'dois-transmissores' };

/**
 * O transmissor do empregador na competência, conferido com as empresas da mesma raiz: todas as que têm parâmetros
 * precisam apontar o mesmo transmissor (as sem parâmetros seguem o do empregador).
 */
export function decidirTransmissor(
  vigencias: readonly VigenciaTransmissor[],
  cnpjs: ReadonlyMap<number, string | null>,
  empresa: number,
  competencia: string,
): DecisaoTransmissor {
  const proprio = transmissorNaCompetencia(vigencias, empresa, competencia);
  if (!proprio) return { ok: false, motivo: 'sem-transmissor' };
  for (const outra of empresasDaMesmaRaiz(cnpjs, empresa)) {
    const t = transmissorNaCompetencia(vigencias, outra, competencia);
    if (t && t !== proprio) return { ok: false, motivo: 'dois-transmissores' };
  }
  return { ok: true, transmissor: proprio };
}

/** O que entra na conciliação da competência. */
export interface EntradaConciliacao {
  readonly empresa: number;
  readonly competencia: string;
  readonly decisao: DecisaoTransmissor;
  readonly mesmaRaiz: readonly number[];
  /** Eventos do Sante SGH enviados ou aceitos na competência, por código. */
  readonly sante: Readonly<Record<string, number>>;
  /** Quantidade informada pelo sistema externo, por código (ausente: não informado). */
  readonly externo: Readonly<Record<string, number>>;
  /** Recibos de pagamento a autônomo do repasse na competência. */
  readonly repasse: number;
  /** Pendências do outro sistema, por código (de todos os anos: elas nunca saem). */
  readonly pendenciasLegado: Readonly<Record<string, number>>;
}

/** Os eventos periódicos de remuneração e pagamento em que os recibos de autônomo entram. */
const EVENTOS_DO_REPASSE = ['S-1200', 'S-1210'] as const;

const rotuloDe = (codigo: string) =>
  CATALOGO_EVENTOS_ESOCIAL.find((e) => e.codigo === codigo)?.rotulo ??
  (codigo === 'S-1200'
    ? 'Remuneração do trabalhador'
    : codigo === 'S-1210'
      ? 'Pagamentos de rendimentos'
      : codigo);

/**
 * A conciliação do empregador na competência, evento a evento:
 * - `dois-transmissores`: o Sante SGH tem eventos e o transmissor é o externo (ou o externo informou eventos com o
 *   Sante SGH como transmissor), ou as empresas da mesma raiz divergem;
 * - `repasse-no-periodico` / `repasse-no-externo`: os recibos de autônomo vão nos periódicos do transmissor;
 * - `so-contagem`: só há pendências do outro sistema (nunca enviadas; regra 2);
 * - `sem-transmissor`: o empregador não tem os parâmetros do eSocial na competência;
 * - `conciliado`: o resto.
 */
export function conciliar(e: EntradaConciliacao): Omit<ConciliacaoEsocial, 'conferida'> {
  const codigos = new Set<string>([
    ...Object.keys(e.sante),
    ...Object.keys(e.externo),
    ...Object.keys(e.pendenciasLegado),
    ...(e.repasse > 0 ? EVENTOS_DO_REPASSE : []),
  ]);
  const transmissor = e.decisao.ok ? e.decisao.transmissor : null;
  const linhas: LinhaConciliacaoEsocial[] = [...codigos]
    .sort((a, b) => a.localeCompare(b))
    .map((codigo) => {
      const sante = e.sante[codigo] ?? 0;
      const externo = codigo in e.externo ? e.externo[codigo]! : null;
      const repasse = (EVENTOS_DO_REPASSE as readonly string[]).includes(codigo) ? e.repasse : 0;
      const pendenciaLegado = e.pendenciasLegado[codigo] ?? 0;
      let situacao: SituacaoLinhaConciliacao;
      if (!e.decisao.ok && e.decisao.motivo === 'sem-transmissor') situacao = 'sem-transmissor';
      else if (!e.decisao.ok) situacao = 'dois-transmissores';
      else if (transmissor === 'externo' && sante > 0) situacao = 'dois-transmissores';
      else if (transmissor === 'sante' && (externo ?? 0) > 0) situacao = 'dois-transmissores';
      else if (repasse > 0)
        situacao = transmissor === 'sante' ? 'repasse-no-periodico' : 'repasse-no-externo';
      else if (sante === 0 && (externo ?? 0) === 0 && pendenciaLegado > 0) situacao = 'so-contagem';
      else situacao = 'conciliado';
      return { evento: codigo, rotulo: rotuloDe(codigo), sante, externo, repasse, pendenciaLegado, situacao };
    });
  const situacao =
    !e.decisao.ok && e.decisao.motivo === 'sem-transmissor'
      ? 'sem-transmissor'
      : linhas.some((l) => l.situacao === 'dois-transmissores') || !e.decisao.ok
        ? 'divergente'
        : 'conciliada';
  return {
    empresa: e.empresa,
    competencia: e.competencia,
    transmissor,
    mesmaRaiz: e.mesmaRaiz,
    linhas,
    situacao,
  };
}

/** As pendências do outro sistema para o painel (regra 2: só a contagem, por evento e ano). */
export function painelPendenciasLegado(
  linhas: readonly { readonly evento: string; readonly ano: number; readonly quantidade: number }[],
): PendenciasLegadoEsocial {
  const por = new Map<string, Map<number, number>>();
  for (const l of linhas) {
    if (l.quantidade <= 0) continue;
    const m = por.get(l.evento) ?? new Map<number, number>();
    m.set(l.ano, (m.get(l.ano) ?? 0) + l.quantidade);
    por.set(l.evento, m);
  }
  const grupoDe = (c: string) =>
    CATALOGO_EVENTOS_ESOCIAL.find((e) => e.codigo === c)?.grupo ??
    (/^S-1[23]\d{2}$/.test(c)
      ? 'periodico'
      : /^S-10\d{2}$/.test(c)
        ? 'tabela'
        : /^S-[23]\d{3}$/.test(c)
          ? 'nao-periodico'
          : null);
  const porEvento = [...por.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([evento, anos]) => {
      const porAno = [...anos.entries()]
        .sort(([a], [b]) => a - b)
        .map(([ano, quantidade]) => ({ ano, quantidade }));
      return {
        evento,
        rotulo: rotuloDe(evento),
        grupo: grupoDe(evento),
        quantidade: porAno.reduce((s, x) => s + x.quantidade, 0),
        porAno,
      };
    });
  return { total: porEvento.reduce((s, x) => s + x.quantidade, 0), porEvento };
}
