// F3.7 (06-FAT linha 17): cadastro do horário especial pelo caminho da tela, @C2-063. O cadastro exige o banco
// próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API destas rotas são simuladas
// pelo Playwright com massa SINTÉTICA; o que se prova é a tela: a validação na hora (faixa noturna sem percentual não
// sai), a faixa só de urgência com percentual de anestesia e replicada nos itens do mesmo ato gravada num clique, a
// inativação (nada se apaga) e o expediente da tabela com a validação do período. O efeito no banco (acréscimo ao
// lançar, urgência, mesmo ato e anestesia) está no contrato de efeito
// (apps/api/src/modulos/faturamento/conta-horario-especial-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const TABELA = 7631;

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

const faixa = (x: Record<string, unknown>) => ({
  id: 1,
  versao: 1,
  codigo: 'F376N',
  descricao: 'NOTURNO SINTETICO',
  tipoHorario: 'noturno',
  diaSemana: null,
  aplicaFeriado: false,
  horaInicio: '19:00:00',
  horaFim: '07:00:00',
  percentual: 30,
  percentualHonorario: null,
  percentualCustoOperacional: null,
  percentualFilme: null,
  percentualAnestesia: null,
  exigeUrgencia: false,
  aplicaProcedimentosVinculados: false,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  fontePagadoraId: null,
  contratoId: null,
  ativo: true,
  ...x,
});

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  const faixas = [faixa({})];
  let expediente = [{ diaSemana: 1, horaInicio: '07:00:00', horaFim: '19:00:00' }];
  await page.route('**/api/faturamento/horario-especial**', (rota) => {
    if (rota.request().method() === 'POST') {
      const corpo = rota.request().postDataJSON() as Record<string, unknown>;
      enviados.push({ faixa: corpo });
      if (corpo['id']) {
        const k = faixas.findIndex((f) => f.id === corpo['id']);
        faixas[k] = faixa({ ...corpo, versao: Number(corpo['versao']) + 1 });
      } else faixas.push(faixa({ ...corpo, id: faixas.length + 1, versao: 1 })); // a faixa nova nasce na versão 1
      return json(rota, { id: corpo['id'] ?? faixas.length });
    }
    const comTabela = rota.request().url().includes(`tabela=${TABELA}`);
    return json(rota, {
      faixas,
      expediente: comTabela ? expediente : [],
      fontes: [{ id: 51, nome: 'OPERADORA SINTETICA F376' }],
      tabelas: [{ id: TABELA, codigo: 'F376T', descricao: 'TABELA SINTETICA' }],
    });
  });
  await page.route(`**/api/faturamento/tabelas/${TABELA}/expediente`, (rota) => {
    const corpo = rota.request().postDataJSON() as { faixas: typeof expediente };
    enviados.push({ expediente: corpo });
    expediente = corpo.faixas.map((p) => ({
      ...p,
      horaInicio: `${p.horaInicio}:00`,
      horaFim: `${p.horaFim}:00`,
    }));
    return json(rota, { id: TABELA, gravadas: corpo.faixas.length, inativadas: 0 });
  });
}

test.describe('@C2-063 horário especial: faixas e expediente', () => {
  test('faixa só de urgência com anestesia e mesmo ato validada na hora e gravada; inativar; expediente; axe', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await simular(page, enviados);
    await entrar(page, 'SINT.TISS');
    await page.goto('/faturamento/horario-especial');
    await expect(page.getByTestId('tela-horario-especial')).toBeVisible();
    await expect(page.getByTestId('he-faixa-F376N')).toContainText('30%');
    await semViolacaoAxe(page, '/faturamento/horario-especial');

    // Validação na hora: sem código e sem percentual a faixa não sai.
    await page.getByTestId('he-gravar').click();
    await expect(page.getByTestId('he-form')).toContainText('Informe o código');
    expect(enviados).toHaveLength(0);

    await page.getByTestId('he-codigo').fill('F376U');
    await page.getByTestId('he-descricao').fill('URGENCIA NOTURNA SINTETICA');
    await escolher(page.getByTestId('he-tipo'), 'noturno');
    await escolher(page.getByTestId('he-fonte'), { rotulo: 'OPERADORA SINTETICA F376' });
    await page.getByTestId('he-percentual').fill('40');
    await page.getByTestId('he-anestesia').fill('50');
    await page.getByTestId('he-urgencia').check();
    await page.getByTestId('he-vinculados').check();
    await page.getByTestId('he-gravar').click();
    await expect(page.getByTestId('he-mensagem')).toBeVisible();
    expect(enviados[0]).toMatchObject({
      faixa: {
        id: null,
        codigo: 'F376U',
        tipoHorario: 'noturno',
        fontePagadoraId: 51,
        percentual: 40,
        percentualAnestesia: 50,
        exigeUrgencia: true,
        aplicaProcedimentosVinculados: true,
        horaInicio: '19:00',
        horaFim: '07:00',
      },
    });
    await expect(page.getByTestId('he-faixa-F376U')).toContainText('Só no atendimento de urgência');

    // Inativar não apaga: a faixa continua na lista, inativa.
    await page.getByTestId('he-ativo-F376N').click();
    await expect(page.getByTestId('he-faixa-F376N')).toContainText('Inativa');
    expect(enviados[1]).toMatchObject({ faixa: { id: 1, versao: 1, ativo: false } });

    // Expediente da tabela: período inválido bloqueia; o válido grava a lista inteira.
    await escolher(page.getByTestId('he-tabela'), { rotulo: /F376T/ });
    await expect(page.getByTestId('he-periodo-0')).toBeVisible();
    await page.getByTestId('he-incluir-periodo').click();
    await page.locator('#he-p-fim-1').fill('06:00');
    await expect(page.getByTestId('he-gravar-expediente')).toBeDisabled();
    await page.locator('#he-p-fim-1').fill('18:00');
    await page.getByTestId('he-gravar-expediente').click();
    await expect(page.getByTestId('he-mensagem')).toBeVisible();
    expect(enviados[2]).toMatchObject({
      expediente: {
        faixas: [
          { diaSemana: 1, horaInicio: '07:00', horaFim: '19:00' },
          { diaSemana: 1, horaInicio: '07:00', horaFim: '18:00' },
        ],
      },
    });
  });
});
