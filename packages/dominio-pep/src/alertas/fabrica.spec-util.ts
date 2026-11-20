// Massa sintética do motor de alertas (produtos e contexto; nenhum dado real).
import type { ContextoAlertas, ItemAvaliado, ProdutoAlerta } from './tipos.js';
import { REGRAS_PADRAO } from './motor.js';

export function produto(p: Partial<ProdutoAlerta> & { produto: number }): ProdutoAlerta {
  return {
    nome: `PRODUTO SINTETICO ${p.produto}`,
    principiosAtivos: [],
    padronizado: true,
    altoAlerta: false,
    controlado: null,
    antimicrobiano: false,
    doseMinima: null,
    doseMaxima: null,
    viasPermitidas: [],
    ...p,
  };
}

export function item(
  chave: string,
  produtos: { produto: ProdutoAlerta; dose?: number | null; unidade?: string | null }[],
  extra: Partial<ItemAvaliado> = {},
): ItemAvaliado {
  return {
    chave,
    tipo: 'medicamento',
    produtos: produtos.map((p) => ({
      produto: p.produto,
      dose: p.dose === undefined ? 1 : p.dose,
      unidade: p.unidade === undefined ? 'MG' : p.unidade,
    })),
    via: 'VO',
    dosesNoPeriodo: 3,
    intervaloHoras: 8,
    aCriterio: false,
    seNecessario: null,
    fichaAntimicrobiano: false,
    ...extra,
  };
}

export function contexto(c: Partial<ContextoAlertas> = {}): ContextoAlertas {
  return {
    alergias: [],
    ativos: [],
    paciente: { clearance: null, pesoKg: null },
    tipoAtendimento: 'I',
    alta: false,
    regras: REGRAS_PADRAO,
    interacoes: [],
    duplicidade: { porMedicamento: true, porPrincipio: true, consistir: true },
    altaVigilancia: new Set(),
    dietaDeOutro: null,
    hoje: '2026-10-21',
    ...c,
  };
}
