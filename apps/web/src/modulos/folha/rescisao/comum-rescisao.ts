// Comuns da aba de rescisão (M53.5, etapa F4): o intervalo padrão da fila dos desligados, o pagamento padrão (art. 477
// §6), os avisos que cada modalidade aceita, quando o termo do contrato a prazo é pedido, as recusas que o servidor
// devolve, a conta da multa do FGTS com as parcelas e o que cada rescisão deixa fazer. O servidor confere tudo de novo (a
// regra está em @sgh/dominio-pessoas); aqui é só a previsão que a tela mostra antes de enviar.
import {
  type ApoioRescisao,
  AVISOS_DA_MODALIDADE,
  type DesligadoParaRescisao,
  type AvisoPrevio,
  type ModalidadeRescisao,
  RECUSAS_RESCISAO,
  type RecusaRescisao,
  type RescisaoDoVinculo,
} from '@sgh/contratos';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { reais } from '../comum-folha.js';
import { somarDias } from '../ferias/comum-ferias.js';

/** A fila padrão: do primeiro dia do mês anterior até hoje (os desligamentos que ainda pedem o termo). */
export function intervaloDesligados(hoje: string): { de: string; ate: string } {
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  const [pa, pm] = m === 1 ? [a - 1, 12] : [a, m - 1];
  return { de: `${pa}-${String(pm).padStart(2, '0')}-01`, ate: hoje };
}

/** O pagamento das verbas rescisórias até 10 dias depois do desligamento (CLT art. 477 §6). */
export const pagamentoPadrao = (desligamento: string) => somarDias(desligamento, 10);

/** Os avisos que a modalidade aceita (o do apoio, se veio; senão, o do contrato); o primeiro é o padrão. */
export function avisosDa(
  modalidade: ModalidadeRescisao | null,
  apoio: ApoioRescisao | null,
): readonly AvisoPrevio[] {
  if (!modalidade) return [];
  return (
    apoio?.modalidades.find((m) => m.modalidade === modalidade)?.avisos ?? AVISOS_DA_MODALIDADE[modalidade]
  );
}

/** O termo do contrato a prazo: obrigatório na antecipação pelo empregador (art. 479); aceito na do empregado. */
export const pedeTermo = (m: ModalidadeRescisao | null) =>
  m === 'antecipada-empregador' || m === 'antecipada-empregado';
export const termoObrigatorio = (m: ModalidadeRescisao | null) => m === 'antecipada-empregador';

/** As recusas do cálculo que a resposta traz (todas de uma vez, quando o servidor as lista). */
export function recusasDaRescisao(e: unknown): RecusaRescisao[] {
  if (!(e instanceof ErroApi)) return [];
  const p = e.problema as { codigo?: unknown; recusas?: unknown } | null;
  const validas = (xs: unknown[]) =>
    xs.filter((x): x is RecusaRescisao => (RECUSAS_RESCISAO as readonly unknown[]).includes(x));
  if (Array.isArray(p?.recusas)) {
    const r = validas(p.recusas);
    if (r.length) return r;
  }
  return typeof p?.codigo === 'string' ? validas([p.codigo]) : [];
}

/**
 * "(R$ 10.000,00 + R$ 1.977,33) × 40% = R$ 4.790,93": a conta da multa com as parcelas impressas (o saldo para fins
 * rescisórios e o FGTS desta rescisão, D-MULTA-535); sem o FGTS da rescisão, só o saldo. null sem multa.
 */
export function contaMulta(
  saldo: number,
  fgtsRescisao: number,
  percentualCentesimos: number,
  multa: number,
): string | null {
  if (percentualCentesimos <= 0) return null;
  const pct = `${String(percentualCentesimos / 100).replace('.', ',')}%`;
  const base = fgtsRescisao > 0 ? `(${reais(saldo)} + ${reais(fgtsRescisao)})` : reais(saldo);
  return `${base} × ${pct} = ${reais(multa)}`;
}

/** O que a rescisão deixa a sessão fazer (o servidor confere de novo). */
export function acoesDaRescisao(r: RescisaoDoVinculo, a: ApoioRescisao) {
  const grava = a.gravacao.ligada && a.acoes.calcular;
  return {
    cancelar: grava && r.situacao === 'calculada',
    termo: a.acoes.verSalario && r.situacao !== 'cancelada',
  };
}

/** A busca do colaborador na aba: sem diferença de caixa, por trecho da matrícula ou pelo número exato do vínculo. */
export function casaColaborador(busca: string, vinculo: number, matricula: string | null): boolean {
  const b = busca.trim().toLowerCase();
  if (!b) return true;
  return String(vinculo) === b || (matricula ?? '').toLowerCase().includes(b);
}

/** Os desligados da fila que casam com a busca (busca vazia: todos). */
export const filtrarDesligados = (itens: readonly DesligadoParaRescisao[], busca: string) =>
  itens.filter((d) => casaColaborador(busca, d.vinculo, d.matricula));

/**
 * O vínculo que a busca aponta, para o filtro `vinculo` do histórico no servidor: o único desligado da fila que casa; sem
 * nenhum na fila e só com algarismos, o próprio número do vínculo (a rescisão pode ser de um desligamento fora do
 * intervalo da fila); vários ou nenhum: undefined (o histórico do intervalo é filtrado na tela pela mesma busca).
 */
export function vinculoDaBusca(itens: readonly DesligadoParaRescisao[], busca: string): number | undefined {
  const b = busca.trim();
  if (!b) return undefined;
  const xs = new Set(filtrarDesligados(itens, b).map((d) => d.vinculo));
  if (xs.size === 1) return [...xs][0];
  if (xs.size === 0 && /^\d{1,16}$/.test(b) && Number.isSafeInteger(Number(b))) return Number(b);
  return undefined;
}
