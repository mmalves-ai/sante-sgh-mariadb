// M60, etapa 3: a conferência do manual de implantação (seções, referências dos testes pós-implantação, itens,
// variáveis obrigatórias, anexos e lista de verificação) e o conversor de Markdown do PDF. O manual real do repositório
// também é conferido aqui (o mesmo que o verificar roda).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ITENS_VERIFICACAO_IMPLANTACAO } from '@sgh/contratos';
import { SE_FALHAR } from '@sgh/dominio-config';
import { describe, expect, it } from 'vitest';
import {
  ANEXOS_MANUAL,
  conferirManual,
  emLinha,
  htmlDoManual,
  impressaoDasFontes,
  markdownParaHtml,
  obrigatoriasDoAnexo,
  referencias,
  SECOES_MANUAL,
  titulos,
} from './manual.ts';

const pasta = resolve(import.meta.dirname, '../../../docs/implantacao');
const manualReal = readFileSync(resolve(pasta, 'manual-implantacao.md'), 'utf8');
const anexoReal = readFileSync(resolve(pasta, 'anexos/variaveis.md'), 'utf8');

const ANEXO = [
  '## Produto',
  '| variável | uso | segredo | descrição |',
  '|---|---|---|---|',
  '| `AMBIENTE` | obrigatoria |  | Ambiente. |',
  '| `MARCA` | recomendada |  | Marca. |',
  '### Série por estabelecimento (`FB_<CÓDIGO>_<CAMPO>`)',
  '| campo | uso | segredo | descrição |',
  '|---|---|---|---|',
  '| `HOST` | obrigatoria |  | Servidor. |',
  '## Serviços',
  '| `TZ` | obrigatoria |  | Fuso. |',
].join('\n');

/** Um manual mínimo que passa: as 12 seções, as subseções citadas, os itens, as variáveis, anexos e a lista. */
function manualMinimo(): string {
  const sub = new Set(Object.values(SE_FALHAR).flatMap((t) => referencias(t)));
  const linhas = ['# Manual'];
  for (const s of SECOES_MANUAL) {
    linhas.push(`## ${s.numero}. ${s.nome[0]!.toUpperCase()}${s.nome.slice(1)}`);
    for (const r of sub) if (r.startsWith(`${s.numero}.`)) linhas.push(`### ${r} Sub`);
    if (s.numero === 5) linhas.push('`AMBIENTE`, `TZ` e `FB_<CÓDIGO>_HOST`.');
    if (s.numero === 8) linhas.push(ITENS_VERIFICACAO_IMPLANTACAO.map((c) => `\`${c}\``).join(', '));
    if (s.numero === 12)
      linhas.push(
        '### Antes',
        '| ☐ | Backup restaurado com sucesso | responsável | assinatura |',
        '### Durante',
        '### Depois',
      );
  }
  linhas.push(...ANEXOS_MANUAL.map((a) => `- [anexo](${a})`));
  return linhas.join('\n');
}

describe('conferência do manual', () => {
  it('o manual mínimo passa', () => {
    expect(conferirManual({ manual: manualMinimo(), seFalhar: SE_FALHAR, anexoVariaveis: ANEXO })).toEqual(
      [],
    );
  });

  it('o manual do repositório passa (o mesmo do verificar)', () => {
    expect(conferirManual({ manual: manualReal, seFalhar: SE_FALHAR, anexoVariaveis: anexoReal })).toEqual(
      [],
    );
  });

  it('acusa seção faltando, seção trocada e subseção citada que não existe', () => {
    const m = manualMinimo()
      .replace(/^## 9\. .*$/m, '## 9. Outra coisa')
      .replace(/^## 10\. .*$/m, '')
      .replace(/^### 11\.4 Sub$/m, '');
    const a = conferirManual({ manual: m, seFalhar: SE_FALHAR, anexoVariaveis: ANEXO });
    expect(a).toContain('a seção 9 ("Outra coisa") não é a de liberação por onda');
    expect(a.some((x) => x.startsWith('falta a seção 10'))).toBe(true);
    expect(a).toContain('o "se falhar" de impressao-digital cita §11.4, que não existe no manual');
  });

  it('acusa item da verificação, variável obrigatória e campo do estabelecimento não citados', () => {
    const m = manualMinimo()
      .replace('`valkey`', 'valkey')
      .replace('`TZ`', 'TZ')
      .replace('`FB_<CÓDIGO>_HOST`', '');
    const a = conferirManual({ manual: m, seFalhar: SE_FALHAR, anexoVariaveis: ANEXO });
    expect(a).toContain('o item valkey não aparece na seção 8');
    expect(a).toContain('a variável obrigatória TZ não é explicada no manual');
    expect(a).toContain('o campo obrigatório FB_<CÓDIGO>_HOST não é explicado no manual');
  });

  it('acusa anexo sem ligação, lista sem momento, sem assinatura ou sem backup, e termo proibido', () => {
    const m = manualMinimo()
      .replace(`(${ANEXOS_MANUAL[0]})`, '')
      .replace('### Durante', '')
      .replace('| ☐ | Backup restaurado com sucesso | responsável | assinatura |', '')
      .concat('\nUse o legado.');
    const a = conferirManual({ manual: m, seFalhar: SE_FALHAR, anexoVariaveis: ANEXO });
    expect(a).toContain(`o manual não liga o anexo ${ANEXOS_MANUAL[0]}`);
    expect(a).toContain('a lista de verificação não tem "Durante"');
    expect(a).toContain('a lista de verificação não tem espaço para assinatura');
    expect(a.some((x) => x.includes('backup verificado'))).toBe(true);
    expect(a.some((x) => x.includes('termo proibido'))).toBe(true);
  });

  it('"se falhar" sem referência e anexo ilegível são achados', () => {
    const a = conferirManual({
      manual: manualMinimo(),
      seFalhar: { ...SE_FALHAR, valkey: 'reinicie' },
      anexoVariaveis: '',
    });
    expect(a).toContain('o "se falhar" de valkey não cita seção do manual');
    expect(a.some((x) => x.includes('anexo ilegível'))).toBe(true);
  });
});

describe('peças da conferência', () => {
  it('títulos ignoram blocos de código; referências e obrigatórias do anexo', () => {
    expect(titulos('## 1. A\n```\n## não\n```\n### 1.1 B')).toEqual([
      { nivel: 2, texto: '1. A' },
      { nivel: 3, texto: '1.1 B' },
    ]);
    expect(referencias('Manual §11.1 e §6, depois §3.3')).toEqual(['11.1', '6', '3.3']);
    expect(obrigatoriasDoAnexo(ANEXO)).toEqual({
      variaveis: ['AMBIENTE', 'TZ'],
      camposEstabelecimento: ['HOST'],
    });
  });

  it('a impressão das fontes muda com qualquer fonte e respeita a ordem', () => {
    const a = impressaoDasFontes(['m', 'x', 'y']);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(impressaoDasFontes(['m', 'x', 'y'])).toBe(a);
    expect(impressaoDasFontes(['m', 'x', 'z'])).not.toBe(a);
    expect(impressaoDasFontes(['m', 'y', 'x'])).not.toBe(a);
  });
});

describe('Markdown do PDF', () => {
  it('escapa, faz código, negrito e links (os .md viram âncora interna)', () => {
    expect(emLinha('a <b> **c** `<d>`')).toBe('a &lt;b&gt; <strong>c</strong> <code>&lt;d&gt;</code>');
    expect(emLinha('[A](anexos/scripts-sgh.md)')).toBe('<a href="#scripts-sgh">A</a>');
  });

  it('títulos numerados ganham id; tabela com alinhamento; listas; código; parágrafo; comentário some', () => {
    const h = markdownParaHtml(
      [
        '<!-- nota -->',
        '## 12. Lista',
        '',
        '| a | n |',
        '|---|---:|',
        '| x | 1 |',
        '',
        '- um',
        '  continua',
        '- dois',
        '',
        '1. primeiro',
        '',
        '```',
        '# <raiz>',
        '```',
        'linha um',
        'linha dois',
      ].join('\n'),
    );
    expect(h).not.toContain('nota');
    expect(h).toContain('<h2 id="s12">12. Lista</h2>');
    expect(h).toContain('<th class="num">n</th>');
    expect(h).toContain('<td class="num">1</td>');
    expect(h).toContain('<ul><li>um continua</li><li>dois</li></ul>');
    expect(h).toContain('<ol><li>primeiro</li></ol>');
    expect(h).toContain('<pre><code># &lt;raiz&gt;</code></pre>');
    expect(h).toContain('<p>linha um linha dois</p>');
  });

  it('o HTML do PDF põe cada anexo numa seção com a âncora', () => {
    const h = htmlDoManual('# M', [{ arquivo: 'anexos/variaveis.md', texto: '# V' }]);
    expect(h).toContain('<section class="anexo" id="variaveis"><h1>V</h1></section>');
    expect(h).toContain('<html lang="pt-BR">');
  });
});
