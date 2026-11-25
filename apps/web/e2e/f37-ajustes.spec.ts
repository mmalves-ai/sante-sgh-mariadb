// F3.7 (06-FAT linhas 18 e 20): acréscimo e desconto na conta com alçada e pacote na conta, pelo caminho da tela.
// Os ajustes exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo). Por isso as respostas da API
// destas rotas são simuladas pelo Playwright com massa SINTÉTICA; o que se prova é a tela: a validação na hora (sem
// justificativa o pedido não sai), o pedido de desconto num clique com o valor certo, a aprovação e a recusa com
// observação, e a descaracterização do pacote com motivo e justificativa depois do alerta de teto. O efeito no banco
// (alçada por valor, isolamento por estabelecimento, cabeçalho preservado) está no contrato de efeito
// (apps/api/src/modulos/faturamento/conta-ajustes-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const CONTA = 7305;

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

const ajuste = (id: number, tipo: string, valor: number, justificativa: string) => ({
  id,
  versao: 2,
  tipo,
  motivo: tipo === 'desconto' ? 'F375D - Desconto comercial' : 'F375A - Acréscimo sintético',
  forma: 'valor',
  percentual: null,
  valor,
  justificativa,
  situacao: 'pendente_aprovacao',
  solicitadoEm: '2026-01-20T14:00:00.000Z',
  solicitanteId: 901,
  solicitante: 'USUARIO SINTETICO',
  decisor: null,
});

async function simular(page: Page, enviados: Record<string, unknown>[]): Promise<void> {
  const ajustes = [ajuste(21, 'acrescimo', 20, 'Acréscimo sintético pedido')];
  await page.route(`**/api/faturamento/contas/${CONTA}/ajustes`, (rota) => {
    if (rota.request().method() === 'POST') {
      const corpo = rota.request().postDataJSON() as Record<string, unknown>;
      enviados.push({ pedido: corpo });
      ajustes.unshift(ajuste(22, 'desconto', Number(corpo['valor']), String(corpo['justificativa'])));
      return json(rota, { id: 22, valor: corpo['valor'], situacao: 'pendente_aprovacao' }, 201);
    }
    return json(rota, {
      contaId: CONTA,
      situacao: 'aberta',
      editavel: true,
      valores: { itens: 500, acrescimo: 0, desconto: 0, total: 500 },
      reservado: { desconto: 0, acrescimo: 0 },
      ajustes,
      motivos: [
        {
          id: 1,
          codigo: 'F375D',
          descricao: 'Desconto comercial',
          tipoAjuste: 'desconto',
          forma: null,
          valorPadrao: null,
          textoPadrao: null,
        },
        {
          id: 2,
          codigo: 'F375A',
          descricao: 'Acréscimo sintético',
          tipoAjuste: 'acrescimo',
          forma: null,
          valorPadrao: null,
          textoPadrao: null,
        },
      ],
      horario: [],
    });
  });
  await page.route('**/api/faturamento/ajustes-conta/*/decisao', (rota) => {
    const id = Number(rota.request().url().split('/ajustes-conta/')[1]!.split('/')[0]);
    enviados.push({ decisao: { id, ...(rota.request().postDataJSON() as object) } });
    return json(rota, { id, situacao: 'aprovado', total: 450 });
  });
  await page.route(`**/api/faturamento/contas/${CONTA}/pacotes`, (rota) =>
    json(rota, {
      contaId: CONTA,
      situacao: 'aberta',
      editavel: true,
      dias: 4,
      aplicados: [
        {
          id: 61,
          versao: 1,
          pacoteId: 51,
          pacote: 'F375PC - PACOTE SINTETICO',
          numeroVersao: 2,
          valorCobrado: 1000,
          ativo: true,
          descaracterizacao: null,
          inclusos: 1,
          aParte: 1,
          alertas: [
            {
              tipo: 'teto',
              descaracteriza: true,
              mensagem: 'Consumo de 300.00 passa o teto de 200.00 do pacote.',
            },
          ],
        },
      ],
      candidatos: [{ id: 51, codigo: 'F375PC', descricao: 'PACOTE SINTETICO' }],
      motivos: [{ id: 7, codigo: 'F375M', descricao: 'Intercorrência sintética', tipo: 'intercorrencia' }],
    }),
  );
  await page.route('**/api/faturamento/pacotes-conta/*/descaracterizacao', (rota) => {
    enviados.push({ descaracterizacao: rota.request().postDataJSON() });
    return json(rota, { id: 81, reabertos: 1, total: 350 }, 201);
  });
}

test.describe('ajustes da conta e pacote @F3.7', () => {
  test.setTimeout(180_000);

  test('desconto validado na hora e pedido num clique; aprovar e recusar com observação; descaracterizar o pacote com motivo; axe', async ({
    page,
  }) => {
    const enviados: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.TISS');
    await simular(page, enviados);

    await page.goto(`/faturamento/contas/${CONTA}/ajustes`);
    await expect(page.getByTestId('tela-ajustes-conta')).toBeVisible();
    await expect(page.getByTestId('aj-form')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/contas/:id/ajustes');

    // Validação na hora: sem justificativa o pedido não sai; com ela, o desconto vai com o valor digitado.
    await escolher(page.getByTestId('aj-tipo'), 'desconto');
    await escolher(page.getByTestId('aj-motivo'), { rotulo: 'Desconto comercial' });
    await escolher(page.getByTestId('aj-forma'), 'valor');
    await page.getByTestId('aj-valor').fill('50');
    await expect(page.getByTestId('aj-erros')).toContainText('Justifique');
    await expect(page.getByTestId('aj-pedir')).toBeDisabled();
    await page.getByTestId('aj-justificativa').fill('Acordo comercial sintético da conta');
    await expect(page.getByTestId('aj-erros')).toHaveCount(0);
    await page.getByTestId('aj-pedir').click();
    await expect.poll(() => enviados.find((e) => 'pedido' in e)).toBeTruthy();
    expect(enviados.find((e) => 'pedido' in e)?.['pedido']).toMatchObject({
      tipo: 'desconto',
      motivoId: 1,
      valor: 50,
      justificativa: 'Acordo comercial sintético da conta',
    });

    // O pedido aparece pendente; outro usuário aprova (a alçada é conferida no servidor).
    const lista = page.getByTestId('aj-lista');
    const linhaDesconto = lista.locator('tr', { hasText: 'Acordo comercial sintético da conta' });
    await expect(linhaDesconto).toBeVisible();
    await linhaDesconto.getByTestId('aj-aprovar').click();
    await expect.poll(() => enviados.find((e) => 'decisao' in e)).toBeTruthy();
    expect(enviados.find((e) => 'decisao' in e)?.['decisao']).toMatchObject({
      id: 22,
      versao: 2,
      decisao: 'aprovar',
    });

    // Recusar pede observação.
    const linhaAcrescimo = lista.locator('tr', { hasText: 'Acréscimo sintético pedido' });
    await linhaAcrescimo.getByTestId('aj-abrir-recusa').click();
    await expect(linhaAcrescimo.getByTestId('aj-recusar')).toBeDisabled();
    await linhaAcrescimo.getByTestId('aj-observacao').fill('Sem respaldo no acordo');
    await linhaAcrescimo.getByTestId('aj-recusar').click();
    await expect.poll(() => enviados.filter((e) => 'decisao' in e).length).toBe(2);
    expect(enviados.filter((e) => 'decisao' in e)[1]?.['decisao']).toMatchObject({
      id: 21,
      decisao: 'recusar',
      observacao: 'Sem respaldo no acordo',
    });

    // Pacote: o alerta de teto aparece; a descaracterização exige motivo e justificativa.
    await expect(page.getByTestId('aj-alertas')).toContainText('passa o teto');
    await page.getByTestId('aj-abrir-desc').click();
    await escolher(page.getByTestId('aj-motivo-desc'), { rotulo: 'Intercorrência sintética' });
    await page.getByTestId('aj-just-desc').fill('curta');
    await expect(page.getByTestId('aj-descaracterizar')).toBeDisabled();
    await page.getByTestId('aj-just-desc').fill('Teto de consumo superado na internação');
    await page.getByTestId('aj-descaracterizar').click();
    await expect.poll(() => enviados.find((e) => 'descaracterizacao' in e)).toBeTruthy();
    expect(enviados.find((e) => 'descaracterizacao' in e)?.['descaracterizacao']).toEqual({
      versao: 1,
      motivoId: 7,
      justificativa: 'Teto de consumo superado na internação',
    });
  });
});
