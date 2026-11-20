// Consumidor idempotente das integrações novas (M34; ficha, regra 8; cap-12 §12.3, Idempotência): o evento da outbox
// chega pelo BullMQ pelo menos uma vez (o relay republica depois de uma falha); para cada parceiro ATIVO que assina o
// tipo do evento, a mensagem de saída é registrada UMA vez (estabelecimento + evento + parceiro: a unicidade do banco e
// a conferência antes da inclusão). O que um gatilho do legado já envia nunca entra (a lista do contrato). A ordem por
// objeto vem da carga (o paciente ou a conta).
import { EVENTOS_INTEGRACAO } from '@sgh/contratos';
import { chaveDeOrdem } from '@sgh/dominio-integracao';
import { idDaOutbox, lerParceiros, registrarEnvio } from '@sgh/legado';
import type { AcessoIntegracao } from './acesso.js';

export interface EventoRecebido {
  /** A chave do evento (o jobId do BullMQ: o resumo SHA-256 da chave composta, como a outbox guarda). */
  readonly chave: string;
  readonly tipo: string;
  readonly dados: Readonly<Record<string, string | number>>;
}

export interface Distribuicao {
  readonly parceiros: number;
  readonly incluidas: number;
  readonly repetidas: number;
}

const NADA: Distribuicao = { parceiros: 0, incluidas: 0, repetidas: 0 };

/** A chave de ordem do evento: o paciente, senão a conta, senão o exame, senão o estabelecimento. */
export function ordemDoEvento(hospital: string, d: Readonly<Record<string, string | number>>): string {
  for (const [campo, tipo] of [
    ['paciente', 'paciente'],
    ['conta', 'conta'],
    ['exame', 'exame'],
  ] as const) {
    const v = d[campo];
    if ((typeof v === 'number' && v > 0) || (typeof v === 'string' && /^[A-Za-z0-9.-]{1,40}$/.test(v)))
      return chaveDeOrdem(tipo, v);
  }
  return chaveDeOrdem('estabelecimento', hospital.replace(/[^A-Za-z0-9.-]/g, '') || 'x');
}

/**
 * O objeto do evento no envio: o exame (SILANEXA) ou, W0-03 (M6), a vacina do RIA (SGH_PEP_VACINA_APLICADA) com a versão
 * do registro (0 = a aplicação; N = a substituição ou o cancelamento da versão N), como "vacina.versao".
 */
export function fatoDoEvento(d: Readonly<Record<string, string | number>>): {
  tabelaFato: string | null;
  idFato: string | null;
} {
  if (typeof d['exame'] === 'number') return { tabelaFato: 'SILANEXA', idFato: String(d['exame']) };
  if (typeof d['vacina'] === 'number')
    return {
      tabelaFato: 'SGH_PEP_VACINA_APLICADA',
      idFato: `${String(d['vacina'])}.${String(typeof d['versao'] === 'number' ? d['versao'] : 0)}`,
    };
  return { tabelaFato: null, idFato: null };
}

export async function distribuirEvento(acesso: AcessoIntegracao, ev: EventoRecebido): Promise<Distribuicao> {
  if (!(EVENTOS_INTEGRACAO as readonly string[]).includes(ev.tipo)) return NADA;
  const hospital = String(ev.dados['hospital'] ?? '');
  if (!/^[a-z0-9]{1,10}$/.test(hospital)) return NADA;
  const [parceiros, idOutbox] = await acesso.ler(
    hospital,
    async (l) => [await lerParceiros(l, hospital), await idDaOutbox(l, ev.chave)] as const,
  );
  if (!idOutbox) return NADA;
  const alvo = parceiros.filter(
    (p) =>
      p.ativo &&
      p.eventos.includes(ev.tipo) &&
      // O teste vai só ao parceiro pedido.
      (ev.tipo !== 'integracao.teste' || p.codigo === ev.dados['parceiro']),
  );
  if (alvo.length === 0) return NADA;
  const chaveOrdem = ordemDoEvento(hospital, ev.dados);
  const { tabelaFato, idFato } = fatoDoEvento(ev.dados);
  const novas = await acesso.gravar(hospital, async (e) => {
    const r: boolean[] = [];
    for (const p of alvo)
      r.push(
        await registrarEnvio(e, hospital, {
          idOutbox,
          chaveEvento: ev.chave,
          tipoEvento: ev.tipo,
          parceiro: p.codigo,
          chaveOrdem,
          tabelaFato,
          idFato,
        }),
      );
    return r;
  });
  const incluidas = novas.filter(Boolean).length;
  return { parceiros: alvo.length, incluidas, repetidas: novas.length - incluidas };
}
