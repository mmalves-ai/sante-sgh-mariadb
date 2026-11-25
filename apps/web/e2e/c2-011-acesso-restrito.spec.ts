// F8 (02-CAD linha 10): paciente com acesso restrito ao prontuário, com liberação nominal, pelo caminho da tela.
// A marca exige o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API destas
// rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: a lista leva à visão do paciente
// pelo número interno, a marca valida na hora (motivo curto, pseudônimo sem texto) antes de gravar, a liberação nominal
// escolhe o profissional pela busca e manda a justificativa, a revogação manda a versão e o encerramento manda o motivo.
// O efeito no banco e a decisão do filtro clínico estão no contrato de efeito
// (apps/api/src/modulos/cadastro/acesso-restrito-proprio.int.spec.ts) e no spec do interceptador.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 501;

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

test.describe('F8 paciente com acesso restrito ao prontuário @C2-011', () => {
  test('marca o paciente, libera e revoga o profissional e encerra a marca, com validação na hora', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const marcas: Record<string, unknown>[] = [];
    const liberacoes: Record<string, unknown>[] = [];

    await page.route('**/api/cadastros/acesso-restrito**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/destinos'))
          return json(r, {
            profissionais: [{ id: 901, nome: 'MEDICO SINTETICO UM' }],
            equipes: [{ id: 7, nome: 'EQUIPE SINTETICA' }],
          });
        return json(r, [
          { paciente: PACIENTE, nome: 'PACIENTE SINTETICO RESTRITO', tipos: ['confidencial'], liberacoes: 0 },
        ]);
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (url.pathname.endsWith('/liberacoes')) {
        liberacoes.push({
          id: 41,
          versao: 1,
          profissionalId: corpo['profissionalId'],
          equipeId: corpo['equipeId'],
          destino: 'MEDICO SINTETICO UM',
          justificativa: corpo['justificativa'],
          inicio: corpo['inicio'],
          fim: corpo['fim'],
          vigente: true,
        });
        return json(r, { id: 41 }, 201);
      }
      if (url.pathname.endsWith('/revogar')) {
        Object.assign(liberacoes[0]!, { vigente: false, versao: 2, fim: '2041-03-10T10:00:00' });
        return json(r, { id: 41 });
      }
      // encerrar
      Object.assign(marcas[0]!, {
        situacao: 'encerrada',
        viva: false,
        versao: 2,
        fim: '2041-03-10T11:00:00',
      });
      return json(r, { id: 31 });
    });
    await page.route(`**/api/cadastros/pacientes/${PACIENTE}/acesso-restrito`, (r) => {
      const req = r.request();
      if (req.method() === 'GET')
        return json(r, {
          paciente: { id: PACIENTE, nome: 'PACIENTE SINTETICO RESTRITO', prontuario: 'SINT-501' },
          marcas: marcas.map((m) => ({ ...m, liberacoes })),
        });
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: new URL(req.url()).pathname, corpo });
      marcas.push({
        id: 31,
        versao: 1,
        tipo: corpo['tipo'],
        motivo: corpo['motivo'],
        todosEstabelecimentos: corpo['todosEstabelecimentos'],
        exibicao: corpo['exibicao'],
        pseudonimo: corpo['pseudonimo'],
        exigeQuebraVidro: corpo['exigeQuebraVidro'],
        situacao: 'ativa',
        inicio: `${String(corpo['inicio'])}T00:00:00`,
        fim: null,
        viva: true,
      });
      return json(r, { id: 31 }, 201);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/cadastros/pacientes/acesso-restrito');
    await expect(page.getByTestId('acesso-restrito')).toBeVisible();
    await expect(page.getByRole('link', { name: 'PACIENTE SINTETICO RESTRITO' })).toBeVisible();

    // Visão do paciente pelo número interno.
    await page.getByTestId('ar-numero').fill(String(PACIENTE));
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cadastros/pacientes/${PACIENTE}/acesso-restrito$`));
    await expect(page.getByTestId('ar-paciente')).toContainText('PACIENTE SINTETICO RESTRITO');
    await expect(page.getByText('O paciente não tem marca de acesso restrito.')).toBeVisible();

    // Marca com validação na hora: motivo curto e pseudônimo vazio seguram o botão; nada vai ao servidor.
    await page.getByTestId('ar-nova').click();
    const formMarca = page.getByTestId('ar-form-marca');
    await escolher(page.getByLabel('Tipo da marca'), { rotulo: 'VIP' });
    await page.getByTestId('ar-motivo').fill('Curto');
    await escolher(page.getByLabel('Nome em telas, painéis e etiquetas'), { rotulo: 'Pseudônimo' });
    await expect(formMarca).toContainText('Escreva o motivo (10 letras ou mais).');
    await expect(formMarca).toContainText('Informe o pseudônimo (3 letras ou mais).');
    await expect(formMarca.getByRole('button', { name: 'Marcar', exact: true })).toBeDisabled();
    expect(pedidos).toHaveLength(0);
    await formMarca.getByLabel('Pseudônimo', { exact: true }).fill('Paciente Azul');
    await page.getByTestId('ar-motivo').fill('Pedido formal do paciente por exposição pública');
    await formMarca.getByRole('button', { name: 'Marcar', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Gravado.');
    expect(pedidos[0]).toMatchObject({
      caminho: `/api/cadastros/pacientes/${PACIENTE}/acesso-restrito`,
      corpo: {
        tipo: 'vip',
        exibicao: 'pseudonimo',
        pseudonimo: 'Paciente Azul',
        exigeQuebraVidro: true,
        fim: null,
      },
    });
    const marca = page.getByTestId('ar-marca-31');
    await expect(marca).toContainText('VIP');
    await expect(marca).toContainText('Em vigor');
    await expect(marca).toContainText('Ninguém liberado nominalmente.');

    // Liberação nominal: busca do profissional (3 letras), justificativa curta segura; depois grava.
    await page.getByTestId('ar-liberar').click();
    const formLib = page.getByTestId('ar-form-liberar');
    await page.getByTestId('ar-busca').fill('MED');
    await page.getByTestId('ar-justificativa').fill('Curta');
    await expect(formLib).toContainText('Escolha um profissional ou uma equipe.');
    await expect(formLib.getByRole('button', { name: 'Liberar', exact: true })).toBeDisabled();
    await escolher(page.getByLabel('Profissional ou equipe'), {
      rotulo: 'Profissional: MEDICO SINTETICO UM',
    });
    await page.getByTestId('ar-justificativa').fill('Médico assistente escolhido pelo paciente');
    await formLib.getByRole('button', { name: 'Liberar', exact: true }).click();
    await expect(page.getByTestId('ar-liberacao-41')).toContainText('MEDICO SINTETICO UM');
    await expect(page.getByTestId('ar-liberacao-41')).toContainText('Vigente');
    expect(pedidos[1]).toMatchObject({
      caminho: '/api/cadastros/acesso-restrito/31/liberacoes',
      corpo: {
        profissionalId: 901,
        equipeId: null,
        justificativa: 'Médico assistente escolhido pelo paciente',
      },
    });

    // Revogação: manda a versão; a liberação fica na lista como terminada (nada é apagado).
    await page.getByTestId('ar-liberacao-41').getByRole('button', { name: 'Revogar' }).click();
    await expect(page.getByTestId('ar-liberacao-41')).toContainText('Terminada');
    expect(pedidos[2]).toMatchObject({
      caminho: '/api/cadastros/acesso-restrito/liberacoes/41/revogar',
      corpo: { versao: 1 },
    });

    // Encerramento com motivo: a marca continua na visão, encerrada.
    await page.getByTestId('ar-encerrar').click();
    const formEncerrar = page.locator('form').filter({ has: page.getByTestId('ar-motivo-encerrar') });
    await page.getByTestId('ar-motivo-encerrar').fill('Curto');
    await expect(formEncerrar.getByRole('button', { name: 'Encerrar a marca' })).toBeDisabled();
    await page.getByTestId('ar-motivo-encerrar').fill('Paciente recebeu alta e pediu o fim da restrição');
    await formEncerrar.getByRole('button', { name: 'Encerrar a marca' }).click();
    await expect(marca).toContainText('Encerrada');
    expect(pedidos[3]).toMatchObject({
      caminho: '/api/cadastros/acesso-restrito/31/encerrar',
      corpo: { versao: 1, motivo: 'Paciente recebeu alta e pediu o fim da restrição' },
    });
    await expect(page.getByTestId('ar-liberar')).toHaveCount(0);

    await semViolacaoAxe(page, 'acesso restrito ao prontuário');
  });
});
