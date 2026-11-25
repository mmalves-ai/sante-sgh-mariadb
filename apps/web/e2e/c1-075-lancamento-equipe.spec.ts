// C1-075 (F3.7, 06-FAT linha 15): lançamento manual do item com a equipe do ato no mesmo pedido, pela tela
// `/faturamento/contas/:id/lancamentos`. O E2E roda com a fonte sintética (sem núcleo): as respostas da API destas rotas
// são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a equipe só aparece para honorário e
// procedimento; o participante incompleto e o 1º auxiliar repetido travam o lançamento na hora (regra do domínio,
// validarEquipeItem); a função sem percentual pede o percentual; o pedido sai por POST contas/:id/itens-com-equipe com o
// item e a equipe juntos. Sem equipe, o lançamento segue pelo caminho de sempre (POST contas/:id/itens). O efeito no
// banco (item e equipe na mesma transação; equipe recusada não deixa o item) está no contrato de efeito
// apps/api/src/modulos/faturamento/conta-movimentos-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7501;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const funcao = (
  id: number,
  codigo: string,
  descricao: string,
  tipo: string,
  percentual: number | null,
  ordemAuxiliar: number | null,
) => ({
  id,
  codigo,
  descricao,
  tipo,
  ativo: true,
  percentual,
  grau: null,
  ordemAuxiliar,
  ordemApresentacao: id,
});

const listaVazia = { itens: [], total: 0, pagina: 0, porPagina: 500, somaPagina: 0, regua: 'competencia' };

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  await page.route('**/api/faturamento/gravacao', (r) =>
    json(r, {
      funcionalidades: { contas: { ligada: true, motivo: null } },
      operacoes: {
        'faturamento.lancarItem': { ligada: true, motivo: null },
        'faturamento.conferirItem': { ligada: true, motivo: null },
      },
    }),
  );
  await page.route('**/api/faturamento/apoio', (r) =>
    json(r, { hoje: '2026-11-25', escopo: [], situacoes: [], convenios: [] }),
  );
  await page.route(`**/api/faturamento/contas/${CONTA}/itens?**`, (r) => json(r, listaVazia));
  await page.route(`**/api/faturamento/contas/${CONTA}/movimentos`, (r) =>
    json(r, {
      contaId: CONTA,
      numero: 'C1075-SINT-1',
      situacao: 'aberta',
      editavel: true,
      fontePagadoraId: 61,
      fonte: 'Convênio Sintético A',
      itens: [],
      funcoes: [
        funcao(1, 'CIR', 'Cirurgião', 'cirurgiao', null, null),
        funcao(2, 'AUX1', '1º auxiliar', 'auxiliar', 30, 1),
        funcao(3, 'INS', 'Instrumentador', 'instrumentador', null, null),
      ],
      graus: [],
      kits: [],
      profissionais: [
        { id: 31, nome: 'Profissional Sintético Um' },
        { id: 32, nome: 'Profissional Sintético Dois' },
        { id: 33, nome: 'Profissional Sintético Três' },
      ],
      destinos: [],
      transferencias: [],
    }),
  );
  await page.route(`**/api/faturamento/contas/${CONTA}/itens-com-equipe`, (r) => {
    enviados.push({ comEquipe: r.request().postDataJSON() });
    return json(r, { id: 9901, participantes: 2, valorItem: 1300, adicionalEquipe: 300 }, 201);
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/itens`, (r) => {
    if (r.request().method() !== 'POST') return json(r, listaVazia);
    enviados.push({ semEquipe: r.request().postDataJSON() });
    return json(r, { mensagem: 'Item lançado.', repetida: false, ids: { item: 9902 }, avisos: [] }, 201);
  });
}

test.describe('lançamento manual com a equipe do ato @C1-075 @F3.7', () => {
  test.setTimeout(180_000);

  test('equipe validada na hora e lançada com o item no mesmo pedido; sem equipe, o caminho de sempre; axe', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.CONTAS');
    await simular(page, enviados);
    await page.goto(`/faturamento/contas/${CONTA}/lancamentos`);
    await expect(page.getByTestId('tela-faturamento-lancamentos')).toBeVisible();

    // Grupo 4 (materiais e medicamentos) não tem equipe; honorários e procedimentos (grupo 3) têm.
    await escolher(page.getByTestId('lan-n-tipo'), { rotulo: 'Materiais e medicamentos' });
    await expect(page.getByTestId('lan-equipe')).toHaveCount(0);
    await escolher(page.getByTestId('lan-n-tipo'), { rotulo: 'Exames e terapias (SADT)' });
    const eq = page.getByTestId('lan-equipe');
    await expect(eq).toBeVisible();
    await page.getByTestId('lan-n-codigo').fill('83750001');

    // Participante incluído e não preenchido trava o lançamento.
    await eq.getByTestId('lan-eq-incluir').click();
    await expect(eq.getByTestId('lan-eq-erro-0')).toBeVisible();
    await expect(page.getByTestId('lan-n-gravar')).toBeDisabled();
    await escolher(eq.getByTestId('lan-eq-profissional-0'), { rotulo: 'Profissional Sintético Um' });
    await escolher(eq.getByTestId('lan-eq-funcao-0'), { rotulo: 'Cirurgião' });
    await expect(eq.getByTestId('lan-eq-erro-0')).toHaveCount(0);

    // Dois 1º auxiliares: a regra do domínio recusa na hora; retirado o segundo, libera.
    for (const [k, prof] of [
      [1, 'Profissional Sintético Dois'],
      [2, 'Profissional Sintético Três'],
    ] as const) {
      await eq.getByTestId('lan-eq-incluir').click();
      await escolher(eq.getByTestId(`lan-eq-profissional-${k}`), { rotulo: prof });
      await escolher(eq.getByTestId(`lan-eq-funcao-${k}`), { rotulo: '1º auxiliar' });
    }
    await expect(eq.getByTestId('lan-eq-erro-2')).toBeVisible();
    await expect(page.getByTestId('lan-n-gravar')).toBeDisabled();

    // Função sem percentual (instrumentador) pede o percentual em vez de zerar o ato.
    await escolher(eq.getByTestId('lan-eq-funcao-2'), { rotulo: 'Instrumentador' });
    await expect(eq.getByTestId('lan-eq-erro-2')).toBeVisible();
    await eq.getByTestId('lan-eq-retirar-2').click();
    await expect(page.getByTestId('lan-n-gravar')).toBeEnabled();
    await semViolacaoAxe(page, '/faturamento/contas/:id/lancamentos (equipe)');

    await page.getByTestId('lan-n-gravar').click();
    await expect.poll(() => enviados.find((x) => 'comEquipe' in x)).toBeTruthy();
    expect(enviados.find((x) => 'comEquipe' in x)?.['comEquipe']).toMatchObject({
      tipo: 3,
      codigo: 83750001,
      quantidade: 1,
      equipe: [
        { profissionalId: 31, funcaoId: 1, grauId: null, percentual: null, formaPagamento: 'via_hospital' },
        { profissionalId: 32, funcaoId: 2, grauId: null, percentual: null, formaPagamento: 'via_hospital' },
      ],
    });
    await expect(page.getByTestId('lan-mensagem')).toContainText('2 participante(s)');
    // A equipe zera depois do lançamento; o próximo item sem equipe vai pelo caminho de sempre.
    await expect(eq.getByTestId('lan-eq-participante-0')).toHaveCount(0);
    await page.getByTestId('lan-n-codigo').fill('83750002');
    await page.getByTestId('lan-n-gravar').click();
    await expect.poll(() => enviados.find((x) => 'semEquipe' in x)).toBeTruthy();
    expect(enviados.find((x) => 'semEquipe' in x)?.['semEquipe']).not.toHaveProperty('equipe');
    expect(enviados.filter((x) => 'comEquipe' in x)).toHaveLength(1);
  });
  test('equipe inválida e troca para um grupo sem equipe: o lançamento segue sem a equipe; de volta, a trava volta', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.CONTAS');
    await simular(page, enviados);
    await page.goto(`/faturamento/contas/${CONTA}/lancamentos`);
    await expect(page.getByTestId('tela-faturamento-lancamentos')).toBeVisible();

    await escolher(page.getByTestId('lan-n-tipo'), { rotulo: 'Exames e terapias (SADT)' });
    const eq = page.getByTestId('lan-equipe');
    await page.getByTestId('lan-n-codigo').fill('83750003');
    await eq.getByTestId('lan-eq-incluir').click();
    await expect(eq.getByTestId('lan-eq-erro-0')).toBeVisible();
    await expect(page.getByTestId('lan-n-gravar')).toBeDisabled();

    // Materiais e medicamentos não levam equipe: o botão libera e o clique lança pelo caminho de sempre.
    await escolher(page.getByTestId('lan-n-tipo'), { rotulo: 'Materiais e medicamentos' });
    await expect(page.getByTestId('lan-equipe')).toHaveCount(0);
    await expect(page.getByTestId('lan-n-gravar')).toBeEnabled();
    await page.getByTestId('lan-n-gravar').click();
    await expect.poll(() => enviados.find((x) => 'semEquipe' in x)).toBeTruthy();
    expect(enviados.find((x) => 'semEquipe' in x)?.['semEquipe']).toMatchObject({
      tipo: 4,
      codigo: 83750003,
    });
    expect(enviados.find((x) => 'semEquipe' in x)?.['semEquipe']).not.toHaveProperty('equipe');
    expect(enviados.filter((x) => 'comEquipe' in x)).toHaveLength(0);

    // De volta ao grupo com equipe, o participante incompleto continua lá e trava de novo.
    await escolher(page.getByTestId('lan-n-tipo'), { rotulo: 'Exames e terapias (SADT)' });
    await expect(page.getByTestId('lan-equipe').getByTestId('lan-eq-erro-0')).toBeVisible();
    await expect(page.getByTestId('lan-n-gravar')).toBeDisabled();
  });
});
