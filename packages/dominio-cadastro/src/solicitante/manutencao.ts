// Manutenção do solicitante externo (F3.1, 02-CAD linha 20): parecidos antes de incluir (mesmo nome em outro número,
// erro de digitação no número), campos que a guia exige, código do solicitante em cada fonte pagadora e inativação
// (nunca apagar: o solicitante segue nos pedidos e atendimentos já feitos).
import { normalizarChave } from '@sgh/contratos';
import { chaveSolicitante, incompleto, type SolicitanteComparavel } from './deduplicacao.js';

export interface SolicitanteParecido extends SolicitanteComparavel {
  readonly nome: string;
}

const nomeChave = (n: string) =>
  normalizarChave(n)
    .split(' ')
    .filter((p) => p.length > 2 && !['DRA', 'DR', 'DOS', 'DAS', 'DEL'].includes(p))
    .join(' ');

/** Distância de edição (número do conselho com um dígito trocado ou a mais). */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let ant = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, ant + (a[i - 1] === b[j - 1] ? 0 : 1));
      ant = t;
    }
  }
  return d[b.length]!;
}

export type MotivoParecido = 'mesmo-registro' | 'mesmo-nome' | 'numero-proximo';

/**
 * Parecidos com o solicitante proposto, do mais forte ao mais fraco: o mesmo registro (conselho, UF e número), o
 * mesmo nome no mesmo conselho e UF, e o número a um dígito de distância com o nome que começa igual.
 */
export function parecidos(
  lista: readonly SolicitanteParecido[],
  alvo: Omit<SolicitanteParecido, 'id'> & { id?: number },
): { id: number; motivo: MotivoParecido }[] {
  const chave = chaveSolicitante(alvo);
  const nome = nomeChave(alvo.nome);
  const r: { id: number; motivo: MotivoParecido }[] = [];
  for (const s of lista) {
    if (s.id === alvo.id) continue;
    const mesmoConselho =
      normalizarChave(s.conselho) === normalizarChave(alvo.conselho) &&
      normalizarChave(s.uf) === normalizarChave(alvo.uf);
    if (chave !== null && chaveSolicitante(s) === chave) r.push({ id: s.id, motivo: 'mesmo-registro' });
    else if (mesmoConselho && nome !== '' && nomeChave(s.nome) === nome)
      r.push({ id: s.id, motivo: 'mesmo-nome' });
    else if (
      mesmoConselho &&
      s.numero !== null &&
      alvo.numero !== null &&
      distancia(String(s.numero), String(alvo.numero)) === 1 &&
      nome.split(' ')[0] === nomeChave(s.nome).split(' ')[0]
    )
      r.push({ id: s.id, motivo: 'numero-proximo' });
  }
  const ordem: MotivoParecido[] = ['mesmo-registro', 'mesmo-nome', 'numero-proximo'];
  return r.sort((a, b) => ordem.indexOf(a.motivo) - ordem.indexOf(b.motivo));
}

/** O que falta para a guia (conselho, UF, número e CBO), na forma de campos da tela. */
export function camposFaltantes(s: SolicitanteComparavel): string[] {
  if (!incompleto(s)) return [];
  const f: string[] = [];
  if (!normalizarChave(s.conselho)) f.push('conselho');
  if (!/^[A-Z]{2}$/.test(normalizarChave(s.uf).replace(/ /g, ''))) f.push('uf');
  if (s.numero === null || !(s.numero > 0)) f.push('numero');
  if (!s.cbo || String(s.cbo).replace(/\D+/g, '').length < 4) f.push('cbo');
  return f;
}

/** Código do solicitante na fonte pagadora: letras e dígitos, até 20. */
export function errosCodigoNaFonte(codigo: string): string[] {
  const c = codigo.trim();
  if (c === '') return ['codigo-vazio'];
  if (c.length > 20 || !/^[0-9A-Za-z./-]+$/.test(c)) return ['codigo-invalido'];
  return [];
}

/** Inativar exige o motivo (vai à observação e à trilha) e a data não anterior à inscrição. */
export function errosInativacao(e: { motivo: string; data: string; inscricao: string | null }): string[] {
  const erros: string[] = [];
  if (e.motivo.replace(/\s+/g, ' ').trim().length < 10) erros.push('motivo-curto');
  if (e.inscricao !== null && e.data < e.inscricao) erros.push('inativacao-antes-da-inscricao');
  return erros;
}
