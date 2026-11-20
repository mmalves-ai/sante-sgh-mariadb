// Nome social e paciente sigiloso no fluxo da recepção (W1-04, mercado incorporado (a)). Regras:
// - O nome de tratamento é o nome social quando houver (Decreto 8.727/2016; Portaria MS 1.820/2009, art. 4º): o painel,
//   a chamada, o guichê e as listas usam o nome social; o nome civil fica só onde a identificação segura o exige.
// - Paciente sigiloso (marca do cadastro, W1-02) sai mascarado em painel, chamada, guichê e listas: nem iniciais nem
//   nome; a senha e o prontuário bastam para o atendimento.
// - Pulseira (identificação segura, dois identificadores): o nome social em destaque e o nome civil logo abaixo; o
//   sigilo não esconde a pulseira, que fica no próprio paciente (meta 1 de segurança do paciente, RDC 36/2013).
import { iniciais } from './painel.js';

export interface IdentidadeExibida {
  /** Nome civil (registro). */
  readonly nome: string | null | undefined;
  /** Nome social do cadastro, quando houver. */
  readonly nomeSocial?: string | null | undefined;
  /** Marca "sigiloso" do cadastro do paciente. */
  readonly sigiloso?: boolean | undefined;
}

/** Texto que substitui o nome do paciente sigiloso nas listas e no guichê. */
export const NOME_SIGILOSO = 'Paciente sigiloso';

const limpo = (t: string | null | undefined): string => String(t ?? '').trim();

/** O nome de tratamento (nome social quando houver), ou null para o sigiloso ou sem nome. */
export function nomeDeTratamento(i: IdentidadeExibida): string | null {
  if (i.sigiloso) return null;
  return limpo(i.nomeSocial) || limpo(i.nome) || null;
}

/** O nome de tratamento veio do nome social? (a tela marca "nome social"). */
export function usaNomeSocial(i: IdentidadeExibida): boolean {
  return !i.sigiloso && limpo(i.nomeSocial) !== '';
}

/** Iniciais do painel e da chamada: do nome social quando houver; o sigiloso não tem iniciais. */
export function iniciaisDaChamada(i: IdentidadeExibida): string | null {
  const n = nomeDeTratamento(i);
  return n ? iniciais(n) : null;
}

/** Nome mascarado das listas ("M*** S***"), do nome social quando houver; o sigiloso vira NOME_SIGILOSO. */
export function nomeNaLista(i: IdentidadeExibida): string {
  if (i.sigiloso) return NOME_SIGILOSO;
  const partes = (nomeDeTratamento(i) ?? '').split(/\s+/).filter(Boolean);
  return partes.length === 0 ? '—' : partes.map((p) => `${p[0]}***`).join(' ');
}

/** Linhas de nome da pulseira: o nome social em destaque e o civil abaixo; sem nome social, só o civil. */
export function nomesDaPulseira(i: IdentidadeExibida): {
  readonly principal: string;
  readonly civil: string | null;
} {
  const civil = limpo(i.nome);
  const social = limpo(i.nomeSocial);
  if (social && social.toUpperCase() !== civil.toUpperCase()) return { principal: social, civil };
  return { principal: civil, civil: null };
}
