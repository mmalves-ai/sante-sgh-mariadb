// E2E @C2-070 (06-FAT linha 26): elegibilidade pelo serviço web da operadora. A recepção abre o paciente pelo endereço,
// consulta em um clique e a consulta já sai pelo serviço web cadastrado (o aviso diz que foi enviada); a linha pendente
// mostra "Ler o retorno" em vez do formulário à mão; na primeira leitura a operadora ainda não respondeu (nada muda);
// na segunda, o recibo vira a resposta elegível e a cobertura passa a mostrar a última elegibilidade. As rotas
// /api/tiss/elegibilidade exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas da API
// são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está em
// apps/api/src/modulos/tiss/elegibilidade-servico-web.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7402;

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

type Estado = 'nada' | 'enviada' | 'elegivel';
function visao(estado: Estado) {
  const consulta = {
    id: 82,
    fontePagadora: 'Operadora sintética',
    carteira: '0000222233334444',
    situacao: estado === 'elegivel' ? 'elegivel' : 'pendente',
    solicitadaEm: '2026-11-25T10:00:00.000Z',
    respondidaEm: estado === 'elegivel' ? '2026-11-25T10:01:00.000Z' : null,
    motivoNegativa: null,
    codigoValidacao: estado === 'elegivel' ? 'VSINT1' : null,
    por: 'Recepção sintética',
    versao: estado === 'elegivel' ? 3 : 2,
    pelaOperadora: true,
  };
  return {
    coberturas: [
      {
        id: 32,
        fontePagadora: 'Operadora sintética',
        carteira: '0000222233334444',
        validade: '2027-12-31',
        ultimaElegibilidadeEm: estado === 'elegivel' ? '2026-11-25T10:01:00.000Z' : null,
        ultimaAprovada: estado === 'elegivel' ? true : null,
      },
    ],
    consultas: estado === 'nada' ? [] : [consulta],
  };
}

test.describe('Elegibilidade pelo serviço web da operadora @C2-070 @fase7', () => {
  test.setTimeout(180_000);
  test('consulta sai pelo serviço web, retorno na fila não muda nada e o recibo vira a resposta; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let estado: Estado = 'nada';
    let leituras = 0;
    await page.route('**/api/tiss/elegibilidade**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/tiss\/elegibilidade\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === `pacientes/${PACIENTE}`) return json(rota, visao(estado));
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === '') {
        estado = 'enviada';
        return json(rota, { id: 82, situacao: 'pendente', reaproveitada: false, enviada: true }, 201);
      }
      if (caminho === '82/retorno') {
        leituras++;
        if (leituras === 1) return json(rota, { id: 82, situacao: 'pendente', aguardando: true });
        estado = 'elegivel';
        return json(rota, { id: 82, situacao: 'elegivel', aguardando: false });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.GUICHE');
    await page.goto(`/faturamento/elegibilidade?paciente=${PACIENTE}`);
    await expect(page.getByTestId('elegibilidade')).toBeVisible();
    const cobertura = page.getByTestId('eleg-cobertura-32');
    await expect(cobertura.getByTestId('eleg-ultima')).toHaveText('Nunca consultada');

    await cobertura.getByTestId('eleg-consultar').click();
    await expect(page.getByTestId('eleg-aviso')).toContainText('enviada à operadora pelo serviço web');
    expect(pedidos[0]).toEqual({ caminho: '', corpo: { cobertura: 32 } });

    const consulta = page.getByTestId('eleg-consulta-82');
    await expect(consulta.getByTestId('eleg-pela-operadora')).toBeVisible();
    await expect(consulta.getByTestId('eleg-resposta')).toHaveCount(0);
    await semViolacaoAxe(page, '/faturamento/elegibilidade (enviada pelo serviço web)');

    await consulta.getByTestId('eleg-ler-retorno').click();
    await expect(page.getByTestId('eleg-aviso')).toContainText('ainda não respondeu');
    await expect(consulta.getByTestId('eleg-situacao')).toHaveText('Aguardando a resposta');

    await consulta.getByTestId('eleg-ler-retorno').click();
    await expect(page.getByTestId('eleg-aviso')).toHaveText('Resposta registrada.');
    expect(pedidos.map((p) => p.caminho)).toEqual(['', '82/retorno', '82/retorno']);
    await expect(consulta.getByTestId('eleg-situacao')).toHaveText('Elegível');
    await expect(cobertura.getByTestId('eleg-ultima')).toContainText('Elegível em');
  });
});
