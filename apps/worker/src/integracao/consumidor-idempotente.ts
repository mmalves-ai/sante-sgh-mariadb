// Consumidor idempotente das integrações (M34; ficha, regra 8; cap-12 §12.3, Idempotência): o evento da fila comum
// chega pelo BullMQ pelo menos uma vez (o relay republica depois de uma falha); para cada parceiro ATIVO que assina o
// tipo do evento, a mensagem de saída é registrada UMA vez (ponto do estabelecimento + chave do evento: a unicidade do
// banco e a conferência travada antes da inclusão). A ordem por objeto vem da carga (o paciente, a conta ou o exame).
// Melhoria: o objeto do evento é o do modelo (exame_item, vacina_aplicada com a versão), nunca a tabela de outro
// sistema; o código do estabelecimento é conferido pelo contrato da sessão; a gravação é uma operação do Executor.
// Melhoria: o evento derivado vai a quem assina o evento de origem (a revogação do resultado a quem assina o liberado).
import { EVENTOS_INTEGRACAO, esquemaCodigoEstabelecimento } from '@sgh/contratos';
import { assinaturaDoEvento, chaveDeOrdem } from '@sgh/dominio-integracao';
import type { AcessoIntegracao } from './acesso.js';
import { idDaOutbox, lerParceiros, registrarEnvio } from './porta-propria.js';

export interface EventoRecebido {
  /** A chave do evento (o jobId do BullMQ: a referência da mensagem na fila comum). */
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
 * O objeto do evento no envio: o exame pedido ou, W0-03 (M6), a vacina aplicada com a versão do registro (0 = a
 * aplicação; N = a substituição ou o cancelamento da versão N), como "vacina.versao".
 */
export function fatoDoEvento(d: Readonly<Record<string, string | number>>): {
  entidade: string | null;
  objeto: string | null;
} {
  if (typeof d['exame'] === 'number') return { entidade: 'exame_item', objeto: String(d['exame']) };
  if (typeof d['vacina'] === 'number')
    return {
      entidade: 'vacina_aplicada',
      objeto: `${String(d['vacina'])}.${String(typeof d['versao'] === 'number' ? d['versao'] : 0)}`,
    };
  return { entidade: null, objeto: null };
}

export async function distribuirEvento(acesso: AcessoIntegracao, ev: EventoRecebido): Promise<Distribuicao> {
  const assinatura = assinaturaDoEvento(ev.tipo);
  if (!(EVENTOS_INTEGRACAO as readonly string[]).includes(assinatura)) return NADA;
  const hospital = String(ev.dados['hospital'] ?? '');
  if (!esquemaCodigoEstabelecimento.safeParse(hospital).success) return NADA;
  const [parceiros, idOutbox] = await acesso.ler(
    hospital,
    async (l) => [await lerParceiros(l), await idDaOutbox(l, hospital, ev.chave)] as const,
  );
  if (!idOutbox) return NADA;
  const alvo = parceiros.filter(
    (p) =>
      p.ativo &&
      p.eventos.includes(assinatura) &&
      // O teste vai só ao parceiro pedido.
      (ev.tipo !== 'integracao.teste' || p.codigo === ev.dados['parceiro']),
  );
  if (alvo.length === 0) return NADA;
  const chaveOrdem = ordemDoEvento(hospital, ev.dados);
  const { entidade, objeto } = fatoDoEvento(ev.dados);
  const novas = await acesso.gravar(
    hospital,
    async (tx) => {
      const r: boolean[] = [];
      for (const p of alvo)
        r.push(
          await registrarEnvio(tx, {
            idOutbox,
            chaveEvento: ev.chave,
            tipoEvento: ev.tipo,
            parceiro: p.codigo,
            chaveOrdem,
            entidade,
            objeto,
          }),
        );
      return r;
    },
    { operacao: 'integracao.distribuir-evento' },
  );
  const incluidas = novas.filter(Boolean).length;
  return { parceiros: alvo.length, incluidas, repetidas: novas.length - incluidas };
}
