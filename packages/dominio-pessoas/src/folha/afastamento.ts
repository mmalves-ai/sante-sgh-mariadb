// Afastamento do colaborador (M53-F0; ficha do M53, seção 1: a exportação leva os afastamentos; D-AFAST-531): o motivo
// vem do domínio de motivos de afastamento do ramo (FPMOTAFAST, lido na hora), o período fica dentro do vínculo e não se
// sobrepõe a outro afastamento em vigor do mesmo vínculo. Encerrar é informar o fim (uma vez); cancelar exige motivo e
// nunca apaga (fica para a trilha).
import type { RecusaSesmt } from '../sesmt/recusa.js';

export type RecusaFolha = RecusaSesmt;

const recusa = (codigo: string, mensagem: string, campo: string | null = null): RecusaFolha => ({
  codigo,
  mensagem,
  campo,
});

export interface AfastamentoLido {
  readonly id: number;
  readonly vinculo: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly situacao: string;
}

export interface VinculoDoAfastamento {
  readonly admissao: string;
  readonly desligamento: string | null;
}

/** Os dois períodos se tocam (fim null: sem fim). */
export function periodosSeSobrepoem(
  a: { inicio: string; fim: string | null },
  b: { inicio: string; fim: string | null },
): boolean {
  return a.inicio <= (b.fim ?? '9999-12-31') && b.inicio <= (a.fim ?? '9999-12-31');
}

export function conferirAfastamento(
  novo: { inicio: string; fim: string | null; motivo: number },
  vinculo: VinculoDoAfastamento,
  doVinculo: readonly AfastamentoLido[],
  motivos: ReadonlySet<number>,
  ignorar: number | null = null,
): RecusaFolha | null {
  if (!motivos.has(novo.motivo))
    return recusa('motivo-inexistente', 'O motivo do afastamento não está cadastrado.', 'motivo');
  if (novo.fim !== null && novo.fim < novo.inicio)
    return recusa('fim-antes-do-inicio', 'O fim do afastamento é anterior ao início.', 'fim');
  if (novo.inicio < vinculo.admissao)
    return recusa('antes-da-admissao', 'O afastamento começa antes da admissão do colaborador.', 'inicio');
  if (vinculo.desligamento !== null && (novo.fim === null || novo.fim > vinculo.desligamento))
    return recusa(
      'depois-do-desligamento',
      'O colaborador foi desligado: o afastamento termina até a data do desligamento.',
      'fim',
    );
  const outro = doVinculo.find(
    (a) => a.id !== ignorar && a.situacao === 'ativo' && periodosSeSobrepoem(a, novo),
  );
  if (outro)
    return recusa(
      'sobreposto',
      `O período coincide com outro afastamento em vigor do colaborador (desde ${outro.inicio}).`,
      'inicio',
    );
  return null;
}

/** Encerrar: só o em vigor e ainda sem fim; o fim passa pelas mesmas regras do registro. */
export function conferirEncerramentoAfastamento(
  a: AfastamentoLido & { readonly motivo: number },
  fim: string,
  vinculo: VinculoDoAfastamento,
  doVinculo: readonly AfastamentoLido[],
  motivos: ReadonlySet<number>,
): RecusaFolha | null {
  if (a.situacao !== 'ativo') return recusa('cancelado', 'O afastamento foi cancelado.');
  if (a.fim !== null) return recusa('ja-encerrado', 'O afastamento já tem data de fim.', 'fim');
  return conferirAfastamento({ inicio: a.inicio, fim, motivo: a.motivo }, vinculo, doVinculo, motivos, a.id);
}

/** Cancelar: só o em vigor; o motivo é obrigatório (o contrato já confere o texto). */
export function conferirCancelamentoAfastamento(a: AfastamentoLido): RecusaFolha | null {
  return a.situacao !== 'ativo' ? recusa('cancelado', 'O afastamento já foi cancelado.') : null;
}
