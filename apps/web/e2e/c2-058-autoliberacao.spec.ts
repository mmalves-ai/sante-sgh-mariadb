// E2E @C2-058 (F8, 05-SADT linha 11): autoliberação do resultado pelo caminho da tela /sadt/autoliberacao. O
// responsável técnico cadastra a regra do exame (faixa do analito e variação máxima contra o anterior), o limite de
// delta check e a substância interferente; a fila de conferência mostra, por paciente, o resultado retido com o motivo
// (Delta check, Interferente) e "Conferir e liberar" o tira da fila. As rotas /api/sadt/autoliberacao exigem o banco
// próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa
// SINTÉTICA. A avaliação na digitação (dentro da faixa sai autoliberado; acima do limite de delta vai para a
// conferência) e o que fica no banco estão em apps/api/src/modulos/sadt/aplicacao/autoliberacao.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

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

const opcoes = {
  exames: [{ id: 501, nome: 'GLICOSE SINTETICA' }],
  analitos: [{ id: 701, nome: 'ANALITO SINTETICO', exame: 501 }],
  setores: [{ id: 601, nome: 'LABORATORIO SINTETICO' }],
};

const retido = (exameItem: number, motivos: string[], interferentes: string[] = []) => ({
  exameItem,
  resultado: exameItem + 1000,
  paciente: 9001,
  pacienteNome: 'PACIENTE SINTETICO A',
  exame: 'GLICOSE SINTETICA',
  setor: 'LABORATORIO SINTETICO',
  avaliadoEm: '2026-03-15T10:00:00',
  motivos,
  interferentes,
  critico: false,
});

test.describe('Autoliberação de resultados @C2-058 @fase7', () => {
  test.setTimeout(180_000);
  test('cadastro da regra, do delta check e do interferente; conferência do retido por paciente; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let fila = [retido(81, ['delta']), retido(82, ['interferente'], ['HEMOLISE'])];
    const regras: unknown[] = [];
    const limitesDelta: unknown[] = [];
    const interferentes: unknown[] = [];

    await page.route('**/api/sadt/exames-pedidos/*/resultado/liberar', (rota) => {
      const item = Number(new URL(rota.request().url()).pathname.split('/')[4]);
      pedidos.push({ caminho: `liberar/${item}`, corpo: {} });
      fila = fila.filter((r) => r.exameItem !== item);
      return json(rota, { resultado: item + 1000, exame: item, situacao: 'liberado' });
    });
    await page.route('**/api/sadt/autoliberacao**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/autoliberacao\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === 'fila') return json(rota, fila);
        if (caminho === 'principios') return json(rota, []);
        if (caminho === 'amostra') return json(rota, []);
        return json(rota, { regras, limitesDelta, interferentes, opcoes });
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === 'regras') {
        regras.push({
          id: 11,
          exameNome: 'GLICOSE SINTETICA',
          setor: null,
          vigenciaFim: null,
          ativo: true,
          ...corpo,
        });
        return json(rota, { id: 11 });
      }
      if (caminho === 'limites-delta') {
        limitesDelta.push({
          id: 21,
          analitoNome: 'ANALITO SINTETICO',
          vigenciaFim: null,
          ativo: true,
          ...corpo,
        });
        return json(rota, { id: 21 });
      }
      if (caminho === 'interferentes') {
        interferentes.push({
          id: 31,
          exameNome: 'GLICOSE SINTETICA',
          principioNome: null,
          ativo: true,
          ...corpo,
        });
        return json(rota, { id: 31 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.BIOMEDICO'); // a bancada técnica do laboratório (sadt.resultado.ler)
    await page.goto('/sadt/autoliberacao');
    await expect(page.getByTestId('autoliberacao')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/autoliberacao');

    // Fila por paciente: os dois retidos do mesmo paciente num só grupo, cada um com o motivo.
    await expect(page.getByTestId('autolib-paciente')).toHaveCount(1);
    await expect(page.getByTestId('autolib-retido')).toHaveCount(2);
    await expect(page.getByTestId('autolib-motivo').first()).toHaveText('Delta check');
    await expect(page.getByTestId('autolib-fila')).toContainText('HEMOLISE');

    // Regra: o botão só libera com código, descrição, exame e a faixa do analito; faixa invertida avisa na hora.
    await page.getByTestId('autolib-aba-regras').click();
    const incluirRegra = page.getByTestId('regra-incluir');
    await expect(incluirRegra).toBeDisabled();
    await page.getByTestId('regra-codigo').fill('GLI-AUTO');
    await page.getByTestId('regra-descricao').fill('Glicose dentro da faixa');
    await escolher(page.getByTestId('regra-exame'), { rotulo: 'GLICOSE SINTETICA' });
    await escolher(page.getByTestId('regra-analito'), { rotulo: 'ANALITO SINTETICO' });
    await page.getByTestId('regra-minimo').fill('120');
    await page.getByTestId('regra-maximo').fill('70');
    await expect(page.getByTestId('regra-erro')).toBeVisible();
    await expect(incluirRegra).toBeDisabled();
    await page.getByTestId('regra-minimo').fill('70');
    await page.getByTestId('regra-maximo').fill('120');
    await page.getByTestId('regra-delta').fill('20');
    expect(pedidos).toHaveLength(0);
    await incluirRegra.click();
    await expect(page.getByTestId('autolib-mensagem')).toBeVisible();
    expect(pedidos.at(-1)).toMatchObject({
      caminho: 'regras',
      corpo: {
        codigo: 'GLI-AUTO',
        exame: 501,
        acao: 'liberar',
        condicoes: [
          { tipo: 'faixa', analito: 701, operador: 'entre', minimo: 70, maximo: 120 },
          { tipo: 'delta', analito: 701, deltaPercentual: 20, deltaJanelaHoras: 72 },
        ],
      },
    });
    await expect(page.getByTestId('regra-item')).toHaveCount(1);

    // Delta check: limite por analito, retém para conferência por padrão.
    await page.getByTestId('autolib-aba-deltas').click();
    const incluirDelta = page.getByTestId('delta-incluir');
    await expect(incluirDelta).toBeDisabled();
    await escolher(page.getByTestId('delta-analito'), { rotulo: 'ANALITO SINTETICO' });
    await page.getByTestId('delta-variacao').fill('25');
    await incluirDelta.click();
    await expect(page.getByTestId('delta-item')).toHaveCount(1);
    expect(pedidos.at(-1)).toMatchObject({
      caminho: 'limites-delta',
      corpo: { analito: 701, tipo: 'percentual', variacaoMaxima: 25, janelaHoras: 72, acao: 'reter_revisao' },
    });

    // Interferente: condição da amostra que retém a autoliberação.
    await page.getByTestId('autolib-aba-interferentes').click();
    const incluirInterf = page.getByTestId('interf-incluir');
    await expect(incluirInterf).toBeDisabled();
    await escolher(page.getByTestId('interf-exame'), { rotulo: 'GLICOSE SINTETICA' });
    await page.getByTestId('interf-substancia').fill('HEMOLISE');
    await incluirInterf.click();
    await expect(page.getByTestId('interf-item')).toHaveCount(1);
    expect(pedidos.at(-1)).toMatchObject({
      caminho: 'interferentes',
      corpo: { exame: 501, substancia: 'HEMOLISE', efeito: 'variavel', bloqueia: true },
    });

    // Conferência: "Conferir e liberar" tira o retido da fila.
    await page.getByTestId('autolib-aba-fila').click();
    await page.getByTestId('autolib-liberar').first().click();
    await expect(page.getByTestId('autolib-mensagem')).toBeVisible();
    expect(pedidos.at(-1)).toMatchObject({ caminho: 'liberar/81' });
    await expect(page.getByTestId('autolib-retido')).toHaveCount(1);
    await expect(page.getByTestId('autolib-motivo')).toHaveText('Interferente');
  });
});
