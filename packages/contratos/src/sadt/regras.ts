// Regras puras do SADT compartilhadas pela tela, pela API e pelas receitas do adaptador (que só importa contratos):
// as restrições do exame (regra 6) e a habilitação de quem libera e lauda (regra 8). Os testes ficam em
// @sgh/dominio-sadt (exame/restricoes.spec.ts e laudo/habilitacao.spec.ts), que as reexporta.
import { laudoPrivativoDeMedico } from './vocabulario.js';

// Restrições do pedido e do lançamento (ficha do M26, regra 6; cap-05b §5.10 "Restrições"): alerta ou bloqueio para
// exame incompatível com o sexo ou a idade do paciente (o cadastro de exames do legado guarda o sexo permitido, a faixa
// de idade e o tipo de notificação: 1 apenas notificação, 2 notificação e bloqueio, 3 notificação com exigência de
// justificativa; o legado registra os casos no histórico de notificação por sexo) e para exame repetido dentro do
// intervalo mínimo (parâmetro `sadt.repeticaoMinimaHoras`). Perfil da cópia pc: 8 exames com notificação, 7 com "ambos";
// 1 exame com faixa de idade (0 a 999). Unidades da idade: 1 anos, 2 meses, 3 dias (a confirmar na validação).

export type NivelRestricao = 'alerta' | 'justificativa' | 'bloqueio';

export interface RestricaoCadastro {
  /** Sexo permitido no cadastro (1 masculino, 2 feminino, 3 ambos; nulo = sem restrição). */
  readonly sexo: number | null;
  /** Tipo de notificação do sexo (1, 2 ou 3; nulo = sem notificação). */
  readonly notificacaoSexo: number | null;
  readonly idadeMinima: number | null;
  readonly unidadeIdadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly unidadeIdadeMaxima: number | null;
  readonly notificacaoIdade: number | null;
}

export interface PacienteRestricao {
  readonly sexo: 'M' | 'F' | null;
  /** Idade em dias na data do pedido (nulo sem data de nascimento). */
  readonly idadeDias: number | null;
}

export interface AvisoRestricao {
  readonly tipo: 'sexo' | 'idade' | 'repeticao';
  readonly nivel: NivelRestricao;
  readonly texto: string;
}

function nivelDaNotificacao(n: number | null): NivelRestricao {
  if (n === 2) return 'bloqueio';
  if (n === 3) return 'justificativa';
  return 'alerta';
}

/** A idade em dias de um limite do cadastro (1 anos, 2 meses, 3 dias). */
export function emDias(valor: number, unidade: number | null): number {
  if (unidade === 3) return valor;
  if (unidade === 2) return valor * 30.4375;
  return valor * 365.25;
}

/** Idade em dias entre o nascimento e a data de referência (datas civis AAAA-MM-DD). */
export function idadeEmDias(nascimento: string | null, referencia: string): number | null {
  if (!nascimento) return null;
  const n = Date.parse(`${nascimento.slice(0, 10)}T00:00:00Z`);
  const r = Date.parse(`${referencia.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(n) || !Number.isFinite(r) || n > r) return null;
  return Math.floor((r - n) / 86_400_000);
}

/** As restrições de sexo e idade do exame para o paciente. */
export function restricoesDoExame(c: RestricaoCadastro, p: PacienteRestricao): AvisoRestricao[] {
  const avisos: AvisoRestricao[] = [];
  if (c.sexo === 1 || c.sexo === 2) {
    const permitido = c.sexo === 1 ? 'M' : 'F';
    if (p.sexo !== null && p.sexo !== permitido)
      avisos.push({
        tipo: 'sexo',
        nivel: nivelDaNotificacao(c.notificacaoSexo),
        texto: `Exame indicado só para o sexo ${permitido === 'M' ? 'masculino' : 'feminino'}.`,
      });
  }
  if (p.idadeDias !== null) {
    const min = c.idadeMinima !== null ? emDias(c.idadeMinima, c.unidadeIdadeMinima) : null;
    const max = c.idadeMaxima !== null ? emDias(c.idadeMaxima, c.unidadeIdadeMaxima) : null;
    if ((min !== null && p.idadeDias < min) || (max !== null && p.idadeDias > max))
      avisos.push({
        tipo: 'idade',
        nivel: nivelDaNotificacao(c.notificacaoIdade),
        texto: 'Exame fora da faixa de idade do cadastro de exames.',
      });
  }
  return avisos;
}

/** Repetição: o mesmo exame pedido para o paciente antes do intervalo mínimo (horas). */
export function repeticao(
  anteriores: readonly string[],
  agora: string,
  intervaloMinimoHoras: number,
): AvisoRestricao | null {
  if (intervaloMinimoHoras <= 0) return null;
  const t = Date.parse(agora);
  const recente = anteriores
    .map((a) => Date.parse(a))
    .filter((x) => Number.isFinite(x) && x <= t && t - x < intervaloMinimoHoras * 3_600_000)
    .sort((a, b) => b - a)[0];
  if (recente === undefined) return null;
  const horas = Math.max(0, Math.round((t - recente) / 3_600_000));
  return {
    tipo: 'repeticao',
    nivel: 'alerta',
    texto: `O mesmo exame foi pedido há ${horas} hora(s) (intervalo mínimo de ${intervaloMinimoHoras} horas).`,
  };
}

/** Decide se a gravação segue: bloqueio recusa sempre; alerta e justificativa pedem a confirmação da tela. */
export function decisaoDasRestricoes(
  avisos: readonly AvisoRestricao[],
  confirmado: boolean,
): { readonly segue: boolean; readonly motivo: string | null } {
  const bloqueio = avisos.find((a) => a.nivel === 'bloqueio');
  if (bloqueio) return { segue: false, motivo: bloqueio.texto };
  if (avisos.length > 0 && !confirmado)
    return { segue: false, motivo: 'Confirme os avisos do pedido antes de gravar.' };
  return { segue: true, motivo: null };
}

export interface VinculoProfissional {
  /** Código CBO (6 dígitos) do vínculo. */
  readonly cbo: string;
  readonly conselhoAtivo: boolean;
}

const so = (cbo: string) => cbo.replace(/\D/g, '');

/** Médico pelo CBO (famílias 2251, 2252 e 2253; e o 2231 da tabela antiga). */
export function ehMedico(cbo: string): boolean {
  const c = so(cbo);
  return /^225[123]/.test(c) || /^2231/.test(c);
}

/** Responsável técnico do laboratório: biomédico (2212), farmacêutico-bioquímico (2234) ou patologista clínico (225335). */
export function ehResponsavelLaboratorio(cbo: string): boolean {
  const c = so(cbo);
  return /^2212/.test(c) || /^2234/.test(c) || c === '225335' || c === '225325';
}

/** Pode liberar o resultado do ato pelo vínculo (regra 8), com o motivo em português quando não pode. */
export function podeLiberar(
  ato: number,
  v: VinculoProfissional | null,
): { readonly pode: boolean; readonly motivo: string | null } {
  if (!v) return { pode: false, motivo: 'A sessão não tem vínculo profissional ativo.' };
  if (!v.conselhoAtivo) return { pode: false, motivo: 'O registro no conselho do vínculo não está ativo.' };
  if (laudoPrivativoDeMedico(ato))
    return ehMedico(v.cbo)
      ? { pode: true, motivo: null }
      : { pode: false, motivo: 'O laudo deste exame é privativo de médico (Lei 12.842/2013).' };
  return ehResponsavelLaboratorio(v.cbo)
    ? { pode: true, motivo: null }
    : {
        pode: false,
        motivo:
          'A liberação do resultado de laboratório é do responsável técnico habilitado (biomédico, farmacêutico-bioquímico ou médico patologista clínico).',
      };
}

/** Pode escrever ou assinar o laudo do ato (o de imagem, endoscopia e métodos gráficos só médico). */
export function podeLaudar(
  ato: number,
  v: VinculoProfissional | null,
): { readonly pode: boolean; readonly motivo: string | null } {
  // A mesma regra da liberação: o laudo privativo de médico só pelo médico; o de laboratório pelo responsável técnico.
  return podeLiberar(ato, v);
}
