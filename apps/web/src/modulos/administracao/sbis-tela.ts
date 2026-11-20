// Regras de tela do M59-F5 (certificação SBIS, backup verificado e concessões), puras e testadas sem navegador: o
// texto de cada recusa do servidor (extensão `codigo` do Problem Details; o texto vem do contrato), as ações de cada
// requisito num ciclo, os resultados que cada tipo de ciclo aceita, o que falta para concluir, a montagem do relatório
// de uma restauração (data e hora locais para ISO) e a conferência do período da exportação para a auditoria.
import {
  type CicloSbis,
  DIAS_MAXIMOS_PROVA_CADEIA,
  type ItemCicloSbis,
  type RegistrarRestauracaoPedido,
  RESULTADOS_ITEM_SBIS,
  type ResultadoItemSbis,
  RECUSAS_SBIS,
  type RecusaSbis,
  TEXTO_RECUSA_SBIS,
  type TipoCicloSbis,
} from '@sgh/contratos';

/** Texto da recusa conhecida (do contrato) ou null (o erro vai à MensagemErro). */
export function textoRecusaSbis(codigo: string | null): string | null {
  return codigo && (RECUSAS_SBIS as readonly string[]).includes(codigo)
    ? TEXTO_RECUSA_SBIS[codigo as RecusaSbis]
    : null;
}

export type AcaoItemSbis = 'avaliar' | 'corrigir' | 'verificar';

/** Ações de um requisito: só em ciclo aberto e com a permissão de avaliar. */
export function acoesDoItem(
  item: ItemCicloSbis,
  ciclo: Pick<CicloSbis, 'situacao'>,
  podeAvaliar: boolean,
): AcaoItemSbis[] {
  if (!podeAvaliar || ciclo.situacao !== 'aberto') return [];
  // A não conformidade só se reavalia depois da correção verificada (o servidor recusa com nc-sem-verificacao).
  if (item.resultado === 'nao-conforme' && item.correcao === 'aberta') return ['corrigir'];
  if (item.resultado === 'nao-conforme' && item.correcao === 'corrigida') return ['verificar'];
  return ['avaliar'];
}

/** Os filtros da lista de requisitos do ciclo; o padrão mostra o que ainda pede trabalho. */
export const FILTROS_ITENS_SBIS = [
  'a-tratar',
  'pendente',
  'nao-conforme',
  'correcao-aberta',
  'correcao-corrigida',
  'todos',
] as const;
export type FiltroItensSbis = (typeof FILTROS_ITENS_SBIS)[number];

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Os requisitos do ciclo pelo filtro de resultado ou correção e pela busca no código ou no título. */
export function filtrarItensSbis<
  T extends Pick<ItemCicloSbis, 'requisito' | 'resultado' | 'correcao'> & { titulo?: string },
>(itens: readonly T[], filtro: FiltroItensSbis, busca: string): T[] {
  const termo = semAcento(busca.trim());
  return itens.filter((i) => {
    const passa =
      filtro === 'todos' ||
      (filtro === 'a-tratar' && (i.resultado === 'pendente' || i.resultado === 'nao-conforme')) ||
      (filtro === 'pendente' && i.resultado === 'pendente') ||
      (filtro === 'nao-conforme' && i.resultado === 'nao-conforme') ||
      (filtro === 'correcao-aberta' && i.correcao === 'aberta') ||
      (filtro === 'correcao-corrigida' && i.correcao === 'corrigida');
    return passa && (!termo || semAcento(`${i.requisito} ${i.titulo ?? ''}`).includes(termo));
  });
}

/** Resultados escolhíveis: "concessão" só na autoavaliação (regra 9; cap-13 §13.6.2). */
export function resultadosDoCiclo(tipo: TipoCicloSbis): Exclude<ResultadoItemSbis, 'pendente'>[] {
  return RESULTADOS_ITEM_SBIS.filter(
    (r): r is Exclude<ResultadoItemSbis, 'pendente'> =>
      r !== 'pendente' && (r !== 'concessao' || tipo === 'autoavaliacao'),
  );
}

/** O que impede concluir o ciclo, na ordem em que o servidor confere (null: pode concluir). */
export function faltaParaConcluir(itens: readonly ItemCicloSbis[]): 'itens-pendentes' | null {
  return itens.some((i) => i.resultado === 'pendente') ? 'itens-pendentes' : null;
}

/** O pedido de avaliação com só os campos que o resultado usa. */
export function pedidoAvaliacao(f: {
  resultado: Exclude<ResultadoItemSbis, 'pendente'>;
  severidade: string;
  origem: string;
  evidencia: string;
  observacao: string;
}) {
  const nc = f.resultado === 'nao-conforme';
  const texto = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    resultado: f.resultado,
    ...(nc && f.severidade ? { severidade: f.severidade } : {}),
    ...(nc && f.origem ? { origem: f.origem } : {}),
    ...(texto(f.evidencia) ? { evidencia: texto(f.evidencia) } : {}),
    ...(texto(f.observacao) ? { observacao: texto(f.observacao) } : {}),
  } as const;
}

/** "2026-10-29T08:00" (campo de data e hora local) em ISO com o fuso; null se inválida. */
export function localParaIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type FalhaRestauracao = 'inicio-invalido' | 'fim-invalido' | 'fim-antes' | 'ambiente' | 'tamanho';

/** O relatório da restauração pronto para o servidor, ou a falha a mostrar ao lado do campo. */
export function montarRestauracao(f: {
  tipo: 'diaria' | 'mensal';
  inicio: string;
  fim: string;
  resultado: 'ok' | 'falhou';
  integridade: 'ok' | 'falhou' | 'nao-verificada';
  tamanhoMb: string;
  ambiente: string;
  observacao: string;
}): { ok: true; pedido: RegistrarRestauracaoPedido } | { ok: false; falha: FalhaRestauracao } {
  const inicio = localParaIso(f.inicio);
  if (!inicio) return { ok: false, falha: 'inicio-invalido' };
  const fim = localParaIso(f.fim);
  if (!fim) return { ok: false, falha: 'fim-invalido' };
  if (Date.parse(fim) < Date.parse(inicio)) return { ok: false, falha: 'fim-antes' };
  if (f.ambiente.trim().length < 2) return { ok: false, falha: 'ambiente' };
  const tam = f.tamanhoMb.trim();
  if (tam && !/^\d{1,8}$/.test(tam)) return { ok: false, falha: 'tamanho' };
  return {
    ok: true,
    pedido: {
      tipo: f.tipo,
      inicio,
      fim,
      resultado: f.resultado,
      integridade: f.integridade,
      ambiente: f.ambiente.trim(),
      ...(tam ? { tamanhoMb: Number(tam) } : {}),
      ...(f.observacao.trim() ? { observacao: f.observacao.trim() } : {}),
    },
  };
}

/** Período da exportação para a auditoria: datas válidas, em ordem e até 31 dias (a prova da cadeia). */
export function periodoExportacaoSbis(inicio: string, fim: string): 'ok' | 'invalido' | 'longo' {
  const a = Date.parse(`${inicio}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return 'invalido';
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 'invalido';
  return (b - a) / 86_400_000 + 1 > DIAS_MAXIMOS_PROVA_CADEIA ? 'longo' : 'ok';
}

/** Ciclos em ordem: os abertos primeiro, depois os mais recentes. */
export function ordenarCiclos<T extends Pick<CicloSbis, 'situacao' | 'abertoEm'>>(ciclos: readonly T[]): T[] {
  return [...ciclos].sort(
    (x, y) =>
      Number(y.situacao === 'aberto') - Number(x.situacao === 'aberto') ||
      y.abertoEm.localeCompare(x.abertoEm),
  );
}

/** "2026-10-29T11:00:00.000Z" → "29/10/2026 08:00" (hora local). */
export function dataHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "2026-11-30" → "30/11/2026". */
export const dataCurta = (dia: string | null): string =>
  dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia.split('-').reverse().join('/') : '—';
