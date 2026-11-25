// O demonstrativo de pagamento na sessão sintética de dev/ci (E2E), com a mesma regra da porta própria
// (demonstrativo-importacao-propria.ts): cada linha casa com qualquer lote da mesma operadora pelo número do lote ou
// do protocolo, ou com a conta do lote pela guia; a linha casada fica pendente (divergente, com glosa) até a baixa;
// os totais vêm do domínio (totaisDoPagamento) e o líquido negativo é recusado. Dados SINTÉTICOS.
import type { DemonstrativoLido, ItemDemonstrativoLido } from '@sgh/contratos';
import { conferirPagamento, situacaoLinhaPagamento, totaisDoPagamento } from '@sgh/dominio-faturamento';
import { recusa } from '@sgh/nucleo';
import type { ResumoPagamento } from './demonstrativo-importacao-propria.js';
import type { ImportacaoPorta } from './porta.js';

const limpo = (v: string) => v.trim().replace(/^0+(?=\d)/, '');

interface EstadoPagamentoMemoria {
  seq: number;
  readonly lotes: ReadonlyMap<
    number,
    {
      readonly id: number;
      readonly convenio: number;
      readonly numero: string;
      readonly protocolo: string | null;
      readonly contas: readonly number[];
    }
  >;
  readonly demonstrativos: (DemonstrativoLido & {
    itensM: ItemDemonstrativoLido[];
    resumo?: ResumoPagamento;
  })[];
}

export function importarPagamentoMemoria(
  s: EstadoPagamentoMemoria,
  convenio: number,
  d: ImportacaoPorta,
): { id: number; repetido: boolean; casados: number; semCasamento: number } {
  const p = d.pagamento;
  if (!p || p.linhas.length === 0)
    throw recusa('entrada-invalida', 'O demonstrativo de pagamento não tem protocolos nem guias.');
  const t = totaisDoPagamento(p.linhas, p.deducoes);
  const erro = conferirPagamento(t);
  if (erro) throw recusa('pagamento-inconsistente', erro);
  const lotes = [...s.lotes.values()].filter((l) => l.convenio === convenio);
  const id = (s.seq += 1);
  const lotesDasLinhas: Record<number, number> = {};
  const itensM: ItemDemonstrativoLido[] = p.linhas.map((l, k) => {
    const guia = l.numeroGuia !== null ? limpo(l.numeroGuia) : '';
    const porConta = guia !== '' ? lotes.find((x) => x.contas.some((c) => String(c) === guia)) : undefined;
    const lote =
      porConta ??
      lotes.find(
        (x) =>
          (l.numeroLote !== null && limpo(l.numeroLote) === limpo(x.numero)) ||
          (l.protocolo !== null && x.protocolo !== null && limpo(l.protocolo) === limpo(x.protocolo)),
      );
    const casada = lote !== undefined;
    const situacao = situacaoLinhaPagamento({ casada, valorGlosa: l.valorGlosa });
    const linha = id * 1000 + k;
    lotesDasLinhas[linha] = lote?.id ?? 0;
    return {
      id: linha,
      item: null,
      versaoItem: null,
      conta: porConta ? Number(guia) : null,
      numeroGuia: l.numeroGuia ?? l.protocolo ?? l.numeroLote ?? '',
      sequencial: k + 1,
      codigoProcedimento: '',
      valorCobrado: null,
      valorInformado: l.valorInformado,
      valorPago: l.valorLiberado,
      quantidadePaga: 0,
      motivo: 0,
      motivoNome: '',
      situacao: situacao === 'sem_correspondencia' ? ('sem-casamento' as const) : ('casado' as const),
    };
  });
  const casados = itensM.filter((i) => i.situacao !== 'sem-casamento').length;
  s.demonstrativos.unshift({
    id,
    lote: Object.values(lotesDasLinhas).find((x) => x > 0) ?? 0,
    convenio,
    tipo: 'pagamento',
    origem: d.origem,
    numero: d.numero,
    dataEmissao: d.dataEmissao,
    itens: itensM.length,
    casados,
    semCasamento: itensM.length - casados,
    baixados: 0,
    valorInformado: t.informado,
    valorPago: t.liquido,
    importadoPor: d.usuario,
    importadoEm: new Date().toISOString(),
    itensM,
    resumo: {
      situacao: 'importado',
      dataPagamento: p.dataPagamento ?? '',
      informado: t.informado,
      liberado: t.liberado,
      glosa: t.glosa,
      debitos: t.debitos,
      creditos: t.creditos,
      liquido: t.liquido,
      titulo: null,
      deducoes: p.deducoes.map((x, k) => ({
        sequencia: k + 1,
        natureza: x.natureza,
        codigo: x.codigo ?? '',
        descricao: x.descricao,
        valor: x.valor,
      })),
      lotes: lotesDasLinhas,
    },
    ...(d.hashArquivo ? { hash: d.hashArquivo } : {}),
  });
  return { id, repetido: false, casados, semCasamento: itensM.length - casados };
}
