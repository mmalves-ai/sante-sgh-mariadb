// Regras do registro do prontuário (ficha do M15): escolha da fonte por registro (regra 3), marcas legais
// visíveis (regra 8) e as exceções que aparecem em vez de sumir (regra 9). Puras: a API monta a entrada a
// partir do que o adaptador leu ao vivo.
import type { ComoEmitido, Marcas } from '@sgh/contratos';

export interface CabecalhoRegistro {
  /** AAAA-MM-DDTHH:MM:SS do ato clínico (o relógio do estabelecimento, como gravado). */
  readonly dataHora: string | null;
  readonly lancadoEm: string | null;
  readonly suspensoEm: string | null;
  readonly justificativaSuspensao: string | null;
  readonly corrigeRegistro: number | null;
  readonly justificativaRetroativo: string | null;
  readonly supervisor: number | null;
  readonly temConteudo: boolean;
  /** Situações dos eventos do documento (ex.: 1 lançado, 2 suspenso, 12 suspenso por correção). */
  readonly situacoesDocumento: readonly number[];
  /** Tipo de documento da trilha documental (1 "somente lançamento": sem assinatura ICP). */
  readonly tiposDocumento: readonly number[];
}

export interface FontesDisponiveis {
  readonly documento: boolean;
  readonly layout: boolean;
  readonly texto: boolean;
}

/** Situação "Suspenso" e "Suspenso por correção" do cadastro de situações do documento. */
export const SITUACOES_SUSPENSO: ReadonlySet<number> = new Set([2, 12]);
/** Tipo de documento "Somente lançamento" (100% dos registros): registro eletrônico sem assinatura ICP. */
export const TIPO_SOMENTE_LANCAMENTO = 1;

/** A data do ato é impossível (sentinela, antes de 1900 ou mais de um dia no futuro). */
export function dataImpossivel(dataHora: string | null, agora: Date): boolean {
  if (!dataHora) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataHora);
  if (!m) return true;
  const ano = Number(m[1]);
  if (ano < 1900) return true;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return !Number.isFinite(t) || t > agora.getTime() + 86_400_000;
}

/** AAAA-MM-DDTHH:MM (a tela não mostra os segundos), ou null. */
export function minutos(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(v);
  return m ? `${m[1]}T${m[2]}` : null;
}

export function marcasDoRegistro(c: CabecalhoRegistro, agora: Date): Marcas {
  const suspensoPorDocumento = c.situacoesDocumento.some((s) => SITUACOES_SUSPENSO.has(s));
  const impossivel = dataImpossivel(c.dataHora, agora);
  return {
    suspenso: c.suspensoEm !== null || suspensoPorDocumento,
    suspensoEm: minutos(c.suspensoEm),
    justificativaSuspensao: c.justificativaSuspensao?.trim() || null,
    corrigeRegistro: c.corrigeRegistro && c.corrigeRegistro > 0 ? c.corrigeRegistro : null,
    retroativo: Boolean(c.justificativaRetroativo?.trim()),
    justificativaRetroativo: c.justificativaRetroativo?.trim() || null,
    supervisao: c.supervisor !== null && c.supervisor > 0,
    semConteudo: !c.temConteudo,
    dataImpossivel: impossivel,
    // Todo registro do legado é "somente lançamento" (nenhum documento com assinatura ICP).
    semAssinaturaIcp:
      c.tiposDocumento.length === 0 || c.tiposDocumento.every((t) => t === TIPO_SOMENTE_LANCAMENTO),
  };
}

/**
 * Escolha da fonte do "como emitido" (regra 3; cap-11 §11.1, tabela de fidelidade): o documento emitido (03/2022
 * em diante); sem ele, o layout da época com o cabeçalho dos retratos; sem layout, o texto formatado.
 */
export function fonteComoEmitido(f: FontesDisponiveis): ComoEmitido['fonte'] {
  if (f.documento) return 'documento';
  if (f.layout) return 'layout';
  if (f.texto) return 'texto';
  return 'nenhuma';
}

export const AVISO_SEM_DOCUMENTO =
  'Este registro não tem o documento emitido guardado: o conteúdo abaixo é o do formulário gravado com o registro, com o cabeçalho do momento do ato.';
export const AVISO_SO_TEXTO =
  'Este registro não tem o formulário gravado: o conteúdo abaixo é o texto formatado do registro.';
export const AVISO_SEM_CONTEUDO =
  'Registro sem conteúdo: o cabeçalho existe, mas o conteúdo não foi gravado. O caso vai ao relatório do arquivo médico.';
export const AVISO_ILEGIVEL =
  'O conteúdo deste registro não pôde ser lido (dado ilegível). As outras abas continuam disponíveis; avise o arquivo médico.';
