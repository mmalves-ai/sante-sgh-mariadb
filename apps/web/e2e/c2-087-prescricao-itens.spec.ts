// E2E @C2-087 (03-PEP L105): o médico monta, na prescrição, os itens que a gravação própria passou a cobrir:
// solução em duas etapas (cada componente na sua etapa, velocidade de cada etapa), "se necessário" com a dose máxima
// no período, VMI com os tempos inspiratório e expiratório, VNI com a pressão de suporte e a duração da sessão e
// hemocomponente com a indicação clínica. Sessão real sobre a fonte sintética e a porta da prescrição em MEMÓRIA
// (pacientes, produtos e cadastros SINTÉTICOS; nada vai à cópia). Combos pelo e2e/combos.ts. axe sem violação séria.
// No fim, o corpo do pedido de verificação prova que as etapas, a etapa de cada componente, a dose máxima, os tempos
// da VMI, a pressão de suporte, a duração da VNI e a indicação do hemocomponente saíram do editor.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaPrescricao(page: Page): Promise<void> {
  await page.goto('/pep/prescricao');
  await page.getByTestId('busca-paciente-prescricao').fill('jose');
  await page.getByTestId('buscar-paciente-prescricao').click();
  await page.getByTestId('paciente-prescricao-1001').getByRole('link').click();
  await expect(page.getByTestId('tela-prescricao-paciente')).toBeVisible();
  await page.getByTestId('nova-prescricao').click();
  await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
  await escolher(page.getByTestId('editor-periodo'), 'seguinte');
}

const combo = (area: Locator, nome: string) => area.getByRole('combobox', { name: nome });
const itens = (page: Page) => page.locator('[data-testid^="item-"]');

test.describe('Prescrição: itens da gravação própria @C2-087', () => {
  test.setTimeout(90_000);

  test('solução em duas etapas, "se necessário" com dose máxima, VMI, VNI e hemocomponente; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.MEDICO');
    await novaPrescricao(page);

    // Solução: soro na etapa 1 e glicose na etapa 2, cada etapa com a sua velocidade.
    await page.getByTestId('aba-solucoes').click();
    const sol = page.getByTestId('editor-solucoes');
    await sol.getByTestId('busca-produto').fill('cloreto');
    await sol.getByTestId('buscar-produto').click();
    await sol.getByTestId('produto-504').click();
    await sol.getByTestId('busca-produto').fill('glicose');
    await sol.getByTestId('buscar-produto').click();
    await sol.getByTestId('produto-508').click();
    await sol.getByLabel('Dose').nth(0).fill('500');
    await sol.getByLabel('Dose').nth(1).fill('250');
    await sol.getByRole('checkbox', { name: 'Principal' }).nth(1).check();
    await sol.getByTestId('velocidade').fill('125');
    await escolher(combo(sol, 'Unidade da velocidade'), { rotulo: 'mL/h' });
    // Sem a segunda etapa, o componente não tem a escolha da etapa (entra na primeira).
    await expect(sol.getByTestId('componente-etapa-0')).toHaveCount(0);
    await sol.getByTestId('acrescentar-etapa').click();
    await expect(sol.getByTestId('etapa-2')).toBeVisible();
    await sol.getByTestId('velocidade-etapa-2').fill('50');
    await escolher(combo(sol.getByTestId('etapa-2'), 'Unidade da velocidade'), { rotulo: 'mL/h' });
    await escolher(sol.getByTestId('componente-etapa-1'), '2');
    await semViolacaoAxe(page, 'solução em etapas');
    await sol.getByTestId('incluir-item').click();
    await expect(sol.getByTestId('item-incompleto')).toHaveCount(0);
    await expect(itens(page)).toHaveCount(1);
    // O editor volta limpo: a segunda etapa sai com o item incluído.
    await expect(sol.getByTestId('etapa-2')).toHaveCount(0);

    // Medicamento "se necessário" com a dose máxima no período.
    await page.getByTestId('aba-medicamentos').click();
    const med = page.getByTestId('editor-medicamentos');
    await med.getByTestId('busca-produto').fill('dipirona');
    await med.getByTestId('buscar-produto').click();
    await med.getByTestId('produto-501').click();
    await med.getByTestId('dose').fill('1');
    await escolher(med.getByTestId('unidade'), 'ML');
    await escolher(med.getByTestId('via'), 'EV');
    await med.getByTestId('se-necessario').check();
    await escolher(combo(med, 'Condição'), { rotulo: 'Dor' });
    await med.getByLabel('Intervalo mínimo (horas)').fill('6');
    await med.getByTestId('se-necessario-dose-maxima').fill('4');
    await med.getByTestId('incluir-item').click();
    await expect(itens(page)).toHaveCount(2);

    // VMI a pressão com os tempos inspiratório e expiratório.
    await page.getByTestId('aba-oxigenio').click();
    const oxi = page.getByTestId('editor-oxigenio');
    await escolher(oxi.getByTestId('tipo-item'), 'vmi');
    await escolher(combo(oxi, 'Via aérea'), { rotulo: 'Tubo orotraqueal' });
    await escolher(combo(oxi, 'Modo'), { rotulo: 'Pressão controlada' });
    await oxi.getByLabel('FiO2', { exact: false }).first().fill('40');
    await oxi.getByLabel('PEEP', { exact: false }).first().fill('5');
    await oxi.getByLabel('Pressão inspiratória').fill('20');
    await oxi.getByLabel('Frequência respiratória').fill('16');
    await oxi.getByTestId('vmi-tempo-insp').fill('1');
    await oxi.getByTestId('vmi-tempo-exp').fill('2,5');
    await oxi.getByTestId('incluir-item').click();
    await expect(itens(page)).toHaveCount(3);

    // VNI (BIPAP) com IPAP, EPAP, pressão de suporte e duração da sessão.
    await escolher(oxi.getByTestId('tipo-item'), 'vni');
    await escolher(combo(oxi, 'Via aérea'), { rotulo: 'Máscara facial' });
    await escolher(combo(oxi, 'Modo'), { rotulo: 'BIPAP' });
    await oxi.getByLabel('FiO2', { exact: false }).first().fill('35');
    await oxi.getByLabel('Pressão inspiratória').fill('14');
    await oxi.getByLabel('Pressão expiratória').fill('6');
    await oxi.getByTestId('vni-pressao-suporte').fill('8');
    await oxi.getByTestId('vni-duracao').fill('60');
    await oxi.getByTestId('incluir-item').click();
    await expect(itens(page)).toHaveCount(4);

    // Hemocomponente: sem a indicação clínica o item não entra; com ela, entra.
    await page.getByTestId('aba-hemoterapia').click();
    const hemo = page.getByTestId('editor-hemoterapia');
    await escolher(hemo.getByTestId('hemocomponente'), { rotulo: 'Concentrado de hemácias' });
    await hemo.getByTestId('dose-hemo').fill('1');
    await escolher(hemo.getByTestId('unidade-hemo'), { indice: 1 });
    await hemo.getByTestId('incluir-item').click();
    await expect(hemo.getByTestId('item-incompleto')).toBeVisible();
    await expect(itens(page)).toHaveCount(4);
    await hemo.getByTestId('indicacao-hemo').fill('Anemia sintomática com hemoglobina abaixo do alvo.');
    await hemo.getByTestId('incluir-item').click();
    await expect(itens(page)).toHaveCount(5);
    await semViolacaoAxe(page, 'itens da prescrição');

    // O que o editor coletou chega ao pedido: confere o corpo da verificação, item por item.
    const pedido = page.waitForRequest((r) => r.method() === 'POST' && /\/verificar$/.test(r.url()));
    await page.getByTestId('verificar-prescricao').click();
    const corpo = (await pedido).postDataJSON() as { itens: { detalhe: Record<string, unknown> }[] };
    const detalhe = (tipo: string) => corpo.itens.map((i) => i.detalhe).filter((d) => d['tipo'] === tipo);
    expect(corpo.itens).toHaveLength(5);

    const [solucao] = detalhe('solucao');
    expect(solucao?.['etapas']).toEqual([
      expect.objectContaining({ etapa: 1, velocidade: 125 }),
      expect.objectContaining({ etapa: 2, velocidade: 50 }),
    ]);
    const componentes = solucao?.['componentes'] as { produto: number; dose: number; etapa?: number }[];
    expect(componentes.map((c) => [c.produto, c.dose, c.etapa ?? 1])).toEqual([
      [504, 500, 1],
      [508, 250, 2],
    ]);

    const [medicamento] = detalhe('medicamento');
    expect(medicamento?.['seNecessario']).toEqual(
      expect.objectContaining({
        intervaloMinimoHoras: 6,
        doseMaxima: expect.objectContaining({ dose: 4, periodoHoras: expect.any(Number) }),
      }),
    );

    const [vmi] = detalhe('vmi');
    expect(vmi).toEqual(expect.objectContaining({ tempoInspiratorio: 1, tempoExpiratorio: 2.5 }));
    const [vni] = detalhe('vni');
    expect(vni).toEqual(expect.objectContaining({ pressaoSuporte: 8, duracaoMinutos: 60 }));
    const [itemHemo] = detalhe('hemoterapia');
    expect(itemHemo?.['indicacao']).toBe('Anemia sintomática com hemoglobina abaixo do alvo.');
    expect(externas).toEqual([]);
  });
});
