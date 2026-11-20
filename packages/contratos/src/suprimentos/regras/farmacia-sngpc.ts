// Farmácia ambulatorial com SNGPC (ficha do M29, regra 10; DP-47.5 (b), 2026-10-19; cap-13 CTRL-06): construída e
// DESLIGADA por parâmetro. A farmácia só hospitalar não está sujeita ao SNGPC (RDC 22/2014, art. 3º, parágrafo único):
// a chave nasce desligada e só liga com os pré-requisitos (CNAE de farmácia e credenciamento no SNGPC). A dispensação
// ambulatorial e a escrituração vão só a tabelas SGH_, sem nenhum efeito no outro sistema (sem baixa no estoque).
import { listaDoItem } from './farmacia-controlado.js';
import { qtd3, recusa, type RecusaSuprimentos } from './recusa.js';

/** Com a chave desligada, nenhuma escrita (nem SGH_): a recusa vem antes de abrir a transação. */
export function conferirChaveSngpc(ligada: boolean): RecusaSuprimentos | null {
  return ligada
    ? null
    : recusa(
        'farmacia-ambulatorial-desligada',
        'A farmácia ambulatorial (SNGPC) está desligada: liga com o CNAE de farmácia e o credenciamento no SNGPC registrados em Funcionalidades.',
      );
}

/** A dispensação ambulatorial: item controlado exige receita (número e data), lote e quantidade positiva. */
export function conferirDispensacaoAmbulatorial(c: {
  portaria: string | null;
  receitaNumero: string | null;
  receitaData: string | null;
  hoje: string;
  lote: string;
  quantidade: number;
}): RecusaSuprimentos | null {
  if (!(c.quantidade > 0)) return recusa('quantidade-invalida', 'Informe a quantidade.', ['quantidade']);
  if (!c.lote.trim()) return recusa('sem-lote', 'Informe o lote dispensado (vai à escrituração).', ['lote']);
  if (listaDoItem(c.portaria)) {
    if (!(c.receitaNumero ?? '').trim())
      return recusa('sem-receita', 'Controlado: informe o número da notificação ou da receita.', ['receita']);
    if (!c.receitaData || c.receitaData > c.hoje)
      return recusa('receita-data', 'A data da receita é inválida ou futura.', ['receitaData']);
    // Validade da notificação: 30 dias da emissão (Portaria 344, arts. 41 e 52).
    const dias = (Date.parse(`${c.hoje}T00:00:00Z`) - Date.parse(`${c.receitaData}T00:00:00Z`)) / 86_400_000;
    if (dias > 30)
      return recusa('receita-vencida', 'A receita passou dos 30 dias de validade.', ['receitaData']);
  }
  return null;
}

/** O lote de envio SNGPC: as dispensações ainda não escrituradas do período, com a soma por item e lote. */
export function montarEnvioSngpc(
  d: readonly { id: number; item: number; lote: string; quantidade: number; escriturada: boolean }[],
): { dispensacoes: number[]; porItemLote: { item: number; lote: string; quantidade: number }[] } {
  const pend = d.filter((x) => !x.escriturada);
  const m = new Map<string, { item: number; lote: string; quantidade: number }>();
  for (const x of pend) {
    const k = `${x.item}|${x.lote}`;
    const a = m.get(k) ?? { item: x.item, lote: x.lote, quantidade: 0 };
    m.set(k, { ...a, quantidade: qtd3(a.quantidade + x.quantidade) });
  }
  return { dispensacoes: pend.map((x) => x.id), porItemLote: [...m.values()] };
}
