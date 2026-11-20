// Comuns das telas da contabilidade, etapa 3 (M54-F3): o saldo com "D" ou "C" (o servidor manda o sinal devedor), o
// intervalo padrão do exercício, as competências e os exercícios para os seletores, o rascunho do SPED (signatários,
// substituta, ECF) com os problemas conferidos antes do servidor e o corpo do pedido, e o texto do arquivo em
// ISO-8859-1 (o programa oficial lê nessa codificação). Puro: testado sem montar tela.
import type { FormaTributacaoEcf, QualificacaoSignatario, TipoArquivoSped } from '@sgh/contratos';
import { reais } from './comum-contabil.js';

/** Saldo com o sinal devedor (D − C) → "R$ 1.000,00 D", "R$ 300,00 C" ou "R$ 0,00". */
export function saldoDC(centavos: number): string {
  if (centavos === 0) return reais(0);
  return `${reais(Math.abs(centavos))} ${centavos > 0 ? 'D' : 'C'}`;
}

/** O intervalo padrão: de janeiro até a competência de hoje. */
export function intervaloDoAno(hoje: string): { de: string; ate: string } {
  return { de: `${hoje.slice(0, 4)}-01`, ate: hoje.slice(0, 7) };
}

/** Os 12 meses de um exercício, de janeiro a dezembro. */
export function competenciasDoExercicio(exercicio: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${exercicio}-${String(i + 1).padStart(2, '0')}`);
}

/** Exercícios para o seletor: o de hoje e os anteriores (o mais recente primeiro). */
export function exerciciosAte(hoje: string, n = 6): number[] {
  const a = Number(hoje.slice(0, 4));
  return Array.from({ length: n }, (_, i) => a - i);
}

/** Meses entre duas competências, inclusive (de 2025-01 a 2025-12 = 12). */
export function mesesEntre(de: string, ate: string): number {
  const [a1, m1] = de.split('-').map(Number) as [number, number];
  const [a2, m2] = ate.split('-').map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

/** Problema do intervalo das demonstrações antes de ir ao servidor (a chave do texto, ou nulo). */
export function problemaDoIntervalo(
  de: string | null,
  ate: string | null,
  mesmoExercicio = false,
): string | null {
  if (!de || !ate) return 'intervaloIncompleto';
  if (de > ate) return 'inicioDepoisDoFim';
  if (mesesEntre(de.slice(0, 7), ate.slice(0, 7)) > 12) return 'maisDe12Meses';
  if (mesmoExercicio && de.slice(0, 4) !== ate.slice(0, 4)) return 'exerciciosDiferentes';
  return null;
}

// ── SPED ─────────────────────────────────────────────────────────────────────────────────────────

export interface SignatarioRascunho {
  nome: string;
  cpf: string;
  qualificacao: QualificacaoSignatario | null;
  crc: string;
  email: string;
  telefone: string;
}

export interface RascunhoSped {
  tipo: TipoArquivoSped;
  exercicio: number;
  numeroOrdem: string;
  substituta: boolean;
  hashAnterior: string;
  formaTributacao: FormaTributacaoEcf | null;
  tipoEntidadeEcf: string;
  signatarios: SignatarioRascunho[];
}

export interface CorpoGerarSped {
  readonly empresa: number;
  readonly tipo: TipoArquivoSped;
  readonly exercicio: number;
  readonly numeroOrdem: number;
  readonly substituta: boolean;
  readonly hashAnterior: string | null;
  readonly formaTributacao: FormaTributacaoEcf | null;
  readonly tipoEntidadeEcf: string | null;
  readonly signatarios: readonly {
    readonly nome: string;
    readonly cpf: string;
    readonly qualificacao: QualificacaoSignatario;
    readonly crc: string | null;
    readonly email: string | null;
    readonly telefone: string | null;
  }[];
}

export const signatarioVazio = (qualificacao: QualificacaoSignatario | null = null): SignatarioRascunho => ({
  nome: '',
  cpf: '',
  qualificacao,
  crc: '',
  email: '',
  telefone: '',
});

/** O rascunho novo: o contador e o responsável pela entidade (os dois que o leiaute exige). */
export function novoRascunhoSped(tipo: TipoArquivoSped, exercicio: number): RascunhoSped {
  return {
    tipo,
    exercicio,
    numeroOrdem: '1',
    substituta: false,
    hashAnterior: '',
    formaTributacao: null,
    tipoEntidadeEcf: '',
    signatarios: [signatarioVazio('900'), signatarioVazio('203')],
  };
}

const soDigitos = (s: string) => s.replace(/\D/g, '');

/** Dígitos verificadores do CPF (a conferência que o programa oficial faz). */
export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/**
 * Os problemas do rascunho (chaves de texto em `contabil.sped.problemas`, com o número do signatário quando for dele),
 * os mesmos que o servidor confere: nada vai ao servidor com problema.
 */
export function problemasDoSped(r: RascunhoSped): { chave: string; n?: number }[] {
  const p: { chave: string; n?: number }[] = [];
  const ordem = Number(r.numeroOrdem);
  if (!/^\d{1,5}$/.test(r.numeroOrdem.trim()) || ordem < 1) p.push({ chave: 'numeroOrdem' });
  if (r.substituta && r.hashAnterior.trim().length === 0) p.push({ chave: 'hashAnterior' });
  if (r.tipo === 'ecf') {
    if (!r.formaTributacao) p.push({ chave: 'formaTributacao' });
    if (!/^\d{2}$/.test(r.tipoEntidadeEcf.trim())) p.push({ chave: 'tipoEntidade' });
  }
  if (r.signatarios.length < 2) p.push({ chave: 'doisSignatarios' });
  if (!r.signatarios.some((s) => s.qualificacao === '900')) p.push({ chave: 'semContador' });
  if (!r.signatarios.some((s) => s.qualificacao !== null && s.qualificacao !== '900'))
    p.push({ chave: 'semResponsavel' });
  r.signatarios.forEach((s, i) => {
    const n = i + 1;
    if (s.nome.trim().length < 3) p.push({ chave: 'nome', n });
    if (!cpfValido(s.cpf)) p.push({ chave: 'cpf', n });
    if (!s.qualificacao) p.push({ chave: 'qualificacao', n });
    if (s.qualificacao === '900' && s.crc.trim().length === 0) p.push({ chave: 'crc', n });
    if (s.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email.trim())) p.push({ chave: 'email', n });
    if (s.telefone.trim() && !/^\d{10,11}$/.test(soDigitos(s.telefone))) p.push({ chave: 'telefone', n });
  });
  return p;
}

/** O corpo do pedido (só com o rascunho sem problemas). */
export function corpoDoSped(empresa: number, r: RascunhoSped): CorpoGerarSped {
  return {
    empresa,
    tipo: r.tipo,
    exercicio: r.exercicio,
    numeroOrdem: Number(r.numeroOrdem),
    substituta: r.substituta,
    hashAnterior: r.substituta ? r.hashAnterior.trim() : null,
    formaTributacao: r.tipo === 'ecf' ? r.formaTributacao : null,
    tipoEntidadeEcf: r.tipo === 'ecf' ? r.tipoEntidadeEcf.trim() : null,
    signatarios: r.signatarios.map((s) => ({
      nome: s.nome.trim(),
      cpf: soDigitos(s.cpf),
      qualificacao: s.qualificacao!,
      crc: s.crc.trim() || null,
      email: s.email.trim() || null,
      telefone: soDigitos(s.telefone) || null,
    })),
  };
}

/** O texto em ISO-8859-1 (o que não cabe vira "?", como o programa oficial faria). */
export function latin1(texto: string): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(texto.length));
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    b[i] = c < 256 ? c : 0x3f;
  }
  return b;
}

/** Tamanho em bytes para a lista ("1,2 MB"). */
export function tamanhoBr(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
