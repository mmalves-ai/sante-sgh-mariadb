// Título a pagar (M32; ficha, seções 5 e 8): chave natural, parcelas, exclusão e a classificação gerencial.
//   - regra 3: chave natural única (EMPRESA, FORN, DOC, PARC, TIPO, SERIE); repetição devolve 409;
//   - regra 6: título pago não se apaga (TRG_MFCONPAG_AD recusa: e_exc_mfconpag_pago); desfazer é estorno com motivo;
//   - regra 7: a classificação gerencial (MFLANGSI) é gravada só na parcela 1, com CDC = 0, e vale para o documento
//     inteiro; o rateio por centro de custo fica em SGH_FIN_RATEIO até o cenário controlado.
import { dataVazia, iguaisEmCentavos, recusaFin, type RecusaFinanceiro, reais } from './recusa.js';

export interface ChaveTituloPagar {
  readonly empresa: number;
  readonly credor: number;
  readonly documento: number;
  readonly parcela: number;
  readonly tipo: string;
  readonly serie: string;
}

/** A chave natural em texto (trilha, aprovação e mensagens). */
export const chaveTituloTexto = (c: ChaveTituloPagar): string =>
  `${c.empresa}/${c.credor}/${c.documento}/${c.parcela}/${c.tipo}/${c.serie.trim() || '-'}`;

/** A série gravada: sem série, a letra F do DEFAULT da coluna (MFCONPAG.SERIE e MFCTAREC.SERIE; D-SERIE-32). */
export const serieGravada = (s: string | null | undefined): string => (s ?? '').trim().toUpperCase() || 'F';

export interface ParcelaInformada {
  readonly parcela: number;
  readonly vencimento: string;
  readonly valor: number;
}

export const MAX_PARCELAS = 120;

/** As parcelas: numeradas de 1 em diante sem salto, vencimentos em ordem, valores positivos que somam o documento. */
export function conferirParcelas(
  parcelas: readonly ParcelaInformada[],
  totalDocumento: number,
  emissao: string,
): RecusaFinanceiro | null {
  if (parcelas.length === 0) return recusaFin('sem-parcelas', 'Informe ao menos uma parcela.', ['parcelas']);
  if (parcelas.length > MAX_PARCELAS)
    return recusaFin('parcelas-demais', `No máximo ${MAX_PARCELAS} parcelas.`, ['parcelas']);
  let anterior = '';
  for (const [i, p] of parcelas.entries()) {
    if (p.parcela !== i + 1)
      return recusaFin('parcela-fora-de-ordem', 'As parcelas são numeradas de 1 em diante, sem salto.', [
        'parcelas',
      ]);
    if (!(p.valor > 0))
      return recusaFin('parcela-sem-valor', `A parcela ${p.parcela} precisa de valor.`, ['parcelas']);
    if (p.vencimento < emissao)
      return recusaFin(
        'vencimento-antes-da-emissao',
        `A parcela ${p.parcela} vence antes da emissão do documento.`,
        ['parcelas'],
      );
    if (anterior && p.vencimento < anterior)
      return recusaFin('vencimentos-fora-de-ordem', 'Os vencimentos vêm em ordem.', ['parcelas']);
    anterior = p.vencimento;
  }
  const soma = parcelas.reduce((s, p) => s + p.valor, 0);
  if (!iguaisEmCentavos(soma, totalDocumento))
    return recusaFin(
      'parcelas-nao-somam',
      `As parcelas somam ${reais(soma)} e o documento vale ${reais(totalDocumento)}.`,
      ['parcelas', 'valorDocumento'],
    );
  return null;
}

/** Divide o documento em n parcelas iguais (a última leva a diferença de centavos), a cada `intervaloDias`. */
export function parcelarDocumento(
  total: number,
  n: number,
  primeiroVencimento: string,
  intervaloDias: number,
): ParcelaInformada[] {
  const base = Math.floor((total * 100) / n) / 100;
  const r: ParcelaInformada[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(`${primeiroVencimento}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i * intervaloDias);
    const valor = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
    r.push({ parcela: i + 1, vencimento: d.toISOString().slice(0, 10), valor });
  }
  return r;
}

/** Regra 7: o MFLANGSI só nasce com a parcela 1 (o outro sistema grava assim; o rateio vale para o documento). */
export const gravaClassificacao = (parcela: number): boolean => parcela === 1;

export interface TituloRelido {
  readonly pago: number;
  readonly dataPagamento: string | null;
  readonly bordero: number;
}

/** Em aberto: PAGO = 0 e DT_PGTO sentinela (Anexo A §A.6, confiança alta). */
export const tituloEmAberto = (t: TituloRelido): boolean => !(t.pago > 0) && dataVazia(t.dataPagamento);

/** Regra 6: só se exclui título em aberto e fora de borderô; o pago se estorna com motivo. */
export function conferirExclusao(t: TituloRelido): RecusaFinanceiro | null {
  if (!tituloEmAberto(t))
    return recusaFin('titulo-pago', 'Título pago não se apaga: registre o estorno com o motivo.');
  if (t.bordero > 0)
    return recusaFin('titulo-em-bordero', 'O título está num borderô: retire-o do borderô antes de excluir.');
  return null;
}

/** A mensagem em português da exceção do gatilho (e_exc_mfconpag_pago) que recusa excluir título baixado. */
export const MENSAGEM_EXCLUIR_PAGO = 'Título pago não se apaga: registre o estorno com o motivo.';
