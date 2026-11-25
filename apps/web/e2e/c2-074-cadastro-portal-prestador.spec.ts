// E2E @C2-074 (08-SGO L113): "Meu cadastro e avisos" no portal do prestador, com respostas simuladas (fonte sintética;
// a porta própria só existe no banco e tem o contrato de efeito na integração). O prestador vê o aviso em destaque e o
// documento exigido; o pedido de alteração de endereço é validado na hora (CEP e e-mail), passa pelo painel de
// confirmação e aparece na lista; o pedido recebido é cancelado. Nenhuma saída externa.
import { expect, test } from '@playwright/test';
import { escolher } from './combos.js';

const sessao = {
  nome: 'Responsável sintético',
  prestador: 7,
  prestadorNome: 'Clínica Sintética',
  operadora: 1,
  funcoes: [1, 3, 7],
  expiraEm: '2099-01-01T00:00:00',
};
const pedido = (id: number, situacao: string, versao = 1) => ({
  id,
  numero: `PW${String(id).padStart(8, '0')}`,
  tipo: 'endereco',
  situacao,
  recebidoEm: '2026-11-25T10:00:00',
  analisadoEm: null,
  motivoRecusa: null,
  versao,
});

test('@C2-074 avisos, documentos, pedido de alteração e cancelamento no portal do prestador', async ({
  page,
}) => {
  let pedidos = [pedido(11, 'recebido')];
  const corpos: unknown[] = [];
  await page.route('**/api/portal-prestador/sessao', (r) => r.fulfill({ json: sessao }));
  await page.route('**/api/portal-prestador/avisos', (r) =>
    r.fulfill({
      json: {
        itens: [
          {
            id: 2,
            tipo: 'comunicado',
            titulo: 'Novo prazo de lotes',
            conteudo: 'Texto sintético.',
            link: null,
            exibirDe: '2026-11-20T00:00:00',
            destaque: true,
          },
        ],
      },
    }),
  );
  await page.route('**/api/portal-prestador/documentos-exigidos', (r) =>
    r.fulfill({
      json: {
        itens: [
          {
            id: 5,
            descricao: 'Alvará sanitário',
            obrigatorio: true,
            extensoes: 'pdf',
            tamanhoMaximoKb: 2048,
          },
        ],
      },
    }),
  );
  await page.route('**/api/portal-prestador/pedidos-cadastro/11/cancelar', async (r) => {
    corpos.push(r.request().postDataJSON());
    pedidos = pedidos.map((p) => (p.id === 11 ? pedido(11, 'cancelado', 2) : p));
    await r.fulfill({ json: { id: 11, versao: 2, situacao: 'cancelado' } });
  });
  await page.route('**/api/portal-prestador/pedidos-cadastro', async (r) => {
    if (r.request().method() === 'POST') {
      corpos.push(r.request().postDataJSON());
      pedidos = [pedido(12, 'recebido'), ...pedidos];
      await r.fulfill({
        json: { id: 12, versao: 2, numero: 'PW00000012', mensagem: 'Pedido PW00000012 recebido.' },
      });
    } else await r.fulfill({ json: { itens: pedidos } });
  });

  await page.goto('/prestador/cadastro');
  const tela = page.getByTestId('portal-prestador-cadastro');
  await expect(tela.getByTestId('pp-avisos')).toContainText('Novo prazo de lotes');
  await expect(tela.getByTestId('pp-documentos')).toContainText('Alvará sanitário');

  await escolher(tela.getByTestId('pp-cad-tipo'), { rotulo: /Endereço/ });
  await page.locator('#pp-cad-nome').fill('Clínica Sintética');
  await page.locator('#pp-cad-cep').fill('0100');
  await page.locator('#pp-cad-email').fill('contato@');
  await expect(tela.getByTestId('pp-cad-problemas')).toContainText('CEP');
  await expect(tela.getByTestId('pp-cad-problemas')).toContainText('e-mail');
  await expect(tela.getByTestId('pp-cad-enviar')).toBeDisabled();
  await page.locator('#pp-cad-cep').fill('01001000');
  await page.locator('#pp-cad-email').fill('contato@exemplo.test');
  await page.locator('#pp-cad-muda').fill('Rua Sintética, 10');
  await tela.getByTestId('pp-cad-enviar').click();
  await expect(tela.getByTestId('pp-cad-confirmacao')).toBeVisible();
  await tela.getByTestId('pp-cad-confirmar').click();
  await expect(tela.getByTestId('pp-cad-mensagem')).toContainText('PW00000012');
  await expect(tela.getByTestId('pp-cad-pedidos')).toContainText('PW00000012');
  expect(corpos[0]).toMatchObject({ tipo: 'endereco', cep: '01001000', cpf: null, cnpj: null });

  await tela.getByTestId('pp-cad-cancelar-11').click();
  await expect(tela.getByTestId('pp-cad-mensagem')).toContainText('PW00000011');
  expect(corpos[1]).toEqual({ versao: 1 });
});
