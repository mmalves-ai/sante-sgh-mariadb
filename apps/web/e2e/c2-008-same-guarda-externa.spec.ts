// E2E @C2-008 (04-HOT L126, ficha F3.9): a guarda externa do volume pelo caminho da tela /same/guarda. O endereço antigo
// do menu (/same/movimentos, a movimentação pela conta e pelo código da operação, aposentada) leva à guarda pelo volume.
// O arquivista acha o paciente pelo prontuário; o envio à empresa de guarda fica travado até a empresa e a caixa serem
// informadas (a regra do domínio, conferida na hora); enviado, o volume mostra onde está (a caixa) e o botão passa a
// registrar o retorno, que volta o volume ao local. As rotas /api/same/guarda exigem o banco próprio e o E2E roda com a
// fonte sintética (sem núcleo): as respostas da API são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco
// está no contrato de efeito apps/api/src/modulos/adt/same-guarda-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7402;
const VOLUME = 9201;

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

function volume(fora: boolean) {
  return {
    id: VOLUME,
    numero: 1,
    matricula: '7402-3-1',
    tipoDocumento: { id: 3, descricao: 'Prontuário em papel' },
    atendimento: null,
    situacao: 'arquivado',
    noLocal: !fora,
    local: { id: 21, caminho: 'Sala 1 > Armário 3' },
    posicao: { linha: 'B', coluna: '4' },
    ondeEsta: fora ? 'Guarda externa (CX-77)' : 'Sala 1 > Armário 3',
    previsaoRetorno: null,
    retornoAtrasado: false,
    extraviadoEm: null,
    guardaExterna: fora ? { desde: '2026-11-25T10:00:00.000Z', caixa: 'CX-77' } : null,
    guardaDesde: '2026-11-20T10:00:00.000Z',
    prazoGuardaAnos: 20,
    versao: fora ? 2 : 1,
    movimentos: [
      {
        id: 1,
        em: '2026-11-20T10:00:00.000Z',
        operacao: {
          codigo: 'registro',
          descricao: 'Registro no arquivo',
          tipo: 'registro',
          sentido: 'entrada',
        },
        setorOrigem: null,
        setorDestino: null,
        localDestino: 'Sala 1 > Armário 3',
        responsavel: null,
        previsaoRetorno: null,
        por: 'Arquivista sintético',
        excluido: false,
      },
    ],
  };
}

test.describe('Guarda externa do volume @C2-008 @fase3', () => {
  test.setTimeout(180_000);
  test('endereço antigo leva à guarda; envio travado até empresa e caixa; enviado e retornado com o corpo certo; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let fora = false;
    await page.route('**/api/same/guarda/**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace('/api/same/guarda/', '');
      if (req.method() === 'GET') {
        if (caminho === 'operacoes') return json(rota, { itens: [] });
        if (caminho === 'apoio')
          return json(rota, {
            locais: [
              {
                id: 21,
                nivel: 'armario',
                codigo: 'A3',
                caminho: 'Sala 1 > Armário 3',
                pai: null,
                capacidade: null,
                volumes: 1,
              },
            ],
            setores: [],
            tiposDocumento: [{ id: 3, descricao: 'Prontuário em papel' }],
          });
        if (caminho === 'deliberacoes') return json(rota, { itens: [] });
        if (caminho.startsWith('busca')) return json(rota, { paciente: PACIENTE, volume: null });
        if (caminho === `pacientes/${PACIENTE}/volumes`) return json(rota, { itens: [volume(fora)] });
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === `volumes/${VOLUME}/guarda-externa`) {
        fora = true;
        return json(rota, { id: 31 });
      }
      if (caminho === `volumes/${VOLUME}/guarda-externa/retorno`) {
        fora = false;
        return json(rota, { id: 32 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.ARQUIVO');
    await page.goto('/same/movimentos');
    await expect(page).toHaveURL(/\/same\/guarda$/);
    await expect(page.getByTestId('same-guarda')).toBeVisible();
    await page.getByTestId('guarda-prontuario').locator('input').fill(String(PACIENTE));
    await page.getByTestId('guarda-buscar').click();
    const cartao = page.getByTestId('guarda-volume-1');
    await expect(cartao.getByTestId('guarda-onde')).toHaveText('Sala 1 > Armário 3');

    // Sem a empresa e a caixa o envio não sai (validação na hora, nenhum pedido).
    const externa = cartao.getByTestId('guarda-externa');
    await expect(externa).toBeVisible();
    await expect(externa.getByTestId('guarda-externa-gravar')).toBeDisabled();
    await externa.getByTestId('guarda-externa-empresa').locator('input').fill('Guarda sintética');
    await expect(externa.getByTestId('guarda-externa-gravar')).toBeDisabled();
    await externa.getByTestId('guarda-externa-caixa').locator('input').fill('CX-77');
    await expect(externa.getByTestId('guarda-externa-gravar')).toBeEnabled();
    expect(pedidos).toHaveLength(0);
    await semViolacaoAxe(page, '/same/guarda (guarda externa)');
    await externa.getByTestId('guarda-externa-gravar').click();

    await expect(cartao.getByTestId('guarda-onde')).toHaveText('Guarda externa (CX-77)');
    expect(pedidos[0]).toMatchObject({
      caminho: `volumes/${VOLUME}/guarda-externa`,
      corpo: { empresa: 'Guarda sintética', caixa: 'CX-77', versao: 1 },
    });
    await expect(externa.getByTestId('guarda-externa-desde')).toBeVisible();
    await expect(externa.getByTestId('guarda-externa-gravar')).toBeEnabled();
    await externa.getByTestId('guarda-externa-gravar').click();

    await expect(cartao.getByTestId('guarda-onde')).toHaveText('Sala 1 > Armário 3');
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]).toMatchObject({
      caminho: `volumes/${VOLUME}/guarda-externa/retorno`,
      corpo: { versao: 2 },
    });
  });
});
