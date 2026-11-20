// Fluxo entre locais e tipos de gerador (M19; ficha, regras 4 e 5): o encaminhamento só vai aos locais que o cadastro
// permite (TBLOCALENCATE: 12 ↔ 13 e 23 → 13 no pc); o gerador tipo 0 (recepção) segue para a abertura do atendimento e
// o tipo 5 (serviços diversos) termina no guichê com a liberação; os tipos 1 a 4 existem como colunas vazias e não são
// usados (0 geradores na cópia).
import { TIPOS_GERADOR } from '@sgh/contratos';

export interface ParEncaminhamento {
  readonly de: number;
  readonly para: number;
}

/** O local de origem pode encaminhar para o destino? (nunca para si mesmo) */
export function podeEncaminhar(de: number, para: number, pares: readonly ParEncaminhamento[]): boolean {
  if (de === para) return false;
  return pares.some((p) => p.de === de && p.para === para);
}

/** Destinos permitidos de um local. */
export function destinosDe(de: number, pares: readonly ParEncaminhamento[]): number[] {
  return [...new Set(pares.filter((p) => p.de === de && p.para !== de).map((p) => p.para))].sort(
    (a, b) => a - b,
  );
}

export interface RegraGerador {
  readonly usado: boolean;
  readonly abreAtendimento: boolean;
  readonly terminaNoGuiche: boolean;
}

export function regraDoGerador(tipo: string | null | undefined): RegraGerador {
  const t = (tipo ?? '').trim();
  const def = TIPOS_GERADOR.find((x) => x.codigo === t);
  return {
    usado: def?.usado ?? false,
    abreAtendimento: t === '0',
    terminaNoGuiche: t === '5',
  };
}

/** Recusa do gerador que não emite senha (inativo ou de tipo não usado), ou null. */
export function motivoGeradorSemEmissao(g: {
  readonly tipo: string;
  readonly ativo: boolean;
}): string | null {
  if (!g.ativo) return 'O serviço está inativo: escolha outro.';
  if (!regraDoGerador(g.tipo).usado) return 'Este tipo de serviço não é usado nas filas do estabelecimento.';
  return null;
}
