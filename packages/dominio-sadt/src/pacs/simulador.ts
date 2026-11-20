// Simulador de modalidade e PACS (M47, etapa 3; ficha, regra 9: fora de `producao`, PACS, RIS e equipamentos só por
// simulador; convencoes.md §1, regra 10). Em memória e sem rede: recebe o item da lista de trabalho (o mesmo número de
// acesso atualiza o item, nunca duplica: é assim que o reenvio é provado), e produz as mensagens de status (MPPS) que a
// modalidade mandaria, com o UID do estudo pré-atribuído no item. Usado pelo destino em loopback do worker, pelos testes
// de integração e pela tela fora de produção.
import type { StatusEstudo, StatusExameEntrada } from '@sgh/contratos';

export interface ItemRecebidoSimulador {
  readonly accession: string;
  readonly modalidade: string;
  readonly uidEstudo: string | null;
  readonly recebimentos: number;
}

const texto = (item: Record<string, unknown>, tag: string): string | null => {
  const v = (item[tag] as { Value?: unknown[] } | undefined)?.Value?.[0];
  return typeof v === 'string' ? v : null;
};

export class SimuladorModalidade {
  private readonly porAccession = new Map<string, ItemRecebidoSimulador>();
  private sequencia = 0;

  /** Recebe o item (JSON do DICOM): 'criado' na primeira vez, 'atualizado' no reenvio com o mesmo número de acesso. */
  receber(item: Record<string, unknown>): { situacao: 'criado' | 'atualizado'; accession: string } {
    const accession = texto(item, '00080050');
    if (!accession) throw new Error('Item sem o número de acesso (0008,0050).');
    const sps = (item['00400100'] as { Value?: Record<string, unknown>[] } | undefined)?.Value?.[0] ?? {};
    const modalidade = texto(sps, '00080060') ?? 'OT';
    const ja = this.porAccession.get(accession);
    this.porAccession.set(accession, {
      accession,
      modalidade,
      uidEstudo: texto(item, '0020000D'),
      recebimentos: (ja?.recebimentos ?? 0) + 1,
    });
    return { situacao: ja ? 'atualizado' : 'criado', accession };
  }

  itens(): ItemRecebidoSimulador[] {
    return [...this.porAccession.values()];
  }

  item(accession: string): ItemRecebidoSimulador | null {
    return this.porAccession.get(accession) ?? null;
  }

  /** A mensagem de status que a modalidade mandaria (o identificador muda a cada mensagem nova). */
  status(accession: string, status: StatusEstudo, ocorridoEm: string): StatusExameEntrada {
    const i = this.porAccession.get(accession);
    this.sequencia++;
    return {
      mensagem: `SIM-${accession}-${status}-${this.sequencia}`,
      accession,
      status,
      uidEstudo: i?.uidEstudo ?? null,
      uidMpps: i?.uidEstudo ? `${i.uidEstudo}.${this.sequencia}` : null,
      ocorridoEm: ocorridoEm.slice(0, 19),
    };
  }
}

/**
 * A mensagem de status do simulador sem estado (a tela fora de produção e o E2E): o identificador é determinístico pelo
 * item, o status e o envio, de modo que clicar de novo no mesmo passo repete a mensagem (e a repetição não grava).
 */
export function statusSimulado(x: {
  readonly accession: string;
  readonly uidEstudo: string;
  readonly status: StatusEstudo;
  readonly envio: number;
  readonly ocorridoEm: string;
}): StatusExameEntrada {
  return {
    mensagem: `SIM-${x.accession}-${x.status}-${x.envio}`,
    accession: x.accession,
    status: x.status,
    uidEstudo: x.uidEstudo,
    uidMpps: `${x.uidEstudo}.${x.envio}`,
    ocorridoEm: x.ocorridoEm.slice(0, 19),
  };
}
