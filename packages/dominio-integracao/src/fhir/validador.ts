// Validação dos recursos FHIR R4 gerados contra os perfis BR Core da versão FIXADA (M34; ficha, regra 14; ADR 0016:
// 1.6.1). Recorte versionado do pacote oficial (packages/dominio-integracao/src/fhir/br-core-1.6.1.json, com o SHA-256
// do pacote): cardinalidade dos elementos (mínimo e máximo, inclusive os proibidos com máximo 0), valores fixos e
// padrões, e as fatias de identificador pelo sistema fixo (CPF, CNS, CNES, CNPJ). Não substitui o validador oficial
// do HL7 na homologação da RNDS: é a conferência do CI, sem rede.

export interface ElementoPerfil {
  readonly id: string;
  readonly caminho: string;
  readonly fatia?: string;
  readonly min: number;
  readonly max: string;
  readonly fixo?: { readonly tipo: string; readonly valor: unknown };
  readonly tipos: readonly string[];
}

export interface PerfilRecortado {
  readonly url: string;
  readonly versao: string;
  readonly tipo: string;
  readonly elementos: readonly ElementoPerfil[];
}

export interface ProblemaValidacao {
  readonly caminho: string;
  readonly mensagem: string;
}

type Json = Record<string, unknown>;

/** Valores do campo no objeto (o campo `nome[x]` casa com `nomeTipo`). */
function valores(obj: Json, nome: string): unknown[] {
  if (nome.endsWith('[x]')) {
    const base = nome.slice(0, -3);
    return Object.keys(obj)
      .filter((k) => k.startsWith(base) && /^[A-Z]/.test(k.slice(base.length)))
      .flatMap((k) => (Array.isArray(obj[k]) ? (obj[k] as unknown[]) : [obj[k]]));
  }
  const v = obj[nome];
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Quantos valores o campo tem para a cardinalidade: o primitivo só com extensão (`_campo`, ex.: data-absent-reason)
 * também está presente (FHIR R4, JSON: o elemento existe mesmo sem valor). */
function quantos(obj: Json, nome: string): number {
  const n = valores(obj, nome).length;
  return n > 0 ? n : obj[`_${nome}`] !== undefined && obj[`_${nome}`] !== null ? 1 : 0;
}

const contaMax = (max: string) => (max === '*' ? Number.POSITIVE_INFINITY : Number(max));

function igual(a: unknown, b: unknown): boolean {
  if (typeof b !== 'object' || b === null) return a === b;
  if (typeof a !== 'object' || a === null) return false;
  if (Array.isArray(b)) return Array.isArray(a) && b.every((x, i) => igual((a as unknown[])[i], x));
  return Object.entries(b as Json).every(([k, v]) => igual((a as Json)[k], v));
}

/** O sistema fixo de cada fatia de identificador (ex.: cpf → https://saude.gov.br/fhir/sid/cpf). */
function sistemasDasFatias(p: PerfilRecortado, campo: string): Map<string, string> {
  const r = new Map<string, string>();
  for (const e of p.elementos) {
    // Sem expressão montada do perfil (M35, varredura de segurança): prefixo e sufixo fixos, a fatia sem ponto.
    const prefixo = `${p.tipo}.${campo}:`;
    const fatia =
      e.id.startsWith(prefixo) && e.id.endsWith('.system')
        ? e.id.slice(prefixo.length, -'.system'.length)
        : '';
    if (fatia && !fatia.includes('.') && e.fixo && typeof e.fixo.valor === 'string')
      r.set(fatia, e.fixo.valor);
  }
  return r;
}

/**
 * Valida o recurso: o tipo, o perfil declarado em meta.profile (url|versão fixada) e os elementos do snapshot até o
 * segundo nível (o recurso e os filhos diretos dos elementos presentes), com as fatias de identificador.
 */
export function validarRecurso(recurso: Json, p: PerfilRecortado): ProblemaValidacao[] {
  const problemas: ProblemaValidacao[] = [];
  const add = (caminho: string, mensagem: string) => problemas.push({ caminho, mensagem });
  if (recurso['resourceType'] !== p.tipo) add('resourceType', `esperado ${p.tipo}`);
  const perfis = ((recurso['meta'] as Json | undefined)?.['profile'] as string[] | undefined) ?? [];
  if (!perfis.includes(`${p.url}|${p.versao}`))
    add('meta.profile', `o perfil tem de ser ${p.url}|${p.versao} (versão fixada)`);

  const fatias = sistemasDasFatias(p, 'identifier');
  const identificadores = valores(recurso, 'identifier') as Json[];
  const fatiaDe = (id: Json) =>
    [...fatias.entries()].find(([, sistema]) => id['system'] === sistema)?.[0] ?? null;

  for (const e of p.elementos) {
    const partes = e.id.split('.');
    if (partes.length < 2) continue;
    const [raizId, nivel1, nivel2] = partes;
    if (raizId !== p.tipo) continue;
    const [campo1, fatia1] = (nivel1 ?? '').split(':') as [string, string | undefined];
    // Nível 1 sem fatia: cardinalidade no recurso.
    if (partes.length === 2 && !fatia1) {
      const n = quantos(recurso, campo1);
      if (n < e.min) add(e.caminho, `obrigatório (mínimo ${e.min})`);
      if (n > contaMax(e.max)) add(e.caminho, e.max === '0' ? 'proibido neste perfil' : `máximo ${e.max}`);
      if (e.fixo && n > 0 && !valores(recurso, campo1).every((v) => igual(v, e.fixo!.valor)))
        add(e.caminho, `valor fixo ${JSON.stringify(e.fixo.valor)}`);
      continue;
    }
    // Fatia de identificador: o elemento de nível 1 (cardinalidade da fatia) e os filhos de cada identificador dela.
    if (campo1 === 'identifier' && fatia1) {
      const daFatia = identificadores.filter((i) => fatiaDe(i) === fatia1);
      if (partes.length === 2) {
        if (daFatia.length < e.min) add(e.id, `fatia obrigatória (mínimo ${e.min})`);
        if (daFatia.length > contaMax(e.max)) add(e.id, `fatia com no máximo ${e.max}`);
        continue;
      }
      if (partes.length === 3 && nivel2 && !nivel2.includes(':'))
        for (const id of daFatia) {
          const n = valores(id, nivel2).length;
          if (n < e.min) add(e.id, `obrigatório na fatia (mínimo ${e.min})`);
          if (n > contaMax(e.max)) add(e.id, `máximo ${e.max} na fatia`);
          if (e.fixo && n > 0 && !valores(id, nivel2).every((v) => igual(v, e.fixo!.valor)))
            add(e.id, `valor fixo ${JSON.stringify(e.fixo.valor)}`);
        }
      continue;
    }
    // Nível 2 sem fatia: os filhos dos elementos presentes (performer.actor, protocolApplied.doseNumber[x]…).
    if (partes.length === 3 && !fatia1 && nivel2 && !nivel2.includes(':') && campo1 !== 'identifier') {
      for (const pai of valores(recurso, campo1)) {
        if (typeof pai !== 'object' || pai === null) continue;
        const n = quantos(pai as Json, nivel2);
        if (n < e.min) add(e.caminho, `obrigatório (mínimo ${e.min})`);
        if (n > contaMax(e.max)) add(e.caminho, e.max === '0' ? 'proibido neste perfil' : `máximo ${e.max}`);
      }
    }
  }
  // Identificador com sistema que o perfil não conhece não é erro (o perfil é aberto), mas sem sistema é.
  identificadores.forEach((i, k) => {
    if (typeof i['system'] !== 'string' || typeof i['value'] !== 'string')
      add(`identifier[${k}]`, 'identificador sem sistema ou sem valor');
  });
  return problemas;
}
