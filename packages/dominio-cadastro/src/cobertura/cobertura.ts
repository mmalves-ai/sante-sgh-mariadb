// Cobertura permanente do paciente (F3.1, 02-CAD linha 9): as carteiras do paciente por fonte pagadora e plano, com
// validade, vigência, titular e parentesco, e a carteira principal. A carteira nunca é apagada: o fim é o encerramento
// (vigência fim e situação "cancelada"). A situação que a tela mostra (vigente, a vencer, vencida, encerrada) sai das
// datas no dia; o atendimento propõe a cobertura vigente do paciente (a principal primeiro), nunca uma vencida.
// Vocabulário neutro: ids, booleanos, datas AAAA-MM-DD e texto.

/** A fonte pagadora como o hospital a cadastrou (lida na gravação). */
export interface FontePagadoraRegra {
  readonly id: number;
  readonly ativa: boolean;
  /** Particular não tem carteira; as demais fontes exigem o número. */
  readonly particular: boolean;
  readonly exigeValidadeCarteira: boolean;
}

export interface PlanoRegra {
  readonly id: number;
  readonly fontePagadora: number;
  readonly ativo: boolean;
}

export interface CoberturaProposta {
  readonly paciente: number;
  /** null quando o id informado não existe. */
  readonly fontePagadora: FontePagadoraRegra | null;
  /** null quando não informado; undefined não é aceito na gravação (a porta resolve). */
  readonly plano: PlanoRegra | null;
  readonly planoInformado: boolean;
  readonly numeroCarteira?: string | null;
  readonly validade?: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim?: string | null;
  readonly titular: boolean;
  readonly titularPaciente?: number | null;
  readonly titularNome?: string | null;
  readonly parentesco?: number | null;
}

export interface RecusaCobertura {
  readonly codigo: string;
  readonly campo: string;
  readonly mensagem: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const preenchido = (t: string | null | undefined): boolean => (t ?? '').trim().length > 0;

/** Confere a carteira proposta (inclusão ou alteração); devolve as recusas (vazia quando pode gravar). */
export function conferirCobertura(c: CoberturaProposta): RecusaCobertura[] {
  const r: RecusaCobertura[] = [];
  const f = c.fontePagadora;
  if (!f || !f.ativa)
    r.push({
      codigo: 'fonte-pagadora-invalida',
      campo: 'fontePagadora',
      mensagem: 'Escolha uma fonte pagadora ativa.',
    });
  if (c.planoInformado && (!c.plano || !c.plano.ativo))
    r.push({ codigo: 'plano-invalido', campo: 'plano', mensagem: 'Escolha um plano ativo.' });
  else if (f && c.plano && c.plano.fontePagadora !== f.id)
    r.push({
      codigo: 'plano-de-outra-fonte',
      campo: 'plano',
      mensagem: 'O plano escolhido é de outra fonte pagadora.',
    });
  if (f && !f.particular && !preenchido(c.numeroCarteira))
    r.push({
      codigo: 'carteira-obrigatoria',
      campo: 'numeroCarteira',
      mensagem: 'Informe o número da carteira.',
    });
  if (f && f.exigeValidadeCarteira && !c.validade)
    r.push({
      codigo: 'validade-obrigatoria',
      campo: 'validade',
      mensagem: 'Esta fonte pagadora exige a validade da carteira.',
    });
  for (const [campo, v] of [
    ['validade', c.validade],
    ['vigenciaInicio', c.vigenciaInicio],
    ['vigenciaFim', c.vigenciaFim],
  ] as const)
    if (v && !DATA.test(v)) r.push({ codigo: 'data-invalida', campo, mensagem: 'Data inválida.' });
  if (c.vigenciaFim && c.vigenciaFim < c.vigenciaInicio)
    r.push({
      codigo: 'vigencia-invertida',
      campo: 'vigenciaFim',
      mensagem: 'O fim da vigência não pode ser antes do início.',
    });
  if (!c.titular) {
    if (!c.titularPaciente && !preenchido(c.titularNome))
      r.push({
        codigo: 'titular-obrigatorio',
        campo: 'titularNome',
        mensagem: 'Dependente: informe o titular da carteira.',
      });
    if (!c.parentesco)
      r.push({
        codigo: 'parentesco-obrigatorio',
        campo: 'parentesco',
        mensagem: 'Dependente: informe o parentesco com o titular.',
      });
    if (c.titularPaciente && c.titularPaciente === c.paciente)
      r.push({
        codigo: 'titular-e-o-proprio',
        campo: 'titularPaciente',
        mensagem: 'O dependente não pode ser o próprio titular.',
      });
  }
  return r;
}

export type SituacaoCarteira = 'vigente' | 'a_vencer' | 'vencida' | 'encerrada';

export interface CarteiraNoDia {
  readonly situacao: string;
  readonly validade: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** Dias antes da validade em que a tela avisa "a vencer". */
export const DIAS_AVISO_VALIDADE = 30;

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** A situação da carteira no dia `hoje` (AAAA-MM-DD). Encerrada, suspensa ou fora da vigência não é vigente. */
export function situacaoDaCarteira(c: CarteiraNoDia, hoje: string): SituacaoCarteira {
  if (c.situacao === 'cancelada' || c.situacao === 'suspensa') return 'encerrada';
  if (c.vigenciaFim && c.vigenciaFim < hoje) return 'encerrada';
  if (c.vigenciaInicio > hoje) return 'encerrada';
  if (c.situacao === 'vencida' || (c.validade && c.validade < hoje)) return 'vencida';
  if (c.validade && c.validade <= somarDias(hoje, DIAS_AVISO_VALIDADE)) return 'a_vencer';
  return 'vigente';
}

/**
 * A cobertura que o atendimento propõe: a principal entre as utilizáveis no dia (vigente ou a vencer); sem principal
 * utilizável, a utilizável de início de vigência mais recente. Vencida e encerrada nunca são propostas.
 */
export function coberturaProposta<
  T extends CarteiraNoDia & { readonly id: number; readonly principal: boolean },
>(lista: readonly T[], hoje: string): T | null {
  const uteis = lista.filter((c) => {
    const s = situacaoDaCarteira(c, hoje);
    return s === 'vigente' || s === 'a_vencer';
  });
  if (uteis.length === 0) return null;
  const ordenadas = [...uteis].sort(
    (a, b) =>
      Number(b.principal) - Number(a.principal) ||
      b.vigenciaInicio.localeCompare(a.vigenciaInicio) ||
      b.id - a.id,
  );
  return ordenadas[0] ?? null;
}
