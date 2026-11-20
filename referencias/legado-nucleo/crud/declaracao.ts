// CRUD genérico (M08; roteiro 4.8 e 6.5): a declaração física de um domínio do legado (tabela, chave,
// colunas, codec por coluna) e o que sai dela sem banco: o Zod de entrada de cada operação (tamanho em bytes
// CP1252, inteiro no intervalo do tipo, letra só entre os valores já vistos, hora HH:MM), a conversão
// linha → valores da tela e valores da tela → parâmetros da gravação, e a descrição pública do domínio.
// A conferência da declaração contra os catálogos é pura (@sgh/dominio-config, validarDeclaracao) e roda no
// `pnpm matriz:verificar` e no teste das declarações.
import {
  type CampoDescrito,
  cnsValido,
  cpfValido,
  type ColunaDeclarada,
  type DeclaracaoDominio,
  esquemaTextoCp1252,
  type ValorCampo,
} from '@sgh/contratos';
import { z } from 'zod';
import { deCivil, paraCivil } from '../codec.js';
import type { Linha } from '../driver.js';

const COLUNA = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** Declara o domínio: confere nomes e devolve a declaração congelada (a única fonte; regra 1). */
export function declararCadastroLegado(d: DeclaracaoDominio): DeclaracaoDominio {
  for (const n of [d.tabela, d.chave, ...(d.chaveComposta ?? []), ...d.colunas.map((c) => c.coluna)]) {
    if (!COLUNA.test(n)) throw new Error(`Declaração ${d.publico.recurso}: nome de objeto inválido (${n}).`);
  }
  for (const k of chavesDe(d))
    if (!d.colunas.some((c) => c.coluna === k))
      throw new Error(`Declaração ${d.publico.recurso}: chave ausente (${k}).`);
  if (d.chaveComposta && d.chaveComposta[0] !== d.chave)
    throw new Error(`Declaração ${d.publico.recurso}: a chave composta começa pela chave declarada.`);
  return Object.freeze(d);
}

/** Colunas da chave primária (uma, ou a composta do M14). */
export function chavesDe(d: DeclaracaoDominio): readonly string[] {
  return d.chaveComposta ?? [d.chave];
}

export function colunaDaChave(d: DeclaracaoDominio): ColunaDeclarada {
  const c = d.colunas.find((x) => x.coluna === d.chave);
  if (!c) throw new Error('Declaração sem a coluna da chave.');
  return c;
}

/** Colunas declaradas da chave, na ordem da chave. */
export function colunasDaChave(d: DeclaracaoDominio): ColunaDeclarada[] {
  return chavesDe(d).map((k) => {
    const c = d.colunas.find((x) => x.coluna === k);
    if (!c) throw new Error('Declaração sem a coluna da chave.');
    return c;
  });
}

/** Cláusula WHERE pela chave (`A = ? AND B = ?`). */
export function condicaoDaChave(d: DeclaracaoDominio): string {
  return chavesDe(d)
    .map((k) => `${k} = ?`)
    .join(' AND ');
}

/** Ordem da lista: a chave inteira. */
export function ordemDaChave(d: DeclaracaoDominio): string {
  return chavesDe(d).join(', ');
}

const SEPARADOR = '|';
const escapar = (v: string) => v.replace(/%/g, '%25').replace(/\|/g, '%7C');
const desescapar = (v: string) => v.replace(/%7C/gi, '|').replace(/%25/g, '%');

export function colunaDoCampo(d: DeclaracaoDominio, campo: string): ColunaDeclarada | undefined {
  return d.colunas.find((c) => c.campo === campo);
}

/** Colunas que a lista e o item leem (a chave, as declaradas e a situação). */
export function colunasLidas(d: DeclaracaoDominio): string[] {
  return [
    ...new Set([
      ...chavesDe(d),
      ...d.colunas.map((c) => c.coluna),
      ...(d.situacao ? [d.situacao.coluna] : []),
    ]),
  ];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const AAAAMMDD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valor do banco → valor da tela (texto sem o preenchimento do CHAR; hora HH:MM; número). */
export function valorDaColuna(c: ColunaDeclarada, bruto: unknown): ValorCampo {
  const v = valorBrutoDaColuna(c, bruto);
  // M24: a sentinela do "vazio" do legado (1899-12-30 da vigência sem fim) aparece vazia na tela.
  return c.sentinelaVazio !== undefined && v === c.sentinelaVazio ? null : v;
}

function valorBrutoDaColuna(c: ColunaDeclarada, bruto: unknown): ValorCampo {
  if (bruto === null || bruto === undefined) return null;
  switch (c.tipo) {
    case 'texto':
    case 'letra':
      return String(bruto).replace(/ +$/, '');
    case 'inteiro':
    case 'referencia':
    case 'decimal': {
      const n = typeof bruto === 'bigint' ? Number(bruto) : Number(bruto);
      return Number.isFinite(n) ? n : String(bruto);
    }
    case 'hora': {
      if (!(bruto instanceof Date)) return String(bruto);
      const civ = paraCivil(bruto);
      return `${String(civ.hora ?? 0).padStart(2, '0')}:${String(civ.minuto ?? 0).padStart(2, '0')}`;
    }
    case 'data': {
      if (!(bruto instanceof Date)) return String(bruto);
      const civ = paraCivil(bruto);
      return `${String(civ.ano).padStart(4, '0')}-${String(civ.mes).padStart(2, '0')}-${String(civ.dia).padStart(2, '0')}`;
    }
  }
}

/** Valor da tela → parâmetro da gravação (hora em TIMESTAMP 1899-12-30 HH:MM, como o TDateTime do Delphi). */
export function valorParaColuna(c: ColunaDeclarada, v: ValorCampo | undefined): unknown {
  // M24: o vazio da tela grava a sentinela do legado (nunca NULL onde o perfil não tem NULL).
  if ((v === undefined || v === null || v === '') && c.sentinelaVazio !== undefined) {
    const { sentinelaVazio, ...semSentinela } = c;
    return valorParaColuna(semSentinela, sentinelaVazio);
  }
  if (v === undefined || v === null) return null;
  if (c.tipo === 'hora') {
    const m = HHMM.exec(String(v));
    if (!m) throw new Error('Hora fora do formato HH:MM.');
    return deCivil({ ano: 1899, mes: 12, dia: 30, hora: Number(m[1]), minuto: Number(m[2]), segundo: 0 });
  }
  if (c.tipo === 'data') {
    const m = AAAAMMDD.exec(String(v));
    if (!m) throw new Error('Data fora do formato AAAA-MM-DD.');
    return deCivil({
      ano: Number(m[1]),
      mes: Number(m[2]),
      dia: Number(m[3]),
      hora: 0,
      minuto: 0,
      segundo: 0,
    });
  }
  return v;
}

/** Código exposto (texto) e valores da tela de uma linha lida. */
export function itemDaLinha(
  d: DeclaracaoDominio,
  linha: Linha,
): { codigo: string; ativo: boolean; valores: Record<string, ValorCampo> } {
  const valores: Record<string, ValorCampo> = {};
  for (const c of d.colunas) valores[c.campo] = valorDaColuna(c, linha[c.coluna]);
  const situacao = d.situacao ? String(linha[d.situacao.coluna] ?? '').trim() : null;
  return {
    codigo: codigoDaLinha(d, linha),
    // Situação NULL conta como ativo (o legado grava a letra de ativo ou deixa vazio na inclusão antiga).
    ativo: !d.situacao || situacao !== d.situacao.inativo,
    valores,
  };
}

/** Código exposto de uma linha: o valor da chave (composta: os valores com `|`). */
export function codigoDaLinha(d: DeclaracaoDominio, linha: Linha): string {
  return colunasDaChave(d)
    .map((c) => {
      const v = valorDaColuna(c, linha[c.coluna]);
      return d.chaveComposta ? escapar(String(v ?? '')) : String(v ?? '');
    })
    .join(SEPARADOR);
}

/** Código exposto a partir dos valores da tela (inclusão com chave digitada). */
export function codigoDosValores(
  d: DeclaracaoDominio,
  valores: Readonly<Record<string, ValorCampo>>,
): string {
  return colunasDaChave(d)
    .map((c) => (d.chaveComposta ? escapar(String(valores[c.campo] ?? '')) : String(valores[c.campo] ?? '')))
    .join(SEPARADOR);
}

/** Valor da chave: número, texto ou (M53, TBTABIRR) data, convertida como a coluna (AAAA-MM-DD → DATE). */
export type ValorChave = number | string | Date;

function valorDaChave(c: ColunaDeclarada, texto: string): ValorChave {
  if (c.tipo === 'inteiro' || c.tipo === 'referencia') {
    if (!/^-?\d{1,10}$/.test(texto)) throw new Error('Código inválido.');
    return Number(texto);
  }
  // M53 (etapa F1): chave do tipo data (a vigência da tabela legal): a data civil da rota vira o DATE do parâmetro.
  if (c.tipo === 'data') {
    if (!AAAAMMDD.test(texto) || !dataCivilValida(texto)) throw new Error('Código inválido.');
    return valorParaColuna(c, texto) as Date;
  }
  return texto;
}

/** Converte o código exposto (texto da rota) no valor da chave (a primeira coluna, na chave simples). */
export function chaveDoCodigo(d: DeclaracaoDominio, codigo: string): ValorChave {
  return valorDaChave(
    colunaDaChave(d),
    d.chaveComposta ? desescapar(codigo.split(SEPARADOR)[0] ?? '') : codigo,
  );
}

/** Valores da chave na ordem de `condicaoDaChave` (parâmetros do WHERE). */
export function valoresDaChave(d: DeclaracaoDominio, codigo: string): ValorChave[] {
  const cols = colunasDaChave(d);
  if (!d.chaveComposta) return [valorDaChave(cols[0]!, codigo)];
  const partes = codigo.split(SEPARADOR);
  if (partes.length !== cols.length) throw new Error('Código inválido.');
  return cols.map((c, i) => valorDaChave(c, desescapar(partes[i] ?? '')));
}

/** Chave como objeto coluna → valor (trava da linha no executor). */
export function chaveComoObjeto(d: DeclaracaoDominio, codigo: string): Record<string, ValorChave> {
  const v = valoresDaChave(d, codigo);
  return Object.fromEntries(chavesDe(d).map((k, i) => [k, v[i]!]));
}

/** Data civil existente (o ano 9999 do feriado recorrente é aceito). */
function dataCivilValida(v: string): boolean {
  const m = AAAAMMDD.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
}

function esquemaCampo(c: ColunaDeclarada): z.ZodType<ValorCampo> {
  let e: z.ZodType<ValorCampo>;
  switch (c.tipo) {
    case 'texto': {
      const base = esquemaTextoCp1252({ maxBytes: c.maxBytes ?? 1 });
      // M23: hora em texto HHMM (PRHORPAD.HORARIO), como o legado grava.
      // M54.1: texto só com algarismos (a ordem de 4 dígitos), vazio aceito quando não é obrigatório.
      const t =
        c.formatoTexto === 'HHMM'
          ? base.pipe(z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, 'Hora no formato HHMM.'))
          : c.formatoTexto === 'digitos'
            ? base.pipe(z.string().regex(/^\d*$/, 'Use só algarismos.'))
            : base;
      e = (
        c.obrigatorio && c.padraoNaInclusao === undefined
          ? t.pipe(z.string().min(1, 'Campo obrigatório.'))
          : t
      ) as z.ZodType<ValorCampo>;
      break;
    }
    case 'letra':
      e = z.enum((c.valores ?? []).map((v) => v.valor) as [string, ...string[]]) as z.ZodType<ValorCampo>;
      break;
    case 'hora':
      e = z.string().regex(HHMM, 'Hora no formato HH:MM.') as z.ZodType<ValorCampo>;
      break;
    case 'data':
      e = z
        .string()
        .regex(AAAAMMDD, 'Data no formato AAAA-MM-DD.')
        .refine(dataCivilValida, 'Data inexistente.') as z.ZodType<ValorCampo>;
      break;
    case 'inteiro':
    case 'referencia': {
      let n = z.number().int();
      if (c.minimo !== undefined) n = n.min(c.minimo);
      if (c.maximo !== undefined) n = n.max(c.maximo);
      e = n as z.ZodType<ValorCampo>;
      break;
    }
    case 'decimal': {
      // M14: casas da coluna (escala do NUMERIC); o banco arredondaria em silêncio, a tela recusa.
      const casas = c.casas ?? 4;
      let n = z
        .number()
        .refine(
          (v) => Math.abs(Math.round(v * 10 ** casas) - v * 10 ** casas) < 1e-6,
          `Até ${casas} casas decimais.`,
        );
      if (c.minimo !== undefined) n = n.refine((v) => v >= (c.minimo ?? 0), `Mínimo ${c.minimo}.`);
      if (c.maximo !== undefined) n = n.refine((v) => v <= (c.maximo ?? 0), `Máximo ${c.maximo}.`);
      e = n as z.ZodType<ValorCampo>;
      break;
    }
  }
  // M51: o documento (CPF ou CNS) guardado como número é conferido pelo dígito.
  if (c.documento === 'cpf')
    e = e.refine(
      (v) => v === null || v === undefined || cpfValido(String(Math.trunc(Number(v))).padStart(11, '0')),
      'CPF inválido.',
    ) as z.ZodType<ValorCampo>;
  if (c.documento === 'cns')
    e = e.refine(
      (v) => v === null || v === undefined || cnsValido(String(Math.trunc(Number(v)))),
      'CNS inválido.',
    ) as z.ZodType<ValorCampo>;
  return c.obrigatorio && c.padraoNaInclusao === undefined
    ? e
    : (e.nullable().optional() as z.ZodType<ValorCampo>);
}

/** Zod da inclusão: os campos que a tela pede (gerado da declaração e dos tipos do catálogo). */
export function esquemaInclusao(d: DeclaracaoDominio) {
  return z
    .object(
      Object.fromEntries([
        ...d.colunas.filter((c) => c.naInclusao).map((c) => [c.campo, esquemaCampo(c)] as const),
        // Revisão do W0-02 (D-CRUD-30): o texto longo editável também na inclusão (vazio: NULL).
        ...textosEditaveis(d).map(
          (t) =>
            [
              t.campo,
              t.obrigatorio
                ? esquemaTextoCp1252({ maxBytes: t.maxBytes ?? TETO_TEXTO_LONGO }).refine(
                    (x) => x.trim() !== '',
                    `${t.rotulo}: obrigatório.`,
                  )
                : esquemaTextoCp1252({ maxBytes: t.maxBytes ?? TETO_TEXTO_LONGO })
                    .nullable()
                    .optional(),
            ] as const,
        ),
      ]),
    )
    .strict();
}

const versao = z.string().min(2).max(4000);
// M14: chave composta ("1|ABCD|23") cabe em 120.
const codigo = z.string().min(1).max(120);

/** W0-02 (D-CRUD-30): teto padrão do texto longo editável, em bytes CP1252 (1 MiB). */
export const TETO_TEXTO_LONGO = 1_048_576;

/** W0-02 (D-CRUD-30): os textos longos (BLOB de texto) que o CRUD genérico grava (editor na tela). */
export function textosEditaveis(d: DeclaracaoDominio) {
  return (d.textosLongos ?? []).filter((t) => t.editavel);
}

/** Zod da alteração: código, só os campos editáveis (nunca a chave) e a versão lida. */
export function esquemaAlteracao(d: DeclaracaoDominio) {
  const editaveis = d.colunas.filter((c) => c.editavel);
  return z
    .object({
      codigo,
      versao,
      valores: z
        .object(
          Object.fromEntries([
            ...editaveis.map((c) => [c.campo, esquemaCampo(c)] as const),
            // W0-02: o texto longo editável (vazio grava NULL, como o cadastro anterior deixa).
            ...textosEditaveis(d).map(
              (t) =>
                [
                  t.campo,
                  t.obrigatorio
                    ? esquemaTextoCp1252({ maxBytes: t.maxBytes ?? TETO_TEXTO_LONGO }).refine(
                        (x) => x.trim() !== '',
                        `${t.rotulo}: obrigatório.`,
                      )
                    : esquemaTextoCp1252({ maxBytes: t.maxBytes ?? TETO_TEXTO_LONGO }).nullable(),
                ] as const,
            ),
          ]),
        )
        .strict()
        .partial(),
    })
    .strict();
}

const motivo = z.string().trim().min(5).max(200);

/**
 * Revisão do W0-02: o motivo da inativação vai ao registro do evento (SGH_CRUD_EVENTO) com o valor anterior. A API e a
 * tela o exigem (esquemaPedidoInativacao); na operação ele é opcional para as chamadas internas que não vêm de pessoa
 * (a reprodução dos cenários de assinatura), que registram o evento sem motivo.
 */
export function esquemaInativacao() {
  return z
    .object({ codigo, versao, confirmarEmUso: z.boolean().optional(), motivo: motivo.optional() })
    .strict();
}

/** W0-02: Zod da exclusão física e da reativação (código, versão lida e o motivo obrigatório). */
export function esquemaExclusao() {
  return z.object({ codigo, versao, motivo }).strict();
}
export function esquemaReativacao() {
  return z.object({ codigo, versao, motivo }).strict();
}

/** Campos como a API os descreve à tela. */
export function camposDescritos(
  d: DeclaracaoDominio,
  aConfirmar: (coluna: string) => boolean,
): CampoDescrito[] {
  return d.colunas.map((c) => ({
    campo: c.campo,
    rotulo: c.rotulo,
    tipo: c.tipo,
    ...(c.maxBytes !== undefined ? { maxBytes: c.maxBytes } : {}),
    ...(c.casas !== undefined ? { casas: c.casas } : {}),
    ...(c.minimo !== undefined ? { minimo: c.minimo } : {}),
    ...(c.maximo !== undefined ? { maximo: c.maximo } : {}),
    obrigatorio: c.obrigatorio && c.padraoNaInclusao === undefined,
    ...(c.codigo ? { codigo: c.codigo } : {}),
    editavel: c.editavel,
    naInclusao: c.naInclusao,
    naLista: c.naLista,
    ...(c.valores ? { valores: c.valores.map((v) => ({ ...v })) } : {}),
    ...(c.referencia ? { referencia: c.campo } : {}),
    ...(aConfirmar(c.coluna) ? { aConfirmar: true } : {}),
  }));
}

/** O domínio tem campo de dado pessoal (exportação exige justificativa; regra 6)? */
export function temDadoPessoal(d: DeclaracaoDominio): boolean {
  return d.colunas.some((c) => c.pessoal);
}
