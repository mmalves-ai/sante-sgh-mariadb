// C2-018 (08-INTG linha 132): prescrição digital por plataforma externa, pelo caminho da tela. As rotas
// /api/integracoes/prescricao-digital exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por
// isso as respostas destas rotas são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: a busca
// escolhe o paciente (visão por paciente), a plataforma vem escolhida quando há uma só, a receita sem assinatura
// ICP-Brasil mostra o bloqueio na hora e não deixa enviar, a assinada vai com a receita e a plataforma; o retorno
// validável (código e endereço) aparece no envio; o cancelamento pede o motivo (curto trava o botão) e vai com a
// versão lida. O efeito no banco (envio, fila de saída, cancelamento, retorno) está no contrato de efeito
// apps/api/src/modulos/integracao/prescricao-digital-propria.int.spec.ts e no enviador do worker.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { esperarValor } from './combos.js';

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

const PACIENTE = { id: 9101, nome: 'Paciente Sintético Receita', prontuario: '910001' };
const receita = (id: number, numero: string, nivel: string | null) => ({
  id,
  numero,
  emitidaEm: '2026-11-25T10:00:00.000Z',
  validadeAte: '2099-12-31',
  situacao: 'emitida',
  tipo: 'Receita simples',
  controleEspecial: false,
  prescritor: 'Prescritor Sintético',
  assinatura: nivel ? 'assinado' : null,
  nivelAssinatura: nivel,
  envios: [] as Record<string, unknown>[],
});

test.describe('C2-018 prescrição digital por plataforma externa @C2-018', () => {
  test('receita assinada enviada à plataforma, retorno validável e cancelamento com motivo', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const receitas = [receita(501, 'R-501', 'icp-brasil'), receita(502, 'R-502', 'eletronica-avancada')];
    await page.route('**/api/integracoes/prescricao-digital/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      const c = url.pathname.replace('/api/integracoes/prescricao-digital', '');
      if (req.method() === 'GET') {
        if (c === '/plataformas')
          return json(r, {
            itens: [{ codigo: 'plat-sint', nome: 'Plataforma Sintética', parceiroApiAtivo: true }],
          });
        if (c === '/pacientes') return json(r, { itens: [PACIENTE] });
        if (c.startsWith('/paciente/')) return json(r, { receitas });
        return json(r, { itens: [] });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (c === '/envios') {
        // O retorno do simulador já gravado pelo worker: aceita, com código e endereço de validação.
        receitas[0]!.envios = [
          {
            id: 701,
            receita: 501,
            plataforma: 'plat-sint',
            plataformaNome: 'Plataforma Sintética',
            situacao: 'aceita',
            situacaoExterna: 'emitida',
            identificadorExterno: 'SIM-0000C2018',
            codigoValidacao: '123456',
            urlValidacao: 'https://validar.prescricao-simulada.invalid/receita/SIM-0000C2018',
            filaSituacao: 'confirmada',
            enviadoEm: '2026-11-25T10:01:00.000Z',
            retornoEm: '2026-11-25T10:01:00.000Z',
            canceladoEm: null,
            motivoCancelamento: null,
            criadoEm: '2026-11-25T10:00:30.000Z',
            versao: 3,
          },
        ];
        return json(r, { id: 701, mensagem: 801 }, 201);
      }
      receitas[0]!.envios = [
        { ...receitas[0]!.envios[0], situacao: 'cancelada', motivoCancelamento: corpo['motivo'], versao: 4 },
      ];
      return json(r, { id: 701, mensagem: 802 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/pep/prescricao-digital');
    await expect(page.getByTestId('tela-prescricao-digital')).toBeVisible();
    await esperarValor(page.getByTestId('prescricao-plataforma'), 'plat-sint');

    await page.getByTestId('prescricao-busca-paciente').fill('Sintético');
    await page.getByTestId(`prescricao-paciente-${PACIENTE.id}`).click();
    await expect(page.getByTestId('prescricao-paciente-escolhido')).toContainText(PACIENTE.prontuario);

    // A receita sem ICP-Brasil: o bloqueio aparece na hora e o botão fica travado.
    await expect(page.getByTestId('prescricao-bloqueio-502')).toContainText('ICP-Brasil');
    await expect(page.getByTestId('prescricao-enviar-502')).toBeDisabled();

    await page.getByTestId('prescricao-enviar-501').click();
    await expect(page.getByTestId('prescricao-aviso')).toBeVisible();
    expect(pedidos[0]).toMatchObject({ corpo: { receita: 501, plataforma: 'plat-sint' } });
    await expect(page.getByTestId('prescricao-codigo-701')).toContainText('123456');
    await expect(page.getByTestId('prescricao-enviar-501')).toBeDisabled();

    await page.getByTestId('prescricao-cancelar-701').click();
    await page.getByTestId('prescricao-motivo').fill('curto');
    await expect(page.getByTestId('prescricao-confirmar-cancelamento')).toBeDisabled();
    await page.getByTestId('prescricao-motivo').fill('Receita substituída pelo prescritor');
    await page.getByTestId('prescricao-confirmar-cancelamento').click();
    await expect(page.getByTestId('prescricao-envio-701')).toContainText('Cancelad');
    expect(pedidos[1]).toMatchObject({
      caminho: '/api/integracoes/prescricao-digital/envios/701/cancelar',
      corpo: { motivo: 'Receita substituída pelo prescritor', versao: 3 },
    });
    await semViolacaoAxe(page, 'prescricao-digital');
  });
});
