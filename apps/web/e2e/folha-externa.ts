// Simulador da folha externa para o E2E @M53.1: cópia de `packages/testes/src/m53/folha-externa.ts` (o teste de contrato
// roda lá). A fronteira do Nx não deixa o projeto web depender de `@sgh/testes` (D-SIM-E2E-531); esta cópia depende só
// de `@sgh/contratos` e valida o retorno pelo mesmo leiaute, então um desvio do contrato quebra os dois.
import {
  esquemaLoteExportacaoFolha,
  esquemaLoteRetornoFolha,
  type LoteExportacaoFolha,
  type LoteRetornoFolha,
} from '@sgh/contratos';

export interface VariacaoFolhaExterna {
  /** Soma este valor (centavos) ao líquido declarado do vínculo, sem mexer nas rubricas (divergência por colaborador). */
  readonly alterarLiquido?: { readonly vinculo: number; readonly centavos: number };
  /** Ecoa um colaborador a menos do que recebeu (o sistema externo "perdeu" um). */
  readonly ecoDiferente?: boolean;
  /** Inclui um vínculo que não estava no lote enviado. */
  readonly vinculoExtra?: number;
}

export const SALARIO_BASE_SINTETICO = 300_000; // R$ 3.000,00
export const VALOR_HORA_SINTETICO = 2_500; // R$ 25,00 por hora de ponto ou plantão

const proximoMes = (c: string) => {
  const a = Number(c.slice(0, 4));
  const m = Number(c.slice(5, 7));
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};

/** O retorno da folha externa para o lote (válido pelo leiaute; com defeito só pela variação pedida). */
export function simularFolhaExterna(bruto: unknown, v: VariacaoFolhaExterna = {}): LoteRetornoFolha {
  const lote: LoteExportacaoFolha = esquemaLoteExportacaoFolha.parse(bruto);
  const minutos = new Map<number, number>();
  for (const e of lote.eventosPonto) minutos.set(e.vinculo, (minutos.get(e.vinculo) ?? 0) + e.minutos);
  for (const p of lote.plantoes) minutos.set(p.vinculo, (minutos.get(p.vinculo) ?? 0) + p.minutos);
  const vinculos = [...lote.colaboradores.map((c) => c.vinculo), ...(v.vinculoExtra ? [v.vinculoExtra] : [])];
  const colaboradores = vinculos.map((vinculo, i) => {
    const horas = Math.round(((minutos.get(vinculo) ?? 0) * VALOR_HORA_SINTETICO) / 60);
    const proventos = SALARIO_BASE_SINTETICO + horas;
    const inss = Math.round(proventos * 0.09);
    const irrf = Math.round(proventos * 0.05);
    const liquido =
      proventos - inss - irrf + (v.alterarLiquido?.vinculo === vinculo ? v.alterarLiquido.centavos : 0);
    return {
      vinculo,
      matriculaExterna: `EXT-${String(i + 1).padStart(4, '0')}`,
      rubricas: [
        { codigo: '0001', natureza: 'provento' as const, valor: SALARIO_BASE_SINTETICO },
        ...(horas > 0 ? [{ codigo: '0050', natureza: 'provento' as const, valor: horas }] : []),
        { codigo: '0901', natureza: 'desconto' as const, valor: inss },
        { codigo: '0902', natureza: 'desconto' as const, valor: irrf },
      ],
      liquido,
    };
  });
  const somaDe = (natureza: 'provento' | 'desconto') =>
    colaboradores.reduce(
      (s, c) => s + c.rubricas.filter((r) => r.natureza === natureza).reduce((x, r) => x + r.valor, 0),
      0,
    );
  const proventos = somaDe('provento');
  const descontos = somaDe('desconto');
  const liquido = colaboradores.reduce((s, c) => s + c.liquido, 0);
  const vencimento = `${proximoMes(lote.competencia)}-05`;
  const encargos = [
    {
      tipo: 'inss' as const,
      valor: Math.round(proventos * 0.2),
      vencimento: `${proximoMes(lote.competencia)}-20`,
      centroCusto: null,
    },
    {
      tipo: 'fgts' as const,
      valor: Math.round(proventos * 0.08),
      vencimento: `${proximoMes(lote.competencia)}-07`,
      centroCusto: null,
    },
  ];
  const recebido = v.ecoDiferente
    ? { ...lote.totais, colaboradores: Math.max(0, lote.totais.colaboradores - 1) }
    : lote.totais;
  return esquemaLoteRetornoFolha.parse({
    leiaute: lote.leiaute,
    loteExportado: lote.lote,
    empresa: lote.empresa,
    competencia: lote.competencia,
    recebido,
    colaboradores,
    encargos,
    vencimentoLiquido: vencimento,
    totais: {
      colaboradores: colaboradores.length,
      proventos,
      descontos,
      liquido,
      encargos: encargos.reduce((s, e) => s + e.valor, 0),
    },
  });
}
