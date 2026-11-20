// Relatório de contraste (regra 2): `pnpm nx run ui:contraste`. Só razões calculadas; vai às evidências.
import { PALETA_CLINICA } from './clinica.js';
import { PARES_DE_CONTRASTE, tokensDoTema, type CoresDaMarca } from './cores.js';
import { contraste } from './contraste.js';
import { CORES_REDE_SANTE } from './marcas.js';

export function relatorioContraste(marca: CoresDaMarca): string {
  const temas = tokensDoTema(marca);
  const linhas = [
    '| tema | texto | fundo | uso | razão | mínimo | resultado |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const tema of ['claro', 'escuro'] as const) {
    const t = temas[tema];
    for (const p of PARES_DE_CONTRASTE) {
      const r = contraste(t[p.texto], t[p.fundo]);
      linhas.push(
        `| ${tema} | ${p.texto} ${t[p.texto]} | ${p.fundo} ${t[p.fundo]} | ${p.uso} | ${r.toFixed(2)} | ${p.minimo} | ${r >= p.minimo ? 'passa' : 'FALHA'} |`,
      );
    }
    for (const e of PALETA_CLINICA) {
      const r = contraste(e[tema].texto, e[tema].fundo);
      linhas.push(
        `| ${tema} | rótulo ${e[tema].texto} | ${e.id} ${e[tema].fundo} | selo clínico | ${r.toFixed(2)} | 4.5 | ${r >= 4.5 ? 'passa' : 'FALHA'} |`,
      );
    }
  }
  const sec = contraste(marca.corSecundaria, temas.claro.fundo);
  linhas.push(
    '',
    `Secundária ${marca.corSecundaria} sobre ${temas.claro.fundo}: ${sec.toFixed(2)}:1 (proibida como texto no claro).`,
  );
  return linhas.join('\n');
}

if (import.meta.main) console.log(relatorioContraste(CORES_REDE_SANTE));
