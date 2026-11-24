// E2E @F78-09-1 (F7, 09-AREA linha 68): análise da cultura positiva pela CCIH pelo caminho da tela. O controlador de
// infecção chega à fila pela navegação da CCIH, vê a cultura agrupada pelo paciente com o germe multirresistente e as
// pendências, abre a análise na linha: o que falta aparece na hora e o botão fica travado; a conduta que pede a
// orientação do prescritor exige a marca; a precaução herdada do germe multirresistente vem marcada. A gravação sai com
// o corpo certo e a tela mostra as pendências devolvidas e as análises do paciente. As rotas /api/qualidade/ccih/culturas
// exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas pelo Playwright com
// massa SINTÉTICA. O efeito no banco está no contrato de efeito apps/api/src/modulos/qualidade/analise-cultura.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7501;
const CULTURA = 9001;
const GERME_MR = 41;
const GERME_2 = 42;

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

function cultura(analisado: boolean) {
  return {
    id: CULTURA,
    paciente: PACIENTE,
    nome: 'PACIENTE SINTETICO CCIH',
    atendimento: 3301,
    exame: 'Hemocultura sintética',
    material: 'Sangue',
    resultadoEm: '2026-11-23T08:00:00',
    situacao: 'final',
    germes: [
      { id: GERME_MR, microrganismo: 'GERME SINTETICO A', multirresistente: true, analisado },
      { id: GERME_2, microrganismo: 'GERME SINTETICO B', multirresistente: false, analisado: false },
    ],
    faltaAnalisar: true,
    pendencias: analisado ? ['abrir-ficha-iras'] : [],
    pendente: true,
  };
}

const condutas = [
  {
    id: 1,
    codigo: 'contato',
    descricao: 'Precaução de contato e orientar o prescritor',
    ativo: true,
    classificacaoAplicavel: null,
    abreCaso: true,
    indicaPrecaucao: false,
    exigeResposta: true,
  },
  {
    id: 2,
    codigo: 'descartar',
    descricao: 'Descartar como contaminante',
    ativo: true,
    classificacaoAplicavel: 'contaminacao',
    abreCaso: false,
    indicaPrecaucao: false,
    exigeResposta: false,
  },
];

test.describe('Análise da cultura positiva @F78-09-1 @fase7', () => {
  test.setTimeout(180_000);
  test('fila por paciente, falta na hora, conduta com prescritor, precaução herdada, corpo certo e pendências; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let analisado = false;
    await page.route('**/api/qualidade/ccih/culturas**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/qualidade\/ccih\/culturas\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, [cultura(analisado)]);
        if (caminho === 'condutas') return json(rota, condutas);
        if (caminho === 'analises')
          return json(
            rota,
            analisado
              ? [
                  {
                    id: 77,
                    cultura: CULTURA,
                    isolado: GERME_MR,
                    paciente: PACIENTE,
                    classificacao: 'infeccao',
                    conduta: 1,
                    condutaDescricao: null,
                    precaucaoIndicada: true,
                    prescritorOrientado: true,
                    laudoRetificado: false,
                    casoInfeccao: null,
                    analisadaEm: '2026-11-24T09:00:00',
                    analista: 'SINT.CCIH',
                    versao: 1,
                    pendencias: ['abrir-ficha-iras'],
                  },
                ]
              : [],
          );
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === `${CULTURA}/analise`) {
        analisado = true;
        return json(
          rota,
          { id: 77, paciente: PACIENTE, pendencias: ['abrir-ficha-iras', 'aplicar-precaucao'] },
          201,
        );
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.CCIH');
    await page.goto('/qualidade/ccih/iras');
    await page.getByTestId('nav-ccih-culturas').click();
    await expect(page).toHaveURL(/\/qualidade\/ccih\/culturas$/);
    await expect(page.getByTestId('tela-ccih-culturas')).toBeVisible();
    const grupo = page.getByTestId(`culturas-paciente-${PACIENTE}`);
    await expect(grupo).toBeVisible();
    await expect(grupo.getByTestId(`cultura-falta-${CULTURA}`)).toBeVisible();
    await semViolacaoAxe(page, '/qualidade/ccih/culturas (fila)');

    await grupo.getByTestId(`cultura-analisar-${CULTURA}`).click();
    const form = page.getByTestId('form-analise');
    await expect(form).toBeVisible();
    await expect(page.getByTestId('analise-falta')).toBeVisible();
    await expect(form.getByTestId('analise-gravar')).toBeDisabled();

    await escolher(form.getByTestId('analise-germe'), { rotulo: /GERME SINTETICO A/ });
    await escolher(form.getByTestId('analise-classificacao'), { rotulo: 'Infecção' });
    await expect(page.getByTestId('analise-precaucao-herdada')).toBeVisible();
    await escolher(form.getByTestId('analise-conduta'), {
      rotulo: 'Precaução de contato e orientar o prescritor',
    });
    await expect(page.getByTestId('analise-falta')).toContainText('prescritor');
    await expect(form.getByTestId('analise-gravar')).toBeDisabled();
    await form.getByTestId('analise-prescritor').check();
    await expect(page.getByTestId('analise-falta')).toHaveCount(0);
    expect(pedidos).toHaveLength(0);
    await form.getByTestId('analise-gravar').click();

    await expect(page.getByTestId('cultura-aviso')).toContainText('ficha de IRAS');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      caminho: `${CULTURA}/analise`,
      corpo: {
        classificacao: 'infeccao',
        isolado: GERME_MR,
        conduta: 1,
        condutaDescricao: null,
        precaucaoIndicada: true,
        prescritorOrientado: true,
        casoInfeccao: null,
      },
    });
    await expect(grupo.getByTestId(`cultura-pendencia-${CULTURA}-abrir-ficha-iras`)).toBeVisible();
    await grupo.getByTestId(`culturas-ver-analises-${PACIENTE}`).click();
    await expect(page.getByTestId('analise-77')).toContainText('Infecção');
    await semViolacaoAxe(page, '/qualidade/ccih/culturas (análises do paciente)');
  });
});
