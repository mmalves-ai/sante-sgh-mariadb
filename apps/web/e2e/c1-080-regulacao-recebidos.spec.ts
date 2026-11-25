// C1-080 (02-REC linha 38): pedidos recebidos da central de regulação, na aba "Recebidos da central" da regulação do
// NIR (/internacao/nir/regulacao). Simula as rotas /api/nir/regulacao/recebidos (page.route com respostas
// sintéticas) e a busca de pacientes, e exercita pela tela:
//   - o registro do pedido recebido com a validação na hora (número da central, resumo clínico na urgência) e o
//     corpo enviado;
//   - a fila com a emergência primeiro;
//   - a recusa com motivo padronizado (complemento exigido em "outro") e o aceite da consulta com a especialidade da
//     lista de espera, conferindo o corpo enviado e a orientação da devolução à central.
// O que fica no banco é provado pelo contrato de efeito regulacao-entrada-propria.int.spec.ts. Axe em cada passo.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const R = '/api/nir/regulacao/recebidos';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (route: Route, corpo: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const pedido = (id: number, numero: string, tipo: string, prioridade: string, situacao = 'solicitada') => ({
  id,
  versao: 1,
  central: { id: 1, sigla: 'CENTRAL-SINT', nome: 'Central sintética', conexao: 'manual' },
  numero,
  tipo,
  prioridade,
  situacao,
  paciente: { id: 10 + id, prontuario: 900 + id, nome: `Paciente sintético ${id}` },
  solicitadoEm: '2026-11-25T10:00:00.000Z',
  reguladoEm: null,
  encerradoEm: null,
  resumoClinico: null,
  observacao: null,
  mensagemCentral: null,
  listaEspera: null,
  eventos: [
    {
      id: id * 10,
      tipo: 'contato_central',
      anterior: null,
      nova: 'solicitada',
      observacao: null,
      motivo: null,
      devolucao: null,
      por: 'SINT.ADMIN',
      em: '2026-11-25T10:01:00.000Z',
    },
  ],
});

test.describe('regulação: pedidos recebidos da central @C1-080', () => {
  test.setTimeout(180_000);

  test('registra o pedido recebido, recusa com motivo e aceita a consulta com lista de espera; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const enviados: { url: string; corpo: unknown }[] = [];
    await page.route('**/api/cadastros/pacientes?**', (r) =>
      json(r, {
        tipo: 'nome',
        itens: [
          {
            id: 77,
            prontuario: 9077,
            nome: 'Paciente sintético da central',
            nomeSocial: null,
            nascimento: '1980-01-01',
            situacao: 'ativo',
          },
        ],
        sugestoes: [],
        truncado: false,
        duracaoMs: 1,
      }),
    );
    await page.route(`**${R}/opcoes`, (r) =>
      json(r, {
        centrais: [
          {
            id: 1,
            sigla: 'CENTRAL-SINT',
            nome: 'Central sintética',
            conexao: 'manual',
            telefone: '0000-0000',
            email: null,
          },
        ],
        especialidades: [{ id: 5, nome: 'Cardiologia sintética' }],
      }),
    );
    await page.route(`**${R}/*/resposta`, async (r) => {
      const corpo = r.request().postDataJSON() as { decisao: string };
      enviados.push({ url: r.request().url(), corpo });
      await json(r, {
        id: 2,
        situacao: corpo.decisao === 'aceitar' ? 'autorizada' : 'negada',
        listaEspera: corpo.decisao === 'aceitar' ? 501 : null,
        devolucao: 'manual',
      });
    });
    await page.route(new RegExp(`${R}(\\?.*)?$`), async (r) => {
      if (r.request().method() === 'POST') {
        enviados.push({ url: r.request().url(), corpo: r.request().postDataJSON() });
        return json(r, { id: 3, situacao: 'solicitada' }, 201);
      }
      return json(r, {
        itens: [
          pedido(1, 'REG-SINT-0001', 'internacao', 'emergencia'),
          pedido(2, 'REG-SINT-0002', 'consulta', 'eletivo'),
        ],
      });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/internacao/nir/regulacao');
    await page.getByTestId('aba-regulacao-recebidos').click();
    await expect(page.getByTestId('regulacao-recebidos')).toBeVisible();
    // A fila traz a emergência primeiro.
    await expect(page.locator('[data-testid^="recebido-REG-"]').first()).toHaveAttribute(
      'data-testid',
      'recebido-REG-SINT-0001',
    );
    await semViolacaoAxe(page, '/internacao/nir/regulacao (recebidos)');

    // Registro do pedido recebido: validação na hora.
    await page.getByTestId('recebidos-novo').click();
    const registrar = page.getByTestId('rec-registrar');
    await expect(registrar).toBeDisabled();
    await escolher(page.getByTestId('rec-central'), { rotulo: /CENTRAL-SINT/ });
    await page.getByTestId('rec-numero').fill('A 1');
    await expect(page.getByTestId('form-recebido')).toContainText('Número da central de 4 a 30 letras');
    await page.getByTestId('rec-numero').fill('reg-sint-0003');
    await escolher(page.getByTestId('rec-prioridade'), 'urgente');
    await expect(page.getByTestId('rec-erro-resumo')).toBeVisible();
    await page.getByTestId('rec-resumo').fill('Quadro sintético estável, aguarda leito clínico.');
    await expect(page.getByTestId('rec-erro-resumo')).toHaveCount(0);
    await page.getByTestId('rec-busca').fill('sintetico');
    await page.getByTestId('rec-buscar').click();
    await page.getByTestId('rec-paciente-77').click();
    await expect(page.getByTestId('rec-paciente-escolhido')).toContainText('9077');
    await semViolacaoAxe(page, '/internacao/nir/regulacao (registro do pedido recebido)');
    await expect(registrar).toBeEnabled();
    await registrar.click();
    await expect(page.getByTestId('recebidos-mensagem')).toContainText('Pedido da central registrado');
    expect(enviados.at(-1)?.corpo).toMatchObject({
      central: 1,
      numero: 'REG-SINT-0003',
      tipo: 'internacao',
      prioridade: 'urgente',
      paciente: 77,
    });

    // Recusa com motivo padronizado: "outro" exige o complemento.
    await page.getByTestId('recusar-REG-SINT-0001').click();
    const confirmar = page.getByTestId('resp-confirmar');
    await expect(confirmar).toBeDisabled();
    await escolher(page.getByTestId('resp-motivo'), 'outro');
    await expect(page.getByTestId('resp-problemas')).toContainText('Detalhe o motivo da recusa');
    await page.getByTestId('resp-complemento').fill('Equipe sintética indisponível hoje');
    await expect(confirmar).toBeEnabled();
    await confirmar.click();
    await expect(page.getByTestId('recebidos-mensagem')).toContainText('CENTRAL-SINT');
    expect(enviados.at(-1)).toMatchObject({
      url: expect.stringContaining(`${R}/1/resposta`),
      corpo: { decisao: 'recusar', motivo: 'outro', versao: 1 },
    });

    // Aceite da consulta: a especialidade da lista de espera é pedida na hora.
    await page.getByTestId('aceitar-REG-SINT-0002').click();
    await expect(page.getByTestId('resp-problemas')).toContainText('especialidade');
    await escolher(page.getByTestId('resp-especialidade'), { rotulo: 'Cardiologia sintética' });
    await semViolacaoAxe(page, '/internacao/nir/regulacao (aceite)');
    await page.getByTestId('resp-confirmar').click();
    await expect(page.getByTestId('recebidos-mensagem')).toContainText('Resposta registrada');
    expect(enviados.at(-1)).toMatchObject({
      url: expect.stringContaining(`${R}/2/resposta`),
      corpo: { decisao: 'aceitar', motivo: null, especialidade: 5, versao: 1 },
    });
    expect(externas).toEqual([]);
  });
});
