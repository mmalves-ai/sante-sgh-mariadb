// Legendas do novo para códigos de domínio (M14; ficha, seção 8, regras 7, 8, 9 e 13; ref 02 §1; Anexo A):
//   - situação de agenda: a legenda canônica é a do domínio novo de situações (16 códigos); a antiga (14) só
//     traduz o que já foi gravado; pela legenda oficial, C é "Confirmado" e X é "Cancelado";
//   - checagem da enfermagem: os 14 códigos distinguem maiúsculas e minúsculas (P e p, E e e, N e n): nenhuma
//     busca ou validação os converte;
//   - código em uso sem linha no domínio (o ato 90 dos métodos gráficos): legenda "(a confirmar)", sem gravar
//     linha nova no banco;
//   - motivo de alta: o grupo do indicador (óbito, transferência externa, internação domiciliar, evasão ou a
//     pedido, encerramento administrativo, alta domiciliar), usado pelo censo e pelo painel de leitos.
// Só regras e textos de produto; nenhum nome de tabela.

/** Sufixo das legendas de baixa confiança (DP-46). */
export const A_CONFIRMAR = '(a confirmar)';

/** Situação de agenda pela legenda oficial (os demais códigos vêm do próprio domínio). */
export const SITUACAO_AGENDA_OFICIAL: Readonly<Record<string, string>> = {
  C: 'Confirmado',
  X: 'Cancelado',
};

export function legendaSituacaoAgenda(codigo: string, doDominio?: string | null): string {
  return SITUACAO_AGENDA_OFICIAL[codigo] ?? doDominio ?? `${codigo} ${A_CONFIRMAR}`;
}

/** Os 14 códigos da checagem (sensíveis a maiúsculas: P ≠ p, E ≠ e, N ≠ n). */
export const CODIGOS_CHECAGEM = [
  'P',
  'p',
  'A',
  'N',
  'S',
  'X',
  'C',
  'O',
  'I',
  'E',
  'B',
  'e',
  'n',
  'l',
] as const;

/** Comparação exata (sem trocar caixa nem tirar espaço do meio): o código é o que está gravado. */
export function mesmoCodigo(a: string, b: string): boolean {
  return a.replace(/ +$/, '') === b.replace(/ +$/, '');
}

/** Códigos em uso no movimento que não têm linha no domínio (ref 02 §1; levantamento do M14). */
export const CODIGOS_SEM_LINHA: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  /** Ato do exame (lançamentos do SADT): 90 = métodos gráficos. */
  ato: { '90': `Métodos gráficos ${A_CONFIRMAR}` },
  /** Item do atendimento: 0 = "não informado" (sentinela do legado, ref 02 §3; medido em 21/10/2026). */
  itemAtendimento: { '0': `Não informado ${A_CONFIRMAR}` },
};

/** Legenda de um código de domínio: a do domínio, ou a "a confirmar" do código em uso sem linha. */
export function legendaDoCodigo(
  dominio: keyof typeof CODIGOS_SEM_LINHA | string,
  codigo: string,
  doDominio?: string | null,
): string {
  if (doDominio) return doDominio;
  return CODIGOS_SEM_LINHA[dominio]?.[codigo] ?? `${codigo} ${A_CONFIRMAR}`;
}

export const GRUPOS_MOTIVO_ALTA = [
  'obito',
  'transferencia-externa',
  'internacao-domiciliar',
  'evasao-ou-a-pedido',
  'encerramento-administrativo',
  'alta-domiciliar',
] as const;
export type GrupoMotivoAlta = (typeof GRUPOS_MOTIVO_ALTA)[number];

export const ROTULO_GRUPO_MOTIVO_ALTA: Readonly<Record<GrupoMotivoAlta, string>> = {
  obito: 'Óbito',
  'transferencia-externa': 'Transferência externa',
  'internacao-domiciliar': 'Internação domiciliar',
  'evasao-ou-a-pedido': 'Evasão ou alta a pedido',
  'encerramento-administrativo': 'Encerramento administrativo',
  'alta-domiciliar': 'Alta domiciliar',
};

const faixa = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);
const OBITO = new Set([...faixa(40, 46), ...faixa(52, 54), ...faixa(65, 67)]);

/** Grupo do indicador do motivo de alta (Anexo A §A.4; cap-05a §5.4): todo código tem grupo. */
export function grupoMotivoAlta(codigo: number): GrupoMotivoAlta {
  if (OBITO.has(codigo)) return 'obito';
  if (codigo === 31) return 'transferencia-externa';
  if (codigo === 10 || codigo === 29 || codigo === 32) return 'internacao-domiciliar';
  if (codigo === 14 || codigo === 16) return 'evasao-ou-a-pedido';
  if (codigo === 51) return 'encerramento-administrativo';
  return 'alta-domiciliar';
}

/** Legenda do tipo declarado (domínio) — o tipo da declaração, sem depender dela (contratos sem tabela). */
export type TipoLegenda =
  | { readonly tipo: 'situacao-agenda' }
  | { readonly tipo: 'motivo-alta' }
  | { readonly tipo: 'codigos-sem-linha'; readonly dominio: string };

/** Rótulo da coluna de legenda na tela (sem legenda própria por item: nenhum). */
export function rotuloDaLegenda(l: TipoLegenda | undefined): string | undefined {
  if (!l) return undefined;
  if (l.tipo === 'situacao-agenda') return 'Legenda oficial';
  if (l.tipo === 'motivo-alta') return 'Grupo do indicador';
  return undefined;
}

export interface ItemComLegenda {
  readonly codigo: string;
  readonly ativo: boolean;
  readonly valores: Readonly<Record<string, string | number | null>>;
  readonly versao: string;
  readonly legenda?: string | undefined;
  readonly aConfirmar?: boolean | undefined;
}

/**
 * Aplica a legenda do novo aos itens lidos do domínio (regras 7, 9 e 13): situação de agenda pela legenda
 * oficial (C, X; os demais com a descrição do próprio domínio), grupo do indicador do motivo de alta e, nos
 * códigos em uso sem linha, um item só de leitura "(a confirmar)" (nada é gravado no banco).
 */
export function aplicarLegenda<T extends ItemComLegenda>(
  l: TipoLegenda | undefined,
  itens: readonly T[],
  campoDescricao: string,
): ItemComLegenda[] {
  if (!l) return [...itens];
  if (l.tipo === 'situacao-agenda')
    return itens.map((i) => ({
      ...i,
      legenda: legendaSituacaoAgenda(
        i.codigo.replace(/ +$/, ''),
        typeof i.valores[campoDescricao] === 'string' ? (i.valores[campoDescricao] as string) : null,
      ),
    }));
  if (l.tipo === 'motivo-alta')
    return itens.map((i) => {
      const n = Number(i.codigo);
      return Number.isInteger(n) ? { ...i, legenda: ROTULO_GRUPO_MOTIVO_ALTA[grupoMotivoAlta(n)] } : i;
    });
  const semLinha = CODIGOS_SEM_LINHA[l.dominio] ?? {};
  const existentes = new Set(itens.map((i) => i.codigo));
  const virtuais: ItemComLegenda[] = Object.entries(semLinha)
    .filter(([c]) => !existentes.has(c))
    .map(([codigo, texto]) => ({
      codigo,
      ativo: true,
      valores: { [campoDescricao]: texto },
      versao: '',
      aConfirmar: true,
    }));
  return [...itens, ...virtuais];
}
