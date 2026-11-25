// C1-068 (06-SUS linha 59): leitos de UTI habilitados pelo SUS por tipo e competência, pelo caminho da tela. As rotas
// /api/sus/leitos-uti exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas
// destas rotas são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a rota abre a tela, a
// validação aparece na hora (sem tipo e sem quantidade o botão fica travado, sem ir ao servidor), a inclusão vai com a
// vigência por competência (primeiro e último dia) e aparece na lista, a alteração da vigência na própria linha leva a
// versão lida e a inativação pede confirmação. O efeito no banco (encerramento da anterior, sobreposição, versão,
// trilha, diária por competência) está nos contratos de efeito (apps/api/src/modulos/sus/leitos-uti-propria.int.spec.ts
// e porta-propria-aih.int.spec.ts).
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

test.describe('C1-068 leitos de UTI habilitados @C1-068', () => {
  test('habilitação validada na hora, incluída por competência, vigência alterada e inativada', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const itens: Record<string, unknown>[] = [];
    await page.route('**/api/sus/leitos-uti**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/opcoes'))
          return json(r, {
            tipos: [{ id: 41, codigo: '9875', descricao: 'UTI adulto tipo II (sintético)' }],
            unidades: [{ id: 51, codigo: 'UTI-S', descricao: 'Unidade sintética de terapia intensiva' }],
          });
        return json(r, { itens });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname === '/api/sus/leitos-uti') {
        itens.push({
          id: 701,
          tipo: 41,
          tipoCodigo: '9875',
          tipoDescricao: 'UTI adulto tipo II (sintético)',
          classe: 'adulto',
          nivel: 2,
          unidade: corpo['unidade'],
          unidadeDescricao: 'Unidade sintética de terapia intensiva',
          quantidadeLeitos: corpo['quantidadeLeitos'],
          liberaCritica: corpo['liberaCritica'],
          vigenciaInicio: corpo['vigenciaInicio'],
          vigenciaFim: corpo['vigenciaFim'],
          ativo: true,
          vigente: true,
          versao: 1,
        });
        return json(r, { id: 701, encerrada: null }, 201);
      }
      const x = itens[0]!;
      if (url.pathname.endsWith('/vigencia')) Object.assign(x, corpo, { versao: 2 });
      else Object.assign(x, { ativo: false, vigente: false, versao: 3 });
      return json(r, { id: 701 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/faturamento/sus/cadastros/leitos-uti');
    await expect(page.getByTestId('tela-leitos-uti')).toBeVisible();
    await expect(page.getByTestId('leitos-uti-vazio')).toBeVisible();

    // Validação na hora: sem tipo e sem quantidade, o botão fica travado.
    await expect(page.getByTestId('leitos-uti-problemas')).toContainText('Escolha o tipo de UTI.');
    await expect(page.getByTestId('leitos-uti-incluir')).toBeDisabled();
    await escolher(page.getByTestId('leitos-uti-tipo'), '41');
    await escolher(page.getByTestId('leitos-uti-unidade'), '51');
    await page.getByTestId('leitos-uti-quantidade').fill('10');
    await page.getByTestId('leitos-uti-inicio').fill('2026-03');
    await page.getByTestId('leitos-uti-fim').fill('2026-02');
    await expect(page.getByTestId('leitos-uti-problemas')).toContainText(
      'O fim da vigência é anterior ao início.',
    );
    await page.getByTestId('leitos-uti-fim').fill('');
    await expect(page.getByTestId('leitos-uti-problemas')).toHaveCount(0);
    await page.getByTestId('leitos-uti-incluir').click();
    await expect(page.getByTestId('leitos-uti-aviso')).toHaveText('Habilitação gravada.');
    expect(pedidos[0]).toEqual({
      caminho: '/api/sus/leitos-uti',
      corpo: {
        tipo: 41,
        unidade: 51,
        quantidadeLeitos: 10,
        vigenciaInicio: '2026-03-01',
        vigenciaFim: null,
        liberaCritica: false,
      },
    });
    await expect(page.getByTestId('leitos-uti-linha-701')).toContainText('2026-03');
    await expect(page.getByTestId('leitos-uti-situacao-701')).toHaveText('Vigente');

    // A vigência muda na própria linha, com a versão lida e o último dia da competência final.
    await page.getByTestId('leitos-uti-editar-701').click();
    await page.getByTestId('leitos-uti-vig-fim').fill('2026-12');
    await page.getByTestId('leitos-uti-vig-gravar').click();
    await expect(page.getByTestId('leitos-uti-aviso')).toHaveText('Habilitação gravada.');
    expect(pedidos[1]).toEqual({
      caminho: '/api/sus/leitos-uti/701/vigencia',
      corpo: { vigenciaInicio: '2026-03-01', vigenciaFim: '2026-12-31', liberaCritica: false, versao: 1 },
    });

    // Inativar pede confirmação e leva a versão; a linha fica, inativa.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('leitos-uti-inativar-701').click();
    await expect(page.getByTestId('leitos-uti-situacao-701')).toHaveText('Inativa');
    expect(pedidos[2]).toEqual({ caminho: '/api/sus/leitos-uti/701/inativar', corpo: { versao: 2 } });
    await semViolacaoAxe(page, 'leitos de UTI habilitados');
  });
});
