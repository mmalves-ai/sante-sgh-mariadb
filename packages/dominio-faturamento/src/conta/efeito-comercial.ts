// Efeito da franquia e do desconto por volume no total cobrado da fonte pagadora e na guia TISS (F8, 06-FAT linha 19).
//   - O desconto por volume reduz o total da guia (abatido da fonte pagadora).
//   - A franquia é a parte do beneficiário: entra no valor do paciente e é abatida do total da fonte pagadora.
//   - A reaplicação troca o que estava aplicado (diferença), sem somar duas vezes; o acréscimo e o desconto que vieram de
//     outro fluxo (ajuste aprovado, importação) ficam como estão.
//   - Na guia TISS, o abatimento vai no fator de redução de cada item (reducaoAcrescimo, st_decimal3-2), o jeito do padrão
//     de mostrar redução por item sem mudar o preço de tabela.

const r2 = (v: number) => Math.round(v * 100) / 100;

/** O que a regra comercial abate da conta: franquia (paciente) e desconto por volume (fonte). */
export interface AbatimentoComercial {
  readonly franquia: number;
  readonly desconto: number;
}

export interface ValoresContaComercial {
  readonly valorItens: number;
  readonly valorAcrescimo: number;
  readonly valorDesconto: number;
  readonly valorPaciente: number;
}

export interface EfeitoComercialConta {
  /** Desconto do cabeçalho da conta (inclui o abatido pela regra comercial). */
  readonly valorDesconto: number;
  /** Parte do paciente (franquia). */
  readonly valorPaciente: number;
  /** Total cobrado da fonte pagadora: itens + acréscimo − desconto (nunca negativo). */
  readonly valorTotal: number;
  /** Total abatido pela regra comercial nesta aplicação. */
  readonly abatimento: number;
}

const total = (a: AbatimentoComercial) => r2(Math.max(0, a.franquia) + Math.max(0, a.desconto));

/**
 * Os valores da conta depois de aplicar a franquia e o desconto: troca o abatimento anterior pelo novo, sem mexer no
 * desconto e no acréscimo de outros fluxos.
 */
export function efeitoComercialNaConta(
  c: ValoresContaComercial,
  anterior: AbatimentoComercial,
  novo: AbatimentoComercial,
): EfeitoComercialConta {
  const valorDesconto = Math.max(0, r2(c.valorDesconto - total(anterior) + total(novo)));
  const valorPaciente = Math.max(
    0,
    r2(c.valorPaciente - Math.max(0, anterior.franquia) + Math.max(0, novo.franquia)),
  );
  return {
    valorDesconto,
    valorPaciente,
    valorTotal: Math.max(0, r2(c.valorItens + c.valorAcrescimo - valorDesconto)),
    abatimento: total(novo),
  };
}

/**
 * O fator de redução da guia TISS (reducaoAcrescimo, duas casas) para levar o abatimento comercial ao total da guia:
 * (bruto − abatimento) / bruto. Sem abatimento ou sem valor bruto, 1 (sem redução); o abatimento maior que o bruto dá 0.
 */
export function fatorReducaoGuia(bruto: number, abatimento: number): number {
  if (!(bruto > 0) || !(abatimento > 0)) return 1;
  const f = Math.max(0, (bruto - abatimento) / bruto);
  return Math.round(f * 100) / 100;
}

/** O valor de uma linha da guia com o fator: quantidade × unitário × fator, em centavos inteiros. */
export function valorLinhaGuia(quantidade: number, valorUnitario: number, fator = 1): number {
  return Math.round(quantidade * valorUnitario * fator * 100) / 100;
}

/** O resultado da repartição do abatimento comercial nos itens da guia. */
export interface ReducaoComercialGuia {
  /** O fator de cada item, na ordem recebida (duas casas; 1 quando o item não é reduzido). */
  readonly fatores: readonly number[];
  /** Total da guia com os fatores (soma das linhas arredondadas no centavo, como no XML). */
  readonly totalGuia: number;
  /** O total que a guia precisa ter: bruto − abatimento (o valor_total da conta). */
  readonly alvo: number;
  /** alvo − totalGuia: zero quando a guia fecha no centavo. */
  readonly residuo: number;
}

/**
 * Reparte o abatimento comercial (franquia e desconto por volume) pelos itens da guia TISS de modo que o total da guia
 * feche no centavo com o total cobrado da fonte pagadora. O fator do padrão tem só duas casas (st_decimal3-2): um fator
 * único arredondado deixa sobra (bruto 1000 com abatimento 333 daria 670 na guia e 667 na conta; abatimento abaixo de
 * 0,5% viraria 1,00 e a franquia seria cobrada duas vezes). Por isso cada item recebe o seu fator: parte do fator comum
 * e ajusta item a item, um centésimo por vez, o que mais aproxima do alvo sem passar dele. O resíduo que sobra (guia de
 * um item só, por exemplo) é devolvido para quem chama recusar a guia em vez de cobrar diferente da conta.
 */
export function reducaoComercialDaGuia(
  itens: readonly { readonly quantidade: number; readonly valorUnitario: number }[],
  abatimento: number,
): ReducaoComercialGuia {
  const linha = (i: { quantidade: number; valorUnitario: number }, k: number) =>
    Math.round(i.quantidade * i.valorUnitario * (k / 100) * 100);
  const bruto = itens.reduce((t, i) => t + linha(i, 100), 0);
  const ab = Math.round(Math.max(0, abatimento) * 100);
  const alvo = Math.max(0, bruto - ab);
  if (!(ab > 0) || !(bruto > 0))
    return { fatores: itens.map(() => 1), totalGuia: bruto / 100, alvo: bruto / 100, residuo: 0 };
  const ks = itens.map(() => Math.max(0, Math.min(100, Math.round((alvo / bruto) * 100))));
  const soma = () => itens.reduce((t, i, x) => t + linha(i, ks[x]!), 0);
  let total = soma();
  // Ajuste fino: a cada passo, o item cujo centésimo a mais (ou a menos) mais aproxima o total do alvo.
  for (let passo = 0; passo < 100 * itens.length && total !== alvo; passo++) {
    const sinal = total < alvo ? 1 : -1;
    let melhor = -1;
    let melhorGap = Math.abs(alvo - total);
    itens.forEach((i, x) => {
      const k = ks[x]! + sinal;
      if (k < 0 || k > 100) return;
      const novo = total - linha(i, ks[x]!) + linha(i, k);
      const gap = Math.abs(alvo - novo);
      if (gap < melhorGap) {
        melhor = x;
        melhorGap = gap;
      }
    });
    if (melhor < 0) break;
    const k = ks[melhor]! + sinal;
    total = total - linha(itens[melhor]!, ks[melhor]!) + linha(itens[melhor]!, k);
    ks[melhor] = k;
  }
  // Quando um passo só não chega (cada centésimo de um item pula o alvo), troca em par: um item sobe e outro desce até
  // três centésimos cada. Limitado às guias de até 400 itens; acima disso sobra resíduo e a guia é recusada.
  for (let volta = 0; volta < 20 && total !== alvo && itens.length <= 400; volta++) {
    let melhor: [number, number, number, number] | null = null;
    let melhorGap = Math.abs(alvo - total);
    for (let x = 0; x < itens.length; x++)
      for (let dx = -3; dx <= 3; dx++) {
        const kx = ks[x]! + dx;
        if (dx === 0 || kx < 0 || kx > 100) continue;
        const tx = total - linha(itens[x]!, ks[x]!) + linha(itens[x]!, kx);
        for (let y = x + 1; y < itens.length; y++)
          for (let dy = -3; dy <= 3; dy++) {
            const ky = ks[y]! + dy;
            if (dy === 0 || ky < 0 || ky > 100) continue;
            const gap = Math.abs(alvo - (tx - linha(itens[y]!, ks[y]!) + linha(itens[y]!, ky)));
            if (gap < melhorGap) {
              melhor = [x, kx, y, ky];
              melhorGap = gap;
            }
          }
      }
    if (!melhor) break;
    const [x, kx, y, ky] = melhor;
    ks[x] = kx;
    ks[y] = ky;
    total = soma();
  }
  return {
    fatores: ks.map((k) => k / 100),
    totalGuia: total / 100,
    alvo: alvo / 100,
    residuo: (alvo - total) / 100,
  };
}

const brl = (v: number) => v.toFixed(2).replace('.', ',');

/**
 * Confere que a guia com o abatimento comercial fecha no centavo com o total cobrado da fonte pagadora (valor_total da
 * conta). Recusa quando sobra resíduo (o fator de duas casas não representa o abatimento) e quando o total da conta não
 * é o bruto menos o abatimento; diz os valores para o faturista ajustar o desconto ou a franquia.
 */
export function conferirReducaoComercialDaGuia(
  conta: string,
  r: ReducaoComercialGuia,
  valorTotalConta: number,
  abatimento: number,
): { readonly codigo: string; readonly mensagem: string } | null {
  if (!(abatimento > 0)) return null;
  if (Math.round(r.alvo * 100) !== Math.round(valorTotalConta * 100))
    return {
      codigo: 'guia-abatimento-divergente',
      mensagem: `A conta ${conta} tem R$ ${brl(valorTotalConta)} cobrados da fonte, mas o bruto da guia menos o desconto e a franquia dá R$ ${brl(r.alvo)}: reaplique o desconto e a franquia antes do lote.`,
    };
  if (r.residuo !== 0)
    return {
      codigo: 'guia-abatimento-sem-fator',
      mensagem: `A guia da conta ${conta} não fecha com a conta pelo fator de redução de duas casas do padrão TISS (R$ ${brl(r.totalGuia)} na guia e R$ ${brl(r.alvo)} na conta): ajuste o desconto ou a franquia em R$ ${brl(Math.abs(r.residuo))} para o total fechar no centavo.`,
    };
  return null;
}
