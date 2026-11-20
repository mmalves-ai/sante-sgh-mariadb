// SOFA (Vincent et al., Intensive Care Med 1996; ficha do M45, regra 5): seis órgãos de 0 a 4 pela configuração do
// estabelecimento: respiratório (PaO2/FiO2), coagulação (plaquetas ×10³/µL), hepático (bilirrubina mg/dL),
// cardiovascular (o maior entre a pressão média e as drogas vasoativas em µg/kg/min), neurológico (Glasgow) e renal (o
// maior entre a creatinina mg/dL e o débito urinário mL/dia). Órgão sem dado conta 0, com o aviso. Puro.
import type { CalculoIndiceUti, ConfiguracaoIndicesUti, PontoVariavel } from '@sgh/contratos';
import type { RecusaIndice } from './apache2.js';
import { fracao } from './apache2.js';
import { glasgowDoIndice, pontosDaVariavel, variaveisDoIndice } from './configuracao.js';

export interface EntradaSofa {
  /** Pelas siglas: PAO2 e FIO2 (ou RELACAO_PF), PLAQUETAS, BILIRRUBINA, PAM, DOPAMINA, DOBUTAMINA, EPI_NORA, CREATININA, DEBURINARIO. */
  readonly variaveis: Readonly<Record<string, number | null>>;
  readonly glasgow: { readonly ocular: number; readonly verbal: number; readonly motora: number };
}

/** As drogas vasoativas: dose 0 ou vazia = não usa; acima da última faixa, os pontos da última. */
const DROGAS = new Set(['DOPAMINA', 'DOBUTAMINA', 'EPI_NORA']);
const nulo = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || !Number.isFinite(v);

/** O neurológico pela publicação (a configuração não traz as faixas do Glasgow do SOFA). */
export function pontosNeurologicoSofa(gcs: number): number {
  if (gcs >= 15) return 0;
  if (gcs >= 13) return 1;
  if (gcs >= 10) return 2;
  if (gcs >= 6) return 3;
  return 4;
}

export function calcularSofa(
  c: ConfiguracaoIndicesUti,
  e: EntradaSofa,
): ({ ok: true } & CalculoIndiceUti) | RecusaIndice {
  const vs = variaveisDoIndice(c, 'sofa');
  const v = e.variaveis;
  const avisos: string[] = [];
  const parcelas: PontoVariavel[] = [];
  const orgao = (
    grupo: string,
    itens: { sigla: string; valor: number | null | undefined; nome?: string }[],
  ) => {
    const pontos: PontoVariavel[] = [];
    for (const it of itens) {
      const d = vs.get(it.sigla);
      if (!d || nulo(it.valor) || (DROGAS.has(it.sigla) && it.valor <= 0)) continue;
      pontos.push({
        variavel: d.id,
        sigla: it.sigla,
        nome: it.nome ?? d.nome,
        valor: it.valor,
        pontos: pontosDaVariavel(d, it.valor, { saturarAcima: DROGAS.has(it.sigla) }).pontos,
        grupo,
      });
    }
    if (pontos.length === 0) {
      avisos.push(`${grupo}: sem dado, conta 0.`);
      parcelas.push({ variavel: null, sigla: grupo, nome: grupo, valor: null, pontos: 0, grupo });
      return;
    }
    // O órgão vale o maior dos itens dele.
    parcelas.push(pontos.reduce((a, b) => (b.pontos > a.pontos ? b : a)));
  };
  const relacao = !nulo(v['RELACAO_PF'])
    ? v['RELACAO_PF']
    : !nulo(v['PAO2']) && !nulo(v['FIO2']) && v['FIO2']! > 0
      ? Math.round(v['PAO2']! / fracao(v['FIO2']!))
      : null;
  orgao('Respiratório', [{ sigla: 'PAO2', valor: relacao, nome: 'PaO2/FiO2' }]);
  orgao('Coagulação', [{ sigla: 'PLAQUETAS', valor: v['PLAQUETAS'] }]);
  orgao('Hepático', [{ sigla: 'BILIRRUBINA', valor: v['BILIRRUBINA'] }]);
  const pam = !nulo(v['PAM'])
    ? v['PAM']
    : !nulo(v['PAS']) && !nulo(v['PAD'])
      ? Math.round((v['PAS']! + 2 * v['PAD']!) / 3)
      : null;
  orgao('Cardiovascular', [
    { sigla: 'PAM', valor: pam },
    { sigla: 'DOPAMINA', valor: v['DOPAMINA'] },
    { sigla: 'DOBUTAMINA', valor: v['DOBUTAMINA'] },
    { sigla: 'EPI_NORA', valor: v['EPI_NORA'] },
  ]);
  const gl = glasgowDoIndice(c, 'sofa');
  const escolhidos = [e.glasgow.ocular, e.glasgow.verbal, e.glasgow.motora];
  const itens = gl.map((g) => g.itens.find((i) => escolhidos.includes(i.id)) ?? null);
  if (gl.length !== 3 || itens.some((i) => i === null))
    return {
      ok: false,
      codigo: 'glasgow-invalido',
      mensagem: 'Escolha os três itens de Glasgow da configuração do SOFA.',
    };
  const gcs = itens.reduce((s, i) => s + i!.pontuacao, 0);
  parcelas.push({
    variavel: null,
    sigla: 'GLASGOW',
    nome: `Glasgow ${gcs}`,
    valor: gcs,
    pontos: pontosNeurologicoSofa(gcs),
    grupo: 'Neurológico',
  });
  orgao('Renal', [
    { sigla: 'CREATININA', valor: v['CREATININA'] },
    { sigla: 'DEBURINARIO', valor: v['DEBURINARIO'] },
  ]);
  const pontuacao = parcelas.reduce((s, p) => s + p.pontos, 0);
  return { ok: true, indice: 'sofa', pontuacao, parcelas, mortalidade: null, equacao: null, avisos };
}
