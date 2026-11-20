// DIOPS, o documento de informações periódicas das operadoras (M56, etapa 7, F6): os quadros econômico-financeiros do
// trimestre que o módulo sabe calcular, com as parcelas de cada soma, e o balancete do fim do trimestre informado pela
// contabilidade da operadora (o plano de contas padrão da ANS é da contabilidade: D-DIOPS-567):
//   - contraprestações emitidas (as cobranças das competências do trimestre, não canceladas), por tipo de cobrança;
//   - contraprestações recebidas no trimestre (pela data do pagamento), por tipo;
//   - contraprestações vencidas e não pagas no último dia do trimestre, por faixa de atraso;
//   - eventos avisados (as contas médicas recebidas no trimestre): apresentado, glosado e líquido;
//   - eventos pagos aos prestadores no trimestre, por mês;
//   - beneficiários ativos no último dia do trimestre, por tipo de contratação;
//   - o balancete: o ativo tem de ser igual ao passivo mais o patrimônio líquido.
import {
  type BalanceteDiops,
  type ParcelaAns,
  type ProblemaAns,
  type QuadroAns,
  TIPOS_COBRANCA_OPERADORA,
  TIPOS_CONTRATACAO,
} from '@sgh/contratos';
import {
  emCentavos,
  documentoXml,
  el,
  mesesDoPeriodo,
  type Periodo,
  problema,
  deCentavos,
  valorNoArquivo,
} from './comum.js';
import { type CabecalhoAns, cabecalhoXml } from './sib.js';

export interface CobrancaDiops {
  readonly tipo: number;
  readonly competencia: string;
  readonly valor: number;
  readonly situacao: 'aberta' | 'paga' | 'cancelada' | 'renegociada';
  readonly vencimento: string;
  readonly pagoEm: string | null;
  readonly valorPago: number | null;
}

export interface ContaDiops {
  readonly recebidaEm: string;
  readonly apresentado: number;
  readonly glosado: number;
  readonly situacao: 'recebida' | 'analisada' | 'paga' | 'devolvida';
}

export interface PagamentoPrestadorDiops {
  readonly pagoEm: string;
  readonly valor: number;
}

export interface EntradaDiops {
  readonly periodo: Periodo;
  readonly cobrancas: readonly CobrancaDiops[];
  readonly contas: readonly ContaDiops[];
  readonly pagamentos: readonly PagamentoPrestadorDiops[];
  /** Beneficiários ativos no último dia do trimestre, por tipo de contratação (1 a 3). */
  readonly beneficiarios: Readonly<Record<number, number>>;
  readonly balancete: BalanceteDiops | null;
}

const rotuloTipo = (t: number) =>
  TIPOS_COBRANCA_OPERADORA[t as keyof typeof TIPOS_COBRANCA_OPERADORA] ?? `Tipo ${t}`;

function quadro(titulo: string, porChave: Map<string, { c: number; q: number }>): QuadroAns {
  const parcelas: ParcelaAns[] = [...porChave.entries()].map(([rotulo, x]) => ({
    rotulo,
    valor: deCentavos(x.c),
    quantidade: x.q,
  }));
  const c = [...porChave.values()].reduce((a, x) => a + x.c, 0);
  const q = [...porChave.values()].reduce((a, x) => a + x.q, 0);
  return { titulo, parcelas, total: { rotulo: 'Total', valor: deCentavos(c), quantidade: q } };
}

const somar = (m: Map<string, { c: number; q: number }>, k: string, c: number) => {
  const x = m.get(k) ?? { c: 0, q: 0 };
  m.set(k, { c: x.c + c, q: x.q + 1 });
};

/** Faixa de atraso no último dia do trimestre. */
export function faixaDeAtraso(vencimento: string, fim: string): string {
  const dias = Math.round(
    (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${vencimento}T00:00:00Z`)) / 86_400_000,
  );
  if (dias <= 30) return 'Até 30 dias';
  if (dias <= 60) return 'De 31 a 60 dias';
  if (dias <= 90) return 'De 61 a 90 dias';
  return 'Mais de 90 dias';
}

export function problemasDiops(balancete: BalanceteDiops | null | undefined): ProblemaAns[] {
  if (!balancete) return [problema('sem-balancete')];
  const diferenca =
    emCentavos(balancete.ativo) - emCentavos(balancete.passivo) - emCentavos(balancete.patrimonioLiquido);
  return diferenca === 0 ? [] : [problema('balancete-desequilibrado')];
}

export function quadrosDiops(e: EntradaDiops): QuadroAns[] {
  const { inicio, fim } = e.periodo;
  const meses = new Set(mesesDoPeriodo(e.periodo).map((m) => m.mes));
  const emitidas = new Map<string, { c: number; q: number }>();
  const recebidas = new Map<string, { c: number; q: number }>();
  const vencidas = new Map<string, { c: number; q: number }>();
  for (const c of e.cobrancas) {
    if (meses.has(c.competencia) && c.situacao !== 'cancelada')
      somar(emitidas, rotuloTipo(c.tipo), emCentavos(c.valor));
    if (c.pagoEm && c.pagoEm >= inicio && c.pagoEm <= fim)
      somar(recebidas, rotuloTipo(c.tipo), emCentavos(c.valorPago ?? c.valor));
    const abertaNoFim =
      c.situacao === 'aberta' || (c.situacao === 'paga' && c.pagoEm !== null && c.pagoEm > fim);
    if (abertaNoFim && c.vencimento < fim)
      somar(vencidas, faixaDeAtraso(c.vencimento, fim), emCentavos(c.valor));
  }
  const avisados = e.contas.filter(
    (c) => c.recebidaEm >= inicio && c.recebidaEm <= fim && c.situacao !== 'devolvida',
  );
  const apresentado = avisados.reduce((a, c) => a + emCentavos(c.apresentado), 0);
  const glosado = avisados.reduce((a, c) => a + emCentavos(c.glosado), 0);
  const pagos = new Map<string, { c: number; q: number }>();
  for (const m of mesesDoPeriodo(e.periodo)) pagos.set(m.mes, { c: 0, q: 0 });
  for (const p of e.pagamentos)
    if (p.pagoEm >= inicio && p.pagoEm <= fim) somar(pagos, p.pagoEm.slice(0, 7), emCentavos(p.valor));
  const benef = new Map<string, { c: number; q: number }>();
  for (const t of [1, 2, 3] as const) benef.set(TIPOS_CONTRATACAO[t], { c: 0, q: e.beneficiarios[t] ?? 0 });
  const quadros: QuadroAns[] = [
    quadro('Contraprestações emitidas', emitidas),
    quadro('Contraprestações recebidas no trimestre', recebidas),
    quadro('Contraprestações vencidas a receber no fim do trimestre', vencidas),
    {
      titulo: 'Eventos avisados no trimestre (contas médicas recebidas)',
      parcelas: [
        { rotulo: 'Valor apresentado', valor: deCentavos(apresentado), quantidade: avisados.length },
        { rotulo: 'Glosa (menos)', valor: deCentavos(-glosado) },
      ],
      total: {
        rotulo: 'Eventos líquidos',
        valor: deCentavos(apresentado - glosado),
        quantidade: avisados.length,
      },
    },
    quadro('Eventos pagos aos prestadores no trimestre', pagos),
    {
      titulo: 'Beneficiários no fim do trimestre',
      parcelas: [...benef.entries()].map(([rotulo, x]) => ({ rotulo, valor: 0, quantidade: x.q })),
      total: { rotulo: 'Total', valor: 0, quantidade: [...benef.values()].reduce((a, x) => a + x.q, 0) },
    },
  ];
  if (e.balancete)
    quadros.push({
      titulo: `Balancete do fim do trimestre (informado por ${e.balancete.responsavel})`,
      parcelas: [
        { rotulo: 'Passivo', valor: e.balancete.passivo },
        { rotulo: 'Patrimônio líquido', valor: e.balancete.patrimonioLiquido },
      ],
      total: { rotulo: 'Ativo', valor: e.balancete.ativo },
    });
  return quadros;
}

export function arquivoDiops(cab: CabecalhoAns, quadros: readonly QuadroAns[], b: BalanceteDiops): string {
  return documentoXml(
    el('mensagemDIOPS', [
      cabecalhoXml(cab, quadros.length),
      el('balancete', [
        el('ativo', valorNoArquivo(b.ativo)),
        el('passivo', valorNoArquivo(b.passivo)),
        el('patrimonioLiquido', valorNoArquivo(b.patrimonioLiquido)),
        el('provisoesTecnicas', valorNoArquivo(b.provisoesTecnicas)),
        el('responsavel', b.responsavel),
      ]),
      el(
        'quadros',
        quadros.map((q) =>
          el(
            'quadro',
            [
              ...q.parcelas.map((p) =>
                el('parcela', valorNoArquivo(p.valor), {
                  rotulo: p.rotulo,
                  ...(p.quantidade === undefined ? {} : { quantidade: p.quantidade }),
                }),
              ),
              el('total', valorNoArquivo(q.total.valor), {
                rotulo: q.total.rotulo,
                ...(q.total.quantidade === undefined ? {} : { quantidade: q.total.quantidade }),
              }),
            ],
            { titulo: q.titulo },
          ),
        ),
      ),
    ]),
  );
}
