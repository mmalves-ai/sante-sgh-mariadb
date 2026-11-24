// Fechamento da checagem do turno e leitura do produto e do lote na administração (03-PEP L113).
// Desenho próprio:
//   - o turno fecha com as pendências conhecidas: os horários resolvidos (administrado, não administrado com motivo,
//     suspenso) ficam travados no fechamento; os pendentes NÃO são travados (seguem para o próximo turno, que ainda pode
//     checar a dose atrasada) e, havendo algum, o fechamento exige a justificativa de quem fecha;
//   - o pendente passado adiante entra no fechamento do turno seguinte (turno anterior): ainda pendente, volta a ser
//     listado e justificado; resolvido depois, é travado por esse fechamento. Assim a dose atrasada nunca some da
//     passagem de plantão;
//   - o fechamento pode ser do setor inteiro ou de um só paciente (visão por paciente), e nunca é apagado: a correção é a
//     reabertura com motivo, que destrava os horários (o fechamento fica no histórico como "reaberto");
//   - a leitura à beira do leito liga a dose ao produto e ao lote do estoque, com o resultado da conferência; o que não
//     confere só segue com a justificativa de quem administra.

/** Situação do horário na checagem: P pendente, A administrado, p administrado em parte, N não administrado, S suspenso. */
export type LetraHorarioFechamento = 'P' | 'A' | 'p' | 'N' | 'S';

const RESOLVIDA = new Set(['A', 'p', 'N', 'S']);

export interface HorarioParaFechar {
  readonly id: number;
  readonly letra: string;
  /** O horário já está travado num fechamento ainda vigente (situação "fechado"). */
  readonly travado: boolean;
  /** O horário é de um turno anterior ao que fecha (chegou pendente a este turno). */
  readonly anterior?: boolean;
  /** O horário foi passado pendente por um fechamento anterior (consta como pendente na composição dele). */
  readonly passouPendente?: boolean;
}

export interface ResumoFechamento {
  readonly total: number;
  readonly administrados: number;
  readonly naoAdministrados: number;
  readonly suspensos: number;
  /** Pendentes: ficam fora da trava e são listados para o próximo turno. */
  readonly pendentes: readonly number[];
  /** Os horários resolvidos que este fechamento trava. */
  readonly aTravar: readonly number[];
  readonly jaTravados: number;
  /** Dos pendentes, os que vieram de turnos anteriores. */
  readonly pendentesAnteriores: readonly number[];
}

export function resumirFechamento(horarios: readonly HorarioParaFechar[]): ResumoFechamento {
  let administrados = 0;
  let naoAdministrados = 0;
  let suspensos = 0;
  let jaTravados = 0;
  const pendentes: number[] = [];
  const aTravar: number[] = [];
  const pendentesAnteriores: number[] = [];
  let total = 0;
  for (const h of horarios) {
    // Do turno anterior só entra o que ficou pendente: o pendente ainda aberto ou o que foi passado adiante pendente
    // e resolvido depois. O horário anterior que nunca esteve pendente num fechamento é do turno dele.
    if (h.anterior && !h.travado && RESOLVIDA.has(h.letra) && !h.passouPendente) continue;
    if (h.anterior && h.travado) continue;
    total++;
    if (h.letra === 'A' || h.letra === 'p') administrados++;
    else if (h.letra === 'N') naoAdministrados++;
    else if (h.letra === 'S') suspensos++;
    if (h.travado) {
      jaTravados++;
      continue;
    }
    if (RESOLVIDA.has(h.letra)) aTravar.push(h.id);
    else {
      pendentes.push(h.id);
      if (h.anterior) pendentesAnteriores.push(h.id);
    }
  }
  return {
    total,
    administrados,
    naoAdministrados,
    suspensos,
    pendentes,
    aTravar,
    jaTravados,
    pendentesAnteriores,
  };
}

export const JUSTIFICATIVA_MINIMA = 10;

export type RecusaFechamento =
  | { readonly codigo: 'turno-sem-horarios'; readonly mensagem: string }
  | { readonly codigo: 'turno-ja-fechado'; readonly mensagem: string }
  | { readonly codigo: 'pendencias-sem-justificativa'; readonly mensagem: string };

/** Confere se o turno pode fechar: nulo quando pode; senão, a recusa com a mensagem da tela. */
export function conferirFechamento(
  r: ResumoFechamento,
  justificativa: string | null,
): RecusaFechamento | null {
  if (r.total === 0)
    return { codigo: 'turno-sem-horarios', mensagem: 'Não há horários neste turno para fechar.' };
  if (r.aTravar.length === 0 && r.pendentes.length === 0)
    return { codigo: 'turno-ja-fechado', mensagem: 'Os horários deste turno já estão fechados.' };
  if (r.aTravar.length === 0)
    return {
      codigo: 'turno-sem-horarios',
      mensagem: 'Nenhum horário resolvido para fechar: checar ou registrar o não administrado antes.',
    };
  if (r.pendentes.length > 0 && (justificativa ?? '').trim().length < JUSTIFICATIVA_MINIMA)
    return {
      codigo: 'pendencias-sem-justificativa',
      mensagem: `Há ${r.pendentes.length} horário(s) pendente(s): justifique o fechamento com as pendências (mínimo de ${JUSTIFICATIVA_MINIMA} caracteres).`,
    };
  return null;
}

/** Confere a reabertura: só o fechamento vigente, sempre com o motivo. */
export function conferirReabertura(situacao: string, motivo: string | null): string | null {
  if (situacao !== 'fechado') return 'O fechamento já foi reaberto.';
  if ((motivo ?? '').trim().length < JUSTIFICATIVA_MINIMA)
    return `Informe o motivo da reabertura (mínimo de ${JUSTIFICATIVA_MINIMA} caracteres).`;
  return null;
}

export type ResultadoLeituraLote =
  'conforme' | 'produto_divergente' | 'lote_vencido' | 'lote_bloqueado' | 'nao_identificado';

export interface LeituraLote {
  /** Insumo achado pelo código do produto lido (GTIN), quando houve leitura. */
  readonly insumoDoCodigo: number | null;
  /** O lote do estoque achado pelo número lido. */
  readonly lote: { readonly insumo: number; readonly validade: string; readonly situacao: string } | null;
  /** Validade lida na etiqueta (AAAA-MM-DD), quando houve. */
  readonly validadeLida: string | null;
  /** Data (AAAA-MM-DD) da administração. */
  readonly dataAdministracao: string;
}

/** O resultado da conferência do produto e do lote lidos à beira do leito. */
export function resultadoLeituraLote(l: LeituraLote): ResultadoLeituraLote {
  if (l.insumoDoCodigo === null && l.lote === null) return 'nao_identificado';
  if (l.insumoDoCodigo !== null && l.lote !== null && l.lote.insumo !== l.insumoDoCodigo)
    return 'produto_divergente';
  if (l.lote && l.lote.situacao === 'vencido') return 'lote_vencido';
  if (l.lote && l.lote.situacao !== 'liberado') return 'lote_bloqueado';
  const validade = l.lote?.validade ?? l.validadeLida;
  if (validade !== null && validade < l.dataAdministracao) return 'lote_vencido';
  return 'conforme';
}

/** A justificativa de seguir com a leitura que não confere: nula quando confere; senão o texto, ou a recusa. */
export function justificativaDaLeitura(
  resultado: ResultadoLeituraLote,
  texto: string | null,
): { readonly justificativa: string | null } | { readonly recusa: string } {
  if (resultado === 'conforme') return { justificativa: null };
  const t = (texto ?? '').trim();
  if (t.length < JUSTIFICATIVA_MINIMA)
    return {
      recusa: `A leitura do produto ou do lote não confere (${resultado.replace('_', ' ')}): registre na observação por que a dose segue.`,
    };
  return { justificativa: t.slice(0, 500) };
}

export interface EtiquetaLida {
  /** Código do produto (GTIN, código interno ou o texto lido quando não é GS1). */
  readonly codigo: string;
  readonly lote: string | null;
  /** Validade (AAAA-MM-DD) lida da etiqueta GS1, quando houver. */
  readonly validade: string | null;
  readonly meio: 'codigo_barras' | 'datamatrix';
}

const GS = String.fromCharCode(29);

/** Validade GS1 (AAMMDD; dia 00 é o último dia do mês) em AAAA-MM-DD; nula quando inválida. */
function validadeGs1(v: string): string | null {
  if (!/^\d{6}$/.test(v)) return null;
  const ano = 2000 + Number(v.slice(0, 2));
  const mes = Number(v.slice(2, 4));
  let dia = Number(v.slice(4, 6));
  if (mes < 1 || mes > 12) return null;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia === 0) dia = ultimo;
  if (dia > ultimo) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Lê a etiqueta à beira do leito. O código bidimensional GS1 (DataMatrix, com o prefixo de símbolo "]d2", os
 * identificadores entre parênteses ou o separador GS) traz o GTIN (01), a validade (17) e o lote (10); o código de
 * barras linear traz só o código do produto.
 */
export function lerEtiqueta(texto: string): EtiquetaLida {
  const bruto = texto.trim();
  const comParenteses = /^\(01\)/.test(bruto);
  const comPrefixo = bruto.startsWith(']d2') || bruto.startsWith(']Q3');
  const corpo = comPrefixo ? bruto.slice(3) : bruto;
  const elementar = /^01\d{14}/.test(corpo) && (comPrefixo || corpo.includes(GS) || corpo.length > 16);
  if (!comParenteses && !elementar)
    return { codigo: bruto, lote: null, validade: null, meio: 'codigo_barras' };
  const campos = new Map<string, string>();
  if (comParenteses) {
    for (const m of corpo.matchAll(/\((\d{2})\)([^(]*)/g)) campos.set(m[1]!, m[2]!.trim());
  } else {
    let resto = corpo;
    while (resto.length >= 2) {
      const ia = resto.slice(0, 2);
      resto = resto.slice(2);
      const fixo = ia === '01' || ia === '02' ? 14 : ia === '11' || ia === '17' ? 6 : 0;
      if (fixo) {
        campos.set(ia, resto.slice(0, fixo));
        resto = resto.slice(fixo);
        if (resto.startsWith(GS)) resto = resto.slice(1);
      } else {
        const fim = resto.indexOf(GS);
        campos.set(ia, fim < 0 ? resto : resto.slice(0, fim));
        resto = fim < 0 ? '' : resto.slice(fim + 1);
      }
    }
  }
  const gtin = (campos.get('01') ?? '').replace(/^0(?=\d{13}$)/, '');
  return {
    codigo: gtin || bruto,
    lote: campos.get('10')?.slice(0, 50) || null,
    validade: campos.has('17') ? validadeGs1(campos.get('17')!) : null,
    meio: 'datamatrix',
  };
}
