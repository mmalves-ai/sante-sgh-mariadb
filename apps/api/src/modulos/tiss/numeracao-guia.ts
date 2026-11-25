// Número da guia do prestador na emissão (F3.1, 02-CAD linha 25): a geração do lote consome a faixa de números que
// a operadora forneceu para o tipo de guia e grava a guia emitida com o número, na mesma transação do lote.
// - a conta que já tem guia fica com o número dela (número emitido não muda nem é reemitido: o lote refeito depois
//   de um cancelamento reusa a guia);
// - a fonte pagadora com faixa (ativa ou esgotada) para o tipo: o número sai da faixa, em ordem; sem número
//   disponível o lote é recusado inteiro, com o aviso de cadastrar a nova faixa;
// - sem faixa, a numeração é a do hospital (o número da conta), como antes.
// A decisão é do domínio (`origemNumeroGuia`); aqui só leitura sob trava e gravação pelo executor.
import type { ContaTiss } from '@sgh/contratos';
import { avisoFaixaNoFim, origemNumeroGuia, tipoFaixaDaGuia } from '@sgh/dominio-faturamento';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { reservarNumeroGuia } from '../cadastro/tiss-configuracao-proprio.js';

type Linha = Record<string, unknown>;

/** Tabelas que a operação que emite declara além das suas. */
export const TABELAS_NUMERACAO_GUIA = [
  'guia_tiss',
  'faixa_numeracao_guia',
  'faixa_numeracao_guia_uso',
] as const;

/** Guia que nasce neste lote, com o número já consumido da faixa. */
export interface GuiaEmitida {
  readonly conta: number;
  readonly numero: string;
  readonly sequencia: number;
  readonly faixa: number;
  readonly principal: number | null;
  readonly recemNascido: boolean;
  readonly senha: string;
  readonly guiaOperadora: string;
}

export interface LoteNumerado {
  readonly montadas: ContaTiss[];
  readonly emitidas: GuiaEmitida[];
  /** Guias que já existiam e seguem com o número delas: só passam a apontar para o lote novo. */
  readonly reusadas: { readonly id: number; readonly versao: number }[];
  readonly avisos: string[];
}

const SQL_GUIA = `
  SELECT id, versao, numero_guia_prestador, situacao FROM guia_tiss
   WHERE conta_hospitalar_id = ? AND tipo_guia = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
   ORDER BY id DESC LIMIT 1`;

/**
 * Dá o número a cada guia que vai ao arquivo, antes da montagem do XML. `tipoGuia` é o tipo da guia no modelo
 * (consulta, sp_sadt, resumo_internacao, honorario).
 */
export async function numerarGuiasDoLote(
  tx: TxOperacao,
  est: number,
  fonte: number,
  tipoGuia: string,
  montadas: readonly ContaTiss[],
  hoje: string,
): Promise<LoteNumerado> {
  const faixas = await tx.consultar<Linha>(
    `SELECT situacao FROM faixa_numeracao_guia
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND tipo_guia = ?`,
    [est, fonte, tipoFaixaDaGuia(tipoGuia)],
  );
  const situacoes = faixas.map((f) => String(f['situacao']));
  const saida: ContaTiss[] = [];
  const emitidas: GuiaEmitida[] = [];
  const reusadas: { id: number; versao: number }[] = [];
  const dados = new Map<number, GuiaEmitida | null>();
  let ultimo: { esgotada: boolean; noFim: boolean; restantes: number } | null = null;
  for (const m of montadas) {
    if (!dados.has(m.conta)) {
      const guia = await tx.uma<Linha>(SQL_GUIA, [m.conta, tipoGuia]);
      const numeroDaGuia = guia ? String(guia['numero_guia_prestador'] ?? '') : null;
      const origem = origemNumeroGuia({ numeroDaGuia, situacoesDasFaixas: situacoes });
      if (origem === 'guia' && guia && String(guia['situacao']) === 'em_lote')
        reusadas.push({ id: Number(guia['id']), versao: Number(guia['versao']) });
      if (origem !== 'faixa') dados.set(m.conta, null);
      else {
        // A guia de honorário referencia a guia principal da conta (o resumo de internação já emitido).
        let principal: number | null = null;
        if (tipoGuia === 'honorario' || tipoGuia === 'outras_despesas') {
          const p = await tx.uma<Linha>(SQL_GUIA, [m.conta, 'resumo_internacao']);
          if (!p)
            throw recusa(
              'guia-principal-ausente',
              'A operadora numera esta guia por faixa e ela referencia a guia principal da conta: gere antes o lote do resumo de internação.',
            );
          principal = Number(p['id']);
        }
        const r = await reservarNumeroGuia(tx, est, fonte, tipoGuia, hoje);
        ultimo = r;
        const g: GuiaEmitida = {
          conta: m.conta,
          numero: r.numero,
          sequencia: r.sequencia,
          faixa: r.faixa,
          principal,
          recemNascido: m.atendimentoRN,
          senha: m.senha,
          guiaOperadora: m.guiaSolicitacao,
        };
        dados.set(m.conta, g);
        emitidas.push(g);
      }
    }
    const g = dados.get(m.conta);
    saida.push(g ? { ...m, numeroGuia: g.numero } : m);
  }
  const aviso = ultimo ? avisoFaixaNoFim(ultimo) : null;
  return { montadas: saida, emitidas, reusadas, avisos: aviso ? [aviso] : [] };
}

/** Grava as guias emitidas no lote (com o valor apresentado) e o uso de cada número na faixa. */
export async function gravarGuiasDoLote(
  tx: TxOperacao,
  d: {
    readonly estabelecimento: number;
    readonly fonte: number;
    readonly tipoGuia: string;
    readonly lote: number;
    readonly hoje: string;
    readonly agora: Date;
    readonly usuario: number | null;
    readonly numerado: LoteNumerado;
    readonly valores: ReadonlyMap<number, number>;
  },
): Promise<void> {
  for (const g of d.numerado.emitidas) {
    const ct = await tx.uma<Linha>(
      'SELECT paciente_id, guia_fonte_pagadora_id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ?',
      [g.conta, d.estabelecimento],
    );
    const guia = await tx.incluir('guia_tiss', {
      estabelecimento_id: d.estabelecimento,
      conta_hospitalar_id: g.conta,
      tipo_guia: d.tipoGuia,
      guia_tiss_principal_id: g.principal,
      guia_fonte_pagadora_id: ct?.['guia_fonte_pagadora_id'] ?? null,
      lote_tiss_id: d.lote,
      fonte_pagadora_id: d.fonte,
      paciente_id: ct?.['paciente_id'],
      numero_guia_prestador: g.numero,
      numero_guia_operadora: g.guiaOperadora || null,
      atendimento_recem_nascido: g.recemNascido,
      data_emissao: d.hoje,
      senha: g.senha || null,
      valor_total: d.valores.get(g.conta) ?? 0,
      situacao: 'em_lote',
    });
    await tx.incluir('faixa_numeracao_guia_uso', {
      faixa_numeracao_guia_id: g.faixa,
      numero: g.sequencia,
      numero_guia: g.numero,
      guia_tiss_id: guia,
      utilizado_em: d.agora,
      usuario_id: d.usuario,
    });
  }
  for (const r of d.numerado.reusadas)
    await tx.alterar('guia_tiss', r.id, r.versao, { lote_tiss_id: d.lote });
}
