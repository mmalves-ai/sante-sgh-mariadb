// E2E @F78-05-1 (F8, 05-SADT linha 6): cadastro dos limites do pedido de exame pelo caminho da tela /sadt/limites. A
// equipe do laboratório abre a tela: a vigência da cota já vem no dia do estabelecimento (o servidor manda pelo fuso
// dele; nunca o UTC do navegador), o botão só libera com o exame e o limite, a cota sai por unidade assistencial e por
// setor solicitante escolhidos em SanteSelecao, e o bloqueio de alcance global aparece marcado na lista. As rotas
// /api/sadt/limites exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas são simuladas
// pelo Playwright com massa SINTÉTICA. O efeito no banco (estabelecimento da regra, recusa de outra unidade, alcance
// global só do administrador, avisos no pedido) está em apps/api/src/modulos/sadt/aplicacao/limites-exame.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const HOJE_DO_ESTABELECIMENTO = '2026-03-15';

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

const lista = (cotas: unknown[]) => ({
  cotas,
  intervalos: [],
  bloqueios: [
    {
      id: 31,
      exame: 501,
      exameAvaliado: null,
      analito: 701,
      operador: 'maior',
      valor: '10',
      janelaDias: 30,
      acao: 'alertar',
      mensagem: null,
      ativo: true,
      global: true,
    },
  ],
  fontes: [{ id: 11, nome: 'CONVENIO SINTETICO' }],
  unidades: [{ id: 21, nome: 'UNIDADE SINTETICA A' }],
  setoresSolicitantes: [{ id: 41, nome: 'SETOR SOLICITANTE SINTETICO' }],
  hoje: HOJE_DO_ESTABELECIMENTO,
});

test.describe('Limites do pedido de exame @F78-05-1 @fase7', () => {
  test.setTimeout(180_000);
  test('vigência no dia do estabelecimento, cota por unidade e setor solicitante, alcance global marcado; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let cotas: unknown[] = [];
    await page.route('**/api/sadt/catalogo/opcoes**', (rota) =>
      json(rota, {
        exames: [{ id: 501, nome: 'HEMOGRAMA SINTETICO' }],
        setores: [{ id: 601, nome: 'LABORATORIO SINTETICO' }],
        analitos: [{ id: 701, nome: 'ANALITO SINTETICO' }],
      }),
    );
    await page.route('**/api/sadt/limites**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/limites\/?/, '');
      if (req.method() === 'GET') return json(rota, lista(cotas));
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === 'cotas') {
        cotas = [
          {
            id: 91,
            exame: 501,
            exameNome: 'HEMOGRAMA SINTETICO',
            setor: null,
            fontePagadora: null,
            unidade: 21,
            setorSolicitante: 41,
            periodo: 'mes',
            quantidadeMaxima: 5,
            percentualLimite: null,
            permiteExceder: false,
            vigenciaInicio: HOJE_DO_ESTABELECIMENTO,
            vigenciaFim: null,
            ativo: true,
            usoNoPeriodo: 0,
          },
        ];
        return json(rota, { id: 91 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/limites');
    await expect(page.getByTestId('limites-exame')).toBeVisible();
    await expect(page.getByTestId('cota-inicio')).toHaveValue(HOJE_DO_ESTABELECIMENTO);
    await expect(page.getByTestId('bloqueio-global-31')).toHaveCount(1);
    await semViolacaoAxe(page, '/sadt/limites');

    const incluir = page.getByTestId('cota-incluir');
    await expect(incluir).toBeDisabled();
    await escolher(page.getByTestId('cota-exame'), { rotulo: 'HEMOGRAMA SINTETICO' });
    await escolher(page.getByTestId('cota-unidade'), { rotulo: 'UNIDADE SINTETICA A' });
    await escolher(page.getByTestId('cota-solicitante'), { rotulo: 'SETOR SOLICITANTE SINTETICO' });
    await expect(incluir).toBeDisabled();
    await page.getByTestId('cota-quantidade').fill('5');
    expect(pedidos).toHaveLength(0);
    await incluir.click();

    await expect(page.getByTestId('limites-mensagem')).toBeVisible();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      caminho: 'cotas',
      corpo: {
        exame: 501,
        unidade: 21,
        setorSolicitante: 41,
        quantidadeMaxima: 5,
        vigenciaInicio: HOJE_DO_ESTABELECIMENTO,
      },
    });
    await expect(page.getByTestId('limites-cotas')).toContainText('UNIDADE SINTETICA A');
    await expect(page.getByTestId('limites-cotas')).toContainText('SETOR SOLICITANTE SINTETICO');
  });
});
