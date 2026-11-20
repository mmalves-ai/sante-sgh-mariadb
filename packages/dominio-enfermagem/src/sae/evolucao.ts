// A evolução de enfermagem (M45, etapa 4; regra 7, quinta etapa da COFEN 736/2024): reavalia cada resultado esperado
// do processo vigente frente à meta. A situação sai da conta, nunca é escolhida: "aumentar para" (o ponto novo chegou
// à meta: atingida; subiu: melhorou; igual: mantida; caiu: piorou), "diminuir para" (o inverso) e "manter em" (no ponto
// da meta: atingida; mais perto: melhorou; mais longe: piorou).
import type {
  DominiosSae,
  EvoluirSaeEntrada,
  ProcessoSaeLido,
  ResultadoSaeLido,
  SentidoMetaSae,
  SituacaoEvolucaoSae,
} from '@sgh/contratos';
import type { RecusaSae } from './processo.js';

export function situacaoDaEvolucao(
  sentido: SentidoMetaSae,
  anterior: number,
  meta: number,
  novo: number,
): SituacaoEvolucaoSae {
  if (sentido === 'aumentar') {
    if (novo >= meta) return 'atingida';
    return novo > anterior ? 'melhorou' : novo === anterior ? 'mantida' : 'piorou';
  }
  if (sentido === 'diminuir') {
    if (novo <= meta) return 'atingida';
    return novo < anterior ? 'melhorou' : novo === anterior ? 'mantida' : 'piorou';
  }
  if (novo === meta) return 'atingida';
  const antes = Math.abs(anterior - meta);
  const agora = Math.abs(novo - meta);
  return agora < antes ? 'melhorou' : agora === antes ? 'mantida' : 'piorou';
}

/** O último ponto do resultado (a última evolução, ou o de quando foi planejado). */
export function pontoAtualDoResultado(r: ResultadoSaeLido): number {
  const ultima = [...r.evolucoes].sort((a, b) => a.em.localeCompare(b.em) || a.id - b.id).at(-1);
  return ultima ? ultima.escala : r.escalaAtual;
}

export interface EvolucaoPlanejada {
  readonly ok: true;
  readonly nota: string;
  readonly resultados: readonly {
    readonly resultado: number;
    readonly descricao: string;
    readonly escala: number;
    readonly situacao: SituacaoEvolucaoSae;
  }[];
}

/** Confere a evolução contra o processo vigente e calcula a situação de cada resultado. */
export function conferirEvolucao(
  e: EvoluirSaeEntrada,
  processo: ProcessoSaeLido | null,
  dominios: DominiosSae,
): EvolucaoPlanejada | RecusaSae {
  if (!processo)
    return {
      ok: false,
      codigo: 'sem-processo',
      mensagem: 'O paciente ainda não tem processo de enfermagem.',
    };
  if (e.versaoVista !== processo.versao)
    return {
      ok: false,
      codigo: 'sae-mudou',
      mensagem: 'O processo de enfermagem mudou depois da leitura: confira e registre a evolução de novo.',
    };
  const resultados = new Map(processo.diagnosticos.flatMap((d) => d.resultados).map((r) => [r.id, r]));
  const vistos = new Set<number>();
  const saida: EvolucaoPlanejada['resultados'][number][] = [];
  for (const [i, x] of e.resultados.entries()) {
    const campo = `resultados.${i}`;
    const r = resultados.get(x.resultado);
    if (!r)
      return {
        ok: false,
        codigo: 'resultado-de-outro-processo',
        mensagem: 'O resultado não é do processo vigente.',
        campo,
      };
    if (vistos.has(r.id))
      return {
        ok: false,
        codigo: 'resultado-repetido',
        mensagem: 'O mesmo resultado entrou duas vezes.',
        campo,
      };
    vistos.add(r.id);
    const p = dominios.escala.find((y) => y.codigo === x.escala);
    const alvo = dominios.escala.find((y) => y.codigo === r.escalaMeta);
    const antes = dominios.escala.find((y) => y.codigo === pontoAtualDoResultado(r));
    const meta = dominios.metas.find((y) => y.codigo === r.meta);
    if (!p || p.valor === null)
      return {
        ok: false,
        codigo: 'valor-nunca-visto',
        mensagem: 'Informe um ponto da escala de 1 a 5.',
        campo,
      };
    if (!alvo || alvo.valor === null || !antes || antes.valor === null || !meta || meta.sentido === null)
      return {
        ok: false,
        codigo: 'valor-nunca-visto',
        mensagem: 'A meta do resultado não está mais no domínio do estabelecimento.',
        campo,
      };
    saida.push({
      resultado: r.id,
      descricao: r.descricao,
      escala: p.codigo,
      situacao: situacaoDaEvolucao(meta.sentido, antes.valor, alvo.valor, p.valor),
    });
  }
  return { ok: true, nota: e.nota, resultados: saida };
}
