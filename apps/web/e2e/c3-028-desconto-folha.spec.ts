// C3-028 (08-SGO linha 97): desconto em folha da mensalidade, pelo caminho da tela. As rotas /api/operadora/desconto-folha
// exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas destas rotas (e a da
// tela da cobrança, de onde vêm as operadoras) são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a
// tela: a rota abre a tela, a contratante vem da busca remota, a prévia mostra os itens e as críticas, a geração vai
// com o tipo e abre a ficha, o envio, a leitura do retorno (matrícula;valor e a data do crédito), a conferência e o
// cancelamento levam a versão lida. O efeito no banco está no contrato de efeito
// (apps/api/src/modulos/operadora/desconto-folha-propria.int.spec.ts).
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

const TELA_COBRANCA = {
  liberacao: { ligada: true, motivo: null },
  acoes: { gerar: true, motivo: null },
  operadoras: [{ id: 7, razaoSocial: 'Operadora Sintética', registroAns: '000000' }],
  hoje: '2026-10-15',
  mensagens: { enviar: false, motivo: 'desligado' },
  parametros: {
    multaPercentual: 2,
    jurosPercentualMes: 1,
    diasLimiteNotificacao: 50,
    diasInadimplencia: 60,
    diasPrazoNotificacao: 10,
    parcelasMaximas: 12,
  },
};

test.describe('C3-028 desconto em folha da mensalidade @C3-028', () => {
  test('prévia com críticas, gerar, enviar, ler o retorno, conferir; cancelar outra remessa', async ({ page }) => {
    const pedidos: { metodo: string; caminho: string; corpo: Record<string, unknown> }[] = [];
    let situacao: 'gerada' | 'enviada' | 'retorno_recebido' | 'conferida' = 'gerada';
    let versao = 1;
    const remessa = () => ({
      id: 301,
      versao,
      numero: 'DF-SINT-1',
      contratanteNome: 'Órgão Sintético',
      competencia: '2026-10',
      tipo: 'mensal',
      situacao,
      valorEnviado: 500,
      valorDescontado: situacao === 'gerada' || situacao === 'enviada' ? 0 : 450,
      itens: 2,
    });
    const outra = {
      id: 302,
      versao: 4,
      numero: 'DF-SINT-2',
      contratanteNome: 'Órgão Sintético',
      competencia: '2026-09',
      tipo: 'complementar',
      situacao: 'gerada',
      valorEnviado: 100,
      valorDescontado: 0,
      itens: 1,
    };
    let gerou = false;
    await page.route('**/api/operadora/cobranca/tela', (r) => json(r, TELA_COBRANCA));
    await page.route('**/api/operadora/desconto-folha/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      const caminho = url.pathname;
      if (req.method() === 'GET') {
        if (caminho.endsWith('/contratantes'))
          return json(r, [{ id: 41, codigo: 'C-SINT', nome: 'Órgão Sintético' }]);
        if (caminho.endsWith('/remessas')) return json(r, gerou ? [remessa(), outra] : [outra]);
        if (caminho.endsWith('/remessas/302'))
          return json(r, { ...outra, detalhe: [] });
        if (caminho.endsWith('/remessas/301'))
          return json(r, {
            ...remessa(),
            detalhe: [
              {
                sequencia: 1,
                cobranca: 'MF-SINT-1',
                matriculaFuncional: 'MAT-001',
                competencia: '2026-10',
                valorEnviado: 300,
                valorAtrasado: 50,
                valorDescontado: situacao === 'gerada' || situacao === 'enviada' ? null : 300,
                situacao: situacao === 'gerada' || situacao === 'enviada' ? 'pendente' : 'descontado',
              },
            ],
          });
        return json(r, { mensagem: 'não simulado' }, 404);
      }
      const corpo = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      pedidos.push({ metodo: req.method(), caminho, corpo });
      if (caminho.endsWith('/previa'))
        return json(r, {
          itens: [
            {
              sequencia: 1,
              numero: 'MF-SINT-1',
              matriculaFuncional: 'MAT-001',
              competencia: '2026-10',
              valorEnviado: 300,
              valorAtrasado: 50,
            },
          ],
          criticas: [{ fatura: 9, numero: 'MF-SINT-9', codigo: 'sem-matricula', mensagem: 'Titular sem matrícula funcional.' }],
          valorTotal: 300,
          valorAtrasado: 50,
        });
      if (caminho.endsWith('/remessas')) {
        gerou = true;
        return json(r, { id: 301, versao: 1, numero: 'DF-SINT-1' }, 201);
      }
      const passa = (s: typeof situacao) => {
        situacao = s;
        versao += 1;
        return json(r, { id: 301, versao });
      };
      if (caminho.endsWith('/301/envio')) return passa('enviada');
      if (caminho.endsWith('/301/retorno')) return passa('retorno_recebido');
      if (caminho.endsWith('/301/conferencia')) return passa('conferida');
      if (caminho.endsWith('/302/cancelamento')) return json(r, { id: 302, versao: 5 });
      return json(r, { mensagem: 'não simulado' }, 404);
    });

    // Entra como o gestor da operadora (perfil operadora-gestor: operadora.cobranca.ler e .gerar). O SINT.ADMIN não tem os
    // perfis da operadora própria (nenhuma opção do outro sistema dá a operadora, D-PERM-56), e a rota abriria em Sem
    // permissão.
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/desconto-folha');
    await expect(page.getByTestId('tela-desconto-folha')).toBeVisible();
    await expect(page.getByTestId('desconto-folha-previa')).toBeDisabled();

    await escolher(page.getByTestId('desconto-folha-contratante'), { rotulo: 'Sintético' });
    await page.getByTestId('desconto-folha-competencia').fill('2026-10');
    await page.getByTestId('desconto-folha-previa').click();
    await expect(page.getByTestId('desconto-folha-previa-itens')).toContainText('MAT-001');
    await expect(page.getByTestId('desconto-folha-criticas')).toContainText('MF-SINT-9');
    expect(pedidos[0]).toMatchObject({
      caminho: '/api/operadora/desconto-folha/previa',
      corpo: { operadora: 7, contratante: 41, competencia: '2026-10' },
    });

    await page.getByTestId('desconto-folha-gerar').click();
    await expect(page.getByTestId('desconto-folha-aviso')).toContainText('DF-SINT-1');
    expect(pedidos[1]).toMatchObject({
      caminho: '/api/operadora/desconto-folha/remessas',
      corpo: { operadora: 7, contratante: 41, competencia: '2026-10', tipo: 'mensal', observacao: null },
    });
    await expect(page.getByTestId('desconto-folha-ficha')).toContainText('MF-SINT-1');

    await page.getByTestId('desconto-folha-enviar').click();
    await expect(page.getByTestId('desconto-folha-retorno-texto')).toBeVisible();
    expect(pedidos[2]).toMatchObject({ caminho: '/api/operadora/desconto-folha/remessas/301/envio', corpo: { versao: 1 } });

    await page.getByTestId('desconto-folha-retorno-texto').fill('MAT-001;300,00');
    await page.getByTestId('desconto-folha-credito').fill('2026-11-05');
    await page.getByTestId('desconto-folha-ler-retorno').click();
    await expect(page.getByTestId('desconto-folha-conferir')).toBeVisible();
    expect(pedidos[3]).toMatchObject({
      caminho: '/api/operadora/desconto-folha/remessas/301/retorno',
      corpo: { versao: 2, texto: 'MAT-001;300,00', creditoEm: '2026-11-05' },
    });

    await page.getByTestId('desconto-folha-conferir').click();
    await expect(page.getByTestId('desconto-folha-ficha')).toContainText('Conferida');
    expect(pedidos[4]).toMatchObject({ caminho: '/api/operadora/desconto-folha/remessas/301/conferencia', corpo: { versao: 3 } });

    await page.getByTestId('desconto-folha-abrir-302').click();
    await expect(page.getByTestId('desconto-folha-cancelar')).toBeDisabled();
    await page.getByTestId('desconto-folha-motivo').fill('Competência refeita');
    await page.getByTestId('desconto-folha-cancelar').click();
    await expect.poll(() => pedidos.length).toBe(6);
    expect(pedidos[5]).toMatchObject({
      caminho: '/api/operadora/desconto-folha/remessas/302/cancelamento',
      corpo: { versao: 4, motivo: 'Competência refeita' },
    });

    await semViolacaoAxe(page, 'desconto em folha da mensalidade');
  });
});
