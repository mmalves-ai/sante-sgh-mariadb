// pnpm crud:portao-iae — W0-02: gera o relatório do portão do I/A/E dos domínios do CRUD genérico (modo relatório até o
// W4-01) em docs/marcos/W0-02/portao-iae.md, a lista publicada no relatório da onda. Sai com 1 se houver violação que
// vale sempre (excluir sem categoria, ou em regra de apoio à decisão ou formulário) ou, no modo obrigatório, lacuna.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DOMINIOS_DECLARADOS,
  lacunasIae,
  PORTAO_IAE_OBRIGATORIO,
  relatorioIae,
  violacoesExclusao,
} from '@sgh/contratos';

const raiz = resolve(import.meta.dirname, '../../..');
const destino = resolve(raiz, 'docs/marcos/W0-02/portao-iae.md');
const data = new Date().toISOString().slice(0, 10);
writeFileSync(destino, relatorioIae(DOMINIOS_DECLARADOS, data));
const lacunas = lacunasIae(DOMINIOS_DECLARADOS);
const violacoes = violacoesExclusao(DOMINIOS_DECLARADOS);
console.log(
  `portão do I/A/E (modo ${PORTAO_IAE_OBRIGATORIO ? 'obrigatório' : 'relatório'}): ${lacunas.length} domínio(s) editável(is) sem I/A/E completo; ${violacoes.length} violação(ões) que valem sempre. Relatório: docs/marcos/W0-02/portao-iae.md`,
);
for (const v of violacoes) console.error(`  violação: ${v}`);
if (violacoes.length > 0 || (PORTAO_IAE_OBRIGATORIO && lacunas.length > 0)) process.exitCode = 1;
