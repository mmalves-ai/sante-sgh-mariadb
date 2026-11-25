// Receituário (ficha do M23, regras 6 e 7; cap-05b §5.6 Receita): os campos da CFM 2.299/2021 (art. 2º) e da CFM
// 2.381/2024 — identificação do paciente e do prescritor (com o conselho), medicamento pela denominação, concentração,
// forma, via, posologia, quantidade e duração, data — e o receituário certo pela Portaria 344/98 (controle especial
// em 2 vias) e pela RDC 471/2021 (antimicrobiano em 2 vias, validade de 10 dias). Proibido indicar farmácia ou
// drogaria. No banco do estabelecimento a receita é texto formatado (RECEITA) com o tipo do padrão (1 "Padrão" ou 4
// "Padrão - Psicotrópico"); desde a C2-021 cada medicamento também é gravado estruturado (receita_medica_item: o item
// do catálogo, a quantidade em número e a duração), e o documento impresso sai dos itens, em 2 vias quando o
// receituário pede. A receita de controle especial e a de antimicrobiano que saem do hospital são impressas e
// assinadas à mão até a assinatura qualificada (Lei 14.063/2020, art. 13).
import { problemasCp1252, type ItemReceita, type TipoReceita } from '@sgh/contratos';
import { paragrafosDoTexto, rtfDoCampo } from './gravador/rtf.js';

/**
 * Classe própria de cada tipo de receita (C2-021): o tipo de receita do cliente é escolhido pelas marcas de controle
 * especial e de antimicrobiano, nunca por código de outro sistema. A de antimicrobiano é classe própria (2 vias, 10
 * dias), não vira receita simples.
 */
export interface ClasseReceita {
  readonly controleEspecial: boolean;
  readonly antimicrobiano: boolean;
}
export const CLASSE_RECEITA: Readonly<Record<TipoReceita, ClasseReceita>> = {
  simples: { controleEspecial: false, antimicrobiano: false },
  'controle-especial': { controleEspecial: true, antimicrobiano: false },
  antimicrobiano: { controleEspecial: false, antimicrobiano: true },
};

/** Tipo da receita pela classe gravada (controle especial prevalece: é o receituário mais restrito). */
export function tipoDaClasse(c: { controleEspecial: unknown; antimicrobiano: unknown }): TipoReceita {
  if (Number(c.controleEspecial)) return 'controle-especial';
  if (Number(c.antimicrobiano)) return 'antimicrobiano';
  return 'simples';
}

export interface Receituario {
  readonly titulo: string;
  readonly vias: 1 | 2;
  readonly validadeDias: number;
  readonly rodape: string;
}

const RODAPE_A_MAO =
  'Documento impresso para assinatura à mão do prescritor (assinatura qualificada na Fase 5; Lei 14.063/2020, art. 13).';

export function receituario(tipo: TipoReceita): Receituario {
  if (tipo === 'controle-especial')
    return {
      titulo: 'Receituário de controle especial',
      vias: 2,
      validadeDias: 30,
      rodape: `1ª via: retenção da farmácia; 2ª via: orientação ao paciente. ${RODAPE_A_MAO}`,
    };
  if (tipo === 'antimicrobiano')
    return {
      titulo: 'Receituário de antimicrobiano',
      vias: 2,
      validadeDias: 10,
      rodape: `1ª via: retenção da farmácia; 2ª via: paciente. Validade de 10 dias. ${RODAPE_A_MAO}`,
    };
  return { titulo: 'Receituário', vias: 1, validadeDias: 30, rodape: '' };
}

const FARMACIA = /\b(farm[aá]cia|drogaria|drogasil|pague\s*menos|panvel|raia)\b/i;

export interface ProblemaReceita {
  readonly campo: string;
  readonly motivo: string;
}

/** Conferência da receita antes de gravar (regra 6 e regra 18): campos mínimos, CP1252, sem indicar farmácia. */
export function conferirReceita(itens: readonly ItemReceita[], orientacoes?: string): ProblemaReceita[] {
  const r: ProblemaReceita[] = [];
  if (itens.length === 0) r.push({ campo: 'itens', motivo: 'Inclua ao menos um medicamento.' });
  itens.forEach((it, i) => {
    for (const [campo, v] of Object.entries(it))
      if (typeof v === 'string' && problemasCp1252(v).length > 0)
        r.push({
          campo: `itens.${i}.${campo}`,
          motivo: 'Caractere que o banco não guarda (troque antes de salvar).',
        });
    if (!it.posologia.trim()) r.push({ campo: `itens.${i}.posologia`, motivo: 'Informe a posologia.' });
    if (!it.quantidade.trim()) r.push({ campo: `itens.${i}.quantidade`, motivo: 'Informe a quantidade.' });
    if (FARMACIA.test(`${it.medicamento} ${it.posologia}`))
      r.push({ campo: `itens.${i}`, motivo: 'A receita não pode indicar farmácia ou drogaria.' });
  });
  if (orientacoes && FARMACIA.test(orientacoes))
    r.push({ campo: 'orientacoes', motivo: 'A receita não pode indicar farmácia ou drogaria.' });
  if (orientacoes && problemasCp1252(orientacoes).length > 0)
    r.push({ campo: 'orientacoes', motivo: 'Caractere que o banco não guarda (troque antes de salvar).' });
  return r;
}

/** Linhas do corpo da receita (o que vai ao texto formatado e ao documento). */
export function linhasDaReceita(itens: readonly ItemReceita[], orientacoes?: string): string[] {
  const linhas: string[] = [];
  itens.forEach((it, i) => {
    const nome = [it.medicamento, it.concentracao, it.forma].filter(Boolean).join(' ');
    linhas.push(`${i + 1}) ${nome}${it.quantidade ? ` - ${it.quantidade}` : ''}`);
    const uso = [it.via ? `Via ${it.via}` : null, it.posologia, it.duracao ? `por ${it.duracao}` : null]
      .filter(Boolean)
      .join(', ');
    linhas.push(`   ${uso}${it.usoContinuo ? ' (uso contínuo)' : ''}`);
  });
  if (orientacoes?.trim()) {
    linhas.push('');
    linhas.push('Orientações:');
    for (const l of orientacoes.replace(/\r\n?/g, '\n').split('\n')) linhas.push(l);
  }
  return linhas;
}

/** Texto formatado da receita como o legado grava (RTF CP1252, parágrafos sem formatação, fonte 8). */
export function rtfDaReceita(itens: readonly ItemReceita[], orientacoes?: string): string {
  return rtfDoCampo(paragrafosDoTexto(linhasDaReceita(itens, orientacoes).join('\n')));
}

// ── Itens estruturados (C2-021): o que a farmácia confere e escritura ───────────────────────────────────────

/** Dias de cada unidade de duração do tratamento (a unidade do cadastro é achada por estes dias). */
export const DIAS_DA_UNIDADE = { dia: 1, semana: 7, mes: 30 } as const;
export type UnidadeDuracao = keyof typeof DIAS_DA_UNIDADE;

const NUMERO_POR_EXTENSO: Readonly<Record<string, number>> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  vinte: 20,
  trinta: 30,
  sessenta: 60,
  noventa: 90,
};
const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** Primeiro número da quantidade ("2 caixas" → 2; "30 (trinta) comprimidos" → 30; "1,5" → 1,5); nulo sem número. */
export function quantidadeNumerica(texto: string | undefined): number | null {
  const t = semAcento(texto ?? '');
  const m = /^(\d{1,6}(?:[.,]\d{1,4})?)/.exec(t);
  if (m) {
    const n = Number(m[1]!.replace(',', '.'));
    return n > 0 ? n : null;
  }
  const p = /^([a-z]+)/.exec(t);
  return p ? (NUMERO_POR_EXTENSO[p[1]!] ?? null) : null;
}

/** Duração do tratamento em número e unidade ("7 dias", "2 semanas", "1 mês", "10" = dias); nula se não houver. */
export function duracaoEstruturada(
  texto: string | undefined,
): { readonly valor: number; readonly unidade: UnidadeDuracao } | null {
  const t = semAcento(texto ?? '');
  const m = /^(\d{1,4})\s*(dias?|d|semanas?|sem|mes(?:es)?)?\b/.exec(t);
  if (!m) return null;
  const valor = Number(m[1]);
  if (valor <= 0) return null;
  const u = m[2] ?? 'dia';
  const unidade: UnidadeDuracao = u.startsWith('sem') ? 'semana' : u.startsWith('mes') ? 'mes' : 'dia';
  return { valor, unidade };
}

export interface ItemReceitaEstruturado {
  readonly sequencia: number;
  readonly medicamento: string;
  readonly concentracao: string | null;
  readonly forma: string | null;
  readonly via: string | null;
  readonly posologia: string;
  readonly quantidade: number | null;
  readonly quantidadeDescricao: string;
  readonly duracao: { readonly valor: number; readonly unidade: UnidadeDuracao } | null;
  readonly usoContinuo: boolean;
}

/** Cada medicamento como vai a receita_medica_item: texto impresso e, ao lado, quantidade e duração em número. */
export function itensEstruturados(itens: readonly ItemReceita[]): ItemReceitaEstruturado[] {
  const ou = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return itens.map((it, i) => ({
    sequencia: i + 1,
    medicamento: it.medicamento.trim(),
    concentracao: ou(it.concentracao),
    forma: ou(it.forma),
    via: ou(it.via),
    posologia: it.posologia.trim(),
    quantidade: quantidadeNumerica(it.quantidade),
    quantidadeDescricao: it.quantidade.trim(),
    duracao: duracaoEstruturada(it.duracao),
    usoContinuo: it.usoContinuo === true,
  }));
}

/** O item lido do banco de volta ao formato da receita (para o documento impresso). */
export function itemDaLinha(l: {
  medicamento: string;
  concentracao: string | null;
  forma: string | null;
  via: string | null;
  posologia: string;
  quantidadeDescricao: string;
  duracao: number | null;
  diasDaUnidade: number | null;
  usoContinuo: boolean;
}): ItemReceita {
  const unidade =
    l.diasDaUnidade === 7
      ? ['semana', 'semanas']
      : l.diasDaUnidade === 30
        ? ['mês', 'meses']
        : ['dia', 'dias'];
  return {
    medicamento: l.medicamento,
    ...(l.concentracao ? { concentracao: l.concentracao } : {}),
    ...(l.forma ? { forma: l.forma } : {}),
    ...(l.via ? { via: l.via } : {}),
    posologia: l.posologia,
    quantidade: l.quantidadeDescricao,
    ...(l.duracao ? { duracao: `${l.duracao} ${l.duracao === 1 ? unidade[0] : unidade[1]}` } : {}),
    usoContinuo: l.usoContinuo,
  };
}

/** Classe do medicamento no catálogo (para conferir o receituário certo). */
export interface ClasseDoMedicamento {
  readonly sequencia: number;
  readonly controlado: boolean;
  readonly antimicrobiano: boolean;
}

/**
 * Conferência do receituário pelo tipo (Portaria 344/98 e RDC 471/2021): no de controle especial e no de antimicrobiano a
 * quantidade sai em número (a farmácia retém e escritura); no de antimicrobiano a duração do tratamento é obrigatória
 * (salvo uso contínuo). Medicamento do catálogo marcado como controlado só sai no receituário de controle especial, e o
 * antimicrobiano nunca sai na receita simples.
 */
export function conferirItensDoTipo(
  tipo: TipoReceita,
  itens: readonly ItemReceita[],
  classes: readonly ClasseDoMedicamento[] = [],
): ProblemaReceita[] {
  const r: ProblemaReceita[] = [];
  itensEstruturados(itens).forEach((it, i) => {
    if (tipo !== 'simples' && it.quantidade === null)
      r.push({
        campo: `itens.${i}.quantidade`,
        motivo: 'Neste receituário a quantidade começa pelo número (ex.: 30 comprimidos).',
      });
    if (tipo === 'antimicrobiano' && it.duracao === null && !it.usoContinuo)
      r.push({
        campo: `itens.${i}.duracao`,
        motivo: 'Informe a duração do tratamento do antimicrobiano (ex.: 7 dias).',
      });
  });
  for (const c of classes) {
    const i = c.sequencia - 1;
    if (c.controlado && tipo !== 'controle-especial')
      r.push({
        campo: `itens.${i}.medicamento`,
        motivo: 'Medicamento controlado: use o receituário de controle especial (Portaria 344/98).',
      });
    else if (c.antimicrobiano && tipo === 'simples')
      r.push({
        campo: `itens.${i}.medicamento`,
        motivo: 'Antimicrobiano: use o receituário de antimicrobiano (RDC 471/2021).',
      });
  }
  return r;
}

/** Corpo do documento impresso: uma via por receituário (2 vias no controle especial e no antimicrobiano). */
export function corpoDaReceitaEmVias(
  tipo: TipoReceita,
  itens: readonly ItemReceita[],
  orientacoes?: string,
): string[] {
  const corpo = linhasDaReceita(itens, orientacoes);
  const r = receituario(tipo);
  if (r.vias === 1) return [r.titulo, '', ...corpo];
  return [
    `${r.titulo} - 1ª via: retenção da farmácia`,
    '',
    ...corpo,
    '',
    `${r.titulo} - 2ª via: paciente`,
    '',
    ...corpo,
    '',
    r.rodape,
  ];
}

/** Texto formatado do documento impresso a partir dos itens gravados (as vias do receituário). */
export function rtfDaReceitaEmVias(
  tipo: TipoReceita,
  itens: readonly ItemReceita[],
  orientacoes?: string,
): string {
  return rtfDoCampo(paragrafosDoTexto(corpoDaReceitaEmVias(tipo, itens, orientacoes).join('\n')));
}
