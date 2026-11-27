// Número da guia do prestador na emissão (F3.1, 02-CAD linha 25): a geração do lote consome a faixa de números que
// a operadora forneceu para o tipo de guia e grava a guia emitida com o número, na mesma transação do lote.
// - a conta que já tem guia DESTA fonte pagadora fica com o número dela (número emitido não muda nem é reemitido,
//   inclusive o da guia que veio da importação: a operadora já o conhece). Toda guia existente que vai ao arquivo
//   passa a apontar para o lote novo, fica "em lote" e é regravada com o que o lote apresenta (valor, senha, número
//   na operadora, recém-nascido), para a guia gravada não divergir do arquivo e da fatura;
// - a guia de outra fonte pagadora (a conta trocou de convênio) não é reusada: a guia nasce de novo, com o número
//   da operadora atual; a antiga fica como está, no histórico;
// - a fonte pagadora com faixa (ativa ou esgotada) para o tipo: o número sai da faixa, em ordem; sem número
//   disponível o lote é recusado inteiro, com o aviso de cadastrar a nova faixa;
// - o número tirado da faixa é conferido contra as guias da fonte pagadora (o número é único por fonte pagadora,
//   qualquer que seja o tipo de guia): já usado, o lote recusa inteiro dizendo qual faixa corrigir;
// - sem faixa, a numeração é a do hospital (o número da conta), como antes.
// A decisão é do domínio (`origemNumeroGuia`); aqui só leitura sob trava e gravação pelo executor.
import type { ContaTiss } from '@sgh/contratos';
import { avisoFaixaNoFim, origemNumeroGuia, tipoFaixaDaGuia } from '@sgh/dominio-faturamento';
import { recusa, type TxOperacao } from '@sgh/nucleo';
import { reservarNumeroGuia } from '../cadastro/tiss-configuracao-proprio.js';
import { gravarOpmeDaGuiaTiss, TABELAS_OPME_COBRANCA } from './opme-guia-propria.js';

type Linha = Record<string, unknown>;

/** Tabelas que a operação que emite declara além das suas. */
export const TABELAS_NUMERACAO_GUIA = [
  'guia_tiss',
  'faixa_numeracao_guia',
  'faixa_numeracao_guia_uso',
  ...TABELAS_OPME_COBRANCA,
] as const;

/** Guia que nasce neste lote, com o número já consumido da faixa. */
export interface GuiaEmitida {
  readonly conta: number;
  /** O período fechado da guia (lote por período); nulo na guia da conta inteira. */
  readonly periodo: number | null;
  readonly numero: string;
  readonly sequencia: number;
  readonly faixa: number;
  readonly principal: number | null;
  readonly recemNascido: boolean;
  readonly senha: string;
  readonly guiaOperadora: string;
}

export interface GuiaReusada {
  readonly id: number;
  readonly versao: number;
  readonly conta: number;
  readonly periodo: number | null;
  readonly recemNascido: boolean;
  readonly senha: string;
  readonly guiaOperadora: string;
}

export interface LoteNumerado {
  readonly montadas: ContaTiss[];
  readonly emitidas: GuiaEmitida[];
  /** Guias que já existiam e seguem com o número delas: passam ao lote novo, com o que ele apresenta. */
  readonly reusadas: GuiaReusada[];
  readonly avisos: string[];
}

const SQL_GUIA = `
  SELECT id, versao, numero_guia_prestador, situacao FROM guia_tiss
   WHERE conta_hospitalar_id = ? AND tipo_guia = ? AND fonte_pagadora_id = ? AND excluido_em IS NULL
     AND situacao <> 'cancelada'
   ORDER BY id DESC LIMIT 1`;
/** A guia da conta no período (lote TISS por período, decisão 58): nulo, a guia da conta inteira ou a do que sobra. */
const SQL_GUIA_PERIODO = `
  SELECT id, versao, numero_guia_prestador, situacao FROM guia_tiss
   WHERE conta_hospitalar_id = ? AND tipo_guia = ? AND fonte_pagadora_id = ? AND conta_hospitalar_periodo_id <=> ?
     AND excluido_em IS NULL AND situacao <> 'cancelada'
   ORDER BY id DESC LIMIT 1`;

/** A chave da guia no lote: a conta e, na conta repartida por período fechado, o período. */
export const chaveGuiaDoLote = (conta: number, periodo: number | null | undefined): string =>
  `${conta}/${periodo ?? ''}`;

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
  const reusadas: GuiaReusada[] = [];
  const dados = new Map<string, { readonly numero: string } | null>();
  // Só o lote com conta repartida por período lê a guia pelo período (a coluna vem da migração 12_FAT/98).
  const porPeriodo = montadas.some((m) => m.periodo !== undefined);
  let ultimo: { esgotada: boolean; noFim: boolean; restantes: number } | null = null;
  for (const m of montadas) {
    const chave = chaveGuiaDoLote(m.conta, m.periodo);
    if (!dados.has(chave)) {
      const guia = porPeriodo
        ? await tx.uma<Linha>(SQL_GUIA_PERIODO, [m.conta, tipoGuia, fonte, m.periodo ?? null])
        : await tx.uma<Linha>(SQL_GUIA, [m.conta, tipoGuia, fonte]);
      const numeroDaGuia = guia ? String(guia['numero_guia_prestador'] ?? '') : null;
      const origem = origemNumeroGuia({ numeroDaGuia, situacoesDasFaixas: situacoes });
      // Toda guia existente que vai ao arquivo é ligada ao lote (não só a que já estava em lote).
      if (origem === 'guia' && guia)
        reusadas.push({
          id: Number(guia['id']),
          versao: Number(guia['versao']),
          conta: m.conta,
          periodo: m.periodo ?? null,
          recemNascido: m.atendimentoRN,
          senha: m.senha,
          guiaOperadora: m.guiaSolicitacao,
        });
      if (origem === 'guia') dados.set(chave, { numero: numeroDaGuia ?? m.numeroGuia });
      else if (origem === 'conta') dados.set(chave, null);
      else {
        // A guia de honorário referencia a guia principal da conta (o resumo de internação já emitido).
        let principal: number | null = null;
        if (tipoGuia === 'honorario' || tipoGuia === 'outras_despesas') {
          const p = await tx.uma<Linha>(SQL_GUIA, [m.conta, 'resumo_internacao', fonte]);
          if (!p)
            throw recusa(
              'guia-principal-ausente',
              'A operadora numera esta guia por faixa e ela referencia a guia principal da conta: gere antes o lote do resumo de internação.',
            );
          principal = Number(p['id']);
        }
        const r = await reservarNumeroGuia(tx, est, fonte, tipoGuia, hoje);
        ultimo = r;
        // O número da guia do prestador é único por fonte pagadora, qualquer que seja o tipo de guia: a faixa que
        // repete número já emitido (faixa de outro tipo com os mesmos números, guia que veio da importação) recusa
        // o lote inteiro como regra de negócio, antes de qualquer gravação de guia.
        const usada = await tx.uma<Linha>(
          `SELECT id FROM guia_tiss
            WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND numero_guia_prestador = ? LIMIT 1`,
          [est, fonte, r.numero],
        );
        if (usada)
          throw recusa(
            'numero-de-guia-ja-usado',
            `O número ${r.numero} da faixa da operadora já está em outra guia desta fonte pagadora: encerre a faixa deste tipo de guia e cadastre outra que não repita números já emitidos.`,
            { campos: ['tipoGuia'] },
          );
        const g: GuiaEmitida = {
          conta: m.conta,
          periodo: m.periodo ?? null,
          numero: r.numero,
          sequencia: r.sequencia,
          faixa: r.faixa,
          principal,
          recemNascido: m.atendimentoRN,
          senha: m.senha,
          guiaOperadora: m.guiaSolicitacao,
        };
        dados.set(chave, g);
        emitidas.push(g);
      }
    }
    const g = dados.get(chave);
    saida.push(g ? { ...m, numeroGuia: g.numero } : m);
  }
  const aviso = ultimo ? avisoFaixaNoFim(ultimo) : null;
  return { montadas: saida, emitidas, reusadas, avisos: aviso ? [aviso] : [] };
}

/**
 * Grava as guias emitidas no lote (com o valor apresentado) e o uso de cada número na faixa; a OPME da conta vai à guia
 * (`guia_tiss_opme`, 06-FAT linha 25) ligada à OPME autorizada. Devolve os avisos da OPME cobrada acima do autorizado.
 */
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
    /** Valor de cada guia pela chave (chaveGuiaDoLote), quando a conta vai repartida por período fechado. */
    readonly valoresGuia?: ReadonlyMap<string, number>;
  },
): Promise<string[]> {
  const valorDa = (conta: number, periodo: number | null) =>
    d.valoresGuia?.get(chaveGuiaDoLote(conta, periodo)) ?? d.valores.get(conta) ?? 0;
  const avisos: string[] = [];
  for (const g of d.numerado.emitidas) {
    const ct = await tx.uma<Linha>(
      'SELECT paciente_id, guia_fonte_pagadora_id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ?',
      [g.conta, d.estabelecimento],
    );
    const guia = await tx.incluir('guia_tiss', {
      estabelecimento_id: d.estabelecimento,
      conta_hospitalar_id: g.conta,
      ...(g.periodo !== null ? { conta_hospitalar_periodo_id: g.periodo } : {}),
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
      valor_total: valorDa(g.conta, g.periodo),
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
    avisos.push(
      ...(await gravarOpmeDaGuiaTiss(tx, {
        guiaTiss: guia,
        conta: g.conta,
        agora: d.agora,
        usuario: d.usuario,
      })),
    );
  }
  // A guia que já existia vai ao lote novo com o que ele apresenta: a conta pode ter sido corrigida entre o
  // cancelamento e a nova geração, e a guia gravada não pode divergir do arquivo nem da fatura. Senha e número na
  // operadora só são regravados quando o lote os traz (não se apaga o que a guia já tinha).
  for (const r of d.numerado.reusadas)
    await tx.alterar('guia_tiss', r.id, r.versao, {
      lote_tiss_id: d.lote,
      situacao: 'em_lote',
      valor_total: valorDa(r.conta, r.periodo),
      atendimento_recem_nascido: r.recemNascido,
      ...(r.senha ? { senha: r.senha } : {}),
      ...(r.guiaOperadora ? { numero_guia_operadora: r.guiaOperadora } : {}),
    });
  for (const r of d.numerado.reusadas)
    avisos.push(
      ...(await gravarOpmeDaGuiaTiss(tx, {
        guiaTiss: r.id,
        conta: r.conta,
        agora: d.agora,
        usuario: d.usuario,
      })),
    );
  return avisos;
}
