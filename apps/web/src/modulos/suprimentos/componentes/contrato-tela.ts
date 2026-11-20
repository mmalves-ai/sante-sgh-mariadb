// Apoios puros da tela dos contratos com fornecedores (M55, etapa 3): a leitura do dinheiro digitado, os rótulos dos
// vocabulários, os eventos que o perfil registra (pela permissão de agir de cada rota) e a exceção disponível para o
// vínculo fora da vigência. Sem estado; testados em contrato-telas.spec.ts.
import {
  DIAS_VALIDADE_EXCECAO,
  type EventoContrato,
  FAIXAS_VIGENCIA,
  GARANTIAS_CONTRATO,
  type GravacaoAgenda,
  INDICES_REAJUSTE,
  RESULTADOS_AVALIACAO,
  SITUACOES_CONTRATO_FORNECEDOR,
  TIPOS_CONTRATO,
  TIPOS_EVENTO_CONTRATO,
  TIPOS_VINCULO_CONTRATO,
  type TipoEventoContrato,
} from '@sgh/contratos';

/** O valor digitado com vírgula decimal e ponto de milhar ("1.234,56") ou só ponto decimal ("1234.56"); nulo se vazio. */
export function lerDinheiro(s: string): number | null {
  const x = s.trim().replace(/^R\$\s*/, '');
  if (!x) return null;
  const normal = x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

type Vocab = readonly { readonly codigo: string; readonly rotulo: string }[];
const rotuloDe = (v: Vocab) => (codigo: string | null | undefined) =>
  (codigo && v.find((x) => x.codigo === codigo)?.rotulo) || '—';

export const rotuloTipoContrato = rotuloDe(TIPOS_CONTRATO);
export const rotuloIndice = rotuloDe(INDICES_REAJUSTE);
export const rotuloGarantia = rotuloDe(GARANTIAS_CONTRATO);
export const rotuloFaixa = rotuloDe(FAIXAS_VIGENCIA);
export const rotuloSituacao = rotuloDe(SITUACOES_CONTRATO_FORNECEDOR);
export const rotuloEvento = rotuloDe(TIPOS_EVENTO_CONTRATO);
export const rotuloResultado = rotuloDe(RESULTADOS_AVALIACAO);
export const rotuloVinculo = rotuloDe(TIPOS_VINCULO_CONTRATO);

/** A operação de gravação (em `gravacao.operacoes`) que autoriza cada evento. */
export const OPERACAO_DO_EVENTO: Readonly<Record<TipoEventoContrato, 'editar' | 'aditar' | 'avaliar'>> = {
  aditivo: 'aditar',
  reajuste: 'aditar',
  renovacao: 'aditar',
  excecao: 'aditar',
  avaliacao: 'avaliar',
  ocorrencia: 'editar',
  anexo: 'editar',
  encerramento: 'editar',
  rescisao: 'editar',
};

/** Pode gravar a operação agora (ligada no estabelecimento e com a permissão)? */
export const podeOperacao = (g: GravacaoAgenda | null | undefined, op: 'editar' | 'aditar' | 'avaliar') =>
  !!g && g.ligada && g.operacoes[op]?.pode === true;

/** Os eventos que o perfil registra na aba "Registrar evento" (a avaliação tem aba própria). */
export function eventosRegistraveis(g: GravacaoAgenda | null | undefined): TipoEventoContrato[] {
  return TIPOS_EVENTO_CONTRATO.map((t) => t.codigo).filter(
    (t) => t !== 'avaliacao' && podeOperacao(g, OPERACAO_DO_EVENTO[t]),
  );
}

/** As exceções aprovadas ainda não usadas e dentro dos 30 dias (regra 7), da mais nova para a mais antiga. */
export function excecoesDisponiveis(eventos: readonly EventoContrato[], hoje: string): EventoContrato[] {
  const limite = new Date(`${hoje}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - DIAS_VALIDADE_EXCECAO);
  const corte = limite.toISOString().slice(0, 10);
  return eventos
    .filter((e) => e.tipo === 'excecao' && !e.usado && e.criadoEm.slice(0, 10) >= corte)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

/** A faixa pede a exceção para ligar pedido ou título (fora da vigência). */
export const foraDaVigencia = (faixa: string) => faixa === 'vencido' || faixa === 'a-iniciar';
