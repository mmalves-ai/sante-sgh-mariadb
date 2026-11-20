// W0-08, parte 10 (mercado M4: PMOC e infraestrutura crítica): a montagem pura do relatório do PMOC (Lei 13.589/2018,
// Portaria GM/MS 3.523/1998) e a conferência do período e do modelo instalado. O controlador lê os planos do modelo
// "pmocAr", as execuções e o responsável técnico (parâmetro, cadastro do dono) e entrega aqui; o HTML sai de
// documentos.ts (htmlPmoc). Toda conta agregada vai com as parcelas impressas.
import {
  MODELOS_PLANO_INFRA,
  type CodigoModeloPlano,
  type ResponsavelPmoc,
  type RecusaPmoc,
} from '@sgh/contratos';
import { diasEntre, situacaoDoPlano } from '@sgh/dominio-manutencao';
import type { ExecucaoLida, PlanoManutencaoLido } from '@sgh/legado';
import type { PmocParaDocumento } from './documentos.js';

/** Período do relatório: a ordem e o teto de 366 dias. */
export function conferirPeriodoPmoc(
  de: string,
  ate: string,
): { ok: true } | { ok: false; recusa: RecusaPmoc; mensagem: string } {
  const dias = diasEntre(de, ate);
  if (dias < 0)
    return { ok: false, recusa: 'periodo-invalido', mensagem: 'O fim do período vem antes do início.' };
  if (dias > 366)
    return {
      ok: false,
      recusa: 'periodo-invalido',
      mensagem: 'O relatório do PMOC cobre no máximo 12 meses.',
    };
  return { ok: true };
}

/** O mesmo modelo não fica ativo duas vezes no mesmo equipamento (o segundo seria o mesmo plano duplicado). */
export function conferirInstalacaoModelo(
  planosDoEquipamento: readonly PlanoManutencaoLido[],
  modelo: CodigoModeloPlano,
): { ok: true } | { ok: false; recusa: RecusaPmoc; mensagem: string } {
  const ja = planosDoEquipamento.find((p) => p.ativo && p.modelo?.codigo === modelo);
  return ja
    ? {
        ok: false,
        recusa: 'modelo-instalado',
        mensagem: `O modelo "${MODELOS_PLANO_INFRA[modelo].nome}" já está ativo neste equipamento (plano ${ja.id}): altere esse plano.`,
      }
    : { ok: true };
}

export interface EquipamentoDoPmoc {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly local: string;
  readonly fabricante: string | null;
  readonly modelo: string | null;
  readonly numeroSerie: string | null;
}

export interface EntradaPmoc {
  readonly de: string;
  readonly ate: string;
  readonly hoje: string;
  readonly antecedenciaPadrao: number;
  readonly responsavel: ResponsavelPmoc;
  readonly planos: readonly PlanoManutencaoLido[];
  readonly equipamentos: ReadonlyMap<number, EquipamentoDoPmoc>;
  readonly execucoes: ReadonlyMap<number, readonly ExecucaoLida[]>;
  readonly emissao: {
    readonly estabelecimento: string;
    readonly emitidoEm: string;
    readonly emitidoPor: string;
  };
}

/**
 * O relatório do PMOC: cada plano ATIVO do modelo "pmocAr" (ou inativo que tenha execução no período), com o equipamento,
 * a versão do modelo, a situação de hoje e as execuções do período (resultado, laudo, observação, quem). Execuções de
 * fora do período ficam fora. Ordem: código do equipamento.
 */
export function montarPmoc(x: EntradaPmoc): PmocParaDocumento {
  const modelo = MODELOS_PLANO_INFRA.pmocAr;
  const itens = x.planos
    .filter((p) => p.modelo?.codigo === 'pmocAr')
    .map((p) => {
      const execucoes = (x.execucoes.get(p.id) ?? [])
        .filter((e) => e.data >= x.de && e.data <= x.ate)
        .slice()
        .sort((a, b) => (a.data === b.data ? a.id - b.id : a.data < b.data ? -1 : 1));
      return { p, execucoes };
    })
    .filter(({ p, execucoes }) => p.ativo || execucoes.length > 0)
    .flatMap(({ p, execucoes }) => {
      const eq = x.equipamentos.get(p.equipamento);
      if (!eq) return [];
      const s = situacaoDoPlano(p, x.hoje, x.antecedenciaPadrao);
      return [
        {
          plano: p.id,
          versaoModelo: p.modelo?.versao ?? modelo.versao,
          equipamento: eq,
          periodicidade: p.periodicidade,
          ativo: p.ativo,
          proxima: p.ativo ? s.proxima : null,
          situacao: p.ativo ? s.situacao : null,
          execucoes: execucoes.map((e) => ({
            data: e.data,
            resultado: e.resultado,
            laudo: e.laudo,
            observacao: e.observacao,
            por: e.por,
          })),
        },
      ];
    })
    .sort((a, b) => a.equipamento.codigo.localeCompare(b.equipamento.codigo, 'pt-BR'));
  return {
    ...x.emissao,
    de: x.de,
    ate: x.ate,
    norma: modelo.norma,
    responsavel: x.responsavel,
    itens,
  };
}
