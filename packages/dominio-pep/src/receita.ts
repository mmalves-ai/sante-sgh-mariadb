// Receituário (ficha do M23, regras 6 e 7; cap-05b §5.6 Receita): os campos da CFM 2.299/2021 (art. 2º) e da CFM
// 2.381/2024 — identificação do paciente e do prescritor (com o conselho), medicamento pela denominação, concentração,
// forma, via, posologia, quantidade e duração, data — e o receituário certo pela Portaria 344/98 (controle especial
// em 2 vias) e pela RDC 471/2021 (antimicrobiano em 2 vias, validade de 10 dias). Proibido indicar farmácia ou
// drogaria. No banco do estabelecimento a receita é texto formatado (RECEITA) com o tipo do padrão (1 "Padrão" ou 4
// "Padrão - Psicotrópico", os únicos em uso desde 2023); a receita de controle especial e a de antimicrobiano que
// saem do hospital são impressas e assinadas à mão até a assinatura qualificada (Lei 14.063/2020, art. 13).
import { problemasCp1252, type ItemReceita, type TipoReceita } from '@sgh/contratos';
import { paragrafosDoTexto, rtfDoCampo } from './gravador/rtf.js';

/** Tipo do padrão no banco do estabelecimento (domínio visto em 2026: 1 e 4). */
export const TIPO_PADRAO_LEGADO: Readonly<Record<TipoReceita, 1 | 4>> = {
  simples: 1,
  'controle-especial': 4,
  // Antimicrobiano: o tipo 3 do legado exige itens estruturados e não é usado desde 2022 (valor nunca visto na
  // janela); grava como o padrão (1), com o receituário de antimicrobiano no documento do novo (D-REC-2).
  antimicrobiano: 1,
};

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
