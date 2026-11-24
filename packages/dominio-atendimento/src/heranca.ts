// Herança do atendimento anterior: as marcas dizem o que a nova ficha copia do atendimento anterior do paciente
// (fonte pagadora, profissional, carteira, plano, clínica, empresa, validade da carteira…). A pessoa confere antes de
// gravar. Melhoria: a regra tem escopo (todo o cliente, o estabelecimento, um usuário); a mais específica vence,
// campo a campo, e quem nunca configurou nada recebe o padrão que poupa redigitar a cobertura.
import { type CampoHerdado, HERANCAS } from '@sgh/contratos';

/** As marcas por chave da regra (`HERANCAS[].chave`): true herda, false não herda. */
export type MarcasHeranca = Readonly<Record<string, boolean | null | undefined>>;

/** Sem nenhuma regra gravada: a cobertura e o profissional do atendimento anterior. */
export const HERANCA_PADRAO: ReadonlySet<string> = new Set([
  'fonte_pagadora',
  'plano',
  'carteira',
  'validade_carteira',
  'profissional',
]);

/** Uma linha de regra lida do banco: escopo (nulo = todos) e a marca. */
export interface RegraHeranca {
  readonly campo: string;
  readonly herda: boolean;
  readonly estabelecimento: number | null;
  readonly usuario: number | null;
}

/**
 * As marcas em vigor para o usuário no estabelecimento: para cada campo, a regra mais específica (do usuário vence a
 * do estabelecimento, que vence a de todo o cliente); campo sem regra fica com o padrão. Regras de outro
 * estabelecimento ou de outro usuário são ignoradas.
 */
export function resolverHeranca(
  regras: readonly RegraHeranca[],
  contexto: { readonly estabelecimento: number | null; readonly usuario: number | null },
): Record<string, boolean> {
  const peso = new Map<string, number>();
  const r: Record<string, boolean> = {};
  for (const h of HERANCAS) r[h.chave] = HERANCA_PADRAO.has(h.chave);
  for (const g of regras) {
    if (!(g.campo in r)) continue;
    if (g.estabelecimento !== null && g.estabelecimento !== contexto.estabelecimento) continue;
    if (g.usuario !== null && g.usuario !== contexto.usuario) continue;
    const p = (g.usuario !== null ? 2 : 0) + (g.estabelecimento !== null ? 1 : 0);
    if ((peso.get(g.campo) ?? -1) >= p) continue;
    peso.set(g.campo, p);
    r[g.campo] = g.herda;
  }
  return r;
}

/** Controle otimista da alteração: as chaves herdadas, em ordem; "nenhum" quando nada é herdado. */
export function versaoHeranca(marcas: MarcasHeranca): string {
  const h = HERANCAS.filter((x) => marcas[x.chave] === true).map((x) => x.chave);
  return h.length ? h.join(',') : 'nenhum';
}

/** Os campos que a configuração manda herdar. */
export function camposHerdados(marcas: MarcasHeranca): CampoHerdado[] {
  return HERANCAS.filter((h) => marcas[h.chave] === true).map((h) => h.campo);
}

/** Campos da cobertura que só valem com a fonte pagadora de onde vieram. */
const DA_COBERTURA: readonly CampoHerdado[] = ['plano', 'matricula', 'validadeCarteira'];

/** O que a ficha nova recebe do anterior e os avisos para a recepção conferir. */
export interface HerancaAplicada {
  readonly valores: Partial<Record<CampoHerdado, string | number>>;
  readonly avisos: string[];
}

const dataBr = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * Os valores a pré-preencher: só os campos herdados com valor no atendimento anterior, com as regras da cobertura:
 * plano, carteirinha e validade só vêm junto com a fonte pagadora (sem ela seriam de outro convênio); a validade
 * vencida em `hoje` não é herdada e vira aviso.
 */
export function aplicarHeranca(
  marcas: MarcasHeranca,
  anterior: Readonly<Partial<Record<CampoHerdado, string | number | null>>> | null,
  hoje: string,
): HerancaAplicada {
  const valores: Partial<Record<CampoHerdado, string | number>> = {};
  const avisos: string[] = [];
  if (!anterior) return { valores, avisos };
  const comValor = (c: CampoHerdado) => {
    const v = anterior[c];
    return v !== null && v !== undefined && v !== '' && v !== 0;
  };
  const marcados = camposHerdados(marcas);
  const comFonte = marcados.includes('convenio') && comValor('convenio');
  for (const c of marcados) {
    if (!comValor(c)) continue;
    if (DA_COBERTURA.includes(c) && !comFonte) continue;
    const v = anterior[c] as string | number;
    if (c === 'validadeCarteira' && String(v).slice(0, 10) < hoje.slice(0, 10)) {
      avisos.push(
        `A carteirinha do atendimento anterior venceu em ${dataBr(String(v))}: confira a validade nova.`,
      );
      continue;
    }
    valores[c] = v;
  }
  if (!comFonte && marcados.some((c) => DA_COBERTURA.includes(c) && comValor(c)))
    avisos.push('Plano e carteirinha não foram trazidos: só valem com o convênio do atendimento anterior.');
  return { valores, avisos };
}
