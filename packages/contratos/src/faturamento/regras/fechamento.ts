// Fechar e reabrir a conta (ficha do M30, regra 4 e campo 5; ref 01 §3.8; `sante-api: src/services/acoes-conta.js`).
// Os vetos na ordem da sante-api, cada um com o motivo em português (o erro cru do banco nunca chega à tela): aberta;
// com remessa; emitida (data de emissão real e IND_EMI 'T'); pacote com valor já visto; com itens; total igual à soma
// dos itens (meio centavo), salvo a conta por pacote (C); o pré-voo das 4 exceções do gatilho da conta (o médico
// solicitante e o da conta no cadastro de profissionais, o procedimento solicitado na tabela do convênio, o título a
// receber existente); nenhuma pendência bloqueante. A reabertura só de S para N, fora de lote, com supervisor e motivo.
import { recusaFat, type RecusaFaturamento, TOLERANCIA_CENTAVO, reaisTexto } from './recusa.js';

/** Valores de FCCTAEXT.PACOTE já vistos (Anexo A); P, D e F "a confirmar" (DP-46.5). */
export const PACOTES_CONTA_VISTOS = ['N', 'C', 'P', 'D', 'F', ''] as const;

/** O retrato da conta relido sob a trava (o que os vetos leem). */
export interface ContaParaFechar {
  readonly fechada: string | null;
  readonly remessa: number | null;
  /** DATA_EMI como AAAA-MM-DD (null ou anterior a 1900: sentinela). */
  readonly dataEmissao: string | null;
  readonly indEmi: string | null;
  readonly pacote: string | null;
  readonly itens: number;
  readonly somaItens: number;
  readonly totalConta: number | null;
  /** Pré-voo de TRG_FCCTAEXT_BIU (a mesma forma que o gatilho avalia). */
  readonly preVoo: {
    readonly medicoSolicitanteValido: boolean;
    readonly medicoContaValido: boolean;
    readonly procedimentoNaTabela: boolean;
    readonly tituloReceberExiste: boolean;
  };
  /** Pendências bloqueantes abertas em SGH_FAT_PENDENCIA. */
  readonly pendenciasBloqueantes: number;
}

const ehDataReal = (d: string | null): boolean =>
  !!d && /^\d{4}-\d{2}-\d{2}/.test(d) && d.slice(0, 10) >= '1900-01-01';

/** Os vetos do fechamento, na ordem da sante-api; o primeiro que falha é a recusa (null: pode fechar). */
export function conferirFechamento(c: ContaParaFechar): RecusaFaturamento | null {
  const fechada = (c.fechada ?? '').trim().toUpperCase();
  if (fechada === 'S') return recusaFat('conta-ja-fechada', 'A conta já está fechada.');
  if (fechada === 'A') return recusaFat('conta-apresentada', 'A conta já foi apresentada à operadora.');
  if (fechada !== 'N')
    return recusaFat('situacao-invalida', 'A situação desta conta é inválida; não é possível fechar.');
  if (!c.remessa)
    return recusaFat('sem-remessa', 'A conta ainda não tem remessa; emita a conta antes de fechar.');
  if (!ehDataReal(c.dataEmissao))
    return recusaFat('nao-emitida', 'A conta ainda não foi emitida; emita a conta antes de fechar.');
  if ((c.indEmi ?? '').trim().toUpperCase() !== 'T')
    return recusaFat('nao-emitida', 'A conta ainda não foi emitida; emita a conta antes de fechar.');
  const pacote = (c.pacote ?? '').trim().toUpperCase();
  if (!(PACOTES_CONTA_VISTOS as readonly string[]).includes(pacote))
    return recusaFat('pacote-desconhecido', `O tipo de pacote da conta (${pacote}) não é conhecido.`);
  if (c.itens <= 0) return recusaFat('conta-sem-itens', 'A conta não tem itens lançados.');
  if (pacote !== 'C' && Math.abs((c.totalConta ?? 0) - c.somaItens) > TOLERANCIA_CENTAVO)
    return recusaFat(
      'total-diverge',
      `O total da conta (${reaisTexto(c.totalConta ?? 0)}) difere da soma dos itens (${reaisTexto(c.somaItens)}); confira os lançamentos.`,
    );
  if (!c.preVoo.medicoSolicitanteValido)
    return recusaFat(
      'solicitante-invalido',
      'O médico solicitante da conta não está no cadastro de profissionais; corrija o solicitante antes de fechar.',
      ['solicitante'],
    );
  if (!c.preVoo.medicoContaValido)
    return recusaFat(
      'medico-conta-invalido',
      'O médico responsável pela conta não está no cadastro de profissionais; corrija antes de fechar.',
    );
  if (!c.preVoo.procedimentoNaTabela)
    return recusaFat(
      'procedimento-fora-da-tabela',
      'O procedimento solicitado não está na tabela de honorários do convênio; corrija antes de fechar.',
    );
  if (!c.preVoo.tituloReceberExiste)
    return recusaFat(
      'titulo-inexistente',
      'O título a receber ligado à conta não existe; corrija antes de fechar.',
    );
  if (c.pendenciasBloqueantes > 0)
    return recusaFat(
      'com-pendencia-bloqueante',
      `A conta tem ${c.pendenciasBloqueantes} pendência(s) que impedem o fechamento; resolva-as antes.`,
    );
  return null;
}

export interface ContaParaReabrir {
  readonly fechada: string | null;
  /** Lotes TISS em que a conta está. */
  readonly lotesTiss: number;
  readonly supervisor: boolean;
  readonly motivo: string;
}

/** Regra 4: reabrir só de S para N, antes da apresentação e fora de lote, com supervisor e motivo. */
export function conferirReabertura(c: ContaParaReabrir): RecusaFaturamento | null {
  const fechada = (c.fechada ?? '').trim().toUpperCase();
  if (fechada === 'N') return recusaFat('conta-ja-aberta', 'A conta já está aberta.');
  if (fechada === 'A')
    return recusaFat(
      'conta-apresentada',
      'A conta já foi apresentada à operadora e não pode ser reaberta; use o recurso de glosa ou a conta complementar.',
    );
  if (fechada !== 'S')
    return recusaFat('situacao-invalida', 'A situação desta conta é inválida; não é possível reabrir.');
  if (c.lotesTiss > 0)
    return recusaFat('em-lote', 'A conta está em um lote TISS; retire-a do lote antes de reabrir.');
  if (!c.supervisor)
    return recusaFat('sem-supervisor', 'Só o supervisor do faturamento reabre conta fechada.');
  if (c.motivo.trim().length < 5)
    return recusaFat('motivo-obrigatorio', 'Informe o motivo da reabertura (ao menos 5 letras).', ['motivo']);
  return null;
}
