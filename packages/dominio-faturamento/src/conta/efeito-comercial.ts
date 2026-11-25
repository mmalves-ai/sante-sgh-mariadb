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
