// Chaves de busca do cadastro (ficha do M11, regra 5; cap-10 §10.7; ref 01 §4.4): o formato das linhas de
// SGH_BUSCA_NOME é contrato entre quem grava (o executor, na mesma transação do cadastro, e a leitura
// incremental) e quem busca (a API). Por isso mora aqui, puro: palavra normalizada (NFD sem acento, maiúscula,
// pontuação vira espaço; porta de normalizarChave da sante-api), chave fonética em português (porta de
// chaveFonetica da sante-api, calibrada contra 851 profissionais e 25.979 grafias erradas; usada SÓ para
// sugerir) e telefone pelos 8 últimos dígitos. As regras de casamento e de sugestão ficam em
// @sgh/dominio-cadastro (busca/fonetica.ts).
import { normalizarChave } from '../texto/normalizar.js';

/** Títulos e conectivos que nunca identificam uma pessoa (sante-api, utils/busca.js: PALAVRAS_IGNORADAS). */
export const PALAVRAS_IGNORADAS: ReadonlySet<string> = new Set([
  'DR',
  'DRA',
  'DRS',
  'DOUTOR',
  'DOUTORA',
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
]);

/** "(A)" de "DR(A)" e "MEDICO(A)": inicial que não é inicial. */
const INICIAIS_IGNORADAS: ReadonlySet<string> = new Set(['A', 'O']);

/** Tamanho máximo da palavra gravada (coluna PALAVRA de SGH_BUSCA_NOME). */
export const TAMANHO_PALAVRA_BUSCA = 40;

/** Palavras comparáveis de um nome CADASTRADO (normalizadas, sem descarte, sem repetição). */
export function palavrasDoCadastro(nome: string | null | undefined): string[] {
  return [...new Set(normalizarChave(nome).split(' ').filter(Boolean))];
}

/** Palavras de um termo DIGITADO que identificam uma pessoa (sem títulos, conectivos e o "(A)"). */
export function palavrasDoTermo(termo: string | null | undefined): string[] {
  return normalizarChave(termo)
    .split(' ')
    .filter((p) => p && !PALAVRAS_IGNORADAS.has(p) && !(p.length === 1 && INICIAIS_IGNORADAS.has(p)));
}

/**
 * Chave fonética PT-BR de UMA palavra já normalizada (porta literal de sante-api, src/utils/fonetica.js). A
 * ordem das regras é medida: Y→I antes do C brando; CH vira X (ROCHA funde com ROSA, de propósito); dobradas
 * antes do L vocalizado. Não "conserte" sem refazer a medição.
 */
export function chaveFonetica(palavra: string | null | undefined): string {
  return String(palavra ?? '')
    .toUpperCase()
    .replace(/Y/g, 'I')
    .replace(/PH/g, 'F')
    .replace(/KH/g, 'K')
    .replace(/CHR/g, 'KR')
    .replace(/SCH/g, 'SK')
    .replace(/CH(?=[BCDFGJKLMNPQRSTVXZ])/g, 'K')
    .replace(/CH/g, 'X')
    .replace(/LH/g, 'LI')
    .replace(/NH/g, 'NI')
    .replace(/QU/g, 'K')
    .replace(/Q/g, 'K')
    .replace(/CE/g, 'SE')
    .replace(/CI/g, 'SI')
    .replace(/C/g, 'K')
    .replace(/GE/g, 'JE')
    .replace(/GI/g, 'JI')
    .replace(/H/g, '')
    .replace(/W/g, 'V')
    .replace(/KT/g, 'T')
    .replace(/KS/g, 'S')
    .replace(/Z/g, 'S')
    .replace(/X/g, 'S')
    .replace(/(.)\1+/g, '$1')
    .replace(/L(?=[BDFGJKMNPRSTV])/g, 'U')
    .replace(/L$/, 'U')
    .replace(/M$/, 'N')
    .replace(/[IE]$/, 'E')
    .replace(/[OU]$/, 'O')
    .replace(/(.)\1+/g, '$1');
}

/** Os 8 últimos dígitos do telefone (ref 01 §4.4); null com menos de 8 dígitos. */
export function chaveTelefone(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? '').replace(/\D+/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

/** Entidades indexadas em SGH_BUSCA_NOME. */
export const ENTIDADES_BUSCA = ['paciente', 'profissional', 'solicitante'] as const;
export type EntidadeBusca = (typeof ENTIDADES_BUSCA)[number];

/** Campo de origem da chave: nome civil, nome social, nome da mãe, telefone. */
export const CAMPOS_BUSCA = ['nome', 'social', 'mae', 'telefone'] as const;
export type CampoBusca = (typeof CAMPOS_BUSCA)[number];

export interface ChaveBusca {
  readonly campo: CampoBusca;
  /** Palavra normalizada (até 40) ou os 8 últimos dígitos do telefone. */
  readonly palavra: string;
  /** Chave fonética da palavra (null para telefone). */
  readonly fonetica: string | null;
}

export interface OrigemChaves {
  readonly nome?: string | null;
  readonly social?: string | null;
  readonly mae?: string | null;
  readonly telefones?: readonly (string | null | undefined)[];
}

/** Linhas de chave de uma entidade: uma por palavra distinta de cada nome e uma por telefone distinto. */
export function chavesDeBusca(o: OrigemChaves): ChaveBusca[] {
  const r: ChaveBusca[] = [];
  const vistas = new Set<string>();
  const incluir = (campo: CampoBusca, palavra: string, fonetica: string | null) => {
    const k = `${campo}\u0000${palavra}`;
    if (vistas.has(k)) return;
    vistas.add(k);
    r.push({ campo, palavra, fonetica });
  };
  for (const [campo, texto] of [
    ['nome', o.nome],
    ['social', o.social],
    ['mae', o.mae],
  ] as const) {
    for (const p of palavrasDoCadastro(texto)) {
      const palavra = p.slice(0, TAMANHO_PALAVRA_BUSCA);
      incluir(campo, palavra, chaveFonetica(palavra).slice(0, TAMANHO_PALAVRA_BUSCA) || null);
    }
  }
  for (const t of o.telefones ?? []) {
    const k = chaveTelefone(t);
    if (k) incluir('telefone', k, null);
  }
  return r;
}
