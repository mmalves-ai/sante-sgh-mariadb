// E2E @F39-5e (08-INTG L128 (31), ficha F3.9): elegibilidade do beneficiário pela visão do paciente. A recepção abre o
// paciente pelo endereço, vê a cobertura nunca consultada, consulta em um clique e registra a resposta da operadora na
// linha da consulta pendente: a negativa sem motivo é barrada na hora pela regra do domínio; com o motivo, sai com o
// corpo certo e a cobertura passa a mostrar a última elegibilidade. As rotas /api/tiss/elegibilidade exigem o banco
// próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas da API são simuladas pelo Playwright com massa
// SINTÉTICA. O efeito no banco está em apps/api/src/modulos/tiss/elegibilidade-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7401;

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

type Estado = 'nada' | 'pendente' | 'negada';
function visao(estado: Estado) {
  const consulta = {
    id: 81,
    fontePagadora: 'Operadora sintética',
    carteira: '0000111122223333',
    situacao: estado === 'negada' ? 'inelegivel' : 'pendente',
    solicitadaEm: '2026-11-24T10:00:00.000Z',
    respondidaEm: estado === 'negada' ? '2026-11-24T10:05:00.000Z' : null,
    motivoNegativa: estado === 'negada' ? 'Carência sintética' : null,
    codigoValidacao: null,
    por: 'Recepção sintética',
    versao: estado === 'negada' ? 2 : 1,
  };
  return {
    coberturas: [
      {
        id: 31,
        fontePagadora: 'Operadora sintética',
        carteira: '0000111122223333',
        validade: '2027-12-31',
        ultimaElegibilidadeEm: estado === 'negada' ? '2026-11-24T10:05:00.000Z' : null,
        ultimaAprovada: estado === 'negada' ? false : null,
      },
    ],
    consultas: estado === 'nada' ? [] : [consulta],
  };
}

test.describe('Elegibilidade do beneficiário @F39-5e @fase3', () => {
  test.setTimeout(180_000);
  test('consulta em um clique, negativa sem motivo barrada na hora e resposta enviada com o corpo certo; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let estado: Estado = 'nada';
    await page.route('**/api/tiss/elegibilidade**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/tiss\/elegibilidade\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === `pacientes/${PACIENTE}`) return json(rota, visao(estado));
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === '') {
        estado = 'pendente';
        return json(rota, { id: 81, situacao: 'pendente', reaproveitada: false }, 201);
      }
      if (caminho === '81/resposta') {
        estado = 'negada';
        return json(rota, { id: 81, situacao: 'inelegivel' });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.GUICHE');
    await page.goto(`/faturamento/elegibilidade?paciente=${PACIENTE}`);
    await expect(page.getByTestId('elegibilidade')).toBeVisible();
    const cobertura = page.getByTestId('eleg-cobertura-31');
    await expect(cobertura.getByTestId('eleg-ultima')).toHaveText('Nunca consultada');
    await semViolacaoAxe(page, '/faturamento/elegibilidade (coberturas)');

    await cobertura.getByTestId('eleg-consultar').click();
    await expect(page.getByTestId('eleg-aviso')).toContainText('Consulta registrada');
    expect(pedidos[0]).toEqual({ caminho: '', corpo: { cobertura: 31 } });

    const consulta = page.getByTestId('eleg-consulta-81');
    await expect(consulta.getByTestId('eleg-situacao')).toHaveText('Aguardando a resposta');
    await escolher(consulta.getByTestId('eleg-resposta'), { rotulo: 'Inelegível' });
    await expect(consulta.getByTestId('eleg-falta')).toContainText('A negativa da operadora exige o motivo.');
    await expect(consulta.getByTestId('eleg-registrar')).toBeDisabled();
    expect(pedidos).toHaveLength(1);
    await consulta.getByTestId('eleg-motivo').locator('input').fill('Carência sintética');
    await expect(consulta.getByTestId('eleg-falta')).toHaveCount(0);
    await semViolacaoAxe(page, '/faturamento/elegibilidade (resposta)');
    await consulta.getByTestId('eleg-registrar').click();
    await expect(page.getByTestId('eleg-aviso')).toHaveText('Resposta registrada.');
    expect(pedidos[1]).toEqual({
      caminho: '81/resposta',
      corpo: {
        situacao: 'inelegivel',
        codigoValidacao: null,
        motivoNegativa: 'Carência sintética',
        versao: 1,
      },
    });
    await expect(consulta.getByTestId('eleg-situacao')).toHaveText('Inelegível');
    await expect(cobertura.getByTestId('eleg-ultima')).toContainText('Negada em');
  });
});
