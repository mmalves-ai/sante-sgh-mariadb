// ADR 0009, decisão 25 nos fluxos: o profissional sem credenciamento vigente no convênio (ou no plano da conta, com o
// plano superior) gera ALERTA por padrão e BLOQUEIO quando o convênio pede (fonte_pagadora.bloqueia_sem_credenciamento).
// A mesma conferência vale na marcação da agenda, na abertura do atendimento e no lançamento na conta. O particular
// não pede credenciamento. A leitura é da porta (@sgh/persistencia); quem decide é o domínio (@sgh/dominio-preco).
import type { VerificacaoCredenciamento } from '@sgh/contratos';
import { verificarCredenciamento } from '@sgh/dominio-preco';
import { type Leitor, type Linha, recusa } from '@sgh/nucleo';
import { credenciamentosVigentes, opcoesCredenciamentoConvenio } from '@sgh/persistencia';

export interface PedidoCredenciamentoFluxo {
  readonly profissionalId: number | null;
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  /** O passo não conhece o plano do paciente (marcação): credenciamento em plano do convênio só alerta. */
  readonly planoDesconhecido?: boolean;
  readonly estabelecimentoId: number;
  /** AAAA-MM-DD. */
  readonly data: string;
  /** Campo da tela que recebe a recusa no bloqueio. */
  readonly campo: string;
}

/**
 * Confere o credenciamento no fluxo. Bloqueio: recusa `profissional-nao-credenciado`. Alerta: devolve a verificação
 * (quem chama a devolve no resultado). Credenciado, particular ou sem profissional: nulo.
 */
export async function conferirCredenciamentoNoFluxo(
  l: Leitor,
  p: PedidoCredenciamentoFluxo,
): Promise<VerificacaoCredenciamento | null> {
  if (p.profissionalId === null) return null;
  const f = await l.uma<Linha>('SELECT tipo FROM fonte_pagadora WHERE id = ?', [p.fontePagadoraId]);
  if (!f || String(f['tipo']) === 'particular') return null;
  let planoSuperiorId: number | null = null;
  if (p.planoId !== null) {
    const pl = await l.uma<Linha>('SELECT plano_superior_id FROM plano_fonte_pagadora WHERE id = ?', [
      p.planoId,
    ]);
    planoSuperiorId = pl?.['plano_superior_id'] == null ? null : Number(pl['plano_superior_id']);
  }
  const q = {
    profissionalId: p.profissionalId,
    fontePagadoraId: p.fontePagadoraId,
    estabelecimentoId: p.estabelecimentoId,
    data: p.data,
  };
  const v = verificarCredenciamento({
    particular: false,
    profissionalId: p.profissionalId,
    planoId: p.planoId,
    planoSuperiorId,
    planoDesconhecido: p.planoDesconhecido ?? false,
    data: p.data,
    credenciamentos: await credenciamentosVigentes(l, q),
    opcoes: await opcoesCredenciamentoConvenio(l, p.fontePagadoraId),
  });
  if (v.efeito === 'bloqueio')
    throw recusa(
      'profissional-nao-credenciado',
      v.motivo ?? 'O profissional não é credenciado no convênio.',
      {
        campos: [p.campo],
      },
    );
  return v.efeito === 'alerta' ? v : null;
}
