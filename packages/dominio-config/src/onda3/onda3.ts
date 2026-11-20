// Onda 3 (ficha do M41): a liberação por setor da farmácia, da dispensação, do almoxarifado e das compras sobre as
// regras 1 a 8 do M40 (o mesmo critério por setor, o mesmo registro na lista para ligar, o mesmo lote), mais as
// condições próprias da onda: a ordem dos quatro setores (campo 12), a prescrição eletrônica em uso nas unidades
// atendidas antes da dispensação (regra 1), as operações P1 e P2 (campo 5) e o roteiro de recolhimento com os recursos
// que só existem no novo. Regras puras, sem banco e sem tela.
import {
  CHAVE_PRESCRICAO_ONDA2,
  CHAVES_REGRA_1_ONDA_3,
  DIAS_PRESCRICAO_EM_USO,
  OPERACOES_FICHA_ONDA_3,
  ORDEM_SETORES_ONDA_3,
  SETORES_ONDA_3,
  SETORES_PRONTIDAO,
  type DefinicaoSetor,
} from '@sgh/contratos';
import { decidirChaveFarmacia, setoresAntesDe, unidadesPorLocal } from '@sgh/contratos/regras-suprimentos';
import { setoresDaOndaDaChave } from '../onda2/onda2.js';

export function ehSetorOnda3(setor: string): boolean {
  return SETORES_ONDA_3.includes(setor);
}

/** O passo do setor na ordem recomendada (1 = primeiro), ou 0 fora da onda. */
export function passoDoSetorOnda3(setor: string): number {
  return ORDEM_SETORES_ONDA_3.findIndex((p) => (p as readonly string[]).includes(setor)) + 1;
}

/** Setores da onda 3 a que a chave pertence (vazio: a chave é de outra onda ou de nenhuma). */
export function setoresOnda3DaChave(
  tipo: 'recurso' | 'operacao',
  chave: string,
  nomesCatalogo: readonly string[],
  setores: readonly Pick<DefinicaoSetor, 'id' | 'onda' | 'operacoes' | 'recursos'>[] = SETORES_PRONTIDAO,
): string[] {
  return setoresDaOndaDaChave(3, SETORES_ONDA_3, tipo, chave, nomesCatalogo, setores);
}

/** P1 ou P2 da operação na onda (campo 5); null fora da ficha. */
export function prioridadeOnda3(operacao: string): 'P1' | 'P2' | null {
  return OPERACOES_FICHA_ONDA_3.find((o) => o.catalogo.includes(operacao))?.prioridade ?? null;
}

/**
 * Ordem recomendada (campo 12): os setores anteriores ainda não liberados no hospital. É aviso: quem decide é o
 * comitê (regra 1 do M40). `situacoes`: setor → situação do M37 (SGH_CFG_COEX_SETOR).
 */
export function anterioresNaoLiberados(setor: string, situacoes: Readonly<Record<string, string>>): string[] {
  const liberados = Object.entries(situacoes)
    .filter(([, s]) => ['liberado', 'acompanhamento', 'migrado'].includes(s))
    .map(([k]) => k);
  return setoresAntesDe(setor, liberados);
}

// ── Regra 1: farmácia depois da prescrição em uso ──────────────────────────────────────────────────────────────

/** A chave exige a prescrição em uso (a dispensação, a entrega e as operações delas)? */
export function chaveExigePrescricao(chave: string): boolean {
  return CHAVES_REGRA_1_ONDA_3.includes(chave);
}

export interface ChavePrescricaoLida {
  readonly escopo: string;
  readonly valor: string;
  readonly ligada: boolean | null;
}

/**
 * As unidades com a prescrição eletrônica "em uso no novo": as unidades (bloco da internação) com prescrição gravada
 * pelo novo na janela (trilha), desde que a chave da prescrição não esteja desligada no estabelecimento inteiro (o
 * recolhimento da prescrição recolhe também a prova da regra 1). Sem nenhuma chave da prescrição ligada, nenhuma.
 */
export function unidadesComPrescricaoEmUso(
  chavesPrescricao: readonly ChavePrescricaoLida[],
  prescricoesDoNovoPorUnidade: readonly { readonly unidade: string; readonly n: number }[],
): string[] {
  const hospital = chavesPrescricao.find((c) => c.escopo === 'hospital' && c.valor === '*');
  if (hospital && hospital.ligada === false) return [];
  if (!chavesPrescricao.some((c) => c.ligada === true)) return [];
  return [...new Set(prescricoesDoNovoPorUnidade.filter((p) => p.n > 0).map((p) => p.unidade.trim()))]
    .filter(Boolean)
    .sort();
}

export interface Regra1Local {
  readonly local: number;
  readonly unidades: string[];
  readonly faltam: string[];
}

/** Por local de dispensação: as unidades atendidas e as que ainda não têm a prescrição em uso. */
export function regra1PorLocal(
  atendidas: readonly { readonly local: number; readonly unidade: string; readonly dispensacoes: number }[],
  comPrescricao: readonly string[],
): Regra1Local[] {
  const com = new Set(comPrescricao);
  return [...unidadesPorLocal(atendidas, 1)]
    .map(([local, unidades]) => ({ local, unidades, faltam: unidades.filter((u) => !com.has(u)) }))
    .sort((a, b) => a.local - b.local);
}

/**
 * O que falta para ligar a chave da dispensação ou da entrega (null: pode). A chave de liberação não tem o escopo de
 * local de estoque (o setor da chave é a unidade da sessão): ligar em qualquer escopo vale para quem dispensa de
 * qualquer local, então todas as unidades atendidas por todos os locais com dispensação precisam da prescrição em uso
 * (D-REGRA1-41, falha fechada). Sem o mapa (nenhuma dispensação lida), não liga.
 */
export function motivoRegra1(
  ligar: boolean,
  porLocal: readonly Regra1Local[],
  comPrescricao: readonly string[],
) {
  const d = decidirChaveFarmacia(
    ligar,
    porLocal.flatMap((l) => l.unidades),
    comPrescricao,
  );
  return d.permitido ? null : d.mensagem;
}

/** A chave da prescrição usada na regra 1 (a da onda 2). */
export const CHAVE_PRESCRICAO_REGRA_1 = CHAVE_PRESCRICAO_ONDA2;

/** O que o banco diz para a regra 1 (unidades atendidas por local e prescrições gravadas pelo novo por unidade). */
export interface LeituraRegraFarmacia {
  readonly atendidas: readonly {
    readonly local: number;
    readonly unidade: string;
    readonly dispensacoes: number;
  }[];
  readonly prescricoes: readonly { readonly unidade: string; readonly n: number }[];
}

/**
 * A conferência da farmácia ao ligar (M41, regra 1; a mesma da tela de chaves e do comando `liberacao:ligar-tudo`): o que
 * falta para ligar a dispensação ou a entrega (null: pode, ou a chave não é da regra 1). Sem a leitura (null), não liga.
 */
export function motivoLigarRegraFarmacia(
  chave: string,
  leitura: LeituraRegraFarmacia | null,
  chavesPrescricao: readonly ChavePrescricaoLida[],
): string | null {
  if (!chaveExigePrescricao(chave)) return null;
  if (!leitura)
    return 'Não foi possível conferir agora as unidades atendidas e a prescrição eletrônica em uso (regra da farmácia).';
  const com = unidadesComPrescricaoEmUso(chavesPrescricao, leitura.prescricoes);
  const m = motivoRegra1(true, regra1PorLocal(leitura.atendidas, com), com);
  return m
    ? `${m} A dispensação só liga quando a prescrição eletrônica está em uso (gravada aqui nos últimos ${DIAS_PRESCRICAO_EM_USO} dias) em todas as unidades atendidas.`
    : null;
}
